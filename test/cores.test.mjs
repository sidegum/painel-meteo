// Cores do painel (bloco no começo do app.css): os dois temas definem as mesmas variáveis, o texto colorido é legível
// sobre as três superfícies e nenhuma cor de informação é forte demais (a regra é cor discreta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** Variáveis em #RRGGBB declaradas no bloco do seletor dado. */
function variaveis(seletor) {
  const ini = css.indexOf(`${seletor} {`);
  assert.ok(ini >= 0, `bloco ${seletor} não encontrado no app.css`);
  const bloco = css.slice(ini, css.indexOf('\n}', ini));
  return Object.fromEntries([...bloco.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
}

const canais = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminancia = (hex) => { const [r, g, b] = canais(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Saturação HSL, de 0 (cinza) a 1 (cor pura). */
const saturacao = (hex) => { const c = canais(hex), max = Math.max(...c), min = Math.min(...c), l = (max + min) / 2; return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1)); };

const TEMAS = { escuro: variaveis(':root'), claro: variaveis(':root[data-tema="claro"]') };
const SUPERFICIES = ['--fundo', '--sup', '--sup2'];
const TEXTO = ['--texto', '--fraco', '--chuva-txt', '--rajada-txt', '--fria', '--quente', '--m-ecmwf', '--m-aifs', '--m-ukmo', '--m-gfs', '--m-icon'];
const NEUTRAS = new Set([...SUPERFICIES, '--linha', '--texto', '--fraco', '--foco', '--ponto', '--mapa-local']);

test('os dois temas definem as mesmas cores', () => {
  assert.deepEqual(Object.keys(TEMAS.claro).sort(), Object.keys(TEMAS.escuro).sort());
});

for (const [nome, v] of Object.entries(TEMAS)) {
  test(`tema ${nome}: texto colorido com contraste de pelo menos 4,5:1 nas três superfícies`, () => {
    for (const t of TEXTO) for (const s of SUPERFICIES) {
      const c = contraste(v[t], v[s]);
      assert.ok(c >= 4.5, `${t} sobre ${s}: ${c.toFixed(2)}:1`);
    }
  });
  test(`tema ${nome}: cores de informação discretas (saturação de até 50%)`, () => {
    for (const [k, hex] of Object.entries(v)) {
      if (NEUTRAS.has(k)) continue;
      assert.ok(saturacao(hex) <= 0.5, `${k} ${hex}: saturação de ${Math.round(saturacao(hex) * 100)}%`);
    }
  });
}
