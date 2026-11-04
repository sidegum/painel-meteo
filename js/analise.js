// Regras de análise do painel. Funções puras, sem acesso à rede nem ao DOM,
// para poderem ser testadas no Node (test/analise.test.mjs).
//
// Todos os limites ficam em REGRAS. Para ajustar a confiança, mude só aqui.

export const REGRAS = {
  chuvaMinimaMm: 1,            // dia "com chuva" quando o total passa de 1 mm
  chuvaHoraMm: 0.2,            // hora "com chuva" para achar o horário provável
  ocorrencia: {                // probabilidade de cenários -> palavra
    provavel: 0.7, possivel: 0.4, poucoProvavel: 0.15,
  },
  volumeIncertoRazao: 0.8,     // (máx - mín) / mediana acima disso = volume incerto
  volumeMinimoRazaoMm: 2,      // mediana mínima usada na razão, para não explodir com 0,1 mm
  rajadaIncertaRazao: 0.35,    // (máx - mín) / mediana das rajadas
  rajadaClasses: [             // limites de rajada em km/h
    { min: 80, nome: 'muito fortes' },
    { min: 60, nome: 'fortes' },
    { min: 40, nome: 'moderadas' },
  ],
  divisaoCenarios: [0.3, 0.7], // probabilidade nesse intervalo = cenários divididos (só informativo)
  difSistemas: [0.3, 0.5],     // diferença de probabilidade entre sistemas de cenários: -1 / -2 níveis
  horizonteLongoDias: 4,       // a partir do 5º dia, perde um nível de confiança
  // Só os modelos globais de melhor desempenho nas verificações publicadas (centro líder da OMM para
  // verificação, sediado no ECMWF): ECMWF IFS, ECMWF AIFS e UKMO. GFS e ICON saíram da previsão.
  // Peso inicial maior para o ECMWF IFS; depois de 30 dias de dados locais, o acerto medido aqui ajusta.
  pesoInicial: {
    ecmwf_ifs: 1.3, ecmwf_aifs025_single: 1.15, ukmo_global_deterministic_10km: 1.15,
  },
  // Aprendizado: o painel compara o que previu com o que as estações mediram e se corrige aos poucos.
  // Cada correção entra com peso n / (n + meia), ou seja, vale metade quando há "meia" dias de dados.
  aprendizado: {
    diasInicio: 7,             // começa a corrigir com 7 dias verificados
    meiaPesos: 30,             // pesos dos modelos: confiança de 50% com 30 dias
    meiaVies: 10,              // viés de temperatura: confiança de 50% com 10 dias
    viesMax: 3,                // correção de temperatura limitada a ±3 °C
    calibMinPares: 30,         // calibração da chance só com 30 pares previsão x medição
    meiaCalib: 10,             // por faixa de chance: confiança de 50% com 10 casos
  },
  acerto: {
    diasMinimos: 30,           // a taxa de acerto local só pesa na confiança com 30 dias
    pesoMin: 0.7, pesoMax: 1.3, // ajuste moderado depois disso
    taxaAcertoBaixa: 0.6,      // acerto de chuva abaixo disso reduz a confiança
    distanciaMaxKm: 50,        // estação de verificação mais longe que isso é ignorada
  },
  divergencia: {               // blocos de 6 h
    chuvaMm: 5, chuvaRazao: 0.6, rajadaKmh: 25,
  },
  limitesSemana: { chuva: [1, 10, 30], rajada: [40, 60, 80] },
  ceu: {                       // cobertura média de nuvens (%) -> condição do céu
    limpo: 20, poucasNuvens: 45, parcial: 75,
  },
  // Pressão ao nível do mar (hPa). Tendência de 3 h pelos termos do Met Office e da OMM:
  // estável < 0,1; devagar 0,1 a 1,5; normal 1,6 a 3,5; rápido 3,6 a 6,0; muito rápido acima de 6,0.
  pressao: {
    tendencia3h: { estavel: 0.1, devagar: 1.5, normal: 3.5, rapido: 6.0 },
    queda24hForte: 6,          // queda de 6 hPa ou mais em 24 h soma um ponto de sinal de chuva
    previsaoHoras: 12,         // janela da variação prevista pelos modelos
    variacaoPrevForte: 4,      // variação prevista de 4 hPa ou mais na janela soma (queda) ou tira (subida) um ponto
    baixa: 1008, alta: 1020,   // nível: abaixo de 1008 favorece chuva, acima de 1020 favorece tempo firme
    toleranciaMin: { h3: 40, h24: 90 }, // distância máxima da leitura de referência ao instante alvo
  },
  // Chuva chegando: extrapolação do movimento dos ecos de radar (nowcasting por correlação de blocos).
  radar: {
    intervaloMin: 60,          // intervalo entre os dois quadros comparados
    deslocMax: 12,             // busca de deslocamento: até 12 células em cada eixo no intervalo
    ecoMin: 0.3,               // fração de pixels com eco para a célula contar como chuva (chegada)
    limiarMovimento: 0.05,     // intensidade mínima para a célula entrar na medida do movimento
    concordanciaKmh: 15,       // velocidades medidas em 30 e 60 min precisam concordar dentro disso
    celulasMin: 40,            // mínimo de células com eco nos dois quadros para medir o movimento
    melhoraMin: 0.01,          // o melhor deslocamento precisa ser melhor que "parado" (a confiabilidade vem da concordância 30 x 60 min)
    raioCelulas: 2,            // vizinhança verificada no ponto de origem da chuva
    horizonteMin: 120,         // só avisa chegada nas próximas 2 h
    passoMin: 5,
    probChegando: 0.7,         // chuva chegando pelo radar: a chance do dia passa a ser no mínimo "provável"
  },
  // Risco de temporal: só avaliado quando há chuva prevista, chegando ou ocorrendo, ou aviso do INMET.
  temporal: {
    cape: [1000, 2500],        // J/kg: energia moderada (+1) e forte (+2) para tempestades
    chuvaHoraMm: [10, 25],     // mm/h: chuva forte (+1) e muito forte (+2)
    rajada: [60, 80],          // km/h: rajadas fortes (+1) e muito fortes (+2), as mesmas classes de rajadaClasses
    quedaPressao3h: 3.5,       // queda de pressão acima disso em 3 h: +1
    // Aviso de tempestade do INMET em vigor: o nível oficial prevalece, para o painel nunca contradizer o aviso.
    aviso: { 'perigo potencial': 'moderado', perigo: 'alto', 'grande perigo': 'alto' },
    niveis: { moderado: 2, alto: 4 },
  },
};

export const MODELOS = {
  ecmwf_ifs: { nome: 'ECMWF IFS', curto: 'ECMWF', cor: 'var(--m-ecmwf)' },
  ecmwf_aifs025_single: { nome: 'ECMWF AIFS', curto: 'AIFS', cor: 'var(--m-aifs)' },
  ukmo_global_deterministic_10km: { nome: 'UKMO (Met Office)', curto: 'UKMO', cor: 'var(--m-ukmo)' },
};

// ---------- utilidades numéricas ----------

export const valido = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Mediana ponderada. Ordena os pares (valor, peso) válidos e devolve o primeiro valor cujo peso acumulado
 * passa da metade do total; no empate exato, a média dos dois vizinhos. Sem pesos, é a mediana comum.
 * @param {Array<number|null>} arr valores (inválidos são ignorados)
 * @param {number[]} [pesos] peso de cada posição de arr (padrão 1)
 * @returns {number|null} null se não houver valor válido
 */
export function mediana(arr, pesos) {
  const xs = [];
  arr.forEach((v, i) => { if (valido(v)) xs.push([v, pesos ? (pesos[i] ?? 1) : 1]); });
  if (!xs.length) return null;
  xs.sort((a, b) => a[0] - b[0]);
  const total = xs.reduce((s, x) => s + x[1], 0);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i][1];
    if (acc > total / 2) return xs[i][0];
    if (acc === total / 2) return (xs[i][0] + xs[i + 1][0]) / 2;
  }
  return xs[xs.length - 1][0];
}

/**
 * Quantil com interpolação linear entre as posições ordenadas (posição = (n - 1) * q).
 * @param {Array<number|null>} arr
 * @param {number} q entre 0 e 1
 * @returns {number|null}
 */
export function quantil(arr, q) {
  const xs = arr.filter(valido).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export const minimo = (arr) => { const v = arr.filter(valido); return v.length ? Math.min(...v) : null; };
export const maximo = (arr) => { const v = arr.filter(valido); return v.length ? Math.max(...v) : null; };

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const arredondaCoord = (x) => Math.round(x * 100) / 100;

export function direcaoTexto(graus) {
  if (!valido(graus)) return null;
  const nomes = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return nomes[Math.round(((graus % 360) + 360) % 360 / 45) % 8];
}

// ---------- tempo ----------

// Open-Meteo devolve "2026-11-03T16:00" no fuso do local, mais utc_offset_seconds.
/**
 * Converte horário local ISO da Open-Meteo ("AAAA-MM-DDTHH:MM") em epoch ms usando o deslocamento do local,
 * sem depender do fuso do aparelho.
 * @param {string} iso
 * @param {number} offsetSeg utc_offset_seconds da resposta
 * @returns {number}
 */
export function isoLocalParaMs(iso, offsetSeg) {
  const [d, t = '00:00'] = iso.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, m) - offsetSeg * 1000;
}

/**
 * Decompõe um instante nas partes do calendário local do ponto (não do aparelho).
 * @param {number} ms epoch ms
 * @param {number} offsetSeg deslocamento UTC do local, em segundos
 * @returns {{ano:number, mes:number, dia:number, hora:number, minuto:number, semana:number, data:string}}
 */
export function partesLocais(ms, offsetSeg) {
  const d = new Date(ms + offsetSeg * 1000);
  return {
    ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
    hora: d.getUTCHours(), minuto: d.getUTCMinutes(), semana: d.getUTCDay(),
    data: d.toISOString().slice(0, 10),
  };
}

export function periodoDoDia(hora) {
  if (hora < 6) return 'madrugada';
  if (hora < 12) return 'manhã';
  if (hora < 18) return 'tarde';
  return 'noite';
}

// ---------- validação de leituras ----------

const FAIXAS = {
  temperatura: [-30, 50], umidade: [0, 100], orvalho: [-40, 40], pressao: [870, 1085],
  vento: [0, 300], rajada: [0, 400], direcao: [0, 360], chuva: [0, 500], sensacao: [-45, 60],
};
const SENTINELAS = new Set([9999, -9999, 999.9, -999, 99999, -99999, 9999.9]);

export function leituraValida(variavel, valor) {
  if (!valido(valor)) return false;
  if (SENTINELAS.has(valor)) return false;
  const f = FAIXAS[variavel];
  return !f || (valor >= f[0] && valor <= f[1]);
}

// fontes: [{ id, nome, tipo, lat, lon, leituras: { temperatura: { valor, ms } } }]
// Ordena por distância calculada no aparelho e devolve { escolhida, outras }.
/**
 * Escolhe a estação mais próxima com leitura válida e recente de uma variável.
 * Distâncias calculadas no aparelho (haversine); leituras inválidas, antigas ou mais de 15 min no futuro são descartadas.
 * @returns {{escolhida: object|null, outras: object[]}} outras inclui o motivo do descarte
 */
export function escolherFonte(fontes, variavel, lat, lon, agoraMs, idadeMaxMin) {
  const candidatas = [];
  for (const f of fontes) {
    const l = f.leituras?.[variavel];
    const distancia = distanciaKm(lat, lon, f.lat, f.lon);
    if (!l) continue;
    const idadeMin = (agoraMs - l.ms) / 60000;
    const ok = leituraValida(variavel, l.valor) && idadeMin <= idadeMaxMin && idadeMin > -15;
    candidatas.push({ fonte: f, valor: l.valor, ms: l.ms, idadeMin, distancia, ok,
      motivo: ok ? null : (!leituraValida(variavel, l.valor) ? 'leitura inválida' : 'leitura antiga') });
  }
  candidatas.sort((a, b) => a.distancia - b.distancia);
  const validas = candidatas.filter((c) => c.ok);
  return { escolhida: validas[0] || null, outras: candidatas.filter((c) => c !== validas[0]) };
}

// ---------- previsão: recortes por dia ----------

/**
 * Índices horários pertencentes a uma data local; com aPartirMs, exclui horas já encerradas.
 * @param {number[]} horas epoch ms de cada hora
 * @param {string} data "AAAA-MM-DD" no fuso do local
 * @param {number} offsetSeg
 * @param {number} [aPartirMs]
 * @returns {number[]}
 */
export function indicesDoDia(horas, data, offsetSeg, aPartirMs = -Infinity) {
  const idx = [];
  horas.forEach((ms, i) => {
    if (ms + 3600000 <= aPartirMs) return;
    if (partesLocais(ms, offsetSeg).data === data) idx.push(i);
  });
  return idx;
}

function soma(serie, idx) {
  if (!serie) return null;
  let s = 0, n = 0;
  for (const i of idx) if (valido(serie[i])) { s += serie[i]; n++; }
  // Se faltar mais de um quarto das horas, o total não é confiável: devolve nulo.
  if (n === 0 || n < idx.length * 0.75) return null;
  return s;
}

function maxComHora(serie, idx, horas, dir) {
  let melhor = null;
  for (const i of idx) {
    if (valido(serie?.[i]) && (!melhor || serie[i] > melhor.valor)) {
      melhor = { valor: serie[i], ms: horas[i], direcao: dir?.[i] ?? null };
    }
  }
  return melhor;
}

/**
 * Resumo diário de um modelo determinístico: total de chuva (nulo se faltar mais de 25% das horas),
 * probabilidade máxima, rajada máxima com hora e direção, vento máximo, mínima e máxima.
 */
export function resumoModeloDia(prev, modelo, idx) {
  const v = prev.modelos[modelo]?.vars || {};
  return {
    modelo,
    chuva: soma(v.precipitation, idx),
    probMax: maximo(idx.map((i) => v.precipitation_probability?.[i])),
    rajada: maxComHora(v.wind_gusts_10m, idx, prev.horas, v.wind_direction_10m),
    ventoMax: maximo(idx.map((i) => v.wind_speed_10m?.[i])),
    tmin: minimo(idx.map((i) => v.temperature_2m?.[i])),
    tmax: maximo(idx.map((i) => v.temperature_2m?.[i])),
  };
}

// Membros do ensemble: { precipitation: [[...horas], ...], wind_gusts_10m: [...] }
/**
 * Totais diários de chuva e rajada máxima de cada membro dos sistemas de cenários (ensemble).
 * @returns {{chuva:number[], rajada:number[], modelos:string[], porModelo:Object<string, number[]>}|null}
 */
export function membrosDia(ens, data, offsetSeg, aPartirMs) {
  if (!ens) return null;
  const out = { chuva: [], rajada: [], modelos: [], porModelo: {} };
  for (const [modelo, e] of Object.entries(ens)) {
    const idx = indicesDoDia(e.horas, data, offsetSeg, aPartirMs);
    if (!idx.length) continue;
    let usou = false;
    for (const m of e.membros.precipitation || []) {
      const s = soma(m, idx); if (s !== null) { out.chuva.push(s); (out.porModelo[modelo] ||= []).push(s); usou = true; }
    }
    for (const m of e.membros.wind_gusts_10m || []) {
      const x = maximo(idx.map((i) => m[i])); if (x !== null) { out.rajada.push(x); usou = true; }
    }
    if (usou) out.modelos.push(modelo);
  }
  return out.chuva.length || out.rajada.length ? out : null;
}

// ---------- confiança ----------

const NIVEIS = ['baixa', 'baixa', 'média', 'alta'];

export function palavraOcorrencia(p) {
  const o = REGRAS.ocorrencia;
  if (p >= o.provavel) return 'provável';
  if (p >= o.possivel) return 'possível';
  if (p >= o.poucoProvavel) return 'pouco provável';
  return 'improvável';
}

export function classeRajada(kmh) {
  if (!valido(kmh)) return null;
  return REGRAS.rajadaClasses.find((c) => kmh >= c.min)?.nome || null;
}

// resumos: saída de resumoModeloDia para cada modelo; membros: membrosDia; ctx: { diaIndice, acerto, medicaoAgora }
/**
 * Avaliação completa de um dia: probabilidade de chuva (cenários por sistema, depois cenários, depois modelos),
 * calibração local, volume provável, concordância, faixa de rajada e nível de confiança com motivos.
 * Ver docs/TECNICO.md, seção 3.6.
 * @param {object[]} resumos saída de resumoModeloDia por modelo
 * @param {object|null} membros saída de membrosDia
 * @param {{diaIndice?:number, acerto?:object, pesos?:object, medicaoAgora?:object, calibracao?:object}} [ctx]
 */
export function avaliarDia(resumos, membros, ctx = {}) {
  const R = REGRAS;
  const pesos = ctx.pesos || {};
  const comChuva = resumos.filter((r) => r.chuva !== null);
  const chuvas = comChuva.map((r) => r.chuva);
  const pesosChuva = comChuva.map((r) => pesos[r.modelo] ?? 1);
  const motivos = [];

  // 1. probabilidade dos cenários
  let prob = null, fonteProb = null;
  const sistemas = Object.entries(membros?.porModelo || {}).filter(([, xs]) => xs.length >= 10);
  if (sistemas.length >= 2) {
    // média das probabilidades de cada sistema: o Met Office (18 cenários) pesa igual ao ECMWF (51)
    prob = sistemas.reduce((t, [, xs]) => t + xs.filter((x) => x >= R.chuvaMinimaMm).length / xs.length, 0) / sistemas.length;
    fonteProb = `${membros.chuva.length} cenários de ${sistemas.length} sistemas`;
  } else if (membros?.chuva?.length >= 10) {
    prob = membros.chuva.filter((x) => x >= R.chuvaMinimaMm).length / membros.chuva.length;
    fonteProb = `${membros.chuva.length} cenários do ensemble`;
  } else if (chuvas.length) {
    prob = chuvas.filter((x) => x >= R.chuvaMinimaMm).length / chuvas.length;
    fonteProb = `concordância entre ${chuvas.length} modelos (sem ensemble)`;
  }
  // calibração aprendida com o histórico local (quando houver casos suficientes)
  const probBruta = prob;
  if (prob !== null && ctx.calibracao) prob = calibrarProb(prob, ctx.calibracao);
  // Chuva chegando pelo radar (só hoje): nas próximas 2 h a extrapolação do radar acerta mais que os modelos,
  // então a chance do dia passa a ser no mínimo "provável", e todas as telas mostram o mesmo veredito.
  if (ctx.chegando && (prob === null || prob < R.radar.probChegando)) {
    prob = R.radar.probChegando;
    fonteProb = `${fonteProb ? fonteProb + ' e ' : ''}radar mostrando chuva chegando`;
  }
  const probModelos = mediana(resumos.map((r) => r.probMax));

  // volume se chover
  let volume = null;
  if (membros?.chuva?.length >= 10) {
    const mol = membros.chuva.filter((x) => x >= R.chuvaMinimaMm);
    if (mol.length) volume = { mediana: quantil(mol, 0.5), min: quantil(mol, 0.1), max: quantil(mol, 0.9), origem: 'cenários' };
  }
  if (!volume && chuvas.length) {
    const mol = chuvas.filter((x) => x >= R.chuvaMinimaMm);
    const base = mol.length ? mol : chuvas;
    volume = { mediana: mediana(base, mol.length ? comChuva.filter((r) => r.chuva >= R.chuvaMinimaMm).map((r) => pesos[r.modelo] ?? 1) : pesosChuva),
      min: minimo(base), max: maximo(base), origem: 'modelos' };
  }

  // 2. concordância entre modelos sobre ocorrência e volume
  let concordancia = null, volumeIncerto = false;
  if (chuvas.length >= 2) {
    const sim = chuvas.filter((x) => x >= R.chuvaMinimaMm).length;
    concordancia = Math.max(sim, chuvas.length - sim) / chuvas.length;
    const molhados = chuvas.filter((x) => x >= R.chuvaMinimaMm);
    if (molhados.length >= 1 && sim >= chuvas.length / 2) {
      const med = Math.max(mediana(chuvas), R.volumeMinimoRazaoMm);
      volumeIncerto = (maximo(chuvas) - minimo(chuvas)) / med >= R.volumeIncertoRazao;
    }
  }

  // Confiança = quanto os sistemas independentes concordam sobre a estimativa (não se a chuva é certa).
  // "30% de chance" com ECMWF e Met Office dizendo o mesmo é uma estimativa confiável.
  // Cada motivo conta uma vez; volume diferente não rebaixa (mostramos a melhor estimativa e a faixa).
  let pontosChuva = 3;
  const porSistema = Object.values(membros?.porModelo || {}).filter((xs) => xs.length >= 10)
    .map((xs) => xs.filter((x) => x >= R.chuvaMinimaMm).length / xs.length);
  if (prob === null) { pontosChuva = 0; motivos.push('sem dados de chuva suficientes'); }
  else if (porSistema.length >= 2) {
    const dif = maximo(porSistema) - minimo(porSistema);
    if (dif > R.difSistemas[1]) { pontosChuva -= 2; motivos.push(`os sistemas de cenários discordam muito (${Math.round(minimo(porSistema) * 100)}% a ${Math.round(maximo(porSistema) * 100)}%)`); }
    else if (dif > R.difSistemas[0]) { pontosChuva -= 1; motivos.push(`os sistemas de cenários diferem (${Math.round(minimo(porSistema) * 100)}% a ${Math.round(maximo(porSistema) * 100)}%)`); }
  } else if (membros?.chuva?.length >= 10) {
    // um só sistema: perde um nível só se os modelos determinísticos contradizem os cenários
    if (concordancia !== null && chuvas.length >= 2) {
      const fracDet = chuvas.filter((x) => x >= R.chuvaMinimaMm).length / chuvas.length;
      if (Math.abs(fracDet - prob) > 0.5) { pontosChuva -= 1; motivos.push('modelos e cenários apontam em direções opostas'); }
    }
  } else if (concordancia !== null && concordancia < 1) {
    pontosChuva -= concordancia <= 0.6 ? 2 : 1;
    motivos.push(`modelos discordam sobre chover (${Math.round(concordancia * 100)}% no mesmo lado), sem cenários para desempatar`);
  } else if (chuvas.length < 2) { pontosChuva -= 1; motivos.push('menos de dois modelos com dados'); }

  // 3. rajadas: cenários quando existem; senão, diferença entre modelos
  const rajadas = resumos.map((r) => r.rajada?.valor).filter(valido);
  let pontosRajada = 3, rajadaIncerta = false;
  const rajadaMed = mediana(resumos.map((r) => r.rajada?.valor), resumos.map((r) => pesos[r.modelo] ?? 1));
  if (membros?.rajada?.length >= 10) {
    const q1 = quantil(membros.rajada, 0.1), q9 = quantil(membros.rajada, 0.9), qm = quantil(membros.rajada, 0.5);
    rajadaIncerta = (q9 - q1) / Math.max(qm, 15) >= R.rajadaIncertaRazao * 2;
    if (rajadaIncerta && classeRajada(q9)) { pontosRajada -= 1; motivos.push('cenários variam muito na força das rajadas'); }
  } else if (rajadas.length >= 2) {
    rajadaIncerta = (maximo(rajadas) - minimo(rajadas)) / Math.max(rajadaMed, 15) >= R.rajadaIncertaRazao;
    if (rajadaIncerta && classeRajada(maximo(rajadas))) { pontosRajada -= 1; motivos.push('rajadas diferentes entre modelos'); }
  } else if (!rajadas.length) { pontosRajada = 1; motivos.push('sem previsão de rajada'); }
  const rajadaFaixa = membros?.rajada?.length >= 10
    ? { min: quantil(membros.rajada, 0.1), max: quantil(membros.rajada, 0.9), mediana: quantil(membros.rajada, 0.5), origem: 'cenários' }
    : rajadas.length ? { min: minimo(rajadas), max: maximo(rajadas), mediana: rajadaMed, origem: 'modelos' } : null;

  // horizonte: a partir do 5º dia perde um nível; a partir do 8º, dois
  const dia = ctx.diaIndice ?? 0;
  if (dia >= R.horizonteLongoDias) {
    const n = dia >= 7 ? 2 : 1;
    pontosChuva -= n; pontosRajada -= n; motivos.push(`previsão para daqui a ${dia} dias`);
  }

  // 4. desempenho local recente e distância da estação
  const a = ctx.acerto;
  if (a && a.dias >= R.acerto.diasMinimos && a.distanciaKm <= R.acerto.distanciaMaxKm && valido(a.taxaChuva)) {
    if (a.taxaChuva < R.acerto.taxaAcertoBaixa) { pontosChuva -= 1; motivos.push(`acerto local de chuva recente de ${Math.round(a.taxaChuva * 100)}%`); }
  } else if (a && a.distanciaKm > R.acerto.distanciaMaxKm) {
    motivos.push('estação de verificação longe demais, acerto local não usado');
  }

  // medição agora contradiz a previsão (só para hoje)
  if (ctx.medicaoAgora && prob !== null) {
    const m = ctx.medicaoAgora;
    if (m.chovendo && prob < 0.2) { pontosChuva -= 1; motivos.push('estação próxima mede chuva que a previsão não esperava'); }
  }

  const nivel = (p) => NIVEIS[Math.max(0, Math.min(3, p))];
  const chuvaNivel = nivel(pontosChuva), rajadaNivel = nivel(pontosRajada);
  const ordem = { baixa: 0, 'média': 1, alta: 2 };
  // a rajada só pesa no geral quando é relevante (moderada ou mais forte)
  const rajadaRelevante = classeRajada(rajadaFaixa?.max ?? rajadaMed);
  const geral = rajadaRelevante && ordem[rajadaNivel] < ordem[chuvaNivel] ? rajadaNivel : chuvaNivel;

  // mensagem curta de chuva
  let mensagemChuva = null;
  if (prob !== null) {
    const palavra = palavraOcorrencia(prob);
    if (palavra === 'improvável') mensagemChuva = 'chuva improvável';
    else mensagemChuva = `chuva ${palavra}` + (volumeIncerto ? ', volume incerto' : '');
  }

  return {
    prob, probBruta, fonteProb, probModelos, volume, volumeIncerto, concordancia, mensagemChuva,
    rajada: rajadaFaixa, rajadaIncerta,
    confianca: { geral, chuva: chuvaNivel, rajada: rajadaNivel, motivos: [...new Set(motivos)] },
  };
}

// Probabilidades de passar limites, para a aba Semana.
/**
 * Fração de cenários (ou de modelos, sem ensemble) acima de cada limite de REGRAS.limitesSemana.
 */
export function probLimites(resumos, membros) {
  const L = REGRAS.limitesSemana;
  const usarEns = membros && membros.chuva.length >= 10;
  const chuvas = usarEns ? membros.chuva : resumos.map((r) => r.chuva).filter(valido);
  const raj = usarEns && membros.rajada.length >= 10 ? membros.rajada : resumos.map((r) => r.rajada?.valor).filter(valido);
  const frac = (arr, lim) => (arr.length ? arr.filter((x) => x > lim).length / arr.length : null);
  return {
    origem: usarEns ? 'cenários do ensemble' : 'concordância entre modelos',
    n: { chuva: chuvas.length, rajada: raj.length },
    chuva: L.chuva.map((l) => ({ limite: l, p: frac(chuvas, l) })),
    rajada: L.rajada.map((l) => ({ limite: l, p: frac(raj, l) })),
  };
}

// ---------- frase principal ----------

/**
 * Probabilidade horária de chuva e janela mais provável: o maior bloco contínuo (pela soma das probabilidades)
 * acima de max(0,4; 0,8 x pico). Sem janela se o pico for menor que 0,3.
 * @returns {{pico:number|null, janela:{ini:number, fim:number, soma:number}|null, porHora:object[]}}
 */
export function horasProvaveisDeChuva(prev, idx, modelos) {
  // por hora: mediana da probabilidade; se não houver, fração de modelos com chuva
  const porHora = idx.map((i) => {
    const probs = modelos.map((m) => prev.modelos[m]?.vars.precipitation_probability?.[i]).filter(valido);
    const mm = modelos.map((m) => prev.modelos[m]?.vars.precipitation?.[i]).filter(valido);
    const fr = mm.length ? mm.filter((x) => x >= REGRAS.chuvaHoraMm).length / mm.length : null;
    const p = probs.length ? mediana(probs) / 100 : fr;
    return { i, ms: prev.horas[i], p, mm: mediana(mm) };
  });
  const pico = maximo(porHora.map((h) => h.p));
  if (!valido(pico) || pico < 0.3) return { pico, janela: null, porHora };
  const limite = Math.max(0.4, pico * 0.8);
  // maior bloco contínuo acima do limite
  let melhor = null, atual = null;
  for (const h of porHora) {
    if (valido(h.p) && h.p >= limite) {
      if (!atual) atual = { ini: h.ms, fim: h.ms, soma: 0 };
      atual.fim = h.ms; atual.soma += h.p;
      if (!melhor || atual.soma > melhor.soma) melhor = { ...atual };
    } else atual = null;
  }
  return { pico, janela: melhor, porHora };
}

export function fraseDoDia(av, janela, offsetSeg) {
  let chuva;
  const palavra = av.prob === null ? null : palavraOcorrencia(av.prob);
  const periodo = janela ? periodosTexto(janela.ini, janela.fim, offsetSeg) : '';
  if (palavra === null) chuva = 'Previsão de chuva indisponível';
  else if (palavra === 'improvável') chuva = 'Sem chuva prevista';
  else if (palavra === 'pouco provável') chuva = 'Pouca chance de chuva' + (periodo ? ' ' + periodo : '');
  else if (palavra === 'possível') chuva = 'Chuva possível' + (periodo ? ' ' + periodo : '');
  else chuva = 'Chuva' + (periodo ? ' ' + periodo : '');
  const classe = classeRajada(av.rajada?.mediana);
  let vento = '';
  if (classe) vento = `com rajadas ${classe}`;
  else if (palavra === 'improvável' && valido(av.rajada?.mediana)) vento = 'vento fraco';
  if (!vento) return chuva;
  return palavra === 'improvável' ? `${chuva}, ${vento}` : `${chuva}, ${vento}`;
}

export function periodosTexto(iniMs, fimMs, offsetSeg) {
  const nomes = [];
  for (let t = iniMs; t <= fimMs; t += 3600000) {
    const p = periodoDoDia(partesLocais(t, offsetSeg).hora);
    if (!nomes.includes(p)) nomes.push(p);
  }
  const art = { madrugada: 'de madrugada', 'manhã': 'pela manhã', tarde: 'à tarde', noite: 'à noite' };
  if (nomes.length >= 3) return 'ao longo do dia';
  return nomes.map((n) => art[n]).join(' e ');
}

// ---------- divergência e pesos ----------

/**
 * Primeiro bloco futuro de 6 h em que os modelos divergem em chuva ou rajada (limites em REGRAS.divergencia).
 * @returns {{ms:number, motivo:string}|null}
 */
export function horizonteDivergencia(prev, modelos) {
  const D = REGRAS.divergencia;
  const ativos = modelos.filter((m) => prev.modelos[m]);
  for (let i0 = 0; i0 + 6 <= prev.horas.length; i0 += 6) {
    if (prev.horas[i0] < Date.now() - 3600000) continue;
    const idx = [0, 1, 2, 3, 4, 5].map((k) => i0 + k);
    const chuvas = ativos.map((m) => soma(prev.modelos[m].vars.precipitation, idx)).filter(valido);
    const raj = ativos.map((m) => maximo(idx.map((i) => prev.modelos[m].vars.wind_gusts_10m?.[i]))).filter(valido);
    let motivo = null;
    if (chuvas.length >= 2) {
      const d = maximo(chuvas) - minimo(chuvas);
      if (d > Math.max(D.chuvaMm, D.chuvaRazao * mediana(chuvas))) motivo = `chuva varia ${d.toFixed(0)} mm em 6 h`;
    }
    if (!motivo && raj.length >= 2 && maximo(raj) - minimo(raj) > D.rajadaKmh) {
      motivo = `rajadas variam ${Math.round(maximo(raj) - minimo(raj))} km/h`;
    }
    if (motivo) return { ms: prev.horas[i0], motivo };
  }
  return null;
}

// acertoPorModelo: { modelo: { dias, maeChuva } }. Pesos iniciais (verificação global) até 30 dias de dados
// locais; depois, peso inicial vezes o acerto local relativo (inverso do erro), limitado.
/**
 * Pesos dos modelos: peso inicial ajustado pelo erro relativo local (chuva e máxima), com confiança
 * c = dias / (dias + meiaPesos), limitado a [pesoMin, pesoMax]. Ver docs/TECNICO.md, seção 3.7.
 * @param {Object<string, {dias:number, maeChuva?:number, maeTmax?:number}>|null} acertoPorModelo
 * @param {string[]} modelos
 * @returns {{pesos:Object<string, number>, ajustado:boolean}}
 */
export function pesosModelos(acertoPorModelo, modelos) {
  const A = REGRAS.acerto, L = REGRAS.aprendizado;
  const base = (m) => REGRAS.pesoInicial[m] ?? 1;
  const pesos = Object.fromEntries(modelos.map((m) => [m, base(m)]));
  if (!acertoPorModelo) return { pesos, ajustado: false };
  const ok = modelos.filter((m) => acertoPorModelo[m]?.dias >= L.diasInicio && (valido(acertoPorModelo[m].maeChuva) || valido(acertoPorModelo[m].maeTmax)));
  if (ok.length < 2) return { pesos, ajustado: false };
  // erro relativo de cada modelo em cada medida (chuva e temperatura máxima): média dos outros / o dele
  const rel = (campo, piso) => {
    const xs = ok.filter((m) => valido(acertoPorModelo[m][campo]));
    if (xs.length < 2) return null;
    const media = xs.reduce((t, m) => t + Math.max(acertoPorModelo[m][campo], piso), 0) / xs.length;
    return Object.fromEntries(xs.map((m) => [m, media / Math.max(acertoPorModelo[m][campo], piso)]));
  };
  const rc = rel('maeChuva', 0.5), rt = rel('maeTmax', 0.3);
  ok.forEach((m) => {
    const rs = [rc?.[m], rt?.[m]].filter(valido);
    if (!rs.length) return;
    const r = rs.reduce((t, x) => t + x, 0) / rs.length;
    const c = acertoPorModelo[m].dias / (acertoPorModelo[m].dias + L.meiaPesos);
    pesos[m] = Math.min(A.pesoMax, Math.max(A.pesoMin, base(m) * (1 + c * (r - 1))));
  });
  return { pesos, ajustado: true };
}

// Viés de temperatura aprendido para um modelo: quanto ele erra para cima (+) ou para baixo (-),
// já reduzido pela confiança. Subtrair da previsão do modelo.
/**
 * Correção de viés de temperatura (previsto - medido) reduzida pela confiança c = n / (n + meiaVies)
 * e limitada a ±viesMax. O valor deve ser subtraído da previsão.
 * @returns {{tmax:number, tmin:number}}
 */
export function correcaoTemperatura(acertoModeloLead) {
  const L = REGRAS.aprendizado;
  const um = (vies, n) => {
    if (!valido(vies) || !(n >= L.diasInicio)) return 0;
    const c = n / (n + L.meiaVies);
    return Math.max(-L.viesMax, Math.min(L.viesMax, vies * c));
  };
  const a = acertoModeloLead || {};
  return { tmax: um(a.viesTmax, a.amostrasTmax), tmin: um(a.viesTmin, a.amostrasTmin) };
}

// Chance de chuva calibrada pelo histórico: se, quando o painel disse 30%, choveu em 50% das vezes,
// a chance sobe na direção de 50%, na medida da quantidade de casos naquela faixa.
/**
 * Calibração da chance pelo histórico: desloca p em direção à frequência observada na faixa de 10%
 * correspondente, com peso c = n / (n + meiaCalib). Só com calibMinPares pares no total.
 * @param {number} p probabilidade entre 0 e 1
 * @param {{pares:number, bins:{n:number, freq:number|null}[]}|null} calib
 * @returns {number}
 */
export function calibrarProb(p, calib) {
  const L = REGRAS.aprendizado;
  if (!valido(p) || !calib || !(calib.pares >= L.calibMinPares)) return p;
  const b = calib.bins?.[Math.min(9, Math.floor(p * 10))];
  if (!b?.n || !valido(b.freq)) return p;
  const c = b.n / (b.n + L.meiaCalib);
  return Math.max(0, Math.min(1, p + c * (b.freq - p)));
}

// Consenso por hora para gráficos: mediana, mínimo e máximo entre modelos.
/**
 * Séries horárias de mediana, mínimo e máximo de uma variável entre os modelos.
 * @returns {{med:Array<number|null>, lo:Array<number|null>, hi:Array<number|null>}}
 */
export function consensoHorario(prev, variavel, modelos) {
  const med = [], lo = [], hi = [];
  for (let i = 0; i < prev.horas.length; i++) {
    const vs = modelos.map((m) => prev.modelos[m]?.vars[variavel]?.[i]);
    med.push(mediana(vs)); lo.push(minimo(vs)); hi.push(maximo(vs));
  }
  return { med, lo, hi };
}

// ---------- condição do céu ----------
// cobertura: valores horários de cloud_cover (%) já em consenso entre modelos; dia: valores de is_day (0/1).
// Usa as horas de dia quando houver; senão, todas as horas. Devolve null sem dado (nunca inventa).
/**
 * Condição do céu pela cobertura média (horas de dia, se houver) e pela probabilidade de chuva.
 * @returns {{nivel:string, texto:string, noite:boolean, chuva:string|null, cobertura:number}|null}
 */
export function condicaoCeu(cobertura, dia, probChuva) {
  const C = REGRAS.ceu;
  const pares = (cobertura || []).map((c, i) => [c, dia?.[i]]).filter(([c]) => valido(c));
  if (!pares.length) return null;
  const deDia = pares.filter(([, d]) => d === 1 || d === true);
  const usar = deDia.length ? deDia : pares;
  const noite = !deDia.length && pares.some(([, d]) => d === 0 || d === false);
  const media = usar.reduce((s, [c]) => s + c, 0) / usar.length;
  let nivel, texto;
  if (media <= C.limpo) { nivel = 'limpo'; texto = noite ? 'Céu limpo' : 'Ensolarado'; }
  else if (media <= C.poucasNuvens) { nivel = 'poucas'; texto = noite ? 'Poucas nuvens' : 'Sol entre nuvens'; }
  else if (media <= C.parcial) { nivel = 'parcial'; texto = 'Parcialmente nublado'; }
  else { nivel = 'nublado'; texto = 'Nublado'; }
  const o = REGRAS.ocorrencia;
  let chuva = null;
  if (valido(probChuva) && probChuva >= o.provavel) chuva = 'provavel';
  else if (valido(probChuva) && probChuva >= o.possivel) chuva = 'possivel';
  if (chuva === 'provavel') texto = nivel === 'nublado' || nivel === 'parcial' ? 'Nublado com chuva' : (noite ? 'Pancadas de chuva' : 'Sol e pancadas de chuva');
  else if (chuva === 'possivel') texto = `${texto}, pode chover`;
  return { nivel, texto, noite, chuva, cobertura: media };
}

// Resposta curta para "vai chover?".
export function respostaChuva(prob) {
  if (!valido(prob)) return null;
  const p = palavraOcorrencia(prob);
  return { 'provável': 'Vai chover', 'possível': 'Pode chover', 'pouco provável': 'Chuva pouco provável', 'improvável': 'Não deve chover' }[p];
}

// ---------- pressão atmosférica ----------

/**
 * Variação de uma série entre a leitura mais recente e a leitura mais próxima de "horas" antes dela.
 * @param {{ms:number, valor:number|null}[]} serie leituras (qualquer ordem; inválidas são ignoradas)
 * @param {number} horas intervalo desejado, em horas
 * @param {number} toleranciaMin distância máxima, em minutos, entre a leitura de referência e o instante alvo
 * @returns {{delta:number, de:{ms:number, valor:number}, ate:{ms:number, valor:number}}|null}
 */
export function variacaoSerie(serie, horas, toleranciaMin) {
  const pts = (serie || []).filter((x) => valido(x?.valor) && valido(x?.ms)).sort((a, b) => a.ms - b.ms);
  if (pts.length < 2) return null;
  const ate = pts[pts.length - 1];
  const alvo = ate.ms - horas * 3600000;
  let de = null;
  for (const x of pts) if (x !== ate && (!de || Math.abs(x.ms - alvo) < Math.abs(de.ms - alvo))) de = x;
  if (!de || Math.abs(de.ms - alvo) > toleranciaMin * 60000) return null;
  return { delta: ate.valor - de.valor, de, ate };
}

/**
 * Classifica a tendência de 3 h da pressão pelos termos do Met Office e da OMM (REGRAS.pressao.tendencia3h).
 * @param {number|null} delta3h variação em hPa nas últimas 3 h
 * @returns {{sentido:'subindo'|'caindo'|'estavel', intensidade:string, texto:string}|null}
 */
export function classeTendenciaPressao(delta3h) {
  if (!valido(delta3h)) return null;
  const T = REGRAS.pressao.tendencia3h, a = Math.abs(delta3h);
  if (a < T.estavel) return { sentido: 'estavel', intensidade: '', texto: 'estável' };
  const sentido = delta3h > 0 ? 'subindo' : 'caindo';
  const intensidade = a <= T.devagar ? 'devagar' : a <= T.normal ? '' : a <= T.rapido ? 'rápido' : 'muito rápido';
  return { sentido, intensidade, texto: intensidade ? `${sentido} ${intensidade}` : sentido };
}

/**
 * Sinal de chuva pela pressão. Soma pontos objetivos e devolve o nível do sinal e os motivos:
 *   tendência de 3 h: queda acima de 3,5 hPa +2; queda de 1,6 a 3,5 +1; subida de 1,6 ou mais -1;
 *   queda de 6 hPa ou mais em 24 h +1;
 *   variação prevista nas próximas 12 h: queda de 4 hPa ou mais +1; subida de 4 hPa ou mais -1;
 *   nível: abaixo de 1008 hPa +1; acima de 1020 hPa -1.
 * Pontos: 3 ou mais = forte; 2 = moderado; 1 = fraco; 0 = nenhum; negativo = tempo firme.
 * É um indicador auxiliar: não altera a chance de chuva calculada pelos modelos.
 * @param {{atual?:number|null, d3?:number|null, d24?:number|null, prev?:number|null}} p
 * @returns {{pontos:number, sinal:'forte'|'moderado'|'fraco'|'nenhum'|'firme', motivos:string[]}|null}
 */
export function avaliarPressao({ atual = null, d3 = null, d24 = null, prev = null } = {}) {
  const R = REGRAS.pressao, T = R.tendencia3h;
  if (![atual, d3, d24, prev].some(valido)) return null;
  let pontos = 0;
  const motivos = [];
  const n1 = (v) => `${(Math.round(Math.abs(v) * 10) / 10).toString().replace('.', ',')} hPa`;
  if (valido(d3)) {
    if (d3 < -T.normal) { pontos += 2; motivos.push(`queda rápida de ${n1(d3)} em 3 h`); }
    else if (d3 < -T.devagar) { pontos += 1; motivos.push(`queda de ${n1(d3)} em 3 h`); }
    else if (d3 > T.devagar) { pontos -= 1; motivos.push(`subida de ${n1(d3)} em 3 h`); }
  }
  if (valido(d24) && d24 <= -R.queda24hForte) { pontos += 1; motivos.push(`queda de ${n1(d24)} em 24 h`); }
  if (valido(prev)) {
    if (prev <= -R.variacaoPrevForte) { pontos += 1; motivos.push(`modelos preveem queda de ${n1(prev)} nas próximas ${R.previsaoHoras} h`); }
    else if (prev >= R.variacaoPrevForte) { pontos -= 1; motivos.push(`modelos preveem subida de ${n1(prev)} nas próximas ${R.previsaoHoras} h`); }
  }
  if (valido(atual)) {
    if (atual < R.baixa) { pontos += 1; motivos.push(`pressão baixa (abaixo de ${R.baixa} hPa)`); }
    else if (atual > R.alta) { pontos -= 1; motivos.push(`pressão alta (acima de ${R.alta} hPa)`); }
  }
  const sinal = pontos >= 3 ? 'forte' : pontos === 2 ? 'moderado' : pontos === 1 ? 'fraco' : pontos === 0 ? 'nenhum' : 'firme';
  return { pontos, sinal, motivos };
}

/**
 * Leitura final da pressão, sempre coerente com a chance de chuva principal (que é a referência).
 * A pressão nunca contradiz a previsão: quando ela indica piora e os modelos não mostram chuva,
 * o texto fala em mudança no tempo sem chuva prevista; quando os modelos mostram chuva e a pressão
 * não cai, explica que a chuva prevista não depende de queda de pressão.
 * @param {{sinal:string}|null} av saída de avaliarPressao
 * @param {number|null} probChuva chance de chuva principal do dia (0 a 1), já calibrada
 * @returns {{titulo:string, texto:string, classe:string}|null}
 */
export function leituraPressao(av, probChuva) {
  if (!av) return null;
  const chuvaPrevista = valido(probChuva) && probChuva >= REGRAS.ocorrencia.possivel;
  const piora = av.sinal === 'forte' || av.sinal === 'moderado' || av.sinal === 'fraco';
  if (!valido(probChuva)) {
    return piora
      ? { titulo: 'Pressão caindo', texto: 'A queda costuma anteceder mudança no tempo. A previsão de chuva está indisponível agora para confirmar.', classe: 'mudanca' }
      : { titulo: av.sinal === 'firme' ? 'Pressão subindo ou alta' : 'Pressão estável', texto: 'Sem indício de piora pela pressão.', classe: av.sinal === 'firme' ? 'firme' : 'neutra' };
  }
  if (piora && chuvaPrevista) {
    return { titulo: 'Confirma a chuva prevista', classe: av.sinal === 'forte' ? 'forte' : 'confirma',
      texto: av.sinal === 'fraco'
        ? 'A pressão começa a cair, de acordo com a chuva prevista pelos modelos.'
        : 'A pressão está caindo, como acontece antes de uma frente ou de um sistema de baixa pressão. Isso reforça a chuva prevista pelos modelos.' };
  }
  if (piora) {
    return { titulo: 'Mudança no tempo, sem chuva prevista', classe: 'mudanca',
      texto: 'A pressão está caindo, mas os modelos não mostram chuva para hoje. Por enquanto, a queda indica mais nuvens ou vento. Se ela continuar, a próxima atualização da previsão vai refletir isso.' };
  }
  if (chuvaPrevista) {
    return { titulo: 'Pressão estável', classe: 'neutra',
      texto: 'A pressão não mostra queda. Isso não muda a chuva prevista pelos modelos: pancadas de calor e umidade, por exemplo, acontecem sem queda de pressão.' };
  }
  return av.sinal === 'firme'
    ? { titulo: 'Tempo firme', classe: 'firme', texto: 'A pressão está subindo ou alta, de acordo com a previsão sem chuva.' }
    : { titulo: 'Pressão estável', classe: 'neutra', texto: 'A pressão não mostra variação importante, de acordo com a previsão sem chuva.' };
}

// ---------- chuva chegando (radar) ----------

/**
 * Deslocamento dos ecos de radar entre dois quadros por correlação de blocos (block matching):
 * procura o (dx, dy) que minimiza o erro absoluto médio entre o quadro novo e o antigo deslocado,
 * contando só células com eco em algum dos dois. Recusa o resultado quando há pouco eco ou quando
 * o melhor deslocamento não melhora o ajuste o bastante em relação a "parado".
 * @param {ArrayLike<number>} antigo grade n x n, intensidade média do eco por célula (0 a 1)
 * @param {ArrayLike<number>} novo grade n x n do quadro mais recente
 * @param {number} n lado da grade
 * @returns {{dx:number, dy:number, melhora:number}|null} deslocamento em células no intervalo
 */
export function deslocamentoRadar(antigo, novo, n) {
  const R = REGRAS.radar, M = R.deslocMax, L = R.limiarMovimento;
  let ca = 0, cn = 0;
  for (let k = 0; k < n * n; k++) { if (antigo[k] >= L) ca++; if (novo[k] >= L) cn++; }
  if (ca < R.celulasMin || cn < R.celulasMin) return null;
  const erro = (dx, dy) => {
    let soma = 0, cont = 0;
    for (let y = M; y < n - M; y++) for (let x = M; x < n - M; x++) {
      const b = novo[y * n + x], a = antigo[(y - dy) * n + (x - dx)];
      if (a < L && b < L) continue;
      soma += Math.abs(a - b); cont++;
    }
    return cont ? soma / cont : Infinity;
  };
  const e0 = erro(0, 0);
  let melhor = { dx: 0, dy: 0, e: e0 };
  for (let dy = -M; dy <= M; dy++) for (let dx = -M; dx <= M; dx++) {
    const e = erro(dx, dy);
    if (e < melhor.e) melhor = { dx, dy, e };
  }
  if (!Number.isFinite(e0) || !Number.isFinite(melhor.e)) return null;
  const melhora = e0 > 0 ? 1 - melhor.e / e0 : 0;
  if ((melhor.dx || melhor.dy) && melhora < R.melhoraMin) return null;
  return { dx: melhor.dx, dy: melhor.dy, melhora };
}

/**
 * Extrapolação: a cada passo de tempo, olha o ponto de onde a chuva viria (posição menos velocidade x tempo)
 * no quadro mais recente. A primeira vez em que a vizinhança tem eco é a chegada estimada.
 * @param {ArrayLike<number>} grade quadro mais recente, n x n
 * @param {number} n
 * @param {number} px coluna do local na grade
 * @param {number} py linha do local na grade
 * @param {{dx:number, dy:number}} desl deslocamento em células por REGRAS.radar.intervaloMin
 * @returns {number|null} minutos até a chegada (0 = já sobre o local), ou null se nada chega no horizonte
 */
export function chegadaChuva(grade, n, px, py, desl) {
  const R = REGRAS.radar;
  const vx = desl.dx / R.intervaloMin, vy = desl.dy / R.intervaloMin;
  const temEco = (cx, cy) => {
    let soma = 0, cont = 0;
    for (let y = Math.round(cy) - R.raioCelulas; y <= Math.round(cy) + R.raioCelulas; y++) {
      for (let x = Math.round(cx) - R.raioCelulas; x <= Math.round(cx) + R.raioCelulas; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) return null; // saiu da área conhecida: não afirma nada
        soma += grade[y * n + x]; cont++;
      }
    }
    return soma / cont >= R.ecoMin;
  };
  for (let t = 0; t <= R.horizonteMin; t += R.passoMin) {
    const r = temEco(px - vx * t, py - vy * t);
    if (r === null) return null;
    if (r) return t;
  }
  return null;
}

// ---------- risco de temporal ----------

/**
 * Risco de temporal por pontos objetivos (limites em REGRAS.temporal). Com aviso de tempestade do INMET em
 * vigor, o nível é o do aviso (perigo potencial = moderado; perigo ou grande perigo = alto). Só é avaliado quando a previsão
 * principal tem chuva (possível ou provável), quando está chovendo ou chegando chuva, ou quando há
 * aviso de tempestade do INMET; fora disso devolve null, para não contradizer a previsão sem chuva.
 * @param {{prob?:number|null, chovendo?:boolean, chegando?:boolean, cape?:number|null, chuvaHora?:number|null,
 *   rajada?:number|null, d3Pressao?:number|null, aviso?:string|null}} e
 * @returns {{nivel:'baixo'|'moderado'|'alto', pontos:number, motivos:string[]}|null}
 */
export function riscoTemporal({ prob = null, chovendo = false, chegando = false, cape = null, chuvaHora = null, rajada = null, d3Pressao = null, aviso = null } = {}) {
  const T = REGRAS.temporal;
  const nivelAviso = aviso ? T.aviso[String(aviso).trim().toLowerCase()] ?? 'moderado' : null;
  const chuva = chovendo || chegando || (valido(prob) && prob >= REGRAS.ocorrencia.possivel);
  if (!chuva && !nivelAviso) return null;
  let pontos = 0;
  const motivos = [];
  const faixa = (v, [a, b], nome, un) => {
    if (!valido(v) || v < a) return;
    pontos += v >= b ? 2 : 1;
    motivos.push(`${nome} ${v >= b ? 'muito ' : ''}${nome === 'energia para tempestades' ? 'alta' : 'forte'} (${Math.round(v)} ${un})`);
  };
  faixa(cape, T.cape, 'energia para tempestades', 'J/kg');
  faixa(chuvaHora, T.chuvaHoraMm, 'chuva', 'mm/h');
  faixa(rajada, T.rajada, 'rajadas', 'km/h');
  if (valido(d3Pressao) && d3Pressao < -T.quedaPressao3h) { pontos += 1; motivos.push('pressão caindo rápido'); }
  let nivel = pontos >= T.niveis.alto ? 'alto' : pontos >= T.niveis.moderado ? 'moderado' : 'baixo';
  if (nivelAviso) { nivel = nivelAviso; motivos.unshift(`aviso de tempestade do INMET em vigor (${String(aviso).toLowerCase()})`); }
  return { nivel, pontos, motivos };
}
