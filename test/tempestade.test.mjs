// Testes do radar de tempestade. Rodar: node --test test/tempestade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celulasTempestade, classeNucleo, riscoTemporal, REGRAS } from '../js/analise.js';
import { dbzDoPixel } from '../js/dados.js';

// Grade de teste: 101 x 101 células de 4 km, local no centro (50, 50).
const N = 101, KM = 4, C = 50;
const grade = (nucleos) => {
  const d = new Int8Array(N * N).fill(-128);
  for (const { x, y, r = 2, dbz } of nucleos) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) d[(y + j) * N + x + i] = dbz;
  return d;
};

test('cores da paleta Universal Blue viram dBZ exato (tabela oficial da RainViewer)', () => {
  assert.equal(dbzDoPixel(0xff, 0xaa, 0x00, 255), 40);
  assert.equal(dbzDoPixel(0xff, 0x44, 0x00, 255), 45);
  assert.equal(dbzDoPixel(0xff, 0xaa, 0xff, 255), 55);
  assert.equal(dbzDoPixel(0x88, 0xdd, 0xee, 255), 15);
  assert.equal(dbzDoPixel(0xd6, 0xc8, 0x8f, 0xaa), 12); // bege semitransparente
  assert.equal(dbzDoPixel(0, 0, 0, 0), null);
  assert.equal(dbzDoPixel(0x12, 0x34, 0x56, 255), null); // cor fora da tabela
});

test('classes pelos limiares de refletividade', () => {
  assert.equal(classeNucleo(39), null);
  assert.equal(classeNucleo(42), 'forte');
  assert.equal(classeNucleo(48), 'tempestade');
  assert.equal(classeNucleo(57), 'severa');
});

test('núcleo a oeste vindo para leste: chegando, com a hora pela velocidade', () => {
  // 15 células = 60 km a oeste; ecos se movem para leste a 60 km/h -> borda leste (52 km) chega a 10 km em ~42 min
  const [n] = celulasTempestade({ dbz: grade([{ x: C - 15, y: C, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(n.classe, 'tempestade');
  assert.equal(n.tendencia, 'chegando');
  assert.ok(n.chegaMin >= 40 && n.chegaMin <= 44, `chegaMin ${n.chegaMin}`);
  assert.ok(Math.abs(n.distanciaKm - 52) < 1);
  assert.ok(Math.abs(n.rumo - 270) < 1, 'a oeste');
});

test('núcleo a leste com ecos indo para leste: se afastando, sem hora de chegada', () => {
  const [n] = celulasTempestade({ dbz: grade([{ x: C + 15, y: C, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(n.tendencia, 'afastando');
  assert.equal(n.chegaMin, null);
});

test('núcleo ao norte com ecos indo para leste: passando ao lado', () => {
  const [n] = celulasTempestade({ dbz: grade([{ x: C - 5, y: C - 15, dbz: 47 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(n.tendencia, 'passando');
});

test('sem movimento medido: só posição, sem tendência', () => {
  const [n] = celulasTempestade({ dbz: grade([{ x: C - 15, y: C, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM, vel: null });
  assert.equal(n.tendencia, null);
  assert.equal(n.chegaMin, null);
});

test('núcleo sobre o local vem primeiro; ruído pequeno e além do alcance são ignorados', () => {
  const lista = celulasTempestade({ dbz: grade([{ x: C - 30, y: C, dbz: 56 }, { x: C + 1, y: C, r: 1, dbz: 46 }, { x: C + 20, y: C + 20, r: 0, dbz: 44 }]), n: N, px: C, py: C, kmCelula: KM });
  assert.equal(lista[0].tendencia, 'sobre');
  assert.equal(lista.length, 2); // o de 1 célula (16 km², 44 dBZ) é ruído
  assert.ok(lista.every((x) => x.distanciaKm <= REGRAS.tempestade.raioKm));
});

test('tempestade no radar a caminho sobe o risco de temporal, mesmo sem chuva prevista', () => {
  assert.equal(riscoTemporal({ prob: 0.05, nucleoRadar: 48 }).nivel, 'moderado');
  assert.equal(riscoTemporal({ prob: 0.05, nucleoRadar: 58 }).nivel, 'alto');
  assert.equal(riscoTemporal({ prob: 0.05, nucleoRadar: 42 }), null); // chuva forte não é tempestade
  // aviso do INMET mais grave prevalece; o radar só sobe
  assert.equal(riscoTemporal({ prob: 0.8, nucleoRadar: 48, aviso: 'Perigo' }).nivel, 'alto');
  assert.equal(riscoTemporal({ prob: 0.8, nucleoRadar: 58, aviso: 'Perigo Potencial' }).nivel, 'alto');
});

import { limitesCoerentes } from '../js/analise.js';
test('tabela de limites segue a chance principal do dia (nenhuma tabela contradiz o resumo)', () => {
  const lim = { origem: 'cenários do ensemble', chuva: [{ limite: 1, p: 0.43 }, { limite: 10, p: 0.05 }, { limite: 30, p: 0 }], rajada: [] };
  const c = limitesCoerentes(lim, 0.26);
  assert.equal(c.chuva[0].p, 0.26);
  assert.ok(Math.abs(c.chuva[1].p - 0.26 * 0.05 / 0.43) < 1e-9);
  assert.equal(c.chuva[2].p, 0);
  assert.equal(limitesCoerentes(lim, null), lim);
});

test('eco que conta como chuva no radar equivale a REGRAS.chuvaHoraMm (Marshall-Palmer)', () => {
  const dbz = 10 * Math.log10(200 * REGRAS.chuvaHoraMm ** 1.6);
  assert.equal(Math.round(dbz), REGRAS.radar.dbzChuva);
});

test('núcleo que não atinge o local mas passa perto: aproximando, com a menor distância e a hora', () => {
  // 100 km a oeste e 24 km ao norte, indo para leste a 60 km/h: a borda sul passa a 16 km do local em cerca de 1h40
  const [n] = celulasTempestade({ dbz: grade([{ x: C - 25, y: C - 6, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(n.tendencia, 'aproximando');
  assert.equal(n.chegaMin, null);
  assert.equal(n.passaKm, 16);
  assert.ok(n.passaMin >= 90 && n.passaMin <= 110, `passa em ${n.passaMin} min`);
});

test('núcleo que passa longe continua "passando", e o que chega não traz passaKm', () => {
  const [longe] = celulasTempestade({ dbz: grade([{ x: C - 5, y: C - 15, dbz: 47 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(longe.tendencia, 'passando');
  assert.ok(longe.passaKm > REGRAS.tempestade.pertoKm);
  const [chega] = celulasTempestade({ dbz: grade([{ x: C - 15, y: C, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.equal(chega.tendencia, 'chegando');
  assert.equal(chega.passaKm, null);
});

test('ordem: quem chega vem antes de quem só se aproxima, e este antes do que passa longe', () => {
  const lista = celulasTempestade({ dbz: grade([{ x: C - 5, y: C - 15, dbz: 58 }, { x: C - 25, y: C - 6, dbz: 50 }, { x: C - 30, y: C, dbz: 46 }]), n: N, px: C, py: C, kmCelula: KM, vel: { lesteKmh: 60, sulKmh: 0 } });
  assert.deepEqual(lista.map((x) => x.tendencia), ['chegando', 'aproximando', 'passando']);
});

test('evolução do núcleo em 30 min: nova, intensificando, enfraquecendo e estável', () => {
  const vel = { lesteKmh: 60, sulKmh: 0 }; // em 30 min o núcleo andou 30 km para leste: estava em C - 22 ou C - 23
  const agora = grade([{ x: C - 15, y: C, dbz: 52 }]);
  const evol = (antes) => celulasTempestade({ dbz: agora, n: N, px: C, py: C, kmCelula: KM, vel, anterior: antes ? { dbz: antes, min: 30 } : null })[0].evolucao;
  assert.equal(evol(null), null);
  assert.equal(evol(grade([])), 'nova');
  assert.equal(evol(grade([{ x: C - 22, y: C, dbz: 35 }])), 'nova'); // havia chuva, mas não forte
  assert.equal(evol(grade([{ x: C - 22, y: C, dbz: 44 }])), 'intensificando');
  assert.equal(evol(grade([{ x: C - 22, y: C, dbz: 60 }])), 'enfraquecendo');
  assert.equal(evol(grade([{ x: C - 22, y: C, dbz: 50 }])), 'estavel');
});

test('posição do centro do núcleo em km (leste e sul positivos)', () => {
  const [n] = celulasTempestade({ dbz: grade([{ x: C - 15, y: C + 10, dbz: 50 }]), n: N, px: C, py: C, kmCelula: KM });
  assert.equal(Math.round(n.leste), -60);
  assert.equal(Math.round(n.sul), 40);
});
