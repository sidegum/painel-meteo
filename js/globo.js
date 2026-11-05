// Aba Globo: Terra em 3D com o tempo do mundo todo. Carregada só quando a aba abre (import dinâmico em app.js).
//
// Por que Three.js: o globo precisa de sombreamento próprio (terminador dia/noite calculado pelo Sol, luzes das cidades,
// reflexo do Sol no mar, atmosfera na borda, nuvens de satélite e campos do GFS por cima), o que exige shaders
// próprios. Three.js dá isso com 190 KB comprimidos, roda no WebGL do iPhone e é só um arquivo no vendor/.
// CesiumJS pesaria dezenas de MB; globe.gl esconde os shaders e a câmera, que aqui são o ponto central.
//
// Organização deste módulo:
//   1. estado e constantes      4. cena (Terra, nuvens, atmosfera, estrelas, marcadores)   7. partículas de vento
//   2. abrir / fechar           5. câmera e gestos (arrastar, pinça, roda, toque)          8. interface (chips, legenda, painel)
//   3. carregamento progressivo 6. camadas de dados e linha do tempo                        9. laço de animação e qualidade
import * as THREE from '../vendor/three/three.module.min.js';
import { el, fmt, prefs, mostrarInfo, linkExterno } from './ui.js';
import { buscarManifest, buscarCampo, buscarSatelite, lerPontoGfs, buscarPonto, textoCodigoTempo, valorDoByte } from './globo-dados.js';
import { pontoSubsolar, pontoSublunar } from './globo-astro.js';
import { valido, direcaoTexto, partesLocais } from './analise.js';

// ------------------------------------------------------------------ 1. estado e constantes

const RAD = Math.PI / 180;
const RAIO = 1;
const DIST = { min: 1.12, inicial: 2.7, max: 8 };
const MOVIMENTO_REDUZIDO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CELULAR = matchMedia('(pointer: coarse)').matches;

/** Camadas visíveis no seletor. canal: canal do PNG (0 R, 1 G, 2 B, 3 = módulo de RG, para vento). */
const CAMADAS = [
  { id: 'nuvens', nome: 'Nuvens', legenda: null },
  { id: 'vento', nome: 'Vento', arquivo: 'vento', canal: 3, faixaCor: [0, 120], unidade: 'km/h', fator: 3.6, legenda: 'Vento a 10 m. As linhas mostram para onde ele sopra.',
    cores: [[0, 90, 200, 190, 0], [15, 90, 200, 190, 0.25], [30, 90, 220, 140, 0.45], [50, 240, 210, 70, 0.6], [75, 240, 130, 50, 0.7], [100, 220, 50, 50, 0.78], [120, 140, 20, 110, 0.85]] },
  { id: 'chuva', nome: 'Chuva', arquivo: 'campo', canal: 2, faixaCor: [0, 30], unidade: 'mm/h', fator: 1, legenda: 'Chuva prevista pelo modelo, em milímetros por hora.',
    cores: [[0, 80, 170, 230, 0], [0.3, 80, 170, 230, 0.35], [1, 60, 130, 230, 0.6], [4, 40, 80, 210, 0.75], [10, 120, 50, 190, 0.85], [20, 200, 40, 150, 0.9], [30, 255, 90, 120, 0.95]] },
  { id: 'temp', nome: 'Temperatura', arquivo: 'campo', canal: 0, faixaCor: [-40, 45], unidade: '°C', fator: 1, legenda: 'Temperatura do ar a 2 m do chão.',
    cores: [[-40, 120, 40, 170, 0.8], [-20, 60, 70, 200, 0.8], [-5, 70, 150, 220, 0.8], [5, 90, 200, 200, 0.8], [15, 110, 200, 110, 0.8], [25, 240, 210, 70, 0.8], [32, 240, 130, 50, 0.8], [40, 215, 50, 50, 0.82], [45, 150, 20, 90, 0.85]] },
  { id: 'pressao', nome: 'Pressão', arquivo: 'campo', canal: 1, faixaCor: [960, 1050], unidade: 'hPa', fator: 1, legenda: 'Pressão ao nível do mar. Linhas a cada 4 hPa; azul é baixa (tempo instável), laranja é alta.',
    cores: [[960, 110, 40, 180, 0.8], [985, 60, 90, 210, 0.75], [1000, 80, 160, 220, 0.6], [1013, 190, 200, 210, 0.45], [1025, 240, 190, 90, 0.6], [1040, 235, 120, 50, 0.75], [1050, 200, 50, 40, 0.8]] },
];

/** Estado do globo (um só, porque há uma aba só). */
const G = {
  aberto: false, pronto: false, dom: null, estadoApp: null,
  renderer: null, cena: null, camera: null, terra: null, nuvens: null, atmosfera: null, estrelas: null, lua: null,
  marcadorUsuario: null, marcadorToque: null, ciclones: [],
  cam: { lat: -29.7, lon: -51.1, dist: DIST.inicial, vLat: 0, vLon: 0 }, animCam: null, autoGira: !MOVIMENTO_REDUZIDO, chegou: false,
  camada: 'nuvens', hora: null, horaAgora: null, manifest: null, manifestAntigo: false, campos: {}, satelite: null,
  texturas: {}, relogio: null, quadro: 0, ultimoQuadro: 0, tempos: [], nivelQualidade: 0, pixelRatio: 1,
  particulas: null, tocado: null, erroDados: null, anim: 0, tempoLinha: { tocando: false, timer: null },
};

const latLonVec = (lat, lon, r = RAIO, alvo = new THREE.Vector3()) => {
  const la = lat * RAD, lo = lon * RAD;
  return alvo.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
};
const vecLatLon = (v) => ({ lat: Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))) / RAD, lon: -Math.atan2(v.z, v.x) / RAD });

// ------------------------------------------------------------------ 2. abrir / fechar

/**
 * Monta o globo dentro da seção da aba (uma vez) e liga o laço de animação. Chamado por app.js ao abrir a aba.
 * @param {HTMLElement} secao  conteúdo da aba Globo
 * @param {object} estadoApp   estado do app (usa estado.local para marcar a posição do usuário)
 */
export function abrirGlobo(secao, estadoApp) {
  G.estadoApp = estadoApp;
  if (!G.dom) montarDom(secao);
  G.aberto = true;
  if (!G.renderer) {
    try { montarCena(); } catch (e) { mostrarAviso('Este aparelho não conseguiu abrir o globo em 3D (WebGL indisponível).', true); return; }
    carregarTudo();
  }
  atualizarMarcadorUsuario();
  ajustarTamanho();
  G.ultimoQuadro = performance.now();
  if (!G.anim) G.anim = requestAnimationFrame(laco);
}

/** Para o laço de animação ao sair da aba (a cena fica em memória para voltar na hora). */
export function fecharGlobo() {
  G.aberto = false;
  if (G.anim) { cancelAnimationFrame(G.anim); G.anim = 0; }
  pararLinhaDoTempo();
}

// ------------------------------------------------------------------ 3. carregamento progressivo

function textura(url, opcoes = {}) {
  if (G.texturas[url]) return G.texturas[url];
  G.texturas[url] = new Promise((ok, falha) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = opcoes.cor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(4, G.renderer.capabilities.getMaxAnisotropy());
      t.wrapS = THREE.RepeatWrapping;
      ok(t);
    }, undefined, () => falha(new Error('textura não carregou: ' + url)));
  });
  return G.texturas[url];
}

function texturaDeImagem(imagem, { linear = true } = {}) {
  const t = new THREE.Texture(imagem);
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.premultiplyAlpha = false; t.generateMipmaps = false;
  t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Ordem: Terra em baixa resolução (aparece em menos de 1 s), depois relevo, noite e mar, depois os dados. */
async function carregarTudo() {
  const u = G.terra.material.uniforms;
  try {
    u.tDia.value = await textura('vendor/texturas/terra-dia-1024.jpg', { cor: true });
    G.pronto = true; esconderAviso();
    // chegada: o globo inteiro aparece e a câmera desce suavemente até o local do usuário (Rio Grande do Sul por padrão)
    const l = G.estadoApp?.local;
    G.cam.dist = distanciaQueCabe(); G.cam.lat = (l?.lat ?? -29.7) * 0.6; G.cam.lon = (l?.lon ?? -51.1) + 35;
    irPara(l?.lat ?? -29.7, l?.lon ?? -51.1, DIST.inicial, 2200);
    G.chegou = true;
  } catch { mostrarAviso('Não foi possível carregar a imagem da Terra. Verifique a conexão e toque em atualizar.', true); return; }
  textura('vendor/texturas/terra-dia-4096.jpg', { cor: true }).then((t) => { u.tDia.value = t; }).catch(() => {});
  textura('vendor/texturas/terra-normal-2048.jpg').then((t) => { u.tNormal.value = t; u.temNormal.value = 1; }).catch(() => {});
  textura('vendor/texturas/terra-noite-2048.jpg', { cor: true }).then((t) => { u.tNoite.value = t; u.temNoite.value = 1; }).catch(() => {});
  textura('vendor/texturas/terra-mascaras-2048.png').then((t) => { u.tMascaras.value = t; u.temMascaras.value = 1; }).catch(() => {});
  await carregarDados();
}

/** Lê o manifest do branch globo-dados e carrega a hora mais próxima de agora. */
async function carregarDados() {
  try {
    const { manifest, antigo } = await buscarManifest();
    G.manifest = manifest; G.manifestAntigo = antigo; G.erroDados = null;
    if (!manifest.gfs?.horas?.length) throw new Error('sem campos do GFS');
    const rodadaMs = Date.parse(manifest.gfs.rodada);
    const h = Math.round((Date.now() - rodadaMs) / 3600000 / 3) * 3;
    G.horaAgora = manifest.gfs.horas.reduce((m, x) => (Math.abs(x - h) < Math.abs(m - h) ? x : m), manifest.gfs.horas[0]);
    G.hora = G.horaAgora;
    montarLinhaDoTempo();
    await Promise.all([carregarNuvens(G.hora), carregarCamada(G.camada, G.hora)]);
    marcarCiclones();
    atualizarNotaFonte();
  } catch (e) {
    G.erroDados = e;
    mostrarAviso(`O globo abriu, mas os dados de tempo não chegaram (${e?.message || 'falha'}). Mostrando só a Terra, o Sol e a noite.`, false);
    atualizarNotaFonte();
  }
}

/** Nuvens: mosaico de satélite para a hora de agora; campo do modelo para as outras horas (ou se o satélite faltar). */
async function carregarNuvens(hora) {
  const m = G.manifest;
  let modelo = null, sat = null;
  try { modelo = await buscarCampo(m, 'nuvens', hora); } catch {}
  if (hora === G.horaAgora && m.satelite) { try { sat = await buscarSatelite(m); G.satelite = sat; } catch {} }
  if (!modelo && !sat) return;
  const W = sat ? sat.largura : 1440, H = sat ? sat.altura : 720;
  const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d', { willReadFrequently: true });
  let mp = null;
  if (modelo) { // o modelo (0,5°) é ampliado com interpolação para não aparecer em blocos
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(modelo.imagem, 0, 0, W, H);
    mp = ctx.getImageData(0, 0, W, H).data;
  }
  const img = ctx.createImageData(W, H), d = img.data;
  const sp = sat?.pixels, alfaPronto = !!m.satelite?.alfa;
  for (let i = 0, o = 0; o < d.length; i += 4, o += 4) {
    let a = 0;
    if (mp) {
      const b = mp[i] / 255, md = mp[i + 1] / 255, al = mp[i + 2] / 255;
      a = 1 - (1 - b * 0.95) * (1 - md * 0.8) * (1 - al * 0.5); // sobreposição aleatória das camadas, as altas mais finas
      a = Math.pow(a, 1.3);
    }
    if (sp) {
      const cob = sp[i + 1] / 255;
      if (cob > 0) a = a * (1 - cob) + (alfaPronto ? sp[i] / 255 : suave(130, 215, sp[i])) * cob; // R já é transparência (ou brilho infravermelho nas versões antigas)
    }
    d[o] = Math.round(a * 255); d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = texturaDeImagem(cv);
  t.wrapT = THREE.ClampToEdgeWrapping;
  G.nuvens.material.uniforms.tNuvem.value?.dispose?.();
  G.nuvens.material.uniforms.tNuvem.value = t;
  G.nuvens.material.uniforms.temNuvem.value = 1;
  G.nuvens.userData.satelite = !!sat;
  G.terra.material.uniforms.tNuvens.value = t;
  G.terra.material.uniforms.temNuvens.value = 1;
  if (G.camada === 'nuvens') { montarLegenda(CAMADAS[0], null); atualizarNotaFonte(); }
}

const suave = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ 4. cena

const VERTEX_TERRA = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vP = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  }`;

const FRAGMENT_TERRA = /* glsl */`
  uniform sampler2D tDia, tNoite, tNormal, tMascaras, tNuvens, tCamada, tEscala;
  uniform float temNormal, temNoite, temMascaras, temNuvens, temCamada, opacidade, raiz, isobaras;
  uniform vec3 sol, olho; uniform vec2 faixaCanal, faixaCor, desloc; uniform int canal;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  vec2 uvDados(vec2 uv) { return vec2(fract(uv.x + 0.5 / 720.0), ((1.0 - uv.y) * 360.0 + 0.5) / 361.0); }
  float valorCanal(vec4 px) {
    float b = canal == 0 ? px.r : canal == 1 ? px.g : canal == 2 ? px.b : 0.0;
    if (canal == 3) { vec2 uv = (px.rg * (faixaCanal.y - faixaCanal.x) + faixaCanal.x); return length(uv); }
    if (raiz > 0.5) b *= b;
    return faixaCanal.x + b * (faixaCanal.y - faixaCanal.x);
  }
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(olho - vP);
    float lam = atan(-vP.z, vP.x);
    vec3 T = normalize(vec3(-sin(lam), 0.0, -cos(lam))); vec3 B = cross(N, T);
    vec3 Nd = N;
    if (temNormal > 0.5) { vec3 nm = texture2D(tNormal, vUv).xyz * 2.0 - 1.0; Nd = normalize(T * nm.x + B * nm.y + N * (nm.z * 1.6)); }
    float cosSol = dot(N, sol);
    float dia = smoothstep(-0.10, 0.14, cosSol);
    vec3 cDia = texture2D(tDia, vUv).rgb;
    float lamb = mix(max(dot(Nd, sol), 0.0), max(cosSol, 0.0), 0.45);
    vec3 cor = cDia * (0.035 + 1.05 * lamb);
    float tw = exp(-pow(cosSol / 0.13, 2.0));
    cor = mix(cor, cor * vec3(1.3, 0.82, 0.55) + vec3(0.06, 0.02, 0.0), tw * 0.5);
    float agua = temMascaras > 0.5 ? texture2D(tMascaras, vUv).r : 0.0;
    vec3 H = normalize(sol + V);
    float brilho = pow(max(dot(Nd, H), 0.0), 140.0) * agua * dia;
    cor += vec3(1.0, 0.93, 0.8) * brilho * 1.1;
    cor += vec3(0.5, 0.7, 1.0) * pow(max(dot(N, H), 0.0), 10.0) * agua * dia * 0.06;
    float nuvem = 0.0;
    if (temNuvens > 0.5) { nuvem = texture2D(tNuvens, vec2(fract(vUv.x + desloc.x), 1.0 - vUv.y + desloc.y)).r; cor *= 1.0 - 0.42 * nuvem * dia; }
    float noite = 1.0 - dia;
    if (temNoite > 0.5) {
      vec3 luzes = texture2D(tNoite, vUv).rgb;
      float nuvemAqui = temNuvens > 0.5 ? texture2D(tNuvens, vec2(vUv.x, 1.0 - vUv.y)).r : 0.0;
      cor += pow(luzes, vec3(0.8)) * vec3(1.0, 0.88, 0.7) * noite * 3.2 * (1.0 - 0.6 * nuvemAqui);
    }
    cor += cDia * vec3(0.18, 0.25, 0.4) * noite * 0.7;
    if (temCamada > 0.5) {
      vec2 ud = uvDados(vUv);
      vec4 px = texture2D(tCamada, ud);
      float v = valorCanal(px);
      float t = clamp((v - faixaCor.x) / (faixaCor.y - faixaCor.x), 0.0, 1.0);
      vec4 c = texture2D(tEscala, vec2(t, 0.5));
      float luzCamada = 0.78 + 0.22 * lamb;
      cor = mix(cor, c.rgb * luzCamada, c.a * opacidade);
      if (isobaras > 0.5) { // isóbaras a cada 4 hPa, só com o globo aproximado (de longe viram ruído)
        float f = v / 4.0; float d = abs(fract(f) - 0.5); float w = max(fwidth(f), 0.01);
        float linha = 1.0 - smoothstep(0.5 - w * 1.6, 0.5 - w * 0.4, d);
        cor = mix(cor, vec3(0.97, 0.98, 1.0), linha * 0.45 * isobaras * opacidade);
      }
    }
    float fr = pow(1.0 - max(dot(N, V), 0.0), 3.2);
    cor += vec3(0.33, 0.52, 1.0) * fr * (0.12 + 0.88 * dia) * 0.55;
    gl_FragColor = vec4(cor, 1.0);
  }`;

const FRAGMENT_NUVENS = /* glsl */`
  uniform sampler2D tNuvem; uniform float temNuvem, opacNuvem; uniform vec3 sol, olho;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    if (temNuvem < 0.5) discard;
    vec3 N = normalize(vN); vec3 V = normalize(olho - vP);
    float a = texture2D(tNuvem, vec2(vUv.x, 1.0 - vUv.y)).r;
    float cosSol = dot(N, sol);
    float dia = smoothstep(-0.12, 0.16, cosSol);
    vec3 cor = vec3(1.0, 0.99, 0.97) * (0.10 + 0.92 * max(cosSol, 0.0));
    float tw = exp(-pow(cosSol / 0.13, 2.0));
    cor = mix(cor, cor * vec3(1.35, 0.8, 0.55), tw * 0.6);
    cor = mix(vec3(0.09, 0.10, 0.13), cor, dia);
    float borda = pow(max(dot(N, V), 0.0), 0.45);
    gl_FragColor = vec4(cor, a * 0.96 * borda * opacNuvem);
  }`;

const FRAGMENT_ATMOSFERA = /* glsl */`
  uniform vec3 sol, olho; varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(olho - vP);
    float f = 1.0 - max(dot(N, V), 0.0);
    float a = pow(f, 3.0) * smoothstep(0.0, 1.0, f * 1.4);
    float dia = smoothstep(-0.35, 0.45, dot(N, sol));
    vec3 cor = mix(vec3(0.25, 0.45, 0.95), vec3(0.55, 0.75, 1.0), f);
    float tw = exp(-pow(dot(N, sol) / 0.25, 2.0));
    cor = mix(cor, vec3(1.0, 0.55, 0.3), tw * 0.5);
    gl_FragColor = vec4(cor, a * (0.08 + 0.92 * dia) * 0.9);
  }`;

function montarCena() {
  const canvas = G.dom.canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !CELULAR, alpha: false, powerPreference: 'high-performance', stencil: false });
  G.pixelRatio = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(G.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x04060b, 1);
  G.renderer = renderer;
  G.cena = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);

  const seg = CELULAR ? [96, 72] : [160, 120];
  const uniTerra = {
    tDia: { value: null }, tNoite: { value: null }, tNormal: { value: null }, tMascaras: { value: null }, tNuvens: { value: null }, tCamada: { value: null }, tEscala: { value: null },
    temNormal: { value: 0 }, temNoite: { value: 0 }, temMascaras: { value: 0 }, temNuvens: { value: 0 }, temCamada: { value: 0 },
    opacidade: { value: 0 }, raiz: { value: 0 }, isobaras: { value: 0 }, canal: { value: 0 },
    sol: { value: new THREE.Vector3(1, 0, 0) }, olho: { value: new THREE.Vector3() }, faixaCanal: { value: new THREE.Vector2(0, 1) }, faixaCor: { value: new THREE.Vector2(0, 1) },
    desloc: { value: new THREE.Vector2(0.0025, 0.0025) },
  };
  G.terra = new THREE.Mesh(new THREE.SphereGeometry(RAIO, seg[0], seg[1]), new THREE.ShaderMaterial({ uniforms: uniTerra, vertexShader: VERTEX_TERRA, fragmentShader: FRAGMENT_TERRA }));
  G.cena.add(G.terra);

  G.nuvens = new THREE.Mesh(new THREE.SphereGeometry(RAIO * 1.0065, seg[0], seg[1]), new THREE.ShaderMaterial({
    uniforms: { tNuvem: { value: null }, temNuvem: { value: 0 }, opacNuvem: { value: 1 }, sol: uniTerra.sol, olho: uniTerra.olho },
    vertexShader: VERTEX_TERRA, fragmentShader: FRAGMENT_NUVENS, transparent: true, depthWrite: false,
  }));
  G.cena.add(G.nuvens);

  G.atmosfera = new THREE.Mesh(new THREE.SphereGeometry(RAIO * 1.045, 96, 64), new THREE.ShaderMaterial({
    uniforms: { sol: uniTerra.sol, olho: uniTerra.olho }, vertexShader: VERTEX_TERRA, fragmentShader: FRAGMENT_ATMOSFERA,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  }));
  G.cena.add(G.atmosfera);

  // estrelas de fundo (posições fixas por semente, para o céu não mudar a cada abertura)
  const n = 2200, pos = new Float32Array(n * 3), cor = new Float32Array(n * 3);
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 60, z * 60, r * Math.sin(a) * 60], i * 3);
    const b = 0.35 + rnd() * 0.65, q = rnd();
    cor.set([b * (q < 0.2 ? 0.85 : 1), b * (q < 0.2 ? 0.9 : q > 0.85 ? 0.95 : 1), b * (q > 0.85 ? 0.8 : 1)], i * 3);
  }
  const ge = new THREE.BufferGeometry();
  ge.setAttribute('position', new THREE.BufferAttribute(pos, 3)); ge.setAttribute('color', new THREE.BufferAttribute(cor, 3));
  G.estrelas = new THREE.Points(ge, new THREE.PointsMaterial({ size: CELULAR ? 1.6 : 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  G.cena.add(G.estrelas);

  // Lua: esfera pequena na direção real, fora de escala de distância (fica a 14 raios da Terra)
  G.lua = new THREE.Mesh(new THREE.SphereGeometry(0.27 * 0.5, 32, 24), new THREE.MeshLambertMaterial({ color: 0xcfcbc2 }));
  const luzSol = new THREE.DirectionalLight(0xffffff, 2.2); luzSol.name = 'sol';
  G.cena.add(G.lua, luzSol, new THREE.AmbientLight(0x202430, 0.5));

  G.marcadorUsuario = criarMarcador(0xf2d16b, 0.022);
  G.marcadorToque = criarMarcador(0xffffff, 0.018); G.marcadorToque.visible = false;
  G.cena.add(G.marcadorUsuario, G.marcadorToque);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); mostrarAviso('O 3D foi interrompido pelo aparelho. Toque em atualizar para reabrir o globo.', true); fecharGlobo(); });
  configurarGestos();
}

function criarMarcador(corHex, raio) {
  const g = new THREE.Group();
  const anel = new THREE.Mesh(new THREE.RingGeometry(raio * 0.7, raio, 40), new THREE.MeshBasicMaterial({ color: corHex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
  const ponto = new THREE.Mesh(new THREE.CircleGeometry(raio * 0.32, 24), new THREE.MeshBasicMaterial({ color: corHex, depthTest: false }));
  const pulso = new THREE.Mesh(new THREE.RingGeometry(raio * 0.9, raio * 1.0, 40), new THREE.MeshBasicMaterial({ color: corHex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthTest: false }));
  pulso.name = 'pulso';
  g.add(anel, ponto, pulso); g.renderOrder = 10;
  return g;
}

function posicionarMarcador(m, lat, lon, altura = 1.004) {
  latLonVec(lat, lon, RAIO * altura, m.position);
  m.lookAt(latLonVec(lat, lon, 2));
  m.userData.lat = lat; m.userData.lon = lon;
}

function atualizarMarcadorUsuario() {
  const l = G.estadoApp?.local;
  if (!G.marcadorUsuario) return;
  if (l && valido(l.lat) && valido(l.lon)) { posicionarMarcador(G.marcadorUsuario, l.lat, l.lon); G.marcadorUsuario.visible = true; }
  else G.marcadorUsuario.visible = false;
}

function marcarCiclones() {
  for (const c of G.ciclones) G.cena.remove(c);
  G.ciclones = [];
  for (const c of G.manifest?.ciclones || []) {
    const m = criarMarcador(0xff6a5a, 0.03);
    posicionarMarcador(m, c.lat, c.lon, 1.006);
    m.userData.ciclone = c;
    G.cena.add(m); G.ciclones.push(m);
  }
  G.dom.ciclones.textContent = G.ciclones.length ? `${G.ciclones.length} ciclone${G.ciclones.length > 1 ? 's' : ''} ativo${G.ciclones.length > 1 ? 's' : ''} (pontos vermelhos)` : '';
}

/** Posição do Sol e da Lua para o instante mostrado (agora, ou a hora escolhida na linha do tempo). */
function atualizarAstros() {
  const ms = instanteMostrado();
  const ss = pontoSubsolar(ms);
  const sol = G.terra.material.uniforms.sol.value;
  latLonVec(ss.lat, ss.lon, 1, sol);
  G.cena.getObjectByName('sol').position.copy(sol).multiplyScalar(50);
  const sl = pontoSublunar(ms);
  latLonVec(sl.lat, sl.lon, 14, G.lua.position);
  G.dom.sol.textContent = `Sol a pino em ${fmtLat(ss.lat)} ${fmtLon(ss.lon)}`;
}

function instanteMostrado() {
  if (G.hora === null || G.hora === G.horaAgora || !G.manifest?.gfs) return Date.now();
  return Date.parse(G.manifest.gfs.rodada) + G.hora * 3600000;
}

// ------------------------------------------------------------------ 5. câmera e gestos

function posicionarCamera() {
  const c = G.cam;
  latLonVec(c.lat, c.lon, c.dist, G.camera.position);
  G.camera.up.set(0, 1, 0);
  G.camera.lookAt(0, 0, 0);
  G.terra.material.uniforms.olho.value.copy(G.camera.position);
}

/** Leva a câmera suavemente até (lat, lon, dist) em ms milissegundos. */
function irPara(lat, lon, dist = G.cam.dist, ms = 900) {
  const de = { lat: G.cam.lat, lon: G.cam.lon, dist: G.cam.dist };
  let dlon = lon - de.lon; dlon = ((dlon + 540) % 360) - 180;
  G.cam.vLat = G.cam.vLon = 0; G.autoGira = false;
  if (MOVIMENTO_REDUZIDO) { G.cam.lat = lat; G.cam.lon = lon; G.cam.dist = dist; G.animCam = null; return; }
  G.animCam = { de, para: { lat, lon: de.lon + dlon, dist }, t0: performance.now(), ms };
}

function configurarGestos() {
  const cv = G.dom.canvas;
  const ponteiros = new Map();
  let ultimo = null, pinca = null, toque = null, ultimoToque = 0;
  const velAng = () => 0.22 * Math.max(0.08, (G.cam.dist - 1) / (DIST.inicial - 1));
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    G.cam.vLat = G.cam.vLon = 0; G.animCam = null; G.autoGira = false;
    if (ponteiros.size === 1) { ultimo = { x: e.clientX, y: e.clientY, t: performance.now() }; toque = { x: e.clientX, y: e.clientY, t: performance.now(), moveu: 0 }; }
    else if (ponteiros.size === 2) { const [a, b] = [...ponteiros.values()]; pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: G.cam.dist }; toque = null; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ponteiros.size === 2 && pinca) {
      const [a, b] = [...ponteiros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) definirDist(pinca.dist * (pinca.d / d));
      return;
    }
    if (ponteiros.size !== 1 || !ultimo) return;
    const dx = e.clientX - ultimo.x, dy = e.clientY - ultimo.y, agora = performance.now(), dt = Math.max(1, agora - ultimo.t);
    const k = velAng();
    G.cam.lon -= dx * k; G.cam.lat = Math.max(-85, Math.min(85, G.cam.lat + dy * k));
    G.cam.vLon = -dx * k / dt * 16; G.cam.vLat = dy * k / dt * 16;
    if (toque) toque.moveu += Math.abs(dx) + Math.abs(dy);
    ultimo = { x: e.clientX, y: e.clientY, t: agora };
  });
  const soltar = (e) => {
    ponteiros.delete(e.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (ponteiros.size === 0) {
      if (toque && toque.moveu < 8 && performance.now() - toque.t < 400) {
        const agora = performance.now();
        if (agora - ultimoToque < 320) { aproximar(e.clientX, e.clientY); ultimoToque = 0; }
        else { ultimoToque = agora; tocarPonto(e.clientX, e.clientY); }
      }
      if (performance.now() - (ultimo?.t || 0) > 80) { G.cam.vLat = G.cam.vLon = 0; }
      ultimo = null; toque = null;
    }
  };
  cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); definirDist(G.cam.dist * Math.exp(e.deltaY * 0.0012)); G.autoGira = false; }, { passive: false });
  cv.addEventListener('dblclick', (e) => e.preventDefault());
  cv.addEventListener('keydown', (e) => {
    const passo = 5;
    if (e.key === 'ArrowLeft') G.cam.lon -= passo; else if (e.key === 'ArrowRight') G.cam.lon += passo;
    else if (e.key === 'ArrowUp') G.cam.lat = Math.min(85, G.cam.lat + passo); else if (e.key === 'ArrowDown') G.cam.lat = Math.max(-85, G.cam.lat - passo);
    else if (e.key === '+' || e.key === '=') definirDist(G.cam.dist / 1.2); else if (e.key === '-') definirDist(G.cam.dist * 1.2);
    else return;
    e.preventDefault(); G.autoGira = false;
  });
}

/** Distância em que a Terra inteira cabe na tela, com folga, qualquer que seja a proporção. */
function distanciaQueCabe() {
  const fovV = G.camera.fov * RAD, fovH = 2 * Math.atan(Math.tan(fovV / 2) * G.camera.aspect);
  return Math.min(DIST.max, 1 / Math.sin(Math.min(fovV, fovH) / 2 * 0.86));
}

function definirDist(d) { G.cam.dist = Math.max(DIST.min, Math.min(DIST.max, d)); }

/** Ponto da esfera sob a posição da tela (interseção analítica raio x esfera), ou null fora da Terra. */
function pontoSob(cx, cy) {
  const r = G.dom.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, G.camera);
  const o = rc.ray.origin, d = rc.ray.direction;
  const b = o.dot(d), c = o.dot(o) - RAIO * RAIO, disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const p = o.clone().addScaledVector(d, t);
  return vecLatLon(p);
}

function aproximar(cx, cy) {
  const p = pontoSob(cx, cy);
  if (!p) return;
  irPara(p.lat, p.lon, Math.max(DIST.min, G.cam.dist * 0.55), 700);
}

// ------------------------------------------------------------------ 6. camadas de dados e linha do tempo

function escalaTextura(camada) {
  const dados = new Uint8Array(256 * 4);
  const paradas = camada.cores;
  for (let i = 0; i < 256; i++) {
    const v = camada.faixaCor[0] + (i / 255) * (camada.faixaCor[1] - camada.faixaCor[0]);
    let c = paradas[paradas.length - 1].slice(1);
    if (v <= paradas[0][0]) c = paradas[0].slice(1);
    else for (let k = 1; k < paradas.length; k++) {
      const a = paradas[k - 1], b = paradas[k];
      if (v <= b[0]) { const t = (v - a[0]) / (b[0] - a[0]); c = [1, 2, 3, 4].map((j) => a[j] + t * (b[j] - a[j])); break; }
    }
    dados.set([c[0], c[1], c[2], Math.round(c[3] * 255)], i * 4);
  }
  const t = new THREE.DataTexture(dados, 256, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/** Ativa uma camada do seletor: carrega o campo da hora atual e configura o shader (e as partículas, no vento). */
async function carregarCamada(id, hora) {
  const cam = CAMADAS.find((c) => c.id === id);
  const u = G.terra.material.uniforms;
  G.camada = id;
  for (const b of G.dom.chips.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.camada === id));
  prefs.gravar('globoCamada', id);
  G.nuvens.material.uniforms.opacNuvem.value = cam.arquivo ? 0.3 : 1; // com dados por cima, as nuvens ficam discretas
  if (!cam.arquivo) { u.temCamada.value = 0; pararParticulas(); montarLegenda(cam, null); atualizarNotaFonte(); return; }
  if (!G.manifest?.gfs) { montarLegenda(cam, null); return; }
  let campo;
  try { campo = await buscarCampo(G.manifest, cam.arquivo, hora); }
  catch (e) { mostrarAviso(`Não foi possível carregar a camada ${cam.nome} (${e?.message || 'falha'}).`, false); return; }
  if (G.camada !== id || G.hora !== hora) return; // o usuário já trocou enquanto carregava
  G.campos[cam.arquivo] = campo;
  const canalInfo = campo.canais[cam.canal === 3 ? 'R' : ['R', 'G', 'B'][cam.canal]]; // canal 3 = módulo de (R, G), mesma faixa dos dois
  if (!cam.textura) cam.textura = escalaTextura(cam);
  u.tCamada.value?.dispose?.();
  u.tCamada.value = texturaDeImagem(campo.imagem);
  u.tEscala.value = cam.textura;
  u.canal.value = cam.canal;
  u.raiz.value = canalInfo?.escala === 'raiz' ? 1 : 0;
  u.faixaCanal.value.set(canalInfo?.min ?? 0, canalInfo?.max ?? 1);
  u.faixaCor.value.set(cam.faixaCor[0] / cam.fator, cam.faixaCor[1] / cam.fator);
  u.isobaras.value = 0; // ligado no laço quando a câmera aproxima (ver laco)
  u.opacidade.value = 1;
  u.temCamada.value = 1;
  if (id === 'vento') iniciarParticulas(campo); else pararParticulas();
  montarLegenda(cam, campo);
  atualizarNotaFonte();
}

/** Troca a hora mostrada: nuvens e camada ativa recarregam; o Sol acompanha o horário. */
async function definirHora(h) {
  if (!G.manifest?.gfs?.horas?.includes(h)) return;
  G.hora = h;
  atualizarRotuloHora();
  await Promise.all([carregarNuvens(h), carregarCamada(G.camada, h)]);
  if (G.tocado) mostrarPontoTocado(G.tocado.lat, G.tocado.lon, true);
}

function montarLinhaDoTempo() {
  const horas = G.manifest.gfs.horas;
  const r = G.dom.faixa;
  r.min = '0'; r.max = String(horas.length - 1); r.step = '1'; r.value = String(horas.indexOf(G.hora));
  r.disabled = false;
  G.dom.linha.hidden = false;
  atualizarRotuloHora();
}

function atualizarRotuloHora() {
  const off = -new Date().getTimezoneOffset() * 60;
  const ms = instanteMostrado();
  const p = partesLocais(ms, off);
  const dia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][p.semana];
  G.dom.rotuloHora.textContent = G.hora === G.horaAgora ? 'Agora' : `${dia} ${String(p.hora).padStart(2, '0')}h`;
  G.dom.faixa.setAttribute('aria-valuetext', G.dom.rotuloHora.textContent);
  if (G.manifest?.gfs?.horas) G.dom.faixa.value = String(G.manifest.gfs.horas.indexOf(G.hora));
}

function alternarLinhaDoTempo() {
  if (G.tempoLinha.tocando) { pararLinhaDoTempo(); return; }
  G.tempoLinha.tocando = true;
  G.dom.tocar.textContent = 'Pausar'; G.dom.tocar.setAttribute('aria-pressed', 'true');
  const passo = async () => {
    if (!G.tempoLinha.tocando) return;
    const horas = G.manifest.gfs.horas;
    const k = (horas.indexOf(G.hora) + 1) % horas.length;
    await definirHora(horas[k]);
    G.tempoLinha.timer = setTimeout(passo, 1100);
  };
  passo();
}
function pararLinhaDoTempo() {
  G.tempoLinha.tocando = false; clearTimeout(G.tempoLinha.timer);
  if (G.dom) { G.dom.tocar.textContent = 'Animar'; G.dom.tocar.setAttribute('aria-pressed', 'false'); }
}

// ------------------------------------------------------------------ 7. partículas de vento

// passo: graus por quadro por (m/s): 20 m/s avançam 0,15° por quadro (uns 3 px com o globo aproximado)
const PART = { n: CELULAR ? 2600 : 5000, trilha: 12, vida: [120, 320], passo: 0.011 };

function iniciarParticulas(campo) {
  pararParticulas();
  const n = Math.round(PART.n * (G.nivelQualidade >= 2 ? 0.5 : 1)), K = PART.trilha;
  const segs = n * (K - 1);
  const pos = new Float32Array(segs * 2 * 3), alfa = new Float32Array(segs * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alfa', new THREE.BufferAttribute(alfa, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { cor: { value: new THREE.Color(0xffffff) } },
    vertexShader: 'attribute float alfa; varying float vA; void main(){ vA = alfa; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 cor; varying float vA; void main(){ gl_FragColor = vec4(cor, vA); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const linhas = new THREE.LineSegments(geo, mat);
  linhas.renderOrder = 5;
  G.cena.add(linhas);
  const p = { n, K, linhas, pos, alfa, lat: new Float32Array(n), lon: new Float32Array(n), idade: new Float32Array(n), vida: new Float32Array(n), trilha: new Float32Array(n * K * 2), campo };
  for (let i = 0; i < n; i++) nascer(p, i, true);
  G.particulas = p;
}

function nascer(p, i, inicial) {
  // distribuição uniforme na esfera (latitude por arco-seno), para não acumular nos polos
  p.lat[i] = Math.asin(Math.random() * 2 - 1) / RAD;
  p.lon[i] = Math.random() * 360 - 180;
  p.vida[i] = PART.vida[0] + Math.random() * (PART.vida[1] - PART.vida[0]);
  p.idade[i] = inicial ? Math.random() * p.vida[i] : 0;
  for (let k = 0; k < p.K; k++) { p.trilha[(i * p.K + k) * 2] = p.lat[i]; p.trilha[(i * p.K + k) * 2 + 1] = p.lon[i]; }
}

function vento(p, lat, lon) {
  const { largura: W, altura: H, pixels, canais } = p.campo;
  const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * (H - 1);
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
  const fx = x - x0, fy = Math.max(0, Math.min(1, y - y0));
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
  const i00 = (y0 * W + xa) * 4, i10 = (y0 * W + xb) * 4, i01 = ((y0 + 1) * W + xa) * 4, i11 = ((y0 + 1) * W + xb) * 4;
  const bi = (c) => (pixels[i00 + c] * (1 - fx) + pixels[i10 + c] * fx) * (1 - fy) + (pixels[i01 + c] * (1 - fx) + pixels[i11 + c] * fx) * fy;
  return [valorDoByte(bi(0), canais.R), valorDoByte(bi(1), canais.G)];
}

function animarParticulas(dt) {
  const p = G.particulas;
  if (!p) return;
  const passos = Math.min(3, Math.max(1, Math.round(dt / 16)));
  const K = p.K, v3 = new THREE.Vector3();
  const escala = PART.passo * Math.min(1.6, Math.max(0.5, (G.cam.dist - 1) / (DIST.inicial - 1)));
  for (let i = 0; i < p.n; i++) {
    p.idade[i] += passos;
    if (p.idade[i] > p.vida[i]) nascer(p, i, false);
    const [u, v] = vento(p, p.lat[i], p.lon[i]);
    const cosLat = Math.max(0.15, Math.cos(p.lat[i] * RAD));
    p.lat[i] += v * escala * passos;
    p.lon[i] += (u * escala * passos) / cosLat;
    if (p.lat[i] > 89 || p.lat[i] < -89) nascer(p, i, false);
    if (p.lon[i] > 180) p.lon[i] -= 360; else if (p.lon[i] < -180) p.lon[i] += 360;
    const base = i * K * 2;
    for (let k = K - 1; k > 0; k--) { p.trilha[base + k * 2] = p.trilha[base + (k - 1) * 2]; p.trilha[base + k * 2 + 1] = p.trilha[base + (k - 1) * 2 + 1]; }
    p.trilha[base] = p.lat[i]; p.trilha[base + 1] = p.lon[i];
    const fade = Math.min(1, p.idade[i] / 20, (p.vida[i] - p.idade[i]) / 20);
    const vel = Math.min(1, Math.hypot(u, v) / 18);
    for (let k = 0; k < K - 1; k++) {
      const s = (i * (K - 1) + k);
      let la = p.trilha[base + k * 2], lo = p.trilha[base + k * 2 + 1], la2 = p.trilha[base + (k + 1) * 2], lo2 = p.trilha[base + (k + 1) * 2 + 1];
      let salto = Math.abs(lo - lo2) > 180; // trilha que cruzou a linha de data
      latLonVec(la, lo, RAIO * 1.012, v3); p.pos.set([v3.x, v3.y, v3.z], s * 6);
      latLonVec(la2, lo2, RAIO * 1.012, v3); p.pos.set([v3.x, v3.y, v3.z], s * 6 + 3);
      const a = salto ? 0 : fade * (0.25 + 0.75 * vel) * (1 - k / (K - 1)) * 0.85;
      p.alfa[s * 2] = a; p.alfa[s * 2 + 1] = a * (1 - (k + 1) / (K - 1));
    }
  }
  p.linhas.geometry.attributes.position.needsUpdate = true;
  p.linhas.geometry.attributes.alfa.needsUpdate = true;
}

function pararParticulas() {
  const p = G.particulas;
  if (!p) return;
  G.cena.remove(p.linhas); p.linhas.geometry.dispose(); p.linhas.material.dispose();
  G.particulas = null;
}

// ------------------------------------------------------------------ 8. interface

function montarDom(secao) {
  const canvas = el('canvas', { class: 'globo-canvas', tabindex: '0', 'aria-label': 'Globo 3D do tempo. Arraste para girar, pince para aproximar, toque num ponto para ver o tempo lá.' });
  const chips = el('div', { class: 'globo-chips', role: 'radiogroup', 'aria-label': 'Camada' });
  const camadaSalva = prefs.ler('globoCamada', 'nuvens');
  G.camada = CAMADAS.some((c) => c.id === camadaSalva) ? camadaSalva : 'nuvens';
  for (const c of CAMADAS) chips.append(el('button', { type: 'button', role: 'radio', 'aria-checked': String(c.id === G.camada), 'data-camada': c.id, text: c.nome, onclick: () => { carregarCamada(c.id, G.hora ?? 0); } }));
  const aviso = el('p', { class: 'globo-aviso', role: 'status', text: 'Carregando o globo…' });
  const legenda = el('div', { class: 'globo-legenda' });
  const fonte = el('p', { class: 'globo-fonte' });
  const sol = el('p', { class: 'globo-sol' });
  const ciclones = el('p', { class: 'globo-ciclones' });
  const faixa = el('input', { type: 'range', class: 'globo-faixa', min: '0', max: '0', value: '0', disabled: true, 'aria-label': 'Hora da previsão' });
  faixa.addEventListener('input', () => { pararLinhaDoTempo(); definirHora(G.manifest.gfs.horas[Number(faixa.value)]); });
  const rotuloHora = el('span', { class: 'globo-hora', text: 'Agora' });
  const tocar = el('button', { type: 'button', class: 'globo-tocar', text: 'Animar', 'aria-pressed': 'false', onclick: alternarLinhaDoTempo });
  const linha = el('div', { class: 'globo-linha', hidden: true }, rotuloHora, faixa, tocar);
  const painel = el('div', { class: 'globo-painel', hidden: true, role: 'dialog', 'aria-label': 'Tempo no ponto tocado' });
  const botoes = el('div', { class: 'globo-botoes' },
    el('button', { type: 'button', text: 'Minha posição', 'aria-label': 'Centralizar na minha posição', onclick: () => { const l = G.estadoApp?.local; if (l) irPara(l.lat, l.lon, Math.min(G.cam.dist, 2.2)); } }),
    el('button', { type: 'button', text: '+', 'aria-label': 'Aproximar', onclick: () => irPara(G.cam.lat, G.cam.lon, G.cam.dist / 1.5, 400) }),
    el('button', { type: 'button', text: '−', 'aria-label': 'Afastar', onclick: () => irPara(G.cam.lat, G.cam.lon, G.cam.dist * 1.5, 400) }),
    el('button', { type: 'button', text: '?', 'aria-label': 'Como usar e fontes', onclick: mostrarAjuda }));
  const raiz = el('div', { class: 'globo' }, canvas, el('div', { class: 'globo-topo' }, chips), botoes, aviso, painel,
    el('div', { class: 'globo-rodape' }, legenda, linha, el('div', { class: 'globo-notas' }, fonte, sol, ciclones)));
  secao.append(raiz);
  G.dom = { raiz, canvas, chips, aviso, legenda, fonte, sol, ciclones, faixa, rotuloHora, tocar, linha, painel };
  window.__globo = G; // só para testes automáticos de tela
  new ResizeObserver(ajustarTamanho).observe(raiz);
  montarLegenda(CAMADAS.find((c) => c.id === G.camada), null);
}

function ajustarTamanho() {
  if (!G.dom || !G.renderer) return;
  const r = G.dom.raiz;
  const cabeca = document.querySelector('.cabeca');
  const alturaTela = (window.visualViewport?.height || window.innerHeight) - (cabeca?.offsetHeight || 0);
  r.style.height = `${Math.max(360, Math.floor(alturaTela))}px`;
  const w = r.clientWidth, h = r.clientHeight;
  if (!w || !h) return;
  G.renderer.setSize(w, h, false);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
}

function montarLegenda(cam, campo) {
  const L = G.dom.legenda;
  L.replaceChildren();
  if (!cam.cores) {
    const sat = G.nuvens?.userData?.satelite;
    L.append(el('p', { class: 'globo-legenda-texto', text: sat ? 'Nuvens vistas pelos satélites agora. Onde não há satélite, entra o modelo.' : 'Nuvens previstas pelo modelo (baixas, médias e altas).' }));
    return;
  }
  const barra = el('div', { class: 'globo-barra' });
  const paradas = cam.cores.map((p) => `rgba(${Math.round(p[1])},${Math.round(p[2])},${Math.round(p[3])},${Math.max(0.15, p[4])}) ${((p[0] - cam.faixaCor[0]) / (cam.faixaCor[1] - cam.faixaCor[0]) * 100).toFixed(0)}%`);
  barra.style.background = `linear-gradient(to right, ${paradas.join(', ')})`;
  const rotulos = el('div', { class: 'globo-rotulos' });
  const n = cam.id === 'pressao' ? [960, 990, 1013, 1030, 1050] : cam.id === 'temp' ? [-40, -20, 0, 20, 45] : cam.id === 'vento' ? [0, 30, 60, 90, 120] : [0, 5, 10, 20, 30];
  for (const v of n) rotulos.append(el('span', { text: fmt.n(v) }));
  L.append(el('p', { class: 'globo-legenda-texto', text: `${cam.legenda}${campo ? '' : ' Carregando…'}` }), barra, rotulos, el('span', { class: 'globo-unidade', text: cam.unidade }));
}

function atualizarNotaFonte() {
  const off = -new Date().getTimezoneOffset() * 60;
  const partes = [];
  const m = G.manifest;
  if (m?.gfs?.rodada) partes.push(`NOAA GFS · ${fmt.horaMin(Date.parse(m.gfs.rodada), off)}`);
  if (G.camada === 'nuvens' && G.nuvens?.userData?.satelite && m?.satelite?.instante) partes.push(`NASA GIBS · ${fmt.horaMin(Date.parse(m.satelite.instante), off)}`);
  if (G.manifestAntigo) partes.push('dados guardados, podem estar desatualizados');
  if (!partes.length) partes.push(G.erroDados ? 'sem dados de tempo' : 'carregando dados…');
  G.dom.fonte.textContent = partes.join(' · ');
}

function mostrarAviso(texto, grave) { G.dom.aviso.textContent = texto; G.dom.aviso.hidden = false; G.dom.aviso.classList.toggle('grave', !!grave); if (!grave) setTimeout(() => { if (G.dom.aviso.textContent === texto) esconderAviso(); }, 9000); }
function esconderAviso() { G.dom.aviso.hidden = true; }

const fmtLat = (v) => `${fmt.n(Math.abs(v), 1)}°${v < 0 ? 'S' : 'N'}`;
const fmtLon = (v) => `${fmt.n(Math.abs(v), 1)}°${v < 0 ? 'O' : 'L'}`;

/** Toque num ponto: marca, mostra o que o GFS diz na hora (instantâneo) e completa com a Open-Meteo. */
function tocarPonto(cx, cy) {
  const p = pontoSob(cx, cy);
  if (!p) { fecharPainel(); return; }
  G.tocado = p;
  posicionarMarcador(G.marcadorToque, p.lat, p.lon); G.marcadorToque.visible = true;
  mostrarPontoTocado(p.lat, p.lon, false);
}

function fecharPainel() { G.dom.painel.hidden = true; G.marcadorToque.visible = false; G.tocado = null; }

async function mostrarPontoTocado(lat, lon, soGfs) {
  const P = G.dom.painel;
  const gfs = lerPontoGfs(G.campos, lat, lon);
  const cic = G.ciclones.find((c) => Math.hypot(c.userData.lat - lat, (c.userData.lon - lon) * Math.cos(lat * RAD)) < 3)?.userData.ciclone;
  const titulo = el('div', { class: 'globo-painel-topo' }, el('b', { text: cic ? `${cic.nome} (ciclone)` : `${fmtLat(lat)} ${fmtLon(lon)}` }),
    el('button', { type: 'button', class: 'globo-fechar', 'aria-label': 'Fechar', text: '×', onclick: fecharPainel }));
  const frase = el('p', { class: 'globo-frase', text: fraseSimples(gfs, null, cic) });
  const linha = el('p', { class: 'globo-numeros', text: numerosSimples(gfs) });
  const quando = el('p', { class: 'globo-quando', text: G.hora === G.horaAgora ? 'Previsão do modelo para agora.' : `Previsão do modelo para ${G.dom.rotuloHora.textContent}.` });
  const detalhe = el('button', { type: 'button', class: 'globo-detalhe', text: 'Ver detalhes', onclick: () => detalhesPonto(lat, lon, gfs, P.dadosOm, cic) });
  P.replaceChildren(titulo, frase, linha, quando, detalhe);
  P.hidden = false;
  P.dadosOm = null;
  if (soGfs || G.hora !== G.horaAgora) return;
  try {
    const om = await buscarPonto(lat, lon);
    if (G.tocado?.lat !== lat) return;
    P.dadosOm = om;
    frase.textContent = fraseSimples(gfs, om, cic);
    linha.textContent = numerosSimples(gfs, om);
    const pl = partesLocais(om.atual.ms || Date.now(), om.offset || 0);
    quando.textContent = `Agora lá são ${String(pl.hora).padStart(2, '0')}:${String(pl.minuto).padStart(2, '0')}${om.fuso ? ` (${om.fuso.replace(/_/g, ' ')})` : ''}.`;
  } catch { quando.textContent += ' Sem resposta da previsão detalhada deste ponto.'; }
}

function fraseSimples(gfs, om, cic) {
  if (cic) return `Ciclone ativo${valido(cic.ventoKmh) ? ` com ventos de ${fmt.kmh(cic.ventoKmh)}` : ''}. Siga os avisos oficiais da região.`;
  const a = om?.atual;
  if (a && valido(a.weather_code)) {
    let t = textoCodigoTempo(a.weather_code, a.is_day !== 0);
    if (valido(a.wind_gusts_10m) && a.wind_gusts_10m >= 60) t += ', com rajadas fortes';
    return t + '.';
  }
  if (!gfs) return 'Carregando os dados deste ponto…';
  const partes = [];
  if (valido(gfs.chuvaMmH) && gfs.chuvaMmH >= 0.3) partes.push(gfs.chuvaMmH >= 5 ? 'Chuva forte' : gfs.chuvaMmH >= 1.5 ? 'Chuva' : 'Chuva fraca');
  else if (valido(gfs.nuvens)) partes.push(gfs.nuvens >= 80 ? 'Nublado' : gfs.nuvens >= 40 ? 'Parcialmente nublado' : 'Céu limpo');
  if (valido(gfs.rajadaKmh) && gfs.rajadaKmh >= 60) partes.push('rajadas fortes');
  else if (valido(gfs.ventoKmh) && gfs.ventoKmh >= 30) partes.push('vento forte');
  return (partes.join(', ') || 'Sem dados neste ponto') + '.';
}

function numerosSimples(gfs, om) {
  const a = om?.atual;
  const t = valido(a?.temperature_2m) ? a.temperature_2m : gfs?.temp;
  const v = valido(a?.wind_speed_10m) ? a.wind_speed_10m : gfs?.ventoKmh;
  const r = valido(a?.wind_gusts_10m) ? a.wind_gusts_10m : gfs?.rajadaKmh;
  const d = valido(a?.wind_direction_10m) ? a.wind_direction_10m : gfs?.direcao;
  const partes = [];
  if (valido(t)) partes.push(fmt.c(Math.round(t)));
  if (valido(v)) partes.push(`vento ${fmt.kmh(Math.round(v))}${valido(d) ? ` de ${direcaoTexto(d)}` : ''}`);
  if (valido(r) && r > (v || 0) + 5) partes.push(`rajadas ${fmt.kmh(Math.round(r))}`);
  return partes.join(' · ');
}

function detalhesPonto(lat, lon, gfs, om, cic) {
  const linhas = [];
  const tr = (k, v) => el('tr', {}, el('th', { text: k }), el('td', { text: v ?? 'sem dado' }));
  if (cic) linhas.push(tr('Sistema', cic.nome), tr('Classificação', cic.tipo), tr('Vento máximo', fmt.kmh(cic.ventoKmh) ?? 'sem dado'), tr('Pressão central', fmt.hpa(cic.pressaoHpa) ?? 'sem dado'), tr('Fonte', `${cic.fonte} · ${cic.atualizado}`));
  linhas.push(tr('Coordenadas', `${fmt.n(lat, 2)}, ${fmt.n(lon, 2)}`));
  if (om) {
    const a = om.atual;
    linhas.push(tr('Fuso horário', `${om.fuso} (${om.fusoAbrev})`), tr('Altitude do modelo', valido(om.elevacao) ? `${fmt.n(om.elevacao)} m` : null),
      tr('Temperatura (ECMWF)', fmt.c1(a.temperature_2m)), tr('Sensação (ECMWF)', fmt.c1(a.apparent_temperature)), tr('Umidade', valido(a.relative_humidity_2m) ? `${fmt.n(a.relative_humidity_2m)}%` : null),
      tr('Vento (ECMWF)', valido(a.wind_speed_10m) ? `${fmt.kmh(a.wind_speed_10m)} de ${direcaoTexto(a.wind_direction_10m)}` : null), tr('Rajada (ECMWF)', fmt.kmh(a.wind_gusts_10m)),
      tr('Chuva na última hora (ECMWF)', fmt.mm(a.precipitation)), tr('Nuvens (ECMWF)', valido(a.cloud_cover) ? `${fmt.n(a.cloud_cover)}%` : null), tr('Pressão (ECMWF)', fmt.hpa(a.pressure_msl)));
    const prox = om.horas.filter((h) => h.ms > Date.now() && h.ms <= Date.now() + 24 * 3600000);
    const chuva = prox.reduce((s, h) => s + (h.precipitation || 0), 0);
    const rajMax = Math.max(0, ...prox.map((h) => h.wind_gusts_10m || 0));
    const probMax = Math.max(0, ...prox.map((h) => h.precipitation_probability || 0));
    linhas.push(tr('Próximas 24 h (ECMWF)', `chuva ${fmt.mm(chuva)}, chance máxima ${fmt.n(probMax)}%, rajada até ${fmt.kmh(Math.round(rajMax))}`));
  }
  if (gfs) {
    linhas.push(tr('Temperatura (GFS)', fmt.c1(gfs.temp)), tr('Vento (GFS)', valido(gfs.ventoKmh) ? `${fmt.kmh(Math.round(gfs.ventoKmh))} de ${direcaoTexto(gfs.direcao)}` : null),
      tr('Rajada (GFS)', fmt.kmh(valido(gfs.rajadaKmh) ? Math.round(gfs.rajadaKmh) : null)), tr('Chuva (GFS)', valido(gfs.chuvaMmH) ? `${fmt.n(gfs.chuvaMmH, 1)} mm/h` : null),
      tr('Pressão (GFS)', fmt.hpa(gfs.pressao)), tr('Nuvens (GFS)', valido(gfs.nuvens) ? `${fmt.n(gfs.nuvens)}%` : null));
  }
  const m = G.manifest;
  const nota = el('p', { class: 'nota', text: `GFS 0,5° (NOAA), rodada ${m?.gfs?.rodada ? fmt.horaMin(Date.parse(m.gfs.rodada), -new Date().getTimezoneOffset() * 60) : '–'}, lido na grade de 55 km. ECMWF IFS pela Open-Meteo (CC BY 4.0), no ponto exato. Quando os dois discordam, a previsão naquele local é menos confiável.` });
  mostrarInfo('Detalhes do ponto', el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)), nota);
}

function mostrarAjuda() {
  const m = G.manifest;
  mostrarInfo('Globo do tempo',
    el('p', { text: 'Arraste para girar, pince ou use a roda para aproximar, toque duas vezes para chegar perto. Toque num ponto para ver o tempo lá, com detalhes num segundo toque.' }),
    el('p', { text: 'O lado escuro é a noite real: o terminador é calculado pela posição do Sol neste instante. As luzes são das cidades (NASA Black Marble). Ao mudar a hora na linha do tempo, o Sol acompanha.' }),
    el('ul', {},
      el('li', {}, 'Nuvens: imagem infravermelha dos satélites GOES-Leste, GOES-Oeste e Himawari (NASA GIBS), onde há cobertura; no resto, nuvens previstas pelo GFS.'),
      el('li', {}, 'Vento, chuva, temperatura e pressão: modelo GFS 0,5° da NOAA, a cada 3 h até 48 h.'),
      el('li', {}, 'Ponto tocado: ECMWF IFS pela Open-Meteo, com fuso horário local.'),
      el('li', {}, 'Ciclones: NHC e GDACS. Raios em tempo real não têm fonte pública gratuita que o app possa usar.')),
    el('p', { class: 'nota', text: `Texturas: NASA Visible Earth (Blue Marble e Black Marble, domínio público). Dados gerados ${m?.gerado ? fmt.idade(Date.parse(m.gerado)) : '–'}. Este globo é um painel pessoal, não uma fonte oficial. Em situação de risco, siga a Defesa Civil e o INMET.` }));
}

// ------------------------------------------------------------------ 9. laço de animação e qualidade

function laco(agora) {
  G.anim = G.aberto ? requestAnimationFrame(laco) : 0;
  if (!G.aberto || document.hidden) return;
  const dt = Math.min(100, agora - G.ultimoQuadro); G.ultimoQuadro = agora;
  medirQualidade(dt);
  const c = G.cam;
  if (G.animCam) {
    const a = G.animCam, t = Math.min(1, (agora - a.t0) / a.ms), e = 1 - Math.pow(1 - t, 3);
    c.lat = a.de.lat + (a.para.lat - a.de.lat) * e; c.lon = a.de.lon + (a.para.lon - a.de.lon) * e; c.dist = a.de.dist + (a.para.dist - a.de.dist) * e;
    if (t >= 1) G.animCam = null;
  } else {
    if (G.autoGira) c.lon += 0.004 * dt;
    if (Math.abs(c.vLon) > 0.001 || Math.abs(c.vLat) > 0.001) {
      c.lon += c.vLon * dt / 16; c.lat = Math.max(-85, Math.min(85, c.lat + c.vLat * dt / 16));
      const amort = Math.pow(0.92, dt / 16); c.vLon *= amort; c.vLat *= amort;
    }
  }
  if (G.quadro % 30 === 0) atualizarAstros();
  if (G.camada === 'pressao') G.terra.material.uniforms.isobaras.value = Math.max(0, Math.min(1, (2.6 - c.dist) / 0.8));
  posicionarCamera();
  const pulso = (Math.sin(agora / 500) + 1) / 2;
  for (const m of [G.marcadorUsuario, G.marcadorToque, ...G.ciclones]) { const p = m.getObjectByName('pulso'); if (p) { p.scale.setScalar(1 + pulso * 1.6); p.material.opacity = 0.6 * (1 - pulso); } }
  if (G.particulas) animarParticulas(dt);
  G.renderer.render(G.cena, G.camera);
  G.quadro++;
}

/** Mede o tempo por quadro; se ficar lento (menos de 30 fps por ~3 s), baixa a resolução e as partículas, uma vez por nível. */
function medirQualidade(dt) {
  G.tempos.push(dt);
  if (G.tempos.length < 120) return;
  const media = G.tempos.reduce((s, v) => s + v, 0) / G.tempos.length;
  G.tempos = [];
  if (media > 36 && G.nivelQualidade < 3) {
    G.nivelQualidade++;
    G.pixelRatio = Math.max(1, G.pixelRatio - 0.4);
    G.renderer.setPixelRatio(G.pixelRatio);
    if (G.particulas && G.nivelQualidade >= 2) iniciarParticulas(G.particulas.campo);
    if (G.nivelQualidade >= 3) { G.atmosfera.visible = false; }
  }
}
