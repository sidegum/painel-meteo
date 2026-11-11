"""Monta o céu profundo da aba Globo: estrelas além do olho nu e os objetos de céu profundo.

Uso: python3 scripts/globo/montar-ceu-profundo.py hygdata_v41.csv messier.json vendor/ceu NGC.csv addendum.csv
Fontes:
- HYG Database v4.1 (https://github.com/astronexus/HYG-Database, hyg/CURRENT/hygdata_v41.csv, CC BY-SA 4.0).
- d3-celestial (https://github.com/ofrohn/d3-celestial, data/messier.json, BSD-3-Clause).
- OpenNGC (https://github.com/mattiaverga/OpenNGC, database_files/NGC.csv e addendum.csv, CC BY-SA 4.0): os objetos
  NGC e IC que não são de Messier nem estão entre os extras.

Saídas em vendor/ceu:
- estrelas-profundas.bin: as 110.705 estrelas do HYG mais fracas que a magnitude 6,5 (as mais brilhantes estão em
  estrelas.json), ordenadas por brilho, em colunas binárias little-endian:
    'HYG1', n (uint32), hip uint32[n], ra uint16[n] (360°/65536), dec int16[n] (90°/32767),
    dist uint16[n] (0 = desconhecida; senão log10(pc) de −1 a 5 em 1..65535), mag int16[n] (×100),
    ci int16[n] (×1000; 32767 = sem índice), classe uint8[n] (posição em CLASSES; 255 = sem tipo)
  Posições J2000 levadas à época 2026,0 pelo movimento próprio, como em montar-estrelas.py.
- estrelas-profundas.json: nomes das que têm nome próprio ou designação de Gliese (índice → [nome, gliese]).
- objetos.json: os 110 objetos de Messier e objetos austrais famosos fora do catálogo, com tipo, magnitude, tamanho,
  nome em português e distância publicada quando conhecida (ver DISTANCIAS_ANOS_LUZ); depois, os objetos NGC/IC do
  OpenNGC (sem nome próprio; galáxias com distância pelo desvio para o vermelho quando z > 0,003, lei de Hubble com
  H0 = 70 km/s/Mpc; abaixo disso o movimento próprio da galáxia pesa demais e a distância fica em branco).
"""
import csv
import json
import math
import struct
import sys
from pathlib import Path


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


def objetos(origem, pasta, ngc=()):
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
    if ngc:
        saida += objetos_ngc(ngc, saida)
    json.dump({'fonte': 'Catálogo de Messier (d3-celestial, Olaf Frohn, BSD-3-Clause), objetos austrais famosos e OpenNGC (Mattia Verga, CC BY-SA 4.0); distâncias publicadas, arredondadas, ou pelo desvio para o vermelho',
               'objetos': saida}, open(pasta / 'objetos.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(saida), 'objetos de céu profundo')


# Tipos do OpenNGC para os tipos usados no app (TIPOS_OBJETO em js/globo-estrelas.js); os ausentes (estrelas, duplicatas,
# objetos inexistentes ou sem classificação) ficam de fora.
TIPOS_NGC = {'OCl': 'oc', 'GCl': 'gc', 'PN': 'pn', 'Neb': 'bn', 'HII': 'en', 'EmN': 'en', 'Cl+N': 'sfr', '*Ass': 'pos',
             'RfN': 'rn', 'SNR': 'snr', 'GPair': 'gg', 'GTrpl': 'gg', 'GGroup': 'gg'}


def tipo_galaxia(hubble):
    h = (hubble or '').strip()
    if h.startswith('S0') or h.startswith('E-S0'):
        return 'l'
    if h.startswith('E'):
        return 'e'
    if h.startswith('I'):
        return 'i'
    return 's'


def sexagesimal(texto, horas):
    sinal = -1 if texto.strip().startswith('-') else 1
    a, b, c = (abs(float(x)) for x in texto.strip().lstrip('+-').split(':'))
    return sinal * (a + b / 60 + c / 3600) * (15 if horas else 1)


def designacao_ngc(nome):
    for prefixo in ('NGC', 'IC'):
        if nome.startswith(prefixo) and nome[len(prefixo):].split(' ')[0].isdigit():
            resto = nome[len(prefixo):]
            num = resto.split(' ')[0]
            return f'{prefixo} {int(num)}{resto[len(num):]}'
    return nome


def objetos_ngc(arquivos, existentes):
    ja = {o['designacao'] for o in existentes}
    saida = []
    for arq in arquivos:
        for r in csv.DictReader(open(arq, encoding='utf-8'), delimiter=';'):
            tipo = 'g' if r['Type'] == 'G' else TIPOS_NGC.get(r['Type'])
            if not tipo or r['M'].strip() or not r['RA'] or not r['Dec']:
                continue
            desig = designacao_ngc(r['Name'])
            if desig in ja:
                continue
            if tipo == 'g':
                tipo = tipo_galaxia(r['Hubble'])
            mag = r['V-Mag'] or r['B-Mag']
            maior, menor = r['MajAx'], r['MinAx']
            dim = f'{float(maior):g}x{float(menor):g}' if maior and menor else (f'{float(maior):g}' if maior else '')
            z = float(r['Redshift']) if r['Redshift'] else None
            dist = round(z * 299792.458 / 70 * 3.26156e6, -4) if tipo in ('s', 'e', 'i', 'l', 'gg') and z and z > 0.003 else None
            ob = {'id': desig.replace(' ', '').lower(), 'nome': '', 'designacao': desig, 'tipo': tipo,
                  'ra': round(sexagesimal(r['RA'], True) % 360, 4), 'dec': round(sexagesimal(r['Dec'], False), 4),
                  'mag': round(float(mag), 1) if mag else None, 'dim': dim, 'distAnosLuz': dist}
            if dist:
                ob['distFonte'] = 'z'
            if r['Common names'].strip():
                ob['apelidos'] = r['Common names'].strip().replace(',', ', ')
            saida.append(ob)
            ja.add(desig)
    print(len(saida), 'objetos do OpenNGC')
    return saida


if __name__ == '__main__':
    destino = Path(sys.argv[3])
    estrelas(sys.argv[1], destino)
    objetos(sys.argv[2], destino, sys.argv[4:])
