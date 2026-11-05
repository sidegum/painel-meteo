// Sondas e telescópios espaciais no sistema solar: trajetória e posição pelos vetores do JPL Horizons (gerados uma vez
// por dia pelo GitHub Actions em sondas.json, branch globo-dados) e uma ficha curta de cada missão.
// Coordenadas: heliocêntricas, eclíptica J2000, em UA; velocidades em UA/dia.

/** Ficha de cada missão (fatos públicos das agências; datas de lançamento em UTC). */
export const MISSOES = {
  jwst: { nome: 'Telescópio James Webb', curto: 'James Webb', agencia: 'NASA, ESA e CSA', lancamento: '2021-12-25', cor: '#f2c14e',
    resumo: 'O maior telescópio espacial já lançado. Observa em infravermelho, de uma órbita em torno do ponto L2, a cerca de 1,5 milhão de km da Terra, sempre do lado oposto ao Sol.' },
  voyager1: { nome: 'Voyager 1', curto: 'Voyager 1', agencia: 'NASA/JPL', lancamento: '1977-09-05', cor: '#9ad0ff',
    resumo: 'Passou por Júpiter (1979) e Saturno (1980). Entrou no espaço interestelar em 2012 e é o objeto feito pelo ser humano mais distante da Terra. Ainda envia dados.' },
  voyager2: { nome: 'Voyager 2', curto: 'Voyager 2', agencia: 'NASA/JPL', lancamento: '1977-08-20', cor: '#9ad0ff',
    resumo: 'A única nave que visitou Urano (1986) e Netuno (1989), depois de Júpiter e Saturno. No espaço interestelar desde 2018.' },
  newhorizons: { nome: 'New Horizons', curto: 'New Horizons', agencia: 'NASA', lancamento: '2006-01-19', cor: '#c9e3a0',
    resumo: 'Primeira nave a visitar Plutão (2015) e depois o objeto Arrokoth (2019). Segue pelo Cinturão de Kuiper.' },
  parker: { nome: 'Sonda Solar Parker', curto: 'Parker', agencia: 'NASA', lancamento: '2018-08-12', cor: '#ffb07a',
    resumo: 'Mergulha na coroa do Sol. Em 24/12/2024 passou a 6,1 milhões de km da superfície, a 692 mil km/h: o objeto mais rápido já feito.' },
  juno: { nome: 'Juno', curto: 'Juno', agencia: 'NASA', lancamento: '2011-08-05', cor: '#e0c49a',
    resumo: 'Em órbita de Júpiter desde 4/7/2016, estudando o interior, as auroras e as luas do planeta.' },
  europaclipper: { nome: 'Europa Clipper', curto: 'Europa Clipper', agencia: 'NASA', lancamento: '2024-10-14', cor: '#a8e6e0',
    resumo: 'A caminho de Júpiter (chegada prevista para abril de 2030) para estudar Europa, lua com um oceano sob o gelo.' },
  juice: { nome: 'JUICE', curto: 'JUICE', agencia: 'ESA', lancamento: '2023-04-14', cor: '#b8b4ff',
    resumo: 'A caminho de Júpiter (chegada prevista para julho de 2031) para estudar as luas geladas Ganimedes, Calisto e Europa.' },
  psyche: { nome: 'Psyche', curto: 'Psyche', agencia: 'NASA', lancamento: '2023-10-13', cor: '#d6d0c4',
    resumo: 'A caminho do asteroide metálico Psyche, no cinturão de asteroides (chegada prevista para 2029).' },
  lucy: { nome: 'Lucy', curto: 'Lucy', agencia: 'NASA', lancamento: '2021-10-16', cor: '#f0a6c8',
    resumo: 'Vai visitar os asteroides troianos, que dividem a órbita de Júpiter (primeiro encontro com um troiano previsto para 2027).' },
  bepicolombo: { nome: 'BepiColombo', curto: 'BepiColombo', agencia: 'ESA e JAXA', lancamento: '2018-10-20', cor: '#cfc3ad',
    resumo: 'Duas sondas viajando juntas até Mercúrio, onde a chegada à órbita está prevista para o fim de 2026.' },
  solarorbiter: { nome: 'Solar Orbiter', curto: 'Solar Orbiter', agencia: 'ESA e NASA', lancamento: '2020-02-10', cor: '#ffd38a',
    resumo: 'Fotografa o Sol de perto e, inclinando a órbita aos poucos, mostra pela primeira vez os polos solares.' },
  osirisapex: { nome: 'OSIRIS-APEX', curto: 'OSIRIS-APEX', agencia: 'NASA', lancamento: '2016-09-08', cor: '#c0d8f0',
    resumo: 'Antes OSIRIS-REx: trouxe à Terra uma amostra do asteroide Bennu (2023). Agora vai ao asteroide Apófis, que passa perto da Terra em 2029.' },
  hera: { nome: 'Hera', curto: 'Hera', agencia: 'ESA', lancamento: '2024-10-07', cor: '#e8b4b4',
    resumo: 'Vai examinar o asteroide Dimorphos, desviado de propósito pela sonda DART em 2022, e seu companheiro Didymos.' },
  pioneer10: { nome: 'Pioneer 10', curto: 'Pioneer 10', agencia: 'NASA', lancamento: '1972-03-03', cor: '#8f9aa6', inativa: true,
    resumo: 'Primeira nave a cruzar o cinturão de asteroides e a passar por Júpiter (1973). Sem contato desde 2003; a posição é a da trajetória calculada.' },
  pioneer11: { nome: 'Pioneer 11', curto: 'Pioneer 11', agencia: 'NASA', lancamento: '1973-04-06', cor: '#8f9aa6', inativa: true,
    resumo: 'Passou por Júpiter (1974) e foi a primeira a visitar Saturno (1979). Sem contato desde 1995; a posição é a da trajetória calculada.' },
};

/**
 * Posição e velocidade no instante t por interpolação: no trecho fino (6 h) com Hermite cúbica (usa a velocidade),
 * fora dele na rota (passo de dias). Devolve null fora da cobertura.
 * @param {{rota:number[][], perto:number[][]}} s pontos [ms, x, y, z, vx, vy, vz]
 * @returns {{x:number, y:number, z:number, vx:number, vy:number, vz:number}|null}
 */
export function estadoSonda(s, t) {
  return interpolar(s.perto, t) || interpolar(s.rota, t);
}

/** Interpolação de Hermite entre os dois pontos que cercam t (posição em UA, velocidade em UA/dia). */
export function interpolar(pontos, t) {
  if (!pontos?.length || t < pontos[0][0] || t > pontos[pontos.length - 1][0]) return null;
  let a = 0, b = pontos.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (pontos[m][0] <= t) a = m; else b = m; }
  const p0 = pontos[a], p1 = pontos[b];
  const h = (p1[0] - p0[0]) / 86400000 || 1; // dias
  const s = (t - p0[0]) / 86400000 / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const out = {};
  ['x', 'y', 'z'].forEach((k, i) => {
    out[k] = h00 * p0[1 + i] + h10 * h * p0[4 + i] + h01 * p1[1 + i] + h11 * h * p1[4 + i];
    out['v' + k] = p0[4 + i] + (p1[4 + i] - p0[4 + i]) * s;
  });
  return out;
}
