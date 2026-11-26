// Modelos 3D de sondas, telescópios espaciais e satélites, desenhados peça por peça a partir das dimensões públicas de
// cada nave (em metros). Cada modelo vira uma única malha (uma chamada de desenho), com a cor e o acabamento de cada
// peça gravados por vértice; o material é um só para todas as naves.
//
// São maquetes feitas à mão, fiéis à forma geral e às proporções, e não os arquivos de engenharia das agências.
// Na cena as naves aparecem ampliadas (ninguém veria 20 m ao lado de um planeta): o tamanho real fica no cartão.
//
// Eixos das sondas e telescópios: +Z aponta para o Sol (escudo, painéis solares ou antena, que nas sondas distantes
// mira a Terra, quase na mesma direção); X é a envergadura. Eixos dos satélites da Terra: +Z aponta para a Terra,
// +Y segue a velocidade e X cruza a órbita.

/** Acabamentos de superfície tratados pelo shader. */
const ACAB = { liso: 0, painel: 1, folha: 2, espelho: 3 };

const COR = {
  branco: [0.86, 0.86, 0.84], cinza: [0.46, 0.47, 0.5], grafite: [0.16, 0.16, 0.18], preto: [0.045, 0.045, 0.05],
  ouro: [0.84, 0.6, 0.2], ouroEscuro: [0.42, 0.3, 0.12], prata: [0.76, 0.77, 0.8], rosado: [0.8, 0.66, 0.7],
  celula: [0.035, 0.07, 0.2], celulaIss: [0.4, 0.27, 0.1], espelho: [0.95, 0.72, 0.24], russo: [0.74, 0.7, 0.62],
  radiador: [0.93, 0.93, 0.95], cobre: [0.6, 0.36, 0.2],
};

const VERTEX = /* glsl */`
  attribute vec3 cor;
  attribute float acab;
  #ifdef USE_INSTANCING
    attribute float px;
  #endif
  uniform float porPixel, pxMin, achatar;
  varying vec3 vNormal, vCor, vMundo, vLocal, vCentro;
  varying vec2 vUv;
  varying float vAcab;
  void main() {
    #ifdef USE_INSTANCING
      mat4 mm = modelMatrix * instanceMatrix; float alvo = px;
    #else
      mat4 mm = modelMatrix; float alvo = pxMin;
    #endif
    vec3 centro = mm[3].xyz;
    float prof = max(-(viewMatrix * vec4(centro, 1.0)).z, 0.0);
    float e0 = max(length(mm[0].xyz), 1e-12);
    float s = max(e0, alvo * prof * porPixel);       // nunca menor que 'alvo' pixels de raio na tela
    vec3 rel = mat3(mm) * position * (s / e0);
    vec4 clip = projectionMatrix * viewMatrix * vec4(centro + rel, 1.0);
    if (achatar > 0.0) {                             // ampliado junto de um planeta: a profundidade fica rente ao centro
      vec4 cc = projectionMatrix * viewMatrix * vec4(centro, 1.0);
      float k = min(1.0, achatar / s);
      clip.z = (cc.z / cc.w + (clip.z / clip.w - cc.z / cc.w) * k) * clip.w;
    }
    #ifdef USE_INSTANCING
      if (px <= 0.0) clip = vec4(2.0, 2.0, 2.0, 1.0); // fora da tela: grupo desligado ou sem posição
    #endif
    vNormal = mat3(mm) * normal; vCor = cor; vAcab = acab; vUv = uv; vLocal = position; vCentro = centro; vMundo = centro + rel;
    gl_Position = clip;
  }`;

const FRAGMENT = /* glsl */`
  uniform vec4 luz;            // xyz: direção do Sol (w = 0) ou posição do Sol (w = 1)
  uniform float sombraTerra;   // 1: a Terra (raio 1, na origem) faz sombra
  uniform float luzAmbiente;
  varying vec3 vNormal, vCor, vMundo, vLocal, vCentro;
  varying vec2 vUv;
  varying float vAcab;
  void main() {
    vec3 L = luz.w > 0.5 ? normalize(luz.xyz - vCentro) : normalize(luz.xyz);
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vMundo);
    float sol = 1.0;
    if (sombraTerra > 0.5) { float d = dot(vCentro, L); if (d < 0.0 && length(vCentro - d * L) < 1.0) sol = 0.0; }
    vec3 base = vCor;
    float brilho = 0.22, dureza = 28.0, ambiente = mix(0.42, luzAmbiente, sol); // na sombra da Terra sobra o clarão do planeta
    if (vAcab > 2.5) {                               // espelho: reflete o céu escuro, acende na direção do Sol
      vec3 R = reflect(-V, N);
      float r = max(dot(R, L), 0.0);
      vec3 c = base * (0.2 + 0.5 * smoothstep(-0.4, 1.0, R.y)) + base * pow(r, 6.0) * 1.6 * sol + vec3(1.0, 0.95, 0.85) * pow(r, 90.0) * sol;
      gl_FragColor = vec4(c, 1.0); return;
    } else if (vAcab > 1.5) {                        // manta térmica: amassada, com reflexos soltos
      vec3 p = vLocal * 34.0;                         // dobras suaves, em duas escalas
      N = normalize(N + 0.12 * vec3(sin(p.y * 1.3 + sin(p.z * 0.7) * 2.0), sin(p.z * 1.1 + sin(p.x * 0.9) * 2.0), sin(p.x * 1.2 + sin(p.y * 0.8) * 2.0))
        + 0.06 * sin(p.zxy * 3.7 + p.yzx * 2.3 + sin(p * 1.9) * 1.5));
      brilho = 0.75; dureza = 18.0;
    } else if (vAcab > 0.5) {                        // painel solar: células e trilhas
      vec2 g = abs(fract(vUv) - 0.5);
      float trilha = smoothstep(0.44, 0.49, max(g.x, g.y));
      base = mix(base, base * 2.2 + 0.1, trilha);
      brilho = 0.55; dureza = 70.0;
    }
    float difusa = max(dot(N, L), 0.0) * sol;
    vec3 H = normalize(L + V);
    float espec = pow(max(dot(N, H), 0.0), dureza) * brilho * sol * step(0.0, dot(N, L));
    vec3 c = base * (ambiente + 0.95 * difusa) + mix(vec3(1.0), base * 1.4, step(1.5, vAcab)) * espec;
    gl_FragColor = vec4(c, 1.0);
  }`;

/**
 * Montador de peças: cada função acrescenta uma peça em metros. Opções comuns: p (posição), r (giro de Euler XYZ, em
 * radianos), cor e acab (acabamento).
 */
function montador(THREE) {
  const partes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), pos = new THREE.Vector3(), um = new THREE.Vector3(1, 1, 1);
  const por = (geo, o = {}) => {
    m4.compose(pos.fromArray(o.p || [0, 0, 0]), q.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), um);
    partes.push({ geo, m: m4.clone(), cor: o.cor || COR.branco, acab: o.acab ?? ACAB.liso });
  };
  const b = {
    partes,
    caixa: (w, h, d, o) => por(new THREE.BoxGeometry(w, h, d), o),
    /** Cilindro ou tronco de cone ao longo de Y; 'lados' baixo dá um prisma (6 = hexagonal). */
    cilindro: (rTopo, rBase, h, o = {}) => { const g = new THREE.CylinderGeometry(rTopo, rBase, h, o.lados || 20, 1, !!o.aberto); if (o.giro) g.rotateY(o.giro); por(g, o); },
    esfera: (r, o) => por(new THREE.SphereGeometry(r, 16, 12), o),
    /** Antena parabólica aberta para +Y (use r para virar). */
    prato: (raio, fundo, o = {}) => {
      const perfil = Array.from({ length: 9 }, (_, i) => new THREE.Vector2(raio * i / 8 + 1e-4, fundo * (i / 8) ** 2));
      por(new THREE.LatheGeometry(perfil, 28), { cor: COR.branco, ...o });
    },
    /** Painel solar no plano XY (face para ±Z), com 'celulas' [colunas, linhas] desenhadas pelo shader. */
    painel: (w, h, o = {}) => {
      const g = new THREE.BoxGeometry(w, h, o.esp || 0.05), uv = g.attributes.uv, [nx, ny] = o.celulas || [Math.max(1, Math.round(w / 0.6)), Math.max(1, Math.round(h / 0.6))];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * ny);
      por(g, { cor: COR.celula, acab: ACAB.painel, ...o });
    },
    /** Haste fina entre dois pontos. */
    haste: (a, c, raio = 0.04, o = {}) => {
      const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c), g = new THREE.CylinderGeometry(raio, raio, A.distanceTo(C), 6, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), C.clone().sub(A).normalize()));
      g.translate((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);
      por(g, { cor: COR.cinza, ...o });
    },
    /** Placa com contorno livre (pontos [x, y]) e espessura ao longo de Z. */
    placa: (pontos, esp, o) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pontos.map(([x, y]) => new THREE.Vector2(x, y))), { depth: esp, bevelEnabled: false });
      g.translate(0, 0, -esp / 2);
      por(g, o);
    },
  };
  /** Asa de painéis solares ao longo de X: n painéis de w × h a partir de x0 (sinal dá o lado), com a haste de ligação. */
  b.asa = (lado, x0, n, w, h, o = {}) => {
    const { p = [0, 0, 0], ...resto } = o;
    b.haste([p[0], p[1], p[2]], [p[0] + lado * x0, p[1], p[2]], 0.05);
    for (let i = 0; i < n; i++) b.painel(w - 0.06, h, { ...resto, p: [p[0] + lado * (x0 + w * (i + 0.5)), p[1], p[2]] });
  };
  return b;
}

const GIRO_Z = [Math.PI / 2, 0, 0];   // leva o eixo Y da peça para +Z
const GIRO_X = [0, 0, -Math.PI / 2];  // leva o eixo Y da peça para +X
const folha = (cor) => ({ cor, acab: ACAB.folha });

/**
 * Modelos. raio: raio de enquadramento em metros (o corpo principal; hastes longas podem passar dele).
 * tipo e medidas vão para o cartão.
 */
const MODELOS = {
  jwst: { raio: 11.5, tipo: 'Telescópio espacial', medidas: 'Escudo solar de 21,2 × 14,2 m em 5 camadas; espelho principal de 6,5 m, com 18 segmentos de berílio banhados a ouro',
    montar(b) {
      const losango = (k) => [[10.6 * k, 0], [4.6 * k, 7.1 * k], [-4.6 * k, 7.1 * k], [-10.6 * k, 0], [-4.6 * k, -7.1 * k], [4.6 * k, -7.1 * k]];
      for (let i = 0; i < 5; i++) b.placa(losango(1 - i * 0.035), 0.03, { p: [0, 0, -i * 0.3], ...folha(i ? COR.prata : COR.rosado) });
      for (const [x, y] of [[10.6, 0], [-10.6, 0], [4.6, 7.1], [-4.6, 7.1], [4.6, -7.1], [-4.6, -7.1]]) b.haste([0, 0, 0.3], [x, y, -0.6], 0.06);
      b.caixa(3.2, 3.2, 2.2, { p: [0, 0, 1.3], ...folha(COR.ouro) });                       // plataforma, do lado do Sol
      b.painel(5.9, 2.0, { p: [-4.6, 0, 2.2], r: [0, 0.35, 0] });
      b.prato(0.55, 0.14, { p: [1.0, 1.0, 2.5], r: GIRO_Z });
      b.placa([[0, -0.9], [2.2, -0.6], [2.2, 0.6], [0, 0.9]], 0.03, { p: [-12.6, 0, -0.5], r: [0, -0.5, 0], ...folha(COR.prata) }); // aba de momento
      b.caixa(1.3, 1.3, 1.6, { p: [-0.6, 0, -2.0], cor: COR.grafite });                     // torre que afasta o telescópio do calor
      const zc = -6.3, R = 0.762;                                                        // espelho de pé, olhando para +X
      for (let qh = -2; qh <= 2; qh++) for (let rh = -2; rh <= 2; rh++) {
        const anel = Math.max(Math.abs(qh), Math.abs(rh), Math.abs(qh + rh));
        if (anel < 1 || anel > 2) continue;
        const u = 1.5 * R * qh * 1.02, w = Math.sqrt(3) * R * (rh + qh / 2) * 1.02;
        b.cilindro(R, R, 0.1, { lados: 6, giro: Math.PI / 6, p: [0.35 + (u * u + w * w) * 0.012, u, zc + w], r: GIRO_X, cor: COR.espelho, acab: ACAB.espelho });
      }
      b.cilindro(3.5, 3.5, 0.5, { lados: 6, giro: Math.PI / 6, p: [-0.1, 0, zc], r: GIRO_X, cor: COR.preto });   // estrutura atrás do espelho
      b.caixa(2.0, 2.6, 2.4, { p: [-1.5, 0, zc], cor: COR.grafite });                       // módulo dos instrumentos
      b.cilindro(0.22, 0.36, 1.9, { p: [1.3, 0, zc], r: GIRO_X, cor: COR.preto });          // torre óptica central
      b.cilindro(0.37, 0.37, 0.08, { p: [7.5, 0, zc], r: GIRO_X, cor: COR.espelho, acab: ACAB.espelho }); // espelho secundário
      for (const [y, z] of [[0, 3.3], [2.9, -2.6], [-2.9, -2.6]]) b.haste([0.4, y, zc + z], [7.5, 0, zc], 0.05, { cor: COR.preto });
    } },

  voyager: { raio: 4.6, tipo: 'Sonda interestelar', medidas: 'Antena de 3,7 m; haste do magnetômetro de 13 m; três geradores de radioisótopos',
    montar(b) {
      b.prato(1.83, 0.5, { p: [0, 0, 0.25], r: GIRO_Z });
      b.cilindro(0.2, 0.2, 0.08, { p: [0, 0, 1.75], r: GIRO_Z, cor: COR.cinza });
      for (let k = 0; k < 3; k++) { const a = k * 2.094; b.haste([1.7 * Math.cos(a), 1.7 * Math.sin(a), 0.7], [0.15 * Math.cos(a), 0.15 * Math.sin(a), 1.75], 0.025); }
      b.cilindro(0.9, 0.9, 0.47, { lados: 10, p: [0, 0, -0.2], r: GIRO_Z, ...folha(COR.ouroEscuro) });
      b.esfera(0.36, { p: [0, 0, -0.2], cor: COR.prata });                                  // tanque de hidrazina
      b.haste([-0.8, 0, -0.3], [-2.3, 0, -0.6], 0.07);
      for (let k = 0; k < 3; k++) b.cilindro(0.2, 0.2, 0.5, { p: [-2.6 - k * 0.55, 0, -0.66 - k * 0.11], r: [0, 0.2, -Math.PI / 2], cor: COR.grafite }); // geradores
      b.haste([0.8, 0, -0.3], [3.1, 0, -0.5], 0.07);
      b.caixa(0.5, 0.6, 0.5, { p: [3.3, 0, -0.5], cor: COR.cinza });                        // plataforma das câmeras
      b.cilindro(0.11, 0.11, 0.7, { p: [3.3, 0.5, -0.5], r: GIRO_Z, cor: COR.grafite });
      b.caixa(0.3, 0.3, 0.4, { p: [2.2, 0.3, -0.4], ...folha(COR.ouro) });
      b.haste([-0.4, 0.7, -0.4], [-3.4, 10.6, -6.0], 0.035, { cor: COR.prata });            // magnetômetro
      b.haste([0.3, -0.7, -0.4], [5.2, -7.6, -3.4], 0.012); b.haste([-0.3, -0.7, -0.4], [-5.2, -7.6, -3.4], 0.012); // antenas de ondas de plasma
    } },

  pioneer: { raio: 3.6, tipo: 'Sonda interestelar', medidas: 'Antena de 2,74 m; dois pares de geradores de radioisótopos; haste do magnetômetro de 6,6 m',
    montar(b) {
      b.prato(1.37, 0.46, { p: [0, 0, 0.1], r: GIRO_Z });
      for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; b.haste([1.25 * Math.cos(a), 1.25 * Math.sin(a), 0.5], [0, 0, 1.35], 0.02); }
      b.cilindro(0.12, 0.2, 0.3, { p: [0, 0, 1.4], r: GIRO_Z, cor: COR.cinza });
      b.cilindro(0.72, 0.72, 0.36, { lados: 6, p: [0, 0, -0.2], r: GIRO_Z, ...folha(COR.ouro) });
      for (const s of [1, -1]) {
        const a = Math.PI + s * 0.6, dx = Math.cos(a), dy = Math.sin(a);
        b.haste([0.6 * dx, 0.6 * dy, -0.2], [3.0 * dx, 3.0 * dy, -0.2], 0.035); b.haste([0.6 * dx, 0.6 * dy, -0.35], [3.0 * dx, 3.0 * dy, -0.2], 0.02);
        for (let k = 0; k < 2; k++) b.cilindro(0.15, 0.15, 0.3, { p: [(3.05 + k * 0.34) * dx, (3.05 + k * 0.34) * dy, -0.2], r: [0, 0, a - Math.PI / 2], cor: COR.grafite });
      }
      b.haste([0.6, 0, -0.2], [6.2, 0, -0.2], 0.03, { cor: COR.prata });
      b.caixa(0.2, 0.2, 0.2, { p: [6.3, 0, -0.2], cor: COR.cinza });
    } },

  newhorizons: { raio: 2.0, tipo: 'Sonda', medidas: 'Corpo triangular de 2,7 m; antena de 2,1 m; um gerador de radioisótopos',
    montar(b) {
      b.placa([[-0.9, -1.05], [-0.9, 1.05], [0.3, 0.55], [1.0, 0.2], [1.0, -0.2], [0.3, -0.55]], 0.7, { ...folha(COR.ouro) });
      b.prato(1.05, 0.3, { p: [-0.15, 0, 0.55], r: GIRO_Z });
      b.cilindro(0.09, 0.09, 0.25, { p: [-0.15, 0, 1.25], r: GIRO_Z, cor: COR.cinza });
      for (let k = 0; k < 3; k++) { const a = k * 2.094; b.haste([-0.15 + 0.95 * Math.cos(a), 0.95 * Math.sin(a), 0.8], [-0.15, 0, 1.25], 0.015); }
      b.cilindro(0.2, 0.2, 1.1, { p: [1.75, 0, 0], r: GIRO_X, cor: COR.preto });            // gerador de radioisótopos
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.caixa(1.0, 0.02, 0.16, { p: [1.75, 0.27 * Math.cos(a), 0.27 * Math.sin(a)], r: [a + Math.PI / 2, 0, 0], cor: COR.grafite }); }
      b.cilindro(0.11, 0.11, 0.7, { p: [-0.2, -1.0, -0.15], r: GIRO_X, ...folha(COR.ouro) }); // câmera LORRI
      b.caixa(0.35, 0.3, 0.3, { p: [-0.7, 0.8, -0.5], cor: COR.cinza });
    } },

  parker: { raio: 2.6, tipo: 'Sonda solar', medidas: 'Escudo térmico de 2,3 m de diâmetro e 11 cm de espessura, de carbono',
    montar(b) {
      b.cilindro(1.15, 1.15, 0.11, { lados: 32, p: [0, 0, 1.55], r: GIRO_Z, cor: COR.grafite });
      b.cilindro(1.13, 1.13, 0.02, { lados: 32, p: [0, 0, 1.62], r: GIRO_Z, cor: COR.radiador }); // face branca voltada para o Sol
      b.cilindro(0.95, 0.5, 1.2, { lados: 6, p: [0, 0, 0.85], r: GIRO_Z, cor: COR.preto, aberto: true });
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; b.caixa(0.9, 0.03, 0.95, { p: [0.62 * Math.cos(a), 0.62 * Math.sin(a), 0.85], r: [0, 0, a + Math.PI / 2], cor: COR.preto }); } // radiadores
      b.cilindro(0.5, 0.5, 1.0, { lados: 6, p: [0, 0, -0.3], r: GIRO_Z, ...folha(COR.ouro) });
      for (const s of [1, -1]) b.painel(1.12, 0.69, { p: [s * 1.0, 0, -0.35], r: [0, s * 1.05, 0] });
      for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.haste([0.75 * x, 0.75 * y, 1.4], [2.1 * x, 2.1 * y, 1.75], 0.012, { cor: COR.prata }); // antenas de campo elétrico
      b.haste([0, 0, -0.8], [0, 0.3, -4.3], 0.03, { cor: COR.prata });                      // magnetômetro
      b.prato(0.3, 0.08, { p: [0, -0.75, -0.3], r: [Math.PI, 0, 0] });
    } },

  juno: { raio: 10.5, tipo: 'Sonda em órbita de Júpiter', medidas: 'Três asas solares de 9 m (envergadura de 20 m); antena de 2,5 m',
    montar(b) {
      b.cilindro(1.75, 1.75, 1.6, { lados: 6, p: [0, 0, 0], r: GIRO_Z, ...folha(COR.ouro) });
      b.caixa(0.9, 0.9, 0.7, { p: [0, 0, 1.0], cor: COR.cinza });                           // cofre de titânio da eletrônica
      b.prato(1.25, 0.35, { p: [0, 0, 1.4], r: GIRO_Z });
      for (let k = 0; k < 3; k++) {
        const a = k * 2.094, n = k === 0 ? 3 : 4, c = Math.cos(a), s = Math.sin(a);
        for (let i = 0; i < n; i++) { const d = 1.8 + 2.2 * (i + 0.5); b.painel(2.14, 2.65, { p: [d * c, d * s, 0.5], r: [0, 0, a], celulas: [4, 5] }); }
        if (k === 0) { b.placa([[0, -0.5], [2.4, -0.3], [2.4, 0.3], [0, 0.5]], 0.06, { p: [8.4, 0, 0.5], cor: COR.prata }); b.caixa(0.25, 0.25, 0.25, { p: [10.6, 0, 0.6], cor: COR.cinza }); }
      }
    } },

  europaclipper: { raio: 15.5, tipo: 'Sonda', medidas: 'Envergadura de 30,5 m com os painéis abertos; antena de 3 m; 6 m de altura',
    montar(b) {
      b.cilindro(0.8, 0.8, 4.6, { p: [0, -0.6, 0], cor: COR.prata, acab: ACAB.folha });
      b.caixa(1.5, 1.4, 1.3, { p: [0, 2.2, 0], ...folha(COR.ouro) });                       // cofre da eletrônica
      b.prato(1.5, 0.4, { p: [0, 0.9, 0.85], r: GIRO_Z });
      b.haste([0, 0.9, 1.0], [0, 0.9, 1.9], 0.05);
      b.caixa(1.3, 2.2, 0.05, { p: [0, -1.2, -0.85], cor: COR.radiador });                  // radiador
      for (const s of [1, -1]) {
        b.asa(s, 1.3, 5, 2.84, 4.1, { celulas: [5, 7] });
        for (const x of [5, 12]) { b.haste([s * x, -2.05, 0.05], [s * x, -4.8, 0.05], 0.015, { cor: COR.prata }); b.haste([s * x, 2.05, 0.05], [s * x, 4.8, 0.05], 0.015, { cor: COR.prata }); } // antenas do radar
      }
      b.haste([0.5, -2.6, -0.6], [3.0, -7.5, -6.0], 0.035, { cor: COR.prata });             // magnetômetro de 8,5 m
      b.cilindro(0.35, 0.5, 0.5, { p: [0, -3.1, 0], cor: COR.grafite });
    } },

  juice: { raio: 13.5, tipo: 'Sonda', medidas: 'Painéis solares de 85 m² em duas asas em cruz; antena de 2,5 m; haste do magnetômetro de 10,6 m',
    montar(b) {
      b.caixa(2.5, 3.4, 3.0, { ...folha(COR.ouroEscuro) });
      b.prato(1.27, 0.35, { p: [0, 0.2, 1.55], r: GIRO_Z });
      for (const s of [1, -1]) {
        b.asa(s, 2.8, 3, 2.55, 3.5, { celulas: [4, 6] });
        for (const y of [3.56, -3.56]) b.painel(2.49, 3.5, { p: [s * (2.8 + 2.55 * 1.5), y, 0], celulas: [4, 6] });
      }
      b.haste([0, -1.7, -1.5], [2.5, -8.0, -8.4], 0.04, { cor: COR.prata });
      b.haste([0, -8, -1.6], [0, 8, -1.6], 0.02, { cor: COR.prata });                       // antena do radar, 16 m
      b.cilindro(0.3, 0.45, 0.6, { p: [0, -2.0, 0], cor: COR.grafite });
    } },

  psyche: { raio: 12.6, tipo: 'Sonda', medidas: 'Envergadura de 24,8 m, com duas asas solares em cruz; propulsão elétrica',
    montar(b) {
      b.caixa(2.2, 3.1, 2.4, { ...folha(COR.ouro) });
      b.prato(1.0, 0.28, { p: [0, 0.3, 1.25], r: GIRO_Z });
      for (const s of [1, -1]) {
        b.asa(s, 2.4, 3, 3.3, 2.3, { celulas: [6, 4] });
        for (const y of [2.36, -2.36]) b.painel(3.24, 2.3, { p: [s * (2.4 + 3.3 * 1.5), y, 0], celulas: [6, 4] });
      }
      b.haste([0.6, 1.5, -0.6], [1.2, 3.6, -0.9], 0.04); b.haste([-0.6, 1.5, -0.6], [-1.2, 3.6, -0.9], 0.04); // magnetômetro e espectrômetro
      for (const x of [0.5, -0.5]) b.cilindro(0.2, 0.26, 0.3, { p: [x, -1.7, 0], cor: COR.grafite });           // propulsores Hall
    } },

  lucy: { raio: 8.2, tipo: 'Sonda', medidas: 'Dois painéis solares circulares de 7,3 m de diâmetro; antena de 2 m',
    montar(b) {
      b.caixa(1.6, 2.0, 1.6, { ...folha(COR.ouro) });
      b.prato(1.0, 0.28, { p: [0, 0, 0.85], r: GIRO_Z });
      for (const s of [1, -1]) {
        b.haste([s * 0.8, 0, 0], [s * 1.6, 0, 0], 0.06);
        b.cilindro(3.65, 3.65, 0.04, { lados: 10, p: [s * 5.2, 0, 0], r: GIRO_Z, cor: COR.celula, acab: ACAB.painel });
        for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; b.haste([s * 5.2, 0, -0.04], [s * 5.2 + 3.6 * Math.cos(a), 3.6 * Math.sin(a), -0.04], 0.02); }
      }
      b.caixa(0.6, 0.5, 0.5, { p: [0, 1.25, -0.3], cor: COR.cinza });                       // plataforma dos instrumentos
      b.cilindro(0.1, 0.1, 0.5, { p: [0.15, 1.4, -0.75], r: GIRO_Z, cor: COR.grafite });
    } },

  bepicolombo: { raio: 15.5, tipo: 'Duas sondas viajando juntas', medidas: 'Conjunto de cruzeiro com 6,4 m de altura; asas solares do módulo de transferência com 30 m de envergadura',
    montar(b) {
      b.caixa(3.5, 2.3, 3.7, { p: [0, -2.0, 0], ...folha(COR.ouro) });                      // módulo de transferência
      for (const s of [1, -1]) b.asa(s, 2.4, 5, 2.5, 1.9, { p: [0, -2.0, 0], celulas: [5, 3] });
      for (const x of [0.9, -0.9]) for (const z of [0.9, -0.9]) b.cilindro(0.2, 0.26, 0.3, { p: [x, -3.3, z], cor: COR.grafite });
      b.caixa(2.4, 1.7, 2.2, { p: [0, 0.1, 0], cor: COR.branco, acab: ACAB.folha });        // orbitador planetário (MPO)
      b.caixa(2.0, 1.5, 0.06, { p: [0, 0.1, -1.15], cor: COR.radiador });
      b.asa(-1, 1.6, 3, 1.9, 1.3, { p: [0, 0.3, 0.6], celulas: [4, 2] });
      b.haste([1.2, 0.5, 0.3], [2.4, 1.6, 0.8], 0.04); b.prato(0.5, 0.14, { p: [2.4, 1.6, 0.8], r: GIRO_Z });
      b.cilindro(0.95, 1.4, 1.9, { p: [0, 1.95, 0], cor: COR.radiador, aberto: true });     // escudo solar em volta do Mio
      b.cilindro(0.9, 0.9, 1.1, { lados: 8, p: [0, 1.9, 0], cor: COR.celula, acab: ACAB.painel });
    } },

  solarorbiter: { raio: 9.6, tipo: 'Sonda solar', medidas: 'Escudo térmico de 3,1 × 2,4 m; envergadura de 18 m; três antenas de 6,5 m',
    montar(b) {
      b.caixa(3.1, 2.4, 0.3, { p: [0, 0, 1.55], cor: COR.preto });
      for (const [x, y] of [[-0.9, 0.5], [0, 0.6], [0.9, 0.5], [-0.6, -0.5], [0.6, -0.5]]) b.cilindro(0.13, 0.13, 0.04, { p: [x, y, 1.71], r: GIRO_Z, cor: COR.grafite }); // janelas dos telescópios
      b.caixa(2.3, 2.0, 2.5, { p: [0, 0, 0.1], ...folha(COR.ouroEscuro) });
      for (const s of [1, -1]) b.asa(s, 2.2, 3, 2.1, 1.2, { celulas: [4, 2] });
      b.haste([0, 0, -1.1], [0, 0.4, -5.5], 0.04, { cor: COR.prata });                      // haste dos instrumentos
      b.haste([0, 1.0, 0.9], [0, 7.5, 1.1], 0.015, { cor: COR.prata });
      for (const s of [1, -1]) b.haste([s * 0.9, -0.9, 0.9], [s * 5.5, -4.6, 1.1], 0.015, { cor: COR.prata });
      b.haste([0, -1.0, -0.5], [0, -2.4, -0.6], 0.04); b.prato(0.55, 0.15, { p: [0, -2.5, -0.6], r: GIRO_Z });
    } },

  osirisapex: { raio: 3.6, tipo: 'Sonda', medidas: 'Envergadura de 6,2 m; antena de 2,1 m; braço coletor de 3,35 m',
    montar(b) {
      b.cilindro(1.35, 1.35, 2.0, { lados: 6, p: [0, 0, 0], r: GIRO_Z, ...folha(COR.ouro) });
      b.prato(1.05, 0.3, { p: [0, 0, 1.05], r: GIRO_Z });
      b.cilindro(0.07, 0.07, 0.5, { p: [0, 0, 1.5], r: GIRO_Z, cor: COR.cinza });
      for (const s of [1, -1]) { b.haste([s * 1.2, 0, 0], [s * 1.5, 0, 0], 0.05); b.painel(1.7, 2.5, { p: [s * 2.35, 0, 0.1], r: [0, -s * 0.25, 0], celulas: [3, 5] }); }
      b.haste([0.3, 0, -1.0], [0.3, 0, -2.6], 0.05); b.haste([0.3, 0, -2.6], [0.3, 0.3, -4.2], 0.05); // braço de coleta
      b.cilindro(0.16, 0.16, 0.1, { p: [0.3, 0.3, -4.25], r: GIRO_Z, cor: COR.prata });
      b.cilindro(0.42, 0.42, 0.08, { p: [-0.5, 0, -1.03], r: GIRO_Z, cor: COR.grafite });   // suporte da cápsula, já entregue à Terra
      for (const [x, y] of [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]]) b.cilindro(0.1, 0.14, 0.2, { p: [x, y, -1.1], r: GIRO_Z, cor: COR.grafite });
    } },

  hera: { raio: 5.9, tipo: 'Sonda', medidas: 'Corpo de 1,6 m; envergadura de 11,5 m; antena de 1,13 m',
    montar(b) {
      b.caixa(1.6, 1.6, 1.7, { ...folha(COR.ouroEscuro) });
      b.prato(0.57, 0.16, { p: [0, 0, 0.9], r: GIRO_Z });
      for (const s of [1, -1]) b.asa(s, 1.1, 3, 1.55, 1.6, { celulas: [3, 3] });
      for (const [x, y] of [[0.3, 0.3], [-0.3, 0.3], [0, -0.35]]) b.cilindro(0.09, 0.09, 0.3, { p: [x, y, -0.95], r: GIRO_Z, cor: COR.grafite }); // câmeras
      b.caixa(0.25, 0.35, 0.2, { p: [0.6, -0.5, -0.95], cor: COR.prata }); b.caixa(0.25, 0.35, 0.2, { p: [-0.6, -0.5, -0.95], cor: COR.prata }); // CubeSats Milani e Juventas
    } },

  // ---------------------------------------------------------------- em volta da Terra

  iss: { raio: 56, tipo: 'Estação espacial', medidas: '109 m de envergadura por 73 m de comprimento; cerca de 420 toneladas',
    montar(b) {
      const us = { cor: COR.prata }, ru = { cor: COR.russo, acab: ACAB.folha }, zt = -3.4, yt = 6;
      b.caixa(96, 2.0, 2.0, { p: [0, yt, zt], cor: COR.cinza });                             // treliça
      for (let x = -46; x <= 46; x += 4) b.caixa(0.15, 2.3, 2.3, { p: [x, yt, zt], cor: COR.grafite });
      for (const x of [-48.5, -34.5, 34.5, 48.5]) for (const s of [1, -1]) {                // 8 asas solares
        b.haste([x, yt, zt], [x, yt + s * 36, zt], 0.25);
        for (const dx of [-3.1, 3.1]) b.painel(5.0, 31, { p: [x + dx, yt + s * 20, zt], cor: COR.celulaIss, celulas: [4, 26], esp: 0.08 });
      }
      for (const x of [-15, 15]) for (const dx of [-3.5, 0, 3.5]) b.caixa(3.2, 22, 0.12, { p: [x + dx, yt - 13, zt - 1.2], r: [0, 0.6, 0], cor: COR.radiador }); // radiadores
      for (const x of [-41.5, 41.5]) b.caixa(3.2, 0.12, 12, { p: [x, yt, zt + 7.5], cor: COR.radiador });
      const modY = (y, comp, raio, o) => b.cilindro(raio, raio, comp, { p: [0, y, 0], ...o });
      const modX = (x, y, comp, raio, o, z = 0) => b.cilindro(raio, raio, comp, { p: [x, y, z], r: GIRO_X, ...o });
      modY(-24.5, 13, 2.05, ru); modY(-11.5, 12.5, 2.05, ru);                               // Zvezda e Zarya
      modY(-1.8, 5.5, 2.3, us); modY(6, 8.5, 2.15, us); modY(14.2, 7.2, 2.2, us);           // Unity, Destiny e Harmony
      b.cilindro(0.8, 1.3, 2.0, { p: [0, 18.8, 0], cor: COR.grafite });
      modX(6.2, 14.2, 6.9, 2.25, us); modX(-8, 14.2, 11.2, 2.2, us);                        // Columbus e Kibo
      b.cilindro(2.2, 2.2, 4.2, { p: [-8, 14.2, -4.2], r: GIRO_Z, ...us });
      b.caixa(5.6, 5.0, 3.0, { p: [-16.5, 14.2, 0.2], cor: COR.cinza });                    // plataforma externa do Kibo
      modX(-5.8, -1.8, 6.7, 2.2, us); b.cilindro(0.9, 1.5, 1.5, { lados: 6, p: [-7.2, -1.8, 2.9], r: GIRO_Z, cor: COR.grafite }); // Tranquility e Cupola
      modX(5.2, -1.8, 5.5, 1.9, us);                                                        // câmara de descompressão Quest
      b.cilindro(2.1, 2.1, 13, { p: [0, -19.5, 8.6], r: GIRO_Z, ...ru });                   // Nauka
      b.cilindro(1.3, 1.3, 4, { p: [0, -19.5, -4.0], r: GIRO_Z, ...ru });                   // Poisk
      b.cilindro(1.25, 1.25, 6, { p: [0, -8, 5.0], r: GIRO_Z, ...ru });                     // Rassvet
      for (const s of [1, -1]) { b.asa(s, 2.4, 2, 6.0, 3.0, { p: [0, -25.5, 0], celulas: [8, 4] }); b.asa(s, 2.4, 2, 5.0, 2.4, { p: [0, -19.5, 11], celulas: [7, 3] }); }
      b.cilindro(1.1, 1.1, 5.2, { p: [0, -33.8, 0], cor: COR.cinza }); b.esfera(1.15, { p: [0, -36.6, 0], cor: COR.cinza });   // nave russa na popa
      for (const s of [1, -1]) b.painel(4.0, 1.4, { p: [s * 3.2, -33.5, 0] });
      b.cilindro(1.2, 1.85, 3.0, { p: [0, 21.3, 0], cor: COR.branco }); b.cilindro(1.85, 1.85, 3.6, { p: [0, 24.6, 0], cor: COR.branco }); // cápsula na proa
    } },

  tiangong: { raio: 30, tipo: 'Estação espacial', medidas: 'Três módulos em T, cada um com cerca de 17 m; asas solares dos laboratórios com 55 m de ponta a ponta',
    montar(b) {
      const m = { cor: COR.branco, acab: ACAB.folha };
      b.cilindro(2.1, 2.1, 9.0, { p: [0, -4.2, 0], ...m }); b.cilindro(1.4, 2.1, 1.0, { p: [0, 0.8, 0], ...m }); b.cilindro(1.4, 1.4, 4.2, { p: [0, 3.4, 0], ...m });
      b.esfera(1.5, { p: [0, 6.6, 0], cor: COR.prata });                                    // nó de acoplagem
      for (const s of [1, -1]) {
        b.asa(s, 1.4, 2, 5.2, 2.6, { p: [0, 3.2, 0], celulas: [8, 4] });
        b.cilindro(2.1, 2.1, 12.5, { p: [s * 8.2, 6.6, 0], r: GIRO_X, ...m }); b.cilindro(1.5, 1.5, 4.5, { p: [s * 16.6, 6.6, 0], r: GIRO_X, cor: COR.cinza });
        for (const t of [1, -1]) { b.haste([s * 18.4, 6.6, 0], [s * 18.4, 6.6 + t * 2.4, 0], 0.15); b.painel(4.6, 24, { p: [s * 18.4, 6.6 + t * 14.4, 0], celulas: [4, 22], esp: 0.06 }); }
      }
      b.cilindro(1.65, 1.65, 9.0, { p: [0, -13.4, 0], cor: COR.prata }); for (const s of [1, -1]) b.painel(5.0, 1.8, { p: [s * 4.3, -13.4, 0] }); // cargueiro Tianzhou
      b.cilindro(1.25, 1.25, 7.0, { p: [0, 11.6, 0], cor: COR.cinza }); for (const s of [1, -1]) b.painel(4.2, 1.6, { p: [s * 3.4, 12.8, 0] });   // nave Shenzhou
    } },

  hubble: { raio: 7.6, tipo: 'Telescópio espacial', medidas: '13,2 m de comprimento por 4,2 m de diâmetro; espelho de 2,4 m',
    montar(b) {
      b.cilindro(2.1, 2.1, 5.4, { p: [0, -3.9, 0], cor: COR.prata, acab: ACAB.folha });
      b.cilindro(1.55, 2.1, 0.5, { p: [0, -0.95, 0], cor: COR.prata, acab: ACAB.folha });
      b.cilindro(1.55, 1.55, 7.4, { p: [0, 3.0, 0], cor: COR.prata, acab: ACAB.folha });
      b.cilindro(1.47, 1.47, 0.05, { p: [0, 6.68, 0], cor: COR.preto });                    // boca do tubo
      b.cilindro(1.5, 1.5, 0.08, { p: [0, 7.4, -1.9], r: [1.9, 0, 0], cor: COR.prata, acab: ACAB.folha }); // tampa aberta
      b.cilindro(2.14, 2.14, 0.25, { p: [0, -2.0, 0], cor: COR.cinza });
      for (const s of [1, -1]) { b.haste([s * 1.5, 1.0, 0], [s * 2.7, 1.0, 0], 0.07); b.painel(2.6, 7.1, { p: [s * 4.0, 1.0, 0], celulas: [4, 10] }); }
      for (const s of [1, -1]) { b.haste([0, 0.5, s * 1.5], [0, 2.6, s * 3.6], 0.04); b.prato(0.6, 0.16, { p: [0, 2.6, s * 3.6], r: [s * Math.PI / 2, 0, 0] }); }
    } },

  gps: { raio: 6.2, tipo: 'Satélite de navegação', medidas: 'Modelo do tipo: corpo de cerca de 2,5 m, com as antenas voltadas para a Terra e duas asas solares',
    montar(b) {
      b.caixa(2.0, 2.4, 1.8, { ...folha(COR.ouro) });
      b.caixa(2.1, 2.5, 0.08, { p: [0, 0, 0.95], cor: COR.prata });
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.cilindro(0.06, 0.1, 0.6, { p: [0.75 * Math.cos(a), 0.75 * Math.sin(a), 1.3], r: GIRO_Z, cor: COR.cinza }); }
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; b.cilindro(0.06, 0.1, 0.6, { p: [0.3 * Math.cos(a), 0.3 * Math.sin(a), 1.3], r: GIRO_Z, cor: COR.cinza }); }
      for (const s of [1, -1]) b.asa(s, 1.5, 2, 2.2, 2.3, { celulas: [4, 4] });
      b.haste([0.8, 1.0, -0.9], [1.6, 1.8, -2.2], 0.03); b.haste([-0.8, 1.0, -0.9], [-1.6, 1.8, -2.2], 0.03);
    } },

  geoMeteo: { raio: 6.5, tipo: 'Satélite meteorológico geoestacionário', medidas: 'Modelo do tipo: corpo de cerca de 4 m, uma asa solar e os sensores voltados para a Terra',
    montar(b) {
      b.caixa(2.8, 2.8, 4.0, { ...folha(COR.ouro) });
      b.caixa(1.2, 1.5, 1.1, { p: [0.5, 0.4, 2.5], cor: COR.branco }); b.cilindro(0.45, 0.45, 0.9, { p: [-0.7, -0.5, 2.4], r: GIRO_Z, cor: COR.grafite }); // imageador e mapeador de raios
      b.prato(0.6, 0.16, { p: [-0.8, 0.9, 2.2], r: GIRO_Z }); b.prato(0.45, 0.12, { p: [0.9, -1.0, 2.2], r: GIRO_Z });
      b.asa(1, 1.8, 4, 2.0, 2.6, { celulas: [3, 4] });
      b.haste([-1.4, 0, -1.5], [-7.5, 0.5, -2.5], 0.04, { cor: COR.prata });                // magnetômetro
      b.caixa(2.4, 0.06, 3.2, { p: [0, -1.45, 0], cor: COR.radiador });
    } },

  poloMeteo: { raio: 6.0, tipo: 'Satélite meteorológico de órbita polar', medidas: 'Modelo do tipo: corpo alongado de cerca de 5 m, uma asa solar e os sensores voltados para a Terra',
    montar(b) {
      b.caixa(2.0, 4.8, 1.9, { ...folha(COR.ouro) });
      b.caixa(1.0, 1.1, 0.8, { p: [0.3, 1.5, 1.2], cor: COR.branco }); b.caixa(0.8, 0.9, 0.7, { p: [-0.3, 0.1, 1.2], cor: COR.cinza });
      b.cilindro(0.3, 0.3, 0.7, { p: [0.4, -1.4, 1.2], r: GIRO_Z, cor: COR.grafite }); b.prato(0.4, 0.1, { p: [-0.5, -1.7, 1.15], r: GIRO_Z });
      b.haste([-1.0, -1.0, 0], [-1.8, -1.0, 0], 0.06);
      for (let i = 0; i < 4; i++) b.painel(1.7, 2.6, { p: [-1.8 - 1.75 * (i + 0.5), -1.0, 0], r: [0.6, 0, 0], celulas: [3, 4] });
      b.caixa(0.06, 3.6, 1.5, { p: [1.03, 0, 0], cor: COR.radiador });
    } },

  foguete: { raio: 4.6, tipo: 'Estágio de foguete', medidas: 'Modelo do tipo: estágio superior vazio, de alguns metros, que ficou em órbita depois do lançamento',
    montar(b) {
      b.cilindro(1.2, 1.2, 6.0, { p: [0, 0.4, 0], cor: COR.branco });
      b.cilindro(0.9, 1.2, 0.8, { p: [0, 3.8, 0], cor: COR.cinza }); b.cilindro(1.22, 1.22, 0.3, { p: [0, 1.5, 0], cor: COR.grafite });
      b.cilindro(0.35, 0.95, 1.5, { p: [0, -3.3, 0], cor: COR.grafite, aberto: true });
      b.esfera(0.5, { p: [0, -2.6, 0], cor: COR.cobre });
    } },

  generico: { raio: 4.4, tipo: 'Satélite', medidas: 'Modelo do tipo: corpo de cerca de 1,5 m e duas asas solares',
    montar(b) {
      b.caixa(1.3, 1.6, 1.3, { ...folha(COR.ouro) });
      for (const s of [1, -1]) b.asa(s, 0.9, 2, 1.6, 1.3, { celulas: [3, 2] });
      b.prato(0.4, 0.1, { p: [0, 0.2, 0.7], r: GIRO_Z });
      b.haste([0.3, -0.5, 0.65], [0.3, -0.5, 1.8], 0.015);
    } },
};

/** Missão (chave de MISSOES) -> modelo. */
const MODELO_DA_SONDA = { voyager1: 'voyager', voyager2: 'voyager', pioneer10: 'pioneer', pioneer11: 'pioneer' };
export const modeloDaSonda = (chave) => MODELO_DA_SONDA[chave] || (MODELOS[chave] ? chave : 'generico');

/**
 * Modelo de um satélite da Terra pelo nome do catálogo e pela órbita.
 * @param {string} nome OBJECT_NAME do CelesTrak
 * @param {string} grupo grupo do Globo (estacoes, brilhantes, meteorologicos, gps)
 * @param {number} voltasPorDia movimento médio
 */
export function modeloDoSatelite(nome, grupo, voltasPorDia) {
  if (/^ISS \(ZARYA\)/.test(nome)) return 'iss';
  if (/^CSS \(TIANHE\)/.test(nome)) return 'tiangong';
  if (/^HST$|HUBBLE/.test(nome)) return 'hubble';
  if (/R\/B|CENTAUR|AGENA/.test(nome)) return 'foguete';
  if (grupo === 'gps') return 'gps';
  if (grupo === 'meteorologicos' && !/CYGFM|TIANMU/.test(nome)) return voltasPorDia < 1.5 ? 'geoMeteo' : 'poloMeteo';
  return 'generico';
}

/** Tipo e medidas de um modelo, para o cartão. */
export const fichaModelo = (id) => { const m = MODELOS[id] || MODELOS.generico; return { tipo: m.tipo, medidas: m.medidas, doTipo: /^Modelo do tipo/.test(m.medidas) }; };

const cacheGeo = new Map();

/**
 * Geometria de um modelo, numa malha só: raio de enquadramento 1, com cor e acabamento por vértice.
 * @param {typeof import('../vendor/three/three.module.min.js')} THREE
 * @param {string} id chave de MODELOS
 */
export function geometriaNave(THREE, id) {
  if (cacheGeo.has(id)) return cacheGeo.get(id);
  const def = MODELOS[id] || MODELOS.generico, b = montador(THREE);
  def.montar(b);
  const pos = [], nor = [], uv = [], cor = [], acab = [];
  for (const parte of b.partes) {
    const g = parte.geo.index ? parte.geo.toNonIndexed() : parte.geo;
    g.applyMatrix4(parte.m);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i) / def.raio, P.getY(i) / def.raio, P.getZ(i) / def.raio);
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      cor.push(...parte.cor); acab.push(parte.acab);
    }
    g.dispose(); parte.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('cor', new THREE.Float32BufferAttribute(cor, 3));
  geo.setAttribute('acab', new THREE.Float32BufferAttribute(acab, 1));
  geo.computeBoundingSphere();
  cacheGeo.set(id, geo);
  return geo;
}

/**
 * Material das naves. Uniforms: luz (direção ou posição do Sol), sombraTerra, porPixel (2·tan(campo/2) ÷ altura da
 * tela em px), pxMin (raio mínimo na tela, em px, para malhas avulsas; as instanciadas usam o atributo px) e achatar
 * (profundidade máxima do modelo ampliado, na unidade da cena; 0 desliga). ambiente: luz no lado sem Sol.
 */
export function materialNaves(THREE, { sombraTerra = false, pxMin = 0, achatar = 0, ambiente = 0.17 } = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    uniforms: { luz: { value: new THREE.Vector4(0, 0, 0, 1) }, sombraTerra: { value: sombraTerra ? 1 : 0 }, porPixel: { value: 0.002 }, pxMin: { value: pxMin }, achatar: { value: achatar }, luzAmbiente: { value: ambiente } } });
}

/** Mesma geometria com um atributo próprio de tamanho por instância (px), para um InstancedMesh. */
export function geometriaInstanciada(THREE, id, quantos) {
  const base = geometriaNave(THREE, id), geo = new THREE.BufferGeometry();
  for (const nome of ['position', 'normal', 'uv', 'cor', 'acab']) geo.setAttribute(nome, base.attributes[nome]);
  geo.setAttribute('px', new THREE.InstancedBufferAttribute(new Float32Array(quantos), 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = base.boundingSphere.clone();
  return geo;
}

export const IDS_MODELOS = Object.keys(MODELOS);
