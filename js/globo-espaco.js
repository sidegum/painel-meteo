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
import { el, fmt, prefs, mostrarInfo } from './ui.js';
import { buscarSatelites, buscarSondas, buscarCorpos } from './globo-dados.js';
import { PLANETAS, posicaoPlaneta } from './globo-astro.js';
import * as K from './globo-corpos.js';
import * as C from './ceu.js';
import { cartaoAstro, cartaoEstrela, cartaoObjeto, cartaoSatelite, cartaoSonda, cartaoLua, cartaoPequeno, fusoS } from './globo-ceu.js';
import { DIST_ESCALA, DIST_EXP, posicaoObjeto } from './globo-estrelas.js';
import { MISSOES, estadoSonda, interpolar, rotaCompleta } from './globo-sondas.js';
import { ANEL_SATURNO_KM, texturaPlaneta, texturaSol, texturaAnel, texturaPonto, texturaBrilho, texturaAnelSelecao, texturaReal, anelReal } from './globo-texturas.js';

const num = (v, casas = 0) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : null);

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
  selecao: null, ceu: [], estrelas: [], constelacoes: [], objetos: [], sistema: null, sondas: null, corpos: null,
};

// ------------------------------------------------------------------ filtros (o que aparece no espaço)

const MAGS = [[21, 'Todas (800 mil, inclusive as de telescópio)'], [6.5, 'As visíveis a olho nu'], [4.5, 'As de céu de cidade'], [2.5, 'Só as mais brilhantes'], [0, 'Nenhuma']];
const FILTROS_PADRAO = { magEstrelas: 21, viaLactea: true, objetos: true, nomesEstrelas: true, linhas: true, nomesConst: false, planetas: true, trilhas: true,
  orbitas: true, luas: true, pequenos: true, cinturoes: true, sondas: true, rotasSondas: true, rotulos: true, escala: true, tabela: true };
const F = { ...FILTROS_PADRAO, ...prefs.ler('globo:filtrosEspaco', {}) };
const MAG_ROTULO_ESTRELA = 1.6; // estrelas com nome que ganham rótulo (as ~25 mais brilhantes)

function gravarFiltros() { prefs.gravar('globo:filtrosEspaco', F); aplicarFiltros(); }

/** Aplica os filtros à cena: estrelas por brilho, linhas das constelações, planetas no céu, trilhas e o sistema solar. */
function aplicarFiltros() {
  const ceu = E.G?.estrelas;
  if (ceu?.pontos) { ceu.limitarMagnitude(F.magEstrelas); ceu.pontos.visible = F.magEstrelas > 0; }
  if (ceu?.pontosProfundos) ceu.pontosProfundos.visible = F.magEstrelas > 6.5;
  if (ceu?.via) ceu.via.visible = F.viaLactea;
  if (ceu?.pontosObjetos) ceu.pontosObjetos.visible = F.objetos;
  for (const r of E.objetos) r.rotulo.hidden = true;
  if (ceu?.linhas) ceu.linhas.visible = E.aberto && E.modo !== 'sistema' && F.linhas;
  for (const c of E.ceu) c.sprite.visible = E.modo !== 'sistema' && F.planetas;
  for (const r of E.rotulos) if (r.s.trilha) r.s.trilha.visible = E.modo !== 'sistema' && F.trilhas && E.ativos.has('estacoes');
  for (const r of [...E.estrelas, ...E.constelacoes]) if (r.rotulo) r.rotulo.hidden = true;
  if (E.sistema) aplicarFiltrosSistema();
}

/** Painel de filtros: o que vale para o modo aberto (céu em volta da Terra ou sistema solar). */
function abrirFiltros() {
  const caixa = (chave, texto) => {
    const i = el('input', { type: 'checkbox' }); i.checked = !!F[chave];
    i.addEventListener('change', () => { F[chave] = i.checked; gravarFiltros(); });
    return el('label', { class: 'filtro' }, i, el('span', { text: texto }));
  };
  const mags = el('div', { class: 'filtro-opcoes', role: 'radiogroup', 'aria-label': 'Estrelas' }, ...MAGS.map(([m, texto]) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(F.magEstrelas === m), text: texto });
    b.addEventListener('click', () => { F.magEstrelas = m; for (const x of b.parentElement.children) x.setAttribute('aria-checked', String(x === b)); gravarFiltros(); });
    return b;
  }));
  const sistema = E.modo === 'sistema';
  mostrarInfo('O que mostrar',
    el('div', { class: 'filtros' },
      el('h4', { text: 'Estrelas' }), mags,
      caixa('nomesEstrelas', 'Nomes das estrelas mais brilhantes'),
      caixa('viaLactea', 'Via Láctea'),
      caixa('objetos', 'Galáxias, nebulosas e aglomerados'),
      sistema ? null : caixa('linhas', 'Linhas das constelações'),
      sistema ? null : caixa('nomesConst', 'Nomes das constelações'),
      el('h4', { text: sistema ? 'Sistema solar' : 'Em volta da Terra' }),
      ...(sistema
        ? [caixa('orbitas', 'Órbitas'), caixa('escala', 'Escala de distâncias (UA e tempo da luz)'), caixa('luas', 'Luas'), caixa('pequenos', 'Planetas anões, asteroides e cometas'), caixa('cinturoes', 'Cinturões de asteroides e de Kuiper'), caixa('sondas', 'Sondas e telescópios'), caixa('rotasSondas', 'Rotas das sondas'), caixa('rotulos', 'Nomes')]
        : [caixa('planetas', 'Planetas no céu'), caixa('trilhas', 'Órbita da ISS e da Tiangong')])));
}

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
    const [sats, sondas, corpos] = await Promise.allSettled([buscarSatelites(G.manifest), buscarSondas(G.manifest), buscarCorpos(G.manifest)]);
    if (sats.status === 'fulfilled') montarSatelites(sats.value);
    else E.notaSat = `Satélites indisponíveis agora (${sats.reason?.message || 'falha'}).`;
    E.sondas = sondas.status === 'fulfilled' ? sondas.value : null;
    E.corpos = corpos.status === 'fulfilled' ? corpos.value : null;
    E.sistema = await montarSistema();
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
  G.estrelas?.pronto.then(() => { if (E.aberto) aplicarFiltros(); }).catch(() => {});
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
  for (const r of [...E.estrelas, ...E.constelacoes]) r.rotulo.hidden = true;
  if (E.G?.estrelas?.linhas) E.G.estrelas.linhas.visible = false;
  limparSelecao();
}

export const sistemaAtivo = () => E.modo === 'sistema';

function montarInterface() {
  const G = E.G;
  const chips = el('div', { class: 'globo-chips', role: 'group', 'aria-label': 'Satélites' });
  chips.append(el('button', { type: 'button', class: 'globo-chip-sistema', text: 'Sistema solar', 'aria-pressed': 'false', onclick: () => alternarSistema(E.modo !== 'sistema') }));
  chips.append(el('button', { type: 'button', class: 'globo-chip-filtros', text: 'Filtros', 'aria-haspopup': 'dialog', onclick: abrirFiltros }));
  for (const g of GRUPOS) {
    chips.append(el('button', { type: 'button', 'aria-pressed': String(E.ativos.has(g.id)), 'data-grupo': g.id, text: g.nome, onclick: (ev) => {
      const b = ev.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on)); if (on) E.ativos.add(g.id); else E.ativos.delete(g.id);
      if (E.pontos[g.id]) E.pontos[g.id].visible = on;
      if (!on && E.selecao?.s?.grupo === g.id) limparSelecao();
      E.ultimo = 0;
    } }));
  }
  const nota = el('p', { class: 'globo-espaco-nota', text: '' });
  const raiz = el('div', { class: 'globo-espaco globo-recolhivel', hidden: true }, chips, nota);
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
    for (const e of ceu.estrelas) {
      if (!e.nome || (e.mag > MAG_ROTULO_ESTRELA && !(e.distPc < 30))) continue; // as mais brilhantes e as vizinhas do Sol
      const rotulo = el('span', { class: 'globo-rotulo globo-rotulo-planeta globo-rotulo-estrela', text: e.nome, hidden: true });
      G.dom.raiz.append(rotulo);
      E.estrelas.push({ e, rotulo, mundo: new THREE.Vector3() });
    }
    ceu.prontoProfundo?.then(() => {
      for (const ob of ceu.objetos) {
        if (!ob.nome) continue;
        const rotulo = el('span', { class: 'globo-rotulo globo-rotulo-planeta globo-rotulo-objeto', text: ob.nome, hidden: true });
        G.dom.raiz.append(rotulo);
        E.objetos.push({ ob, rotulo, mundo: new THREE.Vector3(), largura: ob.nome.length * 6.5 + 16 });
      }
      aplicarFiltros();
    }).catch(() => {});
    for (const [sigla, c] of Object.entries(ceu.constelacoes)) {
      const rotulo = el('span', { class: 'globo-rotulo globo-rotulo-planeta globo-rotulo-constelacao', text: C.CONSTELACOES[sigla] || c.nome, hidden: true });
      G.dom.raiz.append(rotulo);
      E.constelacoes.push({ e: { posicao: c.centro }, rotulo, mundo: new THREE.Vector3() });
    }
    aplicarFiltros();
  }).catch(() => {});
}

/** Posição atual (na cena) de uma estrela com nome: o grupo das estrelas gira com o tempo sideral. */
const estrelaNaCena = (s) => E.G.estrelas.posicaoVista(s.e, s.mundo).applyMatrix4(E.G.estrelas.grupo.matrixWorld);
const objetoNaCena = (s) => posicaoObjeto(E.G.estrelas, s.ob, s.mundo).applyMatrix4(E.G.estrelas.grupo.matrixWorld);
/** Brilho de uma estrela com ficha vista da câmera (no céu da Terra, o do catálogo). */
const magVista = (e) => E.G.estrelas.magnitudeVista(e.posicao.clone().normalize(), e.distPc, e.magAbs, e.mag);

/**
 * Toque nas estrelas visíveis (as com ficha completa e as fracas do catálogo profundo) e nos objetos de céu profundo:
 * o mais próximo do dedo, com preferência pelos mais brilhantes. No modo 3D o brilho é o visto da câmera.
 */
function tocarEstrela(considerar, rect) {
  const ceu = E.G.estrelas;
  if (!ceu?.pontos?.visible) return;
  const m = ceu.grupo.matrixWorld, v = new E.THREE.Vector3(), dir = new E.THREE.Vector3();
  const prioridade = (mag) => -12 + Math.max(0, 3 - mag) * 2;
  for (const e of ceu.estrelas) {
    const mag = magVista(e);
    if (mag > ceu.limite) continue;
    const w = ceu.posicaoVista(e, new E.THREE.Vector3()).applyMatrix4(m);
    considerar(naTela(w, rect), 0, () => mostrarEstrela(e, w), prioridade(mag), () => ({ posicao: w, raio: 0.002, ponto: true }));
  }
  const P = ceu.profundas;
  if (P && ceu.pontosProfundos?.visible) {
    const limite = Math.min(ceu.limite, 9.5); // as muito fracas quase não aparecem: não roubam o toque
    for (let i = 0; i < P.n; i++) {
      const mag = ceu.modo3d && P.dpc[i] > 0 ? ceu.magnitudeVista(dir.set(P.posicao[i * 3], P.posicao[i * 3 + 1], P.posicao[i * 3 + 2]).normalize(), P.dpc[i], P.mabs[i], P.mag[i]) : P.mag[i];
      if (mag > limite) continue;
      ceu.posicaoProfunda(i, v).applyMatrix4(m);
      const tela = naTela(v, rect);
      if (tela) { const w = v.clone(); considerar(tela, 0, () => mostrarEstrela(ceu.estrelaProfunda(i), w), prioridade(mag) - 4, () => ({ posicao: w, raio: 0.002, ponto: true })); }
    }
  }
  if (ceu.pontosObjetos?.visible) for (const ob of ceu.objetos) considerar(naTela(posicaoObjeto(ceu, ob, v).applyMatrix4(m), rect), 0, () => mostrarObjeto(ob), ob.nome ? -2 : -8);
}

function mostrarObjeto(ob) {
  const c = cartaoObjeto(ob, E.G.estadoApp);
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, [{ texto: 'Ver detalhes', onclick: c.detalhes }]);
}

function mostrarEstrela(e, mundo) {
  const c = cartaoEstrela(e, E.G.estrelas.constelacoes[e.sigla], E.G.estadoApp);
  const ir = E.modo === 'sistema' && mundo && e.distPc > 0 ? [{ texto: 'Ir até', onclick: () => { irAte(mundo, 0.002, true); E.G.fecharPainel?.(); } }] : [];
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, [...ir, { texto: 'Ver detalhes', onclick: c.detalhes }]);
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
  const topo = E.dom.raiz.getBoundingClientRect().bottom - rect.top + 8; // rótulos não passam por cima dos botões do espaço
  for (const r of E.rotulos) {
    if (!E.ativos.has('estacoes') || !posicaoCena(r.s.rec, data, v)) { r.el.hidden = true; continue; }
    const tela = naTela(v, rect);
    r.el.hidden = !tela || tela.y < topo;
    if (tela) r.el.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  for (const c of E.ceu) {
    const tela = F.planetas ? naTela(c.sprite.position, rect) : null;
    c.rotulo.hidden = !tela || tela.y < topo;
    if (tela) c.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  const nomes = F.nomesEstrelas && F.magEstrelas > 0;
  for (const s of E.estrelas) {
    const tela = nomes && s.e.mag <= Math.min(F.magEstrelas, MAG_ROTULO_ESTRELA) ? naTela(estrelaNaCena(s), rect) : null;
    s.rotulo.hidden = !tela || tela.y < topo;
    if (tela) s.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  for (const s of E.objetos) {
    const tela = F.objetos && F.nomesEstrelas ? naTela(objetoNaCena(s), rect) : null;
    s.rotulo.hidden = !tela || tela.y < topo;
    if (tela) s.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  for (const s of E.constelacoes) {
    const tela = F.nomesConst ? naTela(estrelaNaCena(s), rect) : null;
    s.rotulo.hidden = !tela || tela.y < topo;
    if (tela) s.rotulo.style.transform = `translate(${tela.x.toFixed(0)}px, ${tela.y.toFixed(0)}px)`;
  }
  if (E.selecao) {
    if (posicaoCena(E.selecao.s.rec, data, v)) E.selecao.anel.position.copy(v);
    E.selecao.anel.material.opacity = 0.65 + 0.35 * Math.sin(agora / 250);
  }
}

/**
 * Projeção (coordenadas normalizadas, x e y de −1 a 1) de um ponto à frente da câmera, ou null se estiver atrás dela.
 * Não usa o plano distante: as estrelas ficam além dele e continuam na tela.
 */
function projetar(p, alvo) {
  const cam = E.G.camera;
  alvo.copy(p).applyMatrix4(cam.matrixWorldInverse);
  if (alvo.z >= -cam.near) return null;
  return alvo.applyMatrix4(cam.projectionMatrix);
}

/** Projeção na tela (px dentro do canvas) de um ponto da cena, ou null se estiver fora da tela ou atrás da Terra. */
function naTela(p, rect) {
  const cam = E.G.camera.position;
  if (escondidoPelaTerra(cam, p)) return null;
  const v = projetar(p, SIS.vp || (SIS.vp = new E.THREE.Vector3()));
  if (!v) return null;
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
/**
 * @param {'tocar'|'focar'|'alvo'} modo tocar abre o cartão; focar leva a câmera até o objeto; alvo só devolve
 *   { posicao (mundo), raio } do objeto sob o dedo (navegação livre), ou null
 */
export function tocarEspaco(cx, cy, modo = 'tocar') {
  const focar = modo === 'focar';
  const { G, THREE } = E;
  if (!E.aberto || !E.grupo) return false;
  const rect = G.dom.canvas.getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top;
  let melhor = null;
  const considerar = (tela, raio, acao, prioridade = 0, alvo = null) => {
    if (!tela) return;
    const d = Math.hypot(tela.x - x, tela.y - y) - prioridade;
    if (d <= Math.max(TOQUE_PX, raio) && (!melhor || d < melhor.d)) melhor = { d, acao, alvo };
  };
  if (E.modo === 'sistema') {
    tocarEstrela(considerar, rect);
    for (const o of E.sistema.userData.tocaveis) {
      if (!visivelNoSistema(o.objeto) || (!E.sistema.visible && o.objeto !== SIS.sol)) continue;
      const w = o.objeto.getWorldPosition(new THREE.Vector3());
      considerar(naTela(w, rect), raioNaTela(o.objeto, rect) + 10, () => { SIS.tocado = o.objeto; if (focar) focarObjeto(o.objeto); else o.acao(); }, o.prioridade || 0, () => ({ posicao: w, raio: raioCena(o.objeto) }));
    }
  } else {
    const v = new THREE.Vector3(), data = new Date();
    for (const g of GRUPOS) {
      if (!E.pontos[g.id]?.visible) continue;
      for (const s of E.sats[g.id]) if (posicaoCena(s.rec, data, v)) considerar(naTela(v, rect), 0, () => selecionarSatelite(s), s.destaque ? 6 : s.acopladoA ? -2 : 0);
    }
    if (F.planetas) for (const c of E.ceu) considerar(naTela(c.sprite.position, rect), 0, () => mostrarAstro(c.corpo), -4);
    tocarEstrela(considerar, rect);
  }
  if (modo === 'alvo') return melhor?.alvo?.() ?? null;
  if (!melhor) return false;
  if (focar && melhor.alvo && !melhor.focaObjeto) { const a = melhor.alvo(); if (a.ponto) { focarPonto(a.posicao); return true; } }
  melhor.acao();
  return true;
}

/** Fontes do espaço no formato "Fonte · Horário", para a ajuda (fora da cena). */
export function notasFontes() {
  const out = [];
  if (E.notaSat) out.push(E.notaSat);
  const off = fusoS(E.G?.estadoApp);
  if (E.sondas?.gerado) out.push(`JPL Horizons · ${fmt.dataCurta(Date.parse(E.sondas.gerado), off)}`);
  if (E.corpos?.gerado) out.push(`JPL SBDB · ${fmt.dataCurta(Date.parse(E.corpos.gerado), off)}`);
  out.push('Astronomy Engine · agora');
  return out;
}

/** Objeto sob o dedo para a navegação livre (posição no mundo e raio), ou null. */
export function alvoNoToque(cx, cy) { return E.modo === 'sistema' ? tocarEspaco(cx, cy, 'alvo') : null; }

/** Distância da posição p (mundo) à superfície do corpo mais próximo: Sol, planetas, luas, corpos menores, sondas e estrelas. */
export function distanciaProxima(p) {
  if (!E.sistema) return Infinity;
  const v = SIS.vd || (SIS.vd = new E.THREE.Vector3());
  let min = Infinity;
  for (const o of E.sistema.userData.tocaveis) {
    if (!o.objeto.visible) continue;
    min = Math.min(min, o.objeto.getWorldPosition(v).distanceTo(p) - raioCena(o.objeto));
  }
  // estrelas com distância: posições fixas no modo 3D, calculadas uma vez (as brilhantes e as vizinhas fracas)
  const ceu = E.G.estrelas;
  if (ceu?.modo3d && ceu.pontos) {
    if (!SIS.posEstrelas || SIS.posEstrelasProfundas !== !!ceu.profundas) {
      const lista = [], m = ceu.grupo.matrixWorld;
      for (const e of ceu.estrelas) if (e.distPc > 0) lista.push(ceu.posicaoVista(e, new E.THREE.Vector3()).applyMatrix4(m));
      if (ceu.profundas) for (let i = 0; i < ceu.profundas.n; i++) if (ceu.profundas.dpc[i] > 0 && ceu.profundas.dpc[i] < 60) lista.push(ceu.posicaoProfunda(i, new E.THREE.Vector3()).applyMatrix4(m));
      SIS.posEstrelas = lista; SIS.posEstrelasProfundas = !!ceu.profundas;
    }
    for (const w of SIS.posEstrelas) { const d = w.distanceToSquared(p); if (d < min * min) min = Math.sqrt(d); }
  }
  return min;
}

/** Leva a câmera (modo orbital) até um ponto fixo do espaço, como uma estrela. */
function focarPonto(w) {
  E.G.focarSistema(() => w, 0.08, 0.002);
  SIS.focado = w;
  if (SIS.dom) SIS.dom.geral.hidden = false;
}

/** Dois toques no sistema solar: vai até o corpo sob o dedo e passa a segui-lo. */
export function focarNoToque(cx, cy) { if (E.modo === 'sistema') tocarEspaco(cx, cy, 'focar'); }

/** Raio de um corpo na cena (esfera) ou um raio pequeno para pontos (sondas) e marcas. */
function raioCena(obj) {
  const r = obj.geometry?.parameters?.radius;
  return r ? r * obj.scale.x : 0.004;
}

/** Leva a câmera até um objeto do sistema solar e o acompanha; mostra o botão de voltar à visão geral. */
function focarObjeto(obj) {
  const r = raioCena(obj), v = new E.THREE.Vector3();
  const comLuas = SIS.planetas?.some((P) => P.malha === obj && P.listaLuas.length); // enquadra o sistema de luas
  E.G.focarSistema(() => obj.getWorldPosition(v), Math.max(r * (comLuas ? 16 : 7), 0.06), Math.max(r * 1.4, 0.004));
  SIS.focado = obj;
  if (SIS.dom) SIS.dom.geral.hidden = false;
}

/** Liga ou desliga a navegação livre: a câmera solta no espaço, até as estrelas mais distantes do catálogo. */
function alternarLivre(ligar) {
  E.G.navegacaoLivre(ligar);
  const on = !!E.G.livre;
  SIS.focado = null;
  if (!SIS.dom) return;
  SIS.dom.livre.setAttribute('aria-pressed', String(on));
  SIS.dom.geral.hidden = !on;
  clearTimeout(SIS.dicaTimer);
  SIS.dom.dica.hidden = !on;
  if (on) SIS.dicaTimer = setTimeout(() => { SIS.dom.dica.hidden = true; }, 6000);
}

/** "Ir até": na navegação livre, voa até o ponto; no modo orbital, passa a girar em volta dele. */
function irAte(w, raio, ponto = false) {
  if (E.G.livre) E.G.voarLivreAte(w, raio);
  else if (ponto) focarPonto(w);
}

function visaoGeral() {
  if (E.G.livre) alternarLivre(false);
  E.G.focarSistema(null, E.G.distanciaVisaoGeral(), 0.3);
  SIS.focado = null;
  if (SIS.dom) SIS.dom.geral.hidden = true;
}

/** Botões dos cartões do sistema solar: "Ir até" (se o corpo ainda não está em foco) mais os do próprio cartão. */
function acoesSistema(acoes = []) {
  const obj = SIS.tocado;
  if (E.modo !== 'sistema' || !obj || obj === SIS.focado) return acoes;
  return [{ texto: 'Ir até', onclick: () => { if (E.G.livre) irAte(obj.getWorldPosition(new E.THREE.Vector3()), raioCena(obj)); else focarObjeto(obj); E.G.fecharPainel?.(); } }, ...acoes];
}

function raioNaTela(obj, rect) {
  const r = obj.geometry?.boundingSphere?.radius ?? (obj.geometry?.computeBoundingSphere(), obj.geometry?.boundingSphere?.radius) ?? 0;
  if (!r) return 0;
  const d = obj.getWorldPosition(new E.THREE.Vector3()).distanceTo(E.G.camera.position);
  return r * obj.scale.x / d / Math.tan(E.G.camera.fov * RAD / 2) * rect.height / 2;
}

function mostrarAstro(corpo, t) {
  const c = cartaoAstro(corpo, E.G.estadoApp, t);
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, acoesSistema([{ texto: 'Ver detalhes', onclick: c.detalhes }]));
}

// ------------------------------------------------------------------ sistema solar

// Distância na tela: potência 0,45 da distância em UA (Mercúrio 0,8; Terra 1,25; Júpiter 2,6; Netuno 5,6;
// Plutão 6,3; heliopausa 10,2; Voyager 1 ~12). A direção é sempre a real.
const distanciaTela = (ua) => DIST_ESCALA * Math.pow(Math.max(ua, 1e-6), DIST_EXP);
const raioTela = (raioTerras) => 0.024 + 0.034 * Math.log10(1 + raioTerras);
/** Eclíptica (x para o ponto vernal, y 90° à frente, z norte) para a cena (y para cima), com a distância comprimida. */
function paraCena(x, y, z, alvo) {
  const r = Math.hypot(x, y, z) || 1e-9, d = distanciaTela(r) / r;
  return alvo.set(x * d, z * d, -y * d);
}

/** Distância da câmera ao Sol (cena; uns 5.000 UA) a partir da qual o sistema solar vira um ponto. */
const LONGE_DO_SOL = 60;
const SIS = { desloc: 0, vel: 0, ultimo: 0, dom: null, rotulos: [] };
const VELOCIDADES = [{ v: 0, nome: 'Tempo real' }, { v: 1, nome: '1 dia por segundo' }, { v: 30, nome: '1 mês por segundo' }, { v: 365.25, nome: '1 ano por segundo' }];
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
  for (const c of E.ceu) c.rotulo.hidden = true;
  for (const r of SIS.rotulos) r.el.hidden = true;
  for (const r of [...E.estrelas, ...E.objetos, ...E.constelacoes]) r.rotulo.hidden = true;
  SIS.dom.raiz.hidden = !ligar;
  mostrarTabela();
  if (!ligar) { SIS.desloc = 0; definirVelocidade(0); }
  SIS.focado = null; if (SIS.dom) { SIS.dom.geral.hidden = true; SIS.dom.livre.setAttribute('aria-pressed', 'false'); SIS.dom.dica.hidden = true; }
  G.modoSistema(ligar);
  aplicarFiltros();
  E.dom.nota.textContent = ligar ? '' : E.notaSat;
}

function definirVelocidade(v) {
  SIS.vel = v; SIS.ultimo = performance.now();
  if (SIS.dom) { SIS.dom.tempo.textContent = (VELOCIDADES.find((x) => x.v === v) || VELOCIDADES[0]).nome; SIS.dom.tempo.setAttribute('aria-pressed', String(v !== 0)); }
}

// Luas em volta do planeta: direção real e distância em escala logarítmica, r·(1 + ln(d/R)), com r o raio do planeta
// na tela e R o raio real. A superfície fica em r, a Lua a 5,1 r, Fobos a 2,0 r, Calisto a 4,3 r, Jápeto a 5,1 r.
const escalaLua = (rTela, raioKm, p, alvo) => {
  const d = Math.hypot(p.x, p.y, p.z) || 1, f = rTela * (1 + Math.log(Math.max(d / raioKm, 1))) / d;
  return alvo.set(p.x * f, p.z * f, -p.y * f);
};
const COR_LUA = { io: '#e8d27a', europa: '#e2d8c6', ganimedes: '#b2a898', calisto: '#7d7166', tita: '#e0ad55', encelado: '#ffffff', japeto: '#b9ada0', tritao: '#e4d6cf', caronte: '#b8aea6' };
/** Corpo do Astronomy Engine -> mapa real em vendor/texturas/planetas (Plutão fica com a textura desenhada). */
const MAPA_REAL = { Mercury: 'mercurio', Venus: 'venus', Mars: 'marte', Jupiter: 'jupiter', Saturn: 'saturno', Uranus: 'urano', Neptune: 'netuno' };
const COR_PEQUENO = { anao: '#f0d2a8', asteroide: '#c8bfb0', cometa: '#9fe3ff' };
const PRIORIDADE_PEQUENO = { anao: 26, cometa: 22, asteroide: 18 };
// Populações reais dos cinturões (elementos do SBDB): cor e nome no cartão
const POPULACOES = {
  principal: { cor: [0.66, 0.64, 0.6], nome: 'Cinturão de asteroides', amostra: 'os asteroides numerados de menor número do cinturão principal' },
  troianos: { cor: [0.55, 0.78, 0.62], nome: 'Troianos de Júpiter', amostra: 'troianos de Júpiter numerados' },
  kuiper: { cor: [0.55, 0.65, 0.85], nome: 'Cinturão de Kuiper', amostra: 'objetos transnetunianos numerados' },
};

// Kepler na GPU: cada ponto leva a órbita (P·a, Q·b, e, M na época de referência, n) e o shader resolve a equação de
// Kepler a cada quadro. Milhares de asteroides andam com o tempo sem custo de CPU.
const VERTEX_POP = /* glsl */`
  attribute vec3 pa;
  attribute vec3 qb;
  attribute vec3 emn;
  uniform float dias;
  uniform float tamanho;
  void main() {
    float e = emn.x;
    float M = mod(emn.y + emn.z * dias, 6.28318531);
    float E = M + e * sin(M);
    for (int k = 0; k < 6; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    vec3 ecl = pa * (cos(E) - e) + qb * sin(E);
    float r = max(length(ecl), 1e-6);
    vec3 p = vec3(ecl.x, ecl.z, -ecl.y) * (${DIST_ESCALA.toFixed(4)} * pow(r, ${DIST_EXP.toFixed(4)}) / r);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = tamanho;
  }`;
const FRAGMENT_POP = /* glsl */`
  uniform vec3 cor;
  uniform float opacidade;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(cor, opacidade * (1.0 - r * r));
  }`;
const JD_UNIX = 2440587.5;

/** Cede a vez ao navegador entre as partes da montagem (nenhuma tarefa longa trava a tela). */
const pausa = () => new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 250 }) : setTimeout(ok, 16)));

async function montarSistema() {
  const { THREE, G } = E;
  const grupo = new THREE.Group(); grupo.name = 'sistema'; grupo.visible = false;
  const tocaveis = [];
  grupo.userData.tocaveis = tocaveis;
  SIS.comRotulo = []; SIS.planetas = []; SIS.pequenos = []; SIS.populacoes = [];
  const rotulo = (obj, texto, prioridade, classe = '', deslocY = null) => {
    const r = el('span', { class: `globo-rotulo globo-rotulo-planeta ${classe}`, text: texto, hidden: true });
    G.dom.raiz.append(r);
    const item = { el: r, prioridade, largura: texto.length * 7 + 18 };
    SIS.rotulos.push(item);
    obj.userData.rotulo = item; obj.userData.deslocY = deslocY;
    SIS.comRotulo.push(obj);
    return item;
  };
  const linha = (pontos, cor, opacidade, tipo) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pontos), new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opacidade, depthWrite: false }));
    l.userData.tipo = tipo;
    return l;
  };
  const corpos = E.corpos;
  const agora = Date.now();

  // Sol: fotosfera, halo e coroa (aditivos)
  const sol = new THREE.Mesh(new THREE.SphereGeometry(0.11, 64, 48), new THREE.MeshBasicMaterial({ map: texturaSol(THREE) }));
  texturaReal(THREE, 'sol', (t) => { sol.material.map = t; sol.material.needsUpdate = true; });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.62);
  const coroa = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(THREE), color: 0xffb060, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  coroa.scale.setScalar(1.4);
  grupo.add(sol, halo, coroa);
  rotulo(sol, 'Sol', 100, 'sol', 22);
  tocaveis.push({ objeto: sol, acao: () => mostrarAstro('Sun', instanteSistema()), prioridade: 4 });
  SIS.sol = sol;
  grupo.add(new THREE.PointLight(0xfff2dc, 6, 0, 0.35), new THREE.AmbientLight(0x404a60, 0.55));

  // planetas e Plutão: posição pelo Astronomy Engine (VSOP87), eixo e rotação pela IAU, luas em volta
  const luasPorPlaneta = {};
  for (const chave of K.luasDisponiveis(corpos)) (luasPorPlaneta[K.LUAS[chave].pai] ||= []).push(chave);
  for (const p of [...PLANETAS, { nome: 'Plutão', corpo: 'Pluto', cor: '#c8b8a6', raio: 0.187 }]) {
    const r = raioTela(p.raio);
    const sistemaPlaneta = new THREE.Group(); sistemaPlaneta.name = p.nome;
    const mat = new THREE.MeshStandardMaterial({ map: texturaPlaneta(THREE, p.corpo === 'Pluto' ? 'Mercúrio' : p.nome), roughness: 0.9, metalness: 0 });
    if (p.corpo === 'Pluto') mat.color.set('#e6d2bc');
    const real = MAPA_REAL[p.corpo];
    if (real) texturaReal(THREE, real, (t) => { mat.map = t; mat.needsUpdate = true; });
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), mat);
    sistemaPlaneta.add(m);
    rotulo(m, p.nome, p.corpo === 'Earth' ? 90 : 80 - PLANETAS.indexOf(p), p.corpo === 'Pluto' ? 'anao' : '');
    tocaveis.push({ objeto: m, acao: () => (p.corpo === 'Earth' ? mostrarTerra() : mostrarAstro(p.corpo, instanteSistema())), prioridade: 3 });
    if (p.nome === 'Saturno') { // anéis no plano do equador, nos raios reais (mesma escala logarítmica das luas)
      const R = K.PLANETA_FISICO.Saturn.raioKm, [k0, k1] = ANEL_SATURNO_KM;
      const de = r * (1 + Math.log(k0 / R)), ate = r * (1 + Math.log(k1 / R));
      const geoAnel = new THREE.RingGeometry(de, ate, 128, 4);
      const uv = geoAnel.attributes.uv, posA = geoAnel.attributes.position, v3 = new THREE.Vector3();
      for (let k = 0; k < uv.count; k++) { v3.fromBufferAttribute(posA, k); uv.setXY(k, (R * Math.exp(v3.length() / r - 1) - k0) / (k1 - k0), 0.5); }
      const anel = new THREE.Mesh(geoAnel, new THREE.MeshBasicMaterial({ map: texturaAnel(THREE), side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      anelReal(THREE, (t) => { anel.material.map = t; anel.material.needsUpdate = true; });
      anel.rotation.x = -Math.PI / 2; m.add(anel);
    }
    if (p.corpo === 'Earth') {
      new THREE.TextureLoader().load('vendor/texturas/terra-dia-1024.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
      SIS.terra = m;
    }
    // luas
    const luas = new THREE.Group(); luas.name = `luas de ${p.nome}`;
    const listaLuas = [];
    const raioKm = K.PLANETA_FISICO[p.corpo].raioKm;
    for (const chave of luasPorPlaneta[p.corpo] || []) {
      const L = K.LUAS[chave], el0 = corpos?.luas?.[chave];
      const rl = Math.max(r * Math.sqrt(L.raioKm / raioKm) * 0.6, 0.0012);
      const lm = new THREE.Mesh(new THREE.SphereGeometry(rl, chave === 'lua' ? 64 : 24, chave === 'lua' ? 48 : 16), new THREE.MeshStandardMaterial({ map: texturaPlaneta(THREE, 'Lua'), color: COR_LUA[chave] || '#d4cec6', roughness: 1 }));
      if (chave === 'lua') texturaReal(THREE, 'lua', (t) => { lm.material.map = t; lm.material.color.set('#ffffff'); lm.material.needsUpdate = true; });
      lm.name = L.nome;
      luas.add(lm);
      rotulo(lm, L.nome, chave === 'lua' ? 60 : 50, 'lua');
      tocaveis.push({ objeto: lm, acao: () => (chave === 'lua' ? mostrarAstro('Moon', instanteSistema()) : mostrarLua(chave)), prioridade: 2 });
      // uma volta da órbita, amostrada em volta de agora
      const periodo = K.PERIODO_LUA_DIAS[chave] ?? (el0?.n ? 360 / el0.n : 0);
      if (periodo) {
        const pts = [];
        for (let k = 0; k <= 96; k++) { const q = K.posicaoLua(chave, agora + (k / 96 - 0.5) * periodo * 86400000, el0); if (q) pts.push(escalaLua(r, raioKm, q, new THREE.Vector3())); }
        luas.add(linha(pts, 0xc8d2e0, 0.2, 'orbitaLua'));
      }
      listaLuas.push({ chave, malha: lm, el: el0 });
    }
    sistemaPlaneta.add(luas);
    grupo.add(sistemaPlaneta);
    SIS.planetas.push({ p, grupo: sistemaPlaneta, malha: m, r, raioKm, luas, listaLuas });
    // órbita: uma volta completa pela própria efeméride, centrada em agora
    const dias = K.PERIODO_DIAS[p.corpo], pts = [], v = new THREE.Vector3(), n = p.corpo === 'Mercury' ? 160 : 220;
    for (let k = 0; k <= n; k++) { const q = C.helioEcliptica(p.corpo, agora + (k / n - 0.5) * dias * 86400000); pts.push(paraCena(q.x, q.y, q.z, v).clone()); }
    grupo.add(linha(pts, p.cor, p.corpo === 'Pluto' ? 0.2 : 0.3, 'orbita'));
    await pausa();
  }

  // planetas anões, asteroides e cometas com nome (SBDB): ponto, nome e órbita (anões sempre; os outros ao tocar)
  for (const [chave, d] of Object.entries(corpos?.pequenos || {})) {
    if (!K.PEQUENOS[chave] || !(d.e < 1)) continue;
    const cor = COR_PEQUENO[d.tipo] || COR_PEQUENO.asteroide;
    const marca = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaPonto(THREE), color: cor, sizeAttenuation: false, transparent: true, depthWrite: false }));
    marca.scale.setScalar(d.tipo === 'anao' ? 0.012 : 0.009);
    marca.userData.tipo = 'pequeno';
    grupo.add(marca);
    rotulo(marca, K.PEQUENOS[chave].nome, PRIORIDADE_PEQUENO[d.tipo] || 18, d.tipo === 'cometa' ? 'cometa' : 'anao', -13);
    const orbita = linha(K.pontosOrbita(d, 240).map((q) => paraCena(q.x, q.y, q.z, new THREE.Vector3())), cor, d.tipo === 'anao' ? 0.16 : 0.45, d.tipo === 'anao' ? 'orbitaAnao' : 'orbitaPequeno');
    grupo.add(orbita);
    const item = { chave, d, marca, orbita };
    SIS.pequenos.push(item);
    tocaveis.push({ objeto: marca, acao: () => mostrarPequeno(item), prioridade: 1 });
  }

  await pausa();
  // cinturões: populações reais (SBDB) com Kepler na GPU; sem os dados, desenho ilustrativo avisado no cartão
  const pops = corpos?.populacoes || {};
  const ref = agora;
  SIS.refPopulacoes = ref;
  for (const [chave, lista] of Object.entries(pops)) {
    const P = POPULACOES[chave]; if (!P || !lista.length) continue;
    const pa = [], qb = [], emn = [], pos = [];
    for (const [a, e, i, om, w, ma, ep] of lista) {
      if (!(e < 0.95) || !(a > 0)) continue;
      const base = K.baseOrbita({ i, om, w }), b = a * Math.sqrt(1 - e * e);
      const n = 0.01720209895 / Math.pow(a, 1.5); // rad/dia
      const epocaMs = (ep + 2460000 - JD_UNIX) * 86400000;
      pa.push(base.P[0] * a, base.P[1] * a, base.P[2] * a);
      qb.push(base.Q[0] * b, base.Q[1] * b, base.Q[2] * b);
      emn.push(e, ma * RAD + n * (ref - epocaMs) / 86400000, n);
      pos.push(0, 0, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('pa', new THREE.Float32BufferAttribute(pa, 3));
    geo.setAttribute('qb', new THREE.Float32BufferAttribute(qb, 3));
    geo.setAttribute('emn', new THREE.Float32BufferAttribute(emn, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40); // o shader move os pontos: sem recorte por caixa
    const pontos = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { dias: { value: 0 }, tamanho: { value: 1.6 * G.renderer.getPixelRatio() }, cor: { value: new THREE.Color(...P.cor) }, opacidade: { value: chave === 'principal' ? 0.55 : 0.5 } },
      vertexShader: VERTEX_POP, fragmentShader: FRAGMENT_POP, transparent: true, depthWrite: false,
    }));
    pontos.userData.tipo = 'populacao'; pontos.frustumCulled = false;
    grupo.add(pontos);
    SIS.populacoes.push({ chave, pontos, n: emn.length / 3 });
    await pausa();
  }
  const temPop = (k) => SIS.populacoes.some((x) => x.chave === k);
  const anel = (n, de, ate, espessura, cor, tamanho, opac, semente) => {
    const pos = new Float32Array(n * 3);
    let s = semente; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const ua = de + rnd() * (ate - de), a = rnd() * Math.PI * 2; paraCena(Math.cos(a) * ua, Math.sin(a) * ua, (rnd() - 0.5) * espessura * ua, v).toArray(pos, i * 3); }
    const o = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: cor, size: tamanho, sizeAttenuation: false, transparent: true, opacity: opac, depthWrite: false }));
    o.userData.tipo = 'populacao';
    return o;
  };
  if (!temPop('principal')) grupo.add(anel(1600, 2.1, 3.3, 0.06, 0x9a9a9a, 1.4, 0.45, 11));
  if (!temPop('kuiper')) grupo.add(anel(1400, 30, 50, 0.12, 0x8aa0b8, 1.3, 0.3, 23));

  // heliopausa: limite da bolha do vento solar, cruzado pela Voyager 1 a 121 UA (2012) e pela Voyager 2 a 119 UA (2018)
  const hp = [], v = new THREE.Vector3();
  for (let k = 0; k <= 180; k++) { const a = k / 180 * Math.PI * 2; hp.push(paraCena(Math.cos(a) * 120, Math.sin(a) * 120, 0, v).clone()); }
  const helio = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hp), new THREE.LineDashedMaterial({ color: 0x6f8fb5, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.4 }));
  helio.computeLineDistances(); grupo.add(helio);
  const marcaHp = new THREE.Object3D(); paraCena(0, -120, 0, marcaHp.position); grupo.add(marcaHp);
  rotulo(marcaHp, 'Heliopausa', 10, 'faixa', 0);
  tocaveis.push({ objeto: marcaHp, acao: () => G.mostrarPainel('Heliopausa', 'Onde o vento do Sol perde força e começa o espaço interestelar.', 'Cerca de 120 UA do Sol (18 bilhões de km)', 'Voyager 1 (2012) e Voyager 2 (2018), NASA', acoesSistema()) });
  montarEscala(grupo, rotulo, tocaveis);
  const fonteCorpos = corpos ? `JPL Small-Body Database · ${fmt.dataCurta(Date.parse(corpos.gerado) || agora, fusoS(G.estadoApp))}` : '';
  const regioes = [
    ['principal', 2.7, 135, 'Milhões de rochas entre Marte e Júpiter. Ceres, o maior, é um planeta anão.', 'De 2,1 a 3,3 UA do Sol'],
    ['troianos', 5.2, 75, 'Dois enxames que acompanham Júpiter na mesma órbita, 60° à frente e 60° atrás dele. A sonda Lucy vai visitá-los.', 'Na órbita de Júpiter, a 5,2 UA do Sol'],
    ['kuiper', 42, 135, 'Região gelada além de Netuno, onde estão Plutão, Haumea, Makemake e Arrokoth.', 'De 30 a 50 UA do Sol'],
  ];
  for (const [chave, ua, ang, texto, faixa] of regioes) {
    const pop = SIS.populacoes.find((x) => x.chave === chave);
    if (!pop && chave === 'troianos') continue;
    const P = POPULACOES[chave];
    const o = new THREE.Object3D(); paraCena(ua * Math.cos(ang * RAD), ua * Math.sin(ang * RAD), 0, o.position); grupo.add(o);
    o.userData.tipo = 'regiao';
    rotulo(o, P.nome, 8, 'faixa', 0);
    const numeros = pop ? `${faixa} · ${num(pop.n, 0)} ${P.amostra} à mostra` : faixa;
    const fonte = pop ? fonteCorpos : 'Desenho ilustrativo: os pontos não são objetos reais';
    tocaveis.push({ objeto: o, acao: () => G.mostrarPainel(P.nome, texto, numeros, fonte, acoesSistema(pop ? [{ texto: 'Ver detalhes', onclick: () => mostrarInfo(P.nome, el('p', { text: `Cada ponto é um objeto real, na posição calculada para a data mostrada pelos elementos orbitais do JPL Small-Body Database (órbita kepleriana em volta do Sol). São ${num(pop.n, 0)} ${P.amostra}; a distância ao Sol está comprimida no mapa e a direção é a real.` })) }] : [])) });
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
    const linhaPassada = (lista, opacidade) => (lista.length > 1 ? linha(pts(lista), cor, opacidade, 'rota') : null);
    const recente = SAINDO.has(chave) ? passado : passado.filter((p) => p[0] >= agora - RECENTE_MS);
    const rastro = linhaPassada(recente, 0.42), rotaInteira = SAINDO.has(chave) ? null : linhaPassada(passado, 0.6);
    if (rastro) grupo.add(rastro);
    if (rotaInteira) { rotaInteira.userData.tipo = 'rotaInteira'; rotaInteira.visible = false; grupo.add(rotaInteira); }
    if (futuro.length > 1) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts(futuro)), new THREE.LineDashedMaterial({ color: cor, dashSize: 0.05, gapSize: 0.05, transparent: true, opacity: 0.35, depthWrite: false }));
      l.computeLineDistances(); l.userData.tipo = 'rota'; grupo.add(l);
    }
    const marcador = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaPonto(THREE), color: cor, sizeAttenuation: false, transparent: true, depthWrite: false }));
    marcador.scale.setScalar(0.014);
    marcador.userData.tipo = 'sonda';
    grupo.add(marcador);
    rotulo(marcador, m.curto, chave === 'jwst' || chave.startsWith('voyager') ? 40 : 30, 'sonda', -14);
    SIS.sondas.push({ chave, dados, marcador, rastro, rotaInteira });
    tocaveis.push({ objeto: marcador, acao: () => mostrarSonda(chave), prioridade: 1 });
    await pausa();
  }

  montarControlesSistema();
  G.cena.add(grupo);
  return grupo;
}

/** Filtros do sistema solar: órbitas, luas, corpos menores, cinturões, sondas e rotas (o que foi tocado continua à mostra). */
function aplicarFiltrosSistema() {
  E.sistema.traverse((o) => {
    switch (o.userData.tipo) {
      case 'orbita': o.visible = F.orbitas; break;
      case 'orbitaLua': o.visible = F.orbitas; break;
      case 'rota': o.visible = F.sondas && F.rotasSondas && !o.userData.oculta; break;
      case 'pequeno': o.visible = F.pequenos; break;
      case 'orbitaAnao': o.visible = F.pequenos && (F.orbitas || !!o.userData.destaque); break;
      case 'orbitaPequeno': o.visible = F.pequenos && !!o.userData.destaque; break;
      case 'populacao': o.visible = F.cinturoes; break;
      case 'escala': o.visible = F.escala; break;
      default:
    }
  });
}

// ---------- escala de distâncias, choque de terminação e Nuvem de Oort ----------

const ANEIS_ESCALA_UA = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const SEGUNDOS_LUZ_POR_UA = C.UA / 299792.458; // 499,0 s

/** Tempo que a luz leva para percorrer 'ua' unidades astronômicas, em texto curto. */
function textoLuz(ua) {
  const s = ua * SEGUNDOS_LUZ_POR_UA;
  if (s < 3600) return `${num(s / 60, 0)} min-luz`;
  if (s < 86400 * 2) return `${num(s / 3600, s < 36000 ? 1 : 0)} h-luz`;
  return `${num(s / 86400, 1)} dias-luz`;
}

/**
 * Anéis de distância no plano da eclíptica (a escala da cena é comprimida, então a régua fica desenhada nela), o choque
 * de terminação (Voyager 1 a 94 UA em 2004, Voyager 2 a 84 UA em 2007) e o começo estimado da Nuvem de Oort.
 */
function montarEscala(grupo, rotulo, tocaveis) {
  const { THREE, G } = E;
  const circulo = (ua, cor, opac, tracejado) => {
    const pts = [], v = new THREE.Vector3();
    for (let k = 0; k <= 240; k++) { const a = k / 240 * Math.PI * 2; pts.push(paraCena(Math.cos(a) * ua, Math.sin(a) * ua, 0, v).clone()); }
    const mat = tracejado ? new THREE.LineDashedMaterial({ color: cor, dashSize: 0.04 * distanciaTela(ua), gapSize: 0.05 * distanciaTela(ua), transparent: true, opacity: opac, depthWrite: false })
      : new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opac, depthWrite: false });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    if (tracejado) l.computeLineDistances();
    return l;
  };
  const marca = (ua, angulo, tipo) => { const o = new THREE.Object3D(); paraCena(ua * Math.cos(angulo * RAD), ua * Math.sin(angulo * RAD), 0, o.position); o.userData.tipo = tipo; grupo.add(o); return o; };
  for (const ua of ANEIS_ESCALA_UA) {
    const l = circulo(ua, 0x9fb4cc, 0.09, true); l.userData.tipo = 'escala'; grupo.add(l);
    const o = marca(ua, -62, 'escala');
    rotulo(o, `${num(ua, 0)} UA · ${textoLuz(ua)}`, 6, 'escala', 0);
    tocaveis.push({ objeto: o, acao: () => G.mostrarPainel(`${num(ua, 0)} UA do Sol`, 'Anel de distância: cada ponto dele está a esta distância do Sol. No mapa as distâncias são comprimidas para tudo caber na tela; a direção de cada corpo é a real.',
      `${num(ua * C.UA / 1e6, 0)} milhões de km · a luz do Sol leva ${textoLuz(ua).replace('-luz', '')} para chegar`, 'UA = 149.597.870,7 km (IAU 2012)', acoesSistema()), prioridade: 0 });
  }
  const choque = circulo(90, 0x8fb0d8, 0.28, true); choque.userData.tipo = 'escala'; grupo.add(choque);
  const oChoque = marca(90, 160, 'escala');
  rotulo(oChoque, 'Choque de terminação', 9, 'faixa', 0);
  tocaveis.push({ objeto: oChoque, acao: () => G.mostrarPainel('Choque de terminação', 'Onde o vento solar, que sai do Sol a 400 km/s, freia de repente abaixo da velocidade do som ao encontrar o gás entre as estrelas.',
    'Voyager 1 cruzou a 94 UA (dez/2004) e Voyager 2 a 84 UA (ago/2007): a bolha não é redonda nem fixa', 'Stone et al. 2005 e 2008, Science e Nature', acoesSistema()), prioridade: 0 });
  const oort = circulo(2000, 0xb9a6d8, 0.22, true); oort.userData.tipo = 'escala'; grupo.add(oort);
  const oOort = marca(2000, 120, 'escala');
  rotulo(oOort, 'Nuvem de Oort (início estimado)', 7, 'faixa', 0);
  tocaveis.push({ objeto: oOort, acao: () => G.mostrarPainel('Nuvem de Oort', 'Reservatório de bilhões de núcleos de cometas em volta do Sol, de onde vêm os cometas de período longo. Nunca foi vista diretamente: sua existência é deduzida das órbitas desses cometas.',
    'Começa a cerca de 2.000 UA e pode ir além de 100.000 UA (1,6 ano-luz), um terço do caminho até Alfa Centauri', 'Oort 1950; estimativas atuais variam bastante', acoesSistema()), prioridade: 0 });
}

// ---------- tabela dos planetas agora ----------

const largo = () => matchMedia('(min-width: 900px)').matches;

/** Painel lateral no computador; no celular, "Dados" abre a mesma tabela numa janela (a cena fica limpa). */
function mostrarTabela() {
  if (!SIS.dom) return;
  const ligado = E.modo === 'sistema' && !E.G.galaxia;
  SIS.dom.dados.setAttribute('aria-pressed', String(F.tabela && largo()));
  SIS.dom.tabela.hidden = !(ligado && F.tabela && largo());
  if (ligado && !largo() && SIS.pediuTabela) mostrarInfo('Planetas agora', montarTabela(instanteSistema()));
  SIS.pediuTabela = false;
  if (!SIS.dom.tabela.hidden) atualizarTabela(instanteSistema(), true);
}

function atualizarTabela(ms, forcar = false) {
  if (!forcar && SIS.dom.tabela.hidden) return;
  SIS.dom.tabela.replaceChildren(montarTabela(ms));
}

const textoMin = (min) => (min < 60 ? `${num(min, min < 10 ? 1 : 0)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`);

function montarTabela(ms) {
  const lista = C.efemeridesPlanetas(ms);
  const te = C.helioEcliptica('Earth', ms), terraSol = Math.hypot(te.x, te.y, te.z), ve = C.estadoHelio('Earth', ms);
  const cab = el('tr', {}, ...['', 'do Sol', 'da Terra', 'luz', 'km/s', 'brilho', 'no céu'].map((t) => el('th', { text: t })));
  const linhaDe = (nome, sol, terra, luz, vel, mag, ceu, corpo) => {
    const tr = el('tr', {}, el('th', { text: nome }), el('td', { text: sol }), el('td', { text: terra }), el('td', { text: luz }), el('td', { text: vel }), el('td', { text: mag }), el('td', { text: ceu }));
    if (corpo) {
      tr.tabIndex = 0; tr.classList.add('tocavel');
      tr.addEventListener('click', () => { const P = SIS.planetas.find((x) => x.p.corpo === corpo); if (P) { SIS.tocado = P.malha; focarObjeto(P.malha); } mostrarAstro(corpo, instanteSistema()); document.getElementById('dlg-info')?.close?.(); });
    }
    return tr;
  };
  const linhas = lista.map((p) => linhaDe(p.nome, `${num(p.distSolUa, p.distSolUa < 10 ? 3 : 2)} UA`, `${num(p.distTerraUa * C.UA / 1e6, 0)} mi km`, textoMin(p.luzMin),
    num(p.velKmS, 1), num(p.mag, 1), `${p.constelacao} · ${num(p.elongacao, 0)}° do Sol`, p.corpo));
  linhas.splice(2, 0, linhaDe('Terra', `${num(terraSol, 4)} UA`, '–', textoMin(terraSol * SEGUNDOS_LUZ_POR_UA / 60), num(Math.hypot(ve.vx, ve.vy, ve.vz) * C.UA / 86400, 1), '–', 'luz do Sol até aqui', null));
  const d = new Date(ms);
  return el('div', { class: 'tabela-planetas' },
    el('table', {}, el('thead', {}, cab), el('tbody', {}, ...linhas)),
    el('p', { class: 'nota', text: `Astronomy Engine (VSOP87) · ${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Brilho em magnitude (menor = mais brilhante); "luz" é o tempo que a luz do planeta leva até a Terra. Toque numa linha para ir até o planeta.` }));
}

function mostrarTerra() {
  const t = instanteSistema(), te = C.helioEcliptica('Earth', t), r = Math.hypot(te.x, te.y, te.z);
  E.G.mostrarPainel('Terra', 'É aqui que você está. A Terra dá uma volta no Sol por ano, a cerca de 107 mil km/h.', `${num(r * C.UA / 1e6, 1)} milhões de km do Sol (${num(r, 4)} UA) · a luz do Sol chega em ${num(r * C.UA / 299792.458 / 60, 1)} min`, `Astronomy Engine · ${new Date(t).toLocaleDateString('pt-BR')}`, acoesSistema());
}

function mostrarLua(chave) {
  const c = cartaoLua(chave, E.corpos?.luas?.[chave], instanteSistema());
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, acoesSistema([{ texto: 'Ver detalhes', onclick: c.detalhes }]));
}

function mostrarPequeno(item) {
  const c = cartaoPequeno(item.chave, item.d, E.G.estadoApp, instanteSistema());
  const destacar = (ligar) => { item.orbita.userData.destaque = ligar; aplicarFiltrosSistema(); };
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, acoesSistema([{ texto: 'Ver detalhes', onclick: c.detalhes }]), () => destacar(false));
  destacar(true);
}

function mostrarSonda(chave) {
  const s = SIS.sondas.find((x) => x.chave === chave);
  const c = cartaoSonda(chave, s.dados, E.sondas?.gerado, E.G.estadoApp, instanteSistema());
  const destacar = (ligar) => { if (s.rotaInteira) { s.rotaInteira.visible = ligar; if (s.rastro) { s.rastro.userData.oculta = ligar; s.rastro.visible = !ligar && F.sondas && F.rotasSondas; } } };
  E.G.mostrarPainel(c.titulo, c.frase, c.numeros, c.fonte, acoesSistema(c.detalhes ? [{ texto: 'Ver detalhes', onclick: c.detalhes }] : []), () => destacar(false));
  destacar(true);
}

function montarControlesSistema() {
  // um botão só para a velocidade do tempo (cada toque passa para a próxima) e "Hoje" só quando a data mudou
  const tempo = el('button', { type: 'button', class: 'globo-tempo', text: VELOCIDADES[0].nome, 'aria-pressed': 'false', title: 'Toque para acelerar o tempo',
    onclick: () => { const i = VELOCIDADES.findIndex((v) => v.v === SIS.vel); definirVelocidade(VELOCIDADES[(i + 1) % VELOCIDADES.length].v); } });
  const hoje = el('button', { type: 'button', class: 'globo-hoje', text: 'Hoje', hidden: true, 'aria-label': 'Voltar para hoje', onclick: () => { SIS.desloc = 0; definirVelocidade(0); } });
  const geral = el('button', { type: 'button', class: 'globo-visao-geral', text: 'Visão geral', hidden: true, onclick: visaoGeral });
  const livre = el('button', { type: 'button', class: 'globo-livre', text: 'Navegação livre', 'aria-pressed': 'false', onclick: () => alternarLivre(!E.G.livre) });
  const dados = el('button', { type: 'button', class: 'globo-btn-tabela', text: 'Dados', 'aria-pressed': String(F.tabela), title: 'Tabela dos planetas agora', onclick: () => { if (largo()) { F.tabela = !F.tabela; gravarFiltros(); } else SIS.pediuTabela = true; mostrarTabela(); } });
  const tabela = el('div', { class: 'globo-tabela-planetas', hidden: true });
  const galaxia = el('button', { type: 'button', class: 'globo-ir-galaxia', text: 'Via Láctea', title: 'Sair do sistema solar e ver a Via Láctea de fora', onclick: () => E.G.abrirGalaxia() });
  const dica = el('p', { class: 'globo-dica', hidden: true, text: 'Arraste para olhar em volta · afaste os dedos para avançar · dois toques para ir até algo' });
  const data = el('p', { class: 'globo-data-sistema' });
  const topo = el('div', { class: 'globo-sistema-topo' }, tempo, hoje, geral, galaxia, dados, livre);
  // fontes e data dos dados ficam no "?" (ajuda), fora da cena
  const raiz = el('div', { class: 'globo-sistema-controles globo-recolhivel', hidden: true }, dica, data, topo);
  E.G.dom.raiz.append(raiz, tabela);
  SIS.dom = { raiz, tempo, hoje, data, geral, livre, dica, dados, tabela };
}

const _m4 = { m: null, x: null, y: null, z: null, p: null };
/** Gira a malha do corpo para o polo e o meridiano principal da IAU no instante ms (y local = polo, x local = longitude 0). */
function orientar(malha, corpo, ms) {
  const o = K.orientacao(corpo, ms); if (!o) return;
  const { THREE } = E;
  if (!_m4.m) Object.assign(_m4, { m: new THREE.Matrix4(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() });
  _m4.x.set(o.meridiano.x, o.meridiano.z, -o.meridiano.y);
  _m4.y.set(o.polo.x, o.polo.z, -o.polo.y);
  _m4.z.crossVectors(_m4.x, _m4.y);
  malha.quaternion.setFromRotationMatrix(_m4.m.makeBasis(_m4.x, _m4.y, _m4.z));
}

function atualizarSistema(agora) {
  const { G } = E;
  if (SIS.vel) SIS.desloc += (agora - SIS.ultimo) / 1000 * SIS.vel * 86400000;
  SIS.ultimo = agora;
  const ms = instanteSistema();
  const cam = G.camera.position;
  // a anos-luz do Sol, o sistema inteiro cabe num ponto: some a maquete e fica o Sol como estrela do catálogo
  E.sistema.visible = cam.length() <= LONGE_DO_SOL;
  orientar(SIS.sol, 'Sun', ms);
  for (const P of SIS.planetas) {
    const pos = P.p.corpo === 'Pluto' ? C.helioEcliptica('Pluto', ms) : posicaoPlaneta(P.p, ms);
    paraCena(pos.x, pos.y, pos.z, P.grupo.position);
    orientar(P.malha, P.p.corpo, ms);
    // em órbita, um planeta que passa rente à câmera vira um disco enorme na frente de tudo: some enquanto não for o foco
    P.malha.visible = !!G.livre || SIS.focado === P.malha || cam.distanceTo(P.grupo.position) > P.r * 12;
    // luas: a nossa sempre; as dos outros planetas quando a câmera chega perto (ou o planeta está em foco)
    const perto = cam.distanceTo(P.grupo.position) < P.r * 40;
    P.luas.visible = F.luas && (P.p.corpo === 'Earth' || perto);
    if (P.luas.visible) for (const L of P.listaLuas) {
      const q = K.posicaoLua(L.chave, ms, L.el);
      L.malha.visible = !!q;
      if (q) escalaLua(P.r, P.raioKm, q, L.malha.position);
    }
  }
  for (const s of SIS.pequenos) {
    const q = F.pequenos ? K.posicaoKepler(s.d, ms) : null;
    s.marca.visible = !!q;
    if (q) paraCena(q.x, q.y, q.z, s.marca.position);
  }
  const dias = (ms - SIS.refPopulacoes) / 86400000;
  for (const p of SIS.populacoes) p.pontos.material.uniforms.dias.value = dias;
  for (const s of SIS.sondas) {
    const e = F.sondas ? estadoSonda(s.dados, ms) : null;
    s.marcador.visible = !!e;
    if (e) paraCena(e.x, e.y, e.z, s.marcador.position);
  }
  posicionarRotulos();
  if (SIS.dom && G.quadro % 10 === 0) {
    const d = new Date(ms);
    const agoraMesmo = SIS.desloc === 0 && !SIS.vel;
    SIS.dom.data.textContent = agoraMesmo ? `Hoje, ${d.toLocaleDateString('pt-BR')}` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    SIS.dom.hoje.hidden = agoraMesmo;
  }
  if (SIS.dom && G.quadro % 30 === 5) atualizarTabela(ms);
}

/** Objeto e todos os grupos acima dele visíveis (dentro do sistema solar). */
function visivelNoSistema(o) {
  for (; o && o !== E.sistema; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Rótulos do sistema solar sem sobreposição: os de maior prioridade ficam, os que colidem somem. */
/** Retângulos (em coordenadas do canvas) dos controles visíveis por cima da cena, com uma folga. */
function zonasDosControles(G, rect) {
  const out = [];
  const tab = SIS.dom?.tabela; // a tabela dos planetas fica à vista mesmo com os controles recolhidos
  if (tab && !tab.hidden) { const r = tab.getBoundingClientRect(); out.push({ x0: r.left - rect.left - 4, y0: r.top - rect.top - 4, x1: r.right - rect.left + 4, y1: r.bottom - rect.top + 4 }); }
  if (G.dom.raiz.classList.contains('imersivo')) return out;
  for (const b of G.dom.raiz.querySelectorAll('.globo-recolhivel button, .globo-recolhivel .globo-data-sistema, .globo-recolhivel .globo-legenda, .globo-recolhivel .globo-linha')) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    out.push({ x0: r.left - rect.left - 4, y0: r.top - rect.top - 4, x1: r.right - rect.left + 4, y1: r.bottom - rect.top + 4 });
  }
  return out;
}

function posicionarRotulos() {
  const G = E.G, rect = G.dom.canvas.getBoundingClientRect();
  const v = SIS.vr || (SIS.vr = new E.THREE.Vector3());
  const itens = [];
  const longe = G.camera.position.length() > LONGE_DO_SOL; // além de uns 5.000 UA, só o Sol continua com nome
  for (const o of SIS.comRotulo) {
    const r = o.userData.rotulo;
    if (!F.rotulos || !visivelNoSistema(o) || (longe && o !== SIS.sol)) { r.el.hidden = true; continue; }
    if (!projetar(o.getWorldPosition(v), v)) { r.el.hidden = true; continue; }
    const desloc = o.userData.deslocY ?? -(raioNaTela(o, rect) + 12);
    itens.push({ r, x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height + desloc });
  }
  // estrelas com nome que estão brilhantes vistas daqui (no 3D, as vizinhas ganham nome ao chegar perto) e céu profundo
  const ceu = G.estrelas, proj = (s, mundo) => { return !projetar(mundo, mundo) ? null : { x: (mundo.x + 1) / 2 * rect.width, y: (1 - mundo.y) / 2 * rect.height + 14 }; };
  for (const s of E.estrelas) {
    const p = F.rotulos && F.nomesEstrelas && ceu?.pontos?.visible && magVista(s.e) <= Math.min(MAG_ROTULO_ESTRELA, ceu.limite) ? proj(s, estrelaNaCena(s)) : null;
    if (!p) { s.rotulo.hidden = true; continue; }
    s.item ||= { el: s.rotulo, prioridade: 12, largura: s.e.nome.length * 7 + 18 };
    itens.push({ r: s.item, ...p });
  }
  for (const s of E.objetos) {
    const p = F.rotulos && F.nomesEstrelas && F.objetos ? proj(s, objetoNaCena(s)) : null;
    if (!p) { s.rotulo.hidden = true; continue; }
    s.item ||= { el: s.rotulo, prioridade: 9, largura: s.largura };
    itens.push({ r: s.item, ...p });
  }
  itens.sort((a, b) => b.r.prioridade - a.r.prioridade);
  // nenhum nome por baixo de botões e filtros visíveis; com os controles recolhidos, a tela toda fica livre
  if (!SIS.zonas || G.quadro % 15 === 0) SIS.zonas = zonasDosControles(G, rect);
  const ocupados = [...SIS.zonas];
  for (const it of itens) {
    const w = it.r.largura, h = 22, x0 = it.x - w / 2, y0 = it.y - h / 2;
    const fora = it.x < 0 || it.x > rect.width || it.y < 8 || it.y > rect.height - 8;
    const bate = ocupados.some((o) => x0 < o.x1 && x0 + w > o.x0 && y0 < o.y1 && y0 + h > o.y0);
    it.r.el.hidden = fora || bate;
    if (!it.r.el.hidden) { ocupados.push({ x0, y0, x1: x0 + w, y1: y0 + h }); it.r.el.style.transform = `translate(${(x0).toFixed(0)}px, ${(y0).toFixed(0)}px)`; }
  }
}
