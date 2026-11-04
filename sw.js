// Service worker simples: guarda só os arquivos do app para abrir sem internet.
// Dados de previsão ficam no cache "painel-dados-v1", gravado pelo próprio app (dados públicos).
const VERSAO = 'painel-app-v1.2.19';
const ARQUIVOS = [
  './', './index.html', './app.css', './manifest.json', './privacidade.html',
  './js/app.js', './js/analise.js', './js/dados.js', './js/config.js', './js/ui.js', './js/faixa.js', './js/graficos.js', './js/mapa.js',
  './vendor/uplot/uPlot.iife.min.js', './vendor/uplot/uPlot.min.css',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/fontes/archivo-latin-standard-normal.woff2', './vendor/fontes/archivo-latin-ext-standard-normal.woff2',
  './icones/icone.svg', './icones/icone-192.png', './icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
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
  // cache HTTP de 10 min do GitHub Pages; o cache local só entra sem internet ou se a rede demorar 4 s.
  const pagina = e.request.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    const daRede = fetch(e.request, { cache: 'no-cache' }).then((r) => {
      if (r.ok) cache.put(pagina ? './index.html' : e.request, r.clone());
      return r;
    });
    const guardado = await cache.match(pagina ? './index.html' : e.request);
    if (!guardado) return daRede;
    const espera = new Promise((ok) => setTimeout(() => ok(guardado), 4000));
    return Promise.race([daRede.catch(() => guardado), espera]);
  })());
});
