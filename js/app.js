// Painel Meteorológico Pessoal: aplicação principal.
import { CONFIG } from './config.js';
import {
  REGRAS, MODELOS, valido, mediana, minimo, maximo, quantil, partesLocais, distanciaKm, arredondaCoord, direcaoTexto,
  indicesDoDia, resumoModeloDia, membrosDia, avaliarDia, probLimites, horasProvaveisDeChuva, fraseDoDia,
  horizonteDivergencia, pesosModelos, consensoHorario, escolherFonte, periodoDoDia, classeRajada,
  condicaoCeu, respostaChuva,
} from './analise.js';
import {
  buscarPrevisao, buscarEnsemble, buscarCidades, buscarObservacoes, buscarAlertas, buscarEnso, buscarAcerto,
  salvarCache, lerCache, workerConfigurado, MODELOS_ENSEMBLE, buscarAlertasDireto, buscarObservacoesDireto, buscarChuvaRadar,
} from './dados.js';
import { el, svg, fmt, setaVento, ausente, bus, secao, mostrarInfo, prefs, linkExterno } from './ui.js';
import { criarFaixa } from './faixa.js';
import { criarGrafico, limparGraficos, noitesDe } from './graficos.js';

const VERSAO = '1.2.0';
const $ = (s) => document.querySelector(s);

const estado = {
  local: null, aba: 'hoje',
  prev: null, prevEm: null, ens: null, ensEm: null, ensErros: [],
  obs: null, obsEm: null, alertas: null, alertasEm: null, enso: null, ensoEm: null, acerto: {}, acertoEm: null,
  erros: {}, cacheAntigo: false, faixas: [],
};

// Estações de verificação: as mesmas do Worker (coordenadas públicas das estações).
const VERIFICACAO = [
  { id: 'A884', nome: 'Campo Bom (INMET)', lat: -29.674, lon: -51.064, chuva: true },
  { id: 'A801', nome: 'Porto Alegre Jardim Botânico (INMET)', lat: -30.054, lon: -51.175, chuva: true },
  { id: 'SBCO', nome: 'Canoas (METAR)', lat: -29.945, lon: -51.144, chuva: false },
];

// ------------------------------------------------------------------ início

window.addEventListener('DOMContentLoaded', iniciar);

async function iniciar() {
  aplicarTema();
  $('#versao').textContent = `Versão ${VERSAO}. Regras de confiança em js/analise.js.`;
  configurarNavegacao();
  configurarLocal();
  configurarRodape();
  configurarPuxar();
  // aba: sempre Hoje, salvo se um detalhe estava aberto nesta sessão
  try { const s = sessionStorage.getItem('abaComDetalhe'); if (s) irPara(s, false); } catch {}

  estado.local = prefs.ler('local', null);
  // 1. mostra o que houver em cache imediatamente
  const c = await lerCache('previsao');
  if (c?.dados && estado.local) {
    estado.prev = reidratar(c.dados); estado.prevEm = c.salvoEm; estado.cacheAntigo = true;
    const e = await lerCache('ensemble'); if (e?.dados) { estado.ens = e.dados; estado.ensEm = e.salvoEm; }
    const o = await lerCache('observacoes'); if (o?.dados) { estado.obs = o.dados; estado.obsEm = o.salvoEm; }
    renderTudo();
  } else {
    mostrarCarregando();
  }
  // 2. localização: sempre a posição atual ao abrir o app. Uma cidade escolhida vale só até fechar o app.
  // 3. dados novos já com o último local salvo, em paralelo com o GPS; se a posição mudar, busca de novo
  let escolhaDaSessao = false;
  try { escolhaDaSessao = sessionStorage.getItem('localEscolhido') === '1'; } catch {}
  if (escolhaDaSessao && estado.local?.origem === 'cidade') { atualizarCabecalho(); await atualizar({ forcar: true }); }
  else {
    const antes = estado.local ? { lat: arredondaCoord(estado.local.lat), lon: arredondaCoord(estado.local.lon) } : null;
    const primeira = antes ? atualizar({ forcar: true }) : Promise.resolve();
    await localizarGps(true);
    await primeira;
    const agora = { lat: arredondaCoord(estado.local.lat), lon: arredondaCoord(estado.local.lon) };
    if (!antes || antes.lat !== agora.lat || antes.lon !== agora.lon) await atualizar({ forcar: true, local: !!antes });
  }
  agendar();
  if ('serviceWorker' in navigator) {
    // versão nova publicada: recarrega uma vez quando o novo service worker assume
    const tinha = !!navigator.serviceWorker.controller;
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !recarregou) { recarregou = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  }
}

function reidratar(p) { return p; }

function mostrarCarregando() {
  const alvo = $('#hoje-primeira');
  alvo.replaceChildren(el('p', { class: 'frase', text: 'Buscando a previsão…' }),
    el('p', { class: 'nota', text: 'Primeiro a resposta do dia; gráficos e mapa carregam depois.' }));
}

// ------------------------------------------------------------------ localização

function localizarGps(silencioso) {
  return new Promise((ok) => {
    const usarPadrao = (motivo) => {
      // sem GPS: o último local salvo (já arredondado); se não houver, o centro de Campo Bom
      if (estado.local && estado.local.origem !== 'padrao') {
        estado.avisoGps = `${motivo} Mostrando o último local usado (${estado.local.nome}); toque no nome do local para trocar.`;
        atualizarCabecalho(); ok(); return;
      }
      definirLocal({ ...CONFIG.padrao, origem: 'padrao' });
      estado.avisoGps = `${motivo} Usando o centro de Campo Bom; toque no nome do local para buscar outra cidade.`;
      atualizarCabecalho();
      ok();
    };
    if (!('geolocation' in navigator)) return usarPadrao('GPS não disponível neste navegador.');
    navigator.geolocation.getCurrentPosition((pos) => {
      // A coordenada exata fica só em memória, para distâncias no aparelho.
      estado.localExato = { lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy };
      estado.avisoGps = null;
      definirLocal({ nome: 'Sua localização', regiao: `GPS, precisão de ${Math.round(pos.coords.accuracy)} m`, lat: pos.coords.latitude, lon: pos.coords.longitude, origem: 'gps' });
      ok();
    }, (err) => {
      const m = { 1: 'Permissão de localização negada.', 2: 'GPS sem sinal.', 3: 'GPS demorou demais.' }[err.code] || 'GPS falhou.';
      usarPadrao(m);
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60000 });
  });
}

function definirLocal(l) {
  const mudou = !estado.local || Math.abs(arredondaCoord(estado.local.lat) - arredondaCoord(l.lat)) > 0.001 || Math.abs(arredondaCoord(estado.local.lon) - arredondaCoord(l.lon)) > 0.001;
  // salva só no aparelho e já arredondado: a posição exata não é persistida
  estado.local = { ...l, lat: l.lat, lon: l.lon };
  prefs.gravar('local', { nome: l.nome, regiao: l.regiao, origem: l.origem, lat: arredondaCoord(l.lat), lon: arredondaCoord(l.lon) });
  if (l.origem !== 'gps') estado.localExato = null;
  atualizarCabecalho();
  return mudou;
}

const pontoExato = () => estado.localExato || estado.local;

// Cidade escolhida à mão vale só nesta sessão; ao abrir o app de novo, volta para a posição atual.
function marcarEscolha(sim) { try { if (sim) sessionStorage.setItem('localEscolhido', '1'); else sessionStorage.removeItem('localEscolhido'); } catch {} }

function configurarLocal() {
  const dlg = $('#dlg-local');
  $('#btn-local').addEventListener('click', () => { dlg.showModal(); $('#busca').focus(); });
  $('#btn-gps').addEventListener('click', async () => { dlg.close(); marcarEscolha(false); await localizarGps(false); atualizar({ forcar: true, local: true }); });
  $('#btn-padrao').addEventListener('click', () => { dlg.close(); marcarEscolha(true); definirLocal({ ...CONFIG.padrao, origem: 'cidade' }); atualizar({ forcar: true, local: true }); });
  let t = null;
  $('#busca').addEventListener('input', (e) => {
    clearTimeout(t);
    const q = e.target.value;
    t = setTimeout(async () => {
      const lista = $('#resultados');
      if (q.trim().length < 2) { lista.replaceChildren(); return; }
      try {
        const r = await buscarCidades(q);
        lista.replaceChildren(...(r.length ? r.map((c) => el('li', {}, el('button', { type: 'button', onclick: () => {
          dlg.close(); marcarEscolha(true); definirLocal({ nome: c.nome, regiao: c.regiao, lat: c.lat, lon: c.lon, origem: 'cidade' }); atualizar({ forcar: true, local: true });
        } }, c.nome, el('small', { text: c.regiao })))) : [el('li', { class: 'nota', text: 'Nenhuma cidade encontrada.' })]));
      } catch (err) { lista.replaceChildren(el('li', { class: 'nota', text: 'Busca indisponível: ' + err.message })); }
    }, 450); // espera a pessoa parar de digitar: uma chamada por busca, não por tecla
  });
}

// ------------------------------------------------------------------ atualização

let atualizando = false;
async function atualizar({ forcar = false, local = false } = {}) {
  if (atualizando || !estado.local || estado.apagado) return;
  atualizando = true;
  $('#btn-atualizar').setAttribute('aria-busy', 'true');
  $('#btn-atualizar').setAttribute('aria-label', 'Atualizando');
  const venceu = (em, min) => forcar || local || !em || Date.now() - em > min * 60000;
  const I = CONFIG.intervalos;
  const { lat, lon } = estado.local;
  try {
    // Todas as fontes saem ao mesmo tempo; a primeira tela é desenhada assim que a previsão chega.
    if (local) { estado.ens = null; estado.obs = null; estado.alertas = null; }
    const tarefas = [];
    if (venceu(estado.prevEm, I.previsao)) tarefas.push(buscarPrevisao(lat, lon)
      .then((pv) => { estado.prev = pv; estado.prevEm = Date.now(); estado.cacheAntigo = false; delete estado.erros.previsao; salvarCache('previsao', pv); })
      .catch((e) => { estado.erros.previsao = e.message; })
      .then(() => renderTudo()));
    if (venceu(estado.ensEm, I.cenarios)) tarefas.push(buscarEnsemble(lat, lon).then(({ ens, erros }) => {
      estado.ensErros = erros;
      if (ens) { estado.ens = ens; estado.ensEm = Date.now(); salvarCache('ensemble', ens); delete estado.erros.ensemble; }
      else estado.erros.ensemble = erros.join('; ') || 'sem dados';
    }));
    const w = workerConfigurado();
    // Medições: Worker (INMET + METAR); sem ele, só a última leitura do INMET de Campo Bom direto.
    if (venceu(estado.obsEm, I.medicoes)) tarefas.push((w ? buscarObservacoes(lat, lon).catch(() => buscarObservacoesDireto()) : buscarObservacoesDireto())
      .then((o) => { estado.obs = o; estado.obsEm = Date.now(); salvarCache('observacoes', o); delete estado.erros.medicoes; })
      .catch((e) => { estado.erros.medicoes = e.message; }));
    // Alertas: Worker (resposta enxuta) ou INMET direto. Falha vira "Alertas indisponíveis".
    if (venceu(estado.alertasEm, I.alertas)) tarefas.push((w ? buscarAlertas().catch(() => buscarAlertasDireto()) : buscarAlertasDireto())
      .then((a) => { estado.alertas = a; estado.alertasEm = Date.now(); delete estado.erros.alertas; })
      .catch((e) => { estado.alertas = null; estado.erros.alertas = e.message; }));
    // Radar sobre o ponto: diz se está chovendo agora, mesmo entre as leituras horárias da estação.
    if (venceu(estado.radarAgoraEm, 5)) tarefas.push(buscarChuvaRadar(lat, lon)
      .then((r) => { estado.radarAgora = r; estado.radarAgoraEm = Date.now(); })
      .catch(() => { estado.radarAgora = null; }));
    if (w && venceu(estado.acertoEm, I.acerto) && !local) tarefas.push(Promise.all(VERIFICACAO.map((v) => buscarAcerto(v.id).then((a) => { estado.acerto[v.id] = a; }).catch(() => {}))).then(() => { estado.acertoEm = Date.now(); }));
    await Promise.all(tarefas);
    if (tarefas.length && estado.prev) renderTudo();
  } finally {
    atualizando = false;
    $('#btn-atualizar').removeAttribute('aria-busy');
    $('#btn-atualizar').setAttribute('aria-label', 'Atualizar');
    atualizarCabecalho();
  }
}

function agendar() {
  setInterval(() => { if (!document.hidden) atualizar(); atualizarCabecalho(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  window.addEventListener('online', () => atualizar());
  window.addEventListener('offline', () => avisar('Sem conexão. Mostrando os últimos dados salvos, que podem estar desatualizados.', true));
  $('#btn-atualizar').addEventListener('click', () => atualizar({ forcar: true }));
}

function atualizarCabecalho() {
  if (estado.local) {
    $('#local-nome').textContent = estado.local.nome;
    $('#btn-local').setAttribute('aria-label', `Local: ${estado.local.nome}. Toque para trocar.`);
  }
  const h = $('#local-hora');
  if (!estado.prevEm) { h.textContent = 'sem dados ainda'; return; }
  const atraso = Date.now() - estado.prevEm > 45 * 60000;
  h.textContent = `Previsão de ${fmt.horaMin(estado.prevEm, estado.prev?.offset ?? -10800)} (${fmt.idade(estado.prevEm)})${atraso ? ', desatualizada' : ''}`;
  h.classList.toggle('atrasado', atraso);
  renderAgora();
  const msgs = [];
  if (!navigator.onLine) msgs.push('Sem conexão: dados salvos podem estar desatualizados.');
  else if (estado.cacheAntigo) msgs.push('Mostrando dados salvos enquanto atualiza.');
  if (estado.erros.previsao) msgs.push(`Previsão não atualizou (${estado.erros.previsao}).`);
  if (estado.avisoGps && estado.local?.origem !== 'cidade') msgs.push(estado.avisoGps);
  if (msgs.length) avisar(msgs.join(' '), Boolean(estado.erros.previsao) || !navigator.onLine);
  else avisar('', false);
}

// Temperatura agora: medição da estação mais próxima (até 25 km e 2 h); sem ela, a previsão para esta hora.
function renderAgora() {
  const alvo = $('#agora');
  const p = estado.prev;
  const pt = pontoExato();
  const med = escolherFonte(fontesNormalizadas(), 'temperatura', pt.lat, pt.lon, Date.now(), 120).escolhida;
  if (med && med.distancia <= 25) {
    alvo.replaceChildren(el('span', { class: 'rot-agora', text: 'Agora' }), el('b', { text: fmt.c(med.valor) }), el('small', { text: `medido ${fmt.idade(med.ms)}` }));
    alvo.title = `${med.fonte.nome}, ${fmt.n(med.distancia, 0)} km`;
    return;
  }
  if (!p) { alvo.replaceChildren(); return; }
  const { pesos } = pesosAtuais();
  const mods = modelosAtivos();
  // valor "current" dos modelos (intervalo de 15 min); se faltar, a hora cheia mais recente
  let v = mediana(mods.map((m) => p.atual?.temp?.[m]), mods.map((m) => pesos[m] ?? 1));
  if (!valido(v)) v = p.atual?.geral ?? null;
  if (!valido(v)) {
    let i = -1;
    for (let k = 0; k < p.horas.length; k++) if (p.horas[k] <= Date.now()) i = k;
    v = i < 0 ? null : mediana(mods.map((m) => p.modelos[m].vars.temperature_2m?.[i]), mods.map((m) => pesos[m] ?? 1));
  }
  alvo.replaceChildren(el('span', { class: 'rot-agora', text: 'Agora' }), el('b', { text: fmt.c(v) ?? '–' }), el('small', { text: valido(v) ? 'previsto' : 'sem dado' }));
  alvo.title = 'Sem medição recente perto daqui; valor previsto pelos modelos para esta hora.';
}

function avisar(texto, erro) {
  const e = $('#estado');
  e.textContent = texto;
  e.classList.toggle('erro', !!erro);
}

// ------------------------------------------------------------------ análise por dia

function modelosAtivos() { return Object.keys(MODELOS).filter((m) => estado.prev?.modelos[m]); }

function estacaoAcerto() {
  const p = pontoExato();
  return VERIFICACAO.filter((v) => v.chuva && estado.acerto[v.id]?.dias)
    .sort((a, b) => distanciaKm(p.lat, p.lon, a.lat, a.lon) - distanciaKm(p.lat, p.lon, b.lat, b.lon))
    .map((v) => estado.acerto[v.id])[0] || null;
}

function pesosAtuais() {
  const a = estacaoAcerto()?.porModelo;
  const mapa = {};
  if (a) for (const m of Object.keys(a)) mapa[m] = { dias: a[m]?.[1]?.amostrasChuva ?? 0, maeChuva: a[m]?.[1]?.maeChuva };
  return pesosModelos(a ? mapa : null, modelosAtivos());
}

function acertoCtx(diaIndice) {
  const a = estacaoAcerto();
  if (!a?.porModelo) return null;
  const lead = Math.min(5, Math.max(1, diaIndice + 1));
  const taxas = Object.values(a.porModelo).map((m) => m?.[lead]?.taxaChuva);
  const amostras = maximo(Object.values(a.porModelo).map((m) => m?.[lead]?.amostrasChuva));
  const p = pontoExato();
  return { dias: amostras || 0, taxaChuva: mediana(taxas), distanciaKm: distanciaKm(p.lat, p.lon, a.estacao.lat, a.estacao.lon) };
}

function datas() {
  const p = estado.prev;
  const hoje = partesLocais(Date.now(), p.offset).data;
  return p.diario.datas.filter((d) => d >= hoje);
}

const cacheDias = new Map();
function analisarDia(data, diaIndice, desdeAgora) {
  const chave = `${data}|${desdeAgora}|${estado.prevEm}|${estado.ensEm}|${estado.obsEm}|${estado.acertoEm}`;
  if (cacheDias.has(chave)) return cacheDias.get(chave);
  const p = estado.prev, mods = modelosAtivos();
  const inicio = desdeAgora ? Date.now() : -Infinity;
  const idxTodo = indicesDoDia(p.horas, data, p.offset);
  const idx = indicesDoDia(p.horas, data, p.offset, inicio);
  const usar = idx.length ? idx : idxTodo;
  const { pesos, ajustado } = pesosAtuais();
  const resumos = mods.map((m) => resumoModeloDia(p, m, usar));
  const resumosTodo = mods.map((m) => resumoModeloDia(p, m, idxTodo));
  const membros = membrosDia(estado.ens, data, p.offset, inicio);
  const medAgora = diaIndice === 0 ? medicaoChuvaAgora() : null;
  const av = avaliarDia(resumos, membros, { diaIndice, acerto: acertoCtx(diaIndice), pesos, medicaoAgora: medAgora });
  const horasChuva = horasProvaveisDeChuva(p, usar, mods);
  // rajada: pico da mediana horária entre modelos, com horário e direção
  const cons = consensoHorario(p, 'wind_gusts_10m', mods);
  let pico = null;
  for (const i of usar) if (valido(cons.med[i]) && (!pico || cons.med[i] > cons.med[pico])) pico = i;
  const dirPico = pico === null ? null : direcaoMedia(mods.map((m) => p.modelos[m].vars.wind_direction_10m?.[pico]));
  const r = {
    data, diaIndice, idx: usar, idxTodo, resumos, membros, av, horasChuva, pesosAjustados: ajustado,
    frase: fraseDoDia(av, horasChuva.janela, p.offset),
    tmin: mediana(resumosTodo.map((x) => x.tmin), resumosTodo.map((x) => pesos[x.modelo] ?? 1)), tmax: mediana(resumosTodo.map((x) => x.tmax), resumosTodo.map((x) => pesos[x.modelo] ?? 1)),
    tminFaixa: [minimo(resumosTodo.map((x) => x.tmin)), maximo(resumosTodo.map((x) => x.tmin))],
    tmaxFaixa: [minimo(resumosTodo.map((x) => x.tmax)), maximo(resumosTodo.map((x) => x.tmax))],
    rajadaPico: pico === null ? null : { ms: p.horas[pico], valor: cons.med[pico], dir: dirPico },
    limites: probLimites(resumos, membros),
    modelosComDado: resumos.filter((x) => x.chuva !== null).map((x) => x.modelo),
  };
  cacheDias.set(chave, r);
  if (cacheDias.size > 60) cacheDias.delete(cacheDias.keys().next().value);
  return r;
}

function direcaoMedia(graus) {
  let x = 0, y = 0, n = 0;
  for (const g of graus) if (valido(g)) { x += Math.sin(g * Math.PI / 180); y += Math.cos(g * Math.PI / 180); n++; }
  return n ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null;
}

// ------------------------------------------------------------------ medições

function fontesNormalizadas() {
  // Converte a série de cada estação em "última leitura válida por variável".
  const out = [];
  for (const f of estado.obs?.fontes || []) {
    const leituras = {};
    const vars = ['temperatura', 'umidade', 'orvalho', 'pressao', 'vento', 'rajada', 'direcao', 'chuva', 'sensacao'];
    for (const v of vars) {
      for (let k = f.serie.length - 1; k >= 0; k--) {
        const ponto = f.serie[k];
        if (ponto[v] !== null && ponto[v] !== undefined) { leituras[v] = { valor: ponto[v], ms: ponto.ms }; break; }
      }
    }
    if (f.acumulados) for (const [k, a] of Object.entries(f.acumulados)) {
      const ultimo = f.serie.length ? f.serie[f.serie.length - 1].ms : null;
      if (valido(a.valor) && ultimo) leituras['chuva_' + k] = { valor: a.valor, ms: ultimo };
    }
    out.push({ ...f, leituras });
  }
  return out;
}

// Chuva agora, só com dado real: estação a até 25 km com leitura de até 90 min
// (acumulado da última hora) ou eco de radar sobre o ponto em quadro de até 20 min.
function medicaoChuvaAgora() {
  const p = pontoExato();
  const fontes = fontesNormalizadas();
  const e = escolherFonte(fontes, 'chuva_h1', p.lat, p.lon, Date.now(), 90).escolhida || escolherFonte(fontes, 'chuva', p.lat, p.lon, Date.now(), 90).escolhida;
  const est = e && e.distancia <= 25 ? e : null;
  const r = estado.radarAgora && Date.now() - estado.radarAgora.ms <= 20 * 60000 ? estado.radarAgora : null;
  if (!est && !r) return null;
  const chovendoEst = est ? est.valor >= REGRAS.chuvaHoraMm : false;
  const chovendoRadar = r ? r.chuva : false;
  return { chovendo: chovendoEst || chovendoRadar, estacao: est, radar: r };
}

// ------------------------------------------------------------------ render geral

function renderTudo() {
  if (!estado.prev) { renderSemPrevisao(); return; }
  for (const f of estado.faixas) f.destruir();
  estado.faixas = [];
  limparGraficos();
  const ds = datas();
  renderPrimeira($('#hoje-primeira'), ds[0], 0, true);
  if (ds[1]) renderPrimeira($('#amanha-primeira'), ds[1], 1, false);
  // detalhes depois da primeira tela, sem travar a abertura
  const depois = window.requestIdleCallback || ((fn) => setTimeout(fn, 30));
  depois(() => {
    const y = window.scrollY;
    renderHojeDetalhes();
    if (ds[1]) renderAmanhaDetalhes(ds[1]);
    renderSemana();
    renderModelos();
    if (estado.aba === 'elnino') renderElNino();
    window.scrollTo(0, y); // evita que a tela pule
  });
  atualizarCabecalho();
}

function renderSemPrevisao() {
  const msg = estado.erros.previsao || 'sem dados';
  $('#hoje-primeira').replaceChildren(el('p', { class: 'frase', text: 'Previsão indisponível' }),
    el('p', {}, `Não foi possível buscar a previsão (${msg}) e não há dados salvos neste aparelho. Verifique a conexão e toque em Atualizar.`),
    el('p', { class: 'nota' }, 'Em situação de risco, siga a Defesa Civil RS (199) e os avisos do INMET.'));
}

// ------------------------------------------------------------------ primeira tela (Hoje e Amanhã)

function renderPrimeira(alvo, data, diaIndice, desdeAgora) {
  const p = estado.prev;
  const a = analisarDia(data, diaIndice, desdeAgora);
  const av = a.av;
  const dataMs = p.horas[a.idxTodo[0]] ?? Date.now();
  const quando = diaIndice === 1
    ? `Amanhã, ${fmt.diaSemana(dataMs, p.offset)} ${fmt.dataCurta(dataMs, p.offset)}`
    : `Hoje, ${fmt.diaSemana(dataMs, p.offset)} ${fmt.dataCurta(dataMs, p.offset)}, até 23h`;

  // céu: consenso horário entre modelos; hoje só as horas que faltam
  const mods = modelosAtivos();
  const nuv = consensoHorario(p, 'cloud_cover', mods).med;
  const dia = consensoHorario(p, 'is_day', mods).med;
  const ceu = condicaoCeu(a.idx.map((i) => nuv[i]), a.idx.map((i) => (valido(dia[i]) ? Math.round(dia[i]) : null)), av.prob);

  // chuva: resposta curta, chance, volume e horário
  const agoraChuva = diaIndice === 0 ? medicaoChuvaAgora() : null;
  const chovendo = !!agoraChuva?.chovendo;
  const resp = chovendo ? 'Chovendo agora' : respostaChuva(av.prob);
  if (chovendo && ceu) { ceu.chuva = 'provavel'; ceu.texto = ceu.nivel === 'limpo' || ceu.nivel === 'poucas' ? 'Pancadas de chuva' : 'Chuva'; }
  const temChuva = av.prob !== null && av.prob >= REGRAS.ocorrencia.poucoProvavel;
  const detalhe = [];
  if (chovendo) {
    const es = agoraChuva.estacao, ra = agoraChuva.radar;
    if (es && es.valor >= REGRAS.chuvaHoraMm) detalhe.push(`medido ${fmt.n(es.valor, 1)} mm na última hora (${es.fonte.nome}, ${fmt.idade(es.ms)})`);
    if (ra?.chuva) detalhe.push(`radar mostra chuva aqui (${fmt.idade(ra.ms)})`);
    detalhe.push(av.prob === null ? 'depois: previsão sem dado' : `depois: ${(respostaChuva(av.prob) || '').toLowerCase()}`);
  }
  if (temChuva && av.volume) detalhe.push(`cerca de ${fmt.mm(av.volume.mediana)}${av.volumeIncerto ? ` (provável entre ${fmt.n(av.volume.min, 0)} e ${fmt.n(av.volume.max, 0)} mm)` : ''}`);
  const jan = a.horasChuva.janela;
  if (temChuva && jan) detalhe.push(`mais provável ${fmt.hora(jan.ini, p.offset)} a ${fmt.hora(jan.fim + 3600000, p.offset)}`);

  const botaoConf = el('button', { type: 'button', class: 'confianca', 'data-n': av.confianca.geral, onclick: () => explicarConfianca(a) },
    el('span', { class: 'nivel', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), `Confiança ${av.confianca.geral}`);
  const resumo = el('div', { class: 'resumo', 'data-ceu': ceu?.nivel || 'sem', 'data-chuva': ceu?.chuva || (temChuva ? 'pouca' : 'nao') },
    el('div', { class: 'resumo-topo' }, el('p', { class: 'resumo-quando', text: quando }), botaoConf),
    el('div', { class: 'resumo-ceu' },
      iconeCeu(ceu),
      el('span', { class: 'cond' }, ceu ? ceu.texto : ausente('céu sem dado'))),
    el('div', { class: 'resumo-temp' },
      el('span', { class: 'bloco-t min' }, el('small', { text: 'mínima' }), el('b', { class: 'tmin', text: fmt.c(a.tmin) ?? '–' })),
      el('span', { class: 'bloco-t max' }, el('small', { text: 'máxima' }), el('b', { class: 'tmax', text: fmt.c(a.tmax) ?? '–' })),
      el('span', { class: 'bloco-t chuva' }, el('small', { text: 'chuva' }), el('b', { text: chovendo ? 'agora' : (av.prob === null ? '–' : fmt.pct(av.prob)) }))),
    el('div', { class: 'resumo-chuva' + (chovendo ? ' chovendo' : '') },
      el('strong', {}, resp || 'Chuva sem dado', chovendo ? el('span', { class: 'marca medido', text: agoraChuva.estacao?.valor >= REGRAS.chuvaHoraMm ? 'medido' : 'radar' }) : null),
      el('span', { class: 'det', text: detalhe.join(' · ') || ' ' })));

  const filhos = [resumo, linhaAlerta()];

  // rajada
  const rp = a.rajadaPico;
  filhos.push(el('div', { class: 'linha-rajada' },
    el('span', { class: 'raj' },
      el('span', { class: 'rot', text: 'Rajada ' }),
      rp ? el('strong', { text: `${Math.round(av.rajada?.mediana ?? rp.valor)} km/h` }) : ausente('sem dado'),
      rp ? el('span', { class: 'raj-det' }, ` de ${direcaoTexto(rp.dir) || '?'} `, setaVento(rp.dir), ` às ${fmt.hora(rp.ms, p.offset)}`) : '')));

  // Gráfico: chance de chuva hora a hora (padrão) ou Faixa do Céu
  // só as horas deste dia: hoje, da hora atual até 23h; amanhã, de 0h a 23h
  const ini = p.horas[(desdeAgora && a.idx.length ? a.idx : a.idxTodo)[0]];
  const fim = p.horas[a.idxTodo[a.idxTodo.length - 1]] + 3600000;
  const caixa = el('div', { class: 'grafico-primeira' });
  let modo = 'chance';
  const botoes = el('div', { class: 'troca', role: 'group', 'aria-label': 'Gráfico' });
  const desenharModo = () => {
    botoes.replaceChildren(...[['chance', 'Chance de chuva'], ['ceu', 'Faixa do Céu']].map(([k, nome]) =>
      el('button', { type: 'button', 'aria-pressed': String(modo === k), onclick: () => { modo = k; desenharModo(); } }, nome)));
    caixa.replaceChildren();
    if (modo === 'chance') caixa.append(graficoChance(ini, fim));
    else estado.faixas.push(criarFaixa(caixa, { prev: p, modelos: mods, iniMs: ini, fimMs: fim, id: 'faixa-' + diaIndice }));
  };
  filhos.push(botoes, caixa);
  alvo.replaceChildren(...filhos);
  desenharModo();
}

// Chance de chuva por hora: fração dos cenários do ensemble com pelo menos REGRAS.chuvaHoraMm (0,2 mm) na hora.
// Sem ensemble, mediana da probabilidade dos modelos que a publicam. Sem dado, a barra fica vazia.
function chanceHoraria(ms) {
  const fontes = Object.values(estado.ens || {});
  let total = 0, comChuva = 0;
  for (const e of fontes) {
    const i = e.horas.indexOf(ms);
    if (i < 0) continue;
    for (const m of e.membros.precipitation || []) { if (valido(m[i])) { total++; if (m[i] >= REGRAS.chuvaHoraMm) comChuva++; } }
  }
  if (total >= 10) return { p: comChuva / total, origem: 'cenários' };
  const p = estado.prev, i = p.horas.indexOf(ms);
  const v = i < 0 ? null : mediana(modelosAtivos().map((m) => p.modelos[m].vars.precipitation_probability?.[i]));
  return valido(v) ? { p: v / 100, origem: 'modelos' } : { p: null, origem: null };
}

function graficoChance(iniMs, fimMs) {
  const p = estado.prev, mods = modelosAtivos();
  const mm = consensoHorario(p, 'precipitation', mods).med;
  const pontos = [];
  p.horas.forEach((ms, i) => { if (ms >= iniMs && ms < fimMs) pontos.push({ ms, mm: mm[i], ...chanceHoraria(ms) }); });
  // hora atual: se está chovendo (estação ou radar), a barra vira 100% medido
  const agoraM = medicaoChuvaAgora();
  for (const x of pontos) if (agoraM?.chovendo && Date.now() >= x.ms && Date.now() < x.ms + 3600000) { x.p = 1; x.origem = 'medido'; x.medido = true; }
  const info = el('p', { class: 'chance-info', 'aria-live': 'polite' });
  const validos = pontos.filter((x) => valido(x.p));
  const maior = validos.reduce((b, x) => (!b || x.p > b.p ? x : b), null);
  const futuro = validos.filter((x) => !x.medido);
  const maiorF = futuro.reduce((b, x) => (!b || x.p > b.p ? x : b), null);
  const resumo = () => (agoraM?.chovendo ? `Chovendo agora.${maiorF ? ` Depois, maior chance: ${fmt.pct(maiorF.p)} às ${fmt.hora(maiorF.ms, p.offset)}.` : ''}` : maior ? `Maior chance no dia: ${fmt.pct(maior.p)} às ${fmt.hora(maior.ms, p.offset)}. Toque numa barra.` : 'Chance de chuva por hora sem dado.');
  info.textContent = resumo();
  const origem = validos.some((x) => x.origem === 'cenários') ? 'cenários do ensemble' : 'probabilidade dos modelos';
  const barras = el('div', { class: 'chance-barras', role: 'img', 'aria-label': `Chance de chuva por hora. ${resumo()}` },
    el('i', { class: 'guia g50', 'aria-hidden': 'true' }), el('i', { class: 'guia g100', 'aria-hidden': 'true' }),
    ...pontos.map((x, k) => {
      const agora = Date.now() >= x.ms && Date.now() < x.ms + 3600000;
      return el('button', { type: 'button', class: 'barra-c' + (agora ? ' agora' : ''), 'aria-label': `${fmt.hora(x.ms, p.offset)}: ${valido(x.p) ? fmt.pct(x.p) : 'sem dado'}`,
        onclick: () => { info.textContent = `${fmt.hora(x.ms, p.offset)}: ${x.medido ? 'chovendo agora (medido)' : valido(x.p) ? fmt.pct(x.p) + ' de chance' : 'sem dado'}${valido(x.mm) ? `, ${fmt.n(x.mm, 1)} mm previstos` : ''}`; } },
        el('i', { class: valido(x.p) ? (x.medido ? 'medido' : '') : 'sem', style: { height: valido(x.p) ? `${Math.max(2, x.p * 100)}%` : '100%' } }),
        valido(x.p) && x.p >= 0.3 && (k === 0 || !valido(pontos[k - 1].p) || Math.abs(x.p - pontos[k - 1].p) >= 0.1 || x === maior) ? el('span', { text: Math.round(x.p * 100) }) : null);
    }));
  const eixo = el('div', { class: 'chance-eixo', 'aria-hidden': 'true' },
    ...pontos.map((x) => { const h = partesLocais(x.ms, p.offset).hora; return el('span', { text: h % 3 === 0 ? (h === 0 ? fmt.diaSemana(x.ms, p.offset) : `${h}h`) : '' }); }));
  return el('div', { class: 'chance' }, barras, eixo, info, el('p', { class: 'chance-fonte', text: `Previsão: ${origem}. 50% e 100% marcados.` }));
}

// Ícone de linha (SVG, sem emoji): sol ou lua, nuvem e gotas conforme o céu previsto.
function iconeCeu(ceu) {
  const s = svg('svg', { viewBox: '0 0 48 48', class: 'icone-ceu', 'aria-hidden': 'true' });
  if (!ceu) { s.append(svg('circle', { cx: 24, cy: 24, r: 10, class: 'tr', 'stroke-dasharray': '3 4' })); return s; }
  const astro = (cx, cy, r) => {
    if (ceu.noite) return svg('path', { class: 'tr', d: `M${cx + r * 0.3} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.7} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.7} ${-r * 1.55}z` });
    const g = svg('g', { class: 'tr' });
    g.append(svg('circle', { cx, cy, r }));
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4, r1 = r + 3, r2 = r + 6.5;
      g.append(svg('line', { x1: (cx + r1 * Math.cos(ang)).toFixed(1), y1: (cy + r1 * Math.sin(ang)).toFixed(1), x2: (cx + r2 * Math.cos(ang)).toFixed(1), y2: (cy + r2 * Math.sin(ang)).toFixed(1) }));
    }
    return g;
  };
  const nuvem = (dx, dy, k) => svg('path', { class: 'tr nuvem', transform: `translate(${dx} ${dy}) scale(${k})`, d: 'M10 30 h24 a7 7 0 0 0 0-14 a10 10 0 0 0-19-2 a8 8 0 0 0-5 16z' });
  const comChuva = !!ceu.chuva;
  if (ceu.nivel === 'limpo' && !comChuva) s.append(astro(24, 24, 9));
  else if (ceu.nivel === 'limpo' || ceu.nivel === 'poucas') { s.append(astro(17, 16, 7)); s.append(nuvem(8, comChuva ? 2 : 8, 0.95)); }
  else if (ceu.nivel === 'parcial') { s.append(astro(15, 14, 6)); s.append(nuvem(5, comChuva ? 2 : 6, 1.05)); }
  else s.append(nuvem(3, comChuva ? 0 : 4, 1.1));
  if (comChuva) {
    const n = ceu.chuva === 'provavel' ? 3 : 2;
    for (let k = 0; k < n; k++) { const x = 16 + k * 8; s.append(svg('line', { class: 'gota', x1: x, y1: 37, x2: x - 3, y2: 44 })); }
  }
  return s;
}

function linhaAlerta() {
  if (!estado.alertas || estado.alertas.indisponivel) return el('button', { type: 'button', class: 'alerta indisponivel', onclick: () => mostrarInfo('Alertas', el('p', { text: 'A consulta aos avisos do INMET falhou. Isso não significa que não há alertas.' }), linkExterno('https://alertas2.inmet.gov.br/', 'Avisos do INMET')) }, 'Alertas indisponíveis');
  const meus = alertasDoLocal();
  if (!meus.length) return el('p', { class: 'nota', style: { margin: '2px 0' } }, `Nenhum aviso do INMET encontrado para este local (consulta ${fmt.idade(estado.alertasEm)}).`);
  const a = meus[0];
  return el('button', { type: 'button', class: 'alerta', onclick: () => detalheAlertas(meus) },
    `INMET: ${a.titulo}${a.severidade ? `, ${a.severidade.toLowerCase()}` : ''}${meus.length > 1 ? ` (+${meus.length - 1})` : ''}`);
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function dentroPoligono(lat, lon, pol) {
  let dentro = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [yi, xi] = pol[i], [yj, xj] = pol[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function alertasDoLocal() {
  const p = pontoExato();
  const pertoDeCampoBom = distanciaKm(p.lat, p.lon, CONFIG.padrao.lat, CONFIG.padrao.lon) < 6 || semAcento(estado.local.nome) === 'campo bom';
  const noRS = p.lat < -27 && p.lat > -34 && p.lon > -58 && p.lon < -49.5;
  return (estado.alertas?.avisos || []).filter((a) => {
    if (pertoDeCampoBom && a.municipioPadrao) return true; // lista oficial de municípios (código IBGE)
    if (a.poligonos?.length) return a.poligonos.some((pol) => dentroPoligono(p.lat, p.lon, pol)); // teste feito no aparelho
    if (estado.alertas?.semArea && noRS && /rio grande do sul|\bRS\b/i.test(`${a.titulo} ${a.descricao || ''}`)) { a.incerto = true; return true; }
    return false;
  });
}
function detalheAlertas(lista) {
  mostrarInfo('Avisos do INMET', ...lista.map((a) => el('div', { class: 'secao' },
    el('h2', { text: a.titulo }),
    el('p', { class: 'fonte', text: [a.severidade, a.inicio && `início ${a.inicio}`, a.fim && `fim ${a.fim}`].filter(Boolean).join(', ') }),
    a.incerto ? el('p', { class: 'nota', text: 'Aviso para parte do RS. Confira no INMET se inclui o seu município.' }) : null,
    a.descricao ? el('p', { text: a.descricao }) : null,
    ...(a.riscos || []).map((r) => el('p', { text: r })),
    ...(a.instrucoes || []).map((r) => el('p', { class: 'nota', text: r })))),
  el('p', { class: 'oficial', text: 'Siga as orientações da Defesa Civil (199) e do INMET.' }), linkExterno('https://alertas2.inmet.gov.br/', 'Abrir avisos no INMET'));
}

function explicarConfianca(a) {
  const c = a.av.confianca;
  mostrarInfo(`Confiança ${c.geral}`,
    el('p', {}, `Chuva: ${c.chuva}. Rajadas: ${c.rajada}. A confiança geral é a menor das duas.`),
    el('p', {}, a.av.fonteProb ? `Chance de chuva calculada por ${a.av.fonteProb}.` : 'Sem dados para calcular a chance de chuva.'),
    c.motivos.length ? el('ul', {}, ...c.motivos.map((m) => el('li', { text: m }))) : el('p', { text: 'Modelos e cenários concordam.' }),
    a.pesosAjustados ? el('p', { class: 'nota', text: 'Pesos dos modelos ajustados pelo acerto local dos últimos 30 dias ou mais.' }) : el('p', { class: 'nota', text: 'Pesos iniciais pela verificação global: ECMWF IFS 1,3; ECMWF AIFS e UKMO 1,15. Depois de 30 dias de dados locais, o acerto medido aqui ajusta esses pesos.' }),
    regraConfianca());
}

function regraConfianca() {
  const R = REGRAS;
  return el('div', { class: 'explica' },
    el('p', {}, 'O que a confiança mede: se as fontes independentes concordam sobre a estimativa. Uma chance de 30% em que ECMWF e Met Office concordam é uma estimativa confiável. Cada dia começa com confiança alta e perde nível só por estes motivos, cada um contado uma vez:'),
    el('ul', {},
      el('li', { text: `os sistemas de cenários (ECMWF ENS, ECMWF AIFS ENS e Met Office) diferem mais de ${R.difSistemas[0] * 100} pontos na chance de chover (perde dois níveis acima de ${R.difSistemas[1] * 100});` }),
      el('li', { text: 'com um só sistema de cenários: os modelos e os cenários apontam em direções opostas;' }),
      el('li', { text: `sem cenários: os modelos discordam se vai chover mais de ${R.chuvaMinimaMm} mm;` }),
      el('li', { text: 'rajadas: só quando podem ser moderadas ou mais fortes e as fontes variam muito;' }),
      el('li', { text: `previsão para daqui a ${R.horizonteLongoDias} dias ou mais (dois níveis a partir de 7 dias);` }),
      el('li', { text: `acerto local de chuva abaixo de ${R.acerto.taxaAcertoBaixa * 100}% nos últimos ${R.acerto.diasMinimos}+ dias;` }),
      el('li', { text: 'hoje: chuva medida agora que a previsão não esperava.' })),
    el('p', {}, 'Volume diferente entre modelos não rebaixa a confiança: o painel mostra a melhor estimativa (mediana dos cenários com chuva, ou mediana ponderada dos modelos) e a faixa provável.'),
    el('p', { class: 'nota', text: 'Os limites ficam no objeto REGRAS, em js/analise.js.' }));
}

// ------------------------------------------------------------------ Hoje: detalhes

function renderHojeDetalhes() {
  const alvo = $('#hoje-detalhes');
  const p = estado.prev;
  const filhos = [];
  filhos.push(proximasHoras());
  filhos.push(instrumentos());
  const met = secao('Meteograma', 'Previsão: mediana dos modelos disponíveis, com a faixa entre o menor e o maior valor. Arraste para os lados para ver até 48 h; use dois dedos para aproximar.');
  met.classList.add('largura-total');
  filhos.push(met);
  const pm = secao('Previsto x medido', null);
  filhos.push(pm);
  const mapa = secao('Mapa e radar', null);
  mapa.classList.add('largura-total');
  filhos.push(mapa);
  filhos.push(estadoFontes());
  alvo.replaceChildren(...filhos);
  meteograma(met, Date.now() - 2 * 3600000, Date.now() + 48 * 3600000, 24, 'hoje');
  previstoMedido(pm);
  import('./mapa.js').then((m) => m.secaoMapa(mapa, estado)).catch(() => mapa.append(el('p', { class: 'nota', text: 'Mapa indisponível.' })));
  void p;
}

function proximasHoras() {
  const p = estado.prev, mods = modelosAtivos();
  const agora = Date.now();
  const lista = el('div', { class: 'horas', 'data-hscroll': '', role: 'list' });
  const cons = (v) => consensoHorario(p, v, mods).med;
  const prob = cons('precipitation_probability'), mm = cons('precipitation'), vento = cons('wind_speed_10m'), raj = cons('wind_gusts_10m'), dia = cons('is_day');
  let n = 0;
  for (let i = 0; i < p.horas.length && n < 24; i++) {
    if (p.horas[i] + 3600000 <= agora) continue;
    n++;
    const dir = direcaoMedia(mods.map((m) => p.modelos[m].vars.wind_direction_10m?.[i]));
    const altura = valido(mm[i]) ? Math.max(1, Math.sqrt(Math.min(mm[i], 10) / 10) * 34) : 0;
    lista.append(el('div', { class: 'hora' + (dia[i] === 0 ? ' noite' : ''), role: 'listitem' },
      el('div', { class: 'h', text: fmt.hora(p.horas[i], p.offset) }),
      el('div', { class: 'barra', 'aria-hidden': 'true' }, valido(mm[i]) ? el('i', { style: { height: altura + 'px' } }) : ''),
      el('div', { class: 'p', text: valido(prob[i]) ? `${Math.round(prob[i])}%` : '–' }),
      el('div', { class: 'mm', text: valido(mm[i]) ? `${fmt.n(mm[i], 1)} mm` : 'sem dado' }),
      el('div', {}, setaVento(dir), ' ', valido(vento[i]) ? Math.round(vento[i]) : '–'),
      el('div', { class: 'g', text: valido(raj[i]) ? `${Math.round(raj[i])}` : '–' })));
  }
  return secao('Próximas horas', 'Previsão, mediana dos modelos. Linhas: hora, chuva, chance, volume, vento médio e rajada em km/h.', lista);
}

function apparente(t, rh, kmh) {
  if (![t, rh, kmh].every(valido)) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return t + 0.33 * e - 0.7 * (kmh / 3.6) - 4;
}

function instrumentos() {
  const s = secao('Instrumentos', 'Medições de estações próximas. A distância é calculada no aparelho. Leituras antigas, vazias ou inválidas são descartadas.');
  if (!workerConfigurado()) s.append(el('p', { class: 'nota', text: 'Sem o Worker: só a última leitura da estação INMET de Campo Bom. METAR, séries de chuva e tendência da pressão aguardam a configuração do Worker. O painel nunca usa previsão no lugar de medição.' }));
  if (!estado.obs) { s.append(el('p', { text: estado.erros.medicoes ? `Medições indisponíveis (${estado.erros.medicoes}).` : 'Carregando medições…' })); return s; }
  const st = estado.obs.status || {};
  if (st.inmet && !st.inmet.ok) s.append(el('p', { class: 'nota', text: `INMET: ${st.inmet.erro}.` }));
  if (st.inmet?.aviso) s.append(el('p', { class: 'nota', text: `INMET: ${st.inmet.aviso}.` }));
  if (st.metar && !st.metar.ok) s.append(el('p', { class: 'nota', text: `METAR: ${st.metar.erro}.` }));
  if (estado.obsEm && Date.now() - estado.obsEm > 30 * 60000) s.append(el('p', { class: 'nota', text: `Medições salvas ${fmt.idade(estado.obsEm)}; podem estar desatualizadas.` }));
  const fontes = fontesNormalizadas();
  const p = pontoExato();
  const agora = Date.now();
  const lista = el('div', { class: 'instr' });
  const linha = (nome, varKey, formato, extra) => {
    const e = escolherFonte(fontes, varKey, p.lat, p.lon, agora, CONFIG.idadeMaxMedicaoMin);
    const item = el('div', { class: 'item' }, el('span', { class: 'nome', text: nome }));
    if (!e.escolhida) {
      item.append(el('span', { class: 'sem', text: 'Sem medição' }));
    } else {
      const c = e.escolhida;
      item.append(el('span', { class: 'v' }, formato(c.valor), el('span', { class: 'marca medido', text: 'medido' })));
      item.append(el('span', { class: 'orig', text: `${c.fonte.tipo === 'inmet' ? 'INMET' : 'METAR'} ${c.fonte.nome}, ${fmt.n(c.distancia, 0)} km, ${fmt.idade(c.ms)}${extra ? extra(c) : ''}` }));
    }
    if (e.outras.length) {
      item.append(el('details', {}, el('summary', { text: `Comparar com ${e.outras.length} outra${e.outras.length > 1 ? 's' : ''}` }),
        el('ul', {}, ...e.outras.slice(0, 6).map((o) => el('li', { text: `${o.fonte.nome} (${fmt.n(o.distancia, 0)} km): ${o.ok ? formato(o.valor) : o.motivo}, ${fmt.idade(o.ms)}` })))));
    }
    lista.append(item);
    return e.escolhida;
  };
  const t = linha('Temperatura', 'temperatura', (v) => fmt.c1(v));
  const u = linha('Umidade relativa', 'umidade', (v) => `${Math.round(v)}%`);
  // sensação: a do INMET (TEM_SEN) ou calculada com medições da mesma estação
  const sensInmet = linhaSilenciosa(fontes, 'sensacao', p, agora);
  const ve = escolherFonte(fontes, 'vento', p.lat, p.lon, agora, CONFIG.idadeMaxMedicaoMin).escolhida;
  const sens = sensInmet ? sensInmet.valor : (t && u && ve && t.fonte.id === u.fonte.id && u.fonte.id === ve.fonte.id ? apparente(t.valor, u.valor, ve.valor) : null);
  lista.append(el('div', { class: 'item' }, el('span', { class: 'nome', text: 'Sensação térmica' }),
    valido(sens) ? el('span', { class: 'v' }, fmt.c1(sens), el('span', { class: 'marca medido', text: 'medido' })) : el('span', { class: 'sem', text: 'Sem medição' }),
    el('span', { class: 'orig', text: sensInmet ? `calculada pelo INMET em ${sensInmet.fonte.nome}, ${fmt.n(sensInmet.distancia, 0)} km, ${fmt.idade(sensInmet.ms)}` : valido(sens) ? `calculada com temperatura, umidade e vento de ${t.fonte.nome}` : 'precisa de temperatura, umidade e vento da mesma estação' })));
  linha('Ponto de orvalho', 'orvalho', (v) => fmt.c1(v));
  const pr = linha('Pressão (nível do mar)', 'pressao', (v) => fmt.hpa(v), (c) => (c.fonte.tipo === 'inmet' ? '; reduzida ao nível do mar pelo Worker' : ''));
  // tendência 3 h na mesma estação
  let tend = null;
  if (pr) {
    const serie = (estado.obs.fontes.find((f) => f.id === pr.fonte.id)?.serie || []).filter((x) => valido(x.pressao));
    const ult = serie[serie.length - 1];
    const ant = ult && serie.reduce((b, x) => (Math.abs(x.ms - (ult.ms - 3 * 3600000)) < Math.abs((b?.ms ?? Infinity) - (ult.ms - 3 * 3600000)) ? x : b), null);
    if (ult && ant && Math.abs(ant.ms - (ult.ms - 3 * 3600000)) <= 40 * 60000) tend = ult.pressao - ant.pressao;
  }
  lista.append(el('div', { class: 'item' }, el('span', { class: 'nome', text: 'Tendência da pressão em 3 h' }),
    valido(tend) ? el('span', { class: 'v', text: `${tend > 0 ? '+' : ''}${fmt.n(tend, 1)} hPa` }) : el('span', { class: 'sem', text: 'Sem medição' }),
    el('span', { class: 'orig', text: valido(tend) ? (tend <= -3 ? 'queda forte: tempo pode mudar' : tend >= 3 ? 'subida forte' : 'variação pequena') : 'precisa de leituras de 3 h atrás na mesma estação' })));
  linha('Vento médio', 'vento', (v) => fmt.kmh(v));
  linha('Rajada', 'rajada', (v) => fmt.kmh(v), (c) => (c.fonte.tipo === 'metar' ? '; METAR só informa rajada quando ela ocorre' : ''));
  linha('Direção do vento', 'direcao', (v) => `${direcaoTexto(v)} (${Math.round(v)}°)`);
  linha('Chuva na última hora', 'chuva_h1', (v) => fmt.mm(v));
  linha('Chuva em 24 h', 'chuva_h24', (v) => fmt.mm(v));
  linha('Chuva em 72 h', 'chuva_h72', (v) => fmt.mm(v));
  linha('Chuva em 7 dias', 'chuva_d7', (v) => fmt.mm(v));
  s.append(lista);
  // condição atual do modelo (não é medição)
  const cod = estado.prev?.atual?.codigo;
  if (valido(cod)) s.append(el('p', { class: 'nota' }, `Condição estimada pelo modelo agora: ${textoWmo(cod)}`, el('span', { class: 'marca previsao', text: 'previsão' })));
  s.append(el('p', { class: 'nota', text: 'Pluviômetros do CEMADEN não são usados: não há acesso público e estável confirmado.' }));
  return s;
}

function linhaSilenciosa(fontes, v, p, agora) {
  return escolherFonte(fontes, v, p.lat, p.lon, agora, CONFIG.idadeMaxMedicaoMin).escolhida;
}

function textoWmo(c) {
  const t = { 0: 'céu limpo', 1: 'predomínio de sol', 2: 'parcialmente nublado', 3: 'nublado', 45: 'nevoeiro', 48: 'nevoeiro com geada',
    51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 61: 'chuva fraca', 63: 'chuva moderada', 65: 'chuva forte', 66: 'chuva congelante', 67: 'chuva congelante forte',
    80: 'pancadas fracas', 81: 'pancadas de chuva', 82: 'pancadas fortes', 95: 'trovoada', 96: 'trovoada com granizo', 99: 'trovoada com granizo forte' };
  return t[c] || `código ${c}`;
}

// ------------------------------------------------------------------ meteograma

const PAINEIS = {
  chuva: 'Chuva', vento: 'Vento', temperatura: 'Temperatura', pressao: 'Pressão', umidade: 'Umidade', nuvens: 'Nuvens', cape: 'CAPE',
};

function meteograma(container, iniMs, fimMs, horasVisiveis, id) {
  const p = estado.prev, mods = modelosAtivos();
  const idx = []; p.horas.forEach((ms, i) => { if (ms >= iniMs && ms <= fimMs) idx.push(i); });
  const x = idx.map((i) => p.horas[i]);
  const C = (v) => { const c = consensoHorario(p, v, mods); return { med: idx.map((i) => c.med[i]), lo: idx.map((i) => c.lo[i]), hi: idx.map((i) => c.hi[i]) }; };
  const disponivel = (v) => mods.some((m) => p.modelos[m].vars[v]);
  let abertos = prefs.ler('paineis-v2', ['chuva']);
  const chips = el('div', { class: 'paineis', role: 'group', 'aria-label': 'Painéis do meteograma' });
  const area = el('div');
  container.append(chips, area);
  const noites = noitesDe(p.diario, iniMs, fimMs);
  const base = { x, noites, horasVisiveis, fuso: p.fuso, sync: 'meteo-' + id };

  function desenhar() {
    limparGraficos(area);
    area.replaceChildren();
    chips.replaceChildren(...Object.entries(PAINEIS).map(([k, nome]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(abertos.includes(k)), onclick: () => {
      abertos = abertos.includes(k) ? abertos.filter((a) => a !== k) : [...abertos, k];
      prefs.gravar('paineis-v2', abertos); desenhar();
    } }, nome)));
    const fonte = `Previsão Open-Meteo (${mods.map((m) => MODELOS[m].curto).join(', ')}), ${fmt.horaMin(estado.prevEm, p.offset)}.`;
    if (abertos.includes('chuva')) {
      const ch = C('precipitation'), pr = C('precipitation_probability');
      let acc = 0, falhou = false; const acum = ch.med.map((v) => { if (!valido(v)) { falhou = true; return null; } if (falhou) return null; acc += v; return acc; });
      criarGrafico(area, { ...base, titulo: 'Chuva por hora, acumulada e probabilidade', fonte,
        series: [
          { rotulo: 'mm/h', valores: ch.med, corCss: '--chuva', barras: true, escala: 'mm', formato: (v) => `${fmt.n(v, 1)} mm` },
          { rotulo: 'acumulada', valores: acum, corCss: '--chuva', escala: 'acc', largura: 2, formato: (v) => `${fmt.n(v, 1)} mm` },
          { rotulo: 'probabilidade', valores: pr.med, corCss: '--texto', escala: '%', dash: [5, 4], largura: 1.5, formato: (v) => `${Math.round(v)}%` },
        ],
        escalas: { mm: { range: (u, a, b) => [0, Math.max(2, b)] }, acc: { range: (u, a, b) => [0, Math.max(5, b)] }, '%': { range: [0, 100] } },
        eixos: [{ escala: 'mm', formato: (v) => `${v}` , rotulo: 'mm/h' }, { escala: '%', lado: 1, grade: false, formato: (v) => `${v}%`, tamanho: 40 }] });
    }
    if (abertos.includes('vento')) {
      const v = C('wind_speed_10m'), g = C('wind_gusts_10m');
      const dirs = idx.map((i) => direcaoMedia(mods.map((m) => p.modelos[m].vars.wind_direction_10m?.[i])));
      criarGrafico(area, { ...base, titulo: 'Vento médio, rajadas e direção', fonte: fonte + ' Setas apontam para onde o vento sopra.', setas: dirs, altura: 190,
        series: [
          { rotulo: 'rajada mín.', valores: g.lo, corCss: '--rajada', faixa: true, semLegenda: true },
          { rotulo: 'rajada máx.', valores: g.hi, corCss: '--rajada', faixa: true, semLegenda: true },
          { rotulo: 'rajada', valores: g.med, corCss: '--rajada', largura: 2.5, formato: (x) => `${Math.round(x)} km/h` },
          { rotulo: 'vento médio', valores: v.med, corCss: '--texto', largura: 1.5, formato: (x) => `${Math.round(x)} km/h` },
        ],
        bandas: [{ de: 1, ate: 0, corCss: '--rajada' }],
        escalas: { y: { range: (u, a, b) => [0, Math.max(40, b + 10)] } }, eixos: [{ formato: (x) => `${x}`, rotulo: 'km/h' }] });
    }
    if (abertos.includes('temperatura')) {
      criarGrafico(area, { ...base, titulo: 'Temperatura, sensação térmica e ponto de orvalho', fonte,
        series: [
          { rotulo: 'temperatura', valores: C('temperature_2m').med, corCss: '--quente', largura: 2.5, formato: (v) => fmt.c1(v) },
          { rotulo: 'sensação', valores: C('apparent_temperature').med, corCss: '--quente', dash: [5, 4], largura: 1.5, formato: (v) => fmt.c1(v) },
          { rotulo: 'orvalho', valores: C('dew_point_2m').med, corCss: '--fria', largura: 1.5, formato: (v) => fmt.c1(v) },
        ], eixos: [{ formato: (v) => `${v}°` }] });
    }
    if (abertos.includes('pressao')) {
      criarGrafico(area, { ...base, titulo: 'Pressão ao nível do mar', fonte, altura: 140,
        series: [{ rotulo: 'pressão', valores: C('pressure_msl').med, corCss: '--texto', formato: (v) => fmt.hpa(v) }], eixos: [{ formato: (v) => `${v}`, tamanho: 48, rotulo: 'hPa' }] });
    }
    if (abertos.includes('umidade')) {
      criarGrafico(area, { ...base, titulo: 'Umidade relativa', fonte, altura: 140,
        series: [{ rotulo: 'umidade', valores: C('relative_humidity_2m').med, corCss: '--chuva', formato: (v) => `${Math.round(v)}%` }],
        escalas: { y: { range: [0, 100] } }, eixos: [{ formato: (v) => `${v}%` }] });
    }
    if (abertos.includes('nuvens')) {
      if (!disponivel('cloud_cover_low')) area.append(el('p', { class: 'nota', text: 'Nuvens por camada: nenhum modelo forneceu este dado.' }));
      else criarGrafico(area, { ...base, titulo: 'Cobertura de nuvens por camada', fonte, altura: 150,
        series: [
          { rotulo: 'altas', valores: C('cloud_cover_high').med, cor: '#9DB3B8', largura: 1.5, formato: (v) => `${Math.round(v)}%` },
          { rotulo: 'médias', valores: C('cloud_cover_mid').med, corCss: '--fria', largura: 1.5, formato: (v) => `${Math.round(v)}%` },
          { rotulo: 'baixas', valores: C('cloud_cover_low').med, corCss: '--texto', largura: 2.5, formato: (v) => `${Math.round(v)}%` },
        ], escalas: { y: { range: [0, 100] } }, eixos: [{ formato: (v) => `${v}%` }] });
    }
    if (abertos.includes('cape')) {
      if (!disponivel('cape')) area.append(el('p', { class: 'nota', text: 'CAPE: nenhum modelo forneceu este dado.' }));
      else {
        criarGrafico(area, { ...base, titulo: 'CAPE (energia para nuvens de tempestade)', fonte, altura: 140,
          series: [{ rotulo: 'CAPE', valores: C('cape').med, corCss: '--quente', formato: (v) => `${Math.round(v)} J/kg` }], eixos: [{ formato: (v) => `${v}`, tamanho: 48, rotulo: 'J/kg' }] });
        area.append(el('p', { class: 'explica', text: 'CAPE mede quanta energia o ar tem para formar nuvens de tempestade. Abaixo de 500 J/kg é pouco; acima de 1.000 J/kg, se houver gatilho, podem surgir temporais. Não é previsão de raios nem garante tempestade.' }));
      }
    }
    if (!abertos.length) area.append(el('p', { class: 'nota', text: 'Escolha um painel acima.' }));
  }
  desenhar();
}

// ------------------------------------------------------------------ previsto x medido

function previstoMedido(s) {
  const p = estado.prev;
  const temSerie = (estado.obs?.fontes || []).some((f) => f.serie.length >= 3);
  if (!estado.obs || !temSerie) {
    s.append(el('p', { text: estado.obs ? 'Sem medição horária suficiente: a comparação precisa do histórico do dia, que vem do Worker (METAR e INMET). A comparação nunca usa previsão como medição.' : 'Aguardando medições.' }));
    return;
  }
  const hoje = datas()[0];
  const idx = indicesDoDia(p.horas, hoje, p.offset).filter((i) => p.horas[i] <= Date.now());
  if (idx.length < 2) { s.append(el('p', { class: 'nota', text: 'Ainda é cedo: poucas horas de hoje para comparar.' })); return; }
  const mods = modelosAtivos();
  const pt = pontoExato();
  const fontes = fontesNormalizadas();
  const escolha = (v) => escolherFonte(fontes, v, pt.lat, pt.lon, Date.now(), CONFIG.idadeMaxMedicaoMin).escolhida;
  const fT = escolha('temperatura'), fC = escolha('chuva'), fR = escolha('rajada') || escolha('vento');
  const x = idx.map((i) => p.horas[i]);
  const medidoEm = (fonte, v) => {
    if (!fonte) return x.map(() => null);
    const serie = estado.obs.fontes.find((f) => f.id === fonte.fonte.id)?.serie || [];
    return x.map((ms) => { const o = serie.find((q) => Math.abs(q.ms - ms) <= 30 * 60000); return o && valido(o[v]) ? o[v] : null; });
  };
  const prevT = idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.temperature_2m?.[i])));
  const medT = medidoEm(fT, 'temperatura');
  criarGrafico(s, { x, noites: noitesDe(p.diario, x[0], x[x.length - 1]), fuso: p.fuso, sync: 'pm', emitirHora: false, titulo: 'Temperatura hoje', altura: 150,
    fonte: fT ? `Medido: ${fT.fonte.nome} (${fmt.n(fT.distancia, 0)} km). Previsto: mediana dos modelos.` : 'Sem medição de temperatura.',
    series: [
      { rotulo: 'previsto', valores: prevT, corCss: '--quente', dash: [6, 4], largura: 1.5, formato: (v) => fmt.c1(v) },
      { rotulo: 'medido', valores: medT, corCss: '--texto', pontos: true, largura: 2.5, formato: (v) => fmt.c1(v) },
    ], eixos: [{ formato: (v) => `${v}°` }] });
  // chuva acumulada
  const prevC = []; let a = 0;
  for (const i of idx) { const v = mediana(mods.map((m) => p.modelos[m].vars.precipitation?.[i])); a = valido(v) ? a + v : a; prevC.push(valido(v) ? a : null); }
  const medCh = medidoEm(fC, 'chuva'); let b = 0, quebrou = false;
  const medC = medCh.map((v) => { if (!valido(v)) { quebrou = true; return null; } if (quebrou) return null; b += v; return b; });
  criarGrafico(s, { x, fuso: p.fuso, sync: 'pm', emitirHora: false, titulo: 'Chuva acumulada hoje', altura: 140,
    fonte: fC ? `Medido: ${fC.fonte.nome} (${fmt.n(fC.distancia, 0)} km). Hora sem leitura interrompe a linha medida.` : 'Sem medição de chuva perto (METAR não informa volume).',
    series: [
      { rotulo: 'previsto', valores: prevC, corCss: '--chuva', dash: [6, 4], largura: 1.5, formato: (v) => `${fmt.n(v, 1)} mm` },
      { rotulo: 'medido', valores: medC, corCss: '--texto', pontos: true, largura: 2.5, formato: (v) => `${fmt.n(v, 1)} mm` },
    ], escalas: { y: { range: (u, mi, ma) => [0, Math.max(5, ma)] } }, eixos: [{ formato: (v) => `${v}` , rotulo: 'mm' }] });
  const prevG = idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.wind_gusts_10m?.[i])));
  const medG = medidoEm(fR, fR?.fonte && escolha('rajada') ? 'rajada' : 'vento');
  criarGrafico(s, { x, fuso: p.fuso, sync: 'pm', emitirHora: false, titulo: 'Rajadas hoje', altura: 140,
    fonte: fR ? `Medido: ${fR.fonte.nome}. METAR só informa rajada quando ela ocorre.` : 'Sem medição de vento.',
    series: [
      { rotulo: 'previsto', valores: prevG, corCss: '--rajada', dash: [6, 4], largura: 1.5, formato: (v) => `${Math.round(v)} km/h` },
      { rotulo: 'medido', valores: medG, corCss: '--texto', pontos: true, largura: 2.5, formato: (v) => `${Math.round(v)} km/h` },
    ], escalas: { y: { range: (u, mi, ma) => [0, Math.max(40, ma + 5)] } }, eixos: [{ formato: (v) => `${v}`, rotulo: 'km/h' }] });
  s.append(el('p', { class: 'nota', text: 'Linha tracejada é previsão; linha cheia com pontos é medição.' }));
}

function estadoFontes() {
  const linhas = [];
  const add = (nome, ok, quando, erro) => linhas.push(el('tr', {}, el('td', { text: nome }), el('td', { text: ok ? 'ok' : (erro || 'indisponível') }), el('td', { class: 'n', text: quando ? fmt.idade(quando) : '–' })));
  add('Previsão (Open-Meteo)', !estado.erros.previsao && estado.prev, estado.prevEm, estado.erros.previsao);
  add('Cenários (Ensemble API)', !!estado.ens, estado.ensEm, estado.erros.ensemble);
  const w = workerConfigurado();
  add(w ? 'Medições (INMET, METAR)' : 'Medições (INMET Campo Bom, direto)', estado.obs && !estado.erros.medicoes, estado.obsEm, estado.erros.medicoes);
  add('Alertas INMET', estado.alertas && !estado.alertas.indisponivel, estado.alertasEm, estado.erros.alertas || 'indisponíveis');
  add('Worker (METAR, El Niño, acerto)', w, null, 'não configurado');
  add('Acerto local', w && Object.keys(estado.acerto).length, estado.acertoEm, w ? 'sem histórico' : 'Worker não configurado');
  return secao('Estado das fontes', 'Se uma fonte falhar, as outras continuam. Previsão não substitui canais oficiais.',
    el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Fonte' }), el('th', { text: 'Situação' }), el('th', { class: 'n', text: 'Idade' }))), el('tbody', {}, ...linhas)));
}

// ------------------------------------------------------------------ Amanhã: detalhes

function renderAmanhaDetalhes(data) {
  const alvo = $('#amanha-detalhes');
  const p = estado.prev, mods = modelosAtivos();
  const a = analisarDia(data, 1, false);
  const filhos = [];
  // períodos
  const per = { madrugada: [], 'manhã': [], tarde: [], noite: [] };
  for (const i of a.idxTodo) per[periodoDoDia(partesLocais(p.horas[i], p.offset).hora)].push(i);
  const caixas = Object.entries(per).map(([nome, idx]) => {
    const prob = maximo(idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.precipitation_probability?.[i]))));
    const mm = idx.reduce((s, i) => { const v = mediana(mods.map((m) => p.modelos[m].vars.precipitation?.[i])); return valido(v) ? s + v : s; }, 0);
    const g = maximo(idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.wind_gusts_10m?.[i]))));
    const t = idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.temperature_2m?.[i])));
    return el('div', { class: 'periodo' }, el('h3', { text: nome[0].toUpperCase() + nome.slice(1) }),
      el('div', { class: 'p', text: valido(prob) ? `${Math.round(prob)}% de chance` : 'chance sem dado' }),
      el('div', { text: `${fmt.n(mm, 1)} mm` }),
      el('div', { class: 'g', text: valido(g) ? `rajada ${Math.round(g)} km/h` : 'rajada sem dado' }),
      el('div', {}, el('span', { class: 'tmin', text: fmt.c(minimo(t)) || '–' }), ' a ', el('span', { class: 'tmax', text: fmt.c(maximo(t)) || '–' })));
  });
  filhos.push(secao('Períodos', 'Previsão, mediana dos modelos. Chance é a maior chance horária do período.', el('div', { class: 'periodos' }, ...caixas)));
  const met = secao('Meteograma de amanhã', 'Previsão de 0h a 24h.');
  met.classList.add('largura-total');
  filhos.push(met);
  filhos.push(secao('Probabilidades de chuva e rajadas', a.limites.origem === 'cenários do ensemble' ? `Fração dos ${a.limites.n.chuva} cenários do ensemble.` : `Sem ensemble: fração de ${a.limites.n.chuva} modelos, o que é concordância e não probabilidade.`, tabelaLimites([a])));
  const k = p.diario.datas.indexOf(data);
  filhos.push(secao('Sol e UV', 'Previsão Open-Meteo. UV máximo vem só do GFS.',
    el('p', {}, `Nascer do sol ${fmt.horaMin(p.diario.nascer[k], p.offset)}, pôr do sol ${fmt.horaMin(p.diario.por[k], p.offset)}.`),
    el('p', {}, 'Índice UV máximo: ', valido(p.diario.uvMax[k]) ? el('b', { text: `${fmt.n(p.diario.uvMax[k], 0)} (${textoUv(p.diario.uvMax[k])})` }) : ausente('sem dado'))));
  filhos.push(secao('Confiança e divergência entre modelos', null, tabelaModelosDia(a), el('ul', {}, ...(a.av.confianca.motivos.length ? a.av.confianca.motivos : ['modelos e cenários concordam']).map((m) => el('li', { text: m }))),
    el('button', { type: 'button', class: 'chip', onclick: () => explicarConfianca(a) }, 'Como a confiança é calculada')));
  alvo.replaceChildren(...filhos);
  meteograma(met, p.horas[a.idxTodo[0]], p.horas[a.idxTodo[a.idxTodo.length - 1]], null, 'amanha');
}

function textoUv(u) { return u < 3 ? 'baixo' : u < 6 ? 'moderado' : u < 8 ? 'alto' : u < 11 ? 'muito alto' : 'extremo'; }

function tabelaModelosDia(a) {
  return el('div', { class: 'tabela-rolar', 'data-hscroll': '' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', { text: 'Modelo' }), el('th', { class: 'n', text: 'Chuva' }), el('th', { class: 'n', text: 'Rajada' }), el('th', { class: 'n', text: 'Mín/Máx' }))),
    el('tbody', {}, ...a.resumos.map((r) => el('tr', {}, el('td', { text: MODELOS[r.modelo].nome }),
      el('td', { class: 'n' }, valido(r.chuva) ? fmt.mm(r.chuva) : ausente('sem dado')),
      el('td', { class: 'n' }, valido(r.rajada?.valor) ? `${Math.round(r.rajada.valor)} km/h` : ausente('não fornece')),
      el('td', { class: 'n' }, valido(r.tmin) ? `${fmt.c(r.tmin)}/${fmt.c(r.tmax)}` : ausente('sem dado')))))));
}

function tabelaLimites(dias) {
  const p = estado.prev;
  const L = REGRAS.limitesSemana;
  const cab = el('tr', {}, el('th', { text: 'Dia' }), ...L.chuva.map((l) => el('th', { class: 'n', text: `>${l} mm` })), ...L.rajada.map((l) => el('th', { class: 'n', text: `>${l}` })));
  const linhas = dias.map((a) => el('tr', {}, el('td', { text: `${fmt.diaSemana(p.horas[a.idxTodo[0]], p.offset)} ${fmt.dataCurta(p.horas[a.idxTodo[0]], p.offset)}` }),
    ...a.limites.chuva.map((c) => el('td', { class: 'p', text: valido(c.p) ? `${Math.round(c.p * 100)}%` : '–' })),
    ...a.limites.rajada.map((c) => el('td', { class: 'g', text: valido(c.p) ? `${Math.round(c.p * 100)}%` : '–' }))));
  return el('div', { class: 'tabela-rolar', 'data-hscroll': '' }, el('table', { class: 'mini-tab' }, el('thead', {}, cab), el('tbody', {}, ...linhas)),
    el('p', { class: 'nota', text: 'Colunas em mm são chuva no dia; em km/h, rajada máxima.' }));
}

// ------------------------------------------------------------------ Semana

function renderSemana() {
  const alvo = $('#semana-conteudo');
  const p = estado.prev;
  const ds = datas();
  const dias = ds.slice(0, 7).map((d, k) => analisarDia(d, k, k === 0));
  const extra = ds.slice(7).map((d, k) => analisarDia(d, k + 7, false)).filter((a) => a.modelosComDado.length);
  const abertos = new Set(prefs.ler('diasAbertos', []));
  const item = (a, longe) => {
    const ms = p.horas[a.idxTodo[0]];
    const exp = el('div', { class: 'exp', hidden: !abertos.has(a.data) }, tabelaModelosDia(a),
      el('p', { class: 'nota', text: a.av.confianca.motivos.join('; ') || 'modelos e cenários concordam' }));
    const btn = el('button', { type: 'button', 'aria-expanded': String(abertos.has(a.data)), onclick: () => {
      const abre = exp.hidden; exp.hidden = !abre; btn.setAttribute('aria-expanded', String(abre));
      abre ? abertos.add(a.data) : abertos.delete(a.data); prefs.gravar('diasAbertos', [...abertos]);
      try { abre ? sessionStorage.setItem('abaComDetalhe', 'semana') : sessionStorage.removeItem('abaComDetalhe'); } catch {}
    } },
      el('span', { class: 'dn' }, a.diaIndice === 0 ? 'Hoje' : fmt.diaSemana(ms, p.offset), el('small', { text: fmt.dataCurta(ms, p.offset) })),
      el('span', { class: 'resumo', text: a.frase }),
      el('span', { class: 'nums' },
        el('span', { class: 'p', text: a.av.prob === null ? 'chuva –' : `${fmt.pct(a.av.prob)}${a.av.volume && a.av.prob >= 0.15 ? ' ' + fmt.mm(a.av.volume.mediana) : ''}` }),
        el('span', { class: 'g', text: a.av.rajada ? `${Math.round(a.av.rajada.mediana)} km/h` : 'rajada –' }),
        el('span', { class: 't' }, el('span', { class: 'tmin', text: fmt.c(a.tmin) || '–' }), '/', el('span', { class: 'tmax', text: fmt.c(a.tmax) || '–' }))),
      el('span', { class: 'cf', text: `confiança ${a.av.confianca.geral}` }));
    return el('li', { class: 'dia' + (longe ? ' longe' : '') }, btn, exp);
  };
  const filhos = [el('ul', { class: 'dias largura-total' }, ...dias.map((a) => item(a)))];
  if (extra.length) {
    const det = el('details', { class: 'largura-total' }, el('summary', { class: 'chip', style: { display: 'inline-flex', 'align-items': 'center', margin: '10px 0' } }, `Mais ${extra.length} dias (confiança menor)`),
      el('p', { class: 'nota', text: `Depois do 7º dia restam ${[...new Set(extra.flatMap((a) => a.modelosComDado))].map((m) => MODELOS[m].curto).join(' e ')}. Use só como tendência.` }),
      el('ul', { class: 'dias' }, ...extra.map((a) => item(a, true))));
    filhos.push(det);
  }
  const x = dias.map((a) => p.horas[a.idxTodo[0]] + 12 * 3600000);
  const fmtDia = (u, vals) => vals.map((v) => { const d = window.uPlot.tzDate(new Date(v * 1000), p.fuso || 'America/Sao_Paulo'); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()]; });
  const gChuva = secao('Chuva diária e acumulada', 'Previsão: mediana dos modelos se chover; acumulada soma as medianas.');
  const gTemp = secao('Temperatura mínima e máxima', 'Linhas: mediana dos modelos. Faixas: menor e maior valor entre modelos.');
  const gRaj = secao('Rajada máxima', 'Barras: mediana; faixa: cenários (p10 a p90) ou modelos.');
  const faixas = secao('Faixa provável', 'Do menor ao maior valor provável: cenários p10 a p90 quando há ensemble; senão, menor e maior modelo.', tabelaFaixas(dias));
  const probs = secao('Probabilidade por dia', dias[0]?.limites.origem === 'cenários do ensemble' ? 'Fração dos cenários do ensemble acima de cada limite.' : 'Sem ensemble: concordância entre modelos, não é probabilidade.', tabelaLimites(dias));
  filhos.push(gChuva, gTemp, gRaj, faixas, probs);
  alvo.replaceChildren(...filhos);
  const chuvaDia = dias.map((a) => mediana(a.resumos.map((r) => r.chuva)));
  let ac = 0; const acum = chuvaDia.map((v) => (valido(v) ? (ac += v) : null));
  const base = { x, fuso: p.fuso, sync: 'semana', emitirHora: false, agora: false, formatoX: fmtDia, altura: 160 };
  criarGrafico(gChuva, { ...base, series: [
    { rotulo: 'no dia', valores: chuvaDia, corCss: '--chuva', barras: true, formato: (v) => fmt.mm(v) },
    { rotulo: 'acumulada', valores: acum, corCss: '--texto', largura: 2, formato: (v) => fmt.mm(v) },
  ], escalas: { y: { range: (u, a, b) => [0, Math.max(10, b)] } }, eixos: [{ formato: (v) => `${v}`, rotulo: 'mm' }] });
  criarGrafico(gTemp, { ...base, series: [
    { rotulo: 'mín baixa', valores: dias.map((a) => a.tminFaixa[0]), corCss: '--fria', faixa: true, semLegenda: true },
    { rotulo: 'mín alta', valores: dias.map((a) => a.tminFaixa[1]), corCss: '--fria', faixa: true, semLegenda: true },
    { rotulo: 'máx baixa', valores: dias.map((a) => a.tmaxFaixa[0]), corCss: '--quente', faixa: true, semLegenda: true },
    { rotulo: 'máx alta', valores: dias.map((a) => a.tmaxFaixa[1]), corCss: '--quente', faixa: true, semLegenda: true },
    { rotulo: 'mínima', valores: dias.map((a) => a.tmin), corCss: '--fria', pontos: false, largura: 2.5, formato: (v) => fmt.c(v) },
    { rotulo: 'máxima', valores: dias.map((a) => a.tmax), corCss: '--quente', largura: 2.5, formato: (v) => fmt.c(v) },
  ], bandas: [{ de: 1, ate: 0, corCss: '--fria' }, { de: 3, ate: 2, corCss: '--quente' }], eixos: [{ formato: (v) => `${v}°` }] });
  criarGrafico(gRaj, { ...base, series: [
    { rotulo: 'baixa', valores: dias.map((a) => a.av.rajada?.min ?? null), corCss: '--rajada', faixa: true, semLegenda: true },
    { rotulo: 'alta', valores: dias.map((a) => a.av.rajada?.max ?? null), corCss: '--rajada', faixa: true, semLegenda: true },
    { rotulo: 'rajada máxima', valores: dias.map((a) => a.av.rajada?.mediana ?? null), corCss: '--rajada', largura: 2.5, pontos: true, formato: (v) => `${Math.round(v)} km/h` },
  ], bandas: [{ de: 1, ate: 0, corCss: '--rajada' }], escalas: { y: { range: (u, a, b) => [0, Math.max(60, b + 10)] } }, eixos: [{ formato: (v) => `${v}`, rotulo: 'km/h' }] });
}

function tabelaFaixas(dias) {
  const p = estado.prev;
  return el('div', { class: 'tabela-rolar', 'data-hscroll': '' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', { text: 'Dia' }), el('th', { class: 'n', text: 'Chuva' }), el('th', { class: 'n', text: 'Rajada' }), el('th', { class: 'n', text: 'Mín' }), el('th', { class: 'n', text: 'Máx' }))),
    el('tbody', {}, ...dias.map((a) => el('tr', {},
      el('td', { text: fmt.diaSemana(p.horas[a.idxTodo[0]], p.offset) }),
      el('td', { class: 'n', text: a.av.volume ? `${fmt.n(a.av.volume.min, 0)}–${fmt.n(a.av.volume.max, 0)} mm` : '–' }),
      el('td', { class: 'n', text: a.av.rajada ? `${Math.round(a.av.rajada.min)}–${Math.round(a.av.rajada.max)}` : '–' }),
      el('td', { class: 'n', text: valido(a.tminFaixa[0]) ? `${Math.round(a.tminFaixa[0])}–${Math.round(a.tminFaixa[1])}°` : '–' }),
      el('td', { class: 'n', text: valido(a.tmaxFaixa[0]) ? `${Math.round(a.tmaxFaixa[0])}–${Math.round(a.tmaxFaixa[1])}°` : '–' }))))),
    el('p', { class: 'nota', text: 'Volume de chuva considera só os cenários ou modelos em que chove mais de 1 mm.' }));
}

// ------------------------------------------------------------------ Modelos

function renderModelos() {
  const alvo = $('#modelos-conteudo');
  const p = estado.prev, mods = modelosAtivos();
  const ds = datas().slice(0, 7);
  const dias = ds.map((d, k) => analisarDia(d, k, k === 0));
  const filhos = [];
  const div = horizonteDivergencia(p, mods);
  filhos.push(el('p', { class: 'frase', style: { 'font-size': '22px', 'min-height': '0' }, text: div ? `Os modelos começam a divergir ${fmt.diaSemana(div.ms, p.offset)} às ${fmt.hora(div.ms, p.offset)}` : 'Os modelos concordam nos próximos dias' }));
  filhos.push(el('p', { class: 'nota', text: div ? `Motivo: ${div.motivo}. Antes disso, a previsão é mais confiável.` : 'Nenhum bloco de 6 h com diferença grande de chuva ou rajada.' }));
  const ausencias = mods.map((m) => p.modelos[m].ausentes.length ? `${MODELOS[m].nome} não fornece: ${p.modelos[m].ausentes.map(nomeVar).join(', ')}` : null).filter(Boolean);
  const faltam = Object.keys(MODELOS).filter((m) => !mods.includes(m));
  // tabela lado a lado
  const tab = el('div', { class: 'tabela-rolar largura-total', 'data-hscroll': '' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', { text: 'Dia' }), ...mods.map((m) => el('th', { class: 'n', text: MODELOS[m].curto })))),
    el('tbody', {}, ...dias.map((a) => el('tr', {}, el('td', { text: fmt.diaSemana(p.horas[a.idxTodo[0]], p.offset) }),
      ...mods.map((m) => { const r = a.resumos.find((x) => x.modelo === m); return el('td', { class: 'n' },
        el('div', { class: 'p', style: { color: 'var(--chuva-txt)' }, text: valido(r.chuva) ? fmt.mm(r.chuva) : '–' }),
        el('div', { style: { color: 'var(--rajada-txt)' }, text: valido(r.rajada?.valor) ? `${Math.round(r.rajada.valor)} km/h` : 'sem rajada' })); }))))));
  filhos.push(secao('Chuva e rajada de cada modelo', 'Previsão por dia. Traço indica dado ausente, não zero.', tab,
    ...ausencias.map((t) => el('p', { class: 'nota', text: t })), faltam.length ? el('p', { class: 'nota', text: `Sem dados agora: ${faltam.map((m) => MODELOS[m].nome).join(', ')}.` }) : null));
  const gC = secao('Chuva acumulada por modelo', 'Previsão, 7 dias. Faixa: cenários do ensemble (p10 a p90) e mediana.');
  const gR = secao('Rajadas por modelo', 'Previsão, 7 dias. Faixa: cenários do ensemble (p10 a p90).');
  gC.classList.add('largura-total'); gR.classList.add('largura-total');
  filhos.push(gC, gR);
  filhos.push(secao('Taxa de acerto local', null, tabelaAcerto()));
  filhos.push(secao('Regra de confiança', null, regraConfianca()));
  if (estado.ensErros?.length) filhos.push(el('p', { class: 'nota', text: `Ensemble: ${estado.ensErros.join('; ')}.` }));
  alvo.replaceChildren(...filhos);

  const ini = Date.now() - 3600000, fim = Date.now() + 7 * 86400000;
  const idx = []; p.horas.forEach((ms, i) => { if (ms >= ini && ms <= fim) idx.push(i); });
  const x = idx.map((i) => p.horas[i]);
  const leque = (v, acumular) => {
    if (!estado.ens) return null;
    const membros = [];
    for (const e of Object.values(estado.ens)) {
      const pos = new Map(e.horas.map((ms, i) => [ms, i]));
      for (const s of e.membros[v] || []) {
        let a = 0, ok = true;
        membros.push(x.map((ms) => { const i = pos.get(ms); const val = i === undefined ? null : s[i]; if (!valido(val)) { ok = false; return null; } if (acumular) { a += val; return ok ? a : null; } return val; }));
      }
    }
    if (membros.length < 10) return null;
    const q = (qq) => x.map((_, k) => quantil(membros.map((m) => m[k]), qq));
    return { p10: q(0.1), p50: q(0.5), p90: q(0.9), n: membros.length };
  };
  const serieModelo = (m, v, acumular) => { let a = 0, quebra = false; return idx.map((i) => { const val = p.modelos[m].vars[v]?.[i]; if (!valido(val)) { quebra = acumular; return null; } if (quebra) return null; a += val; return acumular ? a : val; }); };
  const base = { x, fuso: p.fuso, sync: 'modelos', emitirHora: false, altura: 200, horasVisiveis: 72, noites: noitesDe(p.diario, ini, fim) };
  for (const [caixa, v, acumular, unidade] of [[gC, 'precipitation', true, 'mm'], [gR, 'wind_gusts_10m', false, 'km/h']]) {
    const l = leque(v, acumular);
    const series = [];
    const bandas = [];
    if (l) {
      series.push({ rotulo: 'p10', valores: l.p10, cor: '#7f9aa1', faixa: true, semLegenda: true }, { rotulo: 'p90', valores: l.p90, cor: '#7f9aa1', faixa: true, semLegenda: true },
        { rotulo: `mediana de ${l.n} cenários`, valores: l.p50, cor: '#7f9aa1', largura: 2, dash: [2, 3], formato: (z) => `${fmt.n(z, 0)} ${unidade}` });
      bandas.push({ de: 1, ate: 0, cor: '#7f9aa1' });
    }
    for (const m of mods) if (p.modelos[m].vars[v]) series.push({ rotulo: MODELOS[m].curto, valores: serieModelo(m, v, acumular), corCss: MODELOS[m].cor.slice(4, -1), largura: 2, formato: (z) => `${fmt.n(z, 0)} ${unidade}` });
    if (!l) caixa.append(el('p', { class: 'nota', text: 'Leque de cenários indisponível: a Ensemble API não respondeu. Mostrando só os modelos.' }));
    criarGrafico(caixa, { ...base, series, bandas, escalas: { y: { range: (u, a, b) => [0, Math.max(acumular ? 10 : 50, b)] } }, eixos: [{ formato: (z) => `${z}`, rotulo: unidade }] });
  }
}

function nomeVar(v) {
  return { precipitation_probability: 'probabilidade', wind_gusts_10m: 'rajadas', visibility: 'visibilidade', cape: 'CAPE', uv_index: 'UV', cloud_cover_low: 'nuvens baixas', cloud_cover_mid: 'nuvens médias', cloud_cover_high: 'nuvens altas', precipitation: 'chuva', pressure_msl: 'pressão', is_day: 'dia/noite', apparent_temperature: 'sensação', dew_point_2m: 'orvalho', relative_humidity_2m: 'umidade' }[v] || v;
}

function tabelaAcerto() {
  if (!workerConfigurado()) return el('p', { text: 'Requer o Worker: ele guarda, uma vez por dia, a previsão antiga (Previous Runs API) e a medição de estações públicas.' });
  const blocos = [];
  for (const v of VERIFICACAO) {
    const a = estado.acerto[v.id];
    if (!a) { blocos.push(el('p', { class: 'nota', text: `${v.nome}: sem dados de acerto ainda.` })); continue; }
    const pt = pontoExato();
    blocos.push(el('h3', { text: `${a.estacao.nome}, ${fmt.n(distanciaKm(pt.lat, pt.lon, a.estacao.lat, a.estacao.lon), 0)} km` }));
    blocos.push(el('p', { class: 'fonte', text: a.periodo ? `${a.dias} dias, de ${a.periodo.ini} a ${a.periodo.fim}.` : 'Ainda sem dias registrados.' }));
    if (a.observacao) blocos.push(el('p', { class: 'nota', text: a.observacao }));
    const linhas = [];
    for (const m of Object.keys(MODELOS)) for (const d of [1, 2, 3, 5]) {
      const r = a.porModelo?.[m]?.[d]; if (!r) continue;
      if (!r.amostrasChuva && !r.amostrasRajada && !r.amostrasTmax) continue;
      linhas.push(el('tr', {}, el('td', { text: `${MODELOS[m].curto}, ${d} dia${d > 1 ? 's' : ''} antes` }),
        el('td', { class: 'n', text: valido(r.taxaChuva) ? `${Math.round(r.taxaChuva * 100)}%` : '–' }),
        el('td', { class: 'n', text: valido(r.maeChuva) ? `${fmt.n(r.maeChuva, 1)} mm` : '–' }),
        el('td', { class: 'n', text: valido(r.maeRajada) ? `${fmt.n(r.maeRajada, 0)} km/h` : '–' }),
        el('td', { class: 'n', text: valido(r.maeTmax) ? `${fmt.n(r.maeTmax, 1)}°` : '–' }),
        el('td', { class: 'n', text: `${Math.max(r.amostrasChuva, r.amostrasRajada, r.amostrasTmax)}` })));
    }
    blocos.push(linhas.length ? el('div', { class: 'tabela-rolar', 'data-hscroll': '' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', { text: 'Modelo e antecedência' }), el('th', { class: 'n', text: 'Acerto chuva' }), el('th', { class: 'n', text: 'Erro volume' }), el('th', { class: 'n', text: 'Erro rajada' }), el('th', { class: 'n', text: 'Erro máx.' }), el('th', { class: 'n', text: 'Amostras' }))),
      el('tbody', {}, ...linhas))) : el('p', { class: 'nota', text: 'Ainda sem amostras.' }));
  }
  blocos.push(el('p', { class: 'nota', text: `Acerto de chuva: o modelo previu chuva acima de 1 mm e choveu, ou previu seco e não choveu. Erros são a média do erro absoluto. Pesos iguais até ${REGRAS.acerto.diasMinimos} dias; depois, ajuste entre ${REGRAS.acerto.pesoMin} e ${REGRAS.acerto.pesoMax}.` }));
  return el('div', {}, ...blocos);
}

// ------------------------------------------------------------------ El Niño

let ensoCarregando = false;
async function renderElNino() {
  const alvo = $('#elnino-conteudo');
  if (!estado.enso || Date.now() - estado.ensoEm > CONFIG.intervalos.enso * 60000) {
    if (ensoCarregando) return;
    ensoCarregando = true;
    alvo.replaceChildren(el('p', { class: 'nota', text: 'Carregando dados oficiais…' }));
    try { estado.enso = await buscarEnso(); estado.ensoEm = Date.now(); salvarCache('enso', estado.enso); }
    catch (e) { const c = await lerCache('enso'); if (c) { estado.enso = c.dados; estado.ensoEm = c.salvoEm; } else { alvo.replaceChildren(el('p', { text: `Dados do El Niño indisponíveis (${e.message}).` })); ensoCarregando = false; return; } }
    ensoCarregando = false;
  }
  const E = estado.enso, P = E.partes || {};
  limparGraficos(alvo);
  const filhos = [];
  const disc = P.discussao?.dados;
  const roniUlt = P.roni?.dados?.at(-1);
  filhos.push(painelEnso(P, disc, roniUlt));
  const avisoParte = (k) => (P[k]?.desatualizado ? el('p', { class: 'faixa-aviso erro', text: `A fonte mudou ou falhou (${P[k].erro}). Mostrando a última versão válida, de ${new Date(P[k].em).toLocaleDateString('pt-BR')}.` }) : null);
  filhos.push(secao('Status oficial da NOAA CPC', 'Estimativa oficial', avisoParte('discussao'),
    disc ? el('p', {}, el('span', { class: 'marca oficial', text: 'estimativa oficial' }), ' ', el('span', { lang: 'en', text: disc.sinopse })) : el('p', { text: 'Não foi possível ler a discussão.' }),
    disc ? el('p', { class: 'nota', text: `Publicado em ${disc.emitido || 'data não encontrada'}. Próxima atualização: ${disc.proxima || 'data não encontrada na fonte'}.` }) : null,
    el('p', {}, linkExterno(E.fontes?.cpc, 'Ler a discussão completa (em inglês)'))));
  const gInd = secao('Índices recentes', null);
  const gHist = secao('ONI e RONI desde 1950', null);
  gInd.classList.add('largura-total'); gHist.classList.add('largura-total');
  filhos.push(gInd, gHist);
  filhos.push(secao('O que cada índice mede', null, el('ul', {},
    el('li', { text: 'Niño 3.4 convencional: quanto o mar no Pacífico central está mais quente ou mais frio que a média de 1991 a 2020.' }),
    el('li', { text: 'Niño 3.4 relativo: a mesma anomalia, descontado o aquecimento de todos os oceanos tropicais. Evita confundir aquecimento global com El Niño.' }),
    el('li', { text: 'ONI: média de 3 meses do Niño 3.4 convencional. El Niño quando fica em +0,5 °C ou mais por vários trimestres.' }),
    el('li', { text: 'RONI: média de 3 meses do Niño 3.4 relativo. Desde 2026 é o índice que a NOAA usa para classificar El Niño e La Niña; por isso aparece em destaque aqui.' }))));
  filhos.push(secao('Probabilidades oficiais da NOAA por trimestre', 'Estimativa oficial do CPC, atualizada na 2ª quinta-feira de cada mês', avisoParte('probCpc'), barrasProb(P.probCpc?.dados), el('p', {}, linkExterno(E.fontes?.cpcProb, 'Tabela oficial'))));
  const iri = P.iri?.dados;
  filhos.push(secao('Previsão baseada em modelos do IRI', 'Separada da NOAA: combina dezenas de modelos dinâmicos e estatísticos, sem ajuste humano.', avisoParte('iri'),
    iri ? el('p', { class: 'nota', text: `Publicada em ${iri.publicado}.` }) : el('p', { text: 'Resumo do IRI indisponível.' }),
    iri?.forca ? el('p', { lang: 'en', text: iri.forca }) : null,
    el('p', { class: 'nota', text: 'Os números por modelo do IRI só são publicados como imagens, então o painel mostra o resumo em texto e o link.' }),
    el('p', {}, linkExterno(E.fontes?.iri, 'Ver a previsão do IRI'))));
  filhos.push(secao('Tendência para o Sul e o RS', 'INMET e parceiros', el('p', { text: 'O painel do INMET não tem formato de dados estável para leitura automática. Para não arriscar uma extração errada, mostramos só o link oficial.' }), el('p', {}, linkExterno(E.fontes?.inmet, 'Abrir o INMET'))));
  filhos.push(secao('Comparação com eventos fortes', 'Calculado a partir do RONI oficial', comparacaoHistorica(P.roni?.dados?.length ? P.roni.dados : P.oni?.dados)));
  filhos.push(el('p', { class: 'explica' }, 'El Niño indica tendências sazonais e não garante impactos específicos. Este painel não faz previsão própria de El Niño e não usa esses dados para alterar a previsão diária.'));
  filhos.push(el('p', { class: 'nota', text: `Dados verificados ${fmt.idade(E.verificadoEm)} (${E.origem || 'Worker'}; o app confere de novo a cada 6 horas).` }));
  alvo.replaceChildren(...filhos);

  const fmtMes = (u, vals) => vals.map((v) => { const d = new Date(v * 1000); return `${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`; });
  const rel = P.relativoSemanal?.dados || [], conv = P.convencionalSemanal?.dados || [];
  if (rel.length || conv.length) {
    const tempos = [...new Set([...rel, ...conv].map((r) => r.ms))].sort((a, b) => a - b).slice(-104);
    const mapa = (lista) => { const m = new Map(lista.map((r) => [r.ms, r.n34])); return tempos.map((t) => m.get(t) ?? null); };
    criarGrafico(gInd, { x: tempos, agora: false, emitirHora: false, sync: 'enso', formatoX: fmtMes, altura: 180, titulo: 'Niño 3.4 semanal, últimos 2 anos',
      fonte: 'NOAA CPC, arquivos rel_wksst9120.txt e wksst9120.for. Valores em °C de anomalia.',
      series: [
        { rotulo: 'relativo', valores: mapa(rel), corCss: '--quente', largura: 2.5, formato: (v) => `${fmt.n(v, 1)} °C` },
        { rotulo: 'convencional', valores: mapa(conv), corCss: '--fraco', largura: 1.5, dash: [5, 4], formato: (v) => `${fmt.n(v, 1)} °C` },
      ], eixos: [{ formato: (v) => `${v}` }] });
  } else gInd.append(el('p', { text: 'Índices semanais indisponíveis.' }), avisoParte('relativoSemanal'));
  const oni = P.oni?.dados || [], roni = P.roni?.dados || [];
  if (oni.length || roni.length) {
    const centro = { DJF: 0, JFM: 1, FMA: 2, MAM: 3, AMJ: 4, MJJ: 5, JJA: 6, JAS: 7, ASO: 8, SON: 9, OND: 10, NDJ: 11 };
    const ms = (r) => Date.UTC(r.ano, centro[r.seas], 15);
    const tempos = [...new Set([...oni, ...roni].map(ms))].sort((a, b) => a - b);
    const mapa = (lista) => { const m = new Map(lista.map((r) => [ms(r), r.anom])); return tempos.map((t) => m.get(t) ?? null); };
    criarGrafico(gHist, { x: tempos, agora: false, emitirHora: false, sync: 'enso2', formatoX: (u, v) => v.map((s) => String(new Date(s * 1000).getUTCFullYear())), altura: 180,
      titulo: 'ONI e RONI', fonte: 'NOAA CPC, oni.ascii.txt e RONI.ascii.txt. Arraste para ver desde 1950.' + (roni.length ? '' : ' RONI indisponível.'), horasVisiveis: 24 * 365 * 25, rolarFim: true,
      series: [
        { rotulo: 'ONI', valores: mapa(oni), corCss: '--fraco', largura: 1.5, dash: [5, 4], formato: (v) => `${fmt.n(v, 1)} °C` },
        { rotulo: 'RONI (principal)', valores: mapa(roni), corCss: '--quente', largura: 2.5, formato: (v) => `${fmt.n(v, 1)} °C` },
      ], eixos: [{ formato: (v) => `${v}` }] });
  } else gHist.append(el('p', { text: 'ONI indisponível.' }));
}

// Painel de controle: o estado atual em números, cada um com a data e o tipo do dado.
function intensidade(a) {
  if (!valido(a)) return null;
  const x = Math.abs(a), lado = a > 0 ? 'El Niño' : 'La Niña';
  if (x < 0.5) return 'neutro';
  if (x < 1) return `${lado} fraco`;
  if (x < 1.5) return `${lado} moderado`;
  if (x < 2) return `${lado} forte`;
  return `${lado} muito forte`;
}
function painelEnso(P, disc, roniUlt) {
  const sinal = (v) => (valido(v) ? `${v > 0 ? '+' : ''}${fmt.n(v, 1)} °C` : '–');
  const dataSem = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const rel = P.relativoSemanal?.dados?.at(-1), conv = P.convencionalSemanal?.dados?.at(-1);
  const dia = P.diario?.dados?.at(-1);
  const prob = P.probCpc?.dados?.[0];
  const bloco = (rot, val, sub, marca, destaque) => el('div', { class: 'enso-bloco' + (destaque ? ' destaque' : '') },
    el('small', { text: rot }), el('b', { text: val }), el('span', { class: 'sub', text: sub }), marca ? el('span', { class: 'marca ' + marca[0], text: marca[1] }) : null);
  const filhos = [
    el('p', { class: 'enso-status', text: disc ? traduzStatus(disc.status) : 'Status oficial indisponível' }),
    roniUlt ? el('p', { class: 'enso-intensidade', text: `Intensidade pelo RONI: ${intensidade(roniUlt.anom)}` }) : null,
    el('div', { class: 'enso-grade' },
      bloco('RONI, índice oficial', valido(roniUlt?.anom) ? `${roniUlt.anom > 0 ? '+' : ''}${fmt.n(roniUlt.anom, 2)} °C` : '–', roniUlt ? `trimestre ${roniUlt.seas} ${roniUlt.ano}` : 'indisponível', ['oficial', 'oficial'], true),
      bloco('Niño 3.4 da semana', sinal(rel?.n34), rel ? `relativo, semana de ${dataSem(rel.ms)}` : 'indisponível', ['medido', 'medido']),
      bloco('Niño 3.4 convencional', sinal(conv?.n34), conv ? `semana de ${dataSem(conv.ms)}` : 'indisponível', ['medido', 'medido']),
      dia ? bloco('Niño 3.4 de ontem', sinal(dia.anom), `${fmt.n(dia.sst, 1)} °C no mar, ${new Date(dia.data + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`, ['previsao', 'estimativa'])
        : bloco('Chance de El Niño', prob ? `${prob.elNino}%` : '–', prob ? `trimestre ${prob.tri}, NOAA` : 'indisponível', ['oficial', 'oficial'])),
    conv && (valido(conv.n12) || valido(conv.n4)) ? el('div', { class: 'enso-regioes' },
      ...[['Niño 1+2', conv.n12, 'costa do Peru'], ['Niño 3', conv.n3, 'leste'], ['Niño 3.4', conv.n34, 'centro'], ['Niño 4', conv.n4, 'oeste']]
        .map(([n, v, onde]) => el('div', {}, el('small', { text: n }), el('b', { text: sinal(v) }), el('span', { text: onde })))) : null,
    conv ? el('p', { class: 'nota', text: 'Regiões: anomalia convencional da última semana (NOAA CPC, OISST).' }) : null,
  ];
  if (P.diario?.dados?.length > 7) {
    const d = P.diario.dados.slice(-30);
    filhos.push(el('div', { class: 'enso-diario', role: 'img', 'aria-label': 'Niño 3.4 diário estimado, últimos 30 dias' },
      ...d.map((x) => el('i', { title: `${x.data}: ${sinal(x.anom)}`, style: { height: `${Math.max(2, Math.min(100, (Math.abs(x.anom) / 4) * 100))}%` }, class: x.anom >= 0 ? 'q' : 'f' }))));
    filhos.push(el('p', { class: 'nota', text: 'Últimos 30 dias, estimativa diária: média da temperatura do mar da Open-Meteo Marine em 18 pontos da região Niño 3.4, menos a média 1991-2020 da NOAA. Serve para acompanhar a tendência entre os boletins semanais; os números oficiais são os da NOAA acima.' }));
  } else if (P.diario && !P.diario.ok) filhos.push(el('p', { class: 'nota', text: 'Estimativa diária indisponível nesta atualização.' }));
  return el('section', { class: 'enso-painel largura-total' }, ...filhos);
}

function traduzStatus(s) {
  const t = String(s).toLowerCase();
  const partes = [];
  if (t.includes('el niño watch') || t.includes('el nino watch')) partes.push('Vigilância de El Niño');
  if (t.includes('el niño advisory') || t.includes('el nino advisory')) partes.push('El Niño em curso');
  if (t.includes('la niña watch') || t.includes('la nina watch')) partes.push('Vigilância de La Niña');
  if (t.includes('la niña advisory') || t.includes('la nina advisory')) partes.push('La Niña em curso');
  if (t.includes('final')) partes.push('aviso final do evento');
  if (t.includes('not active')) partes.push('Sem alerta ativo: condições neutras');
  return partes.length ? `${partes.join(', ')} (NOAA: ${s})` : `NOAA: ${s}`;
}

function barrasProb(linhas) {
  if (!linhas?.length) return el('p', { text: 'Tabela indisponível ou com formato inesperado.' });
  return el('div', {}, el('p', { class: 'nota' }, el('span', { style: { color: 'var(--fria)' }, text: 'La Niña' }), ', neutro, ', el('span', { style: { color: 'var(--quente)' }, text: 'El Niño' })),
    ...linhas.map((l) => el('div', { class: 'pbar', role: 'img', 'aria-label': `${l.tri}: La Niña ${l.laNina}%, neutro ${l.neutro}%, El Niño ${l.elNino}%` },
      el('span', { text: l.tri }),
      el('span', { class: 'trilho' },
        el('i', { class: 'ln', style: { width: l.laNina + '%' }, text: l.laNina >= 12 ? `${l.laNina}` : '' }),
        el('i', { class: 'ne', style: { width: l.neutro + '%' }, text: l.neutro >= 12 ? `${l.neutro}` : '' }),
        el('i', { class: 'en', style: { width: l.elNino + '%' }, text: l.elNino >= 12 ? `${l.elNino}` : '' })))),
    el('p', { class: 'nota', text: 'Trimestres em inglês: DJF é dezembro-janeiro-fevereiro, JFM é janeiro-fevereiro-março, e assim por diante. Números em %.' }));
}

function comparacaoHistorica(oni) {
  if (!oni?.length) return el('p', { text: 'ONI indisponível.' });
  // eventos: sequências com ONI >= 0,5; fortes quando o pico passa de 1,5
  const eventos = []; let atual = null;
  for (const r of oni) {
    if (r.anom >= 0.5) { if (!atual) atual = { ini: r, pico: r }; if (r.anom > atual.pico.anom) atual.pico = r; atual.fim = r; }
    else if (atual) { eventos.push(atual); atual = null; }
  }
  if (atual) eventos.push({ ...atual, emCurso: true });
  const fortes = eventos.filter((e) => e.pico.anom >= 1.5);
  const ultimo = oni[oni.length - 1];
  return el('div', {},
    el('p', {}, `Último valor: ${fmt.n(ultimo.anom, 2)} °C (${ultimo.seas} ${ultimo.ano}).`),
    el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Evento forte' }), el('th', { class: 'n', text: 'Pico' }))),
      el('tbody', {}, ...fortes.map((e) => el('tr', {}, el('td', { text: `${e.ini.ano}–${e.fim.ano}${e.emCurso ? ' (em curso)' : ''}` }), el('td', { class: 'n', text: `${fmt.n(e.pico.anom, 1)} °C` }))))),
    el('p', { class: 'nota', text: 'Eventos com intensidade parecida tiveram impactos diferentes no RS. A comparação mostra só a força do aquecimento, não sugere que os impactos se repetirão.' }));
}

// ------------------------------------------------------------------ navegação e gestos

const ABAS = ['hoje', 'amanha', 'semana', 'modelos', 'elnino'];
function irPara(aba, rolarTopo = true) {
  if (!ABAS.includes(aba)) return;
  estado.aba = aba;
  for (const s of document.querySelectorAll('.aba')) s.hidden = s.dataset.aba !== aba;
  for (const b of document.querySelectorAll('.nav button')) b.toggleAttribute('aria-current', b.dataset.ir === aba) || b.removeAttribute('aria-current');
  document.querySelectorAll('.nav button').forEach((b) => { if (b.dataset.ir === aba) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (rolarTopo) window.scrollTo(0, 0);
  if (aba === 'elnino' && estado.prev !== undefined) renderElNino();
  for (const f of estado.faixas) f.desenhar();
  window.dispatchEvent(new Event('resize'));
}

function configurarNavegacao() {
  for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => irPara(b.dataset.ir));
  // deslizar entre Hoje, Amanhã e Semana, sem roubar gestos de listas e gráficos
  let x0 = null, y0 = null, alvoH = false;
  const main = $('#conteudo');
  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    alvoH = !!e.target.closest('[data-hscroll], .mapa, .ceu, dialog');
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 === null || alvoH) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const trio = ['hoje', 'amanha', 'semana'];
    const k = trio.indexOf(estado.aba);
    if (k < 0) return;
    const n = dx < 0 ? k + 1 : k - 1;
    if (n >= 0 && n < trio.length) irPara(trio[n]);
  }, { passive: true });
}

function configurarPuxar() {
  const ind = $('#puxar');
  let y0 = null, dy = 0;
  window.addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 && e.touches.length === 1 && !e.target.closest('.mapa, dialog') ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    ind.style.height = dy > 10 ? Math.min(44, dy / 2) + 'px' : '0';
    ind.textContent = dy > 80 ? 'Solte para atualizar' : 'Puxe para atualizar';
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (y0 !== null && dy > 80) atualizar({ forcar: true });
    y0 = null; ind.style.height = '0';
  }, { passive: true });
}

// ------------------------------------------------------------------ tema, rodapé, apagar dados

function aplicarTema() {
  const t = prefs.ler('tema', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-tema'); else document.documentElement.setAttribute('data-tema', t);
  const fundo = getComputedStyle(document.documentElement).getPropertyValue('--fundo').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', fundo || '#17303B');
  const b = $('#btn-tema'); if (b) b.textContent = `Tema: ${{ auto: 'automático', claro: 'claro', escuro: 'escuro' }[t]}`;
}

function configurarRodape() {
  $('#btn-tema').addEventListener('click', () => {
    const ordem = ['auto', 'claro', 'escuro'];
    prefs.gravar('tema', ordem[(ordem.indexOf(prefs.ler('tema', 'auto')) + 1) % 3]);
    aplicarTema(); renderTudo();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { aplicarTema(); renderTudo(); });
  $('#btn-apagar').addEventListener('click', async () => {
    if (!confirm('Apagar localização, preferências e dados salvos deste aparelho? O app vai recarregar.')) return;
    estado.apagado = true; // para atualizações e gravações
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    $('#conteudo').replaceChildren(el('section', { class: 'detalhes' }, el('p', { class: 'frase', text: 'Dados deste aparelho apagados' }),
      el('p', { text: 'Localização, preferências e dados salvos foram removidos. Ao abrir de novo, o app vai pedir a localização outra vez.' }),
      el('button', { type: 'button', class: 'largo', onclick: () => location.reload() }, 'Abrir de novo')));
  });
}

// expõe só para testes automatizados
window.__painel = { estado, REGRAS };
void bus; void classeRajada; void MODELOS_ENSEMBLE;
