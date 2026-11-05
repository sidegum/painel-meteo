// Testes do Worker com respostas reais gravadas em test/fixtures (2026-11-03).
// Rodar: node --test worker/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import w, {
  parseOni, parseSemanal, parseMensal, parseDiscussao, parseProbabilidades, parseIri, normalizarMetar, coberturaMetar,
  normalizarAvisos, listaPython, itensRss, xmlSeguro, textoPuro, buscarExterno, lerCoord, normalizarInmet, acumulados, resumirAcerto, prevDoDia, obsDoDia, calibracao, probDiariaCenarios,
} from '../src/index.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const TOKEN = 'TOKEN-SECRETO-DE-TESTE-123';

// fetch falso: serve as fixtures reais pela URL e registra o que foi chamado
const chamadas = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  chamadas.push(u);
  const resp = (corpo, tipo = 'application/json') => new Response(corpo, { status: 200, headers: { 'content-type': tipo } });
  if (u.includes('aviationweather.gov')) return resp(fx('metar.json'));
  if (u.includes('/estacoes/T')) return resp(fx('inmet-estacoes.json'));
  if (u.includes('/estacao/proxima/4303905')) return resp(fx('inmet-proxima-4303905.json'));
  if (u.includes('/estacao/proxima/')) return new Response('', { status: 204 });
  if (u.includes('/avisos/ativos')) return resp(fx('inmet-avisos.json'));
  if (u.includes('/token/estacao/')) return new Response(`erro interno com ${TOKEN}`, { status: 500 });
  if (u.includes('rel_wksst9120')) return resp(fx('rel_wksst9120.txt'), 'text/plain');
  if (u.includes('wksst9120.for')) return resp(fx('wksst9120.for'), 'text/plain');
  if (u.includes('oni.ascii')) return resp(fx('oni.ascii.txt'), 'text/plain');
  if (u.includes('RONI.ascii')) return resp(fx('RONI.ascii.txt'), 'text/plain');
  if (u.includes('sstoi.indices')) return resp(fx('sstoi.indices'), 'text/plain');
  if (u.includes('ensodisc')) return resp(fx('ensodisc.html'), 'text/html');
  if (u.includes('roni/probabilities')) return resp(fx('cpc-probabilidades.html'), 'text/html');
  if (u.includes('iri.columbia.edu')) return resp(fx('iri.html'), 'text/html');
  return new Response('não esperado', { status: 599 });
};

const env = { ALLOWED_ORIGIN: 'https://sidegum.github.io', LIMITE_POR_MINUTO: '30' };
let ipSeq = 0;
const req = (path, { method = 'GET', origin = 'https://sidegum.github.io', ip } = {}) =>
  new Request('https://painel.exemplo.workers.dev' + path, { method, headers: { origin, 'cf-connecting-ip': ip || `10.0.0.${++ipSeq % 250}` } });

// ---------------- parsers com dados reais

test('ONI e RONI (3 e 4 colunas)', () => {
  const oni = parseOni(fx('oni.ascii.txt'));
  assert.deepEqual(oni.at(-1), { seas: 'ASO', ano: 2026, anom: 2.46 });
  const roni = parseOni(fx('RONI.ascii.txt'));
  assert.deepEqual(roni.at(-1), { seas: 'ASO', ano: 2026, anom: 1.97 });
});

test('Niño 3.4 semanal relativo e convencional (colunas grudadas)', () => {
  const rel = parseSemanal(fx('rel_wksst9120.txt'));
  assert.equal(rel.at(-1).n34, 2.5);
  const conv = parseSemanal(fx('wksst9120.for'));
  assert.equal(conv.at(-1).n34, 3.4);
  assert.equal(conv[0].n34, -0.2); // "26.5-0.2"
  assert.equal(new Date(conv.at(-1).ms).toISOString().slice(0, 10), '2026-10-28');
});

test('Niño 3.4 mensal', () => {
  const m = parseMensal(fx('sstoi.indices'));
  assert.deepEqual(m.at(-1), { ano: 2026, mes: 10, anom: 3.25 });
});

test('discussão da NOAA', () => {
  const d = parseDiscussao(fx('ensodisc.html'));
  assert.equal(d.status, 'El Niño Advisory');
  assert.match(d.sinopse, /^El Niño continues to strengthen/);
  assert.equal(d.emitido, '8 October 2026');
  assert.equal(d.proxima, '12 November 2026');
});

test('probabilidades oficiais do CPC', () => {
  const p = parseProbabilidades(fx('cpc-probabilidades.html'));
  assert.equal(p.length, 9);
  assert.deepEqual(p[0], { tri: 'SON', laNina: 0, neutro: 0, elNino: 100 });
  assert.deepEqual(p.at(-1), { tri: 'MJJ', laNina: 13, neutro: 70, elNino: 17 });
});

test('IRI: data e resumo', () => {
  const i = parseIri(fx('iri.html'));
  assert.equal(i.publicado, 'October 19, 2026');
  assert.ok(i.forca && i.forca.length > 50);
});

test('METAR: nós para km/h, estações da região', () => {
  const est = normalizarMetar(JSON.parse(fx('metar.json')));
  const ids = est.map((e) => e.id).sort();
  assert.deepEqual(ids, ['SBCO', 'SBCX', 'SBPA']);
  const pa = est.find((e) => e.id === 'SBPA');
  const ult = pa.serie.at(-1);
  assert.equal(ult.vento, Math.round(17 * 1.852));
  assert.equal(ult.rajada, null); // sem wgst: ausente, não zero
  assert.equal(ult.pressao, 1009);
  assert.equal(ult.nuvens, 25); // FEW
});

test('METAR: cobertura de nuvens pela camada mais coberta', () => {
  assert.equal(coberturaMetar({ clouds: [{ cover: 'FEW' }, { cover: 'BKN' }] }), 85);
  assert.equal(coberturaMetar({ clouds: [], cover: 'CAVOK' }), 0);
  assert.equal(coberturaMetar({ clouds: [{ cover: 'SCT', base: 4000 }], cover: 'SCT' }), 50);
  assert.equal(coberturaMetar({}), null);
});

test('INMET última leitura: m/s para km/h, UTC', () => {
  const j = JSON.parse(fx('inmet-proxima-4303905.json'));
  const s = normalizarInmet({ id: 'A884', nome: 'CAMPO BOM', lat: -29.674, lon: -51.064, alt: 23.35 }, [j.dados]).serie;
  assert.equal(s.length, 1);
  assert.equal(new Date(s[0].ms).toISOString(), '2026-11-03T19:00:00.000Z');
  assert.equal(s[0].temperatura, 29.2);
  assert.equal(s[0].vento, 5); // 1,4 m/s
  assert.equal(s[0].rajada, 29); // 8 m/s
  assert.ok(s[0].pressao > 1006 && s[0].pressao < 1010); // reduzida ao nível do mar
});

test('leituras inválidas e 9999 são descartadas', () => {
  const s = normalizarInmet({ id: 'X', alt: 0 }, [{ DT_MEDICAO: '2026-11-03', HR_MEDICAO: '1200', TEM_INS: '9999', UMD_INS: '-9999', CHUVA: null, VEN_VEL: '' }]).serie[0];
  assert.equal(s.temperatura, null); assert.equal(s.umidade, null); assert.equal(s.chuva, null); assert.equal(s.vento, null);
});

test('sem altitude da estação a pressão ao nível do mar fica nula (nunca a pressão da estação)', () => {
  const j = JSON.parse(fx('inmet-proxima-4303905.json'));
  const s = normalizarInmet({ id: 'A884', nome: 'CAMPO BOM', lat: -29.674, lon: -51.064, alt: null }, [j.dados]).serie[0];
  assert.ok(s.pressaoEstacao > 900);
  assert.equal(s.pressao, null);
});

test('acumulados exigem horas completas', () => {
  const agora = Date.UTC(2026, 10, 3, 12);
  const serie = Array.from({ length: 24 }, (_, k) => ({ ms: agora - k * 3600000, chuva: k === 5 ? null : 1 }));
  const a = acumulados(serie, agora);
  assert.equal(a.h1.valor, 1);
  assert.equal(a.h24.valor, 23);
  assert.equal(a.h72.valor, null); // faltam horas: não vira zero
});

test('avisos do INMET: polígono, município padrão, listas', () => {
  const av = normalizarAvisos(JSON.parse(fx('inmet-avisos.json')), '4303905');
  assert.ok(av.length >= 2);
  const campoBom = av.filter((a) => a.municipioPadrao);
  assert.ok(campoBom.length >= 1);
  assert.ok(Array.isArray(campoBom[0].poligonos) && campoBom[0].poligonos[0].length >= 3);
  assert.ok(campoBom[0].riscos.length >= 1 && !campoBom[0].riscos[0].startsWith('['));
  assert.ok(JSON.stringify(av).length < 400000);
  assert.deepEqual(listaPython("['um', 'dois']"), ['um', 'dois']);
});

test('XML com DTD/entidades externas é recusado; scripts viram texto', () => {
  assert.throws(() => xmlSeguro('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><rss>&e;</rss>'));
  assert.throws(() => itensRss('<!DOCTYPE rss><rss><item><title>a</title></item></rss>'));
  const itens = itensRss('<rss><item><title><![CDATA[<script>alert(1)</script>Aviso]]></title><description>&lt;img src=x onerror=alert(1)&gt; texto</description><link>javascript:alert(1)</link></item></rss>');
  assert.equal(itens[0].titulo, 'Aviso');
  assert.ok(!/[<>]/.test(itens[0].descricao));
  assert.equal(itens[0].link, null);
  assert.ok(!textoPuro('<script>x()</script>ok').includes('x()'));
});

// ---------------- segurança do roteador

test('só GET e OPTIONS', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await w.fetch(req('/v1/enso', { method: m }), env)).status, 405);
  assert.equal((await w.fetch(req('/v1/enso', { method: 'OPTIONS' }), env)).status, 204);
});

test('não funciona como proxy aberto', async () => {
  for (const p of ['/?url=https://evil.example', '/v1/observacoes?lat=-29.68&lon=-51.05&url=https://evil.example',
    '/https://evil.example/', '/v1/../../etc/passwd', '/v1/alertas?host=evil.example', '/v1/acerto?estacao=../../x']) {
    const r = await w.fetch(req(p), env);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  await assert.rejects(buscarExterno('https://evil.example/'), /não permitido/);
  await assert.rejects(buscarExterno('http://aviationweather.gov/api'), /não permitido/);
  await assert.rejects(buscarExterno('https://aviationweather.gov.evil.example/'), /não permitido/);
});

test('parâmetros inválidos', async () => {
  for (const q of ['lat=abc&lon=-51', 'lat=-29.68', 'lat=200&lon=-51', 'lat=-29.68&lon=10', 'lat=1e3&lon=-51', 'lat=-29.68&lon=-51.05&lat=1']) {
    const r = await w.fetch(req('/v1/observacoes?' + q), env);
    assert.ok([400].includes(r.status), `${q} -> ${r.status}`);
  }
  assert.equal(lerCoord('-29.6789', -60, 15), -29.68);
  const longo = await w.fetch(req('/v1/enso?' + 'a'.repeat(300)), env);
  assert.equal(longo.status, 414);
});

test('CORS restrito à origem do app', async () => {
  const ok = await w.fetch(req('/v1/saude'), env);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sidegum.github.io');
  const ruim = await w.fetch(req('/v1/saude', { origin: 'https://evil.example' }), env);
  assert.equal(ruim.headers.get('access-control-allow-origin'), null);
});

test('limite de requisições por cliente', async () => {
  let ultimo;
  for (let i = 0; i < 32; i++) ultimo = await w.fetch(req('/v1/saude', { ip: '203.0.113.9' }), env);
  assert.equal(ultimo.status, 429);
  const outro = await w.fetch(req('/v1/saude', { ip: '203.0.113.10' }), env);
  assert.equal(outro.status, 200);
});

test('observações sem token: METAR e INMET, coordenada arredondada', async () => {
  chamadas.length = 0;
  const r = await w.fetch(req('/v1/observacoes?lat=-29.678912&lon=-51.053321'), env);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.status.metar.ok);
  assert.ok(j.status.inmet.ok, JSON.stringify(j.status));
  assert.ok(j.fontes.some((f) => f.id === 'A884'));
  // nenhuma chamada externa leva a coordenada exata
  assert.ok(chamadas.every((u) => !u.includes('678912') && !u.includes('053321')));
  assert.ok(chamadas.some((u) => u.includes('bbox=-30.88,-52.25,-28.48,-49.85')));
});

test('com token: token nunca aparece na resposta, mesmo com erro', async () => {
  const r = await w.fetch(req('/v1/observacoes?lat=-29.68&lon=-51.05'), { ...env, INMET_TOKEN: TOKEN });
  const txt = await r.text();
  assert.ok(!txt.includes(TOKEN));
  const s = await w.fetch(req('/v1/saude'), { ...env, INMET_TOKEN: TOKEN });
  assert.ok(!(await s.text()).includes(TOKEN));
});

test('alertas pelo Worker', async () => {
  const r = await w.fetch(req('/v1/alertas'), env);
  const j = await r.json();
  assert.ok(j.avisos.some((a) => a.municipioPadrao));
});

test('El Niño completo a partir das fontes', async () => {
  const r = await w.fetch(req('/v1/enso'), env);
  const j = await r.json();
  for (const k of ['relativoSemanal', 'convencionalSemanal', 'convencionalMensal', 'oni', 'roni', 'discussao', 'probCpc', 'iri']) assert.ok(j.partes[k].ok, k + ' ' + j.partes[k].erro);
});

test('acerto: previsões antigas x observação', () => {
  const j = { utc_offset_seconds: -10800, hourly: { time: Array.from({ length: 24 }, (_, h) => `2026-11-02T${String(h).padStart(2, '0')}:00`) } };
  for (let d = 1; d <= 5; d++) {
    j.hourly[`precipitation_previous_day${d}_ukmo_global_deterministic_10km`] = Array(24).fill(0.5);
    j.hourly[`wind_gusts_10m_previous_day${d}_ecmwf_ifs`] = Array(24).fill(null); // ECMWF não guarda rajada anterior
    j.hourly[`temperature_2m_previous_day${d}_ukmo_global_deterministic_10km`] = Array(24).fill(20);
  }
  const prev = prevDoDia(j, '2026-11-02');
  assert.equal(prev.ukmo_global_deterministic_10km[1].chuva, 12);
  assert.equal(prev.ecmwf_ifs[1].rajada, null);
  const serie = Array.from({ length: 24 }, (_, h) => ({ ms: Date.UTC(2026, 10, 2, h + 3), temperatura: 18 + h / 4, chuva: 0.5, rajada: null, vento: 10 }));
  const obs = obsDoDia(serie, '2026-11-02');
  assert.equal(obs.chuva, 12);
  const res = resumirAcerto([{ data: '2026-11-02', obs, prev }]);
  assert.equal(res.ukmo_global_deterministic_10km[1].taxaChuva, 1);
  assert.equal(res.ecmwf_ifs[1].amostrasRajada, 0);
  // viés: previsão 20 °C contra máxima medida 23,75 e mínima 18 -> -3,75 e +2
  assert.equal(res.ukmo_global_deterministic_10km[1].viesTmax, -3.75);
  assert.equal(res.ukmo_global_deterministic_10km[1].viesTmin, 2);
});

test('aprendizado: chance diária dos cenários e calibração', () => {
  const time = [...Array(24)].map((_, h) => `2026-11-05T${String(h).padStart(2, '0')}:00`);
  const hourly = { time, precipitation: Array(24).fill(0.1) };
  for (let k = 1; k <= 9; k++) hourly[`precipitation_member${String(k).padStart(2, '0')}`] = Array(24).fill(k <= 3 ? 0.1 : 0);
  assert.ok(Math.abs(probDiariaCenarios({ hourly })['2026-11-05'] - 0.4) < 1e-9); // 4 de 10 com 2,4 mm
  const cal = calibracao(
    [{ data: '2026-11-05', prob: 0.35 }, { data: '2026-11-06', prob: 0.31 }, { data: '2026-11-09', prob: 0.9 }],
    [{ data: '2026-11-05', obs: { chuva: 4 } }, { data: '2026-11-06', obs: { chuva: 0 } }]);
  assert.equal(cal.pares, 2);
  assert.equal(cal.bins[3].n, 2);
  assert.equal(cal.bins[3].freq, 0.5);
});

test('força do El Niño por trimestre (tabela real do CPC)', async () => {
  const { parseForcas } = await import('../src/index.js');
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./fixtures/cpc-forcas.html', import.meta.url), 'utf8');
  const f = parseForcas(html);
  assert.equal(f.length, 9);
  assert.equal(f[0].tri, 'SON');
  assert.equal(f[3].tri, 'DJF');
  assert.deepEqual(f[3].elNino, { fraco: 0, moderado: 3, forte: 16, muitoForte: 81 });
  assert.equal(f[8].neutro, 70);
});
