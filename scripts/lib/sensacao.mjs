// Ponto de orvalho e sensação térmica: calibração do orvalho hora a hora e conferência da sensação prevista
// contra a medida. Funções puras, testadas em test/calibracao.test.mjs. Método em docs/CALIBRACAO.md, seção 4.7.
//
// A sensação térmica não é uma medida de instrumento: é uma conta (sensacaoTermica, js/analise.js) com
// temperatura, umidade (pela pressão de vapor do ponto de orvalho) e vento. Prever a sensação com rigor é, então,
// prever bem essas três coisas e usar a mesma conta na previsão e na medição. Aqui:
// 1. o viés do ponto de orvalho por hora do dia e estação do ano (véspera), com validação fora da amostra;
// 2. a sensação prevista na véspera (bruta e com todas as correções do painel) contra a sensação calculada com
//    as medições do INMET A884 na mesma hora, pela mesma fórmula.

import { PARAM, metricas, estacaoDoAno } from './calibracao.mjs';
import { ajustarHorario, diasHorarios, PARAM_HORARIO } from './temperatura-horaria.mjs';
import { sensacaoTermica, pressaoVapor } from '../../js/analise.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const HORAS = Array.from({ length: 24 }, (_, h) => h);
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Viés horário do ponto de orvalho de um modelo na véspera (d1 × od), validado deixando um mês de fora.
 * @returns {{usar:boolean, dias:number, vies:Record<string, number[]>, validacao:{antes:object, depois:object}, porDia:Map<string, number[]>}|null}
 */
export function calibrarOrvalho(horario, modelo) {
  const dias = diasHorarios(horario, modelo, 'd1', null, 'od');
  if (dias.length < PARAM_HORARIO.minDias) return null;
  const antes = [], depois = [], porDia = new Map();
  for (const mes of new Set(dias.map((d) => d.mes))) {
    const aj = ajustarHorario(dias.filter((d) => d.mes !== mes));
    for (const d of dias.filter((x) => x.mes === mes)) {
      const s = d.prev.map((v, h) => (num(v) && aj ? v - aj.porEstacao[d.estacao][h] : v));
      porDia.set(d.data, s);
      for (const h of HORAS) if (num(d.prev[h]) && num(d.obs[h])) { antes.push({ prev: d.prev[h], obs: d.obs[h] }); depois.push({ prev: s[h], obs: d.obs[h] }); }
    }
  }
  const a = metricas(antes), b = metricas(depois);
  const fim = ajustarHorario(dias);
  return {
    usar: num(a.mae) && b.mae <= (1 - PARAM.ganhoMinimo) * a.mae, dias: dias.length,
    vies: Object.fromEntries(Object.entries(fim.porEstacao).map(([e, v]) => [e, v.map(r2)])),
    validacao: { antes: { n: a.n, mae: r2(a.mae), vies: r2(a.vies) }, depois: { n: b.n, mae: r2(b.mae), vies: r2(b.vies) } },
    porDia,
  };
}

/** Sensação de uma hora a partir de temperatura, orvalho (nunca acima da temperatura) e vento. */
const sensacaoHora = (t, td, v) => (num(t) && num(td) && num(v) ? sensacaoTermica(t, pressaoVapor(Math.min(td, t)), v) : null);

/**
 * Sensação prevista na véspera contra a calculada com as medições, hora a hora.
 * "Bruta": temperatura, orvalho e vento como o modelo previu. "Corrigida": como o painel mostra, com a
 * temperatura corrigida fora da amostra (porDia de validarHorario), o orvalho corrigido fora da amostra
 * (calibrarOrvalho, quando aprovado) e o vento multiplicado pelo fator da estação do ano (fatorVento).
 * @param {object} horario tabela horária
 * @param {string} modelo
 * @param {{temperatura?: Map<string, {horaria?:number[], diaria?:number[]}>, usarHoraria?: boolean,
 *   orvalho?: Map<string, number[]>|null, fatorVento?: (estacao:string) => number}} cor
 * @returns {{dias:number, hora:{bruta:object, corrigida:object}, tarde:object, max:object, min:object}|null}
 */
export function conferirSensacao(horario, modelo, cor) {
  const [t0, t1] = PARAM_HORARIO.tarde;
  const H = { bruta: [], corrigida: [] }, T = { bruta: [], corrigida: [] }, MX = { bruta: [], corrigida: [] }, MN = { bruta: [], corrigida: [] };
  let dias = 0;
  for (const [data, l] of Object.entries(horario.dias || {})) {
    const p = l[modelo];
    if (!p?.p1 || !p.d1 || !p.w1 || !l.o || !l.od || !l.ow) continue;
    const obs = HORAS.map((h) => sensacaoHora(l.o[h], l.od[h], l.ow[h]));
    if (obs.filter(num).length < PARAM_HORARIO.minHorasDia) continue;
    const est = estacaoDoAno(Number(data.slice(5, 7)));
    const tc = cor.temperatura?.get(data)?.[cor.usarHoraria ? 'horaria' : 'diaria'] ?? p.p1;
    const tdc = cor.orvalho?.get(data) ?? p.d1;
    const f = cor.fatorVento ? cor.fatorVento(est) : 1;
    const versoes = {
      bruta: HORAS.map((h) => sensacaoHora(p.p1[h], p.d1[h], p.w1[h])),
      corrigida: HORAS.map((h) => sensacaoHora(tc[h], tdc[h], num(p.w1[h]) ? p.w1[h] * f : null)),
    };
    // compara só horas com as duas versões e a medida, para os erros serem do mesmo conjunto
    const hs = HORAS.filter((h) => num(obs[h]) && num(versoes.bruta[h]) && num(versoes.corrigida[h]));
    if (hs.length < PARAM_HORARIO.minHorasDia) continue;
    dias++;
    for (const [nome, s] of Object.entries(versoes)) {
      for (const h of hs) {
        H[nome].push({ prev: s[h], obs: obs[h] });
        if (h >= t0 && h <= t1) T[nome].push({ prev: s[h], obs: obs[h] });
      }
      MX[nome].push({ prev: Math.max(...hs.map((h) => s[h])), obs: Math.max(...hs.map((h) => obs[h])) });
      MN[nome].push({ prev: Math.min(...hs.map((h) => s[h])), obs: Math.min(...hs.map((h) => obs[h])) });
    }
  }
  if (dias < PARAM_HORARIO.minDias) return null;
  const res = (a) => Object.fromEntries(Object.entries(a).map(([k, ps]) => { const m = metricas(ps); return [k, { n: m.n, mae: r2(m.mae), vies: r2(m.vies) }]; }));
  return { dias, hora: res(H), tarde: res(T), max: res(MX), min: res(MN) };
}
