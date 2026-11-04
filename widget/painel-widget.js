// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-sun-rain;

// Widget do Painel Meteorológico para o iPhone (app Scriptable).
//
// Como funciona:
// 1. Pega a posição pelo GPS do iPhone (precisão de cerca de 3 km), arredondada para 2 casas, como o app.
// 2. Abre o próprio painel fora da tela, no modo widget (?widget=1&lat=..&lon=..). O painel faz a mesma busca
//    e a mesma análise da tela Hoje e devolve um resumo com os textos já prontos (window.painelResumo).
// 3. Mostra esses textos. O widget não calcula nada: os números são sempre os mesmos do app.
// 4. Guarda o último resumo válido. Sem conexão, mostra esse resumo com o aviso de que pode estar desatualizado.
//
// Contrato do resumo: docs/TECNICO.md, seção 11. Instalação: docs/WIDGET.md.

/** Configuração. appUrl é o único item a trocar quando o painel mudar de endereço. */
const CONFIG = {
  appUrl: 'https://sidegum.github.io/painel-meteo/',
  formatoResumo: 1,          // igual a FORMATO_RESUMO em js/app.js
  atualizarMin: 15,          // pedido ao iOS; ele decide o momento exato da atualização
  esperaGpsMs: 8000,
  esperaNomeMs: 4000,
  esperaPaginaMs: 15000,
  esperaResumoMs: 25000,
  arquivoCache: 'painel-meteo-widget.json',
};

/** Cores do visual do app (app.css, :root[data-visual="a"]): claro e escuro. */
const CORES = {
  fundo: Color.dynamic(new Color('#FFFFFF'), new Color('#1A1D20')),
  texto: Color.dynamic(new Color('#15181B'), new Color('#ECEEF0')),
  fraco: Color.dynamic(new Color('#5D666E'), new Color('#9BA4AC')),
  chuva: Color.dynamic(new Color('#155F91'), new Color('#6BB8E3')),
  rajada: Color.dynamic(new Color('#7A5A00'), new Color('#E2C474')),
  alto: Color.dynamic(new Color('#C4492B'), new Color('#EE8A6A')),
};

/**
 * Fluxo do widget: local, resumo (novo ou guardado) e desenho conforme o tamanho escolhido.
 * Fora do widget (rodando dentro do Scriptable), mostra a prévia no tamanho médio.
 */
async function principal() {
  const local = await obterLocal(args.widgetParameter);
  let resumo = null, guardado = false;
  try {
    resumo = await buscarResumo(local);
    salvarCache(resumo);
  } catch (e) {
    resumo = lerCache();
    guardado = Boolean(resumo);
    if (!resumo) console.error(`Painel sem resumo: ${e.message}`);
  }
  const widget = montarWidget(resumo, guardado, config.widgetFamily || 'medium');
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

// ------------------------------------------------------------------ local

/**
 * Local do widget, já arredondado para 2 casas (cerca de 1 km), como o app envia às APIs.
 * Ordem: parâmetro do widget "lat,lon"; GPS do iPhone; último local usado; null (o painel usa Campo Bom).
 * @param {string|null} parametro texto de "Parâmetro" na edição do widget
 * @returns {Promise<{lat:number, lon:number, nome:string|null}|null>}
 */
async function obterLocal(parametro) {
  const fixo = lerCoordenadas(parametro);
  if (fixo) return fixo;
  try {
    Location.setAccuracyToThreeKilometers();
    const pos = await comLimite(Location.current(), CONFIG.esperaGpsMs, 'GPS demorou demais');
    const local = { lat: arredonda(pos.latitude), lon: arredonda(pos.longitude), nome: null };
    try {
      const lugares = await comLimite(Location.reverseGeocode(pos.latitude, pos.longitude, 'pt_BR'), CONFIG.esperaNomeMs, 'nome demorou');
      local.nome = lugares?.[0]?.locality || null;
    } catch { /* sem nome: o painel mostra "Sua localização" */ }
    gravarArquivo('local', local);
    return local;
  } catch {
    return lerArquivo('local');
  }
}

/**
 * Lê "lat,lon" (ponto ou vírgula decimal separados por vírgula, ponto e vírgula ou espaço).
 * @param {string|null} texto
 * @returns {{lat:number, lon:number, nome:null}|null}
 */
function lerCoordenadas(texto) {
  const m = String(texto || '').trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[;, ]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.')), lon = Number(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: arredonda(lat), lon: arredonda(lon), nome: null };
}

const arredonda = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ resumo do painel

/**
 * Abre o painel fora da tela no modo widget e lê o resumo de Hoje.
 * @param {{lat:number, lon:number, nome:string|null}|null} local
 * @returns {Promise<object>} resumo no formato CONFIG.formatoResumo
 * @throws {Error} sem conexão, painel sem modo widget, formato diferente ou resposta com erro
 */
async function buscarResumo(local) {
  const web = new WebView();
  await comLimite(web.loadURL(urlDoPainel(local)), CONFIG.esperaPaginaMs, 'o painel não abriu');
  const leitura = `
    const limite = new Promise((ok) => setTimeout(() => ok(null), ${CONFIG.esperaResumoMs}));
    Promise.race([window.painelResumo || Promise.resolve(null), limite])
      .then((r) => completion(r ? JSON.stringify(r) : ''))
      .catch(() => completion(''));`;
  const texto = await web.evaluateJavaScript(leitura, true);
  if (!texto) throw new Error('o painel não respondeu');
  const resumo = JSON.parse(texto);
  if (resumo.erro) throw new Error(resumo.erro);
  if (resumo.formato !== CONFIG.formatoResumo || !resumo.textos) throw new Error('formato do resumo diferente: atualize o widget');
  return resumo;
}

/**
 * Endereço do painel no modo widget.
 * @param {{lat:number, lon:number, nome:string|null}|null} local
 * @returns {string}
 */
function urlDoPainel(local) {
  const q = ['widget=1'];
  if (local) {
    q.push(`lat=${local.lat}`, `lon=${local.lon}`);
    if (local.nome) q.push(`nome=${encodeURIComponent(local.nome)}`);
  }
  return `${CONFIG.appUrl}?${q.join('&')}`;
}

// ------------------------------------------------------------------ desenho

/**
 * Monta o widget para o tamanho escolhido. Toque no widget abre o painel.
 * @param {object|null} resumo
 * @param {boolean} guardado true quando o resumo é o último guardado (sem conexão ou falha)
 * @param {string} familia config.widgetFamily
 * @returns {ListWidget}
 */
function montarWidget(resumo, guardado, familia) {
  const w = new ListWidget();
  w.url = CONFIG.appUrl;
  w.refreshAfterDate = new Date(Date.now() + CONFIG.atualizarMin * 60000);
  const tela = familia.startsWith('accessory');
  if (!tela) { w.backgroundColor = CORES.fundo; w.setPadding(12, 14, 12, 14); }
  if (!resumo) return semDados(w, familia);
  const T = resumo.textos;
  const nota = guardado ? `Sem atualização · dados de ${horaMin(resumo.previsaoMs)}` : T.notaPrevisao;
  if (familia === 'accessoryInline') {
    w.addText(`${T.temperatura} · ${T.chuva} ${T.chance}`);
  } else if (familia === 'accessoryCircular') {
    texto(w, T.temperatura, Font.boldSystemFont(18));
    texto(w, T.chance, Font.systemFont(11));
  } else if (familia === 'accessoryRectangular') {
    texto(w, `${T.temperatura} · ${T.chance} chuva`, Font.boldSystemFont(15));
    texto(w, T.chuva, Font.systemFont(12));
    texto(w, resumo.valores.temporal ? T.temporal : nota, Font.systemFont(11));
  } else if (familia === 'small') {
    pequeno(w, resumo, nota, guardado);
  } else {
    medio(w, resumo, nota, guardado);
  }
  return w;
}

/** Tamanho pequeno: local, temperatura, chuva, temporal e nota. */
function pequeno(w, r, nota, guardado) {
  const T = r.textos;
  texto(w, T.local, Font.semiboldSystemFont(12), CORES.fraco);
  const linha = w.addStack();
  linha.bottomAlignContent();
  texto(linha, T.temperatura, Font.boldSystemFont(34));
  linha.addSpacer(4);
  texto(linha, r.valores.temperaturaMedida ? 'agora' : 'prevista', Font.systemFont(11), CORES.fraco);
  w.addSpacer(2);
  texto(w, linhaChuva(r), Font.semiboldSystemFont(13), CORES.chuva);
  if (T.chuvaDetalhe) texto(w, T.chuvaDetalhe, Font.systemFont(11), CORES.texto, 2);
  w.addSpacer();
  linhaTemporal(w, r, 11);
  texto(w, nota, Font.systemFont(10), guardado ? CORES.alto : CORES.fraco);
}

/** Tamanho médio (e grande): temperatura à esquerda; chuva, temporal e rajada à direita. */
function medio(w, r, nota, guardado) {
  const T = r.textos;
  const topo = w.addStack();
  texto(topo, T.local, Font.semiboldSystemFont(13), CORES.fraco);
  topo.addSpacer();
  texto(topo, T.confianca, Font.systemFont(11), CORES.fraco);
  w.addSpacer(4);
  const corpo = w.addStack();
  const esq = corpo.addStack();
  esq.layoutVertically();
  texto(esq, T.temperatura, Font.boldSystemFont(40));
  texto(esq, T.rotuloTemperatura, Font.systemFont(11), CORES.fraco);
  texto(esq, T.minMax, Font.systemFont(12));
  corpo.addSpacer(14);
  const dir = corpo.addStack();
  dir.layoutVertically();
  texto(dir, linhaChuva(r), Font.semiboldSystemFont(15), CORES.chuva);
  if (T.chuvaDetalhe) texto(dir, T.chuvaDetalhe, Font.systemFont(12), CORES.texto, 2);
  dir.addSpacer(4);
  linhaTemporal(dir, r, 12);
  texto(dir, T.rajada, Font.systemFont(12), CORES.rajada);
  corpo.addSpacer();
  w.addSpacer();
  const rodape = w.addStack();
  // temperatura medida: a nota da estação à esquerda; prevista, só a nota da previsão (é a mesma fonte)
  if (r.valores.temperaturaMedida) texto(rodape, T.notaTemperatura, Font.systemFont(10), CORES.fraco);
  rodape.addSpacer();
  texto(rodape, nota, Font.systemFont(10), guardado ? CORES.alto : CORES.fraco);
}

/** Resposta curta da chuva com a chance ("Pode chover · 40%"); chovendo, só "Chovendo agora". */
function linhaChuva(r) {
  return r.valores.chovendo ? r.textos.chuva : `${r.textos.chuva} · ${r.textos.chance}`;
}

/**
 * Linha de temporal e avisos, com a mesma regra da tela Hoje: risco moderado ou alto em destaque, com a fonte;
 * senão a linha de avisos do INMET.
 */
function linhaTemporal(pilha, r, tamanho) {
  const T = r.textos, nivel = r.valores.temporal;
  if (nivel) {
    const cor = nivel === 'alto' ? CORES.alto : CORES.rajada;
    const linha = pilha.addStack();
    linha.centerAlignContent();
    const raio = linha.addImage(SFSymbol.named('bolt.fill').image);
    raio.imageSize = new Size(tamanho, tamanho);
    raio.tintColor = cor;
    linha.addSpacer(3);
    texto(linha, `${T.temporal} · ${T.temporalFonte}`, Font.semiboldSystemFont(tamanho), cor);
  } else {
    texto(pilha, T.temporal, Font.systemFont(tamanho), r.valores.aviso ? CORES.alto : CORES.fraco);
  }
}

/** Sem resumo novo nem guardado (primeira vez sem conexão, por exemplo). */
function semDados(w, familia) {
  if (familia === 'accessoryInline') { w.addText('Tempo: sem dados'); return w; }
  texto(w, 'Painel do tempo', Font.semiboldSystemFont(13), CORES.fraco);
  w.addSpacer(4);
  texto(w, 'Sem dados agora', Font.boldSystemFont(16));
  texto(w, 'Toque para abrir o painel.', Font.systemFont(12), CORES.fraco);
  return w;
}

/**
 * Adiciona um texto com fonte, cor e número de linhas.
 * @returns {WidgetText}
 */
function texto(pilha, conteudo, fonte, cor = CORES.texto, linhas = 1) {
  const t = pilha.addText(String(conteudo ?? ''));
  t.font = fonte;
  t.textColor = cor;
  t.lineLimit = linhas;
  t.minimumScaleFactor = 0.7;
  return t;
}

/** Hora local do iPhone no formato 15:40. */
function horaMin(ms) {
  const f = new DateFormatter();
  f.dateFormat = 'HH:mm';
  return Number.isFinite(ms) ? f.string(new Date(ms)) : '–';
}

// ------------------------------------------------------------------ utilidades

/**
 * Rejeita a promessa se ela não terminar a tempo (o Scriptable não tem setTimeout; usa Timer).
 * @template T
 * @param {Promise<T>} promessa
 * @param {number} ms
 * @param {string} motivo mensagem do erro
 * @returns {Promise<T>}
 */
function comLimite(promessa, ms, motivo) {
  return new Promise((ok, falha) => {
    const timer = Timer.schedule(ms, false, () => falha(new Error(motivo)));
    promessa.then((v) => { timer.invalidate(); ok(v); }, (e) => { timer.invalidate(); falha(e); });
  });
}

/** Último resumo válido, guardado só neste iPhone. */
function salvarCache(resumo) { gravarArquivo('resumo', resumo); }
function lerCache() {
  const r = lerArquivo('resumo');
  return r?.formato === CONFIG.formatoResumo && r.textos ? r : null;
}

/** Arquivo JSON do widget na pasta local do Scriptable, com uma chave por tipo de dado. */
function gravarArquivo(chave, valor) {
  try {
    const dados = lerTudo();
    dados[chave] = valor;
    const fm = FileManager.local();
    fm.writeString(fm.joinPath(fm.documentsDirectory(), CONFIG.arquivoCache), JSON.stringify(dados));
  } catch { /* sem cache: o widget segue funcionando */ }
}
function lerArquivo(chave) { return lerTudo()[chave] ?? null; }
function lerTudo() {
  try {
    const fm = FileManager.local();
    const caminho = fm.joinPath(fm.documentsDirectory(), CONFIG.arquivoCache);
    return fm.fileExists(caminho) ? JSON.parse(fm.readString(caminho)) : {};
  } catch {
    return {};
  }
}

// Ponto de entrada: no fim do arquivo, depois de todas as declarações (const e let não existem antes da linha).
await principal();
