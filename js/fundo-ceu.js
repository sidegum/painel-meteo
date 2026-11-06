// Céu desenhado atrás do bloco principal (Hoje, Amanhã e dia): degradê do céu pela hora (dia, sol baixo, noite),
// nuvens procedurais na cobertura real, brilho do sol, estrelas, chuva e tom de temporal.
// Tudo é calculado uma vez por tamanho e condição (sem animação), num canvas atrás do texto.
// Funções puras de cor e ruído; o único efeito é desenhar no canvas recebido.

const mistura = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(v)).join(',')},${a})`;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const limitar = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const suave = (a, b, x) => { const t = limitar((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Paletas do céu: [topo, base] limpo e encoberto, por fase do dia.
const CEUS = {
  dia: { limpo: ['#2C6CBF', '#8FBDEB'], encoberto: ['#6E7C8B', '#A7B2BD'] },
  baixo: { limpo: ['#36598F', '#EBA66E'], encoberto: ['#59607A', '#B4917F'] },
  noite: { limpo: ['#060C21', '#1C2A52'], encoberto: ['#141925', '#2C3341'] },
};
const CHUVA = ['#4C5865', '#6F7A87'], TEMPORAL = ['#232733', '#454A5B'];

// Ruído de valor com semente (determinístico: o mesmo céu para a mesma condição).
function ruido(semente) {
  const h = (x, y) => {
    let n = (x * 374761393 + y * 668265263 + semente * 2147483647) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, y, oitavas = 5) => {
    let s = 0, amp = 0.5, f = 1, norma = 0;
    for (let k = 0; k < oitavas; k++) { s += amp * v(x * f, y * f); norma += amp; amp *= 0.5; f *= 2.03; }
    return s / norma;
  };
}

// Sorteio com semente (posições de estrelas e gotas).
function sorteio(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{cobertura:number|null, fase:'dia'|'baixo'|'noite', chuva:boolean, temporal:boolean, vento:boolean, semente:number}} c
 *   cobertura: % de céu coberto (0 a 100); fase: dia, sol baixo (nascer/pôr) ou noite.
 */
export function desenharCeu(canvas, c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cob = limitar((c.cobertura ?? 40) / 100);
  const pal = CEUS[c.fase] || CEUS.dia;
  let topo = mistura(hex(pal.limpo[0]), hex(pal.encoberto[0]), suave(0.3, 1, cob));
  let base = mistura(hex(pal.limpo[1]), hex(pal.encoberto[1]), suave(0.3, 1, cob));
  if (c.chuva && c.fase !== 'noite') { topo = mistura(topo, hex(CHUVA[0]), 0.75); base = mistura(base, hex(CHUVA[1]), 0.75); }
  if (c.temporal) { topo = mistura(topo, hex(TEMPORAL[0]), 0.8); base = mistura(base, hex(TEMPORAL[1]), 0.8); }

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(topo)); g.addColorStop(1, rgb(base));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // sol (de dia e com sol baixo) ou estrelas (à noite), apagados pelas nuvens
  if (c.fase !== 'noite' && !c.chuva && !c.temporal && cob < 0.9) {
    const [sx, sy, cor] = c.fase === 'baixo' ? [w * 0.82, h * 0.78, [255, 190, 120]] : [w * 0.86, h * 0.1, [255, 244, 214]];
    const brilho = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.75);
    const a = 0.65 * (1 - cob);
    brilho.addColorStop(0, rgb(cor, a)); brilho.addColorStop(0.18, rgb(cor, a * 0.45)); brilho.addColorStop(1, rgb(cor, 0));
    ctx.fillStyle = brilho; ctx.fillRect(0, 0, w, h);
  }
  if (c.fase === 'noite' && cob < 0.7) {
    const r0 = sorteio(c.semente + 7);
    const total = Math.round((w * h) / 900 * (1 - cob / 0.7));
    for (let k = 0; k < total; k++) {
      const x = r0() * w, y = r0() * h;
      const r = 0.4 + r0() * 0.9;
      ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.6 * r0()) * (1 - y / h * 0.6)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // nuvens: ruído em baixa resolução, ampliado com suavização (bordas macias), na cobertura real
  if (cob > 0.03) {
    const esc = 4, cw = Math.ceil(w / esc), ch = Math.ceil(h / esc);
    const tela = document.createElement('canvas'); tela.width = cw; tela.height = ch;
    const t = tela.getContext('2d'), img = t.createImageData(cw, ch), d = img.data;
    const n = ruido(c.semente), n2 = ruido(c.semente + 13);
    const limiar = 0.86 - cob * 0.58; // mais cobertura, mais céu passa do limiar
    const [sxE, syE] = c.vento ? [0.012, 0.05] : [0.022, 0.034];
    let claro = c.fase === 'noite' ? [120, 130, 152] : c.fase === 'baixo' ? [255, 222, 196] : [255, 255, 255];
    // céu fechado ou chovendo: nuvens mais cinzentas (e o texto branco continua legível)
    if (c.fase !== 'noite' && (c.chuva || c.temporal)) claro = [184, 192, 202];
    else if (c.fase !== 'noite') claro = mistura(claro, [214, 220, 228], suave(0.6, 1, cob));
    let sombra = c.fase === 'noite' ? [40, 46, 62] : c.fase === 'baixo' ? [128, 110, 128] : [150, 162, 176];
    if (c.chuva || cob > 0.85) sombra = mistura(sombra, [88, 96, 108], 0.6);
    if (c.temporal) sombra = [46, 50, 64];
    const opac = c.fase === 'noite' ? 0.75 : 0.95;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const v = n(x * esc * sxE, y * esc * syE);
        const dens = suave(limiar - 0.1, limiar + 0.16, v);
        if (dens <= 0) continue;
        const luz = suave(0.25, 0.85, n2(x * esc * sxE * 1.6 + 9, y * esc * syE * 1.6) * 0.6 + (1 - y / ch) * 0.5);
        const cor = mistura(sombra, claro, c.temporal ? luz * 0.4 : luz);
        const i = (y * cw + x) * 4;
        d[i] = cor[0]; d[i + 1] = cor[1]; d[i + 2] = cor[2]; d[i + 3] = 255 * dens * opac;
      }
    }
    t.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tela, 0, 0, cw, ch, 0, 0, cw * esc, ch * esc);
  }

  // chuva: traços finos inclinados
  if (c.chuva || c.temporal) {
    const r0 = sorteio(c.semente + 29);
    const total = Math.round((w * h) / (c.temporal ? 260 : 380));
    ctx.strokeStyle = 'rgba(220,232,245,.32)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < total; k++) {
      const x = r0() * (w + 40) - 20, y = r0() * h;
      const len = 7 + r0() * 9;
      ctx.moveTo(x, y); ctx.lineTo(x - len * 0.28, y + len);
    }
    ctx.stroke();
  }

  // leitura do texto branco: escurece de leve as bordas de cima e de baixo
  const v = ctx.createLinearGradient(0, 0, 0, h);
  const fundo = 0.1 + 0.1 * cob; // nuvens claras pedem um pouco mais de contraste
  v.addColorStop(0, `rgba(0,0,0,${fundo + 0.04})`); v.addColorStop(0.5, `rgba(0,0,0,${fundo * 0.6})`); v.addColorStop(1, `rgba(0,0,0,${fundo + 0.12})`);
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}
