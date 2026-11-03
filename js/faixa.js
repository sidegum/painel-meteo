// Faixa do Céu: uma linha contínua das próximas horas desenhada só com dados reais.
// Camadas de cima para baixo: nuvens altas, médias e baixas; chuva; pressão; vento e rajadas; horas.
// Dado ausente aparece hachurado. Noite tem fundo mais escuro. "Agora" tem marcador.
import { valido, mediana, partesLocais, direcaoTexto } from './analise.js';
import { el, fmt, bus, cor } from './ui.js';

const ALT = 120;

export function criarFaixa(container, { prev, modelos, iniMs, fimMs, id }) {
  const wrap = el('div', { class: 'ceu' });
  const canvas = el('canvas', { role: 'img', 'aria-label': 'Faixa do Céu: nuvens, chuva, pressão e vento hora a hora' });
  const info = el('p', { class: 'ceu-info', 'aria-live': 'polite' }, 'Toque num horário para ver os valores.');
  wrap.append(canvas, info);
  container.append(wrap);

  const idx = [];
  prev.horas.forEach((ms, i) => { if (ms >= iniMs && ms < fimMs) idx.push(i); });
  const med = (v) => idx.map((i) => mediana(modelos.map((m) => prev.modelos[m]?.vars[v]?.[i])));
  const d = {
    ms: idx.map((i) => prev.horas[i]),
    alta: med('cloud_cover_high'), media: med('cloud_cover_mid'), baixa: med('cloud_cover_low'),
    chuva: med('precipitation'), prob: med('precipitation_probability'),
    pressao: med('pressure_msl'), vento: med('wind_speed_10m'), rajada: med('wind_gusts_10m'),
    dir: idx.map((i) => {
      // direção: média vetorial entre modelos
      let x = 0, y = 0, n = 0;
      for (const m of modelos) { const g = prev.modelos[m]?.vars.wind_direction_10m?.[i]; if (valido(g)) { x += Math.sin(g * Math.PI / 180); y += Math.cos(g * Math.PI / 180); n++; } }
      return n ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null;
    }),
    dia: med('is_day'),
  };
  let selecionado = null;

  function desenhar() {
    const w = canvas.clientWidth || container.clientWidth || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(ALT * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, ALT);
    const n = d.ms.length;
    if (!n) return;
    const L = 16, R = 16, larg = (w - L - R) / n;
    const x = (k) => L + k * larg;
    const nuvem = cor('--nuvem'), chuvaCor = cor('--chuva'), rajCor = cor('--rajada'), texto = cor('--texto'), fraco = cor('--fraco'), linha = cor('--linha');

    // noite
    c.fillStyle = cor('--noite');
    for (let k = 0; k < n; k++) if (d.dia[k] !== null && d.dia[k] < 0.5) c.fillRect(x(k), 0, larg + 0.5, ALT - 16);

    // padrão de lacuna
    const hach = document.createElement('canvas'); hach.width = 6; hach.height = 6;
    const hc = hach.getContext('2d'); hc.strokeStyle = fraco; hc.globalAlpha = 0.5; hc.beginPath(); hc.moveTo(0, 6); hc.lineTo(6, 0); hc.stroke();
    const lacuna = c.createPattern(hach, 'repeat');

    // nuvens: altas (finas, no alto), médias, baixas (mais grossas, perto da chuva)
    const camadas = [[d.alta, 3, 7], [d.media, 12, 9], [d.baixa, 23, 13]];
    for (const [serie, y0, h] of camadas) {
      for (let k = 0; k < n; k++) {
        const v = serie[k];
        if (!valido(v)) { c.fillStyle = lacuna; c.fillRect(x(k), y0, larg + 0.5, h); continue; }
        c.fillStyle = `rgba(${nuvem}, ${(0.08 + 0.8 * v / 100).toFixed(3)})`;
        c.fillRect(x(k), y0, larg + 0.5, h);
      }
    }

    // chuva: barras que descem das nuvens; altura = intensidade (raiz, até 10 mm/h), opacidade = probabilidade
    const yC = 38, hC = 36;
    for (let k = 0; k < n; k++) {
      const v = d.chuva[k];
      if (!valido(v)) { c.fillStyle = lacuna; c.fillRect(x(k), yC, larg + 0.5, hC); continue; }
      if (v <= 0) continue;
      const h = Math.max(2, Math.sqrt(Math.min(v, 10) / 10) * hC);
      c.globalAlpha = valido(d.prob[k]) ? 0.35 + 0.65 * d.prob[k] / 100 : 0.8;
      c.fillStyle = chuvaCor;
      c.fillRect(x(k) + larg * 0.18, yC, larg * 0.64, h);
      c.globalAlpha = 1;
    }

    // pressão: linha integrada, escala local da janela
    const ps = d.pressao.filter(valido);
    if (ps.length > 1) {
      const pmin = Math.min(...ps) - 1, pmax = Math.max(...ps) + 1;
      const yP = (p) => yC + hC - 4 - ((p - pmin) / (pmax - pmin)) * (hC - 8);
      c.strokeStyle = texto; c.globalAlpha = 0.75; c.lineWidth = 1.5; c.beginPath();
      let aberto = false;
      for (let k = 0; k < n; k++) {
        const p = d.pressao[k];
        if (!valido(p)) { aberto = false; continue; }
        const px = x(k) + larg / 2;
        if (!aberto) { c.moveTo(px, yP(p)); aberto = true; } else c.lineTo(px, yP(p));
      }
      c.stroke(); c.globalAlpha = 1;
      c.fillStyle = fraco; c.font = '600 11px Archivo, sans-serif';
      const p0 = d.pressao.find(valido), p1 = [...d.pressao].reverse().find(valido);
      c.textAlign = 'left'; c.fillText(`${Math.round(p0)} hPa`, L + 2, yC + 10);
      c.textAlign = 'right'; c.fillText(`${Math.round(p1)}`, w - R - 2, yC + 10);
    }

    // vento: setas a cada 2 h e bandeira de rajada cuja altura e cor seguem a rajada
    const yV = 86;
    const passo = n > 30 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const g = d.rajada[k];
      if (!valido(g)) { c.fillStyle = lacuna; c.fillRect(x(k), yV - 10, larg + 0.5, 20); continue; }
      const h = Math.min(14, (g / 80) * 14);
      c.fillStyle = rajCor; c.globalAlpha = g >= 60 ? 1 : g >= 40 ? 0.75 : 0.4;
      c.fillRect(x(k) + larg * 0.2, yV + 8 - h, larg * 0.6, h);
      c.globalAlpha = 1;
    }
    c.strokeStyle = texto; c.fillStyle = texto; c.lineWidth = 1.6;
    for (let k = 0; k < n; k += passo) {
      if (!valido(d.dir[k])) continue;
      const cx = x(k) + larg / 2, cy = yV - 4;
      c.save(); c.translate(cx, cy); c.rotate(((d.dir[k] + 180) * Math.PI) / 180);
      c.beginPath(); c.moveTo(0, 6); c.lineTo(0, -5); c.stroke();
      c.beginPath(); c.moveTo(0, -7); c.lineTo(3.5, -2); c.lineTo(-3.5, -2); c.closePath(); c.fill();
      c.restore();
    }

    // eixo de horas
    c.fillStyle = fraco; c.font = '600 12px Archivo, sans-serif'; c.textAlign = 'center';
    c.strokeStyle = linha; c.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const p = partesLocais(d.ms[k], prev.offset);
      if (p.hora % 3 === 0) {
        c.fillText(p.hora === 0 ? fmt.diaSemana(d.ms[k], prev.offset) : `${p.hora}h`, x(k), ALT - 3);
        c.beginPath(); c.moveTo(x(k), ALT - 16); c.lineTo(x(k), ALT - 12); c.stroke();
      }
    }

    // agora
    const agora = Date.now();
    if (agora >= d.ms[0] && agora <= d.ms[n - 1] + 3600000) {
      const ax = L + ((agora - d.ms[0]) / 3600000) * larg;
      c.strokeStyle = texto; c.lineWidth = 2; c.beginPath(); c.moveTo(ax, 0); c.lineTo(ax, ALT - 16); c.stroke();
      c.fillStyle = texto; c.beginPath(); c.moveTo(ax - 5, 0); c.lineTo(ax + 5, 0); c.lineTo(ax, 6); c.fill();
    }
    // seleção
    if (selecionado !== null) {
      c.strokeStyle = cor('--foco'); c.lineWidth = 2;
      c.strokeRect(x(selecionado) + 1, 1, larg - 2, ALT - 18);
    }
  }

  function selecionar(k, emitir = true) {
    if (k < 0 || k >= d.ms.length) return;
    selecionado = k;
    const partes = [
      ['', fmt.hora(d.ms[k], prev.offset)],
      ['chuva', valido(d.chuva[k]) ? `${fmt.n(d.chuva[k], 1)} mm` : 'sem dado'],
      ['prob.', valido(d.prob[k]) ? `${Math.round(d.prob[k])}%` : 'sem dado'],
      ['rajada', valido(d.rajada[k]) ? `${Math.round(d.rajada[k])} km/h` : 'sem dado'],
      ['de', direcaoTexto(d.dir[k]) || 'sem dado'],
      ['nuvens baixas', valido(d.baixa[k]) ? `${Math.round(d.baixa[k])}%` : 'sem dado'],
      ['pressão', valido(d.pressao[k]) ? `${Math.round(d.pressao[k])} hPa` : 'sem dado'],
    ];
    info.replaceChildren(...partes.flatMap(([r, v], i) => [i ? ` ${r} ` : '', el('b', { text: v })]), ' (previsão, mediana dos modelos)');
    desenhar();
    if (emitir) bus.emit('hora', d.ms[k], id);
  }

  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    const larg = (r.width - 32) / d.ms.length;
    selecionar(Math.floor((ev.clientX - r.left - 16) / larg));
  });
  const off = bus.on('hora', (ms, origem) => {
    if (origem === id) return;
    const k = d.ms.findIndex((t) => t === ms);
    if (k >= 0) selecionar(k, false);
  });
  const ro = new ResizeObserver(() => desenhar());
  ro.observe(canvas);
  desenhar();
  return { desenhar, destruir() { off(); ro.disconnect(); } };
}
