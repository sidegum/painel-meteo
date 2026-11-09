// Geometria astronômica da cena do Globo. As posições vêm todas do Astronomy Engine (via ceu.js), a mesma fonte
// dos cartões e do bloco "Céu de hoje": o Sol que ilumina o globo, a Lua desenhada e os textos nunca discordam.
// Os elementos keplerianos do JPL ficam só para desenhar as órbitas no sistema solar (a curva inteira de cada
// planeta), onde um erro de menos de 1° não se vê.
import * as A from '../vendor/astronomy/astronomy.min.js';
import { pontoSob } from './ceu.js';

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const CORPO = { 'Mercúrio': 'Mercury', 'Vênus': 'Venus', Terra: 'Earth', Marte: 'Mars', 'Júpiter': 'Jupiter', Saturno: 'Saturn', Urano: 'Uranus', Netuno: 'Neptune' };

/** Ponto onde o Sol está a pino no instante (latitude e longitude em graus). */
export const pontoSubsolar = (ms) => pontoSob('Sun', ms);
/** Ponto sob a Lua (centro da Terra para o centro da Lua), com a distância em km. */
export const pontoSublunar = (ms) => pontoSob('Moon', ms);

// ---------- planetas: posição real e órbita desenhada ----------
// Colunas de el/taxa: a (UA), e, i (°), L (°), varpi (longitude do periélio, °), Omega (nó ascendente, °), por século.
export const PLANETAS = [
  { nome: 'Mercúrio', corpo: 'Mercury', cor: '#b5b1a9', raio: 0.383, el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], taxa: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { nome: 'Vênus', corpo: 'Venus', cor: '#e6d3a3', raio: 0.949, el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], taxa: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  { nome: 'Terra', corpo: 'Earth', cor: '#4d8ed6', raio: 1, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], taxa: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  { nome: 'Marte', corpo: 'Mars', cor: '#d07a52', raio: 0.532, el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], taxa: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { nome: 'Júpiter', corpo: 'Jupiter', cor: '#d9b48a', raio: 11.21, el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], taxa: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { nome: 'Saturno', corpo: 'Saturn', cor: '#e3cf9a', raio: 9.45, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], taxa: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { nome: 'Urano', corpo: 'Uranus', cor: '#9fd6e0', raio: 4.01, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], taxa: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { nome: 'Netuno', corpo: 'Neptune', cor: '#5d7fe0', raio: 3.88, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], taxa: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
];

const ROT_ECL = A.Rotation_EQJ_ECL();

/**
 * Posição heliocêntrica real do planeta em coordenadas eclípticas J2000 (UA), pelo Astronomy Engine.
 * @returns {{x:number, y:number, z:number, r:number}}
 */
export function posicaoPlaneta(planeta, ms) {
  const v = A.RotateVector(ROT_ECL, A.HelioVector(CORPO[planeta.nome] || planeta.corpo, new Date(ms)));
  return { x: v.x, y: v.y, z: v.z, r: Math.hypot(v.x, v.y, v.z) };
}

/** Lua vista do centro da Terra em coordenadas eclípticas J2000: longitude e latitude (graus) e distância (km). */
export function posicaoLua(ms) {
  const v = A.RotateVector(ROT_ECL, A.GeoMoon(new Date(ms)));
  const r = Math.hypot(v.x, v.y, v.z);
  return { lon: Math.atan2(v.y, v.x) / RAD, lat: Math.asin(v.z / r) / RAD, distanciaKm: r * 149597870.7 };
}

/**
 * Ponto da órbita do planeta para uma anomalia média dada (graus), pelos elementos keplerianos: só para desenhar a
 * curva da órbita no sistema solar.
 */
export function pontoOrbita(planeta, ms, anomaliaMedia) {
  const T = (ms / 86400000 + 2440587.5 - J2000) / 36525;
  const [a, e, i, , varpi, Omega] = planeta.el.map((v, k) => v + planeta.taxa[k] * T);
  const omega = varpi - Omega;
  const M = anomaliaMedia * RAD;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) { const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E)); E += dE; if (Math.abs(dE) < 1e-8) break; }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega * RAD), sw = Math.sin(omega * RAD), cO = Math.cos(Omega * RAD), sO = Math.sin(Omega * RAD), ci = Math.cos(i * RAD), si = Math.sin(i * RAD);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  return { x, y, z, r: Math.hypot(x, y, z) };
}
