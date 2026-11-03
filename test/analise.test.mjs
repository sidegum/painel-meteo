// Testes das regras de análise. Rodar: node --test test/analise.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDia, mediana, escolherFonte, leituraValida, fraseDoDia, pesosModelos, probLimites, isoLocalParaMs, partesLocais, direcaoTexto, arredondaCoord } from '../js/analise.js';

const r = (modelo, chuva, rajada) => ({ modelo, chuva, probMax: null, rajada: rajada === null ? null : { valor: rajada }, tmin: 15, tmax: 25 });

test('exemplo da especificação: ECMWF 18, ICON 15, GFS 3 -> chuva provável, volume incerto', () => {
  const av = avaliarDia([r('ecmwf_ifs', 18, 50), r('dwd_icon_global', 15, 48), r('ncep_gfs_seamless', 3, 52)], null);
  assert.equal(av.mensagemChuva, 'chuva provável, volume incerto');
  assert.equal(av.volumeIncerto, true);
  assert.notEqual(av.confianca.chuva, 'alta');
  assert.equal(av.volume.mediana, 15); // não é a média de 12 mm
  assert.deepEqual([av.volume.min, av.volume.max], [3, 18]);
});

test('modelos concordantes -> confiança alta', () => {
  const av = avaliarDia([r('ecmwf_ifs', 10, 40), r('dwd_icon_global', 11, 42), r('ncep_gfs_seamless', 9, 41)], null);
  assert.equal(av.confianca.geral, 'alta');
  assert.equal(av.mensagemChuva, 'chuva provável');
});

test('discordância sobre chover reduz a confiança', () => {
  const av = avaliarDia([r('ecmwf_ifs', 12, 30), r('dwd_icon_global', 0, 30), r('ncep_gfs_seamless', 0.2, 30)], null);
  assert.equal(av.confianca.chuva, 'baixa');
});

test('ensemble manda na probabilidade quando existe', () => {
  const membros = { chuva: [...Array(30).fill(0), ...Array(21).fill(5)], rajada: Array(51).fill(45), modelos: ['ecmwf_ifs025'] };
  const av = avaliarDia([r('ecmwf_ifs', 5, 45), r('ncep_gfs_seamless', 6, 44)], membros);
  assert.equal(Math.round(av.prob * 100), 41);
  assert.match(av.fonteProb, /51 cenários/);
  assert.ok(av.confianca.motivos.some((m) => /divididos/.test(m)));
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
