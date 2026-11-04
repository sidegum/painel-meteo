// Testes das regras de análise. Rodar: node --test test/analise.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDia, correcaoTemperatura, calibrarProb, mediana, escolherFonte, leituraValida, fraseDoDia, pesosModelos, probLimites, isoLocalParaMs, partesLocais, direcaoTexto, arredondaCoord, condicaoCeu, respostaChuva } from '../js/analise.js';

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

test('pesos iniciais até 7 dias, depois ajuste gradual e limitado', () => {
  assert.equal(pesosModelos({ a: { dias: 5, maeChuva: 1 }, b: { dias: 5, maeChuva: 9 } }, ['a', 'b']).ajustado, false);
  const pouco = pesosModelos({ a: { dias: 8, maeChuva: 1 }, b: { dias: 8, maeChuva: 1.4 } }, ['a', 'b']);
  const muito = pesosModelos({ a: { dias: 90, maeChuva: 1 }, b: { dias: 90, maeChuva: 1.4 } }, ['a', 'b']);
  assert.ok(pouco.ajustado && muito.ajustado);
  assert.ok(muito.pesos.a > pouco.pesos.a && muito.pesos.b < pouco.pesos.b); // mais dias, mais confiança no ajuste
  assert.ok(muito.pesos.a <= 1.3 && muito.pesos.b >= 0.7);
  // temperatura também conta
  const t = pesosModelos({ a: { dias: 60, maeTmax: 0.8 }, b: { dias: 60, maeTmax: 2.4 } }, ['a', 'b']);
  assert.ok(t.pesos.a > t.pesos.b);
});

test('viés de temperatura aprendido, gradual e limitado', () => {
  assert.deepEqual(correcaoTemperatura({ viesTmax: 2, amostrasTmax: 3 }), { tmax: 0, tmin: 0 }); // poucos dias: não corrige
  const c = correcaoTemperatura({ viesTmax: 2, amostrasTmax: 10, viesTmin: -1, amostrasTmin: 30 });
  assert.equal(c.tmax, 1); // 10 / (10 + 10) do viés
  assert.equal(c.tmin, -0.75);
  assert.equal(correcaoTemperatura({ viesTmax: 9, amostrasTmax: 1000 }).tmax, 3); // limite de 3 °C
});

test('calibração da chance pelo histórico', () => {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, freq: null }));
  bins[3] = { n: 10, freq: 0.6 }; // quando disse 30-40%, choveu 60% das vezes
  assert.equal(calibrarProb(0.35, { pares: 10, bins }), 0.35); // poucos pares: não mexe
  assert.ok(Math.abs(calibrarProb(0.35, { pares: 40, bins }) - 0.475) < 1e-9);
  assert.equal(calibrarProb(0.85, { pares: 40, bins }), 0.85); // faixa sem casos: não mexe
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

test('pressão: variação de 3 h e 24 h com tolerância', async () => {
  const { variacaoSerie } = await import('../js/analise.js');
  const h = 3600000, t0 = Date.UTC(2026, 10, 4, 12);
  const serie = Array.from({ length: 25 }, (_, k) => ({ ms: t0 - (24 - k) * h, valor: 1015 - k * 0.5 }));
  assert.equal(variacaoSerie(serie, 3, 40).delta, -1.5);
  assert.equal(variacaoSerie(serie, 24, 90).delta, -12);
  // sem leitura perto do alvo: nada é inventado
  assert.equal(variacaoSerie([{ ms: t0 - 10 * h, valor: 1010 }, { ms: t0, valor: 1008 }], 3, 40), null);
  assert.equal(variacaoSerie([{ ms: t0, valor: 1008 }], 3, 40), null);
});

test('pressão: termos de tendência do Met Office e da OMM', async () => {
  const { classeTendenciaPressao } = await import('../js/analise.js');
  assert.equal(classeTendenciaPressao(0.05).texto, 'estável');
  assert.equal(classeTendenciaPressao(-1.0).texto, 'caindo devagar');
  assert.equal(classeTendenciaPressao(2.0).texto, 'subindo');
  assert.equal(classeTendenciaPressao(-4.2).texto, 'caindo rápido');
  assert.equal(classeTendenciaPressao(-7).texto, 'caindo muito rápido');
  assert.equal(classeTendenciaPressao(null), null);
});

test('pressão: sinal de chuva por pontos', async () => {
  const { avaliarPressao } = await import('../js/analise.js');
  // queda rápida + queda em 24 h + pressão baixa = sinal forte
  const a = avaliarPressao({ atual: 1004, d3: -4, d24: -8, prev: -2 });
  assert.equal(a.sinal, 'forte'); assert.equal(a.pontos, 4); assert.equal(a.motivos.length, 3);
  // queda moderada só = fraco; subida com pressão alta = tempo firme
  assert.equal(avaliarPressao({ atual: 1014, d3: -2 }).sinal, 'fraco');
  assert.equal(avaliarPressao({ atual: 1024, d3: 2, prev: 5 }).sinal, 'firme');
  assert.equal(avaliarPressao({ atual: 1014, d3: 0.3 }).sinal, 'nenhum');
  assert.equal(avaliarPressao({}), null);
});

test('pressão nunca contradiz a chance de chuva principal', async () => {
  const { leituraPressao, avaliarPressao, palavraOcorrencia } = await import('../js/analise.js');
  const casos = [{ atual: 1003, d3: -5, d24: -9, prev: -5 }, { atual: 1012, d3: -2 }, { atual: 1014, d3: 0 }, { atual: 1024, d3: 2, prev: 5 }];
  for (const c of casos) for (const prob of [0, 0.1, 0.3, 0.5, 0.8, 1, null]) {
    const l = leituraPressao(avaliarPressao(c), prob);
    const semChuva = prob !== null && ['improvável', 'pouco provável'].includes(palavraOcorrencia(prob));
    const comChuva = prob !== null && !semChuva;
    // previsão sem chuva: o texto da pressão não pode anunciar chuva
    if (semChuva) assert.ok(!/reforça a chuva|confirma a chuva|chuva prevista pelos modelos\./i.test(l.titulo + l.texto) && l.classe !== 'forte' && l.classe !== 'confirma', `${JSON.stringify(c)} ${prob}`);
    // previsão com chuva: o texto da pressão não pode anunciar tempo firme
    if (comChuva) assert.ok(!/tempo firme/i.test(l.titulo + l.texto) && l.classe !== 'firme', `${JSON.stringify(c)} ${prob}`);
  }
});

test('radar: deslocamento por correlação de blocos e chegada estimada', async () => {
  const { deslocamentoRadar, chegadaChuva } = await import('../js/analise.js');
  const n = 64;
  const blob = (cx, cy) => { const g = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= 36) g[y * n + x] = 1; return g; };
  // eco andou 5 células para leste e 2 para o sul em 60 min
  const d = deslocamentoRadar(blob(20, 30), blob(25, 32), n);
  assert.deepEqual([d.dx, d.dy], [5, 2]);
  // local 20 células a leste do eco atual, na mesma linha: chega em cerca de 20 / 5 x 60 = 240 min, fora do horizonte
  assert.equal(chegadaChuva(blob(25, 32), n, 45, 32, { dx: 5, dy: 0 }), null);
  // local 10 células a leste: a borda (raio 6) está a 4 células, chega entre 40 e 60 min
  const t = chegadaChuva(blob(25, 32), n, 35, 32, { dx: 5, dy: 0 });
  assert.ok(t >= 30 && t <= 60, String(t));
  // sobre o eco: 0 min
  assert.equal(chegadaChuva(blob(25, 32), n, 25, 32, { dx: 5, dy: 0 }), 0);
  // pouco eco: não mede movimento
  assert.equal(deslocamentoRadar(new Float32Array(n * n), new Float32Array(n * n), n), null);
});

test('radar seco: janela sem chuva pela extrapolação ou pela chuva mais próxima', async () => {
  const { secoPeloRadar, REGRAS } = await import('../js/analise.js');
  const R = REGRAS.radar, n = 64;
  const blob = (cx, cy) => { const g = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= 36) g[y * n + x] = 1; return g; };
  // eco sobre o local: nenhuma janela seca
  assert.equal(secoPeloRadar(blob(32, 32), n, 32, 32, { dx: 5, dy: 0 }, 8.5), 0);
  // chuva indo embora (local a oeste, eco andando para leste): seco o horizonte inteiro
  assert.equal(secoPeloRadar(blob(40, 32), n, 25, 32, { dx: 5, dy: 0 }, 8.5), R.horizonteMin);
  // chuva vindo: seco só até a chegada
  const t = secoPeloRadar(blob(25, 32), n, 35, 32, { dx: 5, dy: 0 }, 8.5);
  assert.ok(t >= 30 && t <= 60, String(t));
  // sem movimento medido e nenhuma chuva na grade: limitado pela borda da área conhecida
  const vazio = new Float32Array(n * n);
  assert.equal(secoPeloRadar(vazio, n, 32, 32, null, 8.5), R.horizonteMin); // 31 células x 8,5 km = 263 km > 200 km
  // sem movimento e chuva a 10 células (85 km): 85 / 100 km/h = 51 min, arredondado para baixo a 50
  assert.equal(secoPeloRadar(blob(42 + 6, 32), n, 32, 32, null, 8.5), 50);
});

test('risco de temporal: só com chuva prevista ou aviso, por pontos', async () => {
  const { riscoTemporal } = await import('../js/analise.js');
  // sem chuva prevista: nunca contradiz a previsão
  assert.equal(riscoTemporal({ prob: 0.1, cape: 3000, rajada: 90 }), null);
  assert.equal(riscoTemporal({ prob: 0.8, cape: 300 }).nivel, 'baixo');
  assert.equal(riscoTemporal({ prob: 0.8, cape: 1500, chuvaHora: 12 }).nivel, 'moderado');
  assert.equal(riscoTemporal({ chegando: true, cape: 2800, rajada: 85 }).nivel, 'alto');
  // aviso do INMET: o nível oficial prevalece, para cima e para baixo
  assert.equal(riscoTemporal({ prob: 0.1, aviso: 'Perigo' }).nivel, 'alto');
  assert.equal(riscoTemporal({ prob: 0.9, cape: 3000, rajada: 90, aviso: 'Perigo Potencial' }).nivel, 'moderado');
});
