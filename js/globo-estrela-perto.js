// Estrelas vistas de perto: no modo 3D (sistema solar e navegação livre), as estrelas mais próximas da câmera deixam
// de ser só um ponto e ganham uma esfera com fotosfera própria: cor pela temperatura, granulação, escurecimento de
// borda e manchas nas estrelas frias. O tamanho vem do raio estimado pelo brilho e pela cor de cada uma.
//
// O que é medido e o que é desenhado:
// - Medido (catálogo HYG/Gaia DR3): distância, magnitude absoluta e índice de cor B−V.
// - Estimado a partir disso: temperatura (Ballesteros 2012), correção bolométrica (Reed 1998) e raio (Stefan-Boltzmann).
// - Desenhado: o padrão da superfície. Nenhuma estrela além do Sol tem mapa de superfície; a granulação é uma
//   ilustração com células maiores nas gigantes, como a teoria da convecção prevê.
// O raio na cena passa pela mesma compressão de distâncias do sistema solar (o Sol tem 0,11 unidade).
import { DIST_ESCALA, DIST_EXP, corBV } from './globo-estrelas.js';
import { texturaBrilho } from './globo-texturas.js';

const T_SOL = 5772;            // K (IAU 2015)
const RAIO_SOL_UA = 0.00465047; // raio do Sol em UA
const MBOL_SOL = 4.74;         // magnitude bolométrica absoluta do Sol (IAU 2015)
const QUANTAS = 4;             // esferas simultâneas (as mais próximas da câmera)

/**
 * Raio (raios solares) e temperatura efetiva (K) medidos de estrelas conhecidas, por número Hipparcos: interferometria
 * e espectroscopia (compilação dos valores adotados na literatura; CHARA, VLTI, Kervella et al., Boyajian et al.,
 * Baines et al.). Para estas, vale a medida; para as outras, a estimativa de `fisicaEstelar`. Supergigantes variam e
 * têm distância incerta: o valor é o adotado mais comum.
 */
const MEDIDAS = {
  32349: [1.711, 9940], 27989: [764, 3600], 69673: [25.4, 4286], 24436: [78.9, 12100], 91262: [2.5, 9600], 37279: [2.05, 6530], 21421: [45.1, 3900],
  80763: [680, 3660], 30438: [71, 7400], 37826: [9.06, 4586], 71683: [1.22, 5790], 71681: [0.863, 5260], 70890: [0.154, 3042], 97649: [1.8, 7670],
  65474: [7.47, 25300], 113368: [1.84, 8590], 49669: [4.35, 11670], 102098: [203, 8525], 87937: [0.196, 3134], 24608: [11.98, 4970], 7588: [9.16, 15000],
  11767: [37.5, 6015], 25336: [5.75, 22000], 36850: [2.09, 10286], 10826: [332, 3000], 8102: [0.793, 5344], 16537: [0.735, 5084], 104214: [0.665, 4526],
};

/**
 * Temperatura, luminosidade e raio de uma estrela: medidos, quando ela está em MEDIDAS, ou estimados.
 * @param {number} magAbs magnitude absoluta visual
 * @param {number} bv índice de cor B−V
 * @param {number} [hip] número Hipparcos, quando houver
 * @returns {{ teff: number, lum: number, raioSol: number, medido: boolean }}
 */
export function fisicaEstelar(magAbs, bv, hip = 0) {
  const m = MEDIDAS[hip];
  if (m) return { teff: m[1], lum: m[0] * m[0] * (m[1] / T_SOL) ** 4, raioSol: m[0], medido: true };
  const c = Math.max(-0.35, Math.min(2.0, Number.isFinite(bv) ? bv : 0.65));
  const teff = 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
  const x = Math.log10(teff) - 4;
  const bc = Math.max(-4.5, -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x * x - 3.901 * x - 0.438);
  const lum = Math.pow(10, -0.4 * (magAbs + bc - MBOL_SOL));
  const raioSol = Math.max(0.008, Math.min(1800, Math.sqrt(lum) * (T_SOL / teff) ** 2));
  return { teff, lum, raioSol, medido: false };
}

/** Raio na cena comprimida de uma estrela com `raioSol` raios solares. */
export const raioNaCena = (raioSol) => DIST_ESCALA * Math.pow(raioSol * RAIO_SOL_UA, DIST_EXP);

const VERTEX = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vVista;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vVista = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAGMENT = /* glsl */`
  uniform vec3 cor;
  uniform float tempo, celulas, manchas, opacidade;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vVista;
  float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float ruido(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // células de convecção: distância ao centro da célula mais próxima (Worley), claras no meio e escuras nas bordas
  float granulos(vec3 p) {
    vec3 i = floor(p), f = fract(p); float d = 1.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = vec3(h(i + g), h(i + g + 17.0), h(i + g + 31.0));
      o = 0.5 + 0.4 * sin(tempo * 0.6 + 6.2831 * o);
      d = min(d, length(g + o - f));
    }
    return d;
  }
  void main() {
    vec3 n = normalize(vLocal);
    float mu = clamp(dot(normalize(vNormal), normalize(vVista)), 0.0, 1.0);
    float g = 1.0 - granulos(n * celulas);
    float fino = ruido(n * celulas * 3.1 + tempo * 0.05);
    float largo = ruido(n * 3.0 + 11.0);
    float brilho = 0.70 + 0.40 * g * g + 0.10 * (fino - 0.5) + 0.14 * (largo - 0.5);
    // manchas (estrelas frias): regiões escuras em latitudes médias
    float m = smoothstep(0.66, 0.82, ruido(n * 5.0 + 3.0)) * manchas * smoothstep(0.75, 0.2, abs(n.y));
    brilho *= 1.0 - 0.45 * m;
    // escurecimento de borda (lei linear, u = 0,6) com a borda mais avermelhada
    float borda = 1.0 - 0.6 * (1.0 - mu);
    vec3 c = cor * brilho * borda * 1.2;
    c += vec3(max(brilho * borda - 0.92, 0.0)) * 0.9; // o miolo das células mais quentes tende ao branco
    c = mix(c * vec3(1.0, 0.82, 0.66), c, smoothstep(0.0, 0.55, mu));
    c += cor * pow(1.0 - mu, 5.0) * 0.35; // cromosfera fina na borda
    gl_FragColor = vec4(c, opacidade * clamp(mu / max(fwidth(mu) * 1.5, 1e-5), 0.0, 1.0));
  }`;

/**
 * Cria as esferas das estrelas próximas.
 * @param {typeof import('../vendor/three/three.module.min.js')} THREE
 * @param {object} ceu céu do globo (globo-estrelas.js), com as estrelas e o grupo delas
 * @returns {{ grupo: object, atualizar: (camera: object, agora: number, alturaPx: number) => void, raioEm: (p: object) => number,
 *   fisicaEm: (p: object) => ({ teff: number, lum: number, raioSol: number } | null) }}
 */
export function criarEstrelasPerto(THREE, ceu) {
  const grupo = new THREE.Group(); grupo.name = 'estrelas de perto';
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const esferas = Array.from({ length: QUANTAS }, () => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
      uniforms: { cor: { value: new THREE.Color() }, tempo: { value: 0 }, celulas: { value: 40 }, manchas: { value: 0 }, opacidade: { value: 1 } } }));
    m.visible = false; m.renderOrder = 6; grupo.add(m); // depois dos pontos do céu, que não podem aparecer por cima do disco
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(3.4); halo.renderOrder = 5; m.add(halo); m.userData.halo = halo; // brilho em volta do disco
    return m;
  });
  let lista = null, comProfundas = false, ultimo = 0;
  const v = new THREE.Vector3();

  /** Estrelas com distância medida, na posição da cena (fixa no modo 3D), com o raio estimado. Montada uma vez. */
  function montarLista() {
    const m = ceu.grupo.matrixWorld, out = [];
    const por = (pos, magAbs, bv, hip) => {
      if (!Number.isFinite(magAbs) || pos.lengthSq() < 0.25) return; // o Sol tem a maquete própria
      const f = fisicaEstelar(magAbs, bv, hip);
      out.push({ pos, f, raio: raioNaCena(f.raioSol), bv });
    };
    for (const e of ceu.estrelas) if (e.distPc > 0) por(ceu.posicaoVista(e, new THREE.Vector3()).applyMatrix4(m), e.magAbs, e.bv, e.hip);
    const P = ceu.profundas;
    if (P) for (let i = 0; i < P.nHyg; i++) if (P.dpc[i] > 0) por(ceu.posicaoProfunda(i, new THREE.Vector3()).applyMatrix4(m), P.mabs[i], P.bv[i], P.hip[i]);
    lista = out; comProfundas = !!P;
  }

  function maisProxima(p, tolerancia) {
    if (!lista) return null;
    let melhor = null, dm = tolerancia * tolerancia;
    for (const s of lista) { const d = s.pos.distanceToSquared(p); if (d < dm) { dm = d; melhor = s; } }
    return melhor;
  }

  /**
   * A cada quadro no modo 3D: escolhe (algumas vezes por segundo) as estrelas mais próximas e desenha as que já têm
   * tamanho na tela; as outras continuam sendo o ponto do catálogo.
   */
  function atualizar(camera, agora, alturaPx) {
    grupo.visible = !!ceu.modo3d;
    if (!ceu.modo3d || !ceu.estrelas.length) return;
    if (!lista || comProfundas !== !!ceu.profundas) { ceu.grupo.updateMatrixWorld(); montarLista(); }
    if (agora - ultimo > 300) {
      ultimo = agora;
      const cam = camera.position, pxPorRad = alturaPx / (2 * Math.tan(camera.fov * Math.PI / 360));
      const perto = [];
      for (const s of lista) {
        const d = s.pos.distanceTo(cam), px = s.raio / Math.max(d, 1e-9) * pxPorRad;
        if (px > 1.2) perto.push({ s, px });
      }
      perto.sort((a, b) => b.px - a.px);
      esferas.forEach((m, k) => {
        const it = perto[k];
        m.visible = !!it;
        if (!it) return;
        const u = m.material.uniforms, c = corBV(it.s.bv);
        m.position.copy(it.s.pos); m.scale.setScalar(it.s.raio);
        u.opacidade.value = Math.min(1, (it.px - 1.2) / 2.5); // aparece aos poucos por cima do ponto
        // a cor dos pontos do céu é suave, para não cansar; de perto a estrela mostra a cor da temperatura com mais força
        const media = (c[0] + c[1] + c[2]) / 3, sat = 2.1;
        u.cor.value.setRGB(Math.max(0, media + (c[0] - media) * sat), Math.max(0, media + (c[1] - media) * sat), Math.max(0, media + (c[2] - media) * sat));
        m.userData.halo.material.color.copy(u.cor.value); m.userData.halo.material.opacity = 0.9 * u.opacidade.value;
        // gigantes têm poucas células enormes; anãs, milhares de grânulos pequenos
        u.celulas.value = Math.max(5, Math.min(70, 42 / Math.pow(Math.max(it.s.f.raioSol, 0.1), 0.38)));
        u.manchas.value = it.s.f.teff < 5200 ? Math.min(1, (5200 - it.s.f.teff) / 1500) : 0.15;
      });
    }
    for (const m of esferas) if (m.visible) m.material.uniforms.tempo.value = agora / 1000;
  }

  return {
    grupo, atualizar,
    raioEm: (p) => maisProxima(v.copy(p), 0.02)?.raio || 0,
    fisicaEm: (p) => maisProxima(v.copy(p), 0.02)?.f || null,
  };
}
