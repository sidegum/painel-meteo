// Testes da cosmologia (js/cosmologia.js) contra a integração direta e os valores publicados do Planck 2018.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/cosmologia.js';

/** Integração direta, lenta, sem tabela (Simpson com 200 mil passos em z). */
function direto(f, z0, z1, n = 200000) {
  const h = (z1 - z0) / n; let s = f(z0) + f(z1);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(z0 + i * h);
  return s * h / 3;
}

test('idade do universo bate com o Planck 2018 (13,787 ± 0,020 bilhões de anos)', () => {
  assert.ok(Math.abs(C.IDADE - 13.787) < 0.02, `idade ${C.IDADE}`);
});

test('horizonte de partículas e casca da radiação cósmica de fundo (~46 e ~45 bilhões de anos-luz)', () => {
  const horizonte = C.HORIZONTE_MPC * C.AL_POR_MPC / 1e9, cmb = C.DIST_CMB_MPC * C.AL_POR_MPC / 1e9;
  assert.ok(horizonte > 45.9 && horizonte < 46.6, `horizonte ${horizonte}`);
  assert.ok(cmb > 45.0 && cmb < 45.6, `cmb ${cmb}`);
  assert.ok(C.idadeEm(C.Z_CMB) * 1e9 > 3.6e5 && C.idadeEm(C.Z_CMB) * 1e9 < 3.9e5, 'a radiação de fundo saiu ~380 mil anos depois do Big Bang');
});

test('distância comóvel e tempo da luz da tabela concordam com a integração direta (< 0,01%)', () => {
  for (const z of [0.001, 0.0233, 0.158, 1, 2.219, 7.64, 14.32]) {
    const dc = C.DH_MPC * direto((x) => 1 / C.E(x), 0, z);
    const tl = C.TH_GANOS * direto((x) => 1 / ((1 + x) * C.E(x)), 0, z);
    assert.ok(Math.abs(C.distanciaComovel(z) / dc - 1) < 1e-4, `Dc(${z}) ${C.distanciaComovel(z)} vs ${dc}`);
    assert.ok(Math.abs(C.tempoDaLuz(z) / tl - 1) < 1e-4, `tL(${z}) ${C.tempoDaLuz(z)} vs ${tl}`);
  }
});

test('perto de nós vale a lei de Hubble (Dc ≈ cz/H0)', () => {
  const z = 0.001;
  assert.ok(Math.abs(C.distanciaComovel(z) / (C.C_KMS * z / C.H0) - 1) < 1e-3);
});

test('zDaDistancia inverte distanciaComovel', () => {
  for (const z of [0.01, 0.5, 3, 20, 1000]) assert.ok(Math.abs(C.zDaDistancia(C.distanciaComovel(z)) / z - 1) < 1e-6, `z ${z}`);
  assert.equal(C.zDaDistancia(0), 0);
  assert.equal(C.zDaDistancia(C.HORIZONTE_MPC * 2), Infinity);
});
