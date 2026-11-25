#!/usr/bin/env python3
"""Reduz uma tabela TSV do VizieR (asu-tsv com todas as colunas) às colunas pedidas, com amostragem regular.

Uso: reduzir-tsv.py <entrada> <saida> <passo> <coluna>...
  passo: fica 1 linha a cada <passo> (1 = todas).
  coluna: nomes candidatos; ficam os que existirem no cabeçalho, na ordem pedida. O cabeçalho completo vai para o
  registro do workflow, para conferir os nomes.
"""
import sys


def main():
    entrada, saida, passo, *pedidas = sys.argv[1:]
    passo = int(passo)
    cab, idx, n, gravadas = None, [], 0, 0
    with open(entrada, encoding='utf-8', errors='replace') as f, open(saida, 'w', encoding='utf-8') as g:
        for linha in f:
            if linha.startswith('#') or not linha.strip():
                continue
            campos = linha.rstrip('\n').split('\t')
            if cab is None:
                cab = campos
                print('cabeçalho:', ' '.join(cab))
                idx = [cab.index(c) for c in pedidas if c in cab]
                g.write('\t'.join(cab[i] for i in idx) + '\n')
                continue
            if set(linha.strip()) <= set('-\t ') or len(campos) < len(cab):
                continue  # linha de unidades/traços
            n += 1
            if n % passo:
                continue
            valores = [campos[i].strip() for i in idx]
            if n <= 2 * passo and not valores[0].replace('.', '').replace('-', '').replace('+', '').strip().isdigit():
                continue  # linha de unidades
            g.write('\t'.join(valores) + '\n')
            gravadas += 1
    print(f'{saida}: {gravadas} de {n} linhas, colunas {[cab[i] for i in idx]}')


if __name__ == '__main__':
    main()
