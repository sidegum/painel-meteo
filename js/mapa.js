// Mapa carregado só quando a seção aparece na tela.
// Leaflet 1.9.4. Camadas, uma de cada vez:
//   radar RainViewer (chuva agora, passado, zoom nativo máximo 7);
//   grade Open-Meteo de 11 x 11 pontos (chuva prevista, nuvens, temperatura, calor, frio, vento);
//   polígonos dos avisos do INMET (todos, ou só os de calor ou de frio nas camadas correspondentes).
import { el, fmt, linkExterno, prefs } from './ui.js';
import { buscarRadar, buscarGradeMapa } from './dados.js';
import { CONFIG } from './config.js';

let carregando = null;
function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (carregando) return carregando;
  carregando = new Promise((ok, falha) => {
    const css = el('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' });
    const js = el('script', { src: 'vendor/leaflet/leaflet.js' });
    js.onload = () => ok(window.L); js.onerror = () => falha(new Error('Leaflet não carregou'));
    document.head.append(css, js);
  });
  return carregando;
}

// Escalas de cor: [valor, r, g, b, opacidade 0-1]. Interpolação linear entre as paradas.
const ESCALA_TEMP = [[-5, 92, 60, 170, 0.75], [5, 60, 110, 190, 0.7], [12, 60, 160, 170, 0.6], [18, 120, 190, 110, 0.55], [24, 230, 200, 70, 0.6], [30, 235, 130, 50, 0.7], [35, 215, 60, 50, 0.75], [40, 160, 30, 90, 0.8]];
const ESCALA_CHUVA = [[0.2, 90, 160, 220, 0], [1, 90, 160, 220, 0.45], [5, 50, 120, 210, 0.6], [15, 40, 70, 190, 0.7], [30, 120, 50, 180, 0.75], [60, 200, 40, 150, 0.8]];
const ESCALA_NUVEM = [[10, 230, 234, 240, 0], [40, 230, 234, 240, 0.25], [70, 220, 225, 232, 0.5], [100, 205, 210, 220, 0.75]];
const ESCALA_NUVEM_CLARO = [[10, 90, 100, 115, 0], [40, 90, 100, 115, 0.2], [70, 80, 90, 105, 0.4], [100, 70, 78, 92, 0.6]];
const ESCALA_RAJADA = [[20, 230, 200, 70, 0], [35, 230, 200, 70, 0.45], [50, 235, 140, 50, 0.6], [70, 215, 60, 50, 0.7], [90, 160, 30, 120, 0.8]];

function corNa(escala, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return [0, 0, 0, 0];
  if (v <= escala[0][0]) return escala[0].slice(1);
  for (let k = 1; k < escala.length; k++) {
    const a = escala[k - 1], b = escala[k];
    if (v <= b[0]) { const t = (v - a[0]) / (b[0] - a[0]); return [1, 2, 3, 4].map((i) => a[i] + t * (b[i] - a[i])); }
  }
  return escala[escala.length - 1].slice(1);
}

// Avisos do INMET por tipo. Os títulos usados pelo INMET: "Onda de Calor", "Declínio de Temperatura",
// "Onda de Frio" e "Geada" (conferidos nos avisos ativos em 2026-11-03).
const EH_CALOR = /calor/i;
const EH_FRIO = /frio|decl[ií]nio de temperatura|geada|baixa temperatura/i;

const CAMADAS = [
  { id: 'radar', nome: 'Chuva agora' },
  { id: 'chuva', nome: 'Chuva 24 h', campo: 'chuva24', escala: ESCALA_CHUVA, un: 'mm', casas: 1,
    titulo: 'Chuva prevista para as próximas 24 horas' },
  { id: 'nuvens', nome: 'Nuvens', campo: 'nuvens', escala: ESCALA_NUVEM, un: '%', casas: 0,
    titulo: 'Cobertura de nuvens agora' },
  { id: 'temp', nome: 'Temperatura', campo: 'temp', escala: ESCALA_TEMP, un: '°C', casas: 0,
    titulo: 'Temperatura agora' },
  { id: 'calor', nome: 'Calor', campo: 'tmax5', escala: ESCALA_TEMP, un: '°C', casas: 0, avisos: EH_CALOR,
    titulo: 'Maior máxima prevista nos próximos 5 dias' },
  { id: 'frio', nome: 'Frio', campo: 'tmin5', escala: ESCALA_TEMP, un: '°C', casas: 0, avisos: EH_FRIO,
    titulo: 'Menor mínima prevista nos próximos 5 dias' },
  { id: 'vento', nome: 'Vento', campo: 'rajada', escala: ESCALA_RAJADA, un: 'km/h', casas: 0,
    titulo: 'Rajadas agora' },
  { id: 'avisos', nome: 'Avisos', avisos: /./, titulo: 'Avisos ativos do INMET' },
];

// Grade guardada por 10 minutos, para trocar de camada sem pedir de novo. O botão atualizar recria o mapa
// e só reaproveita a grade se ela for do mesmo ponto e tiver menos de 10 minutos.
let gradeCache = null;
async function grade(lat, lon) {
  const chave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (gradeCache && gradeCache.chave === chave && Date.now() - gradeCache.em < 600000) return gradeCache.p;
  const p = buscarGradeMapa(lat, lon);
  gradeCache = { chave, em: Date.now(), p };
  p.catch(() => { if (gradeCache?.p === p) gradeCache = null; });
  return p;
}

// Desenha a grade como imagem suave: interpolação bilinear entre os pontos.
function imagemGrade(g, valores, escala) {
  const n = g.n, lado = 192, cv = document.createElement('canvas');
  cv.width = lado; cv.height = lado;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(lado, lado);
  const v = (i, j) => valores[i * n + j];
  for (let y = 0; y < lado; y++) {
    const fi = (y / (lado - 1)) * (n - 1), i0 = Math.min(n - 2, Math.floor(fi)), ti = fi - i0;
    for (let x = 0; x < lado; x++) {
      const fj = (x / (lado - 1)) * (n - 1), j0 = Math.min(n - 2, Math.floor(fj)), tj = fj - j0;
      const q = [[v(i0, j0), (1 - ti) * (1 - tj)], [v(i0, j0 + 1), (1 - ti) * tj], [v(i0 + 1, j0), ti * (1 - tj)], [v(i0 + 1, j0 + 1), ti * tj]]
        .filter(([a]) => a !== null && a !== undefined);
      const peso = q.reduce((s, [, w]) => s + w, 0);
      const val = peso > 0.05 ? q.reduce((s, [a, w]) => s + a * w, 0) / peso : null;
      const [r, gg, b, a] = corNa(escala, val);
      const k = (y * lado + x) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

// Paradas igualmente espaçadas na barra, cada uma com seu rótulo embaixo.
function gradiente(escala) {
  const paradas = escala.map(([, r, g, b, a], k) => `rgba(${r},${g},${b},${Math.max(a, 0.15)}) ${((k / (escala.length - 1)) * 100).toFixed(0)}%`);
  return `linear-gradient(to right, ${paradas.join(', ')})`;
}
const rotulosEscala = (c) => c.escala.map(([v], k) => (c.id === 'nuvens' ? ['céu limpo', '', '', 'encoberto'][k] : `${fmt.n(v, Math.abs(v) < 1 ? 1 : 0)}${k === c.escala.length - 1 ? ' ' + c.un : ''}`));

// Aviso perto do local: algum vértice a menos de 4° (cerca de 400 km).
const perto = (a, lat, lon) => a.poligonos.some((anel) => anel.some(([la, lo]) => Math.abs(la - lat) < 4 && Math.abs(lo - lon) < 4));

export function secaoMapa(container, estado) {
  const caixa = el('div', { class: 'mapa', role: 'region', 'aria-label': 'Mapa do tempo' }, el('p', { class: 'nota', style: { padding: '16px' }, text: 'O mapa carrega quando esta parte aparece na tela.' }));
  const escolha = el('div', { class: 'camadas', role: 'radiogroup', 'aria-label': 'Camada do mapa', 'data-hscroll': '' });
  const titulo = el('p', { class: 'mapa-titulo', 'aria-live': 'polite' });
  const barra = el('div', { class: 'mapa-barra', hidden: true });
  const rotulos = el('div', { class: 'mapa-rotulos', hidden: true });
  const legenda = el('p', { class: 'fonte', 'aria-live': 'polite' });
  const btnPausa = el('button', { type: 'button', 'aria-pressed': 'false', class: 'botao-link' }, 'Pausar radar');
  const nota = el('p', { class: 'nota' });
  const rodape = el('div', { class: 'mapa-controles' }, btnPausa, linkExterno(CONFIG.radarOficial, 'Radar oficial da Defesa Civil RS'));
  rodape.lastChild.classList.add('botao-link');
  container.append(escolha, titulo, barra, rotulos, caixa, legenda, rodape, nota);

  let atual = CAMADAS.some((c) => c.id === prefs.ler('mapaCamada', 'radar')) ? prefs.ler('mapaCamada', 'radar') : 'radar';
  const botoes = CAMADAS.map((c) => el('button', { type: 'button', role: 'radio', 'data-camada': c.id }, c.nome));
  escolha.append(...botoes);
  const marcar = () => botoes.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.camada === atual)));
  marcar();

  const io = new IntersectionObserver(async (ents) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    try { await montar(); } catch (e) { caixa.replaceChildren(el('p', { class: 'nota', style: { padding: '16px' }, text: 'Mapa indisponível: ' + e.message })); }
  }, { rootMargin: '200px' });
  io.observe(caixa);

  async function montar() {
    const L = await carregarLeaflet();
    caixa.replaceChildren();
    // Mapa como nos aplicativos de mapa: um dedo arrasta, dois dedos aproximam ou afastam,
    // e no computador a rodinha do mouse dá zoom. Para rolar a página, toque fora do mapa.
    const mapa = L.map(caixa, { zoomControl: true, attributionControl: true, maxZoom: 12, minZoom: 4, tap: false,
      dragging: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true, wheelPxPerZoomLevel: 90, bounceAtZoomLimits: false });
    const lat = estado.local.lat, lon = estado.local.lon;
    mapa.setView([lat, lon], 8);
    // Mapa base do OpenStreetMap. A política dos servidores dele exige saber de qual site vem o pedido,
    // então só os quadros do mapa enviam a origem (https://sidegum.github.io), nunca o caminho da página.
    const tema = document.documentElement.getAttribute('data-tema');
    const escuro = tema ? tema === 'escuro' : !matchMedia('(prefers-color-scheme: light)').matches;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12, referrerPolicy: 'origin', className: escuro ? 'mapa-escuro' : '',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">colaboradores do OpenStreetMap</a>',
    }).addTo(mapa);
    const fixos = L.layerGroup().addTo(mapa);
    L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2457A6', fillOpacity: 1 }).addTo(fixos).bindTooltip('Você');
    for (const f of estado.obs?.fontes || []) {
      L.circleMarker([f.lat, f.lon], { radius: 5, color: '#17303B', weight: 2, fillColor: f.tipo === 'inmet' ? '#1E8F8A' : '#D9A21B', fillOpacity: 1 })
        .addTo(fixos).bindTooltip(`${f.tipo === 'inmet' ? 'INMET' : 'METAR'} ${f.nome}`.slice(0, 90));
    }

    let camadaAtiva = null, avisosAtivos = null, g = null;
    const offset = estado.prev?.offset ?? -10800;

    // ---------- radar ----------
    let radar = null, quadros = [], iq = 0, carregados = 0, timerCarga = null, timer = null;
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pausado = reduzido || prefs.ler('radarPausado', false);
    const mostrarQuadro = () => {
      quadros.forEach((c, k) => c?.setOpacity(k === iq ? 0.75 : 0));
      const q = radar.quadros[iq];
      legenda.textContent = `Radar ${fmt.horaMin(q.ms, offset)} (${fmt.idade(q.ms)}), quadro ${iq + 1} de ${quadros.length}. Fonte: RainViewer.`;
    };
    const tocar = () => { clearInterval(timer); if (!pausado && atual === 'radar' && !document.hidden) timer = setInterval(() => {
      if (carregados < quadros.length) return; // anima só depois de carregar todos os quadros
      iq = (iq + 1) % quadros.length; mostrarQuadro(); }, 700); };
    const rotulo = () => { btnPausa.textContent = pausado ? 'Animar radar' : 'Pausar radar'; btnPausa.setAttribute('aria-pressed', String(pausado)); };
    btnPausa.onclick = () => { pausado = !pausado; prefs.gravar('radarPausado', pausado); rotulo(); tocar(); };
    rotulo();
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(timer); else tocar(); });

    async function ligarRadar() {
      if (!radar) radar = await buscarRadar();
      if (!quadros.length) {
        // Limite da RainViewer: 100 requisições por IP por minuto. Primeiro o quadro mais recente;
        // os anteriores entram aos poucos, um a cada 2 s, e o navegador guarda os tiles em cache.
        const nova = (q) => L.tileLayer(`${radar.host}${q.path}/256/{z}/{x}/{y}/2/1_1.png`, {
          opacity: 0, maxNativeZoom: 7, maxZoom: 12, attribution: 'Weather data by <a href="https://www.rainviewer.com/" rel="noopener noreferrer" target="_blank">RainViewer</a>' });
        quadros = radar.quadros.map(() => null);
        iq = quadros.length - 1;
        quadros[iq] = nova(radar.quadros[iq]); carregados = 1;
        timerCarga = setInterval(() => {
          const k = quadros.findIndex((c) => c === null);
          if (k < 0) { clearInterval(timerCarga); return; }
          quadros[k] = nova(radar.quadros[k]); carregados++;
          if (atual === 'radar') quadros[k].addTo(mapa);
        }, 2000);
      }
      quadros.forEach((c) => c && c.addTo(mapa));
      mostrarQuadro(); tocar();
    }
    function desligarRadar() { clearInterval(timer); quadros.forEach((c) => c && mapa.removeLayer(c)); }

    // ---------- avisos do INMET ----------
    function desenharAvisos(filtro) {
      const lista = (estado.alertas?.avisos || []).filter((a) => a.poligonos && filtro.test(a.titulo || '') && perto(a, lat, lon));
      const grupo = L.layerGroup();
      for (const a of lista) {
        const cor = /grande/i.test(a.severidade) ? '#C8372D' : /^perigo$/i.test(String(a.severidade).trim()) ? '#F96602' : '#E3C51B';
        for (const anel of a.poligonos) {
          const t = el('div', {}, el('strong', { text: a.titulo }), el('br'), document.createTextNode(`${a.severidade || ''}${a.inicio ? `, de ${a.inicio.slice(8, 10)}/${a.inicio.slice(5, 7)} ${a.inicio.slice(11, 16)}` : ''}${a.fim ? ` a ${a.fim.slice(8, 10)}/${a.fim.slice(5, 7)} ${a.fim.slice(11, 16)}` : ''}`));
          L.polygon(anel, { color: cor, weight: 2, fillColor: cor, fillOpacity: 0.12, interactive: true }).bindPopup(t).addTo(grupo);
        }
      }
      return { grupo, n: lista.length };
    }

    // ---------- grade ----------
    const toque = (e) => {
      const c = CAMADAS.find((x) => x.id === atual);
      if (!c?.campo || !g) return;
      let melhor = -1, dist = Infinity;
      g.pontos.forEach(([a, b], k) => { const d = (a - e.latlng.lat) ** 2 + (b - e.latlng.lng) ** 2; if (d < dist) { dist = d; melhor = k; } });
      if (dist > (g.passo * 0.75) ** 2) return;
      const v = g[c.campo][melhor];
      const extra = c.id === 'vento' && g.vento[melhor] !== null ? `, vento médio ${fmt.n(g.vento[melhor], 0)} km/h` : '';
      L.popup({ closeButton: false }).setLatLng(e.latlng)
        .setContent(el('span', { text: v === null ? 'sem dado' : `${fmt.n(v, c.casas)} ${c.un}${extra}` })).openOn(mapa);
    };
    mapa.on('click', toque);

    async function trocar(id) {
      atual = id; prefs.gravar('mapaCamada', id); marcar();
      const c = CAMADAS.find((x) => x.id === id);
      if (camadaAtiva) { mapa.removeLayer(camadaAtiva); camadaAtiva = null; }
      if (avisosAtivos) { mapa.removeLayer(avisosAtivos); avisosAtivos = null; }
      mapa.closePopup();
      desligarRadar();
      titulo.textContent = c.titulo || 'Chuva agora pelo radar';
      btnPausa.hidden = id !== 'radar';
      barra.hidden = rotulos.hidden = !c.escala;
      legenda.textContent = '';
      nota.textContent = '';
      if (c.escala) {
        barra.style.background = gradiente(c.escala);
        rotulos.replaceChildren(...rotulosEscala(c).map((t) => el('span', { text: t })));
      }
      let nAvisos = 0;
      if (c.avisos) {
        const r = desenharAvisos(c.avisos); nAvisos = r.n;
        avisosAtivos = r.grupo.addTo(mapa);
      }
      try {
        if (id === 'radar') {
          nota.textContent = 'Falta de sinal no radar não significa ausência de chuva: o radar pode não cobrir a área, estar em manutenção ou não detectar chuva fraca.';
          await ligarRadar();
          return;
        }
        if (c.campo) {
          legenda.textContent = 'Carregando…';
          g = await grade(lat, lon);
          if (atual !== id) return;
          const meio = (g.n - 1) / 2, la0 = g.pontos[0][0], lo0 = g.pontos[0][1];
          const sul = la0 - (g.n - 1) * g.passo, leste = lo0 + (g.n - 1) * g.passo;
          const escala = c.id === 'nuvens' && !escuro ? ESCALA_NUVEM_CLARO : c.escala;
          camadaAtiva = L.imageOverlay(imagemGrade(g, g[c.campo], escala), [[sul, lo0], [la0, leste]], { opacity: 1, interactive: false }).addTo(mapa);
          camadaAtiva.bringToBack(); fixos.eachLayer((l) => l.bringToFront?.());
          const aqui = g[c.campo][meio * g.n + meio];
          const hora = c.campo === 'tmax5' || c.campo === 'tmin5' || c.campo === 'chuva24' ? '' : (g.hora ? ` às ${g.hora.slice(11, 16)}` : '');
          legenda.textContent = `Na sua região: ${aqui === null ? 'sem dado' : `${fmt.n(aqui, c.casas)} ${c.un}`}${hora}. Toque no mapa para ver o valor de outro lugar. Fonte: Open-Meteo, cerca de 40 km entre pontos.`;
        }
        if (c.avisos) {
          if (c.id === 'avisos' && mapa.getZoom() > 6) mapa.setView([lat, lon], 6);
          const tipo = c.id === 'calor' ? 'de calor' : c.id === 'frio' ? 'de frio ou geada' : '';
          const msg = !estado.alertas || estado.alertas.indisponivel ? 'Avisos do INMET indisponíveis agora.'
            : estado.alertas.semArea ? 'Os avisos do INMET vieram sem a área no mapa desta vez.'
              : nAvisos ? `${nAvisos} aviso${nAvisos > 1 ? 's' : ''} ${tipo} do INMET em vigor na sua região, com a área marcada. Toque na área para ver o aviso.`.replace(/\s+/g, ' ')
                : `Nenhum aviso ${tipo} do INMET em vigor na sua região.`.replace(/\s+/g, ' ');
          nota.textContent = msg;
        }
      } catch (e) {
        if (atual === id) legenda.textContent = `${c.nome} indisponível agora: ${e.message}`;
      }
    }
    botoes.forEach((b) => { b.onclick = () => { if (b.dataset.camada !== atual) trocar(b.dataset.camada); }; });
    await trocar(atual);
  }
}
