// Escolha do local: abas de cidade no topo (posição atual + favoritas) e a janela "Escolher local",
// com busca por nome (autocompletar), favoritas e recentes. Regras e listas puras ficam em js/cidades.js;
// a troca de local e a previsão ficam no app.js, que entra pelos retornos de criarLocais.
import { el, svg, prefs } from './ui.js';
import { buscarCidades } from './dados.js';
import { CONFIG } from './config.js';
import {
  LIMITES, dobrar, mesmoLocal, trechosDestaque, casaConsulta, alternarFavorita, moverFavorita, adicionarRecente, listaValida,
} from './cidades.js';

/** Espera depois da última tecla antes de buscar: uma chamada por pausa na digitação, não por tecla. */
const ESPERA_DIGITACAO_MS = 220;
/** Respostas guardadas em memória (apagar e redigitar não repete a chamada). */
const MEMORIA_MAX = 40;

const ICONES = {
  gps: 'M3.5 11.2 20.5 3.5l-7.7 17-2-7.3z',
  estrela: 'M12 3.4l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.8l-5.3 2.8 1-5.9-4.3-4.1 5.9-.8z',
  lupa: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.4 15.4 20 20',
  certo: 'M5 12.5l4.5 4.5L19 7.5',
  relogio: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.3l3 1.8',
  cima: 'M12 18.5v-13M6.5 11 12 5.5l5.5 5.5',
  baixo: 'M12 5.5v13M6.5 13l5.5 5.5 5.5-5.5',
  fechar: 'M6 6l12 12M18 6 6 18',
};
const icone = (nome, classe = 'ic') => svg('svg', { viewBox: '0 0 24 24', class: classe, 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: ICONES[nome] }));

/**
 * Monta as abas de cidade e a janela de busca.
 * @param {object} op
 * @param {() => ({origem:string, lat:number, lon:number, id?:number|null, nome:string}|null)} op.atual local em uso
 * @param {(cidade:object) => void} op.escolherCidade troca para a cidade (favorita, recente ou resultado da busca)
 * @param {() => void} op.usarGps volta para a posição atual do aparelho
 * @param {(favoritas:Array<object>, removida:object|null) => void} [op.aoMudarFavoritas]
 * @returns {{abrir:()=>void, renderAbas:()=>void, favoritas:()=>Array<object>, ehFavorita:(l:object)=>boolean}}
 */
export function criarLocais({ atual, escolherCidade, usarGps, aoMudarFavoritas }) {
  let favoritas = listaValida(prefs.ler('favoritas', []), LIMITES.favoritas);
  let recentes = listaValida(prefs.ler('recentes', []), LIMITES.recentes);
  const dlg = document.getElementById('dlg-local');
  const campo = document.getElementById('busca');
  const limpar = document.getElementById('busca-limpar');
  const status = document.getElementById('busca-estado');
  const lista = document.getElementById('lista-locais');
  const abas = document.getElementById('cidades');
  const memoria = new Map();
  // estado da busca: texto digitado, resultados da API para ele, erro e busca em andamento
  const busca = { texto: '', resultados: null, erro: null, buscando: false, timer: 0, ctl: null };
  let ordenando = false, assinaturaAbas = '', aviso = '';

  const padrao = { id: null, nome: CONFIG.padrao.nome, regiao: CONFIG.padrao.regiao, lat: CONFIG.padrao.lat, lon: CONFIG.padrao.lon };
  const ehFavorita = (l) => favoritas.some((f) => mesmoLocal(f, l));
  const ehAtual = (l) => { const a = atual(); return a?.origem === 'cidade' && mesmoLocal(a, l); };
  const gpsAtivo = () => atual()?.origem !== 'cidade';

  // ---------------------------------------------------------------- listas salvas

  function gravar() { prefs.gravar('favoritas', favoritas); prefs.gravar('recentes', recentes); }

  function alternar(c) {
    const era = ehFavorita(c);
    const nova = alternarFavorita(favoritas, c);
    if (nova === favoritas) { aviso = `Limite de ${LIMITES.favoritas} favoritas. Tire uma para incluir outra.`; renderLista(); return; }
    favoritas = nova; aviso = '';
    if (!favoritas.length) ordenando = false;
    gravar();
    aoMudarFavoritas?.(favoritas, era ? c : null);
    renderAbas(); renderLista();
  }

  function mover(c, delta) { favoritas = moverFavorita(favoritas, c, delta); gravar(); renderAbas(); renderLista(); }

  function escolher(c) {
    recentes = adicionarRecente(recentes, c);
    gravar();
    if (dlg.open) dlg.close();
    escolherCidade(c);
  }

  function voltarGps() { if (dlg.open) dlg.close(); usarGps(); }

  // ---------------------------------------------------------------- abas de cidade (topo)

  /**
   * Faixa de abas abaixo do nome do local: "Aqui" (GPS), as favoritas e, se a cidade em uso não for favorita,
   * uma aba para ela com a estrela de favoritar. Sem favoritas e no GPS, a faixa some (tela limpa).
   * Só redesenha quando o local ou as favoritas mudam (atualizarCabecalho chama a cada minuto).
   */
  function renderAbas() {
    const a = atual();
    const avulsa = a?.origem === 'cidade' && !ehFavorita(a) ? a : null;
    const assinatura = JSON.stringify([a?.origem, a?.id, a && Math.round(a.lat * 100), a && Math.round(a.lon * 100), favoritas.map((f) => f.id ?? f.nome)]);
    if (assinatura === assinaturaAbas) return;
    assinaturaAbas = assinatura;
    abas.hidden = !favoritas.length && !avulsa;
    if (abas.hidden) { abas.replaceChildren(); return; }
    const aba = (rotulo, ativo, aoTocar, titulo, ...extra) => el('button', {
      type: 'button', class: 'aba-cidade', 'aria-current': ativo ? 'true' : null, title: titulo, onclick: ativo ? null : aoTocar,
    }, ...extra, el('span', { text: rotulo }));
    const itens = [
      aba('Aqui', gpsAtivo(), voltarGps, 'Sua localização atual (GPS)', icone('gps')),
      ...favoritas.map((f) => aba(f.nome, ehAtual(f), () => escolher(f), [f.nome, f.regiao].filter(Boolean).join(', '))),
    ];
    if (avulsa) {
      itens.push(el('span', { class: 'aba-avulsa' },
        aba(avulsa.nome, true, null, [avulsa.nome, avulsa.regiao].filter(Boolean).join(', ')),
        el('button', { type: 'button', class: 'aba-estrela', 'aria-label': `Favoritar ${avulsa.nome}`, title: 'Favoritar', onclick: () => alternar(avulsa) }, icone('estrela'))));
    }
    itens.push(el('button', { type: 'button', class: 'aba-cidade aba-buscar', 'aria-label': 'Buscar cidade', title: 'Buscar cidade', onclick: abrir }, icone('lupa')));
    abas.replaceChildren(...itens);
    // a aba em uso fica visível mesmo com muitas favoritas (rolagem horizontal só da faixa)
    const ativa = abas.querySelector('[aria-current="true"]');
    if (ativa) requestAnimationFrame(() => {
      const fim = ativa.offsetLeft + ativa.offsetWidth;
      if (ativa.offsetLeft < abas.scrollLeft || fim > abas.scrollLeft + abas.clientWidth) abas.scrollLeft = ativa.offsetLeft - 16;
    });
  }

  // ---------------------------------------------------------------- janela "Escolher local"

  function abrir() {
    campo.value = '';
    definirTexto('');
    ordenando = false; aviso = '';
    renderLista();
    dlg.showModal();
    lista.scrollTop = 0;
    // No celular, o teclado só abre se não houver nada salvo para tocar; no computador, o cursor já fica na busca.
    if (matchMedia('(pointer: fine)').matches || (!favoritas.length && !recentes.length)) campo.focus();
    else dlg.querySelector('.dlg-topo button')?.focus({ preventScroll: true });
  }

  function definirTexto(texto) {
    busca.texto = texto;
    limpar.hidden = !texto;
    clearTimeout(busca.timer);
    busca.ctl?.abort();
    busca.erro = null;
    const q = texto.trim();
    if (q.length < 2) { busca.resultados = null; busca.buscando = false; return; }
    const guardado = memoria.get(dobrar(q));
    if (guardado) { busca.resultados = guardado; busca.buscando = false; return; }
    busca.buscando = true; // os resultados anteriores ficam na tela até os novos chegarem (sem piscar)
    busca.timer = setTimeout(() => executarBusca(q), ESPERA_DIGITACAO_MS);
  }

  async function executarBusca(q) {
    const ctl = new AbortController();
    busca.ctl = ctl;
    try {
      const r = await buscarCidades(q, { signal: ctl.signal });
      if (memoria.size >= MEMORIA_MAX) memoria.delete(memoria.keys().next().value);
      memoria.set(dobrar(q), r);
      if (busca.ctl !== ctl) return;
      busca.resultados = r;
    } catch (e) {
      if (busca.ctl !== ctl || e?.tipo === 'cancelada') return;
      busca.resultados = null;
      busca.erro = e;
    }
    busca.buscando = false;
    renderLista();
  }

  function mensagemErro(e) {
    if (e?.tipo === 'offline') return 'Sem internet. A busca precisa de conexão; as cidades salvas continuam aqui.';
    if (e?.tipo === 'limite') return 'Busca indisponível por alguns minutos (limite de uso). Tente mais tarde.';
    return 'Não foi possível buscar agora.';
  }

  /** Linha de cidade: tocar escolhe; a estrela favorita sem fechar a janela; no modo ordenar, setas no lugar da estrela. */
  function linha(c, { tipo = 'cidade', destaque = '' } = {}) {
    const emUso = tipo === 'gps' ? gpsAtivo() : ehAtual(c);
    const fav = tipo === 'cidade' && ehFavorita(c);
    const nome = destaque ? trechosDestaque(c.nome, destaque).map((t) => (t.destaque ? el('mark', { text: t.texto }) : t.texto)) : [c.nome];
    const lado = tipo === 'gps' ? icone('gps') : fav ? icone('estrela', 'ic ic-fav') : tipo === 'recente' ? icone('relogio') : null;
    const escolhe = el('button', {
      type: 'button', class: 'local-escolher', 'aria-current': emUso ? 'true' : null,
      onclick: () => (tipo === 'gps' ? voltarGps() : escolher(c)),
    }, el('span', { class: 'local-marca' }, lado), el('span', { class: 'local-txt' }, el('b', {}, ...nome), c.regiao ? el('small', { text: c.regiao }) : null),
    emUso ? el('span', { class: 'local-uso' }, icone('certo'), el('span', { class: 'sr', text: 'em uso' })) : null);
    let acao = null;
    if (tipo !== 'gps' && ordenando && fav) {
      const i = favoritas.findIndex((f) => mesmoLocal(f, c));
      acao = el('span', { class: 'local-ordem' },
        el('button', { type: 'button', 'aria-label': `Subir ${c.nome}`, disabled: i === 0, onclick: () => mover(c, -1) }, icone('cima')),
        el('button', { type: 'button', 'aria-label': `Descer ${c.nome}`, disabled: i === favoritas.length - 1, onclick: () => mover(c, 1) }, icone('baixo')));
    } else if (tipo !== 'gps') {
      acao = el('button', {
        type: 'button', class: 'local-estrela', 'aria-pressed': String(fav), title: fav ? 'Tirar das favoritas' : 'Favoritar',
        'aria-label': `${fav ? 'Tirar das favoritas' : 'Favoritar'}: ${c.nome}`, onclick: () => alternar(c),
      }, icone('estrela'));
    }
    return el('li', { class: 'linha-local' }, escolhe, acao);
  }

  function grupo(titulo, linhas, acao = null) {
    if (!linhas.length) return null;
    return el('section', { class: 'grupo-locais' },
      titulo ? el('div', { class: 'grupo-topo' }, el('h3', { text: titulo }), acao) : null,
      el('ul', {}, ...linhas));
  }

  function renderLista() {
    const q = busca.texto.trim();
    const salvasRecentes = recentes.filter((r) => !ehFavorita(r));
    const blocos = [];
    let estado = aviso;
    if (!q) {
      const mostrarPadrao = !ehFavorita(padrao) && !salvasRecentes.some((r) => mesmoLocal(r, padrao));
      blocos.push(grupo(null, [
        linha({ nome: 'Sua localização atual', regiao: 'Pelo GPS do aparelho' }, { tipo: 'gps' }),
        mostrarPadrao ? linha({ ...padrao, regiao: `${padrao.regiao} · padrão do app` }) : null,
      ].filter(Boolean)));
      blocos.push(grupo('Favoritas', favoritas.map((f) => linha(f)),
        favoritas.length > 1 ? el('button', { type: 'button', class: 'grupo-acao', onclick: () => { ordenando = !ordenando; renderLista(); } }, ordenando ? 'Pronto' : 'Ordenar') : null));
      blocos.push(grupo('Recentes', salvasRecentes.map((r) => linha(r, { tipo: 'recente' })),
        el('button', { type: 'button', class: 'grupo-acao', onclick: () => { recentes = recentes.filter(ehFavorita); gravar(); renderLista(); } }, 'Limpar')));
      if (!favoritas.length) estado = estado || 'Toque na estrela de uma cidade para criar uma aba de atalho no topo.';
    } else {
      // salvas que casam com o texto aparecem na hora; a resposta da busca entra abaixo, sem repetir
      const salvas = [...favoritas, ...salvasRecentes].filter((c) => casaConsulta(c, q));
      const novas = (busca.resultados || []).filter((r) => !salvas.some((s) => mesmoLocal(s, r)));
      blocos.push(grupo(salvas.length && novas.length ? 'Salvas' : null, salvas.map((c) => linha(c, { tipo: ehFavorita(c) ? 'cidade' : 'recente', destaque: q }))));
      blocos.push(grupo(salvas.length && novas.length ? 'Outras cidades' : null, novas.map((c) => linha(c, { destaque: q }))));
      if (busca.erro) estado = mensagemErro(busca.erro);
      else if (busca.buscando) estado = 'Buscando…';
      else if (q.length < 2) estado = salvas.length ? '' : 'Digite pelo menos 2 letras.';
      else if (busca.resultados && !salvas.length && !novas.length) estado = 'Nenhuma cidade encontrada. Confira a grafia.';
    }
    status.replaceChildren(estado || '',
      busca.erro && !['limite', 'offline'].includes(busca.erro.tipo) ? el('button', { type: 'button', class: 'grupo-acao', onclick: () => { definirTexto(busca.texto); renderLista(); } }, 'Tentar de novo') : null);
    status.hidden = !estado;
    lista.replaceChildren(...blocos.filter(Boolean));
  }

  // ---------------------------------------------------------------- teclado e eventos

  /** Setas percorrem as cidades; Enter na busca escolhe a primeira; Esc com texto limpa antes de fechar. */
  function aoTeclar(e) {
    const botoes = [...lista.querySelectorAll('.local-escolher')];
    const i = botoes.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!botoes.length) return;
      e.preventDefault();
      const prox = e.key === 'ArrowDown' ? (i < 0 ? 0 : Math.min(i + 1, botoes.length - 1)) : i - 1;
      if (prox < 0) campo.focus(); else botoes[prox].focus();
    } else if (e.key === 'Enter' && e.target === campo) {
      e.preventDefault(); // o formulário do diálogo fecharia a janela
      if (busca.texto.trim().length >= 2) botoes[0]?.click();
    }
  }

  campo.addEventListener('input', () => { definirTexto(campo.value); renderLista(); });
  limpar.addEventListener('click', () => { campo.value = ''; definirTexto(''); renderLista(); campo.focus(); });
  dlg.addEventListener('keydown', aoTeclar);
  dlg.addEventListener('cancel', (e) => { if (campo.value) { e.preventDefault(); campo.value = ''; definirTexto(''); renderLista(); } });
  dlg.addEventListener('close', () => { clearTimeout(busca.timer); busca.ctl?.abort(); });
  // tocar fora da janela (no fundo escurecido) fecha
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  return { abrir, renderAbas, favoritas: () => favoritas, ehFavorita };
}
