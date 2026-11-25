#!/usr/bin/env python3
"""Reduz os catálogos de estrutura em grande escala do BOSS DR12 (CMASSLOWZTOT, norte e sul) a uma amostra regular.

Uso: reduzir-boss.py <pasta> <passo>
Lê <pasta>/boss-North.fits.gz e boss-South.fits.gz e grava <pasta>/boss.tsv (RA, DEC, Z), 1 galáxia a cada <passo>.
"""
import os
import sys

import numpy as np
from astropy.io import fits


def main():
    pasta, passo = sys.argv[1], int(sys.argv[2])
    partes = []
    for hemi in ('North', 'South'):
        caminho = os.path.join(pasta, f'boss-{hemi}.fits.gz')
        if not os.path.exists(caminho):
            print('faltou', caminho)
            continue
        with fits.open(caminho, memmap=False) as hd:
            t = hd[1].data
            print(hemi, len(t), 'galáxias; colunas', t.columns.names[:12])
            partes.append(np.column_stack([t['RA'], t['DEC'], t['Z']])[::passo])
    if not partes:
        sys.exit(1)
    tudo = np.vstack(partes)
    with open(os.path.join(pasta, 'boss.tsv'), 'w') as g:
        g.write('RA\tDEC\tZ\n')
        for ra, de, z in tudo:
            g.write(f'{ra:.4f}\t{de:.4f}\t{z:.4f}\n')
    print('boss.tsv', len(tudo), 'linhas')


if __name__ == '__main__':
    main()
