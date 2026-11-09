// Mapa detalhado da região sob a câmera, para o zoom máximo do globo: quando a câmera chega perto da superfície,
// um mosaico de quadros do OpenStreetMap (projeção Web Mercator) é montado para a área visível e desenhado sobre a
// textura da Terra pelo shader (uniformes tRegiao, regLon, regMerc, temRegiao). As texturas da NASA param em 4096 px
// (10 km por pixel); o mosaico chega ao nível 17 (cerca de 1 m por pixel), com cidades, ruas e nomes. O nível e a
// quantidade de quadros saem do tamanho real do canvas em pixels: cada pixel da tela recebe ~1 pixel do mapa, em
// qualquer monitor (celular, 1080p, 1440p, 4K).
// Política de uso dos servidores do OSM: poucos quadros por vez, com cache local e referrer de origem.

const MAX_NIVEL = 17;           // nível máximo de zoom dos quadros
const MAX_QUADROS_LADO = 16;    // mosaico de no máximo 16 quadros por lado (4096 px, limite seguro de textura)
const PX_MAPA_POR_PX_TELA = 0.85; // pouco abaixo de 1: nítido sem multiplicar os quadros baixados
const FOLGA = 1.2;              // área extra em volta da vista, para o arrasto não mostrar a borda
const DIST_LIGA = 1.6;          // distância da câmera (raio = 1) abaixo da qual o mosaico entra
const DIST_CHEIO = 1.35;        // a partir daqui o mosaico cobre a textura por completo
const INTERVALO_MS = 450;       // intervalo mínimo entre remontagens

const cacheQuadros = new Map(); // url -> Promise<HTMLImageElement>
const MAX_CACHE = 320;

/**
 * Cria o controle da região detalhada. `atualizar(cam, agora, vista)` deve ser chamado a cada quadro com a câmera
 * {lat, lon, dist} e a vista {fov (graus, vertical), aspecto, largura e altura do canvas em pixels de desenho}.
 * @param {object} THREE módulo do Three.js
 * @param {object} uniformes uniformes do material da Terra (recebe tRegiao, regLon, regMerc, temRegiao)
 */
export function criarRegiao(THREE, uniformes) {
  const R = { ativa: false, nivel: 0, caixa: null, ultimo: 0, montando: false, textura: null, pendente: null };
  uniformes.tRegiao = { value: null };
  uniformes.temRegiao = { value: 0 };
  uniformes.regLon = { value: new THREE.Vector2(0, 1) };
  uniformes.regMerc = { value: new THREE.Vector2(1, 0) };

  function atualizar(cam, agora, vista) {
    const forca = Math.max(0, Math.min(1, (DIST_LIGA - cam.dist) / (DIST_LIGA - DIST_CHEIO)));
    uniformes.temRegiao.value = R.textura ? forca : 0;
    R.ativa = forca > 0 && !!R.textura;
    if (forca <= 0) return;
    if (agora - R.ultimo < INTERVALO_MS || R.montando) return;
    const alvo = caixaVisivel(cam, vista);
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

/**
 * Caixa de quadros (nível e índices x, y) que cobre a área visível em torno do centro da câmera, com o nível escolhido
 * para ~1 pixel do mapa por pixel do canvas. Se a vista pedir mais de MAX_QUADROS_LADO quadros, o nível desce um.
 */
function caixaVisivel(cam, vista) {
  const altura = Math.max(0.0005, cam.dist - 1);
  const lat = Math.max(-84, Math.min(84, cam.lat)), cosLat = Math.cos(lat * Math.PI / 180);
  // meia altura e meia largura visíveis em graus de latitude e de longitude no centro da vista
  const meiaV = Math.min(40, altura * Math.tan(vista.fov / 2 * Math.PI / 180) * 57.2958);
  const meiaH = Math.min(170, meiaV * vista.aspecto / cosLat);
  let nivel = Math.round(Math.log2(PX_MAPA_POR_PX_TELA * vista.largura * 360 / (256 * 2 * meiaH)));
  nivel = Math.max(2, Math.min(MAX_NIVEL, nivel));
  let n, ladoX, ladoY;
  for (;;) {
    n = 2 ** nivel;
    const grausQuadro = 360 / n;
    ladoX = Math.ceil(2 * meiaH * FOLGA / grausQuadro) + 1;
    ladoY = Math.ceil(2 * meiaV * FOLGA / (grausQuadro * cosLat)) + 1;
    if ((ladoX <= MAX_QUADROS_LADO && ladoY <= MAX_QUADROS_LADO) || nivel <= 2) break;
    nivel--;
  }
  ladoX = Math.min(ladoX, n, MAX_QUADROS_LADO); ladoY = Math.min(ladoY, n, MAX_QUADROS_LADO);
  const cx = ((cam.lon + 540) % 360 - 180 + 180) / 360 * n;
  const cy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / cosLat) / Math.PI) / 2 * n;
  const x0 = Math.max(0, Math.min(n - ladoX, Math.round(cx - ladoX / 2)));
  const y0 = Math.max(0, Math.min(n - ladoY, Math.round(cy - ladoY / 2)));
  return { nivel, x0, y0, ladoX, ladoY };
}

function mesmaCaixa(a, b) { return a.nivel === b.nivel && a.x0 === b.x0 && a.y0 === b.y0 && a.ladoX === b.ladoX && a.ladoY === b.ladoY; }

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
  const { nivel, x0, y0, ladoX, ladoY } = caixa, n = 2 ** nivel;
  const pedidos = [];
  for (let j = 0; j < ladoY; j++) for (let i = 0; i < ladoX; i++) {
    pedidos.push(quadro(`https://tile.openstreetmap.org/${nivel}/${x0 + i}/${y0 + j}.png`).then((img) => ({ i, j, img }), () => null));
  }
  const quadros = await Promise.all(pedidos);
  if (!quadros.some(Boolean)) return null;
  const cv = document.createElement('canvas'); cv.width = 256 * ladoX; cv.height = 256 * ladoY;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#aad3df'; ctx.fillRect(0, 0, cv.width, cv.height); // cor do mar do OSM onde faltar um quadro
  for (const q of quadros) if (q) ctx.drawImage(q.img, q.i * 256, q.j * 256);
  const textura = new THREE.CanvasTexture(cv);
  textura.flipY = false; textura.colorSpace = THREE.SRGBColorSpace; textura.generateMipmaps = false;
  textura.minFilter = textura.magFilter = THREE.LinearFilter; textura.wrapS = textura.wrapT = THREE.ClampToEdgeWrapping;
  const mercDeY = (y) => Math.PI * (1 - 2 * y / n);
  return { textura, lon0: x0 / n * 360 - 180, lon1: (x0 + ladoX) / n * 360 - 180, mercTopo: mercDeY(y0), mercBase: mercDeY(y0 + ladoY) };
}
