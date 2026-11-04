// Cloudflare Worker do Painel Meteorológico.
//
// Regras de segurança aplicadas aqui:
// - Só rotas fixas. Nenhuma rota aceita URL, host ou caminho do cliente.
// - Lista fechada de destinos (DESTINOS). Qualquer outro host é recusado antes do fetch.
// - Só GET e OPTIONS. CORS restrito a ALLOWED_ORIGIN.
// - Parâmetros validados e limitados. Coordenadas são arredondadas para 2 casas.
// - Limite de requisições por cliente usando hash do IP com sal diário, só em memória.
// - Tempo limite, limite de tamanho e cache para as chamadas externas.
// - INMET_TOKEN nunca aparece em respostas, erros ou logs.
// - Nenhuma localização ou IP é gravado no KV ou em logs.

const VERSAO = '1.0.0';

export const DESTINOS = new Set([
  'apitempo.inmet.gov.br',
  'apiprevmet3.inmet.gov.br',
  'aviationweather.gov',
  'www.cpc.ncep.noaa.gov',
  'iri.columbia.edu',
  'previous-runs-api.open-meteo.com',
]);

const USER_AGENT = 'painel-meteo-pessoal/1.0 (uso pessoal, nao comercial)';

// Estações usadas para medir o acerto (coordenadas públicas de estações, não do usuário).
export const GEOCODE_PADRAO = '4303905'; // Campo Bom (IBGE)
export const ESTACOES_VERIFICACAO = [
  { id: 'A884', tipo: 'inmet', nome: 'Campo Bom (INMET)', lat: -29.674, lon: -51.064, geocode: '4303905' },
  { id: 'A801', tipo: 'inmet', nome: 'Porto Alegre Jardim Botânico (INMET)', lat: -30.054, lon: -51.175, geocode: '4314902' },
  { id: 'SBCO', tipo: 'metar', nome: 'Canoas (METAR)', lat: -29.945, lon: -51.144 },
  { id: 'SBPA', tipo: 'metar', nome: 'Porto Alegre aeroporto (METAR)', lat: -29.994, lon: -51.171 },
];
const MODELOS = ['ecmwf_ifs', 'ecmwf_aifs025_single', 'ukmo_global_deterministic_10km'];

// ---------------------------------------------------------------- utilidades

const json = (dados, status = 200, extra = {}) => new Response(JSON.stringify(dados), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': status === 200 ? 'public, max-age=120' : 'no-store',
    ...extra,
  },
});

export class ErroParam extends Error {}

export function lerCoord(v, min, max) {
  if (typeof v !== 'string' || !/^-?\d{1,3}(\.\d{1,6})?$/.test(v)) throw new ErroParam('coordenada inválida');
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ErroParam('coordenada fora do intervalo');
  return Math.round(n * 100) / 100;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || [9999, -9999, 99999, -99999, 999.9].includes(n)) return null;
  return n;
};
const faixa = (v, a, b) => (v !== null && v >= a && v <= b ? v : null);
const texto = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export async function buscarExterno(url, { timeoutMs = 8000, maxBytes = 3_000_000, tipo = 'json', cacheSeg = 0, headers = {} } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !DESTINOS.has(u.hostname)) throw new Error('destino não permitido');
  const cache = globalThis.caches?.default;
  // A chave de cache nunca usa a URL com token: o chamador passa a URL pública em headers['x-chave'].
  const chave = headers['x-chave'] ? new Request('https://cache.local/' + encodeURIComponent(headers['x-chave'])) : new Request(url);
  if (cacheSeg && cache) {
    const hit = await cache.match(chave);
    if (hit) return tipo === 'json' ? hit.json() : hit.text();
  }
  const h = { 'user-agent': USER_AGENT, accept: tipo === 'json' ? 'application/json' : 'text/plain, text/html, application/xml' };
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', cf: { cacheTtl: cacheSeg || 0 } });
  if (r.status >= 300 && r.status < 400) throw new Error('redirecionamento recusado');
  if (!r.ok) throw new Error(`fonte respondeu ${r.status}`);
  const corpo = await lerLimitado(r, maxBytes);
  if (cacheSeg && cache) {
    await cache.put(chave, new Response(corpo, { headers: { 'cache-control': `max-age=${cacheSeg}` } }));
  }
  if (tipo === 'json') {
    try { return JSON.parse(corpo); } catch { throw new Error('formato inesperado'); }
  }
  return corpo;
}

async function lerLimitado(r, maxBytes) {
  const len = Number(r.headers.get('content-length'));
  if (len && len > maxBytes) throw new Error('resposta grande demais');
  if (!r.body) return '';
  const leitor = r.body.getReader();
  const partes = []; let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { leitor.cancel(); throw new Error('resposta grande demais'); }
    partes.push(value);
  }
  const buf = new Uint8Array(total); let o = 0;
  for (const p of partes) { buf.set(p, o); o += p.byteLength; }
  // INMET e CPC às vezes usam latin1; tenta utf-8 e cai para latin1 se houver caracteres inválidos.
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return utf.includes('�') ? new TextDecoder('latin1').decode(buf) : utf;
}

// ------------------------------------------------- limite por cliente (memória)

const janelas = new Map();
let salDia = null, salData = '';
async function idCliente(req) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (salData !== hoje) { salDia = crypto.getRandomValues(new Uint8Array(16)).join('.'); salData = hoje; janelas.clear(); }
  const ip = req.headers.get('cf-connecting-ip') || 'sem-ip';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salDia + ip));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function limiteExcedido(req, limitePorMin) {
  const id = await idCliente(req);
  const agora = Date.now();
  const j = janelas.get(id) || { ini: agora, n: 0 };
  if (agora - j.ini > 60000) { j.ini = agora; j.n = 0; }
  j.n++;
  janelas.set(id, j);
  if (janelas.size > 5000) janelas.clear();
  return j.n > limitePorMin;
}

// ------------------------------------------------------------- XML seguro
// Não usa parser com DTD: recusa qualquer DOCTYPE/ENTITY e extrai só campos simples.

export function xmlSeguro(xml) {
  if (typeof xml !== 'string') throw new Error('xml inválido');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[[\s\S]*<!ENTITY/i.test(xml)) throw new Error('xml com DTD recusado');
  return xml;
}
const ENTIDADES = { nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', atilde: 'ã', otilde: 'õ', ccedil: 'ç', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', uarr: '↑', minus: '−', plusmn: '±' };
export function textoPuro(s, max = 2000) {
  return texto(String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&([a-zA-Z]{2,8});/g, (m, n) => (n === 'amp' ? m : ENTIDADES[n] ?? ' '))
    .replace(/&#(\d{1,5});/g, (_, n) => { const c = Number(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '; })
    .replace(/&#x([0-9a-f]{1,4});/gi, (_, n) => { const c = parseInt(n, 16); return c > 31 ? String.fromCharCode(c) : ' '; })
    .replace(/&amp;/g, '&')
    .replace(/[<>]/g, ' ')
    .replace(/[ \t]+/g, ' '), max);
}
export function itensRss(xml) {
  xmlSeguro(xml);
  const itens = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const campo = (n) => (m[1].match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i')) || [])[1] || '';
    const link = textoPuro(campo('link'));
    itens.push({ titulo: textoPuro(campo('title')).slice(0, 200), descricao: textoPuro(campo('description')).slice(0, 1500),
      link: /^https:\/\/[a-z0-9.-]*inmet\.gov\.br\//i.test(link) ? link : null });
    if (itens.length >= 80) break;
  }
  return itens;
}

// ------------------------------------------------------------- observações

export function normalizarMetar(lista) {
  if (!Array.isArray(lista)) return [];
  const kt = 1.852;
  const porEstacao = new Map();
  for (const o of lista.slice(0, 2000)) {
    const id = texto(o.icaoId, 8).replace(/[^A-Z0-9]/g, '');
    const lat = num(o.lat), lon = num(o.lon);
    const ms = num(o.obsTime) ? num(o.obsTime) * 1000 : Date.parse(o.reportTime || '');
    if (!id || lat === null || lon === null || !Number.isFinite(ms)) continue;
    const temp = faixa(num(o.temp), -30, 50), dew = faixa(num(o.dewp), -40, 40);
    const wdir = o.wdir === 'VRB' ? null : faixa(num(o.wdir), 0, 360);
    const wspd = faixa(num(o.wspd), 0, 200), wgst = faixa(num(o.wgst), 0, 250);
    const slp = faixa(num(o.slp), 870, 1085) ?? faixa(num(o.altim), 870, 1085);
    const leitura = {
      ms, temperatura: temp, orvalho: dew,
      umidade: temp !== null && dew !== null ? Math.round(100 * Math.exp((17.625 * dew) / (243.04 + dew)) / Math.exp((17.625 * temp) / (243.04 + temp))) : null,
      vento: wspd !== null ? Math.round(wspd * kt) : null,
      rajada: wgst !== null ? Math.round(wgst * kt) : null,
      direcao: wdir, pressao: slp,
    };
    if (!porEstacao.has(id)) porEstacao.set(id, { id, tipo: 'metar', nome: texto(o.name, 80) || id, lat, lon, serie: [] });
    porEstacao.get(id).serie.push(leitura);
  }
  return [...porEstacao.values()].map((e) => {
    e.serie.sort((a, b) => a.ms - b.ms);
    // METAR: rajada só aparece quando há rajada; ausência não é zero.
    return e;
  });
}

// INMET: campos conforme API apitempo (não verificado nesta nuvem). Vento em m/s.
export function normalizarInmet(est, linhas) {
  if (!Array.isArray(linhas)) return null;
  const ms2kmh = 3.6;
  const serie = [];
  for (const l of linhas.slice(0, 400)) {
    const d = texto(l.DT_MEDICAO, 10), h = texto(String(l.HR_MEDICAO ?? ''), 4).padStart(4, '0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}$/.test(h)) continue;
    const ms = Date.parse(`${d}T${h.slice(0, 2)}:${h.slice(2)}:00Z`); // INMET publica em UTC
    const temp = faixa(num(l.TEM_INS), -30, 50);
    const pEst = faixa(num(l.PRE_INS), 700, 1085);
    const alt = num(est.alt) ?? 0;
    serie.push({
      ms, temperatura: temp, umidade: faixa(num(l.UMD_INS), 0, 100), orvalho: faixa(num(l.PTO_INS), -40, 40),
      pressaoEstacao: pEst,
      pressao: pEst !== null && temp !== null ? Math.round(10 * pEst * Math.pow(1 - (0.0065 * alt) / (temp + 0.0065 * alt + 273.15), -5.257)) / 10 : null,
      vento: faixa(num(l.VEN_VEL), 0, 100) !== null ? Math.round(num(l.VEN_VEL) * ms2kmh) : null,
      rajada: faixa(num(l.VEN_RAJ), 0, 120) !== null ? Math.round(num(l.VEN_RAJ) * ms2kmh) : null,
      direcao: faixa(num(l.VEN_DIR), 0, 360), chuva: faixa(num(l.CHUVA), 0, 200),
      sensacao: faixa(num(l.TEM_SEN), -45, 60),
    });
  }
  serie.sort((a, b) => a.ms - b.ms);
  return { id: est.id, tipo: 'inmet', nome: est.nome, lat: est.lat, lon: est.lon, alt: est.alt, serie };
}

export function acumulados(serie, agoraMs) {
  const somaAte = (h) => {
    const ini = agoraMs - h * 3600000;
    const pts = serie.filter((p) => p.ms > ini && p.ms <= agoraMs);
    const esperado = h; // INMET é horário
    const validos = pts.filter((p) => p.chuva !== null);
    if (validos.length < esperado * 0.9) return { valor: null, horas: validos.length, esperado };
    return { valor: Math.round(validos.reduce((s, p) => s + p.chuva, 0) * 10) / 10, horas: validos.length, esperado };
  };
  return { h1: somaAte(1), h24: somaAte(24), h72: somaAte(72), d7: somaAte(168) };
}

function distKm(a, b, c, d) {
  const r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

async function estacoesInmet(env) {
  const kv = env.KV;
  if (kv) {
    const c = await kv.get('inmet:estacoes', 'json');
    if (c && Date.now() - c.em < 7 * 86400000) return c.lista;
  }
  // Lista pública, sem token (conferida em 2026-11-03: 669 estações).
  const bruto = await buscarExterno('https://apitempo.inmet.gov.br/estacoes/T', { timeoutMs: 12000, maxBytes: 3_000_000, cacheSeg: 86400 });
  const lista = (Array.isArray(bruto) ? bruto : []).map((e) => ({
    id: texto(e.CD_ESTACAO, 8).replace(/[^A-Z0-9]/gi, ''), nome: texto(e.DC_NOME, 80),
    uf: texto(e.SG_ESTADO, 2), lat: num(e.VL_LATITUDE), lon: num(e.VL_LONGITUDE), alt: num(e.VL_ALTITUDE),
    situacao: texto(e.CD_SITUACAO, 20),
    // CD_WSI termina com o código IBGE do município: 0-76-0-4303905000000494 -> 4303905
    geocode: (String(e.CD_WSI || '').match(/^0-76-0-(\d{7})/) || [])[1] || null,
  })).filter((e) => e.id && e.lat !== null && e.lon !== null && e.situacao === 'Operante');
  if (lista.length < 50) throw new Error('lista de estações inesperada');
  if (kv) await kv.put('inmet:estacoes', JSON.stringify({ em: Date.now(), lista }));
  return lista;
}

async function dadosInmet(env, est, dias) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000);
  const d = (x) => x.toISOString().slice(0, 10);
  const publica = `inmet:${est.id}:${d(ini)}:${d(fim)}:${Math.floor(Date.now() / 600000)}`;
  const url = `https://apitempo.inmet.gov.br/token/estacao/${d(ini)}/${d(fim)}/${est.id}/${encodeURIComponent(env.INMET_TOKEN)}`;
  const linhas = await buscarExterno(url, { timeoutMs: 10000, maxBytes: 1_500_000, cacheSeg: 600, headers: { 'x-chave': publica } });
  return normalizarInmet(est, linhas);
}

// Última leitura sem token: apiprevmet3 /estacao/proxima/{geocode} (conferido em 2026-11-03).
export async function ultimaInmet(geocode) {
  if (!/^\d{7}$/.test(String(geocode))) throw new Error('geocode inválido');
  const r = await buscarExterno(`https://apiprevmet3.inmet.gov.br/estacao/proxima/${geocode}`, { timeoutMs: 8000, maxBytes: 200_000, cacheSeg: 600 });
  const e = r?.estacao, dd = r?.dados;
  if (!e || !dd) throw new Error('resposta INMET inesperada');
  const est = { id: texto(e.CODIGO, 8).replace(/[^A-Z0-9]/gi, ''), nome: texto(e.NOME, 80), lat: num(e.LATITUDE), lon: num(e.LONGITUDE), alt: null };
  if (!est.id || est.lat === null || est.lon === null) throw new Error('estação INMET sem coordenadas');
  return { est, linha: dd };
}

async function serieKv(env, id) {
  if (!env.KV) return [];
  return (await env.KV.get(`serie:${id}`, 'json')) || [];
}

// Executado a cada hora: guarda a última leitura das estações de verificação.
// Assim temos chuva de 24 h, 72 h e 7 dias e a tendência da pressão mesmo sem token.
export async function registrarSeries(env) {
  if (!env.KV) return;
  const lista = await estacoesInmet(env).catch(() => []);
  for (const v of ESTACOES_VERIFICACAO.filter((x) => x.tipo === 'inmet')) {
    try {
      const meta = lista.find((e) => e.id === v.id);
      const { est, linha } = await ultimaInmet(meta?.geocode || v.geocode);
      if (est.id !== v.id) continue;
      const ponto = normalizarInmet({ ...est, alt: meta?.alt ?? null }, [linha])?.serie?.[0];
      if (!ponto) continue;
      const serie = (await serieKv(env, v.id)).filter((p) => p.ms !== ponto.ms && p.ms > Date.now() - 8 * 86400000);
      serie.push(ponto);
      serie.sort((a, b) => a.ms - b.ms);
      await env.KV.put(`serie:${v.id}`, JSON.stringify(serie));
    } catch { /* tenta de novo na próxima hora */ }
  }
}

async function rotaObservacoes(url, env) {
  const lat = lerCoord(url.searchParams.get('lat'), -60, 15);
  const lon = lerCoord(url.searchParams.get('lon'), -85, -30);
  const status = {};
  const fontes = [];
  // METAR por caixa de ±1,2° em volta da coordenada arredondada (lat_min,lon_min,lat_max,lon_max)
  try {
    const b = [lat - 1.2, lon - 1.2, lat + 1.2, lon + 1.2].map((x) => x.toFixed(2)).join(',');
    const bruto = await buscarExterno(`https://aviationweather.gov/api/data/metar?bbox=${b}&format=json&hours=25`, { timeoutMs: 8000, maxBytes: 1_500_000, cacheSeg: 600 });
    const est = normalizarMetar(bruto);
    fontes.push(...est);
    status.metar = { ok: true, estacoes: est.length };
  } catch { status.metar = { ok: false, erro: 'METAR indisponível' }; }
  // INMET: estações mais próximas da coordenada arredondada
  try {
    const lista = await estacoesInmet(env);
    const perto = lista.map((e) => ({ ...e, d: distKm(lat, lon, e.lat, e.lon) })).filter((e) => e.d <= 120)
      .sort((a, b) => a.d - b.d).slice(0, 4);
    const agora = Date.now();
    const res = await Promise.allSettled(perto.map(async (e) => {
      let serie = [];
      let modo;
      if (env.INMET_TOKEN) { serie = (await dadosInmet(env, e, 7))?.serie || []; modo = 'série completa (token)'; }
      else {
        const { est, linha } = await ultimaInmet(e.geocode);
        if (est.id !== e.id) return null; // a estação mais próxima do município é outra
        serie = [...(await serieKv(env, e.id)), ...(normalizarInmet(e, [linha])?.serie || [])];
        const vistos = new Set(); serie = serie.filter((p) => !vistos.has(p.ms) && vistos.add(p.ms)).sort((a, b) => a.ms - b.ms);
        modo = serie.length > 1 ? 'última leitura e histórico horário gravado pelo Worker' : 'só a última leitura (sem token)';
      }
      if (!serie.length) return null;
      const ultimo = serie[serie.length - 1].ms;
      return { id: e.id, tipo: 'inmet', nome: e.nome, lat: e.lat, lon: e.lon, alt: e.alt, modo,
        acumulados: acumulados(serie, ultimo), serie: serie.filter((p) => p.ms > agora - 26 * 3600000) };
    }));
    const ok = res.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
    fontes.push(...ok);
    status.inmet = ok.length ? { ok: true, estacoes: ok.length, token: Boolean(env.INMET_TOKEN) } : { ok: false, erro: 'INMET indisponível' };
    if (!env.INMET_TOKEN) status.inmet.aviso = 'sem token: séries completas aguardam configuração; usando última leitura';
  } catch { status.inmet = { ok: false, erro: 'INMET indisponível' }; }
  return json({ versao: VERSAO, geradoEm: Date.now(), fontes, status, cemaden: 'não usado: sem acesso público estável confirmado' });
}

// ------------------------------------------------------------- alertas INMET
// Formato conferido em 2026-11-03: { hoje: [...], futuro: [...] }, poligono é GeoJSON em texto
// (lon, lat), geocodes é CSV de códigos IBGE, inicio/fim no horário de Brasília,
// riscos/instrucoes são texto no formato "['...', '...']".

export function listaPython(v) {
  if (Array.isArray(v)) return v.map((x) => texto(String(x), 400)).filter(Boolean).slice(0, 8);
  const s = texto(String(v ?? ''), 4000);
  if (!s) return [];
  const corpo = s.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '');
  return corpo.split(/['"]\s*,\s*['"]/).map((x) => x.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean).map((x) => x.slice(0, 400)).slice(0, 8);
}

export function poligonosGeojson(v) {
  let g = v;
  if (typeof v === 'string') { if (v.length > 2_000_000) return null; try { g = JSON.parse(v); } catch { return null; } }
  if (!g || typeof g !== 'object') return null;
  const aneis = g.type === 'Polygon' ? [g.coordinates?.[0]] : g.type === 'MultiPolygon' ? (g.coordinates || []).map((p) => p?.[0]) : [];
  const out = [];
  for (const anel of aneis) {
    if (!Array.isArray(anel) || anel.length < 3) continue;
    // simplifica para no máximo 400 pontos por anel
    const passo = Math.max(1, Math.ceil(anel.length / 400));
    const pts = [];
    for (let i = 0; i < anel.length; i += passo) {
      const [lon, lat] = anel[i] || [];
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push([Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
    }
    if (pts.length >= 3) out.push(pts);
    if (out.length >= 20) break;
  }
  return out.length ? out : null;
}

export function normalizarAvisos(bruto, geocode) {
  const listas = Array.isArray(bruto) ? bruto : [...(bruto?.hoje || []), ...(bruto?.futuro || [])];
  const saida = [];
  for (const a of listas.slice(0, 300)) {
    if (!a || typeof a !== 'object') continue;
    const geocodes = String(a.geocodes ?? '');
    saida.push({
      id: texto(String(a.id ?? a.id_aviso ?? ''), 40),
      titulo: texto(a.descricao, 160),
      severidade: texto(a.severidade, 40),
      cor: /^#[0-9a-f]{6}$/i.test(String(a.aviso_cor)) ? String(a.aviso_cor) : null,
      inicio: texto(String(a.inicio ?? ''), 20),
      fim: texto(String(a.fim ?? ''), 20),
      estados: texto(String(a.estados ?? ''), 400),
      riscos: listaPython(a.riscos),
      instrucoes: listaPython(a.instrucoes),
      municipioPadrao: geocode ? geocodes.split(',').map((x) => x.trim()).includes(geocode) : undefined,
      poligonos: poligonosGeojson(a.poligono),
    });
  }
  return saida.filter((a) => a.titulo);
}

async function rotaAlertas(env) {
  try {
    const bruto = await buscarExterno('https://apiprevmet3.inmet.gov.br/avisos/ativos', { timeoutMs: 10000, maxBytes: 6_000_000, cacheSeg: 600 });
    return json({ geradoEm: Date.now(), fonte: 'INMET avisos ativos', avisos: normalizarAvisos(bruto, GEOCODE_PADRAO) });
  } catch {
    try {
      const xml = await buscarExterno('https://apiprevmet3.inmet.gov.br/avisos/rss', { tipo: 'texto', timeoutMs: 8000, maxBytes: 1_500_000, cacheSeg: 600 });
      const itens = itensRss(xml);
      return json({ geradoEm: Date.now(), fonte: 'INMET RSS (sem área geográfica)', semArea: true, avisos: itens.map((i) => ({ titulo: i.titulo, descricao: i.descricao, link: i.link, poligonos: null })) });
    } catch {
      return json({ geradoEm: Date.now(), indisponivel: true, avisos: [] }, 502);
    }
  }
}

// ------------------------------------------------------------- El Niño

export function parseOni(txt) {
  const out = [];
  for (const l of String(txt).split('\n')) {
    // ONI: SEAS YR TOTAL ANOM; RONI: SEAS YR ANOM (formatos conferidos em 2026-11-03)
    const m = l.trim().match(/^([DJFMASON]{3})\s+(\d{4})\s+(-?\d+\.\d+)(?:\s+(-?\d+\.\d+))?$/);
    if (m) {
      const anom = Number(m[4] ?? m[3]);
      if (anom > -5 && anom < 5) out.push({ seas: m[1], ano: Number(m[2]), anom });
    }
  }
  if (out.length < 24) throw new Error('ONI com estrutura inesperada');
  return out;
}

const MESES = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export function parseSemanal(txt) {
  const out = [];
  for (const l of String(txt).split('\n')) {
    const m = l.trim().match(/^(\d{2})([A-Z]{3})(\d{4})\s+(.+)$/);
    if (!m || !(m[2] in MESES)) continue;
    const nums = (m[4].match(/-?\d+\.\d+/g) || []).map(Number);
    let an = null;
    if (nums.length === 8) an = [nums[1], nums[3], nums[5], nums[7]]; // pares temperatura/anomalia: Niño1+2, 3, 3.4, 4
    else if (nums.length === 4) an = nums;                             // só anomalias
    if (!an || an[2] < -5 || an[2] > 5) continue;
    const ok = (v) => (v >= -6 && v <= 6 ? v : null);
    out.push({ ms: Date.UTC(Number(m[3]), MESES[m[2]], Number(m[1])), n12: ok(an[0]), n3: ok(an[1]), n34: an[2], n4: ok(an[3]) });
  }
  if (out.length < 20) throw new Error('índice semanal com estrutura inesperada');
  return out;
}

export function parseMensal(txt) { // sstoi.indices: YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM
  const out = [];
  for (const l of String(txt).split('\n')) {
    const p = l.trim().split(/\s+/);
    if (p.length !== 10 || !/^\d{4}$/.test(p[0])) continue;
    const anom = Number(p[9]), mes = Number(p[1]);
    if (!Number.isFinite(anom) || anom < -5 || anom > 5 || mes < 1 || mes > 12) continue;
    out.push({ ano: Number(p[0]), mes, anom });
  }
  if (out.length < 24) throw new Error('índice mensal com estrutura inesperada');
  return out;
}

export function parseDiscussao(html) {
  const t = textoPuro(String(html).slice(0, 400000), 400000).replace(/\s+/g, ' ');
  const status = (t.match(/ENSO Alert System Status:\s*([^.]{3,120}?)(?=\s{0,3}Synopsis|\.)/i) || [])[1];
  const sinopse = (t.match(/Synopsis:\s*([^]{10,400}?\.)(?:\s|$)/i) || [])[1];
  const emitido = (t.match(/(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})/) || [])[1];
  const proxima = (t.match(/next ENSO Diagnostics Discussion is scheduled for (\d{1,2} \w+ \d{4})/i) || [])[1];
  if (!status || !sinopse) throw new Error('discussão com estrutura inesperada');
  return { status: status.trim(), sinopse: sinopse.trim(), emitido: emitido || null, proxima: proxima || null };
}

// Tabelas de probabilidade por trimestre (DJF, JFM, ...): três porcentagens que somam ~100.
export function parseProbabilidades(html) {
  const t = textoPuro(String(html).slice(0, 600000), 600000).replace(/\s+/g, ' ');
  const linhas = [];
  // Tabela do CPC: "SON Sep Oct Nov 0 0 100" (La Niña, Neutro, El Niño), conferida em 2026-11-03.
  for (const m of t.matchAll(/\b(DJF|JFM|FMA|MAM|AMJ|MJJ|JJA|JAS|ASO|SON|OND|NDJ)\b(?:\s+[A-Z][a-z]{2}){0,3}\s*(\d{4})?\s+(\d{1,3})\s*%?\s+(\d{1,3})\s*%?\s+(\d{1,3})\s*%?/g)) {
    const [ln, neu, en] = [Number(m[3]), Number(m[4]), Number(m[5])];
    if (Math.abs(ln + neu + en - 100) <= 2) linhas.push({ tri: m[1], laNina: ln, neutro: neu, elNino: en });
    if (linhas.length >= 9) break;
  }
  if (linhas.length < 4) throw new Error('tabela de probabilidades não encontrada');
  return linhas;
}

// Força por trimestre (página "ENSO Strength Probabilities" do CPC), conferida em 2026-11-04.
// 9 colunas: La Niña muito forte, forte, moderada, fraca; neutro; El Niño fraco, moderado, forte, muito forte.
export function parseForcas(html) {
  const t = textoPuro(String(html).slice(0, 600000), 600000).replace(/\s+/g, ' ');
  const ini = t.indexOf('Strength Probabilities Season');
  const parte = ini >= 0 ? t.slice(ini) : t;
  const linhas = [];
  for (const m of parte.matchAll(/\b(DJF|JFM|FMA|MAM|AMJ|MJJ|JJA|JAS|ASO|SON|OND|NDJ)\b(?:\s+[A-Z][a-z]{2}){0,3}((?:\s+\d{1,3}){9})\b/g)) {
    const v = m[2].trim().split(/\s+/).map(Number);
    if (Math.abs(v.reduce((s, x) => s + x, 0) - 100) > 3) continue;
    linhas.push({ tri: m[1], laNina: { muitoForte: v[0], forte: v[1], moderada: v[2], fraca: v[3] }, neutro: v[4], elNino: { fraco: v[5], moderado: v[6], forte: v[7], muitoForte: v[8] } });
    if (linhas.length >= 9) break;
  }
  if (linhas.length < 4) throw new Error('tabela de força não encontrada');
  return linhas;
}

// IRI: os números por modelo só existem em imagens; extraímos data e o resumo de força em texto.
export function parseIri(html) {
  const t = textoPuro(String(html).slice(0, 600000), 600000).replace(/\s+/g, ' ');
  const publicado = (t.match(/Technical ENSO Update[^]{0,120}?Published:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/) || t.match(/Published:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1];
  let forca = (t.match(/ENSO Strength\s+([^]{80,1400})/) || [])[1] || null;
  if (forca) forca = forca.split(/(?<=[.:])\s(?=[A-Z])/).slice(0, 4).join(' ').slice(0, 1000);
  if (!publicado) throw new Error('página do IRI com estrutura inesperada');
  return { publicado, forca };
}

async function tentar(fn) { try { return { ok: true, dados: await fn() }; } catch (e) { return { ok: false, erro: String(e.message || 'falha').slice(0, 120) }; } }

export async function atualizarEnso(env) {
  const base = 'https://www.cpc.ncep.noaa.gov';
  const iri = 'https://iri.columbia.edu/our-expertise/climate/forecasts/enso/current/';
  const t = (u, o) => buscarExterno(u, { tipo: 'texto', timeoutMs: 12000, maxBytes: 2_500_000, ...o });
  const partes = {
    relativoSemanal: await tentar(async () => parseSemanal(await t(`${base}/data/indices/rel_wksst9120.txt`)).slice(-260)),
    convencionalSemanal: await tentar(async () => parseSemanal(await t(`${base}/data/indices/wksst9120.for`)).slice(-260)),
    convencionalMensal: await tentar(async () => parseMensal(await t(`${base}/data/indices/sstoi.indices`))),
    oni: await tentar(async () => parseOni(await t(`${base}/data/indices/oni.ascii.txt`))),
    roni: await tentar(async () => parseOni(await t(`${base}/data/indices/RONI.ascii.txt`))),
    discussao: await tentar(async () => parseDiscussao(await t(`${base}/products/analysis_monitoring/enso_advisory/ensodisc.shtml`))),
    probCpc: await tentar(async () => parseProbabilidades(await t(`${base}/products/analysis_monitoring/enso/roni/probabilities/`))),
    forcaCpc: await tentar(async () => parseForcas(await t(`${base}/products/analysis_monitoring/enso/roni/strengths/`))),
    iri: await tentar(async () => parseIri(await t(iri))),
  };
  const anterior = env.KV ? await env.KV.get('enso:ultimo', 'json') : null;
  const final = { verificadoEm: Date.now(), partes: {} };
  for (const [k, v] of Object.entries(partes)) {
    if (v.ok) final.partes[k] = { ok: true, dados: v.dados, em: Date.now() };
    else if (anterior?.partes?.[k]?.dados) final.partes[k] = { ...anterior.partes[k], ok: false, desatualizado: true, erro: v.erro };
    else final.partes[k] = { ok: false, erro: v.erro };
  }
  if (env.KV) await env.KV.put('enso:ultimo', JSON.stringify(final));
  return final;
}

async function rotaEnso(env) {
  let d = env.KV ? await env.KV.get('enso:ultimo', 'json') : null;
  if (!d || Date.now() - d.verificadoEm > 7 * 3600000) d = await atualizarEnso(env);
  return json({ ...d, fontes: {
    cpc: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml',
    cpcProb: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/probabilities/',
    iri: 'https://iri.columbia.edu/our-expertise/climate/forecasts/enso/current/',
    inmet: 'https://portal.inmet.gov.br/',
  } });
}

// ------------------------------------------------------------- acerto (Previous Runs)

function diaLocal(ms, offH = -3) { return new Date(ms + offH * 3600000).toISOString().slice(0, 10); }

export function obsDoDia(serie, data) {
  const pts = serie.filter((p) => diaLocal(p.ms) === data);
  if (pts.length < 12) return null;
  const vals = (k) => pts.map((p) => p[k]).filter((x) => x !== null && x !== undefined);
  const t = vals('temperatura');
  const raj = vals('rajada'), vento = vals('vento');
  const chuva = vals('chuva');
  return {
    tmax: t.length >= 12 ? Math.max(...t) : null,
    tmin: t.length >= 12 ? Math.min(...t) : null,
    rajada: raj.length ? Math.max(...raj) : (vento.length >= 12 ? Math.max(...vento) : null),
    chuva: chuva.length >= 22 ? Math.round(chuva.reduce((s, x) => s + x, 0) * 10) / 10 : null,
  };
}

export function prevDoDia(j, data) {
  const off = Number(j.utc_offset_seconds) || 0;
  const horas = (j.hourly?.time || []).map(String);
  const idx = horas.map((h, i) => (h.startsWith(data) ? i : -1)).filter((i) => i >= 0);
  const out = {};
  for (const m of MODELOS) {
    out[m] = {};
    for (let d = 1; d <= 5; d++) {
      const s = (v) => j.hourly?.[`${v}_previous_day${d}_${m}`];
      const vals = (v) => idx.map((i) => s(v)?.[i]).filter((x) => typeof x === 'number');
      const p = vals('precipitation'), t = vals('temperature_2m'), g = vals('wind_gusts_10m');
      out[m][d] = {
        chuva: p.length >= 20 ? Math.round(p.reduce((a, b) => a + b, 0) * 10) / 10 : null,
        tmax: t.length >= 20 ? Math.max(...t) : null, tmin: t.length >= 20 ? Math.min(...t) : null,
        rajada: g.length >= 20 ? Math.max(...g) : null,
      };
    }
  }
  void off;
  return out;
}

export async function registrarAcerto(env) {
  if (!env.KV) return;
  const ontem = diaLocal(Date.now() - 86400000);
  for (const est of ESTACOES_VERIFICACAO) {
    try {
      let serie;
      if (est.tipo === 'metar') {
        const bruto = await buscarExterno(`https://aviationweather.gov/api/data/metar?ids=${est.id}&format=json&hours=48`, { maxBytes: 600_000 });
        serie = normalizarMetar(bruto)[0]?.serie || [];
      } else {
        serie = env.INMET_TOKEN ? ((await dadosInmet(env, est, 2))?.serie || []) : await serieKv(env, est.id);
      }
      const obs = obsDoDia(serie, ontem);
      if (!obs) continue;
      const vars = ['precipitation', 'temperature_2m', 'wind_gusts_10m'].flatMap((v) => [1, 2, 3, 4, 5].map((d) => `${v}_previous_day${d}`));
      const p = new URLSearchParams({ latitude: est.lat.toFixed(2), longitude: est.lon.toFixed(2), hourly: vars.join(','),
        models: MODELOS.join(','), timezone: 'America/Sao_Paulo', past_days: '2', forecast_days: '1', wind_speed_unit: 'kmh' });
      const prev = prevDoDia(await buscarExterno(`https://previous-runs-api.open-meteo.com/v1/forecast?${p}`, { timeoutMs: 15000, maxBytes: 3_000_000 }), ontem);
      const chave = `acerto:${est.id}`;
      const hist = (await env.KV.get(chave, 'json')) || [];
      const novo = hist.filter((r) => r.data !== ontem);
      novo.push({ data: ontem, obs, prev });
      await env.KV.put(chave, JSON.stringify(novo.slice(-120)));
    } catch { /* uma estação com falha não impede as outras */ }
  }
}

export function resumirAcerto(hist) {
  const res = {};
  for (const m of MODELOS) {
    res[m] = {};
    for (let d = 1; d <= 5; d++) {
      let n = 0, acertos = 0, nChuva = 0, eChuva = 0, nRaj = 0, eRaj = 0, nT = 0, eT = 0;
      for (const r of hist) {
        const p = r.prev?.[m]?.[d]; if (!p) continue;
        if (r.obs.chuva !== null && p.chuva !== null) {
          n++; nChuva++; eChuva += Math.abs(p.chuva - r.obs.chuva);
          if ((p.chuva >= 1) === (r.obs.chuva >= 1)) acertos++;
        }
        if (r.obs.rajada !== null && p.rajada !== null) { nRaj++; eRaj += Math.abs(p.rajada - r.obs.rajada); }
        if (r.obs.tmax !== null && p.tmax !== null) { nT++; eT += Math.abs(p.tmax - r.obs.tmax); }
      }
      res[m][d] = {
        amostrasChuva: nChuva, taxaChuva: n ? acertos / n : null, maeChuva: nChuva ? eChuva / nChuva : null,
        amostrasRajada: nRaj, maeRajada: nRaj ? eRaj / nRaj : null, amostrasTmax: nT, maeTmax: nT ? eT / nT : null,
      };
    }
  }
  return res;
}

async function rotaAcerto(url, env) {
  const id = String(url.searchParams.get('estacao') || '');
  const est = ESTACOES_VERIFICACAO.find((e) => e.id === id);
  if (!est) throw new ErroParam('estação de verificação desconhecida');
  const hist = env.KV ? ((await env.KV.get(`acerto:${id}`, 'json')) || []) : [];
  return json({
    estacao: { id: est.id, nome: est.nome, tipo: est.tipo, lat: est.lat, lon: est.lon },
    dias: hist.length, periodo: hist.length ? { ini: hist[0].data, fim: hist[hist.length - 1].data } : null,
    porModelo: resumirAcerto(hist),
    observacao: est.tipo === 'metar' ? 'METAR não informa chuva acumulada: acerto de chuva só com estação INMET.' : null,
  });
}

// ------------------------------------------------------------- roteador

function cors(req, env) {
  const origem = req.headers.get('origin');
  const permitidas = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origem && permitidas.includes(origem)) {
    return { 'access-control-allow-origin': origem, 'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' };
  }
  return { vary: 'Origin' };
}

export default {
  async fetch(req, env) {
    const c = cors(req, env);
    const com = (r) => { for (const [k, v] of Object.entries(c)) r.headers.set(k, v); return r; };
    try {
      if (req.method === 'OPTIONS') return com(new Response(null, { status: 204 }));
      if (req.method !== 'GET') return com(json({ erro: 'método não permitido' }, 405, { allow: 'GET, OPTIONS' }));
      const url = new URL(req.url);
      if (url.search.length > 200) return com(json({ erro: 'parâmetros longos demais' }, 414));
      if (await limiteExcedido(req, Number(env.LIMITE_POR_MINUTO || 30))) return com(json({ erro: 'muitas requisições, tente em 1 minuto' }, 429, { 'retry-after': '60' }));
      const permitidos = { '/v1/observacoes': ['lat', 'lon'], '/v1/alertas': [], '/v1/enso': [], '/v1/acerto': ['estacao'], '/v1/saude': [] };
      const lista = permitidos[url.pathname];
      if (!lista) return com(json({ erro: 'rota não encontrada' }, 404));
      const chaves = [...url.searchParams.keys()];
      if (new Set(chaves).size !== chaves.length) return com(json({ erro: 'parâmetro repetido' }, 400));
      for (const k of chaves) if (!lista.includes(k)) return com(json({ erro: 'parâmetro não aceito' }, 400));
      switch (url.pathname) {
        case '/v1/observacoes': return com(await rotaObservacoes(url, env));
        case '/v1/alertas': return com(await rotaAlertas(env));
        case '/v1/enso': return com(await rotaEnso(env));
        case '/v1/acerto': return com(await rotaAcerto(url, env));
        case '/v1/saude': return com(json({ ok: true, versao: VERSAO, inmetConfigurado: Boolean(env.INMET_TOKEN), kv: Boolean(env.KV) }));
      }
      return com(json({ erro: 'rota não encontrada' }, 404));
    } catch (e) {
      if (e instanceof ErroParam) return com(json({ erro: e.message }, 400));
      return com(json({ erro: 'falha interna' }, 500)); // sem detalhes: nunca expõe URL com token
    }
  },
  async scheduled(evento, env, ctx) {
    // "5 * * * *" -> séries horárias; "0 */6 * * *" -> El Niño; "15 9 * * *" -> acerto diário
    if (evento.cron === '15 9 * * *') ctx.waitUntil(registrarAcerto(env));
    else if (evento.cron === '0 */6 * * *') ctx.waitUntil(atualizarEnso(env));
    else ctx.waitUntil(registrarSeries(env));
  },
};
