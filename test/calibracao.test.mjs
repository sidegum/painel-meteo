// Testes do coletor e da estatística da calibração. Rodar: node --test test/calibracao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { listarZip, extrairZip, lerCsvInmet, numeroInmet, controleQualidade, diasLocais, dataLocal } from '../scripts/lib/inmet.mjs';
import { prevDiaria, ajustarVies, corrigirVies, ajustarFator, validar, contingenciaChuva, pesosRelativos, estacaoDoAno, pares } from '../scripts/lib/calibracao.mjs';

// ZIP mínimo (uma entrada deflate) montado à mão, no formato que o INMET publica.
function zipCom(nome, conteudo) {
  const dados = deflateRawSync(conteudo);
  const n = Buffer.from(nome, 'latin1');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(conteudo.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(conteudo.length, 24); central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOff = 30 + n.length + dados.length;
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(46 + n.length, 12); fim.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, dados, central, n, fim]);
}

const CAB = 'REGIAO:;S\nUF:;RS\nESTACAO:;CAMPO BOM\nCODIGO (WMO):;A884\nLATITUDE:;-29,67444444\nLONGITUDE:;-51,06416666\nALTITUDE:;24,92\nDATA DE FUNDACAO:;2014-11-25\n' +
  'Data;Hora UTC;PRECIPITAÇÃO TOTAL, HORÁRIO (mm);PRESSAO ATMOSFERICA AO NIVEL DA ESTACAO, HORARIA (mB);RADIACAO GLOBAL (Kj/m²);TEMPERATURA DO AR - BULBO SECO, HORARIA (°C);TEMPERATURA DO PONTO DE ORVALHO (°C);TEMPERATURA MÁXIMA NA HORA ANT. (AUT) (°C);TEMPERATURA MÍNIMA NA HORA ANT. (AUT) (°C);UMIDADE RELATIVA DO AR, HORARIA (%);VENTO, DIREÇÃO HORARIA (gr) (° (gr));VENTO, RAJADA MAXIMA (m/s);VENTO, VELOCIDADE HORARIA (m/s);\n';

function csvDia(data, chuvaHora = 0) {
  let s = '';
  for (let h = 0; h < 24; h++) {
    const t = 20 + 5 * Math.sin((h - 12) / 24 * 2 * Math.PI);
    s += `${data.replace(/-/g, '/')};${String(h).padStart(2, '0')}00 UTC;${String(chuvaHora).replace('.', ',')};1010;;${t.toFixed(1).replace('.', ',')};15;${(t + 0.3).toFixed(1).replace('.', ',')};${(t - 0.3).toFixed(1).replace('.', ',')};70;90;10;3,5;\n`;
  }
  return s;
}

test('ZIP: lista e extrai a entrada da estação', () => {
  const csv = Buffer.from(CAB + csvDia('2024-01-02'), 'latin1');
  const zip = zipCom('INMET_S_RS_A884_CAMPO BOM_01-01-2024_A_31-12-2024.CSV', csv);
  const e = listarZip(zip).find((x) => x.nome.includes('_A884_'));
  assert.ok(e);
  assert.equal(extrairZip(zip, e).toString('latin1'), csv.toString('latin1'));
});

test('CSV do INMET: metadados, decimal com vírgula, m/s → km/h, ausentes', () => {
  assert.equal(numeroInmet(',2'), 0.2);
  assert.equal(numeroInmet('-9999'), null);
  assert.equal(numeroInmet(''), null);
  const { meta, horas } = lerCsvInmet(CAB + csvDia('2024-01-02', 0.2));
  assert.equal(meta.codigo, 'A884');
  assert.ok(Math.abs(meta.lat + 29.674) < 0.001);
  assert.equal(horas.length, 24);
  assert.equal(horas[0].ms, Date.UTC(2024, 0, 2, 0, 0));
  assert.equal(horas[0].rajada, 36);   // 10 m/s
  assert.equal(horas[0].vento, 12.6);  // 3,5 m/s
  assert.equal(horas[0].chuva, 0.2);
});

test('dia local: hora UTC 03:00 é a última hora do dia anterior; agrega 24 h', () => {
  assert.equal(dataLocal(Date.UTC(2024, 0, 2, 3)), '2024-01-02');
  assert.equal(dataLocal(Date.UTC(2024, 0, 2, 2)), '2024-01-01');
  const { horas } = lerCsvInmet(CAB + csvDia('2024-01-02', 0.5) + csvDia('2024-01-03', 0.5));
  const dias = diasLocais(horas);
  const d = dias.get('2024-01-02');
  assert.equal(d.chuva, 12);
  assert.equal(d.rajada, 36);
  assert.ok(d.tmax > 24.9 && d.tmin < 15.1);
  assert.equal(dias.get('2024-01-01').tmax, null); // só 3 horas: não conta
});

test('controle de qualidade: descarta pico isolado e rajada menor que o vento', () => {
  const base = [20, 21, 40, 22, 23].map((t, i) => ({ ms: i, temp: t, tmax: t, tmin: t, chuva: 0, rajada: i === 4 ? 5 : 20, vento: 10 }));
  const { horas, descartes } = controleQualidade(base);
  assert.equal(horas[2].temp, null);
  assert.equal(horas[4].rajada, null);
  assert.equal(descartes.temp, 1);
});

test('Previous Runs: hora a hora → dia por antecedência', () => {
  const time = Array.from({ length: 24 }, (_, h) => `2025-03-10T${String(h).padStart(2, '0')}:00`);
  const hourly = { time };
  for (const L of [1, 2, 3, 4, 5]) {
    hourly[`precipitation_previous_day${L}`] = time.map(() => 0.5 * L);
    hourly[`temperature_2m_previous_day${L}`] = time.map((_, h) => 15 + h / 2);
    hourly[`wind_gusts_10m_previous_day${L}`] = time.map(() => (L === 2 ? null : 30));
    hourly[`wind_speed_10m_previous_day${L}`] = time.map(() => 12);
  }
  const d = prevDiaria({ hourly })['2025-03-10'];
  assert.deepEqual(d[1], [12, 26.5, 15, 30, 12]);
  assert.equal(d[2][3], null); // AIFS e afins: sem rajada não inventa
  assert.equal(d[5][0], 60);
});

test('viés por estação do ano com encolhimento e validação fora da amostra', () => {
  // modelo erra +2 °C no verão (jan–fev) e 0 no inverno (jul–ago); 56 dias de cada
  const tabela = { dias: {} };
  const dia = (ini, i) => new Date(Date.parse(ini) + i * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 56; i++) {
    const obs = 25 + (i % 5);
    tabela.dias[dia('2025-01-01', i)] = { obs: { tmax: obs }, prev: { m: { 1: [null, obs + 2, null, null, null] } } };
    tabela.dias[dia('2025-07-01', i)] = { obs: { tmax: obs - 10 }, prev: { m: { 1: [null, obs - 10, null, null, null] } } };
  }
  const ps = pares(tabela, 'm', 1, 'tmax');
  const aj = ajustarVies(ps);
  assert.ok(Math.abs(aj.anual - 1) < 0.01);
  assert.ok(aj.porEstacao.verao.vies > 1.7 && aj.porEstacao.verao.vies < 2);
  assert.ok(aj.porEstacao.inverno.vies < 0.3);
  assert.ok(Math.abs(corrigirVies(aj, ps.find((p) => p.estacao === 'verao')) - ps.find((p) => p.estacao === 'verao').obs) < 0.3);
  const v = validar(ps, ajustarVies, corrigirVies);
  assert.ok(v.usar && v.depois.mae < v.antes.mae);
});

test('fator de rajada e contingência de chuva', () => {
  const ps = Array.from({ length: 40 }, (_, i) => ({ mes: `2025-0${1 + (i % 4)}`, estacao: estacaoDoAno(1 + (i % 4)), prev: 50 + i, obs: (50 + i) * 0.8 }));
  const aj = ajustarFator(ps);
  assert.ok(Math.abs(aj.anual - 0.8) < 1e-9);
  const c = contingenciaChuva([{ prev: 5, obs: 3 }, { prev: 2, obs: 0 }, { prev: 0, obs: 4 }, { prev: 0, obs: 0 }]);
  assert.deepEqual([c.acerto, c.pod, c.far, c.vies], [0.5, 0.5, 0.5, 1]);
  const p = pesosRelativos({ a: { chuva: 2, tmax: 1 }, b: { chuva: 4, tmax: 1 } });
  assert.ok(p.a > 1 && p.b < 1);
});

// ------------------------------------------------------------------ uso no app (js/analise.js)
import { calibrarPrevisao, calibrarEnsemble, correcaoTemperatura, viesHistorico, fatorHistorico, pesosModelos, calibracaoAplicavel, consensoHorario, resumoModeloDia, indicesDoDia } from '../js/analise.js';

const CALIB = {
  versao: 1, estacao: { id: 'A884', lat: -29.674, lon: -51.064 }, diasComuns: 300,
  pesos: { ecmwf_ifs: 1.1, ecmwf_aifs025_single: 0.9, ukmo_global_deterministic_10km: 1 },
  modelos: {
    ecmwf_ifs: {
      tmax: { 1: { usar: true, vies: { verao: -1.5, outono: -1, inverno: -0.5, primavera: -1 } }, 2: { usar: false, vies: { verao: -9 } } },
      tmin: { 1: { usar: true, vies: { verao: 0.5, outono: 0.5, inverno: 0.5, primavera: 0.5 } } },
      rajada: { 1: { usar: true, fator: { verao: 0.8, outono: 0.8, inverno: 0.8, primavera: 0.8 } } },
      vento: { 1: { usar: false, fator: { verao: 0.5 } } },
    },
    ecmwf_ifs025: { rajada: { 1: { usar: true, fator: { verao: 0.7, outono: 0.7, inverno: 0.7, primavera: 0.7 } } } },
  },
};

// Previsão de um dia de janeiro (verão), hora a hora, no fuso -3.
function previsaoTeste() {
  const off = -10800, ini = Date.UTC(2026, 0, 10, 3); // 00:00 local de 10/01
  const horas = Array.from({ length: 24 }, (_, h) => ini + h * 3600000);
  const temp = horas.map((_, h) => 20 + 10 * Math.max(0, Math.sin((h - 6) / 12 * Math.PI))); // 20 a 30 °C
  return { lat: -29.67, lon: -51.06, offset: off, horas, atual: { ms: horas[15], temp: { ecmwf_ifs: temp[15] } },
    modelos: { ecmwf_ifs: { vars: { temperature_2m: temp, wind_gusts_10m: horas.map(() => 50), wind_speed_10m: horas.map(() => 20) } } } };
}

test('calibração só vale perto da estação', () => {
  assert.equal(calibracaoAplicavel(CALIB, -29.68, -51.05), true);
  assert.equal(calibracaoAplicavel(CALIB, -23.55, -46.63), false);
});

test('viés e fator históricos respeitam "usar", antecedência e estação do ano', () => {
  assert.deepEqual(viesHistorico(CALIB, 'ecmwf_ifs', 1, 1), { tmax: -1.5, tmin: 0.5 });
  assert.deepEqual(viesHistorico(CALIB, 'ecmwf_ifs', 2, 1), { tmax: null, tmin: null }); // reprovado fora da amostra
  assert.equal(fatorHistorico(CALIB, 'ecmwf_ifs', 'rajada', 1, 7), 0.8);
  assert.equal(fatorHistorico(CALIB, 'ecmwf_ifs', 'vento', 1, 1), 1);
  assert.equal(fatorHistorico(CALIB, 'ukmo_global_deterministic_10km', 'rajada', 1, 1), 1);
});

test('correção de temperatura: histórico como ponto de partida, aprendizado recente refina', () => {
  assert.deepEqual(correcaoTemperatura(null, { tmax: -1.5, tmin: 0.5 }), { tmax: -1.5, tmin: 0.5 });
  // 20 dias recentes com viés +0.5 e histórico −1.5, peso 20: média = −0.5
  const c = correcaoTemperatura({ viesTmax: 0.5, amostrasTmax: 20 }, { tmax: -1.5, tmin: null });
  assert.ok(Math.abs(c.tmax + 0.5) < 1e-9);
  // sem histórico: comportamento original (encolhe em direção a zero)
  assert.ok(Math.abs(correcaoTemperatura({ viesTmax: 2, amostrasTmax: 10 }).tmax - 1) < 1e-9);
});

test('série horária corrigida: máxima e mínima do dia batem exatamente com a correção diária', () => {
  const p = previsaoTeste();
  const c = calibrarPrevisao(p, { calib: CALIB, aprendizado: null, refMs: p.horas[0] });
  const idx = indicesDoDia(c.horas, '2026-01-10', c.offset);
  const r = resumoModeloDia(c, 'ecmwf_ifs', idx);
  assert.equal(r.tmax, 31.5); // 30 − (−1,5)
  assert.equal(r.tmin, 19.5); // 20 − 0,5
  assert.equal(c.modelos.ecmwf_ifs.vars.wind_gusts_10m[5], 40);  // 50 × 0,8
  assert.equal(c.modelos.ecmwf_ifs.vars.wind_speed_10m[5], 20);  // vento reprovado: sem mudança
  assert.ok(c.atual.temp.ecmwf_ifs > p.atual.temp.ecmwf_ifs);    // "agora" previsto acompanha a correção
  assert.equal(p.modelos.ecmwf_ifs.vars.wind_gusts_10m[5], 50);  // original intacto
  // gráfico (consenso horário) e resumo do dia leem a mesma série: nenhuma tela diverge
  assert.equal(Math.max(...consensoHorario(c, 'wind_gusts_10m', ['ecmwf_ifs']).med), r.rajada.valor);
});

test('cenários: rajada dos membros recebe o fator do modelo de mesma origem', () => {
  const p = previsaoTeste();
  const ens = { ecmwf_ifs025: { horas: p.horas, membros: { precipitation: [], wind_gusts_10m: [p.horas.map(() => 60)] } },
    ecmwf_aifs025_ensemble: { horas: p.horas, membros: { precipitation: [], wind_gusts_10m: [] } } };
  const c = calibrarEnsemble(ens, CALIB, p.horas[0], p.offset);
  assert.equal(c.ecmwf_ifs025.membros.wind_gusts_10m[0][3], 42);
  assert.equal(c.ecmwf_aifs025_ensemble, ens.ecmwf_aifs025_ensemble);
});

test('pesos: histórico ajusta o ponto de partida dentro dos limites', () => {
  const mods = ['ecmwf_ifs', 'ecmwf_aifs025_single', 'ukmo_global_deterministic_10km'];
  const sem = pesosModelos(null, mods).pesos, com = pesosModelos(null, mods, { pesos: CALIB.pesos, dias: 300 });
  assert.ok(com.pesos.ecmwf_ifs >= sem.ecmwf_ifs && com.pesos.ecmwf_aifs025_single < sem.ecmwf_aifs025_single);
  assert.equal(com.historico, true);
  assert.ok(Object.values(com.pesos).every((w) => w >= 0.7 && w <= 1.3));
});

test('METAR da IEM: °F → °C, nós → km/h, rajada só quando informada', async () => {
  const { lerCsvIem, diasLocais: dias } = await import('../scripts/lib/inmet.mjs');
  const csv = 'station,valid,tmpf,sknt,gust\nSBCO,2025-01-01 03:00,68.00,10.00,M\nSBCO,2025-01-01 04:00,M,5.00,25.00\n';
  const h = lerCsvIem(csv);
  assert.equal(h.length, 2);
  assert.equal(h[0].temp, 20);
  assert.equal(h[0].vento, 18.5);
  assert.equal(h[0].rajada, 18.5);   // sem rajada: vale o vento médio
  assert.equal(h[1].rajada, 46.3);
  assert.equal(h[1].temp, null);
  // 18 horas distintas bastam no METAR; leituras especiais na mesma hora não contam duas vezes
  const muitas = Array.from({ length: 18 }, (_, k) => ({ ms: Date.UTC(2025, 0, 2, 3 + k), temp: 20 + k / 2, chuva: null, rajada: 20, vento: 10 }));
  muitas.push({ ...muitas[0], ms: muitas[0].ms + 1800000 });
  const d = dias(muitas, -3, { minHoras: 18 }).get('2025-01-02');
  assert.equal(d.horas, 18);
  assert.equal(d.tmax, 28.5);
  assert.equal(d.chuva, null);
});

// ------------------------------------------------------------------ temperatura hora a hora

import { seriesPorHora, obsPorHora, diasHorarios, ajustarHorario, validarHorario, ajusteFinal } from '../scripts/lib/temperatura-horaria.mjs';
import { temperaturaHoraria, prepararCorrecaoDia } from '../js/analise.js';

// Viés sintético do modelo por hora do dia: frio demais à tarde (−3 °C às 15 h), quente de madrugada (+1 °C).
const viesSint = (h) => -3 * Math.max(0, Math.sin((h - 9) / 12 * Math.PI)) + (h < 6 ? 1 : 0);
function horarioSintetico(dias, comLeads) {
  const t = { dias: {} }, diario = { dias: {} };
  for (let k = 0; k < dias; k++) {
    const d = new Date(Date.UTC(2024, 0, 1) + k * 86400000).toISOString().slice(0, 10);
    const ruido = (h) => ((k * 7 + h * 13) % 11 - 5) / 10; // determinístico, média ~0
    const o = Array.from({ length: 24 }, (_, h) => 18 + 8 * Math.max(0, Math.sin((h - 7) / 14 * Math.PI)) + ruido(h));
    const prev = o.map((v, h) => Math.round((v + viesSint(h) + ruido(23 - h)) * 10) / 10);
    t.dias[d] = { o, ecmwf_ifs: { h0: prev, ...(comLeads ? { p1: prev } : {}) } };
    diario.dias[d] = { obs: { tmax: Math.max(...o) + 0.4, tmin: Math.min(...o) - 0.3 } };
  }
  return { t, diario };
}

test('hora a hora: resposta da Open-Meteo e medições viram 24 valores por dia local', () => {
  const j = { hourly: { time: ['2026-01-10T00:00', '2026-01-10T15:00'], temperature_2m_previous_day1: [20.04, 28.96] } };
  const s = seriesPorHora(j, { p1: 'temperature_2m_previous_day1' });
  assert.equal(s['2026-01-10'].p1[15], 29);
  assert.equal(s['2026-01-10'].p1[3], null);
  const o = obsPorHora([{ ms: Date.UTC(2026, 0, 10, 18), temp: 27.5 }, { ms: Date.UTC(2026, 0, 11, 2), temp: 21 }]);
  assert.equal(o['2026-01-10'][15], 27.5); // 18 UTC = 15 h local
  assert.equal(o['2026-01-10'][23], 21);   // 02 UTC do dia seguinte = 23 h local
});

test('hora a hora: recupera o viés de cada hora e vence o método diário fora da amostra', () => {
  const { t, diario } = horarioSintetico(400, true);
  const d0 = diasHorarios(t, 'ecmwf_ifs', 'h0', diario), d1 = diasHorarios(t, 'ecmwf_ifs', 'p1', diario);
  assert.equal(d1.length, 400);
  const aj = ajustarHorario(d1, ajustarHorario(d0));
  assert.ok(Math.abs(aj.porEstacao.verao[15] - viesSint(15)) < 0.2);
  assert.ok(Math.abs(aj.porEstacao.inverno[3] - 1) < 0.2);
  // método diário de comparação: corrige a máxima pelo viés médio da máxima (sem saber a hora)
  const v = validarHorario(d1, d0, () => () => ({ tmax: -2.6, tmin: 0.9 }));
  assert.ok(v.horaria.horaria.mae < v.horaria.diaria.mae && v.horaria.diaria.mae < v.horaria.bruta.mae);
  assert.ok(v.tmax.horaria.mae < 0.3); // o ajuste residual da máxima pega o pico entre duas horas
  assert.equal(v.usar, true);
  const fim = ajusteFinal(d1, d0);
  assert.equal(fim.vies.verao.length, 24);
  assert.ok(fim.pico.tmax.verao < 0); // máxima medida (hora anterior) acima da leitura da hora cheia
});

test('hora a hora no app: mesma conta do script, máxima do gráfico = máxima do dia', () => {
  const vh = Array.from({ length: 24 }, (_, h) => Math.round(viesSint(h) * 100) / 100);
  const calib = { ...CALIB, temperaturaHoraria: { modelos: { ecmwf_ifs: { leads: { 1: { usar: true, vies: { verao: vh, outono: vh, inverno: vh, primavera: vh }, pico: { tmax: { verao: -0.4 }, tmin: { verao: 0.3 } } }, 2: { usar: false, vies: { verao: vh } } } } } } };
  assert.ok(temperaturaHoraria(calib, 'ecmwf_ifs', 1, 1));
  assert.equal(temperaturaHoraria(calib, 'ecmwf_ifs', 2, 1), null);          // reprovado
  assert.equal(temperaturaHoraria(calib, 'ukmo_global_deterministic_10km', 1, 1), null);
  const p = previsaoTeste();
  const c = calibrarPrevisao(p, { calib, aprendizado: null, refMs: p.horas[0] });
  const bruta = p.modelos.ecmwf_ifs.vars.temperature_2m, nova = c.modelos.ecmwf_ifs.vars.temperature_2m;
  const f = prepararCorrecaoDia(bruta, bruta.map((_, h) => h), vh, { tmax: -0.4, tmin: 0.3 });
  assert.deepEqual(nova, bruta.map((v, h) => f(v, h)));
  assert.ok(nova[15] - bruta[15] > 2.5);                                    // tarde sobe ~3 °C
  assert.deepEqual(c.calibracao.temperaturaHoraria, ['ecmwf_ifs']);
  const r = resumoModeloDia(c, 'ecmwf_ifs', indicesDoDia(c.horas, '2026-01-10', c.offset));
  assert.equal(r.tmax, Math.max(...nova));
  assert.equal(c.atual.temp.ecmwf_ifs, nova[15]);                           // "agora" com a mesma correção
});

// ------------------------------------------------------------------ chuva: mapeamento de quantis

import { ajustarChuva, validarChuva, quantis } from '../scripts/lib/chuva.mjs';
import { mapearChuva, calibrarChuvaSerie, tabelaChuva } from '../js/analise.js';

test('chuva: mapeamento de quantis tira a garoa falsa e mantém a ordem', () => {
  const tab = { p: [0, 0.5, 2, 10, 40], o: [0, 0, 1, 8, 30] };
  assert.equal(mapearChuva(0.4, tab), 0);          // garoa prevista vira zero
  assert.equal(mapearChuva(6, tab), 4.5);          // entre 2→1 e 10→8
  assert.equal(mapearChuva(80, tab), 60);          // acima da tabela: mesma razão do topo
  assert.equal(mapearChuva(0, tab), 0);
  assert.ok(mapearChuva(5, tab) < mapearChuva(7, tab));
  // série horária: horas escaladas na proporção do total do dia
  const serie = [1, 2, 3, 0, 0.2, 0.2];
  const idx = new Map([['2026-01-10', [0, 1, 2]], ['2026-01-11', [3, 4, 5]]]);
  const nova = calibrarChuvaSerie(serie, idx, () => tab);
  assert.deepEqual(nova.slice(0, 3), [0.75, 1.5, 2.25]); // 6 mm → 4,5 mm
  assert.deepEqual(nova.slice(3), [0, 0, 0]);
  const calib = { modelos: { ecmwf_ifs: { chuvaQuantis: { usar: true, tabela: { verao: tab } } }, ukmo_global_deterministic_10km: { chuvaQuantis: { usar: false, tabela: { verao: tab } } } } };
  assert.equal(tabelaChuva(calib, 'ecmwf_ifs', 1), tab);
  assert.equal(tabelaChuva(calib, 'ukmo_global_deterministic_10km', 1), null);
});

test('chuva: modelo que chove demais fica com a frequência certa fora da amostra', () => {
  const ps = [];
  for (let k = 0; k < 730; k++) {
    const d = new Date(Date.UTC(2024, 0, 1) + k * 86400000).toISOString().slice(0, 10);
    const obs = k % 4 === 0 ? 2 + (k % 13) : 0;                 // chove 1 dia em 4
    const prev = obs ? obs * 1.3 : (k % 4 === 1 ? 1.5 : 0.2);     // mais um dia de chuva falsa a cada 4
    ps.push({ data: d, mes: d.slice(0, 7), estacao: 'verao', lead: 1, prev, obs });
  }
  assert.equal(quantis([3, 1, 2], 3).join(), '1,2,3');
  assert.ok(ajustarChuva(ps));
  const v = validarChuva(ps);
  assert.ok(v.total.antes.viesFrequencia > 1.9 && Math.abs(v.total.depois.viesFrequencia - 1) < 0.1);
  assert.ok(v.total.depois.acerto > v.total.antes.acerto);
  assert.equal(v.usar, true);
});

// ------------------------------------------------------------------ orvalho e sensação térmica

import { calibrarOrvalho, conferirSensacao } from '../scripts/lib/sensacao.mjs';
import { sensacaoTermica, pressaoVapor, umidadeESensacao } from '../js/analise.js';

test('sensação térmica: fórmula de Steadman/BoM, igual para medida e prevista', () => {
  // 30 °C, orvalho 24 °C (abafado), vento 10 km/h: e ≈ 29,9 hPa → 30 + 9,9 − 1,9 − 4 ≈ 33,9
  assert.equal(sensacaoTermica(30, pressaoVapor(24), 10), 33.9);
  assert.ok(sensacaoTermica(10, pressaoVapor(5), 30) < 5);     // frio com vento: sensação bem abaixo
  assert.equal(sensacaoTermica(null, 10, 5), null);
});

test('sensação prevista segue a temperatura e o vento corrigidos; umidade coerente com o orvalho', () => {
  const locais = Array.from({ length: 3 }, (_, h) => ({ hora: 15 + h, mes: 1 }));
  const brutas = { temperature_2m: [26, 27, 28], dew_point_2m: [20, 20, 20], relative_humidity_2m: [70, 66, 63], apparent_temperature: [99, 99, 99] };
  const vars = { ...brutas, temperature_2m: [28, 29, 30], wind_speed_10m: [6, 6, 6] };
  umidadeESensacao(vars, brutas, locais, null, 'ecmwf_ifs');
  assert.equal(vars.apparent_temperature[0], sensacaoTermica(28, pressaoVapor(20), 6));
  assert.ok(vars.relative_humidity_2m[0] < 70);                 // mais quente com o mesmo vapor: umidade menor
  const vh = Array(24).fill(-2);                                // modelo seca demais o ar: orvalho sobe 2 °C
  const calib = { orvalhoHorario: { modelos: { ecmwf_ifs: { usar: true, vies: { verao: vh, outono: vh, inverno: vh, primavera: vh } } } } };
  const v2 = { ...brutas, temperature_2m: [28, 29, 30], wind_speed_10m: [6, 6, 6] };
  assert.equal(umidadeESensacao(v2, brutas, locais, calib, 'ecmwf_ifs'), true);
  assert.equal(v2.dew_point_2m[0], 22);
  assert.ok(v2.apparent_temperature[0] > vars.apparent_temperature[0]);
});

test('orvalho hora a hora e conferência da sensação com dados sintéticos', () => {
  const horario = { dias: {} };
  for (let k = 0; k < 200; k++) {
    const d = new Date(Date.UTC(2025, 0, 1) + k * 86400000).toISOString().slice(0, 10);
    const o = Array.from({ length: 24 }, (_, h) => 20 + 6 * Math.max(0, Math.sin((h - 7) / 14 * Math.PI)));
    const od = o.map(() => 17 + ((k * 3) % 5) / 5), ow = o.map(() => 8);
    horario.dias[d] = { o, od, ow, ecmwf_ifs: { p1: o.map((v) => v - 1), d1: od.map((v) => v - 1.5), w1: ow.map((v) => v / 0.6) } };
  }
  const orv = calibrarOrvalho(horario, 'ecmwf_ifs');
  assert.equal(orv.usar, true);
  assert.ok(Math.abs(orv.vies.verao[12] + 1.5) < 0.05);
  const c = conferirSensacao(horario, 'ecmwf_ifs', { orvalho: orv.porDia, fatorVento: () => 0.6 });
  assert.ok(c.hora.corrigida.mae < c.hora.bruta.mae);
});
