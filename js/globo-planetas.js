// Desenho dos planetas, das luas e dos anéis de Saturno no sistema solar: um material próprio no lugar do material
// pronto do three.js, para ter o que um corpo real tem e o genérico não dá: achatamento nos polos, terminador suave,
// escurecimento de borda nos gigantes gasosos, brilho da atmosfera no limbo, sombra dos anéis sobre o planeta, sombra do
// planeta sobre os anéis, luzes das cidades na noite da Terra e borda sem serrilhado (suavizada no próprio shader).
//
// As contas de luz são feitas em espaço linear; a saída passa pela conversão de cor padrão do three.js.

/** Achatamento polar (1 − raio polar ÷ raio equatorial), valores da IAU (Archinal et al. 2018). */
export const ACHATAMENTO = { Earth: 0.00335, Mars: 0.00589, Jupiter: 0.06487, Saturn: 0.09796, Uranus: 0.02293, Neptune: 0.01708 };
/** Gigantes com atmosfera espessa: sem superfície, a borda do disco escurece. */
const GASOSOS = new Set(['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Venus']);
/** Cor e força do brilho da atmosfera no limbo (linear). */
const ATMOSFERA = { Earth: [[0.25, 0.5, 1.0], 0.9], Venus: [[1.0, 0.9, 0.7], 0.35], Mars: [[0.9, 0.55, 0.35], 0.18], Jupiter: [[0.9, 0.8, 0.65], 0.12],
  Saturn: [[0.95, 0.85, 0.6], 0.12], Uranus: [[0.6, 0.9, 1.0], 0.3], Neptune: [[0.35, 0.55, 1.0], 0.35], tita: [[1.0, 0.65, 0.25], 0.5] };

const VERTEX = /* glsl */`
  uniform float achat;
  varying vec3 vNormal, vMundo;
  varying vec2 vUv;
  void main() {
    vec3 p = position; p.y *= 1.0 - achat;
    vec3 n = normalize(vec3(normal.x, normal.y / (1.0 - achat), normal.z));
    vec4 w = modelMatrix * vec4(p, 1.0);
    vMundo = w.xyz; vNormal = mat3(modelMatrix) * n; vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAGMENT = /* glsl */`
  uniform sampler2D mapa, mapaNoite, mapaAnel;
  uniform vec3 sol, centro, eixo, atm, tinta;
  uniform vec4 anel;            // raio interno e externo na cena, raio do planeta na cena, 1 se há anéis
  uniform vec3 anelKm;          // raio do planeta e limites dos anéis em km (escala logarítmica da cena)
  uniform float forcaAtm, gasoso, temNoite;
  varying vec3 vNormal, vMundo;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vNormal), L = normalize(sol - vMundo), V = normalize(cameraPosition - vMundo);
    float nl = dot(N, L), nv = max(dot(N, V), 0.0);
    vec3 cor = texture2D(mapa, vUv).rgb * tinta;
    float dia = max(nl, 0.0);
    dia = mix(dia, pow(dia, 0.8) * (0.5 + 0.5 * sqrt(nv)), gasoso) * smoothstep(-0.04, 0.08, nl);
    if (anel.w > 0.5) {                               // sombra dos anéis: do ponto em direção ao Sol, cruza o plano do equador?
      float den = dot(L, eixo);
      float t = abs(den) > 1e-4 ? dot(centro - vMundo, eixo) / den : -1.0;
      if (t > 0.0) {
        float r = length(vMundo + L * t - centro);
        if (r > anel.x && r < anel.y) {
          float u = (anelKm.x * exp(r / anel.z - 1.0) - anelKm.y) / (anelKm.z - anelKm.y);
          dia *= 1.0 - 0.85 * texture2D(mapaAnel, vec2(u, 0.5)).a;
        }
      }
    }
    vec3 c = cor * (dia * 1.25 + 0.006);
    c += atm * forcaAtm * pow(1.0 - nv, 2.6) * smoothstep(-0.25, 0.35, nl);
    if (temNoite > 0.5) c += texture2D(mapaNoite, vUv).rgb * smoothstep(0.06, -0.18, nl) * 0.9;
    gl_FragColor = vec4(c, clamp(nv / max(fwidth(nv) * 1.5, 1e-5), 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

const VERTEX_ANEL = /* glsl */`
  varying vec3 vMundo;
  varying float vRaio;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vMundo = w.xyz; vRaio = length(position.xy);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAGMENT_ANEL = /* glsl */`
  uniform sampler2D mapa;
  uniform vec3 sol, centro, eixo, anelKm;
  uniform float rPlaneta;
  varying vec3 vMundo;
  varying float vRaio;
  float acaso(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  float ruido(float x) { float i = floor(x), f = fract(x); return mix(acaso(i), acaso(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float u = (anelKm.x * exp(vRaio / rPlaneta - 1.0) - anelKm.y) / (anelKm.z - anelKm.y);
    vec4 t = texture2D(mapa, vec2(u, 0.5));
    // milhares de anéis finos dentro de cada faixa: a textura dá as grandes divisões, o ruído dá a estrutura de perto
    float fino = 0.78 + 0.22 * (ruido(u * 420.0) * 0.6 + ruido(u * 1900.0) * 0.4) * 1.6;
    vec3 L = normalize(sol - vMundo), V = normalize(cameraPosition - vMundo);
    float mesmoLado = step(0.0, dot(L, eixo) * dot(V, eixo));
    float luz = mix(0.1 + 0.5 * (1.0 - t.a) * t.a * 2.0, 1.0, mesmoLado);     // por baixo, só a luz que atravessa
    vec3 oc = vMundo - centro;                                               // sombra do planeta sobre os anéis
    float b = dot(oc, L), d = sqrt(max(dot(oc, oc) - b * b, 0.0));
    if (b < 0.0) luz *= mix(0.03, 1.0, smoothstep(rPlaneta * 0.94, rPlaneta * 1.0, d));
    gl_FragColor = vec4(t.rgb * luz * fino * 1.15, t.a * clamp(fino, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

/**
 * Material de um planeta ou lua.
 * @param {typeof import('../vendor/three/three.module.min.js')} THREE
 * @param {{ mapa: object, corpo?: string, tinta?: string }} o mapa inicial, corpo (chave do Astronomy Engine ou da lua)
 *   e uma cor que multiplica o mapa (luas sem mapa próprio)
 */
export function materialCorpo(THREE, { mapa, corpo = '', tinta = '#ffffff' }) {
  const [atm, forca] = ATMOSFERA[corpo] || [[0, 0, 0], 0];
  return new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
    uniforms: { mapa: { value: mapa }, mapaNoite: { value: null }, mapaAnel: { value: null }, sol: { value: new THREE.Vector3() }, centro: { value: new THREE.Vector3() },
      eixo: { value: new THREE.Vector3(0, 1, 0) }, atm: { value: new THREE.Vector3(...atm) }, tinta: { value: new THREE.Color(tinta) }, anel: { value: new THREE.Vector4(0, 0, 1, 0) },
      anelKm: { value: new THREE.Vector3(1, 0, 1) }, forcaAtm: { value: forca }, gasoso: { value: GASOSOS.has(corpo) ? 1 : 0 }, temNoite: { value: 0 }, achat: { value: ACHATAMENTO[corpo] || 0 } } });
}

/**
 * Material dos anéis, ligado ao material do planeta (que passa a receber a sombra deles).
 * @param {object} planeta material do planeta (materialCorpo)
 * @param {{ mapa: object, de: number, ate: number, r: number, km: [number, number, number] }} o raios na cena
 *   (interno, externo e do planeta) e em km (planeta, interno, externo)
 */
export function materialAnel(THREE, planeta, { mapa, de, ate, r, km }) {
  const u = planeta.uniforms;
  u.anel.value.set(de, ate, r, 1); u.anelKm.value.set(...km); u.mapaAnel.value = mapa;
  return new THREE.ShaderMaterial({ vertexShader: VERTEX_ANEL, fragmentShader: FRAGMENT_ANEL, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: { mapa: { value: mapa }, sol: u.sol, centro: u.centro, eixo: u.eixo, anelKm: u.anelKm, rPlaneta: { value: r } } });
}
