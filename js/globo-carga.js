// Carregamento da aba Globo: uma tela com barra de progresso enquanto tudo é baixado e montado, da Terra até a
// radiação cósmica de fundo. Quando a barra termina, todas as escalas estão prontas e a troca entre elas é imediata.
//
// O progresso é real: cada etapa tem um peso (proporcional ao tempo medido) e avança quando o trabalho dela termina.
// Uma etapa que falha (sem rede, por exemplo) conta como encerrada, para a tela nunca ficar presa; o aviso da falha
// é de quem falhou. Depois de alguns segundos aparece "Entrar agora", que abre o Globo com o resto carregando ao fundo.
import { el } from './ui.js';

/** Etapas na ordem em que acontecem. peso: parte da barra; nome: o que aparece enquanto a etapa roda. */
const ETAPAS = [
  { id: 'terra', nome: 'A Terra', peso: 6 },
  { id: 'tempo', nome: 'O tempo agora, no mundo todo', peso: 12 },
  { id: 'mapa', nome: 'Contornos, relevo e cidades', peso: 6 },
  { id: 'orbita', nome: 'Satélites, sondas e o céu de hoje', peso: 10 },
  { id: 'sistema', nome: 'Sistema solar: planetas, luas, asteroides e cometas', peso: 18 },
  { id: 'via-lactea', nome: 'Via Láctea: estrelas, braços e aglomerados', peso: 16 },
  { id: 'universo', nome: 'Galáxias, aglomerados, quasares e a radiação cósmica de fundo', peso: 24 },
  { id: 'imagens', nome: 'Imagens e nomes', peso: 8 },
];
const TOTAL = ETAPAS.reduce((s, e) => s + e.peso, 0);
const ESPERA_ENTRAR_MS = 9000;

/**
 * Cria a tela de carregamento dentro do globo.
 * @param {HTMLElement} raiz elemento .globo
 * @returns {{ etapa: (id: string, fracao?: number) => void, fim: () => void, pronto: Promise<void>, ativa: () => boolean }}
 */
export function criarCarga(raiz) {
  const feito = Object.fromEntries(ETAPAS.map((e) => [e.id, 0]));
  const nome = el('p', { class: 'carga-etapa', text: ETAPAS[0].nome, 'aria-live': 'polite' });
  const cheio = el('span', { class: 'carga-cheio' });
  const barra = el('div', { class: 'carga-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Carregando o Globo' }, cheio);
  const numero = el('span', { class: 'carga-numero', text: '0%' });
  const entrar = el('button', { type: 'button', class: 'carga-entrar', hidden: true, text: 'Entrar agora', onclick: () => fim() });
  const tela = el('div', { class: 'globo-carga' },
    el('div', { class: 'carga-caixa' }, el('p', { class: 'carga-titulo', text: 'Preparando o universo' }), nome, el('div', { class: 'carga-linha' }, barra, numero), entrar));
  for (const tipo of ['pointerdown', 'wheel', 'touchstart']) tela.addEventListener(tipo, (e) => e.stopPropagation(), { passive: true });
  raiz.append(tela);
  raiz.classList.add('carregando');
  let ativa = true, avisar;
  const pronto = new Promise((ok) => { avisar = ok; });
  const relogio = setTimeout(() => { entrar.hidden = false; }, ESPERA_ENTRAR_MS);

  function desenhar() {
    const soma = ETAPAS.reduce((s, e) => s + e.peso * feito[e.id], 0);
    const pct = Math.round((soma / TOTAL) * 100);
    cheio.style.width = `${pct}%`;
    numero.textContent = `${pct}%`;
    barra.setAttribute('aria-valuenow', String(pct));
    const atual = ETAPAS.find((e) => feito[e.id] < 1);
    if (atual) nome.textContent = atual.nome;
    if (!atual) fim();
  }

  /** Marca o avanço de uma etapa (fracao de 0 a 1; sem fracao, a etapa terminou). O progresso nunca volta. */
  function etapa(id, fracao = 1) {
    if (!(id in feito)) return;
    feito[id] = Math.max(feito[id], Math.min(1, fracao));
    if (ativa) desenhar();
  }

  function fim() {
    if (!ativa) return;
    ativa = false;
    clearTimeout(relogio);
    raiz.classList.remove('carregando');
    tela.classList.add('saindo');
    setTimeout(() => tela.remove(), 700);
    avisar();
  }

  return { etapa, fim, pronto, ativa: () => ativa };
}
