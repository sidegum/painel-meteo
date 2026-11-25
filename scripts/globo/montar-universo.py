"""Monta a escala do universo da aba Globo (vendor/ceu/universo.json e vendor/ceu/universo.bin) a partir dos catálogos
brutos em scripts/globo/fontes/universo/ (baixados pelo workflow universo-fontes.yml).

Uso: python3 scripts/globo/montar-universo.py scripts/globo/fontes/universo vendor/ceu

Fontes e regras:
- Distâncias pelo desvio para o vermelho (z) usam a mesma cosmologia do app (js/cosmologia.js): ΛCDM plano do Planck
  2018 (H0 = 67,66 km/s/Mpc, Ωm = 0,3111, radiação por T0 = 2,7255 K). A distância é a comóvel (onde o objeto está
  hoje). Coordenadas: J2000 → galácticas pela matriz do Hipparcos (ESA 1997, vol. 1, §1.5.3).
- 2MRS (Huchra et al. 2012): velocidade heliocêntrica passada para o referencial da radiação cósmica de fundo (dipolo do
  Planck 2018: 369,82 km/s para l = 264,021°, b = 48,253°). Galáxias com cz < 600 km/s (até ~9 Mpc) ficam de fora: ali
  o movimento próprio domina a velocidade e quem as representa é o catálogo de Karachentsev, com distância medida. As
  distâncias pelo desvio para o vermelho alongam os aglomerados na linha de visada ("dedos de Deus"); o cartão avisa.
- Karachentsev et al. 2013 (UNGC): distância medida (cefeidas, ponta do ramo das gigantes vermelhas, Tully-Fisher...).
- MCXC (Piffaretti et al. 2011): aglomerados de galáxias em raios X, com massa M500 e raio R500.
- MSCC (Chow-Martínez et al. 2014): superaglomerados de aglomerados de Abell; nomes populares pelos membros
  (NOMES_SUPER: um superaglomerado leva o nome se contiver o aglomerado de referência).
- Vazios: VoidFinder no SDSS DR7 (Douglass et al. 2023), esfera máxima de cada vazio, cosmologia do Planck 2018.
- SDSS DR16Q (Lyke et al. 2020): amostra regular de 1 em 8 quasares (a amostra completa tem ~750 mil).
"""
import json
import math
import struct
import sys
from pathlib import Path

C_KMS = 299792.458
H0, OMEGA_M = 67.66, 0.3111
H = H0 / 100
OMEGA_R = 2.469e-5 * (1 + 0.2271 * 3.046) / (H * H)
OMEGA_L = 1 - OMEGA_M - OMEGA_R
DH = C_KMS / H0
DIPOLO = (369.82, 264.021, 48.253)  # km/s, l, b (Planck 2018 I)
EQ_GAL = [[-0.0548755604, -0.8734370902, -0.4838350155],
          [0.4941094279, -0.4448296300, 0.7469822445],
          [-0.8676661490, -0.1980763734, 0.4559837762]]

# superaglomerados com nome popular, pelo aglomerado de Abell de referência que contêm
NOMES_SUPER = {
    'A3558': 'Superaglomerado de Shapley', 'A2151': 'Superaglomerado de Hércules', 'A2065': 'Superaglomerado de Corona Borealis',
    'A1656': 'Superaglomerado de Coma', 'A0426': 'Superaglomerado de Perseu-Peixes', 'A3266': 'Superaglomerado Horologium-Reticulum',
    'A1185': 'Superaglomerado de Leão',
}


def E(z):
    a = 1 + z
    return math.sqrt(OMEGA_R * a ** 4 + OMEGA_M * a ** 3 + OMEGA_L)


class Cosmologia:
    """Tabela de Dc(z) em ln(1+z), integrada por Simpson (mesmo esquema de js/cosmologia.js)."""

    def __init__(self, z_max=20.0, n=20000):
        self.dx = math.log1p(z_max) / n
        self.tab = [0.0]
        f = lambda x: math.exp(x) / E(math.expm1(x))
        for i in range(1, n + 1):
            a = (i - 1) * self.dx
            self.tab.append(self.tab[-1] + self.dx / 6 * (f(a) + 4 * f(a + self.dx / 2) + f(a + self.dx)))
        self.n = n

    def dc(self, z):
        if z <= 0:
            return 0.0
        x = math.log1p(z) / self.dx
        i = min(int(x), self.n - 1)
        t = x - i
        return DH * (self.tab[i] + (self.tab[i + 1] - self.tab[i]) * t)


COSMO = Cosmologia()


def galactica(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    e = (math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d))
    return [sum(l[k] * e[k] for k in range(3)) for l in EQ_GAL]


def unitario_lb(l, b):
    l, b = math.radians(l), math.radians(b)
    return (math.cos(b) * math.cos(l), math.cos(b) * math.sin(l), math.sin(b))


APEX = unitario_lb(DIPOLO[1], DIPOLO[2])


def v_cmb(ra, dec, cz_hel):
    g = galactica(ra, dec)
    return cz_hel + DIPOLO[0] * sum(g[k] * APEX[k] for k in range(3))


def tabela(caminho):
    """Linhas de um arquivo asu-tsv do VizieR com uma tabela (cabeçalho, unidades, traços, dados)."""
    linhas = [l for l in Path(caminho).read_text(encoding='utf-8', errors='replace').splitlines()]
    i = next(k for k, l in enumerate(linhas) if l and not l.startswith('#'))
    cab = [c.strip() for c in linhas[i].split('\t')]
    out = []
    inicio = i + 3 if len(linhas) > i + 2 and linhas[i + 2].startswith('-') else i + 1  # reduzido por reduzir-tsv.py: só o cabeçalho
    for l in linhas[inicio:]:
        if not l.strip():
            continue
        if l.startswith('#'):
            break
        out.append({c: v.strip() for c, v in zip(cab, l.split('\t'))})
    return out


def numero(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def sexagesimal(ra, dec):
    if numero(ra) is not None and numero(dec) is not None:
        return float(ra), float(dec)
    h, m, s = (float(x) for x in ra.split())
    sinal = -1 if dec.strip().startswith('-') else 1
    d, dm, ds = (abs(float(x)) for x in dec.split())
    return 15 * (h + m / 60 + s / 3600), sinal * (d + dm / 60 + ds / 3600)


def r(v, casas):
    return None if v is None else round(v, casas)


def montar_2mrs(pasta):
    pontos = []
    for g in tabela(pasta / '2mrs.tsv'):
        ra, dec, cz, k = numero(g.get('RAJ2000')), numero(g.get('DEJ2000')), numero(g.get('cz')), numero(g.get('Ktmag'))
        if None in (ra, dec, cz):
            continue
        v = v_cmb(ra, dec, cz)
        if v < 600:
            continue
        z = v / C_KMS
        d = COSMO.dc(z)
        t = g.get('type', '').strip()
        try:
            tt = int(t[:2]) if t[:2].strip().lstrip('-').isdigit() else int(t[:1])
        except ValueError:
            tt = 99
        mk = None if k is None else k - 5 * math.log10((1 + z) * d) - 25
        x, y, w = (c * d for c in galactica(ra, dec))
        pontos.append((x, y, w, mk, tt))
    return pontos


def montar_quasares(pasta):
    out = []
    for q in tabela(pasta / 'dr16q.tsv'):
        ra, dec, z = numero(q.get('RAJ2000')), numero(q.get('DEJ2000')), numero(q.get('z'))
        if None in (ra, dec, z) or z <= 0.05 or z > 7.7:
            continue
        d = COSMO.dc(z)
        x, y, w = (c * d for c in galactica(ra, dec))
        out.append((x, y, w, z))
    return out


def lb(ra, dec):
    """Longitude e latitude galácticas (graus) de uma direção equatorial J2000."""
    x, y, z = galactica(ra, dec)
    return math.degrees(math.atan2(y, x)) % 360, math.degrees(math.asin(max(-1, min(1, z))))


def montar_levantamentos(pasta, g2):
    """6dFGS, SDSS (amostra principal) e BOSS: pontos (x, y, z em Mpc, fonte), sem repetir as galáxias do 2MRS.

    A distância é a comóvel do desvio para o vermelho no referencial da radiação cósmica de fundo (mesma conta do 2MRS).
    fonte: 0 = 6dFGS, 1 = SDSS, 2 = BOSS.
    """
    # grade de direções do 2MRS (células de 0,05°) para não desenhar a mesma galáxia duas vezes
    celula = lambda x, y, z, d: (round(math.degrees(math.atan2(y, x)) * 20), round(math.degrees(math.asin(max(-1, min(1, z)))) * 20), round(d / 6))
    vistos = set()
    for p in g2:
        d = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
        vistos.add(celula(p[0] / d, p[1] / d, p[2] / d, d))
    pontos, contagem = [], [0, 0, 0]

    def juntar(ra, dec, z, fonte):
        if not 0.002 < z < 1.2:
            return
        x, y, zg = galactica(ra, dec)
        d = COSMO.dc(z)
        if fonte < 2 and celula(x, y, zg, d) in vistos:
            return
        pontos.append((x * d, y * d, zg * d, fonte))
        contagem[fonte] += 1

    for g in tabela(pasta / '6dfgs.tsv'):
        cz = numero(g.get('cz'))
        if cz is None or g.get('q_cz', '').strip() not in ('3', '4'):
            continue  # só desvios para o vermelho confiáveis (qualidade 3 ou 4)
        ra, dec = sexagesimal(g['RAJ2000'], g['DEJ2000'])
        juntar(ra, dec, v_cmb(ra, dec, cz) / C_KMS, 0)
    for g in tabela(pasta / 'sdss.tsv'):
        ra, dec, z = numero(g.get('RAJ2000')), numero(g.get('DEJ2000')), numero(g.get('zcmb'))
        if None not in (ra, dec, z):
            juntar(ra, dec, z, 1)
    for g in tabela(pasta / 'boss.tsv'):
        ra, dec, z = numero(g.get('RA')), numero(g.get('DEC')), numero(g.get('Z'))
        if None not in (ra, dec, z):
            juntar(ra, dec, v_cmb(ra, dec, z * C_KMS) / C_KMS, 2)
    return pontos, contagem


def montar_via_lactea(pasta):
    """Objetos da Via Láctea com distância: aglomerados estelares, pulsares e estrelas com planetas."""
    out = {}
    # aglomerados estelares: só a amostra confiável do artigo (CST > 5σ e classe do diagrama cor-magnitude > 0,5)
    ae = []
    for c in tabela(pasta / 'aglomerados-estelares.tsv'):
        cst, cmd, d = numero(c.get('CST')), numero(c.get('CMDCl50')), numero(c.get('dist50'))
        if c.get('Type', '').strip() == 'g' or None in (cst, cmd, d) or cst <= 5 or cmd <= 0.5:
            continue
        ae.append([c['Name'].strip().replace('_', ' '), r(numero(c['GLON']), 3), r(numero(c['GLAT']), 3), round(d), r(numero(c.get('logAge50')), 2),
                   r(numero(c.get('r50pc')), 1), int(numero(c.get('N')) or 0), 1 if c.get('Type', '').strip() == 'm' else 0])
    out['aglomeradosEstelares'] = {'colunas': ['nome', 'l', 'b', 'distPc', 'logIdade', 'r50Pc', 'estrelas', 'grupoMovel'], 'linhas': ae}
    # pulsares com distância estimada
    ps = []
    for p in tabela(pasta / 'pulsares.tsv'):
        d, l, b = numero(p.get('Dist')), numero(p.get('GLON')), numero(p.get('GLAT'))
        if None in (d, l, b) or d <= 0:
            continue
        assoc = p.get('Assoc', '').strip()
        onde = next((a.split(':', 1)[1].split('[')[0].replace('_', ' ') for a in assoc.split(',') if a.startswith(('GC:', 'SNR:', 'EXGAL:'))), None)
        ps.append([p['PSRJ'].strip(), r(l, 2), r(b, 2), r(d, 2), r(numero(p.get('P0')), 5), r(numero(p.get('DM')), 1),
                   1 if p.get('Binary', '').strip() else 0, numero(p.get('Age')), onde])
    out['pulsares'] = {'colunas': ['nome', 'l', 'b', 'distKpc', 'periodoS', 'dm', 'binario', 'idadeAnos', 'associacao'], 'linhas': ps}
    # exoplanetas agrupados por estrela
    import csv
    sistemas = {}
    with open(pasta / 'exoplanetas.csv', newline='', encoding='utf-8') as f:
        for e in csv.DictReader(f):
            d, ra, dec = numero(e.get('sy_dist')), numero(e.get('ra')), numero(e.get('dec'))
            if None in (d, ra, dec) or d <= 0:
                continue
            l, b = lb(ra, dec)
            s = sistemas.setdefault(e['hostname'], {'n': e['hostname'], 'l': round(l, 4), 'b': round(b, 4), 'd': round(d, 2), 't': numero(e.get('st_teff')),
                                                    'v': r(numero(e.get('sy_vmag')), 1), 'p': []})
            ano = numero(e.get('disc_year'))
            s['p'].append([e['pl_name'], r(numero(e.get('pl_rade')), 2), r(numero(e.get('pl_bmasse')), 2), r(numero(e.get('pl_orbper')), 3),
                           r(numero(e.get('pl_orbsmax')), 4), r(numero(e.get('pl_eqt')), 0), int(ano) if ano else None, e.get('discoverymethod') or None])
    for s in sistemas.values():
        s['p'].sort(key=lambda p: (p[4] is None, p[4] or 0, p[0]))
    out['exoplanetas'] = {'colunasPlaneta': ['nome', 'raioTerras', 'massaTerras', 'periodoDias', 'semieixoUA', 'tempEquilibrioK', 'ano', 'metodo'],
                          'sistemas': sorted(sistemas.values(), key=lambda s: s['d'])}
    out['fontes'] = {
        'aglomeradosEstelares': 'Hunt & Reffert 2023, A&A 673, A114 (Gaia DR3; VizieR J/A+A/673/A114), amostra confiável',
        'pulsares': 'Manchester et al. 2005, AJ 129, 1993 (catálogo ATNF, edição do VizieR B/psr); distância pela medida de dispersão quando não há paralaxe',
        'exoplanetas': 'NASA Exoplanet Archive, Planetary Systems Composite Parameters (consulta de 2026-11-25)',
    }
    return out


def main():
    fontes, saida = Path(sys.argv[1]), Path(sys.argv[2])
    dados = {
        'fontes': {
            '2mrs': 'Huchra et al. 2012, ApJS 199, 26 (2MASS Redshift Survey; VizieR J/ApJS/199/26)',
            'ungc': 'Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (VizieR J/AJ/145/101)',
            'mcxc': 'Piffaretti et al. 2011, A&A 534, A109 (VizieR J/A+A/534/A109)',
            'mscc': 'Chow-Martínez et al. 2014, MNRAS 445, 4073 (VizieR J/MNRAS/445/4073)',
            'quasares': 'Lyke et al. 2020, ApJS 250, 8 (SDSS DR16Q; VizieR VII/289), amostra de 1 em 8',
            'cosmologia': 'Planck Collaboration 2020, A&A 641, A6 (H0 = 67,66; Ωm = 0,3111)',
        },
    }
    # galáxias próximas com distância medida
    ungc = []
    for g in tabela(fontes / 'ungc.tsv'):
        d = numero(g.get('Dist'))
        if d is None:
            continue
        ra, dec = sexagesimal(g['RAJ2000'], g['DEJ2000'])
        ungc.append({'n': g['Name'].strip(), 'ra': round(ra, 4), 'dec': round(dec, 4), 'd': round(d, 3), 'm': g.get('f_Dist', '').strip() or None,
                     'tt': numero(g.get('TT')), 'diam': r(numero(g.get('A26')), 2), 'MB': r(numero(g.get('BMag')), 1),
                     'lk': r(numero(g.get('KLum')), 2), 'hi': r(numero(g.get('MHI')), 2), 'ba': r(numero(g.get('b/a')), 2)})
    dados['ungc'] = ungc
    # aglomerados em raios X
    ag = []
    for c in tabela(fontes / 'mcxc.tsv'):
        z = numero(c.get('z'))
        if z is None:
            continue
        ra, dec = sexagesimal(c['RAJ2000'], c['DEJ2000'])
        ag.append({'n': c['MCXC'].strip(), 'o': c.get('OName', '').strip() or None, 'a': c.get('AName', '').strip() or None,
                   'ra': round(ra, 4), 'dec': round(dec, 4), 'z': z, 'm': r(numero(c.get('M500')), 3), 'r': r(numero(c.get('R500')), 3),
                   'l': r(numero(c.get('L500')), 3)})
    dados['aglomerados'] = ag
    # superaglomerados
    su, usados = [], set()
    for s in tabela(fontes / 'mscc.tsv'):
        z, ra, dec = numero(s.get('z')), numero(s.get('RAJ2000')), numero(s.get('DEJ2000'))
        if None in (z, ra, dec):
            continue
        membros = [m.strip() for m in s.get('memCl', '').split(',') if m.strip() and m.strip() != '...']
        nome = next((NOMES_SUPER[m[:5]] for m in membros if m[:5] in NOMES_SUPER), None)
        nome = None if nome in usados else nome  # um nome por superaglomerado (o primeiro da lista)
        usados.add(nome)
        su.append({'id': int(numero(s['Seq'])), 'n': nome, 'ra': ra, 'dec': dec, 'z': z, 'dmax': numero(s.get('dmax')),
                   'nm': int(numero(s.get('Nm')) or 0), 'membros': membros[:12]})
    dados['superaglomerados'] = su
    # vazios: esfera máxima de cada vazio (centro, distância comóvel s e raio efetivo Reff, em h⁻¹ Mpc)
    vz = []
    for v in tabela(fontes / 'vazios.tsv'):
        ra, dec, s_, reff = (numero(v.get(k)) for k in ('RAJ2000', 'DEJ2000', 's', 'Reff'))
        if None in (ra, dec, s_, reff) or v.get('Cosmo', 'Planck2018') != 'Planck2018':
            continue
        vz.append({'ra': round(ra, 3), 'dec': round(dec, 3), 'd': round(s_ / H, 1), 'r': round(reff / H, 1), 'borda': v.get('edge') == '1'})
    dados['fontes']['vazios'] = 'Douglass et al. 2023, ApJS 265, 7 (VoidFinder no SDSS DR7; VizieR J/ApJS/265/7)'
    dados['vazios'] = vz
    # nuvens de pontos (binário)
    g2 = montar_2mrs(fontes)
    qs = montar_quasares(fontes) if (fontes / 'dr16q.tsv').exists() else []
    e2 = max(max(abs(c) for c in p[:3]) for p in g2) * 1.0001
    eq = max([max(abs(c) for c in p[:3]) for p in qs] or [1]) * 1.0001
    q16 = lambda v, e: max(-32767, min(32767, round(v / e * 32767)))
    corpo = bytearray(b'UNV1') + struct.pack('<IIff', len(g2), len(qs), e2, eq)
    for p in g2:
        corpo += struct.pack('<hhh', q16(p[0], e2), q16(p[1], e2), q16(p[2], e2))
    for p in g2:  # magnitude absoluta K em décimos, deslocada: byte = (M_K + 30) × 10, 0 = desconhecida
        corpo += struct.pack('<B', 0 if p[3] is None else max(1, min(255, round((p[3] + 30) * 10))))
    for p in g2:  # tipo morfológico T (de Vaucouleurs), 99 = desconhecido
        corpo += struct.pack('<b', max(-9, min(99, p[4])))
    for p in qs:
        corpo += struct.pack('<hhh', q16(p[0], eq), q16(p[1], eq), q16(p[2], eq))
    for p in qs:
        corpo += struct.pack('<H', min(65535, round(p[3] * 1000)))
    (saida / 'universo.bin').write_bytes(bytes(corpo))
    dados['binario'] = {'n2mrs': len(g2), 'nQuasares': len(qs), 'escala2mrs': e2, 'escalaQuasares': eq,
                        'formato': "'UNV1', n2mrs, nQuasares (uint32), escala2mrs, escalaQuasares (float32, Mpc); 2MRS: x, y, z int16 "
                                   "(× escala/32767, galácticas a partir do Sol: x para o centro, y para l = 90°, z para o polo norte), "
                                   "M_K uint8 ((M+30)×10; 0 = sem), T int8; quasares: x, y, z int16, z ×1000 uint16"}
    # levantamentos profundos: binário próprio (o app carrega junto com o universo)
    if (fontes / 'sdss.tsv').exists():
        lev, cont = montar_levantamentos(fontes, g2)
        el_ = max(max(abs(c) for c in p[:3]) for p in lev) * 1.0001
        corpo_l = bytearray(b'LEV1') + struct.pack('<If', len(lev), el_)
        for p in lev:
            corpo_l += struct.pack('<hhh', q16(p[0], el_), q16(p[1], el_), q16(p[2], el_))
        corpo_l += bytes(p[3] for p in lev)
        (saida / 'levantamentos.bin').write_bytes(bytes(corpo_l))
        dados['levantamentos'] = {'n': len(lev), 'escala': el_, 'porFonte': {'6dfgs': cont[0], 'sdss': cont[1], 'boss': cont[2]},
                                  'formato': "'LEV1', n (uint32), escala (float32, Mpc); x, y, z int16 (como no 2MRS); fonte uint8 (0 = 6dFGS, 1 = SDSS, 2 = BOSS)"}
        dados['fontes'].update({
            '6dfgs': 'Jones et al. 2009, MNRAS 399, 683 (6dF Galaxy Survey DR3; VizieR VII/259), qualidade 3 e 4',
            'sdss': 'Tempel et al. 2014, A&A 566, A1 (SDSS DR10, amostra principal; VizieR J/A+A/566/A1), amostra de 1 em 3',
            'boss': 'Reid et al. 2016, MNRAS 455, 1553 (BOSS DR12, CMASS + LOWZ), amostra de 1 em 8',
        })
        print('levantamentos', len(lev), cont, 'escala', round(el_), 'Mpc')
    if (fontes / 'exoplanetas.csv').exists():
        vl = montar_via_lactea(fontes)
        (saida / 'catalogos.json').write_text(json.dumps(vl, ensure_ascii=False, separators=(',', ':')))
        print('aglomerados estelares', len(vl['aglomeradosEstelares']['linhas']), 'pulsares', len(vl['pulsares']['linhas']),
              'sistemas planetários', len(vl['exoplanetas']['sistemas']), 'planetas', sum(len(s['p']) for s in vl['exoplanetas']['sistemas']))
    (saida / 'universo.json').write_text(json.dumps(dados, ensure_ascii=False, separators=(',', ':')))
    print('2MRS', len(g2), 'quasares', len(qs), 'UNGC', len(ungc), 'MCXC', len(ag), 'MSCC', len(su),
          'com nome', sum(1 for s in su if s['n']), 'vazios', len(vz), 'bin', len(corpo))


if __name__ == '__main__':
    main()
