// Painel de camadas da aba Globo: um só lugar para escolher o que aparece, em qualquer escala (Terra, órbita, sistema
// solar, galáxia e universo). Cada módulo descreve as próprias seções; este módulo só desenha e devolve as escolhas.
//
// Seção: { titulo, itens: Item[] }
// Item:  { tipo: 'caixa', texto, valor: boolean, mudar(boolean) }
//        { tipo: 'opcoes', texto, valor, opcoes: [[valor, texto]], mudar(valor) }
// No computador o painel fica à direita, sem cobrir a cena; no celular sobe de baixo, com no máximo 70% da altura.
// O efeito de cada escolha aparece na hora, com o painel aberto.
import { el } from './ui.js';

const P = { raiz: null, corpo: null, titulo: null, aberto: false, secoes: null, aoFechar: null };

/** Cria o painel (escondido) dentro do globo. */
export function montarCamadas(raizGlobo) {
  P.titulo = el('h3', { class: 'camadas-titulo', text: 'Camadas' });
  P.corpo = el('div', { class: 'camadas-corpo' });
  const fechar = el('button', { type: 'button', class: 'camadas-fechar', 'aria-label': 'Fechar camadas', text: '×', onclick: () => fecharCamadas() });
  P.raiz = el('aside', { class: 'globo-camadas', hidden: true, role: 'dialog', 'aria-label': 'Camadas do globo' }, el('div', { class: 'camadas-topo' }, P.titulo, fechar), P.corpo);
  P.raiz.addEventListener('pointerdown', (e) => e.stopPropagation()); // tocar no painel não gira a cena
  P.raiz.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  raizGlobo.append(P.raiz);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.aberto) fecharCamadas(); });
}

/**
 * Abre (ou redesenha) o painel com as seções da escala atual.
 * @param {string} titulo nome da escala ("Camadas · Sistema solar")
 * @param {() => object[]} secoes função que devolve as seções (chamada de novo a cada mudança, para refletir o estado)
 */
export function abrirCamadas(titulo, secoes, aoFechar = null) {
  P.secoes = secoes; P.aoFechar = aoFechar;
  P.titulo.textContent = titulo;
  desenhar();
  P.raiz.hidden = false; P.aberto = true;
  P.raiz.closest('.globo')?.classList.add('com-camadas');
}

export function fecharCamadas() {
  if (!P.raiz || !P.aberto) return;
  P.raiz.hidden = true; P.aberto = false;
  P.raiz.closest('.globo')?.classList.remove('com-camadas');
  const f = P.aoFechar; P.aoFechar = null; f?.();
}

export const camadasAbertas = () => P.aberto;

/** Redesenha com o estado atual (por exemplo, quando a escala muda com o painel aberto). */
export function atualizarCamadas(titulo, secoes) {
  if (!P.aberto) return;
  if (secoes) P.secoes = secoes;
  if (titulo) P.titulo.textContent = titulo;
  desenhar();
}

function desenhar() {
  const rolagem = P.corpo.scrollTop;
  P.corpo.replaceChildren(...P.secoes().filter(Boolean).map((s) => el('section', { class: 'camadas-secao' },
    s.titulo ? el('h4', { text: s.titulo }) : null,
    ...s.itens.filter(Boolean).map(item))));
  P.corpo.scrollTop = rolagem;
}

function item(it) {
  if (it.tipo === 'opcoes') {
    return el('div', { class: 'camadas-opcoes', role: 'radiogroup', 'aria-label': it.texto },
      it.texto ? el('span', { class: 'camadas-rotulo', text: it.texto }) : null,
      el('div', { class: 'camadas-opcoes-lista' }, ...it.opcoes.map(([v, texto]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === it.valor), text: texto,
        onclick: () => { it.mudar(v); desenhar(); } }))));
  }
  const entrada = el('input', { type: 'checkbox', role: 'switch' });
  entrada.checked = !!it.valor;
  entrada.addEventListener('change', () => { it.mudar(entrada.checked); desenhar(); });
  return el('label', { class: 'camadas-caixa' }, el('span', { class: 'camadas-texto' }, it.texto, it.detalhe ? el('small', { text: it.detalhe }) : null), entrada);
}
