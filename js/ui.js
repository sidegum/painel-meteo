// Utilidades de interface. Todo texto entra por textContent; nada de innerHTML com dados externos.
import { partesLocais, valido, direcaoTexto } from './analise.js';

// ------------------------------------------------------------------ guarda de valores ausentes
// Nenhum valor ausente pode aparecer na tela como "null", "undefined" ou "NaN".
// 1) append, prepend, replaceChildren, before, after e replaceWith ignoram null, undefined e false
//    (o DOM os converteria no texto "null"/"undefined").
// 2) Todo texto (textContent, nós de texto criados por el() e strings passadas aos métodos acima) troca as
//    palavras soltas null, undefined e NaN por "–" e avisa no console, para o defeito ser achado e corrigido.
const AUSENTE_RE = /(^|[^\p{L}\p{N}_])(null|undefined|NaN)(?![\p{L}\p{N}_])/gu;
export function textoSeguro(v) {
  const s = String(v);
  if (!AUSENTE_RE.test(s)) return s;
  AUSENTE_RE.lastIndex = 0;
  console.warn('Valor ausente no texto da tela:', s);
  return s.replace(AUSENTE_RE, '$1–');
}
const vazio = (x) => x === null || x === undefined || x === false;
const limpar = (args) => args.filter((x) => !vazio(x)).map((x) => (typeof x === 'string' ? textoSeguro(x) : x));
function protegerMetodos(proto, nomes) {
  for (const nome of nomes) {
    const orig = proto?.[nome];
    if (typeof orig !== 'function' || orig.__seguro) continue;
    const novo = function (...args) { return orig.apply(this, limpar(args)); };
    novo.__seguro = true;
    proto[nome] = novo;
  }
}
if (typeof Element !== 'undefined') {
  protegerMetodos(Element.prototype, ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']);
  protegerMetodos(DocumentFragment.prototype, ['append', 'prepend', 'replaceChildren']);
  protegerMetodos(CharacterData.prototype, ['before', 'after', 'replaceWith']);
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  if (desc?.set && !desc.set.__seguro) {
    const set = function (v) { desc.set.call(this, vazio(v) ? '' : textoSeguro(v)); };
    set.__seguro = true;
    Object.defineProperty(Node.prototype, 'textContent', { ...desc, set });
  }
}

export function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) e.style.setProperty(p, val);
    else e.setAttribute(k, v === true ? '' : k === 'title' || k.startsWith('aria-') ? textoSeguro(v) : String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(textoSeguro(f)));
  }
  return e;
}

export function svg(tag, attrs = {}, ...filhos) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const f of filhos) e.append(f);
  return e;
}

// Link externo seguro: só https e sempre noopener noreferrer.
export function linkExterno(href, texto) {
  const ok = /^https:\/\/[a-z0-9.-]+(\/[^\s"'<>]*)?$/i.test(String(href || ''));
  return ok ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, texto) : el('span', {}, texto);
}

// Seta de vento: aponta para onde o vento vai (direção meteorológica é de onde vem).
export function setaVento(graus, cor = 'currentColor') {
  if (!valido(graus)) return el('span', { class: 'ausente', text: 'sem direção' });
  const s = svg('svg', { viewBox: '-10 -10 20 20', class: 'seta', role: 'img', 'aria-label': `vento de ${direcaoTexto(graus)}` });
  const g = svg('g', { transform: `rotate(${graus + 180})` });
  g.append(svg('path', { d: 'M0 -8 L5 4 L0 1 L-5 4 Z', fill: cor }));
  s.append(g);
  return s;
}

const fmtN = (v, casas = 0) => (valido(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false }) : null);
export const fmt = {
  n: fmtN,
  mm(v) { if (!valido(v)) return null; return v < 1 && v > 0 ? `${fmtN(v, 1)} mm` : `${fmtN(v, 0)} mm`; },
  kmh: (v) => (valido(v) ? `${fmtN(v)} km/h` : null),
  c: (v) => (valido(v) ? `${fmtN(v)}°` : null),
  c1: (v) => (valido(v) ? `${fmtN(v, 1)} °C` : null),
  pct: (v) => (valido(v) ? `${fmtN(v * 100)}%` : null),
  hpa: (v) => (valido(v) ? `${fmtN(v, 1)} hPa` : null),
  hora(ms, off) { if (!valido(ms)) return '–'; const p = partesLocais(ms, off); return `${String(p.hora).padStart(2, '0')}h`; },
  horaMin(ms, off) { if (!valido(ms)) return '–'; const p = partesLocais(ms, off); return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`; },
  diaSemana(ms, off) { const p = partesLocais(ms, off); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][p.semana]; },
  dataCurta(ms, off) { const p = partesLocais(ms, off); return `${p.dia}/${String(p.mes).padStart(2, '0')}`; },
  idade(ms) {
    if (!valido(ms)) return 'idade desconhecida';
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `há ${h} h${min % 60 && h < 6 ? ` ${min % 60} min` : ''}`;
    return `há ${Math.round(h / 24)} dias`;
  },
};

export function ausente(texto = 'sem dado') { return el('span', { class: 'ausente', text: texto }); }
export const valOu = (v, texto = 'sem dado') => (v === null || v === undefined ? ausente(texto) : v);

// Barramento simples para sincronizar o horário tocado entre faixa e gráficos.
const ouvintes = new Map();
export const bus = {
  on(ev, fn) { if (!ouvintes.has(ev)) ouvintes.set(ev, new Set()); ouvintes.get(ev).add(fn); return () => ouvintes.get(ev).delete(fn); },
  emit(ev, dado, origem) { for (const fn of ouvintes.get(ev) || []) fn(dado, origem); },
};

export function secao(titulo, fonte, ...filhos) {
  return el('section', { class: 'secao' }, el('h2', { text: titulo }), fonte ? el('p', { class: 'fonte', text: fonte }) : null, ...filhos);
}

export function mostrarInfo(titulo, ...conteudo) {
  const d = document.getElementById('dlg-info');
  document.getElementById('dlg-info-t').textContent = titulo;
  const c = document.getElementById('dlg-info-corpo');
  c.replaceChildren(...conteudo.filter((x) => x !== null && x !== undefined && x !== false));
  d.showModal();
}

export const prefs = {
  ler(k, padrao) { try { const v = localStorage.getItem('pref:' + k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem('pref:' + k, JSON.stringify(v)); } catch {} },
};

export const cor = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#888';

/**
 * Seletor compacto: um único botão com a opção atual que abre a lista nativa do sistema
 * (no iPhone, a roleta). Substitui fileiras de botões de filtro que poluem a tela.
 * @param {string} rotulo nome acessível
 * @param {Array<[string,string]>} opcoes pares [valor, nome]
 * @param {string} atual valor escolhido
 * @param {(valor:string)=>void} aoMudar
 */
export function seletor(rotulo, opcoes, atual, aoMudar) {
  const s = el('select', { 'aria-label': rotulo, onchange: () => aoMudar(s.value) },
    ...opcoes.map(([v, nome]) => el('option', { value: v, selected: v === atual }, nome)));
  return el('label', { class: 'seletor' }, s);
}
