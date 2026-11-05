// Service worker simples: guarda só os arquivos do app para abrir sem internet.
// Dados de previsão ficam no cache "painel-dados-v1", gravado pelo próprio app (dados públicos).
// Funciona em qualquer endereço base (subpasta do GitHub Pages ou raiz do domínio no Cloudflare Pages): todos os
// caminhos são relativos à pasta do próprio sw.js.
const VERSAO = 'painel-app-v1.6.2';
const ARQUIVOS = [
  './', './index.html', './app.css', './manifest.json', './privacidade.html',
  './js/app.js', './js/analise.js', './js/dados.js', './js/config.js', './js/ui.js', './js/faixa.js', './js/graficos.js', './js/mapa.js',
  './vendor/uplot/uPlot.iife.min.js', './vendor/uplot/uPlot.min.css',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/fontes/archivo-latin-standard-normal.woff2', './vendor/fontes/archivo-latin-ext-standard-normal.woff2',
  './icones/icone.svg', './icones/icone-192.png', './icones/icone-512.png',
];

// O Cloudflare Pages redireciona /index.html para / e /privacidade.html para /privacidade. Uma resposta que passou por
// redirecionamento não pode ser entregue a uma navegação (o navegador recusa), então ela é copiada sem essa marca.
async function semRedirecionamento(r) {
  if (!r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}

async function guardar(cache, chave, r) {
  await cache.put(chave, await semRedirecionamento(r));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    await Promise.all(ARQUIVOS.map(async (arq) => {
      const r = await fetch(arq, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`falha ao guardar ${arq}: ${r.status}`);
      await guardar(cache, arq, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('painel-app-') && k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Só arquivos do próprio app, do mesmo domínio. Respostas de APIs não passam por aqui.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Rede primeiro para todos os arquivos do app (cada abertura já pega a versão publicada), sem usar o
  // cache HTTP do servidor (10 min no GitHub Pages); o cache local só entra sem internet ou se a rede demorar 4 s.
  // Navegações: cada página tem a sua entrada (o app em index.html; a política de privacidade na dela),
  // seja qual for a URL pedida (raiz, ?parametros, #aba).
  const pagina = e.request.mode === 'navigate';
  const chave = !pagina ? e.request : /\/privacidade(\.html)?$/.test(url.pathname) ? './privacidade.html' : './index.html';
  e.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    const daRede = fetch(e.request, { cache: 'no-cache' }).then((r) => {
      if (r.ok) guardar(cache, chave, r.clone()).catch(() => {});
      return r;
    });
    const guardado = await cache.match(chave);
    if (!guardado) return daRede;
    const espera = new Promise((ok) => setTimeout(() => ok(guardado), 4000));
    return Promise.race([daRede.catch(() => guardado), espera]);
  })());
});
