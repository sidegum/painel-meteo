// Espaço da aba Globo: satélites em tempo real (ISS, Tiangong e grupos do CelesTrak via satellite.js) e o sistema solar
// com as posições reais dos planetas. Carregado só quando o usuário toca em "Espaço".
//
// Satélites: elementos orbitais (OMM) do CelesTrak, propagados pelo SGP4 (satellite.js) no instante atual; a posição
// ECI vira geodésica (latitude, longitude, altura) com o tempo sideral, e a altura entra em escala real sobre o globo
// (raio 1 = 6371 km). Sistema solar: elementos keplerianos do JPL (globo-astro.js); distâncias em escala
// logarítmica, porque em escala real Netuno ficaria 30 vezes mais longe que a Terra e nada caberia na tela.
import * as sat from '../vendor/satellite/satellite.min.js';
import { el, fmt } from './ui.js';
import { buscarSatelites } from './globo-dados.js';
import { PLANETAS, posicaoPlaneta, pontoSubsolar } from './globo-astro.js';

const RAD = Math.PI / 180;
const RAIO_TERRA_KM = 6371;
const GRUPOS = [
  { id: 'estacoes', nome: 'Estações', cor: 0xffd166, tamanho: 9 },
  { id: 'brilhantes', nome: 'Mais brilhantes', cor: 0xffffff, tamanho: 6 },
  { id: 'meteorologicos', nome: 'Meteorológicos', cor: 0x7fd3ff, tamanho: 6 },
  { id: 'gps', nome: 'GPS', cor: 0xb8f28b, tamanho: 6 },
];
const DESTAQUES = [/^ISS \(ZARYA\)/i, /^CSS \(TIANHE\)/i, /^TIANGONG/i];

const E = { THREE: null, G: null, grupo: null, pontos: {}, ativos: new Set(['estacoes']), satrecs: {}, rotulos: [], trilha: null, ultimo: 0, sistema: null, modo: 'terra', dom: null };

/**
 * Liga o modo Espaço: baixa os elementos orbitais, cria os pontos dos satélites e as fichas de grupo.
 * @param {object} G estado do globo (cena, câmera, dom, manifest)
 * @param {object} THREE módulo do Three.js já carregado pelo globo
 */
export async function abrirEspaco(G, THREE) {
  E.G = G; E.THREE = THREE;
  if (!E.grupo) {
    E.grupo = new THREE.Group(); E.grupo.name = 'espaco';
    G.cena.add(E.grupo);
    montarFichas();
  }
  E.grupo.visible = true;
  E.dom.raiz.hidden = false;
  if (!Object.keys(E.satrecs).length) {
    try {
      const dados = await buscarSatelites(G.manifest);
      for (const [g, lista] of Object.entries(dados.grupos)) {
        E.satrecs[g] = lista.map((o) => { try { return { nome: String(o.OBJECT_NAME).slice(0, 30), rec: sat.json2satrec(o) }; } catch { return null; } }).filter(Boolean);
      }
      E.dom.nota.textContent = `CelesTrak · ${fmt.horaMin(Date.parse(dados.gerado), -new Date().getTimezoneOffset() * 60)}`;
      montarPontos();
    } catch (e) {
      E.dom.nota.textContent = `Satélites indisponíveis (${e?.message || 'falha'}).`;
    }
  }
}

export function fecharEspaco() {
  if (E.modo === 'sistema') alternarSistema(false);
  if (E.grupo) E.grupo.visible = false;
  if (E.dom) E.dom.raiz.hidden = true;
  for (const r of E.rotulos) r.el.hidden = true;
}

function montarFichas() {
  const G = E.G;
  const chips = el('div', { class: 'globo-chips', role: 'group', 'aria-label': 'Satélites' });
  for (const g of GRUPOS) {
    chips.append(el('button', { type: 'button', 'aria-pressed': String(E.ativos.has(g.id)), 'data-grupo': g.id, text: g.nome, onclick: (ev) => {
      const b = ev.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on)); if (on) E.ativos.add(g.id); else E.ativos.delete(g.id);
      if (E.pontos[g.id]) E.pontos[g.id].visible = on;
    } }));
  }
  chips.append(el('button', { type: 'button', class: 'globo-chip-sistema', text: 'Sistema solar', 'aria-pressed': 'false', onclick: () => alternarSistema(E.modo !== 'sistema') }));
  const nota = el('p', { class: 'globo-espaco-nota', text: 'Carregando órbitas…' });
  const raiz = el('div', { class: 'globo-espaco' }, chips, nota);
  G.dom.raiz.append(raiz);
  E.dom = { raiz, chips, nota };
}

function montarPontos() {
  const { THREE, G } = E;
  for (const g of GRUPOS) {
    const lista = E.satrecs[g.id] || [];
    if (!lista.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lista.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ color: g.cor, size: g.tamanho * (devicePixelRatio > 1.5 ? 1.5 : 1), sizeAttenuation: false, map: texturaPonto(), transparent: true, alphaTest: 0.3, opacity: 0.95, depthWrite: false });
    const p = new THREE.Points(geo, mat);
    p.visible = E.ativos.has(g.id); p.renderOrder = 8;
    E.grupo.add(p);
    E.pontos[g.id] = p;
    if (g.id === 'estacoes') {
      lista.forEach((s, k) => {
        if (!DESTAQUES.some((re) => re.test(s.nome))) return;
        const nome = /ISS/i.test(s.nome) ? 'ISS' : 'Tiangong';
        const r = el('button', { type: 'button', class: 'globo-rotulo', text: nome, hidden: true, onclick: () => mostrarSatelite(s, nome) });
        G.dom.raiz.append(r);
        E.rotulos.push({ el: r, k, grupo: g.id, s, nome });
        if (nome === 'ISS') E.trilha = criarTrilha(s.rec);
      });
    }
  }
}

function criarTrilha(rec) {
  const { THREE } = E;
  const n = 90; // próximos 90 minutos (uma volta)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.45 }));
  linha.userData.rec = rec; linha.userData.n = n;
  E.grupo.add(linha);
  return linha;
}

/** Posição de um satélite no instante: vetor na cena (raio 1 = superfície), ou null se a propagação falhar. */
function posicao(rec, data, alvo) {
  let pv;
  try { pv = sat.propagate(rec, data); } catch { return null; }
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const gmst = sat.gstime(data);
  const geo = sat.eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(geo.height) || geo.height < 80) return null;
  const r = 1 + geo.height / RAIO_TERRA_KM, la = geo.latitude, lo = geo.longitude;
  alvo.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
  alvo.userData = { lat: la / RAD, lon: lo / RAD, alt: geo.height, vel: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) };
  return alvo;
}

/** Chamado a cada quadro pelo globo: propaga os satélites (a cada 400 ms) e posiciona os rótulos. */
export function atualizarEspaco(agora) {
  const { THREE, G } = E;
  if (!E.grupo || !E.grupo.visible) return;
  if (E.modo === 'sistema') { atualizarSistema(); return; }
  const data = new Date();
  if (agora - E.ultimo > 400) {
    E.ultimo = agora;
    const v = new THREE.Vector3();
    for (const g of GRUPOS) {
      const p = E.pontos[g.id]; if (!p || !p.visible) continue;
      const pos = p.geometry.attributes.position.array;
      (E.satrecs[g.id] || []).forEach((s, k) => {
        if (posicao(s.rec, data, v)) { pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; }
        else { pos[k * 3] = 0; pos[k * 3 + 1] = -5; pos[k * 3 + 2] = 0; }
      });
      p.geometry.attributes.position.needsUpdate = true;
    }
    if (E.trilha) {
      const pos = E.trilha.geometry.attributes.position.array, n = E.trilha.userData.n;
      for (let k = 0; k < n; k++) {
        if (posicao(E.trilha.userData.rec, new Date(data.getTime() + k * 60000), v)) { pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; }
      }
      E.trilha.geometry.attributes.position.needsUpdate = true;
    }
  }
  // rótulos ISS / Tiangong: projeção da posição na tela, escondidos atrás da Terra
  const rect = G.dom.canvas.getBoundingClientRect();
  const v = new THREE.Vector3();
  for (const r of E.rotulos) {
    const p = E.pontos[r.grupo]; if (!p || !p.visible) { r.el.hidden = true; continue; }
    const a = p.geometry.attributes.position.array;
    v.set(a[r.k * 3], a[r.k * 3 + 1], a[r.k * 3 + 2]);
    const atras = v.clone().sub(G.camera.position).length() > G.camera.position.length() && v.dot(G.camera.position) < 0;
    v.project(G.camera);
    const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height;
    r.el.hidden = atras || v.z > 1 || x < 0 || y < 0 || x > rect.width || y > rect.height;
    r.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
}

function mostrarSatelite(s, nome) {
  const { THREE, G } = E;
  const v = posicao(s.rec, new Date(), new THREE.Vector3());
  if (!v) return;
  const d = v.userData;
  G.mostrarPainel(nome === 'ISS' ? 'Estação Espacial Internacional' : 'Estação espacial chinesa Tiangong',
    `Agora sobre ${fmt.n(Math.abs(d.lat), 1)}°${d.lat < 0 ? 'S' : 'N'} ${fmt.n(Math.abs(d.lon), 1)}°${d.lon < 0 ? 'O' : 'L'}, a ${fmt.n(d.alt)} km de altura.`,
    `${fmt.n(d.vel * 3600)} km/h · uma volta a cada ${fmt.n(2 * Math.PI / s.rec.no)} min`, `CelesTrak · elementos de ${s.rec.epochyr ? '' : ''}${E.dom.nota.textContent.replace('CelesTrak · ', '')}`);
}

// ---------- sistema solar ----------

function alternarSistema(ligar) {
  const { THREE, G } = E;
  E.modo = ligar ? 'sistema' : 'terra';
  E.dom.chips.querySelector('.globo-chip-sistema').setAttribute('aria-pressed', String(ligar));
  for (const b of E.dom.chips.querySelectorAll('[data-grupo]')) b.hidden = ligar;
  if (ligar && !E.sistema) E.sistema = montarSistema();
  if (E.sistema) { E.sistema.visible = ligar; if (!ligar) for (const m of E.sistema.children) if (m.userData.rotulo) m.userData.rotulo.hidden = true; }
  for (const g of GRUPOS) if (E.pontos[g.id]) E.pontos[g.id].visible = !ligar && E.ativos.has(g.id);
  if (E.trilha) E.trilha.visible = !ligar;
  if (ligar) for (const r of E.rotulos) r.el.hidden = true;
  G.modoSistema(ligar);
  if (ligar) E.dom.nota.textContent = 'Posições reais dos planetas hoje (JPL). Distâncias fora de escala, tamanhos fora de escala.';
  else E.dom.nota.textContent = E.dom.notaSat || E.dom.nota.textContent;
}

const distanciaTela = (ua) => 1.1 + 1.7 * Math.log(1 + ua);

function montarSistema() {
  const { THREE, G } = E;
  const grupo = new THREE.Group(); grupo.name = 'sistema';
  const sol = new THREE.Mesh(new THREE.SphereGeometry(0.28, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  const brilho = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(), color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  brilho.scale.setScalar(1.6);
  grupo.add(sol, brilho);
  for (const p of PLANETAS) {
    const r = 0.025 + 0.03 * Math.log10(1 + p.raio);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshLambertMaterial({ color: p.cor }));
    m.name = p.nome; m.userData.planeta = p;
    const rot = el('span', { class: 'globo-rotulo globo-rotulo-planeta', text: p.nome, hidden: true });
    G.dom.raiz.append(rot);
    m.userData.rotulo = rot;
    grupo.add(m);
    if (p.nome === 'Saturno') { const anel = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.2, 48), new THREE.MeshBasicMaterial({ color: 0xd9c89a, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })); anel.rotation.x = -Math.PI / 2 + 0.47; m.add(anel); }
    // órbita: círculo na distância de tela (as órbitas reais são quase circulares; só a escala muda)
    const pts = [];
    for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    const orb = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
    orb.name = 'orbita-' + p.nome; orb.userData.planeta = p;
    grupo.add(orb);
  }
  const luz = new THREE.PointLight(0xffffff, 6, 0, 0.6); grupo.add(luz);
  const rotSol = el('span', { class: 'globo-rotulo globo-rotulo-planeta', text: 'Sol', hidden: true }); G.dom.raiz.append(rotSol);
  sol.userData.rotulo = rotSol; sol.userData.sol = true;
  grupo.visible = false;
  G.cena.add(grupo);
  return grupo;
}

let pontoTex = null;
function texturaPonto() {
  if (pontoTex) return pontoTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d'); const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  pontoTex = new E.THREE.CanvasTexture(cv);
  return pontoTex;
}

function texturaBrilho() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'); const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,220,150,0.5)'); g.addColorStop(1, 'rgba(255,200,100,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new E.THREE.CanvasTexture(cv); return t;
}

function atualizarSistema() {
  const { THREE, G } = E;
  const ms = Date.now();
  const rect = G.dom.canvas.getBoundingClientRect();
  const v = new THREE.Vector3();
  for (const m of E.sistema.children) {
    if (m.userData.sol) { v.set(0, 0, 0).project(G.camera); const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height; m.userData.rotulo.hidden = false; m.userData.rotulo.style.transform = `translate(${x.toFixed(0)}px, ${(y + 34).toFixed(0)}px)`; continue; }
    const p = m.userData.planeta; if (!p) continue;
    if (m.name.startsWith('orbita-')) {
      const pos = posicaoPlaneta(p, ms); const d = distanciaTela(pos.r); m.scale.setScalar(d); continue;
    }
    const pos = posicaoPlaneta(p, ms);
    const d = distanciaTela(pos.r);
    // eclíptica: x para o ponto vernal, z para cima; na cena, y é para cima
    m.position.set(pos.x / pos.r * d, pos.z / pos.r * d, -pos.y / pos.r * d);
    v.copy(m.position).project(G.camera);
    const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height;
    const r = m.userData.rotulo;
    r.hidden = v.z > 1 || x < 0 || y < 0 || x > rect.width || y > rect.height;
    const desl = PLANETAS.indexOf(p) % 2 ? -24 : 10; // alterna acima/abaixo para rótulos vizinhos não se cobrirem
    r.style.transform = `translate(${x.toFixed(0)}px, ${(y + desl).toFixed(0)}px)`;
  }
}

export function sistemaAtivo() { return E.modo === 'sistema'; }
