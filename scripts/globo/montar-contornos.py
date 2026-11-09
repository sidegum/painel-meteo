"""Monta os contornos vetoriais e as cidades do Globo a partir do Natural Earth 10m (domínio público).

Uso: python3 scripts/globo/montar-contornos.py <pasta-com-os-geojson> vendor/terra

Entradas (https://github.com/nvkelso/natural-earth-vector, pasta geojson/, versão 5.1):
  ne_10m_coastline, ne_10m_lakes, ne_10m_admin_0_boundary_lines_land, ne_10m_admin_1_states_provinces_lines,
  ne_10m_populated_places
Saídas:
  contornos.bin   Int16 [lon, lat, lon, lat, ...] por camada (lon·32767/180, lat·32767/90: ~600 m e ~300 m de passo),
                  cada linha terminada pelo par sentinela (-32768, -32768)
  contornos.json  camadas na ordem do .bin (nome, quantidade de valores) e a tolerância usada
  cidades.json    7 mil localidades com nome em português, país, estado, população e posto (para o zoom)

As linhas são simplificadas por Douglas-Peucker (tolerância em graus) para caber no celular: ~1 km no litoral e nas
fronteiras, que fica abaixo de um pixel até o zoom em que o mapa do OpenStreetMap assume.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ESCALA = np.array([32767 / 180, 32767 / 90])  # graus -> Int16
FIM = -32768                                    # par que encerra cada linha
TOLERANCIA = {'litoral': 0.008, 'lagos': 0.008, 'paises': 0.008, 'estados': 0.012}
PAISES_PT = {
    'Brazil': 'Brasil', 'Argentina': 'Argentina', 'Uruguay': 'Uruguai', 'Paraguay': 'Paraguai', 'Chile': 'Chile', 'Bolivia': 'Bolívia',
    'Peru': 'Peru', 'Colombia': 'Colômbia', 'Venezuela': 'Venezuela', 'Ecuador': 'Equador', 'United States of America': 'Estados Unidos',
    'Mexico': 'México', 'Canada': 'Canadá', 'United Kingdom': 'Reino Unido', 'France': 'França', 'Germany': 'Alemanha', 'Spain': 'Espanha',
    'Portugal': 'Portugal', 'Italy': 'Itália', 'Japan': 'Japão', 'China': 'China', 'India': 'Índia', 'Russia': 'Rússia', 'Australia': 'Austrália',
    'South Africa': 'África do Sul', 'Egypt': 'Egito', 'Nigeria': 'Nigéria', 'Indonesia': 'Indonésia', 'Turkey': 'Turquia', 'Iran': 'Irã',
    'Saudi Arabia': 'Arábia Saudita', 'South Korea': 'Coreia do Sul', 'North Korea': 'Coreia do Norte', 'Philippines': 'Filipinas',
    'Thailand': 'Tailândia', 'Vietnam': 'Vietnã', 'Pakistan': 'Paquistão', 'Bangladesh': 'Bangladesh', 'New Zealand': 'Nova Zelândia',
}


def douglas_peucker(p, tol):
    """Índices mantidos de uma polilinha (n x 2) pela simplificação de Douglas-Peucker, sem recursão."""
    n = len(p)
    if n < 3:
        return np.arange(n)
    manter = np.zeros(n, bool); manter[0] = manter[-1] = True
    pilha = [(0, n - 1)]
    while pilha:
        a, b = pilha.pop()
        if b - a < 2:
            continue
        seg = p[b] - p[a]; comp = math.hypot(*seg)
        meio = p[a + 1:b] - p[a]
        d = np.abs(seg[0] * meio[:, 1] - seg[1] * meio[:, 0]) / comp if comp > 0 else np.hypot(meio[:, 0], meio[:, 1])
        i = int(np.argmax(d))
        if d[i] > tol:
            k = a + 1 + i; manter[k] = True
            pilha += [(a, k), (k, b)]
    return np.nonzero(manter)[0]


def linhas(geojson, filtro=None, aneis=False):
    for f in json.loads(Path(geojson).read_text(encoding='utf-8'))['features']:
        if filtro and not filtro(f['properties']):
            continue
        g = f['geometry']
        if not g:
            continue
        if g['type'] == 'LineString':
            yield g['coordinates']
        elif g['type'] == 'MultiLineString':
            yield from g['coordinates']
        elif aneis and g['type'] == 'Polygon':
            yield from g['coordinates']
        elif aneis and g['type'] == 'MultiPolygon':
            for poli in g['coordinates']:
                yield from poli


def camada(fonte, tol):
    partes, pontos = [], 0
    for l in fonte:
        p = np.asarray(l, dtype=np.float64)[:, :2]
        p = p[douglas_peucker(p, tol)]
        if len(p) < 2:
            continue
        q = np.rint(p * ESCALA).clip(-32767, 32767).astype(np.int16)
        partes.append(q.ravel())
        partes.append(np.array([FIM, FIM], np.int16))
        pontos += len(p)
    return np.concatenate(partes), pontos


def main():
    ent, saida = Path(sys.argv[1]), Path(sys.argv[2])
    saida.mkdir(parents=True, exist_ok=True)
    camadas = [
        ('litoral', linhas(ent / 'ne_10m_coastline.geojson')),
        ('lagos', linhas(ent / 'ne_10m_lakes.geojson', lambda p: (p.get('scalerank') or 99) <= 6, aneis=True)),
        ('paises', linhas(ent / 'ne_10m_admin_0_boundary_lines_land.geojson')),
        ('estados', linhas(ent / 'ne_10m_admin_1_states_provinces_lines.geojson')),
    ]
    blocos, meta = [], []
    for nome, fonte in camadas:
        dados, pontos = camada(fonte, TOLERANCIA[nome])
        blocos.append(dados)
        meta.append({'nome': nome, 'valores': int(dados.size), 'pontos': pontos})
        print(f'{nome}: {pontos} pontos')
    (saida / 'contornos.bin').write_bytes(np.concatenate(blocos).tobytes())
    (saida / 'contornos.json').write_text(json.dumps({
        'fonte': 'Natural Earth 10m (domínio público), simplificado por Douglas-Peucker', 'formato': 'Int16 little-endian, lon*32767/180, lat*32767/90, fim de linha = -32768 -32768',
        'tolerancia': TOLERANCIA, 'camadas': meta,
    }, ensure_ascii=False, indent=1))

    cidades = []
    for f in json.loads((ent / 'ne_10m_populated_places.geojson').read_text(encoding='utf-8'))['features']:
        p = f['properties']
        nome = p.get('NAME_PT') or p.get('NAME')
        if not nome:
            continue
        classe = p.get('FEATURECLA') or ''
        cidades.append([
            nome, round(p['LATITUDE'], 3), round(p['LONGITUDE'], 3), int(p.get('POP_MAX') or 0),
            round(float(p.get('MIN_ZOOM') or 10), 1),
            2 if classe.startswith('Admin-0 capital') else 1 if classe.startswith('Admin-1 capital') else 0,
            PAISES_PT.get(p.get('ADM0NAME'), p.get('ADM0NAME') or ''), p.get('ADM1NAME') or '',
        ])
    cidades.sort(key=lambda c: (c[4], -c[3]))
    (saida / 'cidades.json').write_text(json.dumps({
        'fonte': 'Natural Earth 10m populated places (domínio público)',
        'campos': ['nome', 'lat', 'lon', 'populacao', 'zoomMinimo', 'capital (2 país, 1 estado)', 'pais', 'estado'],
        'cidades': cidades,
    }, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(cidades)} cidades')


if __name__ == '__main__':
    main()
