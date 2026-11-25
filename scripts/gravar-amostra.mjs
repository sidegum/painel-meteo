// Grava respostas reais das fontes do painel (Open-Meteo, Worker, INMET) para o teste de tela (test/e2e).
// Roda no GitHub Actions (.github/workflows/amostra.yml), onde as fontes são acessíveis; o teste de tela usa
// o arquivo gravado no lugar da rede, para conferir todas as abas com dados reais e sem depender de limite de API.
// Uso: node scripts/gravar-amostra.mjs [lat] [lon]   (padrão: centro de Campo Bom)
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CONFIG } from '../js/config.js';
import { urlPrevisao, urlEnsemble, MODELOS_ENSEMBLE, GEOCODE_PADRAO } from '../js/dados.js';

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
const saida = { gravadoEm: new Date().toISOString(), lat, lon, respostas: {} };
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { origin: 'https://tempo-rs.pages.dev' } });
    const corpo = await r.text();
    saida.respostas[url] = { status: r.status, corpo };
    console.log(r.status, (corpo.length / 1024).toFixed(0) + ' kB', url.slice(0, 110));
  } catch (e) { console.log('falhou', url.slice(0, 110), e.message); }
}
mkdirSync('test/e2e', { recursive: true });
writeFileSync('test/e2e/amostra.json.gz', gzipSync(JSON.stringify(saida), { level: 9 }));
