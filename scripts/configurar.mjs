// Configura o endereço do Worker no app (js/config.js e CSP do index.html).
// Uso: node scripts/configurar.mjs https://painel-meteo.SEU-SUBDOMINIO.workers.dev
import { readFileSync, writeFileSync } from 'node:fs';

const url = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) {
  console.error('Informe a URL do Worker, só https://host, sem caminho. Ex.: https://painel-meteo.fulano.workers.dev');
  process.exit(1);
}
const cfg = 'js/config.js';
writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/workerUrl: '[^']*'/, `workerUrl: '${url}'`));

const idx = 'index.html';
let html = readFileSync(idx, 'utf8');
html = html.replace(/ https:\/\/[a-z0-9.-]+\.workers\.dev/gi, '');
html = html.replace('https://apiprevmet3.inmet.gov.br;', `https://apiprevmet3.inmet.gov.br ${url};`);
writeFileSync(idx, html);
console.log('Worker configurado em', url);
