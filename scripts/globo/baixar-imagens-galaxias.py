#!/usr/bin/env python3
"""Baixa fotografias reais de galáxias do Wikimedia Commons e prepara as texturas da escala de galáxias do Globo.

Uso: baixar-imagens-galaxias.py <manifesto.json> <pasta de saída>

Para cada galáxia do manifesto (scripts/globo/imagens-galaxias.json):
1. Procura o primeiro arquivo candidato que existe no Commons e lê de lá autor, crédito e licença. Só entram
   licenças livres (domínio público, CC0, CC BY, CC BY-SA).
2. Baixa a versão de 2048 px, escurece o fundo (o céu vira preto, para a imagem se somar à cena sem moldura) e apaga
   as bordas em degradê. Grava <id>.jpg (até 2048 px) e <id>-1024.jpg (celular).
3. Mede a galáxia na própria imagem pelos momentos da luz: centro, ângulo do eixo maior e tamanhos, usados pelo app
   para alinhar a foto com o ângulo de posição do catálogo.
4. Busca no HyperLEDA (VizieR VII/237) o diâmetro D25, a razão de eixos e o ângulo de posição da galáxia.
Saída: galaxias.json com tudo isso, e uma folha de contato (contato.jpg) para conferência visual.
"""
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
AGENTE = {'User-Agent': 'globo-ceu/1.0 (GitHub Actions; uso educacional)'}
LIVRES = ('public domain', 'pd', 'cc0', 'cc by', 'cc-by', 'cc by-sa', 'cc-by-sa')
VIZIER = ('https://vizier.cfa.harvard.edu', 'https://vizier.cds.unistra.fr')


def buscar(url, tentativas=3):
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENTE), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (rede: tenta de novo e registra)
            print('  falhou', url[:110], e)
            time.sleep(3 * (i + 1))
    return None


def texto_puro(html):
    import re
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html or '')).strip()


def no_commons(titulo):
    """Endereço da miniatura de 2048 px e metadados de um arquivo do Commons, ou None."""
    url = ('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata'
           '&iiurlwidth=2048&titles=' + urllib.parse.quote('File:' + titulo))
    bruto = buscar(url)
    if not bruto:
        return None
    pag = next(iter(json.loads(bruto)['query']['pages'].values()))
    if 'imageinfo' not in pag:
        return None
    ii = pag['imageinfo'][0]
    m = ii.get('extmetadata', {})
    v = lambda k: texto_puro(m.get(k, {}).get('value', ''))
    return {'arquivo': titulo, 'url': ii.get('thumburl') or ii['url'], 'pagina': ii.get('descriptionurl'), 'largura': ii.get('width'), 'altura': ii.get('height'),
            'licenca': v('LicenseShortName'), 'autor': v('Artist')[:160], 'credito': v('Credit')[:200]}


def leda(ra, dec):
    """logD25, logR25 e PA do HyperLEDA (VizieR VII/237) para a galáxia mais brilhante a até 3' da posição."""
    for base in VIZIER:
        url = (f'{base}/viz-bin/asu-tsv?-source=VII/237/pgc&-out=PGC,RAJ2000,DEJ2000,MType,logD25,logR25,PA,ANames&-out.max=20'
               f'&-c={ra:.4f}%20{dec:+.4f}&-c.rm=3&-sort=-logD25')
        bruto = buscar(url, 2)
        if not bruto:
            continue
        linhas = [l for l in bruto.decode('utf-8', 'replace').splitlines() if l and not l.startswith('#')]
        if len(linhas) < 4:
            continue
        cab = [c.strip() for c in linhas[0].split('\t')]
        d = dict(zip(cab, (c.strip() for c in linhas[3].split('\t'))))
        num = lambda k: float(d[k]) if d.get(k, '').replace('.', '').replace('-', '').strip().isdigit() else None
        return {'pgc': d.get('PGC'), 'tipo': d.get('MType') or None, 'logD25': num('logD25'), 'logR25': num('logR25'), 'pa': num('PA'), 'nomes': d.get('ANames', '')[:80]}
    return None


def preparar(img):
    """Fundo preto, bordas em degradê e medidas da galáxia. Devolve (imagem, medidas)."""
    img = img.convert('RGB')
    if max(img.size) > 2048:
        f = 2048 / max(img.size)
        img = img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32) / 255
    lum = a.mean(axis=2)
    fundo = float(np.percentile(lum, 12))
    a = np.clip((a - fundo * 1.05) / max(1e-3, 1 - fundo * 1.05), 0, 1)
    h, w = lum.shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # degradê nas bordas: 1 no miolo, 0 na moldura (12% de cada lado)
    borda = np.minimum(np.minimum(x, w - 1 - x) / (0.12 * w), np.minimum(y, h - 1 - y) / (0.12 * h))
    a *= np.clip(borda, 0, 1)[..., None] ** 1.5
    # momentos da luz difusa (mediana 9 px apaga as estrelas pontuais)
    from PIL import ImageFilter
    peq = Image.fromarray((np.clip(a.mean(axis=2), 0, 1) * 255).astype(np.uint8)).resize((w // 4 or 1, h // 4 or 1), Image.BILINEAR).filter(ImageFilter.MedianFilter(9))
    p = np.asarray(peq).astype(np.float32)
    p = np.clip(p - np.percentile(p, 50), 0, None)
    hh, ww = p.shape
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    s = p.sum() or 1
    cx, cy = (p * xx).sum() / s, (p * yy).sum() / s
    mxx, myy, mxy = (p * (xx - cx) ** 2).sum() / s, (p * (yy - cy) ** 2).sum() / s, (p * (xx - cx) * (yy - cy)).sum() / s
    mxx, myy, mxy = float(mxx), float(myy), float(mxy)
    t = 0.5 * math.atan2(2 * mxy, mxx - myy)
    comum = math.sqrt(((mxx - myy) / 2) ** 2 + mxy ** 2)
    smaior, smenor = math.sqrt((mxx + myy) / 2 + comum), math.sqrt(max(1e-6, (mxx + myy) / 2 - comum))
    medidas = {'largura': w, 'altura': h, 'centro': [round(float(cx) / ww, 4), round(float(cy) / hh, 4)],
               'anguloEixoMaior': round(math.degrees(t), 1),  # graus a partir do eixo x da imagem, sentido horário na tela (y para baixo)
               'sigmaMaior': round(smaior / ww, 4), 'sigmaMenor': round(smenor / ww, 4), 'fundo': round(fundo, 3)}
    return Image.fromarray((a * 255).astype(np.uint8)), medidas


def main():
    manifesto, saida = Path(sys.argv[1]), Path(sys.argv[2])
    saida.mkdir(parents=True, exist_ok=True)
    feitas, miniaturas = [], []
    for g in json.loads(manifesto.read_text())['galaxias']:
        print(g['id'])
        info = None
        for titulo in g['arquivos']:
            info = no_commons(titulo)
            if info and any(l in info['licenca'].lower() for l in LIVRES):
                break
            if info:
                print('  licença não livre:', titulo, info['licenca'])
            info = None
        if not info:
            print('  SEM IMAGEM:', g['arquivos'])
            continue
        bruto = buscar(info['url'])
        if not bruto:
            continue
        try:
            img, medidas = preparar(Image.open(io.BytesIO(bruto)))
        except Exception as e:  # noqa: BLE001
            print('  imagem inválida', e)
            continue
        img.save(saida / f"{g['id']}.jpg", quality=88, optimize=True)
        f = 1024 / max(img.size)
        peq = img if f >= 1 else img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
        peq.save(saida / f"{g['id']}-1024.jpg", quality=86, optimize=True)
        cat = leda(g['ra'], g['dec'])
        feitas.append({'id': g['id'], 'nome': g['nome'], 'ra': g['ra'], 'dec': g['dec'], **{k: info[k] for k in ('arquivo', 'pagina', 'licenca', 'autor', 'credito')},
                       'imagem': medidas, 'leda': cat})
        print('  ok', info['arquivo'], '|', info['licenca'], '|', info['autor'][:60], '|', medidas, '|', cat)
        mini = img.copy()
        mini.thumbnail((256, 256))
        miniaturas.append(mini)
        time.sleep(1)
    (saida / 'galaxias.json').write_text(json.dumps({'fonte': 'Wikimedia Commons (autor e licença de cada imagem em cada entrada); medidas do HyperLEDA (Makarov et al. 2014; VizieR VII/237)',
                                                      'galaxias': feitas}, ensure_ascii=False, indent=1))
    if miniaturas:
        col = 6
        folha = Image.new('RGB', (col * 256, math.ceil(len(miniaturas) / col) * 256))
        for i, m in enumerate(miniaturas):
            folha.paste(m, ((i % col) * 256 + (256 - m.width) // 2, (i // col) * 256 + (256 - m.height) // 2))
        folha.save(saida / 'contato.jpg', quality=80)
    print(len(feitas), 'galáxias com imagem')


if __name__ == '__main__':
    main()
