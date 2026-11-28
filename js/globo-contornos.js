// Contornos vetoriais da Terra no globo: litoral, lagos, fronteiras de países e divisas de estados (Natural Earth 10 m,
// domínio público; vendor/terra, montado por scripts/globo/montar-contornos.py).
//
// Por que vetores: a imagem da NASA tem 2,4 km por pixel no 4096 e, de perto, as bordas viram borrão; as linhas
// ficam com 1 pixel de espessura em qualquer zoom, de dia, de noite e por cima das nuvens e das camadas de dados.
// Quando o mapa do OpenStreetMap assume (zoom de cidade), as linhas somem aos poucos, porque o mapa já traz as suas.
//
// Profundidade: cada vértice é desenhado na própria posição, mas a profundidade é puxada 0,05% em direção à câmera ao
// longo do raio de visão (a posição na tela não muda). Assim a linha nunca briga com a superfície do globo e o lado de
// trás da Terra continua escondido pela própria Terra, em qualquer distância.

const ALTURA = 1.00002; // ~130 m acima do raio 1: acima das faces da esfera (malha 256 x 192), sem paralaxe visível

/** Estilo de cada camada: cor, opacidade e a faixa de distância da câmera (raios da Terra) em que aparece. */
const ESTILO = {
  litoral: { cor: [0.86, 0.91, 0.96], alfa: 0.5, ate: Infinity },
  lagos: { cor: [0.70, 0.83, 0.95], alfa: 0.4, ate: 4 },
  paises: { cor: [1.0, 0.92, 0.72], alfa: 0.62, ate: Infinity },
  estados: { cor: [0.82, 0.86, 0.92], alfa: 0.3, ate: 2.4 },
};

const VERTEX = /* glsl */`
  uniform vec3 olho; uniform float puxar;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 p = projectionMatrix * mv;
    // profundidade de um ponto um pouco mais perto no mesmo raio de visão (xy na tela iguais)
    vec4 q = projectionMatrix * vec4(mv.xyz * (1.0 - puxar), 1.0);
    gl_Position = vec4(p.xy, q.z / q.w * p.w, p.w);
  }`;
const FRAGMENT = /* glsl */`
  uniform vec3 cor; uniform float alfa;
  void main() { gl_FragColor = vec4(cor, alfa); }`;

/**
 * Cria os contornos, vazios até carregar() trazer os dados (1,7 MB, depois das texturas da Terra).
 * atualizar(dist, mapa) acerta a opacidade a cada quadro pela distância da câmera e pela força do mapa detalhado.
 * @param {typeof import('three')} THREE
 * @returns {{grupo: object, carregar: () => Promise<void>, atualizar: (dist:number, mapa:number) => void, ligado: boolean}}
 */
export function criarContornos(THREE) {
  const grupo = new THREE.Group();
  grupo.name = 'contornos';
  grupo.renderOrder = 4; // depois das nuvens (transparentes, ordem 0), antes dos marcadores (10)
  const camadas = [];
  const base = new URL('../vendor/terra/', import.meta.url);
  let pronto = null;
  const carregar = () => pronto || (pronto = Promise.all([
    fetch(new URL('contornos.json', base)).then((r) => { if (!r.ok) throw new Error(`contornos: erro ${r.status}`); return r.json(); }),
    fetch(new URL('contornos.bin', base)).then((r) => { if (!r.ok) throw new Error(`contornos: erro ${r.status}`); return r.arrayBuffer(); }),
  ]).then(([meta, buf]) => {
    const todos = new Int16Array(buf);
    let ini = 0;
    for (const c of meta.camadas) {
      const estilo = ESTILO[c.nome];
      const dados = todos.subarray(ini, ini + c.valores);
      ini += c.valores;
      if (!estilo) continue;
      const linha = new THREE.LineSegments(geometria(THREE, dados, c.pontos), new THREE.ShaderMaterial({
        uniforms: { cor: { value: new THREE.Color(...estilo.cor) }, alfa: { value: 0 }, puxar: { value: 0.0005 } },
        vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
      }));
      linha.frustumCulled = false; // a esfera inteira: o teste de profundidade já corta o lado de trás
      linha.renderOrder = 4;
      linha.userData = { nome: c.nome, estilo };
      grupo.add(linha);
      camadas.push(linha);
    }
  }).catch((e) => { pronto = null; throw e; })); // sem memorizar a falha: dá para tentar de novo
  const api = {
    grupo, carregar, ligado: true,
    atualizar(dist, mapa) {
      for (const l of camadas) {
        const e = l.userData.estilo;
        const perto = e.ate === Infinity ? 1 : 1 - suave(e.ate * 0.8, e.ate, dist);
        l.material.uniforms.alfa.value = e.alfa * perto * (1 - 0.92 * mapa) * (api.ligado ? 1 : 0);
        l.visible = l.material.uniforms.alfa.value > 0.005;
      }
    },
  };
  return api;
}

/** Int16 [lon, lat, ...] com fim de linha (-32768, -32768) -> posições na esfera e pares de índices (segmentos). */
function geometria(THREE, d, pontos) {
  const pos = new Float32Array(pontos * 3);
  const idx = new Uint32Array(pontos * 2);
  const RAD = Math.PI / 180, kLon = 180 / 32767 * RAD, kLat = 90 / 32767 * RAD;
  let n = 0, k = 0, inicioLinha = true;
  for (let i = 0; i < d.length; i += 2) {
    if (d[i] === -32768) { inicioLinha = true; continue; }
    const lo = d[i] * kLon, la = d[i + 1] * kLat, cl = Math.cos(la);
    pos[n * 3] = ALTURA * cl * Math.cos(lo); pos[n * 3 + 1] = ALTURA * Math.sin(la); pos[n * 3 + 2] = -ALTURA * cl * Math.sin(lo);
    if (!inicioLinha) { idx[k++] = n - 1; idx[k++] = n; }
    inicioLinha = false;
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
  return g;
}

const suave = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
