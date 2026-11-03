// Gráficos com uPlot (vendor/uplot, versão 1.6.32 fixada).
// - Cursor sincronizado entre gráficos e com a Faixa do Céu.
// - Valores ao tocar, arraste horizontal pelo contêiner com rolagem nativa,
//   zoom por pinça (dois dedos) e linha de "agora".
// - Um dedo na vertical sempre rola a página: touch-action: pan-x pan-y.
// - Noite sombreada, lacunas não são ligadas (spanGaps: false).
import { el, bus, cor } from './ui.js';
import { valido } from './analise.js';

const graficos = new Set();

export function limparGraficos(raiz) {
  for (const g of [...graficos]) if (!raiz || raiz.contains(g.root)) { g.destroy(); graficos.delete(g); }
}

// noites: [[iniMs, fimMs]]
export function criarGrafico(container, cfg) {
  if (!window.uPlot) { container.append(el('p', { class: 'nota', text: 'Gráfico indisponível: biblioteca não carregou.' })); return null; }
  const uPlot = window.uPlot;
  const caixa = el('div', { class: 'grafico' });
  if (cfg.titulo) caixa.append(el('h3', { text: cfg.titulo }));
  const leg = el('div', { class: 'leg' });
  const valores = cfg.series.map((s) => {
    const span = el('span', { class: [s.dash ? 'tracejado' : '', s.pontos ? 'ponto' : '', s.faixa ? 'faixa' : ''].join(' '), style: { '--c': s.corCss ? cor(s.corCss) : s.cor } }, s.rotulo);
    const v = el('b', {}); span.append(' ', v);
    if (!s.semLegenda) leg.append(span);
    return v;
  });
  caixa.append(leg);
  const rolar = el('div', { class: 'rolar', 'data-hscroll': '' });
  caixa.append(rolar);
  if (cfg.fonte) caixa.append(el('p', { class: 'fonte', text: cfg.fonte }));
  container.append(caixa);

  const xs = cfg.x.map((ms) => ms / 1000);
  let horasVisiveis = cfg.horasVisiveis || null;
  const largura = () => {
    const base = Math.max(240, (rolar.clientWidth || 328) - 32);
    if (!horasVisiveis || xs.length < 2) return base;
    const total = (xs[xs.length - 1] - xs[0]) / 3600;
    return Math.round(base * Math.max(1, total / horasVisiveis));
  };
  const texto = cor('--fraco'), grade = cor('--linha');
  const eixos = [{ stroke: texto, grid: { stroke: grade, width: 1 }, ticks: { stroke: grade }, font: '600 12px Archivo, sans-serif',
    values: cfg.formatoX || ((u, vals) => vals.map((v) => {
      const d = uPlot.tzDate(new Date(v * 1000), cfg.fuso || 'America/Sao_Paulo');
      return d.getHours() === 0 ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()] + ' ' + d.getDate() : d.getHours() + 'h';
    })), space: 44 }];
  for (const e of cfg.eixos || [{}]) {
    eixos.push({ scale: e.escala || 'y', side: e.lado ?? 3, stroke: e.corCss ? cor(e.corCss) : texto, grid: { show: e.grade !== false, stroke: grade, width: 1 },
      ticks: { stroke: grade }, font: '600 12px Archivo, sans-serif', size: e.tamanho || 42, values: e.formato ? (u, v) => v.map(e.formato) : undefined,
      label: e.rotulo, labelFont: '600 12px Archivo, sans-serif', labelSize: e.rotulo ? 16 : 0 });
  }
  const escalas = { x: { time: true } };
  for (const [k, v] of Object.entries(cfg.escalas || {})) escalas[k] = v;

  const series = [{}].concat(cfg.series.map((s) => {
    const c = s.corCss ? cor(s.corCss) : s.cor;
    const o = { label: s.rotulo, scale: s.escala || 'y', stroke: s.faixa ? 'transparent' : c, width: s.largura ?? 2, spanGaps: false,
      points: { show: !!s.pontos, size: 6, fill: c, stroke: c } };
    if (s.dash) o.dash = s.dash;
    if (s.barras) { o.paths = uPlot.paths.bars({ size: [0.7, 40], align: 0 }); o.fill = c; o.width = 0; o.points = { show: false }; }
    if (s.preencher) o.fill = c + '33';
    return o;
  }));
  const dados = [xs, ...cfg.series.map((s) => s.valores.map((v) => (valido(v) ? v : null)))];
  const bandas = (cfg.bandas || []).map((b) => ({ series: [b.de + 1, b.ate + 1], fill: (b.corCss ? cor(b.corCss) : b.cor) + '40' }));

  let ultimoIdx = null, quadro = 0;
  const u = new uPlot({
    width: largura(), height: cfg.altura || 170,
    padding: [8, 8, 0, 0],
    scales: escalas, axes: eixos, series: dados.length ? series : [], bands: bandas,
    legend: { show: false },
    cursor: { sync: { key: cfg.sync || 'meteo', setSeries: false }, drag: { x: false, y: false, setScale: false }, points: { size: 7 }, y: false },
    hooks: {
      drawClear: [(u) => {
        const c = u.ctx; const { top, height } = u.bbox;
        c.save(); c.fillStyle = cor('--noite');
        for (const [a, b] of cfg.noites || []) {
          const x0 = u.valToPos(a / 1000, 'x', true), x1 = u.valToPos(b / 1000, 'x', true);
          if (x1 > u.bbox.left && x0 < u.bbox.left + u.bbox.width) c.fillRect(Math.max(x0, u.bbox.left), top, Math.min(x1, u.bbox.left + u.bbox.width) - Math.max(x0, u.bbox.left), height);
        }
        c.restore();
      }],
      draw: [(u) => {
        const c = u.ctx; const { top, height } = u.bbox; const dpr = uPlot.pxRatio;
        // agora
        const ax = u.valToPos(Date.now() / 1000, 'x', true);
        if (cfg.agora !== false && ax >= u.bbox.left && ax <= u.bbox.left + u.bbox.width) {
          c.save(); c.strokeStyle = cor('--texto'); c.lineWidth = 2 * dpr; c.setLineDash([]);
          c.beginPath(); c.moveTo(ax, top); c.lineTo(ax, top + height); c.stroke();
          c.fillStyle = cor('--texto'); c.font = `${600} ${11 * dpr}px Archivo, sans-serif`; c.fillText('agora', ax + 4 * dpr, top + 11 * dpr); c.restore();
        }
        // setas de direção do vento
        if (cfg.setas) {
          c.save(); c.fillStyle = cor('--texto'); c.strokeStyle = cor('--texto'); c.lineWidth = 1.5 * dpr;
          const passo = Math.max(1, Math.round(xs.length / ((u.bbox.width / dpr) / 30)));
          for (let i = 0; i < xs.length; i += passo) {
            const g = cfg.setas[i]; if (!valido(g)) continue;
            const x = u.valToPos(xs[i], 'x', true), y = top + 10 * dpr;
            c.save(); c.translate(x, y); c.rotate(((g + 180) * Math.PI) / 180);
            c.beginPath(); c.moveTo(0, 6 * dpr); c.lineTo(0, -4 * dpr); c.stroke();
            c.beginPath(); c.moveTo(0, -7 * dpr); c.lineTo(3.5 * dpr, -2 * dpr); c.lineTo(-3.5 * dpr, -2 * dpr); c.closePath(); c.fill();
            c.restore();
          }
          c.restore();
        }
      }],
      setCursor: [(u) => {
        const i = u.cursor.idx;
        if (i === null || i === undefined) return;
        cfg.series.forEach((s, k) => {
          const v = dados[k + 1][i];
          valores[k].textContent = valido(v) ? (s.formato ? s.formato(v) : String(Math.round(v * 10) / 10)) : 'sem dado';
        });
        if (i !== ultimoIdx && cfg.emitirHora !== false) {
          ultimoIdx = i;
          cancelAnimationFrame(quadro);
          quadro = requestAnimationFrame(() => bus.emit('hora', xs[i] * 1000, 'grafico'));
        }
      }],
    },
  }, dados, rolar);
  graficos.add(u);

  // valores iniciais: horário atual ou primeiro ponto
  const agoraI = xs.findIndex((x) => x * 1000 > Date.now() - 3600000);
  cfg.series.forEach((s, k) => {
    const v = dados[k + 1][Math.max(0, agoraI)];
    valores[k].textContent = valido(v) ? (s.formato ? s.formato(v) : String(Math.round(v * 10) / 10)) : 'sem dado';
  });
  // começa mostrando "agora" perto da borda esquerda
  if (horasVisiveis && cfg.rolarFim) requestAnimationFrame(() => { rolar.scrollLeft = rolar.scrollWidth; });
  else if (horasVisiveis && agoraI > 0) requestAnimationFrame(() => { rolar.scrollLeft = Math.max(0, u.valToPos(xs[agoraI], 'x') - 40); });

  const off = bus.on('hora', (ms, origem) => {
    if (origem === 'grafico' || !u.root.isConnected) return;
    const left = u.valToPos(ms / 1000, 'x');
    if (left >= 0 && left <= u.bbox.width / uPlot.pxRatio) u.setCursor({ left, top: 20 }, false);
  });
  const destruirOrig = u.destroy.bind(u);
  u.destroy = () => { off(); ro.disconnect(); destruirOrig(); };

  // zoom por pinça: muda quantas horas cabem na tela
  if (horasVisiveis) {
    let d0 = null, h0 = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    rolar.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); h0 = horasVisiveis; } }, { passive: true });
    rolar.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const total = (xs[xs.length - 1] - xs[0]) / 3600;
      horasVisiveis = Math.max(6, Math.min(total, h0 * d0 / dist(e.touches)));
      u.setSize({ width: largura(), height: cfg.altura || 170 });
    }, { passive: false });
    rolar.addEventListener('touchend', () => { d0 = null; }, { passive: true });
  }
  const ro = new ResizeObserver(() => { const w = largura(); if (Math.abs(w - u.width) > 4) u.setSize({ width: w, height: cfg.altura || 170 }); });
  ro.observe(rolar);
  return u;
}

// Faixas de noite a partir de nascer/pôr do sol.
export function noitesDe(diario, iniMs, fimMs) {
  const out = [];
  const n = diario.datas.length;
  for (let k = 0; k < n; k++) {
    const por = diario.por[k], nascerSeg = diario.nascer[k + 1];
    if (valido(por) && valido(nascerSeg)) out.push([por, nascerSeg]);
    if (k === 0 && valido(diario.nascer[0])) out.push([diario.nascer[0] - 12 * 3600000, diario.nascer[0]]);
  }
  return out.filter(([a, b]) => b > iniMs && a < fimMs);
}
