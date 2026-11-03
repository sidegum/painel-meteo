// Busca e normalização de dados. Toda resposta externa é tratada como não confiável:
// só números e textos esperados são copiados, nada vai para innerHTML.
import { CONFIG } from './config.js';
import { arredondaCoord, isoLocalParaMs, valido, MODELOS } from './analise.js';

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

async function buscarJson(fonte, url, { timeout = 15000, maxBytes = 6e6 } = {}) {
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
    current: 'weather_code,temperature_2m,wind_gusts_10m',
    wind_speed_unit: 'kmh', precipitation_unit: 'mm', temperature_unit: 'celsius',
    past_days: '1', forecast_days: '16',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p;
}

// GFS só para dados diários que os outros não têm (índice UV); não entra na previsão.
export const MODELOS_AUXILIARES = ['ncep_gfs_seamless'];

// Com vários modelos, cada chave vem com sufixo do modelo (testado em 2026-11-03).
// Séries totalmente nulas significam variável ausente naquele modelo.
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
    atual: { ms: c.time ? isoLocalParaMs(String(c.time), off) : null, codigo: valido(c.weather_code) ? c.weather_code : null },
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
      const e = normalizarEnsemble(await buscarJson('ensemble', urlEnsemble(lat, lon, m), { timeout: 25000 }));
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

function listaPython(v) {
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
export const buscarEnso = () => worker('enso');
export const buscarAcerto = (estacao) => worker('acerto', { estacao: String(estacao).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) });

// ---------- RainViewer ----------
// Lê sempre weather-maps.json para descobrir host e caminhos dos quadros.
export async function buscarRadar() {
  const j = await buscarJson('rainviewer', 'https://api.rainviewer.com/public/weather-maps.json', { timeout: 10000, maxBytes: 2e5 });
  const host = String(j.host || '');
  if (!/^https:\/\/[a-z0-9.-]+\.rainviewer\.com$/i.test(host)) throw new ErroFonte('rainviewer', 'formato', 'host de radar inesperado');
  const quadros = (j.radar?.past || []).filter((q) => valido(q.time) && /^\/v2\/radar\/[A-Za-z0-9_]+$/.test(String(q.path)))
    .map((q) => ({ ms: q.time * 1000, path: String(q.path) }));
  if (!quadros.length) throw new ErroFonte('rainviewer', 'formato', 'sem quadros de radar');
  return { host, quadros, gerado: valido(j.generated) ? j.generated * 1000 : null };
}
