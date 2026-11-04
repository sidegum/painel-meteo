// Mapa carregado só quando a seção aparece na tela.
// Leaflet 1.9.4 e radar RainViewer (somente passado, zoom nativo máximo 7).
import { el, fmt, linkExterno, prefs } from './ui.js';
import { buscarRadar } from './dados.js';
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

export function secaoMapa(container, estado) {
  const caixa = el('div', { class: 'mapa', role: 'region', 'aria-label': 'Mapa com radar e estações' }, el('p', { class: 'nota', style: { padding: '16px' }, text: 'O mapa carrega quando esta parte aparece na tela.' }));
  const legenda = el('p', { class: 'fonte', 'aria-live': 'polite' });
  const btnPausa = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Pausar radar');
  const controles = el('div', { class: 'mapa-controles' }, btnPausa, linkExterno(CONFIG.radarOficial, 'Radar oficial da Defesa Civil RS'));
  controles.lastChild.classList.add('botao-link');
  container.append(controles, caixa, legenda,
    el('p', { class: 'nota', text: 'Falta de sinal no radar não significa ausência de chuva: o radar pode não cobrir a área, estar em manutenção ou não detectar chuva fraca. A RainViewer não oferece previsão futura de radar neste plano.' }));

  const io = new IntersectionObserver(async (ents) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    try { await montar(); } catch (e) { caixa.replaceChildren(el('p', { class: 'nota', style: { padding: '16px' }, text: 'Mapa indisponível: ' + e.message })); }
  }, { rootMargin: '200px' });
  io.observe(caixa);

  async function montar() {
    const L = await carregarLeaflet();
    caixa.replaceChildren();
    const mapa = L.map(caixa, { zoomControl: true, attributionControl: true, maxZoom: 12, minZoom: 4, tap: false, dragging: !L.Browser.mobile, scrollWheelZoom: false });
    // No celular, arrastar com um dedo rola a página; o mapa usa dois dedos ou os botões de zoom.
    if (L.Browser.mobile) {
      caixa.addEventListener('touchstart', (e) => { if (e.touches.length === 2) mapa.dragging.enable(); }, { passive: true });
      caixa.addEventListener('touchend', () => mapa.dragging.disable(), { passive: true });
    }
    mapa.setView([estado.local.lat, estado.local.lon], 8);
    // Mapa base do OpenStreetMap. A política dos servidores dele exige saber de qual site vem o pedido,
    // então só os quadros do mapa enviam a origem (https://sidegum.github.io), nunca o caminho da página.
    // O endereço do quadro já indica a região; nada além disso é enviado. No tema escuro, um filtro escurece o mapa.
    const tema = document.documentElement.getAttribute('data-tema');
    const escuro = tema ? tema === 'escuro' : !matchMedia('(prefers-color-scheme: light)').matches;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12, referrerPolicy: 'origin', className: escuro ? 'mapa-escuro' : '',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">colaboradores do OpenStreetMap</a>',
    }).addTo(mapa);
    L.circleMarker([estado.local.lat, estado.local.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2457A6', fillOpacity: 1 }).addTo(mapa).bindTooltip('Você');
    for (const f of estado.obs?.fontes || []) {
      L.circleMarker([f.lat, f.lon], { radius: 6, color: '#17303B', weight: 2, fillColor: f.tipo === 'inmet' ? '#1E8F8A' : '#D9A21B', fillOpacity: 1 })
        .addTo(mapa).bindTooltip(`${f.tipo === 'inmet' ? 'INMET' : 'METAR'} ${f.nome}`.slice(0, 90));
    }
    // radar
    let radar;
    try { radar = await buscarRadar(); } catch (e) { legenda.textContent = 'Radar indisponível: ' + e.message; return; }
    // Cor 2 é o único esquema; zoom nativo até 7 (conferido em 2026-11-03).
    // Limite da RainViewer: 100 requisições por IP por minuto. Primeiro o quadro mais recente;
    // os anteriores entram aos poucos, um a cada 2 s, e o navegador guarda os tiles em cache.
    const nova = (q) => L.tileLayer(`${radar.host}${q.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0, maxNativeZoom: 7, maxZoom: 12, attribution: 'Weather data by <a href="https://www.rainviewer.com/" rel="noopener noreferrer" target="_blank">RainViewer</a>' });
    const camadas = radar.quadros.map(() => null);
    let i = camadas.length - 1;
    camadas[i] = nova(radar.quadros[i]).addTo(mapa);
    let carregados = 1;
    const carregar = setInterval(() => {
      const k = camadas.findIndex((c) => c === null);
      if (k < 0) { clearInterval(carregar); return; }
      camadas[k] = nova(radar.quadros[k]).addTo(mapa); carregados++;
    }, 2000);
    const mostrar = () => {
      camadas.forEach((c, k) => c?.setOpacity(k === i ? 0.75 : 0));
      const q = radar.quadros[i];
      legenda.textContent = `Radar ${fmt.horaMin(q.ms, estado.prev?.offset ?? -10800)} (${fmt.idade(q.ms)}), quadro ${i + 1} de ${camadas.length}. Fonte: RainViewer.`;
    };
    mostrar();
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pausado = reduzido || prefs.ler('radarPausado', false);
    let timer = null;
    const tocar = () => { clearInterval(timer); if (!pausado) timer = setInterval(() => {
      if (carregados < camadas.length) return; // anima só depois de carregar todos os quadros
      i = (i + 1) % camadas.length; mostrar(); }, 700); };
    const rotulo = () => { btnPausa.textContent = pausado ? 'Animar radar' : 'Pausar radar'; btnPausa.setAttribute('aria-pressed', String(pausado)); };
    btnPausa.onclick = () => { pausado = !pausado; prefs.gravar('radarPausado', pausado); rotulo(); tocar(); };
    rotulo(); tocar();
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(timer); else tocar(); });
  }
}
