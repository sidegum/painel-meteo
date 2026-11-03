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
  divisaoCenarios: [0.3, 0.7], // probabilidade nesse intervalo = cenários divididos
  horizonteLongoDias: 4,       // a partir do 5º dia, perde um nível de confiança
  // Só os modelos globais de melhor desempenho nas verificações publicadas (centro líder da OMM para
  // verificação, sediado no ECMWF): ECMWF IFS, ECMWF AIFS e UKMO. GFS e ICON saíram da previsão.
  // Peso inicial maior para o ECMWF IFS; depois de 30 dias de dados locais, o acerto medido aqui ajusta.
  pesoInicial: {
    ecmwf_ifs: 1.3, ecmwf_aifs025_single: 1.15, ukmo_global_deterministic_10km: 1.15,
  },
  acerto: {
    diasMinimos: 30,           // pesos iniciais até ter 30 dias de dados locais
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
};

export const MODELOS = {
  ecmwf_ifs: { nome: 'ECMWF IFS', curto: 'ECMWF', cor: 'var(--m-ecmwf)' },
  ecmwf_aifs025_single: { nome: 'ECMWF AIFS', curto: 'AIFS', cor: 'var(--m-aifs)' },
  ukmo_global_deterministic_10km: { nome: 'UKMO (Met Office)', curto: 'UKMO', cor: 'var(--m-ukmo)' },
};

// ---------- utilidades numéricas ----------

export const valido = (v) => typeof v === 'number' && Number.isFinite(v);

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
export function isoLocalParaMs(iso, offsetSeg) {
  const [d, t = '00:00'] = iso.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, m) - offsetSeg * 1000;
}

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
export function membrosDia(ens, data, offsetSeg, aPartirMs) {
  if (!ens) return null;
  const out = { chuva: [], rajada: [], modelos: [] };
  for (const [modelo, e] of Object.entries(ens)) {
    const idx = indicesDoDia(e.horas, data, offsetSeg, aPartirMs);
    if (!idx.length) continue;
    let usou = false;
    for (const m of e.membros.precipitation || []) {
      const s = soma(m, idx); if (s !== null) { out.chuva.push(s); usou = true; }
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
export function avaliarDia(resumos, membros, ctx = {}) {
  const R = REGRAS;
  const pesos = ctx.pesos || {};
  const comChuva = resumos.filter((r) => r.chuva !== null);
  const chuvas = comChuva.map((r) => r.chuva);
  const pesosChuva = comChuva.map((r) => pesos[r.modelo] ?? 1);
  const motivos = [];

  // 1. probabilidade dos cenários
  let prob = null, fonteProb = null;
  if (membros?.chuva?.length >= 10) {
    prob = membros.chuva.filter((x) => x >= R.chuvaMinimaMm).length / membros.chuva.length;
    fonteProb = `${membros.chuva.length} cenários do ensemble`;
  } else if (chuvas.length) {
    prob = chuvas.filter((x) => x >= R.chuvaMinimaMm).length / chuvas.length;
    fonteProb = `concordância entre ${chuvas.length} modelos (sem ensemble)`;
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

  let pontosChuva = 3;
  if (prob === null) { pontosChuva = 1; motivos.push('sem dados de chuva suficientes'); }
  if (concordancia !== null && concordancia < 1) {
    pontosChuva -= concordancia <= 0.6 ? 2 : 1;
    motivos.push(`modelos discordam sobre chover (${Math.round(concordancia * 100)}% no mesmo lado)`);
  }
  if (concordancia === null && chuvas.length < 2) { pontosChuva -= 1; motivos.push('menos de dois modelos com dados'); }
  if (prob !== null && prob >= R.divisaoCenarios[0] && prob <= R.divisaoCenarios[1]) {
    pontosChuva -= 1; motivos.push('cenários divididos entre chover e não chover');
  }
  if (volumeIncerto) { pontosChuva -= 1; motivos.push('volume muito diferente entre modelos'); }

  // 3. rajadas
  const rajadas = resumos.map((r) => r.rajada?.valor).filter(valido);
  let pontosRajada = 3, rajadaIncerta = false;
  const rajadaMed = mediana(resumos.map((r) => r.rajada?.valor), resumos.map((r) => pesos[r.modelo] ?? 1));
  if (rajadas.length >= 2) {
    rajadaIncerta = (maximo(rajadas) - minimo(rajadas)) / Math.max(rajadaMed, 10) >= R.rajadaIncertaRazao;
    if (rajadaIncerta) { pontosRajada -= 1; motivos.push('rajadas diferentes entre modelos'); }
    const classes = new Set(rajadas.map((x) => classeRajada(x) || 'fracas'));
    if (classes.size > 2) { pontosRajada -= 1; motivos.push('modelos divergem na força das rajadas'); }
  } else { pontosRajada = 1; motivos.push('rajada de um só modelo ou nenhum'); }
  const rajadaFaixa = membros?.rajada?.length >= 10
    ? { min: quantil(membros.rajada, 0.1), max: quantil(membros.rajada, 0.9), mediana: quantil(membros.rajada, 0.5), origem: 'cenários' }
    : rajadas.length ? { min: minimo(rajadas), max: maximo(rajadas), mediana: rajadaMed, origem: 'modelos' } : null;

  // horizonte
  if ((ctx.diaIndice ?? 0) >= R.horizonteLongoDias) {
    pontosChuva -= 1; pontosRajada -= 1; motivos.push('previsão para mais de 4 dias');
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
  const geral = ordem[chuvaNivel] <= ordem[rajadaNivel] ? chuvaNivel : rajadaNivel;

  // mensagem curta de chuva
  let mensagemChuva = null;
  if (prob !== null) {
    const palavra = palavraOcorrencia(prob);
    if (palavra === 'improvável') mensagemChuva = 'chuva improvável';
    else mensagemChuva = `chuva ${palavra}` + (volumeIncerto ? ', volume incerto' : '');
  }

  return {
    prob, fonteProb, probModelos, volume, volumeIncerto, concordancia, mensagemChuva,
    rajada: rajadaFaixa, rajadaIncerta,
    confianca: { geral, chuva: chuvaNivel, rajada: rajadaNivel, motivos: [...new Set(motivos)] },
  };
}

// Probabilidades de passar limites, para a aba Semana.
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
export function pesosModelos(acertoPorModelo, modelos) {
  const A = REGRAS.acerto;
  const base = (m) => REGRAS.pesoInicial[m] ?? 1;
  const pesos = Object.fromEntries(modelos.map((m) => [m, base(m)]));
  if (!acertoPorModelo) return { pesos, ajustado: false };
  const ok = modelos.filter((m) => acertoPorModelo[m]?.dias >= A.diasMinimos && valido(acertoPorModelo[m].maeChuva));
  if (ok.length < 2) return { pesos, ajustado: false };
  const inv = ok.map((m) => 1 / Math.max(acertoPorModelo[m].maeChuva, 0.5));
  const media = inv.reduce((s, x) => s + x, 0) / inv.length;
  ok.forEach((m, k) => { pesos[m] = Math.min(A.pesoMax, Math.max(A.pesoMin, base(m) * (inv[k] / media))); });
  return { pesos, ajustado: true };
}

// Consenso por hora para gráficos: mediana, mínimo e máximo entre modelos.
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
