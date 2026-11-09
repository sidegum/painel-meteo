// Cidades: normalização da busca (geocodificação da Open-Meteo), favoritas e recentes.
// Funções puras, sem DOM nem rede, testadas em test/cidades.test.mjs. A interface fica em js/locais.js.
import { arredondaCoord, valido } from './analise.js';

/** Limites da lista de cidades. Favoritas viram abas no topo, por isso o teto é baixo. */
export const LIMITES = { favoritas: 8, recentes: 5, resultados: 10, consulta: 60 };

/** País que sobe na lista de resultados (o painel é do RS). */
export const PAIS_PREFERIDO = 'BR';

/** Minúsculas e sem acento: "São José" e "sao jose" comparam iguais. */
export function dobrar(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Chave de um local: a coordenada arredondada a 2 casas, a mesma enviada às APIs. */
export const chaveLocal = (l) => `${arredondaCoord(l.lat)},${arredondaCoord(l.lon)}`;

/** Mesmo local: mesmo id do GeoNames quando os dois têm; senão, mesma coordenada arredondada. */
export function mesmoLocal(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return chaveLocal(a) === chaveLocal(b);
}

const texto = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Converte a resposta de /v1/search da Open-Meteo numa lista curta e sem ambiguidade.
 * - Só lugares habitados (feature_code PPL*, do GeoNames); aeroportos, bairros e acidentes geográficos saem.
 *   Se a consulta só achar outros tipos, eles ficam (melhor um resultado do que nenhum).
 * - Sem repetidos (mesmo id) e com o país preferido primeiro, mantendo a ordem de relevância da API dentro de cada grupo.
 * - Região: "Estado, País". Quando duas cidades com o mesmo nome caem no mesmo estado, entra o município
 *   (admin2) para diferenciar.
 * @param {Array<object>} resultados campo results da resposta
 * @param {{pais?:string, limite?:number}} [op]
 * @returns {Array<{id:number|null, nome:string, estado:string|null, municipio:string|null, pais:string|null, codigoPais:string|null, lat:number, lon:number, populacao:number|null, regiao:string}>}
 */
export function normalizarResultados(resultados, { pais = PAIS_PREFERIDO, limite = LIMITES.resultados } = {}) {
  const lista = (Array.isArray(resultados) ? resultados : [])
    .filter((r) => r && valido(r.latitude) && valido(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180 && texto(r.name))
    .map((r) => ({
      id: Number.isInteger(r.id) ? r.id : null,
      nome: texto(r.name),
      estado: texto(r.admin1, 60),
      municipio: texto(r.admin2, 60),
      pais: texto(r.country, 60),
      codigoPais: texto(r.country_code, 2)?.toUpperCase() ?? null,
      lat: r.latitude, lon: r.longitude,
      populacao: Number.isFinite(r.population) && r.population > 0 ? r.population : null,
      habitado: /^PPL/.test(String(r.feature_code || '')),
    }));
  const habitados = lista.filter((c) => c.habitado);
  const base = habitados.length ? habitados : lista;
  const vistos = new Set();
  const unicos = base.filter((c) => {
    const k = c.id ?? chaveLocal(c);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const ordenados = [...unicos.filter((c) => c.codigoPais === pais), ...unicos.filter((c) => c.codigoPais !== pais)].slice(0, limite);
  const contagem = new Map();
  for (const c of ordenados) { const k = dobrar(`${c.nome}|${c.estado}|${c.codigoPais}`); contagem.set(k, (contagem.get(k) || 0) + 1); }
  return ordenados.map(({ habitado: _, ...c }) => {
    const repetida = contagem.get(dobrar(`${c.nome}|${c.estado}|${c.codigoPais}`)) > 1;
    return { ...c, regiao: regiaoDe(c, repetida) };
  });
}

/**
 * Texto da região mostrado abaixo do nome: "Rio Grande do Sul, Brasil".
 * @param {{nome:string, estado?:string|null, municipio?:string|null, pais?:string|null}} c
 * @param {boolean} [repetida] há outra cidade com o mesmo nome no mesmo estado: inclui o município
 */
export function regiaoDe(c, repetida = false) {
  const partes = [];
  if (repetida && c.municipio && dobrar(c.municipio) !== dobrar(c.nome)) partes.push(`município de ${c.municipio}`);
  if (c.estado && dobrar(c.estado) !== dobrar(c.nome)) partes.push(c.estado);
  if (c.pais) partes.push(c.pais);
  return partes.join(', ');
}

/**
 * Divide o nome em trechos para destacar o que a pessoa digitou. Casa no início do nome ou de qualquer
 * palavra, sem diferenciar acento nem maiúscula ("sao" destaca "São" em "São José").
 * @returns {Array<{texto:string, destaque:boolean}>}
 */
export function trechosDestaque(nome, consulta) {
  const n = String(nome ?? '');
  const q = dobrar(consulta).trim();
  if (!q) return [{ texto: n, destaque: false }];
  // índice de cada caractere dobrado no nome original (um caractere pode virar mais de um ao dobrar)
  let dobrado = '';
  const origem = [];
  for (let i = 0; i < n.length; i++) {
    const d = dobrar(n[i]);
    for (let k = 0; k < d.length; k++) origem.push(i);
    dobrado += d;
  }
  let pos = -1;
  for (let i = dobrado.indexOf(q); i >= 0; i = dobrado.indexOf(q, i + 1)) {
    if (i === 0 || /[^\p{L}\p{N}]/u.test(dobrado[i - 1])) { pos = i; break; }
  }
  if (pos < 0) return [{ texto: n, destaque: false }];
  const ini = origem[pos];
  const fim = origem[pos + q.length - 1] + 1;
  return [{ texto: n.slice(0, ini), destaque: false }, { texto: n.slice(ini, fim), destaque: true }, { texto: n.slice(fim), destaque: false }]
    .filter((t) => t.texto);
}

/** Casa a consulta com um local salvo (nome ou região), para mostrar favoritas e recentes antes da resposta da API. */
export function casaConsulta(local, consulta) {
  const q = dobrar(consulta).trim();
  if (!q) return true;
  return dobrar(local.nome).includes(q) || dobrar(local.regiao).includes(q);
}

/**
 * Forma guardada no aparelho: só o necessário para a aba e a busca da previsão, com a coordenada
 * arredondada (cerca de 1 km), a mesma precisão enviada às APIs.
 */
export function paraGuardar(c) {
  return { id: c.id ?? null, nome: texto(c.nome) || 'Local', regiao: texto(c.regiao, 120) || '', lat: arredondaCoord(c.lat), lon: arredondaCoord(c.lon) };
}

/** Valida uma lista lida do aparelho (pode estar corrompida ou ser de outra versão). */
export function listaValida(v, max) {
  if (!Array.isArray(v)) return [];
  return v.filter((c) => c && valido(c.lat) && valido(c.lon) && texto(c.nome)).map(paraGuardar).slice(0, max);
}

/** Favorita a cidade, ou desfavorita se já estiver na lista. Nova favorita entra no fim (vira a última aba). */
export function alternarFavorita(favoritas, cidade) {
  if (favoritas.some((f) => mesmoLocal(f, cidade))) return favoritas.filter((f) => !mesmoLocal(f, cidade));
  if (favoritas.length >= LIMITES.favoritas) return favoritas;
  return [...favoritas, paraGuardar(cidade)];
}

/** Move uma favorita uma posição (delta -1 sobe, +1 desce), para ordenar as abas. */
export function moverFavorita(favoritas, cidade, delta) {
  const i = favoritas.findIndex((f) => mesmoLocal(f, cidade));
  const j = i + delta;
  if (i < 0 || j < 0 || j >= favoritas.length) return favoritas;
  const nova = [...favoritas];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

/** Põe a cidade no topo das recentes, sem repetir e sem passar do limite. */
export function adicionarRecente(recentes, cidade) {
  return [paraGuardar(cidade), ...recentes.filter((r) => !mesmoLocal(r, cidade))].slice(0, LIMITES.recentes);
}
