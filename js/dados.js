// Busca e normalização de dados. Toda resposta externa é tratada como não confiável:
// só números e textos esperados são copiados, nada vai para innerHTML.
import { CONFIG } from './config.js';
import { arredondaCoord, isoLocalParaMs, valido, MODELOS, REGRAS, deslocamentoRadar, chegadaChuva, secoPeloRadar, direcaoTexto } from './analise.js';

const CACHE = 'painel-dados-v1';

// ---------- rede com tempo limite e espera após erro ----------

const espera = {}; // fonte -> instante até o qual não chamamos de novo
function emEspera(fonte) {
  try { const v = Number(localStorage.getItem('espera:' + fonte)); if (v > Date.now()) return v; } catch {}
  return espera[fonte] > Date.now() ? espera[fonte] : 0;
}
function aplicarEspera(fonte, tentativas) {
  const ms = Math.min(60, 2 ** tentativas) * 60000; // 2, 4, 8 ... até 60 min
  espera[fonte] = Date.now() + ms;
  try { localStorage.setItem('espera:' + fonte, String(espera[fonte])); } catch {}
}
const falhas = {};

export class ErroFonte extends Error {
  constructor(fonte, tipo, detalhe) { super(detalhe || tipo); this.fonte = fonte; this.tipo = tipo; }
}

// Uma nova tentativa em falha de rede ou tempo esgotado (comum no celular trocando de rede).
// Limite de uso (429) e erro do servidor não são repetidos: respeitam a espera.
export async function buscarJson(fonte, url, opcoes = {}) {
  try { return await buscarJsonUmaVez(fonte, url, opcoes); }
  catch (e) {
    if (!(e instanceof ErroFonte) || !['rede', 'tempo'].includes(e.tipo)) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return buscarJsonUmaVez(fonte, url, opcoes);
  }
}

/**
 * Uma requisição JSON com tempo limite (AbortController), sem credenciais e sem referrer, com limite de tamanho.
 * Em 429 ou 5xx aplica espera exponencial por fonte (2, 4, 8 ... 60 min), persistida em localStorage.
 * @throws {ErroFonte} com tipo rede | tempo | limite | servidor | http | tamanho | formato | api | offline
 */
async function buscarJsonUmaVez(fonte, url, { timeout = 15000, maxBytes = 6e6 } = {}) {
  const ate = emEspera(fonte);
  if (ate) throw new ErroFonte(fonte, 'limite', `aguardando até ${new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} após limite ou falha`);
  if (!navigator.onLine) throw new ErroFonte(fonte, 'offline', 'sem conexão');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  } catch (e) {
    clearTimeout(t);
    throw new ErroFonte(fonte, e.name === 'AbortError' ? 'tempo' : 'rede', e.name === 'AbortError' ? 'tempo esgotado' : 'falha de conexão');
  }
  clearTimeout(t);
  if (r.status === 429 || r.status >= 500) {
    falhas[fonte] = (falhas[fonte] || 0) + 1;
    aplicarEspera(fonte, falhas[fonte]);
    throw new ErroFonte(fonte, r.status === 429 ? 'limite' : 'servidor', r.status === 429 ? 'limite de uso atingido' : `erro ${r.status} no servidor`);
  }
  if (!r.ok) throw new ErroFonte(fonte, 'http', `erro ${r.status}`);
  const texto = await r.text();
  if (texto.length > maxBytes) throw new ErroFonte(fonte, 'tamanho', 'resposta grande demais');
  let json;
  try { json = JSON.parse(texto); } catch { throw new ErroFonte(fonte, 'formato', 'resposta em formato inesperado'); }
  if (json && json.error === true) throw new ErroFonte(fonte, 'api', String(json.reason || 'erro da API').slice(0, 160));
  falhas[fonte] = 0;
  return json;
}

// ---------- cache local (Cache Storage do navegador) ----------

export async function salvarCache(chave, dados) {
  if (window.__painel?.estado?.apagado) return;
  try {
    const c = await caches.open(CACHE);
    await c.put(new Request('/__dados/' + chave), new Response(JSON.stringify({ salvoEm: Date.now(), dados }), { headers: { 'content-type': 'application/json' } }));
  } catch {}
}
export async function lerCache(chave) {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(new Request('/__dados/' + chave));
    return r ? await r.json() : null;
  } catch { return null; }
}

// ---------- Open-Meteo: previsão determinística ----------

export const VARS_HORA = [
  'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'pressure_msl',
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'cape', 'uv_index', 'is_day',
];
const VARS_DIA = ['sunrise', 'sunset', 'uv_index_max'];

export function urlPrevisao(lat, lon) {
  const p = new URLSearchParams({
    latitude: arredondaCoord(lat).toFixed(2), longitude: arredondaCoord(lon).toFixed(2),
    timezone: 'auto', models: [...Object.keys(MODELOS), ...MODELOS_AUXILIARES].join(','),
    hourly: VARS_HORA.join(','), daily: VARS_DIA.join(','),
    current: 'temperature_2m',
    wind_speed_unit: 'kmh', precipitation_unit: 'mm', temperature_unit: 'celsius',
    past_days: '1', forecast_days: '16',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p;
}

// GFS só para dados diários que os outros não têm (índice UV); não entra na previsão.
export const MODELOS_AUXILIARES = ['ncep_gfs_seamless'];

// Com vários modelos, cada chave vem com sufixo do modelo (testado em 2026-11-03).
// Séries totalmente nulas significam variável ausente naquele modelo.
/**
 * Normaliza a resposta multimodelo da Open-Meteo: horários em epoch ms, séries por modelo (chaves com sufixo),
 * variáveis totalmente nulas marcadas como ausentes, dados diários e temperatura "current" por modelo.
 * @throws {ErroFonte} se a resposta não tiver horários
 */
export function normalizarPrevisao(j) {
  if (!j || !j.hourly || !Array.isArray(j.hourly.time)) throw new ErroFonte('open-meteo', 'formato', 'previsão sem horários');
  const off = Number(j.utc_offset_seconds) || 0;
  const horas = j.hourly.time.map((t) => isoLocalParaMs(String(t), off));
  const modelos = {};
  for (const m of Object.keys(MODELOS)) {
    const vars = {}, ausentes = [];
    for (const v of VARS_HORA) {
      const serie = j.hourly[`${v}_${m}`];
      if (Array.isArray(serie) && serie.some(valido)) vars[v] = serie.map((x) => (valido(x) ? x : null));
      else ausentes.push(v);
    }
    if (Object.keys(vars).length) {
      const ultimo = horas[Math.max(...(vars.precipitation || vars.temperature_2m || []).map((x, i) => (x === null ? -1 : i)))];
      modelos[m] = { vars, ausentes, ate: ultimo ?? null };
    }
  }
  const d = j.daily || {};
  const pegar = (v) => {
    for (const m of ['ncep_gfs_seamless', ...Object.keys(MODELOS)]) {
      const s = d[`${v}_${m}`];
      if (Array.isArray(s) && s.some((x) => x !== null)) return s;
    }
    return Array.isArray(d[v]) ? d[v] : [];
  };
  const diario = {
    datas: (d.time || []).map(String),
    nascer: pegar('sunrise').map((x) => (x ? isoLocalParaMs(String(x), off) : null)),
    por: pegar('sunset').map((x) => (x ? isoLocalParaMs(String(x), off) : null)),
    uvMax: pegar('uv_index_max').map((x) => (valido(x) ? x : null)),
  };
  const c = j.current || {};
  return {
    lat: Number(j.latitude), lon: Number(j.longitude), elevacao: Number(j.elevation),
    fuso: String(j.timezone || ''), offset: off, horas, modelos, diario,
    atual: { ms: c.time ? isoLocalParaMs(String(c.time), off) : null, temp: Object.fromEntries(Object.keys(MODELOS).map((m) => [m, valido(c[`temperature_2m_${m}`]) ? c[`temperature_2m_${m}`] : null])), geral: valido(c.temperature_2m) ? c.temperature_2m : null },
  };
}

export async function buscarPrevisao(lat, lon) {
  const j = await buscarJson('open-meteo', urlPrevisao(lat, lon), { timeout: 20000 });
  return normalizarPrevisao(j);
}

// ---------- Open-Meteo: ensemble (cenários) ----------
// Identificadores conforme a documentação da Ensemble API conhecida até 2026; não verificados
// nesta nuvem porque o IP compartilhado bateu o limite diário. Uma chamada por modelo
// para que as chaves venham sem sufixo de modelo.
export const MODELOS_ENSEMBLE = {
  ecmwf_ifs025: { nome: 'ECMWF ENS', membros: 51 },
  ecmwf_aifs025_ensemble: { nome: 'ECMWF AIFS ENS', membros: 51 },
  ukmo_global_ensemble_20km: { nome: 'UKMO MOGREPS-G', membros: 18 },
};

export function urlEnsemble(lat, lon, modelo) {
  const p = new URLSearchParams({
    latitude: arredondaCoord(lat).toFixed(2), longitude: arredondaCoord(lon).toFixed(2),
    timezone: 'auto', models: modelo, hourly: 'precipitation,wind_gusts_10m',
    wind_speed_unit: 'kmh', forecast_days: '10',
  });
  return 'https://ensemble-api.open-meteo.com/v1/ensemble?' + p;
}

/**
 * Extrai as séries de cada membro (precipitation_memberNN, wind_gusts_10m_memberNN) de um sistema de cenários.
 * @returns {{horas:number[], membros:{precipitation:number[][], wind_gusts_10m:number[][]}}|null}
 */
export function normalizarEnsemble(j) {
  if (!j?.hourly?.time) return null;
  const off = Number(j.utc_offset_seconds) || 0;
  const horas = j.hourly.time.map((t) => isoLocalParaMs(String(t), off));
  const membros = { precipitation: [], wind_gusts_10m: [] };
  for (const [k, serie] of Object.entries(j.hourly)) {
    const m = /^(precipitation|wind_gusts_10m)(?:_member\d{1,3})?(?:_[a-z0-9_]+)?$/.exec(k);
    if (!m || !Array.isArray(serie) || !serie.some(valido)) continue;
    membros[m[1]].push(serie.map((x) => (valido(x) ? x : null)));
  }
  if (!membros.precipitation.length && !membros.wind_gusts_10m.length) return null;
  return { horas, membros };
}

export async function buscarEnsemble(lat, lon) {
  const saida = {}, erros = [];
  await Promise.all(Object.keys(MODELOS_ENSEMBLE).map(async (m) => {
    try {
      const e = normalizarEnsemble(await buscarJson('ensemble-' + m, urlEnsemble(lat, lon, m), { timeout: 25000 }));
      if (e) saida[m] = e; else erros.push(`${MODELOS_ENSEMBLE[m].nome}: sem membros`);
    } catch (e) { erros.push(`${MODELOS_ENSEMBLE[m].nome}: ${e.message}`); }
  }));
  return { ens: Object.keys(saida).length ? saida : null, erros };
}

// ---------- Open-Meteo: busca de cidades ----------

export async function buscarCidades(nome) {
  const q = String(nome).trim().slice(0, 60);
  if (q.length < 2) return [];
  const p = new URLSearchParams({ name: q, count: '8', language: 'pt', format: 'json' });
  const j = await buscarJson('geocoding', 'https://geocoding-api.open-meteo.com/v1/search?' + p, { timeout: 10000 });
  return (Array.isArray(j.results) ? j.results : []).filter((r) => valido(r.latitude) && valido(r.longitude)).map((r) => ({
    nome: String(r.name || '').slice(0, 80),
    regiao: [r.admin1, r.country_code].filter(Boolean).map((x) => String(x).slice(0, 60)).join(', '),
    lat: r.latitude, lon: r.longitude,
  }));
}

// ---------- Worker (INMET, METAR, alertas, El Niño, acerto) ----------

export function workerConfigurado() { return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(CONFIG.workerUrl || ''); }

async function worker(rota, params = {}) {
  if (!workerConfigurado()) throw new ErroFonte('worker', 'config', 'Worker ainda não configurado');
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) p.set(k, typeof v === 'number' ? arredondaCoord(v).toFixed(2) : String(v));
  const url = `${CONFIG.workerUrl}/v1/${rota}${p.toString() ? '?' + p : ''}`;
  return buscarJson('worker-' + rota, url, { timeout: 20000, maxBytes: 2e6 });
}

export const buscarObservacoes = (lat, lon) => worker('observacoes', { lat, lon });
export const buscarAlertas = () => worker('alertas');

// ---------- INMET direto do navegador (CORS liberado, conferido em 2026-11-03) ----------
// Usado quando o Worker não está configurado ou falha. Não envia coordenadas: só o código IBGE
// de Campo Bom, que é público.
export const GEOCODE_PADRAO = '4303905';

// Listas do INMET: hoje chegam como array JSON; versões antigas mandavam texto no formato "['a', 'b']".
// Mesma regra do Worker (listaPython em worker/src/index.js).
function listaPython(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim().slice(0, 400)).filter(Boolean).slice(0, 8);
  const s = String(v ?? '').slice(0, 4000);
  if (!s.trim()) return [];
  return s.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '').split(/['"]\s*,\s*['"]/)
    .map((x) => x.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean).map((x) => x.slice(0, 400)).slice(0, 8);
}
function poligonos(v) {
  let g; try { g = typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  const aneis = g?.type === 'Polygon' ? [g.coordinates?.[0]] : g?.type === 'MultiPolygon' ? (g.coordinates || []).map((p) => p?.[0]) : [];
  const out = aneis.filter((a) => Array.isArray(a) && a.length >= 3)
    .map((a) => a.filter((p) => valido(p?.[0]) && valido(p?.[1])).map(([lon, lat]) => [lat, lon]));
  return out.length ? out : null;
}
export async function buscarAlertasDireto() {
  const j = await buscarJson('inmet-avisos', 'https://apiprevmet3.inmet.gov.br/avisos/ativos', { timeout: 20000, maxBytes: 8e6 });
  const lista = [...(Array.isArray(j?.hoje) ? j.hoje : []), ...(Array.isArray(j?.futuro) ? j.futuro : [])].slice(0, 300);
  return { geradoEm: Date.now(), fonte: 'INMET avisos ativos (direto)', avisos: lista.map((a) => ({
    id: String(a.id ?? '').slice(0, 40), titulo: String(a.descricao ?? '').slice(0, 160), severidade: String(a.severidade ?? '').slice(0, 40),
    inicio: String(a.inicio ?? '').slice(0, 20), fim: String(a.fim ?? '').slice(0, 20), estados: String(a.estados ?? '').slice(0, 400),
    riscos: listaPython(a.riscos), instrucoes: listaPython(a.instrucoes),
    municipioPadrao: String(a.geocodes ?? '').split(',').map((x) => x.trim()).includes(GEOCODE_PADRAO),
    poligonos: poligonos(a.poligono),
  })).filter((a) => a.titulo) };
}

const numInmet = (v, a, b) => { const n = Number(String(v ?? '').replace(',', '.')); return v !== null && v !== '' && Number.isFinite(n) && n >= a && n <= b && ![9999, -9999].includes(n) ? n : null; };
export async function buscarObservacoesDireto() {
  const j = await buscarJson('inmet-estacao', `https://apiprevmet3.inmet.gov.br/estacao/proxima/${GEOCODE_PADRAO}`, { timeout: 12000, maxBytes: 2e5 });
  const e = j?.estacao, d = j?.dados;
  if (!e || !d) throw new ErroFonte('inmet-estacao', 'formato', 'resposta inesperada do INMET');
  const lat = numInmet(e.LATITUDE, -90, 90), lon = numInmet(e.LONGITUDE, -180, 180);
  const data = String(d.DT_MEDICAO || ''), hora = String(d.HR_MEDICAO || '').padStart(4, '0');
  if (lat === null || lon === null || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{4}$/.test(hora)) throw new ErroFonte('inmet-estacao', 'formato', 'leitura sem data ou posição');
  const ms = Date.parse(`${data}T${hora.slice(0, 2)}:${hora.slice(2)}:00Z`); // INMET publica em UTC
  const ms2kmh = (v) => (v === null ? null : Math.round(v * 3.6));
  const ponto = {
    ms, temperatura: numInmet(d.TEM_INS, -30, 50), umidade: numInmet(d.UMD_INS, 0, 100), orvalho: numInmet(d.PTO_INS, -40, 40),
    sensacao: numInmet(d.TEM_SEN, -45, 60), vento: ms2kmh(numInmet(d.VEN_VEL, 0, 100)), rajada: ms2kmh(numInmet(d.VEN_RAJ, 0, 120)),
    direcao: numInmet(d.VEN_DIR, 0, 360), chuva: numInmet(d.CHUVA, 0, 200), pressao: null, pressaoEstacao: numInmet(d.PRE_INS, 700, 1085),
  };
  // Altitude oficial da A884 (lista de estações do INMET, 23,35 m) para reduzir a pressão ao nível do mar.
  const alt = String(e.CODIGO) === 'A884' ? 23.35 : null;
  if (alt !== null && ponto.pressaoEstacao !== null && ponto.temperatura !== null) {
    ponto.pressao = Math.round(10 * ponto.pressaoEstacao * Math.pow(1 - (0.0065 * alt) / (ponto.temperatura + 0.0065 * alt + 273.15), -5.257)) / 10;
  }
  return { geradoEm: Date.now(), direto: true, status: { inmet: { ok: true, estacoes: 1, aviso: 'sem Worker: só a última leitura da estação de Campo Bom' }, metar: { ok: false, erro: 'METAR requer o Worker (a AviationWeather não permite leitura direta pelo navegador)' } },
    fontes: [{ id: String(e.CODIGO || '').replace(/[^A-Z0-9]/gi, '').slice(0, 8), tipo: 'inmet', nome: String(e.NOME || '').slice(0, 80), lat, lon, serie: [ponto], modo: 'só a última leitura' }] };
}
// El Niño: arquivo atualizado pelo GitHub Actions e publicado junto com o app (mesma origem, sem Worker).
export async function buscarEnso() {
  if (workerConfigurado()) { try { return await worker('enso'); } catch {} }
  return buscarJson('enso-arquivo', new URL('dados/enso.json', location.href).href, { timeout: 15000, maxBytes: 3e6 });
}
/**
 * Calibração com o histórico (viés de temperatura, fatores de rajada e vento, pesos), gerada todo mês pelo
 * GitHub Actions (scripts/calibrar.mjs) e publicada pelo GitHub Pages junto com o app: mesma origem, sem
 * Worker e sem CORS. Método em docs/CALIBRACAO.md.
 * @returns {Promise<object>} conteúdo de dados/calibracao.json
 */
export async function buscarCalibracao() {
  const j = await buscarJson('calibracao', new URL('dados/calibracao.json', location.href).href, { timeout: 15000, maxBytes: 2e6 });
  if (j?.versao !== 1 || !j.modelos || !j.estacao) throw new ErroFonte('calibracao', 'formato', 'arquivo de calibração em formato desconhecido');
  return j;
}

export const buscarAcerto = (estacao) => worker('acerto', { estacao: String(estacao).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) });

// ---------- RainViewer ----------
// Lê weather-maps.json para descobrir host e caminhos dos quadros. A mesma resposta serve por 60 s:
// chuva sobre o ponto, chegada da chuva e mapa pedem a lista na mesma rodada e dividem uma só requisição.
let radarRecente = null; // { em: ms, promessa }
export function buscarRadar() {
  if (radarRecente && Date.now() - radarRecente.em < 60000) return radarRecente.promessa;
  const promessa = lerListaRadar();
  radarRecente = { em: Date.now(), promessa };
  promessa.catch(() => { if (radarRecente?.promessa === promessa) radarRecente = null; });
  return promessa;
}
async function lerListaRadar() {
  const j = await buscarJson('rainviewer', 'https://api.rainviewer.com/public/weather-maps.json', { timeout: 10000, maxBytes: 2e5 });
  const host = String(j.host || '');
  if (!/^https:\/\/[a-z0-9.-]+\.rainviewer\.com$/i.test(host)) throw new ErroFonte('rainviewer', 'formato', 'host de radar inesperado');
  const quadros = (j.radar?.past || []).filter((q) => valido(q.time) && /^\/v2\/radar\/[A-Za-z0-9_]+$/.test(String(q.path)))
    .map((q) => ({ ms: q.time * 1000, path: String(q.path) }));
  if (!quadros.length) throw new ErroFonte('rainviewer', 'formato', 'sem quadros de radar');
  return { host, quadros, gerado: valido(j.generated) ? j.generated * 1000 : null };
}

// Chuva sobre o ponto pelo radar: lê o quadro mais recente do RainViewer (zoom 7, cerca de 1,2 km por
// pixel) e conta os pixels com eco num quadrado de 5 x 5 em volta do ponto. A coordenada usada é a
// arredondada; o pedido só revela o quadrado de cerca de 300 km do mapa, como o próprio mapa.
/**
 * Projeção Web Mercator: coordenada -> tile (z, x, y) e pixel (px, py) dentro do tile de 256 px.
 */
export function pixelDoPonto(lat, lon, z = 7) {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { z, x, y, px: Math.floor((fx - x) * 256), py: Math.floor((fy - y) * 256) };
}
/**
 * Chuva sobre o ponto pelo radar: lê o tile do quadro mais recente (zoom 7) e conta pixels com eco
 * (alfa > 40) num quadrado 5 x 5 em volta do ponto arredondado. Chovendo com 3 ou mais pixels.
 * @returns {Promise<{ms:number, eco:number, total:number, chuva:boolean}>}
 */
// Lê um tile do radar como imagem (fetch sem credenciais, tempo limite de 10 s).
async function tileRadar(url) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
  try {
    const resp = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!resp.ok) throw new ErroFonte('rainviewer', 'http', `erro ${resp.status}`);
    return await createImageBitmap(await resp.blob());
  } catch (e) { throw e instanceof ErroFonte ? e : new ErroFonte('rainviewer', 'rede', 'falha ao ler o radar'); }
  finally { clearTimeout(to); }
}

export async function buscarChuvaRadar(lat, lon) {
  const r = await buscarRadar();
  const q = r.quadros[r.quadros.length - 1];
  const t = pixelDoPonto(arredondaCoord(lat), arredondaCoord(lon));
  const url = `${r.host}${q.path}/256/${t.z}/${t.x}/${t.y}/2/0_0.png`;
  const img = await tileRadar(url);
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
  const x0 = Math.max(0, t.px - 2), y0 = Math.max(0, t.py - 2);
  const d = c.getImageData(x0, y0, Math.min(5, 256 - x0), Math.min(5, 256 - y0)).data;
  let eco = 0, total = 0;
  for (let i = 3; i < d.length; i += 4) { total++; if (d[i] > 40) eco++; }
  return { ms: q.ms, eco, total, chuva: eco >= 3 };
}

// ---------- Grade regional para as camadas do mapa ----------
// 11 x 11 pontos a cada 0,4° (cerca de 40 km) em volta da posição arredondada, num só pedido à Open-Meteo.
// Atual: temperatura, nuvens, vento e rajada. Próximas 24 h: chuva. Próximos 5 dias: máxima e mínima.
export const GRADE = { n: 11, passo: 0.4 };
/**
 * Pontos da grade regional (GRADE.n x GRADE.n, passo GRADE.passo graus) centrada na coordenada arredondada.
 * Ordem: linha 0 ao norte, coluna 0 a oeste.
 * @returns {Array<[number, number]>} pares [lat, lon]
 */
export function pontosGrade(lat, lon) {
  const la0 = arredondaCoord(lat), lo0 = arredondaCoord(lon), m = (GRADE.n - 1) / 2, pts = [];
  for (let i = 0; i < GRADE.n; i++) for (let j = 0; j < GRADE.n; j++)
    pts.push([Math.round((la0 + (m - i) * GRADE.passo) * 100) / 100, Math.round((lo0 + (j - m) * GRADE.passo) * 100) / 100]);
  return pts; // linha 0 = norte, coluna 0 = oeste
}
const num = (v, a, b) => (valido(v) && v >= a && v <= b ? v : null);
/**
 * Busca a grade do mapa numa só chamada multiponto e devolve campos alinhados aos pontos, com filtro de faixa:
 * temp, nuvens, vento, rajada, direcao (atuais), chuva24 (soma 24 h), tmax5 e tmin5 (extremos de 5 dias).
 */
export async function buscarGradeMapa(lat, lon) {
  const pts = pontosGrade(lat, lon);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map((p) => p[0]).join(',') + '&longitude=' + pts.map((p) => p[1]).join(',')
    + '&current=temperature_2m,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=precipitation&forecast_hours=24'
    + '&daily=temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto&wind_speed_unit=kmh';
  const j = await buscarJson('open-meteo-grade', url, { timeout: 20000, maxBytes: 3e6 });
  if (!Array.isArray(j) || j.length !== pts.length) throw new ErroFonte('open-meteo-grade', 'formato', 'grade em formato inesperado');
  const soma = (l) => { const v = (Array.isArray(l) ? l : []).filter(valido); return v.length >= 20 ? v.reduce((a, b) => a + b, 0) : null; };
  const ext = (l, f) => { const v = (Array.isArray(l) ? l : []).filter(valido); return v.length ? f(...v) : null; };
  return {
    geradoEm: Date.now(), n: GRADE.n, passo: GRADE.passo, pontos: pts,
    hora: String(j[0]?.current?.time || '').slice(0, 16),
    temp: j.map((r) => num(r?.current?.temperature_2m, -40, 55)),
    nuvens: j.map((r) => num(r?.current?.cloud_cover, 0, 100)),
    vento: j.map((r) => num(r?.current?.wind_speed_10m, 0, 300)),
    rajada: j.map((r) => num(r?.current?.wind_gusts_10m, 0, 400)),
    direcao: j.map((r) => num(r?.current?.wind_direction_10m, 0, 360)),
    chuva24: j.map((r) => num(soma(r?.hourly?.precipitation), 0, 2000)),
    tmax5: j.map((r) => num(ext(r?.daily?.temperature_2m_max, Math.max), -40, 55)),
    tmin5: j.map((r) => num(ext(r?.daily?.temperature_2m_min, Math.min), -40, 55)),
  };
}

// ---------- Chuva chegando (nowcasting pelo radar) ----------

/**
 * Intensidade aproximada (0 a 1) de um pixel da paleta 2 da RainViewer ("Universal Blue"): ecos fracos são
 * bege semitransparentes; depois azul do claro ao escuro; depois amarelo, laranja, vermelho e rosa.
 * Serve só para dar textura à medida do movimento; a presença de chuva usa o alfa.
 */
function intensidadePixel(r, g, b, a) {
  if (a <= 40) return 0;
  if (a < 255) return 0.1 + 0.2 * (a / 255);
  if (b > r) return 0.35 + 0.3 * (1 - Math.min(g, 200) / 200);
  return 0.7 + 0.3 * (1 - Math.min(g, 224) / 224);
}

/**
 * Mosaico 2 x 2 de tiles do radar (zoom 6, cerca de 2 km por pixel no RS) com o local dentro da metade central,
 * reduzido a 128 x 128 células de 4 x 4 pixels: fração de pixels com eco (alfa > 40) e intensidade média.
 * @returns {Promise<{eco:Float32Array, intensidade:Float32Array, n:number, px:number, py:number, kmCelula:number}>}
 */
async function gradeRadar(host, path, lat, lon) {
  const z = 6, t = pixelDoPonto(lat, lon, z);
  const x0 = t.px < 128 ? t.x - 1 : t.x, y0 = t.py < 128 ? t.y - 1 : t.y;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(512, 512) : Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  const c = cv.getContext('2d');
  const imgs = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => tileRadar(`${host}${path}/256/${z}/${x0 + i}/${y0 + j}/2/0_0.png`).then((img) => [i, j, img])));
  for (const [i, j, img] of imgs) c.drawImage(img, i * 256, j * 256);
  const d = c.getImageData(0, 0, 512, 512).data, n = 128;
  const eco = new Float32Array(n * n), intensidade = new Float32Array(n * n);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const k = (y * 512 + x) * 4, cel = (y >> 2) * n + (x >> 2);
    if (d[k + 3] > 40) eco[cel] += 1 / 16;
    intensidade[cel] += intensidadePixel(d[k], d[k + 1], d[k + 2], d[k + 3]) / 16;
  }
  const px = ((t.x - x0) * 256 + t.px) / 4, py = ((t.y - y0) * 256 + t.py) / 4;
  const kmCelula = (40075 * Math.cos((lat * Math.PI) / 180) / (256 * 2 ** z)) * 4;
  return { eco, intensidade, n, px, py, kmCelula };
}

/**
 * Chuva chegando: mede o movimento dos ecos entre o quadro mais recente e os de 30 e 60 min antes
 * (deslocamentoRadar sobre a intensidade). As duas velocidades precisam concordar dentro de
 * REGRAS.radar.concordanciaKmh; a de 60 min é extrapolada até o local (chegadaChuva). Coordenada arredondada.
 * secoMin: minutos garantidos sem chuva no local (secoPeloRadar), mesmo quando o movimento não pode ser medido.
 * @returns {Promise<{ms:number, minutos:number|null, chegaMs:number|null, kmh:number|null, vemDe:string|null, secoMin:number|null}|null>}
 *   minutos/chegaMs/kmh/vemDe nulos quando o movimento não pode ser medido com segurança
 */
export async function buscarChegadaChuva(lat, lon) {
  const R = REGRAS.radar;
  const r = await buscarRadar();
  const ult = r.quadros[r.quadros.length - 1];
  const antes = (min) => r.quadros.find((q) => Math.abs(ult.ms - q.ms - min * 60000) <= 5 * 60000);
  const q30 = antes(30), q60 = antes(R.intervaloMin);
  const la = arredondaCoord(lat), lo = arredondaCoord(lon);
  const g = await gradeRadar(r.host, ult.path, la, lo);
  const semMovimento = { ms: ult.ms, minutos: null, chegaMs: null, kmh: null, vemDe: null, secoMin: secoPeloRadar(g.eco, g.n, g.px, g.py, null, g.kmCelula) };
  if (!q30 || !q60) return semMovimento;
  const [g60, g30] = await Promise.all([q60, q30].map((q) => gradeRadar(r.host, q.path, la, lo)));
  // velocidade em células por REGRAS.radar.intervaloMin, normalizada pelo intervalo real entre os quadros
  const vel = (ga, q) => {
    const d = deslocamentoRadar(ga.intensidade, g.intensidade, g.n);
    if (!d) return null;
    const f = R.intervaloMin * 60000 / (ult.ms - q.ms);
    return { dx: d.dx * f, dy: d.dy * f };
  };
  const v60 = vel(g60, q60), v30 = vel(g30, q30);
  if (!v60 || !v30) return semMovimento;
  const kmh = (v) => Math.hypot(v.dx, v.dy) * g.kmCelula * (60 / R.intervaloMin);
  if (Math.hypot(v60.dx - v30.dx, v60.dy - v30.dy) * g.kmCelula * (60 / R.intervaloMin) > R.concordanciaKmh) return semMovimento;
  const minutos = chegadaChuva(g.eco, g.n, g.px, g.py, v60);
  // direção de onde a chuva vem (meteorológica): oposta ao movimento; o eixo y da imagem aponta para o sul
  const vemDe = kmh(v60) >= 5 ? direcaoTexto((Math.atan2(-v60.dx, v60.dy) * 180 / Math.PI + 360) % 360) : null;
  return { ms: ult.ms, minutos, chegaMs: minutos === null ? null : ult.ms + minutos * 60000, kmh: kmh(v60), vemDe,
    secoMin: secoPeloRadar(g.eco, g.n, g.px, g.py, v60, g.kmCelula) };
}
