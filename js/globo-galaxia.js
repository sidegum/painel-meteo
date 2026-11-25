// Escala de galáxias da aba Globo: a Via Láctea vista de fora, o Grupo Local e as galáxias do catálogo NGC/IC nas
// distâncias reais. Abre a partir do Sistema solar ("Via Láctea") e volta para ele.
//
// Unidade da cena: quiloparsec (kpc; 1 kpc = 3.261,6 anos-luz). Referencial galactocêntrico com o centro da Galáxia na
// origem, o plano galáctico em XZ e o polo norte galáctico em +Y:
//   X = Yg (para a longitude galáctica 90°, sentido da rotação), Y = Zg (polo norte galáctico), Z = Xg (Sol em Z = -R0).
// Uma direção equatorial J2000 (ascensão reta, declinação) vira galáctica pela matriz padrão (Hipparcos, ESA 1997,
// vol. 1, §1.5.3) e depois cartesiana a partir do Sol.
//
// O que é medido e o que é modelo:
// - Via Láctea: modelo calculado (scripts/globo/montar-via-lactea.py) pelos braços ajustados às paralaxes de masers
//   (Reid et al. 2019), barra (Wegg et al. 2015) e disco (Bland-Hawthorn & Gerhard 2016). Ninguém a viu de fora.
// - Estrelas perto do Sol: as 800 mil do céu (HYG e Gaia DR3), cada uma na distância medida.
// - Masers, aglomerados globulares e galáxias do Grupo Local: catálogos (vendor/ceu/galaxia.json).
// - Galáxias NGC/IC: direção do catálogo e distância medida (Karachentsev et al. 2013, quando a galáxia está no Volume
//   Local) ou publicada, ou pelo desvio para o vermelho com a cosmologia do Planck 2018 (js/cosmologia.js).
// - Além do Grupo Local: Volume Local, teia cósmica, aglomerados, superaglomerados, vazios, quasares e a radiação
//   cósmica de fundo, no módulo js/globo-universo.js, que desenha na mesma cena.
import { el, prefs } from './ui.js';
import { TIPOS_OBJETO, corBV } from './globo-estrelas.js';
import { cartaoObjeto } from './globo-ceu.js';
import * as CO from './cosmologia.js';
import * as UNI from './globo-universo.js';

const RAD = Math.PI / 180;
const AL_POR_KPC = 3261.56;
const EQ_GAL = [ // equatorial J2000 → galáctico (linhas: x para o centro, y para l = 90°, z para o polo norte galáctico)
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
const DIST = { min: 0.002, max: 4.5e7, inicial: 46 }; // kpc: de ~400 UA até ver de fora a esfera do universo observável
const RAIO_UNIVERSO = CO.HORIZONTE_MPC; // Mpc: horizonte de partículas (~46 bilhões de anos-luz; Planck 2018, ΛCDM)
const CELULAR = matchMedia('(pointer: coarse)').matches;
const MOVIMENTO_REDUZIDO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const num = (v, casas = 0) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '–');

// Aglomerados de galáxias de referência (centro em J2000). Distância medida (Virgem: Mei et al. 2007; Fornax: Blakeslee
// et al. 2009) ou pelo desvio para o vermelho com a cosmologia do Planck 2018 (distância comóvel).
const AGLOMERADOS = [
  { nome: 'Aglomerado de Virgem', ra: 187.70, dec: 12.39, mpc: 16.5, fonte: 'Mei et al. 2007', n: 'cerca de 1.300 galáxias' },
  { nome: 'Aglomerado de Fornax', ra: 54.62, dec: -35.45, mpc: 20.0, fonte: 'Blakeslee et al. 2009', n: 'cerca de 60 galáxias grandes' },
  { nome: 'Aglomerado de Centauro', ra: 192.20, dec: -41.31, z: 0.0114, fonte: 'Abell 3526' },
  { nome: 'Aglomerado de Hidra', ra: 159.18, dec: -27.52, z: 0.0126, fonte: 'Abell 1060' },
  { nome: 'Aglomerado de Norma', ra: 243.59, dec: -60.91, z: 0.0163, fonte: 'Abell 3627', n: 'perto do Grande Atrator' },
  { nome: 'Aglomerado de Perseu', ra: 49.95, dec: 41.51, z: 0.0179, fonte: 'Abell 426' },
  { nome: 'Aglomerado de Coma', ra: 194.95, dec: 27.98, z: 0.0231, fonte: 'Abell 1656', n: 'mais de 1.000 galáxias' },
];

// ------------------------------------------------------------------ camadas (o que aparece nesta escala)

/** Camadas da escala de galáxias e do universo, com o padrão de cada uma; gravadas em globo:camadasUniverso. */
export const CAMADAS_UNIVERSO = [
  { grupo: 'Nossa galáxia', itens: [['viaLactea', 'Via Láctea (modelo)'], ['estrelas', 'Estrelas perto do Sol (800 mil, distância medida)'], ['masers', 'Regiões de formação de estrelas (masers)'], ['globulares', 'Aglomerados globulares']] },
  { grupo: 'Galáxias', itens: [['grupoLocal', 'Grupo Local'], ['galaxias', 'Galáxias próximas (NGC/IC e Volume Local)'], ['teia', 'Teia cósmica (2MASS Redshift Survey)']] },
  { grupo: 'Grandes estruturas', itens: [['aglomerados', 'Aglomerados de galáxias (raios X)'], ['superaglomerados', 'Superaglomerados'], ['vazios', 'Vazios cósmicos'], ['notaveis', 'Lugares notáveis (quasares, recordes, muralhas)']] },
  { grupo: 'Universo profundo', itens: [['quasares', 'Quasares (SDSS)'], ['cascas', 'Tempo da luz (anéis de 1 a 13 bilhões de anos)'], ['cmb', 'Radiação cósmica de fundo (Planck)']] },
  { grupo: 'Tela', itens: [['nomes', 'Nomes']] },
];
const PADRAO_UNIVERSO = Object.fromEntries(CAMADAS_UNIVERSO.flatMap((g) => g.itens.map(([k]) => [k, true])));
export const FG = { ...PADRAO_UNIVERSO, ...prefs.ler('globo:camadasUniverso', {}) };
/** Liga ou desliga uma camada e grava a escolha. */
export function definirCamada(chave, ligada) { FG[chave] = ligada; prefs.gravar('globo:camadasUniverso', { ...FG }); aplicarCamadas(); }

/** Visibilidade dos objetos fixos de cada camada (as do universo mudam também pelo zoom, em atualizarUniverso). */
function aplicarCamadas() {
  if (!GX.cena) return;
  if (GX.grupoMasers) GX.grupoMasers.visible = FG.masers;
  if (GX.grupoGlobulares) GX.grupoGlobulares.visible = FG.globulares;
  if (GX.estrelasReais) GX.estrelasReais.visible = FG.estrelas;
  for (const o of GX.objGrupoLocal || []) o.visible = FG.grupoLocal;
  for (const o of GX.objGalaxias || []) o.visible = FG.galaxias;
}

const GX = { G: null, THREE: null, preparo: null, aberto: false, rotulos: [], foco: null, anim: null, meta: null, dados: null };

const baixar = (arquivo, tipo = 'json') => fetch(new URL(`../vendor/ceu/${arquivo}`, import.meta.url)).then((r) => {
  if (!r.ok) throw new Error(`${arquivo}: HTTP ${r.status}`);
  return tipo === 'bin' ? r.arrayBuffer() : tipo === 'blob' ? r.blob() : r.json();
});
const pausa = () => new Promise((ok) => (globalThis.requestIdleCallback ? requestIdleCallback(ok, { timeout: 300 }) : setTimeout(ok, 16)));

// ------------------------------------------------------------------ coordenadas

/** Direção equatorial J2000 (graus) e distância (kpc) para a cena (kpc, galactocêntrica). */
function cena(ra, dec, dKpc, alvo) {
  const a = ra * RAD, d = dec * RAD, cd = Math.cos(d);
  const e = [cd * Math.cos(a), cd * Math.sin(a), Math.sin(d)];
  const g = EQ_GAL.map((l) => l[0] * e[0] + l[1] * e[1] + l[2] * e[2]);
  const { R0, zSol } = GX.meta;
  return alvo.set(g[1] * dKpc, g[2] * dKpc + zSol, g[0] * dKpc - R0);
}


// ------------------------------------------------------------------ montagem

/** Baixa e monta tudo de antemão (chamado pelo globo em momento ocioso, depois do sistema solar). */
export function prepararGalaxia(G, THREE) {
  if (GX.preparo) return GX.preparo;
  GX.G = G; GX.THREE = THREE;
  GX.preparo = (async () => {
    const [meta, bin, dados, imagem] = await Promise.all([
      baixar('via-lactea.json'), baixar('via-lactea.bin', 'bin'), baixar('galaxia.json').catch(() => null),
      carregarImagem(CELULAR ? 'via-lactea-2048.jpg' : `via-lactea-${4096}.jpg`),
    ]);
    GX.meta = meta; GX.dados = dados;
    GX.cena = new THREE.Scene();
    GX.camera = new THREE.PerspectiveCamera(G.camera.fov, G.camera.aspect, 0.0005, 2e6);
    GX.foco = new THREE.Vector3();
    montarDisco(imagem);
    await pausa();
    montarParticulas(bin);
    await pausa();
    montarMarcos();
    montarGrupoLocal();
    await pausa();
    await UNI.prepararUniverso({ G, THREE, cena, meta, uniformes: GX.uniformes, rotulo, pontosAlvo, baixar, carregarImagem, adicionar: (...o) => GX.cena.add(...o) });
    await pausa();
    montarGalaxiasNgc();
    montarCatalogos();
    montarInterface();
    aplicarCamadas();
    return GX;
  })();
  return GX.preparo;
}

function carregarImagem(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok(img); img.onerror = () => falha(new Error(`${arquivo} não carregou`));
    img.src = new URL(`../vendor/ceu/${arquivo}`, import.meta.url).href;
  });
}

/** Plano com a imagem do modelo, visto de frente; some quando a Galáxia é vista de lado (aí ficam as partículas). */
function montarDisco(imagem) {
  const { THREE } = GX;
  const tex = new THREE.Texture(imagem);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, GX.G.renderer.capabilities.getMaxAnisotropy()); tex.needsUpdate = true;
  const L = GX.meta.metade * 2;
  GX.uniformes = { face: { value: 1 }, escalaPx: { value: 800 }, pr: { value: 1 }, perto: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  GX.disco = new THREE.Mesh(new THREE.PlaneGeometry(L, L), mat);
  GX.disco.rotation.x = -Math.PI / 2;
  GX.disco.renderOrder = 0;
  GX.cena.add(GX.disco);
  GX.texDisco = tex;
}

const VERTEX_PART = /* glsl */`
  attribute vec3 cor; attribute float brilho; attribute float tam;
  uniform float escalaPx, pr, face, perto;
  varying vec3 vCor; varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = tam * escalaPx / max(-mv.z, 1e-4);             // diâmetro físico (kpc) na tela
    gl_PointSize = clamp(px, 1.5 * pr, 48.0 * pr);
    float encolhe = min(1.0, px / gl_PointSize);              // ponto que ficaria menor que o mínimo some aos poucos
    float cresce = min(1.0, 48.0 * pr / max(px, 1.0));        // muito perto: o ponto fica no tamanho máximo e esmaece
    vA = brilho / 255.0 * (0.004 + 0.03 * (1.0 - face)) * encolhe * encolhe * cresce * cresce * (1.0 - 0.9 * perto);
    vCor = cor;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAGMENT_PART = /* glsl */`
  varying vec3 vCor; varying float vA;
  void main() { vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; if (r2 > 1.0) discard; gl_FragColor = vec4(vCor * vA * exp(-3.0 * r2), 1.0); }`;
const FRAGMENT_POEIRA = /* glsl */`
  uniform float face;
  void main() { vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; if (r2 > 1.0) discard; gl_FragColor = vec4(0.03, 0.02, 0.015, (1.0 - face) * 0.35 * exp(-2.5 * r2)); }`;
const VERTEX_POEIRA = /* glsl */`
  uniform float escalaPx, pr;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(0.12 * escalaPx / max(-mv.z, 1e-4), 1.0 * pr, 64.0 * pr); gl_Position = projectionMatrix * mv; }`;

/** Partículas do modelo (estrelas do disco, braços, barra e poeira) para a Galáxia vista de lado ou de perto. */
function montarParticulas(bin) {
  const { THREE } = GX;
  const v = new DataView(bin);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'MWG2') throw new Error('via-lactea.bin em formato inesperado');
  const n = v.getUint32(4, true), nd = v.getUint32(8, true);
  let o = 12;
  const ler = (qtd, esc) => { const q = new Int16Array(bin.slice(o, o += 2 * qtd)), f = new Float32Array(qtd); for (let i = 0; i < qtd; i++) f[i] = q[i] / 32767 * esc; return f; };
  const M = GX.meta.metade;
  const x = ler(n, M), y = ler(n, 4), z = ler(n, M);
  const cor8 = new Uint8Array(bin.slice(o, o += 3 * n)), br = new Uint8Array(bin.slice(o, o += n)), tam8 = new Uint8Array(bin.slice(o, o += n));
  const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), bri = new Float32Array(n), tam = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = x[i]; pos[i * 3 + 1] = y[i]; pos[i * 3 + 2] = z[i]; cor[i * 3] = cor8[i * 3] / 255; cor[i * 3 + 1] = cor8[i * 3 + 1] / 255; cor[i * 3 + 2] = cor8[i * 3 + 2] / 255; bri[i] = br[i]; tam[i] = tam8[i] / 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cor', new THREE.BufferAttribute(cor, 3)); g.setAttribute('brilho', new THREE.BufferAttribute(bri, 1)); g.setAttribute('tam', new THREE.BufferAttribute(tam, 1));
  GX.particulas = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: GX.uniformes, vertexShader: VERTEX_PART, fragmentShader: FRAGMENT_PART, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  GX.particulas.frustumCulled = false; GX.particulas.renderOrder = 1;
  const xd = ler(nd, M), yd = ler(nd, 4), zd = ler(nd, M), pd = new Float32Array(nd * 3);
  for (let i = 0; i < nd; i++) { pd[i * 3] = xd[i]; pd[i * 3 + 1] = yd[i]; pd[i * 3 + 2] = zd[i]; }
  const gd = new THREE.BufferGeometry(); gd.setAttribute('position', new THREE.BufferAttribute(pd, 3));
  GX.poeira = new THREE.Points(gd, new THREE.ShaderMaterial({ uniforms: GX.uniformes, vertexShader: VERTEX_POEIRA, fragmentShader: FRAGMENT_POEIRA, transparent: true, depthWrite: false, depthTest: false }));
  GX.poeira.frustumCulled = false; GX.poeira.renderOrder = 2;
  GX.cena.add(GX.particulas, GX.poeira);
}

// pontos com tamanho físico (diâmetro em kpc) e um mínimo em pixels: galáxias, aglomerados, masers
const VERTEX_ALVOS = /* glsl */`
  attribute vec3 cor; attribute float diam; attribute float minPx;
  uniform float escalaPx, pr;
  varying vec3 vCor; varying float vNucleo;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = diam * escalaPx / max(-mv.z, 1e-6);
    gl_PointSize = clamp(max(px, minPx * pr), 1.0, 320.0 * pr);
    vNucleo = clamp(minPx * pr / max(px, 1.0), 0.0, 1.0);    // pequeno na tela: ponto nítido; grande: brilho difuso
    vCor = cor * clamp(px / max(minPx * pr, 1.0), 0.3, 1.0);   // galáxia que é só um ponto ao longe fica mais fraca
    gl_Position = projectionMatrix * mv;
  }`;
const FRAGMENT_ALVOS = /* glsl */`
  varying vec3 vCor; varying float vNucleo;
  void main() {
    vec2 p = gl_PointCoord - 0.5; float r2 = dot(p, p) * 4.0; if (r2 > 1.0) discard;
    float a = mix(exp(-4.0 * r2) * 0.55, exp(-7.0 * r2), vNucleo);
    gl_FragColor = vec4(vCor * a, 1.0);
  }`;

function pontosAlvo(lista) {
  const { THREE } = GX;
  const n = lista.length, pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), diam = new Float32Array(n), minPx = new Float32Array(n), c = new THREE.Color();
  lista.forEach((it, i) => { pos.set([it.p.x, it.p.y, it.p.z], i * 3); c.set(it.cor); cor.set([c.r * (it.k ?? 1), c.g * (it.k ?? 1), c.b * (it.k ?? 1)], i * 3); diam[i] = it.diam; minPx[i] = it.minPx; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  g.setAttribute('diam', new THREE.BufferAttribute(diam, 1)); g.setAttribute('minPx', new THREE.BufferAttribute(minPx, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: GX.uniformes, vertexShader: VERTEX_ALVOS, fragmentShader: FRAGMENT_ALVOS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.renderOrder = 4;
  return pts;
}

/** Camada de cada classe de rótulo: com a camada desligada, o nome some junto. */
const CAMADA_DO_ROTULO = { faixa: 'viaLactea', aglomerado: 'aglomerados', super: 'superaglomerados', notavel: 'notaveis', casca: 'cascas', local: 'grupoLocal', ngc: 'galaxias', ungc: 'galaxias' };
function rotulo(texto, p, { prioridade = 10, de = 0, ate = Infinity, classe = '', alvo = null, perto = false } = {}) {
  const e = el('span', { class: `globo-rotulo globo-rotulo-planeta galaxia-rotulo ${classe}`, text: texto, hidden: true });
  GX.G.dom.raiz.append(e);
  const camada = CAMADA_DO_ROTULO[classe.split(' ')[0]] || null;
  const r = { el: e, p, prioridade, de, ate, perto, largura: texto.length * 7 + 18, alvo, camada };
  GX.rotulos.push(r);
  return r;
}

/** Sol, centro galáctico, braços e escala. */
function montarMarcos() {
  const { THREE, meta } = GX;
  GX.sol = new THREE.Vector3(0, meta.zSol, -meta.R0);
  GX.centro = new THREE.Vector3();
  GX.marcos = [
    { tipo: 'sol', nome: 'Sol', p: GX.sol, cor: '#fff3c4', diam: 0.0001, minPx: 5, k: 1.6 },
    { tipo: 'centro', nome: 'Sagitário A*', p: GX.centro, cor: '#ffe9c0', diam: 0.0001, minPx: 4, k: 1.2 },
  ];
  GX.cena.add(pontosAlvo(GX.marcos.slice(0, 2)));
  rotulo('Sol', GX.sol, { prioridade: 100, ate: 3e3, classe: 'galaxia-sol', alvo: GX.marcos[0] });
  rotulo('Centro da Via Láctea', GX.centro, { prioridade: 60, de: 0.5, ate: 400, alvo: GX.marcos[1] });
  for (const b of meta.bracos) {
    const p = new THREE.Vector3(b.x, 0, b.z);
    rotulo(b.nome, p, { prioridade: 40, de: 6, ate: 160, classe: 'faixa', alvo: { tipo: 'braco', ...b, p } });
  }
  for (const a of AGLOMERADOS) {
    const kpc = (a.mpc ?? CO.distanciaComovel(a.z)) * 1000;
    const it = { tipo: 'aglomerado', ...a, distKpc: kpc, p: cena(a.ra, a.dec, kpc, new THREE.Vector3()), diam: 2000, minPx: 0 };
    GX.marcos.push(it);
    rotulo(a.nome, it.p, { prioridade: 50, de: 4000, ate: 2e6, classe: 'aglomerado', alvo: it });
  }
  GX.viaLactea = { tipo: 'galaxia-nossa', nome: 'Via Láctea', p: GX.centro };
  rotulo('Via Láctea', GX.centro, { prioridade: 90, de: 160, ate: 1.5e4, alvo: GX.viaLactea });
  // universo observável: esfera centrada em nós, com o raio comóvel até a radiação cósmica de fundo; vista de fora
  // ela é só um recurso visual (não existe "fora"), com a borda acesa na cor da radiação cósmica de fundo
  const R = RAIO_UNIVERSO * 1000;
  GX.universo = { tipo: 'universo', nome: 'Universo observável', p: GX.sol, distKpc: R };
  GX.esferaUniverso = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main() { float f = 1.0 - abs(dot(vN, vV)); gl_FragColor = vec4(vec3(1.0, 0.56, 0.32) * (0.04 + 0.9 * pow(f, 4.0)), 1.0); }',
  }));
  GX.esferaUniverso.position.copy(GX.sol);
  GX.esferaUniverso.visible = false;
  GX.cena.add(GX.esferaUniverso);
  rotulo('Universo observável', new THREE.Vector3(0, R, 0).add(GX.sol), { prioridade: 95, de: 1.6e7, ate: Infinity, alvo: GX.universo });
}

/** Galáxias do Grupo Local e vizinhas (McConnachie 2012): discos inclinados para as grandes, brilho difuso para as anãs. */
function montarGrupoLocal() {
  const { THREE } = GX;
  const lista = GX.dados?.grupoLocal || [];
  GX.locais = []; GX.objGrupoLocal = [];
  for (const g of lista) {
    const p = cena(g.ra, g.dec, g.distKpc, new THREE.Vector3());
    const raioKpc = Math.max(0.05, (g.raioKpc || (g.rhPc ? g.rhPc / 1000 * 2.5 : 0.3)));
    const it = { tipo: 'local', ...g, p, cor: g.disco ? '#ffe7c4' : '#e8dcc8', diam: raioKpc * 2, minPx: g.disco ? 4 : 3, k: g.disco ? 0.9 : 0.6 };
    GX.locais.push(it);
    if (g.disco) { const d = discoInclinado(g, p, raioKpc); GX.cena.add(d); GX.objGrupoLocal.push(d); }
    rotulo(g.nome, p, { classe: 'local', prioridade: g.disco ? 70 : 30 - Math.min(20, Math.max(0, (g.mv ?? -10) + 15)), ate: g.disco ? 2e4 : 6e3, alvo: it, perto: true });
  }
  if (GX.locais.length) { const pts = pontosAlvo(GX.locais); GX.cena.add(pts); GX.objGrupoLocal.push(pts); }
  // centro aproximado do Grupo Local: meio do caminho entre a Via Láctea e Andrômeda (as duas têm massas parecidas)
  const m31 = GX.locais.find((g) => g.catalogo === 'Andromeda');
  GX.centroGrupoLocal = m31 ? new THREE.Vector3().addVectors(GX.centro, m31.p).multiplyScalar(0.5) : GX.centro.clone();
  GX.grupoLocal = { tipo: 'grupo-local', nome: 'Grupo Local', p: GX.centroGrupoLocal };
  rotulo('Grupo Local', GX.centroGrupoLocal, { classe: 'local estrutura', prioridade: 85, de: 1200, ate: 2.5e4, alvo: GX.grupoLocal });
}

/** Disco de uma galáxia grande do Grupo Local, com inclinação e ângulo de posição medidos. */
function discoInclinado(g, p, raioKpc) {
  const { THREE } = GX;
  const tex = new THREE.CanvasTexture(texturaGalaxia(g.disco));
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(raioKpc * 2, raioKpc * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  // base no céu do ponto: linha de visada n, leste e, norte nn (equatorial → cena)
  const a = g.ra * RAD, d = g.dec * RAD;
  const vetor = (x, y, z) => { const e = [x, y, z]; const gg = EQ_GAL.map((l) => l[0] * e[0] + l[1] * e[1] + l[2] * e[2]); return new THREE.Vector3(gg[1], gg[2], gg[0]); };
  const n = vetor(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  const leste = vetor(-Math.sin(a), Math.cos(a), 0), norte = vetor(-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d));
  const pa = (g.pa ?? 0) * RAD, inc = (g.inclinacao ?? 0) * RAD;
  const maior = norte.clone().multiplyScalar(Math.cos(pa)).addScaledVector(leste, Math.sin(pa)).normalize();
  const menorCeu = norte.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(leste, Math.cos(pa)).normalize();
  const normal = n.clone().multiplyScalar(-Math.cos(inc)).addScaledVector(menorCeu, Math.sin(inc)).normalize();
  const terceiro = new THREE.Vector3().crossVectors(normal, maior).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(maior, terceiro, normal));
  m.position.copy(p);
  m.renderOrder = 3;
  return m;
}

/** Textura procedural de uma galáxia (espiral, irregular com barra ou irregular), com semente fixa por nome. */
function texturaGalaxia(tipo) {
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
  let s = [...tipo].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ruido = new Float32Array(64 * 64).map(rnd);
  const rr = (x, y) => { const i = Math.floor(x) & 63, j = Math.floor(y) & 63, fx = x - Math.floor(x), fy = y - Math.floor(y), a = ruido[j * 64 + i], b = ruido[j * 64 + ((i + 1) & 63)], c = ruido[((j + 1) & 63) * 64 + i], d = ruido[((j + 1) & 63) * 64 + ((i + 1) & 63)]; return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, r = Math.hypot(x, y), t = Math.atan2(y, x);
    if (r >= 1) continue;
    const n1 = rr(x * 9 + 20, y * 9 + 20), n2 = rr(x * 23 + 5, y * 23 + 5);
    let velho = 0, jovem = 0;
    if (tipo === 'espiral' || tipo === 'espiral-aberta') {
      const aberta = tipo === 'espiral-aberta';
      velho = Math.exp(-r / (aberta ? 0.28 : 0.22)) * 0.9 + Math.exp(-((r / (aberta ? 0.06 : 0.1)) ** 2)) * (aberta ? 0.8 : 2.2);
      const braco = Math.cos(2 * (t - Math.log(r + 0.02) / Math.tan((aberta ? 26 : 12) * RAD)));
      const anel = tipo === 'espiral' ? Math.exp(-(((r - 0.55) / 0.07) ** 2)) * 0.9 : 0;
      jovem = (Math.max(0, braco) ** 3 * (aberta ? 1.2 : 0.6) + anel) * Math.exp(-r / 0.6) * Math.max(0, 1.6 * n1 - 0.3) * (r > 0.12 ? 1 : r / 0.12);
    } else if (tipo === 'barrada') {
      const bx = x * Math.cos(0.35) + y * Math.sin(0.35), by = -x * Math.sin(0.35) + y * Math.cos(0.35);
      velho = Math.exp(-r / 0.32) * 0.7 + Math.exp(-((bx / 0.45) ** 2) - ((by / 0.12) ** 2)) * 1.4;
      jovem = Math.exp(-(((x - 0.15) / 0.5) ** 2) - (((y + 0.2) / 0.3) ** 2)) * Math.max(0, 1.8 * n1 - 0.6) * 1.3 + Math.exp(-((Math.hypot(x + 0.25, y - 0.2) / 0.08) ** 2)) * 1.5;
    } else {
      velho = Math.exp(-((x / 0.55) ** 2) - ((y / 0.3) ** 2)) * 0.9;
      jovem = velho * Math.max(0, 1.8 * n1 - 0.5) * 1.1;
    }
    const borda = Math.min(1, (1 - r) / 0.25);
    const R = (velho * 1.0 + jovem * 0.62 + n2 * 0.04 * velho) * borda, Gc = (velho * 0.82 + jovem * 0.75) * borda, B = (velho * 0.6 + jovem * 1.0) * borda;
    const k = (j * N + i) * 4, tone = (v) => Math.round(255 * (1 - Math.exp(-1.4 * v)));
    img.data[k] = tone(R); img.data[k + 1] = tone(Gc); img.data[k + 2] = tone(B); img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Separação angular (graus) entre duas direções J2000, pela fórmula de haversine. */
function separacao(ra1, dec1, ra2, dec2) {
  const s1 = Math.sin((dec2 - dec1) * RAD / 2), s2 = Math.sin((ra2 - ra1) * RAD / 2);
  return 2 * Math.asin(Math.min(1, Math.sqrt(s1 * s1 + Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * s2 * s2))) / RAD;
}

/** Busca rápida por direção: baldes de 1° de declinação. */
function indiceDirecao(lista) {
  const baldes = new Map();
  for (const it of lista) { const k = Math.floor(it.dec); if (!baldes.has(k)) baldes.set(k, []); baldes.get(k).push(it); }
  return (ra, dec, raio) => {
    let melhor = null, dm = raio;
    for (let k = Math.floor(dec - raio); k <= Math.floor(dec + raio); k++) for (const it of baldes.get(k) || []) { const d = separacao(ra, dec, it.ra, it.dec); if (d < dm) { dm = d; melhor = it; } }
    return melhor;
  };
}

/** Nome do catálogo de Karachentsev em forma legível: "MESSIER081" → "M81", "NGC4594" → "NGC 4594". */
function nomeUngc(n) {
  return n.replace(/^MESSIER0*(\d+)/, 'M$1').replace(/^(NGC|IC|UGC|ESO|PGC|DDO|KK|KKH|KKs|LV|AGC|HIPASS|UGCA|KDG|BTS|SDSS|FM|HS|CGCG|MCG|VCC)\s*0*(\d)/, '$1 $2').trim();
}

/**
 * Galáxias além do Grupo Local: as do NGC/IC (OpenNGC) e as do Volume Local (Karachentsev et al. 2013). Quando a mesma
 * galáxia está nos dois, vale a distância medida do Volume Local e o nome e a ficha do NGC/IC. Diâmetro real pelo
 * tamanho aparente × distância (NGC/IC) ou pelo diâmetro linear medido (Volume Local, isofota de 26 mag/arcsec²).
 */
function montarGalaxiasNgc() {
  const { THREE, G } = GX;
  const objetos = G.estrelas?.objetos || [];
  const grupo = GX.dados?.grupoLocal || [];
  const locais = new Set(grupo.map((g) => g.ngc).filter(Boolean));
  const doGrupoLocal = indiceDirecao(grupo);
  const ungc = UNI.volumeLocal().filter((u) => !(u.d < 3.2 && doGrupoLocal(u.ra, u.dec, 0.4))); // as do Grupo Local já estão lá
  const daUngc = indiceDirecao(ungc), usadas = new Set();
  GX.ngc = [];
  for (const ob of objetos) {
    if (!/^(s|l|e|i|gg)$/.test(ob.tipo) || locais.has(ob.designacao)) continue;
    const u = daUngc(ob.ra, ob.dec, 0.08);
    if (u) usadas.add(u);
    const dKpc = u ? u.d * 1000 : ob.distAnosLuz / AL_POR_KPC;
    if (!(dKpc > 450)) continue;
    const tam = Math.max(...String(ob.dim || '0.5').split('x').map(Number).filter(Number.isFinite), 0.3); // minutos de arco
    const diam = u?.diam || Math.max(0.5, dKpc * tam / 60 * RAD);
    GX.ngc.push({ tipo: 'ngc', ob, u, p: cena(ob.ra, ob.dec, dKpc, new THREE.Vector3()), cor: TIPOS_OBJETO[ob.tipo]?.[1] || '#d8dce8', diam, minPx: ob.nome ? 3 : 2.2, k: ob.nome ? 1 : 0.75 });
  }
  GX.volume = [];
  for (const u of ungc) {
    if (usadas.has(u)) continue;
    const espiral = u.tt != null && u.tt >= 1 && u.tt <= 9;
    GX.volume.push({ tipo: 'ungc', u, nome: nomeUngc(u.n), p: cena(u.ra, u.dec, u.d * 1000, new THREE.Vector3()), cor: espiral ? '#cfdcf5' : u.tt != null && u.tt < 0 ? '#ffe3c0' : '#d9d4e6',
      diam: Math.max(0.3, u.diam || 1), minPx: (u.lk || 7) > 9.5 ? 2.6 : 1.8, k: Math.max(0.4, Math.min(1, ((u.lk || 7) - 6.5) / 3.5)) });
  }
  GX.pontosNgc = pontosAlvo([...GX.ngc, ...GX.volume]);
  GX.cena.add(GX.pontosNgc);
  GX.objGalaxias = [GX.pontosNgc];
  for (const it of GX.ngc) if (it.ob.nome) rotulo(it.ob.nome, it.p, { classe: 'ngc', prioridade: 20, ate: it.p.length() * 4, alvo: it, perto: true });
  // Volume Local: nomes das galáxias mais luminosas (luminosidade na banda K, que acompanha a massa de estrelas)
  for (const it of [...GX.volume].filter((v) => (v.u.lk || 0) >= 9.6).sort((a, b) => (b.u.lk || 0) - (a.u.lk || 0)).slice(0, CELULAR ? 14 : 30)) rotulo(it.nome, it.p, { classe: 'ungc', prioridade: 18, ate: 6e4, alvo: it, perto: true });
}

/** Masers com paralaxe (Reid et al. 2019) e aglomerados globulares (Baumgardt & Vasiliev 2021). */
function montarCatalogos() {
  const { THREE } = GX;
  GX.masers = (GX.dados?.masers || []).map((m) => ({ tipo: 'maser', ...m, p: cena(m.ra, m.dec, m.distKpc, new THREE.Vector3()), cor: '#ff7a9a', diam: 0.04, minPx: 3, k: 1 }));
  GX.globulares = (GX.dados?.globulares || []).map((a) => ({ tipo: 'globular', ...a, p: cena(a.ra, a.dec, a.distKpc, new THREE.Vector3()), cor: '#ffe3a0', diam: 0.03, minPx: 2.6, k: 0.9 }));
  GX.grupoMasers = GX.masers.length ? pontosAlvo(GX.masers) : null;
  GX.grupoGlobulares = GX.globulares.length ? pontosAlvo(GX.globulares) : null;
  for (const o of [GX.grupoMasers, GX.grupoGlobulares]) if (o) GX.cena.add(o);
}

/** Estrelas do céu (HYG e Gaia DR3) em volta do Sol, na distância medida: a "bolha" que conhecemos de perto. */
async function montarEstrelasReais() {
  if (GX.estrelasReais || GX.montandoEstrelas) return;
  GX.montandoEstrelas = true;
  const { THREE, G } = GX;
  const P = await G.estrelas?.prontoProfundo?.then(() => G.estrelas.profundas).catch(() => null);
  if (!P) { GX.montandoEstrelas = false; return; }
  const pos = new Float32Array(P.n * 3), cor = new Float32Array(P.n * 3), v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < P.n; i++) {
    if (i % 40000 === 39999) await pausa();
    if (!(P.dpc[i] > 0)) continue;
    cena(P.ra[i], P.dec[i], P.dpc[i] / 1000, v);
    pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    const c = corBV(P.bv[i]), b = Math.min(0.6, 0.012 + 0.12 * Math.pow(10, -0.4 * P.mabs[i])); // as mais luminosas se destacam
    cor[k * 3] = c[0] * b; cor[k * 3 + 1] = c[1] * b; cor[k * 3 + 2] = c[2] * b;
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3)); g.setAttribute('cor', new THREE.BufferAttribute(cor.subarray(0, k * 3), 3));
  GX.estrelasReais = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: GX.uniformes, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute vec3 cor; uniform float pr, perto; varying vec3 vCor; void main() { vCor = cor * perto; gl_PointSize = 1.3 * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`varying vec3 vCor; void main() { vec2 p = gl_PointCoord - 0.5; if (dot(p, p) > 0.25) discard; gl_FragColor = vec4(vCor, 1.0); }` }));
  GX.estrelasReais.frustumCulled = false; GX.estrelasReais.renderOrder = 5;
  GX.nEstrelasReais = k;
  GX.cena.add(GX.estrelasReais);
  aplicarCamadas();
}

// ------------------------------------------------------------------ interface

/** Controles próprios desta escala: barra de escala e "Salvar imagem" (a navegação fica na régua de escalas). */
function montarInterface() {
  const G = GX.G;
  const salvar = el('button', { type: 'button', class: 'globo-salvar', text: 'Salvar imagem', onclick: () => salvarImagem() });
  const escala = el('div', { class: 'globo-escala', 'aria-hidden': 'true' }, el('span', { class: 'globo-escala-barra' }), el('span', { class: 'globo-escala-texto' }));
  const raiz = el('div', { class: 'globo-galaxia-controles globo-recolhivel', hidden: true }, escala, el('div', { class: 'globo-sistema-topo' }, salvar));
  G.dom.raiz.append(raiz);
  GX.dom = { raiz, salvar, escala, escalaBarra: escala.firstChild, escalaTexto: escala.lastChild };
}

/** Seções do painel de camadas (js/globo-camadas.js) desta escala, com as contagens dos catálogos. */
export function secoesCamadas() {
  const n = UNI.contagens();
  const detalhe = { teia: n.galaxias ? `${num(n.galaxias)} galáxias` : null, quasares: n.quasares ? `${num(n.quasares)} quasares` : null, aglomerados: n.aglomerados ? `${num(n.aglomerados)} aglomerados` : null,
    superaglomerados: n.super ? `${num(n.super)} superaglomerados` : null, vazios: n.vazios ? `${num(n.vazios)} vazios do SDSS` : null, galaxias: `${num((GX.ngc?.length || 0) + (GX.volume?.length || 0))} galáxias` };
  return CAMADAS_UNIVERSO.map((g) => ({ titulo: g.grupo, itens: g.itens.map(([chave, texto]) => ({ tipo: 'caixa', texto, detalhe: detalhe[chave] || null, valor: FG[chave], mudar: (v) => definirCamada(chave, v) })) }));
}

/** Abre a escala de galáxias saindo do Sol: a câmera começa colada nele e se afasta até ver a Galáxia inteira. */
export async function abrirGalaxia() {
  await GX.preparo;
  const { G } = GX;
  GX.aberto = true;
  GX.dom.raiz.hidden = false;
  GX.foco.copy(GX.sol);
  G.cam.dist = 0.004; G.cam.lat = 20; G.cam.lon = 180; G.cam.vLat = G.cam.vLon = 0;
  irPara(GX.centro, DIST.inicial, 55, MOVIMENTO_REDUZIDO ? 1 : 4200);
  montarEstrelasReais();
}

export function fecharGalaxia() {
  GX.aberto = false; GX.anim = null;
  if (GX.dom) GX.dom.raiz.hidden = true;
  for (const r of GX.rotulos) r.el.hidden = true;
}

/** Viagem suave até um ponto: foco e distância em escala logarítmica, latitude da câmera junto. */
function irPara(p, dist, lat = null, ms = 2200) {
  const { G } = GX;
  GX.anim = { de: GX.foco.clone(), para: p, dist0: G.cam.dist, dist1: dist, lat0: G.cam.lat, lat1: lat ?? G.cam.lat, t0: performance.now(), ms };
  G.cam.vLat = G.cam.vLon = 0;
}

/** Foco da câmera no Sol (para o zoom contínuo de volta ao sistema solar). */
export const focoNoSol = () => !!GX.foco && GX.foco.distanceTo(GX.sol) < 0.05;

export const limitesDistancia = () => [GX.focoMin ?? DIST.min, DIST.max];

/** Posiciona a câmera da galáxia a partir do estado de órbita do globo (lat, lon, dist em kpc em volta do foco). */
export function posicionar(cam) {
  const c = GX.camera, G = GX.G;
  const lat = cam.lat * RAD, lon = cam.lon * RAD;
  c.position.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(cam.dist).add(GX.foco);
  c.up.set(0, 1, 0);
  c.lookAt(GX.foco);
  const near = Math.max(1e-6, cam.dist * 0.001);
  if (c.aspect !== G.camera.aspect || Math.abs(c.near - near) > near * 0.25) { c.aspect = G.camera.aspect; c.near = near; c.far = Math.max(2e6, cam.dist * 10); c.updateProjectionMatrix(); }
}

const _v = { a: null, b: null };
/** A cada quadro: viagem, transição entre a imagem de frente e as partículas de lado, rótulos e escala. */
export function atualizarGalaxia(agora) {
  if (!GX.aberto) return;
  const { G, THREE } = GX;
  const a = GX.anim;
  if (a) {
    const t = Math.min(1, (agora - a.t0) / a.ms), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    GX.foco.lerpVectors(a.de, a.para, e);
    G.cam.dist = Math.exp(Math.log(a.dist0) + (Math.log(a.dist1) - Math.log(a.dist0)) * e);
    G.cam.lat = a.lat0 + (a.lat1 - a.lat0) * e;
    if (t >= 1) GX.anim = null;
  }
  posicionar(G.cam);
  _v.a ||= new THREE.Vector3(); _v.b ||= new THREE.Vector3();
  const olhar = GX.camera.getWorldDirection(_v.a);
  GX.uniformes.face.value = Math.min(1, Math.max(0, (Math.abs(olhar.y) - 0.12) / 0.5));
  GX.disco.material.opacity = Math.pow(GX.uniformes.face.value, 1.5);
  GX.disco.visible = FG.viaLactea;
  GX.esferaUniverso.visible = G.cam.dist > 2e6;
  GX.particulas.visible = GX.poeira.visible = FG.viaLactea && GX.uniformes.face.value < 0.97; // de frente, só a imagem (as partículas somariam ~0)
  UNI.atualizarUniverso(G.cam.dist, FG, GX.camera);
  // perto do Sol (até uns 3 kpc), as estrelas reais aparecem e o modelo se apaga um pouco
  const dSol = GX.camera.position.distanceTo(GX.sol);
  GX.uniformes.perto.value = Math.max(0, Math.min(1, (4 - dSol) / 3));
  GX.disco.material.color.setScalar(1 - 0.75 * GX.uniformes.perto.value);
  GX.uniformes.escalaPx.value = G.dom.canvas.clientHeight * G.pixelRatio / (2 * Math.tan(GX.camera.fov * RAD / 2));
  GX.uniformes.pr.value = G.pixelRatio;
  if (G.quadro % 2 === 0) posicionarRotulos();
  if (G.quadro % 10 === 0) atualizarEscala();
}

function projetar(p, rect) {
  const v = _v.b.copy(p).project(GX.camera);
  if (v.z > 1 || v.z < -1) return null;
  return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
}

function posicionarRotulos() {
  const G = GX.G, rect = G.dom.canvas.getBoundingClientRect();
  const cam = GX.camera.position, zoom = G.cam.dist;
  const itens = [];
  for (const r of GX.rotulos) {
    // marcos da Galáxia: pela faixa de zoom (distância da câmera ao foco); objetos pontuais: por estarem na região
    // vista (perto do foco ou da câmera), para que um objeto distante atrás do foco não ganhe nome por engano
    if (r.oculto || !FG.nomes || (r.camada && !FG[r.camada])) { r.el.hidden = true; continue; }
    const ok = r.perto ? zoom <= r.ate && (GX.foco.distanceTo(r.p) <= 1.5 * zoom || cam.distanceTo(r.p) <= 2.5 * zoom)
      : zoom >= r.de && zoom <= r.ate;
    const p = ok ? projetar(r.p, rect) : null;
    if (!p) { r.el.hidden = true; continue; }
    itens.push({ r, x: p.x, y: p.y + 14 });
  }
  itens.sort((a, b) => b.r.prioridade - a.r.prioridade);
  if (!GX.zonas || G.quadro % 15 === 0) GX.zonas = zonasDosControles(rect);
  const ocupados = [...GX.zonas];
  for (const it of itens) {
    const w = it.r.largura, h = 22, x0 = it.x - w / 2, y0 = it.y - h / 2;
    const fora = x0 < 0 || x0 + w > rect.width || it.y < 8 || it.y > rect.height - 8;
    const bate = ocupados.some((o) => x0 < o.x1 && x0 + w > o.x0 && y0 < o.y1 && y0 + h > o.y0);
    it.r.el.hidden = fora || bate;
    if (!it.r.el.hidden) { ocupados.push({ x0, y0, x1: x0 + w, y1: y0 + h }); it.r.el.style.transform = `translate(${x0.toFixed(0)}px, ${y0.toFixed(0)}px)`; }
  }
}

/** Retângulos dos botões visíveis (coordenadas do canvas): nenhum nome fica por baixo deles. */
function zonasDosControles(rect) {
  const raiz = GX.G.dom.raiz;
  if (raiz.classList.contains('imersivo')) return [];
  const out = [];
  for (const b of raiz.querySelectorAll('.globo-galaxia-controles button, .globo-galaxia-controles .globo-escala, .globo-botoes button')) {
    const r = b.getBoundingClientRect();
    if (r.width && r.height) out.push({ x0: r.left - rect.left - 4, y0: r.top - rect.top - 4, x1: r.right - rect.left + 4, y1: r.bottom - rect.top + 4 });
  }
  return out;
}

/** Barra de escala: o maior valor "redondo" (1, 2 ou 5 × 10^n anos-luz) que cabe em ~90 px no foco. */
function atualizarEscala() {
  const G = GX.G, h = G.dom.canvas.clientHeight;
  const kpcPorPx = 2 * G.cam.dist * Math.tan(GX.camera.fov * RAD / 2) / h;
  const alPorPx = kpcPorPx * AL_POR_KPC;
  const alvo = alPorPx * 90, pot = Math.pow(10, Math.floor(Math.log10(alvo)));
  const valor = [5, 2, 1].map((m) => m * pot).find((v) => v <= alvo) || pot;
  GX.dom.escalaBarra.style.width = `${Math.round(valor / alPorPx)}px`;
  GX.dom.escalaTexto.textContent = textoAnosLuz(valor);
  GX.escalaAtual = { valor, px: valor / alPorPx };
}

function textoAnosLuz(al) {
  if (al >= 1e9) return `${num(al / 1e9, al < 1e10 ? 1 : 0)} bilhões de anos-luz`.replace(/^1 bilhões/, '1 bilhão');
  if (al >= 1e6) return `${num(al / 1e6, al < 1e7 && al % 1e6 ? 1 : 0)} milhões de anos-luz`.replace(/^1 milhões/, '1 milhão');
  if (al >= 1e3) return `${num(al / 1e3, 0)} mil anos-luz`;
  return `${num(al, 0)} anos-luz`;
}
const kpcTexto = (kpc) => textoAnosLuz(kpc * AL_POR_KPC).replace(/^(\d)/, '$1');

// ------------------------------------------------------------------ toques e cartões

function candidatos() {
  const zoom = GX.G.cam.dist;
  return [...GX.marcos, ...(FG.grupoLocal ? GX.locais : []), ...(FG.masers ? GX.masers : []), ...(FG.globulares ? GX.globulares : []),
    ...(FG.galaxias ? [...GX.ngc, ...GX.volume] : []), ...UNI.candidatos(FG, zoom)];
}

/** Objeto sob o dedo: o mais próximo na tela dentro de 24 px ou do tamanho desenhado. */
function alvoSob(cx, cy) {
  const rect = GX.G.dom.canvas.getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top;
  posicionar(GX.G.cam); GX.camera.updateMatrixWorld();
  let melhor = null, dMelhor = Infinity;
  for (const it of candidatos()) {
    const p = projetar(it.p, rect); if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    const raioPx = it.diam / 2 * GX.uniformes.escalaPx.value / GX.G.pixelRatio / Math.max(1e-9, GX.camera.position.distanceTo(it.p));
    const lim = Math.max((it.tipo === 'ngc' && !it.ob.nome) || it.tipo === 'ungc' || it.tipo === 'mcxc' ? 14 : 24, Math.min(raioPx, it.tipo === 'super' ? 60 : 160));
    if (d <= lim && d < dMelhor) { melhor = it; dMelhor = d; }
  }
  if (melhor) return melhor;
  // rótulos de braço também são tocáveis
  for (const r of GX.rotulos) {
    if (r.el.hidden || !r.alvo || r.alvo.tipo !== 'braco') continue;
    const b = r.el.getBoundingClientRect();
    if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return r.alvo;
  }
  return null;
}

export function tocarGalaxia(cx, cy) {
  const it = alvoSob(cx, cy);
  if (!it) { GX.G.fecharPainel(); return true; }
  mostrarCartao(it);
  return true;
}

export function focarNoToque(cx, cy) {
  const it = alvoSob(cx, cy);
  if (it) irAte(it);
}

function irAte(it) {
  const raio = it.tipo === 'galaxia-nossa' ? 20 : it.tipo === 'braco' ? 3 : (it.diam || 1) / 2;
  if (it.tipo === 'universo') { irPara(GX.sol, it.distKpc * 2.6, null, 3000); return; }
  if (it.tipo === 'grupo-local') { irEscala('grupo-local'); return; }
  const dist = it.tipo === 'aglomerado' ? 9000 : it.tipo === 'sol' ? 0.6 : it.tipo === 'centro' ? 1.2 : it.tipo === 'mcxc' ? Math.max(6000, raio * 8)
    : it.tipo === 'super' ? raio * 3.5 : it.tipo === 'notavel' ? Math.max(4000, raio * 4) : Math.max(0.05, raio * 3.2);
  // viagens longas (bilhões de anos-luz) demoram um pouco mais, para a escala ser percebida
  const ms = 2600 + Math.min(2400, Math.abs(Math.log10(Math.max(1, it.p.distanceTo(GX.foco)) / Math.max(1, GX.G.cam.dist))) * 500);
  irPara(it.p, dist, null, MOVIMENTO_REDUZIDO ? 1 : ms);
}

function mostrarCartao(it) {
  const G = GX.G;
  const ir = (texto = 'Ir até') => ({ texto, onclick: () => { irAte(it); G.fecharPainel(); } });
  if (UNI.cartao(it, G, ir)) return;
  const dSol = it.p.distanceTo(GX.sol);
  const R0 = GX.meta.R0;
  if (it.tipo === 'sol') {
    G.mostrarPainel('Sol', `Nossa estrela, a ${kpcTexto(R0)} do centro da Via Láctea.`, `Dá uma volta na Galáxia a cada ~210 milhões de anos, a 236 km/s · ${num(GX.meta.zSol * 1000, 0)} pc acima do plano`,
      'Reid et al. 2019 · Bennett & Bovy 2019', [ir()]);
  } else if (it.tipo === 'centro') {
    G.mostrarPainel('Sagitário A*', `O buraco negro no centro da Via Láctea, com 4,3 milhões de vezes a massa do Sol, a ${kpcTexto(R0)} daqui.`,
      `Em volta, a barra de estrelas tem ${num(GX.meta.barra.semieixo * 2 * AL_POR_KPC / 1000, 0)} mil anos-luz de ponta a ponta`,
      'GRAVITY Collaboration 2022 · Wegg et al. 2015', [ir()]);
  } else if (it.tipo === 'galaxia-nossa') {
    G.mostrarPainel('Via Láctea', 'Nossa galáxia: uma espiral barrada com uns 100 mil anos-luz de diâmetro e de 100 a 400 bilhões de estrelas.',
      'Ninguém a viu de fora: esta imagem é um modelo calculado a partir dos braços medidos por paralaxe de masers, da barra e do disco.',
      'Modelo: Reid et al. 2019 · Wegg et al. 2015 · Bland-Hawthorn & Gerhard 2016', [ir('Aproximar')]);
  } else if (it.tipo === 'braco') {
    const medido = it.medido ? `medido por paralaxe de ${it.medido[0]}° a ${it.medido[1]}° de azimute; o resto é extrapolado pela mesma espiral` : 'trecho extrapolado';
    G.mostrarPainel(it.nome, `Braço espiral da Via Láctea, ${medido}.`, `Inclinação de ${num(Math.abs(it.psi[0]), 1)}° a ${num(Math.abs(it.psi[1]), 1)}° · largura de ${num(it.largura * AL_POR_KPC, 0)} anos-luz`,
      'Reid et al. 2019', [ir()]);
  } else if (it.tipo === 'local') {
    G.mostrarPainel(it.nome, `${it.descricao || 'Galáxia do Grupo Local'} a ${kpcTexto(it.distKpc)} do Sol.`,
      [it.mv != null ? `Magnitude absoluta ${num(it.mv, 1)}` : null, it.raioKpc ? `${num(it.raioKpc * 2 * AL_POR_KPC / 1000, 0)} mil anos-luz de diâmetro` : null].filter(Boolean).join(' · '),
      it.fonte || 'McConnachie 2012', [ir()]);
  } else if (it.tipo === 'universo') {
    const borda = num(CO.HORIZONTE_MPC * CO.AL_POR_MPC / 1e9, 1), idade = num(CO.IDADE, 2);
    G.mostrarPainel('Universo observável', `Tudo de onde a luz já teve tempo de chegar até nós desde o Big Bang, há ${idade} bilhões de anos. Por causa da expansão, a borda hoje está a ${borda} bilhões de anos-luz.`,
      `A luz mais antiga que vemos é a radiação cósmica de fundo, numa casca a ${num(CO.DIST_CMB_MPC * CO.AL_POR_MPC / 1e9, 1)} bilhões de anos-luz · o universo inteiro pode ser muito maior (ou infinito) · visto “de fora” só como ilustração`,
      'Planck Collaboration 2020 (ΛCDM: H0 = 67,66 km/s/Mpc, Ωm = 0,311)', []);
  } else if (it.tipo === 'grupo-local') {
    G.mostrarPainel('Grupo Local', 'Nosso grupo de galáxias: a Via Láctea e Andrômeda, as duas maiores, mais a do Triângulo e umas 100 galáxias anãs, num espaço de ~10 milhões de anos-luz.',
      `Andrômeda está a ${kpcTexto(GX.locais.find((g) => g.catalogo === 'Andromeda')?.distKpc || 765)} e vem na nossa direção a ~110 km/s; as duas devem se fundir daqui a uns 4 a 5 bilhões de anos`,
      'McConnachie 2012 · van der Marel et al. 2012', [ir('Aproximar')]);
  } else if (it.tipo === 'ungc') {
    const u = it.u, metodo = METODOS[u.m] || (u.m ? `método ${u.m}` : 'método não informado');
    G.mostrarPainel(it.nome, `${tipoUngc(u.tt)} a ${kpcTexto(u.d * 1000)}, distância medida por ${metodo}.`,
      [u.diam ? `${num(u.diam * AL_POR_KPC / 1000, 0)} mil anos-luz de diâmetro` : null, u.MB != null ? `magnitude absoluta ${num(u.MB, 1)} (azul)` : null, u.lk ? `luz de ~${num(10 ** u.lk / 1e9, u.lk < 9 ? 2 : 0)} bilhões de sóis no infravermelho` : null, u.hi ? `${num(10 ** u.hi / 1e6, 0)} milhões de massas solares de hidrogênio` : null].filter(Boolean).join(' · '),
      'Volume Local: Karachentsev, Makarov & Kaisina 2013', [ir()]);
  } else if (it.tipo === 'aglomerado') {
    G.mostrarPainel(it.nome, `Aglomerado de galáxias${it.n ? ` (${it.n})` : ''} a ${kpcTexto(it.distKpc)}.`,
      it.mpc ? 'Distância medida' : `Distância pelo desvio para o vermelho (z = ${num(it.z, 4)}, H0 = 70 km/s/Mpc)`, it.fonte, [ir()]);
  } else if (it.tipo === 'maser') {
    G.mostrarPainel(it.nome, `Região de formação de estrelas no ${it.braco || 'disco'}, a ${kpcTexto(it.distKpc)} do Sol, medida por paralaxe.`,
      `Paralaxe de ${num(it.paralaxe, 3)} ± ${num(it.erro, 3)} milissegundos de arco`, 'Reid et al. 2019 (VLBA, VERA, EVN)', [ir()]);
  } else if (it.tipo === 'globular') {
    G.mostrarPainel(it.nome, `Aglomerado globular, uma bola com centenas de milhares de estrelas antigas, a ${kpcTexto(it.distKpc)} do Sol.`,
      `A ${kpcTexto(it.p.length())} do centro da Galáxia`, 'Baumgardt & Vasiliev 2021', [ir()]);
  } else if (it.tipo === 'ngc') {
    const c = cartaoObjeto(it.ob, G.estadoApp);
    const como = it.u ? `, medida por ${METODOS[it.u.m] || 'métodos diretos'}` : it.ob.distFonte === 'z' ? ' (pelo desvio para o vermelho)' : '';
    G.mostrarPainel(c.titulo, `${TIPOS_OBJETO[it.ob.tipo]?.[0] || 'Galáxia'} a ${kpcTexto(dSol)}${como}.`,
      `Cerca de ${num(it.diam * AL_POR_KPC / 1000, 0)} mil anos-luz de diâmetro`, it.u ? `${c.fonte.split(' · ')[0]} · distância: Karachentsev et al. 2013` : c.fonte.split(' · ')[0], [ir(), { texto: 'Ver detalhes', onclick: c.detalhes }].filter((x) => x.onclick));
  }
}

/** Métodos de distância do catálogo de Karachentsev et al. 2013 (coluna f_Dist). */
const METODOS = {
  Cep: 'cefeidas', TRGB: 'ponta do ramo das gigantes vermelhas', SBF: 'flutuações do brilho superficial', TF: 'Tully-Fisher (rotação do disco)',
  SN: 'supernova', mem: 'pertença a um grupo de distância medida', h: 'lei de Hubble (desvio para o vermelho)', RRL: 'estrelas RR Lyrae', BS: 'estrelas mais brilhantes',
  FP: 'plano fundamental', PNLF: 'nebulosas planetárias', GCLF: 'aglomerados globulares', txt: 'estimativa da literatura',
};
/** Tipo morfológico de de Vaucouleurs (T) em português. */
function tipoUngc(t) {
  if (t == null) return 'Galáxia';
  if (t <= -4) return 'Galáxia elíptica';
  if (t <= 0) return 'Galáxia lenticular';
  if (t <= 8) return 'Galáxia espiral';
  return 'Galáxia irregular';
}

// ------------------------------------------------------------------ escalas (atalhos do zoom contínuo)

/**
 * Escalas desta cena, do Sol até a borda do universo observável: foco, distância da câmera (kpc) e uma linha sobre o
 * que se vê. A escala atual é a de distância mais próxima (em log) da câmera; ir até uma é só uma viagem da câmera.
 */
export const ESCALAS = [
  { id: 'vizinhanca', nome: 'Vizinhança do Sol', texto: 'estrelas a até milhares de anos-luz', foco: () => GX.sol, dist: 0.6 },
  { id: 'via-lactea', nome: 'Via Láctea', texto: 'nossa galáxia vista de fora', foco: () => GX.centro, dist: DIST.inicial, lat: 55 },
  { id: 'grupo-local', nome: 'Grupo Local', texto: 'Andrômeda, Triângulo e ~100 galáxias anãs', foco: () => GX.centroGrupoLocal, dist: 2600, lat: 30 },
  { id: 'volume-local', nome: 'Volume Local', texto: 'galáxias até ~35 milhões de anos-luz, com distância medida', foco: () => GX.sol, dist: 22000, lat: 25 },
  { id: 'laniakea', nome: 'Laniakea', texto: 'nosso superaglomerado e o Grande Atrator', foco: () => GX.sol, dist: 2.2e5, lat: 20 },
  { id: 'teia', nome: 'Teia cósmica', texto: 'filamentos, paredes e vazios até ~1 bilhão de anos-luz', foco: () => GX.sol, dist: 1.1e6, lat: 25 },
  { id: 'profundo', nome: 'Universo profundo', texto: 'quasares e as galáxias mais distantes', foco: () => GX.sol, dist: 7e6, lat: 25 },
  { id: 'observavel', nome: 'Universo observável', texto: 'a radiação cósmica de fundo e a borda do que se pode ver', foco: () => GX.sol, dist: 4.2e7, lat: 20 },
];

/** Escala mais próxima da vista atual (pela distância da câmera, em escala logarítmica). */
export function escalaAtual() {
  if (!GX.aberto) return null;
  const lz = Math.log10(GX.G.cam.dist);
  return ESCALAS.reduce((m, e) => (Math.abs(Math.log10(e.dist) - lz) < Math.abs(Math.log10(m.dist) - lz) ? e : m), ESCALAS[0]);
}

/** Viagem até uma escala desta cena. */
export function irEscala(id, ms = 3200) {
  const e = ESCALAS.find((x) => x.id === id); if (!e) return false;
  GX.G.fecharPainel?.();
  irPara(e.foco(), e.dist, e.lat ?? null, MOVIMENTO_REDUZIDO ? 1 : ms);
  return true;
}

// ------------------------------------------------------------------ imagem em alta resolução

/**
 * Renderiza a vista atual em alta resolução (lado maior de até 4.096 px, ou o máximo da GPU) com os nomes, a barra de
 * escala e a fonte, e entrega um PNG (folha de compartilhar no celular, download no computador).
 */
export async function salvarImagem() {
  const { G } = GX;
  const botao = GX.dom.salvar; botao.disabled = true; const textoAntes = botao.textContent; botao.textContent = 'Gerando…';
  try {
    if (CELULAR && !GX.texAlta) { // no celular a imagem de 4096 px só é baixada para salvar
      const img = await carregarImagem('via-lactea-4096.jpg').catch(() => null);
      if (img) { // textura nova (a antiga tem outro tamanho); a de 2048 px é descartada
        const t = GX.texDisco.clone(); t.image = img; t.needsUpdate = true;
        GX.disco.material.map = t; GX.disco.material.needsUpdate = true; GX.texDisco.dispose(); GX.texDisco = t; GX.texAlta = true;
      }
    }
    const r = G.renderer, cv = r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr0 = r.getPixelRatio();
    const gl = r.getContext();
    const maxGpu = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
    const lado = Math.min(4096, maxGpu), pr = lado / Math.max(w, h);
    r.setPixelRatio(pr); r.setSize(w, h, false);
    const prAntes = G.pixelRatio; G.pixelRatio = pr;
    atualizarGalaxia(performance.now());
    r.render(GX.cena, GX.camera);
    const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(cv, 0, 0);
    G.pixelRatio = prAntes; r.setPixelRatio(pr0); r.setSize(w, h, false);
    desenharSobreposicao(ctx, pr);
    const blob = await new Promise((ok) => out.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('o navegador não gerou a imagem');
    const nome = `via-lactea-${new Date().toISOString().slice(0, 10)}.png`;
    const arquivo = new File([blob], nome, { type: 'image/png' });
    if (CELULAR && navigator.canShare?.({ files: [arquivo] })) await navigator.share({ files: [arquivo], title: 'Via Láctea' }).catch(() => {});
    else { const a = el('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
    GX.ultimaImagem = { largura: out.width, altura: out.height, bytes: blob.size };
  } catch (e) {
    G.mostrarAviso?.(`Não foi possível salvar a imagem (${e.message}).`, false);
  } finally {
    botao.disabled = false; botao.textContent = textoAntes;
  }
}

/** Nomes visíveis, barra de escala e créditos desenhados por cima da imagem, na mesma posição da tela. */
function desenharSobreposicao(ctx, pr) {
  const rect = GX.G.dom.canvas.getBoundingClientRect();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (const r of GX.rotulos) {
    if (r.el.hidden) continue;
    const b = r.el.getBoundingClientRect(), cs = getComputedStyle(r.el);
    const x = (b.left - rect.left) * pr, y = (b.top - rect.top) * pr, w = b.width * pr, h = b.height * pr;
    ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * pr}px system-ui, -apple-system, sans-serif`;
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { ctx.fillStyle = cs.backgroundColor; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill(); }
    ctx.fillStyle = cs.color; ctx.fillText(r.el.textContent, x + w / 2, y + h / 2);
  }
  const e = GX.escalaAtual;
  const H = ctx.canvas.height, m = 16 * pr;
  ctx.textAlign = 'left';
  // créditos quebrados em linhas que cabem na largura, embaixo; a barra de escala fica acima deles
  ctx.font = `${10 * pr}px system-ui, -apple-system, sans-serif`;
  const largura = ctx.canvas.width - 2 * m, linhas = [];
  for (const parte of ['Via Láctea: modelo de Reid et al. 2019, Wegg et al. 2015 e Bland-Hawthorn & Gerhard 2016', 'Estrelas: HYG e Gaia DR3 (ESA/Gaia/DPAC) · masers: Reid et al. 2019 · aglomerados globulares: Baumgardt & Vasiliev 2021', 'Grupo Local: McConnachie 2012 · galáxias: OpenNGC e Karachentsev et al. 2013', ...(GX.G.cam.dist > 3000 ? [UNI.notasFontes().join(' · ')] : []), `Painel Meteo · ${new Date().toLocaleDateString('pt-BR')}`]) {
    let atual = '';
    for (const palavra of parte.split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (ctx.measureText(tentativa).width > largura && atual) { linhas.push(atual); atual = palavra; } else atual = tentativa;
    }
    linhas.push(atual);
  }
  ctx.fillStyle = 'rgba(200,210,224,.75)';
  linhas.reverse().forEach((l, i) => ctx.fillText(l, m, H - m - i * 13 * pr));
  const topo = H - m - (linhas.length - 1) * 13 * pr - 16 * pr;
  if (e) {
    ctx.fillStyle = 'rgba(230,236,244,.9)'; ctx.fillRect(m, topo, e.px * pr, 2 * pr);
    ctx.font = `600 ${12 * pr}px system-ui, -apple-system, sans-serif`; ctx.fillText(textoAnosLuz(e.valor), m, topo - 12 * pr);
  }
}

export function notasFontes() {
  return ['Via Láctea: modelo (Reid et al. 2019, Wegg et al. 2015, Bland-Hawthorn & Gerhard 2016)', 'Masers: Reid et al. 2019', 'Grupo Local: McConnachie 2012', 'Aglomerados globulares: Baumgardt & Vasiliev 2021', 'Galáxias: OpenNGC', ...UNI.notasFontes()];
}

export const estado = () => GX;
