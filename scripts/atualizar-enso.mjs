// Atualiza dados/enso.json (rodado pelo GitHub Actions a cada 3 horas, ou à mão: node scripts/atualizar-enso.mjs).
// Reaproveita os leitores do Worker para NOAA CPC e IRI (que não liberam leitura pelo navegador) e acrescenta
// uma estimativa diária da temperatura do mar na região Niño 3.4 pela Open-Meteo Marine.
// O arquivo é publicado pelo GitHub Pages no mesmo endereço do app, então o app lê sem Worker e sem CORS.
import { readFile, writeFile } from 'node:fs/promises';
import { atualizarEnso } from '../worker/src/index.js';

const ARQ = new URL('../dados/enso.json', import.meta.url);

// "KV" de arquivo: guarda a última versão válida de cada parte, como o Worker faz.
let anterior = null;
try { anterior = JSON.parse(await readFile(ARQ, 'utf8')); } catch {}
const kv = { get: async () => anterior, put: async () => {} };

const final = await atualizarEnso({ KV: kv });

// ---- Niño 3.4 diário (estimativa): média da temperatura do mar em 5N-5S, 170W-120W ----
async function nino34Diario() {
  const lats = [4, 0, -4], lons = [-168, -158, -148, -138, -128, -122];
  const la = [], lo = [];
  for (const y of lats) for (const x of lons) { la.push(y); lo.push(x); }
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=sea_surface_temperature&past_days=45&forecast_days=1&timezone=GMT`;
  const r = await fetch(url, { headers: { 'user-agent': 'painel-meteo-pessoal/1.0' } });
  if (!r.ok) throw new Error(`Open-Meteo Marine respondeu ${r.status}`);
  let j = await r.json();
  if (!Array.isArray(j)) j = [j];
  const horas = j[0]?.hourly?.time || [];
  const porDia = new Map();
  horas.forEach((t, i) => {
    const vs = j.map((p) => p.hourly?.sea_surface_temperature?.[i]).filter((v) => typeof v === 'number' && v > 15 && v < 35);
    if (vs.length < j.length * 0.7) return; // dia sem pontos suficientes não entra
    const d = String(t).slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(vs.reduce((s, v) => s + v, 0) / vs.length);
  });
  const hoje = new Date().toISOString().slice(0, 10); // só dias completos e já passados (o dia atual traz previsão)
  const dias = [...porDia.entries()].filter(([d, v]) => d < hoje && v.length >= 20).map(([d, v]) => ({ data: d, sst: v.reduce((s, x) => s + x, 0) / v.length }));
  if (dias.length < 7) throw new Error('poucos dias com temperatura do mar');
  return dias;
}

// Climatologia mensal 1991-2020 do Niño 3.4 (OISST da NOAA CPC): valor absoluto menos anomalia.
async function climatologia() {
  const r = await fetch('https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices', { headers: { 'user-agent': 'painel-meteo-pessoal/1.0' } });
  if (!r.ok) throw new Error(`CPC respondeu ${r.status}`);
  const soma = Array(13).fill(0), n = Array(13).fill(0);
  for (const l of (await r.text()).split('\n')) {
    const p = l.trim().split(/\s+/);
    if (p.length !== 10 || !/^\d{4}$/.test(p[0])) continue;
    const ano = Number(p[0]), mes = Number(p[1]), abs = Number(p[8]), anom = Number(p[9]);
    if (ano < 1991 || ano > 2020 || !(mes >= 1 && mes <= 12) || !Number.isFinite(abs) || !Number.isFinite(anom)) continue;
    soma[mes] += abs - anom; n[mes]++;
  }
  if (n.slice(1).some((x) => x < 25)) throw new Error('climatologia incompleta');
  return soma.map((s, m) => (m ? s / n[m] : null));
}

try {
  const [dias, clima] = await Promise.all([nino34Diario(), climatologia()]);
  // interpola a climatologia entre os meios dos meses para não dar degrau na virada do mês
  const climaDia = (data) => {
    const d = new Date(data + 'T00:00:00Z'), m = d.getUTCMonth() + 1, dia = d.getUTCDate();
    const dim = new Date(Date.UTC(d.getUTCFullYear(), m, 0)).getUTCDate();
    const f = (dia - 0.5) / dim - 0.5;
    const viz = f >= 0 ? (m % 12) + 1 : ((m + 10) % 12) + 1;
    return clima[m] + (clima[viz] - clima[m]) * Math.abs(f);
  };
  final.partes.diario = { ok: true, em: Date.now(), dados: dias.map((x) => ({ ...x, anom: Math.round((x.sst - climaDia(x.data)) * 100) / 100, sst: Math.round(x.sst * 100) / 100 })) };
} catch (e) {
  const ant = anterior?.partes?.diario;
  final.partes.diario = ant?.dados ? { ...ant, ok: false, desatualizado: true, erro: String(e.message).slice(0, 120) } : { ok: false, erro: String(e.message).slice(0, 120) };
}

final.fontes = {
  cpc: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml',
  cpcProb: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/probabilities/',
  iri: 'https://iri.columbia.edu/our-expertise/climate/forecasts/enso/current/',
  inmet: 'https://portal.inmet.gov.br/',
  marine: 'https://open-meteo.com/en/docs/marine-weather-api',
};
final.origem = 'GitHub Actions';
// só grava quando algum dado mudou (evita um commit a cada 3 horas sem novidade)
const soDados = (x) => JSON.stringify(Object.fromEntries(Object.entries(x?.partes || {}).map(([k, v]) => [k, v.dados ?? null])));
if (anterior && soDados(anterior) === soDados(final)) { console.log('sem mudança nos dados'); process.exit(0); }
await writeFile(ARQ, JSON.stringify(final));
const ok = Object.entries(final.partes).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'falhou'}`).join(' ');
console.log(ok);
