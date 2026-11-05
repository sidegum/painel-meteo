// Testes do widget do iPhone (widget/painel-widget.js) com uma simulação mínima da API do Scriptable.
// Rodar: node --test test/widget.test.mjs
// O que é testado: fluxo de local, leitura do resumo, cache sem conexão e os textos exibidos em cada tamanho.
// O que não é testado aqui: o Scriptable real no iPhone (WebView, GPS e agenda de atualização do iOS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CODIGO = readFileSync(new URL('../widget/painel-widget.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/** Resumo no formato 1, como o painel entrega em window.painelResumo (capturado do modo widget). */
export const RESUMO = {
  formato: 1, versao: '1.2.27', geradoMs: 1793809395885, previsaoMs: 1793809395850,
  valores: { temperatura: 21.3, temperaturaMedida: true, chance: 0.98, chovendo: true, chegando: false, temporal: 'alto', aviso: true, rajadaKmh: 19 },
  textos: {
    local: 'Campo Bom', temperatura: '21°', rotuloTemperatura: 'agora', sensacao: 'sensação 22°',
    notaTemperatura: 'INMET Campo Bom · 15:00', notaPrevisao: 'Open-Meteo · 15:43', minMax: 'mín 18° · máx 27°',
    chuva: 'Chovendo agora', chance: 'agora', chuvaDetalhe: '≈ 9 mm até 21h',
    temporal: 'Risco alto de temporal', temporalFonte: 'INMET', rajada: 'Rajada 19 km/h de NE às 15h', confianca: 'Confiança alta',
  },
};

// ------------------------------------------------------------------ simulação do Scriptable

class Pilha {
  constructor(tipo) { this.tipo = tipo; this.filhos = []; this.vertical = tipo === 'widget'; }
  addText(t) { const x = { tipo: 'texto', texto: t }; this.filhos.push(x); return x; }
  addStack() { const p = new Pilha('pilha'); this.filhos.push(p); return p; }
  addSpacer(n = null) { this.filhos.push({ tipo: 'espaco', n }); }
  addImage(img) { const x = { tipo: 'imagem', img }; this.filhos.push(x); return x; }
  layoutVertically() { this.vertical = true; }
  layoutHorizontally() { this.vertical = false; }
  centerAlignContent() {} bottomAlignContent() {} topAlignContent() {}
  setPadding(...p) { this.padding = p; }
  async presentMedium() { this.apresentado = 'medium'; }
}

/**
 * Executa o script com a simulação. Retorna o widget entregue e o estado da simulação.
 * @param {{familia?:string, parametro?:string|null, pagina?:Function, gps?:object|null, arquivos?:Map}} op
 *   pagina(url) devolve o texto que a página entrega a completion(), ou lança erro (sem conexão)
 */
async function rodar({ familia = 'medium', parametro = null, pagina = () => JSON.stringify(RESUMO), gps = { latitude: -29.6789, longitude: -51.0512 }, arquivos = new Map() } = {}) {
  const sim = { urls: [], widget: null, arquivos, erros: [] };
  const cor = (h) => ({ hex: h });
  const Color = Object.assign(function Color(h) { return cor(h); }, { dynamic: (claro, escuro) => ({ claro, escuro }) });
  const fonte = (peso) => (n) => ({ peso, n });
  const globais = {
    Color,
    Font: { systemFont: fonte('normal'), boldSystemFont: fonte('negrito'), semiboldSystemFont: fonte('seminegrito') },
    Size: function Size(w, h) { return { w, h }; },
    SFSymbol: { named: (n) => ({ image: { simbolo: n } }) },
    ListWidget: function ListWidget() { return new Pilha('widget'); },
    DateFormatter: function DateFormatter() { return { dateFormat: '', string: (d) => d.toISOString().slice(11, 16) }; },
    Timer: { schedule: (ms, rep, fn) => { const t = setTimeout(fn, Math.min(ms, 50)); return { invalidate: () => clearTimeout(t) }; } },
    Location: {
      setAccuracyToThreeKilometers() {},
      current: async () => { if (!gps) throw new Error('sem permissão'); return gps; },
      reverseGeocode: async () => [{ locality: 'Campo Bom' }],
    },
    WebView: function WebView() {
      let url = '';
      return {
        loadURL: async (u) => { url = u; sim.urls.push(u); },
        evaluateJavaScript: async () => pagina(url),
      };
    },
    FileManager: { local: () => ({
      documentsDirectory: () => '/doc', joinPath: (a, b) => `${a}/${b}`,
      fileExists: (c) => arquivos.has(c), readString: (c) => arquivos.get(c), writeString: (c, t) => arquivos.set(c, t),
    }) },
    config: { runsInWidget: true, widgetFamily: familia },
    args: { widgetParameter: parametro },
    Script: { setWidget: (w) => { sim.widget = w; }, complete: () => {} },
    console: { error: (m) => sim.erros.push(m), log() {} },
  };
  const Assincrona = Object.getPrototypeOf(async () => {}).constructor;
  await new Assincrona(...Object.keys(globais), CODIGO)(...Object.values(globais));
  return sim;
}

/** Todos os textos do widget, na ordem em que aparecem. */
function textos(no) {
  if (no.tipo === 'texto') return [no.texto];
  return (no.filhos || []).flatMap(textos);
}

// ------------------------------------------------------------------ testes

test('contrato: o formato do resumo é o mesmo no app e no widget', () => {
  const app = APP.match(/const FORMATO_RESUMO = (\d+);/)?.[1];
  const widget = CODIGO.match(/formatoResumo: (\d+),/)?.[1];
  assert.ok(app && widget);
  assert.equal(app, widget);
});

test('tamanho médio mostra os textos prontos do painel, sem recalcular', async () => {
  const { widget } = await rodar();
  const t = textos(widget);
  for (const esperado of ['Campo Bom', '21°', 'agora', 'sensação 22°', 'mín 18° · máx 27°', 'Chovendo agora', '≈ 9 mm até 21h',
    'Risco alto de temporal · INMET', 'Rajada 19 km/h de NE às 15h', 'INMET Campo Bom · 15:00', 'Open-Meteo · 15:43', 'Confiança alta']) {
    assert.ok(t.includes(esperado), `faltou "${esperado}" em ${JSON.stringify(t)}`);
  }
  assert.equal(widget.url, 'https://sidegum.github.io/painel-meteo/');
  assert.ok(widget.refreshAfterDate instanceof Date);
});

test('local do GPS vai arredondado para 2 casas, com o nome da cidade', async () => {
  const { urls } = await rodar();
  assert.equal(urls[0], 'https://sidegum.github.io/painel-meteo/?widget=1&lat=-29.68&lon=-51.05&nome=Campo%20Bom');
});

test('parâmetro "lat,lon" do widget substitui o GPS', async () => {
  const { urls } = await rodar({ parametro: '-30,03; -51,23', gps: null });
  assert.equal(urls[0], 'https://sidegum.github.io/painel-meteo/?widget=1&lat=-30.03&lon=-51.23');
});

test('sem GPS e sem local anterior, o painel usa o padrão (Campo Bom)', async () => {
  const { urls } = await rodar({ gps: null });
  assert.equal(urls[0], 'https://sidegum.github.io/painel-meteo/?widget=1');
});

test('sem conexão: mostra o último resumo guardado e avisa que pode estar desatualizado', async () => {
  const arquivos = new Map();
  await rodar({ arquivos });
  const { widget } = await rodar({ arquivos, pagina: () => { throw new Error('sem conexão'); } });
  const t = textos(widget);
  assert.ok(t.includes('21°'));
  assert.ok(t.some((x) => x.startsWith('Sem atualização · dados de ')), JSON.stringify(t));
});

test('sem conexão e sem resumo guardado: mensagem simples, sem números', async () => {
  const { widget } = await rodar({ pagina: () => { throw new Error('sem conexão'); } });
  assert.deepEqual(textos(widget), ['Painel do tempo', 'Sem dados agora', 'Toque para abrir o painel.']);
});

test('resumo com erro ou em outro formato não é exibido nem guardado', async () => {
  const arquivos = new Map();
  const a = await rodar({ arquivos, pagina: () => JSON.stringify({ formato: 1, erro: 'previsão indisponível' }) });
  assert.ok(textos(a.widget).includes('Sem dados agora'));
  const b = await rodar({ arquivos, pagina: () => JSON.stringify({ ...RESUMO, formato: 2 }) });
  assert.ok(textos(b.widget).includes('Sem dados agora'));
  const guardado = arquivos.get('/doc/painel-meteo-widget.json');
  assert.ok(!guardado || !JSON.parse(guardado).resumo);
});

test('sem chuva agora: a resposta vem com a chance', async () => {
  const pode = { ...RESUMO, valores: { ...RESUMO.valores, chovendo: false }, textos: { ...RESUMO.textos, chuva: 'Pode chover', chance: '40%' } };
  const { widget } = await rodar({ pagina: () => JSON.stringify(pode) });
  assert.ok(textos(widget).includes('Pode chover · 40%'));
});

test('sem risco de temporal: mostra a linha de avisos do INMET, como a tela Hoje', async () => {
  const semRisco = { ...RESUMO, valores: { ...RESUMO.valores, temporal: null, aviso: false }, textos: { ...RESUMO.textos, temporal: 'Nenhum aviso do INMET', temporalFonte: null } };
  const { widget } = await rodar({ pagina: () => JSON.stringify(semRisco) });
  const t = textos(widget);
  assert.ok(t.includes('Nenhum aviso do INMET'));
  assert.ok(!t.some((x) => /null/.test(x)));
});

test('todos os tamanhos são montados sem erro', async () => {
  for (const familia of ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    const { widget } = await rodar({ familia });
    assert.ok(textos(widget).length > 0, familia);
    assert.ok(!textos(widget).some((x) => /undefined|null/.test(x)), familia);
  }
});
