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
