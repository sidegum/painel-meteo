// Textos do céu na aba Globo: o bloco "Céu de hoje" (acima do globo) e os cartões de Sol, Lua, planetas e satélites
// que abrem ao tocar neles. Todo número vem de ceu.js (Astronomy Engine e SGP4); este módulo só escreve.
// Regra de texto do painel: o que aparece sem tocar é simples; o detalhe técnico fica em "Ver detalhes".
import { el, fmt, mostrarInfo } from './ui.js';
import { consensoHorario, MODELOS, valido } from './analise.js';
import { CIDADES } from './globo-cidades.js';
import * as C from './ceu.js';
import { MISSOES, estadoSonda, interpolar } from './globo-sondas.js';
import * as CORPOS_EXTRA from './globo-corpos.js';
import * as A from '../vendor/astronomy/astronomy.min.js';
import { TIPOS_OBJETO } from './globo-estrelas.js';

/** Número em pt-BR com separador de milhar a partir de 10.000 (regra do CLDR para o português). */
const num = (v, casas = 0) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : null);

const RAD = Math.PI / 180;
const UA_KM = CORPOS_EXTRA.UA_KM;

/** Local do observador: o do app ou Campo Bom (padrão do painel). */
export function localDoObservador(estadoApp) {
  const l = estadoApp?.localExato || estadoApp?.local;
  return { lat: l?.lat ?? -29.67, lon: l?.lon ?? -51.06, altitudeM: 0, nome: estadoApp?.local?.nome || 'Campo Bom' };
}

/** Deslocamento do fuso do local em segundos (o da previsão; sem ela, o do aparelho). */
export const fusoS = (estadoApp) => estadoApp?.prev?.offset ?? -new Date().getTimezoneOffset() * 60;

const hora = (ms, off) => C.horaLocal(ms, off);
const diaHora = (ms, off, agora = Date.now()) => {
  const dias = Math.round((Math.floor((ms + off * 1000) / 86400000) - Math.floor((agora + off * 1000) / 86400000)));
  const quando = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `${fmt.diaSemana(ms, off)} ${fmt.dataCurta(ms, off)}`;
  return `${quando} às ${hora(ms, off)}`;
};
const km = (v) => (v >= 1e9 ? `${num(v / 1e9, 1)} ${v < 2e9 ? 'bilhão' : 'bilhões'} de km` : v >= 1e6 ? `${num(v / 1e6, v >= 1e8 ? 0 : 1)} ${v < 2e6 ? 'milhão' : 'milhões'} de km` : v >= 1e4 ? `${num(v / 1000, 0)} mil km` : `${num(v, 0)} km`);
const tempoLuz = (kmDist) => { const s = kmDist / 299792.458; return s < 90 ? `${num(s, 1)} s` : s < 5400 ? `${num(s / 60, s < 600 ? 1 : 0)} min` : `${num(s / 3600, 1)} h`; };
const latLon = (lat, lon) => `${num(Math.abs(lat), 1)}°${lat < 0 ? 'S' : 'N'} ${num(Math.abs(lon), 1)}°${lon < 0 ? 'O' : 'L'}`;
const linha = (k, v) => el('tr', {}, el('th', { text: k }), el('td', { text: v ?? 'sem dado' }));

// ------------------------------------------------------------------ nuvens previstas (mesma fonte do painel)

/**
 * Cobertura de nuvens prevista para um instante, pela mediana dos modelos ativos (a mesma que a aba Hoje usa).
 * @returns {(ms:number)=>number|null}
 */
export function nuvensPrevistas(estadoApp) {
  const p = estadoApp?.prev;
  if (!p?.horas?.length) return () => null;
  const mods = Object.keys(MODELOS).filter((m) => p.modelos?.[m]);
  const med = consensoHorario(p, 'cloud_cover', mods).med;
  return (ms) => { const i = p.horas.findIndex((h) => ms >= h && ms < h + 3600000); return i < 0 || !valido(med[i]) ? null : med[i]; };
}

// ------------------------------------------------------------------ cartões de astros

/**
 * Cartão de Sol, Lua ou planeta visto do local do usuário.
 * @param {string} corpo nome do Astronomy Engine (Sun, Moon, Mercury...)
 * @returns {{titulo:string, frase:string, numeros:string, fonte:string, detalhes:()=>void}}
 */
export function cartaoAstro(corpo, estadoApp, t = Date.now()) {
  const local = localDoObservador(estadoApp), off = fusoS(estadoApp);
  const obs = C.observador(local.lat, local.lon, 0);
  const i = C.infoAstro(corpo, obs, t);
  const acima = i.altura > (corpo === 'Moon' ? 0 : -0.8);
  const ondeAgora = acima ? `${C.alturaTexto(i.altura)} para o ${C.rumo(i.azimute)} (${Math.round(i.altura)}°)` : 'abaixo do horizonte';
  const nascePoe = [i.nasce && `nasce ${hora(i.nasce, off)}`, i.poe && `se põe ${hora(i.poe, off)}`].filter(Boolean).sort((a, b) => (a.includes('nasce') ? (i.nasce > i.poe ? 1 : -1) : (i.poe > i.nasce ? 1 : -1))).join(' · ');
  const fonte = `Astronomy Engine · ${hora(t, off)} · visto de ${local.nome}`;
  let frase, numeros;
  const linhas = [];

  if (corpo === 'Sun') {
    const s = C.solDoDia(obs, t - ((t + off * 1000) % 86400000));
    const ss = C.pontoSob('Sun', t);
    frase = acima ? `O Sol está ${ondeAgora}.` : C.alturaSol(obs, t) > -6 ? 'O Sol acabou de se pôr ou está para nascer: crepúsculo.' : 'É noite aqui: o Sol está abaixo do horizonte.';
    numeros = `Nasce ${hora(s.nasce, off)} · se põe ${hora(s.poe, off)}`;
    linhas.push(linha('Agora', acima ? `${num(i.altura, 1)}° de altura, azimute ${num(i.azimute, 0)}° (${C.rumo(i.azimute)})` : `${num(i.altura, 1)}° (abaixo do horizonte)`),
      linha('Nascer e pôr', `${hora(s.nasce, off)} e ${hora(s.poe, off)} (duração do dia ${num((s.poe - s.nasce) / 3600000, 1)} h)`),
      linha('Ponto mais alto', i.culmina ? `${hora(i.culmina.ms, off)}, a ${num(i.culmina.altura, 1)}°` : null),
      linha('Céu escuro (Sol a −6°)', s.escurece ? `a partir das ${hora(s.escurece, off)} até ${s.clareia ? hora(s.clareia, off) : '–'} da manhã` : null),
      linha('A pino agora em', latLon(ss.lat, ss.lon)),
      linha('Distância', `${km(i.distKm)} (${num(i.distUa, 4)} UA); a luz leva ${tempoLuz(i.distKm)}`),
      linha('Tamanho no céu', `${num(i.diametroAparente, 1)}′ de diâmetro`), linha('Constelação', i.constelacao),
      linha('Diâmetro real', `${num(C.CORPOS.Sun.diametroKm)} km (109 Terras)`));
  } else if (corpo === 'Moon') {
    const f = i.fase;
    frase = `Lua ${f.nome}, ${num(f.fracao * 100)}% iluminada. ${acima ? `No céu agora, ${ondeAgora}.` : 'Abaixo do horizonte agora.'}`;
    numeros = `${km(i.distKm)} da Terra · ${nascePoe}`;
    const fases = C.proximasFases(t).map((x) => `${x.nome} ${fmt.dataCurta(x.ms, off)} ${hora(x.ms, off)}`).join('; ');
    const ecl = C.proximosEventos(obs, t, 0).find((e) => e.tipo === 'eclipse' && /lunar/i.test(e.titulo));
    linhas.push(linha('Agora', `${num(i.altura, 1)}° de altura, azimute ${num(i.azimute, 0)}° (${C.rumo(i.azimute)})`),
      linha('Fase', `${f.nome} (${num(f.angulo, 0)}° de idade de fase), ${num(f.fracao * 100, 1)}% iluminada`),
      linha('Nasce e se põe', nascePoe), linha('Ponto mais alto', i.culmina ? `${hora(i.culmina.ms, off)}, a ${num(i.culmina.altura, 1)}°` : null),
      linha('Distância', `${num(i.distKm, 0)} km; a luz leva ${tempoLuz(i.distKm)}`), linha('Tamanho no céu', `${num(i.diametroAparente, 1)}′`),
      linha('Brilho', `magnitude ${num(i.mag, 1)}`), linha('Constelação', i.constelacao), linha('Próximas fases', fases),
      linha('Próximo eclipse lunar visível daqui', ecl ? `${fmt.dataCurta(ecl.ms, off)}/${new Date(ecl.ms + off * 1000).getUTCFullYear()} ${hora(ecl.ms, off)}: ${ecl.titulo}` : 'nenhum nos próximos 3 anos'),
      linha('Diâmetro real', `${num(C.CORPOS.Moon.diametroKm)} km`), linha('Rotação', C.CORPOS.Moon.rotacao));
  } else {
    const j = C.janelaVisivel(corpo, obs, C.janelaDaNoite(obs, t));
    const longe = i.afastamentoSol < C.VIS.afastamentoSolMin;
    frase = j ? `Visível a olho nu ${j.inicio <= t + 300000 ? 'agora' : `a partir das ${hora(j.inicio, off)}`} até ${hora(j.fim, off)}, para o ${C.rumo(j.melhor.azimute)}. ${C.brilhoTexto(j.mag).replace(/^./, (c) => c.toUpperCase())}.`
      : longe ? 'Não dá para ver hoje: está perto demais do Sol no céu.' : i.mag > C.VIS.magMaxPlaneta ? 'Fraco demais para ver a olho nu; precisa de binóculo ou telescópio.' : 'Não fica acima do horizonte com o céu escuro esta noite.';
    numeros = `${km(i.distKm)} da Terra · a luz leva ${tempoLuz(i.distKm)}`;
    const dados = C.CORPOS[corpo];
    linhas.push(linha('Agora', `${num(i.altura, 1)}° de altura, azimute ${num(i.azimute, 0)}° (${C.rumo(i.azimute)})`),
      linha('Nasce e se põe', nascePoe), linha('Ponto mais alto', i.culmina ? `${hora(i.culmina.ms, off)}, a ${num(i.culmina.altura, 1)}°` : null),
      linha('Brilho', `magnitude ${num(i.mag, 1)} (quanto menor, mais brilhante; a olho nu até ~5,5)`),
      linha('Parte iluminada vista daqui', `${num(i.fracao * 100, 0)}%`), linha('Afastamento do Sol no céu', `${num(i.afastamentoSol, 1)}°`),
      linha('Distância da Terra', `${km(i.distKm)} (${num(i.distUa, 3)} UA)`), linha('Distância do Sol', `${num(i.distSolUa, 3)} UA (${km(i.distSolUa * UA_KM)})`),
      linha('Tamanho no céu', `${num(i.diametroAparente * 60, 1)}″`), linha('Constelação', i.constelacao),
      linha('Diâmetro real', `${num(dados.diametroKm)} km (${num(dados.diametroKm / 12742, 2)} Terras)`), linha('Um dia lá', dados.rotacao), linha('Um ano lá', dados.ano));
  }
  const titulo = C.CORPOS[corpo].nome;
  return {
    titulo, frase, numeros, fonte,
    detalhes: () => mostrarInfo(titulo, el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)),
      el('p', { class: 'nota', text: `Posições do Astronomy Engine 2.1.19 (validado contra o JPL Horizons, erro menor que 1′), vistas de ${local.nome} (${latLon(local.lat, local.lon)}), com refração atmosférica. Horários no fuso do local.` })),
  };
}

// ------------------------------------------------------------------ estrelas

const GREGAS = { Alp: ['α', 'alfa'], Bet: ['β', 'beta'], Gam: ['γ', 'gama'], Del: ['δ', 'delta'], Eps: ['ε', 'épsilon'], Zet: ['ζ', 'zeta'],
  Eta: ['η', 'eta'], The: ['θ', 'teta'], Iot: ['ι', 'iota'], Kap: ['κ', 'capa'], Lam: ['λ', 'lambda'], Mu: ['μ', 'mi'], Nu: ['ν', 'ni'],
  Xi: ['ξ', 'csi'], Omi: ['ο', 'ômicron'], Pi: ['π', 'pi'], Rho: ['ρ', 'rô'], Sig: ['σ', 'sigma'], Tau: ['τ', 'tau'], Ups: ['υ', 'ípsilon'],
  Phi: ['φ', 'fi'], Chi: ['χ', 'qui'], Psi: ['ψ', 'psi'], Ome: ['ω', 'ômega'] };
const SOBRESCRITO = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const ANO_LUZ_PC = 3.26156;

/** Designação de Bayer (α¹ Centauri), senão de Flamsteed (61 Cygni), senão HIP ou HD. */
export function designacaoEstrela(e, genitivo) {
  const gen = genitivo || e.sigla;
  if (e.bayer) {
    const [letra, indice] = e.bayer.split('-');
    const g = GREGAS[letra];
    if (g) return `${g[0]}${indice ? [...indice].map((c) => SOBRESCRITO[+c] || c).join('') : ''} ${gen}`;
  }
  if (e.flamsteed) return `${e.flamsteed} ${gen}`;
  return e.hip ? `HIP ${e.hip}` : e.hd ? `HD ${e.hd}` : 'estrela sem designação';
}

/** Tipo espectral em palavras: classe (cor e temperatura típica) e classe de luminosidade (anã, gigante...). */
export function tipoEspectral(esp) {
  const s = String(esp || '').trim();
  if (!s) return null;
  if (/^D/.test(s)) return { curto: 'anã branca', longo: 'anã branca (núcleo exposto de uma estrela que já morreu)' };
  const classes = { O: ['azul', 'azul', 'acima de 30.000 K'], B: ['branco-azulada', 'branco-azulada', '10.000 a 30.000 K'],
    A: ['branca', 'branca', '7.500 a 10.000 K'], F: ['branco-amarelada', 'branco-amarelada', '6.000 a 7.500 K'],
    G: ['amarela', 'amarela, como o Sol', '5.200 a 6.000 K'], K: ['laranja', 'laranja', '3.700 a 5.200 K'], M: ['vermelha', 'vermelha', '2.400 a 3.700 K'],
    C: ['vermelha', 'vermelha, rica em carbono', 'abaixo de 3.500 K'], S: ['vermelha', 'vermelha, rica em zircônio', 'abaixo de 3.500 K'],
    W: ['azul', 'azul, do tipo Wolf-Rayet', 'acima de 30.000 K'] };
  const c = classes[s[0]];
  const lum = /^[\d.\-/]*\s*(Ia\+|Iab|Ia|Ib|III|II|IV|VI|V|I)/.exec(s.slice(1))?.[1];
  const [base, papel] = ({ 'Ia+': ['hipergigante', 'hipergigante, das estrelas mais luminosas que existem'], Ia: ['supergigante', 'supergigante muito luminosa'],
    Iab: ['supergigante', 'supergigante'], Ib: ['supergigante', 'supergigante'], I: ['supergigante', 'supergigante'], II: ['gigante luminosa', 'gigante luminosa'],
    III: ['gigante', 'gigante (já saiu da fase em que queima hidrogênio no núcleo)'], IV: ['subgigante', 'subgigante (começando a crescer)'],
    V: ['estrela', 'anã da sequência principal: estrela comum que queima hidrogênio no núcleo, como o Sol'], VI: ['subanã', 'subanã'] })[lum] || ['estrela', null];
  return {
    curto: c ? `${base} ${c[0]}` : base,
    longo: `${s}: ${c ? `classe ${s[0]} (${c[1]}, superfície de ${c[2]})` : 'classe especial'}${papel ? `; ${papel}` : ''}`,
  };
}

const anosLuz = (pc) => pc * ANO_LUZ_PC;
const distanciaTexto = (pc) => { const al = anosLuz(pc); return al < 100 ? `${num(al, 1)} anos-luz` : `${num(al < 1000 ? Math.round(al) : Math.round(al / 10) * 10)} anos-luz`; };

/**
 * Cartão de uma estrela do catálogo, vista do local do usuário.
 * @param {object} e estrela de globo-estrelas.js
 * @param {{nome:string, genitivo:string}} constelacao nomes latinos da constelação
 */
export function cartaoEstrela(e, constelacao, estadoApp, t = Date.now()) {
  const local = localDoObservador(estadoApp), off = fusoS(estadoApp);
  const obs = C.observador(local.lat, local.lon, 0);
  const i = C.infoEstrela(e.ra, e.dec, obs, t);
  const designacao = designacaoEstrela(e, constelacao?.genitivo);
  const titulo = e.nome || designacao;
  const nomeConst = C.CONSTELACOES[e.sigla] || constelacao?.nome || e.sigla;
  const tipo = tipoEspectral(e.espectro);
  const acima = i.altura > 0;
  const quem = [tipo ? `${tipo.curto[0].toUpperCase()}${tipo.curto.slice(1)}` : 'Estrela', Number.isFinite(e.distPc) ? `a ${distanciaTexto(e.distPc)}` : null].filter(Boolean).join(' ');
  let onde = acima ? `agora ${C.alturaTexto(i.altura)} para o ${C.rumo(i.azimute)} (${Math.round(i.altura)}°)`
    : i.sempre === 'abaixo' ? 'daqui ela nunca aparece' : `agora abaixo do horizonte${i.nasce ? `; nasce às ${hora(i.nasce, off)}` : ''}`;
  if (i.sempre === 'acima') onde += '; daqui ela nunca se põe';
  const frase = `${quem}; ${onde}.`;
  const numeros = `Constelação de ${nomeConst} · magnitude ${num(e.mag, 1)}`;
  const fonte = `HYG/Hipparcos · ${hora(t, off)} · visto de ${local.nome}`;
  const T = Number.isFinite(e.bv) ? C.temperaturaCor(e.bv) : null;
  const outras = [e.nome ? designacao : null, e.flamsteed && e.bayer ? `${e.flamsteed} ${constelacao?.genitivo || e.sigla}` : null, e.hip ? `HIP ${e.hip}` : null, e.hd ? `HD ${e.hd}` : null].filter(Boolean);
  const letraLonga = e.bayer ? GREGAS[e.bayer.split('-')[0]]?.[1] : null;
  const linhas = [
    linha('Designações', `${outras.join(' · ') || designacao}${letraLonga ? ` (${letraLonga})` : ''}`),
    linha('Constelação', `${nomeConst} (${constelacao?.nome || e.sigla})`),
    linha('Brilho aparente', `magnitude ${num(e.mag, 2)}: ${C.brilhoTexto(e.mag)}`),
    linha('Distância', Number.isFinite(e.distPc) ? `${distanciaTexto(e.distPc)} (${num(e.distPc, e.distPc < 100 ? 2 : 0)} parsecs); a luz que você vê saiu dela há ${num(Math.round(anosLuz(e.distPc)))} anos` : 'sem paralaxe confiável no catálogo'),
    linha('Brilho real', Number.isFinite(e.magAbs) ? `magnitude absoluta ${num(e.magAbs, 2)}${Number.isFinite(e.lum) ? `; ${e.lum >= 1 ? `${num(e.lum, e.lum < 10 ? 1 : 0)} vezes a` : `${num(e.lum, 3)} da`} luminosidade do Sol (no visível)` : ''}` : null),
    linha('Tipo', tipo ? tipo.longo : null),
    linha('Cor e temperatura', T ? `${corEstrela(T)}; superfície a cerca de ${num(Math.round(T / 100) * 100)} K (pelo índice de cor B−V ${num(e.bv, 2)})` : null),
    linha('Variável', e.variavel ? 'sim: o brilho dela muda com o tempo' : 'não consta como variável'),
    linha('Agora', `${num(i.altura, 1)}° de altura, azimute ${num(i.azimute, 0)}° (${C.rumo(i.azimute)})`),
    linha('Nasce e se põe', i.sempre === 'acima' ? 'nunca se põe neste local' : i.sempre === 'abaixo' ? 'nunca nasce neste local' : [i.nasce && `nasce ${diaHora(i.nasce, off, t)}`, i.poe && `se põe ${diaHora(i.poe, off, t)}`].filter(Boolean).join('; ')),
    linha('Ponto mais alto', i.culmina.altura > 0 ? `${diaHora(i.culmina.ms, off, t)}, a ${num(i.culmina.altura, 1)}° de altura` : null),
    linha('Coordenadas', `ascensão reta ${horasMin(e.ra)}, declinação ${e.dec >= 0 ? '+' : '−'}${num(Math.abs(e.dec), 2)}° (equinócio J2000, época 2026)`),
  ];
  return {
    titulo, frase, numeros, fonte,
    detalhes: () => mostrarInfo(titulo, el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)),
      el('p', { class: 'nota', text: `Catálogo HYG v4.1 (Hipparcos, Yale Bright Star e Gliese), com movimento próprio até 2026; posição de agora com precessão, nutação, aberração e refração pelo Astronomy Engine 2.1.19, vista de ${local.nome}. Horários no fuso do local.` })),
  };
}

/** Distância em anos-luz por extenso (milhões a partir de 1 milhão). */
const anosLuzTexto = (al) => (al >= 1e6 ? `${num(al / 1e6, al < 1e7 ? 2 : 1)} milhões de anos-luz` : `${num(al)} anos-luz`);

/** Cartão de um objeto de céu profundo (Messier e famosos do sul), visto do local do usuário. */
export function cartaoObjeto(ob, estadoApp, t = Date.now()) {
  const local = localDoObservador(estadoApp), off = fusoS(estadoApp);
  const i = C.infoEstrela(ob.ra, ob.dec, C.observador(local.lat, local.lon, 0), t);
  const tipo = TIPOS_OBJETO[ob.tipo]?.[0] || 'Objeto de céu profundo';
  const sigla = A.Constellation(ob.ra / 15, ob.dec).symbol;
  const titulo = ob.nome || ob.id.replace(/^M(\d)/, 'M $1');
  const dims = String(ob.dim || '').split('x').map(Number).filter(Number.isFinite);
  const tamanho = dims.length ? `${dims.map((x) => num(x, x < 10 ? 1 : 0)).join(' × ')} minutos de arco${dims[0] >= 31 ? ` (${num(dims[0] / 31, 1)} vezes a Lua cheia)` : ''}` : null;
  const acima = i.altura > 0;
  const onde = acima ? `agora ${C.alturaTexto(i.altura)} para o ${C.rumo(i.azimute)} (${Math.round(i.altura)}°)`
    : i.sempre === 'abaixo' ? 'daqui nunca aparece' : `agora abaixo do horizonte${i.nasce ? `; nasce às ${hora(i.nasce, off)}` : ''}`;
  const olhoNu = Number.isFinite(ob.mag) && ob.mag <= 5 ? 'visível a olho nu em céu escuro' : Number.isFinite(ob.mag) && ob.mag <= 9 ? 'visível com binóculo' : 'visível com telescópio';
  const linhas = [
    linha('Tipo', tipo),
    linha('Catálogo', [ob.id.startsWith('M') ? ob.id.replace(/^M/, 'Messier ') : null, ob.designacao].filter(Boolean).join(' · ')),
    linha('Constelação', `${C.CONSTELACOES[sigla] || sigla}`),
    linha('Brilho', Number.isFinite(ob.mag) ? `magnitude ${num(ob.mag, 1)}: ${olhoNu}` : null),
    linha('Tamanho no céu', tamanho),
    linha('Distância', ob.distAnosLuz ? `cerca de ${anosLuzTexto(ob.distAnosLuz)}; a luz que você vê saiu de lá há ${anosLuzTexto(ob.distAnosLuz).replace(' de anos-luz', ' de anos').replace(' anos-luz', ' anos')}` : 'sem distância nesta ficha'),
    linha('Agora', `${num(i.altura, 1)}° de altura, azimute ${num(i.azimute, 0)}° (${C.rumo(i.azimute)})`),
    linha('Nasce e se põe', i.sempre === 'acima' ? 'nunca se põe neste local' : i.sempre === 'abaixo' ? 'nunca nasce neste local' : [i.nasce && `nasce ${diaHora(i.nasce, off, t)}`, i.poe && `se põe ${diaHora(i.poe, off, t)}`].filter(Boolean).join('; ')),
    linha('Ponto mais alto', i.culmina.altura > 0 ? `${diaHora(i.culmina.ms, off, t)}, a ${num(i.culmina.altura, 1)}° de altura` : null),
    linha('Coordenadas', `ascensão reta ${horasMin(ob.ra)}, declinação ${ob.dec >= 0 ? '+' : '−'}${num(Math.abs(ob.dec), 2)}° (J2000)`),
  ];
  return {
    titulo,
    frase: `${tipo}${ob.distAnosLuz ? ` a ${anosLuzTexto(ob.distAnosLuz)}` : ''}; ${onde}.`,
    numeros: `Constelação de ${C.CONSTELACOES[sigla] || sigla}${Number.isFinite(ob.mag) ? ` · magnitude ${num(ob.mag, 1)}` : ''}`,
    fonte: `Catálogo de Messier · ${hora(t, off)} · visto de ${local.nome}`,
    detalhes: () => mostrarInfo(titulo, el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)),
      el('p', { class: 'nota', text: `Posição e tamanho do catálogo de Messier (via d3-celestial) e de catálogos NGC/IC; distâncias publicadas, arredondadas. No mapa 3D os objetos de céu profundo ficam no fundo do céu. Horários no fuso do local, vistos de ${local.nome}.` })),
  };
}

const corEstrela = (T) => (T >= 10000 ? 'branco-azulada' : T >= 7300 ? 'branca' : T >= 6000 ? 'branco-amarelada' : T >= 5000 ? 'amarelada' : T >= 3900 ? 'alaranjada' : 'avermelhada');
const horasMin = (raGraus) => { const h = raGraus / 15, m = (h % 1) * 60; return `${Math.floor(h)}h ${num(m, 1)}min`; };

// ------------------------------------------------------------------ satélites: identificação

/** Operador e função por padrões de nome do CelesTrak (a fonte não informa o dono; sem padrão, fica "não informado"). */
const FICHAS = [
  [/^ISS \(ZARYA\)/, 'Estação Espacial Internacional (ISS)', 'NASA, Roscosmos, ESA, JAXA e CSA', 'Laboratório tripulado'],
  [/^ISS \(/, 'Módulo da ISS', 'NASA, Roscosmos, ESA, JAXA e CSA', 'Parte da Estação Espacial Internacional'],
  [/^POISK/, 'Módulo Poisk da ISS', 'Roscosmos', 'Parte da Estação Espacial Internacional'],
  [/^CSS \(TIANHE\)/, 'Estação espacial chinesa Tiangong', 'CMSA (agência espacial tripulada da China)', 'Laboratório tripulado'],
  [/^CSS \(/, 'Módulo da Tiangong', 'CMSA (China)', 'Parte da estação Tiangong'],
  [/^(SHENZHOU|SZ-)/, 'Nave Shenzhou', 'CMSA (China)', 'Nave tripulada'],
  [/^TIANZHOU/, 'Cargueiro Tianzhou', 'CMSA (China)', 'Carga para a Tiangong'],
  [/^SOYUZ/, 'Nave Soyuz', 'Roscosmos (Rússia)', 'Nave tripulada'],
  [/^PROGRESS/, 'Cargueiro Progress', 'Roscosmos (Rússia)', 'Carga para a ISS'],
  [/^CREW DRAGON/, 'Nave Crew Dragon', 'SpaceX para a NASA', 'Nave tripulada'],
  [/^DRAGON/, 'Cargueiro Dragon', 'SpaceX para a NASA', 'Carga para a ISS'],
  [/^CYGNUS/, 'Cargueiro Cygnus', 'Northrop Grumman para a NASA', 'Carga para a ISS'],
  [/^HST$/, 'Telescópio Espacial Hubble', 'NASA e ESA', 'Telescópio'],
  [/^(EWS-G\d \()?GOES/, null, 'NOAA (EUA)', 'Meteorológico geoestacionário (imagens das Américas)'],
  [/^NOAA \d+|SUOMI NPP|JPSS/, null, 'NOAA e NASA (EUA)', 'Meteorológico de órbita polar'],
  [/^(METEOSAT|MTG|MSG)/, null, 'EUMETSAT (Europa)', 'Meteorológico geoestacionário (Europa e África)'],
  [/^METOP/, null, 'EUMETSAT (Europa)', 'Meteorológico de órbita polar'],
  [/^HIMAWARI/, null, 'JMA (Japão)', 'Meteorológico geoestacionário (Ásia e Oceania)'],
  [/^FENGYUN [24]/, null, 'CMA (China)', 'Meteorológico geoestacionário'],
  [/^FENGYUN 3/, null, 'CMA (China)', 'Meteorológico de órbita polar'],
  [/^(METEOR-M|ELEKTRO|ARKTIKA)/, null, 'Roscosmos e Roshydromet (Rússia)', 'Meteorológico'],
  [/^DMSP/, null, 'Força Espacial dos EUA', 'Meteorológico militar'],
  [/^WSF-M/, null, 'Força Espacial dos EUA', 'Meteorológico militar'],
  [/^(GEO-KOMPSAT|COMS)/, null, 'KMA (Coreia do Sul)', 'Meteorológico geoestacionário'],
  [/^INSAT/, null, 'ISRO (Índia)', 'Meteorológico geoestacionário'],
  [/^SENTINEL-3/, null, 'ESA e EUMETSAT (Copernicus)', 'Oceanos e superfície'],
  [/^CYGFM/, 'CYGNSS', 'NASA', 'Vento sobre os oceanos (furacões)'],
  [/^TIANMU/, null, 'Empresa chinesa (Tianmu)', 'Sondagem da atmosfera por GPS'],
  [/^GPS /, null, 'Força Espacial dos EUA', 'Navegação (GPS)'],
  [/R\/B/, null, 'Não informado pela fonte', 'Estágio de foguete abandonado (não funciona)'],
  [/DEB/, null, 'Não informado pela fonte', 'Destroço'],
  [/^(TERRA|AQUA)$/, null, 'NASA', 'Observação da Terra'],
  [/^SPACEMOBILE/, null, 'AST SpaceMobile (EUA)', 'Internet celular por satélite'],
];

/** Nome amigável, operador e função de um objeto do CelesTrak. */
export function fichaSatelite(nomeOriginal) {
  const n = String(nomeOriginal || '').trim();
  for (const [re, nome, operador, funcao] of FICHAS) if (re.test(n)) return { nome: nome || n, operador, funcao, original: n };
  return { nome: n, operador: 'Não informado pela fonte', funcao: null, original: n };
}

/** Cidade conhecida mais próxima do ponto (até 900 km), para dizer "perto de ..." em vez de coordenadas. */
function lugar(lat, lon) {
  let melhor = null;
  for (const c of CIDADES) {
    const d = 6371 * Math.acos(Math.min(1, Math.sin(lat * RAD) * Math.sin(c.lat * RAD) + Math.cos(lat * RAD) * Math.cos(c.lat * RAD) * Math.cos((lon - c.lon) * RAD)));
    if (!melhor || d < melhor.d) melhor = { d, n: c.n };
  }
  return melhor && melhor.d <= 900 ? (melhor.d < 60 ? `sobre ${melhor.n}` : `a ${num(Math.round(melhor.d / 10) * 10)} km de ${melhor.n}`) : `sobre ${latLon(lat, lon)}`;
}

/** Visível a olho nu? Estações e o grupo "mais brilhantes" sim; o resto em geral não. */
export const olhoNu = (s) => s.grupo === 'brilhantes' || /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST$)/.test(s.nome);

/**
 * Cartão de um satélite: onde está, quão alto e rápido, e a próxima passagem visível daqui.
 * @param {{nome:string, rec:object, omm:object, grupo:string, acopladoA?:string}} s
 */
export function cartaoSatelite(s, estadoApp, geradoMs, t = Date.now()) {
  const local = localDoObservador(estadoApp), off = fusoS(estadoApp);
  const f = fichaSatelite(s.nome);
  const e = C.estadoSatelite(s.rec, local, t);
  if (!e) return { titulo: f.nome, frase: 'Sem posição calculável agora (elementos orbitais inválidos ou objeto reentrou na atmosfera).', numeros: '', fonte: 'CelesTrak' };
  const tipo = C.tipoOrbita(s.rec);
  const periodoMin = 2 * Math.PI / s.rec.no;
  const idade = C.idadeElementosDias(s.omm, t);
  const frase = `Agora ${lugar(e.lat, e.lon)}, a ${num(Math.round(e.alturaKm))} km de altura e ${num(Math.round(e.velKmh / 100) * 100)} km/h.${s.acopladoA ? ` Está acoplado à ${s.acopladoA}.` : ''}`;
  let numeros, passagem = null, proximas = [];
  if (tipo === 'geoestacionaria') numeros = e.elevacao > 0 ? `Parado no céu daqui: ${num(Math.round(e.elevacao))}° de altura, para o ${C.rumo(e.azimute)}. Não se vê a olho nu.` : 'Fica sempre abaixo do horizonte daqui.';
  else {
    proximas = C.passagens(s.rec, local, t, t + 2 * 86400000, { maximo: 6 });
    if (olhoNu(s) && idade !== null && idade <= C.VIS.idadeMaxElementosDias) {
      passagem = proximas.find((p) => p.visivel) || C.proximaPassagemVisivel(s.rec, local, t + 2 * 86400000, 3);
      numeros = passagem ? `Próxima passagem visível daqui: ${diaHora(passagem.visivel.inicio, off, t)}, do ${C.rumo(passagem.visivel.azInicio)} para o ${C.rumo(passagem.visivel.azFim)}, até ${num(Math.round(passagem.visivel.max.elevacao))}° de altura.`
        : 'Sem passagem visível daqui nos próximos 5 dias (passa de dia ou na sombra da Terra).';
    } else numeros = e.elevacao > 0 ? `Acima do seu horizonte agora (${num(Math.round(e.elevacao))}°), mas não se vê a olho nu.` : proximas[0] ? `Próxima passagem sobre você: ${diaHora(proximas[0].inicio, off, t)} (não se vê a olho nu).` : 'Não passa sobre você nos próximos 2 dias.';
  }
  const fonte = `CelesTrak · elementos de ${fmt.horaMin(Date.parse(String(s.omm.EPOCH) + 'Z'), off)} do dia ${fmt.dataCurta(Date.parse(String(s.omm.EPOCH) + 'Z'), off)}`;
  const apogeu = (s.rec.a * (1 + s.rec.ecco) - 1) * 6378.137, perigeu = (s.rec.a * (1 - s.rec.ecco) - 1) * 6378.137;
  const ano = /^(\d{4})-/.exec(String(s.omm.OBJECT_ID || ''))?.[1];
  const nomeTipo = { geoestacionaria: 'geoestacionária (36 mil km, gira junto com a Terra)', media: 'média (navegação)', alta: 'alta', baixa: 'baixa' }[tipo];
  const detalhes = () => mostrarInfo(f.nome, el('table', { class: 'tabela-detalhe' }, el('tbody', {},
    linha('Nome no catálogo', f.original), linha('Operador', f.operador), linha('Função', f.funcao || 'não informada pela fonte'),
    linha('Número NORAD', String(s.omm.NORAD_CAT_ID ?? '–')), linha('Designação internacional', `${s.omm.OBJECT_ID || '–'}${ano ? ` (lançado em ${ano})` : ''}`),
    linha('Órbita', nomeTipo), linha('Altura agora', `${num(e.alturaKm, 0)} km (perigeu ${num(perigeu, 0)} km, apogeu ${num(apogeu, 0)} km)`),
    linha('Velocidade', `${num(e.velKmh, 0)} km/h (${num(e.velKmh / 3600, 2)} km/s)`), linha('Uma volta na Terra', periodoMin > 120 ? `${num(periodoMin / 60, 1)} h` : `${num(periodoMin, 1)} min`),
    linha('Inclinação', `${num(s.rec.inclo / RAD, 2)}°`), linha('Posição agora', `${latLon(e.lat, e.lon)}`),
    linha('Visto daqui agora', `${e.elevacao > 0 ? `${num(e.elevacao, 1)}° de altura, para o ${C.rumo(e.azimute)}` : 'abaixo do horizonte'}; a ${num(e.distanciaKm, 0)} km de você`),
    linha('Iluminado pelo Sol agora', e.iluminado ? 'sim' : 'não (na sombra da Terra)'),
    linha('Próximas passagens', proximas.length ? proximas.slice(0, 5).map((p) => `${diaHora(p.inicio, off, t)} até ${num(Math.round(p.max.elevacao))}°${p.visivel ? ' (visível)' : ''}`).join('; ') : 'nenhuma em 2 dias'),
    linha('Idade dos elementos', idade === null ? '–' : `${num(idade, 1)} dia${idade >= 2 ? 's' : ''}`))),
  el('p', { class: 'nota', text: `Posição pelo modelo SGP4 (satellite.js) com os elementos do CelesTrak. Passagem visível: satélite iluminado pelo Sol, céu escuro (Sol abaixo de −6°) e pelo menos 10° de altura, vista de ${local.nome}. Horários podem variar cerca de 1 min.` }));
  return { titulo: f.nome, frase, numeros, fonte, detalhes, passagem };
}

// ------------------------------------------------------------------ bloco "Céu de hoje"

const IDADE_RESUMO_MS = 10 * 60000;

/**
 * Cria o bloco "Céu de hoje" acima do globo. Mostra numa linha o que dá para ver a olho nu até o céu clarear,
 * cada item com o horário; um toque abre a frase completa e "Ver tudo" abre a lista com os próximos eventos.
 * @param {HTMLElement} pai onde inserir (antes do globo)
 * @param {() => object} estadoApp estado do app (local, previsão)
 * @param {() => Promise<object[]>} estacoes ISS e Tiangong como {id, rec, omm}
 * @returns {{el:HTMLElement, atualizar:(forcar?:boolean)=>void}}
 */
export function criarBlocoCeu(pai, estadoApp, estacoes, aoMudarAltura) {
  const lista = el('div', { class: 'ceu-hoje-lista', role: 'list' });
  const titulo = el('span', { class: 'ceu-hoje-titulo', text: 'Céu de hoje' });
  const tudo = el('button', { type: 'button', class: 'ceu-hoje-tudo', text: 'Ver tudo', onclick: () => abrirLista() });
  const raiz = el('section', { class: 'ceu-hoje', 'aria-label': 'O que dá para ver no céu hoje' }, el('div', { class: 'ceu-hoje-topo' }, titulo, tudo), lista);
  pai.prepend(raiz);
  let ultimo = null, calculadoEm = 0, chave = '';

  async function atualizar(forcar = false) {
    const local = localDoObservador(estadoApp());
    const k = `${local.lat.toFixed(2)},${local.lon.toFixed(2)}`;
    if (!forcar && k === chave && Date.now() - calculadoEm < IDADE_RESUMO_MS) return;
    chave = k; calculadoEm = Date.now();
    let est = [];
    try { est = (await estacoes()).filter((e) => (C.idadeElementosDias(e.omm, Date.now()) ?? 99) <= C.VIS.idadeMaxElementosDias); } catch { /* sem satélites: o resto continua */ }
    // o cálculo leva ~0,1 a 0,3 s: roda quando o navegador estiver livre, para não travar o primeiro quadro do globo
    await new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 800 }) : setTimeout(ok, 50)));
    try {
      ultimo = C.resumoDoCeu(local, Date.now(), { offsetS: fusoS(estadoApp()), estacoes: est, nuvemEm: nuvensPrevistas(estadoApp()) });
      ultimo.local = local; ultimo.semSatelites = !est.length;
    } catch (e) { ultimo = { erro: e }; }
    desenhar();
  }

  function desenhar() {
    titulo.textContent = `Céu de hoje · ${localDoObservador(estadoApp()).nome}`;
    lista.replaceChildren();
    if (!ultimo || ultimo.erro) { lista.append(el('p', { class: 'ceu-hoje-vazio', text: ultimo?.erro ? 'Não foi possível calcular o céu agora.' : 'Calculando o céu…' })); aoMudarAltura?.(); return; }
    const itens = ultimo.itens;
    if (!itens.length) lista.append(el('p', { class: 'ceu-hoje-vazio', text: 'Nada especial a olho nu até o amanhecer além das estrelas.' }));
    for (const it of itens) {
      lista.append(el('button', { type: 'button', role: 'listitem', class: `ceu-item${it.destaque ? ' destaque' : ''}${it.nuvem ? ` nuvem-${it.nuvem}` : ''}`, 'aria-label': `${it.quando}, ${it.titulo}. ${it.frase}`, onclick: () => abrirItem(it) },
        el('b', { text: it.quando }), el('span', { text: tituloCurto(it) })));
    }
    aoMudarAltura?.();
  }

  function abrirItem(it) {
    const extra = it.tipo === 'satelite' && it.outras > 0 ? el('p', { class: 'nota', text: `Há mais ${it.outras} passagem${it.outras > 1 ? 's' : ''} visível${it.outras > 1 ? 'eis' : ''} esta noite; esta é a mais alta. Toque na estação no Globo (botão Espaço) para ver todas.` }) : null;
    mostrarInfo(it.titulo, el('p', { class: 'ceu-frase', text: it.frase }), extra, notaFonte());
  }

  function abrirLista() {
    if (!ultimo || ultimo.erro) return;
    const off = fusoS(estadoApp()), local = ultimo.local;
    const obs = C.observador(local.lat, local.lon, 0);
    const itens = ultimo.itens.map((it) => el('li', {}, el('b', { text: `${it.quando} · ${it.titulo}` }), el('p', { text: it.frase })));
    const s = ultimo.sol;
    const prox = C.proximosEventos(obs, Date.now(), 45).slice(0, 10).map((e) => el('li', { class: e.fraca ? 'fraco' : null }, el('b', { text: `${fmt.diaSemana(e.ms, off)} ${fmt.dataCurta(e.ms, off)}${new Date(e.ms + off * 1000).getUTCFullYear() !== new Date(Date.now() + off * 1000).getUTCFullYear() ? `/${new Date(e.ms + off * 1000).getUTCFullYear()}` : ''}${e.tipo === 'estacao' || e.tipo === 'lua' || e.tipo === 'eclipse' ? ` ${hora(e.ms, off)}` : ''} · ${e.titulo}` }), e.detalhe ? el('p', { text: e.detalhe }) : null));
    mostrarInfo(`Céu de hoje · ${local.nome}`,
      el('p', { class: 'ceu-frase', text: `Sol: nasce ${hora(s.nasce, off)}, se põe ${hora(s.poe, off)}; céu escuro das ${s.escurece ? hora(s.escurece, off) : '–'} até ${ultimo.janela.clareia ? hora(ultimo.janela.clareia, off) : '–'}.` }),
      itens.length ? el('ul', { class: 'ceu-lista' }, ...itens) : el('p', { text: 'Nada especial a olho nu até o amanhecer além das estrelas.' }),
      el('h3', { class: 'ceu-sub', text: 'Próximos eventos' }), el('ul', { class: 'ceu-lista' }, ...prox), notaFonte());
  }

  function notaFonte() {
    const sat = ultimo?.semSatelites ? ' Estações espaciais indisponíveis agora (sem elementos orbitais recentes).' : '';
    return el('p', { class: 'nota', text: `Calculado para ${ultimo?.local?.nome || 'o seu local'} às ${hora(calculadoEm, fusoS(estadoApp()))}. Astronomy Engine (Sol, Lua, planetas, eclipses), SGP4 com elementos do CelesTrak (estações) e IMO (chuvas de meteoros). Nuvens: mediana dos modelos, a mesma da aba Hoje. Visível = céu escuro, pelo menos 10° acima do horizonte e longe do clarão do Sol.${sat}` });
  }

  return { el: raiz, atualizar, desenhar };
}

function tituloCurto(it) {
  if (it.tipo === 'satelite') return it.id === 'iss' ? 'ISS passa' : 'Tiangong passa';
  if (it.tipo === 'lua') return it.titulo.replace(/ \(.*\)/, '').replace('Lua ', 'Lua ');
  if (it.tipo === 'meteoros') return `Meteoros (${it.chuva.nome})`;
  return it.titulo;
}


// ------------------------------------------------------------------ sondas

/**
 * Cartão de uma sonda: onde está, a que distância do Sol e da Terra, quanto o sinal leva e o que a missão faz.
 * @param {string} chave chave da missão (MISSOES)
 * @param {{alvo:string, rota:number[][], perto:number[][], geo?:number[][]}} dados vetores do Horizons
 */
export function cartaoSonda(chave, dados, gerado, estadoApp, t = Date.now()) {
  const m = MISSOES[chave] || { nome: dados.alvo, agencia: 'não informado', resumo: '' };
  const off = fusoS(estadoApp);
  const s = estadoSonda(dados, t);
  if (!s) return { titulo: m.nome, frase: m.resumo, numeros: 'Sem posição calculada para esta data.', fonte: 'JPL Horizons' };
  const terra = C.helioEcliptica('Earth', t);
  const rSol = Math.hypot(s.x, s.y, s.z) * C.UA;
  let rTerra = Math.hypot(s.x - terra.x, s.y - terra.y, s.z - terra.z) * C.UA;
  const geo = chave === 'jwst' ? interpolar(dados.geo, t) : null; // o James Webb vem com vetor geocêntrico próprio (mais preciso)
  if (geo) rTerra = Math.hypot(geo.x, geo.y, geo.z) * C.UA;
  const velKms = Math.hypot(s.vx, s.vy, s.vz) * C.UA / 86400;
  const anos = (t - Date.parse(m.lancamento + 'T00:00:00Z')) / (365.25 * 86400000);
  const numeros = chave === 'jwst' ? `${km(rTerra)} da Terra, em volta do ponto L2 · sinal leva ${tempoLuz(rTerra)}`
    : `${km(rSol)} do Sol · ${km(rTerra)} da Terra · ${m.inativa ? 'a luz leva' : 'sinal de rádio leva'} ${tempoLuz(rTerra)}`;
  const quando = Date.parse(String(gerado || '')) || null;
  const detalhes = () => mostrarInfo(m.nome, el('table', { class: 'tabela-detalhe' }, el('tbody', {},
    linha('Agência', m.agencia), linha('Lançamento', `${m.lancamento.split('-').reverse().join('/')} (${num(anos, 1)} anos de viagem)`),
    linha('Situação', m.inativa ? 'sem contato (posição calculada)' : 'ativa'),
    linha('Distância do Sol', `${km(rSol)} (${num(rSol / C.UA, rSol / C.UA > 10 ? 1 : 3)} UA)`), linha('Distância da Terra', `${km(rTerra)} (${num(rTerra / C.UA, rTerra / C.UA > 10 ? 1 : 4)} UA)`),
    linha('Velocidade em relação ao Sol', `${num(velKms, 1)} km/s (${num(velKms * 3600, 0)} km/h)`),
    linha('Sinal ou luz até a Terra', tempoLuz(rTerra)),
    linha('Posição (eclíptica J2000)', `x ${num(s.x, 3)} · y ${num(s.y, 3)} · z ${num(s.z, 3)} UA`),
    linha('Alvo no JPL Horizons', dados.alvo))),
  el('p', { class: 'ceu-frase', text: m.resumo }),
  el('p', { class: 'nota', text: `Vetores de estado do JPL Horizons (NASA/JPL), gerados ${quando ? fmt.idade(quando) : 'recentemente'}; entre dois pontos, interpolação de Hermite. No mapa, a distância ao Sol está fora de escala (comprimida) para caber na tela; a direção é a real.` }));
  return { titulo: m.nome, frase: m.resumo, numeros, fonte: `JPL Horizons · ${quando ? `${fmt.dataCurta(quando, off)} ${hora(quando, off)}` : '–'}`, detalhes };
}

// ------------------------------------------------------------------ luas e corpos menores

const NOME_PLANETA = { Earth: 'Terra', Mars: 'Marte', Jupiter: 'Júpiter', Saturn: 'Saturno', Uranus: 'Urano', Neptune: 'Netuno', Pluto: 'Plutão' };
const PERIODO_LUA_DIAS = CORPOS_EXTRA.PERIODO_LUA_DIAS;
const periodoTexto = (dias) => (dias < 2 ? `${num(dias * 24, 1)} horas` : dias < 730 ? `${num(dias, dias < 30 ? 2 : 0)} dias` : `${num(dias / 365.25, dias < 36525 ? 1 : 0)} anos`);

/**
 * Cartão de uma lua: o que é, distância ao planeta agora, período, tamanho e descoberta.
 * @param {object} [el] elementos do Horizons (para as luas fora do Astronomy Engine)
 */
export function cartaoLua(chave, elem, t = Date.now()) {
  const L = CORPOS_EXTRA.LUAS[chave];
  const p = CORPOS_EXTRA.posicaoLua(chave, t, elem);
  const dist = p ? Math.hypot(p.x, p.y, p.z) : null;
  const periodo = PERIODO_LUA_DIAS[chave] ?? (elem?.n ? 360 / elem.n : null);
  const pai = NOME_PLANETA[L.pai] || L.pai;
  const fonte = PERIODO_LUA_DIAS[chave] ? 'Astronomy Engine' : `JPL Horizons · elementos de ${fmt.dataCurta(elem.epoca, 0)}`;
  const linhas = [
    linha('Lua de', pai),
    linha('Diâmetro', `${num(L.raioKm * 2, L.raioKm < 50 ? 1 : 0)} km${chave !== 'lua' ? ` (${num(L.raioKm / 1737.4 * 100, 0)}% do tamanho da nossa Lua)` : ''}`),
    linha('Distância do centro do planeta agora', dist ? km(dist) : null),
    linha('Uma volta no planeta', periodo ? periodoTexto(periodo) : null),
    linha('Descoberta', L.descoberta || 'conhecida desde sempre'),
    elem?.e != null ? linha('Excentricidade e inclinação', `${num(elem.e, 4)} · ${num(elem.i, 1)}° (sobre a eclíptica)`) : null,
  ];
  return {
    titulo: L.nome, frase: L.frase, numeros: `Lua de ${pai}${dist ? ` · ${km(dist)} do planeta` : ''}`, fonte,
    detalhes: () => mostrarInfo(L.nome, el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)),
      el('p', { class: 'nota', text: `${PERIODO_LUA_DIAS[chave] ? 'Posição pelo Astronomy Engine (teorias ELP/MPP02 para a Lua e L1.2 para as luas de Júpiter).' : 'Posição pela órbita osculante do dia, do JPL Horizons, propagada como órbita kepleriana.'} No mapa, as distâncias das luas estão em escala logarítmica em volta do planeta; a direção é a real.` })),
  };
}

const TIPO_PEQUENO = { anao: 'Planeta anão', asteroide: 'Asteroide', cometa: 'Cometa' };

/** Cartão de um planeta anão, asteroide ou cometa (elementos do JPL SBDB). */
export function cartaoPequeno(chave, d, estadoApp, t = Date.now()) {
  const P = CORPOS_EXTRA.PEQUENOS[chave] || { nome: d.nome, frase: '' };
  const off = fusoS(estadoApp);
  const pos = CORPOS_EXTRA.posicaoKepler(d, t);
  const terra = C.helioEcliptica('Earth', t);
  const rSol = pos ? Math.hypot(pos.x, pos.y, pos.z) : null;
  const rTerra = pos ? Math.hypot(pos.x - terra.x, pos.y - terra.y, pos.z - terra.z) : null;
  const o = CORPOS_EXTRA.dadosOrbita(d);
  const prox = CORPOS_EXTRA.proximoPerielio(d, t);
  const tipo = CORPOS_EXTRA.ANOES_IAU.has(chave) ? 'Planeta anão' : d.tipo === 'anao' ? 'Candidato a planeta anão' : TIPO_PEQUENO[d.tipo] || 'Corpo menor';
  const ua = (v) => `${num(v, v < 10 ? 2 : 1)} UA (${km(v * UA_KM)})`;
  const linhas = [
    linha('Tipo', tipo), linha('Nome oficial', d.nome),
    linha('Diâmetro', d.diametro_km ? `${num(d.diametro_km, d.diametro_km < 10 ? 2 : 0)} km` : 'não medido com precisão'),
    linha('Distância do Sol agora', rSol != null ? ua(rSol) : null),
    linha('Distância da Terra agora', rTerra != null ? `${ua(rTerra)}; a luz leva ${tempoLuz(rTerra * UA_KM)}` : null),
    linha('Uma volta no Sol', periodoTexto(o.periodoDias)),
    linha('Mais perto e mais longe do Sol', `${num(o.perielio, 2)} UA e ${num(o.afelio, o.afelio < 10 ? 2 : 0)} UA`),
    linha('Próxima passagem mais perto do Sol', `${fmt.dataCurta(prox, off)}/${new Date(prox + off * 1000).getUTCFullYear()}`),
    linha('Inclinação e excentricidade', `${num(d.i, 2)}° · ${num(d.e, 4)}`),
  ];
  return {
    titulo: P.nome, frase: P.frase,
    numeros: `${tipo}${rSol != null ? ` · ${num(rSol, rSol < 10 ? 2 : 1)} UA do Sol` : ''}${d.diametro_km ? ` · ${num(d.diametro_km, d.diametro_km < 10 ? 1 : 0)} km` : ''}`,
    fonte: `JPL SBDB · elementos de ${fmt.dataCurta(d.epoca, 0)}/${new Date(d.epoca).getUTCFullYear()}`,
    detalhes: () => mostrarInfo(P.nome, el('table', { class: 'tabela-detalhe' }, el('tbody', {}, ...linhas)),
      el('p', { class: 'nota', text: 'Elementos orbitais do JPL Small-Body Database, propagados como órbita kepleriana em volta do Sol (sem a atração dos planetas: posição boa para alguns anos). No mapa, a distância ao Sol está comprimida; a direção é a real.' })),
  };
}
