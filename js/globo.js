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
import { el, svg, fmt, prefs, mostrarInfo, linkExterno } from './ui.js';
import { buscarManifest, buscarCampo, buscarSatelite, buscarSatelites, lerPontoGfs, buscarPonto, textoCodigoTempo, valorDoByte, amostrar } from './globo-dados.js';
import { criarRegiao } from './globo-regiao.js';
import { criarContornos } from './globo-contornos.js';
import { criarGrade, meiaVisao, obliquidade } from './globo-grade.js';
import { CIDADES } from './globo-cidades.js';
import { pontoSubsolar, pontoSublunar } from './globo-astro.js';
import { faseLua, registroSatelite } from './ceu.js';
import { cartaoAstro, criarBlocoCeu } from './globo-ceu.js';
import { texturaPlaneta, texturaBrilho } from './globo-texturas.js';
import { criarEstrelas, ajustarEscalaEstrelas } from './globo-estrelas.js';
import { valido, direcaoTexto, partesLocais } from './analise.js';

// ------------------------------------------------------------------ 1. estado e constantes

const RAD = Math.PI / 180;
const RAIO = 1;
const DIST = { min: 1.0005, cidade: 1.08, inicial: 2.7, max: 12 }; // raio da Terra = 1; min: ~3 km de altura (ruas no mapa); cidade: ~500 km
const MOVIMENTO_REDUZIDO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CELULAR = matchMedia('(pointer: coarse)').matches;

/** Camadas visíveis no seletor. canal: canal do PNG (0 R, 1 G, 2 B, 3 = módulo de RG, para vento). */
const CAMADAS = [
  { id: 'nuvens', nome: 'Nuvens' },
  { id: 'vento', nome: 'Vento', arquivo: 'vento', canal: 3, faixaCor: [0, 120], unidade: 'km/h', fator: 3.6,
    cores: [[0, 90, 200, 190, 0], [15, 90, 200, 190, 0.25], [30, 90, 220, 140, 0.45], [50, 240, 210, 70, 0.6], [75, 240, 130, 50, 0.7], [100, 220, 50, 50, 0.78], [120, 140, 20, 110, 0.85]] },
  { id: 'chuva', nome: 'Chuva', arquivo: 'campo', canal: 2, faixaCor: [0, 30], unidade: 'mm/h', fator: 1,
    cores: [[0, 80, 170, 230, 0], [0.3, 80, 170, 230, 0.35], [1, 60, 130, 230, 0.6], [4, 40, 80, 210, 0.75], [10, 120, 50, 190, 0.85], [20, 200, 40, 150, 0.9], [30, 255, 90, 120, 0.95]] },
  { id: 'temp', nome: 'Temperatura', arquivo: 'campo', canal: 0, faixaCor: [-40, 45], unidade: '°C', fator: 1,
    cores: [[-40, 120, 40, 170, 0.8], [-20, 60, 70, 200, 0.8], [-5, 70, 150, 220, 0.8], [5, 90, 200, 200, 0.8], [15, 110, 200, 110, 0.8], [25, 240, 210, 70, 0.8], [32, 240, 130, 50, 0.8], [40, 215, 50, 50, 0.82], [45, 150, 20, 90, 0.85]] },
  { id: 'pressao', nome: 'Pressão', arquivo: 'campo', canal: 1, faixaCor: [960, 1050], unidade: 'hPa', fator: 1,
    cores: [[960, 110, 40, 180, 0.8], [985, 60, 90, 210, 0.75], [1000, 80, 160, 220, 0.6], [1013, 190, 200, 210, 0.45], [1025, 240, 190, 90, 0.6], [1040, 235, 120, 50, 0.75], [1050, 200, 50, 40, 0.8]] },
];

/** Estado do globo (um só, porque há uma aba só). */
const G = {
  aberto: false, pronto: false, dom: null, estadoApp: null,
  renderer: null, cena: null, camera: null, terra: null, nuvens: null, atmosfera: null, estrelas: null, lua: null,
  marcadorUsuario: null, marcadorToque: null, ciclones: [],
  cam: { lat: -29.7, lon: -51.1, dist: DIST.inicial, vLat: 0, vLon: 0 }, animCam: null, autoGira: !MOVIMENTO_REDUZIDO, chegou: false,
  camada: 'nuvens', hora: null, horaAgora: null, manifest: null, manifestAntigo: false, satelite: null,
  texturas: {}, relogio: null, quadro: 0, ultimoQuadro: 0, tempos: [], nivelQualidade: 0, pixelRatio: 1,
  particulas: null, tocado: null, erroDados: null, anim: 0, tempoLinha: { tocando: false, timer: null },
  espaco: null, espacoAberto: false, sistema: false, livre: null,
  foco: null, focoAlvo: null, animFoco: null, focoDistMin: 0.3, // sistema solar: ponto em volta do qual a câmera gira
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
  if (!G.dom) {
    montarDom(secao);
    G.dadosProntos = new Promise((ok) => { G.marcarDadosProntos = ok; });
    G.blocoCeu = criarBlocoCeu(secao, () => G.estadoApp, estacoesDoCeu, ajustarTamanho);
  }
  G.blocoCeu.atualizar();
  G.aberto = true;
  if (!G.renderer) {
    try { montarCena(); } catch (e) { mostrarAviso('Este aparelho não conseguiu abrir o globo em 3D (WebGL indisponível).', true); return; }
    carregarTudo();
  }
  atualizarMarcadorUsuario();
  ajustarTamanho();
  G.ultimoQuadro = performance.now();
  if (!G.anim) G.anim = requestAnimationFrame(laco);
  if (!G.verificador) G.verificador = setInterval(verificarAtualizacao, VERIFICA_MS);
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
    }, undefined, () => { delete G.texturas[url]; falha(new Error('textura não carregou: ' + url)); }); // sem memorizar a falha: dá para tentar de novo
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
    irPara(l?.lat ?? -29.7, l?.lon ?? -51.1, l ? DIST.cidade : DIST.inicial, 2600); // com localização, chega já na cidade
    G.chegou = true;
  } catch { mostrarAviso('Não foi possível carregar a imagem da Terra. Verifique a conexão e toque em atualizar.', true); return; }
  textura('vendor/texturas/terra-dia-4096.jpg', { cor: true }).then((t) => { u.tDia.value = t; }).catch(() => {});
  textura('vendor/texturas/terra-normal-2048.jpg').then((t) => { u.tNormal.value = t; u.temNormal.value = 1; }).catch(() => {});
  textura('vendor/texturas/terra-noite-2048.jpg', { cor: true }).then((t) => { u.tNoite.value = t; u.temNoite.value = 1; return textura('vendor/texturas/terra-noite-4096.jpg', { cor: true }); })
    .then((t) => { u.tNoite.value = t; }).catch(() => {});
  textura('vendor/texturas/terra-mascaras-2048.png').then((t) => { u.tMascaras.value = t; u.temMascaras.value = 1; }).catch(() => {});
  await carregarDados(); // o painel de um ponto só abre com toque (não abre sozinho na chegada)
  // contornos e cidades do mundo (1,9 MB) depois dos dados de tempo, para não disputar a conexão com eles
  G.contornos.carregar().catch((e) => console.warn('Globo: contornos indisponíveis', e))
    .then(() => carregarCidadesMundo()).catch((e) => console.warn('Globo: cidades do mundo indisponíveis', e));
  G.marcarDadosProntos();
  prepararEspacoAntes();
}

/** ISS e Tiangong para o bloco "Céu de hoje" (mesmos elementos do CelesTrak que o espaço usa). */
async function estacoesDoCeu() {
  await Promise.race([G.dadosProntos, new Promise((ok) => setTimeout(ok, 15000))]); // sem Terra ou sem rede, segue sem as estações
  if (!G.manifest) throw new Error('sem dados do globo');
  const dados = await buscarSatelites(G.manifest);
  return [['iss', 'ISS (ZARYA)'], ['css', 'CSS (TIANHE)']].map(([id, nome]) => {
    const omm = (dados.grupos.estacoes || []).find((o) => o.OBJECT_NAME === nome);
    const rec = omm && registroSatelite(omm);
    return rec ? { id, rec, omm } : null;
  }).filter(Boolean);
}

/**
 * Pré-carrega o espaço (módulo, satélites, sondas, texturas e a cena do sistema solar) logo depois que a Terra e os
 * dados aparecem, num momento ocioso: quando o usuário tocar em Espaço, tudo já está pronto.
 */
function prepararEspacoAntes() {
  const ir = () => {
    if (!G.espacoModulo) G.espacoModulo = import('./globo-espaco.js').catch(() => null);
    G.espacoModulo.then((m) => { if (m) { G.espaco = m; m.prepararEspaco(G, THREE).then?.(prepararGalaxiaAntes); } });
  };
  if (window.requestIdleCallback) requestIdleCallback(ir, { timeout: 2500 }); else setTimeout(ir, 600);
}

/** Escala de galáxias: módulo e dados (imagem do modelo, partículas, catálogos) preparados depois do sistema solar, sem pressa. */
function prepararGalaxiaAntes() {
  const ir = () => {
    if (!G.galaxiaModulo) G.galaxiaModulo = import('./globo-galaxia.js').catch(() => null);
    G.galaxiaModulo.then((m) => m?.prepararGalaxia(G, THREE).catch(() => { G.galaxiaModulo = null; }));
  };
  if (window.requestIdleCallback) requestIdleCallback(ir, { timeout: 4000 }); else setTimeout(ir, 1500);
}

/** Abre a Via Láctea vista de fora a partir do sistema solar (sai da navegação livre; a órbita da câmera passa a ser em kpc). */
async function abrirGalaxia() {
  if (!G.galaxiaModulo) G.galaxiaModulo = import('./globo-galaxia.js').catch(() => null);
  const m = await G.galaxiaModulo;
  if (!m || !G.sistema) return;
  mostrarAviso('Preparando a Via Láctea…', false);
  try { await m.prepararGalaxia(G, THREE); } catch (e) { G.galaxiaModulo = null; mostrarAviso(`Não foi possível carregar a Via Láctea (${e.message}).`, false); return; }
  esconderAviso();
  if (G.livre) navegacaoLivre(false);
  fecharPainel();
  G.camAntesGalaxia = { ...G.cam, foco: G.foco.clone() };
  G.animFoco = null; G.animCam = null;
  G.galaxia = m;
  G.dom.raiz.classList.add('com-galaxia');
  m.abrirGalaxia();
}

function fecharGalaxia() {
  if (!G.galaxia) return;
  G.galaxia.fecharGalaxia();
  G.galaxia = null;
  G.dom.raiz.classList.remove('com-galaxia');
  fecharPainel();
  const a = G.camAntesGalaxia;
  if (a) { G.cam.lat = a.lat; G.cam.lon = a.lon; G.cam.dist = a.dist; G.cam.vLat = G.cam.vLon = 0; G.foco.copy(a.foco); }
}

/**
 * Lê o manifest do branch globo-dados e carrega a hora mais próxima de agora. Cada parte (nuvens, camada, temperaturas
 * das cidades) carrega por conta própria: a falha de uma não apaga as outras. Sem manifest, tenta de novo sozinho
 * (30 s, 1 min, 2 min, até 5 min), quando a conexão volta e quando a aba volta a ficar visível.
 */
async function carregarDados() {
  try {
    const { manifest, antigo, erro } = await buscarManifest();
    if (!manifest.gfs?.horas?.length) throw new Error('sem campos do GFS');
    G.manifest = manifest; G.manifestAntigo = antigo; G.erroDados = antigo ? erro || null : null;
    G.horaAgora = horaMaisProxima(manifest);
    G.hora = G.horaAgora;
    montarLinhaDoTempo();
    await carregarHora(G.hora);
    marcarCiclones();
    pararNovasTentativas();
    if (antigo) agendarNovaTentativa(); // dados guardados: continua tentando os atuais
  } catch (e) {
    G.erroDados = e;
    mostrarAviso(`Os dados de tempo ainda não chegaram (${motivoErro(e)}). Tentando de novo…`, false);
    agendarNovaTentativa();
  }
  atualizarNotaFonte();
}

/** Nuvens, camada ativa e temperaturas das cidades de uma hora, cada uma independente das outras. */
async function carregarHora(h) {
  const r = await Promise.allSettled([carregarNuvens(h), carregarCamada(G.camada, h), atualizarTemperaturasCidades()]);
  const falha = r.find((x) => x.status === 'rejected');
  if (falha) console.warn('Globo: parte dos dados não carregou', falha.reason);
}

const motivoErro = (e) => e?.tipo === 'offline' ? 'sem conexão' : e?.tipo === 'tempo' ? 'conexão lenta' : e?.message || 'falha de conexão';

function agendarNovaTentativa() {
  if (G.novaTentativa) return;
  const n = G.tentativas = (G.tentativas || 0) + 1;
  const espera = Math.min(300000, 30000 * 2 ** (n - 1));
  G.novaTentativa = setTimeout(tentarDeNovo, espera);
  if (!G.ouvindoConexao) {
    G.ouvindoConexao = true;
    window.addEventListener('online', tentarDeNovo);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && G.novaTentativa) tentarDeNovo(); });
  }
}

function pararNovasTentativas() { clearTimeout(G.novaTentativa); G.novaTentativa = null; G.tentativas = 0; }

/** Nova tentativa: sem manifest, recarrega tudo; com dados guardados, a verificação periódica troca pelos atuais. */
function tentarDeNovo() {
  clearTimeout(G.novaTentativa); G.novaTentativa = null;
  if (G.carregandoDados) return;
  G.carregandoDados = true;
  const fim = () => { G.carregandoDados = false; };
  if (!G.manifest) carregarDados().finally(fim);
  else { G.ultimaVerificacao = 0; verificarAtualizacao(true).finally(() => { fim(); if (G.manifestAntigo) agendarNovaTentativa(); else pararNovasTentativas(); }); }
}

/** Nuvens: mosaico de satélite para a hora de agora; campo do modelo para as outras horas (ou se o satélite faltar). */
async function carregarNuvens(hora) {
  const m = G.manifest;
  let modelo = null, sat = null;
  try { modelo = await buscarCampo(m, 'nuvens', hora); } catch {}
  if (hora === G.horaAgora && m.satelite) { try { sat = await buscarSatelite(m); G.satelite = sat; } catch {} }
  if (G.hora !== hora) return; // o usuário já mudou a hora enquanto carregava: quem chegou por último não pode sobrescrever
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
  if (G.camada === 'nuvens') { montarLegenda(CAMADAS.find((c) => c.id === 'nuvens'), null); atualizarNotaFonte(); }
}

/** Opacidade das nuvens pela camada: cheia em Nuvens, discreta com dados por cima. */
function opacidadeNuvens() { return CAMADAS.find((x) => x.id === G.camada)?.arquivo ? 0.3 : 1; }

const suave = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ 4. cena

const VERTEX_TERRA = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vP = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  }`;

const FRAGMENT_TERRA = /* glsl */`
  uniform sampler2D tDia, tNoite, tNormal, tMascaras, tNuvens, tCamada, tEscala, tRegiao;
  uniform float temNormal, temNoite, temMascaras, temNuvens, temCamada, opacidade, raiz, isobaras, temRegiao, luzLua;
  uniform vec2 regLon, regMerc; // mosaico da região (globo-regiao.js): longitudes e limites Mercator do mosaico
  uniform float passoGrade, opGrade, latTropico; // grade de coordenadas: espaçamento em graus e opacidade (0 = desligada)
  uniform vec3 sol, lua, olho; uniform vec2 faixaCanal, faixaCor, desloc; uniform int canal;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  uniform vec2 grade; // colunas e linhas da grade de dados (coluna 0 em -180°, linha 0 em +90°, última linha em -90°)
  vec2 uvDados(vec2 uv) { return vec2(fract(uv.x + 0.5 / grade.x), ((1.0 - uv.y) * (grade.y - 1.0) + 0.5) / grade.y); }
  // linha de 1 pixel em cada múltiplo de 'passo' (antisserrilhada por fwidth); 0 onde a derivada estoura (antimeridiano)
  float linhaGrade(float v, float passo) {
    float f = v / passo; float w = fwidth(f);
    if (w > 0.25) return 0.0;
    float d = abs(fract(f + 0.5) - 0.5);
    return 1.0 - smoothstep(w * 0.2, w * 0.9, d);
  }
  float linhaEm(float v, float alvo, float largura) { float w = fwidth(v) * largura; return 1.0 - smoothstep(w * 0.2, w * 0.9, abs(v - alvo)); }
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
    // terminador: a luz do dia some entre o Sol 3° acima e 3° abaixo do horizonte (refração e crepúsculo civil);
    // as luzes das cidades acendem do pôr do Sol até o fim do crepúsculo civil (Sol a −6°)
    float dia = smoothstep(-0.05, 0.08, cosSol);
    float noite = 1.0 - smoothstep(-0.10, 0.0, cosSol);
    // cor da superfície: imagem da NASA ou, no zoom próximo, o mapa detalhado (os dois recebem a mesma luz do Sol e da Lua)
    vec3 alb = texture2D(tDia, vUv).rgb;
    float noMapa = 0.0;
    if (temRegiao > 0.0) { // mapa detalhado da região sob a câmera, em Mercator
      // latitude e longitude pela direção do fragmento (não pela UV interpolada na face): o mapa fica exatamente
      // onde estão os marcadores, os rótulos e o ponto tocado (pontoDesenhado usa a mesma direção)
      vec3 dir = normalize(vP);
      float lat = asin(clamp(dir.y, -1.0, 1.0)), lon = -atan(dir.z, dir.x) * 57.2957795;
      float u = (lon - regLon.x) / (regLon.y - regLon.x);
      float merc = log(tan(0.78539816 + lat * 0.5));
      float w = (regMerc.x - merc) / (regMerc.x - regMerc.y);
      if (u > 0.0 && u < 1.0 && w > 0.0 && w < 1.0) {
        float borda = smoothstep(0.0, 0.06, u) * smoothstep(0.0, 0.06, 1.0 - u) * smoothstep(0.0, 0.06, w) * smoothstep(0.0, 0.06, 1.0 - w);
        noMapa = temRegiao * borda;
        alb = mix(alb, texture2D(tRegiao, vec2(u, w)).rgb, noMapa);
      }
    }
    float lamb = mix(max(dot(Nd, sol), 0.0), max(cosSol, 0.0), 0.45 + 0.55 * noMapa);
    // dia claro por igual (como numa foto de satélite), escurecendo só perto do terminador
    vec3 cor = alb * 1.3 * pow(lamb, 0.5) * dia;
    // faixa estreita e quente do nascer e do pôr do Sol
    float tw = exp(-pow((cosSol - 0.02) / 0.06, 2.0));
    cor = mix(cor, cor * vec3(1.25, 0.85, 0.62), tw * 0.35);
    float agua = temMascaras > 0.5 ? texture2D(tMascaras, vUv).r * (1.0 - noMapa) : 0.0;
    vec3 H = normalize(sol + V);
    // reflexo do Sol no mar: discreto e largo, como nas fotos da Terra inteira (não um ponto estourado)
    float brilho = pow(max(dot(N, H), 0.0), 48.0) * agua * dia;
    cor += vec3(1.0, 0.95, 0.85) * brilho * 0.22;
    cor += vec3(0.5, 0.7, 1.0) * pow(max(dot(N, H), 0.0), 8.0) * agua * dia * 0.05;
    float nuvemAqui = 0.0;
    if (temNuvens > 0.5) {
      float sombra = texture2D(tNuvens, vec2(fract(vUv.x + desloc.x), 1.0 - vUv.y + desloc.y)).r;
      nuvemAqui = texture2D(tNuvens, vec2(vUv.x, 1.0 - vUv.y)).r;
      cor *= 1.0 - 0.42 * sombra * dia;
    }
    // noite quase preta, com um azul muito leve; o luar clareia pela fase (luzLua = fração iluminada) e pela altura da Lua
    float luar = luzLua * max(dot(Nd, lua), 0.0);
    cor += alb * (vec3(0.008, 0.011, 0.022) + vec3(0.11, 0.14, 0.21) * luar) * (1.0 - dia);
    // à noite o mapa detalhado continua legível, em tons escuros e frios (como um mapa noturno): a imagem de luzes da
    // NASA tem 10 km por pixel e, esticada no zoom de rua, vira manchas; sobre o mapa ela fica só como brilho leve
    cor += alb * vec3(0.17, 0.19, 0.26) * noMapa * (1.0 - dia);
    if (temNoite > 0.5) { // luzes das cidades (NASA Black Marble), apagadas pelas nuvens por cima
      vec3 luzes = texture2D(tNoite, vUv).rgb;
      cor += pow(luzes, vec3(0.9)) * vec3(1.0, 0.82, 0.55) * noite * 5.0 * (1.0 - 0.75 * nuvemAqui) * (1.0 - 0.8 * noMapa);
    }
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
    if (opGrade > 0.0) { // grade de latitude e longitude, equador e meridiano de Greenwich mais marcados, trópicos e círculos polares tracejados
      vec3 dg = normalize(vP);
      float latG = asin(clamp(dg.y, -1.0, 1.0)) * 57.2957795, lonG = -atan(dg.z, dg.x) * 57.2957795;
      float g = max(linhaGrade(latG, passoGrade), linhaGrade(lonG, passoGrade)) * 0.5;
      g = max(g, max(linhaEm(latG, 0.0, 1.5), linhaEm(lonG, 0.0, 1.5)) * 0.9);
      float traco = step(0.5, fract(lonG / max(passoGrade * 0.25, 0.05)));
      float esp = max(max(linhaEm(latG, latTropico, 1.2), linhaEm(latG, -latTropico, 1.2)), max(linhaEm(latG, 90.0 - latTropico, 1.2), linhaEm(latG, latTropico - 90.0, 1.2)));
      cor = mix(cor, vec3(0.86, 0.9, 0.96), g * opGrade * 0.38);
      cor = mix(cor, vec3(1.0, 0.82, 0.45), esp * traco * opGrade * 0.45);
    }
    float fr = pow(1.0 - max(dot(N, V), 0.0), 3.2);
    cor += vec3(0.33, 0.52, 1.0) * fr * (0.04 + 0.96 * dia) * 0.55;
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
    float dia = smoothstep(-0.05, 0.08, cosSol);
    vec3 cor = vec3(1.0, 0.99, 0.97) * (0.08 + 0.95 * pow(max(cosSol, 0.0), 0.5));
    float tw = exp(-pow((cosSol - 0.02) / 0.06, 2.0));
    cor = mix(cor, cor * vec3(1.3, 0.82, 0.6), tw * 0.45);
    // à noite as nuvens são só uma sombra escura que cobre as luzes, sem manchas cinzas
    cor = mix(vec3(0.012, 0.015, 0.025), cor, dia);
    float borda = pow(max(dot(N, V), 0.0), 0.45);
    gl_FragColor = vec4(cor, a * mix(0.55, 0.96, dia) * borda * opacNuvem);
  }`;

const FRAGMENT_ATMOSFERA = /* glsl */`
  uniform vec3 sol, olho; varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(olho - vP);
    float f = 1.0 - max(dot(N, V), 0.0);
    float a = pow(f, 3.0) * smoothstep(0.0, 1.0, f * 1.4);
    float dia = smoothstep(-0.2, 0.3, dot(N, sol));
    vec3 cor = mix(vec3(0.25, 0.45, 0.95), vec3(0.55, 0.75, 1.0), f);
    float tw = exp(-pow(dot(N, sol) / 0.18, 2.0));
    cor = mix(cor, vec3(1.0, 0.6, 0.35), tw * 0.35);
    gl_FragColor = vec4(cor, a * (0.03 + 0.97 * dia) * 0.9);
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
  G.foco = new THREE.Vector3();

  // Malha fina: a esfera desenhada é um poliedro, e no zoom de cidade a face fica abaixo da esfera ideal
  // (com 96 x 72 faces, até 3,5 km no meio da face), o que desloca o mapa visto em relação a marcadores e toques.
  // Com 256 x 192 a diferença cai para menos de 0,5 km; são 98 mil triângulos, folgado para a placa do celular.
  const seg = [256, 192];
  const uniTerra = {
    tDia: { value: null }, tNoite: { value: null }, tNormal: { value: null }, tMascaras: { value: null }, tNuvens: { value: null }, tCamada: { value: null }, tEscala: { value: null },
    temNormal: { value: 0 }, temNoite: { value: 0 }, temMascaras: { value: 0 }, temNuvens: { value: 0 }, temCamada: { value: 0 },
    opacidade: { value: 0 }, raiz: { value: 0 }, isobaras: { value: 0 }, canal: { value: 0 }, luzLua: { value: 0 },
    sol: { value: new THREE.Vector3(1, 0, 0) }, lua: { value: new THREE.Vector3(0, 0, 1) }, olho: { value: new THREE.Vector3() }, faixaCanal: { value: new THREE.Vector2(0, 1) }, faixaCor: { value: new THREE.Vector2(0, 1) }, grade: { value: new THREE.Vector2(720, 361) },
    desloc: { value: new THREE.Vector2(0.0025, 0.0025) },
    passoGrade: { value: 30 }, opGrade: { value: 0 }, latTropico: { value: obliquidade(Date.now()) },
  };
  G.regiao = criarRegiao(THREE, uniTerra);
  G.terra = new THREE.Mesh(new THREE.SphereGeometry(RAIO, seg[0], seg[1]), new THREE.ShaderMaterial({ uniforms: uniTerra, vertexShader: VERTEX_TERRA, fragmentShader: FRAGMENT_TERRA }));
  G.cena.add(G.terra);
  G.contornos = criarContornos(THREE);
  G.cena.add(G.contornos.grupo);
  G.grade = criarGrade({ THREE, uniformes: uniTerra, camada: G.dom.grade, latLonVec });

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

  // céu de fundo: estrelas reais do catálogo, giradas pelo tempo sideral em atualizarAstros
  G.estrelas = criarEstrelas(THREE, G.pixelRatio);
  G.cena.add(G.estrelas.grupo);
  G.estrelas.pronto.then(() => G.estrelas.girar(instanteMostrado())).catch(() => {});

  // Lua: esfera na direção real, iluminada pelo Sol (a fase aparece sozinha), mais perto que a real (14 raios em vez
  // de 60) e com o dobro do tamanho aparente, para ser vista e tocada.
  G.lua = new THREE.Mesh(new THREE.SphereGeometry(0.135, 48, 32), new THREE.MeshStandardMaterial({ map: texturaPlaneta(THREE, 'Lua'), roughness: 1, metalness: 0 }));
  const luzSol = new THREE.DirectionalLight(0xffffff, 2.6); luzSol.name = 'sol';
  // Sol: brilho na direção real, atrás de tudo (a Terra o encobre quando está do outro lado)
  G.solBrilho = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), color: 0xfff1d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  G.solBrilho.scale.setScalar(5.5);
  G.cena.add(G.lua, G.solBrilho, luzSol, new THREE.AmbientLight(0x202430, 0.18));

  G.marcadorUsuario = criarMarcador(0xf2d16b, 0.022);
  G.marcadorToque = criarMarcador(0xffffff, 0.018); G.marcadorToque.visible = false;
  G.cena.add(G.marcadorUsuario, G.marcadorToque);

  // O aparelho pode descartar o contexto WebGL (app em segundo plano, memória baixa). O Three.js recria programas e
  // texturas sozinho quando o contexto volta; aqui só pausamos o laço e avisamos enquanto isso.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.contextoPerdido = true; mostrarAviso('O 3D foi pausado pelo aparelho. Ele volta sozinho em instantes.', true); });
  canvas.addEventListener('webglcontextrestored', () => { G.contextoPerdido = false; esconderAviso(); G.ultimoQuadro = performance.now(); if (G.aberto && !G.anim) G.anim = requestAnimationFrame(laco); });
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

function posicionarMarcador(m, lat, lon, altura = 1.00005) { // rente ao chão (300 m): no zoom de cidade, altura vira deslocamento na tela
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
    posicionarMarcador(m, c.lat, c.lon);
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
  G.solBrilho.position.copy(sol).multiplyScalar(50);
  const sl = pontoSublunar(ms);
  latLonVec(sl.lat, sl.lon, 14, G.lua.position);
  latLonVec(sl.lat, sl.lon, 1, G.terra.material.uniforms.lua.value);
  G.terra.material.uniforms.luzLua.value = faseLua(ms).fracao;
  G.estrelas.girar(ms);
}

function instanteMostrado() {
  if (G.hora === null || G.hora === G.horaAgora || !G.manifest?.gfs) return Date.now();
  return Date.parse(G.manifest.gfs.rodada) + G.hora * 3600000;
}

// ------------------------------------------------------------------ 5. câmera e gestos

function posicionarCamera() {
  const c = G.cam;
  if (G.galaxia) { G.galaxia.posicionar(c); return; } // escala de galáxias: cena e câmera próprias, em kpc
  if (G.livre) { // navegação livre: câmera solta no espaço, apontada por guinada e arfagem
    const L = G.livre;
    const near = Math.max(1e-6, Math.min(0.05, L.escala * 0.1)), far = Math.max(200, Math.min(1e5, L.pos.length() * 3));
    if (Math.abs(near - G.camera.near) > near * 0.25 || G.camera.far !== far) { G.camera.near = near; G.camera.far = far; G.camera.updateProjectionMatrix(); }
    G.camera.position.copy(L.pos);
    G.camera.rotation.set(L.pitch, L.yaw, 0, 'YXZ');
    return;
  }
  if (G.camera.far !== 200) { G.camera.far = 200; G.camera.updateProjectionMatrix(); }
  if (G.sistema) { // sistema solar: a câmera gira em volta do foco (o Sol ou o corpo escolhido)
    const near = Math.max(0.0002, Math.min(0.05, c.dist * 0.02));
    if (Math.abs(near - G.camera.near) > near * 0.25) { G.camera.near = near; G.camera.updateProjectionMatrix(); }
    latLonVec(c.lat, c.lon, c.dist, G.camera.position).add(G.foco);
    G.camera.up.set(0, 1, 0);
    G.camera.lookAt(G.foco);
    return;
  }
  // plano próximo proporcional à altura: perto da superfície (3 km) a Terra não pode ser cortada
  const near = Math.max(0.00005, Math.min(0.05, (c.dist - 1) * 0.25));
  if (Math.abs(near - G.camera.near) > near * 0.25) { G.camera.near = near; G.camera.updateProjectionMatrix(); }
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

/**
 * Gestos no estilo de mapa: o ponto da Terra que está sob o dedo (ou sob o meio dos dois dedos) acompanha o dedo.
 * - Um dedo arrasta; dois dedos aproximam ou afastam em torno do ponto entre eles e também arrastam.
 * - Ao passar de dois dedos para um (e de volta), a âncora é refeita: nada pula.
 * - A inércia usa a velocidade média dos últimos 100 ms, não a do último evento (no iPhone dois eventos podem
 *   chegar com 1 ms de diferença e a velocidade instantânea explode).
 * - Toque curto abre o painel do ponto; dois toques rápidos aproximam.
 */
function configurarGestos() {
  const cv = G.dom.canvas;
  const ponteiros = new Map();
  let gesto = null, toque = null, ultimoToque = 0, historico = [];
  const centro = () => {
    const ps = [...ponteiros.values()];
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length, y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    return { x, y, d: ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0 };
  };
  // Âncora do gesto: ponto da Terra sob o centro dos dedos, a altura no início e a última posição (para quando a âncora cai fora da Terra).
  const ancorar = () => {
    const c = centro();
    gesto = { n: ponteiros.size, ancora: pontoNaTela(c.x, c.y), d0: c.d, dist0: G.cam.dist, ultimo: c };
  };
  const registrar = (agora) => {
    historico.push({ t: agora, lat: G.cam.lat, lon: G.cam.lon });
    while (historico.length > 2 && agora - historico[0].t > 100) historico.shift();
  };
  cv.addEventListener('pointerdown', (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch { /* ponteiro já encerrado pelo sistema */ }
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    G.cam.vLat = G.cam.vLon = 0; G.animCam = null; G.autoGira = false; G.seguir = null;
    historico = [];
    toque = ponteiros.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moveu: 0 } : null;
    ancorar();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = ponteiros.get(e.pointerId);
    if (!p || !gesto) return;
    if (toque) toque.moveu += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
    const c = centro();
    if (G.livre) { // olhar em volta com um dedo; afastar os dedos avança, juntar recua
      const k = G.camera.fov * RAD / G.dom.canvas.clientHeight;
      G.livre.yaw += (c.x - gesto.ultimo.x) * k; G.livre.pitch = Math.max(-1.55, Math.min(1.55, G.livre.pitch + (c.y - gesto.ultimo.y) * k));
      if (gesto.n > 1 && gesto.ultimo.d > 0 && c.d > 0) avancarLivre(c.d / gesto.ultimo.d);
      G.livre.anim = null;
      gesto.ultimo = c;
      return;
    }
    if (gesto.n > 1 && gesto.d0 > 0 && c.d > 0) definirDist(G.sistema ? gesto.dist0 * (gesto.d0 / c.d) : 1 + (gesto.dist0 - 1) * (gesto.d0 / c.d)); // a pinça escala a altura (no sistema, a distância ao foco)
    if (!gesto.ancora || !levarPontoA(gesto.ancora, c.x, c.y)) {
      // âncora fora da Terra (dedo no espaço) ou sistema solar: giro proporcional à altura
      const k = G.sistema ? 0.3 : 0.22 * Math.max(0.0015, (G.cam.dist - 1) / (DIST.inicial - 1));
      G.cam.lon -= (c.x - gesto.ultimo.x) * k / Math.max(0.2, Math.cos(G.cam.lat * RAD));
      G.cam.lat = Math.max(-85, Math.min(85, G.cam.lat + (c.y - gesto.ultimo.y) * k));
    }
    gesto.ultimo = c;
    registrar(performance.now());
  });
  const soltar = (e) => {
    if (!ponteiros.delete(e.pointerId)) return;
    const agora = performance.now();
    if (ponteiros.size > 0) { ancorar(); historico = []; return; } // de dois dedos para um: recomeça a âncora sem pular
    if (G.revelou) { G.revelou = false; toque = null; } // só trouxe os controles de volta
    if (toque && toque.moveu < 8 && agora - toque.t < 400 && e.type === 'pointerup') {
      if (agora - ultimoToque < 320) { if (G.galaxia) G.galaxia.focarNoToque(e.clientX, e.clientY); else if (G.livre) irLivre(e.clientX, e.clientY); else if (G.sistema) G.espaco?.focarNoToque(e.clientX, e.clientY); else aproximar(e.clientX, e.clientY); ultimoToque = 0; }
      else { ultimoToque = agora; tocarPonto(e.clientX, e.clientY); }
    } else if (historico.length >= 2 && agora - historico[historico.length - 1].t < 60) {
      const a = historico[0], b = historico[historico.length - 1], dt = Math.max(16, b.t - a.t);
      let dlon = b.lon - a.lon; dlon = ((dlon + 540) % 360) - 180;
      G.cam.vLon = dlon / dt * 16; G.cam.vLat = (b.lat - a.lat) / dt * 16;
    }
    gesto = null; toque = null; historico = [];
  };
  cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); G.autoGira = false; G.animCam = null; G.cam.vLat = G.cam.vLon = 0;
    if (G.livre) { avancarLivre(Math.exp(-e.deltaY * 0.0015)); return; }
    const ancora = pontoNaTela(e.clientX, e.clientY);
    definirDist(G.sistema ? G.cam.dist * Math.exp(e.deltaY * 0.0012) : 1 + (G.cam.dist - 1) * Math.exp(e.deltaY * 0.0012));
    if (ancora) levarPontoA(ancora, e.clientX, e.clientY); // a roda aproxima em direção ao cursor
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => e.preventDefault());
  cv.addEventListener('keydown', (e) => {
    const passo = 5;
    if (G.livre) {
      const L = G.livre;
      if (e.key === 'ArrowUp' || e.key === 'w') avancarLivre(1.25); else if (e.key === 'ArrowDown' || e.key === 's') avancarLivre(0.8);
      else if (e.key === 'ArrowLeft' || e.key === 'a') L.yaw += 0.08; else if (e.key === 'ArrowRight' || e.key === 'd') L.yaw -= 0.08;
      else return;
      L.anim = null; e.preventDefault(); return;
    }
    if (e.key === 'ArrowLeft') G.cam.lon -= passo; else if (e.key === 'ArrowRight') G.cam.lon += passo;
    else if (e.key === 'ArrowUp') G.cam.lat = Math.min(85, G.cam.lat + passo); else if (e.key === 'ArrowDown') G.cam.lat = Math.max(-85, G.cam.lat - passo);
    else if (e.key === '+' || e.key === '=') definirDist(G.sistema ? G.cam.dist / 1.2 : 1 + (G.cam.dist - 1) / 1.2); else if (e.key === '-') definirDist(G.sistema ? G.cam.dist * 1.2 : 1 + (G.cam.dist - 1) * 1.2);
    else return;
    e.preventDefault(); G.autoGira = false;
  });
}

/** Ponto da Terra sob a posição da tela com a câmera atual (atualiza a matriz antes de medir). */
function pontoNaTela(cx, cy) {
  if (G.sistema) return null; // no sistema solar não há Terra sob o dedo: o arrasto gira a vista
  posicionarCamera();
  G.camera.updateMatrixWorld();
  return pontoSob(cx, cy);
}

/**
 * Gira a câmera para o ponto `alvo` (lat, lon) ficar sob a posição (cx, cy) da tela. Como a câmera sempre olha
 * para o centro da Terra, basta corrigir latitude e longitude pela diferença medida; duas iterações bastam.
 * @returns {boolean} false se a posição da tela não cai sobre a Terra
 */
function levarPontoA(alvo, cx, cy) {
  for (let k = 0; k < 2; k++) {
    const p = pontoNaTela(cx, cy);
    if (!p) return false;
    let dlon = alvo.lon - p.lon; dlon = ((dlon + 540) % 360) - 180;
    G.cam.lon += dlon;
    G.cam.lat = Math.max(-85, Math.min(85, G.cam.lat + (alvo.lat - p.lat)));
  }
  posicionarCamera();
  return true;
}

/** Distância em que a Terra inteira cabe na tela, com folga, qualquer que seja a proporção. */
function distanciaQueCabe() {
  const fovV = G.camera.fov * RAD, fovH = 2 * Math.atan(Math.tan(fovV / 2) * G.camera.aspect);
  return Math.min(DIST.max, 1 / Math.sin(Math.min(fovV, fovH) / 2 * 0.86));
}

function definirDist(d) {
  if (G.galaxia) { const [min, max] = G.galaxia.limitesDistancia(); G.cam.dist = Math.max(min, Math.min(max, d)); return; }
  const max = G.sistema ? DIST_MAX_SISTEMA : DIST.max;
  G.cam.dist = G.sistema ? Math.max(G.focoDistMin || 0.3, Math.min(max, d)) : Math.max(DIST.min, Math.min(max, d)); // no sistema solar, de rente ao corpo em foco até além das Voyager
  seguirAfastando(d, max);
}

/**
 * Zoom sem fim para fora: insistir em afastar no limite de uma escala passa para a seguinte (Terra → sistema solar →
 * Via Láctea → universo próximo). Conta o quanto se pediu além do limite; aproximar zera a conta.
 */
const DIST_MAX_SISTEMA = 40;
function seguirAfastando(pedido, max) {
  if (G.livre || G.animCam) return;
  if (pedido <= max * 1.0001) { G.alemDoLimite = 0; return; }
  G.alemDoLimite = (G.alemDoLimite || 0) + Math.log(pedido / max);
  if (G.alemDoLimite < 0.35 || G.trocandoEscala) return; // uns três toques da roda ou um movimento de pinça
  G.alemDoLimite = 0; G.trocandoEscala = true;
  setTimeout(() => { G.trocandoEscala = false; }, 1500);
  if (G.sistema) { abrirGalaxia(); return; }
  (async () => { // da Terra para o sistema solar: abre o espaço (se preciso) e liga o sistema solar quando ficar pronto
    if (!G.espacoAberto) await alternarEspaco();
    for (let i = 0; i < 40 && G.espacoAberto && !G.sistema; i++) {
      const chip = G.dom.raiz.querySelector('.globo-chip-sistema');
      if (chip && !chip.hidden && !chip.disabled) { chip.click(); break; }
      await new Promise((ok) => setTimeout(ok, 250));
    }
  })();
}

/**
 * Sistema solar: leva o foco da câmera até um corpo e passa a segui-lo (ele se move com o tempo).
 * @param {(()=>THREE.Vector3)|null} posicao posição atual do corpo na cena; null volta ao Sol
 * @param {number} dist distância da câmera ao chegar; distMin o mais perto que o zoom deixa chegar
 */
function focarSistema(posicao, dist, distMin = 0.3) {
  G.focoAlvo = posicao;
  G.focoDistMin = distMin;
  G.animFoco = MOVIMENTO_REDUZIDO ? null : { de: G.foco.clone(), dist0: G.cam.dist, dist, t0: performance.now(), ms: 1100 };
  if (MOVIMENTO_REDUZIDO) { G.cam.dist = dist; G.foco.copy(posicao ? posicao() : new THREE.Vector3()); }
  G.cam.vLat = G.cam.vLon = 0;
}

// ------------------------------------------------------------------ navegação livre

const LIVRE_MAX = 7000; // cerca de 1.000 parsecs: além disso o catálogo, que é em volta do Sol, fica vazio
/**
 * Liga ou desliga a navegação livre (só no sistema solar). Ao ligar, a câmera fica onde está e passa a ser movida pelo
 * usuário; ao desligar, volta a girar em volta do Sol, do ponto em que parou.
 */
function navegacaoLivre(ligar) {
  if (ligar && G.sistema && !G.livre) {
    const dir = G.camera.getWorldDirection(new THREE.Vector3());
    G.livre = { pos: G.camera.position.clone(), yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))), escala: 1, anim: null };
    G.animFoco = null; G.focoAlvo = null;
    medirEscalaLivre();
  } else if (!ligar && G.livre) {
    const p = G.livre.pos, d = Math.max(0.3, Math.min(40, p.length()));
    G.cam.dist = d; G.cam.lat = Math.asin(Math.max(-1, Math.min(1, p.y / (p.length() || 1)))) / RAD; G.cam.lon = Math.atan2(-p.z, p.x) / RAD;
    G.cam.lat = Math.max(-85, Math.min(85, G.cam.lat));
    G.livre = null; G.foco.set(0, 0, 0); G.focoDistMin = 0.3;
  }
}

/** Escala de movimento: distância até a superfície do corpo mais próximo (planetas, luas, sondas, Sol, estrelas). */
function medirEscalaLivre() {
  const L = G.livre; if (!L) return;
  L.escala = Math.max(2e-5, Math.min(L.pos.length(), G.espaco?.distanciaProxima?.(L.pos) ?? Infinity));
}

/** Avança (r > 1) ou recua (r < 1) na direção do olhar; para a frente, nunca mais que a distância ao corpo mais próximo. */
function avancarLivre(r) {
  const L = G.livre; if (!L || !(r > 0)) return;
  medirEscalaLivre();
  const passo = r >= 1 ? L.escala * (1 - 1 / r) * 0.9 : -Math.max(L.escala, L.pos.length() * 0.05) * (1 / r - 1);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(L.pitch, L.yaw, 0, 'YXZ'));
  L.pos.addScaledVector(dir, passo);
  if (L.pos.length() > LIVRE_MAX) L.pos.setLength(LIVRE_MAX);
}

/** Dois toques na navegação livre: vira para o ponto tocado e voa até o objeto (ou um trecho na direção dele). */
function irLivre(cx, cy) {
  const L = G.livre; if (!L) return;
  const r = G.dom.canvas.getBoundingClientRect();
  posicionarCamera(); G.camera.updateMatrixWorld();
  const alvo = G.espaco?.alvoNoToque?.(cx, cy);
  if (alvo) { voarLivreAte(alvo.posicao, alvo.raio); return; }
  const dir = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(G.camera).sub(L.pos).normalize();
  medirEscalaLivre();
  voarLivreAte(L.pos.clone().addScaledVector(dir, L.escala * 0.8), 0);
}

/** Vira para o ponto e voa até ele, parando a 6 raios do objeto (raio 0: até o próprio ponto). */
function voarLivreAte(posicao, raio) {
  const L = G.livre; if (!L) return;
  const dir = posicao.clone().sub(L.pos);
  const dist = dir.length(); if (!(dist > 0)) return;
  dir.divideScalar(dist);
  const para = L.pos.clone().addScaledVector(dir, Math.max(0, dist - Math.max(raio * 6, raio ? 1e-4 : 0)));
  let yaw = Math.atan2(-dir.x, -dir.z); yaw = L.yaw + (((yaw - L.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  L.anim = { de: L.pos.clone(), para, yaw0: L.yaw, yaw1: yaw, pitch0: L.pitch, pitch1: Math.asin(Math.max(-1, Math.min(1, dir.y))), t0: performance.now(), ms: MOVIMENTO_REDUZIDO ? 1 : 1600 };
}

/** A cada quadro na navegação livre: viagem suave do dois toques (distância em escala logarítmica). */
function moverLivre(agora) {
  const L = G.livre, a = L.anim;
  if (G.quadro % 6 === 0) medirEscalaLivre();
  if (!a) return;
  const t = Math.min(1, (agora - a.t0) / a.ms), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  L.pos.lerpVectors(a.de, a.para, e);
  const v = Math.min(1, t * 2.2), ev = 1 - Math.pow(1 - v, 3); // primeiro vira, depois voa
  L.yaw = a.yaw0 + (a.yaw1 - a.yaw0) * ev; L.pitch = a.pitch0 + (a.pitch1 - a.pitch0) * ev;
  if (t >= 1) L.anim = null;
}

/** A cada quadro: o foco acompanha o corpo escolhido (com a viagem suave até ele quando o foco acabou de mudar). */
function moverFoco(agora) {
  const alvo = G.focoAlvo ? G.focoAlvo() : ORIGEM;
  const a = G.animFoco;
  if (!a) { G.foco.copy(alvo); return; }
  const t = Math.min(1, (agora - a.t0) / a.ms), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  G.foco.lerpVectors(a.de, alvo, e);
  G.cam.dist = Math.exp(Math.log(a.dist0) + (Math.log(a.dist) - Math.log(a.dist0)) * e); // zoom em escala logarítmica: a viagem parece uniforme
  if (t >= 1) G.animFoco = null;
}
const ORIGEM = new THREE.Vector3();

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

/**
 * Ponto tocado exatamente como está desenhado: raio contra a malha da Terra e coordenada pela direção do ponto
 * atingido (a mesma que o shader usa para o mapa detalhado). Assim o toque marca o lugar que se vê.
 * Fora da malha, cai no cálculo analítico (pontoSob).
 */
function pontoDesenhado(cx, cy) {
  const r = G.dom.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  posicionarCamera(); G.camera.updateMatrixWorld();
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, G.camera);
  const hit = rc.intersectObject(G.terra, false)[0];
  return hit ? vecLatLon(hit.point) : pontoSob(cx, cy);
}

function aproximar(cx, cy) {
  const p = pontoSob(cx, cy);
  if (!p) return;
  irPara(p.lat, p.lon, Math.max(DIST.min, 1 + (G.cam.dist - 1) * 0.45), 700);
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
  // o dia e a noite são sempre os reais; com dados por cima, as nuvens ficam discretas (opacidadeNuvens)
  u.temNuvens.value = G.nuvens.material.uniforms.temNuvem.value ? 1 : 0;
  if (!cam.arquivo) { u.temCamada.value = 0; pararParticulas(); montarLegenda(cam, null); atualizarNotaFonte(); return; }
  if (!G.manifest?.gfs) { montarLegenda(cam, null); return; }
  let campo;
  try { campo = await buscarCampo(G.manifest, cam.arquivo, hora); }
  catch (e) { mostrarAviso(`Não foi possível carregar a camada ${cam.nome} (${e?.message || 'falha'}).`, false); return; }
  if (G.camada !== id || G.hora !== hora) return; // o usuário já trocou enquanto carregava
  const canalInfo = campo.canais[cam.canal === 3 ? 'R' : ['R', 'G', 'B'][cam.canal]]; // canal 3 = módulo de (R, G), mesma faixa dos dois
  if (!cam.textura) cam.textura = escalaTextura(cam);
  u.tCamada.value?.dispose?.();
  u.tCamada.value = texturaDeImagem(campo.imagem);
  u.grade.value.set(campo.largura, campo.altura);
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
  await carregarHora(h);
  atualizarRelogio();
  if (G.tocado) mostrarPontoTocado(G.tocado.lat, G.tocado.lon, true);
}

function montarLinhaDoTempo() {
  const horas = G.manifest.gfs.horas;
  const r = G.dom.faixa;
  r.min = '0'; r.max = String(horas.length - 1); r.step = '1'; r.value = String(horas.indexOf(G.hora));
  r.disabled = false;
  G.dom.rotuloHora.hidden = false;
  // nomes dos dias sob a faixa, onde cada dia começa
  const off = -new Date().getTimezoneOffset() * 60, hoje = partesLocais(Date.now(), off);
  const base = Date.parse(G.manifest.gfs.rodada);
  let ultimo = null;
  G.dom.dias.replaceChildren(...horas.flatMap((h, i) => {
    const p = partesLocais(base + h * 3600000, off), chave = `${p.ano}-${p.mes}-${p.dia}`;
    if (chave === ultimo) return [];
    ultimo = chave;
    const dif = Math.round((Date.UTC(p.ano, p.mes - 1, p.dia) - Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia)) / 86400000);
    const nome = dif === 0 ? 'hoje' : dif === 1 ? 'amanhã' : ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][p.semana];
    return [el('span', { text: nome, style: { left: `${(i / Math.max(1, horas.length - 1) * 100).toFixed(2)}%` } })];
  }));
  atualizarRotuloHora();
}

/** Abre ou fecha a linha do tempo da previsão (o botão do instante continua sempre à vista). */
function alternarPainelTempo() {
  const abrir = G.dom.linha.hidden;
  G.dom.linha.hidden = !abrir;
  G.dom.rotuloHora.setAttribute('aria-expanded', String(abrir));
  if (!abrir) pararLinhaDoTempo();
}

/** Ícone do botão de animar: triângulo (tocar) ou duas barras (pausar). */
function desenharTocar(tocando) {
  const b = G.dom.tocar;
  b.replaceChildren(svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: tocando ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l10.5-6.5z', class: 'cheio' })));
  b.setAttribute('aria-pressed', String(tocando));
  b.setAttribute('aria-label', tocando ? 'Pausar a animação' : 'Animar a previsão');
}

function atualizarRotuloHora() {
  const off = -new Date().getTimezoneOffset() * 60;
  const ms = instanteMostrado();
  const p = partesLocais(ms, off);
  const dia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][p.semana];
  const agora = G.hora === G.horaAgora;
  G.rotuloHora = agora ? 'agora' : `${dia} ${String(p.hora).padStart(2, '0')}h`;
  G.dom.rotuloHora.classList.toggle('previsao', !agora);
  G.dom.voltarAgora.hidden = agora;
  atualizarRelogio();
  G.dom.faixa.setAttribute('aria-valuetext', agora ? 'Agora' : G.rotuloHora);
  if (G.manifest?.gfs?.horas) G.dom.faixa.value = String(G.manifest.gfs.horas.indexOf(G.hora));
}

function alternarLinhaDoTempo() {
  if (G.tempoLinha.tocando) { pararLinhaDoTempo(); return; }
  G.tempoLinha.tocando = true;
  const serie = (G.tempoLinha.serie = (G.tempoLinha.serie || 0) + 1); // identifica esta animação: pausar e animar de novo não duplica o passo
  desenharTocar(true);
  const passo = async () => {
    if (!G.tempoLinha.tocando || G.tempoLinha.serie !== serie) return;
    const horas = G.manifest.gfs.horas;
    const k = (horas.indexOf(G.hora) + 1) % horas.length;
    await definirHora(horas[k]);
    if (!G.tempoLinha.tocando || G.tempoLinha.serie !== serie) return;
    G.tempoLinha.timer = setTimeout(passo, 1100);
  };
  passo();
}
function pararLinhaDoTempo() {
  G.tempoLinha.tocando = false; clearTimeout(G.tempoLinha.timer);
  if (G.dom) desenharTocar(false);
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
  const fonte = el('p', { class: 'globo-fonte', onclick: () => { if (G.erroDados) mostrarErroDados(); } });
  const ciclones = el('p', { class: 'globo-ciclones' });
  const faixa = el('input', { type: 'range', class: 'globo-faixa', min: '0', max: '0', value: '0', disabled: true, 'aria-label': 'Hora da previsão' });
  faixa.addEventListener('input', () => { pararLinhaDoTempo(); definirHora(G.manifest.gfs.horas[Number(faixa.value)]); });
  // Tempo: um botão só com o instante mostrado ("Agora · 19:21"); ao tocar, abre a linha do tempo da previsão (arrastar e
  // animar). Fora de "agora", um botão "Agora" ao lado volta para o tempo real.
  const rotuloHora = el('button', { type: 'button', class: 'globo-instante', hidden: true, 'aria-expanded': 'false', 'aria-label': 'Escolher a hora da previsão', onclick: alternarPainelTempo });
  const voltarAgora = el('button', { type: 'button', class: 'globo-agora', text: 'Agora', hidden: true, 'aria-label': 'Voltar para agora', onclick: () => { pararLinhaDoTempo(); definirHora(G.horaAgora); } });
  const tocar = el('button', { type: 'button', class: 'globo-tocar', 'aria-label': 'Animar a previsão', 'aria-pressed': 'false', onclick: alternarLinhaDoTempo });
  const dias = el('div', { class: 'globo-dias', 'aria-hidden': 'true' });
  const linha = el('div', { class: 'globo-linha', hidden: true }, tocar, el('div', { class: 'globo-faixa-caixa' }, faixa, dias));
  const painel = el('div', { class: 'globo-painel', hidden: true, role: 'dialog', 'aria-label': 'Tempo no ponto tocado' });
  // Controles discretos: só ícones, numa coluna estreita. Aproximar e afastar ficam nos gestos (pinça, dois toques, roda).
  const icone = (...filhos) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, ...filhos);
  const botoes = el('div', { class: 'globo-botoes globo-recolhivel' },
    el('button', { type: 'button', title: 'Minha posição', 'aria-label': 'Centralizar na minha posição', onclick: () => { const l = G.estadoApp?.local; if (l) irPara(l.lat, l.lon, Math.min(G.cam.dist, DIST.cidade)); } },
      icone(svg('circle', { cx: 12, cy: 12, r: 6 }), svg('circle', { cx: 12, cy: 12, r: 1.6, class: 'cheio' }), svg('path', { d: 'M12 2v4M12 18v4M2 12h4M18 12h4' }))),
    el('button', { type: 'button', title: 'Espaço', class: 'globo-btn-espaco', 'aria-label': 'Espaço: satélites e sistema solar', 'aria-pressed': 'false', onclick: alternarEspaco },
      icone(svg('circle', { cx: 12, cy: 12, r: 5 }), svg('ellipse', { cx: 12, cy: 12, rx: 10, ry: 3.4, transform: 'rotate(-20 12 12)' }))),
    el('button', { type: 'button', title: 'Ajuda', 'aria-label': 'Como usar e fontes', onclick: mostrarAjuda },
      icone(svg('path', { d: 'M9.2 9a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.1-1.5 2.1v.6' }), svg('circle', { cx: 12, cy: 17.6, r: 1.1, class: 'cheio' }))));
  const rodape = el('div', { class: 'globo-rodape globo-recolhivel' }, legenda, linha, el('div', { class: 'globo-tempo-terra' }, rotuloHora, voltarAgora), el('div', { class: 'globo-notas' }, fonte, ciclones));
  const cidades = el('div', { class: 'globo-cidades', 'aria-hidden': 'true' });
  const grade = el('div', { class: 'globo-grade globo-recolhivel', 'aria-hidden': 'true' });
  const leitura = el('div', { class: 'globo-leitura', hidden: true, 'aria-hidden': 'true' });
  const raiz = el('div', { class: 'globo' }, canvas, grade, cidades, el('div', { class: 'globo-topo globo-recolhivel' }, chips), botoes, aviso, painel, leitura, rodape);
  secao.append(raiz);
  G.dom = { raiz, canvas, chips, aviso, legenda, fonte, ciclones, faixa, rotuloHora, voltarAgora, tocar, dias, linha, painel, rodape, botoes, cidades, grade, leitura };
  // leitura sob o cursor: só com mouse (no toque, o painel do ponto tocado faz esse papel)
  canvas.addEventListener('pointermove', (e) => { G.mouse = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null; });
  canvas.addEventListener('pointerleave', () => { G.mouse = null; });
  desenharTocar(false);
  montarCidades();
  G.mostrarPainel = mostrarPainelTexto; G.fecharPainel = fecharPainel; G.modoSistema = modoSistema; G.focarSistema = focarSistema; G.distanciaVisaoGeral = distanciaVisaoGeral; G.navegacaoLivre = navegacaoLivre; G.voarLivreAte = voarLivreAte;
  G.abrirGalaxia = abrirGalaxia; G.fecharGalaxia = fecharGalaxia; G.mostrarAviso = mostrarAviso;
  window.__globo = G; G.pontoNaTela = pontoNaTela; G.pontoDesenhado = pontoDesenhado; // só para testes automáticos de tela
  new ResizeObserver(ajustarTamanho).observe(raiz);
  // a barra de cima do app se recolhe sozinha: o globo cresce para ocupar a altura liberada
  addEventListener('resize', ajustarTamanho);
  window.visualViewport?.addEventListener('resize', ajustarTamanho);
  configurarRecolhimento(raiz);
  montarLegenda(CAMADAS.find((c) => c.id === G.camada), null);
}

// ---------- controles que se recolhem ----------

/** Sem toque por este tempo, botões, filtros e notas somem e a cena fica limpa; qualquer toque traz de volta. */
const OCIOSO_MS = 4500;

function configurarRecolhimento(raiz) {
  const revelar = () => {
    if (raiz.classList.contains('imersivo')) G.revelou = true; // o toque que traz os controles não age na cena
    mostrarControles();
  };
  raiz.addEventListener('pointerdown', revelar, { capture: true });
  raiz.addEventListener('wheel', mostrarControles, { capture: true, passive: true });
  raiz.addEventListener('keydown', mostrarControles, { capture: true });
  raiz.addEventListener('focusin', mostrarControles);
  mostrarControles();
}

function mostrarControles() {
  G.dom.raiz.classList.remove('imersivo');
  clearTimeout(G.timerOcioso);
  G.timerOcioso = setTimeout(recolherControles, OCIOSO_MS);
}

function recolherControles() {
  const ocupado = !G.dom.painel.hidden || G.tempoLinha.tocando || G.dom.raiz.contains(document.activeElement) && document.activeElement !== G.dom.canvas;
  if (ocupado || !G.aberto) { mostrarControles(); return; }
  G.dom.raiz.classList.add('imersivo');
}

// ---------- cidades com temperatura ----------
//
// Duas fontes, uma lista só: as cidades escolhidas à mão (js/globo-cidades.js: RS e vizinhança, que o Natural Earth não
// traz todas) e as ~7.300 localidades do Natural Earth 10 m (vendor/terra/cidades.json), cada uma com o zoom a partir do
// qual aparece. A lista fica ordenada por esse zoom e pela população: a cada atualização só as que cabem no zoom atual
// são testadas, e as primeiras ganham o lugar quando os rótulos se sobrepõem. Os rótulos vêm de um conjunto fixo de
// elementos reaproveitados (o DOM não cresce com o número de cidades).

const ZOOM_DO_NIVEL = { 1: 1.5, 2: 3.4, 3: 5.4 };          // nível das cidades escolhidas à mão -> zoom em que aparecem
const MAX_ROTULOS_CIDADES = CELULAR ? 70 : 180;
const PROXIMA_DEMAIS = 0.12;                                // graus: localidade do Natural Earth igual a uma escolhida à mão

function montarCidades() {
  G.cidades = CIDADES.map((c) => ({ n: c.n, lat: c.lat, lon: c.lon, zMin: ZOOM_DO_NIVEL[c.nivel] ?? 5.4, pop: 0, capital: c.nivel === 1 ? 2 : 0, pos: latLonVec(c.lat, c.lon, RAIO * 1.00005), temp: null }));
  G.rotulosCidades = Array.from({ length: MAX_ROTULOS_CIDADES }, () => { const e = el('span', { class: 'globo-cidade', hidden: true }); G.dom.cidades.append(e); return e; });
}

/** Junta as localidades do Natural Earth às cidades escolhidas à mão (sem repetir) e reordena por zoom e população. */
async function carregarCidadesMundo() {
  const r = await fetch(new URL('../vendor/terra/cidades.json', import.meta.url));
  if (!r.ok) throw new Error(`cidades: erro ${r.status}`);
  const { campos, cidades } = await r.json();
  const i = Object.fromEntries(['nome', 'lat', 'lon', 'populacao', 'zoomMinimo', 'capital (2 país, 1 estado)', 'pais', 'estado'].map((k) => [k, campos.indexOf(k)]));
  const proprias = G.cidades.slice();
  const repetida = (lat, lon) => proprias.some((c) => Math.abs(c.lat - lat) < PROXIMA_DEMAIS && Math.abs(c.lon - lon) < PROXIMA_DEMAIS / Math.max(0.2, Math.cos(lat * RAD)));
  for (const c of cidades) {
    const lat = c[i.lat], lon = c[i.lon];
    const cap = c[i['capital (2 país, 1 estado)']];
    const igual = proprias.find((p) => Math.abs(p.lat - lat) < PROXIMA_DEMAIS && Math.abs(p.lon - lon) < PROXIMA_DEMAIS / Math.max(0.2, Math.cos(lat * RAD)));
    if (igual) { igual.pop = c[i.populacao]; igual.capital = Math.max(igual.capital, cap); igual.pais = c[i.pais]; igual.estado = c[i.estado]; continue; }
    if (repetida(lat, lon)) continue;
    G.cidades.push({ n: c[i.nome], lat, lon, zMin: c[i.zoomMinimo], pop: c[i.populacao], capital: cap, pais: c[i.pais], estado: c[i.estado], pos: latLonVec(lat, lon, RAIO * 1.00005), temp: null });
  }
  G.cidades.sort((a, b) => a.zMin - b.zMin || b.capital - a.capital || b.pop - a.pop);
  await atualizarTemperaturasCidades().catch(() => {}); // sem o campo agora, a próxima troca de hora preenche
}

/** Temperatura de cada cidade pelo campo do GFS da hora mostrada (sem chamadas de rede: o campo já está em memória). */
async function atualizarTemperaturasCidades() {
  if (!G.manifest?.gfs || !G.cidades) return;
  const hora = G.hora;
  const campo = await buscarCampo(G.manifest, 'campo', hora);
  if (G.hora !== hora) return;
  for (const c of G.cidades) { const t = amostrar(campo, 0, c.lat, c.lon); c.temp = valido(t) ? Math.round(t) : null; }
  G.cidadesMudaram = true;
}

/**
 * Zoom no padrão dos mapas da web (0 = mundo inteiro em 256 px) equivalente à vista atual, usado para escolher quais
 * localidades aparecem (o Natural Earth traz o zoom mínimo de cada uma pensado nessa escala).
 */
function zoomEquivalente(largura) {
  const meia = meiaVisao(G.cam.dist, G.camera.fov, G.camera.aspect);
  return Math.log2(360 / (2 * Math.max(meia, 1e-4))) + 2 + Math.log2(Math.max(0.6, largura / 1000));
}

/** Projeta as cidades visíveis (lado da Terra voltado à câmera, conforme o zoom) nos rótulos sobre o canvas. */
function posicionarCidades() {
  if (!G.cidades) return;
  const r = G.dom.canvas.getBoundingClientRect();
  const z = G.sistema || G.espacoAberto ? -Infinity : zoomEquivalente(r.width);
  const olho = G.camera.position, v = new THREE.Vector3();
  const ocupados = [];
  const soTemp = G.regiao?.estado.ativa && G.terra.material.uniforms.temRegiao.value > 0.5; // o mapa do OSM já traz os nomes
  let n = 0;
  for (const c of G.cidades) {
    if (c.zMin > z || n >= G.rotulosCidades.length) break; // lista ordenada por zoom: as seguintes também não cabem
    v.copy(olho).sub(c.pos);
    if (c.pos.dot(v) <= 0.18 * c.pos.length() * v.length()) continue; // só o lado visível, longe da borda
    v.copy(c.pos).project(G.camera);
    const x = (v.x + 1) / 2 * r.width, y = (1 - v.y) / 2 * r.height;
    if (v.z >= 1 || x < 8 || y < 56 || x > r.width - 8 || y > r.height - 150 || (x > r.width - 120 && y < 400)) continue; // fora dos botões da direita
    if (soTemp && c.temp === null) continue;
    const texto = soTemp ? `${c.temp}°` : c.temp === null ? c.n : `${c.n} ${c.temp}°`;
    const largura = 14 + texto.length * (c.capital ? 7.2 : 6.6);
    if (ocupados.some((o) => x < o.x + o.w + 6 && o.x < x + largura + 6 && Math.abs(o.y - y) < 16)) continue;
    ocupados.push({ x, y, w: largura });
    const e = G.rotulosCidades[n++];
    if (e.textContent !== texto) e.textContent = texto;
    const classe = 'globo-cidade' + (soTemp ? ' so-temp' : c.capital === 2 ? ' capital' : c.capital === 1 ? ' capital-estado' : c.pop < 100000 && c.zMin > 5 ? ' pequena' : '');
    if (e.className !== classe) e.className = classe;
    e.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    e.hidden = false;
  }
  for (let i = n; i < G.rotulosCidades.length; i++) G.rotulosCidades[i].hidden = true;
}

// ---------- grade de coordenadas e leitura sob o cursor ----------

/** Margens livres para os rótulos da grade: abaixo dos chips, à direita da borda e acima do rodapé. */
function atualizarGrade() {
  const r = G.dom.canvas.getBoundingClientRect();
  const topo = G.dom.chips.getBoundingClientRect().bottom - r.top + 6;
  const base = r.bottom - G.dom.rodape.getBoundingClientRect().top + 4;
  G.grade.atualizar(G.cam, G.camera, r, { topo: Math.max(8, topo), esquerda: 6, base: Math.max(0, base) });
}

const NOMES_DIRECAO = ['N', 'NNE', 'NE', 'ENE', 'L', 'ELE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Período do dia pela altura do Sol (centro do disco, sem refração): os limites usuais de crepúsculo em −6°, −12° e −18°. */
function periodoDoSol(alt) {
  if (alt >= 0) return alt < 6 ? 'Sol baixo' : 'dia';
  return alt >= -6 ? 'crepúsculo civil' : alt >= -12 ? 'crepúsculo náutico' : alt >= -18 ? 'crepúsculo astronômico' : 'noite';
}

/**
 * Leitura do ponto sob o cursor (computador): coordenadas, distância até você, hora solar verdadeira, altura do Sol
 * e os campos do GFS da hora mostrada. Tudo calculado no aparelho, sem rede, a cada poucos quadros.
 */
function atualizarLeitura() {
  const L = G.dom.leitura;
  const ativo = G.mouse && !G.sistema && !G.galaxia && !G.animCam;
  // só recalcula quando algo mudou (o raio contra a malha da Terra custa alguns milissegundos)
  const chave = ativo ? `${G.mouse.x},${G.mouse.y},${G.cam.lat.toFixed(5)},${G.cam.lon.toFixed(5)},${G.cam.dist.toFixed(6)},${G.hora},${!!G.leituraCampos},${Math.floor(Date.now() / 30000)}` : '';
  if (chave === G.leituraChave) return;
  G.leituraChave = chave;
  const p = ativo ? pontoDesenhado(G.mouse.x, G.mouse.y) : null;
  if (!p) { if (!L.hidden) L.hidden = true; return; }
  const casas = G.grade.passo >= 1 ? 2 : G.grade.passo >= 0.1 ? 3 : 4; // precisão que o zoom permite apontar
  const ms = instanteMostrado();
  const ss = pontoSubsolar(ms);
  const cosZ = Math.sin(p.lat * RAD) * Math.sin(ss.lat * RAD) + Math.cos(p.lat * RAD) * Math.cos(ss.lat * RAD) * Math.cos((p.lon - ss.lon) * RAD);
  const altSol = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / RAD;
  const hSolar = (((12 + (p.lon - ss.lon) / 15) % 24) + 24) % 24; // hora solar verdadeira: 12 h quando o Sol cruza o meridiano
  const hh = Math.floor(hSolar), mm = Math.floor((hSolar - hh) * 60);
  const l = G.estadoApp?.local;
  const distKm = l ? 6371.0088 * Math.acos(Math.max(-1, Math.min(1, Math.sin(p.lat * RAD) * Math.sin(l.lat * RAD) + Math.cos(p.lat * RAD) * Math.cos(l.lat * RAD) * Math.cos((p.lon - l.lon) * RAD)))) : null;
  const linhas = [
    `${fmtCoord(p.lat, 'S', 'N', casas)} ${fmtCoord(p.lon, 'O', 'L', casas)}${distKm !== null ? ` · ${distKm < 10 ? fmt.n(distKm, 1) : fmt.n(Math.round(distKm))} km de você` : ''}`,
    `Hora solar ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · Sol ${altSol >= 0 ? 'a' : ''} ${fmt.n(Math.abs(altSol), 1)}° ${altSol >= 0 ? 'de altura' : 'abaixo do horizonte'} · ${periodoDoSol(altSol)}`,
  ];
  const campos = camposParaLeitura();
  if (campos) {
    const g = lerPontoGfs(campos, p.lat, p.lon) || {};
    const partes = [];
    if (valido(g.temp)) partes.push(`${fmt.n(g.temp, 1)} °C`);
    if (valido(g.pressao)) partes.push(`${fmt.n(Math.round(g.pressao))} hPa`);
    if (valido(g.ventoKmh)) partes.push(`vento ${fmt.n(Math.round(g.ventoKmh))} km/h ${NOMES_DIRECAO[Math.round(g.direcao / 22.5) % 16]}${valido(g.rajadaKmh) ? `, rajadas ${fmt.n(Math.round(g.rajadaKmh))}` : ''}`);
    if (valido(g.chuvaMmH)) partes.push(g.chuvaMmH < 0.05 ? 'sem chuva' : `chuva ${fmt.n(g.chuvaMmH, 1)} mm/h`);
    if (partes.length) linhas.push(partes.join(' · '));
    if (campos.nuvens) {
      const n = [0, 1, 2].map((k) => amostrar(campos.nuvens, k, p.lat, p.lon));
      if (n.every(valido)) linhas.push(`Nuvens ${fmt.n(g.nuvens)}%: baixas ${fmt.n(Math.round(n[0]))}%, médias ${fmt.n(Math.round(n[1]))}%, altas ${fmt.n(Math.round(n[2]))}%`);
    }
  }
  linhas.push(`NOAA GFS · ${G.hora === G.horaAgora ? 'agora' : G.rotuloHora || ''}`);
  const texto = linhas.join('\n');
  if (L.textContent !== texto) L.textContent = texto;
  L.hidden = false;
}

/** Campos do GFS da hora mostrada para a leitura (pede uma vez por hora; até chegarem, a leitura mostra só o céu). */
function camposParaLeitura() {
  const h = G.hora;
  if (h === null || !G.manifest?.gfs) return null;
  if (G.leituraHora !== h) { G.leituraHora = h; G.leituraCampos = null; camposDaHora(h).then((c) => { if (G.leituraHora === h) G.leituraCampos = c; }); }
  return G.leituraCampos;
}

const fmtCoord = (v, neg, pos, casas) => `${fmt.n(Math.abs(v), casas)}°${v < 0 ? neg : pos}`;

// ---------- tempo real: relógio e verificação de dados novos ----------

const VERIFICA_MS = 60000; // a cada minuto: hora "agora" da linha do tempo; a cada 5 min: manifest novo (rodada ou satélite)

function atualizarRelogio() {
  const agora = new Date();
  const hh = String(agora.getHours()).padStart(2, '0'), mm = String(agora.getMinutes()).padStart(2, '0');
  // o botão do instante mostra a hora certa em tempo real ou a hora da previsão escolhida
  G.dom.rotuloHora.textContent = G.hora === G.horaAgora || G.hora === null ? `Agora · ${hh}:${mm}` : `${G.rotuloHora} · previsão`;
}

function horaMaisProxima(manifest) {
  const h = Math.round((Date.now() - Date.parse(manifest.gfs.rodada)) / 3600000 / 3) * 3;
  return manifest.gfs.horas.reduce((m, x) => (Math.abs(x - h) < Math.abs(m - h) ? x : m), manifest.gfs.horas[0]);
}

/** Chamado a cada minuto com a aba aberta: avança a hora "agora" e, a cada 5 min, procura rodada ou satélite novos. */
async function verificarAtualizacao(forcar = false) {
  if (!forcar && (!G.aberto || document.hidden)) return;
  G.blocoCeu?.atualizar(); // recalcula sozinho a cada 10 min ou quando o local muda
  if (!G.manifest?.gfs) return;
  const agora = Date.now();
  if (agora - (G.ultimaVerificacao || 0) >= 5 * VERIFICA_MS) {
    G.ultimaVerificacao = agora;
    try {
      const { manifest, antigo } = await buscarManifest();
      const mudou = manifest.gfs?.rodada !== G.manifest.gfs.rodada || manifest.satelite?.instante !== G.manifest.satelite?.instante || manifest.gerado !== G.manifest.gerado;
      if (!antigo && (mudou || G.manifestAntigo)) {
        const estavaAgora = G.hora === G.horaAgora;
        G.manifest = manifest; G.manifestAntigo = false; G.satelite = null;
        G.horaAgora = horaMaisProxima(manifest);
        if (estavaAgora || !manifest.gfs.horas.includes(G.hora)) G.hora = G.horaAgora;
        montarLinhaDoTempo();
        G.erroDados = null;
        await carregarHora(G.hora);
        marcarCiclones(); atualizarNotaFonte();
        if (G.tocado) mostrarPontoTocado(G.tocado.lat, G.tocado.lon, true);
        mostrarAviso('Dados novos carregados.', false);
        return;
      }
    } catch { /* sem rede agora: tenta de novo em 5 min */ }
  }
  const h = horaMaisProxima(G.manifest);
  if (h !== G.horaAgora) { const estavaAgora = G.hora === G.horaAgora; G.horaAgora = h; if (estavaAgora) await definirHora(h); else atualizarRotuloHora(); }
}

function ajustarTamanho() {
  if (!G.dom || !G.renderer) return;
  const r = G.dom.raiz;
  const cabeca = document.querySelector('.cabeca');
  const alturaTela = (window.visualViewport?.height || window.innerHeight) - (cabeca?.offsetHeight || 0) - (G.blocoCeu?.el.offsetHeight || 0);
  r.style.height = `${Math.max(360, Math.floor(alturaTela))}px`;
  const w = r.clientWidth, h = r.clientHeight;
  if (!w || !h) return;
  G.renderer.setSize(w, h, false);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
}

/** Legenda da camada: só a barra de cores com os valores e a unidade (as telas autoexplicativas não levam texto). */
function montarLegenda(cam, campo) {
  const L = G.dom.legenda;
  L.replaceChildren();
  if (!cam.cores) return;
  const barra = el('div', { class: 'globo-barra' });
  const paradas = cam.cores.map((p) => `rgba(${Math.round(p[1])},${Math.round(p[2])},${Math.round(p[3])},${Math.max(0.15, p[4])}) ${((p[0] - cam.faixaCor[0]) / (cam.faixaCor[1] - cam.faixaCor[0]) * 100).toFixed(0)}%`);
  barra.style.background = `linear-gradient(to right, ${paradas.join(', ')})`;
  const rotulos = el('div', { class: 'globo-rotulos' });
  const n = cam.id === 'pressao' ? [960, 990, 1013, 1030, 1050] : cam.id === 'temp' ? [-40, -20, 0, 20, 45] : cam.id === 'vento' ? [0, 30, 60, 90, 120] : [0, 5, 10, 20, 30];
  for (const v of n) rotulos.append(el('span', { text: fmt.n(v) }));
  rotulos.append(el('span', { class: 'globo-unidade', text: cam.unidade }));
  L.append(campo ? null : el('p', { class: 'globo-legenda-texto', text: 'Carregando…' }), barra, rotulos);
}

function atualizarNotaFonte() {
  const off = -new Date().getTimezoneOffset() * 60;
  const partes = [];
  const m = G.manifest;
  if (m?.gfs?.rodada) partes.push(`NOAA GFS · ${fmt.horaMin(Date.parse(m.gfs.rodada), off)}`);
  if (G.camada === 'nuvens' && G.nuvens?.userData?.satelite && m?.satelite?.instante) partes.push(`NASA GIBS · ${fmt.horaMin(Date.parse(m.satelite.instante), off)}`);
  if (G.regiao?.estado.ativa) partes.push('Mapa © OpenStreetMap');
  if (G.manifestAntigo) partes.push('dados guardados, podem estar desatualizados');
  if (!partes.length) partes.push(G.erroDados ? 'dados de tempo indisponíveis · tentando de novo' : 'carregando dados…');
  G.dom.fonte.textContent = partes.join(' · ');
  G.dom.fonte.classList.toggle('com-erro', !!G.erroDados);
}

/** Toque na nota de fonte com falha: o motivo, quando foi a última tentativa e um botão para tentar agora. */
function mostrarErroDados() {
  const e = G.erroDados;
  mostrarInfo('Dados de tempo',
    el('p', { text: G.manifest ? 'Mostrando os últimos dados guardados neste aparelho. Os atuais não chegaram.' : 'Os campos do modelo e as nuvens de satélite não chegaram. A Terra, o Sol, a noite e o espaço funcionam normalmente.' }),
    el('p', { class: 'nota', text: `Motivo: ${motivoErro(e)}${e?.fonte ? ` · ${e.fonte}` : ''}. O globo tenta de novo sozinho e quando a conexão volta.` }),
    el('button', { type: 'button', class: 'chip', text: 'Tentar agora', onclick: () => { document.getElementById('dlg-info').close(); tentarDeNovo(); } }));
}

function mostrarAviso(texto, grave) { G.dom.aviso.textContent = texto; G.dom.aviso.hidden = false; G.dom.aviso.classList.toggle('grave', !!grave); if (!grave) setTimeout(() => { if (G.dom.aviso.textContent === texto) esconderAviso(); }, 9000); }
function esconderAviso() { G.dom.aviso.hidden = true; }

const fmtLat = (v) => `${fmt.n(Math.abs(v), 1)}°${v < 0 ? 'S' : 'N'}`;
const fmtLon = (v) => `${fmt.n(Math.abs(v), 1)}°${v < 0 ? 'O' : 'L'}`;

/** Toque num ponto: marca, mostra o que o GFS diz na hora (instantâneo) e completa com a Open-Meteo. */
function tocarPonto(cx, cy) {
  if (G.galaxia) { G.galaxia.tocarGalaxia(cx, cy); return; }
  if (G.espaco && G.espacoAberto && G.espaco.tocarEspaco(cx, cy)) { G.marcadorToque.visible = false; G.tocado = null; return; }
  if (G.sistema) { fecharPainel(); return; }
  const astro = astroSob(cx, cy);
  if (astro) { mostrarCartaoAstro(astro); return; }
  const p = pontoDesenhado(cx, cy);
  if (!p) { fecharPainel(); return; }
  G.tocado = p;
  posicionarMarcador(G.marcadorToque, p.lat, p.lon); G.marcadorToque.visible = true;
  mostrarPontoTocado(p.lat, p.lon, false);
}

function fecharPainel() {
  G.dom.painel.hidden = true; G.marcadorToque.visible = false; G.tocado = null; G.seguir = null;
  const aoFechar = G.aoFecharPainel; G.aoFecharPainel = null; aoFechar?.();
}

/** Sol ou Lua sob o dedo (na tela, com folga de 22 px), se não estiverem atrás da Terra. */
function astroSob(cx, cy) {
  const r = G.dom.canvas.getBoundingClientRect();
  posicionarCamera(); G.camera.updateMatrixWorld();
  for (const [corpo, obj, raio] of [['Moon', G.lua, 0.135], ['Sun', G.solBrilho, 1.2]]) {
    if (!obj.visible) continue;
    const p = obj.position, c = G.camera.position;
    const d = p.clone().sub(c), a = d.dot(d), b = 2 * c.dot(d), disc = b * b - 4 * a * (c.dot(c) - 1);
    if (disc > 0 && (-b - Math.sqrt(disc)) / (2 * a) > 0 && (-b - Math.sqrt(disc)) / (2 * a) < 1) continue; // atrás da Terra
    const v = p.clone().project(G.camera);
    if (v.z > 1) continue;
    const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
    const raioPx = raio / d.length() / Math.tan(G.camera.fov * RAD / 2) * r.height / 2;
    if (Math.hypot(x - cx, y - cy) <= Math.max(22, raioPx + 8)) return corpo;
  }
  return null;
}

function mostrarCartaoAstro(corpo) {
  const c = cartaoAstro(corpo, G.estadoApp);
  G.marcadorToque.visible = false; G.tocado = null;
  mostrarPainelTexto(c.titulo, c.frase, c.numeros, c.fonte, [{ texto: 'Ver detalhes', onclick: c.detalhes }]);
}

async function mostrarPontoTocado(lat, lon, soGfs) {
  const P = G.dom.painel;
  const hora = G.hora;
  const gfs = lerPontoGfs(await camposDaHora(hora), lat, lon);
  if (G.tocado?.lat !== lat || G.hora !== hora) return; // o toque ou a hora mudaram enquanto os campos carregavam
  const cic = G.ciclones.find((c) => Math.hypot(c.userData.lat - lat, (c.userData.lon - lon) * Math.cos(lat * RAD)) < 3)?.userData.ciclone;
  const titulo = el('div', { class: 'globo-painel-topo' }, el('b', { text: cic ? `${cic.nome} (ciclone)` : `${fmtLat(lat)} ${fmtLon(lon)}` }),
    el('button', { type: 'button', class: 'globo-fechar', 'aria-label': 'Fechar', text: '×', onclick: fecharPainel }));
  const frase = el('p', { class: 'globo-frase', text: fraseSimples(gfs, null, cic) });
  const linha = el('p', { class: 'globo-numeros', text: numerosSimples(gfs) });
  const quando = el('p', { class: 'globo-quando', text: G.hora === G.horaAgora ? 'Previsão do modelo para agora.' : `Previsão do modelo para ${G.rotuloHora}.` });
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

/** Os três campos do GFS da hora mostrada (memorizados por globo-dados; o que falhar fica de fora). */
async function camposDaHora(hora) {
  if (!G.manifest?.gfs) return {};
  const r = await Promise.allSettled(['vento', 'campo', 'nuvens'].map((t) => buscarCampo(G.manifest, t, hora)));
  return { vento: r[0].value || null, campo: r[1].value || null, nuvens: r[2].value || null };
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
  mostrarInfo('Globo',
    el('p', { text: 'Arraste para girar, pince ou use a roda para aproximar, toque duas vezes para chegar perto. O botão “Agora” embaixo abre a linha do tempo da previsão. Toque num ponto da Terra para ver o tempo lá; toque no Sol, na Lua, num satélite, num planeta ou numa sonda para ver o que é, onde está e quando dá para ver daqui.' }),
    el('ul', {},
      el('li', {}, 'Dia e noite (sempre ligado): o lado iluminado e o escuro pela posição real do Sol agora; a Lua clareia a noite conforme a fase e as luzes das cidades (NASA Black Marble) acendem no escuro. Ao mudar a hora na linha do tempo, o Sol acompanha.'),
      el('li', {}, 'Nuvens: imagem infravermelha dos satélites GOES-Leste, GOES-Oeste e Himawari (NASA GIBS), onde há cobertura; no resto, nuvens previstas pelo GFS.'),
      el('li', {}, 'Vento (linhas mostram para onde ele sopra, a 10 m), chuva (mm/h), temperatura (a 2 m) e pressão ao nível do mar (isóbaras a cada 4 hPa ao aproximar): modelo GFS 0,5° da NOAA, a cada 3 h até 48 h.'),
      el('li', {}, 'Ponto tocado: ECMWF IFS pela Open-Meteo, com fuso horário local. Ciclones: NHC e GDACS.'),
      el('li', {}, 'Mapa: litoral, lagos, fronteiras e divisas de estados em linhas nítidas e 7 mil cidades que aparecem conforme o zoom, com a temperatura do GFS (Natural Earth, domínio público). Grade de coordenadas pelo zoom, com o equador, Greenwich, os trópicos e os círculos polares na inclinação do eixo da Terra hoje.'),
      el('li', {}, 'No computador, o mouse sobre a Terra mostra as coordenadas, a distância até você, a hora solar verdadeira, a altura do Sol e os valores do GFS naquele ponto.'),
      el('li', {}, 'Céu de hoje: o que dá para ver a olho nu do seu local até o amanhecer, com horário, direção e altura, já com as nuvens previstas.'),
      el('li', {}, 'Espaço: ISS, Tiangong e satélites (CelesTrak, SGP4) em escala real de altura; planetas na direção real. Sistema solar com posições reais (Astronomy Engine), sondas pelo JPL Horizons e distâncias comprimidas para caber na tela.'),
      el('li', {}, 'Via Láctea (no Sistema solar): a Galáxia vista de fora é um modelo calculado pelos braços medidos por paralaxe (Reid et al. 2019), a barra (Wegg et al. 2015) e o disco (Bland-Hawthorn & Gerhard 2016); ninguém a fotografou de fora. Perto do Sol aparecem as 800 mil estrelas do céu na distância medida; longe, as galáxias do NGC/IC e os grandes aglomerados de galáxias. "Salvar imagem" gera um PNG de até 4.096 px com os nomes e a escala.')),
    el('p', { class: 'nota', text: `Nesta tela: ${(G.galaxia ? G.galaxia.notasFontes() : [G.dom.fonte.textContent, ...(G.espaco?.notasFontes?.() || [])]).filter(Boolean).join(' · ')}.` }),
    el('p', { class: 'nota', text: `Texturas: NASA Visible Earth (Blue Marble e Black Marble, domínio público). Contornos e cidades: Natural Earth 10 m (domínio público). Dados gerados ${m?.gerado ? fmt.idade(Date.parse(m.gerado)) : '–'}. Este globo é um painel pessoal, não uma fonte oficial. Em situação de risco, siga a Defesa Civil e o INMET.` }));
}

// ---------- espaço: satélites e sistema solar (módulo globo-espaco.js, carregado ao tocar em Espaço) ----------

async function alternarEspaco() {
  const b = G.dom.botoes.querySelector('.globo-btn-espaco');
  if (G.espacoAberto) {
    G.espacoAberto = false; b.setAttribute('aria-pressed', 'false'); G.dom.raiz.classList.remove('com-espaco');
    G.espaco?.fecharEspaco();
    irPara(G.cam.lat, G.cam.lon, Math.min(G.cam.dist, DIST.inicial), 900);
    return;
  }
  G.espacoAberto = true; b.setAttribute('aria-pressed', 'true'); G.dom.raiz.classList.add('com-espaco');
  if (!G.espaco) {
    if (!G.espacoModulo) G.espacoModulo = import('./globo-espaco.js').catch(() => null);
    G.espaco = await G.espacoModulo;
    if (!G.espaco) { G.espacoModulo = null; G.espacoAberto = false; b.setAttribute('aria-pressed', 'false'); G.dom.raiz.classList.remove('com-espaco'); mostrarAviso('Não foi possível carregar o espaço. Verifique a conexão e toque de novo.', false); return; }
  }
  if (!G.espacoAberto) return;
  fecharPainel();
  irPara(G.cam.lat, G.cam.lon, Math.max(G.cam.dist, 5.5), 1200);
  G.espaco.abrirEspaco(G, THREE);
}

/**
 * Cartão de um objeto do céu (Sol, Lua, planeta, satélite, sonda): título, frase simples, números, fonte e ações.
 * @param {{texto:string, onclick:Function, alternar?:boolean}[]} [acoes] botões (alternar: liga e desliga, como "Seguir")
 * @param {Function} [aoFechar] chamado quando o cartão fecha (por exemplo, para tirar o destaque do satélite)
 */
function mostrarPainelTexto(titulo, frase, numeros, fonte, acoes = [], aoFechar = null) {
  const P = G.dom.painel;
  const aoFecharAntes = G.aoFecharPainel; G.aoFecharPainel = null; aoFecharAntes?.(); // o cartão anterior fecha antes
  G.seguir = null;
  const botoes = acoes.map((a) => {
    const b = el('button', { type: 'button', class: 'globo-detalhe', text: a.texto, 'aria-pressed': a.alternar ? 'false' : null });
    b.addEventListener('click', () => {
      if (!a.alternar) { a.onclick(); return; }
      const ativo = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(ativo)); a.onclick(ativo);
    });
    return b;
  });
  P.replaceChildren(
    el('div', { class: 'globo-painel-topo' }, el('b', { text: titulo }), el('button', { type: 'button', class: 'globo-fechar', 'aria-label': 'Fechar', text: '×', onclick: fecharPainel })),
    el('p', { class: 'globo-frase globo-frase-media', text: frase }), numeros ? el('p', { class: 'globo-numeros', text: numeros }) : null, el('p', { class: 'globo-quando', text: fonte }),
    botoes.length ? el('div', { class: 'globo-acoes' }, ...botoes) : null);
  P.hidden = false;
  G.aoFecharPainel = aoFechar;
}

const OBLIQUIDADE_J2000 = 23.4392911; // inclinação do equador sobre a eclíptica em J2000 (IAU 2006), em graus

/** Distância da visão geral do sistema solar: a órbita de Saturno (3,5 na escala da cena) cabe na largura da tela. */
function distanciaVisaoGeral() {
  const meiaLargura = Math.atan(Math.tan(G.camera.fov * Math.PI / 360) * G.camera.aspect);
  return Math.max(9.5, Math.min(18, 3.9 / Math.tan(meiaLargura)));
}

/** Troca entre a Terra e o sistema solar: esconde a Terra, as nuvens, os marcadores e a interface do tempo. */
function modoSistema(ligar) {
  if (!ligar) fecharGalaxia();
  G.sistema = ligar;
  for (const o of [G.terra, G.nuvens, G.atmosfera, G.contornos.grupo, G.lua, G.solBrilho, G.marcadorUsuario, G.marcadorToque, ...G.ciclones]) o.visible = !ligar;
  G.dom.cidades.hidden = ligar; G.dom.grade.hidden = ligar;
  if (G.particulas) G.particulas.linhas.visible = !ligar;
  G.dom.rodape.hidden = ligar; G.dom.chips.parentElement.hidden = ligar;
  G.marcadorUsuario.visible = !ligar && !!G.estadoApp?.local;
  fecharPainel();
  if (!ligar) navegacaoLivre(false);
  G.foco.set(0, 0, 0); G.focoAlvo = null; G.animFoco = null; G.focoDistMin = 0.3;
  G.estrelas.definir3d(ligar); // no sistema solar as estrelas ficam na distância real (comprimida) e o brilho é o visto da câmera
  // estrelas: no sistema solar a cena está na eclíptica J2000 (y para o polo norte da eclíptica); fora dele, no equador
  G.estrelas.grupo.rotation.set(ligar ? -OBLIQUIDADE_J2000 * RAD : 0, 0, 0);
  if (ligar) { // de cima, inclinado, com a órbita de Saturno (3,5 na escala da cena) cabendo na largura da tela
    G.camAntes = { ...G.cam }; G.cam.lat = 50; G.cam.dist = distanciaVisaoGeral(); G.animCam = null;
  } else {
    if (G.camAntes) { G.cam.lat = G.camAntes.lat; G.cam.lon = G.camAntes.lon; G.cam.dist = Math.min(G.camAntes.dist, 5.5); G.animCam = null; }
    atualizarAstros();
  }
}

// ------------------------------------------------------------------ 9. laço de animação e qualidade

function laco(agora) {
  G.anim = G.aberto && !G.contextoPerdido ? requestAnimationFrame(laco) : 0;
  if (!G.aberto || G.contextoPerdido || document.hidden) return;
  const dt = Math.min(100, agora - G.ultimoQuadro); G.ultimoQuadro = agora;
  medirQualidade(dt);
  const c = G.cam;
  if (G.animCam) {
    const a = G.animCam, t = Math.min(1, (agora - a.t0) / a.ms), e = 1 - Math.pow(1 - t, 3);
    c.lat = a.de.lat + (a.para.lat - a.de.lat) * e; c.lon = a.de.lon + (a.para.lon - a.de.lon) * e; c.dist = a.de.dist + (a.para.dist - a.de.dist) * e;
    if (t >= 1) G.animCam = null;
  } else if (G.seguir) { // seguindo um satélite: a câmera persegue o ponto sob ele, suavemente
    const alvo = G.seguir();
    if (alvo) { let dl = alvo.lon - c.lon; dl = ((dl + 540) % 360) - 180; const k = 1 - Math.pow(0.9, dt / 16); c.lon += dl * k; c.lat += (Math.max(-85, Math.min(85, alvo.lat)) - c.lat) * k; }
  } else {
    if (G.autoGira) c.lon += 0.004 * dt;
    if (Math.abs(c.vLon) > 0.001 || Math.abs(c.vLat) > 0.001) {
      c.lon += c.vLon * dt / 16; c.lat = Math.max(-85, Math.min(85, c.lat + c.vLat * dt / 16));
      const amort = Math.pow(0.92, dt / 16); c.vLon *= amort; c.vLat *= amort;
    }
  }
  if (G.quadro % 30 === 0 && !G.sistema) atualizarAstros();
  if (G.quadro % 4 === 0) posicionarCidades();
  if (G.quadro % 4 === 2 && !G.sistema) atualizarGrade();
  if (G.quadro % 6 === 3) atualizarLeitura();
  if (G.quadro % 30 === 0) atualizarRelogio();
  if (G.galaxia) G.galaxia.atualizarGalaxia(agora);
  else if (G.espaco && G.espacoAberto) G.espaco.atualizarEspaco(agora);
  if (G.camada === 'pressao') G.terra.material.uniforms.isobaras.value = Math.max(0, Math.min(1, (2.6 - c.dist) / 0.8));
  if (!G.sistema) {
    const antes = G.regiao.estado.ativa;
    const cv = G.renderer.domElement;
    G.regiao.atualizar(c, agora, { fov: G.camera.fov, aspecto: G.camera.aspect, largura: cv.width, altura: cv.height });
    if (antes !== G.regiao.estado.ativa) atualizarNotaFonte();
    // a esfera de nuvens fica a 40 km de altura: perto do chão ela some aos poucos, para não tapar o mapa nem cortar a câmera
    G.contornos.atualizar(c.dist, G.terra.material.uniforms.temRegiao.value);
    const base = opacidadeNuvens();
    G.nuvens.material.uniforms.opacNuvem.value = base * Math.max(0, Math.min(1, (c.dist - 1.03) / 0.15));
  }
  if (G.galaxia) { /* a viagem da câmera na galáxia é do próprio módulo */ } else if (G.livre) moverLivre(agora); else if (G.sistema) moverFoco(agora);
  posicionarCamera();
  G.estrelas.acompanharCamera(G.camera, G.dom.canvas.clientHeight * G.pixelRatio);
  const pulso = (Math.sin(agora / 500) + 1) / 2;
  if (!G.sistema) {
    const esc = Math.max(0.0001, Math.min(1, (c.dist - 1) / (DIST.inicial - 1))); // marcadores encolhem com a aproximação (tamanho fixo na tela)
    for (const m of [G.marcadorUsuario, G.marcadorToque, ...G.ciclones]) { m.scale.setScalar(esc); const p = m.getObjectByName('pulso'); if (p) { p.scale.setScalar(1 + pulso * 1.6); p.material.opacity = 0.6 * (1 - pulso); } }
  }
  if (G.particulas) animarParticulas(dt);
  if (G.galaxia) G.renderer.render(G.galaxia.estado().cena, G.galaxia.estado().camera);
  else G.renderer.render(G.cena, G.camera);
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
    ajustarEscalaEstrelas(G.estrelas, G.pixelRatio);
    if (G.particulas && G.nivelQualidade >= 2) iniciarParticulas(G.particulas.campo);
    if (G.nivelQualidade >= 3) { G.atmosfera.visible = false; }
    G.estrelas?.reduzir?.(G.nivelQualidade);
  }
}
