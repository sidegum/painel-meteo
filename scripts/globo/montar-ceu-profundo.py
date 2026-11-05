"""Monta o céu profundo da aba Globo: estrelas além do olho nu, a Via Láctea e os objetos de céu profundo.

Uso: python3 scripts/globo/montar-ceu-profundo.py hygdata_v41.csv messier.json mw.json vendor/ceu
Fontes:
- HYG Database v4.1 (https://github.com/astronexus/HYG-Database, hyg/CURRENT/hygdata_v41.csv, CC BY-SA 4.0).
- d3-celestial (https://github.com/ofrohn/d3-celestial, data/messier.json e data/mw.json, BSD-3-Clause).

Saídas em vendor/ceu:
- estrelas-profundas.bin: as 110.705 estrelas do HYG mais fracas que a magnitude 6,5 (as mais brilhantes estão em
  estrelas.json), ordenadas por brilho, em colunas binárias little-endian:
    'HYG1', n (uint32), hip uint32[n], ra uint16[n] (360°/65536), dec int16[n] (90°/32767),
    dist uint16[n] (0 = desconhecida; senão log10(pc) de −1 a 5 em 1..65535), mag int16[n] (×100),
    ci int16[n] (×1000; 32767 = sem índice), classe uint8[n] (posição em CLASSES; 255 = sem tipo)
  Posições J2000 levadas à época 2026,0 pelo movimento próprio, como em montar-estrelas.py.
- estrelas-profundas.json: nomes das que têm nome próprio ou designação de Gliese (índice → [nome, gliese]).
- via-lactea.png: brilho da Via Láctea (contornos de 5 níveis de mw.json), equiretangular 2048×1024 em tons de cinza,
  coluna = 0,5 + AR/360 (a mesma convenção de longitude da esfera do Three.js), linha 0 = declinação +90°.
- objetos.json: os 110 objetos de Messier e objetos austrais famosos fora do catálogo, com tipo, magnitude, tamanho,
  nome em português e distância publicada quando conhecida (ver DISTANCIAS_ANOS_LUZ).
"""
import csv
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

EPOCA = 2026.0
CLASSES = 'OBAFGKMCSNWDLTY'

# Nomes em português dos objetos de Messier que têm nome popular (o restante fica como "M n").
NOMES_PT = {
    'M1': 'Nebulosa do Caranguejo', 'M6': 'Aglomerado da Borboleta', 'M7': 'Aglomerado de Ptolomeu', 'M8': 'Nebulosa da Lagoa',
    'M11': 'Aglomerado do Pato Selvagem', 'M13': 'Grande Aglomerado de Hércules', 'M16': 'Nebulosa da Águia', 'M17': 'Nebulosa Ômega',
    'M20': 'Nebulosa Trífida', 'M24': 'Nuvem Estelar de Sagitário', 'M27': 'Nebulosa do Haltere', 'M31': 'Galáxia de Andrômeda',
    'M33': 'Galáxia do Triângulo', 'M42': 'Nebulosa de Órion', 'M44': 'Presépio', 'M45': 'Plêiades', 'M51': 'Galáxia do Rodamoinho',
    'M57': 'Nebulosa do Anel', 'M63': 'Galáxia do Girassol', 'M64': 'Galáxia do Olho Negro', 'M76': 'Pequena Nebulosa do Haltere',
    'M77': 'Cetus A', 'M81': 'Galáxia de Bode', 'M82': 'Galáxia do Charuto', 'M83': 'Cata-vento do Sul', 'M87': 'Virgo A',
    'M94': 'Galáxia do Olho de Gato', 'M97': 'Nebulosa da Coruja', 'M101': 'Galáxia do Cata-vento', 'M104': 'Galáxia do Sombreiro',
}

# Objetos famosos fora do catálogo de Messier (coordenadas J2000 em graus, magnitude visual, tamanho em minutos de arco).
EXTRAS = [
    ('lmc', 'Grande Nuvem de Magalhães', 'LMC', 'i', 80.894, -69.756, 0.9, '650x550'),
    ('smc', 'Pequena Nuvem de Magalhães', 'SMC', 'i', 13.187, -72.829, 2.7, '320x185'),
    ('ngc5139', 'Ômega Centauri', 'NGC 5139', 'gc', 201.697, -47.480, 3.9, '36'),
    ('ngc104', '47 Tucanae', 'NGC 104', 'gc', 6.024, -72.081, 4.1, '31'),
    ('ngc3372', 'Nebulosa de Carina', 'NGC 3372', 'sfr', 161.265, -59.867, 1.0, '120x120'),
    ('ngc2070', 'Nebulosa da Tarântula', 'NGC 2070', 'sfr', 84.676, -69.101, 8.0, '40x25'),
    ('ngc4755', 'Caixinha de Joias', 'NGC 4755', 'oc', 193.413, -60.362, 4.2, '10'),
    ('ngc5128', 'Centaurus A', 'NGC 5128', 'e', 201.365, -43.019, 6.8, '26x20'),
    ('ngc253', 'Galáxia do Escultor', 'NGC 253', 's', 11.888, -25.288, 7.2, '27x7'),
    ('mel25', 'Híades', 'Melotte 25', 'oc', 66.75, 15.87, 0.5, '330'),
    ('ic2602', 'Plêiades do Sul', 'IC 2602', 'oc', 160.75, -64.4, 1.9, '50'),
]

# Distâncias publicadas (anos-luz), arredondadas; as demais ficam sem distância no cartão.
DISTANCIAS_ANOS_LUZ = {
    'M1': 6500, 'M4': 7200, 'M6': 1600, 'M7': 980, 'M8': 4100, 'M11': 6200, 'M13': 22200, 'M22': 10600, 'M27': 1360,
    'M31': 2.5e6, 'M33': 2.73e6, 'M35': 2800, 'M41': 2300, 'M42': 1344, 'M44': 577, 'M45': 444, 'M51': 23e6, 'M57': 2570,
    'M81': 11.8e6, 'M82': 12e6, 'M83': 15e6, 'M87': 53.5e6, 'M101': 21e6, 'M104': 31e6,
    'lmc': 160000, 'smc': 200000, 'ngc5139': 17000, 'ngc104': 14700, 'ngc3372': 7500, 'ngc2070': 160000, 'ngc4755': 6400,
    'ngc5128': 12e6, 'ngc253': 11.4e6, 'mel25': 153, 'ic2602': 479,
}


def epoca(r):
    dt = EPOCA - 2000.0
    ra, dec = float(r['ra']) * 15, float(r['dec'])
    pmra, pmdec = float(r['pmra'] or 0), float(r['pmdec'] or 0)
    return (ra + pmra * dt / 3.6e6 / max(math.cos(math.radians(dec)), 1e-6)) % 360, dec + pmdec * dt / 3.6e6


def estrelas(origem, pasta):
    linhas = [r for r in csv.DictReader(open(origem, encoding='utf-8')) if r['id'] != '0' and float(r['mag']) > 6.5]
    linhas.sort(key=lambda r: float(r['mag']))
    n = len(linhas)
    hip, ra, dec, dist, mag, ci, classe, nomes = [], [], [], [], [], [], [], {}
    for k, r in enumerate(linhas):
        a, d = epoca(r)
        hip.append(int(r['hip']) if r['hip'] else 0)
        ra.append(round(a / 360 * 65536) % 65536)
        dec.append(max(-32767, min(32767, round(d / 90 * 32767))))
        pc = float(r['dist'])
        dist.append(0 if not 0 < pc < 100000 else max(1, min(65535, round((math.log10(max(pc, 0.1)) + 1) / 6 * 65534) + 1)))
        mag.append(round(float(r['mag']) * 100))
        ci.append(max(-32000, min(32000, round(float(r['ci']) * 1000))) if r['ci'] else 32767)
        letra = (r['spect'] or ' ')[0].upper()
        classe.append(CLASSES.index(letra) if letra in CLASSES else 255)
        if r['proper'] or r['gl']:
            nomes[k] = [r['proper'], r['gl']]
    with open(pasta / 'estrelas-profundas.bin', 'wb') as f:
        f.write(b'HYG1' + struct.pack('<I', n))
        f.write(struct.pack(f'<{n}I', *hip))
        f.write(struct.pack(f'<{n}H', *ra)); f.write(struct.pack(f'<{n}h', *dec)); f.write(struct.pack(f'<{n}H', *dist))
        f.write(struct.pack(f'<{n}h', *mag)); f.write(struct.pack(f'<{n}h', *ci)); f.write(struct.pack(f'<{n}B', *classe))
    json.dump({'fonte': 'HYG Database v4.1 (David Nash, astronexus, CC BY-SA 4.0), estrelas mais fracas que a magnitude 6,5',
               'n': n, 'classes': CLASSES, 'nomes': nomes},
              open(pasta / 'estrelas-profundas.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(n, 'estrelas profundas,', len(nomes), 'com nome ou designação de Gliese')


def via_lactea(origem, pasta):
    """Cada nível de contorno é rasterizado por paridade (evenodd) de todos os anéis. Um anel que dá a volta no céu
    (soma das variações de longitude de ±360°) é fechado pela borda de baixo; o "ou exclusivo" de dois desses anéis é a
    faixa entre eles, o que dispensa saber de que lado fica o polo."""
    W, H = 2048, 1024
    soma = np.zeros((H, W), np.float32)
    for f in json.load(open(origem, encoding='utf-8'))['features']:
        nivel = np.zeros((H, W), bool)
        for poligono in f['geometry']['coordinates']:
            for anel in poligono:
                lon = [anel[0][0]]
                for a, _ in anel[1:]:
                    d = (a - lon[-1] + 540) % 360 - 180
                    lon.append(lon[-1] + d)
                volta = round((lon[-1] - lon[0] + (anel[0][0] - anel[-1][0] + 540) % 360 - 180) / 360)
                pts = [((0.5 + x / 360) * W, (90 - lat) / 180 * H) for x, (_, lat) in zip(lon, anel)]
                if volta:  # dá a volta: fecha pela borda de baixo, cobrindo as três cópias da longitude
                    pts = [(x + k * W * volta, y) for k in (-1, 0, 1) for x, y in pts]
                    pts += [(pts[-1][0], H + 2), (pts[0][0], H + 2)]
                mascara = Image.new('1', (W, H), 0)
                desenho = ImageDraw.Draw(mascara)
                for k in ((0,) if volta else (-1, 0, 1)):
                    desenho.polygon([(x + k * W, y) for x, y in pts], fill=1)
                nivel ^= np.array(mascara, bool)
        soma += nivel * 48.0
    img = Image.fromarray(np.clip(soma, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(3))
    img.save(pasta / 'via-lactea.png', optimize=True)
    print('via-lactea.png', (pasta / 'via-lactea.png').stat().st_size, 'bytes')


def objetos(origem, pasta):
    saida = []
    for f in json.load(open(origem, encoding='utf-8'))['features']:
        p = f['properties']
        ra, dec = f['geometry']['coordinates']
        mag = float(p['mag']) if str(p['mag']).strip() else None
        saida.append({'id': p['name'], 'nome': NOMES_PT.get(p['name'], ''), 'designacao': p['desig'], 'tipo': p['type'],
                      'ra': round(ra % 360, 4), 'dec': round(dec, 4), 'mag': mag, 'dim': str(p['dim']).strip(),
                      'distAnosLuz': DISTANCIAS_ANOS_LUZ.get(p['name'])})
    for chave, nome, desig, tipo, ra, dec, mag, dim in EXTRAS:
        saida.append({'id': chave, 'nome': nome, 'designacao': desig, 'tipo': tipo, 'ra': ra, 'dec': dec, 'mag': mag, 'dim': dim,
                      'distAnosLuz': DISTANCIAS_ANOS_LUZ.get(chave)})
    json.dump({'fonte': 'Catálogo de Messier (d3-celestial, Olaf Frohn, BSD-3-Clause) e objetos austrais famosos; distâncias publicadas, arredondadas',
               'objetos': saida}, open(pasta / 'objetos.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(saida), 'objetos de céu profundo')


if __name__ == '__main__':
    destino = Path(sys.argv[4])
    estrelas(sys.argv[1], destino)
    objetos(sys.argv[2], destino)
    via_lactea(sys.argv[3], destino)
