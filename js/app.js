// Painel Meteorológico Pessoal: aplicação principal.
import { CONFIG } from './config.js';
import {
  REGRAS, MODELOS, valido, mediana, minimo, maximo, quantil, partesLocais, distanciaKm, arredondaCoord, direcaoTexto,
  indicesDoDia, resumoModeloDia, membrosDia, avaliarDia, probLimites, horasProvaveisDeChuva, fraseDoDia,
  horizonteDivergencia, pesosModelos, correcaoTemperatura, consensoHorario, escolherFonte, ancorarTemperatura, periodoDoDia, classeRajada,
  condicaoCeu, respostaChuva, variacaoSerie, classeTendenciaPressao, avaliarPressao, leituraPressao, riscoTemporal,
  calibrarPrevisao, calibrarEnsemble, calibracaoAplicavel, pesosHistoricos, viesHistorico,
} from './analise.js';
import {
  buscarPrevisao, buscarEnsemble, buscarCidades, buscarObservacoes, buscarAlertas, buscarEnso, buscarAcerto, buscarCalibracao,
  salvarCache, lerCache, workerConfigurado, MODELOS_ENSEMBLE, buscarAlertasDireto, buscarObservacoesDireto, buscarChuvaRadar, buscarChegadaChuva,
} from './dados.js';
import { el, svg, fmt, setaVento, ausente, bus, secao, mostrarInfo, prefs, linkExterno } from './ui.js';
import { criarFaixa } from './faixa.js';
import { criarGrafico, limparGraficos, noitesDe, dataNoFuso } from './graficos.js';

const VERSAO = '1.2.23';
const $ = (s) => document.querySelector(s);

const estado = {
  local: null, aba: 'hoje',
  prev: null, prevEm: null, ens: null, ensEm: null, ensErros: [],
  obs: null, obsEm: null, alertas: null, alertasEm: null, enso: null, ensoEm: null, acerto: {}, acertoEm: null,
  // séries como vieram da Open-Meteo; estado.prev e estado.ens são as versões calibradas (recalibrar)
  prevBruta: null, ensBruto: null, calib: null, calibEm: null,
  erros: {}, cacheAntigo: false, faixas: [],
};

// Estações de verificação: as mesmas do Worker (coordenadas públicas das estações).
const VERIFICACAO = [
  { id: 'A884', nome: 'Campo Bom (INMET)', lat: -29.674, lon: -51.064, chuva: true },
  { id: 'A801', nome: 'Porto Alegre Jardim Botânico (INMET)', lat: -30.054, lon: -51.175, chuva: true },
  { id: 'SBCO', nome: 'Canoas (METAR)', lat: -29.945, lon: -51.144, chuva: false },
];

// ------------------------------------------------------------------ modo widget

/**
 * Modo widget (?widget=1): a página é carregada fora da tela pelo widget do iPhone (widget/painel-widget.js,
 * app Scriptable). Roda a mesma busca e a mesma análise do app e entrega o resumo de Hoje em
 * window.painelResumo (Promise). Nesse modo não há GPS, telas, gravação de preferências nem service worker.
 * O local vem dos parâmetros lat e lon (o widget já os arredonda); sem eles, o centro de Campo Bom.
 * Contrato do resumo: docs/TECNICO.md, seção 11.
 */
const MODO_WIDGET = lerModoWidget(location.search);
const FORMATO_RESUMO = 1;        // muda só quando o contrato do resumo mudar de forma incompatível
const ESPERA_WIDGET_MS = 20000;  // teto para as fontes lentas; depois disso o resumo sai com o que chegou
let entregarResumo = () => {};
if (MODO_WIDGET) window.painelResumo = new Promise((ok) => { entregarResumo = ok; });

/**
 * Lê os parâmetros do modo widget.
 * @param {string} busca location.search
 * @returns {{local:{nome:string, regiao?:string, lat:number, lon:number, origem:string}}|null} null fora do modo widget
 */
function lerModoWidget(busca) {
  const q = new URLSearchParams(busca);
  if (q.get('widget') !== '1') return null;
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  const coordOk = q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!coordOk) return { local: { ...CONFIG.padrao, origem: 'padrao' } };
  const nome = String(q.get('nome') || '').replace(/[^\p{L}\p{N} '.,-]/gu, '').trim().slice(0, 40) || 'Sua localização';
  return { local: { nome, lat: arredondaCoord(lat), lon: arredondaCoord(lon), origem: 'widget' } };
}

/**
 * Início no modo widget: busca todas as fontes que entram na análise de Hoje (sem El Niño) e entrega o resumo.
 * Uma falha nunca deixa a Promise pendente: sai { formato, erro }.
 */
async function iniciarWidget() {
  estado.local = MODO_WIDGET.local;
  try {
    await Promise.race([atualizar({ forcar: true, completo: true }), new Promise((ok) => setTimeout(ok, ESPERA_WIDGET_MS))]);
    entregarResumo(estado.prev ? resumoWidget() : { formato: FORMATO_RESUMO, erro: estado.erros.previsao || 'previsão indisponível' });
  } catch (e) {
    entregarResumo({ formato: FORMATO_RESUMO, erro: String(e?.message || e).slice(0, 120) });
  }
}

// ------------------------------------------------------------------ início

window.addEventListener('DOMContentLoaded', iniciar);

async function iniciar() {
  if (MODO_WIDGET) { await iniciarWidget(); return; }
  aplicarTema();
  $('#versao').textContent = `Versão ${VERSAO}`;
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
    estado.prevBruta = reidratar(c.dados); estado.prevEm = c.salvoEm; estado.cacheAntigo = true;
    const e = await lerCache('ensemble'); if (e?.dados) { estado.ensBruto = e.dados; estado.ensEm = e.salvoEm; }
    const k = await lerCache('calibracao'); if (k?.dados) { estado.calib = k.dados; estado.calibEm = k.salvoEm; }
    const o = await lerCache('observacoes'); if (o?.dados) { estado.obs = o.dados; estado.obsEm = o.salvoEm; }
    recalibrar();
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
    await localizarGps(true, true);
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

function localizarGps(silencioso, recente = false) {
  return new Promise((ok0) => {
    // No iPhone (app na tela inicial), o GPS às vezes não chama nenhum dos retornos, nem o de tempo esgotado.
    // Esta trava encerra a espera em 12 s mantendo o último local, para o botão nunca ficar girando.
    let feito = false;
    const ok = () => { if (!feito) { feito = true; clearTimeout(trava); ok0(); } };
    const trava = setTimeout(() => { if (!feito) usarPadrao('GPS demorou demais.'); }, 12000);
    const usarPadrao = (motivo) => {
      if (feito) return;
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
      if (feito) return;
      // A coordenada exata fica só em memória, para distâncias no aparelho.
      estado.localExato = { lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy };
      estado.avisoGps = null;
      definirLocal({ nome: 'Sua localização', regiao: `GPS, precisão de ${Math.round(pos.coords.accuracy)} m`, lat: pos.coords.latitude, lon: pos.coords.longitude, origem: 'gps' });
      ok();
    }, (err) => {
      const m = { 1: 'Permissão de localização negada.', 2: 'GPS sem sinal.', 3: 'GPS demorou demais.' }[err.code] || 'GPS falhou.';
      usarPadrao(m);
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: recente ? 0 : 2 * 60000 });
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

let atualizando = false, atualizandoDesde = 0;
/**
 * Busca as fontes vencidas (CONFIG.intervalos) em paralelo e redesenha quando chegam.
 * Retorna quando a previsão chega (ou quando todas terminam, com teto de 30 s), para o botão parar de girar.
 * @param {{forcar?:boolean, local?:boolean, agora?:boolean, completo?:boolean}} [op] forcar/local ignoram a validade;
 *   local também descarta dados do local anterior; agora força medições e radar; completo só retorna quando
 *   todas as fontes terminarem (teto de 30 s), usado pelo modo widget.
 */
async function atualizar({ forcar = false, local = false, agora = false, completo = false } = {}) {
  if (!estado.local || estado.apagado) return;
  if (atualizando && Date.now() - atualizandoDesde > 40000) atualizando = false; // busca presa (app suspenso no meio): recomeça
  // Uma busca automática não repete outra em andamento; a pedida pelo botão sempre sai na hora, sem esperar.
  if (atualizando && !forcar && !agora) return;
  atualizando = true; atualizandoDesde = Date.now();
  $('#btn-atualizar').setAttribute('aria-busy', 'true');
  $('#btn-atualizar').setAttribute('aria-label', 'Atualizando');
  const venceu = (em, min) => forcar || local || !em || Date.now() - em > min * 60000;
  const I = CONFIG.intervalos;
  const { lat, lon } = estado.local;
  try {
    // Todas as fontes saem ao mesmo tempo; a primeira tela é desenhada assim que a previsão chega.
    if (local) { estado.ens = null; estado.ensBruto = null; estado.obs = null; estado.alertas = null; }
    const tarefas = [];
    let principal = Promise.resolve();
    if (venceu(estado.prevEm, I.previsao)) tarefas.push(principal = buscarPrevisao(lat, lon)
      .then((pv) => { estado.prevBruta = pv; estado.prevEm = Date.now(); estado.cacheAntigo = false; delete estado.erros.previsao; salvarCache('previsao', pv); recalibrar(); })
      .catch((e) => { estado.erros.previsao = e.message; })
      .then(() => renderTudo()));
    if (venceu(estado.ensEm, I.cenarios)) tarefas.push(buscarEnsemble(lat, lon).then(({ ens, erros }) => {
      estado.ensErros = erros;
      if (ens) { estado.ensBruto = ens; estado.ensEm = Date.now(); salvarCache('ensemble', ens); delete estado.erros.ensemble; recalibrar(); }
      else estado.erros.ensemble = erros.join('; ') || 'sem dados';
    }));
    const w = workerConfigurado();
    // Medições: Worker (INMET + METAR); sem ele, só a última leitura do INMET de Campo Bom direto.
    if (agora || venceu(estado.obsEm, I.medicoes)) tarefas.push((w ? buscarObservacoes(lat, lon).catch(() => buscarObservacoesDireto()) : buscarObservacoesDireto())
      .then((o) => { estado.obs = o; estado.obsEm = Date.now(); salvarCache('observacoes', o); delete estado.erros.medicoes; recalibrar(); })
      .catch((e) => { estado.erros.medicoes = e.message; }));
    // Alertas: Worker (resposta enxuta) ou INMET direto. Falha vira "Alertas indisponíveis".
    if (venceu(estado.alertasEm, I.alertas)) tarefas.push((w ? buscarAlertas().catch(() => buscarAlertasDireto()) : buscarAlertasDireto())
      .then((a) => { estado.alertas = a; estado.alertasEm = Date.now(); delete estado.erros.alertas; })
      .catch((e) => { estado.alertas = null; estado.erros.alertas = e.message; }));
    // Radar sobre o ponto: diz se está chovendo agora, mesmo entre as leituras horárias da estação.
    if (agora || venceu(estado.radarAgoraEm, 5)) tarefas.push(buscarChuvaRadar(lat, lon)
      .then((r) => { estado.radarAgora = r; estado.radarAgoraEm = Date.now(); })
      .catch(() => { estado.radarAgora = null; }));
    // Chuva chegando: movimento dos ecos do radar extrapolado até o local (mesma cadência do radar).
    if (agora || venceu(estado.chegadaEm, 5)) tarefas.push(buscarChegadaChuva(lat, lon)
      .then((c) => { estado.chegada = c; estado.chegadaEm = Date.now(); })
      .catch(() => { estado.chegada = null; }));
    // El Niño: arquivo do robô do GitHub ou Worker; no botão atualizar, busca de novo também
    if (!MODO_WIDGET && venceu(estado.ensoEm, I.enso)) tarefas.push(buscarEnso()
      .then((e) => { estado.enso = e; estado.ensoEm = Date.now(); salvarCache('enso', e); delete estado.erros.enso; })
      .catch((e) => { estado.erros.enso = e.message; }));
    if (w && venceu(estado.acertoEm, I.acerto)) tarefas.push(Promise.all(VERIFICACAO.map((v) => buscarAcerto(v.id).then((a) => { estado.acerto[v.id] = a; }).catch(() => {}))).then(() => { estado.acertoEm = Date.now(); recalibrar(); }));
    // Calibração com o histórico: arquivo mensal do robô do GitHub; sem ele, o painel segue sem correção histórica.
    if (venceu(estado.calibEm, I.acerto)) tarefas.push(buscarCalibracao()
      .then((k) => { estado.calib = k; estado.calibEm = Date.now(); salvarCache('calibracao', k); delete estado.erros.calibracao; recalibrar(); })
      .catch((e) => { estado.erros.calibracao = e.message; }));
    // O botão para de girar quando a previsão chega. As outras fontes (medições, alertas, radar, El Niño)
    // continuam chegando e redesenham a tela sozinhas, com teto de 30 s: uma fonte lenta não segura o botão.
    const resto = Promise.race([Promise.all(tarefas), new Promise((r) => setTimeout(r, 30000))])
      .then(() => { if (tarefas.length && estado.prev) renderTudo(); })
      .finally(() => { atualizando = false; atualizarCabecalho(); });
    await (completo ? resto : Promise.race([principal, resto]));
  } catch {
    atualizando = false;
  } finally {
    if (!tudoRodando) { $('#btn-atualizar').removeAttribute('aria-busy'); $('#btn-atualizar').setAttribute('aria-label', 'Atualizar'); }
    atualizarCabecalho();
  }
}

function agendar() {
  // Os dados são buscados ao abrir o app, ao voltar para ele (inclusive pelo atalho na tela inicial), no botão
  // atualizar e, com a tela aberta e visível, a cada CONFIG.atualizarTelaAbertaMin minutos sem atualização.
  // O relógio de 60 s reescreve o "Atualizado às..." do topo e confere se a última rodada já venceu.
  // Não há busca com a página escondida nem automática ao reconectar.
  setInterval(() => {
    atualizarCabecalho();
    const venceu = Date.now() - ultimaRodada >= CONFIG.atualizarTelaAbertaMin * 60000;
    if (venceu && !document.hidden && navigator.onLine !== false) atualizarTudo();
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarTudo(); });
  // página restaurada do cache de navegação (voltar/avançar ou reabrir a aba)
  window.addEventListener('pageshow', (e) => { if (e.persisted) atualizarTudo(); });
  window.addEventListener('online', () => avisar('Conexão de volta. Toque em atualizar para buscar os dados novos.'));
  window.addEventListener('offline', () => avisar('Sem conexão. Mostrando os últimos dados salvos, que podem estar desatualizados.', true));
  $('#btn-atualizar').addEventListener('click', () => atualizarTudo());
}

// Atualiza tudo, sem exceção: posição atual (salvo cidade escolhida nesta sessão), previsão, cenários,
// medições, radar, alertas, El Niño, acerto dos modelos, mapa e a própria versão do app.
// ultimaRodada: início da última rodada (ou da abertura do app), base da atualização a cada 10 min com a tela aberta.
let tudoRodando = false, tudoDesde = 0, ultimaRodada = Date.now(), rodada = 0;
async function atualizarTudo() {
  // Já está atualizando tudo: o giro do botão mostra isso. Mas se a rodada passou de 45 s (o iPhone
  // suspende o app no meio e as esperas nunca terminam), ela é abandonada e uma nova começa.
  if (tudoRodando && Date.now() - tudoDesde < 45000) return;
  const minha = ++rodada;
  tudoRodando = true; tudoDesde = ultimaRodada = Date.now();
  const vigia = setTimeout(() => { if (rodada === minha) pararGiro(); }, 50000);
  const btn = $('#btn-atualizar');
  btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-label', 'Atualizando');
  try {
    let escolha = false;
    try { escolha = sessionStorage.getItem('localEscolhido') === '1'; } catch {}
    const chave = () => (estado.local ? `${arredondaCoord(estado.local.lat)},${arredondaCoord(estado.local.lon)}` : null);
    const antes = chave();
    // GPS e busca começam juntos: os dados chegam sem esperar o GPS; se a posição mudou, busca de novo.
    const gps = escolha && estado.local?.origem === 'cidade' ? Promise.resolve() : localizarGps(true, true);
    await atualizar({ forcar: true });
    await gps;
    if (chave() !== antes) await atualizar({ forcar: true, local: true });
  } finally {
    clearTimeout(vigia);
    if (rodada === minha) pararGiro();
    navigator.serviceWorker?.getRegistration?.().then((r) => r?.update()).catch(() => {});
  }
}

function pararGiro() {
  tudoRodando = false;
  const btn = $('#btn-atualizar');
  btn.removeAttribute('aria-busy'); btn.setAttribute('aria-label', 'Atualizar');
  atualizarCabecalho();
}

function atualizarCabecalho() {
  if (estado.local) {
    $('#local-nome').textContent = estado.local.nome;
    $('#btn-local').setAttribute('aria-label', `Local: ${estado.local.nome}. Toque para trocar.`);
  }
  const h = $('#local-hora');
  if (!estado.prevEm) { h.textContent = 'sem dados ainda'; return; }
  const atraso = Date.now() - estado.prevEm > 45 * 60000;
  h.textContent = `Atualizado às ${fmt.horaMin(estado.prevEm, estado.prev?.offset ?? -10800)}${atraso ? ', desatualizado' : ''}`;
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

/**
 * Temperatura agora: medição da estação mais próxima (até 25 km e 2 h); sem ela, a prevista para esta hora
 * (valor "current" do ECMWF, MODELO_TEMP; sem ele, mediana ponderada dos modelos; por fim, a hora cheia).
 * Fonte única do topo, do resumo de Hoje e do widget.
 * @returns {{valor:number|null, medida:boolean, estacao:object|null, ms:number|null, distanciaKm:number|null}|null}
 *   estacao é a fonte da medição (null quando prevista); null sem medição e sem previsão
 */
function temperaturaAgora() {
  const pt = pontoExato();
  const med = escolherFonte(fontesNormalizadas(), 'temperatura', pt.lat, pt.lon, Date.now(), 120).escolhida;
  if (med && med.distancia <= 25) return { valor: med.valor, medida: true, estacao: med.fonte, ms: med.ms, distanciaKm: med.distancia };
  const p = estado.prev;
  if (!p) return null;
  const { pesos } = pesosAtuais();
  const mods = modelosAtivos();
  let v = valido(p.atual?.temp?.[MODELO_TEMP]) ? p.atual.temp[MODELO_TEMP] : mediana(mods.map((m) => p.atual?.temp?.[m]), mods.map((m) => pesos[m] ?? 1));
  if (!valido(v)) v = p.atual?.geral ?? null;
  if (!valido(v)) {
    let i = -1;
    for (let k = 0; k < p.horas.length; k++) if (p.horas[k] <= Date.now()) i = k;
    v = i < 0 ? null : tempHora(p, 'temperature_2m', i, mods);
  }
  return { valor: valido(v) ? v : null, medida: false, estacao: null, ms: estado.prevEm, distanciaKm: null };
}

// Temperatura agora no topo e no resumo de Hoje (temperaturaAgora).
function renderAgora() {
  const alvo = $('#agora');
  const noResumo = document.getElementById('agora-hoje');
  const t = temperaturaAgora();
  if (!t) { alvo.replaceChildren(); return; }
  const texto = fmt.c(t.valor) ?? '–';
  alvo.replaceChildren(el('span', { class: 'rot-agora', text: 'Agora' }), el('b', { text: texto }));
  if (t.medida) {
    alvo.title = `Medido em ${t.estacao.nome}, ${fmt.n(t.distanciaKm, 0)} km, ${fmt.idade(t.ms)}`;
    alvo.setAttribute('aria-label', `Temperatura agora ${texto}, ${alvo.title}`);
  } else {
    alvo.title = 'Sem medição recente perto daqui; valor previsto pelos modelos para esta hora.';
    alvo.setAttribute('aria-label', `Temperatura agora ${fmt.c(t.valor) ?? 'sem dado'}, prevista`);
  }
  if (noResumo) {
    noResumo.replaceChildren(el('b', { text: texto }), el('span', { class: 'rot-agora', text: t.medida ? 'agora' : 'agora (prevista)' }));
    noResumo.title = alvo.title;
  }
}

// No topo, a temperatura só aparece quando a de hoje (no resumo) não está visível.
let obsAgora = null;
function observarAgora() {
  const alvo = document.getElementById('agora-hoje');
  if (obsAgora) obsAgora.disconnect();
  if (!alvo || !('IntersectionObserver' in window)) return;
  obsAgora = new IntersectionObserver(([e]) => { $('#agora').classList.toggle('oculto', e.isIntersecting && estado.aba === 'hoje'); }, { threshold: 0.5 });
  obsAgora.observe(alvo);
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

// O que o painel aprendeu só vale perto da estação onde aprendeu (até 50 km).
function aprendizadoLocal() {
  const a = estacaoAcerto();
  if (!a?.porModelo || !a.estacao) return null;
  const p = pontoExato();
  return distanciaKm(p.lat, p.lon, a.estacao.lat, a.estacao.lon) <= REGRAS.acerto.distanciaMaxKm ? a : null;
}

function pesosAtuais() {
  const a = aprendizadoLocal()?.porModelo;
  const mapa = {};
  if (a) for (const m of Object.keys(a)) {
    const l1 = a[m]?.[1] || {};
    mapa[m] = { dias: Math.max(l1.amostrasChuva ?? 0, l1.amostrasTmax ?? 0), maeChuva: l1.maeChuva, maeTmax: l1.maeTmax };
  }
  return pesosModelos(a ? mapa : null, modelosAtivos(), calibracaoLocal() ? pesosHistoricos(estado.calib) : null);
}

// Calibração com o histórico: só vale perto da estação onde foi medida (até 50 km).
function calibracaoLocal() {
  const p = estado.prevBruta || estado.prev;
  return estado.calib && p && calibracaoAplicavel(estado.calib, p.lat, p.lon) ? estado.calib : null;
}

/**
 * Fonte única dos valores exibidos (inclui a ancoragem da temperatura na medição de agora): recalcula estado.prev e estado.ens a partir das séries brutas sempre que
 * chega previsão, cenários, calibração ou aprendizado novo. Todas as telas leem estado.prev/estado.ens, então
 * herdam a mesma correção (temperatura, rajada e vento), sem ajustes separados por tela.
 */
// Última temperatura medida perto do ponto (estação mais próxima com leitura válida), ou null.
function temperaturaMedida(idadeMaxMin, distanciaMaxKm) {
  const pt = pontoExato();
  if (!estado.obs || !pt) return null;
  const c = escolherFonte(fontesNormalizadas(), 'temperatura', pt.lat, pt.lon, Date.now(), idadeMaxMin).escolhida;
  return c && c.distancia <= distanciaMaxKm ? { valor: c.valor, ms: c.ms, fonte: c.fonte.nome } : null;
}

function recalibrar() {
  const bruta = estado.prevBruta;
  if (!bruta) return;
  const calib = calibracaoLocal();
  const apr = aprendizadoLocal()?.porModelo || null;
  const ref = estado.prevEm || Date.now();
  estado.prev = calibrarPrevisao(bruta, { calib, aprendizado: apr, refMs: ref });
  // próximas horas ancoradas na temperatura medida agora (some em REGRAS.ancoragem.horas)
  const medida = temperaturaMedida(REGRAS.ancoragem.idadeMaxMin, REGRAS.ancoragem.distanciaKm);
  const anc = medida ? ancorarTemperatura(estado.prev, medida, MODELO_TEMP, Date.now()) : null;
  if (anc) estado.prev = anc.prev;
  estado.ancoragem = anc?.delta ? { delta: anc.delta, medida } : null;
  estado.ens = estado.ensBruto ? calibrarEnsemble(estado.ensBruto, calib, ref, bruta.offset) : null;
  cacheDias.clear();
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
/**
 * Análise de um dia: resumos por modelo, cenários, avaliarDia, janela provável de chuva, pico de rajada
 * (direção por média vetorial), mínima e máxima pelo ECMWF com correção de viés e limites da Semana.
 * Memorizada em cacheDias pela data e pelos instantes de atualização de cada fonte.
 * @param {string} data "AAAA-MM-DD" local
 * @param {number} diaIndice 0 = hoje
 * @param {boolean} desdeAgora considerar só as horas restantes
 */
function analisarDia(data, diaIndice, desdeAgora) {
  const chave = `${data}|${desdeAgora}|${estado.prevEm}|${estado.ensEm}|${estado.obsEm}|${estado.acertoEm}|${estado.chegadaEm}|${estado.radarAgoraEm}|${estado.calibEm}`;
  if (cacheDias.has(chave)) return cacheDias.get(chave);
  const p = estado.prev, mods = modelosAtivos();
  // Hoje, com o radar seco e nada chegando, as horas cobertas pelo radar saem da conta do dia:
  // o veredito passa a valer para o que resta depois delas (os modelos ainda não viram a chuva parar).
  const seco = desdeAgora && diaIndice === 0 ? secoAgora() : null;
  let inicio = desdeAgora ? Date.now() : -Infinity;
  const idxTodo = indicesDoDia(p.horas, data, p.offset);
  if (seco && indicesDoDia(p.horas, data, p.offset, seco.ateMs).length) inicio = seco.ateMs;
  const idx = indicesDoDia(p.horas, data, p.offset, inicio);
  const idxAgora = desdeAgora ? indicesDoDia(p.horas, data, p.offset, Date.now()) : idxTodo; // gráficos: sempre da hora atual
  const usar = idx.length ? idx : idxTodo;
  const { pesos, ajustado } = pesosAtuais();
  const resumos = mods.map((m) => resumoModeloDia(p, m, usar));
  // A temperatura já vem corrigida nas séries horárias (recalibrar: histórico + aprendizado recente).
  const apr = aprendizadoLocal();
  const resumosTodo = mods.map((m) => resumoModeloDia(p, m, idxTodo));
  const membros = membrosDia(estado.ens, data, p.offset, inicio);
  const medAgora = diaIndice === 0 ? medicaoChuvaAgora() : null;
  const av = avaliarDia(resumos, membros, { diaIndice, acerto: acertoCtx(diaIndice), pesos, medicaoAgora: medAgora, calibracao: apr?.calibracao, chegando: diaIndice === 0 && !!chegandoAgora() });
  const horasChuva = horasProvaveisDeChuva(p, usar, mods);
  // rajada: pico da mediana horária entre modelos, com horário e direção
  const cons = consensoHorario(p, 'wind_gusts_10m', mods);
  let pico = null;
  for (const i of usar) if (valido(cons.med[i]) && (!pico || cons.med[i] > cons.med[pico])) pico = i;
  const dirPico = pico === null ? null : direcaoMedia(mods.map((m) => p.modelos[m].vars.wind_direction_10m?.[pico]));
  const r = {
    data, diaIndice, idx: usar, idxAgora, idxTodo, resumos, membros, av, horasChuva, pesosAjustados: ajustado,
    frase: fraseDoDia(av, horasChuva.janela, p.offset),
    // mínima e máxima: ECMWF (padrão europeu), corrigido pelo aprendizado; sem ECMWF, mediana ponderada
    tmin: valido(resumosTodo.find((x) => x.modelo === MODELO_TEMP)?.tmin) ? resumosTodo.find((x) => x.modelo === MODELO_TEMP).tmin : mediana(resumosTodo.map((x) => x.tmin), resumosTodo.map((x) => pesos[x.modelo] ?? 1)),
    tmax: valido(resumosTodo.find((x) => x.modelo === MODELO_TEMP)?.tmax) ? resumosTodo.find((x) => x.modelo === MODELO_TEMP).tmax : mediana(resumosTodo.map((x) => x.tmax), resumosTodo.map((x) => pesos[x.modelo] ?? 1)),
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

/**
 * Céu do dia pelos modelos: cobertura média das horas (de dia, se houver) e chance de chuva do veredito.
 * @returns {ReturnType<typeof condicaoCeu>}
 */
function ceuDoDia(a) {
  const p = estado.prev, mods = modelosAtivos();
  const nuv = consensoHorario(p, 'cloud_cover', mods).med, dia = consensoHorario(p, 'is_day', mods).med;
  return condicaoCeu(a.idx.map((i) => nuv[i]), a.idx.map((i) => (valido(dia[i]) ? Math.round(dia[i]) : null)), a.av.prob);
}

/**
 * Céu de agora, com medição real quando houver: cobertura de nuvens do METAR mais recente (até
 * REGRAS.ceuMedido.distanciaKm e REGRAS.ceuMedido.idadeMin); sem METAR, a cobertura dos modelos na hora atual.
 * A chuva vem só do que se mede agora (radar ou estação): previsão de chuva fica na linha "Vai chover", não no céu.
 * @returns {(ReturnType<typeof condicaoCeu> & {origem:string})|null}
 */
function ceuAgora() {
  const p = estado.prev, mods = modelosAtivos(), agora = Date.now(), pt = pontoExato();
  const i = p.horas.findIndex((ms) => agora >= ms && agora < ms + 3600000);
  const dia = i < 0 ? null : consensoHorario(p, 'is_day', mods).med[i];
  // entre os METAR válidos dentro da distância, o boletim mais recente (o céu muda mais rápido que a distância pesa)
  const { escolhida, outras } = escolherFonte(fontesNormalizadas(), 'nuvens', pt.lat, pt.lon, agora, REGRAS.ceuMedido.idadeMin);
  const medido = [escolhida, ...outras].filter((c) => c?.ok && c.distancia <= REGRAS.ceuMedido.distanciaKm).sort((x, y) => y.ms - x.ms)[0] || null;
  const cobertura = medido ? medido.valor : (i < 0 ? null : consensoHorario(p, 'cloud_cover', mods).med[i]);
  const ceu = condicaoCeu([cobertura], [valido(dia) ? Math.round(dia) : null], null);
  if (!ceu) return null;
  const origem = medido ? `nuvens medidas em ${medido.fonte.nome}, ${fmt.idade(medido.ms)}` : 'nuvens pela previsão para esta hora';
  return { ...ceu, origem };
}

// ------------------------------------------------------------------ medições

function fontesNormalizadas() {
  // Converte a série de cada estação em "última leitura válida por variável".
  const out = [];
  for (const f of estado.obs?.fontes || []) {
    const leituras = {};
    const vars = ['temperatura', 'umidade', 'orvalho', 'pressao', 'vento', 'rajada', 'direcao', 'chuva', 'sensacao', 'nuvens'];
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

// Chuva agora, só com dado real. O radar (quadro de até 20 min) diz o que acontece agora; a estação
// (a até 25 km) mede o acumulado da hora que já passou e chega com atraso de 1 h ou mais. Por isso a
// estação só conta sozinha quando não há radar recente, ou quando a leitura dela tem até 20 min.
// Assim, quando a chuva para, o radar seco tira o "Chovendo agora" sem esperar a estação.
function medicaoChuvaAgora() {
  const p = pontoExato(), agora = Date.now();
  const fontes = fontesNormalizadas();
  const e = escolherFonte(fontes, 'chuva_h1', p.lat, p.lon, agora, 90).escolhida || escolherFonte(fontes, 'chuva', p.lat, p.lon, agora, 90).escolhida;
  const est = e && e.distancia <= 25 ? e : null;
  const r = estado.radarAgora && agora - estado.radarAgora.ms <= 20 * 60000 ? estado.radarAgora : null;
  if (!est && !r) return null;
  const estacaoValida = est && (!r || agora - est.ms <= 20 * 60000);
  const chovendoEst = estacaoValida ? est.valor >= REGRAS.chuvaHoraMm : false;
  const chovendoRadar = r ? r.chuva : false;
  return { chovendo: chovendoEst || chovendoRadar, estacao: estacaoValida ? est : null, radar: r };
}

/**
 * Janela sem chuva garantida pelo radar: sem eco sobre o local agora e nada chegando por pelo menos
 * REGRAS.radar.secoMinimoMin (secoPeloRadar). Nessas horas o radar manda; depois delas, os modelos.
 * @returns {{ateMs:number}|null}
 */
function secoAgora() {
  const c = estado.chegada, agora = Date.now();
  if (!c || !valido(c.secoMin) || agora - c.ms > 30 * 60000) return null;
  if (c.secoMin < REGRAS.radar.secoMinimoMin || medicaoChuvaAgora()?.chovendo !== false) return null;
  const ateMs = c.ms + c.secoMin * 60000;
  return ateMs > agora ? { ateMs } : null;
}

/**
 * Chuva chegando pelo radar, válida agora: quadro de até 30 min, chegada ainda por vir (ou há menos de 10 min)
 * e sem chuva medida no local (chovendo, a tela já diz "Chovendo agora").
 * @returns {{minutos:number, chegaMs:number, kmh:number|null, vemDe:string|null}|null}
 */
function chegandoAgora() {
  const c = estado.chegada, agora = Date.now();
  if (!c || !valido(c.chegaMs) || !(c.minutos > 0) || agora - c.ms > 30 * 60000 || c.chegaMs < agora - 10 * 60000) return null;
  return medicaoChuvaAgora()?.chovendo ? null : c;
}

/**
 * Situação da chuva num dia analisado (analisarDia), com os textos da primeira tela. Fonte única da primeira
 * tela e do widget.
 * - Chovendo (medição agora, só hoje): quanto ainda deve cair e até quando (chuvaRestante).
 * - Chuva chegando pelo radar (só hoje, sem chuva no local): horário previsto de início.
 * - Senão: volume provável e horário mais provável, quando a chance é pelo menos "pouco provável".
 * @param {object} a resultado de analisarDia
 * @returns {{agoraChuva:object|null, chovendo:boolean, chegando:object|null, temChuva:boolean,
 *   resposta:string|null, detalhe:string}} resposta é a frase curta ("Vai chover"); detalhe pode ser vazio
 */
function situacaoChuva(a) {
  const p = estado.prev, av = a.av;
  const hoje = a.diaIndice === 0;
  const agoraChuva = hoje ? medicaoChuvaAgora() : null;
  const chovendo = !!agoraChuva?.chovendo;
  const chegando = hoje && !chovendo ? chegandoAgora() : null;
  const resposta = chovendo ? 'Chovendo agora' : chegando ? 'Chuva chegando' : respostaChuva(av.prob);
  const temChuva = av.prob !== null && av.prob >= REGRAS.ocorrencia.poucoProvavel;
  let detalhe;
  if (chovendo) {
    // Chovendo: só a estimativa de quanto ainda cai e quando para. A origem (estação ou radar) fica no toque longo.
    const resto = chuvaRestante();
    detalhe = !resto ? '' : resto.fraca ? 'chuva fraca, deve passar logo'
      : `≈ ${fmt.mm(resto.mm)} ${resto.maisDe12h ? 'até pelo menos' : 'até'} ${fmt.hora(resto.ate, p.offset)}`;
  } else {
    const partes = [];
    if (chegando) partes.push(`deve começar por volta das ${fmt.horaMin(chegando.chegaMs, p.offset)}${chegando.vemDe ? `, vinda do ${chegando.vemDe}` : ''} (radar)`);
    if (temChuva && av.volume) partes.push(`cerca de ${fmt.mm(av.volume.mediana)}${av.volumeIncerto ? ` (provável entre ${fmt.n(av.volume.min, 0)} e ${fmt.n(av.volume.max, 0)} mm)` : ''}`);
    const jan = a.horasChuva.janela;
    if (!chegando && temChuva && jan) partes.push(`mais provável ${fmt.hora(jan.ini, p.offset)} a ${fmt.hora(jan.fim + 3600000, p.offset)}`);
    detalhe = partes.join(' · ');
  }
  return { agoraChuva, chovendo, chegando, temChuva, resposta, detalhe };
}

/**
 * Resumo de Hoje para o widget do iPhone, montado com as mesmas funções e os mesmos formatos da primeira tela
 * (temperaturaAgora, analisarDia, situacaoChuva, avaliarRisco, avisosOrdenados, fmt). O widget só exibe os
 * textos prontos de "textos"; os valores numéricos vão junto apenas para cor e ícone.
 * Contrato (FORMATO_RESUMO): docs/TECNICO.md, seção 11.
 * @returns {object} objeto simples, serializável em JSON
 */
function resumoWidget() {
  const p = estado.prev, off = p.offset;
  const a = analisarDia(datas()[0], 0, true);
  const av = a.av;
  const chuva = situacaoChuva(a);
  const risco = avaliarRisco(a, chuva.chovendo, !!chuva.chegando);
  const temRisco = !!risco && risco.nivel !== 'baixo';
  const avisos = avisosOrdenados();
  const t = temperaturaAgora();
  const rp = a.rajadaPico;
  const alertasOk = !!estado.alertas && !estado.alertas.indisponivel;
  // mesma regra da primeira tela: risco moderado ou alto substitui a linha de avisos do INMET
  const linhaTemporal = temRisco ? `Risco ${risco.nivel} de temporal`
    : !alertasOk ? 'Alertas indisponíveis'
      : avisos.length ? `Aviso do INMET: ${avisos[0].titulo.toLowerCase()}${avisos[0].severidade ? ` (${avisos[0].severidade.toLowerCase()})` : ''}`
        : 'Nenhum aviso do INMET';
  return {
    formato: FORMATO_RESUMO, versao: VERSAO, geradoMs: Date.now(), previsaoMs: estado.prevEm,
    valores: {
      temperatura: t?.valor ?? null, temperaturaMedida: !!t?.medida,
      chance: av.prob, chovendo: chuva.chovendo, chegando: !!chuva.chegando,
      temporal: temRisco ? risco.nivel : null, aviso: alertasOk && avisos.length > 0,
      rajadaKmh: rp ? Math.round(av.rajada?.mediana ?? rp.valor) : null,
    },
    textos: {
      local: estado.local.nome,
      temperatura: fmt.c(t?.valor) ?? '–',
      rotuloTemperatura: t?.medida ? 'agora' : 'agora (prevista)',
      // notas no formato "Fonte · Horário" (notaFonte e notaPrevisao)
      notaTemperatura: t?.medida ? notaFonte({ fonte: t.estacao, ms: t.ms }, off) : notaPrevisao(off),
      notaPrevisao: notaPrevisao(off),
      minMax: `mín ${fmt.c(a.tmin) ?? '–'} · máx ${fmt.c(a.tmax) ?? '–'}`,
      chuva: chuva.resposta || 'Chuva sem dado',
      chance: chuva.chovendo ? 'agora' : (fmt.pct(av.prob) ?? '–'),
      chuvaDetalhe: chuva.detalhe,
      temporal: linhaTemporal,
      temporalFonte: temRisco ? (risco.aviso ? 'INMET' : 'Previsão') : null,
      rajada: rp ? `Rajada ${Math.round(av.rajada?.mediana ?? rp.valor)} km/h${direcaoTexto(rp.dir) ? ` de ${direcaoTexto(rp.dir)}` : ''} às ${fmt.hora(rp.ms, off)}` : 'Rajada sem dado',
      confianca: `Confiança ${av.confianca.geral}`,
    },
  };
}

// ------------------------------------------------------------------ render geral

function renderTudo() {
  if (MODO_WIDGET) return; // modo widget: sem telas, só o resumo (resumoWidget)
  if (!estado.prev) { renderSemPrevisao(); return; }
  for (const f of estado.faixas) f.destruir();
  estado.faixas = [];
  limparGraficos();
  const ds = datas();
  renderPrimeira($('#hoje-primeira'), ds[0], 0, true);
  renderAgora(); observarAgora();
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
    : `Hoje, ${fmt.diaSemana(dataMs, p.offset)} ${fmt.dataCurta(dataMs, p.offset)}`;

  // céu: hoje é o céu de agora (ao lado da temperatura de agora); amanhã, o resumo do dia pelos modelos
  const ceu = diaIndice === 0 ? ceuAgora() : ceuDoDia(a);
  const mods = modelosAtivos();

  // chuva: resposta curta, chance, volume e horário
  const { agoraChuva, chovendo, chegando, temChuva, resposta: resp, detalhe } = situacaoChuva(a);
  if (chovendo && ceu) { ceu.chuva = 'provavel'; ceu.texto = ceu.nivel === 'limpo' || ceu.nivel === 'poucas' ? 'Pancadas de chuva' : 'Chuva'; }
  const origemAgora = chovendo ? (agoraChuva.estacao?.valor >= REGRAS.chuvaHoraMm ? `medido pela estação ${agoraChuva.estacao.fonte.nome}` : 'visto pelo radar') : '';

  const botaoConf = el('button', { type: 'button', class: 'confianca', 'data-n': av.confianca.geral, onclick: () => explicarConfianca(a) },
    el('span', { class: 'nivel', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), `Confiança ${av.confianca.geral}`);
  const resumo = el('div', { class: 'resumo', 'data-ceu': ceu?.nivel || 'sem', 'data-chuva': ceu?.chuva || (temChuva ? 'pouca' : 'nao') },
    el('div', { class: 'resumo-topo' }, el('p', { class: 'resumo-quando', text: quando }), botaoConf),
    diaIndice === 0 ? el('div', { class: 'resumo-agora', id: 'agora-hoje', 'aria-hidden': 'true' }) : null,
    el('div', { class: 'resumo-ceu' },
      iconeCeu(ceu),
      el('span', { class: 'cond', title: ceu?.origem || null }, ceu ? ceu.texto : ausente('céu sem dado'))),
    el('div', { class: 'resumo-temp' },
      el('span', { class: 'bloco-t min' }, el('small', { text: 'mínima' }), el('b', { class: 'tmin', text: fmt.c(a.tmin) ?? '–' })),
      el('span', { class: 'bloco-t max' }, el('small', { text: 'máxima' }), el('b', { class: 'tmax', text: fmt.c(a.tmax) ?? '–' })),
      el('span', { class: 'bloco-t chuva' }, el('small', { text: 'chuva' }), el('b', { text: chovendo ? 'agora' : (av.prob === null ? '–' : fmt.pct(av.prob)) }))),
    el('div', { class: 'resumo-chuva' + (chovendo ? ' chovendo' : '') },
      el('strong', chovendo ? { title: `Chuva ${origemAgora}. Estimativa: mediana dos modelos hora a hora.` } : {}, resp || 'Chuva sem dado'),
      el('span', { class: 'det' + (chovendo ? ' resto' : ''), text: detalhe || ' ' })));

  // Risco de temporal (moderado ou alto) substitui a linha de avisos do INMET: um cartão só, com a fonte,
  // e os horários de todos os avisos do local ao tocar. Sem risco, a linha de avisos aparece sozinha.
  const risco = avaliarRisco(a, chovendo, !!chegando);
  const temRisco = risco && risco.nivel !== 'baixo';
  const filhos = [resumo];
  filhos.push(temRisco ? cartaoTemporal(risco) : linhaAlerta());

  // rajada
  const rp = a.rajadaPico;
  filhos.push(el('div', { class: 'linha-rajada' },
    el('span', { class: 'raj' },
      el('span', { class: 'rot', text: 'Rajada ' }),
      rp ? el('strong', { text: `${Math.round(av.rajada?.mediana ?? rp.valor)} km/h` }) : ausente('sem dado'),
      rp ? el('span', { class: 'raj-det' }, ` de ${direcaoTexto(rp.dir) || '?'} `, setaVento(rp.dir), ` às ${fmt.hora(rp.ms, p.offset)}`) : '')));


  // Gráfico: chance de chuva hora a hora (padrão) ou Faixa do Céu
  // só as horas deste dia: hoje, da hora atual até 23h; amanhã, de 0h a 23h
  const ini = p.horas[(desdeAgora && a.idxAgora.length ? a.idxAgora : a.idxTodo)[0]];
  const fim = p.horas[a.idxTodo[a.idxTodo.length - 1]] + 3600000;
  const caixa = el('div', { class: 'grafico-primeira' });
  let modo = 'chance';
  const botoes = el('div', { class: 'troca', role: 'group', 'aria-label': 'Gráfico' });
  const iniDia = p.horas[a.idxTodo[0]];
  const desenharModo = () => {
    // hoje: escolher entre as horas que faltam e o dia todo (a escolha fica salva no aparelho)
    const todas = desdeAgora && prefs.ler('horasTodas', false);
    const iniUsado = todas ? iniDia : ini;
    botoes.replaceChildren(...[['chance', 'Chuva'], ['temp', 'Temperatura'], ['ceu', 'Céu']].map(([k, nome]) =>
      el('button', { type: 'button', 'aria-pressed': String(modo === k), onclick: () => { modo = k; desenharModo(); } }, nome)),
    desdeAgora ? el('span', { class: 'troca-horas' }, ...[[false, 'Restantes'], [true, 'Dia todo']].map(([v, nome]) =>
      el('button', { type: 'button', 'aria-pressed': String(todas === v), onclick: () => { prefs.gravar('horasTodas', v); desenharModo(); } }, nome))) : '');
    caixa.replaceChildren();
    if (modo === 'chance') caixa.append(graficoChance(iniUsado, fim));
    else if (modo === 'temp') caixa.append(graficoTemperatura(iniUsado, fim));
    else estado.faixas.push(criarFaixa(caixa, { prev: p, modelos: mods, iniMs: iniUsado, fimMs: fim, id: 'faixa-' + diaIndice }));
  };
  filhos.push(botoes, caixa);
  alvo.replaceChildren(...filhos);
  desenharModo();
}

// Quanto ainda deve chover: soma a mediana ponderada dos modelos a partir de agora (só o que falta da hora
// atual) até a primeira hora com menos de 0,1 mm e chance abaixo de 30%. Recalculado a cada atualização.
function chuvaRestante() {
  const p = estado.prev, mods = modelosAtivos();
  const { pesos } = pesosAtuais();
  const agora = Date.now();
  let i0 = -1;
  for (let k = 0; k < p.horas.length; k++) if (p.horas[k] <= agora) i0 = k;
  if (i0 < 0) return null;
  // Soma o episódio atual: para na primeira hora seguinte em que a mediana dos modelos fica abaixo de 0,1 mm.
  // Janela máxima de 12 h, para não somar chuvas de outro sistema.
  let mm = 0, fim = null;
  for (let i = i0; i < p.horas.length && i < i0 + 12; i++) {
    const v = mediana(mods.map((m) => p.modelos[m].vars.precipitation?.[i]), mods.map((m) => pesos[m] ?? 1));
    if (i > i0 && (!valido(v) || v < 0.1)) break;
    const frac = i === i0 ? Math.max(0, (p.horas[i] + 3600000 - agora) / 3600000) : 1;
    if (valido(v)) mm += v * frac;
    fim = p.horas[i] + 3600000;
  }
  if (fim === null) return null;
  // Chovendo, mas os modelos não mostram volume: chuva fraca, sem prazo confiável.
  if (mm < 0.2) return { fraca: true };
  return { mm, ate: fim, maisDe12h: fim >= p.horas[i0] + 12 * 3600000 };
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

/**
 * O que se mede agora e vale para as próximas horas: chovendo (estação ou radar), chuva chegando pelo radar
 * ou janela seca garantida pelo radar. Calculado uma vez e passado a chanceHora.
 */
function situacaoAgora() {
  const m = medicaoChuvaAgora();
  const chovendo = !!m?.chovendo;
  return { chovendo, chegando: chovendo ? null : chegandoAgora(), seco: chovendo ? null : secoAgora() };
}

/**
 * Chance de chuva de uma hora como todas as telas mostram: a dos modelos (chanceHoraria), corrigida pelo
 * que se mede agora, nesta ordem: chovendo agora (hora atual vira 100%, medido); chuva chegando pelo radar
 * (a hora da chegada e a seguinte ficam com no mínimo REGRAS.radar.probChegando); radar seco (horas inteiras
 * dentro da janela seca ficam com no máximo REGRAS.radar.probSeco). É o mesmo critério do veredito do dia.
 * @returns {{p:number|null, origem:string|null, medido?:boolean}}
 */
function chanceHora(ms, sit = situacaoAgora()) {
  const c = chanceHoraria(ms), agora = Date.now(), R = REGRAS.radar;
  if (sit.chovendo && agora >= ms && agora < ms + 3600000) return { p: 1, origem: 'medido', medido: true };
  if (sit.chegando && ms + 3600000 > sit.chegando.chegaMs && ms < sit.chegando.chegaMs + 2 * 3600000 && !(c.p >= R.probChegando)) return { p: R.probChegando, origem: 'radar' };
  if (sit.seco && ms + 3600000 <= sit.seco.ateMs && ms + 3600000 > agora && !(c.p <= R.probSeco)) return { p: R.probSeco, origem: 'radar seco' };
  return c;
}

const TETO_CHANCE = 115; // topo do eixo da chance de chuva, em %
function graficoChance(iniMs, fimMs) {
  const p = estado.prev, mods = modelosAtivos();
  const mm = consensoHorario(p, 'precipitation', mods).med;
  const pontos = [];
  const sit = situacaoAgora();
  p.horas.forEach((ms, i) => { if (ms >= iniMs && ms < fimMs) pontos.push({ ms, mm: mm[i], ...chanceHora(ms, sit) }); });
  const validos = pontos.filter((x) => valido(x.p));
  const origem = validos.some((x) => x.origem === 'cenários') ? 'cenários do ensemble' : 'probabilidade dos modelos';
  const atual = pontos.find((x) => Date.now() >= x.ms && Date.now() < x.ms + 3600000);
  // Escala vertical de 0 a TETO_CHANCE (115%): a folga acima de 100% evita que barras cheias encostem no topo.
  // Marcas a cada 20%. pos() converte uma chance (0 a 1) em altura percentual dentro da área do gráfico.
  const pos = (p) => (p * 100 / TETO_CHANCE) * 100;
  return barrasComEixo({
    pontos, classe: 'chuva', titulo: `Previsão: ${origem}`, nome: 'Chance de chuva por hora',
    pct: (x) => (valido(x.p) ? pos(x.p) : null), medido: (x) => x.medido,
    ticks: [0, 20, 40, 60, 80, 100].map((v) => [pos(v / 100), `${v}%`]),
    agoraPct: atual && valido(atual.p) ? pos(atual.p) : null,
    inicial: sit.chovendo ? 'Chovendo agora. Toque num horário para ver a chance de chuva.' : 'Toque num horário para ver a chance de chuva.',
    detalhe: (x) => `${fmt.hora(x.ms, p.offset)}: ${x.medido ? 'chovendo agora (medido)' : valido(x.p) ? fmt.pct(x.p) + ' de chance' + ({ radar: ' (chuva chegando pelo radar)', 'radar seco': ' (radar sem chuva por perto)' }[x.origem] || '') : 'sem dado'}${valido(x.mm) && x.origem !== 'radar seco' ? `, ${fmt.n(x.mm, 1)} mm previstos` : ''}`,
  });
}

// Barras por hora com eixo vertical à esquerda e linha pontilhada na altura do valor da hora atual.
// Nada de números sobre as barras: o valor exato aparece embaixo ao tocar num horário.
/**
 * Gráfico de barras por hora com eixo vertical rotulado, linhas-guia, linha tracejada no valor da hora atual
 * e detalhe exato só ao tocar num horário. Alturas e marcas são percentuais da área (0 a 100).
 * @param {object} o pontos, classe CSS, título, nome acessível, pct(ponto), medido(ponto), ticks [[pos, rótulo]],
 *   agoraPct, texto inicial e detalhe(ponto)
 * @returns {HTMLElement}
 */
function barrasComEixo({ pontos, classe, titulo, nome, pct, medido = () => false, ticks, agoraPct, inicial, detalhe }) {
  const p = estado.prev;
  const info = el('p', { class: 'chance-info', 'aria-live': 'polite', text: inicial });
  let sel = null;
  const area = el('div', { class: 'gb-area' },
    ...ticks.map(([v]) => el('i', { class: 'gb-guia', 'aria-hidden': 'true', style: { bottom: `${v}%` } })),
    valido(agoraPct) ? el('i', { class: 'gb-agora', 'aria-hidden': 'true', style: { bottom: `${Math.min(100, Math.max(0, agoraPct))}%` } }) : null,
    ...pontos.map((x) => {
      const agora = Date.now() >= x.ms && Date.now() < x.ms + 3600000;
      const v = pct(x);
      const b = el('button', { type: 'button', class: 'gb-barra' + (agora ? ' gb-atual' : ''), 'aria-label': detalhe(x) },
        el('i', { class: valido(v) ? (medido(x) ? 'medido' : '') : 'sem', style: { height: valido(v) ? `${Math.max(2, Math.min(100, v))}%` : '100%' } }));
      b.onclick = () => { sel?.classList.remove('sel'); sel = b; b.classList.add('sel'); info.textContent = detalhe(x); };
      return b;
    }));
  const eixoY = el('div', { class: 'gb-y', 'aria-hidden': 'true' }, ...ticks.map(([v, t]) => el('span', { text: t, style: { bottom: `${v}%` } })));
  const eixoX = el('div', { class: 'gb-x', 'aria-hidden': 'true' },
    ...pontos.map((x) => { const h = partesLocais(x.ms, p.offset).hora; return el('span', { text: h % 3 === 0 ? (h === 0 ? fmt.diaSemana(x.ms, p.offset) : `${h}h`) : '' }); }));
  return el('div', { class: `grafbarras ${classe}`, title: titulo, role: 'group', 'aria-label': `${nome}. ${inicial}` },
    el('div', { class: 'gb-corpo' }, eixoY, area), el('div', { class: 'gb-rodape' }, el('span'), eixoX), info);
}

// Temperatura por hora: ECMWF, com o mesmo formato do gráfico de chuva.
// O eixo vai de pouco abaixo da mínima a pouco acima da máxima do período, em passos redondos.
function graficoTemperatura(iniMs, fimMs) {
  const p = estado.prev, mods = modelosAtivos();
  const t = serieTemp(p, 'temperature_2m', mods);
  const st = serieTemp(p, 'apparent_temperature', mods);
  const pontos = [];
  p.horas.forEach((ms, i) => { if (ms >= iniMs && ms < fimMs) pontos.push({ ms, t: t[i], st: st[i] }); });
  const vals = pontos.map((x) => x.t).filter(valido);
  if (!vals.length) return el('p', { class: 'chance-info', text: 'Temperatura por hora sem dado.' });
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const passo = hi - lo > 12 ? 5 : hi - lo > 6 ? 3 : 2;
  const base = Math.floor((lo - 1) / passo) * passo, topo = Math.max(Math.ceil((hi + 0.5) / passo) * passo, base + 2 * passo);
  const pct = (v) => ((v - base) / (topo - base)) * 100;
  const ticks = [];
  for (let v = base; v <= topo + 1e-9; v += passo) ticks.push([pct(v), `${v}°`]);
  const atual = pontos.find((x) => Date.now() >= x.ms && Date.now() < x.ms + 3600000);
  return barrasComEixo({
    pontos, classe: 'temp', titulo: 'Previsão Open-Meteo', nome: 'Temperatura por hora',
    pct: (x) => (valido(x.t) ? pct(x.t) : null), ticks,
    agoraPct: atual && valido(atual.t) ? pct(atual.t) : null,
    inicial: 'Toque num horário para ver a temperatura.',
    detalhe: (x) => `${fmt.hora(x.ms, p.offset)}: ${valido(x.t) ? `${fmt.n(x.t, 1)} °C` : 'sem dado'}${valido(x.st) ? `, sensação de ${fmt.n(x.st, 0)} °C` : ''}`,
  });
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

/**
 * Cartão "Risco X de temporal · Fonte". Fonte: INMET quando há aviso de tempestade para o local, senão Previsão.
 * Ao tocar: horário de cada aviso do INMET do local (o mais grave primeiro), o motivo pela previsão e a orientação.
 */
function cartaoTemporal(risco) {
  const avisos = avisosOrdenados();
  const motivos = risco.motivos.filter((m) => !/aviso de tempestade do INMET/.test(m));
  const abrir = () => mostrarInfo(`Risco ${risco.nivel} de temporal`,
    avisos.length ? el('ul', { class: 'lt-avisos' }, ...avisos.map((x) => el('li', {},
      el('b', { text: `${x.titulo}${x.severidade ? ` (${x.severidade.toLowerCase()})` : ''}` }), el('br'), periodoAviso(x) || 'horário não informado'))) : null,
    motivos.length ? el('p', { text: `Pela previsão: ${motivos.join('; ')}.` }) : null,
    el('p', { text: 'Durante o temporal, fique longe de árvores e áreas abertas. Emergência: Defesa Civil, 199.' }),
    avisos.length ? linkExterno('https://alertas2.inmet.gov.br/', 'Avisos no INMET') : null);
  return el('button', { type: 'button', class: `linha-temporal ${risco.nivel}`, onclick: abrir },
    svg('svg', { viewBox: '0 0 24 24', class: 'raio', 'aria-hidden': 'true' }, svg('path', { d: 'M13 2 4 14h7l-1 8 9-12h-7z' })),
    el('span', { class: 'lt-txt' }, `Risco ${risco.nivel} de temporal`, el('small', { text: `· ${risco.aviso ? 'INMET' : 'Previsão'}` })));
}

// Avisos do INMET válidos para o local, do mais grave ao menos grave.
function avisosOrdenados() {
  const grau = (x) => ['perigo potencial', 'perigo', 'grande perigo'].indexOf(String(x.severidade || '').trim().toLowerCase());
  return alertasDoLocal().sort((x, y) => grau(y) - grau(x));
}

function linhaAlerta() {
  if (!estado.alertas || estado.alertas.indisponivel) return el('button', { type: 'button', class: 'alerta indisponivel', onclick: () => mostrarInfo('Alertas', el('p', { text: 'A consulta aos avisos do INMET falhou. Isso não significa que não há alertas.' }), linkExterno('https://alertas2.inmet.gov.br/', 'Avisos do INMET')) }, 'Alertas indisponíveis');
  const meus = avisosOrdenados();
  if (!meus.length) return el('p', { class: 'nota', style: { margin: '2px 0' } }, `Nenhum aviso do INMET encontrado para este local (consulta ${fmt.idade(estado.alertasEm)}).`);
  const a = meus[0];
  return el('button', { type: 'button', class: 'alerta', onclick: () => detalheAlertas(meus) },
    `Aviso do INMET: ${a.titulo.toLowerCase()}${a.severidade ? ` (${a.severidade.toLowerCase()})` : ''}${meus.length > 1 ? ` e mais ${meus.length - 1}` : ''}`);
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

/**
 * Explicação curta da confiança: o que o nível significa, os motivos objetivos que a reduziram
 * (avaliarDia) e uma nota de que ela mede concordância entre previsões, não a chance de chover.
 */
function explicarConfianca(a) {
  const c = a.av.confianca;
  const sentido = {
    alta: 'As previsões concordam entre si. A estimativa é segura.',
    'média': 'As previsões concordam só em parte. A estimativa pode mudar.',
    baixa: 'As previsões discordam. Trate esta estimativa como incerta.',
  }[c.geral];
  mostrarInfo(`Confiança ${c.geral}`,
    el('p', { text: sentido }),
    c.motivos.length ? el('p', { text: `Por quê: ${c.motivos.join('; ')}.` }) : null,
    el('p', { class: 'nota', text: 'A confiança mede se os modelos concordam, não se vai chover. A regra completa está na aba Modelos.' }));
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

// Temperatura no padrão europeu: o ECMWF IFS (Centro Europeu) é a fonte principal da temperatura e da
// mínima e máxima, com a correção de viés aprendida pelo painel. Se o ECMWF faltar numa hora, entra a
// mediana ponderada dos outros modelos. Chuva e vento continuam pela combinação dos modelos.
const MODELO_TEMP = 'ecmwf_ifs';
function tempHora(p, variavel, i, mods) {
  const v = p.modelos[MODELO_TEMP]?.vars[variavel]?.[i];
  if (valido(v)) return v;
  const { pesos } = pesosAtuais();
  return mediana(mods.map((m) => p.modelos[m].vars[variavel]?.[i]), mods.map((m) => pesos[m] ?? 1));
}
const serieTemp = (p, variavel, mods) => p.horas.map((_, i) => tempHora(p, variavel, i, mods));

// ------------------------------------------------------------------ Hoje: detalhes

function renderHojeDetalhes() {
  const alvo = $('#hoje-detalhes');
  const p = estado.prev;
  const filhos = [];
  filhos.push(proximasHoras());
  filhos.push(instrumentos());
  const pm = secao('Previsto x medido', null);
  filhos.push(pm);
  const mapa = secao('Mapa', null);
  mapa.classList.add('largura-total');
  filhos.push(mapa);
  const met = secao('Meteograma', 'Previsão das próximas 48 horas. Arraste para os lados.');
  met.classList.add('largura-total');
  filhos.push(met);
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
  const sit = situacaoAgora();
  const mm = cons('precipitation'), vento = cons('wind_speed_10m'), raj = cons('wind_gusts_10m'), dia = cons('is_day');
  let n = 0;
  for (let i = 0; i < p.horas.length && n < 24; i++) {
    if (p.horas[i] + 3600000 <= agora) continue;
    n++;
    const ch = chanceHora(p.horas[i], sit);
    const mmHora = ch.origem === 'radar seco' ? 0 : mm[i]; // radar sem chuva por perto: o volume dos modelos não vale
    const altura = valido(mmHora) ? Math.max(1, Math.sqrt(Math.min(mmHora, 10) / 10) * 34) : 0;
    lista.append(el('div', { class: 'hora' + (dia[i] === 0 ? ' noite' : ''), role: 'listitem' },
      el('div', { class: 'h', text: fmt.hora(p.horas[i], p.offset) }),
      el('div', { class: 'barra', 'aria-hidden': 'true' }, valido(mmHora) ? el('i', { style: { height: altura + 'px' } }) : ''),
      el('div', { class: 'p', text: valido(ch.p) ? `${Math.round(ch.p * 100)}%` : '–' }),
      el('div', { class: 'mm', text: valido(mmHora) ? `${fmt.n(mmHora, 1)} mm` : 'sem dado' }),
      el('div', { class: 'v', text: valido(vento[i]) ? `${Math.round(vento[i])}` : '–' }),
      el('div', { class: 'g', text: valido(raj[i]) ? `${Math.round(raj[i])}` : '–' })));
  }
  return secao('Próximas horas', 'Chance de chuva, volume, vento e rajada (km/h).', lista);
}

function apparente(t, rh, kmh) {
  if (![t, rh, kmh].every(valido)) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return t + 0.33 * e - 0.7 * (kmh / 3.6) - 4;
}

function instrumentos() {
  const s = secao('Medições agora', ' ');
  const sub = s.querySelector('.fonte');
  if (!estado.obs) { s.append(el('p', { class: 'nota', text: estado.erros.medicoes ? 'Medições indisponíveis no momento.' : 'Carregando medições…' })); return s; }
  const fontes = fontesNormalizadas();
  const p = pontoExato();
  const agora = Date.now();
  const escolhas = {};
  const pegar = (k) => (escolhas[k] ??= escolherFonte(fontes, k, p.lat, p.lon, agora, CONFIG.idadeMaxMedicaoMin));
  const val = (k) => pegar(k).escolhida;

  const t = val('temperatura'), u = val('umidade'), ve = val('vento');
  const sensInmet = linhaSilenciosa(fontes, 'sensacao', p, agora);
  const sens = sensInmet ? sensInmet.valor : (t && u && ve && t.fonte.id === u.fonte.id && u.fonte.id === ve.fonte.id ? apparente(t.valor, u.valor, ve.valor) : null);
  const pr = val('pressao');
  const dir = val('direcao');

  // estação principal: a que fornece a maior parte das leituras
  const usadas = ['temperatura', 'umidade', 'vento', 'pressao', 'chuva_h1'].map((k) => val(k)).filter(Boolean);
  const conta = {};
  for (const c of usadas) conta[c.fonte.id] = (conta[c.fonte.id] || 0) + 1;
  const principal = usadas.sort((x, y) => conta[y.fonte.id] - conta[x.fonte.id])[0];
  if (principal) {
    sub.textContent = `${nomeEstacao(principal.fonte)}, a ${fmt.n(principal.distancia, 0)} km · leitura ${fmt.idade(principal.ms)}`;
  } else sub.textContent = 'Nenhuma estação com leitura recente por perto.';

  const outra = (c) => (c && principal && c.fonte.id !== principal.fonte.id ? `${c.fonte.nome}, ${fmt.n(c.distancia, 0)} km` : null);
  const bloco = (nome, c, texto, nota) => el('div', { class: 'med' + (texto === null ? ' vazio' : '') },
    el('span', { class: 'med-nome', text: nome }),
    el('b', { class: 'med-v', text: texto ?? '–' }),
    (nota || outra(c)) ? el('span', { class: 'med-nota', text: nota || outra(c) }) : null);

  const grade = el('div', { class: 'medicoes' },
    bloco('Temperatura', t, t ? fmt.c1(t.valor) : null),
    bloco('Sensação', sensInmet || t, valido(sens) ? fmt.c1(sens) : null),
    bloco('Umidade', u, u ? `${Math.round(u.valor)}%` : null),
    bloco('Ponto de orvalho', val('orvalho'), val('orvalho') ? fmt.c1(val('orvalho').valor) : null),
    bloco('Vento', ve, ve ? `${fmt.kmh(ve.valor)}${dir ? ' ' + direcaoTexto(dir.valor) : ''}` : null),
    bloco('Rajada', val('rajada'), val('rajada') ? fmt.kmh(val('rajada').valor) : null));
  const chuva = el('div', { class: 'medicoes chuvas' },
    ...[['Última hora', 'chuva_h1'], ['24 h', 'chuva_h24'], ['72 h', 'chuva_h72'], ['7 dias', 'chuva_d7']]
      .map(([n, k]) => { const c = val(k) || (k === 'chuva_h1' ? val('chuva') : null); return bloco(n, c, c ? fmt.mm(c.valor) : null); }));
  s.append(painelPressao(pr), grade);
  if ([...chuva.children].some((b) => !b.classList.contains('vazio'))) s.append(el('h3', { class: 'med-tit', text: 'Chuva medida' }), chuva);

  // detalhes para quem quiser conferir: outras estações e avisos técnicos
  const det = el('details', { class: 'med-det' }, el('summary', { text: 'Comparar estações' }));
  const nomes = { temperatura: ['Temperatura', (v) => fmt.c1(v)], umidade: ['Umidade', (v) => `${Math.round(v)}%`], vento: ['Vento', (v) => fmt.kmh(v)], pressao: ['Pressão', (v) => fmt.hpa(v)], chuva_h1: ['Chuva na última hora', (v) => fmt.mm(v)] };
  for (const [k, [n, fm]] of Object.entries(nomes)) {
    const e = pegar(k);
    const linhas = [e.escolhida && { ...e.escolhida, ok: true }, ...e.outras].filter(Boolean).slice(0, 6);
    if (!linhas.length) continue;
    det.append(el('p', { class: 'med-det-t', text: n }), el('ul', {}, ...linhas.map((o) => el('li', { text: `${o.fonte.nome} (${fmt.n(o.distancia, 0)} km): ${o.ok ? fm(o.valor) : o.motivo}, ${fmt.idade(o.ms)}` }))));
  }
  det.append(el('p', { class: 'nota', text: 'Leituras com mais de 3 horas, vazias ou fora da faixa física são descartadas. A medição nunca é trocada por previsão.' }));
  s.append(det);
  return s;
}

/**
 * Dados de pressão para o painel e para o risco de temporal: leitura escolhida, séries medida e prevista
 * (ancorada na medição), variações de 3 h e 24 h, variação prevista e menor pressão nas próximas 24 h.
 * Ver docs/TECNICO.md, seção 3.10.
 * @param {object|null} [pr] leitura de 'pressao' escolhida por escolherFonte (padrão: a estação mais próxima)
 */
function dadosPressao(pr = undefined) {
  if (pr === undefined) {
    const pt = pontoExato();
    pr = escolherFonte(fontesNormalizadas(), 'pressao', pt.lat, pt.lon, Date.now(), CONFIG.idadeMaxMedicaoMin).escolhida;
  }
  const R = REGRAS.pressao, p = estado.prev, agora = Date.now();
  const mods = modelosAtivos();
  const prevHora = (i) => {
    const v = p?.modelos[MODELO_TEMP]?.vars.pressure_msl?.[i];
    return valido(v) ? v : mediana(mods.map((m) => p.modelos[m].vars.pressure_msl?.[i]));
  };
  let i0 = -1;
  if (p) for (let k = 0; k < p.horas.length; k++) if (p.horas[k] <= agora) i0 = k;
  const seriePrev = p ? p.horas.map((ms, i) => ({ ms, valor: prevHora(i) })) : [];

  // medição: série da mesma estação da leitura escolhida
  const serieMed = pr ? (estado.obs?.fontes.find((x) => x.id === pr.fonte.id)?.serie || [])
    .filter((x) => valido(x.pressao)).map((x) => ({ ms: x.ms, valor: x.pressao })) : [];
  let v3 = variacaoSerie(serieMed, 3, R.toleranciaMin.h3), v24 = variacaoSerie(serieMed, 24, R.toleranciaMin.h24);
  let origemTend = 'medida';
  if (!v3 && !v24 && i0 >= 0) {
    const ate = seriePrev.slice(0, i0 + 1);
    v3 = variacaoSerie(ate, 3, R.toleranciaMin.h3); v24 = variacaoSerie(ate, 24, R.toleranciaMin.h24);
    origemTend = 'prevista';
  }
  const atual = pr ? pr.valor : (i0 >= 0 ? seriePrev[i0].valor : null);
  // Ancoragem: a previsão é deslocada pela diferença entre a medição atual e o valor previsto para agora,
  // para os valores previstos (menor pressão e gráfico) ficarem na mesma referência da estação.
  // Variações não mudam com o deslocamento. Só com leitura de até 2 h.
  const ancora = pr && i0 >= 0 && valido(seriePrev[i0].valor) && agora - pr.ms <= 2 * 3600000 ? pr.valor - seriePrev[i0].valor : 0;
  if (ancora) for (const q of seriePrev) if (valido(q.valor)) q.valor += ancora;
  // previsão: variação até daqui a N horas e menor valor nas próximas 24 h
  let varPrev = null, minimo24 = null;
  if (i0 >= 0) {
    const iN = i0 + R.previsaoHoras;
    if (iN < seriePrev.length && valido(seriePrev[i0].valor) && valido(seriePrev[iN].valor)) varPrev = seriePrev[iN].valor - seriePrev[i0].valor;
    for (let k = i0 + 1; k <= i0 + 24 && k < seriePrev.length; k++) if (valido(seriePrev[k].valor) && (!minimo24 || seriePrev[k].valor < minimo24.valor)) minimo24 = seriePrev[k];
  }
  return { pr, p, agora, i0, seriePrev, serieMed, v3, v24, origemTend, atual, ancora, varPrev, minimo24 };
}

/**
 * Risco de temporal do dia (riscoTemporal em analise.js), com os mesmos valores mostrados na tela:
 * rajada do resumo do dia, maior chuva horária e maior CAPE (medianas entre modelos) nas horas do dia,
 * queda de pressão de 3 h (só hoje) e aviso de tempestade do INMET válido para o local e a data.
 */
function avaliarRisco(a, chovendo, chegando) {
  const p = estado.prev, mods = modelosAtivos();
  const maxNoDia = (v) => maximo(a.idx.map((i) => consensoHorario(p, v, mods).med[i]));
  const avisos = alertasDoLocal().filter((x) => /tempestade|granizo|vendaval/i.test(x.titulo || '')
    && (!x.inicio || x.inicio.slice(0, 10) <= a.data) && (!x.fim || x.fim.slice(0, 10) >= a.data));
  const ordem = ['perigo potencial', 'perigo', 'grande perigo'];
  const grau = (x) => ordem.indexOf(String(x.severidade || '').trim().toLowerCase());
  const maisGrave = avisos.sort((x, y) => grau(y) - grau(x))[0] || null;
  const aviso = maisGrave ? String(maisGrave.severidade || '').trim().toLowerCase() : null;
  const r = riscoTemporal({
    prob: a.av.prob, chovendo, chegando,
    cape: maxNoDia('cape'), chuvaHora: maxNoDia('precipitation'),
    rajada: a.av.rajada?.mediana ?? a.rajadaPico?.valor ?? null,
    d3Pressao: a.diaIndice === 0 ? dadosPressao().v3?.delta ?? null : null,
    aviso,
  });
  return r && { ...r, aviso: maisGrave };
}

/**
 * Período de um aviso do INMET ("AAAA-MM-DD HH:MM", horário de Brasília) em texto curto:
 * "hoje, das 10:00 às 23:59" ou "08/11, das 00:00 às 23:59" num dia só; com as duas datas quando passa de um dia.
 */
function periodoAviso(av) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(s || ''));
  if (!ok(av?.inicio) || !ok(av?.fim)) return null;
  const hoje = partesLocais(Date.now(), -10800).data;
  const d = (s) => s.slice(0, 10), h = (s) => s.slice(11, 16), dm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  if (d(av.inicio) === d(av.fim)) return `${d(av.inicio) === hoje ? 'hoje' : dm(av.inicio)}, das ${h(av.inicio)} às ${h(av.fim)}`;
  return `das ${h(av.inicio)} de ${dm(av.inicio)} às ${h(av.fim)} de ${dm(av.fim)}`;
}

/**
 * Análise da pressão ao nível do mar, no topo do bloco "Medições agora".
 * Medição: série da estação escolhida (INMET reduz a pressão da estação ao nível do mar; METAR informa SLP).
 * Sem série medida, as tendências usam a previsão (ECMWF, ou mediana dos modelos) e isso é dito na tela.
 * Previsão: variação nas próximas REGRAS.pressao.previsaoHoras horas e menor pressão nas próximas 24 h.
 * O sinal de chuva vem de avaliarPressao (analise.js) e não altera a chance de chuva dos modelos.
 * @param {object|null} pr leitura escolhida por escolherFonte para 'pressao'
 * @returns {HTMLElement}
 */
function painelPressao(pr) {
  const R = REGRAS.pressao;
  const { p, agora, i0, seriePrev, serieMed, v3, v24, atual, varPrev, minimo24 } = dadosPressao(pr);
  const cls = classeTendenciaPressao(v3?.delta);
  const av = avaliarPressao({ atual, d3: v3?.delta, d24: v24?.delta, prev: varPrev });
  const caixa = el('div', { class: 'pressao' });
  const sinal = (d) => `${d > 0 ? '+' : ''}${fmt.n(d, 1)} hPa`;
  // Cabeçalho objetivo: valor, tendência de 3 h e a conclusão em uma linha. O restante fica em "Ver detalhes".
  caixa.append(el('div', { class: 'pr-topo' },
    el('span', { class: 'med-nome', text: 'Pressão atmosférica' }),
    el('b', { class: 'pr-v', text: valido(atual) ? fmt.hpa(atual) : '–' }),
    cls ? el('span', { class: `pr-tend ${cls.sentido}`, text: `${cls.sentido === 'caindo' ? '▼' : cls.sentido === 'subindo' ? '▲' : '●'} ${cls.texto}${v3 ? ` (${sinal(v3.delta)} em 3 h)` : ''}` }) : null));
  // A leitura parte da chance de chuva principal de hoje (a mesma da primeira tela), para nunca contradizê-la.
  const hoje = datas()[0];
  const lp = leituraPressao(av, p && hoje ? analisarDia(hoje, 0, true).av.prob : null);
  if (lp) {
    caixa.classList.add(`sinal-${lp.classe}`);
    caixa.append(el('p', { class: 'pr-sinal' }, el('b', { text: lp.titulo + '. ' }), lp.texto));
  }
  const det = el('details', { class: 'med-det' }, el('summary', { text: 'Ver detalhes' }));
  const linhas = [
    ['Últimas 24 h', v24 ? sinal(v24.delta) : 'sem dado'],
    [`Próximas ${R.previsaoHoras} h (previsão)`, valido(varPrev) ? sinal(varPrev) : 'sem dado'],
    ['Menor nas próximas 24 h', minimo24 ? `${fmt.hpa(minimo24.valor)} às ${fmt.hora(minimo24.ms, p.offset)}` : 'sem dado'],
  ];
  det.append(el('dl', { class: 'pr-lista' }, ...linhas.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })])));
  if (av?.motivos.length) det.append(el('p', { class: 'nota', text: `Pela pressão: ${av.motivos.join('; ')}.` }));
  caixa.append(det);
  // gráfico: últimas 24 h medidas e próximas 24 h previstas (desenhado ao abrir, quando o contêiner tem largura)
  let desenhado = false;
  det.addEventListener('toggle', () => {
    if (!det.open || desenhado || !p || i0 < 0) return;
    desenhado = true;
    const ini = Math.max(0, i0 - 24), fim = Math.min(p.horas.length - 1, i0 + 24);
    const x = p.horas.slice(ini, fim + 1);
    const med = x.map((ms) => { if (ms > agora) return null; const o = serieMed.find((q) => Math.abs(q.ms - ms) <= 30 * 60000); return o ? o.valor : null; });
    const prv = x.map((_, k) => seriePrev[ini + k].valor);
    criarGrafico(det, { x, noites: noitesDe(p.diario, x[0], x[x.length - 1]), fuso: p.fuso, emitirHora: false, titulo: 'Pressão: 24 h medidas e 24 h previstas', altura: 140,
      fonte: pr ? notaFonte(pr, p.offset) : notaPrevisao(p.offset),
      series: [
        { rotulo: 'previsto', valores: prv, corCss: '--texto', dash: [6, 4], largura: 1.5, formato: (v) => fmt.hpa(v) },
        { rotulo: 'medido', valores: med, corCss: '--chuva', pontos: true, largura: 2.5, formato: (v) => fmt.hpa(v) },
      ], eixos: [{ formato: (v) => `${v}`, tamanho: 48, rotulo: 'hPa' }] });
    det.append(el('p', { class: 'nota', text: `Como é calculado: queda em 3 h soma 1 ponto (2 se rápida); queda de ${R.queda24hForte} hPa em 24 h, queda prevista de ${R.variacaoPrevForte} hPa em ${R.previsaoHoras} h e pressão abaixo de ${R.baixa} hPa somam 1 cada; subidas e pressão acima de ${R.alta} hPa tiram pontos. A conclusão sempre parte da chance de chuva do topo da tela.` }));
  });
  return caixa;
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
    const fonte = notaPrevisao(p.offset);
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
      criarGrafico(area, { ...base, titulo: 'Vento médio, rajadas e direção', fonte, setas: dirs, altura: 190,
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
          { rotulo: 'temperatura', valores: idx.map((i) => tempHora(p, 'temperature_2m', i, mods)), corCss: '--quente', largura: 2.5, formato: (v) => fmt.c1(v) },
          { rotulo: 'sensação', valores: idx.map((i) => tempHora(p, 'apparent_temperature', i, mods)), corCss: '--quente', dash: [5, 4], largura: 1.5, formato: (v) => fmt.c1(v) },
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
  const placar = linhaPlacar();
  // sem medições do dia, os gráficos não aparecem (nunca compara com previsão no lugar de medição);
  // o placar, que vem do histórico, continua sozinho na seção
  const soPlacar = () => { if (placar) s.append(placar); else s.remove(); };
  if (!estado.obs || !temSerie) { soPlacar(); return; }
  const hoje = datas()[0];
  // só horas encerradas: a hora atual já recebe a ancoragem na medição e não serve para comparar
  const idx = indicesDoDia(p.horas, hoje, p.offset).filter((i) => p.horas[i] + 3600000 <= Date.now());
  if (idx.length < 2) { soPlacar(); return; }
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
  const prevT = idx.map((i) => tempHora(p, 'temperature_2m', i, mods));
  const medT = medidoEm(fT, 'temperatura');
  criarGrafico(s, { x, noites: noitesDe(p.diario, x[0], x[x.length - 1]), fuso: p.fuso, sync: 'pm', emitirHora: false, titulo: 'Temperatura hoje', altura: 150,
    fonte: fT ? notaFonte(fT, p.offset) : 'Sem medição de temperatura',
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
    fonte: fC ? notaFonte(fC, p.offset) : 'Sem medição de chuva perto',
    series: [
      { rotulo: 'previsto', valores: prevC, corCss: '--chuva', dash: [6, 4], largura: 1.5, formato: (v) => `${fmt.n(v, 1)} mm` },
      { rotulo: 'medido', valores: medC, corCss: '--texto', pontos: true, largura: 2.5, formato: (v) => `${fmt.n(v, 1)} mm` },
    ], escalas: { y: { range: (u, mi, ma) => [0, Math.max(5, ma)] } }, eixos: [{ formato: (v) => `${v}` , rotulo: 'mm' }] });
  const prevG = idx.map((i) => mediana(mods.map((m) => p.modelos[m].vars.wind_gusts_10m?.[i])));
  const medG = medidoEm(fR, fR?.fonte && escolha('rajada') ? 'rajada' : 'vento');
  criarGrafico(s, { x, fuso: p.fuso, sync: 'pm', emitirHora: false, titulo: 'Rajadas hoje', altura: 140,
    fonte: fR ? notaFonte(fR, p.offset) : 'Sem medição de vento',
    series: [
      { rotulo: 'previsto', valores: prevG, corCss: '--rajada', dash: [6, 4], largura: 1.5, formato: (v) => `${Math.round(v)} km/h` },
      { rotulo: 'medido', valores: medG, corCss: '--texto', pontos: true, largura: 2.5, formato: (v) => `${Math.round(v)} km/h` },
    ], escalas: { y: { range: (u, mi, ma) => [0, Math.max(40, ma + 5)] } }, eixos: [{ formato: (v) => `${v}`, rotulo: 'km/h' }] });
  if (placar) s.append(placar);
}

/**
 * Placar de acerto da previsão da véspera, calculado pelo GitHub Actions (dados/calibracao.json, campo placar):
 * os últimos 30 dias com medição da estação. Uma linha "Acerto da véspera · chuva X% · máx. Y% · rajada Z%"
 * com a fonte no formato "Fonte · Horário"; ao tocar, o detalhe com os critérios e o período completo.
 * Só aparece perto da estação (calibracaoLocal), porque o placar mede o acerto ali.
 */
function linhaPlacar() {
  const k = calibracaoLocal(), pl = k?.placar, u = pl?.ultimos;
  if (!u?.dias) return null;
  const pct = (x) => (valido(x?.pct) ? `${Math.round(x.pct * 100)}%` : '–');
  const dataBr = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
  const fonte = `${pl.fonte.replace(/^INMET\s+A884$/, 'INMET Campo Bom')} · até ${dataBr(u.fim)}`;
  const linha = (nome, x, crit) => el('li', {}, el('b', { text: `${nome}: ${pct(x)}` }), ` dos dias ${crit}${valido(x?.erroMedio) ? ` (erro médio ${fmt.n(x.erroMedio, 1)})` : ''}`);
  const bloco = (titulo, x) => [el('h3', { text: titulo }), el('ul', { class: 'lt-avisos' },
    linha('Chuva', x.chuva, 'em que chover ou não chover foi previsto certo (1 mm ou mais)'),
    linha('Máxima', x.tmax, `com erro de até ${pl.limites.tempC} °C`),
    linha('Mínima', x.tmin, `com erro de até ${pl.limites.tempC} °C`),
    x.rajada?.n ? linha('Rajada', x.rajada, `com erro de até ${pl.limites.rajadaKmh} km/h`) : null)];
  const abrir = () => mostrarInfo('Acerto da véspera',
    el('p', { text: 'Quanto a previsão feita no dia anterior acertou, comparada com a estação do INMET em Campo Bom. Temperatura e rajada já com a correção pelo histórico, medida em meses que a correção não viu.' }),
    ...bloco(`Últimos ${u.dias} dias (${dataBr(u.ini)} a ${dataBr(u.fim)})`, u),
    ...(pl.completo?.dias > u.dias ? bloco(`Todo o período (${pl.completo.dias} dias, desde ${dataBr(pl.completo.ini)}/${pl.completo.ini.slice(2, 4)})`, pl.completo) : []),
    el('p', { class: 'nota', text: 'O arquivo do INMET chega com um ou dois meses de atraso; o placar é recalculado sozinho quando ele chega.' }));
  // linha visível em linguagem simples; percentuais, critérios e erros ficam no detalhe
  const de = (x) => `${x.acertos} de ${x.n} dias`;
  const texto = `A previsão da véspera acertou a chuva em ${de(u.chuva)} e a temperatura máxima em ${de(u.tmax)}`;
  return el('button', { type: 'button', class: 'linha-placar', onclick: abrir },
    el('span', { class: 'lt-txt' }, texto, el('small', { text: fonte })));
}

// Nota de fonte dos gráficos, no formato "Fonte · Horário" (ex.: "INMET Campo Bom · 12:00").
// `c` é a leitura escolhida por escolherFonte: o horário é o da última leitura usada daquela estação.
function nomeEstacao(fonte) {
  const nome = fonte.nome.replace(/\s*\((INMET|METAR)\)\s*$/i, '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  return `${fonte.tipo === 'inmet' ? 'INMET' : 'METAR'} ${nome}`;
}
function notaFonte(c, off) { return `${nomeEstacao(c.fonte)} · ${fmt.horaMin(c.ms, off)}`; }
function notaPrevisao(off) { return `Open-Meteo · ${fmt.horaMin(estado.prevEm, off)}`; }

// Fontes de dados, de forma enxuta: de onde vem cada dado e como é calculado, mais uma linha de situação.
function estadoFontes() {
  const w = workerConfigurado();
  const falhas = [
    ['previsão', !estado.erros.previsao && estado.prev],
    ['cenários', !!estado.ens],
    ['medições', estado.obs && !estado.erros.medicoes],
    ['alertas', estado.alertas && !estado.alertas.indisponivel],
  ].filter(([, ok]) => !ok).map(([n]) => n);
  const itens = [
    ['Temperatura', 'ECMWF, o modelo europeu, corrigido pelo que o painel aprende comparando com as estações.'],
    ['Chuva e vento', 'Combinação do ECMWF, do AIFS e do Met Office, com mais peso para o que vem acertando mais.'],
    ['Chance de chuva', 'Fração dos cenários dos modelos (ensemble) que mostram chuva em cada hora.'],
    ['Medições', w ? 'Estações do INMET e dos aeroportos (METAR) mais próximas.' : 'Estação do INMET em Campo Bom.'],
    ['Radar e alertas', 'RainViewer e avisos oficiais do INMET.'],
  ];
  return secao('Fontes de dados', falhas.length ? `Sem resposta agora: ${falhas.join(', ')}. O restante está atualizado.` : 'Todas as fontes responderam.',
    el('ul', { class: 'fontes-lista' }, ...itens.map(([t, d]) => el('li', {}, el('b', { text: t + ': ' }), d))));
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
    const t = idx.map((i) => tempHora(p, 'temperature_2m', i, mods));
    return el('div', { class: 'periodo' }, el('h3', { text: nome[0].toUpperCase() + nome.slice(1) }),
      el('div', { class: 'p', text: valido(prob) ? `${Math.round(prob)}% de chance` : 'chance sem dado' }),
      el('div', { text: `${fmt.n(mm, 1)} mm` }),
      el('div', { class: 'g', text: valido(g) ? `rajada ${Math.round(g)} km/h` : 'rajada sem dado' }),
      el('div', {}, el('span', { class: 'tmin', text: fmt.c(minimo(t)) || '–' }), ' a ', el('span', { class: 'tmax', text: fmt.c(maximo(t)) || '–' })));
  });
  filhos.push(secao('Períodos', notaPrevisao(p.offset), el('div', { class: 'periodos' }, ...caixas)));
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
  const chovendoAgora = !!medicaoChuvaAgora()?.chovendo;
  const restoAgora = chovendoAgora ? chuvaRestante() : null;
  const item = (a, longe) => {
    const ms = p.horas[a.idxTodo[0]];
    const agoraHoje = a.diaIndice === 0 && chovendoAgora;
    const exp = el('div', { class: 'exp', hidden: !abertos.has(a.data) }, tabelaModelosDia(a),
      el('p', { class: 'nota', text: a.av.confianca.motivos.join('; ') || 'modelos e cenários concordam' }));
    const btn = el('button', { type: 'button', 'aria-expanded': String(abertos.has(a.data)), onclick: () => {
      const abre = exp.hidden; exp.hidden = !abre; btn.setAttribute('aria-expanded', String(abre));
      abre ? abertos.add(a.data) : abertos.delete(a.data); prefs.gravar('diasAbertos', [...abertos]);
      try { abre ? sessionStorage.setItem('abaComDetalhe', 'semana') : sessionStorage.removeItem('abaComDetalhe'); } catch {}
    } },
      el('span', { class: 'dn' }, a.diaIndice === 0 ? 'Hoje' : fmt.diaSemana(ms, p.offset), el('small', { text: fmt.dataCurta(ms, p.offset) })),
      el('span', { class: 'resumo', text: agoraHoje ? 'Chovendo agora' : a.frase }),
      el('span', { class: 'nums' },
        el('span', { class: 'p', text: agoraHoje ? `agora${restoAgora && !restoAgora.fraca ? ' ≈ ' + fmt.mm(restoAgora.mm) : ''}` : a.av.prob === null ? 'chuva –' : `${fmt.pct(a.av.prob)}${a.av.volume && a.av.prob >= 0.15 ? ' ' + fmt.mm(a.av.volume.mediana) : ''}` }),
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
  const fmtDia = (u, vals) => vals.map((v) => { const d = dataNoFuso(v, p.fuso); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()]; });
  const gChuva = secao('Chuva diária e acumulada', 'Previsão: mediana dos modelos se chover; acumulada soma as medianas.');
  const gTemp = secao('Temperatura mínima e máxima', notaPrevisao(estado.prev.offset));
  const gRaj = secao('Rajada máxima', 'Linha: valor mais provável; faixa: do menor ao maior provável.');
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
      el('td', { class: 'n', text: a.av.prob !== null && a.av.prob < REGRAS.ocorrencia.poucoProvavel ? 'sem chuva' : a.av.volume ? (Math.round(a.av.volume.min) === Math.round(a.av.volume.max) ? `${fmt.n(a.av.volume.max, 0)} mm` : `${fmt.n(a.av.volume.min, 0)}–${fmt.n(a.av.volume.max, 0)} mm`) : '–' }),
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
        el('div', { style: { color: 'var(--rajada-txt)' }, text: valido(r.rajada?.valor) ? `${Math.round(r.rajada.valor)} km/h` : '–' })); }))))));
  filhos.push(secao('Chuva e rajada de cada modelo', 'Previsão por dia. Traço indica dado ausente, não zero.', tab,
    ...ausencias.map((t) => el('p', { class: 'nota', text: t })), faltam.length ? el('p', { class: 'nota', text: `Sem dados agora: ${faltam.map((m) => MODELOS[m].nome).join(', ')}.` }) : null));
  const gC = secao('Chuva acumulada por modelo', 'Previsão, 7 dias. Faixa: cenários do ensemble (p10 a p90) e mediana.');
  const gR = secao('Rajadas por modelo', 'Previsão, 7 dias. Faixa: cenários do ensemble (p10 a p90).');
  gC.classList.add('largura-total'); gR.classList.add('largura-total');
  filhos.push(gC, gR);
  filhos.push(secao('Acerto de cada modelo', null, tabelaAcerto()));
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

/**
 * Acerto de cada modelo por estação de verificação, em até duas tabelas:
 * 1. histórico importado (dados/calibracao.json): anos de previsões passadas x medições do INMET, com os erros
 *    de temperatura e rajada já depois da correção (medidos fora da amostra), que é o que o painel mostra;
 * 2. últimos dias registrados pelo servidor (Worker, /v1/acerto), quando houver.
 */
function tabelaAcerto() {
  const blocos = [];
  const pt = pontoExato();
  const dataBr = (d) => `${d.slice(5, 7)}/${d.slice(2, 4)}`;
  const cabecalho = el('thead', {}, el('tr', {}, el('th', { text: 'Previsão feita' }), el('th', { class: 'n', text: 'Acertou se chovia' }), el('th', { class: 'n', text: 'Erro na chuva' }), el('th', { class: 'n', text: 'Erro na rajada' }), el('th', { class: 'n', text: 'Erro na máxima' }), el('th', { class: 'n', text: 'Dias' })));
  const tabela = (linhas) => el('div', { class: 'tabela-rolar', 'data-hscroll': '' }, el('table', {}, cabecalho.cloneNode(true), el('tbody', {}, ...linhas)));
  const linha = (m, d, acerto, volume, rajada, tmax, n) => el('tr', {}, el('td', { text: `${MODELOS[m].curto}, ${d === 1 ? 'na véspera' : `${d} dias antes`}` }),
    el('td', { class: 'n', text: valido(acerto) ? `${Math.round(acerto * 100)}%` : '–' }),
    el('td', { class: 'n', text: valido(volume) ? `${fmt.n(volume, 1)} mm` : '–' }),
    el('td', { class: 'n', text: valido(rajada) ? `${fmt.n(rajada, 0)} km/h` : '–' }),
    el('td', { class: 'n', text: valido(tmax) ? `${fmt.n(tmax, 1)}°` : '–' }),
    el('td', { class: 'n', text: valido(n) ? `${n}` : '–' }));
  // erro em uso no painel: depois da correção quando ela foi aprovada, senão o bruto
  const erroUsado = (x) => (x ? (x.usar && x.origem !== 'curto prazo' ? x.maeDepois : x.origem === 'curto prazo' ? null : x.maeAntes) : null);

  for (const v of VERIFICACAO) {
    const a = estado.acerto[v.id];
    const k = estado.calib?.estacao?.id === v.id ? estado.calib : null;
    const o = estado.calib?.outras?.[v.id];
    blocos.push(el('h3', { text: `${v.nome}, ${fmt.n(distanciaKm(pt.lat, pt.lon, v.lat, v.lon), 0)} km` }));
    if (!k && o) {
      const linhas = [];
      for (const m of Object.keys(MODELOS)) for (const d of [1, 2, 3, 5]) {
        const x = o.modelos?.[m]?.[d]; if (!x) continue;
        linhas.push(linha(m, d, x.acertoChuva, x.maeChuva, x.maeRajada, x.maeTmax, x.n));
      }
      blocos.push(el('p', { class: 'fonte', text: `${v.chuva ? 'INMET' : 'METAR'} ${o.estacao.nome} · histórico de ${dataBr(o.periodo.ini)} a ${dataBr(o.periodo.fim)}` }));
      if (!v.chuva) blocos.push(el('p', { class: 'nota', text: 'O aeroporto não mede a chuva, só temperatura e vento.' }));
      if (linhas.length) blocos.push(tabela(linhas));
    }
    if (k) {
      const linhas = [];
      for (const m of Object.keys(MODELOS)) for (const d of [1, 2, 3, 5]) {
        const x = k.modelos?.[m]; if (!x?.chuva?.[d]) continue;
        linhas.push(linha(m, d, x.chuva[d].acerto, x.chuva[d].mae, erroUsado(x.rajada?.[d]), erroUsado(x.tmax?.[d]), x.chuva[d].n));
      }
      blocos.push(el('p', { class: 'fonte', text: `INMET Campo Bom · histórico de ${dataBr(k.periodo.ini)} a ${dataBr(k.periodo.fim)}` }));
      if (linhas.length) blocos.push(tabela(linhas));
    }
    if (a?.dias) {
      const linhas = [];
      for (const m of Object.keys(MODELOS)) for (const d of [1, 2, 3, 5]) {
        const r = a.porModelo?.[m]?.[d]; if (!r) continue;
        if (!r.amostrasChuva && !r.amostrasRajada && !r.amostrasTmax) continue;
        linhas.push(linha(m, d, r.taxaChuva, r.maeChuva, r.maeRajada, r.maeTmax, Math.max(r.amostrasChuva, r.amostrasRajada, r.amostrasTmax)));
      }
      blocos.push(el('p', { class: 'fonte', text: `${v.chuva ? 'INMET' : 'METAR'} · últimos ${a.dias} dias, até ${a.periodo.fim.slice(8, 10)}/${a.periodo.fim.slice(5, 7)}` }));
      if (linhas.length) blocos.push(tabela(linhas));
    } else if (!k && !o) {
      blocos.push(el('p', { class: 'nota', text: workerConfigurado() ? 'Sem histórico importado; os dias passam a contar a partir de amanhã.' : 'Sem histórico importado.' }));
    }
  }
  blocos.push(el('p', { class: 'nota', text: '"Acertou se chovia" conta os dias em que o modelo disse que ia chover e choveu, ou disse que não ia e não choveu. Os erros mostram, em média, quanto o modelo errou para mais ou para menos: quanto menor, melhor. Em Campo Bom, temperatura e rajada já com a correção que o painel aplica.' }));
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
  if (alvo.dataset.desenhadoEm === String(estado.ensoEm) && alvo.childElementCount) return; // nada mudou: só mostra
  alvo.dataset.desenhadoEm = String(estado.ensoEm);
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
      fonte: `NOAA CPC · semana de ${fmt.dataCurta(tempos[tempos.length - 1], 0)}`,
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
      titulo: 'ONI e RONI', fonte: `NOAA CPC · ${[...oni, ...roni].sort((a, b) => ms(a) - ms(b)).map((r) => `${r.seas} ${r.ano}`).pop()}`, horasVisiveis: 24 * 365 * 25, rolarFim: true,
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
  // trimestre atual (centrado no mês corrente) e os próximos, da NOAA CPC
  const CENTRO = { DJF: 1, JFM: 2, FMA: 3, MAM: 4, AMJ: 5, MJJ: 6, JJA: 7, JAS: 8, ASO: 9, SON: 10, OND: 11, NDJ: 12 };
  const mesAgora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric' }));
  const probs = P.probCpc?.dados || [], forcas = P.forcaCpc?.dados || [];
  const iAgora = Math.max(0, probs.findIndex((x) => CENTRO[x.tri] === mesAgora));
  const prob = probs[iAgora];
  const NOME_F = { fraco: 'fraco', moderado: 'moderado', forte: 'forte', muitoForte: 'muito forte' };
  const forcaDe = (tri) => {
    const f = forcas.find((x) => x.tri === tri)?.elNino;
    if (!f) return null;
    const [k, v] = Object.entries(f).sort((a, b) => b[1] - a[1])[0];
    return v > 0 ? { nome: NOME_F[k], p: v, forteOuMais: f.forte + f.muitoForte } : null;
  };
  const fAgora = prob ? forcaDe(prob.tri) : null;
  const bloco = (rot, val, sub, marca, destaque) => el('div', { class: 'enso-bloco' + (destaque ? ' destaque' : '') },
    el('small', { text: rot }), el('b', { text: val }), el('span', { class: 'sub', text: sub }), marca ? el('span', { class: 'marca ' + marca[0], text: marca[1] }) : null);
  const filhos = [
    el('p', { class: 'enso-status', text: disc ? traduzStatus(disc.status) : 'Status oficial indisponível' }),
    roniUlt ? el('p', { class: 'enso-intensidade', text: `Intensidade pelo RONI: ${intensidade(roniUlt.anom)}` }) : null,
    el('div', { class: 'enso-grade' },
      bloco('RONI, índice oficial', valido(roniUlt?.anom) ? `${roniUlt.anom > 0 ? '+' : ''}${fmt.n(roniUlt.anom, 2)} °C` : '–', roniUlt ? `trimestre ${roniUlt.seas} ${roniUlt.ano}` : 'indisponível', ['oficial', 'oficial'], true),
      bloco('Niño 3.4 da semana', sinal(rel?.n34), rel ? `relativo, semana de ${dataSem(rel.ms)}` : 'indisponível', ['medido', 'medido']),
      bloco('Chance de El Niño', prob ? `${prob.elNino}%` : '–', prob ? `trimestre ${prob.tri} (atual), NOAA` : 'indisponível', ['oficial', 'oficial'], true),
      bloco('Força mais provável', fAgora ? fAgora.nome : '–', fAgora ? `${fAgora.p}% de chance; forte ou mais: ${fAgora.forteOuMais}%` : 'indisponível', ['oficial', 'oficial'], true),
      dia ? bloco('Niño 3.4 de ontem', sinal(dia.anom), `${fmt.n(dia.sst, 1)} °C no mar, ${new Date(dia.data + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`, ['previsao', 'estimativa']) : null),
    probs.length ? el('table', { class: 'enso-tri' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Trimestre' }), el('th', { class: 'n', text: 'El Niño' }), el('th', { text: 'Força mais provável' }))),
      el('tbody', {}, ...probs.slice(iAgora).map((x) => { const f = forcaDe(x.tri); return el('tr', {},
        el('td', { text: x.tri }), el('td', { class: 'n', text: `${x.elNino}%` }), el('td', { text: f ? `${f.nome} (${f.p}%)` : (x.neutro >= x.elNino ? `neutro mais provável (${x.neutro}%)` : '–') })); }))) : null,
    probs.length ? el('p', { class: 'nota', text: 'Chance e força: previsão oficial da NOAA CPC, revisada na 2ª quinta-feira de cada mês. Força pelo RONI: fraco 0,5 a 1 °C, moderado 1 a 1,5, forte 1,5 a 2, muito forte 2 ou mais.' }) : null,
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
function irPara(aba, rolarTopo = true, direcao = 0) {
  if (!ABAS.includes(aba)) return;
  const mudou = estado.aba !== aba;
  estado.aba = aba;
  for (const s of document.querySelectorAll('.aba')) s.hidden = s.dataset.aba !== aba;
  if (aba !== 'hoje') $('#agora').classList.remove('oculto'); else observarAgora();
  document.querySelectorAll('.nav button').forEach((b) => { if (b.dataset.ir === aba) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (rolarTopo) window.scrollTo({ top: 0, behavior: 'instant' });
  if (aba === 'elnino' && estado.prev !== undefined) renderElNino();
  // Entrada suave da aba (só transform e opacidade, que a placa de vídeo faz sem travar).
  // Gráficos e faixas se ajustam sozinhos pelo ResizeObserver quando a aba aparece; nada é redesenhado à força.
  if (mudou) {
    const sec = $(`#aba-${aba}`);
    sec.classList.remove('entra', 'entra-dir', 'entra-esq');
    void sec.offsetWidth;
    sec.classList.add(direcao > 0 ? 'entra-dir' : direcao < 0 ? 'entra-esq' : 'entra');
  }
}

function configurarNavegacao() {
  for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => irPara(b.dataset.ir));
  // Deslizar entre Hoje, Amanhã e Semana. Para não trocar de aba sem querer, o gesto só vale quando:
  // é um único dedo, rápido (até 450 ms), claramente horizontal (80 px ou mais, e 3 vezes mais que o vertical),
  // a página não rolou no meio, não começou na borda da tela (gesto de voltar do sistema)
  // e não começou em nada que role para os lados (horas, gráficos, tabelas, camadas, mapa).
  let ini = null;
  const main = $('#conteudo');
  const rolaHorizontal = (alvo) => {
    for (let n = alvo; n && n !== main; n = n.parentElement) {
      if (n.matches?.('[data-hscroll], .mapa, .ceu, dialog, input, .rolar, .tabela-rolar, .camadas, .horas, .u-wrap')) return true;
      if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  main.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    ini = e.touches.length === 1 && t.clientX > 24 && t.clientX < innerWidth - 24 && !rolaHorizontal(e.target)
      ? { x: t.clientX, y: t.clientY, t: performance.now(), sy: window.scrollY } : null;
  }, { passive: true });
  main.addEventListener('touchmove', (e) => { if (ini && e.touches.length !== 1) ini = null; }, { passive: true });
  main.addEventListener('touchcancel', () => { ini = null; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (!ini) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - ini.x, dy = t.clientY - ini.y, dt = performance.now() - ini.t, rolou = Math.abs(window.scrollY - ini.sy) > 4;
    ini = null;
    if (rolou || dt > 450 || Math.abs(dx) < 80 || Math.abs(dx) < 3 * Math.abs(dy)) return;
    const trio = ['hoje', 'amanha', 'semana'];
    const k = trio.indexOf(estado.aba);
    if (k < 0) return;
    const n = dx < 0 ? k + 1 : k - 1;
    if (n >= 0 && n < trio.length) irPara(trio[n], true, dx < 0 ? 1 : -1);
  }, { passive: true });
}

function configurarPuxar() {
  // Puxar para atualizar: o aviso flutua sobre a página (transform), sem empurrar o conteúdo,
  // e só dispara com o dedo puxando claramente para baixo a partir do topo.
  const ind = $('#puxar');
  let y0 = null, x0 = 0, dy = 0;
  const mostrar = (v) => { ind.style.transform = `translate(-50%, ${v}px)`; ind.style.opacity = v > 0 ? '1' : '0'; };
  window.addEventListener('touchstart', (e) => {
    y0 = window.scrollY <= 0 && e.touches.length === 1 && !e.target.closest('.mapa, dialog, .camadas, [data-hscroll]') ? e.touches[0].clientY : null;
    x0 = e.touches[0]?.clientX ?? 0; dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    if (e.touches.length !== 1 || window.scrollY > 0 || Math.abs(e.touches[0].clientX - x0) > 40) { y0 = null; mostrar(0); return; }
    dy = e.touches[0].clientY - y0;
    const v = dy > 20 ? Math.min(56, (dy - 20) / 2) : 0;
    ind.textContent = dy > 110 ? 'Solte para atualizar' : 'Puxe para atualizar';
    mostrar(v);
  }, { passive: true });
  const fim = () => {
    if (y0 !== null && dy > 110 && window.scrollY <= 0) atualizarTudo();
    y0 = null; dy = 0; mostrar(0);
  };
  window.addEventListener('touchend', fim, { passive: true });
  window.addEventListener('touchcancel', () => { y0 = null; dy = 0; mostrar(0); }, { passive: true });
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
