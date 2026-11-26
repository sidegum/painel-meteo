// Teste de tela: abre o app num navegador sem rede externa, com as respostas reais gravadas em
// test/e2e/amostra.json.gz (scripts/gravar-amostra.mjs), percorre todas as abas no celular e no computador e
// falha se aparecer "null", "undefined" ou "NaN", erro no console ou rolagem horizontal.
// Uso: node test/e2e/telas.mjs [pasta-das-capturas]   (capturas opcionais, para conferência visual)
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

// Playwright pelo require: acha a instalação global (no CI, npx playwright) sem entrar no package.json.
const { chromium } = createRequire(import.meta.url)('playwright');

const RAIZ = new URL('../..', import.meta.url).pathname;
const amostra = JSON.parse(gunzipSync(readFileSync(new URL('amostra.json.gz', import.meta.url))));
const capturas = process.argv[2];
if (capturas) mkdirSync(capturas, { recursive: true });

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.gz': 'application/gzip' };
const servidor = createServer((req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let arq = join(RAIZ, caminho.endsWith('/') ? caminho + 'index.html' : caminho);
  if (!existsSync(arq)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TIPOS[extname(arq)] || 'application/octet-stream' });
  res.end(readFileSync(arq));
}).listen(0);
const base = `http://localhost:${servidor.address().port}/`;

// A previsão é gravada num instante; o relógio do navegador é posto nesse instante para as telas baterem.
const agora = Date.parse(amostra.gravadoEm);

/** Resposta gravada para a URL (mesma URL ou mesmo caminho com os mesmos parâmetros, em qualquer ordem). */
function gravada(url) {
  if (amostra.respostas[url]) return amostra.respostas[url];
  const u = new URL(url);
  const chave = (x) => x.origin + x.pathname + '?' + [...x.searchParams].sort().map((p) => p.join('=')).join('&');
  for (const [k, v] of Object.entries(amostra.respostas)) if (chave(new URL(k)) === chave(u)) return v;
  return null;
}

const ABAS = ['hoje', 'amanha', 'semana', 'avisos', 'modelos', 'elnino'];
const TELAS = [
  { nome: 'celular', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { nome: 'computador', viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
];

const problemas = [];
const navegador = await chromium.launch();
for (const tela of TELAS) {
  for (const tema of ['dark', 'light']) {
    if (tema === 'light' && !capturas) continue;
    const ctx = await navegador.newContext({ ...tela, colorScheme: tema, geolocation: { latitude: amostra.lat, longitude: amostra.lon, accuracy: 30 },
      permissions: ['geolocation'], bypassCSP: !!capturas, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await ctx.addInitScript(`{ const d = ${agora} - Date.now(); const N = Date.now; Date.now = () => N() + d;
      const D = Date; globalThis.Date = class extends D { constructor(...a) { a.length ? super(...a) : super(N() + d); } static now() { return N() + d; } }; }`);
    await ctx.route(/^https?:\/\/(?!localhost)/, (rota) => {
      const r = gravada(rota.request().url());
      return r ? rota.fulfill({ status: r.status, body: r.base64 ? Buffer.from(r.corpo, 'base64') : r.corpo, headers: { 'content-type': r.tipo || 'application/json', 'access-control-allow-origin': '*' } }) : rota.abort();
    });
    const pag = await ctx.newPage();
    pag.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problemas.push(`${tela.nome}: console: ${m.text()}`); });
    pag.on('pageerror', (e) => problemas.push(`${tela.nome}: erro: ${e.message}`));
    // conteúdo fora da tela com content-visibility não é pintado na captura de página inteira
    await pag.goto(base);
    if (capturas) await pag.addStyleTag({ content: '.secao, .detalhes > .secao, #semana-conteudo > .secao, #modelos-conteudo > .secao, #elnino-conteudo > .secao { content-visibility: visible !important; }' });
    await pag.waitForFunction(() => document.querySelector('#hoje-primeira')?.textContent.length > 40, null, { timeout: 30000 });
    await pag.waitForTimeout(2500);
    // Pré-carregamento: o mapa já está montado sem ninguém rolar até ele, e as abas escondidas têm a largura real.
    if (!await pag.evaluate(() => !!document.querySelector('.mapa .leaflet-pane'))) problemas.push(`${tela.nome}: o mapa não foi montado antes de aparecer na tela`);
    if (await pag.evaluate(() => document.querySelector('#aba-semana').clientWidth === 0)) problemas.push(`${tela.nome}: aba escondida sem largura (os gráficos seriam redesenhados ao abrir)`);
    for (const aba of ABAS) {
      await pag.evaluate((a) => window.__painel?.irPara?.(a) ?? document.querySelector(`[data-ir="${a}"]`)?.click(), aba);
      await pag.waitForTimeout(900);
      const texto = await pag.evaluate(() => document.querySelector('main').innerText);
      const ruim = texto.match(/\b(null|undefined|NaN)\b/g);
      if (ruim) problemas.push(`${tela.nome}/${aba}: aparece ${[...new Set(ruim)].join(', ')}`);
      const larg = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (larg > 1) problemas.push(`${tela.nome}/${aba}: rolagem horizontal de ${larg} px`);
      if (capturas) await pag.screenshot({ path: join(capturas, `${tela.nome}-${tema}-${aba}.png`), fullPage: true });
    }
    // Gráfico inicial de cada dia: Chuva a partir do limite de chance, senão Temperatura (mesma chance do resumo).
    // A escolha à mão vale só para o dia e o local em que foi feita.
    const modos = await pag.evaluate(async () => {
      const { graficoInicial } = await import('./js/analise.js');
      const ler = (id) => { const r = document.querySelector(id); const b = [...r.querySelectorAll('.troca-modo button')];
        const pct = r.querySelector('.bloco-t.chuva b').textContent; const i = b.findIndex((x) => x.getAttribute('aria-pressed') === 'true');
        return { i, esperado: pct === 'agora' ? 0 : ['chance', 'temp'].indexOf(graficoInicial(parseInt(pct, 10) / 100)), pct }; };
      const antes = ['#hoje-primeira', '#amanha-primeira'].map(ler);
      document.querySelectorAll('#amanha-primeira .troca-modo button')[2].click(); // Céu, à mão
      window.__painel.renderTudo();
      const mantida = ler('#amanha-primeira').i === 2 && ler('#hoje-primeira').i === antes[0].i;
      const est = window.__painel.estado, local = est.local;
      est.local = { ...local, lat: local.lat + 1, lon: local.lon + 1 }; window.__painel.renderTudo();
      const voltou = ler('#amanha-primeira').i === antes[1].i;
      est.local = local; est.modoGrafico = {}; window.__painel.renderTudo();
      return { antes, mantida, voltou };
    });
    for (const m of modos.antes) if (m.i !== m.esperado) problemas.push(`${tela.nome}: gráfico inicial errado para chuva ${m.pct}`);
    if (!modos.mantida) problemas.push(`${tela.nome}: a escolha manual do gráfico não se manteve ao atualizar (ou vazou para outro dia)`);
    if (!modos.voltou) problemas.push(`${tela.nome}: a escolha manual do gráfico não voltou ao padrão ao trocar de local`);
    // Cenário de tempestade: núcleo de 52 dBZ a 60 km a oeste vindo para leste a 50 km/h e outro de 58 dBZ ao sul.
    await pag.evaluate(async () => {
      const { celulasTempestade } = await import('./js/analise.js');
      const n = 256, km = 4.2, c = 128, dbz = new Int8Array(n * n).fill(-128);
      const pinta = (x0, y0, r, v) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) dbz[(y0 + y) * n + x0 + x] = Math.max(dbz[(y0 + y) * n + x0 + x], v - Math.round(Math.hypot(x, y) * 4)); };
      pinta(c - 15, c - 2, 7, 52); pinta(c - 4, c + 30, 5, 58); pinta(c + 25, c - 25, 9, 38);
      pinta(c - 25, c - 8, 4, 47); // não atinge o local, mas passa perto: "se aproximando"
      // 30 min antes: o núcleo que chega era mais fraco (ganhando força); os outros não existiam (formaram-se há pouco)
      const agora = dbz.slice(); dbz.fill(-128); pinta(c - 21, c - 2, 7, 45); const antes = dbz.slice(); dbz.set(agora);
      const vel = { lesteKmh: 50, sulKmh: 0 }, est = window.__painel.estado;
      const tempestades = celulasTempestade({ dbz, n, px: c, py: c, kmCelula: km, vel, anterior: { dbz: antes, min: 30 } });
      const ms = Date.now() - 6e5, chega = tempestades.find((t) => t.chegaMin !== null)?.chegaMin ?? null;
      est.chegada = { ms, minutos: chega, chegaMs: chega === null ? null : ms + chega * 60000, kmh: 50, vemDe: 'O', secoMin: chega,
        tempestades, movimento: { kmh: 50, paraGraus: 90 }, mapa: { dbz, n, px: c, py: c, kmCelula: km } };
      est.chegadaEm = Date.now();
      window.__painel.renderTudo();
      window.__painel.irPara('hoje');
    });
    await pag.waitForTimeout(1200);
    const textoTemp = await pag.evaluate(() => document.querySelector('main').innerText);
    if (/\b(null|undefined|NaN)\b/.test(textoTemp)) problemas.push(`${tela.nome}/tempestade: aparece null, undefined ou NaN`);
    // Com chuva chegando pelo radar, o gráfico de Hoje abre em Chuva mesmo com chance baixa no dia.
    if (!await pag.evaluate(() => document.querySelector('#hoje-primeira .troca-modo button').getAttribute('aria-pressed') === 'true')) problemas.push(`${tela.nome}/tempestade: o gráfico de Hoje não abriu em Chuva com chuva chegando`);
    // O radar de tempestade fica colado logo acima do mapa e diz o que cada núcleo faz em relação ao local.
    const radar = await pag.evaluate(() => { const r = document.querySelector('#hoje-detalhes .radar-t'); return r ? { antesDoMapa: !!r.nextElementSibling?.querySelector('.mapa'), texto: r.innerText } : null; });
    if (!radar) problemas.push(`${tela.nome}/tempestade: seção do radar de tempestade ausente`);
    else {
      if (!radar.antesDoMapa) problemas.push(`${tela.nome}/tempestade: o radar não está logo acima do mapa`);
      for (const esperado of [/vindo para cá/i, /se aproximando/i, /passa a \d+ km/i, /ganhando força/i]) if (!esperado.test(radar.texto)) problemas.push(`${tela.nome}/tempestade: falta "${esperado.source}" no radar`);
    }
    if (capturas) {
      await pag.screenshot({ path: join(capturas, `${tela.nome}-${tema}-tempestade.png`) });
      await pag.locator('#hoje-detalhes .radar-t').scrollIntoViewIfNeeded();
      await pag.waitForTimeout(400);
      await pag.locator('#hoje-detalhes .radar-t').screenshot({ path: join(capturas, `${tela.nome}-${tema}-radar.png`) });
    }
    await ctx.close();
  }
}
await navegador.close();
servidor.close();
if (problemas.length) { console.error(problemas.join('\n')); process.exit(1); }
console.log('Telas sem problemas:', TELAS.map((t) => t.nome).join(', '), '·', ABAS.join(', '));
