// Service worker simples: guarda só os arquivos do app para abrir sem internet.
// Dados de previsão ficam no cache "painel-dados-v1", gravado pelo próprio app (dados públicos).
const VERSAO = 'painel-app-v1.1.1';
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
  // Rede primeiro para o HTML (pega versões novas), cache como reserva sem internet.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      const copia = r.clone();
      if (r.ok) caches.open(VERSAO).then((c) => c.put('./index.html', copia));
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request)));
});
