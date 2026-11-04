// Coleta o histórico usado na calibração e grava uma tabela diária em dados/historico/A884-diario.json.
//
//   node scripts/historico.mjs            (rodado pelo GitHub Actions: .github/workflows/calibracao.yml)
//
// 1. Medições: arquivos anuais do INMET (BDMEP), estação automática A884 Campo Bom, hora a hora.
// 2. Previsões passadas: Open-Meteo Previous Runs API, o que cada modelo previu 1 a 5 dias antes de cada hora
//    (variáveis "<var>_previous_dayN"; doc: https://open-meteo.com/en/docs/previous-runs-api).
//
// A tabela é incremental: dias já guardados não são buscados de novo, exceto os 10 mais recentes
// (o INMET completa o arquivo do ano corrente com atraso). Cada execução custa poucas centenas de
// chamadas à Open-Meteo na primeira vez e algumas dezenas depois, dentro do limite de 10 mil por dia.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { listarZip, extrairZip, lerCsvInmet, controleQualidade, diasLocais } from './lib/inmet.mjs';
import { MODELOS_CALIBRACAO, LEADS, VARS_PREVISAO, prevDiaria } from './lib/calibracao.mjs';

const ESTACAO = { id: 'A884', nome: 'Campo Bom', lat: -29.674, lon: -51.064 };
// Todo o histórico que a Previous Runs guarda: a maioria dos modelos desde jan/2024 e o GFS (temperatura)
// desde mar/2021 (doc oficial). Antes do início de cada modelo a API devolve nulos, que não entram na tabela.
const INICIO = process.env.CALIB_INICIO || '2021-03-01';
const ARQ = new URL(`../dados/historico/${ESTACAO.id}-diario.json`, import.meta.url);
const CACHE_ZIP = process.env.CALIB_CACHE || new URL('../.cache-inmet/', import.meta.url).pathname;
const UA = { 'user-agent': 'painel-meteo-pessoal/1.0 (+https://github.com/sidegum/painel-meteo)' };

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hojeLocal = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** fetch com nova tentativa e espera crescente (2, 4, 8, 16 s) para falhas de rede e limite por minuto. */
async function buscar(url, tipo = 'json', tentativas = 5) {
  let ultimo;
  for (let k = 0; k < tentativas; k++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(180000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} em ${url}`), { definitivo: true });
      return tipo === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      ultimo = e;
      if (e.definitivo) throw e;
      await espera(2000 * 2 ** k);
    }
  }
  throw ultimo;
}

// ------------------------------------------------------------------ INMET

async function medicoesInmet(anos) {
  await mkdir(CACHE_ZIP, { recursive: true });
  const todas = [];
  let meta = null;
  const relatorio = {};
  for (const ano of anos) {
    const caminho = `${CACHE_ZIP}${ano}.zip`;
    let zip = null;
    // Anos fechados não mudam: o cache do Actions guarda o ZIP. O ano corrente é sempre baixado de novo.
    if (ano < new Date().getUTCFullYear()) { try { zip = await readFile(caminho); } catch {} }
    if (!zip) {
      try {
        const t0 = Date.now();
        zip = await buscar(`https://portal.inmet.gov.br/uploads/dadoshistoricos/${ano}.zip`, 'buffer', 4);
        console.log(`  ${ano}.zip: ${(zip.length / 1e6).toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        await writeFile(caminho, zip);
      } catch (e) { relatorio[ano] = `falha no download: ${e.message}`; continue; }
    }
    const entrada = listarZip(zip).find((e) => e.nome.toUpperCase().includes(`_${ESTACAO.id}_`));
    if (!entrada) { relatorio[ano] = `estação ${ESTACAO.id} ausente no arquivo`; continue; }
    const csv = lerCsvInmet(new TextDecoder('latin1').decode(extrairZip(zip, entrada)));
    meta = csv.meta;
    todas.push(...csv.horas);
    relatorio[ano] = `${csv.horas.length} horas (${entrada.nome})`;
  }
  todas.sort((a, b) => a.ms - b.ms);
  const { horas, descartes } = controleQualidade(todas);
  return { meta, dias: diasLocais(horas), descartes, relatorio };
}

// ------------------------------------------------------------------ Open-Meteo Previous Runs

async function previsoesPassadas(datas) {
  const porModelo = {};
  const custo = { chamadas: 0 };
  if (!datas.length) return { porModelo, custo };
  const ini = datas[0], fim = datas[datas.length - 1];
  const hourly = VARS_PREVISAO.flatMap((v) => LEADS.map((d) => `${v}_previous_day${d}`)).join(',');
  for (const modelo of Object.keys(MODELOS_CALIBRACAO)) {
    porModelo[modelo] = {};
    // blocos de 60 dias: respostas de ~1 MB e custo previsível
    for (let a = ini; a <= fim; a = somaDias(a, 60)) {
      const b = [somaDias(a, 59), fim].sort()[0];
      const p = new URLSearchParams({
        latitude: String(ESTACAO.lat), longitude: String(ESTACAO.lon), hourly, models: modelo,
        start_date: a, end_date: b, timezone: 'America/Sao_Paulo', wind_speed_unit: 'kmh',
      });
      const j = await buscar(`https://previous-runs-api.open-meteo.com/v1/forecast?${p}`);
      if (j.error) throw new Error(`Open-Meteo: ${j.reason}`);
      custo.chamadas++;
      Object.assign(porModelo[modelo], prevDiaria(j));
      console.log(`  ${modelo} ${a} a ${b}: ${Object.keys(prevDiaria(j)).length} dias com dado`);
      await espera(1500); // bem abaixo de 600 chamadas por minuto
    }
  }
  return { porModelo, custo };
}

// ------------------------------------------------------------------ principal

let tabela = { estacao: ESTACAO, dias: {} };
try { tabela = JSON.parse(await readFile(ARQ, 'utf8')); } catch {}

const ontem = somaDias(hojeLocal(), -1);
const anos = [];
for (let y = Number(INICIO.slice(0, 4)); y <= Number(ontem.slice(0, 4)); y++) anos.push(y);

console.log(`INMET ${ESTACAO.id}: anos ${anos.join(', ')}`);
const obs = await medicoesInmet(anos);
for (const [ano, txt] of Object.entries(obs.relatorio)) console.log(`  ${ano}: ${txt}`);
console.log(`  descartes do controle de qualidade: ${JSON.stringify(obs.descartes)}`);
if (!obs.dias.size) throw new Error('nenhuma medição do INMET; a tabela anterior foi mantida');

// datas a buscar na Open-Meteo: as que faltam na tabela e os 10 dias mais recentes
const recentes = somaDias(ontem, -10);
const todas = [];
for (let d = INICIO; d <= ontem; d = somaDias(d, 1)) todas.push(d);
const faltam = todas.filter((d) => !tabela.dias[d]?.prev || d >= recentes);
console.log(`Open-Meteo Previous Runs: ${faltam.length} dias a buscar (${faltam[0] ?? '-'} a ${faltam.at(-1) ?? '-'})`);
const prev = await previsoesPassadas(faltam);
console.log(`  ${prev.custo.chamadas} requisições`);

for (const d of todas) {
  const linha = tabela.dias[d] || {};
  if (obs.dias.has(d)) linha.obs = obs.dias.get(d);
  for (const [m, porDia] of Object.entries(prev.porModelo)) {
    if (porDia[d]) (linha.prev ||= {})[m] = porDia[d];
  }
  if (linha.obs || linha.prev) tabela.dias[d] = linha;
}
tabela.estacao = { ...ESTACAO, ...(obs.meta?.lat ? { lat: obs.meta.lat, lon: obs.meta.lon, altitude: obs.meta.altitude } : {}) };
tabela.atualizadoEm = new Date().toISOString();
tabela.fontes = {
  medicoes: 'INMET, BDMEP (portal.inmet.gov.br/dadoshistoricos), estação automática A884 Campo Bom',
  previsoes: 'Open-Meteo Previous Runs API (CC BY 4.0), valores previstos 1 a 5 dias antes',
};
tabela.qc = obs.descartes;

await mkdir(new URL('.', ARQ), { recursive: true });
// Uma linha por dia: diffs legíveis no Git e arquivo fácil de auditar.
const linhas = Object.keys(tabela.dias).sort().map((d) => `    ${JSON.stringify(d)}: ${JSON.stringify(tabela.dias[d])}`);
const { dias: _d, ...cab } = tabela;
const cabJson = JSON.stringify(cab, null, 2).slice(0, -2);
await writeFile(ARQ, `${cabJson},\n  "dias": {\n${linhas.join(',\n')}\n  }\n}\n`);
console.log(`Gravado ${ARQ.pathname}: ${linhas.length} dias.`);
