// Leitura dos dados históricos do INMET (BDMEP, arquivos anuais por estação automática).
//
// Fonte: https://portal.inmet.gov.br/dadoshistoricos  →  https://portal.inmet.gov.br/uploads/dadoshistoricos/{ANO}.zip
// Cada ZIP anual traz um CSV por estação, com nome no formato
//   INMET_S_RS_A884_CAMPO BOM_01-01-2024_A_31-12-2024.CSV
// O CSV vem em ISO-8859-1, separado por ";", decimal com vírgula, 8 linhas de cabeçalho (REGIAO, UF, ESTACAO,
// CODIGO (WMO), LATITUDE, LONGITUDE, ALTITUDE, DATA DE FUNDACAO) e uma linha de colunas. Dado ausente: vazio ou -9999.
// As horas estão em UTC ("0000 UTC" desde 2019; "00:00" nos anos anteriores).
//
// Funções puras, sem rede: o download fica em scripts/historico.mjs. Testes em test/calibracao.test.mjs.

import { inflateRawSync } from 'node:zlib';

// ------------------------------------------------------------------ ZIP

/**
 * Lê as entradas de um arquivo ZIP (formato PKWARE clássico, sem ZIP64) a partir do diretório central.
 * Não descompacta nada: devolve o índice para `extrairZip`.
 * @param {Buffer} buf conteúdo completo do .zip
 * @returns {{nome: string, metodo: number, tamComp: number, tamOrig: number, offsetLocal: number}[]}
 */
export function listarZip(buf) {
  // O registro "End of Central Directory" (assinatura 0x06054b50) fica nos últimos 22 + 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: diretório central não encontrado');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido: entrada do diretório central corrompida');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamOrig = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    // Nomes do INMET usam ASCII/Latin-1; latin1 nunca falha na decodificação.
    const nome = buf.toString('latin1', p + 46, p + 46 + nLen);
    entradas.push({ nome, metodo, tamComp, tamOrig, offsetLocal });
    p += 46 + nLen + xLen + cLen;
  }
  return entradas;
}

/**
 * Extrai uma entrada do ZIP. Suporta "stored" (0) e "deflate" (8), que são os métodos usados pelo INMET.
 * @param {Buffer} buf
 * @param {{metodo: number, tamComp: number, offsetLocal: number, nome: string}} e entrada de `listarZip`
 * @returns {Buffer}
 */
export function extrairZip(buf, e) {
  const p = e.offsetLocal;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`ZIP inválido: cabeçalho local de ${e.nome}`);
  const ini = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const dados = buf.subarray(ini, ini + e.tamComp);
  if (e.metodo === 0) return Buffer.from(dados);
  if (e.metodo === 8) return inflateRawSync(dados);
  throw new Error(`ZIP: método de compressão ${e.metodo} não suportado (${e.nome})`);
}

// ------------------------------------------------------------------ CSV

/** Converte "12,5", ",2", "-9999" e "" para número ou null. */
export function numeroInmet(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().replace(',', '.');
  if (t === '' || t === '-') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= -9999 || v >= 9999) return null;
  return v;
}

// Colunas procuradas por trecho do nome, sem acento e em maiúsculas, para resistir a pequenas variações
// de grafia entre anos ("PRECIPITAÇÃO TOTAL, HORÁRIO (mm)", "PRECIPITACAO TOTAL, HORARIO (mm)").
const COLUNAS = {
  data: ['DATA'],
  hora: ['HORA'],
  chuva: ['PRECIPITACAO TOTAL'],
  temp: ['TEMPERATURA DO AR - BULBO SECO'],
  orvalho: ['TEMPERATURA DO PONTO DE ORVALHO'],
  tmaxHora: ['TEMPERATURA MAXIMA NA HORA ANT'],
  tminHora: ['TEMPERATURA MINIMA NA HORA ANT'],
  rajada: ['VENTO, RAJADA MAXIMA'],
  vento: ['VENTO, VELOCIDADE HORARIA'],
  direcao: ['VENTO, DIRECAO HORARIA'],
};

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * Interpreta o CSV de uma estação do INMET.
 * @param {string} texto conteúdo já decodificado de Latin-1
 * @returns {{meta: object, horas: {ms: number, chuva: ?number, temp: ?number, orvalho: ?number, tmax: ?number, tmin: ?number,
 *   rajada: ?number, vento: ?number, direcao: ?number}[]}}
 *   `ms` é o instante UTC do fim da hora; vento e rajada já em km/h (o INMET publica em m/s).
 */
export function lerCsvInmet(texto) {
  const linhas = texto.split(/\r?\n/);
  const meta = {};
  let iCab = -1;
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const partes = linhas[i].split(';');
    const chave = normalizar(partes[0] || '');
    if (chave.startsWith('DATA') && partes.length > 5) { iCab = i; break; }
    if (chave.endsWith(':')) meta[chave.slice(0, -1)] = (partes[1] || '').trim();
  }
  if (iCab < 0) throw new Error('CSV do INMET sem linha de colunas');
  const cab = linhas[iCab].split(';').map(normalizar);
  const col = {};
  for (const [k, trechos] of Object.entries(COLUNAS)) {
    col[k] = cab.findIndex((c) => trechos.some((t) => c.startsWith(t) || c.includes(t)));
  }
  if (col.data < 0 || col.hora < 0) throw new Error('CSV do INMET sem colunas de data e hora');
  const pega = (cel, k) => (col[k] >= 0 ? numeroInmet(cel[col[k]]) : null);
  const horas = [];
  for (let i = iCab + 1; i < linhas.length; i++) {
    const cel = linhas[i].split(';');
    if (cel.length < 3 || !cel[col.data]) continue;
    const ms = instanteUtc(cel[col.data], cel[col.hora]);
    if (ms === null) continue;
    const kmh = (v) => (v === null ? null : Math.round(v * 3.6 * 10) / 10);
    horas.push({
      ms,
      chuva: pega(cel, 'chuva'), temp: pega(cel, 'temp'), orvalho: pega(cel, 'orvalho'), tmax: pega(cel, 'tmaxHora'), tmin: pega(cel, 'tminHora'),
      rajada: kmh(pega(cel, 'rajada')), vento: kmh(pega(cel, 'vento')), direcao: pega(cel, 'direcao'),
    });
  }
  return {
    meta: {
      codigo: meta['CODIGO (WMO)'] || null, estacao: meta.ESTACAO || null, uf: meta.UF || null,
      lat: numeroInmet(meta.LATITUDE), lon: numeroInmet(meta.LONGITUDE), altitude: numeroInmet(meta.ALTITUDE),
    },
    horas,
  };
}

/** "2024/01/31" ou "2024-01-31" + "1500 UTC" ou "15:00" → milissegundos UTC. */
export function instanteUtc(data, hora) {
  const d = String(data).trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  const h = String(hora || '').trim().match(/^(\d{2}):?(\d{2})/);
  if (!d || !h) return null;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
}

// ------------------------------------------------------------------ controle de qualidade

// Limites físicos e de salto entre horas consecutivas. Valores fora disso são descartados (não corrigidos).
export const QC = {
  temp: [-10, 45], orvalho: [-30, 35], chuvaHoraMax: 120, rajada: [0, 200], vento: [0, 150],
  saltoTemp: 8,          // °C entre horas consecutivas: acima disso, a leitura é tratada como pico espúrio
};

/**
 * Remove leituras fisicamente impossíveis ou com salto espúrio. Devolve cópia e a contagem de descartes.
 * @param {ReturnType<typeof lerCsvInmet>['horas']} horas em ordem cronológica
 */
export function controleQualidade(horas) {
  const descartes = { temp: 0, orvalho: 0, chuva: 0, rajada: 0, vento: 0 };
  const fora = (v, [a, b]) => v !== null && (v < a || v > b);
  const out = horas.map((h) => ({ ...h }));
  for (let i = 0; i < out.length; i++) {
    const h = out[i];
    for (const k of ['temp', 'tmax', 'tmin']) if (fora(h[k], QC.temp)) { h[k] = null; descartes.temp++; }
    if (h.chuva !== null && (h.chuva < 0 || h.chuva > QC.chuvaHoraMax)) { h.chuva = null; descartes.chuva++; }
    if (fora(h.rajada, QC.rajada)) { h.rajada = null; descartes.rajada++; }
    if (fora(h.vento, QC.vento)) { h.vento = null; descartes.vento++; }
    // pico isolado: difere das duas vizinhas, na mesma direção, mais que o limite
    const a = out[i - 1]?.temp, b = out[i + 1]?.temp;
    if (h.temp !== null && a != null && b != null &&
      Math.abs(h.temp - a) > QC.saltoTemp && Math.abs(h.temp - b) > QC.saltoTemp && Math.sign(h.temp - a) === Math.sign(h.temp - b)) {
      h.temp = null; h.tmax = null; h.tmin = null; descartes.temp++;
    }
    if (h.rajada !== null && h.vento !== null && h.rajada < h.vento) { h.rajada = null; descartes.rajada++; }
    // ponto de orvalho fora da faixa ou acima da temperatura da mesma hora (meio grau de tolerância do sensor)
    if (h.orvalho != null && (fora(h.orvalho, QC.orvalho) || (h.temp != null && h.orvalho > h.temp + 0.5))) { h.orvalho = null; descartes.orvalho++; }
  }
  return { horas: out, descartes };
}

// ------------------------------------------------------------------ dia local

/** Data local (AAAA-MM-DD) de uma hora UTC, no fuso fixo do Brasil (-3 h; sem horário de verão desde 2019). */
export function dataLocal(msFimHora, offsetH = -3) {
  // A leitura das 03:00 UTC cobre 23:00–24:00 locais do dia anterior; a das 00:00 locais é a hora 0 do dia,
  // igual à convenção da Open-Meteo (valor da hora T = soma/máximo da hora que termina em T).
  return new Date(msFimHora + offsetH * 3600000).toISOString().slice(0, 10);
}

/**
 * Agrega as horas em dias locais com o mesmo critério do Worker (obsDoDia): o dia só conta com dados
 * suficientes, para não comparar previsão de 24 h com medição de meio dia.
 * @param {{minHoras?: number}} [op] mínimo de leituras para máxima, mínima, rajada e vento (20 no INMET; o METAR,
 *   que pode ter várias leituras por hora, conta horas distintas e usa 18)
 * @returns {Map<string, {chuva: ?number, tmax: ?number, tmin: ?number, rajada: ?number, vento: ?number, horas: number}>}
 */
export function diasLocais(horas, offsetH = -3, { minHoras = 20 } = {}) {
  const grupos = new Map();
  for (const h of horas) {
    const d = dataLocal(h.ms, offsetH);
    if (!grupos.has(d)) grupos.set(d, []);
    grupos.get(d).push(h);
  }
  const out = new Map();
  for (const [d, hs] of grupos) {
    const v = (k) => hs.filter((h) => h[k] !== null && h[k] !== undefined);
    const vals = (k) => v(k).map((h) => h[k]);
    const horasDistintas = (k) => new Set(v(k).map((h) => Math.floor(h.ms / 3600000))).size;
    const ok = (k) => horasDistintas(k) >= minHoras;
    const c = vals('chuva');
    // máxima e mínima pelas colunas "na hora anterior" (pegam o extremo entre leituras); sem elas, a instantânea
    const kMax = ok('tmax') ? 'tmax' : 'temp', kMin = ok('tmin') ? 'tmin' : 'temp';
    out.set(d, {
      horas: new Set(hs.map((h) => Math.floor(h.ms / 3600000))).size,
      chuva: c.length >= 22 ? Math.round(c.reduce((s, x) => s + x, 0) * 10) / 10 : null,
      tmax: ok(kMax) ? Math.max(...vals(kMax)) : null,
      tmin: ok(kMin) ? Math.min(...vals(kMin)) : null,
      rajada: ok('rajada') ? Math.max(...vals('rajada')) : null,
      vento: ok('vento') ? Math.max(...vals('vento')) : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ METAR (arquivo da IEM)

/**
 * Interpreta o CSV do serviço asos.py da Iowa Environmental Mesonet (format=onlycomma, missing=M):
 *   station,valid,tmpf,sknt,gust
 *   SBCO,2025-01-01 00:00,77.00,8.00,M
 * `valid` em UTC. Converte °F → °C e nós → km/h. A rajada do dia, no METAR, só existe quando o vento
 * oscila mais de 10 nós; nas outras horas vale o vento médio, como no Worker (obsDoDia).
 * @param {string} texto
 * @returns {{ms: number, temp: ?number, tmax: null, tmin: null, chuva: null, rajada: ?number, vento: ?number}[]}
 */
export function lerCsvIem(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  if (!linhas.length) return [];
  const cab = linhas[0].split(',').map((c) => c.trim().toLowerCase());
  const i = (k) => cab.indexOf(k);
  const iv = i('valid'), it = i('tmpf'), iw = i('sknt'), ig = i('gust');
  if (iv < 0) throw new Error('CSV da IEM sem coluna valid');
  const n = (s) => { const x = Number(s); return s === undefined || s === 'M' || s === '' || !Number.isFinite(x) ? null : x; };
  const out = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(',');
    const m = String(c[iv] || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) continue;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const f = n(c[it]), w = n(c[iw]), g = n(c[ig]);
    const kmh = (x) => (x === null ? null : Math.round(x * 1.852 * 10) / 10);
    out.push({
      ms, temp: f === null ? null : Math.round(((f - 32) * 5) / 9 * 10) / 10, tmax: null, tmin: null, chuva: null,
      vento: kmh(w), rajada: kmh(g ?? w),
    });
  }
  return out;
}
