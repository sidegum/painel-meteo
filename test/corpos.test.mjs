// Testes dos corpos do sistema solar (js/globo-corpos.js) contra valores publicados. Rodar: node --test test/corpos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../vendor/astronomy/astronomy.min.js';
import * as K from '../js/globo-corpos.js';

const perto = (v, alvo, tol, msg) => assert.ok(Math.abs(v - alvo) <= tol, `${msg}: ${v} (esperado ${alvo} ± ${tol})`);
const T = Date.parse('2026-11-05T18:00:00Z');
const dist = (p) => Math.hypot(p.x, p.y, p.z);

test('Lua entre o perigeu e o apogeu; Io e Calisto na distância média publicada', () => {
  const d = dist(K.posicaoLua('lua', T));
  assert.ok(d > 356000 && d < 407000, `Lua a ${d} km`);
  perto(dist(K.posicaoLua('io', T)), 421700, 3000, 'Io (km)');
  perto(dist(K.posicaoLua('calisto', T)), 1882700, 25000, 'Calisto (km)');
});

test('Kepler: periélio, afélio e período de uma órbita de 1 UA', () => {
  const el = { a: 1, e: 0.2, i: 10, om: 30, w: 40, ma: 0, epoca: T };
  perto(dist(K.posicaoKepler(el, T)), 0.8, 1e-9, 'distância no periélio (UA)');
  const o = K.dadosOrbita(el);
  perto(o.periodoDias, 365.2569, 0.01, 'período (dias)');
  perto(dist(K.posicaoKepler(el, T + o.periodoDias / 2 * 86400000)), 1.2, 1e-6, 'distância no afélio (UA)');
  perto(dist(K.pontosOrbita(el, 8)[0]), 0.8, 1e-9, 'primeiro ponto da órbita no periélio');
  assert.equal(K.posicaoKepler({ ...el, e: 1.2 }, T), null);
});

test('Terra: meridiano de Greenwich voltado para o tempo sideral (rotação da IAU)', () => {
  const m = K.orientacao('Earth', T).meridiano, e = 23.4392911 * Math.PI / 180;
  const ra = (Math.atan2(m.y * Math.cos(e) - m.z * Math.sin(e), m.x) * 180 / Math.PI + 360) % 360;
  perto(ra, A.SiderealTime(new Date(T)) * 15, 0.5, 'ascensão reta do meridiano principal (°)');
});

test('Urano: eixo deitado, a 82° do polo da eclíptica (inclinação de 97,8° com rotação retrógrada)', () => {
  perto(Math.acos(K.poloEcliptica('Uranus').z) * 180 / Math.PI, 82.2, 1, 'ângulo do polo (°)');
  perto(Math.acos(K.poloEcliptica('Earth').z) * 180 / Math.PI, 23.44, 0.01, 'obliquidade da Terra (°)');
});

test('planetas anões oficiais da IAU', () => {
  assert.deepEqual([...K.ANOES_IAU].sort(), ['ceres', 'eris', 'haumea', 'makemake']);
});
