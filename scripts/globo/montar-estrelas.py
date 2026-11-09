"""Monta vendor/ceu/estrelas.json a partir do HYG Database v4.1 e das linhas de constelações já presentes no arquivo.

Uso: python3 scripts/globo/montar-estrelas.py hygdata_v41.csv vendor/ceu/estrelas.json
Fonte: https://github.com/astronexus/HYG-Database (hyg/CURRENT/hygdata_v41.csv, CC BY-SA 4.0).
- Estrelas até a magnitude 6,5, ordenadas por brilho (o app filtra pela magnitude cortando o trecho desenhado).
- Posições J2000 levadas à época 2026,0 pelo movimento próprio do Hipparcos (pmra já multiplicado por cos δ).
- Distância desconhecida (100000 pc no HYG) vira null, junto da magnitude absoluta e da luminosidade.
"""
import csv
import json
import math
import sys

EPOCA = 2026.0


def num(v, casas):
    try:
        return round(float(v), casas)
    except ValueError:
        return None


def main(origem, destino):
    antigo = json.load(open(destino, encoding='utf-8'))
    dt = EPOCA - 2000.0
    estrelas, textos = [], []
    for r in csv.DictReader(open(origem, encoding='utf-8')):
        if r['id'] == '0' or float(r['mag']) > 6.5:
            continue
        ra, dec = float(r['ra']) * 15, float(r['dec'])
        pmra, pmdec = float(r['pmra'] or 0), float(r['pmdec'] or 0)
        dec2 = dec + pmdec * dt / 3.6e6
        ra2 = (ra + pmra * dt / 3.6e6 / max(math.cos(math.radians(dec)), 1e-6)) % 360
        dist = float(r['dist'])
        conhecida = 0 < dist < 100000
        estrelas.append([round(ra2, 4), round(dec2, 4), round(float(r['mag']), 2), num(r['ci'], 3),
                         float(f'{dist:.4g}') if conhecida else None,
                         num(r['absmag'], 2) if conhecida else None,
                         int(r['hip']) if r['hip'] else None, int(r['hd']) if r['hd'] else None,
                         float(f"{float(r['lum']):.3g}") if conhecida and r['lum'] else None])
        textos.append([r['proper'], r['bayer'], r['flam'], r['con'], r['spect'], r['var']])
    ordem = sorted(range(len(estrelas)), key=lambda i: estrelas[i][2])
    saida = {
        'fonte': 'HYG Database v4.1 (David Nash, astronexus, CC BY-SA 4.0): Hipparcos, Yale BSC e Gliese, até magnitude 6,5, '
                 'posições J2000 levadas à época 2026,0 pelo movimento próprio; linhas das constelações do d3-celestial '
                 '(Olaf Frohn, BSD-3-Clause)',
        'epoca': EPOCA,
        'colunas': ['ra', 'dec', 'mag', 'ci', 'dist_pc', 'absmag', 'hip', 'hd', 'lum_sol'],
        'colunasTexto': ['nome', 'bayer', 'flamsteed', 'constelacao', 'espectro', 'variavel'],
        'estrelas': [estrelas[i] for i in ordem], 'textos': [textos[i] for i in ordem],
        'constelacoes': antigo['constelacoes'],
    }
    json.dump(saida, open(destino, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(estrelas), 'estrelas')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
