// Catálogos da Via Láctea na aba Globo: o que há medido, com distância, em volta do Sol e pelo disco da Galáxia.
// Entram na cena da galáxia (js/globo-galaxia.js, kpc, referencial galactocêntrico) como pontos tocáveis.
//
// vendor/ceu/catalogos.json (montado por scripts/globo/montar-universo.py):
// - Aglomerados estelares: Hunt & Reffert 2023 (Gaia DR3), amostra confiável, com distância, idade e tamanho.
// - Pulsares: catálogo ATNF (Manchester et al. 2005), com a melhor estimativa de distância do catálogo.
// - Estrelas com planetas: NASA Exoplanet Archive (parâmetros compostos), uma entrada por estrela com os planetas dela.
const RAD = Math.PI / 180;
const CELULAR = matchMedia('(pointer: coarse)').matches;
const num = (v, casas = 0) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '–');

/** Nomes populares de aglomerados estelares (o catálogo usa Melotte, NGC e IC). */
const NOMES_AGLOMERADOS = {
  'Melotte 22': 'Plêiades (M45)', 'Melotte 25': 'Híades', 'NGC 2632': 'Presépio (M44)', 'Melotte 20': 'Aglomerado de Alfa de Perseu', 'Melotte 111': 'Aglomerado de Coma',
  'NGC 869': 'h de Perseu', 'NGC 884': 'χ de Perseu', 'NGC 6705': 'Pato Selvagem (M11)', 'NGC 7092': 'M39', 'NGC 2287': 'M41', 'NGC 6475': 'Aglomerado de Ptolomeu (M7)',
  'NGC 6405': 'Aglomerado da Borboleta (M6)', 'NGC 2168': 'M35', 'NGC 1960': 'M36', 'NGC 2099': 'M37', 'NGC 1912': 'M38', 'NGC 2682': 'M67', 'NGC 4755': 'Caixa de Joias',
  'IC 2602': 'Plêiades do Sul', 'NGC 3532': 'Poço dos Desejos', 'IC 2391': 'Aglomerado de Ômicron de Vela', 'NGC 2516': 'Presépio do Sul', 'NGC 6231': 'NGC 6231 (Escorpião)',
  'NGC 2244': 'Aglomerado da Roseta', 'NGC 6611': 'Aglomerado da Águia (M16)', 'NGC 6530': 'Aglomerado da Lagoa (M8)', 'NGC 1976': 'Aglomerado do Trapézio (Órion)',
};
/** Pulsares com história: nome do catálogo → [nome popular, por que importa]. */
const PULSARES_NOTAVEIS = {
  'J0534+2200': ['Pulsar do Caranguejo', 'Resto da supernova vista em 1054; gira 30 vezes por segundo.'],
  'J0835-4510': ['Pulsar de Vela', 'O pulsar mais brilhante do céu em rádio.'],
  'J1921+2153': ['PSR B1919+21', 'O primeiro pulsar descoberto (Jocelyn Bell, 1967).'],
  'J1939+2134': ['PSR B1937+21', 'O primeiro pulsar de milissegundo: 642 voltas por segundo.'],
  'J1915+1606': ['Pulsar de Hulse-Taylor', 'O par de estrelas de nêutrons que provou a existência das ondas gravitacionais (Nobel de 1993).'],
  'J0737-3039A': ['Pulsar duplo', 'O único sistema conhecido com dois pulsares visíveis orbitando um ao outro.'],
  'J1300+1240': ['PSR B1257+12', 'Os primeiros planetas fora do Sistema Solar foram achados em volta deste pulsar (1992).'],
  'J0633+1746': ['Geminga', 'Um dos pulsares mais próximos; brilha em raios gama e quase nada em rádio.'],
};
/** Estrelas com planetas que ganham nome na tela de perto. */
const SISTEMAS_NOTAVEIS = ['Proxima Cen', "Barnard's star", 'TRAPPIST-1', '51 Peg', 'eps Eri', 'tau Cet', 'Kepler-452', 'Kepler-186', 'Kepler-90', 'HD 209458', '55 Cnc', 'GJ 1214', 'K2-18', 'WASP-12', 'TOI-700', 'LHS 1140', 'bet Pic', 'HR 8799', 'Wolf 359', 'GJ 667 C'];
const METODOS = { Transit: 'trânsito', 'Radial Velocity': 'velocidade radial', Imaging: 'imagem direta', Microlensing: 'microlente gravitacional', 'Transit Timing Variations': 'variação dos trânsitos',
  'Eclipse Timing Variations': 'variação dos eclipses', Astrometry: 'astrometria', 'Pulsar Timing': 'pulsos do pulsar', 'Orbital Brightness Modulation': 'variação de brilho na órbita',
  'Pulsation Timing Variations': 'variação das pulsações', 'Disk Kinematics': 'movimento do disco' };

const C = { ctx: null, pronto: false, aglomerados: [], pulsares: [], sistemas: [], pontos: {}, fontes: {} };
export const estado = C;

/** Posição na cena (kpc) de uma direção galáctica a uma distância do Sol. */
function lugar(l, b, dKpc) {
  const { THREE, meta } = C.ctx, cl = l * RAD, cb = b * RAD;
  return new THREE.Vector3(Math.cos(cb) * Math.sin(cl) * dKpc, Math.sin(cb) * dKpc + meta.zSol, Math.cos(cb) * Math.cos(cl) * dKpc - meta.R0);
}

/**
 * Baixa o catálogo e monta os pontos (escondidos até a escala certa).
 * @param {object} ctx contexto da cena da galáxia: THREE, meta, rotulo, pontosAlvo, baixar, adicionar
 */
export async function prepararCatalogos(ctx) {
  C.ctx = ctx;
  const dados = await ctx.baixar('catalogos.json').catch(() => null);
  if (!dados) return C;
  C.fontes = dados.fontes || {};
  const { rotulo, pontosAlvo, adicionar } = ctx;

  C.aglomerados = dados.aglomeradosEstelares.linhas.map(([nome, l, b, distPc, logIdade, r50, estrelas, movel]) => ({
    tipo: 'aglomerado-estelar', catalogo: nome, nome: NOMES_AGLOMERADOS[nome] || nome, popular: !!NOMES_AGLOMERADOS[nome], distKpc: distPc / 1000, logIdade, r50, estrelas, movel: !!movel,
    p: lugar(l, b, distPc / 1000), cor: logIdade != null && logIdade < 7.7 ? '#a9c8ff' : '#ffe9c4', diam: 0.0006, minPx: 2 + Math.min(1.6, Math.log10(Math.max(10, estrelas)) - 1), k: 0.8 }));
  C.pulsares = dados.pulsares.linhas.map(([nome, l, b, distKpc, periodo, dm, binario, idade, assoc]) => ({
    tipo: 'pulsar', catalogo: nome, nome: PULSARES_NOTAVEIS[nome]?.[0] || `PSR ${nome}`, historia: PULSARES_NOTAVEIS[nome]?.[1] || null, distKpc, periodo, dm, binario: !!binario, idade,
    assoc: assoc ? assoc.replace(/^[A-Z]+:/, '') : null, p: lugar(l, b, distKpc), cor: '#9ff5e6', diam: 0.0005, minPx: periodo && periodo < 0.03 ? 1.7 : 2.0, k: 0.7 }));
  C.sistemas = dados.exoplanetas.sistemas.map((s) => ({
    tipo: 'sistema-planetario', nome: s.n, distKpc: s.d / 1000, temp: s.t, vmag: s.v, planetas: s.p, p: lugar(s.l, s.b, s.d / 1000), cor: '#8dffae', diam: 0.0002, minPx: 1.6 + Math.min(1.2, s.p.length * 0.25), k: 0.7 }));

  for (const [chave, lista] of [['aglomerados', C.aglomerados], ['pulsares', C.pulsares], ['sistemas', C.sistemas]]) {
    if (!lista.length) continue;
    C.pontos[chave] = pontosAlvo(lista);
    C.pontos[chave].visible = false;
    adicionar(C.pontos[chave]);
  }
  // nomes: poucos, só os conhecidos, cada um na faixa de zoom em que faz sentido
  for (const a of C.aglomerados.filter((x) => x.popular)) rotulo(a.nome, a.p, { prioridade: 14, de: 0.02, ate: Math.max(1.2, a.distKpc * 9), classe: 'estelar', alvo: a });
  for (const p of C.pulsares.filter((x) => x.historia)) rotulo(p.nome, p.p, { prioridade: 13, de: 0.05, ate: Math.max(2, p.distKpc * 8), classe: 'pulsar', alvo: p });
  const notaveis = new Set(SISTEMAS_NOTAVEIS);
  for (const s of C.sistemas.filter((x) => notaveis.has(x.nome)).slice(0, CELULAR ? 10 : 20)) rotulo(s.nome, s.p, { prioridade: 12, de: 0.004, ate: Math.max(0.12, s.distKpc * 12), classe: 'exo', alvo: s });
  C.pronto = true;
  return C;
}

/** Liga os pontos conforme as camadas e o zoom (distância da câmera em kpc). */
export function atualizarCatalogos(zoom, F) {
  if (!C.pronto) return;
  if (C.pontos.aglomerados) C.pontos.aglomerados.visible = F.aglomeradosEstelares && zoom > 0.02 && zoom < 90;
  if (C.pontos.pulsares) C.pontos.pulsares.visible = F.pulsares && zoom > 0.05 && zoom < 160;
  if (C.pontos.sistemas) C.pontos.sistemas.visible = F.exoplanetas && zoom > 0.003 && zoom < 40;
}

/** Itens tocáveis agora. */
export function candidatos(F, zoom) {
  if (!C.pronto) return [];
  return [...(C.pontos.aglomerados?.visible ? C.aglomerados : []), ...(C.pontos.pulsares?.visible ? C.pulsares : []), ...(C.pontos.sistemas?.visible && zoom < 8 ? C.sistemas : [])];
}

const idadeTexto = (anos) => (anos >= 1e9 ? `${num(anos / 1e9, 1)} bilhões de anos` : anos >= 1e6 ? `${num(anos / 1e6, 0)} milhões de anos` : `${num(anos / 1e3, 0)} mil anos`);

function textoPlaneta([nome, raio, massa, periodo, semieixo, temp, ano, metodo]) {
  const tamanho = raio != null ? `${num(raio, raio < 10 ? 1 : 0)}× o raio da Terra` : massa != null ? `${num(massa, massa < 10 ? 1 : 0)}× a massa da Terra` : null;
  const orbita = periodo != null ? `ano de ${periodo < 10 ? num(periodo, 1) : num(periodo, 0)} dias` : semieixo != null ? `a ${num(semieixo, 2)} UA da estrela` : null;
  return [nome, [tamanho, orbita, temp != null ? `${num(temp - 273.15, 0)} °C` : null, ano ? `${ano}${METODOS[metodo] ? `, ${METODOS[metodo]}` : ''}` : null].filter(Boolean).join(' · ')];
}

/**
 * Cartão de um item destes catálogos; devolve false se o item não é daqui.
 * @param {object} it item tocado
 * @param {object} G estado do globo (mostrarPainel)
 * @param {() => object} ir botão "Ir até"
 * @param {(kpc: number) => string} distancia texto da distância em anos-luz
 */
export function cartao(it, G, ir, distancia) {
  if (it.tipo === 'aglomerado-estelar') {
    const idade = it.logIdade != null ? `nascidas juntas há ${idadeTexto(10 ** it.logIdade)}` : 'nascidas juntas';
    G.mostrarPainel(it.nome, `${it.movel ? 'Grupo de estrelas em movimento conjunto' : 'Aglomerado aberto'}: ${num(it.estrelas)} estrelas identificadas pelo Gaia, ${idade}, a ${distancia(it.distKpc)} do Sol.`,
      [it.r50 ? `Metade das estrelas dentro de ${num(it.r50 * 3.2616, 1)} anos-luz do centro` : null, it.popular ? it.catalogo : null].filter(Boolean).join(' · '),
      'Hunt & Reffert 2023 (Gaia DR3)', [ir()]);
  } else if (it.tipo === 'pulsar') {
    const giro = it.periodo ? (it.periodo < 1 ? `gira ${num(1 / it.periodo, it.periodo > 0.1 ? 1 : 0)} vezes por segundo` : `dá uma volta a cada ${num(it.periodo, 2)} s`) : null;
    G.mostrarPainel(it.nome, `${it.historia || 'Pulsar: uma estrela de nêutrons que varre a Terra com um feixe de rádio a cada volta.'} Fica a cerca de ${distancia(it.distKpc)} do Sol.`,
      [giro, it.binario ? 'tem uma companheira' : null, it.idade ? `idade característica de ${idadeTexto(it.idade)}` : null, it.assoc ? `em ${it.assoc}` : null, it.historia ? `PSR ${it.catalogo}` : null].filter(Boolean).join(' · ')
        .replace(/^./, (c) => c.toUpperCase()),
      `Catálogo ATNF (Manchester et al. 2005) · distância ${it.dm != null ? 'estimada pela dispersão do sinal' : 'do catálogo'}`, [ir()]);
  } else if (it.tipo === 'sistema-planetario') {
    const n = it.planetas.length;
    const linhas = it.planetas.slice(0, 8).map(textoPlaneta).map(([nome, resto]) => `${nome}: ${resto || 'sem medidas publicadas'}`);
    G.mostrarPainel(it.nome, `Estrela com ${n === 1 ? '1 planeta confirmado' : `${n} planetas confirmados`}, a ${distancia(it.distKpc)} do Sol${it.temp ? `, com ${num(it.temp, 0)} K na superfície` : ''}.`,
      linhas.join('\n') + (n > 8 ? `\n… e mais ${n - 8}` : ''), 'NASA Exoplanet Archive', [ir()]);
  } else return false;
  return true;
}

/** Quantos itens há em cada catálogo (para o painel de camadas). */
export function contagens() {
  return { aglomerados: C.aglomerados.length, pulsares: C.pulsares.length, sistemas: C.sistemas.length, planetas: C.sistemas.reduce((s, x) => s + x.planetas.length, 0) };
}

export function notasFontes() {
  return C.pronto ? ['Aglomerados estelares: Hunt & Reffert 2023 (Gaia DR3)', 'Pulsares: catálogo ATNF (Manchester et al. 2005)', 'Exoplanetas: NASA Exoplanet Archive'] : [];
}
