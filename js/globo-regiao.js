// Mapa detalhado da região sob a câmera, para o zoom máximo do globo: quando a câmera chega perto da superfície,
// um mosaico de quadros do OpenStreetMap (projeção Web Mercator) é montado para a área visível e desenhado sobre a
// textura da Terra pelo shader (uniformes tRegiao, regLon, regMerc, temRegiao). As texturas da NASA param em 4096 px
// (10 km por pixel); o mosaico chega ao nível 13 (cerca de 20 m por pixel), com cidades, estradas e nomes.
// Política de uso dos servidores do OSM: poucos quadros por vez, com cache local e referrer de origem.

const MAX_NIVEL = 13;           // nível máximo de zoom dos quadros
const MAX_QUADROS_LADO = 5;     // mosaico de no máximo 5 x 5 quadros (1280 px)
const DIST_LIGA = 1.6;          // distância da câmera (raio = 1) abaixo da qual o mosaico entra
const DIST_CHEIO = 1.35;        // a partir daqui o mosaico cobre a textura por completo
const INTERVALO_MS = 450;       // intervalo mínimo entre remontagens

const cacheQuadros = new Map(); // url -> Promise<HTMLImageElement>
const MAX_CACHE = 240;

/**
 * Cria o controle da região detalhada. `atualizar(cam)` deve ser chamado a cada quadro com a câmera {lat, lon, dist}.
 * @param {object} THREE módulo do Three.js
 * @param {object} uniformes uniformes do material da Terra (recebe tRegiao, regLon, regMerc, temRegiao)
 */
export function criarRegiao(THREE, uniformes) {
  const R = { ativa: false, nivel: 0, caixa: null, ultimo: 0, montando: false, textura: null, pendente: null };
  uniformes.tRegiao = { value: null };
  uniformes.temRegiao = { value: 0 };
  uniformes.regLon = { value: new THREE.Vector2(0, 1) };
  uniformes.regMerc = { value: new THREE.Vector2(1, 0) };

  function atualizar(cam, agora) {
    const forca = Math.max(0, Math.min(1, (DIST_LIGA - cam.dist) / (DIST_LIGA - DIST_CHEIO)));
    uniformes.temRegiao.value = R.textura ? forca : 0;
    R.ativa = forca > 0 && !!R.textura;
    if (forca <= 0) return;
    if (agora - R.ultimo < INTERVALO_MS || R.montando) return;
    const alvo = caixaVisivel(cam);
    if (R.caixa && mesmaCaixa(R.caixa, alvo)) return;
    R.ultimo = agora; R.montando = true;
    montarMosaico(THREE, alvo).then((m) => {
      if (!m) return;
      R.caixa = alvo;
      R.textura?.dispose();
      R.textura = m.textura;
      uniformes.tRegiao.value = m.textura;
      uniformes.regLon.value.set(m.lon0, m.lon1);
      uniformes.regMerc.value.set(m.mercTopo, m.mercBase);
    }).catch(() => {}).finally(() => { R.montando = false; });
  }

  return { atualizar, estado: R };
}

/** Caixa de quadros (nível e índices x, y) que cobre a área visível em torno do centro da câmera. */
function caixaVisivel(cam) {
  const altura = Math.max(0.002, cam.dist - 1);
  // meia largura visível em graus (fov de 42°, com folga de 40% para o arrasto) ; no mínimo 0,04°
  const meia = Math.max(0.04, Math.min(30, altura * Math.tan(21 * Math.PI / 180) * 57.3 * 1.4));
  const nivel = Math.max(2, Math.min(MAX_NIVEL, Math.round(Math.log2(360 * 3 / (2 * meia)))));
  const n = 2 ** nivel;
  const lat = Math.max(-84, Math.min(84, cam.lat));
  const cx = ((cam.lon + 540) % 360 - 180 + 180) / 360 * n;
  const cy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const lado = Math.min(MAX_QUADROS_LADO, Math.max(1, Math.ceil(2 * meia / (360 / n)) + 1));
  const x0 = Math.max(0, Math.min(n - lado, Math.round(cx - lado / 2)));
  const y0 = Math.max(0, Math.min(n - lado, Math.round(cy - lado / 2)));
  return { nivel, x0, y0, lado };
}

function mesmaCaixa(a, b) { return a.nivel === b.nivel && a.x0 === b.x0 && a.y0 === b.y0 && a.lado === b.lado; }

function quadro(url) {
  if (cacheQuadros.has(url)) { const p = cacheQuadros.get(url); cacheQuadros.delete(url); cacheQuadros.set(url, p); return p; }
  const p = new Promise((ok, falha) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; img.referrerPolicy = 'origin'; img.decoding = 'async';
    img.onload = () => ok(img); img.onerror = () => falha(new Error('quadro'));
    img.src = url;
  });
  p.catch(() => cacheQuadros.delete(url));
  cacheQuadros.set(url, p);
  for (const k of cacheQuadros.keys()) { if (cacheQuadros.size <= MAX_CACHE) break; cacheQuadros.delete(k); }
  return p;
}

/** Baixa os quadros da caixa e monta um canvas em Mercator; devolve a textura e os limites em longitude e Mercator. */
async function montarMosaico(THREE, caixa) {
  const { nivel, x0, y0, lado } = caixa, n = 2 ** nivel;
  const pedidos = [];
  for (let j = 0; j < lado; j++) for (let i = 0; i < lado; i++) {
    pedidos.push(quadro(`https://tile.openstreetmap.org/${nivel}/${x0 + i}/${y0 + j}.png`).then((img) => ({ i, j, img }), () => null));
  }
  const quadros = await Promise.all(pedidos);
  if (!quadros.some(Boolean)) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256 * lado;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#aad3df'; ctx.fillRect(0, 0, cv.width, cv.height); // cor do mar do OSM onde faltar um quadro
  for (const q of quadros) if (q) ctx.drawImage(q.img, q.i * 256, q.j * 256);
  const textura = new THREE.CanvasTexture(cv);
  textura.flipY = false; textura.colorSpace = THREE.SRGBColorSpace; textura.generateMipmaps = false;
  textura.minFilter = textura.magFilter = THREE.LinearFilter; textura.wrapS = textura.wrapT = THREE.ClampToEdgeWrapping;
  const mercDeY = (y) => Math.PI * (1 - 2 * y / n);
  return { textura, lon0: x0 / n * 360 - 180, lon1: (x0 + lado) / n * 360 - 180, mercTopo: mercDeY(y0), mercBase: mercDeY(y0 + lado) };
}
