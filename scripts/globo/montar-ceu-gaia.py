"""Monta o catálogo de estrelas do Gaia DR3 para a aba Globo (as que o HYG/Hipparcos não tem).

Uso: python3 scripts/globo/montar-ceu-gaia.py vendor/ceu [magnitude_G_maxima]
Roda no GitHub Actions (workflow ceu-gaia.yml), porque o arquivo do Gaia não é acessível do ambiente de
desenvolvimento.

Fonte: ESA Gaia DR3 (Gaia Collaboration 2023), consulta ADQL no serviço TAP do Gaia Archive
(https://gea.esac.esa.int/tap-server/tap), com as distâncias geométricas de Bailer-Jones et al. (2021,
external.gaiaedr3_distance, mediana r_med_geo). As estrelas que já estão no Hipparcos (tabela
gaiadr3.hipparcos2_best_neighbour) ficam de fora, porque o HYG já as traz com nome e tipo espectral.

Conversões para o mesmo formato do HYG (magnitude V e índice B−V, que o shader usa para brilho e cor):
- V a partir de G e BP−RP: G − V = −0,02704 + 0,01424 C − 0,2156 C² + 0,01426 C³ (Riello et al. 2021, tabela C.2,
  válida para −0,5 < C < 2,75).
- B−V a partir de BP−RP: 0,0 → 0,0 e o Sol (BP−RP 0,82) → 0,65; aproximação linear B−V ≈ 0,80·(BP−RP) usada só para a
  cor do ponto, limitada a −0,4…2,5.

Saída: vendor/ceu/estrelas-gaia.bin, colunas little-endian ordenadas por brilho:
  'GDR3', n (uint32), ra uint16[n] (360°/65536), dec int16[n] (90°/32767),
  dist uint16[n] (0 = desconhecida; senão log10(pc) de −1 a 5 em 1..65535), mag int16[n] (V ×100),
  ci int16[n] (B−V ×1000; 32767 = sem cor)
e vendor/ceu/estrelas-gaia.json com a fonte, a consulta e o total.
"""
import csv
import io
import json
import math
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

TAP = 'https://gea.esac.esa.int/tap-server/tap'
MAXREC = 3000000  # sem isso o serviço corta em 50 mil linhas sem avisar


def consulta(gmax):
    return f"""
SELECT g.ra, g.dec, g.phot_g_mean_mag AS g, g.bp_rp, d.r_med_geo
FROM gaiadr3.gaia_source AS g
LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id
LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS h ON h.source_id = g.source_id
WHERE g.phot_g_mean_mag < {gmax} AND h.source_id IS NULL
""".strip()


def tap_async(adql):
    dados = urllib.parse.urlencode({'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': 'csv', 'PHASE': 'RUN', 'MAXREC': str(MAXREC), 'QUERY': adql}).encode()
    req = urllib.request.Request(f'{TAP}/async', data=dados, method='POST')
    with urllib.request.urlopen(req, timeout=120) as r:
        job = r.geturl()
    print('job:', job, flush=True)
    for _ in range(720):  # até 2 h
        with urllib.request.urlopen(f'{job}/phase', timeout=60) as r:
            fase = r.read().decode().strip()
        if fase == 'COMPLETED':
            break
        if fase in ('ERROR', 'ABORTED'):
            with urllib.request.urlopen(f'{job}/error', timeout=60) as r:
                raise RuntimeError(f'consulta falhou: {fase}: {r.read()[:2000]!r}')
        time.sleep(10)
    else:
        raise RuntimeError('consulta demorou demais')
    with urllib.request.urlopen(f'{job}/results/result', timeout=1800) as r:
        return r.read().decode()


def v_de_g(g, c):
    if c is None:
        return g  # sem cor: G ≈ V para estrelas de tipo solar (erro de ~0,1 mag)
    c = max(-0.5, min(2.75, c))
    return g - (-0.02704 + 0.01424 * c - 0.2156 * c * c + 0.01426 * c ** 3)


def main():
    pasta = Path(sys.argv[1])
    gmax = float(sys.argv[2]) if len(sys.argv) > 2 else 10.5
    adql = consulta(gmax)
    texto = tap_async(adql)
    linhas = []
    for r in csv.DictReader(io.StringIO(texto)):
        g = float(r['g'])
        c = float(r['bp_rp']) if r['bp_rp'] else None
        d = float(r['r_med_geo']) if r['r_med_geo'] else None
        linhas.append((v_de_g(g, c), float(r['ra']), float(r['dec']), d, c))
    if len(linhas) in (2000, 50000, MAXREC):
        raise RuntimeError(f'resultado cortado no limite do serviço ({len(linhas)} linhas)')
    linhas.sort(key=lambda x: x[0])
    n = len(linhas)
    ra = [int(round(x[1] / 360 * 65536)) % 65536 for x in linhas]
    dec = [max(-32767, min(32767, int(round(x[2] / 90 * 32767)))) for x in linhas]
    dist = [0 if not x[3] or x[3] <= 0 else 1 + int(round((max(-1, min(5, math.log10(x[3]))) + 1) / 6 * 65534)) for x in linhas]
    mag = [int(round(x[0] * 100)) for x in linhas]
    ci = [32767 if x[4] is None else int(round(max(-0.4, min(2.5, 0.80 * x[4])) * 1000)) for x in linhas]
    with open(pasta / 'estrelas-gaia.bin', 'wb') as f:
        f.write(b'GDR3' + struct.pack('<I', n))
        f.write(struct.pack(f'<{n}H', *ra)); f.write(struct.pack(f'<{n}h', *dec)); f.write(struct.pack(f'<{n}H', *dist))
        f.write(struct.pack(f'<{n}h', *mag)); f.write(struct.pack(f'<{n}h', *ci))
    com_dist = sum(1 for x in dist if x)
    meta = {
        'fonte': 'ESA Gaia DR3 (Gaia Collaboration 2023) e distâncias de Bailer-Jones et al. 2021 (r_med_geo), via Gaia Archive',
        'licenca': 'dados do Gaia: CC BY-SA 3.0 IGO (ESA/Gaia/DPAC)',
        'consulta': adql, 'gMax': gmax, 'n': n, 'comDistancia': com_dist,
        'gerado': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    (pasta / 'estrelas-gaia.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f'{n} estrelas ({com_dist} com distância), V de {linhas[0][0]:.2f} a {linhas[-1][0]:.2f}')


if __name__ == '__main__':
    main()
