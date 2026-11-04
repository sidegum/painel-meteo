// Calibração hora a hora da temperatura dos modelos do painel (o ECMWF IFS é o que a primeira tela exibe).
// Funções puras, testadas em test/calibracao.test.mjs. Método em docs/CALIBRACAO.md, seção "Temperatura hora a hora".
//
// Por que hora a hora: o erro do modelo não é o mesmo ao longo do dia. Uma correção só da máxima e da mínima
// desloca a curva inteira; a correção por hora do dia acerta também o meio da tarde e o início da noite.
//
// Dados (dados/historico/A884-horario.json, gravado por scripts/historico.mjs), por dia local, 24 valores
// (hora local 0 a 23):
//   o   temperatura medida na hora (INMET A884, bulbo seco)
//   <modelo>.h0  Historical Forecast API: primeiras horas de cada rodada ("antecedência 0"), desde 2022
//   <modelo>.p1…p5  Previous Runs API, previsto 1 a 5 dias antes (ECMWF IFS só desde out/2025)
//
// Ajuste em duas etapas, as mesmas que o app aplica (prepararCorrecaoDia em js/analise.js):
// 1. viés por hora do dia e estação do ano. O da antecedência 0 (quatro anos) é a base; o de cada antecedência
//    1 a 5 parte dele e se afasta na medida dos dias medidos: (n · média + K · base) / (n + K).
// 2. ajuste residual da máxima e da mínima do dia (a medida da hora cheia não pega o pico entre duas horas).
// Validação: deixa um mês de fora (inclusive da base), ajusta com o resto e mede o mês deixado de fora,
// comparando a previsão bruta, o método diário (só máxima e mínima) e o método horário.

import { PARAM, ESTACOES, estacaoDoAno, ajustarVies, metricas } from './calibracao.mjs';
import { prepararCorrecaoDia } from '../../js/analise.js';

export const MODELOS_HORARIO = ['ecmwf_ifs', 'ecmwf_aifs025_single', 'ukmo_global_deterministic_10km'];
export const LEADS_HORARIO = [1, 2, 3, 4, 5];
export const PARAM_HORARIO = {
  minHorasDia: 20,     // dia só entra com 20 horas com previsão e medição
  encolhimento: 20,    // K em dias, como na calibração diária
  minDias: 60,         // mínimo de dias para estimar o viés horário
  tarde: [12, 18],     // horas locais do "meio da tarde" no relatório (12 h a 18 h, inclusive)
};
const HORAS = Array.from({ length: 24 }, (_, h) => h);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ coleta: respostas e medições → 24 valores

/**
 * Converte uma resposta horária da Open-Meteo (fuso local) em séries de 24 valores por dia local.
 * @param {object} j resposta JSON
 * @param {Record<string, string>} mapa chave de destino → variável da resposta (ex.: {p1: 'temperature_2m_previous_day1'})
 * @returns {Record<string, Record<string, (number|null)[]>>} data → chave → 24 valores
 */
export function seriesPorHora(j, mapa) {
  const h = j?.hourly;
  if (!h?.time) return {};
  const out = {};
  h.time.forEach((t, i) => {
    const d = String(t).slice(0, 10), hora = Number(String(t).slice(11, 13));
    for (const [chave, v] of Object.entries(mapa)) {
      const x = h[v]?.[i];
      if (!num(x)) continue;
      ((out[d] ||= {})[chave] ||= Array(24).fill(null))[hora] = r1(x);
    }
  });
  return out;
}

/**
 * Temperatura medida hora a hora (já com controle de qualidade) → 24 valores por dia local.
 * @param {{ms:number, temp:number|null}[]} horas instantes UTC
 * @param {number} [offsetH] fuso local fixo (−3 h em Campo Bom)
 * @returns {Record<string, (number|null)[]>}
 */
export function obsPorHora(horas, offsetH = -3) {
  const out = {};
  for (const h of horas) {
    if (!num(h.temp)) continue;
    const local = new Date(h.ms + offsetH * 3600000);
    const d = local.toISOString().slice(0, 10);
    (out[d] ||= Array(24).fill(null))[local.getUTCHours()] = h.temp;
  }
  return out;
}

// ------------------------------------------------------------------ amostras

/**
 * Dias com previsão (chave) e medição em pelo menos PARAM_HORARIO.minHorasDia horas comuns.
 * @param {object} horario tabela dados/historico/A884-horario.json
 * @param {string} modelo identificador Open-Meteo
 * @param {string} chave 'h0' ou 'p1'…'p5'
 * @param {object} [diario] tabela dados/historico/A884-diario.json, para a máxima e a mínima medidas do dia
 * @returns {{data:string, mes:string, estacao:string, prev:(number|null)[], obs:(number|null)[], tmax:number|null, tmin:number|null}[]}
 */
export function diasHorarios(horario, modelo, chave, diario = null) {
  const out = [];
  for (const [data, linha] of Object.entries(horario.dias || {})) {
    const p = linha[modelo]?.[chave], o = linha.o;
    if (!p || !o) continue;
    if (HORAS.filter((h) => num(p[h]) && num(o[h])).length < PARAM_HORARIO.minHorasDia) continue;
    const ob = diario?.dias?.[data]?.obs;
    out.push({
      data, mes: data.slice(0, 7), estacao: estacaoDoAno(Number(data.slice(5, 7))), prev: p, obs: o,
      tmax: num(ob?.tmax) ? ob.tmax : null, tmin: num(ob?.tmin) ? ob.tmin : null,
    });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : 1));
}

// ------------------------------------------------------------------ ajuste

/**
 * Viés (previsto − medido) por hora do dia, anual e por estação do ano, com encolhimento.
 * Sem base: cada estação encolhe para o viés anual da mesma hora. Com base (o ajuste da antecedência 0),
 * encolhe para a base da mesma estação e hora.
 * @param {object[]} dias diasHorarios
 * @param {{porEstacao: Record<string, number[]>}|null} [base]
 * @returns {{n:number, anual:number[], porEstacao:Record<string, number[]>, nEstacao:Record<string, number>}|null}
 */
export function ajustarHorario(dias, base = null) {
  if (dias.length < PARAM_HORARIO.minDias) return null;
  const K = PARAM_HORARIO.encolhimento, lim = PARAM.errMaxTemp;
  const err = (d, h) => (num(d.prev[h]) && num(d.obs[h]) ? Math.max(-lim, Math.min(lim, d.prev[h] - d.obs[h])) : null);
  const soma = (xs, h) => {
    let s = 0, n = 0;
    for (const d of xs) { const e = err(d, h); if (e !== null) { s += e; n++; } }
    return { s, n };
  };
  const anual = HORAS.map((h) => { const { s, n } = soma(dias, h); return n ? s / n : 0; });
  const porEstacao = {}, nEstacao = {};
  for (const est of ESTACOES) {
    const xs = dias.filter((d) => d.estacao === est);
    nEstacao[est] = xs.length;
    porEstacao[est] = HORAS.map((h) => {
      const { s, n } = soma(xs, h);
      const alvo = base?.porEstacao?.[est]?.[h] ?? anual[h];
      return (s + K * alvo) / (n + K);
    });
  }
  return { n: dias.length, anual, porEstacao, nEstacao };
}

/** Série do dia corrigida pelo viés horário e pelo ajuste de extremos (mesma função do app). */
export function corrigirDia(d, viesHora, extremos) {
  const f = prepararCorrecaoDia(d.prev, HORAS, viesHora, extremos);
  return HORAS.map((h) => f(d.prev[h], h));
}

const maxDe = (s) => { const xs = s.filter(num); return xs.length ? Math.max(...xs) : null; };
const minDe = (s) => { const xs = s.filter(num); return xs.length ? Math.min(...xs) : null; };

/**
 * Ajuste residual da máxima e da mínima depois do viés horário: viés diário (ajustarVies) entre o extremo da
 * série já corrigida e o extremo medido pelo INMET (máxima e mínima da hora anterior).
 * @returns {{tmax: object|null, tmin: object|null}}
 */
export function ajustarExtremos(dias, aj) {
  const pares = (campo, ext) => dias
    .filter((d) => num(d[campo]))
    .map((d) => ({ data: d.data, mes: d.mes, estacao: d.estacao, prev: ext(corrigirDia(d, aj?.porEstacao[d.estacao] ?? null, null)), obs: d[campo] }))
    .filter((p) => num(p.prev));
  return { tmax: ajustarVies(pares('tmax', maxDe)), tmin: ajustarVies(pares('tmin', minDe)) };
}

const extremosDe = (ext, est) => ({ tmax: ext.tmax?.porEstacao[est].vies ?? 0, tmin: ext.tmin?.porEstacao[est].vies ?? 0 });

// ------------------------------------------------------------------ validação

/**
 * Leave-one-month-out comparando três versões da previsão de cada dia de teste:
 * bruta, método diário (correção só de máxima e mínima, a que o app usava) e método horário.
 * @param {object[]} dias diasHorarios da antecedência avaliada
 * @param {object[]} dias0 diasHorarios da antecedência 0 (base); pode ser vazio
 * @param {(treino: (mes: string) => boolean) => ((estacao: string) => {tmax:number, tmin:number})|null} metodoDiario
 *   recebe o filtro dos meses de treino e devolve a correção diária por estação do ano ajustada só com eles
 * @returns {{dias:number, meses:number, horaria:object, tarde:object, tmax:object, tmin:object, usar:boolean}|null}
 */
export function validarHorario(dias, dias0, metodoDiario) {
  if (dias.length < PARAM_HORARIO.minDias) return null;
  const [t0, t1] = PARAM_HORARIO.tarde;
  const acum = () => ({ bruta: [], diaria: [], horaria: [] });
  const H = acum(), T = acum(), MX = acum(), MN = acum();
  const meses = [...new Set(dias.map((d) => d.mes))];
  for (const mes of meses) {
    const treino = dias.filter((d) => d.mes !== mes);
    const base = ajustarHorario(dias0.filter((d) => d.mes !== mes));
    const aj = ajustarHorario(treino, base);
    if (!aj) continue;
    const ext = ajustarExtremos(treino, aj);
    const diario = metodoDiario((m) => m !== mes);
    for (const d of dias.filter((x) => x.mes === mes)) {
      const versoes = {
        bruta: d.prev,
        diaria: corrigirDia(d, null, diario ? diario(d.estacao) : null),
        horaria: corrigirDia(d, aj.porEstacao[d.estacao], extremosDe(ext, d.estacao)),
      };
      for (const [nome, s] of Object.entries(versoes)) {
        for (const h of HORAS) {
          if (!num(s[h]) || !num(d.obs[h])) continue;
          const par = { prev: s[h], obs: d.obs[h] };
          H[nome].push(par);
          if (h >= t0 && h <= t1) T[nome].push(par);
        }
        const mx = maxDe(s), mn = minDe(s);
        if (num(mx) && num(d.tmax)) MX[nome].push({ prev: mx, obs: d.tmax });
        if (num(mn) && num(d.tmin)) MN[nome].push({ prev: mn, obs: d.tmin });
      }
    }
  }
  const resumo = (a) => Object.fromEntries(Object.entries(a).map(([k, ps]) => {
    const m = metricas(ps);
    return [k, { n: m.n, mae: m.mae, vies: m.vies }];
  }));
  const r = { dias: dias.length, meses: meses.length, horaria: resumo(H), tarde: resumo(T), tmax: resumo(MX), tmin: resumo(MN) };
  // Horário só entra se, fora da amostra, reduzir o erro hora a hora em relação ao método diário (ganho mínimo
  // igual ao da calibração diária) sem piorar a máxima e a mínima do dia.
  const g = (x) => x.horaria.mae <= (1 - PARAM.ganhoMinimo) * x.diaria.mae;
  const naoPiora = (x) => !x.diaria.n || x.horaria.mae <= x.diaria.mae + 0.05;
  r.usar = num(r.horaria.horaria.mae) && g(r.horaria) && naoPiora(r.tmax) && naoPiora(r.tmin);
  return r;
}

/**
 * Ajuste final (todos os meses) de uma antecedência, no formato de dados/calibracao.json.
 * @returns {{dias:number, vies:Record<string, number[]>, pico:{tmax:Record<string, number>, tmin:Record<string, number>}}|null}
 */
export function ajusteFinal(dias, dias0) {
  const aj = ajustarHorario(dias, ajustarHorario(dias0));
  if (!aj) return null;
  const ext = ajustarExtremos(dias, aj);
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    dias: aj.n, nEstacao: aj.nEstacao,
    vies: Object.fromEntries(ESTACOES.map((e) => [e, aj.porEstacao[e].map(r2)])),
    pico: Object.fromEntries(['tmax', 'tmin'].map((c) => [c, Object.fromEntries(ESTACOES.map((e) => [e, r2(ext[c]?.porEstacao[e].vies ?? 0)]))])),
  };
}
