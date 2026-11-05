// Céu de fundo do Globo: as 119.625 estrelas do HYG (as 8.920 visíveis a olho nu com ficha completa e as 110.705 mais
// fracas), a Via Láctea, os objetos de céu profundo (Messier e famosos do sul) e as linhas e nomes das 88 constelações.
//
// Dois modos de desenho, no mesmo shader:
// - Céu (em volta da Terra): cada estrela na sua direção, numa esfera de raio RAIO_ESTRELAS, com o brilho do catálogo.
// - 3D (sistema solar e navegação livre): cada estrela na distância real, comprimida pela mesma potência do sistema solar
//   (DIST_ESCALA·UA^DIST_EXP), e o brilho recalculado a cada quadro pela distância real até a câmera
//   (m = M + 5·log10(d) − 5). Perto do Sol o céu é o mesmo do catálogo; voando para longe, as estrelas próximas mudam
//   de lugar e de brilho e o Sol vira uma estrela de magnitude absoluta 4,83.
// As estrelas ficam sempre no plano de fundo (profundidade no plano distante): nunca são cortadas e os corpos opacos as
// escondem.
//
// Catálogos (vendor/ceu, montados por scripts/globo/montar-estrelas.py e montar-ceu-profundo.py):
// - HYG Database v4.1 (David Nash, CC BY-SA 4.0): Hipparcos, Yale Bright Star e Gliese, época 2026,0.
// - Linhas das constelações, Messier e contornos da Via Láctea: d3-celestial (Olaf Frohn, BSD-3).
import * as A from '../vendor/astronomy/astronomy.min.js';
import { temperaturaCor } from './ceu.js';

const RAD = Math.PI / 180;
const UA_PC = 206264.806;
export const RAIO_ESTRELAS = 60;
/** Compressão das distâncias da cena (a mesma do sistema solar): DIST_ESCALA·UA^DIST_EXP. */
export const DIST_ESCALA = 1.25, DIST_EXP = 0.45;
const RAIO_FUNDO = 4000; // esfera de fundo (Via Láctea, céu profundo e estrelas sem distância) em volta da câmera, no modo 3D
const MAG_SOL = 4.83;

const COMUM = /* glsl */`
  uniform float modo3d;
  uniform vec3 cam;
  uniform vec3 camReal;
  vec4 noFundo(vec4 p) { // no plano distante, sem corte por ele; o que está atrás da câmera (w < 0) continua recortado
    p.z = p.w * 0.99999;
    return p;
  }`;
const VERTEX = /* glsl */`
  ${COMUM}
  attribute float mag;
  attribute float mabs;
  attribute float dpc;
  attribute vec3 cor;
  uniform float escala;
  uniform float limite;
  varying vec3 vCor;
  varying float vAlfa;
  const float UA_PC = ${UA_PC.toFixed(3)};
  void main() {
    float m = mag;
    vec3 p = position;
    if (modo3d > 0.5) {
      vec3 dir = normalize(position);
      if (dpc > 0.0) {
        float dUa = dpc * UA_PC;
        p = dir * (${DIST_ESCALA.toFixed(4)} * pow(dUa, ${DIST_EXP.toFixed(4)}));
        m = mabs + 2.1714724 * log(max(length(dir * dUa - camReal) / UA_PC, 1e-7)) - 5.0;
      } else if (dpc < 0.0) { // o Sol: perto dele, a malha do sistema solar; longe, uma estrela
        p = vec3(0.0);
        m = length(cam) < 12.0 ? 99.0 : ${MAG_SOL.toFixed(2)} + 2.1714724 * log(max(length(camReal) / UA_PC, 1e-9)) - 5.0;
      } else {
        p = cam + dir * ${RAIO_FUNDO.toFixed(1)};
      }
    } else if (dpc < 0.0) {
      m = 99.0;
    }
    vCor = cor;
    if (m > limite) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlfa = 0.0; return; }
    gl_Position = noFundo(projectionMatrix * modelViewMatrix * vec4(p, 1.0));
    gl_PointSize = clamp(3.6 - 0.62 * m, 1.0, 14.0) * escala;
    vAlfa = m <= 6.5 ? clamp(1.1 - 0.15 * m, 0.18, 1.0) : 0.18 * clamp(1.0 - (m - 6.5) / 5.0, 0.05, 1.0);
  }`;
const FRAGMENT = /* glsl */`
  uniform float opacidade;
  varying vec3 vCor;
  varying float vAlfa;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.35, 1.0, r);
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vCor, a * vAlfa * opacidade);
  }`;
// Via Láctea: esfera de fundo com o brilho dos contornos, somado ao céu
const VERTEX_FUNDO = /* glsl */`
  ${COMUM}
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = modo3d > 0.5 ? cam + position * ${RAIO_FUNDO.toFixed(1)} : position * ${RAIO_ESTRELAS.toFixed(1)};
    gl_Position = noFundo(projectionMatrix * modelViewMatrix * vec4(p, 1.0));
  }`;
const FRAGMENT_FUNDO = /* glsl */`
  uniform sampler2D mapa;
  uniform float intensidade;
  varying vec2 vUv;
  void main() {
    float v = texture2D(mapa, vUv).r;
    gl_FragColor = vec4(vec3(0.78, 0.82, 1.0) * v * intensidade, 1.0);
  }`;
// Objetos de céu profundo: mancha suave do tamanho aparente real (mínimo de alguns pixels), cor pelo tipo
const VERTEX_OBJETOS = /* glsl */`
  ${COMUM}
  attribute vec3 cor;
  attribute float tamanho;
  uniform float pxPorGrau;
  uniform float escala;
  varying vec3 vCor;
  varying float vPx;
  void main() {
    vCor = cor;
    vec3 dir = normalize(position);
    vec3 p = modo3d > 0.5 ? cam + dir * ${(RAIO_FUNDO * 0.99).toFixed(1)} : dir * ${(RAIO_ESTRELAS * 0.99).toFixed(1)};
    gl_Position = noFundo(projectionMatrix * modelViewMatrix * vec4(p, 1.0));
    gl_PointSize = clamp(tamanho / 60.0 * pxPorGrau, 7.0 * escala, 140.0 * escala);
    vPx = gl_PointSize / escala;
  }`;
const FRAGMENT_OBJETOS = /* glsl */`
  uniform float opacidade;
  varying vec3 vCor;
  varying float vPx;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // objeto pequeno na tela: núcleo e um anel fino que ajuda a achá-lo; grande (Nuvens de Magalhães, Andrômeda de
    // perto): só um brilho difuso e fraco, como se vê a olho nu, sem disco nem contorno
    float grande = smoothstep(18.0, 60.0, vPx);
    float nucleo = exp(-4.0 * r * r) * mix(0.55, 0.14, grande);
    float anel = 0.35 * (1.0 - grande) * (1.0 - smoothstep(0.86, 0.94, r)) * smoothstep(0.78, 0.86, r);
    float a = nucleo + anel;
    gl_FragColor = vec4(vCor, a * opacidade);
  }`;

export const TIPOS_OBJETO = {
  oc: ['Aglomerado aberto', '#bfe0ff'], gc: ['Aglomerado globular', '#fff0c0'], s: ['Galáxia espiral', '#ffd9a8'], sd: ['Galáxia espiral', '#ffd9a8'],
  e: ['Galáxia elíptica', '#ffd9a8'], i: ['Galáxia irregular', '#ffd9a8'], l: ['Galáxia lenticular', '#ffd9a8'], en: ['Nebulosa de emissão', '#ff9db0'],
  sfr: ['Nebulosa onde nascem estrelas', '#ff9db0'], pn: ['Nebulosa planetária', '#9fffe0'], snr: ['Restos de supernova', '#ffb38a'],
  rn: ['Nebulosa de reflexão', '#9fc4ff'], pos: ['Agrupamento de estrelas', '#d8dce8'], bn: ['Nebulosa', '#ff9db0'],
};

/** Cor RGB (0–1) de um corpo negro à temperatura T (aproximação de Tanner Helland), suavizada para o fundo escuro. */
function corDaTemperatura(T) {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return [r, g, b].map((v) => 0.45 + 0.55 * Math.max(0, Math.min(255, v)) / 255); // a olho nu as cores são discretas
}
// tabela de cor por B−V (−0,40 a 2,50 em passos de 0,01): evita 120 mil potências e logaritmos na montagem
const COR_BV = Array.from({ length: 291 }, (_, k) => corDaTemperatura(temperaturaCor(-0.4 + k / 100)));
const corBV = (bv) => COR_BV[Math.round((Math.max(-0.4, Math.min(2.5, Number.isFinite(bv) ? bv : 0.6)) + 0.4) * 100)];

/** Cede a vez ao navegador entre as partes da montagem. */
const pausa = () => new Promise((ok) => (globalThis.requestIdleCallback ? requestIdleCallback(ok, { timeout: 300 }) : setTimeout(ok, 16)));

/** Posição real (UA) de um ponto da cena comprimida. */
export function descomprimir(v, alvo) {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r < 1e-12) return alvo.set(0, 0, 0);
  return alvo.copy(v).multiplyScalar(Math.pow(r / DIST_ESCALA, 1 / DIST_EXP) / r);
}

/**
 * Monta o céu (vazio até os catálogos chegarem) e devolve o controle dele.
 * - estrelas: as visíveis a olho nu, ordenadas por brilho; cada uma com ra, dec, mag, bv, distPc, magAbs, hip, hd, lum,
 *   nome, bayer, flamsteed, sigla, espectro, variavel e posicao (Vector3 no céu, raio RAIO_ESTRELAS).
 * - profundas: colunas das 110.705 mais fracas (ra, dec, dpc, mag, mabs, bv, classe, hip) e nomes.
 * - objetos: céu profundo (id, nome, designacao, tipo, ra, dec, mag, dim, distAnosLuz, posicao).
 * - constelacoes: sigla → { nome (latim), genitivo, centro (Vector3 no grupo) }.
 */
export function criarEstrelas(THREE, pixelRatio) {
  const grupo = new THREE.Group(); grupo.name = 'estrelas';
  const U = {
    escala: { value: pixelRatio }, opacidade: { value: 1 }, modo3d: { value: 0 }, limite: { value: 21 },
    cam: { value: new THREE.Vector3() }, camReal: { value: new THREE.Vector3() },
  };
  const ceu = {
    grupo, linhas: null, pontos: null, profundas: null, pontosProfundos: null, via: null, pontosObjetos: null,
    estrelas: [], objetos: [], constelacoes: {}, limite: 21, modo3d: false, uniforms: U, pronto: null, prontoProfundo: null,
    girar, limitarMagnitude, definir3d, acompanharCamera, posicaoVista, magnitudeVista, estrelaProfunda, posicaoProfunda,
  };
  const material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
  const d = new Date();
  const rot = A.Rotation_EQJ_EQD(d).rot; // J2000 → equador e equinócio da data (precessão e nutação)
  /** Direção (cena: x para AR 0h, y para o norte celeste, z para −AR 6h) com precessão; grava raio·dir em alvo[i..i+2]. */
  const direcao = (raGraus, dec, alvo, i, raio = RAIO_ESTRELAS) => {
    const cd = Math.cos(dec * RAD), x = cd * Math.cos(raGraus * RAD), y = cd * Math.sin(raGraus * RAD), z = Math.sin(dec * RAD);
    const vx = rot[0][0] * x + rot[1][0] * y + rot[2][0] * z, vy = rot[0][1] * x + rot[1][1] * y + rot[2][1] * z, vz = rot[0][2] * x + rot[1][2] * y + rot[2][2] * z;
    alvo[i] = vx * raio; alvo[i + 1] = vz * raio; alvo[i + 2] = -vy * raio;
  };

  function girar(ms) { if (!ceu.modo3d) grupo.rotation.y = -A.SiderealTime(new Date(ms)) * 15 * RAD; }
  function limitarMagnitude(m) {
    ceu.limite = m; U.limite.value = m;
    if (ceu.pontosObjetos) ceu.pontosObjetos.visible = m > 0;
  }
  /** Liga o modo 3D (sistema solar e navegação livre) ou volta ao céu em volta da Terra. */
  function definir3d(ligar) { ceu.modo3d = ligar; U.modo3d.value = ligar ? 1 : 0; }
  const _v = new THREE.Vector3();
  /** A cada quadro no modo 3D: posição da câmera no referencial do grupo (comprimida e real), para brilho e fundo. */
  function acompanharCamera(camera, alturaPx) {
    if (ceu.pontosObjetos) ceu.pontosObjetos.material.uniforms.pxPorGrau.value = alturaPx / camera.fov;
    if (!ceu.modo3d) return;
    grupo.updateMatrixWorld();
    grupo.worldToLocal(_v.copy(camera.position));
    U.cam.value.copy(_v);
    descomprimir(_v, U.camReal.value);
  }
  /** Magnitude vista da câmera atual (no modo céu, a do catálogo). */
  function magnitudeVista(dir, dpc, mabs, mag) {
    if (!ceu.modo3d || !(dpc > 0)) return mag;
    const c = U.camReal.value, d = dpc * UA_PC;
    return mabs + 5 * Math.log10(Math.max(Math.hypot(dir.x * d - c.x, dir.y * d - c.y, dir.z * d - c.z) / UA_PC, 1e-7)) - 5;
  }
  /** Posição de uma estrela no grupo para o modo atual (alvo recebe; a direção vem de e.posicao). */
  function posicaoVista(e, alvo) {
    alvo.copy(e.posicao);
    if (!ceu.modo3d) return alvo;
    alvo.normalize();
    return e.distPc > 0 ? alvo.multiplyScalar(DIST_ESCALA * Math.pow(e.distPc * UA_PC, DIST_EXP)) : alvo.multiplyScalar(RAIO_FUNDO).add(U.cam.value);
  }
  function posicaoProfunda(i, alvo) {
    const P = ceu.profundas, p = P.posicao;
    alvo.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    if (!ceu.modo3d) return alvo;
    alvo.normalize();
    return P.dpc[i] > 0 ? alvo.multiplyScalar(DIST_ESCALA * Math.pow(P.dpc[i] * UA_PC, DIST_EXP)) : alvo.multiplyScalar(RAIO_FUNDO).add(U.cam.value);
  }
  /** Ficha de uma estrela fraca no mesmo formato das brilhantes (constelação pelo Astronomy Engine). */
  function estrelaProfunda(i) {
    const P = ceu.profundas, [proprio, gliese] = P.nomes[i] || [];
    const dpc = P.dpc[i] > 0 ? P.dpc[i] : null;
    const classe = P.classe[i] < P.classes.length ? P.classes[P.classe[i]] : '';
    return {
      k: i, profunda: true, ra: P.ra[i], dec: P.dec[i], mag: P.mag[i], bv: P.bv[i], distPc: dpc, magAbs: dpc ? P.mabs[i] : null,
      hip: P.hip[i] || null, hd: null, lum: dpc ? Math.pow(10, 0.4 * (4.85 - P.mabs[i])) : null,
      nome: proprio || (gliese ? gliese.replace(/^Gl /, 'Gliese ') : ''), bayer: '', flamsteed: '',
      sigla: A.Constellation(P.ra[i] / 15, P.dec[i]).symbol, espectro: classe, variavel: '',
      posicao: new THREE.Vector3(P.posicao[i * 3], P.posicao[i * 3 + 1], P.posicao[i * 3 + 2]),
    };
  }

  const pontosDe = (pos, cor, mag, mabs, dpc) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
    g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('mabs', new THREE.BufferAttribute(mabs, 1));
    g.setAttribute('dpc', new THREE.BufferAttribute(dpc, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); // o shader move os pontos: sem recorte pela câmera
    const p = new THREE.Points(g, material);
    p.frustumCulled = false; p.renderOrder = -2;
    return p;
  };
  const baixar = (arquivo, tipo = 'json') => fetch(new URL(`../vendor/ceu/${arquivo}`, import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return tipo === 'json' ? r.json() : r.arrayBuffer();
  });

  // Via Láctea (textura pequena, chega antes de tudo)
  new THREE.TextureLoader().load(new URL('../vendor/ceu/via-lactea.png', import.meta.url).href, (t) => {
    t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, mapa: { value: t }, intensidade: { value: 0.8 } }, vertexShader: VERTEX_FUNDO, fragmentShader: FRAGMENT_FUNDO,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ceu.via = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), m);
    ceu.via.frustumCulled = false; ceu.via.renderOrder = -4;
    grupo.add(ceu.via);
  });

  ceu.pronto = baixar('estrelas.json').then((cat) => {
    const n = cat.estrelas.length, N = n + 1; // + o Sol, que só aparece longe dele no modo 3D
    const pos = new Float32Array(N * 3), cor = new Float32Array(N * 3), mag = new Float32Array(N), mabs = new Float32Array(N), dpc = new Float32Array(N);
    for (let k = 0; k < n; k++) {
      const [ra, dec, m, bv, distPc, magAbs, hip, hd, lum] = cat.estrelas[k];
      const [nome, bayer, flamsteed, sigla, espectro, variavel] = cat.textos[k];
      direcao(ra, dec, pos, k * 3);
      cor.set(corBV(bv), k * 3);
      mag[k] = m; mabs[k] = magAbs ?? m; dpc[k] = distPc > 0 ? distPc : 0;
      ceu.estrelas.push({ k, ra, dec, mag: m, bv, distPc, magAbs, hip, hd, lum, nome, bayer, flamsteed, sigla, espectro, variavel,
        posicao: new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]) });
    }
    pos.set([RAIO_ESTRELAS, 0, 0], n * 3); cor.set(corBV(0.65), n * 3); mag[n] = 99; mabs[n] = MAG_SOL; dpc[n] = -1;
    ceu.pontos = pontosDe(pos, cor, mag, mabs, dpc);

    const seg = [], tmp = [0, 0, 0];
    for (const [sigla, c] of Object.entries(cat.constelacoes)) {
      const centro = new THREE.Vector3();
      for (const traco of c.linhas) {
        for (let i = 0; i < traco.length; i++) {
          if (i) seg.push(traco[i - 1], traco[i]);
          direcao(traco[i][0], traco[i][1], tmp, 0); centro.x += tmp[0]; centro.y += tmp[1]; centro.z += tmp[2];
        }
      }
      ceu.constelacoes[sigla] = { nome: c.nome, genitivo: c.gen, centro: centro.setLength(RAIO_ESTRELAS) };
    }
    const lp = new Float32Array(seg.length * 3);
    seg.forEach(([ra, dec], i) => direcao(ra, dec, lp, i * 3));
    const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    ceu.linhas = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: 0x7f9cc8, transparent: true, opacity: 0.22, depthWrite: false }));
    ceu.linhas.visible = false; ceu.linhas.renderOrder = -3;

    grupo.add(ceu.linhas, ceu.pontos);
    limitarMagnitude(ceu.limite);
    ceu.prontoProfundo = carregarProfundo();
    return ceu;
  });

  // Estrelas fracas e céu profundo: depois das brilhantes, em partes, sem tarefa longa
  async function carregarProfundo() {
    const [bin, extra, objs] = await Promise.all([baixar('estrelas-profundas.bin', 'bin'), baixar('estrelas-profundas.json'), baixar('objetos.json')]);
    await pausa();
    const v = new DataView(bin);
    if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'HYG1') throw new Error('estrelas-profundas.bin inválido');
    const n = v.getUint32(4, true);
    let o = 8;
    const hip = new Uint32Array(bin.slice(o, o += 4 * n)), raQ = new Uint16Array(bin.slice(o, o += 2 * n)), decQ = new Int16Array(bin.slice(o, o += 2 * n));
    const distQ = new Uint16Array(bin.slice(o, o += 2 * n)), magQ = new Int16Array(bin.slice(o, o += 2 * n)), ciQ = new Int16Array(bin.slice(o, o += 2 * n));
    const classe = new Uint8Array(bin.slice(o, o + n));
    const P = { n, hip, classe, classes: extra.classes, nomes: extra.nomes, ra: new Float32Array(n), dec: new Float32Array(n), dpc: new Float32Array(n),
      mag: new Float32Array(n), mabs: new Float32Array(n), bv: new Float32Array(n), posicao: new Float32Array(n * 3) };
    const cor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (i % 20000 === 19999) await pausa();
      const ra = raQ[i] / 65536 * 360, dec = decQ[i] / 32767 * 90;
      P.ra[i] = ra; P.dec[i] = dec;
      P.mag[i] = magQ[i] / 100;
      P.dpc[i] = distQ[i] ? Math.pow(10, (distQ[i] - 1) / 65534 * 6 - 1) : 0;
      P.mabs[i] = P.dpc[i] ? P.mag[i] - 5 * Math.log10(P.dpc[i]) + 5 : P.mag[i];
      P.bv[i] = ciQ[i] === 32767 ? NaN : ciQ[i] / 1000;
      direcao(ra, dec, P.posicao, i * 3);
      cor.set(corBV(P.bv[i]), i * 3);
    }
    ceu.profundas = P;
    ceu.pontosProfundos = pontosDe(P.posicao, cor, P.mag, P.mabs, P.dpc);
    grupo.add(ceu.pontosProfundos);
    await pausa();

    const m = objs.objetos.length, pos = new Float32Array(m * 3), corO = new Float32Array(m * 3), tam = new Float32Array(m), c = new THREE.Color();
    objs.objetos.forEach((ob, i) => {
      direcao(ob.ra, ob.dec, pos, i * 3);
      c.set(TIPOS_OBJETO[ob.tipo]?.[1] || '#d8dce8'); corO.set([c.r, c.g, c.b], i * 3);
      tam[i] = Math.max(...String(ob.dim || '1').split('x').map(Number).filter(Number.isFinite), 1);
      ceu.objetos.push({ ...ob, posicao: new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cor', new THREE.BufferAttribute(corO, 3)); g.setAttribute('tamanho', new THREE.BufferAttribute(tam, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    ceu.pontosObjetos = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { ...U, pxPorGrau: { value: 20 } }, vertexShader: VERTEX_OBJETOS, fragmentShader: FRAGMENT_OBJETOS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ceu.pontosObjetos.frustumCulled = false; ceu.pontosObjetos.renderOrder = -3;
    grupo.add(ceu.pontosObjetos);
    limitarMagnitude(ceu.limite);
    return ceu;
  }
  return ceu;
}

/** Ajusta o tamanho dos pontos quando a resolução do canvas muda (o tamanho é em pixels de tela). */
export function ajustarEscalaEstrelas(ceu, pixelRatio) {
  if (ceu?.uniforms) ceu.uniforms.escala.value = pixelRatio;
}

/** Posição de um objeto de céu profundo no grupo para o modo atual. */
export function posicaoObjeto(ceu, ob, alvo) {
  alvo.copy(ob.posicao).normalize();
  return ceu.modo3d ? alvo.multiplyScalar(RAIO_FUNDO * 0.99).add(ceu.uniforms.cam.value) : alvo.multiplyScalar(RAIO_ESTRELAS * 0.99);
}
