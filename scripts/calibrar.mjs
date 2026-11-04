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
  validar, metricas, contingenciaChuva, pesosRelativos, foraDaAmostra, arredondar as r,
} from './lib/calibracao.mjs';

const ARQ_HIST = new URL('../dados/historico/A884-diario.json', import.meta.url);
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

function resumoRajada() {
  const out = {};
  const comRajada = modelosApp.filter((m) => Object.keys(modelos[m].rajada).length);
  for (const L of LEADS) {
    // correção fora da amostra de cada modelo, depois a mediana entre eles, dia a dia
    const porData = new Map();
    for (const m of comRajada) {
      const ps = pares(tabela, m, L, 'rajada');
      const usar = modelos[m].rajada[L]?.usar;
      const cor = usar ? foraDaAmostra(ps, ajustarFator, corrigirFator) : ps.map((p) => p.prev);
      ps.forEach((p, i) => {
        if (!porData.has(p.data)) porData.set(p.data, { obs: p.obs, bruto: [], corr: [] });
        porData.get(p.data).bruto.push(p.prev); porData.get(p.data).corr.push(cor[i]);
      });
    }
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
    const dias = [...porData.values()].filter((d) => d.bruto.length === comRajada.length);
    if (dias.length < PARAM.minPares) continue;
    const antes = metricas(dias.map((d) => ({ prev: med(d.bruto), obs: d.obs })));
    const depois = metricas(dias.map((d) => ({ prev: med(d.corr), obs: d.obs })));
    out[L] = { n: dias.length, maeAntes: r(antes.mae), maeDepois: r(depois.mae), viesAntes: r(antes.vies), viesDepois: r(depois.vies) };
  }
  return out;
}

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
  modelos,
};

await writeFile(ARQ_CALIB, JSON.stringify(calib, null, 1) + '\n');
await writeFile(ARQ_RELAT, relatorio(calib));
console.log(`Calibração gravada: ${datasObs.length} dias com medição, ${comuns.length} dias comuns aos modelos do app.`);

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
  L.push('', '## Rajada exibida (mediana dos modelos): erro médio em km/h', '', '| Antecedência | Antes | Depois | Viés antes | Viés depois | Dias |', '|---|---|---|---|---|---|');
  for (const l of LEADS) {
    const a = c.resumo.rajadaMediana[l];
    L.push(`| ${l} dia(s) | ${f(a?.maeAntes)} | ${f(a?.maeDepois)} | ${f(a?.viesAntes)} | ${f(a?.viesDepois)} | ${a?.n ?? '–'} |`);
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
  L.push('', '## Chuva diária por modelo (dia com chuva = 1 mm ou mais)', '', '| Modelo | Antecedência | Acerto sim/não | Detecta | Alarme falso | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) |', '|---|---|---|---|---|---|---|---|');
  for (const [, x] of Object.entries(c.modelos)) {
    for (const l of [1, 3, 5]) {
      const y = x.chuva[l]; if (!y) continue;
      L.push(`| ${x.nome} | ${l} | ${pct(y.acerto)} | ${pct(y.pod)} | ${pct(y.far)} | ${f(y.viesFrequencia, 2)} | ${f(y.razaoVolume, 2)} | ${f(y.mae)} |`);
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
