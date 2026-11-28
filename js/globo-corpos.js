// Corpos do sistema solar além dos planetas: luas, planetas anões, asteroides, cometas e as populações reais dos
// cinturões, mais os polos dos planetas. Só cálculo e fichas (sem cena): globo-espaco.js monta a parte 3D.
//
// Fontes:
// - Lua e luas de Júpiter (Io, Europa, Ganimedes, Calisto): Astronomy Engine (ELP/MPP02 truncado e teoria L1.2).
// - Demais luas: elementos osculantes do JPL Horizons no dia (corpos.json), propagados como órbita kepleriana em volta do
//   planeta. Bom para dias e semanas; a precessão das órbitas não entra.
// - Corpos menores e populações: elementos do JPL Small-Body Database (SBDB), propagados como órbita kepleriana em volta
//   do Sol (sem perturbações dos planetas: erro pequeno em anos, maior em décadas).
// - Polos: IAU WGCCRE 2015 (ascensão reta e declinação do polo norte, J2000).
// - Raios médios e descobertas: NASA/JPL Planetary Satellite Physical Parameters e Solar System Dynamics.
import * as A from '../vendor/astronomy/astronomy.min.js';

const RAD = Math.PI / 180;
export const UA_KM = 149597870.7;
const K_GAUSS = 0.01720209895; // constante gravitacional de Gauss (rad/dia, órbitas em volta do Sol em UA)
const ROT_ECL = A.Rotation_EQJ_ECL();
const OBLIQ = 23.4392911 * RAD;

/**
 * Raio médio (km), polo norte e rotação (IAU WGCCRE 2015) do Sol, dos planetas e de Plutão.
 * polo: ascensão reta e declinação do polo norte (graus, ICRF/J2000). rot: W = W0 + Ẇ·d, ângulo (graus) do meridiano
 * principal contado a partir do nó do equador do corpo no equador da ICRF; d em dias desde J2000.
 */
export const PLANETA_FISICO = {
  Sun: { raioKm: 695700, polo: [286.13, 63.87], rot: [84.176, 14.1844] },
  Mercury: { raioKm: 2439.7, polo: [281.0103, 61.4155], rot: [329.5988, 6.1385108] },
  Venus: { raioKm: 6051.8, polo: [272.76, 67.16], rot: [160.20, -1.4813688] },
  Earth: { raioKm: 6371.0, polo: [0, 90], rot: [190.147, 360.9856235] },
  Mars: { raioKm: 3389.5, polo: [317.269, 54.432], rot: [176.049863, 350.891982443297] },
  Jupiter: { raioKm: 69911, polo: [268.056595, 64.495303], rot: [284.95, 870.536] },
  Saturn: { raioKm: 58232, polo: [40.589, 83.537], rot: [38.90, 810.7939024] },
  Uranus: { raioKm: 25362, polo: [257.311, -15.175], rot: [203.81, -501.1600928] },
  Neptune: { raioKm: 24622, polo: [299.36, 43.46], rot: [249.978, 541.1397757] },
  Pluto: { raioKm: 1188.3, polo: [132.993, -6.163], rot: [302.695, 56.3625225] },
};

/** Luas: pai (corpo do Astronomy Engine), raio médio (km), descoberta e uma frase. */
export const LUAS = {
  lua: { nome: 'Lua', pai: 'Earth', raioKm: 1737.4, descoberta: null, frase: 'O único satélite natural da Terra; sempre mostra a mesma face para nós.' },
  fobos: { nome: 'Fobos', pai: 'Mars', raioKm: 11.1, descoberta: '1877, Asaph Hall', frase: 'A maior lua de Marte; dá três voltas no planeta por dia marciano e se aproxima dele aos poucos.' },
  deimos: { nome: 'Deimos', pai: 'Mars', raioKm: 6.2, descoberta: '1877, Asaph Hall', frase: 'A menor e mais distante lua de Marte.' },
  io: { nome: 'Io', pai: 'Jupiter', raioKm: 1821.6, descoberta: '1610, Galileu Galilei', frase: 'O corpo com mais vulcões ativos do sistema solar.' },
  europa: { nome: 'Europa', pai: 'Jupiter', raioKm: 1560.8, descoberta: '1610, Galileu Galilei', frase: 'Tem um oceano de água salgada sob a crosta de gelo; destino da Europa Clipper.' },
  ganimedes: { nome: 'Ganimedes', pai: 'Jupiter', raioKm: 2631.2, descoberta: '1610, Galileu Galilei', frase: 'A maior lua do sistema solar, maior que Mercúrio; destino principal da JUICE.' },
  calisto: { nome: 'Calisto', pai: 'Jupiter', raioKm: 2410.3, descoberta: '1610, Galileu Galilei', frase: 'Uma das superfícies mais cheias de crateras do sistema solar.' },
  mimas: { nome: 'Mimas', pai: 'Saturn', raioKm: 198.2, descoberta: '1789, William Herschel', frase: 'Tem uma cratera enorme, Herschel, com um terço do diâmetro da lua.' },
  encelado: { nome: 'Encélado', pai: 'Saturn', raioKm: 252.1, descoberta: '1789, William Herschel', frase: 'Solta jatos de água do oceano escondido sob o gelo do polo sul.' },
  tetis: { nome: 'Tétis', pai: 'Saturn', raioKm: 531.1, descoberta: '1684, Giovanni Cassini', frase: 'Lua gelada com um cânion de mais de 2.000 km.' },
  dione: { nome: 'Dione', pai: 'Saturn', raioKm: 561.4, descoberta: '1684, Giovanni Cassini', frase: 'Lua de gelo com penhascos brilhantes.' },
  reia: { nome: 'Reia', pai: 'Saturn', raioKm: 763.8, descoberta: '1672, Giovanni Cassini', frase: 'A segunda maior lua de Saturno.' },
  tita: { nome: 'Titã', pai: 'Saturn', raioKm: 2574.7, descoberta: '1655, Christiaan Huygens', frase: 'Tem atmosfera densa e lagos de metano; a sonda Huygens pousou nela em 2005.' },
  japeto: { nome: 'Jápeto', pai: 'Saturn', raioKm: 734.5, descoberta: '1671, Giovanni Cassini', frase: 'Tem um lado escuro e outro claro.' },
  miranda: { nome: 'Miranda', pai: 'Uranus', raioKm: 235.8, descoberta: '1948, Gerard Kuiper', frase: 'Superfície remendada, com penhascos de até 20 km.' },
  ariel: { nome: 'Ariel', pai: 'Uranus', raioKm: 578.9, descoberta: '1851, William Lassell', frase: 'A lua mais clara de Urano.' },
  umbriel: { nome: 'Umbriel', pai: 'Uranus', raioKm: 584.7, descoberta: '1851, William Lassell', frase: 'A lua mais escura de Urano.' },
  titania: { nome: 'Titânia', pai: 'Uranus', raioKm: 788.9, descoberta: '1787, William Herschel', frase: 'A maior lua de Urano.' },
  oberon: { nome: 'Oberon', pai: 'Uranus', raioKm: 761.4, descoberta: '1787, William Herschel', frase: 'A lua mais distante entre as grandes de Urano.' },
  tritao: { nome: 'Tritão', pai: 'Neptune', raioKm: 1353.4, descoberta: '1846, William Lassell', frase: 'Gira ao contrário da rotação de Netuno e tem gêiseres de nitrogênio.' },
  caronte: { nome: 'Caronte', pai: 'Pluto', raioKm: 606.0, descoberta: '1978, James Christy', frase: 'Tão grande perto de Plutão que os dois giram em volta de um ponto entre eles.' },
};
const GALILEIAS = { io: 'io', europa: 'europa', ganimedes: 'ganymede', calisto: 'callisto' };

/** Planetas anões reconhecidos pela IAU (além de Plutão); os outros grandes transnetunianos são candidatos. */
export const ANOES_IAU = new Set(['ceres', 'eris', 'haumea', 'makemake']);

/** Corpos menores: nome em português e uma frase (o resto vem dos elementos do SBDB). */
export const PEQUENOS = {
  ceres: { nome: 'Ceres', frase: 'O maior objeto do cinturão de asteroides e o único planeta anão dele. A sonda Dawn o estudou de 2015 a 2018.' },
  eris: { nome: 'Éris', frase: 'Planeta anão quase do tamanho de Plutão; sua descoberta em 2005 levou à definição atual de planeta, em 2006.' },
  haumea: { nome: 'Haumea', frase: 'Planeta anão alongado que dá uma volta em si mesmo em cerca de 4 horas; tem um anel.' },
  makemake: { nome: 'Makemake', frase: 'Planeta anão gelado do Cinturão de Kuiper, descoberto em 2005.' },
  gonggong: { nome: 'Gonggong', frase: 'Um dos maiores objetos além de Netuno, com órbita alongada e inclinada.' },
  quaoar: { nome: 'Quaoar', frase: 'Objeto grande do Cinturão de Kuiper com um anel muito afastado do corpo, anunciado em 2023.' },
  orco: { nome: 'Orco', frase: 'Tem órbita parecida com a de Plutão, mas está sempre do lado oposto do Sol.' },
  sedna: { nome: 'Sedna', frase: 'Um dos objetos mais distantes conhecidos: leva mais de 10 mil anos para dar uma volta no Sol.' },
  vesta: { nome: 'Vesta', frase: 'O segundo maior asteroide, estudado pela sonda Dawn em 2011 e 2012. Às vezes fica visível a olho nu.' },
  palas: { nome: 'Palas', frase: 'O terceiro maior asteroide, com órbita bem inclinada.' },
  higia: { nome: 'Hígia', frase: 'O quarto maior asteroide, quase esférico.' },
  psique: { nome: 'Psiquê', frase: 'Asteroide rico em metal, destino da sonda Psyche (chegada prevista para 2029).' },
  eros: { nome: 'Eros', frase: 'O primeiro asteroide orbitado e tocado por uma nave (NEAR Shoemaker, 2001).' },
  bennu: { nome: 'Bennu', frase: 'A OSIRIS-REx trouxe amostras dele para a Terra em 2023.' },
  apofis: { nome: 'Apófis', frase: 'Vai passar a cerca de 32 mil km da superfície da Terra em 13/4/2029, visível a olho nu. Não há risco de impacto.' },
  didymos: { nome: 'Didymos', frase: 'Asteroide duplo: a sonda DART atingiu a lua dele, Dimorphos, em 2022 e mudou sua órbita. A Hera vai examinar o resultado.' },
  ryugu: { nome: 'Ryugu', frase: 'A sonda japonesa Hayabusa2 trouxe amostras dele em 2020.' },
  itokawa: { nome: 'Itokawa', frase: 'O primeiro asteroide de onde se trouxe amostra para a Terra (Hayabusa, 2010).' },
  patroclo: { nome: 'Pátroclo', frase: 'Asteroide troiano duplo, que divide a órbita de Júpiter; último destino da sonda Lucy (2033).' },
  eurybates: { nome: 'Eurybates', frase: 'Asteroide troiano de Júpiter que a sonda Lucy visita em 2027.' },
  arrokoth: { nome: 'Arrokoth', frase: 'O objeto mais distante já visitado por uma nave: a New Horizons passou por ele em 1/1/2019.' },
  halley: { nome: 'Cometa Halley', frase: 'O cometa mais famoso; volta a cada 75 a 76 anos. Seus restos formam as Eta Aquáridas e as Oriônidas.' },
  encke: { nome: 'Cometa Encke', frase: 'Volta a cada 3,3 anos; seus restos formam as Táuridas.' },
  churyumov: { nome: 'Cometa 67P', frase: 'A sonda Rosetta o acompanhou de 2014 a 2016 e pousou nele o módulo Philae.' },
  swifttuttle: { nome: 'Cometa Swift-Tuttle', frase: 'Seus restos formam as Perseidas; volta a cada cerca de 133 anos.' },
  tempeltuttle: { nome: 'Cometa Tempel-Tuttle', frase: 'Seus restos formam as Leônidas; volta a cada cerca de 33 anos.' },
  hartley: { nome: 'Cometa Hartley 2', frase: 'Cometa pequeno e muito ativo, visitado pela sonda EPOXI em 2010.' },
  ponsbrooks: { nome: 'Cometa Pons-Brooks', frase: 'Voltou em 2024 e foi visto com binóculos; volta a cada cerca de 71 anos.' },
};
/** Raio aproximado (km) quando o SBDB não traz o diâmetro (cometas e corpos alongados), só para o tamanho do ponto. */
const RAIO_PADRAO_KM = { haumea: 800, cometa: 5 };

// ------------------------------------------------------------------ órbitas keplerianas

/** Resolve a equação de Kepler (M em rad) para órbita elíptica. */
function anomaliaExcentrica(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
  return E;
}

/**
 * Posição por elementos keplerianos (eclíptica J2000, mesma unidade de a). Aceita os elementos do SBDB e do Horizons:
 * a (ou q), e, i, om, w em graus; ma (graus) na época ou tp (ms, passagem pelo periélio); n em graus/dia (ou calculado).
 * @returns {{x:number,y:number,z:number}|null} null para órbitas abertas (e ≥ 1)
 */
export function posicaoKepler(el, t, alvo = { x: 0, y: 0, z: 0 }) {
  const e = el.e;
  if (!(e < 1)) return null;
  const a = el.a ?? el.q / (1 - e);
  const n = el.n ?? K_GAUSS / Math.pow(a, 1.5) / RAD; // graus por dia
  const M0 = el.ma ?? (el.tp != null ? n * (el.epoca - el.tp) / 86400000 : 0);
  let M = ((M0 + n * (t - el.epoca) / 86400000) % 360) * RAD;
  const E = anomaliaExcentrica(M, e);
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const om = el.om * RAD, w = el.w * RAD, i = el.i * RAD;
  const co = Math.cos(om), so = Math.sin(om), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  alvo.x = xv * (co * cw - so * sw * ci) - yv * (co * sw + so * cw * ci);
  alvo.y = xv * (so * cw + co * sw * ci) - yv * (so * sw - co * cw * ci);
  alvo.z = xv * (sw * si) + yv * (cw * si);
  return alvo;
}

/**
 * Base da órbita no espaço (eclíptica J2000): P aponta para o periélio e Q 90° à frente no sentido do movimento.
 * A posição na anomalia excêntrica E é P·a(cos E − e) + Q·a√(1−e²)·sen E.
 */
export function baseOrbita(el) {
  const om = el.om * RAD, w = el.w * RAD, i = el.i * RAD;
  const co = Math.cos(om), so = Math.sin(om), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  return { P: [co * cw - so * sw * ci, so * cw + co * sw * ci, sw * si], Q: [-co * sw - so * cw * ci, -so * sw + co * cw * ci, cw * si] };
}

/** n pontos de uma volta completa (eclíptica J2000, unidade de a), espaçados na anomalia excêntrica: denso no periélio. */
export function pontosOrbita(el, n = 180) {
  if (!(el.e < 1)) return [];
  const a = el.a ?? el.q / (1 - el.e), b = a * Math.sqrt(1 - el.e * el.e), { P, Q } = baseOrbita(el), saida = [];
  for (let k = 0; k <= n; k++) {
    const E = k / n * 2 * Math.PI, x = a * (Math.cos(E) - el.e), y = b * Math.sin(E);
    saida.push({ x: P[0] * x + Q[0] * y, y: P[1] * x + Q[1] * y, z: P[2] * x + Q[2] * y });
  }
  return saida;
}

/** Período (dias), periélio e afélio (UA) pelos elementos. */
export function dadosOrbita(el) {
  const a = el.a ?? el.q / (1 - el.e);
  const n = el.n ?? K_GAUSS / Math.pow(a, 1.5) / RAD;
  return { a, periodoDias: 360 / n, perielio: a * (1 - el.e), afelio: a * (1 + el.e) };
}

/** Próxima passagem pelo periélio depois de t (ms). */
export function proximoPerielio(el, t) {
  const { periodoDias } = dadosOrbita(el);
  const n = 360 / periodoDias;
  const M0 = el.ma ?? (el.tp != null ? n * (el.epoca - el.tp) / 86400000 : 0);
  const M = ((M0 + n * (t - el.epoca) / 86400000) % 360 + 360) % 360;
  return t + (360 - M) / n * 86400000;
}

// ------------------------------------------------------------------ luas

/**
 * Posição de uma lua em relação ao centro do planeta (km, eclíptica J2000) no instante t.
 * @param {string} chave chave em LUAS
 * @param {object} [el] elementos do Horizons (corpos.json), para as luas fora do Astronomy Engine
 */
export function posicaoLua(chave, t, el) {
  const d = new Date(t);
  if (chave === 'lua') { const v = A.RotateVector(ROT_ECL, A.GeoMoon(d)); return { x: v.x * UA_KM, y: v.y * UA_KM, z: v.z * UA_KM }; }
  if (GALILEIAS[chave]) {
    const s = A.JupiterMoons(d)[GALILEIAS[chave]];
    const v = A.RotateVector(ROT_ECL, new A.Vector(s.x, s.y, s.z, s.t));
    return { x: v.x * UA_KM, y: v.y * UA_KM, z: v.z * UA_KM };
  }
  if (!el) return null;
  const p = posicaoKepler(el, t);
  return p && { x: p.x * UA_KM, y: p.y * UA_KM, z: p.z * UA_KM };
}

/** Luas que dá para mostrar com os dados disponíveis (Lua e galileanas sempre; as outras se vieram no corpos.json). */
export function luasDisponiveis(corpos) {
  return Object.keys(LUAS).filter((k) => k === 'lua' || GALILEIAS[k] || corpos?.luas?.[k]);
}

// ------------------------------------------------------------------ polos

const equatorialParaEcliptica = (x, y, z) => ({ x, y: y * Math.cos(OBLIQ) + z * Math.sin(OBLIQ), z: -y * Math.sin(OBLIQ) + z * Math.cos(OBLIQ) });

/** Direção do polo norte de um corpo na eclíptica J2000 (vetor unitário x, y, z). */
export function poloEcliptica(corpo) {
  const p = PLANETA_FISICO[corpo]?.polo; if (!p) return null;
  const ra = p[0] * RAD, dec = p[1] * RAD;
  return equatorialParaEcliptica(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}

/**
 * Orientação de um corpo no instante t (eclíptica J2000): polo norte e direção do meridiano principal (longitude 0),
 * pelo modelo de rotação da IAU. A longitude λ leste fica em polo × meridiano girado de λ em volta do polo.
 */
export function orientacao(corpo, t) {
  const f = PLANETA_FISICO[corpo]; if (!f?.rot) return null;
  const a = f.polo[0] * RAD, dec = f.polo[1] * RAD;
  const P = [Math.cos(dec) * Math.cos(a), Math.cos(dec) * Math.sin(a), Math.sin(dec)];
  const Q = [-Math.sin(a), Math.cos(a), 0]; // nó ascendente do equador do corpo no equador da ICRF
  const PxQ = [P[1] * Q[2] - P[2] * Q[1], P[2] * Q[0] - P[0] * Q[2], P[0] * Q[1] - P[1] * Q[0]];
  const d = (t - Date.UTC(2000, 0, 1, 12)) / 86400000 + 69.2 / 86400; // TDB ≈ UTC + 69,2 s
  const W = ((f.rot[0] + f.rot[1] * d) % 360) * RAD, c = Math.cos(W), s = Math.sin(W);
  return { polo: equatorialParaEcliptica(...P), meridiano: equatorialParaEcliptica(Q[0] * c + PxQ[0] * s, Q[1] * c + PxQ[1] * s, Q[2] * c + PxQ[2] * s) };
}

/** Raio (km) para dimensionar um corpo menor: o do SBDB, senão um valor padrão do tipo. */
export function raioPequenoKm(chave, dados) {
  return dados?.diametro_km ? dados.diametro_km / 2 : RAIO_PADRAO_KM[chave] ?? (dados?.tipo === 'cometa' ? RAIO_PADRAO_KM.cometa : 50);
}

/** Períodos siderais (dias) das luas calculadas pelo Astronomy Engine (as outras usam o n dos elementos). */
export const PERIODO_LUA_DIAS = { lua: 27.321661, io: 1.769138, europa: 3.551181, ganimedes: 7.154553, calisto: 16.689018 };

/** Períodos siderais dos planetas (dias), para desenhar uma volta completa pela efeméride. */
export const PERIODO_DIAS = { Mercury: 87.969, Venus: 224.701, Earth: 365.256, Mars: 686.98, Jupiter: 4332.59, Saturn: 10759.22, Uranus: 30688.5, Neptune: 60182, Pluto: 90560 };
