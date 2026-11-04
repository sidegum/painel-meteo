// Testes das regras de análise. Rodar: node --test test/analise.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDia, mediana, escolherFonte, leituraValida, fraseDoDia, pesosModelos, probLimites, isoLocalParaMs, partesLocais, direcaoTexto, arredondaCoord, condicaoCeu, respostaChuva } from '../js/analise.js';

const r = (modelo, chuva, rajada) => ({ modelo, chuva, probMax: null, rajada: rajada === null ? null : { valor: rajada }, tmin: 15, tmax: 25 });

test('exemplo da especificação: ECMWF 18, ICON 15, GFS 3 -> chuva provável, volume incerto', () => {
  const av = avaliarDia([r('ecmwf_ifs', 18, 50), r('dwd_icon_global', 15, 48), r('ncep_gfs_seamless', 3, 52)], null);
  assert.equal(av.mensagemChuva, 'chuva provável, volume incerto');
  assert.equal(av.volumeIncerto, true);
  // os três concordam que chove: a ocorrência é confiável; o volume vai como faixa, sem rebaixar
  assert.equal(av.confianca.chuva, 'alta');
  assert.equal(av.volume.mediana, 15); // não é a média de 12 mm
  assert.deepEqual([av.volume.min, av.volume.max], [3, 18]);
});

test('modelos concordantes -> confiança alta', () => {
  const av = avaliarDia([r('ecmwf_ifs', 10, 40), r('dwd_icon_global', 11, 42), r('ncep_gfs_seamless', 9, 41)], null);
  assert.equal(av.confianca.geral, 'alta');
  assert.equal(av.mensagemChuva, 'chuva provável');
});

test('discordância sobre chover sem cenários reduz um nível', () => {
  const av = avaliarDia([r('ecmwf_ifs', 12, 30), r('dwd_icon_global', 0, 30), r('ncep_gfs_seamless', 0.2, 30)], null);
  assert.equal(av.confianca.chuva, 'média');
});

test('sistemas de cenários que concordam dão confiança alta mesmo com chance de 30%', () => {
  const ens = (n, molhados) => [...Array(n - molhados).fill(0), ...Array(molhados).fill(4)];
  const a = ens(51, 15), b = ens(18, 6);
  const membros = { chuva: [...a, ...b], rajada: Array(69).fill(30), modelos: ['x', 'y'], porModelo: { x: a, y: b } };
  const av = avaliarDia([r('ecmwf_ifs', 2, 30), r('ukmo_global_deterministic_10km', 0, 30)], membros);
  assert.equal(Math.round(av.prob * 100), 31);
  assert.equal(av.confianca.geral, 'alta');
  const c = ens(51, 32);
  const m2 = { chuva: [...a, ...c], rajada: Array(102).fill(30), modelos: ['x', 'y'], porModelo: { x: a, y: c } };
  assert.equal(avaliarDia([r('ecmwf_ifs', 2, 30)], m2).confianca.chuva, 'média');
});

test('ensemble manda na probabilidade quando existe', () => {
  const membros = { chuva: [...Array(30).fill(0), ...Array(21).fill(5)], rajada: Array(51).fill(45), modelos: ['ecmwf_ifs025'] };
  const av = avaliarDia([r('ecmwf_ifs', 5, 45), r('ncep_gfs_seamless', 6, 44)], membros);
  assert.equal(Math.round(av.prob * 100), 41);
  assert.match(av.fonteProb, /51 cenários/);
  assert.ok(av.confianca.motivos.some((m) => /direções opostas/.test(m))); // os 2 modelos chovem, só 41% dos cenários
});

test('valor ausente não vira zero', () => {
  const av = avaliarDia([r('ecmwf_ifs', null, null), r('ncep_gfs_seamless', null, null)], null);
  assert.equal(av.prob, null);
  assert.equal(av.volume, null);
  assert.equal(av.confianca.geral, 'baixa');
  assert.equal(mediana([null, undefined, NaN]), null);
});

test('limites semanais sem ensemble são concordância', () => {
  const l = probLimites([r('a', 12, 65), r('b', 0, 30)], null);
  assert.equal(l.origem, 'concordância entre modelos');
  assert.equal(l.chuva[1].p, 0.5);
  assert.equal(l.rajada[1].p, 0.5);
});

test('pesos iguais até 30 dias, depois ajuste moderado', () => {
  assert.equal(pesosModelos({ a: { dias: 10, maeChuva: 1 }, b: { dias: 10, maeChuva: 9 } }, ['a', 'b']).ajustado, false);
  const p = pesosModelos({ a: { dias: 40, maeChuva: 1 }, b: { dias: 40, maeChuva: 9 } }, ['a', 'b']);
  assert.ok(p.ajustado && p.pesos.a <= 1.3 && p.pesos.b >= 0.7);
});

test('estação: descarta 9999, antiga e escolhe a mais próxima válida', () => {
  const agora = Date.UTC(2026, 10, 3, 20);
  const f = (id, lat, valor, idadeMin) => ({ id, nome: id, lat, lon: -51.05, leituras: { temperatura: { valor, ms: agora - idadeMin * 60000 } } });
  const e = escolherFonte([f('perto-invalida', -29.68, 9999, 5), f('perto-antiga', -29.69, 25, 400), f('media', -29.8, 26, 20), f('longe', -30.2, 27, 10)], 'temperatura', -29.68, -51.05, agora, 180);
  assert.equal(e.escolhida.fonte.id, 'media');
  assert.equal(e.outras.length, 3);
  assert.ok(!leituraValida('umidade', 120));
});

test('frase do dia', () => {
  const av = { prob: 0.85, rajada: { mediana: 65 } };
  const off = -10800;
  const ini = isoLocalParaMs('2026-11-03T14:00', off), fim = isoLocalParaMs('2026-11-03T17:00', off);
  assert.equal(fraseDoDia(av, { ini, fim }, off), 'Chuva à tarde, com rajadas fortes');
  assert.equal(fraseDoDia({ prob: 0.05, rajada: { mediana: 20 } }, null, off), 'Sem chuva prevista, vento fraco');
});

test('tempo local e utilidades', () => {
  const ms = isoLocalParaMs('2026-11-03T00:00', -10800);
  assert.equal(new Date(ms).toISOString(), '2026-11-03T03:00:00.000Z');
  assert.equal(partesLocais(ms, -10800).hora, 0);
  assert.equal(direcaoTexto(135), 'SE');
  assert.equal(arredondaCoord(-29.678912), -29.68);
});

test('condição do céu a partir da cobertura de nuvens', () => {
  assert.equal(condicaoCeu([10, 15, 5], [1, 1, 1], 0.05).texto, 'Ensolarado');
  assert.equal(condicaoCeu([10, 15, 5], [0, 0, 0], 0.05).texto, 'Céu limpo');
  assert.equal(condicaoCeu([30, 40, 35], [1, 1, 1], 0.1).texto, 'Sol entre nuvens');
  assert.equal(condicaoCeu([60, 70], [1, 1], null).texto, 'Parcialmente nublado');
  assert.equal(condicaoCeu([90, 95], [1, 1], 0.8).texto, 'Nublado com chuva');
  assert.equal(condicaoCeu([90, 95], [1, 1], 0.5).texto, 'Nublado, pode chover');
  // só as horas de dia contam quando existem
  assert.equal(condicaoCeu([100, 100, 5, 5], [0, 0, 1, 1], 0).nivel, 'limpo');
  // sem dado não vira zero
  assert.equal(condicaoCeu([null, null], [1, 1], 0.2), null);
  assert.equal(condicaoCeu([], [], 0.2), null);
});

test('resposta curta de chuva', () => {
  assert.equal(respostaChuva(0.8), 'Vai chover');
  assert.equal(respostaChuva(0.5), 'Pode chover');
  assert.equal(respostaChuva(0.2), 'Chuva pouco provável');
  assert.equal(respostaChuva(0.05), 'Não deve chover');
  assert.equal(respostaChuva(null), null);
});

test('pesos iniciais favorecem ECMWF e UKMO sem dados locais', () => {
  const p = pesosModelos(null, ['ecmwf_ifs', 'ukmo_global_deterministic_10km', 'outro']);
  assert.equal(p.ajustado, false);
  assert.ok(p.pesos.ecmwf_ifs > p.pesos.ukmo_global_deterministic_10km && p.pesos.ukmo_global_deterministic_10km > p.pesos.outro);
  // acerto local ruim do ECMWF reduz o peso, sem passar do limite
  const q = pesosModelos({ ecmwf_ifs: { dias: 40, maeChuva: 9 }, ncep_gfs_seamless: { dias: 40, maeChuva: 1 } }, ['ecmwf_ifs', 'ncep_gfs_seamless']);
  assert.ok(q.ajustado && q.pesos.ecmwf_ifs >= 0.7 && q.pesos.ncep_gfs_seamless <= 1.3);
});

test('radar: pixel do ponto no quadro de zoom 7', async () => {
  const { pixelDoPonto } = await import('../js/dados.js');
  const t = pixelDoPonto(-29.68, -51.05);
  assert.deepEqual([t.z, t.x, t.y], [7, 45, 75]);
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
});
