// Grade de coordenadas do globo: o espaçamento acompanha o zoom (de 30° com a Terra inteira até 0,005°, ~500 m, no
// zoom de rua) e os valores ficam nas bordas da tela, onde cada linha entra: latitudes à esquerda, longitudes em cima,
// sem que um rótulo cubra outro.
// As linhas são desenhadas no shader da Terra (uniformes passoGrade e opGrade); este módulo escolhe o passo e põe os
// rótulos. Trópicos e círculos polares usam a obliquidade da eclíptica do dia (Laskar 1986, via IAU 2006).

const RAD = Math.PI / 180;
const PASSOS = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005];
const PX_POR_LINHA = 160;   // espaçamento escolhido para ~1 linha a cada 160 px da largura (de 3 a 8 linhas)
const MAX_ROTULOS = 40;
const AMOSTRAS = 48;        // pontos testados ao longo de cada linha para achar onde ela entra na tela

/** Obliquidade média da eclíptica em graus (IAU 2006, termo linear basta: 0,47"/século de erro até 2100). */
export function obliquidade(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545.0) / 36525;
  return 23.439279444 - 0.013010214 * T;
}

/**
 * Meia largura da área vista, em graus de arco sobre a superfície, para a câmera a 'dist' raios do centro.
 * Raio de visão no ângulo a do eixo: o ângulo central até o ponto atingido é asin(d·sen a) − a (ou o horizonte).
 */
export function meiaVisao(dist, fovVertical, aspecto) {
  const a = Math.atan(Math.tan(fovVertical * RAD / 2) * Math.max(aspecto, 1));
  const s = dist * Math.sin(a);
  return (s >= 1 ? Math.acos(1 / dist) : Math.asin(s) - a) / RAD;
}

const casas = (passo) => (passo >= 1 ? 0 : passo >= 0.1 ? 1 : passo >= 0.01 ? 2 : 3);
const textoLat = (v, c) => (Math.abs(v) < 1e-9 ? 'Equador' : `${Math.abs(v).toFixed(c).replace('.', ',')}°${v < 0 ? 'S' : 'N'}`);
const textoLon = (v, c) => { const w = ((v + 540) % 360) - 180; return Math.abs(w) < 1e-9 ? '0° Greenwich' : Math.abs(Math.abs(w) - 180) < 1e-9 ? '180°' : `${Math.abs(w).toFixed(c).replace('.', ',')}°${w < 0 ? 'O' : 'L'}`; };

/**
 * @param {{THREE: object, uniformes: object, camada: HTMLElement, latLonVec: Function}} p
 *   camada: elemento sobre o canvas onde os rótulos são postos (posição absoluta, sem eventos)
 * @returns {{atualizar: (cam: object, camera: object, rect: DOMRect, margens: {topo:number, esquerda:number, base:number}) => void, ligar: (sim: boolean) => void, ligada: boolean}}
 */
export function criarGrade({ THREE, uniformes, camada, latLonVec }) {
  const rotulos = [];
  for (let i = 0; i < MAX_ROTULOS; i++) { const r = document.createElement('span'); r.className = 'globo-grade-rotulo'; r.hidden = true; camada.append(r); rotulos.push(r); }
  const v = new THREE.Vector3(), olho = new THREE.Vector3();
  const api = { ligada: true, passo: 30 };

  api.ligar = (sim) => { api.ligada = sim; if (!sim) { uniformes.opGrade.value = 0; for (const r of rotulos) r.hidden = true; } };

  /** Passo e opacidade da grade pela distância, e rótulos onde as linhas entram na tela. */
  api.atualizar = (cam, camera, rect, margens) => {
    if (!api.ligada) return;
    const meia = meiaVisao(cam.dist, camera.fov, camera.aspect);
    const linhas = Math.max(3, Math.min(8, rect.width / PX_POR_LINHA));
    const passo = PASSOS.find((p) => p <= (2 * meia) / linhas) ?? PASSOS[PASSOS.length - 1];
    api.passo = passo;
    uniformes.passoGrade.value = passo;
    uniformes.opGrade.value = 1;
    uniformes.latTropico.value = obliquidade(Date.now());
    olho.copy(camera.position);
    let n = 0;
    const c = casas(passo);
    const postos = []; // caixas dos rótulos já postos: nenhum rótulo cobre outro
    const livre = (x, y, w, h) => !postos.some((b) => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h);
    const limite = 1 + 0.25 * (cam.dist - 1); // longe da borda do disco, onde as linhas se apertam
    const visivel = (lat, lon) => {
      latLonVec(lat, lon, 1, v);
      if (v.dot(olho) <= limite) return null;
      v.project(camera);
      if (v.z >= 1) return null;
      return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
    };
    const lonMeia = Math.min(180, meia / Math.max(0.05, Math.cos(Math.min(85, Math.abs(cam.lat)) * RAD)) * 1.4);
    const latMeia = Math.min(90, meia * 1.4);
    // latitudes: ponto mais à esquerda da linha dentro da tela
    const lat0 = Math.ceil((cam.lat - latMeia) / passo) * passo;
    for (let lat = lat0; lat <= cam.lat + latMeia && n < MAX_ROTULOS; lat += passo) {
      if (Math.abs(lat) > 89.999) continue;
      let melhor = null;
      for (let k = 0; k <= AMOSTRAS; k++) {
        const p = visivel(lat, cam.lon - lonMeia + (2 * lonMeia * k) / AMOSTRAS);
        if (p && p.x >= margens.esquerda && p.y > margens.topo + 14 && p.y < rect.height - margens.base && (!melhor || p.x < melhor.x)) melhor = p;
      }
      if (!melhor) continue;
      const t = textoLat(lat, c), x = Math.max(margens.esquerda, melhor.x), w = 8 + t.length * 6.2;
      if (livre(x, melhor.y - 7, w, 14)) { postos.push({ x, y: melhor.y - 7, w, h: 14 }); colocar(rotulos[n++], t, x, melhor.y, 'lat'); }
    }
    // longitudes: ponto mais alto da linha dentro da tela
    const lon0 = Math.ceil((cam.lon - lonMeia) / passo) * passo;
    for (let lon = lon0; lon <= cam.lon + lonMeia && n < MAX_ROTULOS; lon += passo) {
      let melhor = null;
      for (let k = 0; k <= AMOSTRAS; k++) {
        const p = visivel(Math.max(-89, Math.min(89, cam.lat - latMeia + (2 * latMeia * k) / AMOSTRAS)), lon);
        if (p && p.y >= margens.topo && p.y < rect.height - margens.base - 16 && p.x > margens.esquerda + 40 && p.x < rect.width - 70 && (!melhor || p.y < melhor.y)) melhor = p;
      }
      if (!melhor) continue;
      const t = textoLon(lon, c), w = 8 + t.length * 6.2, y = Math.max(margens.topo, melhor.y);
      if (livre(melhor.x - w / 2, y, w, 14)) { postos.push({ x: melhor.x - w / 2, y, w, h: 14 }); colocar(rotulos[n++], t, melhor.x, y, 'lon'); }
    }
    for (let i = n; i < MAX_ROTULOS; i++) rotulos[i].hidden = true;
  };

  function colocar(r, texto, x, y, tipo) {
    if (r.textContent !== texto) r.textContent = texto;
    r.dataset.tipo = tipo;
    r.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    r.hidden = false;
  }
  return api;
}
