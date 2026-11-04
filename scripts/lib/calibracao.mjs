// Estatística da calibração: compara o que cada modelo previu (1 a 5 dias antes) com o que a estação mediu
// e produz as correções que o app aplica. Funções puras, testadas em test/calibracao.test.mjs.
//
// Método (detalhes em docs/CALIBRACAO.md):
// - Temperatura máxima e mínima: viés aditivo por modelo, antecedência e estação do ano, com encolhimento
//   ("shrinkage") em direção ao viés anual do mesmo modelo e antecedência.
// - Rajada e vento: fator multiplicativo (medido / previsto) por modelo, antecedência e estação do ano, com o
//   mesmo encolhimento. Multiplicativo para que vento previsto zero continue zero.
// - Chuva: métricas de acerto (sem correção de volume; motivo no documento).
// - Pesos dos modelos: erro relativo de chuva, máxima e rajada, na mesma fórmula do aprendizado do app.
// - Validação honesta: deixa um mês de fora, ajusta com o resto, mede o erro no mês deixado de fora e repete
//   para todos os meses ("leave-one-month-out"). Uma correção só é marcada para uso se reduzir o erro fora
//   da amostra.

// Modelos consultados. "app": usados pelo painel. Os demais servem só de referência no relatório.
export const MODELOS_CALIBRACAO = {
  ecmwf_ifs: { nome: 'ECMWF IFS', app: true },
  ecmwf_aifs025_single: { nome: 'ECMWF AIFS', app: true },
  ukmo_global_deterministic_10km: { nome: 'UKMO 10 km', app: true },
  ecmwf_ifs025: { nome: 'ECMWF IFS 0,25°', app: false },
  ncep_gfs_seamless: { nome: 'GFS', app: false },
  dwd_icon_global: { nome: 'ICON', app: false },
};
export const LEADS = [1, 2, 3, 4, 5];
// Modelos do painel cuja rajada também é buscada na Historical Forecast API (antecedência "0", primeiras horas
// de cada rodada). Usada só quando a Previous Runs não tem rajada do modelo ou a tem inconsistente.
export const MODELOS_RAJADA_CURTO_PRAZO = ['ecmwf_ifs', 'ecmwf_ifs025', 'ukmo_global_deterministic_10km', 'ncep_gfs_seamless', 'dwd_icon_global'];
export const VARS_PREVISAO = ['precipitation', 'temperature_2m', 'wind_gusts_10m', 'wind_speed_10m'];
// Ordem dos valores diários guardados por modelo e antecedência na tabela de histórico.
export const CAMPOS = ['chuva', 'tmax', 'tmin', 'rajada', 'vento'];

export const PARAM = {
  encolhimento: 20,        // K: a estação do ano vale metade quando tem 20 dias; o resto vem do valor anual
  minPares: 30,            // mínimo de pares modelo x medição para estimar algo
  errMaxTemp: 10,          // erros de temperatura além de ±10 °C são limitados (dado suspeito não domina a média)
  fatorVento: [0.5, 1.6],  // limites do fator de rajada e vento
  chuvaDia: 1,             // dia com chuva: ≥ 1 mm (igual a REGRAS.chuvaMinimaMm do app)
  ganhoMinimo: 0.02,       // correção só é usada se reduzir o erro fora da amostra em pelo menos 2%
  consistenciaFator: 1.3,  // fator anual que varia mais que 30% entre antecedências indica arquivo inconsistente
};

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v, c = 2) => (num(v) ? Math.round(v * 10 ** c) / 10 ** c : null);

// ------------------------------------------------------------------ previsões: hora a hora → dia

/**
 * Converte uma resposta da Previous Runs API (um modelo, fuso local) em valores diários por antecedência.
 * O dia só entra com horas suficientes: 24 para a soma de chuva, 20 para máximos e mínimos.
 * @param {object} j resposta JSON (chaves "<var>_previous_dayN", sem sufixo de modelo)
 * @returns {Record<string, Record<number, (number|null)[]>>} data → antecedência → valores na ordem de CAMPOS
 */
export function prevDiaria(j) {
  const h = j?.hourly;
  if (!h?.time) return {};
  const porDia = new Map();
  h.time.forEach((t, i) => {
    const d = String(t).slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(i);
  });
  const out = {};
  for (const [d, idx] of porDia) {
    const dia = {};
    for (const L of LEADS) {
      const s = (v) => idx.map((i) => h[`${v}_previous_day${L}`]?.[i]).filter(num);
      const p = s('precipitation'), t = s('temperature_2m'), g = s('wind_gusts_10m'), w = s('wind_speed_10m');
      const vals = [
        p.length >= 24 ? r2(p.reduce((a, b) => a + b, 0), 1) : null,
        t.length >= 20 ? r2(Math.max(...t), 1) : null,
        t.length >= 20 ? r2(Math.min(...t), 1) : null,
        g.length >= 20 ? r2(Math.max(...g), 1) : null,
        w.length >= 20 ? r2(Math.max(...w), 1) : null,
      ];
      if (vals.some(num)) dia[L] = vals;
    }
    if (Object.keys(dia).length) out[d] = dia;
  }
  return out;
}

/**
 * Converte uma resposta da Historical Forecast API (um modelo, fuso local, só wind_gusts_10m) na rajada máxima
 * diária, guardada como antecedência 0 no mesmo formato de CAMPOS.
 * @returns {Record<string, {0: (number|null)[]}>}
 */
export function rajadaCurtoPrazo(j) {
  const h = j?.hourly;
  if (!h?.time || !Array.isArray(h.wind_gusts_10m)) return {};
  const porDia = new Map();
  h.time.forEach((t, i) => {
    const v = h.wind_gusts_10m[i];
    if (!num(v)) return;
    const d = String(t).slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(v);
  });
  const out = {};
  for (const [d, vs] of porDia) if (vs.length >= 20) out[d] = { 0: [null, null, null, r2(Math.max(...vs), 1), null] };
  return out;
}

/**
 * Verifica se o fator anual de um modelo é coerente entre as antecedências. No arquivo do UKMO, por exemplo,
 * a rajada das antecedências ímpares é cerca de 50% maior que a das pares (artefato do arquivo, não do tempo):
 * um fator por antecedência copiaria o artefato para a previsão ao vivo.
 * @param {Record<number, {fatorAnual: number}>} porLead
 * @returns {{coerente: boolean, razao: number|null}}
 */
export function coerenciaFator(porLead) {
  const fs = Object.values(porLead).map((x) => x?.fatorAnual).filter(num);
  if (fs.length < 2) return { coerente: true, razao: null };
  const razao = Math.max(...fs) / Math.min(...fs);
  return { coerente: razao <= PARAM.consistenciaFator, razao };
}

// ------------------------------------------------------------------ pares e estações do ano

/** Estação do ano no hemisfério sul a partir do mês (1–12). */
export function estacaoDoAno(mes) {
  if (mes === 12 || mes <= 2) return 'verao';
  if (mes <= 5) return 'outono';
  if (mes <= 8) return 'inverno';
  return 'primavera';
}
export const ESTACOES = ['verao', 'outono', 'inverno', 'primavera'];

/**
 * Monta pares previsão x medição de uma variável, para um modelo e uma antecedência.
 * @param {object} tabela dados/historico/A884-diario.json
 * @returns {{data: string, mes: string, estacao: string, prev: number, obs: number}[]}
 */
export function pares(tabela, modelo, lead, campo) {
  const k = CAMPOS.indexOf(campo);
  const out = [];
  for (const [data, linha] of Object.entries(tabela.dias)) {
    const o = linha.obs?.[campo], p = linha.prev?.[modelo]?.[lead]?.[k];
    if (!num(o) || !num(p)) continue;
    out.push({ data, mes: data.slice(0, 7), estacao: estacaoDoAno(Number(data.slice(5, 7))), prev: p, obs: o });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : 1));
}

// ------------------------------------------------------------------ ajustes

/**
 * Viés aditivo (previsto − medido) anual e por estação do ano, com encolhimento.
 * vies_estação = (n_e · média_e + K · média_anual) / (n_e + K)
 * @returns {{anual: number, n: number, porEstacao: Record<string, {vies: number, n: number}>} | null}
 */
export function ajustarVies(ps) {
  if (ps.length < PARAM.minPares) return null;
  const e = (p) => Math.max(-PARAM.errMaxTemp, Math.min(PARAM.errMaxTemp, p.prev - p.obs));
  const anual = ps.reduce((s, p) => s + e(p), 0) / ps.length;
  const porEstacao = {};
  for (const est of ESTACOES) {
    const xs = ps.filter((p) => p.estacao === est);
    const soma = xs.reduce((s, p) => s + e(p), 0);
    porEstacao[est] = { vies: (soma + PARAM.encolhimento * anual) / (xs.length + PARAM.encolhimento), n: xs.length };
  }
  return { anual, n: ps.length, porEstacao };
}

/** Aplica o viés: previsão corrigida = previsão − viés da estação do ano. */
export const corrigirVies = (aj, p) => p.prev - (aj ? aj.porEstacao[p.estacao].vies : 0);

/**
 * Fator multiplicativo (soma medida / soma prevista) anual e por estação do ano, com encolhimento.
 * Pares com previsão e medição ambas abaixo de 1 km/h (calmaria) não informam a escala e ficam de fora.
 */
export function ajustarFator(ps) {
  const xs = ps.filter((p) => p.prev >= 1 || p.obs >= 1);
  if (xs.length < PARAM.minPares) return null;
  const [lo, hi] = PARAM.fatorVento;
  const lim = (f) => Math.max(lo, Math.min(hi, f));
  const razao = (arr) => arr.reduce((s, p) => s + p.obs, 0) / Math.max(1e-9, arr.reduce((s, p) => s + p.prev, 0));
  const anual = lim(razao(xs));
  const porEstacao = {};
  for (const est of ESTACOES) {
    const ys = xs.filter((p) => p.estacao === est);
    const f = ys.length ? razao(ys) : anual;
    porEstacao[est] = { fator: lim((ys.length * f + PARAM.encolhimento * anual) / (ys.length + PARAM.encolhimento)), n: ys.length };
  }
  return { anual, n: xs.length, porEstacao };
}

export const corrigirFator = (aj, p) => p.prev * (aj ? aj.porEstacao[p.estacao].fator : 1);

// ------------------------------------------------------------------ métricas

/** Erro absoluto médio, viés médio e raiz do erro quadrático médio. */
export function metricas(ps, f = (p) => p.prev) {
  if (!ps.length) return { n: 0, mae: null, vies: null, rmse: null };
  let a = 0, b = 0, q = 0;
  for (const p of ps) { const e = f(p) - p.obs; a += Math.abs(e); b += e; q += e * e; }
  return { n: ps.length, mae: a / ps.length, vies: b / ps.length, rmse: Math.sqrt(q / ps.length) };
}

/**
 * Tabela de contingência de "dia com chuva" (≥ 1 mm).
 * acerto: fração de dias certos; pod: chuvas previstas entre as que ocorreram; far: alarmes falsos entre as
 * previstas; vies: dias previstos com chuva / dias que choveu (1 = frequência certa).
 */
export function contingenciaChuva(ps, lim = PARAM.chuvaDia) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const p of ps) {
    const fp = p.prev >= lim, fo = p.obs >= lim;
    if (fp && fo) a++; else if (fp) b++; else if (fo) c++; else d++;
  }
  const n = a + b + c + d;
  return {
    n, acerto: n ? (a + d) / n : null, pod: a + c ? a / (a + c) : null, far: a + b ? b / (a + b) : null,
    vies: a + c ? (a + b) / (a + c) : null, csi: a + b + c ? a / (a + b + c) : null,
  };
}

// ------------------------------------------------------------------ validação fora da amostra

/**
 * Leave-one-month-out: para cada mês, ajusta com os outros meses e corrige o mês deixado de fora.
 * Devolve as previsões corrigidas fora da amostra, na mesma ordem dos pares.
 * @param {object[]} ps pares
 * @param {(treino: object[]) => any} ajustar função de ajuste (ajustarVies ou ajustarFator)
 * @param {(aj: any, p: object) => number} corrigir função de correção correspondente
 */
export function foraDaAmostra(ps, ajustar, corrigir) {
  const meses = [...new Set(ps.map((p) => p.mes))];
  const corrigidos = new Map();
  for (const m of meses) {
    const aj = ajustar(ps.filter((p) => p.mes !== m));
    for (const p of ps) if (p.mes === m) corrigidos.set(p, aj ? corrigir(aj, p) : p.prev);
  }
  return ps.map((p) => corrigidos.get(p));
}

/** Compara erro bruto e corrigido fora da amostra e decide se a correção vale a pena. */
export function validar(ps, ajustar, corrigir) {
  const cor = foraDaAmostra(ps, ajustar, corrigir);
  const antes = metricas(ps);
  const depois = metricas(ps.map((p, i) => ({ ...p, prev: cor[i] })));
  const ganho = antes.mae ? 1 - depois.mae / antes.mae : null;
  return { antes, depois, ganho, usar: num(ganho) && ganho >= PARAM.ganhoMinimo };
}

// ------------------------------------------------------------------ pesos

/**
 * Pesos relativos dos modelos do app a partir do erro histórico (média das antecedências 1 a 5):
 * peso = média dos erros dos modelos / erro do modelo, por medida (chuva, máxima, rajada), e depois a média
 * das medidas disponíveis. Mesma ideia de pesosModelos em js/analise.js, que aplica limites e mistura com
 * o aprendizado recente.
 * @param {Record<string, {chuva?: number, tmax?: number, rajada?: number}>} mae erro absoluto médio por modelo
 */
export function pesosRelativos(mae) {
  const modelos = Object.keys(mae);
  const out = Object.fromEntries(modelos.map((m) => [m, []]));
  for (const [campo, piso] of [['chuva', 0.5], ['tmax', 0.3], ['rajada', 1]]) {
    const xs = modelos.filter((m) => num(mae[m][campo]));
    if (xs.length < 2) continue;
    const media = xs.reduce((s, m) => s + Math.max(mae[m][campo], piso), 0) / xs.length;
    for (const m of xs) out[m].push(media / Math.max(mae[m][campo], piso));
  }
  return Object.fromEntries(modelos.map((m) => [m, out[m].length ? out[m].reduce((s, x) => s + x, 0) / out[m].length : 1]));
}

export { r2 as arredondar };
