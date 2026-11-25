// Grava respostas reais das fontes do painel (Open-Meteo, Worker, INMET) para o teste de tela (test/e2e).
// Roda no GitHub Actions (.github/workflows/amostra.yml), onde as fontes são acessíveis; o teste de tela usa
// o arquivo gravado no lugar da rede, para conferir todas as abas com dados reais e sem depender de limite de API.
// Uso: node scripts/gravar-amostra.mjs [lat] [lon]   (padrão: centro de Campo Bom)
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CONFIG } from '../js/config.js';
import { urlPrevisao, urlEnsemble, MODELOS_ENSEMBLE, GEOCODE_PADRAO, pixelDoPonto } from '../js/dados.js';
import { arredondaCoord } from '../js/analise.js';

const lat = Number(process.argv[2] ?? CONFIG.padrao.lat), lon = Number(process.argv[3] ?? CONFIG.padrao.lon);
const w = (rota, q = '') => `${CONFIG.workerUrl}/v1/${rota}${q}`;
const urls = [
  urlPrevisao(lat, lon),
  ...Object.keys(MODELOS_ENSEMBLE).map((m) => urlEnsemble(lat, lon, m)),
  w('observacoes', `?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`), w('alertas'), w('enso'),
  ...['A884', 'A801', 'SBCO', 'SBPA'].map((e) => w('acerto', `?estacao=${e}`)),
  'https://geocoding-api.open-meteo.com/v1/search?name=Novo+Hamburgo&count=20&language=pt&format=json',
  'https://apiprevmet3.inmet.gov.br/avisos/ativos',
  `https://apiprevmet3.inmet.gov.br/estacao/proxima/${GEOCODE_PADRAO}`,
];
// Radar (RainViewer): lista de quadros e os tiles que o app lê (zoom 7 do ponto; mosaico 2 x 2 de zoom 6 do
// quadro mais recente e dos de 30 e 60 min antes), com a mesma regra de escolha de js/dados.js.
const radar = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
urls.push('https://api.rainviewer.com/public/weather-maps.json');
const quadros = radar.radar.past, ult = quadros[quadros.length - 1];
const la = arredondaCoord(lat), lo = arredondaCoord(lon);
const t7 = pixelDoPonto(la, lo, 7), t6 = pixelDoPonto(la, lo, 6);
urls.push(`${radar.host}${ult.path}/256/7/${t7.x}/${t7.y}/2/0_0.png`);
const x0 = t6.px < 128 ? t6.x - 1 : t6.x, y0 = t6.py < 128 ? t6.y - 1 : t6.y;
for (const min of [0, 30, 60]) {
  const q = quadros.find((k) => Math.abs(ult.time - k.time - min * 60) <= 300);
  if (q) for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) urls.push(`${radar.host}${q.path}/256/6/${x0 + i}/${y0 + j}/2/0_0.png`);
}

const saida = { gravadoEm: new Date().toISOString(), lat, lon, respostas: {} };
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { origin: 'https://tempo-rs.pages.dev' } });
    const binario = /\.png$/.test(new URL(url).pathname);
    const corpo = binario ? Buffer.from(await r.arrayBuffer()).toString('base64') : await r.text();
    saida.respostas[url] = { status: r.status, corpo, ...(binario ? { base64: true, tipo: 'image/png' } : {}) };
    console.log(r.status, (corpo.length / 1024).toFixed(0) + ' kB', url.slice(0, 110));
  } catch (e) { console.log('falhou', url.slice(0, 110), e.message); }
}
mkdirSync('test/e2e', { recursive: true });
writeFileSync('test/e2e/amostra.json.gz', gzipSync(JSON.stringify(saida), { level: 9 }));
