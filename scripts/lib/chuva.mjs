// Calibração do volume diário de chuva de cada modelo por mapeamento de quantis ("quantile mapping").
// Funções puras, testadas em test/calibracao.test.mjs. Método em docs/CALIBRACAO.md, seção "Chuva".
//
// Por quê: no histórico de Campo Bom, os modelos preveem dia com chuva (1 mm ou mais) 1,4 a 2 vezes mais do que
// chove de fato (garoa prevista que não acontece) e exageram o volume em 15 a 35%. O mapeamento leva a
// distribuição do volume previsto para a do medido na mesma época do ano: o 60º percentil previsto vira o
// 60º percentil medido, e assim por diante. Assim a frequência de dias com chuva e o volume passam a bater com
// o clima do lugar, sem mudar a ordem (dia mais chuvoso continua mais chuvoso).
//
// O app aplica a mesma tabela (mapearChuva em js/analise.js) ao total do dia de cada modelo e escala as horas
// do dia na mesma proporção; os cenários usam a tabela do modelo determinístico de mesma origem.

import { PARAM, ESTACOES, pares, contingenciaChuva, metricas, LEADS } from './calibracao.mjs';
import { mapearChuva } from '../../js/analise.js';

export const PARAM_CHUVA = {
  niveis: 51,            // quantis de 0 a 100%, de 2 em 2 pontos
  encolhimento: 100,     // pares (antecedências somadas): a estação do ano vale metade com 100 pares
  minPares: 150,         // mínimo de pares para estimar a tabela
  ganhoAcerto: 0.01,     // usa só se o acerto sim/não fora da amostra subir pelo menos 1 ponto
  perdaMaxErro: 0.02,    // e o erro médio em mm não piorar mais que 2%
};

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

/** Quantis (interpolação linear) de uma lista, nos níveis 0, 1/(k−1), …, 1. */
export function quantis(xs, k = PARAM_CHUVA.niveis) {
  const s = xs.filter(num).sort((a, b) => a - b);
  if (!s.length) return null;
  return Array.from({ length: k }, (_, i) => {
    const pos = (i / (k - 1)) * (s.length - 1), a = Math.floor(pos), b = Math.min(s.length - 1, a + 1);
    return s[a] + (pos - a) * (s[b] - s[a]);
  });
}

/** Pares de chuva de um modelo com as antecedências 1 a 5 somadas (a distribuição pouco muda com a antecedência). */
export function paresChuva(tabela, modelo) {
  return LEADS.flatMap((L) => pares(tabela, modelo, L, 'chuva').map((p) => ({ ...p, lead: L })));
}

/**
 * Tabela de mapeamento anual e por estação do ano. A da estação encolhe para a anual:
 * q_estação = (n · q + K · q_anual) / (n + K), nível a nível.
 * @returns {{n:number, anual:{p:number[], o:number[]}, porEstacao:Record<string, {p:number[], o:number[], n:number}>}|null}
 */
export function ajustarChuva(ps) {
  if (ps.length < PARAM_CHUVA.minPares) return null;
  const K = PARAM_CHUVA.encolhimento;
  const anual = { p: quantis(ps.map((x) => x.prev)), o: quantis(ps.map((x) => x.obs)) };
  const porEstacao = {};
  for (const e of ESTACOES) {
    const xs = ps.filter((x) => x.estacao === e), n = xs.length;
    const qp = n ? quantis(xs.map((x) => x.prev)) : anual.p, qo = n ? quantis(xs.map((x) => x.obs)) : anual.o;
    const mistura = (q, a) => q.map((v, i) => (n * v + K * a[i]) / (n + K));
    porEstacao[e] = { p: mistura(qp, anual.p), o: mistura(qo, anual.o), n };
  }
  return { n: ps.length, anual, porEstacao };
}

export const corrigirChuva = (aj, p) => (aj ? mapearChuva(p.prev, aj.porEstacao[p.estacao]) : p.prev);

/**
 * Validação fora da amostra (deixa um mês de fora, ajusta com o resto) por antecedência e no total.
 * usar = acerto sim/não sobe pelo menos ganhoAcerto e o erro em mm não piora mais que perdaMaxErro.
 */
export function validarChuva(ps) {
  if (ps.length < PARAM_CHUVA.minPares) return null;
  const cor = new Map();
  for (const mes of new Set(ps.map((p) => p.mes))) {
    const aj = ajustarChuva(ps.filter((p) => p.mes !== mes));
    for (const p of ps) if (p.mes === mes) cor.set(p, corrigirChuva(aj, p));
  }
  const resumo = (xs) => {
    const depois = xs.map((p) => ({ ...p, prev: cor.get(p) }));
    const ca = contingenciaChuva(xs), cd = contingenciaChuva(depois), ma = metricas(xs), md = metricas(depois);
    const soma = (ys) => ys.reduce((s, p) => s + p.prev, 0) / Math.max(1e-9, ys.reduce((s, p) => s + p.obs, 0));
    return {
      n: xs.length,
      antes: { acerto: ca.acerto, pod: ca.pod, far: ca.far, viesFrequencia: ca.vies, mae: ma.mae, razaoVolume: soma(xs) },
      depois: { acerto: cd.acerto, pod: cd.pod, far: cd.far, viesFrequencia: cd.vies, mae: md.mae, razaoVolume: soma(depois) },
    };
  };
  const total = resumo(ps);
  const porLead = Object.fromEntries(LEADS.map((L) => [L, ps.some((p) => p.lead === L) ? resumo(ps.filter((p) => p.lead === L)) : null]));
  const usar = total.depois.acerto - total.antes.acerto >= PARAM_CHUVA.ganhoAcerto &&
    total.depois.mae <= total.antes.mae * (1 + PARAM_CHUVA.perdaMaxErro);
  return { usar, total, porLead };
}

/** Tabela final no formato de dados/calibracao.json (valores com 2 casas). */
export function tabelaFinal(aj) {
  return Object.fromEntries(ESTACOES.map((e) => [e, { p: aj.porEstacao[e].p.map(r2), o: aj.porEstacao[e].o.map(r2), n: aj.porEstacao[e].n }]));
}

export { PARAM };
