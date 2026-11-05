// Espaço da aba Globo: satélites em tempo real em volta da Terra, planetas no céu ao fundo e o sistema solar com
// planetas, Lua, Plutão, cinturões, heliopausa e as sondas do JPL Horizons. É a parte "para explorar": tudo é tocável.
//
// Satélites: elementos orbitais (OMM) do CelesTrak propagados pelo SGP4 (satellite.js); a posição ECI vira geodésica
// (latitude, longitude, altura) pelo tempo sideral e a altura entra em escala real sobre o globo (raio 1 = 6371 km).
// Sistema solar: posições reais do Astronomy Engine; as distâncias ao Sol são comprimidas por uma potência (DIST_EXP)
// para Mercúrio e Netuno caberem na mesma tela, e as direções são as reais.
// Tudo é montado de antemão (prepararEspaco, chamado pelo globo assim que a Terra aparece): ao tocar em Espaço ou em
// Sistema solar, a cena já está pronta e só fica visível.
import * as sat from '../vendor/satellite/satellite.min.js';
import { el, fmt } from './ui.js';
import { buscarSatelites, buscarSondas } from './globo-dados.js';
import { PLANETAS, posicaoPlaneta, posicaoLua, pontoOrbita } from './globo-astro.js';
import * as C from './ceu.js';
import { cartaoAstro, cartaoEstrela, cartaoSatelite, cartaoSonda, fusoS } from './globo-ceu.js';
import { MISSOES, estadoSonda, interpolar, rotaCompleta } from './globo-sondas.js';
import { texturaPlaneta, texturaSol, texturaAnel, texturaPonto, texturaBrilho, texturaAnelSelecao } from './globo-texturas.js';

const RAD = Math.PI / 180;
const RAIO_TERRA_KM = 6371;
const TOQUE_PX = 24; // raio de toque em volta de um ponto (o dedo cobre uns 40 px)
const GRUPOS = [
  { id: 'estacoes', nome: 'Estações', cor: 0xffd166, tamanho: 9 },
  { id: 'brilhantes', nome: 'Mais brilhantes', cor: 0xffffff, tamanho: 6 },
  { id: 'meteorologicos', nome: 'Meteorológicos', cor: 0x7fd3ff, tamanho: 6 },
  { id: 'gps', nome: 'GPS', cor: 0xb8f28b, tamanho: 6 },
];
const PRINCIPAIS = { 'ISS (ZARYA)': 'ISS', 'CSS (TIANHE)': 'Tiangong' };
const CEU = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const COR_CEU = { Mercury: '#c9c4bb', Venus: '#fff3cf', Mars: '#ff9a6a', Jupiter: '#ffe2b8', Saturn: '#f2e0a8', Uranus: '#b8eef5', Neptune: '#8fb0ff' };

const E = {
  THREE: null, G: null, preparo: null, grupo: null, dom: null, modo: 'terra', aberto: false,
  sats: {}, pontos: {}, ativos: new Set(['estacoes']), rotulos: [], notaSat: '', geradoSat: null, ultimo: 0,
  selecao: null, ceu: [], estrelas: [], sistema: null, sondas: null,
};
const MAG_ROTULO_ESTRELA = 1.6; // estrelas com nome que ganham rótulo no espaço (as ~25 mais brilhantes)

// ------------------------------------------------------------------ preparo, abrir e fechar

/**
 * Monta tudo escondido: satélites, planetas no céu e o sistema solar com as sondas. Pode ser chamado várias vezes;
 * o trabalho acontece uma vez só. Falhas de rede deixam a parte correspondente de fora, com aviso na nota.
 */
export function prepararEspaco(G, THREE) {
  if (E.preparo) return E.preparo;
  E.G = G; E.THREE = THREE;
  E.grupo = new THREE.Group(); E.grupo.name = 'espaco'; E.grupo.visible = false;
  G.cena.add(E.grupo);
  montarInterface();
  montarCeu();
  E.preparo = (async () => {
    const [sats, sondas] = await Promise.allSettled([buscarSatelites(G.manifest), buscarSondas(G.manifest)]);
    if (sats.status === 'fulfilled') montarSatelites(sats.value);
    else E.notaSat = `Satélites indisponíveis agora (${sats.reason?.message || 'falha'}).`;
    E.sondas = sondas.status === 'fulfilled' ? sondas.value : null;
    E.sistema = montarSistema();
    E.dom.nota.textContent = E.notaSat;
  })();
  return E.preparo;
}

/** Mostra o espaço (satélites e planetas em volta da Terra). */
export async function abrirEspaco(G, THREE) {
  E.aberto = true;
  prepararEspaco(G, THREE);
  E.grupo.visible = true;
  E.dom.raiz.hidden = false;
  G.estrelas?.pronto.then((ceu) => { if (E.aberto && ceu.linhas) ceu.linhas.visible = E.modo !== 'sistema'; }).catch(() => {});
  if (!E.sistema) { E.dom.nota.textContent = 'Carregando órbitas…'; await E.preparo; }
  if (!E.aberto) return;
  E.grupo.visible = true;
  E.dom.nota.textContent = E.notaSat;
}

export function fecharEspaco() {
  E.aberto = false;
  if (E.modo === 'sistema') alternarSistema(false);
  if (E.grupo) E.grupo.visible = false;
  if (E.dom) E.dom.raiz.hidden = true;
  for (const r of E.rotulos) r.el.hidden = true;
  for (const c of E.ceu) c.rotulo.hidden = true;
  for (const s of E.estrelas) if (s.rotulo) s.rotulo.hidden = true;
  if (E.G?.estrelas?.linhas) E.G.estrelas.linhas.visible = false;
  limparSelecao();
}

export const sistemaAtivo = () => E.modo === 'sistema';

function montarInterface() {
  const G = E.G;
  const chips = el('div', { class: 'globo-chips', role: 'group', 'aria-label': 'Satélites' });
  for (const g of GRUPOS) {
    chips.append(el('button', { type: 'button', 'aria-pressed': String(E.ativos.has(g.id)), 'data-grupo': g.id, text: g.nome, onclick: (ev) => {
      const b = ev.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on)); if (on) E.ativos.add(g.id); else E.ativos.delete(g.id);
      if (E.pontos[g.id]) E.pontos[g.id].visible = on;
      if (!on && E.selecao?.s?.grupo === g.id) limparSelecao();
      E.ultimo = 0;
    } }));
  }
  chips.append(el('button', { type: 'button', class: 'globo-chip-sistema', text: 'Sistema solar', 'aria-pressed': 'false', onclick: () => alternarSistema(E.modo !== 'sistema') }));
  const nota = el('p', { class: 'globo-espaco-nota', text: '' });
  const raiz = el('div', { class: 'globo-espaco', hidden: true }, chips, nota);
  G.dom.raiz.append(raiz);
  E.dom = { raiz, chips, nota };
}

// ------------------------------------------------------------------ satélites

function montarSatelites(dados) {
  const { THREE, G } = E;
  const off = fusoS(G.estadoApp);
  E.geradoSat = Date.parse(dados.gerado) || null;
  E.notaSat = `CelesTrak · ${E.geradoSat ? fmt.horaMin(E.geradoSat, off) : '–'}`;
  for (const g of GRUPOS) {
    const lista = (dados.grupos[g.id] || []).map((omm) => {
      const rec = C.registroSatelite(omm);
      return rec ? { nome: String(omm.OBJECT_NAME).slice(0, 40), omm, rec, grupo: g.id } : null;
    }).filter(Boolean);
    E.sats[g.id] = lista;
    if (!lista.length) continue;
    lista.forEach((s, k) => { s.k = k; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lista.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ color: g.cor, size: g.tamanho * (devicePixelRatio > 1.5 ? 1.5 : 1), sizeAttenuation: false, map: texturaPonto(THREE), transparent: true, alphaTest: 0.3, opacity: 0.95, depthWrite: false });
    const p = new THREE.Points(geo, mat);
    p.visible = E.ativos.has(g.id); p.renderOrder = 8;
    E.grupo.add(p);
    E.pontos[g.id] = p;
  }
  // rótulos das estações e quem está acoplado a elas (mesma posição, a menos de 5 km)
  const agora = new Date();
  const base = (E.sats.estacoes || []).filter((s) => PRINCIPAIS[s.nome]);
  for (const s of base) {
    s.destaque = PRINCIPAIS[s.nome];
    const r = el('button', { type: 'button', class: 'globo-rotulo', text: s.destaque, hidden: true, onclick: () => selecionarSatelite(s) });
    G.dom.raiz.append(r);
    E.rotulos.push({ el: r, s });
    s.trilha = criarTrilha(0xffd166, 0.4);
  }
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const s of E.sats.estacoes || []) {
    if (s.destaque || !posicaoCena(s.rec, agora, v)) continue;
    for (const b of base) if (posicaoCena(b.rec, agora, w) && v.distanceTo(w) * RAIO_TERRA_KM < 5) s.acopladoA = b.destaque === 'ISS' ? 'ISS' : 'Tiangong';
  }
}

function criarTrilha(cor, opacidade, n = 120) {
  const { THREE } = E;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opacidade, depthWrite: false }));
  linha.userData.n = n;
  E.grupo.add(linha);
  return linha;
}

/** Desenha uma volta da órbita a partir de agora (posições futuras sobre a Terra que gira). */
function atualizarTrilha(linha, rec, data) {
  const pos = linha.geometry.attributes.position.array, n = linha.userData.n, v = new E.THREE.Vector3();
  const periodoMs = 2 * Math.PI / rec.no * 60000;
  for (let k = 0; k < n; k++) if (posicaoCena(rec, new Date(data.getTime() + k * periodoMs / (n - 1)), v)) v.toArray(pos, k * 3);
  linha.geometry.attributes.position.needsUpdate = true;
  linha.geometry.computeBoundingSphere();
}

/** Posição de um satélite no instante: vetor na cena (raio 1 = superfície), ou null se a propagação falhar. */
function posicaoCena(rec, data, alvo) {
  let pv;
  try { pv = sat.propagate(rec, data); } catch { return null; }
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const geo = sat.eciToGeodetic(pv.position, sat.gstime(data));
  if (!Number.isFinite(geo.height) || geo.height < 80) return null;
  const r = 1 + geo.height / RAIO_TERRA_KM, la = geo.latitude, lo = geo.longitude;
  return alvo.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function selecionarSatelite(s) {
  const { G, THREE } = E;
  limparSelecao();
  const anel = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaAnelSelecao(THREE), color: 0xffffff, sizeAttenuation: false, depthTest: false, transparent: true }));
  anel.scale.setScalar(0.05); anel.renderOrder = 12;
  E.grupo.add(anel);
  E.selecao = { s, anel, trilha: s.trilha ? null : criarTrilha(0xffffff, 0.55), ultimaTrilha: 0 };
  E.ultimo = 0;
  const c = cartaoSatelite(s, G.estadoApp, E.geradoSat);
  const seguir = { texto: 'Seguir', alternar: true, onclick: (ativo) => { G.seguir = ativo ? () => { const v = posicaoCena(s.rec, new Date(), new THREE.Vector3()); if (!v) return null; return { lat: Math.asin(v.y / v.length()) / RAD, lon: -Math.atan2(v.z, v.x) / RAD }; } : null; } };
  G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, [c.detalhes && { texto: 'Ver detalhes', onclick: c.detalhes }, seguir].filter(Boolean), limparSelecao);
}

function limparSelecao() {
  const sel = E.selecao;
  if (!sel) return;
  E.grupo.remove(sel.anel); sel.anel.material.dispose();
  if (sel.trilha) { E.grupo.remove(sel.trilha); sel.trilha.geometry.dispose(); sel.trilha.material.dispose(); }
  E.selecao = null;
  if (E.G) E.G.seguir = null;
}

// ------------------------------------------------------------------ planetas no céu da Terra

/** Planetas como pontos na direção real, ao fundo (raio 45, entre a Lua e as estrelas), com nome. */
function montarCeu() {
  const { THREE, G } = E;
  for (const corpo of CEU) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaPonto(THREE), color: COR_CEU[corpo], sizeAttenuation: false, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(corpo === 'Venus' || corpo === 'Jupiter' ? 0.016 : 0.012);
    E.grupo.add(sprite);
    const rotulo = el('span', { class: 'globo-rotulo globo-rotulo-planeta globo-rotulo-ceu', text: C.CORPOS[corpo].nome, hidden: true });
    G.dom.raiz.append(rotulo);
    E.ceu.push({ corpo, sprite, rotulo });
  }
  atualizarCeu();
  G.estrelas?.pronto.then((ceu) => {
    for (const e of ceu.nomeadas) {
      const rotulo = e.nome && e.mag <= MAG_ROTULO_ESTRELA ? el('span', { class: 'globo-rotulo globo-rotulo-planeta globo-rotulo-estrela', text: e.nome, hidden: true }) : null;
      if (rotulo) G.dom.raiz.append(rotulo);
      E.estrelas.push({ e, rotulo, mundo: new THREE.Vector3() });
    }
  }).catch(() => {});
}

/** Posição atual (na cena) de uma estrela com nome: o grupo das estrelas gira com o tempo sideral. */
const estrelaNaCena = (s) => s.mundo.copy(s.e.posicao).applyMatrix4(E.G.estrelas.grupo.matrixWorld);

function mostrarEstrela(e) {
  const c = cartaoEstrela(e, E.G.estrelas.constelacoes[e.sigla], E.G.estadoApp);
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, [{ texto: 'Ver detalhes', onclick: c.detalhes }]);
}

function atualizarCeu() {
  const t = Date.now();
  for (const c of E.ceu) { const p = C.pontoSob(c.corpo, t); latLonCena(p.lat, p.lon, 45, c.sprite.position); }
}

const latLonCena = (lat, lon, r, alvo) => alvo.set(r * Math.cos(lat * RAD) * Math.cos(lon * RAD), r * Math.sin(lat * RAD), -r * Math.cos(lat * RAD) * Math.sin(lon * RAD));

// ------------------------------------------------------------------ quadro a quadro

/** Chamado a cada quadro pelo globo: propaga os satélites (a cada 400 ms) e posiciona rótulos e seleção. */
export function atualizarEspaco(agora) {
  const { THREE, G } = E;
  if (!E.grupo || !E.aberto) return;
  if (E.modo === 'sistema') { atualizarSistema(agora); return; }
  const data = new Date();
  const v = new THREE.Vector3();
  if (agora - E.ultimo > 400) {
    E.ultimo = agora;
    for (const g of GRUPOS) {
      const p = E.pontos[g.id]; if (!p || !p.visible) continue;
      const pos = p.geometry.attributes.position.array;
      for (const s of E.sats[g.id]) {
        if (posicaoCena(s.rec, data, v)) v.toArray(pos, s.k * 3);
        else { pos[s.k * 3] = 0; pos[s.k * 3 + 1] = -500; pos[s.k * 3 + 2] = 0; } // sem posição: longe da cena
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.geometry.computeBoundingSphere();
    }
    for (const r of E.rotulos) if (r.s.trilha) { r.s.trilha.visible = E.ativos.has('estacoes'); if (agora - (r.s.trilhaEm || 0) > 5000) { atualizarTrilha(r.s.trilha, r.s.rec, data); r.s.trilhaEm = agora; } }
    const sel = E.selecao;
    if (sel && sel.trilha && agora - sel.ultimaTrilha > 3000) { atualizarTrilha(sel.trilha, sel.s.rec, data); sel.ultimaTrilha = agora; }
    if (G.quadro % 120 === 0) atualizarCeu();
  }
  const rect = G.dom.canvas.getBoundingClientRect();
  for (const r of E.rotulos) {
    if (!E.ativos.has('estacoes') || !posicaoCena(r.s.rec, data, v)) { r.el.hidden = true; continue; }
    const tela = naTela(v, rect);
    r.el.hidden = !tela;
    if (tela) r.el.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  for (const c of E.ceu) {
    const tela = naTela(c.sprite.position, rect);
    c.rotulo.hidden = !tela || tela.y < 110;
    if (tela) c.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  for (const s of E.estrelas) {
    if (!s.rotulo) continue;
    const tela = naTela(estrelaNaCena(s), rect);
    s.rotulo.hidden = !tela || tela.y < 110;
    if (tela) s.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  if (E.selecao) {
    if (posicaoCena(E.selecao.s.rec, data, v)) E.selecao.anel.position.copy(v);
    E.selecao.anel.material.opacity = 0.65 + 0.35 * Math.sin(agora / 250);
  }
}

/** Projeção na tela (px dentro do canvas) de um ponto da cena, ou null se estiver fora da tela ou atrás da Terra. */
function naTela(p, rect) {
  const cam = E.G.camera.position;
  if (escondidoPelaTerra(cam, p)) return null;
  const v = p.clone().project(E.G.camera);
  if (v.z > 1 || v.z < -1) return null;
  const x = (v.x + 1) / 2 * rect.width, y = (1 - v.y) / 2 * rect.height;
  return x < 0 || y < 0 || x > rect.width || y > rect.height ? null : { x, y };
}

/** O segmento da câmera até o ponto cruza a Terra (raio 1)? */
function escondidoPelaTerra(c, p) {
  if (E.modo === 'sistema') return false;
  const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
  const a = dx * dx + dy * dy + dz * dz, b = 2 * (c.x * dx + c.y * dy + c.z * dz), cc = c.x * c.x + c.y * c.y + c.z * c.z - 1;
  const disc = b * b - 4 * a * cc;
  if (disc <= 0) return false;
  const t1 = (-b - Math.sqrt(disc)) / (2 * a);
  return t1 > 0 && t1 < 1;
}

// ------------------------------------------------------------------ toque

/**
 * Toque na tela com o espaço aberto: escolhe o objeto mais próximo do dedo (satélite, planeta, sonda, Sol ou Lua do
 * sistema solar) e abre o cartão dele.
 * @returns {boolean} true se algo foi tocado (o globo não trata o toque como ponto da Terra)
 */
export function tocarEspaco(cx, cy) {
  const { G, THREE } = E;
  if (!E.aberto || !E.grupo) return false;
  const rect = G.dom.canvas.getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top;
  let melhor = null;
  const considerar = (tela, raio, acao, prioridade = 0) => {
    if (!tela) return;
    const d = Math.hypot(tela.x - x, tela.y - y) - prioridade;
    if (d <= Math.max(TOQUE_PX, raio) && (!melhor || d < melhor.d)) melhor = { d, acao };
  };
  if (E.modo === 'sistema') {
    for (const o of E.sistema.userData.tocaveis) if (o.objeto.visible) considerar(naTela(o.objeto.getWorldPosition(new THREE.Vector3()), rect), raioNaTela(o.objeto, rect) + 10, o.acao, o.prioridade || 0);
  } else {
    const v = new THREE.Vector3(), data = new Date();
    for (const g of GRUPOS) {
      if (!E.pontos[g.id]?.visible) continue;
      for (const s of E.sats[g.id]) if (posicaoCena(s.rec, data, v)) considerar(naTela(v, rect), 0, () => selecionarSatelite(s), s.destaque ? 6 : s.acopladoA ? -2 : 0);
    }
    for (const c of E.ceu) considerar(naTela(c.sprite.position, rect), 0, () => mostrarAstro(c.corpo), -4);
    for (const s of E.estrelas) considerar(naTela(estrelaNaCena(s), rect), 0, () => mostrarEstrela(s.e), -8);
  }
  if (!melhor) return false;
  melhor.acao();
  return true;
}

function raioNaTela(obj, rect) {
  const r = obj.geometry?.boundingSphere?.radius ?? (obj.geometry?.computeBoundingSphere(), obj.geometry?.boundingSphere?.radius) ?? 0;
  if (!r) return 0;
  const d = obj.getWorldPosition(new E.THREE.Vector3()).distanceTo(E.G.camera.position);
  return r * obj.scale.x / d / Math.tan(E.G.camera.fov * RAD / 2) * rect.height / 2;
}

function mostrarAstro(corpo, t) {
  const c = cartaoAstro(corpo, E.G.estadoApp, t);
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, [{ texto: 'Ver detalhes', onclick: c.detalhes }]);
}

// ------------------------------------------------------------------ sistema solar

// Distância na tela: potência 0,45 da distância em UA (Mercúrio 0,8; Terra 1,25; Júpiter 2,6; Netuno 5,6;
// Plutão 6,3; heliopausa 10,2; Voyager 1 ~12). A direção é sempre a real.
const DIST_ESCALA = 1.25, DIST_EXP = 0.45;
const distanciaTela = (ua) => DIST_ESCALA * Math.pow(Math.max(ua, 1e-6), DIST_EXP);
const raioTela = (raioTerras) => 0.024 + 0.034 * Math.log10(1 + raioTerras);
/** Eclíptica (x para o ponto vernal, y 90° à frente, z norte) para a cena (y para cima), com a distância comprimida. */
function paraCena(x, y, z, alvo) {
  const r = Math.hypot(x, y, z) || 1e-9, d = distanciaTela(r) / r;
  return alvo.set(x * d, z * d, -y * d);
}

const SIS = { desloc: 0, vel: 0, ultimo: 0, dom: null, rotulos: [] };
const VELOCIDADES = [{ v: 0, nome: 'Tempo real' }, { v: 1, nome: '1 dia/s' }, { v: 30, nome: '1 mês/s' }, { v: 365.25, nome: '1 ano/s' }];
const instanteSistema = () => Date.now() + SIS.desloc;

function alternarSistema(ligar) {
  const { G } = E;
  if (ligar && !E.sistema) return; // ainda montando (o botão só aparece pronto, mas por segurança)
  E.modo = ligar ? 'sistema' : 'terra';
  limparSelecao();
  E.dom.chips.querySelector('.globo-chip-sistema').setAttribute('aria-pressed', String(ligar));
  for (const b of E.dom.chips.querySelectorAll('[data-grupo]')) b.hidden = ligar;
  E.sistema.visible = ligar;
  for (const g of GRUPOS) if (E.pontos[g.id]) E.pontos[g.id].visible = !ligar && E.ativos.has(g.id);
  for (const r of E.rotulos) { r.el.hidden = true; if (r.s.trilha) r.s.trilha.visible = !ligar; }
  for (const c of E.ceu) { c.sprite.visible = !ligar; c.rotulo.hidden = true; }
  for (const s of E.estrelas) if (s.rotulo) s.rotulo.hidden = true;
  if (E.G.estrelas?.linhas) E.G.estrelas.linhas.visible = !ligar;
  for (const r of SIS.rotulos) r.el.hidden = true;
  SIS.dom.raiz.hidden = !ligar;
  if (!ligar) { SIS.desloc = 0; definirVelocidade(0); }
  G.modoSistema(ligar);
  E.dom.nota.textContent = ligar ? '' : E.notaSat;
}

function definirVelocidade(v) {
  SIS.vel = v; SIS.ultimo = performance.now();
  if (SIS.dom) for (const b of SIS.dom.velocidades.querySelectorAll('[data-vel]')) b.setAttribute('aria-pressed', String(Number(b.dataset.vel) === v));
}

function montarSistema() {
  const { THREE, G } = E;
  const grupo = new THREE.Group(); grupo.name = 'sistema'; grupo.visible = false;
  const tocaveis = [];
  grupo.userData.tocaveis = tocaveis;
  const rotulo = (texto, prioridade, classe = '') => {
    const r = el('span', { class: `globo-rotulo globo-rotulo-planeta ${classe}`, text: texto, hidden: true });
    G.dom.raiz.append(r);
    const item = { el: r, prioridade, largura: texto.length * 7 + 18 };
    SIS.rotulos.push(item);
    return item;
  };

  // Sol: fotosfera, halo e coroa (aditivos)
  const sol = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), new THREE.MeshBasicMaterial({ map: texturaSol(THREE) }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.62);
  const coroa = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), color: 0xffb060, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  coroa.scale.setScalar(1.4);
  grupo.add(sol, halo, coroa);
  sol.userData = { rotulo: rotulo('Sol', 100, 'sol'), deslocY: 22 };
  tocaveis.push({ objeto: sol, acao: () => mostrarAstro('Sun', instanteSistema()), prioridade: 4 });
  grupo.add(new THREE.PointLight(0xfff2dc, 6, 0, 0.35), new THREE.AmbientLight(0x404a60, 0.55));

  // planetas e Plutão
  const corpos = [...PLANETAS, { nome: 'Plutão', corpo: 'Pluto', cor: '#c8b8a6', raio: 0.187 }];
  for (const p of corpos) {
    const r = raioTela(p.raio);
    const mat = new THREE.MeshStandardMaterial({ map: p.corpo === 'Pluto' ? texturaPlaneta(THREE, 'Mercúrio') : texturaPlaneta(THREE, p.nome), roughness: 0.9, metalness: 0 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
    m.name = p.nome;
    m.rotation.z = ({ Urano: 98, Saturno: 27, Terra: 23.4, Marte: 25, Netuno: 28, Plutão: 120 }[p.nome] ?? 3) * RAD;
    m.userData = { planeta: p, rotulo: rotulo(p.nome, p.corpo === 'Earth' ? 90 : 80 - PLANETAS.indexOf(p), p.corpo === 'Pluto' ? 'anao' : ''), deslocY: -14 - r * 120 };
    grupo.add(m);
    tocaveis.push({ objeto: m, acao: () => (p.corpo === 'Earth' ? mostrarTerra() : mostrarAstro(p.corpo, instanteSistema())), prioridade: 3 });
    if (p.nome === 'Saturno') {
      const geoAnel = new THREE.RingGeometry(r * 1.35, r * 2.3, 96);
      const uv = geoAnel.attributes.uv, posA = geoAnel.attributes.position, v3 = new THREE.Vector3();
      for (let k = 0; k < uv.count; k++) { v3.fromBufferAttribute(posA, k); uv.setXY(k, (v3.length() - r * 1.35) / (r * 0.95), 0.5); }
      const anel = new THREE.Mesh(geoAnel, new THREE.MeshBasicMaterial({ map: texturaAnel(THREE), side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      anel.rotation.x = -Math.PI / 2; m.add(anel);
    }
    if (p.corpo === 'Earth') {
      new THREE.TextureLoader().load('vendor/texturas/terra-dia-1024.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
      SIS.terra = m;
      SIS.lua = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 24, 16), new THREE.MeshStandardMaterial({ map: texturaPlaneta(THREE, 'Lua'), roughness: 1 }));
      SIS.lua.userData = { rotulo: rotulo('Lua', 60), deslocY: -16 };
      grupo.add(SIS.lua);
      tocaveis.push({ objeto: SIS.lua, acao: () => mostrarAstro('Moon', instanteSistema()), prioridade: 2 });
    }
    // órbita: elementos keplerianos para os planetas; Plutão pela própria efeméride ao longo de 248 anos
    const pts = [], ms = Date.now(), v = new THREE.Vector3();
    if (p.el) for (let k = 0; k <= 240; k++) { const q = pontoOrbita(p, ms, k * 1.5 - 180); pts.push(paraCena(q.x, q.y, q.z, v).clone()); }
    else for (let k = 0; k <= 240; k++) { const q = C.helioEcliptica('Pluto', ms + k / 240 * 248 * 365.25 * 86400000); pts.push(paraCena(q.x, q.y, q.z, v).clone()); }
    const orb = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.cor, transparent: true, opacity: p.corpo === 'Pluto' ? 0.18 : 0.3, depthWrite: false }));
    grupo.add(orb);
  }

  // cinturão de asteroides (2,1 a 3,3 UA) e cinturão de Kuiper (30 a 50 UA), pontos fixos por semente
  const anel = (n, de, ate, espessura, cor, tamanho, opac, semente) => {
    const pos = new Float32Array(n * 3);
    let s = semente; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const ua = de + rnd() * (ate - de), a = rnd() * Math.PI * 2; paraCena(Math.cos(a) * ua, Math.sin(a) * ua, (rnd() - 0.5) * espessura * ua, v).toArray(pos, i * 3); }
    return new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: cor, size: tamanho, sizeAttenuation: false, transparent: true, opacity: opac, depthWrite: false }));
  };
  grupo.add(anel(1600, 2.1, 3.3, 0.06, 0x9a9a9a, 1.4, 0.45, 11), anel(1400, 30, 50, 0.12, 0x8aa0b8, 1.3, 0.3, 23));
  // heliopausa: limite da bolha do vento solar, cruzado pela Voyager 1 a 121 UA (2012) e pela Voyager 2 a 119 UA (2018)
  const hp = [], v = new THREE.Vector3();
  for (let k = 0; k <= 180; k++) { const a = k / 180 * Math.PI * 2; hp.push(paraCena(Math.cos(a) * 120, Math.sin(a) * 120, 0, v).clone()); }
  const helio = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hp), new THREE.LineDashedMaterial({ color: 0x6f8fb5, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.4 }));
  helio.computeLineDistances(); grupo.add(helio);
  const marcaHp = new THREE.Object3D(); paraCena(0, -120, 0, marcaHp.position); grupo.add(marcaHp);
  marcaHp.userData = { rotulo: rotulo('Heliopausa', 10, 'faixa'), deslocY: 0 };
  tocaveis.push({ objeto: marcaHp, acao: () => G.mostrarPainel('Heliopausa', 'Onde o vento do Sol perde força e começa o espaço interestelar.', 'Cerca de 120 UA do Sol (18 bilhões de km)', 'Voyager 1 (2012) e Voyager 2 (2018), NASA', []) });
  for (const [nome, ua, texto, numeros] of [['Cinturão de asteroides', 2.7, 'Milhões de rochas entre Marte e Júpiter.', 'De 2,1 a 3,3 UA do Sol'], ['Cinturão de Kuiper', 42, 'Região gelada além de Netuno, onde estão Plutão e Arrokoth.', 'De 30 a 50 UA do Sol']]) {
    const o = new THREE.Object3D(); paraCena(-ua * 0.71, ua * 0.71, 0, o.position); grupo.add(o);
    o.userData = { rotulo: rotulo(nome, 8, 'faixa'), deslocY: 0 };
    tocaveis.push({ objeto: o, acao: () => G.mostrarPainel(nome, texto, numeros, 'Desenho ilustrativo: os pontos não são objetos reais', []) });
  }

  // sondas: rota passada (traço firme), rota futura (traço fraco) e marcador. Para não embolar o sistema interno,
  // aparece só o último meio ano da rota de cada sonda; a rota inteira desde o lançamento aparece ao tocar nela.
  // As que estão saindo do sistema solar (Voyager, Pioneer, New Horizons) mostram sempre a rota inteira.
  SIS.sondas = [];
  const RECENTE_MS = 180 * 86400000;
  const SAINDO = new Set(['voyager1', 'voyager2', 'newhorizons', 'pioneer10', 'pioneer11']);
  for (const [chave, dados] of Object.entries(E.sondas?.sondas || {})) {
    const m = MISSOES[chave]; if (!m) continue;
    const cor = new THREE.Color(m.cor);
    const agora = Date.now();
    const pts = (lista) => { // entre dois pontos da efeméride, 6 subpassos pela Hermite (posição e velocidade): curva lisa no periélio
      const saida = [];
      for (let i = 0; i < lista.length; i++) {
        const p = lista[i];
        saida.push(paraCena(p[1], p[2], p[3], new THREE.Vector3()));
        if (i === lista.length - 1) break;
        for (let k = 1; k < 6; k++) { const q = interpolar([p, lista[i + 1]], p[0] + (lista[i + 1][0] - p[0]) * k / 6); saida.push(paraCena(q.x, q.y, q.z, new THREE.Vector3())); }
      }
      return saida;
    };
    const rota = rotaCompleta(dados);
    const passado = rota.filter((p) => p[0] <= agora), futuro = rota.slice(Math.max(0, passado.length - 1)); // emendadas no último ponto passado
    const linhaPassada = (lista, opacidade) => (lista.length > 1 ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts(lista)), new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opacidade, depthWrite: false })) : null);
    const recente = SAINDO.has(chave) ? passado : passado.filter((p) => p[0] >= agora - RECENTE_MS);
    const rastro = linhaPassada(recente, 0.42), rotaInteira = SAINDO.has(chave) ? null : linhaPassada(passado, 0.6);
    if (rastro) grupo.add(rastro);
    if (rotaInteira) { rotaInteira.visible = false; grupo.add(rotaInteira); }
    if (futuro.length > 1) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts(futuro)), new THREE.LineDashedMaterial({ color: cor, dashSize: 0.05, gapSize: 0.05, transparent: true, opacity: 0.35, depthWrite: false }));
      l.computeLineDistances(); grupo.add(l);
    }
    const marcador = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaPonto(THREE), color: cor, sizeAttenuation: false, transparent: true, depthWrite: false }));
    marcador.scale.setScalar(0.014);
    marcador.userData = { rotulo: rotulo(m.curto, chave === 'jwst' || chave.startsWith('voyager') ? 40 : 30, 'sonda'), deslocY: -14 };
    grupo.add(marcador);
    SIS.sondas.push({ chave, dados, marcador, rastro, rotaInteira });
    tocaveis.push({ objeto: marcador, acao: () => mostrarSonda(chave), prioridade: 1 });
  }

  montarControlesSistema();
  G.cena.add(grupo);
  return grupo;
}

function mostrarTerra() {
  const t = instanteSistema(), te = C.helioEcliptica('Earth', t), r = Math.hypot(te.x, te.y, te.z);
  E.G.mostrarPainel('Terra', 'É aqui que você está. A Terra dá uma volta no Sol por ano, a cerca de 107 mil km/h.', `${fmt.n(r * C.UA / 1e6, 1)} milhões de km do Sol (${fmt.n(r, 4)} UA) · a luz do Sol chega em ${fmt.n(r * C.UA / 299792.458 / 60, 1)} min`, `Astronomy Engine · ${new Date(t).toLocaleDateString('pt-BR')}`, []);
}

function mostrarSonda(chave) {
  const s = SIS.sondas.find((x) => x.chave === chave);
  const c = cartaoSonda(chave, s.dados, E.sondas?.gerado, E.G.estadoApp, instanteSistema());
  const destacar = (ligar) => { if (s.rotaInteira) { s.rotaInteira.visible = ligar; if (s.rastro) s.rastro.visible = !ligar; } };
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, c.detalhes ? [{ texto: 'Ver detalhes', onclick: c.detalhes }] : [], () => destacar(false));
  destacar(true);
}

function montarControlesSistema() {
  const velocidades = el('div', { class: 'globo-chips globo-velocidades', role: 'group', 'aria-label': 'Velocidade do tempo' });
  for (const v of VELOCIDADES) velocidades.append(el('button', { type: 'button', 'data-vel': String(v.v), text: v.nome, 'aria-pressed': String(v.v === 0), onclick: () => definirVelocidade(v.v) }));
  velocidades.append(el('button', { type: 'button', text: 'Hoje', 'aria-label': 'Voltar para hoje', onclick: () => { SIS.desloc = 0; definirVelocidade(0); } }));
  const data = el('p', { class: 'globo-data-sistema' });
  const nota = el('p', { class: 'globo-espaco-nota', text: E.sondas ? `Astronomy Engine · JPL Horizons · ${fmt.dataCurta(Date.parse(E.sondas.gerado) || Date.now(), fusoS(E.G.estadoApp))}` : 'Astronomy Engine · sondas indisponíveis agora' });
  const raiz = el('div', { class: 'globo-sistema-controles', hidden: true }, velocidades, data, nota);
  E.G.dom.raiz.append(raiz);
  SIS.dom = { raiz, velocidades, data };
}

function atualizarSistema(agora) {
  const { THREE, G } = E;
  if (SIS.vel) SIS.desloc += (agora - SIS.ultimo) / 1000 * SIS.vel * 86400000;
  SIS.ultimo = agora;
  const ms = instanteSistema();
  for (const m of E.sistema.children) {
    const p = m.userData.planeta; if (!p) continue;
    const pos = p.corpo === 'Pluto' ? C.helioEcliptica('Pluto', ms) : posicaoPlaneta(p, ms);
    paraCena(pos.x, pos.y, pos.z, m.position);
    m.rotation.y += p.nome === 'Júpiter' || p.nome === 'Saturno' ? 0.012 : 0.005;
  }
  if (SIS.lua && SIS.terra) {
    const l = posicaoLua(ms), b = l.lat * RAD, lo = l.lon * RAD, dist = SIS.terra.geometry.parameters.radius * 2.6;
    SIS.lua.position.set(Math.cos(b) * Math.cos(lo) * dist, Math.sin(b) * dist, -Math.cos(b) * Math.sin(lo) * dist).add(SIS.terra.position);
  }
  for (const s of SIS.sondas) {
    const e = estadoSonda(s.dados, ms);
    s.marcador.visible = !!e;
    if (e) paraCena(e.x, e.y, e.z, s.marcador.position);
  }
  posicionarRotulos();
  if (SIS.dom && G.quadro % 10 === 0) {
    const d = new Date(ms);
    SIS.dom.data.textContent = SIS.desloc === 0 && !SIS.vel ? `Hoje, ${d.toLocaleDateString('pt-BR')} · tempo real` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

/** Rótulos do sistema solar sem sobreposição: os de maior prioridade ficam, os que colidem somem. */
function posicionarRotulos() {
  const G = E.G, rect = G.dom.canvas.getBoundingClientRect();
  const v = new E.THREE.Vector3();
  const itens = [];
  for (const o of E.sistema.children) {
    const r = o.userData.rotulo; if (!r) continue;
    if (!o.visible) { r.el.hidden = true; continue; }
    v.copy(o.position).project(G.camera);
    if (v.z > 1) { r.el.hidden = true; continue; }
    itens.push({ r, x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height + (o.userData.deslocY || 0) });
  }
  itens.sort((a, b) => b.r.prioridade - a.r.prioridade);
  const ocupados = [];
  for (const it of itens) {
    const w = it.r.largura, h = 22, x0 = it.x - w / 2, y0 = it.y - h / 2;
    const fora = it.x < 0 || it.x > rect.width || it.y < 100 || it.y > rect.height - 130 || (it.x > rect.width - 70 && it.y < 260);
    const bate = ocupados.some((o) => x0 < o.x1 && x0 + w > o.x0 && y0 < o.y1 && y0 + h > o.y0);
    it.r.el.hidden = fora || bate;
    if (!it.r.el.hidden) { ocupados.push({ x0, y0, x1: x0 + w, y1: y0 + h }); it.r.el.style.transform = `translate(${(x0).toFixed(0)}px, ${(y0).toFixed(0)}px)`; }
  }
}

