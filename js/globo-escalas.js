// Escalas da aba Globo: onde a câmera está, da Terra até a borda do universo observável, e o atalho para ir a
// qualquer uma. O zoom (pinça, roda) continua contínuo entre elas; as escalas só dão nome ao lugar e um caminho direto.
//
// - Computador (tela larga com mouse): uma régua vertical à esquerda, sempre à vista, com a escala atual acesa.
// - Celular: um botão com o nome da escala atual (abre a lista) e, fora da Terra, um "‹ Terra" sempre visível, para
//   nunca ficar preso numa vista.
// A troca de cena (Terra, sistema solar, galáxia) é do globo (G.irParaEscala); aqui só a interface e a detecção.
import { el } from './ui.js';

/** Escalas da Terra e do sistema solar; as da galáxia e do universo vêm de globo-galaxia.js (ESCALAS). */
const BASE = [
  { id: 'terra', nome: 'Terra', texto: 'o tempo agora, no mundo todo' },
  { id: 'orbita', nome: 'Órbita da Terra', texto: 'satélites, estações espaciais e o céu de hoje' },
  { id: 'sistema', nome: 'Sistema solar', texto: 'planetas, luas e sondas, nas posições de agora' },
];
// as da galáxia, para a lista existir antes de o módulo da galáxia carregar (mesmos id, nome e texto)
const GALAXIA = [
  { id: 'vizinhanca', nome: 'Vizinhança do Sol', texto: 'estrelas a até milhares de anos-luz' },
  { id: 'via-lactea', nome: 'Via Láctea', texto: 'nossa galáxia vista de fora' },
  { id: 'grupo-local', nome: 'Grupo Local', texto: 'Andrômeda, Triângulo e ~100 galáxias anãs' },
  { id: 'volume-local', nome: 'Volume Local', texto: 'galáxias até ~35 milhões de anos-luz, com distância medida' },
  { id: 'laniakea', nome: 'Laniakea', texto: 'nosso superaglomerado e o Grande Atrator' },
  { id: 'teia', nome: 'Teia cósmica', texto: 'filamentos, paredes e vazios até ~1 bilhão de anos-luz' },
  { id: 'profundo', nome: 'Universo profundo', texto: 'quasares e as galáxias mais distantes' },
  { id: 'observavel', nome: 'Universo observável', texto: 'a radiação cósmica de fundo e a borda do que se pode ver' },
];
export const TODAS = [...BASE, ...GALAXIA];
const LARGO = matchMedia('(min-width: 1100px) and (pointer: fine)');

const S = { G: null, dom: null, atual: null, ir: null };

/**
 * Monta a régua (computador) e os botões (celular).
 * @param {object} G estado do globo
 * @param {(id:string) => void} ir função do globo que leva a câmera até a escala
 */
export function montarEscalas(G, ir) {
  S.G = G; S.ir = ir;
  const itens = TODAS.map((e) => el('li', {}, el('button', { type: 'button', 'data-escala': e.id, title: e.texto, onclick: () => escolher(e.id) },
    el('span', { class: 'escala-ponto', 'aria-hidden': 'true' }), el('span', { class: 'escala-nome', text: e.nome }), el('small', { class: 'escala-texto', text: e.texto }))));
  const lista = el('ol', { class: 'globo-escalas-lista' }, ...itens);
  const regua = el('nav', { class: 'globo-escalas', 'aria-label': 'Escalas, da Terra ao universo observável' }, lista);
  const atual = el('button', { type: 'button', class: 'globo-onde', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => alternarLista() },
    el('span', { class: 'globo-onde-nome', text: 'Terra' }));
  const terra = el('button', { type: 'button', class: 'globo-voltar', hidden: true, text: '‹ Terra', 'aria-label': 'Voltar à Terra', onclick: () => escolher('terra') });
  const topo = el('div', { class: 'globo-onde-caixa' }, terra, atual);
  // tocar na régua ou nos botões não gira a cena; tocar fora fecha a lista do celular
  for (const caixa of [regua, topo]) caixa.addEventListener('pointerdown', (e) => e.stopPropagation());
  G.dom.raiz.append(regua, topo);
  G.dom.raiz.addEventListener('pointerdown', fecharLista);
  S.dom = { regua, lista, atual, nome: atual.firstChild, terra, topo };
  LARGO.addEventListener?.('change', () => atualizarEscalas(true));
  atualizarEscalas(true);
}

function escolher(id) {
  fecharLista();
  if (id !== S.atual) S.ir(id);
}

function alternarLista() {
  const aberta = S.dom.regua.classList.toggle('aberta');
  S.dom.atual.setAttribute('aria-expanded', String(aberta));
}
export function fecharLista() { S.dom?.regua.classList.remove('aberta'); S.dom?.atual.setAttribute('aria-expanded', 'false'); }

/** Escala em que a câmera está agora. */
export function idAtual(G = S.G) {
  if (G.galaxia) return G.galaxia.escalaAtual()?.id || 'via-lactea';
  if (G.sistema) return 'sistema';
  return G.espacoAberto ? 'orbita' : 'terra';
}

/** Acende a escala atual (chamado algumas vezes por segundo pelo laço do globo). */
export function atualizarEscalas(forcar = false) {
  if (!S.dom) return;
  const id = idAtual();
  S.dom.regua.classList.toggle('larga', LARGO.matches);
  if (id === S.atual && !forcar) return;
  if (S.atual && id !== S.atual) fecharLista(); // mudou de escala (pela lista, pela pinça ou pelo "‹ Terra"): a lista sai da frente
  S.atual = id;
  const e = TODAS.find((x) => x.id === id);
  S.dom.nome.textContent = e.nome;
  S.dom.terra.hidden = id === 'terra';
  for (const b of S.dom.lista.querySelectorAll('button')) {
    const ativo = b.dataset.escala === id;
    b.classList.toggle('atual', ativo);
    if (ativo) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
  }
  S.G.dom.raiz.dataset.escala = id;
  S.G.aoMudarEscala?.(id);
}

export const nomeDaEscala = (id) => TODAS.find((x) => x.id === id)?.nome || '';
