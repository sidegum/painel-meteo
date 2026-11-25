// Escala do universo da aba Globo: do Volume Local (~10 Mpc) até a borda do universo observável, dentro da mesma cena
// da Via Láctea (js/globo-galaxia.js, unidade kpc, referencial galactocêntrico). Tudo vem de catálogos medidos e
// a distância de quem só tem desvio para o vermelho é calculada pela cosmologia do Planck 2018 (js/cosmologia.js).
//
// Camadas (vendor/ceu/universo.json e universo.bin, montados por scripts/globo/montar-universo.py):
// - Volume Local: ~870 galáxias com distância medida (Karachentsev et al. 2013).
// - Teia cósmica: 44 mil galáxias do 2MASS Redshift Survey (Huchra et al. 2012), distância pelo desvio para o vermelho
//   no referencial da radiação cósmica de fundo. Mostra os filamentos, as paredes e os vazios até ~1 bilhão de anos-luz.
// - Aglomerados de galáxias em raios X (MCXC, Piffaretti et al. 2011) e superaglomerados (MSCC, Chow-Martínez et al. 2014).
// - Vazios cósmicos do SDSS (quando o catálogo veio) e objetos notáveis com coordenadas publicadas (lista NOTAVEIS).
// - Quasares do SDSS DR16 (amostra de 1 em 8): o universo profundo, até z ≈ 7.
// - Radiação cósmica de fundo: o mapa SMICA do Planck numa esfera no raio comóvel da última dispersão (z = 1089,8), e o
//   horizonte de partículas (borda do universo observável) logo depois.
// - Cascas do tempo da luz: anéis em volta de nós nas distâncias de onde a luz saiu há 1, 2, 4... bilhões de anos.
import * as CO from './cosmologia.js';

const RAD = Math.PI / 180;
const CELULAR = matchMedia('(pointer: coarse)').matches;
const num = (v, casas = 0) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '–');
const KPC = 1000; // kpc por Mpc

/**
 * Objetos notáveis com coordenadas J2000 e desvio para o vermelho publicados (ou direção galáctica glon/glat, para
 * estruturas extensas). "aprox": centro aproximado de uma estrutura extensa, dito no cartão.
 */
export const NOTAVEIS = [
  { nome: '3C 273', ra: 187.2779, dec: 2.0524, z: 0.158, tipo: 'quasar', texto: 'O primeiro quasar identificado (Schmidt, 1963) e o mais brilhante do céu: um buraco negro de ~900 milhões de massas solares engolindo gás no centro de uma galáxia.', fonte: 'Schmidt 1963 · NED' },
  { nome: '3C 48', ra: 24.4221, dec: 33.1597, z: 0.367, tipo: 'quasar', texto: 'Uma das primeiras fontes de rádio identificadas como quasar.', fonte: 'Greenstein & Matthews 1963 · NED' },
  { nome: 'TON 618', ra: 187.1038, dec: 31.4772, z: 2.219, tipo: 'quasar', texto: 'Um dos quasares mais luminosos conhecidos, com um dos buracos negros mais massivos já estimados (~40 bilhões de massas solares, pela largura das linhas).', fonte: 'Shemmer et al. 2004 · NED' },
  { nome: 'Cruz de Einstein', ra: 340.1263, dec: 3.3586, z: 1.695, tipo: 'quasar', texto: 'Um quasar visto quatro vezes: a gravidade de uma galáxia no caminho (a 400 milhões de anos-luz de nós) desvia a luz dele, como uma lente.', fonte: 'Huchra et al. 1985 · NED' },
  { nome: 'APM 08279+5255', ra: 127.9238, dec: 52.7547, z: 3.911, tipo: 'quasar', texto: 'Quasar ampliado por lente gravitacional, onde se mediu o maior reservatório de água conhecido no universo.', fonte: 'Irwin et al. 1998 · Bradford et al. 2011' },
  { nome: 'ULAS J1342+0928', ra: 205.5338, dec: 9.4772, z: 7.54, tipo: 'quasar', texto: 'Quasar de quando o universo tinha ~690 milhões de anos, já com um buraco negro de ~800 milhões de massas solares.', fonte: 'Bañados et al. 2018' },
  { nome: 'J0313−1806', ra: 48.4327, dec: -18.1101, z: 7.64, tipo: 'quasar', texto: 'O quasar mais distante conhecido (2021): luz de quando o universo tinha ~670 milhões de anos.', fonte: 'Wang et al. 2021' },
  { nome: 'GN-z11', ra: 189.1061, dec: 62.2421, z: 10.60, tipo: 'galaxia-distante', texto: 'Galáxia jovem e muito brilhante, confirmada pelo telescópio Webb (NIRSpec), já com sinais de um buraco negro ativo.', fonte: 'Bunker et al. 2023 · Maiolino et al. 2024' },
  { nome: 'MACS0647-JD', ra: 101.9822, dec: 70.2433, z: 10.17, tipo: 'galaxia-distante', texto: 'Galáxia vista três vezes por lente gravitacional do aglomerado MACS J0647+70; o Webb a resolveu em dois pedaços.', fonte: 'Coe et al. 2013 · Hsiao et al. 2023' },
  { nome: 'JADES-GS-z14-0', ra: 53.08294, dec: -27.85563, z: 14.18, tipo: 'galaxia-distante', texto: 'Uma das galáxias mais distantes confirmadas: luz de quando o universo tinha ~290 milhões de anos, com oxigênio já detectado pelo ALMA. Em 2025, MoM-z14 (z = 14,44) passou a ser a mais distante.', fonte: 'Carniani et al. 2024 · Schouws et al. 2025 (ALMA)' },
  { nome: 'Earendel', ra: 24.3467, dec: -8.4644, z: 6.2, tipo: 'galaxia-distante', texto: 'A estrela individual mais distante já vista, ampliada milhares de vezes pela lente gravitacional do aglomerado WHL0137−08 (Arco do Nascer do Sol). O desvio é o da galáxia hospedeira, z ≈ 6,2.', fonte: 'Welch et al. 2022' },
  { nome: 'Campo Ultraprofundo do Hubble', ra: 53.1625, dec: -27.7914, z: 0.0, tipo: 'campo', texto: 'Um pedaço do céu do tamanho de um grão de areia à distância de um braço, com cerca de 10 mil galáxias. A linha mostra a direção, das galáxias vizinhas às mais distantes (z > 10).', fonte: 'Beckwith et al. 2006 · JADES (Webb)' },
  { nome: 'Primeiro Campo Profundo do Webb', ra: 110.8313, dec: -73.4543, z: 0.388, tipo: 'aglomerado-notavel', texto: 'Aglomerado SMACS 0723: a primeira imagem colorida do telescópio Webb (2022), com arcos de galáxias muito mais distantes ampliadas pela lente gravitacional do aglomerado.', fonte: 'NASA/ESA/CSA 2022 · Pontoppidan et al. 2022' },
  { nome: 'Aglomerado da Bala', ra: 104.658, dec: -55.95, z: 0.296, tipo: 'aglomerado-notavel', texto: 'Dois aglomerados que se atravessaram: o gás quente (raios X) ficou para trás e a massa medida por lente ficou com as galáxias. É uma das provas diretas da matéria escura.', fonte: 'Clowe et al. 2006' },
  { nome: 'El Gordo', ra: 15.7208, dec: -49.2553, z: 0.870, tipo: 'aglomerado-notavel', texto: 'O maior aglomerado de galáxias conhecido àquela distância, também em colisão: ~2 mil trilhões de massas solares.', fonte: 'Menanteau et al. 2012 · Jee et al. 2014' },
  { nome: 'Abell 2744 (Pandora)', ra: 3.5813, dec: -30.3886, z: 0.308, tipo: 'aglomerado-notavel', texto: 'Aglomerado formado pela colisão de pelo menos quatro aglomerados; sua lente gravitacional mostra galáxias muito distantes (programas Frontier Fields e UNCOVER).', fonte: 'Merten et al. 2011 · Bezanson et al. 2024' },
  { nome: 'Superaglomerado Local (de Virgem)', ra: 187.70, dec: 12.39, mpc: 16.5, tipo: 'estrutura', aprox: true, texto: 'O superaglomerado em volta do aglomerado de Virgem, com o Grupo Local na borda. Hoje é visto como um braço de Laniakea, uma estrutura bem maior.', fonte: 'de Vaucouleurs 1953 · Mei et al. 2007 (distância de Virgem)' },
  { nome: 'Grande Atrator', ra: 243.59, dec: -60.91, z: 0.0163, tipo: 'estrutura', aprox: true, texto: 'A concentração de massa para onde convergem as galáxias da nossa região, perto do aglomerado de Norma, escondida atrás do disco da Via Láctea. É o centro de atração de Laniakea, o superaglomerado de que fazemos parte: ~160 Mpc (520 milhões de anos-luz) e ~100 mil galáxias.', fonte: 'Lynden-Bell et al. 1988 · Tully et al. 2014' },
  { nome: 'Grande Muralha CfA2', ra: 195.0, dec: 29.0, z: 0.025, tipo: 'estrutura', aprox: true, texto: 'Parede de galáxias de ~500 milhões de anos-luz de comprimento, que passa pelo aglomerado de Coma. Foi a primeira grande estrutura do universo mapeada (1989).', fonte: 'Geller & Huchra 1989' },
  { nome: 'Grande Muralha Sloan', ra: 195.0, dec: 1.0, z: 0.073, tipo: 'estrutura', aprox: true, texto: 'Uma das maiores estruturas conhecidas: uma parede de galáxias de ~1,4 bilhão de anos-luz de comprimento, achada no mapa do Sloan.', fonte: 'Gott et al. 2005' },
  { nome: 'Vazio de Boötes', ra: 222.5, dec: 46.0, z: 0.05, raioMpc: 50, tipo: 'vazio', aprox: true, texto: 'Um dos maiores vazios conhecidos: uma região de ~330 milhões de anos-luz quase sem galáxias (só umas 60 foram achadas lá dentro).', fonte: 'Kirshner et al. 1981 · Kirshner et al. 1987' },
  { nome: 'Supervazio de Erídano', glon: 209, glat: -57, z: 0.22, raioMpc: 300, tipo: 'vazio', aprox: true, texto: 'Supervazio na direção da Mancha Fria da radiação cósmica de fundo; ele pode explicar parte da mancha (efeito Sachs-Wolfe integrado), mas não toda.', fonte: 'Szapudi et al. 2015 · Mackenzie et al. 2017' },
];

// Cascas do tempo da luz (bilhões de anos): onde está hoje o que emitiu a luz que chega agora, saída há t
const CASCAS = [1, 2, 4, 6, 8, 10, 12, 13];

const U = { ctx: null, dados: null, itens: [], cascas: [], prontos: false };

/** Direção (J2000 ou galáctica) e distância (Mpc) para a cena (kpc). */
function lugar(o, dMpc, alvo) {
  const { cena, THREE } = U.ctx;
  if (o.glon != null) { // galáctica direto: a cena tem X = Yg, Y = Zg, Z = Xg a partir do centro
    const l = o.glon * RAD, b = o.glat * RAD, { R0, zSol } = U.ctx.meta, d = dMpc * KPC;
    return (alvo || new THREE.Vector3()).set(Math.cos(b) * Math.sin(l) * d, Math.sin(b) * d + zSol, Math.cos(b) * Math.cos(l) * d - R0);
  }
  return cena(o.ra, o.dec, dMpc * KPC, alvo || new THREE.Vector3());
}

/** Texto padrão de distância cosmológica: tempo da luz e distância de hoje. */
export function textoCosmo(z) {
  const r = CO.resumo(z);
  const anos = (g) => (g >= 1 ? `${num(g, g < 10 ? 2 : 1)} bilhões de anos`.replace(/^1,00 bilhões/, '1 bilhão') : `${num(g * 1000, 0)} milhões de anos`);
  const al = (a) => (a >= 1e9 ? `${num(a / 1e9, a < 1e10 ? 2 : 1)} bilhões de anos-luz` : `${num(a / 1e6, 0)} milhões de anos-luz`);
  return {
    frase: `A luz que vemos saiu há ${anos(r.tLuz)}; hoje, com a expansão, está a ${al(r.dcAl)}.`,
    numeros: `z = ${num(z, z < 0.1 ? 4 : z < 1 ? 3 : 2)} · universo com ${anos(r.idade)} quando a luz saiu · distância comóvel ${num(r.dcMpc, r.dcMpc < 100 ? 1 : 0)} Mpc`,
    r,
  };
}

// ------------------------------------------------------------------ montagem

/**
 * Monta a escala do universo na cena da galáxia.
 * @param {object} ctx { G, THREE, cena, meta, uniformes, rotulo, pontosAlvo, baixar, carregarImagem, adicionar(obj) }
 */
export async function prepararUniverso(ctx) {
  U.ctx = ctx;
  const [dados, bin, lev] = await Promise.all([ctx.baixar('universo.json').catch(() => null), ctx.baixar('universo.bin', 'bin').catch(() => null), ctx.baixar('levantamentos.bin', 'bin').catch(() => null)]);
  U.dados = dados;
  ctx.progresso?.(0.45);
  const cmb = montarCmb();
  montarCascas();
  if (bin) montarNuvens(bin);
  if (lev) montarLevantamentos(lev);
  ctx.progresso?.(0.75);
  if (dados) { montarAglomerados(); montarSuperaglomerados(); montarVazios(); }
  montarNotaveis();
  await cmb; // o mapa do Planck faz parte do carregamento: ao abrir a escala, já está na tela
  U.prontos = true;
  return U;
}

/**
 * Levantamentos profundos (6dFGS, SDSS e BOSS): a teia cósmica além do 2MRS, até ~6 bilhões de anos-luz.
 * As fatias e cones que aparecem são a área do céu que cada levantamento observou, não a forma do universo.
 */
function montarLevantamentos(bin) {
  const { meta } = U.ctx;
  const v = new DataView(bin);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'LEV1') return;
  const total = v.getUint32(4, true), esc = v.getFloat32(8, true), passo = CELULAR ? 2 : 1, n = Math.floor(total / passo);
  const q = new Int16Array(bin.slice(12, 12 + 6 * total)), fonte = new Uint8Array(bin, 12 + 6 * total, total);
  const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), br = new Float32Array(n);
  const CORES = [[1, 0.9, 0.72], [0.8, 0.88, 1], [1, 0.66, 0.5]]; // 6dFGS, SDSS, BOSS (galáxias vermelhas luminosas)
  for (let i = 0; i < n; i++) {
    const k = i * passo, x = q[k * 3] / 32767 * esc, y = q[k * 3 + 1] / 32767 * esc, z = q[k * 3 + 2] / 32767 * esc;
    pos[i * 3] = y * KPC; pos[i * 3 + 1] = z * KPC + meta.zSol; pos[i * 3 + 2] = x * KPC - meta.R0;
    cor.set(CORES[fonte[k]] || CORES[1], i * 3);
    br[i] = fonte[k] === 2 ? 0.55 : 0.35;
  }
  U.levantamentos = nuvem(pos, cor, br, 1.5);
  U.levantamentos.userData = { n: total };
  U.ctx.adicionar(U.levantamentos);
}

/** Galáxias do Volume Local com distância medida; as que casam com o NGC/IC dão a distância ao objeto do NGC. */
export function volumeLocal() { return U.dados?.ungc || []; }

const VERTEX_NUVEM = /* glsl */`
  attribute vec3 cor; attribute float brilho;
  uniform float pr, alfa, px;
  varying vec3 vCor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = px * pr * (0.75 + 0.6 * brilho);
    vCor = cor * alfa * (0.35 + 0.65 * brilho);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAGMENT_NUVEM = /* glsl */`
  varying vec3 vCor;
  void main() { vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; if (r2 > 1.0) discard; gl_FragColor = vec4(vCor * exp(-2.6 * r2), 1.0); }`;

/** 2MRS e quasares: nuvens de pontos com brilho pela luminosidade e transparência pelo zoom. */
function montarNuvens(bin) {
  const { THREE, meta } = U.ctx;
  const v = new DataView(bin);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'UNV1') return;
  const n = v.getUint32(4, true), nq = v.getUint32(8, true), e2 = v.getFloat32(12, true), eq = v.getFloat32(16, true);
  let o = 20;
  const xyz = (qtd, esc) => { const q = new Int16Array(bin.slice(o, o += 6 * qtd)), pos = new Float32Array(qtd * 3); for (let i = 0; i < qtd; i++) { const x = q[i * 3] / 32767 * esc, y = q[i * 3 + 1] / 32767 * esc, z = q[i * 3 + 2] / 32767 * esc; pos[i * 3] = y * KPC; pos[i * 3 + 1] = z * KPC + meta.zSol; pos[i * 3 + 2] = x * KPC - meta.R0; } return pos; };
  const pos2 = xyz(n, e2);
  const mk = new Uint8Array(bin.slice(o, o += n)), tt = new Int8Array(bin.slice(o, o += n));
  const cor2 = new Float32Array(n * 3), br2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const M = mk[i] ? mk[i] / 10 - 30 : -23;
    br2[i] = Math.max(0, Math.min(1, (-(M) - 21) / 4.5)); // M_K de -21 (fraca) a -25,5 (gigante)
    const c = tt[i] <= 0 ? [1, 0.82, 0.62] : tt[i] < 90 ? [0.72, 0.84, 1] : [0.9, 0.9, 0.95]; // elípticas e lenticulares quentes; espirais azuladas
    cor2.set(c, i * 3);
  }
  U.galaxias = nuvem(pos2, cor2, br2, 2.2);
  U.galaxias.userData = { n };
  const posQ = xyz(nq, eq), zq = new Uint16Array(bin.slice(o, o += 2 * nq));
  const corQ = new Float32Array(nq * 3), brQ = new Float32Array(nq);
  for (let i = 0; i < nq; i++) {
    const z = zq[i] / 1000, t = Math.min(1, z / 4);
    corQ.set([0.62 + 0.38 * t, 0.7 - 0.25 * t, 1 - 0.45 * t], i * 3); // do azul (perto) ao vermelho (mais distante)
    brQ[i] = 0.5;
  }
  U.quasares = nuvem(posQ, corQ, brQ, 1.6);
  U.quasares.userData = { n: nq };
  U.ctx.adicionar(U.galaxias, U.quasares);
}

function nuvem(pos, cor, brilho, px) {
  const { THREE, uniformes } = U.ctx;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cor', new THREE.BufferAttribute(cor, 3)); g.setAttribute('brilho', new THREE.BufferAttribute(brilho, 1));
  const p = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { pr: uniformes.pr, alfa: { value: 0 }, px: { value: px * (CELULAR ? 1.1 : 1) } }, vertexShader: VERTEX_NUVEM, fragmentShader: FRAGMENT_NUVEM,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  p.frustumCulled = false; p.renderOrder = 3;
  return p;
}

/** Aglomerados em raios X: ponto do tamanho de R500; nomes dos mais massivos e próximos. */
function montarAglomerados() {
  const { THREE, rotulo, pontosAlvo } = U.ctx;
  U.aglomerados = [];
  for (const a of U.dados.aglomerados || []) {
    const d = CO.distanciaComovel(a.z);
    const it = { tipo: 'mcxc', ...a, nome: nomeAglomerado(a), p: lugar(a, d), dMpc: d, cor: '#d6b8ff', diam: Math.max(0.6, (a.r || 1) * 2) * KPC, minPx: 2.2, k: 0.55 };
    U.aglomerados.push(it);
  }
  if (!U.aglomerados.length) return;
  U.pontosAglomerados = pontosAlvo(U.aglomerados);
  U.ctx.adicionar(U.pontosAglomerados);
  // nomes: só Abell e nomes populares (as siglas de levantamento em raios X ficam para o cartão), os mais massivos para a distância
  const ordem = [...U.aglomerados].filter((a) => /^Abell |\(Abell /.test(a.nome) || /^[A-Z][a-zà-ú]+ ?[A-Za-zà-ú ]*$/.test(a.nome)).sort((x, y) => (y.m || 0) / (y.dMpc ** 1.2) - (x.m || 0) / (x.dMpc ** 1.2));
  for (const a of ordem.slice(0, CELULAR ? 60 : 140)) rotulo(a.nome, a.p, { prioridade: 22, de: a.dMpc * 120, ate: Math.min(a.dMpc * 9000, 2.5e6), classe: 'aglomerado', alvo: a });
}

function nomeAglomerado(a) {
  const alt = (a.a || '').split(',').map((s) => s.trim()).filter(Boolean);
  const abell = alt.find((s) => /^A\s?\d/.test(s));
  const popular = alt.find((s) => /^[A-Z][a-z]/.test(s) && !/^RXC|^MCXC/.test(s));
  if (popular && abell) return `${popular} (Abell ${abell.replace(/^A\s?0*/, '')})`;
  if (abell) return `Abell ${abell.replace(/^A\s?0*/, '')}`;
  return popular || a.o || `MCXC ${a.n}`;
}

/** Superaglomerados: halo grande e fraco com a extensão medida; os de nome popular ganham rótulo. */
function montarSuperaglomerados() {
  const { rotulo, pontosAlvo } = U.ctx;
  U.super = (U.dados.superaglomerados || []).map((s) => {
    const d = CO.distanciaComovel(s.z);
    return { tipo: 'super', ...s, nome: s.n || `Superaglomerado MSCC ${s.id}`, p: lugar(s, d), dMpc: d, cor: '#7fa6e8', diam: Math.max(8, s.dmax || 10) * KPC, minPx: 1.6, k: 0.35 };
  });
  if (!U.super.length) return;
  U.pontosSuper = pontosAlvo(U.super);
  U.ctx.adicionar(U.pontosSuper);
  for (const s of U.super) if (s.n) rotulo(s.n, s.p, { prioridade: 48, de: 4e4, ate: 3e6, classe: 'super', alvo: s });
}

const VERTEX_ANEL = /* glsl */`
  attribute float diam; uniform float escalaPx, pr, alfa;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = diam * escalaPx / max(-mv.z, 1e-6);
    gl_PointSize = clamp(px, 0.0, 400.0 * pr);
    // só os anéis de tamanho médio na tela: pequenos viram ruído e grandes demais cobririam a cena
    vA = alfa * clamp((px - 10.0 * pr) / (30.0 * pr), 0.0, 1.0) * clamp((260.0 * pr - px) / (160.0 * pr), 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAGMENT_ANEL = /* glsl */`
  varying float vA;
  void main() { vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.0; if (r > 1.0) discard; float borda = smoothstep(0.9, 0.975, r) * (1.0 - smoothstep(0.975, 1.0, r)); gl_FragColor = vec4(vec3(0.42, 0.55, 0.75) * vA * borda * 0.45, 1.0); }`;

/** Vazios: um contorno circular do tamanho do vazio (o vazio em si é a falta de galáxias, que já se vê na nuvem). */
function montarVazios() {
  const { THREE, uniformes } = U.ctx;
  U.vazios = (U.dados.vazios || []).map((v) => ({ tipo: 'vazio-sdss', ...v, p: lugar(v, v.d), diam: v.r * 2 * KPC }));
  if (!U.vazios.length) return;
  const pos = new Float32Array(U.vazios.length * 3), diam = new Float32Array(U.vazios.length);
  U.vazios.forEach((v, i) => { pos.set([v.p.x, v.p.y, v.p.z], i * 3); diam[i] = v.diam; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('diam', new THREE.BufferAttribute(diam, 1));
  U.pontosVazios = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { escalaPx: uniformes.escalaPx, pr: uniformes.pr, alfa: { value: 0 } }, vertexShader: VERTEX_ANEL, fragmentShader: FRAGMENT_ANEL,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  U.pontosVazios.frustumCulled = false; U.pontosVazios.renderOrder = 2;
  U.ctx.adicionar(U.pontosVazios);
}

/** Objetos notáveis: ponto com cor do tipo e nome; o campo profundo vira uma linha de visada. */
function montarNotaveis() {
  const { THREE, rotulo, pontosAlvo } = U.ctx;
  const COR = { quasar: '#9fb8ff', 'galaxia-distante': '#ffb38a', 'aglomerado-notavel': '#e2c4ff', estrutura: '#a8c8ff', vazio: '#8aa0bc', campo: '#ffffff' };
  U.notaveis = NOTAVEIS.map((o) => {
    const d = o.mpc ?? (o.z > 0 ? CO.distanciaComovel(o.z) : 0);
    return { tipo: 'notavel', ...o, dMpc: d, p: lugar(o, Math.max(d, 1)), cor: COR[o.tipo], diam: (o.raioMpc ? o.raioMpc * 2 : 1.5) * KPC, minPx: o.tipo === 'vazio' ? 0 : 3.4, k: 1 };
  });
  const pontuais = U.notaveis.filter((o) => o.tipo !== 'campo' && o.tipo !== 'vazio');
  U.ctx.adicionar(pontosAlvo(pontuais));
  for (const o of U.notaveis) {
    if (o.tipo === 'campo') continue;
    const longe = o.dMpc > 1500;
    rotulo(o.nome, o.p, { prioridade: o.tipo === 'estrutura' || o.tipo === 'vazio' ? 58 : 40, de: longe ? 4e5 : 2e4, ate: longe ? 1.6e7 : 4e6, classe: `notavel ${o.tipo}`, alvo: o });
  }
  // linha de visada do Campo Ultraprofundo do Hubble: do Sol até z = 14 (o que ele enxerga em profundidade)
  const campo = U.notaveis.find((o) => o.tipo === 'campo');
  if (campo) {
    const a = lugar(campo, 0.001), b = lugar(campo, CO.distanciaComovel(14));
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    U.linhaCampo = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
    U.linhaCampo.frustumCulled = false; U.linhaCampo.renderOrder = 2;
    U.ctx.adicionar(U.linhaCampo);
    campo.p = lugar(campo, CO.distanciaComovel(1));
    rotulo(campo.nome, campo.p, { prioridade: 36, de: 6e5, ate: 1.6e7, classe: 'notavel campo', alvo: campo });
  }
}

const VERTEX_CMB = /* glsl */`
  varying vec3 vDir; varying vec3 vN; varying vec3 vV;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
// direção na cena (X = Yg, Y = Zg, Z = Xg) → longitude e latitude galácticas → posição no mapa equiretangular
const FRAGMENT_CMB = /* glsl */`
  uniform sampler2D mapa; uniform float alfa; uniform float temMapa;
  varying vec3 vDir; varying vec3 vN; varying vec3 vV;
  void main() {
    float l = atan(vDir.x, vDir.z);
    float b = asin(clamp(vDir.y, -1.0, 1.0));
    vec2 uv = vec2(fract(l / 6.28318530718), 0.5 + b / 3.14159265359);
    vec3 c = temMapa > 0.5 ? texture2D(mapa, uv).rgb : vec3(1.0, 0.62, 0.38) * 0.35;
    float borda = pow(1.0 - abs(dot(vN, vV)), 3.0);
    gl_FragColor = vec4(c * alfa * (0.85 + 0.4 * borda), 1.0);
  }`;

/** Radiação cósmica de fundo: o mapa do Planck numa esfera no raio da última dispersão, centrada em nós. */
function montarCmb() {
  const { THREE, carregarImagem, meta, G } = U.ctx;
  const R = CO.DIST_CMB_MPC * KPC;
  const uni = { mapa: { value: null }, alfa: { value: 0 }, temMapa: { value: 0 } };
  U.cmb = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.ShaderMaterial({ uniforms: uni, vertexShader: VERTEX_CMB, fragmentShader: FRAGMENT_CMB, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false }));
  U.cmb.position.set(0, meta.zSol, -meta.R0);
  U.cmb.renderOrder = -2; U.cmb.frustumCulled = false; U.cmb.visible = false;
  U.ctx.adicionar(U.cmb);
  U.cmbItem = { tipo: 'cmb', nome: 'Radiação cósmica de fundo', p: new THREE.Vector3(0, R, 0).add(U.cmb.position) };
  return carregarImagem(CELULAR ? 'cmb-2048.jpg' : 'cmb-4096.jpg').then((img) => {
    const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
    uni.mapa.value = t; uni.temMapa.value = 1; U.cmbMapa = true;
  }).catch(() => { U.cmbMapa = false; });
}

/** Cascas do tempo da luz: anéis voltados para a câmera, centrados em nós, com o tempo escrito. */
function montarCascas() {
  const { THREE, rotulo, meta } = U.ctx;
  const n = 256, pts = [];
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  U.grupoCascas = new THREE.Group();
  U.grupoCascas.position.set(0, meta.zSol, -meta.R0);
  for (const t of CASCAS) {
    const z = zDoTempo(t), dMpc = CO.distanciaComovel(z);
    const anel = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fb4d6, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }));
    anel.scale.setScalar(dMpc * KPC); anel.frustumCulled = false; anel.renderOrder = 1;
    U.grupoCascas.add(anel);
    const pRot = new THREE.Vector3();
    const r = rotulo(`luz de ${num(t, 0)} ${t === 1 ? 'bilhão' : 'bilhões'} de anos`, pRot, { prioridade: 12, de: dMpc * KPC * 0.9, ate: dMpc * KPC * 12, classe: 'casca' });
    U.cascas.push({ t, z, dMpc, anel, pRot, r });
  }
  U.ctx.adicionar(U.grupoCascas);
}

/** Desvio para o vermelho cuja luz viajou t bilhões de anos (inverte tempoDaLuz por bisseção). */
function zDoTempo(t) {
  let lo = 0, hi = 2000;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (CO.tempoDaLuz(m) < t) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ a cada quadro

const rampa = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const _q = { v: null };
/**
 * Transparência de cada camada pelo zoom (distância da câmera ao foco, kpc) e filtros.
 * @param {number} zoom distância da câmera ao foco (kpc)
 * @param {object} F filtros ligados
 */
export function atualizarUniverso(zoom, F, camera) {
  if (!U.prontos) return;
  const lz = Math.log10(zoom);
  // galáxias do 2MRS: aparecem a partir de ~3 Mpc de zoom e somem quando o quadro passa de ~5 bilhões de anos-luz; de longe, milhares de pontos se somam no mesmo pixel, então o brilho de cada um cai
  if (U.galaxias) { const a = rampa(lz, 3.3, 4.1) * (1 - rampa(lz, 6.4, 7.0)) * (1 - 0.72 * rampa(lz, 5.0, 6.3)); U.galaxias.material.uniforms.alfa.value = a; U.galaxias.visible = F.teia && a > 0.003; }
  if (U.levantamentos) { const a = rampa(lz, 4.5, 5.3) * (1 - rampa(lz, 7.0, 7.5)) * (0.8 - 0.5 * rampa(lz, 5.7, 6.8)); U.levantamentos.material.uniforms.alfa.value = a; U.levantamentos.visible = F.levantamentos && a > 0.003; }
  if (U.quasares) { const a = rampa(lz, 5.6, 6.5) * 0.9; U.quasares.material.uniforms.alfa.value = a; U.quasares.visible = F.quasares && a > 0.003; }
  if (U.pontosAglomerados) U.pontosAglomerados.visible = F.aglomerados && lz > 3.6;
  if (U.pontosSuper) U.pontosSuper.visible = F.superaglomerados && lz > 4.3;
  if (U.pontosVazios) { const a = rampa(lz, 4.9, 5.5) * (1 - rampa(lz, 6.1, 6.5)) * 0.35; U.pontosVazios.material.uniforms.alfa.value = a; U.pontosVazios.visible = F.vazios && a > 0.003; }
  if (U.linhaCampo) U.linhaCampo.visible = F.notaveis && lz > 5.6;
  // radiação cósmica de fundo: some de perto (no céu real ela não se vê); acende quando o quadro passa de bilhões de anos-luz
  const aCmb = rampa(lz, 6.3, 7.1);
  U.cmb.material.uniforms.alfa.value = aCmb * (zoom > CO.DIST_CMB_MPC * KPC * 1.05 ? 1 : 0.16); // de dentro, fundo discreto
  U.cmb.visible = F.cmb && aCmb > 0.003;
  // cascas: anéis no plano da tela, rótulo no topo de cada anel
  U.grupoCascas.visible = F.cascas && lz > 5.4;
  if (U.grupoCascas.visible) {
    for (const c of U.cascas) {
      c.anel.quaternion.copy(camera.quaternion);
      _q.v ||= new U.ctx.THREE.Vector3();
      c.pRot.copy(_q.v.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(c.dMpc * KPC)).add(U.grupoCascas.position);
      c.anel.material.opacity = 0.28 * rampa(lz, Math.log10(c.dMpc * KPC) - 0.6, Math.log10(c.dMpc * KPC) - 0.1);
    }
  }
  for (const c of U.cascas) c.r.oculto = !U.grupoCascas.visible;
}

/** Itens tocáveis desta escala (com a mesma estrutura dos da galáxia: p, diam, tipo). */
export function candidatos(F, zoom) {
  if (!U.prontos) return [];
  const out = [];
  if (F.notaveis) out.push(...U.notaveis.filter((o) => o.tipo !== 'campo' || zoom > 4e5));
  if (F.aglomerados && zoom > 4000) out.push(...(U.aglomerados || []));
  if (F.superaglomerados && zoom > 2e4) out.push(...(U.super || []));
  if (F.cmb && U.cmb.visible) out.push(U.cmbItem);
  return out;
}

/** Cartão de um item desta escala; devolve false se o item não é daqui. */
export function cartao(it, G, ir) {
  if (it.tipo === 'mcxc') {
    const c = textoCosmo(it.z);
    const outros = [it.o, ...(it.a || '').split(',').map((s) => s.trim())].filter((s) => s && s !== it.nome).slice(0, 3).join(', ');
    G.mostrarPainel(it.nome, `Aglomerado de galáxias com gás a dezenas de milhões de graus, que brilha em raios X. ${c.frase}`,
      [it.m ? `Massa ${num(it.m * 100, 0)} trilhões de sóis (M500)` : null, it.r ? `raio ${num(it.r * 3.2616, 1)} milhões de anos-luz (R500)` : null, c.numeros, outros ? `também ${outros}` : null].filter(Boolean).join(' · '),
      'MCXC (Piffaretti et al. 2011) · distância: Planck 2018', [ir()]);
  } else if (it.tipo === 'super') {
    const c = textoCosmo(it.z);
    G.mostrarPainel(it.nome, `Superaglomerado: ${it.nm} aglomerados de galáxias ligados por filamentos, ${num((it.dmax || 0) * 3.2616, 0)} milhões de anos-luz de ponta a ponta. ${c.frase}`,
      `${c.numeros}${it.membros?.length ? ` · aglomerados: ${it.membros.slice(0, 8).map((m) => m.replace(/^A0*/, 'Abell ').replace(/^S0*/, 'Abell S')).join(', ')}${it.nm > 8 ? '…' : ''}` : ''}`,
      'MSCC (Chow-Martínez et al. 2014) · distância: Planck 2018', [ir()]);
  } else if (it.tipo === 'notavel') {
    const c = it.mpc ? { frase: `Fica a ${num(it.mpc * 3.2616, 0)} milhões de anos-luz (distância medida).`, numeros: `${num(it.mpc, 1)} Mpc` } : it.z > 0 ? textoCosmo(it.z) : null;
    const extra = it.aprox ? ' · posição do centro aproximada (estrutura extensa)' : '';
    G.mostrarPainel(it.nome, it.texto, `${c ? c.frase + ' ' : ''}${c ? c.numeros : 'Direção do campo: as galáxias dele estão de z ≈ 0,1 a z > 10'}${extra}`, it.fonte, [ir()]);
  } else if (it.tipo === 'cmb') {
    const r = CO.resumo(CO.Z_CMB);
    G.mostrarPainel('Radiação cósmica de fundo', `A luz mais antiga que existe: saiu quando o universo tinha ${num(r.idade * 1e6, 0)} mil anos e ficou transparente. Hoje é um brilho de micro-ondas a 2,7255 K vindo de todas as direções.`,
      `Mapa: flutuações de ±300 milionésimos de grau (1 parte em 100 mil), as sementes das galáxias · casca a ${num(r.dcAl / 1e9, 1)} bilhões de anos-luz (z = 1.090) · nosso movimento de 370 km/s (dipolo) foi retirado`,
      `Planck (ESA), mapa SMICA${U.cmbMapa === false ? ' (não carregou; esfera sem o mapa)' : ''} · Planck Collaboration 2020`, []);
  } else return false;
  return true;
}

/** Contagens para a ajuda e para o painel de camadas. */
export function contagens() {
  return { levantamentos: U.levantamentos?.userData.n || 0, galaxias: U.galaxias?.userData.n || 0, quasares: U.quasares?.userData.n || 0, aglomerados: U.aglomerados?.length || 0, super: U.super?.length || 0, vazios: U.vazios?.length || 0, ungc: U.dados?.ungc?.length || 0 };
}

export function notasFontes() {
  const f = U.dados?.fontes || {};
  return ['Teia cósmica: 2MRS (Huchra et al. 2012)', 'Volume Local: Karachentsev et al. 2013', 'Aglomerados: MCXC (Piffaretti et al. 2011)', 'Superaglomerados: MSCC (Chow-Martínez et al. 2014)',
    f.vazios ? `Vazios: ${/douglass/.test(f.vazios) ? 'Douglass et al. 2023' : 'Pan et al. 2012'}` : null, 'Quasares: SDSS DR16Q (Lyke et al. 2020)', 'Radiação cósmica de fundo: Planck (ESA), SMICA', f.boss ? 'Levantamentos profundos: 6dFGS (Jones et al. 2009), SDSS DR10 (Tempel et al. 2014), BOSS DR12 (Reid et al. 2016)' : null, 'Distâncias: ΛCDM do Planck 2018'].filter(Boolean);
}

export const estado = () => U;
