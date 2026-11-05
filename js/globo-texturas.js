// Texturas procedurais do Globo (planetas, Lua, Sol, anéis, brilhos e pontos), geradas em canvas: nada de imagem
// externa para os astros. Cada textura é criada uma vez e reaproveitada.

const cache = new Map();

/** Ruído de valor com 3 oitavas, em [0, 1], determinístico pela semente. */
function ruido2d(semente, largura, altura) {
  let s = semente; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const oitavas = [];
  for (let o = 0; o < 3; o++) { const w = 8 << o, h = 4 << o, g = new Float32Array((w + 1) * (h + 1)); for (let i = 0; i < g.length; i++) g[i] = rnd(); oitavas.push({ w, h, g }); }
  const out = new Float32Array(largura * altura);
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) {
    let v = 0, amp = 0.55, soma = 0;
    for (const { w, h, g } of oitavas) {
      const fx = x / largura * w, fy = y / altura * h, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), x1 = (x0 + 1) % w;
      const a = g[y0 * (w + 1) + x0], b = g[y0 * (w + 1) + x1], c = g[(y0 + 1) * (w + 1) + x0], d = g[(y0 + 1) * (w + 1) + x1];
      v += ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy) * amp; soma += amp; amp *= 0.5;
    }
    out[y * largura + x] = v / soma;
  }
  return out;
}

const PALETAS = {
  'Mercúrio': { base: [120, 116, 110], var: [60, 58, 55], faixas: 0, semente: 3, crateras: 40 },
  'Vênus': { base: [222, 196, 140], var: [40, 30, 20], faixas: 3, semente: 5 },
  'Terra': { base: [60, 110, 180], var: [40, 60, 40], faixas: 0, semente: 7 },
  'Marte': { base: [180, 95, 55], var: [70, 45, 35], faixas: 0, semente: 9, polos: true },
  'Júpiter': { base: [205, 170, 130], var: [60, 50, 45], faixas: 11, semente: 13, mancha: true },
  'Saturno': { base: [218, 196, 150], var: [35, 30, 25], faixas: 8, semente: 17 },
  'Urano': { base: [150, 212, 222], var: [15, 15, 15], faixas: 2, semente: 19 },
  'Netuno': { base: [70, 110, 220], var: [40, 40, 30], faixas: 4, semente: 23 },
  'Lua': { base: [150, 148, 142], var: [70, 70, 68], faixas: 0, semente: 29, mares: true, crateras: 60 },
};

function canvas(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
function textura(THREE, cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

/** Superfície de um planeta ou da Lua (512 x 256, equiretangular). */
export function texturaPlaneta(THREE, nome) {
  const k = 'p:' + nome;
  if (cache.has(k)) return cache.get(k);
  const P = PALETAS[nome], W = 512, H = 256;
  const cv = canvas(W, H), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  const ruido = ruido2d(P.semente, W, H), ruido2 = ruido2d(P.semente + 100, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let t = ruido[i];
    if (P.faixas) { const f = Math.sin((y / H + (ruido2[i] - 0.5) * 0.08) * Math.PI * P.faixas); t = 0.5 + 0.3 * f + (ruido[i] - 0.5) * 0.5; }
    if (P.mares) t = ruido2[i] < 0.42 ? t * 0.55 : t; // mares lunares: manchas escuras de basalto
    if (P.mancha) { const dx = (x - 340) / 36, dy = (y - 150) / 16; if (dx * dx + dy * dy < 1) t = 0.2 - (dx * dx + dy * dy) * 0.1; }
    const lat = Math.abs(y / H - 0.5) * 2;
    let r = P.base[0] + (t - 0.5) * 2 * P.var[0], g = P.base[1] + (t - 0.5) * 2 * P.var[1], b = P.base[2] + (t - 0.5) * 2 * P.var[2];
    if (P.polos && lat > 0.86) { const q = (lat - 0.86) / 0.14; r += (235 - r) * q; g += (235 - g) * q; b += (240 - b) * q; }
    if (P.mancha && t < 0.25) { r += 40; g -= 10; b -= 20; }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (P.crateras) { // crateras: anéis claros com centro escuro, posições fixas pela semente
    let s = P.semente * 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let c = 0; c < P.crateras; c++) {
      const x = rnd() * W, y = H * (0.12 + rnd() * 0.76), r = 2 + rnd() * rnd() * 14;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(40,38,36,0.22)'; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.25); ctx.strokeStyle = 'rgba(235,232,225,0.18)'; ctx.stroke();
    }
  }
  const t = textura(THREE, cv);
  cache.set(k, t);
  return t;
}

/** Fotosfera do Sol (granulação). */
export function texturaSol(THREE) {
  if (cache.has('sol')) return cache.get('sol');
  const W = 512, H = 256, cv = canvas(W, H);
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data, ruido = ruido2d(31, W, H);
  for (let i = 0; i < W * H; i++) { const t = ruido[i]; d[i * 4] = 255; d[i * 4 + 1] = 190 + t * 60; d[i * 4 + 2] = 90 + t * 90; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = textura(THREE, cv); cache.set('sol', t); return t;
}

/** Faixa radial dos anéis de Saturno, com a divisão de Cassini. */
export function texturaAnel(THREE) {
  if (cache.has('anel')) return cache.get('anel');
  const W = 256, cv = canvas(W, 1);
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, 1), d = img.data;
  let s = 41; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let x = 0; x < W; x++) {
    const u = x / W; const divisao = u > 0.62 && u < 0.68 ? 0.1 : 1;
    const a = (u < 0.08 ? u / 0.08 : u > 0.95 ? (1 - u) / 0.05 : 1) * divisao * (0.55 + 0.45 * rnd());
    d[x * 4] = 225; d[x * 4 + 1] = 205; d[x * 4 + 2] = 165; d[x * 4 + 3] = Math.round(a * 230);
  }
  ctx.putImageData(img, 0, 0);
  const t = textura(THREE, cv); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set('anel', t); return t;
}

/** Ponto redondo com borda suave (satélites e planetas no céu). */
export function texturaPonto(THREE) {
  if (cache.has('ponto')) return cache.get('ponto');
  const cv = canvas(32, 32), c = cv.getContext('2d'), g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  const t = textura(THREE, cv, false); cache.set('ponto', t); return t;
}

/** Brilho radial (halo do Sol). */
export function texturaBrilho(THREE) {
  if (cache.has('brilho')) return cache.get('brilho');
  const cv = canvas(128, 128), c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,245,220,0.95)'); g.addColorStop(0.3, 'rgba(255,220,150,0.45)'); g.addColorStop(1, 'rgba(255,200,100,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = textura(THREE, cv, false); cache.set('brilho', t); return t;
}

/** Anel de seleção (destaca o objeto tocado). */
export function texturaAnelSelecao(THREE) {
  if (cache.has('selecao')) return cache.get('selecao');
  const cv = canvas(64, 64), c = cv.getContext('2d');
  c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 4; c.beginPath(); c.arc(32, 32, 24, 0, Math.PI * 2); c.stroke();
  const t = textura(THREE, cv, false); cache.set('selecao', t); return t;
}
