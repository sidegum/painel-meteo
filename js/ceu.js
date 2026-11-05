// Céu visto do seu local: o que dá para ver a olho nu, quando, para onde olhar e a que altura.
// Módulo só de cálculo (sem DOM), usado pelo bloco "Céu de hoje" e pelos cartões do Globo; testado em test/ceu.test.mjs.
//
// Fontes dos cálculos:
// - Sol, Lua e planetas: Astronomy Engine 2.1.19 (Don Cross, MIT), validado pelo autor contra o JPL Horizons e o
//   NOVAS (erro menor que 1 minuto de arco). Dá posições, nascer e pôr, fases, magnitudes e eclipses.
// - Satélites: elementos orbitais do CelesTrak propagados pelo SGP4 (satellite.js). A previsão de passagem vale
//   para 1 a 2 dias com erro típico de segundos a 1 minuto; elementos mais velhos que 3 dias são descartados.
// - Chuvas de meteoros: lista de trabalho da IMO (International Meteor Organization). O pico é guardado pela
//   longitude solar, que não muda de um ano para outro, e a data é calculada para cada ano pelo Astronomy Engine.
//
// Regras de visibilidade (constantes em VIS, fáceis de ajustar):
// - Céu escuro o bastante para estrelas e planetas: Sol 6° ou mais abaixo do horizonte (fim do crepúsculo civil).
// - Planeta, satélite ou radiante: pelo menos 10° acima do horizonte (abaixo disso, prédios, árvores e névoa tapam).
// - Planeta a olho nu: magnitude até 5,5 e afastado do Sol no céu pelo menos 12° (perto disso, some no clarão).
// - Satélite visível: iluminado pelo Sol (fora da sombra da Terra) enquanto o céu do observador está escuro.
import * as A from '../vendor/astronomy/astronomy.min.js';
import * as sat from '../vendor/satellite/satellite.min.js';

export const VIS = {
  solEscuro: -6,          // graus: Sol abaixo disso = céu escuro o bastante
  alturaMin: 10,          // graus: altura mínima útil de um astro ou satélite
  alturaMinLua: 5,        // graus: a Lua é vista mais baixa (é muito mais brilhante)
  magMaxPlaneta: 5.5,     // magnitude: limite a olho nu num céu de cidade pequena
  afastamentoSolMin: 12,  // graus: abaixo disso o astro fica no clarão do Sol
  passoMin: 5,            // minutos: passo da varredura de altura dos astros
  passoSatS: 20,          // segundos: passo da varredura dos satélites (refinado por bisseção)
  idadeMaxElementosDias: 3,
};

const RAD = Math.PI / 180;
const UA_KM = 149597870.7;

/** Nomes em português e dados físicos fixos (NASA Planetary Fact Sheet). */
export const CORPOS = {
  Sun: { nome: 'Sol', diametroKm: 1392700 },
  Moon: { nome: 'Lua', diametroKm: 3475, rotacao: '27,3 dias (sempre a mesma face voltada para a Terra)', ano: '27,3 dias em volta da Terra' },
  Mercury: { nome: 'Mercúrio', diametroKm: 4879, rotacao: '58,6 dias', ano: '88 dias' },
  Venus: { nome: 'Vênus', diametroKm: 12104, rotacao: '243 dias (gira ao contrário)', ano: '225 dias' },
  Mars: { nome: 'Marte', diametroKm: 6792, rotacao: '24 h 37 min', ano: '687 dias' },
  Jupiter: { nome: 'Júpiter', diametroKm: 142984, rotacao: '9 h 56 min', ano: '11,9 anos' },
  Saturn: { nome: 'Saturno', diametroKm: 120536, rotacao: '10 h 33 min', ano: '29,5 anos' },
  Uranus: { nome: 'Urano', diametroKm: 51118, rotacao: '17 h 14 min (gira ao contrário)', ano: '84 anos' },
  Neptune: { nome: 'Netuno', diametroKm: 49528, rotacao: '16 h 6 min', ano: '165 anos' },
  Pluto: { nome: 'Plutão', diametroKm: 2377, rotacao: '6,4 dias (gira ao contrário)', ano: '248 anos', anao: true },
};
export const PLANETAS_OLHO_NU = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

/**
 * Chuvas de meteoros anuais da lista de trabalho da IMO: longitude solar do pico (J2000), taxa horária zenital (ZHR),
 * radiante (ascensão reta e declinação em graus), período de atividade (longitudes solares) e velocidade (km/s) e largura do pico (dias para a taxa cair a 1/10).
 */
export const CHUVAS = [
  { nome: 'Quadrântidas', pico: 283.15, zhr: 110, ra: 230, dec: 49, de: 277, ate: 288, vel: 41, largura: 0.6 },
  { nome: 'Alfa-Centaurídeas', pico: 319.2, zhr: 6, ra: 210, dec: -59, de: 313, ate: 324, vel: 58, largura: 1.5 },
  { nome: 'Líridas', pico: 32.32, zhr: 18, ra: 271, dec: 34, de: 24, ate: 36, vel: 49, largura: 1 },
  { nome: 'Eta-Aquáridas', pico: 45.5, zhr: 50, ra: 338, dec: -1, de: 29, ate: 69, vel: 66, largura: 5 },
  { nome: 'Delta-Aquáridas do Sul', pico: 127, zhr: 25, ra: 340, dec: -16, de: 109, ate: 145, vel: 41, largura: 5 },
  { nome: 'Perseidas', pico: 140.0, zhr: 100, ra: 48, dec: 58, de: 115, ate: 157, vel: 59, largura: 2.5 },
  { nome: 'Oriônidas', pico: 208, zhr: 20, ra: 95, dec: 16, de: 194, ate: 233, vel: 66, largura: 5 },
  { nome: 'Táuridas do Sul', pico: 223, zhr: 5, ra: 52, dec: 15, de: 197, ate: 247, vel: 27, largura: 10 },
  { nome: 'Táuridas do Norte', pico: 230, zhr: 5, ra: 58, dec: 22, de: 207, ate: 252, vel: 29, largura: 10 },
  { nome: 'Leônidas', pico: 235.27, zhr: 15, ra: 152, dec: 22, de: 223, ate: 243, vel: 71, largura: 1.5 },
  { nome: 'Gemínidas', pico: 262.2, zhr: 150, ra: 112, dec: 33, de: 251, ate: 266, vel: 35, largura: 2 },
  { nome: 'Úrsidas', pico: 270.7, zhr: 10, ra: 217, dec: 76, de: 266, ate: 273, vel: 33, largura: 1 },
];

/** Nomes em português das 88 constelações da IAU, pela sigla oficial. */
export const CONSTELACOES = {
  And: 'Andrômeda', Ant: 'Máquina Pneumática', Aps: 'Ave do Paraíso', Aqr: 'Aquário', Aql: 'Águia', Ara: 'Altar', Ari: 'Áries',
  Aur: 'Cocheiro', Boo: 'Boieiro', Cae: 'Buril', Cam: 'Girafa', Cnc: 'Câncer', CVn: 'Cães de Caça', CMa: 'Cão Maior',
  CMi: 'Cão Menor', Cap: 'Capricórnio', Car: 'Quilha', Cas: 'Cassiopeia', Cen: 'Centauro', Cep: 'Cefeu', Cet: 'Baleia',
  Cha: 'Camaleão', Cir: 'Compasso', Col: 'Pomba', Com: 'Cabeleira de Berenice', CrA: 'Coroa Austral', CrB: 'Coroa Boreal',
  Crv: 'Corvo', Crt: 'Taça', Cru: 'Cruzeiro do Sul', Cyg: 'Cisne', Del: 'Golfinho', Dor: 'Dourado', Dra: 'Dragão',
  Equ: 'Cavalo Menor', Eri: 'Erídano', For: 'Fornalha', Gem: 'Gêmeos', Gru: 'Grou', Her: 'Hércules', Hor: 'Relógio',
  Hya: 'Hidra', Hyi: 'Hidra Macho', Ind: 'Índio', Lac: 'Lagarto', Leo: 'Leão', LMi: 'Leão Menor', Lep: 'Lebre', Lib: 'Libra',
  Lup: 'Lobo', Lyn: 'Lince', Lyr: 'Lira', Men: 'Mesa', Mic: 'Microscópio', Mon: 'Unicórnio', Mus: 'Mosca', Nor: 'Esquadro',
  Oct: 'Oitante', Oph: 'Serpentário', Ori: 'Órion', Pav: 'Pavão', Peg: 'Pégaso', Per: 'Perseu', Phe: 'Fênix', Pic: 'Pintor',
  Psc: 'Peixes', PsA: 'Peixe Austral', Pup: 'Popa', Pyx: 'Bússola', Ret: 'Retículo', Sge: 'Flecha', Sgr: 'Sagitário',
  Sco: 'Escorpião', Scl: 'Escultor', Sct: 'Escudo', Ser: 'Serpente', Sex: 'Sextante', Tau: 'Touro', Tel: 'Telescópio',
  Tri: 'Triângulo', TrA: 'Triângulo Austral', Tuc: 'Tucano', UMa: 'Ursa Maior', UMi: 'Ursa Menor', Vel: 'Vela', Vir: 'Virgem',
  Vol: 'Peixe Voador', Vul: 'Raposa',
};

// ------------------------------------------------------------------ utilidades

const data = (ms) => new Date(ms);
const ms = (t) => (t ? t.date.getTime() : null);

/** Observador do Astronomy Engine para (lat, lon) em graus e altitude em metros. */
export function observador(lat, lon, altitudeM = 0) { return new A.Observer(lat, lon, altitudeM); }

/** Rumo em português (8 direções) para um azimute em graus (0 = norte, 90 = leste). */
export function rumo(az) { return ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'][Math.round(((az % 360) + 360) % 360 / 45) % 8]; }

/** Altura no céu em palavras simples. */
export function alturaTexto(alt) { return alt >= 70 ? 'quase a pino' : alt >= 45 ? 'alto no céu' : alt >= 20 ? 'a meia altura' : 'baixo no horizonte'; }

/** Brilho a olho nu pela magnitude (quanto menor, mais brilhante). */
export function brilhoTexto(mag) { return mag <= -3 ? 'brilha muito, mais que qualquer estrela' : mag <= -1 ? 'muito brilhante' : mag <= 1 ? 'brilhante como as estrelas mais fortes' : mag <= 3 ? 'visível como uma estrela comum' : mag <= 4.5 ? 'visível longe das luzes fortes da cidade' : 'fraca, só com céu bem escuro'; }

/** Posição de um corpo visto do observador (com refração), em graus. */
export function posicaoNoCeu(corpo, obs, t) {
  const eq = A.Equator(corpo, data(t), obs, true, true);
  const h = A.Horizon(data(t), obs, eq.ra, eq.dec, 'normal');
  return { altura: h.altitude, azimute: h.azimuth, ra: eq.ra * 15, dec: eq.dec, distUa: eq.dist };
}

/** Posição heliocêntrica de um corpo em coordenadas eclípticas J2000 (UA), a mesma referência das sondas do Horizons. */
const ROT_ECL = A.Rotation_EQJ_ECL();
export function helioEcliptica(corpo, t) { const v = A.RotateVector(ROT_ECL, A.HelioVector(corpo, data(t))); return { x: v.x, y: v.y, z: v.z }; }
export const UA = UA_KM;

/** Altura do Sol (graus) vista do observador. */
export const alturaSol = (obs, t) => posicaoNoCeu('Sun', obs, t).altura;

/**
 * Direção geocêntrica de um corpo no referencial fixo da Terra (latitude e longitude do ponto sob o astro).
 * Usada pelo Globo para pôr Sol, Lua e planetas na direção real e para o terminador dia/noite.
 * @returns {{lat:number, lon:number, distKm:number}}
 */
export function pontoSob(corpo, t) {
  const d = data(t);
  const v = A.RotateVector(A.Rotation_EQJ_EQD(d), A.GeoVector(corpo, d, true));
  const eq = A.EquatorFromVector(v);
  let lon = eq.ra * 15 - A.SiderealTime(d) * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat: eq.dec, lon, distKm: eq.dist * UA_KM };
}

// ------------------------------------------------------------------ estrelas

/**
 * Estrela do catálogo vista do observador: posição agora (com precessão, aberração e refração), nascer, pôr e
 * passagem pelo meridiano nas próximas 24 h. Uma estrela que nunca se põe (ou nunca nasce) neste local fica com
 * nasce e poe nulos e o campo sempre indica qual dos dois casos.
 * @param {number} ra ascensão reta J2000 em graus
 * @param {number} dec declinação J2000 em graus
 */
export function infoEstrela(ra, dec, obs, t) {
  A.DefineStar(A.Body.Star1, ra / 15, dec, 1000);
  const d = data(t);
  const eq = A.Equator(A.Body.Star1, d, obs, true, true);
  const h = A.Horizon(d, obs, eq.ra, eq.dec, 'normal');
  const lat = obs.latitude;
  const sempre = Math.abs(dec) > 90 - Math.abs(lat) ? (Math.sign(dec) === Math.sign(lat) ? 'acima' : 'abaixo') : null;
  const busca = (dir) => (sempre ? null : ms(A.SearchRiseSet(A.Body.Star1, obs, dir, d, 1)));
  const c = A.SearchHourAngle(A.Body.Star1, obs, 0, d);
  return {
    altura: h.altitude, azimute: h.azimuth, nasce: busca(+1), poe: busca(-1), sempre,
    culmina: { ms: c.time.date.getTime(), altura: c.hor.altitude },
  };
}

/** Temperatura da superfície estimada pelo índice de cor B−V (fórmula de Ballesteros, 2012), em kelvin. */
export const temperaturaCor = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

// ------------------------------------------------------------------ Sol e noite

/**
 * Horários do Sol num dia local: nascer, pôr, fim e início do crepúsculo civil (Sol a -6°).
 * @param {object} obs observador
 * @param {number} inicioDiaMs meia-noite local do dia, em ms
 */
export function solDoDia(obs, inicioDiaMs) {
  const d = data(inicioDiaMs);
  return {
    nasce: ms(A.SearchRiseSet('Sun', obs, +1, d, 1)),
    poe: ms(A.SearchRiseSet('Sun', obs, -1, d, 1)),
    clareia: ms(A.SearchAltitude('Sun', obs, +1, d, 1, VIS.solEscuro)),
    escurece: ms(A.SearchAltitude('Sun', obs, -1, d, 1, VIS.solEscuro)),
    culmina: ms(A.SearchHourAngle('Sun', obs, 0, d).time),
  };
}

/**
 * Janela de "hoje" para o céu: de agora até o céu clarear depois da próxima noite. De dia, cobre a noite que vem
 * inteira (inclusive a madrugada); de noite, o resto da noite.
 * @returns {{inicio:number, fim:number, escurece:number, clareia:number, nasceSol:number}}
 */
export function janelaDaNoite(obs, agoraMs) {
  const escuroAgora = alturaSol(obs, agoraMs) <= VIS.solEscuro;
  const escurece = escuroAgora ? agoraMs : ms(A.SearchAltitude('Sun', obs, -1, data(agoraMs), 1.2, VIS.solEscuro));
  const clareia = ms(A.SearchAltitude('Sun', obs, +1, data(escurece ?? agoraMs), 1.2, VIS.solEscuro));
  const nasceSol = clareia === null ? null : ms(A.SearchRiseSet('Sun', obs, +1, data(clareia), 1));
  // regiões polares podem não ter noite ou dia: a janela vira as próximas 24 h
  return { inicio: agoraMs, fim: clareia ?? agoraMs + 86400000, escurece: escurece ?? null, clareia: clareia ?? null, nasceSol };
}

// ------------------------------------------------------------------ Lua e planetas

/** Fase da Lua: ângulo (0 nova, 180 cheia), fração iluminada e nome. */
export function faseLua(t) {
  const ang = A.MoonPhase(data(t));
  const fracao = A.Illumination('Moon', data(t)).phase_fraction;
  const nome = ang < 6 || ang >= 354 ? 'nova' : ang < 84 ? 'crescente' : ang < 96 ? 'quarto crescente' : ang < 174 ? 'crescente gibosa'
    : ang < 186 ? 'cheia' : ang < 264 ? 'minguante gibosa' : ang < 276 ? 'quarto minguante' : 'minguante';
  return { angulo: ang, fracao, nome };
}

/** Próximas fases principais da Lua a partir de t (4 itens). */
export function proximasFases(t) {
  const nomes = ['Lua nova', 'Quarto crescente', 'Lua cheia', 'Quarto minguante'];
  const out = [];
  let q = A.SearchMoonQuarter(data(t));
  for (let k = 0; k < 4 && q; k++) { out.push({ nome: nomes[q.quarter], ms: ms(q.time) }); q = A.NextMoonQuarter(q); }
  return out;
}

/**
 * Tudo o que um cartão precisa sobre um astro (Sol, Lua ou planeta) no instante t, visto do observador.
 * @returns {object} posição, distância, brilho, fase, nascer/pôr nas próximas 24 h, constelação e afastamento do Sol
 */
export function infoAstro(corpo, obs, t) {
  const d = data(t);
  const p = posicaoNoCeu(corpo, obs, t);
  const geo = A.Equator(corpo, d, obs, false, true); // J2000 para a constelação
  const constel = A.Constellation(geo.ra, geo.dec);
  const info = {
    corpo, nome: CORPOS[corpo]?.nome || corpo, ...p,
    distKm: p.distUa * UA_KM,
    nasce: ms(A.SearchRiseSet(corpo, obs, +1, d, 1)), poe: ms(A.SearchRiseSet(corpo, obs, -1, d, 1)),
    culmina: null, constelacao: CONSTELACOES[constel.symbol] || constel.name,
    diametroAparente: 2 * Math.atan((CORPOS[corpo]?.diametroKm || 0) / 2 / (p.distUa * UA_KM)) / RAD * 60, // minutos de arco
  };
  try { const c = A.SearchHourAngle(corpo, obs, 0, d); info.culmina = { ms: ms(c.time), altura: c.hor.altitude }; } catch { /* corpo sem passagem meridiana no intervalo */ }
  if (corpo !== 'Sun') {
    const il = A.Illumination(corpo, d);
    info.mag = il.mag; info.fracao = il.phase_fraction; info.distSolUa = il.helio_dist;
    info.afastamentoSol = A.AngleFromSun(corpo, d);
  }
  if (corpo === 'Moon') info.fase = faseLua(t);
  if (corpo !== 'Sun' && corpo !== 'Moon') info.periodo = A.Elongation(corpo, d).visibility === 'morning' ? 'madrugada' : 'noite';
  return info;
}

/**
 * Quando um astro fica visível a olho nu dentro da janela (céu escuro o bastante para o brilho dele, altura mínima
 * e afastado do clarão do Sol). Varre de janela.inicio até o nascer do Sol a cada VIS.passoMin minutos e devolve o
 * primeiro trecho contínuo com céu escuro (a Lua pode ter também um trecho de dia, marcado como deDia).
 * @returns {{inicio:number, fim:number, melhor:{ms:number, altura:number, azimute:number}, mag:number, deDia:boolean}|null}
 */
export function janelaVisivel(corpo, obs, janela) {
  const lua = corpo === 'Moon';
  const minAlt = lua ? VIS.alturaMinLua : VIS.alturaMin;
  const passo = VIS.passoMin * 60000;
  // astros muito brilhantes aparecem ainda no crepúsculo (Vênus logo depois do pôr ou antes do nascer do Sol)
  const mag0 = A.Illumination(corpo, data(janela.inicio)).mag;
  const solLimite = lua ? 0 : mag0 <= -3.5 ? -1 : mag0 <= -1 ? -4 : VIS.solEscuro;
  if (lua && faseLua(janela.inicio).fracao < 0.03) return null; // perto da Lua nova ela não aparece
  const trechos = [];
  let atual = null;
  for (let t = janela.inicio; t <= (janela.nasceSol ?? janela.fim); t += passo) {
    const hs = alturaSol(obs, t);
    const p = posicaoNoCeu(corpo, obs, t);
    const ok = p.altura >= minAlt && (lua ? true : hs <= solLimite);
    const deDia = hs > solLimite;
    if (ok && atual && atual.deDia === deDia) {
      atual.fim = t;
      if (p.altura > atual.melhor.altura) atual.melhor = { ms: t, altura: p.altura, azimute: p.azimute };
    } else if (ok) {
      atual = { inicio: t, fim: t, deDia, melhor: { ms: t, altura: p.altura, azimute: p.azimute } };
      trechos.push(atual);
    } else atual = null;
  }
  const trecho = trechos.find((x) => !x.deDia) || (lua ? trechos[0] : null);
  if (!trecho) return null;
  const il = A.Illumination(corpo, data(trecho.melhor.ms));
  if (!lua && (il.mag > VIS.magMaxPlaneta || A.AngleFromSun(corpo, data(trecho.melhor.ms)) < VIS.afastamentoSolMin)) return null;
  const pIni = posicaoNoCeu(corpo, obs, trecho.inicio), pFim = posicaoNoCeu(corpo, obs, trecho.fim);
  return { ...trecho, mag: il.mag, azInicio: pIni.azimute, altInicio: pIni.altura, azFim: pFim.azimute, altFim: pFim.altura };
}

/** Separação angular (graus) entre dois corpos vistos do observador. */
export function separacao(a, b, obs, t) {
  const d = data(t);
  const va = A.Equator(a, d, obs, true, true).vec, vb = A.Equator(b, d, obs, true, true).vec;
  return A.AngleBetween(va, vb);
}

// ------------------------------------------------------------------ satélites

/** Converte OMM do CelesTrak em registro SGP4; null se os elementos forem inválidos. */
export function registroSatelite(omm) {
  try { const rec = sat.json2satrec(omm); return rec && !rec.error ? rec : null; } catch { return null; }
}

/** Idade dos elementos orbitais em dias no instante t (a época do OMM é UTC). */
export function idadeElementosDias(omm, t) {
  const e = Date.parse(String(omm?.EPOCH || '') + (String(omm?.EPOCH || '').endsWith('Z') ? '' : 'Z'));
  return Number.isFinite(e) ? (t - e) / 86400000 : null;
}

/**
 * Estado de um satélite no instante t visto do observador: posição geográfica, altura, velocidade, distância,
 * azimute e elevação, e se está iluminado pelo Sol (fora da sombra cilíndrica da Terra).
 * @returns {object|null} null se a propagação falhar (satélite reentrado ou elementos ruins)
 */
export function estadoSatelite(rec, obsGraus, t) {
  const d = data(t);
  let pv;
  try { pv = sat.propagate(rec, d); } catch { return null; }
  if (!pv || !pv.position || typeof pv.position !== 'object' || !Number.isFinite(pv.position.x)) return null;
  const gmst = sat.gstime(d);
  const geo = sat.eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(geo.height) || geo.height < 80) return null;
  const obsGd = { latitude: obsGraus.lat * RAD, longitude: obsGraus.lon * RAD, height: (obsGraus.altitudeM || 0) / 1000 };
  const look = sat.ecfToLookAngles(obsGd, sat.eciToEcf(pv.position, gmst));
  return {
    lat: geo.latitude / RAD, lon: geo.longitude / RAD, alturaKm: geo.height,
    velKmh: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) * 3600,
    elevacao: look.elevation / RAD, azimute: ((look.azimuth / RAD) % 360 + 360) % 360, distanciaKm: look.rangeSat,
    iluminado: iluminado(pv.position, d), eci: pv.position,
  };
}

/** Sombra cilíndrica da Terra: o satélite está no escuro se estiver atrás da Terra e a menos de 1 raio do eixo Sol-Terra. */
function iluminado(r, d) {
  const s = A.GeoVector('Sun', d, true), n = Math.hypot(s.x, s.y, s.z);
  const ux = s.x / n, uy = s.y / n, uz = s.z / n;
  const proj = r.x * ux + r.y * uy + r.z * uz;
  if (proj >= 0) return true;
  const perp = Math.hypot(r.x - proj * ux, r.y - proj * uy, r.z - proj * uz);
  return perp > 6378.137;
}

/** Tipo de órbita pela altura e pelo período. */
export function tipoOrbita(rec) {
  const periodoMin = 2 * Math.PI / rec.no;
  if (Math.abs(periodoMin - 1436) < 20 && rec.ecco < 0.02) return 'geoestacionaria';
  if (periodoMin > 600) return 'media';
  if (periodoMin > 225) return 'alta';
  return 'baixa';
}

/**
 * Passagens de um satélite sobre o observador entre deMs e ateMs. Varre a cada VIS.passoSatS segundos e refina
 * subida e descida por bisseção (1 s). Cada passagem traz o trecho visível a olho nu (satélite iluminado, céu
 * escuro e pelo menos 10° de altura), quando houver.
 * @param {object} rec registro SGP4
 * @param {{lat:number, lon:number, altitudeM?:number}} obsGraus observador em graus
 * @returns {object[]} passagens em ordem
 */
export function passagens(rec, obsGraus, deMs, ateMs, { maximo = 12 } = {}) {
  const obs = observador(obsGraus.lat, obsGraus.lon, obsGraus.altitudeM || 0);
  const passo = VIS.passoSatS * 1000;
  const elev = (t) => estadoSatelite(rec, obsGraus, t)?.elevacao ?? -90;
  const cruzamento = (a, b, subindo) => { // bisseção do instante em que a elevação cruza 0°
    for (let k = 0; k < 14 && b - a > 1000; k++) { const m = (a + b) / 2; if ((elev(m) >= 0) === subindo) b = m; else a = m; }
    return Math.round(b);
  };
  const lista = [];
  let anterior = elev(deMs), tAnt = deMs, atual = null;
  if (anterior >= 0) atual = { inicio: deMs, emAndamento: true, pontos: [] };
  for (let t = deMs + passo; t <= ateMs + passo && lista.length < maximo; t += passo) {
    const e = elev(t);
    if (anterior < 0 && e >= 0) atual = { inicio: cruzamento(tAnt, t, true), pontos: [] };
    if (atual) atual.pontos.push(t);
    if (anterior >= 0 && e < 0 && atual) {
      atual.fim = cruzamento(tAnt, t, false);
      lista.push(fecharPassagem(rec, obsGraus, obs, atual));
      atual = null;
    }
    anterior = e; tAnt = t;
  }
  return lista;
}

function fecharPassagem(rec, obsGraus, obs, p) {
  const amostras = [p.inicio, ...p.pontos.filter((t) => t > p.inicio && t < p.fim), p.fim].map((t) => ({ t, s: estadoSatelite(rec, obsGraus, t) })).filter((a) => a.s);
  let max = amostras[0];
  for (const a of amostras) if (a.s.elevacao > max.s.elevacao) max = a;
  // refina o ponto mais alto com passos de 2 s em volta da amostra
  for (let t = max.t - VIS.passoSatS * 1000; t <= max.t + VIS.passoSatS * 1000; t += 2000) {
    const s = estadoSatelite(rec, obsGraus, t); if (s && s.elevacao > max.s.elevacao) max = { t, s };
  }
  const vis = amostras.filter((a) => a.s.elevacao >= VIS.alturaMin && a.s.iluminado && alturaSol(obs, a.t) <= VIS.solEscuro);
  const ini = amostras[0].s, fim = amostras[amostras.length - 1].s;
  const out = {
    inicio: p.inicio, fim: p.fim, emAndamento: !!p.emAndamento, duracaoMin: (p.fim - p.inicio) / 60000,
    max: { ms: max.t, elevacao: max.s.elevacao, azimute: max.s.azimute, distanciaKm: max.s.distanciaKm },
    azInicio: ini.azimute, azFim: fim.azimute, visivel: null,
  };
  if (vis.length) {
    let vmax = vis[0]; for (const a of vis) if (a.s.elevacao > vmax.s.elevacao) vmax = a;
    const a = vis[0], b = vis[vis.length - 1];
    out.visivel = {
      inicio: a.t, fim: b.t, duracaoMin: Math.max(0.5, (b.t - a.t) / 60000),
      azInicio: a.s.azimute, altInicio: a.s.elevacao, azFim: b.s.azimute, altFim: b.s.elevacao,
      max: { ms: vmax.t, elevacao: vmax.s.elevacao, azimute: vmax.s.azimute, distanciaKm: vmax.s.distanciaKm },
      // entra ou sai da sombra no meio do caminho (o satélite "acende" ou "apaga" no céu)
      apaga: b.t < p.fim - VIS.passoSatS * 1000 && !estadoSatelite(rec, obsGraus, b.t + VIS.passoSatS * 1000)?.iluminado,
    };
  }
  return out;
}

/** Próxima passagem visível a olho nu nos próximos `dias` dias (ou null). */
export function proximaPassagemVisivel(rec, obsGraus, deMs, dias = 5) {
  const fim = deMs + dias * 86400000;
  for (let t = deMs; t < fim; t += 86400000) {
    const p = passagens(rec, obsGraus, t, Math.min(fim, t + 86400000), { maximo: 20 }).find((x) => x.visivel);
    if (p) return p;
  }
  return null;
}

// ------------------------------------------------------------------ chuvas de meteoros e eventos

/** Instante em que o Sol chega a uma longitude eclíptica, a partir de t (até 370 dias depois). */
function quandoLongitudeSolar(lon, t) { return ms(A.SearchSunLongitude(lon, data(t), 370)); }

/** Longitude eclíptica geocêntrica do Sol (J2000), em graus. */
export const longitudeSolar = (t) => A.SunPosition(data(t)).elon;

/**
 * Chuvas de meteoros ativas na janela, com o melhor horário (radiante mais alto no escuro) e a taxa esperada
 * por hora num céu escuro: ZHR × seno da altura do radiante (fórmula padrão da IMO, sem correção de magnitude
 * limite). A Lua acima do horizonte apaga os meteoros fracos e fica indicada.
 */
export function chuvasNaJanela(obs, janela) {
  const lonSol = longitudeSolar(janela.inicio);
  const dentro = (c) => (c.de <= c.ate ? lonSol >= c.de && lonSol <= c.ate : lonSol >= c.de || lonSol <= c.ate);
  const out = [];
  for (const c of CHUVAS) {
    if (!dentro(c)) continue;
    const picoMs = quandoLongitudeSolar(c.pico, janela.inicio - 20 * 86400000);
    const diasDoPico = picoMs === null ? null : (janela.inicio - picoMs) / 86400000;
    let melhor = null;
    for (let t = janela.inicio; t <= janela.fim; t += VIS.passoMin * 60000 * 2) {
      if (alturaSol(obs, t) > -12) continue; // meteoros pedem céu escuro de verdade (crepúsculo náutico)
      const h = A.Horizon(data(t), obs, c.ra / 15, c.dec, 'normal');
      if (h.altitude >= VIS.alturaMin && (!melhor || h.altitude > melhor.altura)) melhor = { ms: t, altura: h.altitude, azimute: h.azimuth };
    }
    if (!melhor) continue;
    // perfil exponencial em volta do pico (Jenniskens, 1994): a taxa cai a 1/10 a cada `largura` dias
    const fator = diasDoPico === null ? 0.1 : Math.pow(10, -Math.abs(diasDoPico) / c.largura);
    const taxa = Math.round(c.zhr * Math.sin(melhor.altura * RAD) * fator);
    const lua = posicaoNoCeu('Moon', obs, melhor.ms), fase = faseLua(melhor.ms);
    out.push({ ...c, picoMs, diasDoPico, melhor, taxa, luaAtrapalha: lua.altura > 0 && fase.fracao > 0.4 });
  }
  return out.filter((c) => c.taxa >= 3).sort((a, b) => b.taxa - a.taxa);
}

/**
 * Próximos eventos astronômicos visíveis daqui: eclipses (lunares com a Lua acima do horizonte; solares pelo
 * cálculo local), fases principais da Lua, equinócios e solstícios e picos de chuvas de meteoros.
 * @param {number} dias horizonte da busca para fases e picos (eclipses buscam até 3 anos)
 */
export function proximosEventos(obs, t, dias = 60) {
  const ev = [];
  const fimMs = t + dias * 86400000;
  // eclipse lunar: visível se a Lua estiver acima do horizonte no ponto máximo
  let le = A.SearchLunarEclipse(data(t));
  for (let k = 0; k < 6 && le && ms(le.peak) < t + 3 * 365 * 86400000; k++, le = A.NextLunarEclipse(le.peak)) {
    const pico = ms(le.peak);
    const alt = posicaoNoCeu('Moon', obs, pico).altura;
    if (alt > 0) {
      const nome = { penumbral: 'Eclipse lunar penumbral (sutil, a Lua escurece pouco)', partial: 'Eclipse lunar parcial', total: 'Eclipse lunar total (Lua avermelhada)' }[le.kind];
      ev.push({ tipo: 'eclipse', ms: pico, titulo: nome, detalhe: `Máximo com a Lua a ${Math.round(alt)}° de altura, para o ${rumo(posicaoNoCeu('Moon', obs, pico).azimute)}. Dura cerca de ${Math.round(le.sd_penum * 2 / 60)} h (fase penumbral).`, kind: le.kind });
      break;
    }
  }
  // eclipse solar visível no local (o Astronomy Engine já calcula as circunstâncias locais)
  try {
    const se = A.SearchLocalSolarEclipse(data(t), obs);
    if (se && ms(se.peak.time) < t + 3 * 365 * 86400000) {
      const nome = { partial: 'Eclipse solar parcial', annular: 'Eclipse solar anular', total: 'Eclipse solar total' }[se.kind];
      ev.push({ tipo: 'eclipse', ms: ms(se.peak.time), titulo: `${nome} visível daqui`, detalhe: `${Math.round(se.obscuration * 100)}% do Sol coberto no máximo, com o Sol a ${Math.round(se.peak.altitude)}° de altura. Nunca olhe para o Sol sem filtro próprio.`, kind: se.kind });
    }
  } catch { /* sem eclipse solar visível no intervalo */ }
  for (const f of proximasFases(t)) if (f.ms <= fimMs) ev.push({ tipo: 'lua', ms: f.ms, titulo: f.nome });
  const ano = new Date(t).getUTCFullYear();
  for (const y of [ano, ano + 1]) {
    const s = A.Seasons(y);
    // hemisfério sul: as estações são invertidas em relação ao nome astronômico do evento
    const sul = obs.latitude < 0;
    for (const [k, nomeN, nomeS] of [['mar_equinox', 'Equinócio de primavera', 'Equinócio de outono'], ['jun_solstice', 'Solstício de verão', 'Solstício de inverno'], ['sep_equinox', 'Equinócio de outono', 'Equinócio de primavera'], ['dec_solstice', 'Solstício de inverno', 'Solstício de verão']]) {
      const m = ms(s[k]); if (m >= t && m <= fimMs) ev.push({ tipo: 'estacao', ms: m, titulo: `${sul ? nomeS : nomeN}` });
    }
  }
  for (const c of CHUVAS) {
    const pico = quandoLongitudeSolar(c.pico, t);
    if (pico !== null && pico <= fimMs) {
      const altMax = 90 - Math.abs(obs.latitude - c.dec);
      ev.push({ tipo: 'meteoros', ms: pico, titulo: `Pico das ${c.nome}`, detalhe: altMax < VIS.alturaMin ? 'O radiante fica baixo demais daqui: poucos meteoros visíveis.' : `Até ${c.zhr} meteoros por hora em céu muito escuro, com o radiante a pino; daqui o radiante sobe até ${Math.round(altMax)}°.`, fraca: altMax < VIS.alturaMin });
    }
  }
  return ev.sort((a, b) => a.ms - b.ms);
}

// ------------------------------------------------------------------ resumo "Céu de hoje"

/** Horário local "19:42" a partir de ms e do deslocamento do fuso em segundos. */
export function horaLocal(t, offsetS) {
  const d = new Date(t + offsetS * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Frase sobre as nuvens previstas para um instante (mesmos limites de REGRAS.ceu do painel: 45% e 75%). */
export function fraseNuvens(cobertura) {
  if (typeof cobertura !== 'number' || !Number.isFinite(cobertura)) return { nivel: null, texto: '' };
  if (cobertura <= 45) return { nivel: 'aberto', texto: 'Céu deve estar aberto.' };
  if (cobertura <= 75) return { nivel: 'parcial', texto: `Nuvens podem atrapalhar (${Math.round(cobertura)}% do céu coberto).` };
  return { nivel: 'nublado', texto: `Previsão de céu nublado (${Math.round(cobertura)}%): difícil ver.` };
}

const NOMES_ESTACOES = { iss: 'Estação Espacial Internacional (ISS)', css: 'Estação espacial chinesa Tiangong' };

/**
 * Tudo o que dá para ver a olho nu de agora até o céu clarear: passagens visíveis das estações espaciais, planetas,
 * Lua, chuvas de meteoros, eclipses e encontros da Lua com planetas. Cada item tem um título curto e uma frase simples
 * (horário local, direção e altura), já com a nuvem prevista para o horário.
 * @param {{lat:number, lon:number, altitudeM?:number}} local observador em graus
 * @param {number} agoraMs instante de referência
 * @param {{offsetS:number, estacoes?:{id:string, rec:object}[], nuvemEm?:(ms:number)=>number|null}} opcoes
 * @returns {{janela:object, itens:object[], sol:object}}
 */
export function resumoDoCeu(local, agoraMs, { offsetS, estacoes = [], nuvemEm = () => null }) {
  const obs = observador(local.lat, local.lon, local.altitudeM || 0);
  const janela = janelaDaNoite(obs, agoraMs);
  const h = (t) => horaLocal(t, offsetS);
  const itens = [];
  const nuvem = (t) => fraseNuvens(nuvemEm(t));

  for (const e of estacoes) {
    const ps = passagens(e.rec, local, agoraMs, janela.nasceSol ?? janela.fim).filter((p) => p.visivel);
    const p = ps.sort((a, b) => b.visivel.max.elevacao - a.visivel.max.elevacao)[0]; // a melhor da noite
    if (!p) continue;
    const v = p.visivel, n = nuvem(v.max.ms);
    itens.push({
      tipo: 'satelite', id: e.id, titulo: NOMES_ESTACOES[e.id] || e.id, ms: v.inicio, destaque: v.max.elevacao >= 30, nuvem: n.nivel,
      quando: h(v.inicio),
      frase: `Passa às ${h(v.inicio)}, do ${rumo(v.azInicio)} para o ${rumo(v.azFim)}, ${alturaTexto(v.max.elevacao)} (${Math.round(v.max.elevacao)}°), por ${Math.max(1, Math.round(v.duracaoMin))} min.`
        + ` Parece uma estrela andando, sem piscar.${v.apaga ? ' Some no meio do céu ao entrar na sombra da Terra.' : ''} ${n.texto}`.trimEnd(),
      outras: ps.length - 1, passagem: p,
    });
  }

  for (const corpo of ['Moon', ...PLANETAS_OLHO_NU]) {
    const v = janelaVisivel(corpo, obs, janela);
    if (!v) continue;
    const nome = CORPOS[corpo].nome, n = nuvem(v.melhor.ms);
    let frase;
    if (corpo === 'Moon') {
      const f = faseLua(v.melhor.ms);
      const ate = janela.nasceSol ?? janela.fim;
      const nasce = ms(A.SearchRiseSet('Moon', obs, +1, data(agoraMs), 1.2)), poe = ms(A.SearchRiseSet('Moon', obs, -1, data(v.inicio), 1.2));
      const partes = [];
      if (posicaoNoCeu('Moon', obs, agoraMs).altura >= VIS.alturaMinLua && alturaSol(obs, agoraMs) > 0 && f.fracao >= 0.25) partes.push(`já aparece agora, de dia, para o ${rumo(posicaoNoCeu('Moon', obs, agoraMs).azimute)}`);
      if (nasce && nasce > agoraMs && nasce < ate) partes.push(`nasce às ${h(nasce)} a ${rumo(posicaoNoCeu('Moon', obs, nasce).azimute)}`);
      else if (!partes.length || v.inicio > agoraMs) partes.push(`no céu ${v.inicio <= agoraMs + VIS.passoMin * 60000 ? 'agora' : 'ao escurecer'}, para o ${rumo(v.azInicio)} (${Math.round(v.altInicio)}°)`);
      if (poe && poe > v.inicio && poe < ate) partes.push(`se põe às ${h(poe)} a ${rumo(posicaoNoCeu('Moon', obs, poe).azimute)}`);
      frase = `${partes.join('; ').replace(/^./, (c) => c.toUpperCase())}. ${n.texto}`;
      const quando = nasce && nasce > agoraMs && nasce < ate && nasce < v.inicio ? nasce : v.inicio;
      itens.push({ tipo: 'lua', corpo, titulo: `Lua ${f.nome} (${Math.round(f.fracao * 100)}% iluminada)`, ms: quando, quando: h(quando), frase: frase.trimEnd(), nuvem: n.nivel, janela: v, destaque: f.fracao > 0.9 });
      continue;
    }
    const margem = 20 * 60000;
    const meio = v.melhor.ms - v.inicio > margem && v.fim - v.melhor.ms > margem;
    const subindo = v.fim - v.melhor.ms <= margem && v.melhor.ms - v.inicio > margem;
    frase = `Das ${h(v.inicio)} às ${h(v.fim)}, para o ${rumo(v.melhor.azimute)}; ${meio ? `mais alto às ${h(v.melhor.ms)} (${Math.round(v.melhor.altura)}°)` : subindo ? `sobe até ${Math.round(v.melhor.altura)}° antes de o céu clarear` : `${alturaTexto(v.melhor.altura)} (${Math.round(v.melhor.altura)}°)`}.`
      + ` ${brilhoTexto(v.mag).replace(/^./, (c) => c.toUpperCase())}. ${n.texto}`;
    itens.push({ tipo: 'planeta', corpo, titulo: nome, ms: v.inicio, quando: h(v.inicio), frase: frase.trimEnd(), nuvem: n.nivel, janela: v, destaque: v.mag <= -1 });
  }

  // Lua perto de um planeta (menos de 5°) no melhor horário do planeta: chama a atenção no céu
  const lua = itens.find((i) => i.tipo === 'lua');
  if (lua) for (const p of itens.filter((i) => i.tipo === 'planeta')) {
    const t = p.janela.melhor.ms;
    if (posicaoNoCeu('Moon', obs, t).altura < VIS.alturaMinLua) continue;
    const sep = separacao('Moon', p.corpo, obs, t);
    if (sep < 5) itens.push({ tipo: 'encontro', titulo: `Lua e ${p.titulo} juntos`, ms: t, quando: h(t), destaque: true, nuvem: p.nuvem,
      frase: `Às ${h(t)}, a Lua passa a ${sep < 1 ? 'menos de 1°' : `${Math.round(sep)}°`} de ${p.titulo}, para o ${rumo(p.janela.melhor.azimute)}. Fácil de achar: ${p.titulo} é o ponto brilhante ao lado da Lua.` });
  }

  for (const c of chuvasNaJanela(obs, janela)) {
    const n = nuvem(c.melhor.ms);
    const pico = c.diasDoPico !== null && Math.abs(c.diasDoPico) < 1 ? 'no pico' : c.diasDoPico < 0 ? `a ${Math.round(-c.diasDoPico)} dia${Math.round(-c.diasDoPico) > 1 ? 's' : ''} do pico` : `${Math.round(c.diasDoPico)} dia${Math.round(c.diasDoPico) > 1 ? 's' : ''} depois do pico`;
    itens.push({ tipo: 'meteoros', titulo: `Chuva de meteoros ${c.nome}`, ms: c.melhor.ms, quando: h(c.melhor.ms), destaque: c.taxa >= 20, nuvem: n.nivel, chuva: c,
      frase: `Melhor por volta das ${h(c.melhor.ms)}: até ${c.taxa} meteoros por hora longe das luzes da cidade (${pico}). Olhe para o céu todo, não só para o ${rumo(c.melhor.azimute)}.${c.luaAtrapalha ? ' A Lua clara apaga os mais fracos.' : ''} ${n.texto}`.trimEnd() });
  }

  // eclipse dentro da janela
  for (const e of proximosEventos(obs, agoraMs, 2)) {
    if (e.tipo !== 'eclipse' || e.ms > (janela.nasceSol ?? janela.fim) + 12 * 3600000) continue;
    itens.push({ tipo: 'eclipse', titulo: e.titulo, ms: e.ms, quando: h(e.ms), destaque: true, frase: `Máximo às ${h(e.ms)}. ${e.detalhe} ${nuvem(e.ms).texto}`.trimEnd(), nuvem: nuvem(e.ms).nivel });
  }

  itens.sort((a, b) => a.ms - b.ms);
  return { janela, itens, sol: solDoDia(obs, agoraMs - ((agoraMs + offsetS * 1000) % 86400000)) };
}
