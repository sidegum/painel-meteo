"""Monta vendor/ceu/galaxia.json (escala de galáxias da aba Globo) a partir dos catálogos brutos em scripts/globo/fontes/.

Uso: python3 scripts/globo/montar-galaxia.py scripts/globo/fontes vendor/ceu

Os catálogos brutos são baixados pelo workflow galaxia-fontes.yml (scripts/globo/baixar-fontes-galaxia.sh):
- Reid et al. 2019 (ApJ 885, 131; VizieR J/ApJ/885/131): paralaxes de masers em regiões de formação de estrelas de alta
  massa medidas por VLBI. Distância = 1/paralaxe, só para paralaxes com erro de até um terço (paralaxe/erro ≥ 3); com
  erro maior, 1/paralaxe é uma estimativa enviesada da distância. O erro vai no cartão.
- Baumgardt & Vasiliev 2021 (MNRAS 505, 5957): distâncias médias dos aglomerados globulares (Gaia EDR3, HST e
  literatura); nomes populares pelo catálogo de Harris (1996, edição 2010; VizieR VII/202).
- McConnachie 2012 (AJ 144, 4; VizieR J/AJ/144/4): galáxias anãs do Grupo Local e vizinhas (distância, raio de meia luz,
  magnitude absoluta, elipticidade e ângulo de posição).
- Discos das quatro galáxias grandes do Grupo Local: inclinação e ângulo de posição medidos (M31: de Vaucouleurs 1958 e
  Walterbos & Kennicutt 1987, i = 77°, AP = 38°; M33: Corbelli & Schneider 1997, i = 55°, AP = 23°; Grande Nuvem:
  van der Marel & Kallivayalil 2014, i = 26°, AP = 154°; Pequena Nuvem: Stanimirović et al. 2004, i = 40°, AP = 45°) e
  raio do disco pelo diâmetro D25 (RC3/OpenNGC) ou, nas Nuvens, pela extensão óptica.
"""
import csv
import json
import math
import sys
from pathlib import Path

BRACOS = {  # códigos da coluna Arm de Reid et al. 2019
    '3kN': 'braço de 3 kpc (próximo)', '3kF': 'braço de 3 kpc (distante)', 'Nor': 'braço de Norma',
    'ScN': 'braço Escudo-Centauro', 'ScF': 'braço Escudo-Centauro (lado distante)', 'CtN': 'braço Escudo-Centauro', 'OSC': 'braço Externo-Escudo-Centauro',
    'SgN': 'braço Sagitário-Carina', 'SgF': 'braço Sagitário-Carina (lado distante)', 'CrN': 'braço Sagitário-Carina',
    'Loc': 'braço Local', 'LoS': 'esporão do braço Local', 'AqS': 'esporão de Áquila', 'Per': 'braço de Perseu',
    'Out': 'braço Externo', 'Con': 'trecho de ligação entre braços', 'GC': 'centro da Galáxia',
}
NOMES_LOCAIS = {
    'Andromeda': 'Galáxia de Andrômeda', 'Triangulum': 'Galáxia do Triângulo', 'LMC': 'Grande Nuvem de Magalhães',
    'SMC': 'Pequena Nuvem de Magalhães', 'Sagittarius dSph': 'Anã de Sagitário', 'Canis Major': 'Sobredensidade do Cão Maior',
    'Draco': 'Anã do Dragão', 'Ursa Minor': 'Anã da Ursa Menor', 'Sculptor': 'Anã do Escultor', 'Sextans (I)': 'Anã do Sextante',
    'Carina': 'Anã de Carina', 'Fornax': 'Anã da Fornalha', 'Leo I': 'Leão I', 'Leo II': 'Leão II', 'NGC 6822': 'Galáxia de Barnard (NGC 6822)',
    'WLM': 'WLM (Wolf-Lundmark-Melotte)', 'M32': 'M32', 'NGC 205': 'M110 (NGC 205)',
}
DISCOS = {  # nome no catálogo: (textura, inclinação, ângulo de posição, raio do disco em kpc, fonte da orientação)
    'Andromeda': ('espiral', 77, 38, None, 'Walterbos & Kennicutt 1987'), 'Triangulum': ('espiral-aberta', 55, 23, None, 'Corbelli & Schneider 1997'),
    'LMC': ('barrada', 26, 154, 4.7, 'van der Marel & Kallivayalil 2014'), 'SMC': ('irregular', 40, 45, 2.7, 'Stanimirović et al. 2004'),
}
NGC = {'Andromeda': 'NGC 224', 'Triangulum': 'NGC 598', 'M32': 'NGC 221', 'NGC 205': 'NGC 205', 'NGC 147': 'NGC 147', 'NGC 185': 'NGC 185', 'NGC 6822': 'NGC 6822', 'IC 10': 'IC 10', 'IC 1613': 'IC 1613'}
TIPOS = {'dSph': 'Galáxia anã esferoidal', 'dIrr': 'Galáxia anã irregular', 'Irr': 'Galáxia irregular', 'cE': 'Galáxia elíptica compacta',
         'Sb': 'Galáxia espiral', 'Sc': 'Galáxia espiral', 'dE/dSph': 'Galáxia anã elíptica',
         '????': 'Concentração de estrelas de natureza ainda debatida (galáxia anã ou parte do disco)', 'dIrr/dSph': 'Galáxia anã de transição'}


def tabela_vizier(caminho, tabela):
    """Linhas de uma tabela de um arquivo asu-tsv do VizieR com várias tabelas (cabeçalho, unidades, traços, dados)."""
    linhas = Path(caminho).read_text(encoding='utf-8', errors='replace').splitlines()
    i = next(k for k, l in enumerate(linhas) if l.startswith(f'#Name: {tabela}'))
    while not linhas[i].startswith('recno'):
        i += 1
    cab = linhas[i].split('\t')
    out = []
    for l in linhas[i + 3:]:
        if not l.strip() or l.startswith('#'):
            break
        out.append({c.strip(): v.strip() for c, v in zip(cab, l.split('\t'))})
    return out


def sexagesimal(ra, dec):
    h, m, s = (float(x) for x in ra.split())
    sinal = -1 if dec.strip().startswith('-') else 1
    d, dm, ds = (abs(float(x)) for x in dec.split())
    return round((h + m / 60 + s / 3600) * 15, 5), round(sinal * (d + dm / 60 + ds / 3600), 5)


def numero(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    fontes, saida = Path(sys.argv[1]), Path(sys.argv[2])
    objetos = {o.get('designacao'): o for o in json.loads((saida / 'objetos.json').read_text())['objetos']}

    masers = []
    for r in tabela_vizier(fontes / 'reid2019-masers.tsv', 'J/ApJ/885/131/table1'):
        plx, e = numero(r['plx']), numero(r['e_plx'])
        if not plx or not e or plx / e < 3:
            continue
        ra, dec = sexagesimal(r['RAJ2000'], r['DEJ2000'])
        nome = r['OName'] or r['Name']
        masers.append({'nome': nome, 'designacao': r['Name'], 'ra': ra, 'dec': dec, 'paralaxe': plx, 'erro': e,
                       'distKpc': round(1 / plx, 3), 'braco': BRACOS.get(r['Arm'])})

    harris = {r['ID'].replace(' ', ''): r['Name'] for r in tabela_vizier(fontes / 'harris2010.tsv', 'VII/202/catalog') if r.get('Name')}
    globulares = []
    for l in (fontes / 'baumgardt-gc.txt').read_text().splitlines():
        if l.startswith('#') or not l.strip():
            continue
        c = l.split()
        ident = c[0].replace('_', ' ')
        popular = harris.get(c[0].replace('_', ''))
        globulares.append({'nome': f'{ident} ({popular})' if popular and popular != ident else ident, 'ra': float(c[1]), 'dec': float(c[2]), 'distKpc': float(c[5]), 'erroKpc': float(c[6])})

    locais = []
    for r in tabela_vizier(fontes / 'mcconnachie2012.tsv', 'J/AJ/144/4/catalog'):
        nome, d = r['Name'], numero(r['D'])
        if nome == 'The Galaxy' or not d:
            continue
        ra, dec = sexagesimal(r['RAJ2000'], r['DEJ2000'])
        rh_min = numero(r.get('R1'))
        it = {'nome': NOMES_LOCAIS.get(nome, nome), 'catalogo': nome, 'ra': ra, 'dec': dec, 'distKpc': d,
              'rhPc': round(d * 1000 * math.tan(math.radians(rh_min / 60)), 1) if rh_min else None,
              'mv': numero(r.get('VMag')), 'tipoMorfologico': r['MType'], 'descricao': TIPOS.get(r['MType'], 'Galáxia do Grupo Local' if (numero(r.get('D(LG)')) or 9e9) < 1800 else 'Galáxia vizinha do Grupo Local'),
              'fonte': 'McConnachie 2012'}
        if nome in NGC:
            it['ngc'] = NGC[nome]
        if nome in DISCOS:
            tex, inc, pa, raio, ref = DISCOS[nome]
            if raio is None:
                dim = max(float(x) for x in objetos[NGC[nome]]['dim'].split('x'))
                raio = d * math.tan(math.radians(dim / 2 / 60))
            it.update({'disco': tex, 'inclinacao': inc, 'pa': pa, 'raioKpc': round(raio, 2), 'fonte': f'McConnachie 2012 · disco: {ref}'})
        locais.append(it)

    dados = {
        'fontes': {
            'masers': 'Reid et al. 2019, ApJ 885, 131 (VizieR J/ApJ/885/131)',
            'globulares': 'Baumgardt & Vasiliev 2021, MNRAS 505, 5957; nomes de Harris 1996 (edição 2010, VizieR VII/202)',
            'grupoLocal': 'McConnachie 2012, AJ 144, 4 (VizieR J/AJ/144/4); discos: ver scripts/globo/montar-galaxia.py',
        },
        'masers': masers, 'globulares': globulares, 'grupoLocal': locais,
    }
    (saida / 'galaxia.json').write_text(json.dumps(dados, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(masers)} masers, {len(globulares)} aglomerados globulares, {len(locais)} galáxias do Grupo Local e vizinhas')


if __name__ == '__main__':
    main()
