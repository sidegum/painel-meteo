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
- Vazios: VoidFinder no SDSS DR7 (Douglass et al. 2023) ou Pan et al. 2012, o que vier.
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
    for l in linhas[i + 3:]:
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
    su = []
    for s in tabela(fontes / 'mscc.tsv'):
        z, ra, dec = numero(s.get('z')), numero(s.get('RAJ2000')), numero(s.get('DEJ2000'))
        if None in (z, ra, dec):
            continue
        membros = [m.strip() for m in s.get('memCl', '').split(',') if m.strip() and m.strip() != '...']
        nome = next((NOMES_SUPER[m[:5]] for m in membros if m[:5] in NOMES_SUPER), None)
        su.append({'id': int(numero(s['Seq'])), 'n': nome, 'ra': ra, 'dec': dec, 'z': z, 'dmax': numero(s.get('dmax')),
                   'nm': int(numero(s.get('Nm')) or 0), 'membros': membros[:12]})
    dados['superaglomerados'] = su
    # vazios
    vz = []
    for nome in ('vazios-douglass.tsv', 'vazios-pan.tsv'):
        if not (fontes / nome).exists():
            continue
        try:
            linhas = tabela(fontes / nome)
        except StopIteration:
            continue
        for v in linhas:
            ra = numero(v.get('RAJ2000') or v.get('_RA') or v.get('RA'))
            dec = numero(v.get('DEJ2000') or v.get('_DE') or v.get('DE'))
            z = numero(v.get('z') or v.get('Z'))
            raio = numero(v.get('Reff') or v.get('R') or v.get('Rad') or v.get('radius'))
            if None in (ra, dec, z, raio):
                continue
            vz.append({'ra': round(ra, 3), 'dec': round(dec, 3), 'z': round(z, 5), 'r': round(raio / H, 2)})  # h⁻¹ Mpc → Mpc
        if vz:
            dados['fontes']['vazios'] = nome
            break
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
    (saida / 'universo.json').write_text(json.dumps(dados, ensure_ascii=False, separators=(',', ':')))
    print('2MRS', len(g2), 'quasares', len(qs), 'UNGC', len(ungc), 'MCXC', len(ag), 'MSCC', len(su),
          'com nome', sum(1 for s in su if s['n']), 'vazios', len(vz), 'bin', len(corpo))


if __name__ == '__main__':
    main()
