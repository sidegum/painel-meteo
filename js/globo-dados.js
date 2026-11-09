// Dados da aba Globo. Toda resposta externa é tratada como não confiável: só números e textos esperados são copiados.
//
// Campos globais (vento, temperatura, pressão, chuva e nuvens) vêm do branch "globo-dados" deste repositório,
// gerado a cada hora pelo GitHub Actions a partir do GFS 0,5° (ver scripts/globo/atualizar.py). Cada campo é um
// PNG RGB em que cada canal guarda um inteiro de 0 a 255 que volta ao valor físico pela faixa [min, max] do manifest.
// O dado de um ponto tocado vem direto da Open-Meteo (CORS liberado, testado em 2026-11-03).
import { CONFIG } from './config.js';
import { ErroFonte, buscarJson, salvarCache, lerCache } from './dados.js';
import { arredondaCoord, valido } from './analise.js';

const BASE = CONFIG.globoDados;
const FONTE = 'globo-dados';

// ---------- manifest ----------

/**
 * Lê o manifest do branch globo-dados (descrição da rodada, horas e escalas). Guarda a última versão válida em cache
 * para abrir sem internet, marcada como antiga.
 * @returns {Promise<{manifest:object, antigo:boolean, salvoEm:number}>}
 */
export async function buscarManifest() {
  try {
    const r = await comNovasTentativas(() => fetchComTempo(BASE + 'manifest.json', 15000));
    const j = await r.json();
    if (!j || typeof j !== 'object' || !j.grade || !j.canais) throw new ErroFonte(FONTE, 'formato', 'manifest inesperado');
    const m = normalizarManifest(j);
    salvarCache('globo-manifest', m);
    return { manifest: m, antigo: false, salvoEm: Date.now() };
  } catch (e) {
    const c = await lerCache('globo-manifest');
    if (c?.dados) return { manifest: c.dados, antigo: true, salvoEm: c.salvoEm, erro: e };
    throw e instanceof ErroFonte ? e : new ErroFonte(FONTE, 'rede', 'não foi possível ler os dados do globo');
  }
}

function normalizarManifest(j) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const canais = {};
  for (const [arq, c] of Object.entries(j.canais || {})) {
    canais[arq] = {};
    for (const [canal, d] of Object.entries(c)) {
      if (!Array.isArray(d) || d.length < 4) continue;
      canais[arq][canal] = { nome: String(d[0]).slice(0, 30), unidade: String(d[1]).slice(0, 8), min: num(d[2]), max: num(d[3]), escala: d[4] === 'raiz' ? 'raiz' : 'linear' };
    }
  }
  const gfs = j.gfs && typeof j.gfs === 'object' ? {
    modelo: String(j.gfs.modelo || 'GFS').slice(0, 30), fonte: String(j.gfs.fonte || '').slice(0, 60),
    rodada: String(j.gfs.rodada || '').slice(0, 30), horas: (j.gfs.horas || []).map(num).filter((h) => h !== null),
    arquivos: { vento: 'vento-{h}.png', campo: 'campo-{h}.png', nuvens: 'nuvens-{h}.png' },
  } : null;
  const satelite = j.satelite && typeof j.satelite === 'object' ? {
    arquivo: 'satelite.png', largura: num(j.satelite.largura) || 2048, altura: num(j.satelite.altura) || 1024,
    fonte: String(j.satelite.fonte || 'NASA GIBS').slice(0, 80), instante: String(j.satelite.instante || '').slice(0, 30), alfa: j.satelite.alfa === true,
    camadas: (j.satelite.camadas || []).map((c) => ({ camada: String(c.camada || '').slice(0, 60), instante: String(c.instante || '').slice(0, 30) })),
  } : null;
  const ciclones = (Array.isArray(j.ciclones) ? j.ciclones : []).map((c) => ({
    nome: String(c.nome || 'Ciclone').slice(0, 40), tipo: String(c.tipo || '').slice(0, 30), lat: num(c.lat), lon: num(c.lon),
    ventoKmh: num(c.ventoKmh), pressaoHpa: num(c.pressaoHpa), fonte: String(c.fonte || '').slice(0, 20), atualizado: String(c.atualizado || '').slice(0, 30),
  })).filter((c) => c.lat !== null && c.lon !== null);
  const satelites = j.satelites && typeof j.satelites === 'object' ? { arquivo: 'satelites.json', gerado: String(j.satelites.gerado || '').slice(0, 30), grupos: j.satelites.grupos || {} } : null;
  return { gerado: String(j.gerado || '').slice(0, 30), grade: { largura: num(j.grade.largura) || 720, altura: num(j.grade.altura) || 361 }, canais, gfs, satelite, ciclones, satelites };
}

/**
 * Repete uma leitura que falhou por rede, tempo ou erro 5xx (até 3 tentativas, espera de 1,5 s e 4 s). Na abertura o globo
 * baixa texturas e catálogos ao mesmo tempo, e uma leitura isolada pode esgotar o tempo numa conexão lenta.
 */
async function comNovasTentativas(ler, esperas = [1500, 4000]) {
  for (let i = 0; ; i++) {
    try { return await ler(); }
    catch (e) {
      const repetivel = !(e instanceof ErroFonte) || ['rede', 'tempo', 'offline'].includes(e.tipo) || /erro 5\d\d/.test(e.message);
      if (!repetivel || i >= esperas.length) throw e;
      await new Promise((ok) => setTimeout(ok, esperas[i]));
    }
  }
}

async function fetchComTempo(url, timeout = 20000) {
  // navigator.onLine só serve como explicação: em adaptadores virtuais (VPN, máquinas virtuais) ele pode dizer
  // "sem conexão" com a rede funcionando, então a leitura é sempre tentada
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default' });
    if (!r.ok) throw new ErroFonte(FONTE, 'http', `erro ${r.status}`);
    return r;
  } catch (e) {
    if (e instanceof ErroFonte) throw e;
    if (e.name === 'AbortError') throw new ErroFonte(FONTE, 'tempo', 'tempo esgotado');
    throw new ErroFonte(FONTE, navigator.onLine ? 'rede' : 'offline', navigator.onLine ? 'falha de conexão' : 'sem conexão');
  } finally { clearTimeout(t); }
}

// ---------- campos em PNG ----------

const campos = new Map(); // url -> Promise<Campo>, na ordem de uso
const MAX_CAMPOS = 14; // cada campo guarda cerca de 1 MB de pixels mais a imagem: limita a memória ao animar a linha do tempo

/** Memoriza um campo e descarta os usados há mais tempo (o mais recente sempre fica). */
function memorizarCampo(url, promessa) {
  campos.delete(url); campos.set(url, promessa);
  for (const k of campos.keys()) { if (campos.size <= MAX_CAMPOS) break; campos.get(k).then((c) => c.imagem?.close?.(), () => {}); campos.delete(k); }
  return promessa;
}

/**
 * Um campo global decodificado: pixels RGB (Uint8ClampedArray) mais a imagem para virar textura.
 * @typedef {{largura:number, altura:number, pixels:Uint8ClampedArray, imagem:ImageBitmap, canais:object}} Campo
 */

/**
 * Baixa e decodifica um PNG de campo (vento, campo ou nuvens) de uma hora de previsão. Resultado memorizado.
 * @param {object} manifest
 * @param {'vento'|'campo'|'nuvens'} tipo
 * @param {number} hora  hora de previsão (0, 3, ... 48)
 * @returns {Promise<Campo>}
 */
export function buscarCampo(manifest, tipo, hora) {
  if (!manifest?.gfs?.horas?.includes(hora)) return Promise.reject(new ErroFonte(FONTE, 'formato', `hora +${hora} não publicada`));
  const url = BASE + manifest.gfs.arquivos[tipo].replace('{h}', String(hora).padStart(2, '0')) + '?r=' + encodeURIComponent(manifest.gfs.rodada);
  if (campos.has(url)) return memorizarCampo(url, campos.get(url));
  return memorizarCampo(url, lerImagemCampo(url, manifest.grade.largura, manifest.grade.altura).then((c) => ({ ...c, canais: manifest.canais[tipo] })).catch((e) => { campos.delete(url); throw e; }));
}

/** Mosaico infravermelho dos satélites (R = brilho, G = 255 onde há cobertura), 2048 x 1024. */
export function buscarSatelite(manifest) {
  if (!manifest?.satelite) return Promise.reject(new ErroFonte(FONTE, 'formato', 'sem imagem de satélite'));
  const url = BASE + manifest.satelite.arquivo + '?t=' + encodeURIComponent(manifest.satelite.instante);
  if (campos.has(url)) return memorizarCampo(url, campos.get(url));
  return memorizarCampo(url, lerImagemCampo(url, manifest.satelite.largura, manifest.satelite.altura).catch((e) => { campos.delete(url); throw e; }));
}

async function lerImagemCampo(url, largura, altura) {
  const r = await comNovasTentativas(() => fetchComTempo(url, 30000));
  const blob = await r.blob();
  if (blob.size > 8e6) throw new ErroFonte(FONTE, 'tamanho', 'imagem grande demais');
  const imagem = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (imagem.width !== largura || imagem.height !== altura) throw new ErroFonte(FONTE, 'formato', `imagem ${imagem.width}x${imagem.height}, esperado ${largura}x${altura}`);
  const cv = new OffscreenCanvas(largura, altura);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imagem, 0, 0);
  const pixels = ctx.getImageData(0, 0, largura, altura).data;
  return { largura, altura, pixels, imagem };
}

/** Elementos orbitais (OMM) por grupo, do CelesTrak via branch globo-dados. */
const satelitesEmMemoria = new Map(); // versão (gerado) -> Promise: o bloco do céu e o espaço usam a mesma leitura
export function buscarSatelites(manifest) {
  const chave = manifest?.satelites?.gerado || '';
  if (!satelitesEmMemoria.has(chave)) {
    const p = lerSatelites(manifest);
    p.catch(() => satelitesEmMemoria.delete(chave));
    satelitesEmMemoria.set(chave, p);
  }
  return satelitesEmMemoria.get(chave);
}

async function lerSatelites(manifest) {
  if (!manifest?.satelites) throw new ErroFonte(FONTE, 'formato', 'sem elementos orbitais');
  const r = await fetchComTempo(BASE + manifest.satelites.arquivo + '?g=' + encodeURIComponent(manifest.satelites.gerado), 30000);
  const j = await r.json();
  const grupos = {};
  for (const [g, lista] of Object.entries(j?.grupos || {})) {
    if (!Array.isArray(lista)) continue;
    grupos[g] = lista.filter((s) => s && typeof s.OBJECT_NAME === 'string' && typeof s.MEAN_MOTION === 'number').slice(0, 400);
  }
  return { gerado: String(j?.gerado || '').slice(0, 30), grupos };
}

/**
 * Trajetórias das sondas (JPL Horizons, gerado uma vez por dia). Só entram listas de números finitos com 7 colunas.
 * O arquivo é lido mesmo sem entrada no manifest (o workflow antigo da main pode ter regravado o manifest sem ela).
 * @returns {Promise<{gerado:string, sondas:Object<string,{alvo:string, rota:number[][], recente:number[][], perto:number[][], geo?:number[][]}>}>}
 */
export async function buscarSondas(manifest) {
  const versao = manifest?.sondas?.gerado || new Date().toISOString().slice(0, 10);
  const r = await fetchComTempo(BASE + 'sondas.json?g=' + encodeURIComponent(versao), 30000);
  const j = await r.json();
  const pontos = (l) => (Array.isArray(l) ? l.filter((p) => Array.isArray(p) && p.length >= 7 && p.slice(0, 7).every((v) => typeof v === 'number' && Number.isFinite(v))).map((p) => p.slice(0, 7)) : []);
  const sondas = {};
  for (const [k, s] of Object.entries(j?.sondas || {})) {
    if (!/^[a-z0-9]{2,20}$/.test(k) || !s || typeof s !== 'object') continue;
    const rota = pontos(s.rota), perto = pontos(s.perto);
    if (!rota.length && !perto.length) continue;
    sondas[k] = { alvo: String(s.alvo || k).slice(0, 80), rota, recente: pontos(s.recente), perto, geo: pontos(s.geo) };
  }
  if (!Object.keys(sondas).length) throw new ErroFonte(FONTE, 'formato', 'sem sondas');
  return { gerado: String(j?.gerado || '').slice(0, 30), sondas };
}

/**
 * Luas (elementos osculantes do JPL Horizons em relação ao planeta), corpos menores (JPL SBDB) e as populações dos
 * cinturões. Ângulos em graus, a em UA, n em graus/dia, épocas em ms. Só entram números finitos.
 * @returns {Promise<{gerado:string, luas:Object, pequenos:Object, populacoes:Object<string,number[][]>}>}
 */
export async function buscarCorpos(manifest) {
  const versao = manifest?.corpos?.gerado || new Date().toISOString().slice(0, 10);
  const r = await fetchComTempo(BASE + 'corpos.json?g=' + encodeURIComponent(versao), 30000);
  const j = await r.json();
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const elementos = (o) => (o && fin(o.e) && fin(o.i) && fin(o.om) && fin(o.w) && fin(o.epoca) && (fin(o.a) || fin(o.q)) ? o : null);
  const filtrar = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => /^[a-z0-9]{2,20}$/.test(k) && elementos(v)));
  const populacoes = {};
  for (const [k, l] of Object.entries(j?.populacoes || {})) {
    if (/^[a-z]{2,20}$/.test(k) && Array.isArray(l)) populacoes[k] = l.filter((p) => Array.isArray(p) && p.length === 7 && p.every(fin));
  }
  return { gerado: String(j?.gerado || '').slice(0, 30), luas: filtrar(j?.luas), pequenos: filtrar(j?.pequenos), populacoes };
}

// ---------- leitura de valores ----------

/** Valor físico de um byte de canal pela faixa do manifest (inverso da quantização do script). */
export function valorDoByte(byte, canal) {
  if (!canal || canal.min === null || canal.max === null) return null;
  let t = byte / 255;
  if (canal.escala === 'raiz') t *= t;
  return canal.min + t * (canal.max - canal.min);
}

/**
 * Interpolação bilinear de um canal (0 = R, 1 = G, 2 = B) de um campo em (lat, lon), com volta na longitude.
 * A grade tem a coluna 0 em -180° e a linha 0 em +90°, passo 360/largura graus.
 * @returns {number} valor físico, ou null se o campo não existir
 */
export function amostrar(campo, canal, lat, lon) {
  if (!campo) return null;
  const { largura: W, altura: H, pixels } = campo;
  const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * (H - 1);
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
  const fx = x - x0, fy = Math.max(0, Math.min(1, y - y0));
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
  const p = (xx, yy) => pixels[(yy * W + xx) * 4 + canal];
  const byte = (p(xa, y0) * (1 - fx) + p(xb, y0) * fx) * (1 - fy) + (p(xa, y0 + 1) * (1 - fx) + p(xb, y0 + 1) * fx) * fy;
  const nome = ['R', 'G', 'B'][canal];
  return campo.canais ? valorDoByte(byte, campo.canais[nome]) : byte;
}

/**
 * Leitura rápida de um ponto nos campos do GFS (o que já está carregado), em unidades do app.
 * @returns {{ventoKmh:number, rajadaKmh:number, direcao:number, temp:number, pressao:number, chuvaMmH:number, nuvens:number}|null}
 */
export function lerPontoGfs({ vento, campo, nuvens }, lat, lon) {
  if (!vento && !campo) return null;
  const u = amostrar(vento, 0, lat, lon), v = amostrar(vento, 1, lat, lon);
  const r = {};
  if (valido(u) && valido(v)) {
    r.ventoKmh = Math.hypot(u, v) * 3.6;
    r.direcao = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360; // de onde vem (convenção meteorológica)
    r.rajadaKmh = Math.max(r.ventoKmh, (amostrar(vento, 2, lat, lon) || 0) * 3.6);
  }
  if (campo) { r.temp = amostrar(campo, 0, lat, lon); r.pressao = amostrar(campo, 1, lat, lon); r.chuvaMmH = amostrar(campo, 2, lat, lon); }
  if (nuvens) {
    const b = amostrar(nuvens, 0, lat, lon), m = amostrar(nuvens, 1, lat, lon), a = amostrar(nuvens, 2, lat, lon);
    if (valido(b) && valido(m) && valido(a)) r.nuvens = Math.round((1 - (1 - b / 100) * (1 - m / 100) * (1 - a / 100)) * 100); // cobertura total por sobreposição aleatória
  }
  return r;
}

// ---------- ponto tocado: Open-Meteo ----------

const VARS_ATUAL = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'is_day'];
const VARS_HORA = ['precipitation', 'precipitation_probability', 'temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code'];
const pontos = new Map();

/**
 * Previsão do ponto tocado: condição atual e próximas 24 h pela Open-Meteo (ECMWF IFS, a mesma fonte principal
 * do painel, com fuso horário do próprio local). Resultado memorizado por coordenada arredondada durante 10 min.
 */
export async function buscarPonto(lat, lon) {
  const la = arredondaCoord(lat).toFixed(2), lo = arredondaCoord(lon).toFixed(2);
  const chave = `${la},${lo}`;
  const m = pontos.get(chave);
  if (m && Date.now() - m.em < 600000) return m.dados;
  const p = new URLSearchParams({
    latitude: la, longitude: lo, timezone: 'auto', models: 'ecmwf_ifs',
    current: VARS_ATUAL.join(','), hourly: VARS_HORA.join(','), forecast_days: '2', timeformat: 'unixtime',
    wind_speed_unit: 'kmh', precipitation_unit: 'mm', temperature_unit: 'celsius',
  });
  // Mesma rota das previsões do painel: respeita a espera após limite de uso (429) da Open-Meteo e trata o formato.
  const j = await buscarJson('open-meteo', 'https://api.open-meteo.com/v1/forecast?' + p, { timeout: 15000, maxBytes: 1e6 });
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const atual = {};
  for (const k of VARS_ATUAL) atual[k] = num(j?.current?.[k]);
  atual.ms = num(j?.current?.time) !== null ? j.current.time * 1000 : null;
  const horas = (j?.hourly?.time || []).map((t, i) => {
    const h = { ms: num(t) !== null ? t * 1000 : null };
    for (const k of VARS_HORA) h[k] = num(j.hourly[k]?.[i]);
    return h;
  });
  const dados = { atual, horas, fuso: String(j?.timezone || '').slice(0, 40), fusoAbrev: String(j?.timezone_abbreviation || '').slice(0, 10), offset: num(j?.utc_offset_seconds), elevacao: num(j?.elevation) };
  pontos.set(chave, { em: Date.now(), dados });
  return dados;
}

/** Texto curto do código de tempo WMO usado pela Open-Meteo (apenas os grupos). */
export function textoCodigoTempo(c, dia = true) {
  if (!valido(c)) return null;
  if (c === 0) return dia ? 'Céu limpo' : 'Noite limpa';
  if (c <= 2) return dia ? 'Poucas nuvens' : 'Poucas nuvens';
  if (c === 3) return 'Nublado';
  if (c <= 48) return 'Nevoeiro';
  if (c <= 57) return 'Chuvisco';
  if (c <= 67) return c >= 65 ? 'Chuva forte' : 'Chuva';
  if (c <= 77) return 'Neve';
  if (c <= 82) return c >= 82 ? 'Pancadas fortes' : 'Pancadas de chuva';
  if (c <= 86) return 'Pancadas de neve';
  return c >= 96 ? 'Temporal com granizo' : 'Temporal';
}
