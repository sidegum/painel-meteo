// Calcula a calibração a partir da tabela diária de histórico e grava:
//   dados/calibracao.json          → lido pelo app (js/dados.js: buscarCalibracao)
//   docs/calibracao-resultado.md   → relatório legível com os números de antes e depois
//
//   node scripts/calibrar.mjs     (sem rede; roda em segundos)
//
// Método e justificativas: docs/CALIBRACAO.md.

import { readFile, writeFile } from 'node:fs/promises';
import {
  MODELOS_CALIBRACAO, LEADS, PARAM, ESTACOES, pares, ajustarVies, corrigirVies, ajustarFator, corrigirFator,
  validar, metricas, contingenciaChuva, pesosRelativos, foraDaAmostra, coerenciaFator, arredondar as r,
} from './lib/calibracao.mjs';
import { paresChuva, ajustarChuva, validarChuva, tabelaFinal, corrigirChuva, PARAM_CHUVA } from './lib/chuva.mjs';
import { MODELOS_HORARIO, LEADS_HORARIO, PARAM_HORARIO, diasHorarios, validarHorario, ajusteFinal } from './lib/temperatura-horaria.mjs';

const ARQ_HIST = new URL('../dados/historico/A884-diario.json', import.meta.url);
const ARQ_HORARIO = new URL('../dados/historico/A884-horario.json', import.meta.url);
const ARQ_CALIB = new URL('../dados/calibracao.json', import.meta.url);
const ARQ_RELAT = new URL('../docs/calibracao-resultado.md', import.meta.url);

const tabela = JSON.parse(await readFile(ARQ_HIST, 'utf8'));
const datasObs = Object.keys(tabela.dias).filter((d) => tabela.dias[d].obs).sort();
if (datasObs.length < PARAM.minPares) {
  console.log(`Só ${datasObs.length} dias com medição: calibração não recalculada (o arquivo anterior continua valendo).`);
  process.exit(0);
}
const modelosApp = Object.keys(MODELOS_CALIBRACAO).filter((m) => MODELOS_CALIBRACAO[m].app);

const porEstacao = (aj, campo) => Object.fromEntries(ESTACOES.map((e) => [e, r(aj.porEstacao[e][campo], 3)]));
const nPorEstacao = (aj) => Object.fromEntries(ESTACOES.map((e) => [e, aj.porEstacao[e].n]));

// ------------------------------------------------------------------ por modelo e antecedência

const modelos = {};
const cobertura = {};
for (const m of Object.keys(MODELOS_CALIBRACAO)) {
  const res = { nome: MODELOS_CALIBRACAO[m].nome, app: MODELOS_CALIBRACAO[m].app, tmax: {}, tmin: {}, rajada: {}, vento: {}, chuva: {} };
  const datas = Object.keys(tabela.dias).filter((d) => tabela.dias[d].prev?.[m]).sort();
  cobertura[m] = datas.length ? { ini: datas[0], fim: datas.at(-1), dias: datas.length } : null;
  for (const L of LEADS) {
    for (const campo of ['tmax', 'tmin']) {
      const ps = pares(tabela, m, L, campo);
      const aj = ajustarVies(ps);
      if (!aj) continue;
      const v = validar(ps, ajustarVies, corrigirVies);
      res[campo][L] = {
        usar: v.usar, n: aj.n, viesAnual: r(aj.anual, 3), vies: porEstacao(aj, 'vies'), nEstacao: nPorEstacao(aj),
        maeAntes: r(v.antes.mae), maeDepois: r(v.depois.mae), ganho: r(v.ganho, 3),
      };
    }
    for (const campo of ['rajada', 'vento']) {
      const ps = pares(tabela, m, L, campo);
      const aj = ajustarFator(ps);
      if (!aj) continue;
      const v = validar(ps, ajustarFator, corrigirFator);
      res[campo][L] = {
        usar: v.usar, n: aj.n, fatorAnual: r(aj.anual, 3), fator: porEstacao(aj, 'fator'), nEstacao: nPorEstacao(aj),
        maeAntes: r(v.antes.mae), maeDepois: r(v.depois.mae), viesAntes: r(v.antes.vies), viesDepois: r(v.depois.vies), ganho: r(v.ganho, 3),
      };
    }
    const pc = pares(tabela, m, L, 'chuva');
    if (pc.length >= PARAM.minPares) {
      const met = metricas(pc), c = contingenciaChuva(pc);
      const somaP = pc.reduce((s, p) => s + p.prev, 0), somaO = pc.reduce((s, p) => s + p.obs, 0);
      res.chuva[L] = {
        n: met.n, mae: r(met.mae), vies: r(met.vies), razaoVolume: r(somaP / Math.max(somaO, 1e-9), 3),
        acerto: r(c.acerto, 3), pod: r(c.pod, 3), far: r(c.far, 3), viesFrequencia: r(c.vies, 3), csi: r(c.csi, 3),
      };
    }
  }
  // Chuva: mapeamento de quantis do total diário (antecedências somadas), validado fora da amostra
  const psChuva = paresChuva(tabela, m);
  const vc = validarChuva(psChuva), ajc = ajustarChuva(psChuva);
  if (vc && ajc) {
    const fx = (x) => x && Object.fromEntries(Object.entries(x).map(([k, v]) => [k, r(v, 3)]));
    res.chuvaQuantis = {
      usar: vc.usar, n: ajc.n, tabela: tabelaFinal(ajc),
      validacao: {
        total: { antes: fx(vc.total.antes), depois: fx(vc.total.depois) },
        porLead: Object.fromEntries(Object.entries(vc.porLead).filter(([, x]) => x).map(([L, x]) => [L, { n: x.n, antes: fx(x.antes), depois: fx(x.depois) }])),
      },
    };
  }
  // Rajada e vento: o fator precisa ser coerente entre antecedências (senão é artefato do arquivo, não erro do
  // modelo). Sem fator coerente de 1 a 5 dias, usa o da rajada de curto prazo (Historical Forecast), se validado:
  // nos modelos que têm as duas (GFS, ICON), o fator quase não muda com a antecedência (ver relatório).
  for (const campo of ['rajada', 'vento']) {
    const coer = coerenciaFator(res[campo]);
    if (!coer.coerente) {
      for (const L of LEADS) if (res[campo][L]) { res[campo][L].usar = false; res[campo][L].motivo = `fator varia ${r(coer.razao, 2)}× entre antecedências`; }
    }
    res[`${campo}Coerencia`] = coer.razao === null ? null : r(coer.razao, 3);
  }
  const ps0 = pares(tabela, m, 0, 'rajada');
  const aj0 = ajustarFator(ps0);
  if (aj0) {
    const v0 = validar(ps0, ajustarFator, corrigirFator);
    res.rajadaCurtoPrazo = {
      usar: v0.usar, n: aj0.n, fatorAnual: r(aj0.anual, 3), fator: porEstacao(aj0, 'fator'), nEstacao: nPorEstacao(aj0),
      maeAntes: r(v0.antes.mae), maeDepois: r(v0.depois.mae), viesAntes: r(v0.antes.vies), viesDepois: r(v0.depois.vies), ganho: r(v0.ganho, 3),
    };
    const temUsavel = LEADS.some((L) => res.rajada[L]?.usar);
    if (!temUsavel && v0.usar) {
      for (const L of LEADS) res.rajada[L] = { ...res.rajadaCurtoPrazo, origem: 'curto prazo', ...(res.rajada[L] ? { arquivoLead: { fatorAnual: res.rajada[L].fatorAnual, motivo: res.rajada[L].motivo ?? null } } : {}) };
    }
  }
  modelos[m] = res;
}

// ------------------------------------------------------------------ pesos dos modelos do app

// Erro médio das antecedências 1 a 5 em datas comuns aos três modelos, para a comparação ser justa.
const comuns = Object.keys(tabela.dias).filter((d) => tabela.dias[d].obs && modelosApp.every((m) => tabela.dias[d].prev?.[m]));
const tabComum = { dias: Object.fromEntries(comuns.map((d) => [d, tabela.dias[d]])) };
const maeComum = {};
for (const m of modelosApp) {
  maeComum[m] = {};
  for (const campo of ['chuva', 'tmax', 'rajada']) {
    const xs = LEADS.map((L) => metricas(pares(tabComum, m, L, campo)).mae).filter((x) => x !== null);
    maeComum[m][campo] = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  }
}
const pesos = pesosRelativos(maeComum);

// ------------------------------------------------------------------ o que o usuário vê: antes e depois

// Temperatura exibida: ECMWF IFS (js/app.js, MODELO_TEMP). Rajada exibida: mediana dos modelos com rajada.
function resumoTemperatura() {
  const out = {};
  for (const campo of ['tmax', 'tmin']) {
    out[campo] = {};
    for (const L of LEADS) {
      const x = modelos.ecmwf_ifs[campo][L];
      if (x) out[campo][L] = { n: x.n, maeAntes: x.maeAntes, maeDepois: x.usar ? x.maeDepois : x.maeAntes, usar: x.usar };
    }
  }
  return out;
}

/**
 * Rajada corrigida fora da amostra de um modelo numa antecedência, do jeito que o app aplica: com o fator da
 * própria antecedência, ou com o de curto prazo quando é ele que está em uso. Sem correção aprovada, a bruta.
 * @returns {Map<string, number>} data → rajada corrigida
 */
function rajadaCorrigida(m, L) {
  const ps = pares(tabela, m, L, 'rajada');
  const cfg = modelos[m].rajada[L];
  const out = new Map(ps.map((p) => [p.data, p.prev]));
  if (!cfg?.usar) return out;
  if (cfg.origem === 'curto prazo') {
    const ps0 = pares(tabela, m, 0, 'rajada');
    for (const mes of new Set(ps.map((p) => p.mes))) {
      const aj = ajustarFator(ps0.filter((p) => p.mes !== mes));
      for (const p of ps) if (p.mes === mes) out.set(p.data, aj ? corrigirFator(aj, p) : p.prev);
    }
    return out;
  }
  const cor = foraDaAmostra(ps, ajustarFator, corrigirFator);
  ps.forEach((p, i) => out.set(p.data, cor[i]));
  return out;
}

/**
 * Chuva diária de um modelo numa antecedência como o app mostra: mapeada pela tabela de quantis ajustada sem o
 * mês do dia (fora da amostra) quando a correção foi aprovada; senão, a bruta.
 * @returns {Map<string, number>} data → chuva (mm)
 */
function chuvaCorrigida(m, L) {
  const ps = pares(tabela, m, L, 'chuva');
  const out = new Map(ps.map((p) => [p.data, p.prev]));
  if (!modelos[m].chuvaQuantis?.usar) return out;
  const todos = paresChuva(tabela, m);
  for (const mes of new Set(ps.map((p) => p.mes))) {
    const aj = ajustarChuva(todos.filter((p) => p.mes !== mes));
    for (const p of ps) if (p.mes === mes) out.set(p.data, corrigirChuva(aj, p));
  }
  return out;
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

function resumoRajada() {
  const out = {};
  const comRajada = modelosApp.filter((m) => LEADS.some((L) => pares(tabela, m, L, 'rajada').length));
  for (const L of LEADS) {
    // por dia: mediana dos modelos com rajada, bruta e corrigida fora da amostra
    const porData = new Map();
    for (const m of comRajada) {
      const cor = rajadaCorrigida(m, L);
      for (const p of pares(tabela, m, L, 'rajada')) {
        if (!porData.has(p.data)) porData.set(p.data, { obs: p.obs, bruto: [], corr: [] });
        porData.get(p.data).bruto.push(p.prev); porData.get(p.data).corr.push(cor.get(p.data));
      }
    }
    const dias = [...porData.values()].filter((d) => d.bruto.length === comRajada.length);
    if (dias.length < PARAM.minPares) continue;
    const antes = metricas(dias.map((d) => ({ prev: med(d.bruto), obs: d.obs })));
    const depois = metricas(dias.map((d) => ({ prev: med(d.corr), obs: d.obs })));
    out[L] = { n: dias.length, modelos: comRajada, maeAntes: r(antes.mae), maeDepois: r(depois.mae), viesAntes: r(antes.vies), viesDepois: r(depois.vies) };
  }
  return out;
}

// ------------------------------------------------------------------ placar de acerto

// Limites do que conta como "acertou" no placar. Ajustáveis aqui; o app só exibe.
const PLACAR = { tempC: 2, rajadaKmh: 10, dias: 30 };

/**
 * Placar de acerto da previsão da véspera (antecedência de 1 dia), do jeito que o painel mostra:
 * - chuva: consenso (mediana) dos modelos do painel, já com a correção de chuva fora da amostra, com 1 mm ou
 *   mais × medição com 1 mm ou mais;
 * - máxima e mínima: ECMWF IFS corrigido fora da amostra, acerto = erro de até ±2 °C;
 * - rajada: mediana dos modelos com rajada, corrigida fora da amostra, acerto = erro de até ±10 km/h.
 * Calculado para os últimos 30 dias com medição e para todo o período com os três modelos.
 */
function placar() {
  const L = 1;
  const dia = new Map(); // data → { chuva: [...], tmax, tmin, raj: [...] , obs }
  const pega = (d) => { if (!dia.has(d)) dia.set(d, { chuva: [], raj: [], obs: tabela.dias[d].obs }); return dia.get(d); };
  for (const m of modelosApp) for (const [d, v] of chuvaCorrigida(m, L)) pega(d).chuva.push(v);
  for (const campo of ['tmax', 'tmin']) {
    const ps = pares(tabela, 'ecmwf_ifs', L, campo);
    const cor = modelos.ecmwf_ifs[campo][L]?.usar ? foraDaAmostra(ps, ajustarVies, corrigirVies) : ps.map((p) => p.prev);
    // com o método hora a hora aprovado, o placar usa a máxima e a mínima dele (as que o painel mostra)
    const hor = maximasHorarias.get(`ecmwf_ifs:${L}`);
    ps.forEach((p, i) => { pega(p.data)[campo] = hor?.get(p.data)?.[campo] ?? cor[i]; });
  }
  const comRajada = modelosApp.filter((m) => pares(tabela, m, L, 'rajada').length);
  for (const m of comRajada) for (const [d, v] of rajadaCorrigida(m, L)) pega(d).raj.push(v);

  const resumo = (datas) => {
    const conta = (ok) => { const xs = datas.map(ok).filter((x) => x !== null); return { n: xs.length, acertos: xs.filter(Boolean).length, pct: xs.length ? r(xs.filter(Boolean).length / xs.length, 3) : null }; };
    const erro = (f) => { const xs = datas.map(f).filter((x) => x !== null); return xs.length ? r(xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length) : null; };
    const x = (d) => dia.get(d);
    const chuvaOk = (d) => (x(d).chuva.length >= 2 && x(d).obs.chuva != null ? (med(x(d).chuva) >= PARAM.chuvaDia) === (x(d).obs.chuva >= PARAM.chuvaDia) : null);
    const tErr = (c) => (d) => (x(d)[c] != null && x(d).obs[c] != null ? x(d)[c] - x(d).obs[c] : null);
    const rErr = (d) => (x(d).raj.length === comRajada.length && comRajada.length && x(d).obs.rajada != null ? med(x(d).raj) - x(d).obs.rajada : null);
    return {
      ini: datas[0] ?? null, fim: datas.at(-1) ?? null, dias: datas.length,
      chuva: conta(chuvaOk),
      tmax: { ...conta((d) => (tErr('tmax')(d) === null ? null : Math.abs(tErr('tmax')(d)) <= PLACAR.tempC)), erroMedio: erro(tErr('tmax')) },
      tmin: { ...conta((d) => (tErr('tmin')(d) === null ? null : Math.abs(tErr('tmin')(d)) <= PLACAR.tempC)), erroMedio: erro(tErr('tmin')) },
      rajada: { ...conta((d) => (rErr(d) === null ? null : Math.abs(rErr(d)) <= PLACAR.rajadaKmh)), erroMedio: erro(rErr) },
    };
  };
  // dias em que os três modelos do painel têm chuva prevista e há medição
  const datas = [...dia.keys()].filter((d) => dia.get(d).chuva.length === modelosApp.length && dia.get(d).obs).sort();
  return {
    antecedencia: L, limites: PLACAR, fonte: `INMET ${tabela.estacao.id}`,
    ultimos: resumo(datas.slice(-PLACAR.dias)), completo: resumo(datas),
  };
}

// ------------------------------------------------------------------ temperatura hora a hora (modelos do painel)

/**
 * Correção hora a hora da temperatura de cada modelo do painel, por antecedência
 * (scripts/lib/temperatura-horaria.mjs), com a validação fora da amostra contra a previsão bruta e contra o
 * método diário (só máxima e mínima). null quando ainda não há a tabela horária.
 */
// modelo:antecedência → (data → máxima e mínima corrigidas hora a hora, fora da amostra), para o placar
const maximasHorarias = new Map();
async function temperaturaHoraria() {
  let horario;
  try { horario = JSON.parse(await readFile(ARQ_HORARIO, 'utf8')); } catch { return null; }
  const res = { fontes: horario.fontes, metodo: { ...PARAM_HORARIO, documento: 'docs/CALIBRACAO.md' }, modelos: {} };
  const resumo = (v) => v && Object.fromEntries(['horaria', 'tarde', 'tmax', 'tmin'].map((k) => [k,
    Object.fromEntries(Object.entries(v[k]).map(([nome, x]) => [nome, { n: x.n, mae: r(x.mae), vies: r(x.vies) }]))]));
  for (const m of MODELOS_HORARIO) {
    // método diário em uso (só máxima e mínima), ajustado sem o mês de teste
    const metodoDiario = (L) => (treino) => {
      const ajuste = (campo) => (modelos[m]?.[campo]?.[L]?.usar
        ? ajustarVies(pares(tabela, m, L, campo).filter((p) => treino(p.mes))) : null);
      const a = ajuste('tmax'), b = ajuste('tmin');
      return (est) => ({ tmax: a ? a.porEstacao[est].vies : 0, tmin: b ? b.porEstacao[est].vies : 0 });
    };
    const dias0 = diasHorarios(horario, m, 'h0', tabela);
    const v0 = validarHorario(dias0, [], () => null);
    const out = { nome: MODELOS_CALIBRACAO[m].nome, curtoPrazo: { dias: dias0.length, ini: dias0[0]?.data ?? null, fim: dias0.at(-1)?.data ?? null, validacao: resumo(v0) }, leads: {} };
    for (const L of LEADS_HORARIO) {
      const dias = diasHorarios(horario, m, `p${L}`, tabela);
      const v = validarHorario(dias, dias0, metodoDiario(L));
      const fim = ajusteFinal(dias, dias0);
      if (!v || !fim) { out.leads[L] = { usar: false, dias: dias.length }; continue; }
      out.leads[L] = { usar: v.usar, ...fim, ini: dias[0].data, fim: dias.at(-1).data, validacao: resumo(v) };
      if (v.usar) maximasHorarias.set(`${m}:${L}`, v.porDia);
      console.log(`Hora a hora ${m}, ${L} dia(s): ${dias.length} dias, erro por hora ${r(v.horaria.bruta.mae)} → diário ${r(v.horaria.diaria.mae)} → horário ${r(v.horaria.horaria.mae)} °C; ${v.usar ? 'em uso' : 'não usado'}`);
    }
    res.modelos[m] = out;
  }
  return res;
}

const horaria = await temperaturaHoraria();
const calib = {
  versao: 1,
  geradoEm: new Date().toISOString(),
  estacao: { id: tabela.estacao.id, nome: tabela.estacao.nome, lat: tabela.estacao.lat, lon: tabela.estacao.lon },
  periodo: { ini: datasObs[0], fim: datasObs.at(-1), diasComMedicao: datasObs.length },
  fontes: tabela.fontes,
  metodo: {
    validacao: 'leave-one-month-out', encolhimentoDias: PARAM.encolhimento, ganhoMinimo: PARAM.ganhoMinimo,
    limitesFatorVento: PARAM.fatorVento, documento: 'docs/CALIBRACAO.md',
  },
  cobertura,
  pesos: Object.fromEntries(Object.entries(pesos).map(([m, p]) => [m, r(p, 3)])),
  maeComum: Object.fromEntries(Object.entries(maeComum).map(([m, x]) => [m, { chuva: r(x.chuva), tmax: r(x.tmax), rajada: r(x.rajada) }])),
  diasComuns: comuns.length,
  resumo: { temperaturaEcmwf: resumoTemperatura(), rajadaMediana: resumoRajada() },
  placar: placar(),
  outras: await outrasEstacoes(),
  temperaturaHoraria: horaria,
  modelos,
};

await writeFile(ARQ_CALIB, JSON.stringify(calib, null, 1) + '\n');
await writeFile(ARQ_RELAT, relatorio(calib));
console.log(`Calibração gravada: ${datasObs.length} dias com medição, ${comuns.length} dias comuns aos modelos do app.`);

// ------------------------------------------------------------------ outras estações (só acerto)

/**
 * Acerto dos modelos do painel nas outras estações de verificação (Porto Alegre e Canoas), sem correção:
 * a calibração vem só de Campo Bom. Serve à tabela "Acerto de cada modelo" do app.
 */
async function outrasEstacoes() {
  const out = {};
  for (const id of ['A801', 'SBCO', 'SBPA']) {
    let t;
    try { t = JSON.parse(await readFile(new URL(`../dados/historico/${id}-diario.json`, import.meta.url), 'utf8')); } catch { continue; }
    const datas = Object.keys(t.dias).filter((d) => t.dias[d].obs).sort();
    if (datas.length < PARAM.minPares) continue;
    const mods = {};
    for (const m of modelosApp) {
      mods[m] = {};
      for (const L of LEADS) {
        const pc = pares(t, m, L, 'chuva'), pt = pares(t, m, L, 'tmax'), pr = pares(t, m, L, 'rajada');
        const n = Math.max(pc.length, pt.length, pr.length);
        if (n < PARAM.minPares) continue;
        mods[m][L] = {
          n, acertoChuva: pc.length >= PARAM.minPares ? r(contingenciaChuva(pc).acerto, 3) : null,
          maeChuva: pc.length >= PARAM.minPares ? r(metricas(pc).mae) : null,
          maeTmax: pt.length >= PARAM.minPares ? r(metricas(pt).mae) : null,
          maeRajada: pr.length >= PARAM.minPares ? r(metricas(pr).mae) : null,
        };
      }
    }
    out[id] = { estacao: t.estacao, periodo: { ini: datas[0], fim: datas.at(-1), diasComMedicao: datas.length }, fontes: t.fontes, modelos: mods };
    console.log(`${id}: ${datas.length} dias com medição.`);
  }
  return out;
}

// ------------------------------------------------------------------ relatório

function relatorio(c) {
  const f = (v, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d).replace('.', ','));
  const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
  const L = [];
  L.push('# Resultado da calibração (gerado automaticamente)', '');
  L.push(`Gerado em ${c.geradoEm.slice(0, 16).replace('T', ' ')} UTC por \`scripts/calibrar.mjs\`. Método em [CALIBRACAO.md](CALIBRACAO.md).`, '');
  L.push(`Estação: INMET ${c.estacao.id} ${c.estacao.nome}. Medições de ${c.periodo.ini} a ${c.periodo.fim} (${c.periodo.diasComMedicao} dias válidos).`, '');
  L.push('Todos os números de "depois" são **fora da amostra**: cada mês foi corrigido com uma calibração que não viu aquele mês.', '');
  L.push('## Cobertura das previsões passadas', '', '| Modelo | No painel | De | Até | Dias |', '|---|---|---|---|---|');
  for (const [m, x] of Object.entries(c.cobertura)) L.push(`| ${MODELOS_CALIBRACAO[m].nome} | ${MODELOS_CALIBRACAO[m].app ? 'sim' : 'referência'} | ${x?.ini ?? '–'} | ${x?.fim ?? '–'} | ${x?.dias ?? 0} |`);
  L.push('', '## Temperatura exibida (ECMWF IFS): erro médio em °C', '', '| Antecedência | Máx. antes | Máx. depois | Mín. antes | Mín. depois | Dias |', '|---|---|---|---|---|---|');
  for (const l of LEADS) {
    const a = c.resumo.temperaturaEcmwf.tmax[l], b = c.resumo.temperaturaEcmwf.tmin[l];
    L.push(`| ${l} dia(s) | ${f(a?.maeAntes)} | ${f(a?.maeDepois)} | ${f(b?.maeAntes)} | ${f(b?.maeDepois)} | ${a?.n ?? '–'} |`);
  }
  for (const [m, th] of Object.entries(c.temperaturaHoraria?.modelos || {})) {
    const met = c.temperaturaHoraria.metodo;
    L.push('', `## Temperatura hora a hora (${th.nome}): erro médio em °C`, '',
      `Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde ${th.curtoPrazo.ini ?? '–'} (${th.curtoPrazo.dias} dias), mais o ajuste da máxima e da mínima. Tarde: ${met.tarde[0]} h a ${met.tarde[1]} h.`, '');
    L.push('| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |', '|---|---|---|---|---|---|---|');
    const tri = (x) => (x ? `${f(x.bruta?.mae)} / ${f(x.diaria?.mae)} / ${f(x.horaria?.mae)}` : '–');
    const v0 = th.curtoPrazo.validacao;
    if (v0) L.push(`| curto prazo | ${th.curtoPrazo.dias} | ${f(v0.horaria.bruta.mae)} / – / ${f(v0.horaria.horaria.mae)} | ${f(v0.tarde.bruta.mae)} / – / ${f(v0.tarde.horaria.mae)} | ${f(v0.tmax.bruta.mae)} / – / ${f(v0.tmax.horaria.mae)} | ${f(v0.tmin.bruta.mae)} / – / ${f(v0.tmin.horaria.mae)} | base |`);
    for (const l of LEADS_HORARIO) {
      const x = th.leads[l], v = x?.validacao;
      L.push(`| ${l} dia(s) | ${x?.dias ?? 0} | ${tri(v?.horaria)} | ${tri(v?.tarde)} | ${tri(v?.tmax)} | ${tri(v?.tmin)} | ${x?.usar ? 'sim' : 'não'} |`);
    }
    const x1 = th.leads[1], hs = [0, 3, 6, 9, 12, 14, 15, 16, 18, 21];
    if (x1?.vies) {
      L.push('', `Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):`, '');
      L.push(`| Estação | ${hs.map((h) => `${h} h`).join(' | ')} |`, `|---|${'---|'.repeat(hs.length)}`);
      for (const e of ESTACOES) L.push(`| ${e} | ${hs.map((h) => f(x1.vies[e][h])).join(' | ')} |`);
    }
  }
  L.push('', '## Rajada exibida (mediana dos modelos): erro médio em km/h', '', '| Antecedência | Antes | Depois | Viés antes | Viés depois | Dias |', '|---|---|---|---|---|---|');
  for (const l of LEADS) {
    const a = c.resumo.rajadaMediana[l];
    L.push(`| ${l} dia(s) | ${f(a?.maeAntes)} | ${f(a?.maeDepois)} | ${f(a?.viesAntes)} | ${f(a?.viesDepois)} | ${a?.n ?? '–'} |`);
  }
  const pl = c.placar;
  L.push('', `## Placar de acerto da véspera`, '', `Chuva: consenso dos modelos do painel já corrigidos (1 mm ou mais). Máxima e mínima: ECMWF IFS corrigido, acerto = até ±${pl.limites.tempC} °C. Rajada: mediana corrigida, acerto = até ±${pl.limites.rajadaKmh} km/h.`, '');
  L.push('| Período | Chuva | Máxima | Mínima | Rajada |', '|---|---|---|---|---|');
  for (const [nome, x] of [[`últimos ${pl.limites.dias} dias (${pl.ultimos.ini} a ${pl.ultimos.fim})`, pl.ultimos], [`todo o período (${pl.completo.ini} a ${pl.completo.fim}, ${pl.completo.dias} dias)`, pl.completo]]) {
    L.push(`| ${nome} | ${pct(x.chuva.pct)} | ${pct(x.tmax.pct)} | ${pct(x.tmin.pct)} | ${pct(x.rajada.pct)} |`);
  }
  L.push('', '## Rajada de curto prazo (Historical Forecast) e coerência entre antecedências', '', 'Fator medido ÷ previsto. "Varia entre antecedências" = maior ÷ menor fator anual de 1 a 5 dias na Previous Runs.', '');
  L.push('| Modelo | Fator curto prazo | Erro antes | Erro depois | Dias | Fator 1 a 5 dias | Varia entre antecedências | Em uso no painel |', '|---|---|---|---|---|---|---|---|');
  for (const [, x] of Object.entries(c.modelos)) {
    const k = x.rajadaCurtoPrazo;
    const fs = LEADS.map((l) => x.rajada[l]?.arquivoLead?.fatorAnual ?? (x.rajada[l]?.origem ? null : x.rajada[l]?.fatorAnual)).filter((v) => v != null);
    const emUso = LEADS.some((l) => x.rajada[l]?.usar) ? (x.rajada[1]?.origem === 'curto prazo' ? 'curto prazo' : 'por antecedência') : 'não';
    L.push(`| ${x.nome} | ${f(k?.fatorAnual, 2)} | ${f(k?.maeAntes)} | ${f(k?.maeDepois)} | ${k?.n ?? '–'} | ${fs.length ? fs.map((v) => f(v, 2)).join(' / ') : '–'} | ${x.rajadaCoerencia == null ? '–' : f(x.rajadaCoerencia, 2) + '×'} | ${emUso} |`);
  }
  L.push('', '## Viés de cada modelo por estação do ano (antecedência de 1 dia)', '', 'Temperatura: previsto − medido, em °C (positivo = o modelo esquenta demais). Rajada: fator medido ÷ previsto.', '');
  L.push('| Modelo | Medida | Verão | Outono | Inverno | Primavera | Usado |', '|---|---|---|---|---|---|---|');
  for (const [m, x] of Object.entries(c.modelos)) {
    for (const campo of ['tmax', 'tmin']) {
      const y = x[campo][1]; if (!y) continue;
      L.push(`| ${x.nome} | ${campo === 'tmax' ? 'máxima' : 'mínima'} | ${ESTACOES.map((e) => f(y.vies[e])).join(' | ')} | ${y.usar ? 'sim' : 'não'} |`);
    }
    for (const campo of ['rajada', 'vento']) {
      const y = x[campo][1]; if (!y) continue;
      L.push(`| ${x.nome} | ${campo} | ${ESTACOES.map((e) => f(y.fator[e], 2)).join(' | ')} | ${y.usar ? 'sim' : 'não'} |`);
    }
  }
  L.push('', '## Correção da chuva (mapeamento de quantis), fora da amostra', '',
    `Antecedências de 1 a 5 dias somadas. Usada quando o acerto sim/não sobe pelo menos ${PARAM_CHUVA.ganhoAcerto * 100} ponto e o erro em mm não piora mais que ${PARAM_CHUVA.perdaMaxErro * 100}%.`, '');
  L.push('| Modelo | Pares | Acerto sim/não | Alarme falso | Detecta | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) | Em uso |', '|---|---|---|---|---|---|---|---|---|');
  for (const [, x] of Object.entries(c.modelos)) {
    const q = x.chuvaQuantis; if (!q) continue;
    const a = q.validacao.total.antes, d = q.validacao.total.depois;
    L.push(`| ${x.nome} | ${q.n} | ${pct(a.acerto)} → ${pct(d.acerto)} | ${pct(a.far)} → ${pct(d.far)} | ${pct(a.pod)} → ${pct(d.pod)} | ${f(a.viesFrequencia, 2)} → ${f(d.viesFrequencia, 2)} | ${f(a.razaoVolume, 2)} → ${f(d.razaoVolume, 2)} | ${f(a.mae)} → ${f(d.mae)} | ${q.usar ? 'sim' : 'não'} |`);
  }
  L.push('', '## Chuva diária por modelo, sem correção (dia com chuva = 1 mm ou mais)', '', '| Modelo | Antecedência | Acerto sim/não | Detecta | Alarme falso | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) |', '|---|---|---|---|---|---|---|---|');
  for (const [, x] of Object.entries(c.modelos)) {
    for (const l of [1, 3, 5]) {
      const y = x.chuva[l]; if (!y) continue;
      L.push(`| ${x.nome} | ${l} | ${pct(y.acerto)} | ${pct(y.pod)} | ${pct(y.far)} | ${f(y.viesFrequencia, 2)} | ${f(y.razaoVolume, 2)} | ${f(y.mae)} |`);
    }
  }
  for (const [id, o] of Object.entries(c.outras || {})) {
    L.push('', `## ${o.estacao.nome} (${id}), sem correção: ${o.periodo.diasComMedicao} dias de ${o.periodo.ini} a ${o.periodo.fim}`, '', '| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |', '|---|---|---|---|---|---|---|');
    for (const [m, porLead] of Object.entries(o.modelos)) for (const l of [1, 3, 5]) {
      const y = porLead[l]; if (!y) continue;
      L.push(`| ${MODELOS_CALIBRACAO[m].nome} | ${l} | ${pct(y.acertoChuva)} | ${f(y.maeChuva)} | ${f(y.maeTmax)} | ${f(y.maeRajada)} | ${y.n} |`);
    }
  }
  L.push('', `## Pesos dos modelos do painel (${c.diasComuns} dias comuns)`, '', '| Modelo | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Peso relativo |', '|---|---|---|---|---|');
  for (const [m, p] of Object.entries(c.pesos)) {
    const e = c.maeComum[m];
    L.push(`| ${MODELOS_CALIBRACAO[m].nome} | ${f(e.chuva)} | ${f(e.tmax)} | ${f(e.rajada)} | ${f(p, 2)} |`);
  }
  L.push('');
  return L.join('\n');
}
