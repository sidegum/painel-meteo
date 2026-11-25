"""Monta o mapa da radiação cósmica de fundo para a aba Globo: vendor/ceu/cmb-<largura>.jpg e vendor/ceu/cmb.json.

Uso: python3 scripts/globo/montar-cmb.py vendor/ceu

Fonte: Planck Collaboration, mapa SMICA da temperatura da radiação cósmica de fundo (Planck 2015, PR2,
COM_CMB_IQU-smica_1024_R2.02_full.fits, HEALPix Nside 1024, coordenadas galácticas, K_CMB), no IRSA (NASA/IPAC) ou
no Planck Legacy Archive (ESA). O mapa não tem o monopolo (2,7255 K) nem o dipolo (o efeito do nosso movimento):
mostra só as flutuações de ~1 parte em 100 mil, com o plano da Via Láctea preenchido pelo método SMICA.

Saída: projeção equiretangular em coordenadas galácticas, longitude l de 0° a 360° da esquerda para a direita (coluna
i ↔ l = (i + 0,5)/L × 360°) e latitude b de +90° a −90° de cima para baixo. Escala de cor fixa em ±300 µK, com a
paleta usada pela colaboração Planck (azul frio, creme, vermelho quente), para comparação direta com as imagens oficiais.
"""
import json
import subprocess
import sys
from pathlib import Path

import healpy as hp
import numpy as np
from PIL import Image

URLS = [
    'https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits',
    'https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=COM_CMB_IQU-smica_1024_R2.02_full.fits',
]
LIMITE_UK = 300.0
# paleta (posição de −1 a +1, cor): aproxima Planck_Parchment_RGB (Planck 2013 I, fig. 1)
PALETA = [(-1.0, (0, 0, 255)), (-0.66, (0, 112, 255)), (-0.33, (0, 221, 255)), (0.0, (255, 237, 217)),
          (0.33, (255, 180, 30)), (0.66, (255, 75, 0)), (1.0, (100, 0, 0))]


def baixar(destino):
    for url in URLS:
        r = subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '1200', '-o', str(destino), url])
        if r.returncode == 0 and destino.stat().st_size > 1e8:
            print('baixado', url, destino.stat().st_size)
            return url
    raise SystemExit('não foi possível baixar o mapa do Planck')


def colorir(t_uk):
    x = np.clip(t_uk / LIMITE_UK, -1, 1)
    pos = np.array([p for p, _ in PALETA])
    cores = np.array([c for _, c in PALETA], dtype=np.float64)
    rgb = np.stack([np.interp(x, pos, cores[:, k]) for k in range(3)], axis=-1)
    return rgb.round().astype(np.uint8)


def main():
    pasta = Path(sys.argv[1] if len(sys.argv) > 1 else 'vendor/ceu')
    fits = Path('/tmp/smica.fits')
    url = baixar(fits)
    mapa = hp.read_map(str(fits), field=0)  # temperatura, K_CMB
    nside = hp.get_nside(mapa)
    t_uk = mapa * 1e6
    validos = t_uk[np.abs(t_uk) < 1e4]
    print('nside', nside, 'desvio padrão µK', float(np.std(validos)))
    meta = {'fonte': 'Planck Collaboration 2016 (A&A 594, A9), mapa SMICA PR2 Nside 1024', 'url': url, 'nside': int(nside),
            'limiteMicroK': LIMITE_UK, 'desvioMicroK': round(float(np.std(validos)), 1), 'coordenadas': 'galácticas, equiretangular',
            'arquivos': {}}
    for largura in (4096, 2048):
        altura = largura // 2
        l = (np.arange(largura) + 0.5) / largura * 360.0
        b = 90.0 - (np.arange(altura) + 0.5) / altura * 180.0
        L, B = np.meshgrid(l, b)
        # média de 2×2 amostras por pixel quando o pixel da imagem é maior que o do mapa (evita serrilhado)
        acc = np.zeros(L.shape)
        passo_l, passo_b = 360.0 / largura, 180.0 / altura
        for dl in (-0.25, 0.25):
            for db in (-0.25, 0.25):
                pix = hp.ang2pix(nside, np.radians(90.0 - np.clip(B + db * passo_b, -90, 90)), np.radians((L + dl * passo_l) % 360.0))
                acc += t_uk[pix]
        img = Image.fromarray(colorir(acc / 4.0))
        nome = f'cmb-{largura}.jpg'
        img.save(pasta / nome, quality=90, optimize=True, progressive=True)
        meta['arquivos'][str(largura)] = nome
        print(nome, (pasta / nome).stat().st_size)
    (pasta / 'cmb.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
