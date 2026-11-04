// Coleta o histórico usado na calibração e grava uma tabela diária por estação em dados/historico/<ID>-diario.json.
//
//   node scripts/historico.mjs            (rodado pelo GitHub Actions: .github/workflows/calibracao.yml)
//
// Estações (as mesmas da verificação do app, VERIFICACAO em js/app.js):
// - A884 Campo Bom (INMET): a principal. Calibra o painel; recebe os 6 modelos e a rajada de curto prazo.
// - A801 Porto Alegre Jardim Botânico (INMET) e SBCO Canoas (METAR): só para a tabela "Acerto de cada modelo",
//   com os 3 modelos do painel.
// 1. Medições: arquivos anuais do INMET (BDMEP), hora a hora; METAR de Canoas pelo arquivo da Iowa
//    Environmental Mesonet (IEM), que guarda os METAR mundiais desde a década de 2000.
// 2. Previsões passadas: Open-Meteo Previous Runs API, o que cada modelo previu 1 a 5 dias antes de cada hora
//    (variáveis "<var>_previous_dayN"; doc: https://open-meteo.com/en/docs/previous-runs-api).
//
// A tabela é incremental: dias já guardados não são buscados de novo, exceto os 10 mais recentes
// (o INMET completa o arquivo do ano corrente com atraso). Cada execução custa poucas centenas de
// chamadas à Open-Meteo na primeira vez e algumas dezenas depois, dentro do limite de 10 mil por dia.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { listarZip, extrairZip, lerCsvInmet, controleQualidade, diasLocais, numeroInmet, instanteUtc, lerCsvIem } from './lib/inmet.mjs';
import { MODELOS_CALIBRACAO, LEADS, VARS_PREVISAO, prevDiaria, MODELOS_RAJADA_CURTO_PRAZO, rajadaCurtoPrazo } from './lib/calibracao.mjs';

const MODELOS_APP = Object.keys(MODELOS_CALIBRACAO).filter((m) => MODELOS_CALIBRACAO[m].app);
const ESTACOES = [
  { id: 'A884', tipo: 'inmet', nome: 'Campo Bom', lat: -29.674, lon: -51.064, modelos: Object.keys(MODELOS_CALIBRACAO), curtoPrazo: true },
  { id: 'A801', tipo: 'inmet', nome: 'Porto Alegre Jardim Botânico', lat: -30.054, lon: -51.175, modelos: MODELOS_APP, curtoPrazo: false },
  { id: 'SBCO', tipo: 'metar', nome: 'Canoas', lat: -29.945, lon: -51.144, modelos: MODELOS_APP, curtoPrazo: false },
];
// Todo o histórico que a Previous Runs guarda: a maioria dos modelos desde jan/2024 e o GFS (temperatura)
// desde mar/2021 (doc oficial). Antes do início de cada modelo a API devolve nulos, que não entram na tabela.
const INICIO = process.env.CALIB_INICIO || '2021-03-01';
const CACHE_ZIP = process.env.CALIB_CACHE || new URL('../.cache-inmet/', import.meta.url).pathname;
const UA = { 'user-agent': 'painel-meteo-pessoal/1.0 (+https://github.com/sidegum/painel-meteo)' };

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hojeLocal = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** fetch com nova tentativa e espera crescente (2, 4, 8, 16 s) para falhas de rede e limite por minuto. */
async function buscar(url, tipo = 'json', tentativas = 5, timeoutMs = 120000) {
  let ultimo;
  for (let k = 0; k < tentativas; k++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
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

/**
 * Lê os ZIPs anuais uma vez e extrai todas as estações pedidas.
 * @returns {Promise<Record<string, {meta: object|null, horas: object[], relatorio: Record<number, string>}>>}
 */
async function medicoesInmet(anos, ids) {
  await mkdir(CACHE_ZIP, { recursive: true });
  const out = Object.fromEntries(ids.map((id) => [id, { meta: null, horas: [], relatorio: {} }]));
  for (const ano of anos) {
    const caminho = `${CACHE_ZIP}${ano}.zip`;
    let zip = null;
    // Anos fechados não mudam: o cache do Actions guarda o ZIP. O do ano corrente (que o INMET completa
    // uma vez por mês) é baixado de novo quando a cópia tem mais de 7 dias.
    const marca = `${CACHE_ZIP}${ano}.baixado`;
    let recente = ano < new Date().getUTCFullYear();
    if (!recente) { try { recente = Date.now() - Date.parse(await readFile(marca, 'utf8')) < 7 * 86400000; } catch {} }
    if (recente) { try { zip = await readFile(caminho); } catch {} }
    if (!zip) {
      try {
        const t0 = Date.now();
        zip = await buscar(`https://portal.inmet.gov.br/uploads/dadoshistoricos/${ano}.zip`, 'buffer', 2, 300000);
        console.log(`  ${ano}.zip: ${(zip.length / 1e6).toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        await writeFile(caminho, zip);
        await writeFile(marca, new Date().toISOString());
      } catch (e) { for (const id of ids) out[id].relatorio[ano] = `falha no download: ${e.message}`; continue; }
    }
    const entradas = listarZip(zip);
    for (const id of ids) {
      const entrada = entradas.find((e) => e.nome.toUpperCase().includes(`_${id}_`));
      if (!entrada) { out[id].relatorio[ano] = `estação ${id} ausente no arquivo`; continue; }
      const csv = lerCsvInmet(new TextDecoder('latin1').decode(extrairZip(zip, entrada)));
      out[id].meta = csv.meta;
      out[id].horas.push(...csv.horas);
      out[id].relatorio[ano] = `${csv.horas.length} horas (${entrada.nome})`;
    }
  }
  for (const id of ids) out[id].horas.sort((a, b) => a.ms - b.ms);
  return out;
}

// ------------------------------------------------------------------ METAR (IEM)

/**
 * METAR horário de um aeródromo pelo arquivo da IEM (https://mesonet.agron.iastate.edu/request/download.phtml),
 * em blocos de um ano. Temperatura em °F, vento e rajada em nós; convertidos em lerCsvIem.
 */
async function medicoesMetar(est, ini, fim) {
  const horas = [];
  for (let a = ini; a <= fim; a = somaDias(a, 366)) {
    const b = [somaDias(a, 365), fim].sort()[0];
    const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = somaDias(b, 1).split('-').map(Number);
    const p = new URLSearchParams({ station: est.id, tz: 'Etc/UTC', format: 'onlycomma', latlon: 'no', missing: 'M', trace: 'T',
      year1: y1, month1: m1, day1: d1, year2: y2, month2: m2, day2: d2 });
    for (const v of ['tmpf', 'sknt', 'gust']) p.append('data', v);
    for (const t of ['3', '4']) p.append('report_type', t); // METAR de rotina e especiais
    try {
      const txt = (await buscar(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${p}`, 'buffer', 3, 180000)).toString('utf8');
      const hs = lerCsvIem(txt);
      horas.push(...hs);
      console.log(`  METAR ${est.id} ${a} a ${b}: ${hs.length} horas`);
    } catch (e) { console.log(`  METAR ${est.id} ${a} a ${b}: falhou (${e.message})`); }
    await espera(3000); // a IEM pede uso moderado do serviço
  }
  return horas.sort((x, y) => x.ms - y.ms);
}

// ------------------------------------------------------------------ Open-Meteo Previous Runs

async function previsoesPassadas(est, datas) {
  const porModelo = {};
  const custo = { chamadas: 0 };
  if (!datas.length) return { porModelo, custo };
  const ini = datas[0], fim = datas[datas.length - 1];
  const hourly = VARS_PREVISAO.flatMap((v) => LEADS.map((d) => `${v}_previous_day${d}`)).join(',');
  for (const modelo of est.modelos) {
    porModelo[modelo] = {};
    // blocos de 60 dias: respostas de ~1 MB e custo previsível
    for (let a = ini; a <= fim; a = somaDias(a, 60)) {
      const b = [somaDias(a, 59), fim].sort()[0];
      const p = new URLSearchParams({
        latitude: String(est.lat), longitude: String(est.lon), hourly, models: modelo,
        start_date: a, end_date: b, timezone: 'America/Sao_Paulo', wind_speed_unit: 'kmh',
      });
      const j = await buscar(`https://previous-runs-api.open-meteo.com/v1/forecast?${p}`);
      if (j.error) throw new Error(`Open-Meteo: ${j.reason}`);
      custo.chamadas++;
      Object.assign(porModelo[modelo], prevDiaria(j));
      console.log(`  ${est.id} ${modelo} ${a} a ${b}: ${Object.keys(prevDiaria(j)).length} dias com dado`);
      await espera(1500); // bem abaixo de 600 chamadas por minuto
    }
  }
  return { porModelo, custo };
}

// ------------------------------------------------------------------ Open-Meteo Historical Forecast (rajada)

// A Previous Runs não guarda rajada de alguns modelos (ECMWF). A Historical Forecast API guarda a série
// contínua montada com as primeiras horas de cada rodada; dela sai a rajada de "antecedência 0".
// Doc: https://open-meteo.com/en/docs/historical-forecast-api (arquivo desde 2022 para a maioria dos modelos).
const INICIO_HF = '2022-01-01';
async function rajadaHistoricalForecast(est, ini, fim) {
  const porModelo = {};
  let chamadas = 0;
  for (const modelo of MODELOS_RAJADA_CURTO_PRAZO) {
    porModelo[modelo] = {};
    for (let a = ini; a <= fim; a = somaDias(a, 180)) {
      const b = [somaDias(a, 179), fim].sort()[0];
      const p = new URLSearchParams({
        latitude: String(est.lat), longitude: String(est.lon), hourly: 'wind_gusts_10m', models: modelo,
        start_date: a, end_date: b, timezone: 'America/Sao_Paulo', wind_speed_unit: 'kmh',
      });
      try {
        const j = await buscar(`https://historical-forecast-api.open-meteo.com/v1/forecast?${p}`);
        if (j.error) throw new Error(j.reason);
        const dias = rajadaCurtoPrazo(j);
        Object.assign(porModelo[modelo], dias);
        console.log(`  ${modelo} ${a} a ${b}: ${Object.keys(dias).length} dias com rajada`);
      } catch (e) { console.log(`  ${modelo} ${a} a ${b}: falhou (${e.message})`); }
      chamadas++;
      await espera(1500);
    }
  }
  return { porModelo, chamadas };
}

// ------------------------------------------------------------------ INMET com token (dias recentes)

// O arquivo anual do INMET chega com um ou dois meses de atraso. Com o token (segredo INMET_TOKEN do
// repositório, nunca gravado em arquivo nem em log), os dias que faltam vêm da API de séries da estação.
async function medicoesRecentesComToken(est, desde, ate) {
  const token = process.env.INMET_TOKEN;
  if (!token || desde > ate) return [];
  const horas = [];
  for (let a = desde; a <= ate; a = somaDias(a, 30)) {
    const b = [somaDias(a, 29), ate].sort()[0];
    try {
      const linhas = await buscar(`https://apitempo.inmet.gov.br/token/estacao/${a}/${b}/${est.id}/${encodeURIComponent(token)}`, 'json', 3, 60000);
      if (!Array.isArray(linhas)) throw new Error('resposta sem lista');
      const n = (v) => numeroInmet(v);
      const kmh = (v) => (n(v) === null ? null : Math.round(n(v) * 3.6 * 10) / 10);
      for (const l of linhas) {
        const ms = instanteUtc(String(l.DT_MEDICAO || ''), String(l.HR_MEDICAO ?? '').padStart(4, '0'));
        if (ms === null) continue;
        horas.push({ ms, chuva: n(l.CHUVA), temp: n(l.TEM_INS), tmax: n(l.TEM_MAX), tmin: n(l.TEM_MIN), rajada: kmh(l.VEN_RAJ), vento: kmh(l.VEN_VEL), direcao: n(l.VEN_DIR) });
      }
      console.log(`  INMET (token) ${a} a ${b}: ${linhas.length} horas`);
    } catch (e) {
      // a mensagem de erro pode conter a URL; não registra nada além do período
      console.log(`  INMET (token) ${a} a ${b}: falhou`);
      void e;
    }
  }
  return horas;
}

// ------------------------------------------------------------------ principal

const ontem = somaDias(hojeLocal(), -1);
const anos = [];
for (let y = Number(INICIO.slice(0, 4)); y <= Number(ontem.slice(0, 4)); y++) anos.push(y);
const idsInmet = ESTACOES.filter((e) => e.tipo === 'inmet').map((e) => e.id);
console.log(`INMET ${idsInmet.join(', ')}: anos ${anos.join(', ')}`);
const zips = await medicoesInmet(anos, idsInmet);

for (const est of ESTACOES) await coletarEstacao(est);

/** Junta medições e previsões de uma estação e grava a tabela diária dela. */
async function coletarEstacao(est) {
  const arq = new URL(`../dados/historico/${est.id}-diario.json`, import.meta.url);
  let tabela = { estacao: est, dias: {} };
  try { tabela = JSON.parse(await readFile(arq, 'utf8')); } catch {}
  console.log(`\n== ${est.id} ${est.nome}`);

  // medições
  let horasObs = [], meta = null;
  if (est.tipo === 'inmet') {
    const z = zips[est.id];
    for (const [ano, txt] of Object.entries(z.relatorio)) console.log(`  ${ano}: ${txt}`);
    meta = z.meta;
    // dias depois do fim do arquivo anual: API com token, quando o segredo existe
    const ultimoArquivo = z.horas.length ? new Date(z.horas.at(-1).ms - 3 * 3600000).toISOString().slice(0, 10) : INICIO;
    const recentes = await medicoesRecentesComToken(est, somaDias(ultimoArquivo, 1), ontem);
    if (!process.env.INMET_TOKEN) console.log(`  sem INMET_TOKEN: medições até ${ultimoArquivo} (fim do arquivo anual)`);
    horasObs = [...z.horas, ...recentes.filter((h) => h.ms > (z.horas.at(-1)?.ms ?? 0))].sort((a, b) => a.ms - b.ms);
  } else {
    // METAR: na primeira vez, todo o período; depois, os últimos 40 dias
    const temObs = Object.values(tabela.dias).some((l) => l.obs);
    horasObs = await medicoesMetar(est, temObs ? somaDias(ontem, -40) : INICIO, ontem);
  }
  const qc = controleQualidade(horasObs);
  // METAR não traz máxima/mínima da hora nem chuva: o dia usa a temperatura das leituras horárias
  const obsDias = diasLocais(qc.horas, -3, est.tipo === 'metar' ? { minHoras: 18 } : undefined);
  console.log(`  ${obsDias.size} dias com medição; descartes do controle de qualidade: ${JSON.stringify(qc.descartes)}`);
  if (!obsDias.size) console.log('  AVISO: nenhuma medição nova nesta execução; as já guardadas continuam valendo.');

  // previsões: datas que faltam na tabela e os 10 dias mais recentes
  const limiteRecente = somaDias(ontem, -10);
  const todas = [];
  for (let d = INICIO; d <= ontem; d = somaDias(d, 1)) todas.push(d);
  const faltam = todas.filter((d) => !tabela.dias[d]?.prev || d >= limiteRecente);
  console.log(`  Previous Runs: ${faltam.length} dias a buscar (${faltam[0] ?? '-'} a ${faltam.at(-1) ?? '-'})`);
  const prev = await previsoesPassadas(est, faltam);
  console.log(`  ${prev.custo.chamadas} requisições`);

  for (const d of todas) {
    const linha = tabela.dias[d] || {};
    if (obsDias.has(d)) linha.obs = obsDias.get(d);
    for (const [m, porDia] of Object.entries(prev.porModelo)) {
      if (porDia[d]) (linha.prev ||= {})[m] = { ...(linha.prev?.[m] || {}), ...porDia[d] };
    }
    if (linha.obs || linha.prev) tabela.dias[d] = linha;
  }

  // rajada de curto prazo (só a estação principal): na primeira vez, todo o arquivo; depois, 15 dias
  if (est.curtoPrazo) {
    const temHF = Object.values(tabela.dias).some((l) => Object.values(l.prev || {}).some((m) => m[0]));
    const iniHF = temHF ? somaDias(ontem, -15) : INICIO_HF;
    console.log(`  Historical Forecast (rajada): ${iniHF} a ${ontem}`);
    const hf = await rajadaHistoricalForecast(est, iniHF, ontem);
    for (const [m, porDia] of Object.entries(hf.porModelo)) {
      for (const [d, v] of Object.entries(porDia)) {
        const linha = (tabela.dias[d] ||= {});
        ((linha.prev ||= {})[m] ||= {})[0] = v[0];
      }
    }
  }

  const { modelos: _m, curtoPrazo: _c, ...dadosEst } = est;
  tabela.estacao = { ...dadosEst, ...(meta?.lat ? { lat: meta.lat, lon: meta.lon, altitude: meta.altitude } : {}) };
  tabela.atualizadoEm = new Date().toISOString();
  tabela.fontes = {
    medicoes: est.tipo === 'inmet'
      ? `INMET, BDMEP (portal.inmet.gov.br/dadoshistoricos), estação automática ${est.id} ${est.nome}`
      : `METAR ${est.id} ${est.nome}, arquivo da Iowa Environmental Mesonet (mesonet.agron.iastate.edu)`,
    previsoes: 'Open-Meteo Previous Runs API (CC BY 4.0), valores previstos 1 a 5 dias antes',
  };
  tabela.qc = qc.descartes;

  await mkdir(new URL('.', arq), { recursive: true });
  // Uma linha por dia: diffs legíveis no Git e arquivo fácil de auditar.
  const linhas = Object.keys(tabela.dias).sort().map((d) => `    ${JSON.stringify(d)}: ${JSON.stringify(tabela.dias[d])}`);
  const { dias: _d, ...cab } = tabela;
  const cabJson = JSON.stringify(cab, null, 2).slice(0, -2);
  await writeFile(arq, `${cabJson},\n  "dias": {\n${linhas.join(',\n')}\n  }\n}\n`);
  console.log(`  Gravado ${arq.pathname}: ${linhas.length} dias.`);
}
