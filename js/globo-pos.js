// Pós-processamento da cena do universo: a cena é desenhada num alvo de alta faixa dinâmica (meio-flutuante), onde
// milhares de pontos somados no mesmo pixel guardam o brilho real em vez de estourar no branco. Depois vêm o halo de
// luz (bloom em pirâmide, que conserva a energia) e a curva de tom, que comprime só os valores altos e preserva a cor.
//
// Convenção de cor: os valores do alvo já são os da tela (os materiais próprios do Globo escrevem assim). Os materiais
// prontos do three.js (fotografias, imagem da Via Láctea, linhas) escrevem linear num alvo fora da tela; `adaptar`
// faz com que escrevam na mesma convenção.
//
// Sem suporte a alvo meio-flutuante (WebGL antigo), `criarPos` devolve um desenho direto, sem efeitos.

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// redução pela metade com 13 amostras (Jimenez 2014): não pisca com pontos de 1 px
const FRAG_REDUZIR = /* glsl */`
  uniform sampler2D mapa; uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec3 a = texture2D(mapa, vUv + texel * vec2(-2.0, 2.0)).rgb, b = texture2D(mapa, vUv + texel * vec2(0.0, 2.0)).rgb, c = texture2D(mapa, vUv + texel * vec2(2.0, 2.0)).rgb;
    vec3 d = texture2D(mapa, vUv + texel * vec2(-2.0, 0.0)).rgb, e = texture2D(mapa, vUv).rgb, f = texture2D(mapa, vUv + texel * vec2(2.0, 0.0)).rgb;
    vec3 g = texture2D(mapa, vUv + texel * vec2(-2.0, -2.0)).rgb, h = texture2D(mapa, vUv + texel * vec2(0.0, -2.0)).rgb, i = texture2D(mapa, vUv + texel * vec2(2.0, -2.0)).rgb;
    vec3 j = texture2D(mapa, vUv + texel * vec2(-1.0, 1.0)).rgb, k = texture2D(mapa, vUv + texel * vec2(1.0, 1.0)).rgb;
    vec3 l = texture2D(mapa, vUv + texel * vec2(-1.0, -1.0)).rgb, m = texture2D(mapa, vUv + texel * vec2(1.0, -1.0)).rgb;
    gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
  }`;

// ampliação com filtro em tenda 3×3, somada ao nível de cima (mistura aditiva no material)
const FRAG_AMPLIAR = /* glsl */`
  uniform sampler2D mapa; uniform vec2 texel; uniform float peso;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(mapa, vUv).rgb * 4.0;
    s += (texture2D(mapa, vUv + texel * vec2(-1.0, 0.0)).rgb + texture2D(mapa, vUv + texel * vec2(1.0, 0.0)).rgb + texture2D(mapa, vUv + texel * vec2(0.0, -1.0)).rgb + texture2D(mapa, vUv + texel * vec2(0.0, 1.0)).rgb) * 2.0;
    s += texture2D(mapa, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(mapa, vUv + texel * vec2(1.0, -1.0)).rgb + texture2D(mapa, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(mapa, vUv + texel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(s / 16.0 * peso, 1.0);
  }`;

// composição: cena + halo, curva de tom pelo canal mais forte (a cor não muda), vinheta leve e ruído de 1 nível contra faixas
const FRAG_FINAL = /* glsl */`
  uniform sampler2D cena, halo; uniform float forca, exposicao, vinheta; uniform vec3 tinta;
  varying vec2 vUv;
  float ruido(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = texture2D(cena, vUv).rgb + texture2D(halo, vUv).rgb * tinta * forca;
    c *= exposicao;
    float m = max(c.r, max(c.g, c.b));
    if (m > 0.55) {                                  // ombro: até 0,55 a imagem passa intacta (fotografias); acima, comprime
      float t = 0.55 + 0.45 * (1.0 - exp(-(m - 0.55) / 0.45));
      c *= t / m;
      c = mix(c, vec3(t), smoothstep(3.0, 24.0, m) * 0.8); // o que é muitas vezes mais claro que o branco tende ao branco
    }
    vec2 q = vUv - 0.5;
    c *= 1.0 - vinheta * dot(q, q) * 1.6;
    c += (ruido(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

const NIVEIS = 6;

/**
 * Cria o pós-processamento sobre um renderizador.
 * @param {typeof import('../vendor/three/three.module.min.js')} THREE
 * @param {import('../vendor/three/three.module.min.js').WebGLRenderer} renderer
 * @returns {{ ativo: boolean, ajustes: { forca: number, exposicao: number, vinheta: number, tinta: [number, number, number] },
 *   desenhar: (cena: object, camera: object) => void, adaptar: (raiz: object) => void, descartar: () => void }}
 */
export function criarPos(THREE, renderer) {
  const ajustes = { forca: 0.2, exposicao: 1, vinheta: 0.35, tinta: [1, 1, 1] };
  const gl = renderer.getContext();
  const suporta = renderer.capabilities.isWebGL2 !== false && (renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'));
  if (!suporta || !gl) return { ativo: false, ajustes, desenhar: (cena, camera) => renderer.render(cena, camera), adaptar() {}, descartar() {} };

  const alvo = (comProfundidade) => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: comProfundidade, stencilBuffer: false, generateMipmaps: false });
  const principal = alvo(true);
  // a extensão pode existir e o alvo ainda assim não ser aceito pelo aparelho: confere antes de depender dele
  renderer.setRenderTarget(principal);
  const completo = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  renderer.setRenderTarget(null);
  if (!completo) { principal.dispose(); return { ativo: false, ajustes, desenhar: (cena, camera) => renderer.render(cena, camera), adaptar() {}, descartar() {} }; }
  const niveis = Array.from({ length: NIVEIS }, () => alvo(false));
  const tamanho = new THREE.Vector2(), ultimo = new THREE.Vector2(-1, -1);

  const quadro = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quadro.frustumCulled = false;
  const palco = new THREE.Scene(); palco.add(quadro);
  const fixa = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
  const reduzir = material(FRAG_REDUZIR, { mapa: { value: null }, texel: { value: new THREE.Vector2() } });
  const ampliar = material(FRAG_AMPLIAR, { mapa: { value: null }, texel: { value: new THREE.Vector2() }, peso: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
  const final = material(FRAG_FINAL, { cena: { value: principal.texture }, halo: { value: niveis[0].texture }, forca: { value: 0 }, exposicao: { value: 1 }, vinheta: { value: 0 }, tinta: { value: new THREE.Vector3(1, 1, 1) } });

  const passe = (mat, destino) => { quadro.material = mat; renderer.setRenderTarget(destino); renderer.render(palco, fixa); };

  function ajustarTamanho() {
    renderer.getDrawingBufferSize(tamanho);
    if (tamanho.equals(ultimo)) return;
    ultimo.copy(tamanho);
    principal.setSize(tamanho.x, tamanho.y);
    let w = tamanho.x, h = tamanho.y;
    for (const n of niveis) { w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); n.setSize(w, h); }
  }

  /** Desenha a cena com halo e curva de tom, na tela (ou no alvo que já estiver ativo como saída final). */
  function desenhar(cena, camera) {
    ajustarTamanho();
    const limpar = renderer.autoClear;
    renderer.setRenderTarget(principal);
    renderer.render(cena, camera);
    renderer.autoClear = false;
    // pirâmide para baixo; a quantidade de níveis acompanha o lado menor da imagem, para o halo ter a mesma largura
    // relativa numa tela estreita de celular e num monitor
    const usados = Math.max(3, Math.min(NIVEIS, Math.floor(Math.log2(Math.min(tamanho.x, tamanho.y) / 22))));
    let origem = principal;
    for (const n of niveis.slice(0, usados)) {
      reduzir.uniforms.mapa.value = origem.texture; reduzir.uniforms.texel.value.set(1 / origem.width, 1 / origem.height);
      renderer.setRenderTarget(n); renderer.clear(); passe(reduzir, n);
      origem = n;
    }
    // e de volta para cima, somando cada nível ao anterior: os níveis pequenos dão o halo largo
    for (let i = usados - 1; i > 0; i--) {
      ampliar.uniforms.mapa.value = niveis[i].texture; ampliar.uniforms.texel.value.set(1 / niveis[i].width, 1 / niveis[i].height);
      ampliar.uniforms.peso.value = 1;
      passe(ampliar, niveis[i - 1]);
    }
    final.uniforms.forca.value = ajustes.forca / usados; final.uniforms.exposicao.value = ajustes.exposicao; final.uniforms.vinheta.value = ajustes.vinheta;
    final.uniforms.tinta.value.fromArray(ajustes.tinta);
    renderer.setRenderTarget(null); renderer.clear();
    passe(final, null);
    renderer.autoClear = limpar;
  }

  /**
   * Faz os materiais prontos do three.js (que escrevem linear fora da tela) escreverem na convenção da tela.
   * Chamar depois de montar a cena e sempre que entrar um material novo; cada material é tratado uma vez.
   */
  function adaptar(raiz) {
    raiz.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (m.isShaderMaterial || m.userData.posAdaptado) continue;
        m.userData.posAdaptado = true;
        m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <colorspace_fragment>', 'gl_FragColor = sRGBTransferOETF( gl_FragColor );'); };
        m.customProgramCacheKey = () => 'pos-tela';
        m.needsUpdate = true;
      }
    });
  }

  function descartar() { principal.dispose(); niveis.forEach((n) => n.dispose()); reduzir.dispose(); ampliar.dispose(); final.dispose(); quadro.geometry.dispose(); }

  return { ativo: true, ajustes, desenhar, adaptar, descartar };
}
