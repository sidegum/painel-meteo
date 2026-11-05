// Astronomia da aba Globo: posição do Sol (terminador dia/noite), posições dos planetas e órbitas de satélites.
// Fórmulas de baixa precisão (erro menor que 0,02° para o Sol e que 1° para os planetas), suficientes para a cena.
// Referências: Astronomical Almanac (Sol), elementos keplerianos aproximados do JPL (planetas, válidos 1800-2050).

const RAD = Math.PI / 180;
const J2000 = 2451545.0;

/** Dia juliano de um instante (ms desde 1970). */
export function diaJuliano(ms) { return ms / 86400000 + 2440587.5; }

/**
 * Ponto subsolar: latitude e longitude onde o Sol está a pino no instante dado.
 * Algoritmo do Astronomical Almanac (precisão de cerca de 0,01°).
 * @returns {{lat:number, lon:number, declinacao:number, ascensaoReta:number}} graus
 */
export function pontoSubsolar(ms) {
  const n = diaJuliano(ms) - J2000;
  const L = norm360(280.460 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const declinacao = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ascensaoReta = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  // Tempo sideral de Greenwich (graus): ângulo horário de Greenwich = GMST - ascensão reta
  const gmst = norm360((18.697374558 + 24.06570982441908 * n) * 15);
  const lon = norm180(ascensaoReta / RAD - gmst);
  return { lat: declinacao / RAD, lon, declinacao: declinacao / RAD, ascensaoReta: ascensaoReta / RAD };
}

/** Longitude do ponto sublunar e latitude, pela série curta de Meeus (erro de cerca de 0,3°). */
export function pontoSublunar(ms) {
  const n = diaJuliano(ms) - J2000;
  const T = n / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T);         // longitude média
  const D = norm360(297.8501921 + 445267.1114034 * T) * RAD;     // elongação média
  const M = norm360(357.5291092 + 35999.0502909 * T) * RAD;      // anomalia média do Sol
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * RAD;    // anomalia média da Lua
  const F = norm360(93.2720950 + 483202.0175233 * T) * RAD;      // argumento da latitude
  const lon = Lp + 6.289 * Math.sin(Mp) - 1.274 * Math.sin(2 * D - Mp) + 0.658 * Math.sin(2 * D) - 0.214 * Math.sin(2 * Mp) - 0.186 * Math.sin(M) - 0.114 * Math.sin(2 * F);
  const lat = 5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) - 0.278 * Math.sin(F - Mp) - 0.173 * Math.sin(2 * D - F);
  const dist = 385001 - 20905 * Math.cos(Mp) - 3699 * Math.cos(2 * D - Mp) - 2956 * Math.cos(2 * D);
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const l = lon * RAD, b = lat * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  const gmst = norm360((18.697374558 + 24.06570982441908 * n) * 15);
  return { lat: dec / RAD, lon: norm180(ra / RAD - gmst), distanciaKm: dist };
}

// ---------- planetas (elementos keplerianos aproximados do JPL, época J2000, taxas por século) ----------
// Colunas: a (UA), e, i (°), L (°), varpi (longitude do periélio, °), Omega (nó ascendente, °) e as taxas.
export const PLANETAS = [
  { nome: 'Mercúrio', cor: '#b5b1a9', raio: 0.383, el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], taxa: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { nome: 'Vênus', cor: '#e6d3a3', raio: 0.949, el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], taxa: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  { nome: 'Terra', cor: '#4d8ed6', raio: 1, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], taxa: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  { nome: 'Marte', cor: '#d07a52', raio: 0.532, el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], taxa: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { nome: 'Júpiter', cor: '#d9b48a', raio: 11.21, el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], taxa: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { nome: 'Saturno', cor: '#e3cf9a', raio: 9.45, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], taxa: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { nome: 'Urano', cor: '#9fd6e0', raio: 4.01, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], taxa: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { nome: 'Netuno', cor: '#5d7fe0', raio: 3.88, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], taxa: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
];

/**
 * Posição heliocêntrica de um planeta em coordenadas eclípticas J2000 (UA), pelos elementos keplerianos aproximados.
 * @returns {{x:number, y:number, z:number, r:number}}
 */
export function posicaoPlaneta(planeta, ms) {
  const T = (diaJuliano(ms) - J2000) / 36525;
  const [a, e, i, L, varpi, Omega] = planeta.el.map((v, k) => v + planeta.taxa[k] * T);
  const omega = varpi - Omega;                 // argumento do periélio
  const M = norm180(L - varpi) * RAD;          // anomalia média
  let E = M + e * Math.sin(M);                  // equação de Kepler (Newton)
  for (let k = 0; k < 8; k++) { const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E)); E += dE; if (Math.abs(dE) < 1e-8) break; }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega * RAD), sw = Math.sin(omega * RAD), cO = Math.cos(Omega * RAD), sO = Math.sin(Omega * RAD), ci = Math.cos(i * RAD), si = Math.sin(i * RAD);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  return { x, y, z, r: Math.hypot(x, y, z) };
}

// ---------- utilidades ----------

export function norm360(g) { return ((g % 360) + 360) % 360; }
export function norm180(g) { const v = norm360(g); return v > 180 ? v - 360 : v; }

/** Tempo sideral de Greenwich em graus (para orientar a Terra em relação ao céu). */
export function tempoSideralGreenwich(ms) {
  const n = diaJuliano(ms) - J2000;
  return norm360((18.697374558 + 24.06570982441908 * n) * 15);
}
