// Céu de fundo do Globo: as 5.044 estrelas reais até a magnitude 6 (o limite do olho nu) e as linhas das 88
// constelações, na posição verdadeira para o instante mostrado.
//
// Catálogo: d3-celestial (Olaf Frohn, BSD-3), compilado do Hipparcos e do Yale Bright Star Catalogue; coordenadas
// J2000. Ao montar, as direções são levadas ao equador da data (precessão do Astronomy Engine); depois, a cada
// atualização, o grupo gira em torno do eixo da Terra pelo tempo sideral, como o céu real gira sobre o globo.
// Tamanho e opacidade de cada ponto seguem a magnitude; a cor segue o índice B−V (estrelas quentes azuladas, frias
// alaranjadas). Só as estrelas com nome entram nos rótulos e no toque.
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
    gl_PointSize = clamp(3.4 - 0.5 * mag, 1.3, 6.5) * escala;
    vAlfa = clamp(1.1 - 0.15 * mag, 0.22, 1.0);
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

/** Cor RGB (0–1) de um corpo negro à temperatura T, pela aproximação de Tanner Helland, suavizada para o fundo escuro. */
function corDaTemperatura(T) {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255);
  return c.map((v) => 0.45 + 0.55 * v); // mistura com branco: no céu a olho nu as cores são discretas
}

/**
 * Monta o céu (vazio até o catálogo chegar) e devolve o controle dele.
 * @returns {{grupo:object, linhas:object|null, nomeadas:Array, pronto:Promise, girar:(ms:number)=>void}}
 */
export function criarEstrelas(THREE, pixelRatio) {
  const grupo = new THREE.Group(); grupo.name = 'estrelas';
  const ceu = { grupo, linhas: null, pontos: null, nomeadas: [], constelacoes: {}, pronto: null, girar };

  function girar(ms) { grupo.rotation.y = -A.SiderealTime(new Date(ms)) * 15 * RAD; }

  ceu.pronto = fetch(new URL('../vendor/ceu/estrelas.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then((cat) => {
    const prec = A.Rotation_EQJ_EQD(new Date());
    const direcao = (raGraus, dec, alvo, i) => { // J2000 → equador da data → cena (x: RA 0h, y: norte, z: −RA 6h)
      const cd = Math.cos(dec * RAD);
      const v = A.RotateVector(prec, new A.Vector(cd * Math.cos(raGraus * RAD), cd * Math.sin(raGraus * RAD), Math.sin(dec * RAD), null));
      alvo[i] = v.x * RAIO_ESTRELAS; alvo[i + 1] = v.z * RAIO_ESTRELAS; alvo[i + 2] = -v.y * RAIO_ESTRELAS;
    };

    const n = cat.estrelas.length, pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), mag = new Float32Array(n);
    cat.estrelas.forEach(([ra, dec, m, bv, hip], k) => {
      direcao(ra, dec, pos, k * 3);
      cor.set(corDaTemperatura(temperaturaCor(Number.isFinite(bv) ? bv : 0.6)), k * 3);
      mag[k] = m;
      const nome = cat.nomes[hip];
      if (nome) {
        ceu.nomeadas.push({ hip, nome: nome[0], letra: nome[1], sigla: nome[2], ra, dec, mag: m, bv,
          posicao: new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]) });
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
    g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    ceu.pontos = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { escala: { value: pixelRatio }, opacidade: { value: 1 } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    }));
    ceu.pontos.renderOrder = -2;

    const seg = [];
    for (const [sigla, c] of Object.entries(cat.constelacoes)) {
      ceu.constelacoes[sigla] = { nome: c.nome, genitivo: c.gen };
      for (const traco of c.linhas) for (let i = 1; i < traco.length; i++) seg.push(traco[i - 1], traco[i]);
    }
    const lp = new Float32Array(seg.length * 3);
    seg.forEach(([ra, dec], i) => direcao(ra, dec, lp, i * 3));
    const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    ceu.linhas = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: 0x7f9cc8, transparent: true, opacity: 0.2, depthWrite: false }));
    ceu.linhas.visible = false; ceu.linhas.renderOrder = -3;

    ceu.nomeadas.sort((a, b) => a.mag - b.mag);
    grupo.add(ceu.linhas, ceu.pontos);
    return ceu;
  });
  return ceu;
}

/** Ajusta o tamanho dos pontos quando a resolução do canvas muda (o tamanho é em pixels de tela). */
export function ajustarEscalaEstrelas(ceu, pixelRatio) {
  if (ceu?.pontos) ceu.pontos.material.uniforms.escala.value = pixelRatio;
}
