// Céu de fundo do Globo: as 8.920 estrelas até a magnitude 6,5 (o limite do olho nu em céu muito escuro), as linhas
// e os nomes das 88 constelações, na posição verdadeira para o instante mostrado.
//
// Catálogo (vendor/ceu/estrelas.json, montado por scripts/globo/montar-estrelas.py):
// - HYG Database v4.1 (David Nash, CC BY-SA 4.0), que reúne Hipparcos, Yale Bright Star e Gliese: posição, magnitude,
//   índice de cor B−V, distância (paralaxe do Hipparcos), magnitude absoluta, luminosidade, tipo espectral,
//   designações (Bayer, Flamsteed, HIP, HD), nome próprio da IAU e marca de variável.
// - Posições J2000 levadas à época 2026,0 pelo movimento próprio. Ao montar, as direções vão ao equador da data
//   (precessão e nutação do Astronomy Engine); a cada atualização o grupo gira pelo tempo sideral.
// - Linhas das constelações: d3-celestial (Olaf Frohn, BSD-3).
// As estrelas vêm ordenadas por brilho: o filtro de magnitude é só o tamanho do trecho desenhado (setDrawRange).
import * as A from '../vendor/astronomy/astronomy.min.js';
import { temperaturaCor } from './ceu.js';

const RAD = Math.PI / 180;
export const RAIO_ESTRELAS = 60;

const VERTEX = /* glsl */`
  attribute float mag;
  attribute vec3 cor;
  uniform float escala;
  varying vec3 vCor;
  varying float vAlfa;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(3.4 - 0.5 * mag, 1.2, 6.5) * escala;
    vAlfa = clamp(1.1 - 0.15 * mag, 0.18, 1.0);
    vCor = cor;
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

/** Cor RGB (0–1) de um corpo negro à temperatura T (aproximação de Tanner Helland), suavizada para o fundo escuro. */
function corDaTemperatura(T) {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return [r, g, b].map((v) => 0.45 + 0.55 * Math.max(0, Math.min(255, v)) / 255); // a olho nu as cores são discretas
}

/**
 * Monta o céu (vazio até o catálogo chegar) e devolve o controle dele.
 * - estrelas: lista ordenada por brilho; cada uma com ra, dec, mag, bv, distPc, magAbs, hip, hd, lum, nome, bayer,
 *   flamsteed, sigla, espectro, variavel e posicao (Vector3 no grupo).
 * - constelacoes: sigla → { nome (latim), genitivo, centro (Vector3 no grupo) }.
 * - limitarMagnitude(m): só as estrelas até a magnitude m ficam visíveis (e tocáveis).
 */
export function criarEstrelas(THREE, pixelRatio) {
  const grupo = new THREE.Group(); grupo.name = 'estrelas';
  const ceu = { grupo, linhas: null, pontos: null, estrelas: [], constelacoes: {}, limite: 6.5, pronto: null, girar, limitarMagnitude };

  function girar(ms) { grupo.rotation.y = -A.SiderealTime(new Date(ms)) * 15 * RAD; }
  function limitarMagnitude(m) {
    ceu.limite = m;
    if (!ceu.pontos) return;
    let n = 0; while (n < ceu.estrelas.length && ceu.estrelas[n].mag <= m) n++;
    ceu.pontos.geometry.setDrawRange(0, n);
    ceu.visiveis = n;
  }

  ceu.pronto = fetch(new URL('../vendor/ceu/estrelas.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then((cat) => {
    const d = new Date();
    const rot = A.Rotation_EQJ_EQD(d); // J2000 → equador e equinócio da data (precessão e nutação)
    const direcao = (raGraus, dec, alvo, i) => { // cena: x para AR 0h, y para o norte celeste, z para −AR 6h
      const cd = Math.cos(dec * RAD);
      const v = A.RotateVector(rot, new A.Vector(cd * Math.cos(raGraus * RAD), cd * Math.sin(raGraus * RAD), Math.sin(dec * RAD), d));
      alvo[i] = v.x * RAIO_ESTRELAS; alvo[i + 1] = v.z * RAIO_ESTRELAS; alvo[i + 2] = -v.y * RAIO_ESTRELAS;
    };

    const n = cat.estrelas.length, pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), mag = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const [ra, dec, m, bv, distPc, magAbs, hip, hd, lum] = cat.estrelas[k];
      const [nome, bayer, flamsteed, sigla, espectro, variavel] = cat.textos[k];
      direcao(ra, dec, pos, k * 3);
      cor.set(corDaTemperatura(temperaturaCor(Number.isFinite(bv) ? bv : 0.6)), k * 3);
      mag[k] = m;
      ceu.estrelas.push({ k, ra, dec, mag: m, bv, distPc, magAbs, hip, hd, lum, nome, bayer, flamsteed, sigla, espectro, variavel,
        posicao: new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]) });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
    g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    ceu.pontos = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { escala: { value: pixelRatio }, opacidade: { value: 1 } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    }));
    ceu.pontos.renderOrder = -2;

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
    return ceu;
  });
  return ceu;
}

/** Ajusta o tamanho dos pontos quando a resolução do canvas muda (o tamanho é em pixels de tela). */
export function ajustarEscalaEstrelas(ceu, pixelRatio) {
  if (ceu?.pontos) ceu.pontos.material.uniforms.escala.value = pixelRatio;
}
