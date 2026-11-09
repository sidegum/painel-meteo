// Testes da busca de cidades, favoritas e recentes (js/cidades.js). Rodar: node --test test/cidades.test.mjs
// Os resultados de exemplo reproduzem respostas reais de geocoding-api.open-meteo.com/v1/search (language=pt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/cidades.js';

const r = (id, name, admin1, admin2, country_code, country, latitude, longitude, feature_code = 'PPL', population) =>
  ({ id, name, admin1, admin2, country_code, country, latitude, longitude, feature_code, population });

const CAMPO_BOM = r(3467791, 'Campo Bom', 'Rio Grande do Sul', 'Campo Bom', 'BR', 'Brasil', -29.67889, -51.05333, 'PPL', 62886);

test('normalizar: só lugares habitados, Brasil primeiro, ordem da API mantida em cada grupo', () => {
  const lista = C.normalizarResultados([
    r(1, 'Campo Bo', 'Emília-Romanha', null, 'IT', 'Itália', 44.1, 11.9),
    CAMPO_BOM,
    r(2, 'Novo Hamburgo Airport', 'Rio Grande do Sul', null, 'BR', 'Brasil', -29.69, -51.08, 'AIRP'),
    r(3, 'Campo Belo', 'Minas Gerais', 'Campo Belo', 'BR', 'Brasil', -20.89, -45.27, 'PPLA2'),
  ]);
  assert.deepEqual(lista.map((c) => c.nome), ['Campo Bom', 'Campo Belo', 'Campo Bo']);
  assert.equal(lista[0].regiao, 'Rio Grande do Sul, Brasil');
  assert.equal(lista[0].id, 3467791);
  assert.equal(lista[0].populacao, 62886);
  assert.equal('habitado' in lista[0], false);
});

test('normalizar: sem lugar habitado, mantém o que houver; descarta coordenada inválida e repetidos', () => {
  const lista = C.normalizarResultados([
    r(2, 'Aeroporto Salgado Filho', 'Rio Grande do Sul', null, 'BR', 'Brasil', -29.99, -51.17, 'AIRP'),
    r(2, 'Aeroporto Salgado Filho', 'Rio Grande do Sul', null, 'BR', 'Brasil', -29.99, -51.17, 'AIRP'),
    r(5, 'Ruim', 'X', null, 'BR', 'Brasil', null, -51),
    r(6, 'Fora', 'X', null, 'BR', 'Brasil', 95, -51),
  ]);
  assert.deepEqual(lista.map((c) => c.id), [2]);
  assert.deepEqual(C.normalizarResultados(undefined), []);
});

test('normalizar: homônimas no mesmo estado ganham o município para desambiguar (acento não conta)', () => {
  const lista = C.normalizarResultados([
    r(10, 'São José', 'Santa Catarina', 'São José', 'BR', 'Brasil', -27.6, -48.6),
    r(11, 'Sao Jose', 'Santa Catarina', 'Braço do Norte', 'BR', 'Brasil', -28.2, -49.1),
    r(12, 'São José', 'Ceará', 'Amontada', 'BR', 'Brasil', -3.2, -39.8),
  ]);
  assert.equal(lista[0].regiao, 'Santa Catarina, Brasil'); // município igual ao nome não repete
  assert.equal(lista[1].regiao, 'município de Braço do Norte, Santa Catarina, Brasil');
  assert.equal(lista[2].regiao, 'Ceará, Brasil');
});

test('normalizar: limite de resultados', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => r(100 + i, `Cidade ${i}`, 'RS', null, 'BR', 'Brasil', -29 - i / 10, -51));
  assert.equal(C.normalizarResultados(muitos).length, C.LIMITES.resultados);
});

test('destaque: casa no início do nome ou de uma palavra, sem acento nem maiúscula', () => {
  assert.deepEqual(C.trechosDestaque('São José dos Campos', 'sao'), [{ texto: 'São', destaque: true }, { texto: ' José dos Campos', destaque: false }]);
  assert.deepEqual(C.trechosDestaque('São José dos Campos', 'JOSE D'), [
    { texto: 'São ', destaque: false }, { texto: 'José d', destaque: true }, { texto: 'os Campos', destaque: false }]);
  // no meio de uma palavra não destaca
  assert.deepEqual(C.trechosDestaque('Campo Bom', 'mpo'), [{ texto: 'Campo Bom', destaque: false }]);
  assert.deepEqual(C.trechosDestaque('Campo Bom', ''), [{ texto: 'Campo Bom', destaque: false }]);
});

test('mesmo local: pelo id do GeoNames ou, sem id, pela coordenada arredondada', () => {
  const busca = C.normalizarResultados([CAMPO_BOM])[0];
  assert.ok(C.mesmoLocal(busca, { nome: 'Campo Bom', lat: -29.68, lon: -51.05 })); // o padrão do app não tem id
  assert.ok(!C.mesmoLocal(busca, { id: 1, nome: 'Outra', lat: -29.68, lon: -51.05 }));
  assert.ok(!C.mesmoLocal(busca, null));
  assert.equal(C.chaveLocal({ lat: -29.67889, lon: -51.05333 }), '-29.68,-51.05');
});

test('favoritas: alternar, limite, ordem e forma guardada (coordenada arredondada)', () => {
  const cb = C.normalizarResultados([CAMPO_BOM])[0];
  let fav = C.alternarFavorita([], cb);
  assert.deepEqual(fav, [{ id: 3467791, nome: 'Campo Bom', regiao: 'Rio Grande do Sul, Brasil', lat: -29.68, lon: -51.05 }]);
  assert.deepEqual(C.alternarFavorita(fav, cb), []);
  const outras = Array.from({ length: C.LIMITES.favoritas }, (_, i) => ({ id: 200 + i, nome: `C${i}`, regiao: '', lat: -20 - i, lon: -50 }));
  assert.equal(C.alternarFavorita(outras, cb), outras); // cheia: não muda (a interface avisa)
  fav = C.moverFavorita(outras, outras[2], -1);
  assert.deepEqual(fav.slice(0, 3).map((f) => f.nome), ['C0', 'C2', 'C1']);
  assert.equal(C.moverFavorita(outras, outras[0], -1), outras); // primeira não sobe
});

test('recentes: mais nova primeiro, sem repetir, com limite', () => {
  let rec = [];
  for (let i = 0; i < 7; i++) rec = C.adicionarRecente(rec, { id: i, nome: `C${i}`, lat: -20 - i, lon: -50 });
  rec = C.adicionarRecente(rec, { id: 4, nome: 'C4', lat: -24, lon: -50 });
  assert.deepEqual(rec.map((c) => c.id), [4, 6, 5, 3, 2]);
});

test('lista lida do aparelho: descarta itens corrompidos', () => {
  assert.deepEqual(C.listaValida('x', 8), []);
  assert.deepEqual(C.listaValida([null, { nome: 'Sem coordenada' }, { nome: 'Ok', lat: -29.7, lon: -51.1, id: 7 }], 8),
    [{ id: 7, nome: 'Ok', regiao: '', lat: -29.7, lon: -51.1 }]);
});

test('consulta local: casa nome ou região sem acento', () => {
  const c = { nome: 'São Leopoldo', regiao: 'Rio Grande do Sul, Brasil' };
  assert.ok(C.casaConsulta(c, 'sao leo'));
  assert.ok(C.casaConsulta(c, 'grande do sul'));
  assert.ok(!C.casaConsulta(c, 'santa'));
});
