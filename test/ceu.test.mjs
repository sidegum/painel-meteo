// Testes do céu (js/ceu.js) contra fatos astronômicos publicados. Rodar: node --test test/ceu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/ceu.js';

const CAMPO_BOM = C.observador(-29.67, -51.06, 0);
const perto = (v, alvo, tol, msg) => assert.ok(Math.abs(v - alvo) <= tol, `${msg}: ${v} (esperado ${alvo} ± ${tol})`);

test('equinócio de março de 2026 (20/03 14:46 UTC): Sol a pino no equador', () => {
  perto(C.pontoSob('Sun', Date.parse('2026-03-20T14:46:00Z')).lat, 0, 0.01, 'latitude do ponto subsolar');
});

test('solstício de junho de 2026 (21/06 08:24 UTC): Sol a pino no Trópico de Câncer', () => {
  perto(C.pontoSob('Sun', Date.parse('2026-06-21T08:24:00Z')).lat, 23.44, 0.01, 'latitude do ponto subsolar');
});

test('Gemínidas: longitude solar do pico (262,2°) cai em 14/12', () => {
  perto(C.longitudeSolar(Date.parse('2026-12-14T12:00:00Z')), 262.2, 0.6, 'longitude solar');
});

test('estrelas: circumpolares e passagem pelo meridiano em Campo Bom', () => {
  const t = Date.parse('2026-11-05T22:00:00Z');
  assert.equal(C.infoEstrela(37.95, 89.26, CAMPO_BOM, t).sempre, 'abaixo'); // Polaris nunca aparece no Sul
  assert.equal(C.infoEstrela(186.65, -63.1, CAMPO_BOM, t).sempre, 'acima'); // Acrux nunca se põe a 29,7°S
  const sirius = C.infoEstrela(101.287, -16.716, CAMPO_BOM, t);
  assert.equal(sirius.sempre, null);
  perto(sirius.culmina.altura, 90 - Math.abs(-29.67 - -16.716), 0.3, 'altura máxima de Sirius');
  assert.ok(sirius.nasce && sirius.poe);
});

test('temperatura pela cor: Sol (B−V 0,65) perto de 5.780 K', () => {
  perto(C.temperaturaCor(0.65), 5780, 150, 'temperatura');
});

test('eclipse lunar de 28/08/2026 visível do Rio Grande do Sul; o de 03/03/2026 não (Lua abaixo do horizonte)', () => {
  const ev = C.proximosEventos(CAMPO_BOM, Date.parse('2026-02-25T00:00:00Z'), 10).filter((e) => e.tipo === 'eclipse' && /lunar/i.test(e.titulo));
  assert.ok(ev.length >= 1);
  assert.equal(new Date(ev[0].ms).toISOString().slice(0, 10), '2026-08-28');
});

test('rumos em português', () => {
  assert.equal(C.rumo(0), 'norte');
  assert.equal(C.rumo(135), 'sudeste');
  assert.equal(C.rumo(359), 'norte');
  assert.equal(Object.keys(C.CONSTELACOES).length, 88);
});

test('onde olhar: direção e altura batem com a posição do planeta no horário indicado', () => {
  const local = { lat: -29.67, lon: -51.06 };
  const agora = Date.parse('2026-11-05T21:00:00Z');
  const r = C.resumoDoCeu(local, agora, { offsetS: -10800 });
  const planeta = r.itens.find((i) => i.tipo === 'planeta');
  assert.ok(planeta, 'algum planeta visível na noite');
  const o = C.ondeOlhar(planeta, local, agora, -10800);
  const p = C.posicaoNoCeu(planeta.corpo, CAMPO_BOM, o.ms);
  perto(o.altura, p.altura, 0.01, 'altura');
  perto(o.azimute, p.azimute, 0.01, 'azimute');
  assert.match(o.instrucao, new RegExp(`para o ${C.rumo(p.azimute)}`));
  if (o.referencia) assert.ok(o.referencia.sep <= 30 && o.referencia.altura >= 5, 'referência perto e acima do horizonte');
});

test('referências: Sirius e Ácrux nas posições do catálogo (Sirius cruza o meridiano de Campo Bom a ~77°)', () => {
  const s = C.REFERENCIAS.find((r) => r[0] === 'Sirius');
  perto(C.infoEstrela(s[1], s[2], CAMPO_BOM, Date.parse('2026-01-01T00:00:00Z')).culmina.altura, 77.06, 0.1, 'altura de Sirius no meridiano');
  assert.ok(C.REFERENCIAS.some((r) => r[0] === 'Cruzeiro do Sul'));
});
