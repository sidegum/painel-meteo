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
import { PLANETAS, posicaoPlaneta, pontoSubsolar, posicaoLua, faseLua, eclipticaParaEquatorial, alturaAzimute, diaJuliano } from './globo-astro.js';

const RAD = Math.PI / 180;
const RAIO_TERRA_KM = 6371;
const GRUPOS = [
  { id: 'estacoes', nome: 'Estações', cor: 0xffd166, tamanho: 9 },
  { id: 'brilhantes', nome: 'Mais brilhantes', cor: 0xffffff, tamanho: 6 },
  { id: 'meteorologicos', nome: 'Meteorológicos', cor: 0x7fd3ff, tamanho: 6 },
  { id: 'gps', nome: 'GPS', cor: 0xb8f28b, tamanho: 6 },
];
const DESTAQUES = [/^ISS \(ZARYA\)/i, /^CSS \(TIANHE\)/i, /^TIANGONG/i];

const E = { THREE: null, G: null, grupo: null, notaSat: null, pontos: {}, ativos: new Set(['estacoes']), satrecs: {}, rotulos: [], trilha: null, ultimo: 0, sistema: null, modo: 'terra', dom: null };

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
      E.notaSat = `CelesTrak · ${fmt.horaMin(Date.parse(dados.gerado), -new Date().getTimezoneOffset() * 60)}`;
      E.dom.nota.textContent = E.notaSat;
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
    `${fmt.n(d.vel * 3600)} km/h · uma volta a cada ${fmt.n(2 * Math.PI / s.rec.no)} min`, E.notaSat ? E.notaSat.replace('CelesTrak · ', 'CelesTrak · elementos de ') : 'CelesTrak');
}

// ---------- sistema solar ----------
// Posições reais (elementos keplerianos do JPL) em distâncias logarítmicas; texturas procedurais dos planetas
// (sem imagens externas), Lua em torno da Terra, anéis de Saturno, cinturão de asteroides e órbitas elípticas reais.
// O tempo pode correr: 1x (tempo real), 1 dia/s ou 10 dias/s, com a data mostrada.

const SIS = { desloc: 0, vel: 0, ultimo: 0, luz: null, texturas: {}, lua: null, cinturao: null, dom: null };
const VELOCIDADES = [{ v: 0, nome: 'Tempo real' }, { v: 1, nome: '1 dia/s' }, { v: 10, nome: '10 dias/s' }];
const instanteSistema = () => Date.now() + SIS.desloc;

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
  if (SIS.dom) SIS.dom.raiz.hidden = !ligar;
  if (!ligar) { SIS.desloc = 0; definirVelocidade(0); }
  G.modoSistema(ligar);
  if (ligar) E.dom.nota.textContent = 'Posições reais hoje (JPL). Distâncias em escala logarítmica e tamanhos ampliados, para caber na tela. Toque num planeta.';
  else E.dom.nota.textContent = E.notaSat || E.dom.nota.textContent;
}

function definirVelocidade(v) {
  SIS.vel = v; SIS.ultimo = performance.now();
  if (SIS.dom) for (const b of SIS.dom.velocidades.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.vel) === v));
}

const distanciaTela = (ua) => 0.8 + 1.15 * Math.log(1 + ua); // escala logarítmica: Netuno (30 UA) fica a 4,75 e a Terra a 1,6
const raioTela = (raioTerras) => 0.045 + 0.055 * Math.log10(1 + raioTerras); // tamanhos ampliados (Júpiter ~2x a Terra na tela)
/** Eclíptica (x para o ponto vernal, y 90° à frente, z norte) para a cena (y para cima). */
const paraCena = (x, y, z, alvo) => alvo.set(x, z, -y);

function montarSistema() {
  const { THREE, G } = E;
  const grupo = new THREE.Group(); grupo.name = 'sistema';

  // Sol: esfera com textura granulada e dois halos aditivos (fotosfera e coroa)
  const sol = new THREE.Mesh(new THREE.SphereGeometry(0.26, 48, 32), new THREE.MeshBasicMaterial({ map: texturaSol() }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(), color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(1.5);
  const coroa = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(), color: 0xffb060, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  coroa.scale.setScalar(3.2);
  sol.userData.sol = true; sol.userData.rotulo = rotulo('Sol', () => mostrarSol());
  grupo.add(sol, halo, coroa);
  SIS.luz = new THREE.PointLight(0xfff2dc, 7, 0, 0.55); grupo.add(SIS.luz);
  grupo.add(new THREE.AmbientLight(0x404a60, 0.6));

  for (const p of PLANETAS) {
    const r = raioTela(p.raio);
    const mat = new THREE.MeshStandardMaterial({ map: texturaPlaneta(p.nome), roughness: 0.9, metalness: 0 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
    m.name = p.nome; m.userData.planeta = p;
    m.userData.rotulo = rotulo(p.nome, () => mostrarPlaneta(p));
    m.rotation.z = (p.nome === 'Urano' ? 98 : p.nome === 'Saturno' ? 27 : p.nome === 'Terra' ? 23.4 : p.nome === 'Marte' ? 25 : 3) * RAD;
    grupo.add(m);
    if (p.nome === 'Saturno') {
      const geoAnel = new THREE.RingGeometry(r * 1.35, r * 2.3, 96);
      const uv = geoAnel.attributes.uv, posA = geoAnel.attributes.position, v3 = new THREE.Vector3();
      for (let k = 0; k < uv.count; k++) { v3.fromBufferAttribute(posA, k); uv.setXY(k, (v3.length() - r * 1.35) / (r * 0.95), 0.5); } // uv radial: a textura é uma faixa pelo raio
      const anel = new THREE.Mesh(geoAnel, new THREE.MeshBasicMaterial({ map: texturaAnel(), side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      anel.rotation.x = -Math.PI / 2; m.add(anel);
    }
    if (p.nome === 'Terra') {
      SIS.lua = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 20, 14), new THREE.MeshStandardMaterial({ map: texturaPlaneta('Lua'), roughness: 1 }));
      SIS.lua.name = 'Lua'; SIS.lua.userData.rotulo = rotulo('Lua', () => mostrarLua());
      grupo.add(SIS.lua);
      new THREE.TextureLoader().load('vendor/texturas/terra-dia-1024.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
    }
    // órbita real: 180 pontos ao longo da anomalia média, na escala logarítmica da cena
    const pts = [], ms = Date.now(), v = new THREE.Vector3();
    for (let k = 0; k <= 180; k++) { const q = posicaoPlaneta(p, ms, k * 2 - 180); const d = distanciaTela(q.r); pts.push(paraCena(q.x / q.r * d, q.y / q.r * d, q.z / q.r * d, new THREE.Vector3())); }
    const orb = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.cor, transparent: true, opacity: 0.28 }));
    orb.name = 'orbita-' + p.nome;
    grupo.add(orb);
    void v;
  }

  // cinturão de asteroides (entre Marte e Júpiter, 2,1 a 3,3 UA), pontos fixos por semente
  const n = 1400, pos = new Float32Array(n * 3);
  let semente = 11; const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  for (let i = 0; i < n; i++) {
    const ua = 2.1 + rnd() * 1.2, a = rnd() * Math.PI * 2, d = distanciaTela(ua), z = (rnd() - 0.5) * 0.06;
    paraCena(Math.cos(a) * d, Math.sin(a) * d, z, new THREE.Vector3()).toArray(pos, i * 3);
  }
  SIS.cinturao = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({ color: 0x9a9a9a, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false }));
  grupo.add(SIS.cinturao);

  montarControlesSistema();
  grupo.visible = false;
  G.cena.add(grupo);
  return grupo;
}

function rotulo(texto, aoTocar) {
  const r = el('button', { type: 'button', class: 'globo-rotulo globo-rotulo-planeta', text: texto, hidden: true, onclick: aoTocar });
  E.G.dom.raiz.append(r);
  return r;
}

function montarControlesSistema() {
  const velocidades = el('div', { class: 'globo-chips globo-velocidades', role: 'group', 'aria-label': 'Velocidade do tempo' });
  for (const v of VELOCIDADES) velocidades.append(el('button', { type: 'button', 'data-vel': String(v.v), text: v.nome, 'aria-pressed': String(v.v === 0), onclick: () => definirVelocidade(v.v) }));
  velocidades.append(el('button', { type: 'button', text: 'Hoje', 'aria-label': 'Voltar para hoje', onclick: () => { SIS.desloc = 0; definirVelocidade(0); } }));
  const data = el('p', { class: 'globo-data-sistema' });
  const raiz = el('div', { class: 'globo-sistema-controles' }, velocidades, data);
  E.G.dom.raiz.append(raiz);
  SIS.dom = { raiz, velocidades, data };
}

function atualizarSistema() {
  const { THREE, G } = E;
  const agoraPerf = performance.now();
  if (SIS.vel) { SIS.desloc += (agoraPerf - SIS.ultimo) / 1000 * SIS.vel * 86400000; }
  SIS.ultimo = agoraPerf;
  const ms = instanteSistema();
  const rect = G.dom.canvas.getBoundingClientRect();
  const v = new THREE.Vector3();
  const projetar = (obj, rot, desl) => {
    v.copy(obj.position).project(G.camera);
    const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height;
    rot.hidden = v.z > 1 || x < 0 || y < 56 || x > rect.width || y > rect.height - 140 || (x > rect.width - 125 && y < 400); // fora dos botões da direita
    rot.style.transform = `translate(${x.toFixed(0)}px, ${(y + desl).toFixed(0)}px)`;
  };
  let terra = null;
  for (const m of E.sistema.children) {
    if (m.userData.sol) { m.rotation.y += 0.0004; projetar(m, m.userData.rotulo, 40); continue; }
    const p = m.userData.planeta; if (!p) continue;
    const pos = posicaoPlaneta(p, ms);
    const d = distanciaTela(pos.r);
    paraCena(pos.x / pos.r * d, pos.y / pos.r * d, pos.z / pos.r * d, m.position);
    m.rotation.y += p.nome === 'Júpiter' || p.nome === 'Saturno' ? 0.012 : 0.005;
    projetar(m, m.userData.rotulo, PLANETAS.indexOf(p) % 2 ? -26 : 12);
    if (p.nome === 'Terra') terra = m;
  }
  if (SIS.lua && terra) {
    const l = posicaoLua(ms), b = l.lat * RAD, lo = l.lon * RAD, dist = raioTela(1) * 2.4;
    paraCena(Math.cos(b) * Math.cos(lo) * dist, Math.cos(b) * Math.sin(lo) * dist, Math.sin(b) * dist, SIS.lua.position).add(terra.position);
    SIS.lua.rotation.y += 0.002;
    projetar(SIS.lua, SIS.lua.userData.rotulo, -22);
  }
  if (SIS.dom) {
    const d = new Date(ms);
    SIS.dom.data.textContent = SIS.desloc === 0 && !SIS.vel ? `Hoje, ${d.toLocaleDateString('pt-BR')} · tempo real` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

// ---------- informações de cada astro ----------

function localObservador() { const l = E.G.estadoApp?.local; return { lat: l?.lat ?? -29.7, lon: l?.lon ?? -51.1 }; }

/** Frase simples de visibilidade de um astro no céu local agora, pela altura e pelo azimute. */
function fraseCeu(ra, dec, elongacao, ms) {
  const { lat, lon } = localObservador();
  const h = alturaAzimute(ra, dec, lat, lon, ms);
  const rumo = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'][Math.round(h.azimute / 45) % 8];
  if (elongacao !== null && elongacao < 12) return `Está muito perto do Sol no céu (${fmt.n(elongacao)}°): não dá para ver agora.`;
  if (h.altura < -2) return `Abaixo do horizonte agora, do lado ${rumo}.`;
  const sol = pontoSubsolar(ms), hs = alturaAzimute(sol.ascensaoReta, sol.declinacao, lat, lon, ms);
  const dia = hs.altura > -6;
  return `${dia ? 'Está no céu agora, mas a luz do dia atrapalha' : 'Visível agora'}: ${fmt.n(h.altura)}° acima do horizonte, para o ${rumo}.`;
}

function mostrarPlaneta(p) {
  const { G } = E;
  const ms = instanteSistema();
  const pl = posicaoPlaneta(p, ms), te = posicaoPlaneta(PLANETAS[2], ms);
  const gx = pl.x - te.x, gy = pl.y - te.y, gz = pl.z - te.z, gr = Math.hypot(gx, gy, gz);
  const n = diaJuliano(ms) - 2451545.0;
  const eq = eclipticaParaEquatorial(Math.atan2(gy, gx) / RAD, Math.asin(gz / gr) / RAD, n);
  const sx = -te.x, sy = -te.y, sz = -te.z, sr = Math.hypot(sx, sy, sz);
  const elong = Math.acos((gx * sx + gy * sy + gz * sz) / (gr * sr)) / RAD;
  const luzMin = gr * 8.317;
  const frase = p.nome === 'Terra' ? 'É aqui que você está. A Terra dá uma volta no Sol por ano, a cerca de 30 km/s.' : fraseCeu(eq.ra, eq.dec, elong, ms);
  const numeros = p.nome === 'Terra' ? `${fmt.n(te.r, 3)} UA do Sol · luz do Sol chega em ${fmt.n(te.r * 8.317, 1)} min`
    : `${fmt.n(pl.r, 2)} UA do Sol · ${fmt.n(gr, 2)} UA da Terra (luz leva ${luzMin >= 60 ? `${fmt.n(luzMin / 60, 1)} h` : `${fmt.n(luzMin)} min`})`;
  G.mostrarPainel(p.nome, frase, numeros, `JPL (elementos keplerianos) · ${new Date(ms).toLocaleDateString('pt-BR')}${p.nome !== 'Terra' ? ` · afastamento do Sol no céu ${fmt.n(elong)}°` : ''}`);
}

function mostrarSol() {
  const ms = instanteSistema();
  const s = pontoSubsolar(ms), te = posicaoPlaneta(PLANETAS[2], ms);
  const { lat, lon } = localObservador();
  const h = alturaAzimute(s.ascensaoReta, s.declinacao, lat, lon, ms);
  const frase = h.altura > 0 ? `O Sol está ${fmt.n(h.altura)}° acima do horizonte agora, aqui.` : h.altura > -6 ? 'Crepúsculo aqui agora.' : 'É noite aqui agora.';
  E.G.mostrarPainel('Sol', frase, `${fmt.n(te.r * 149597870 / 1e6, 1)} milhões de km da Terra · a pino em ${fmt.n(Math.abs(s.lat), 1)}°${s.lat < 0 ? 'S' : 'N'} ${fmt.n(Math.abs(s.lon), 1)}°${s.lon < 0 ? 'O' : 'L'}`, 'Astronomical Almanac · posição calculada');
}

function mostrarLua() {
  const ms = instanteSistema();
  const l = posicaoLua(ms), f = faseLua(ms), n = diaJuliano(ms) - 2451545.0;
  const eq = eclipticaParaEquatorial(l.lon, l.lat, n);
  const frase = `Lua ${f.nome}, ${fmt.n(f.fracao * 100)}% iluminada. ${fraseCeu(eq.ra, eq.dec, Math.min(f.elongacao, 360 - f.elongacao), ms)}`;
  E.G.mostrarPainel('Lua', frase, `${fmt.n(l.distanciaKm / 1000)} mil km da Terra · luz leva ${fmt.n(l.distanciaKm / 299792.458, 1)} s`, 'Meeus (série curta) · posição calculada');
}

// ---------- texturas procedurais ----------

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
  'Mercúrio': { base: [120, 116, 110], var: [60, 58, 55], faixas: 0, semente: 3 },
  'Vênus': { base: [222, 196, 140], var: [40, 30, 20], faixas: 3, semente: 5 },
  'Terra': { base: [60, 110, 180], var: [40, 60, 40], faixas: 0, semente: 7 },
  'Marte': { base: [180, 95, 55], var: [70, 45, 35], faixas: 0, semente: 9, polos: true },
  'Júpiter': { base: [205, 170, 130], var: [60, 50, 45], faixas: 11, semente: 13, mancha: true },
  'Saturno': { base: [218, 196, 150], var: [35, 30, 25], faixas: 8, semente: 17 },
  'Urano': { base: [150, 212, 222], var: [15, 15, 15], faixas: 2, semente: 19 },
  'Netuno': { base: [70, 110, 220], var: [40, 40, 30], faixas: 4, semente: 23 },
  'Lua': { base: [150, 148, 142], var: [70, 70, 68], faixas: 0, semente: 29 },
};

function texturaPlaneta(nome) {
  if (SIS.texturas[nome]) return SIS.texturas[nome];
  const P = PALETAS[nome], W = 512, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  const ruido = ruido2d(P.semente, W, H), ruido2 = ruido2d(P.semente + 100, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let t = ruido[i];
    if (P.faixas) { const f = Math.sin((y / H + (ruido2[i] - 0.5) * 0.08) * Math.PI * P.faixas); t = 0.5 + 0.3 * f + (ruido[i] - 0.5) * 0.5; }
    if (P.mancha) { const dx = (x - 340) / 36, dy = (y - 150) / 16; if (dx * dx + dy * dy < 1) t = 0.2 - (dx * dx + dy * dy) * 0.1; }
    const lat = Math.abs(y / H - 0.5) * 2;
    let r = P.base[0] + (t - 0.5) * 2 * P.var[0], g = P.base[1] + (t - 0.5) * 2 * P.var[1], b = P.base[2] + (t - 0.5) * 2 * P.var[2];
    if (P.polos && lat > 0.86) { const k = (lat - 0.86) / 0.14; r = r + (235 - r) * k; g = g + (235 - g) * k; b = b + (240 - b) * k; }
    if (P.mancha && t < 0.25) { r += 40; g -= 10; b -= 20; }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new E.THREE.CanvasTexture(cv); tex.colorSpace = E.THREE.SRGBColorSpace;
  SIS.texturas[nome] = tex;
  return tex;
}

function texturaSol() {
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data, ruido = ruido2d(31, W, H);
  for (let i = 0; i < W * H; i++) { const t = ruido[i]; d[i * 4] = 255; d[i * 4 + 1] = 190 + t * 60; d[i * 4 + 2] = 90 + t * 90; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const tex = new E.THREE.CanvasTexture(cv); tex.colorSpace = E.THREE.SRGBColorSpace; return tex;
}

function texturaAnel() {
  const W = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = 1;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, 1), d = img.data;
  let s = 41; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let x = 0; x < W; x++) {
    const u = x / W; const divisao = u > 0.62 && u < 0.68 ? 0.1 : 1; // divisão de Cassini
    const a = (u < 0.08 ? u / 0.08 : u > 0.95 ? (1 - u) / 0.05 : 1) * divisao * (0.55 + 0.45 * rnd());
    d[x * 4] = 225; d[x * 4 + 1] = 205; d[x * 4 + 2] = 165; d[x * 4 + 3] = Math.round(a * 230);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new E.THREE.CanvasTexture(cv); tex.colorSpace = E.THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = E.THREE.ClampToEdgeWrapping;
  return tex;
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

export function sistemaAtivo() { return E.modo === 'sistema'; }
