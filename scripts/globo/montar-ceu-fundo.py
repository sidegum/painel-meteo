"""Monta a Via Láctea do céu de fundo a partir do NASA SVS Deep Star Maps 2020 (domínio público, NASA/Goddard).

Uso: python3 scripts/globo/montar-ceu-fundo.py vendor/ceu

Fonte: https://svs.gsfc.nasa.gov/4851 (Ernie Wright, NASA/Goddard Scientific Visualization Studio). O mapa "milkyway" é a
luz difusa da Galáxia sem as estrelas individuais, feita com as contagens do Gaia DR2 (1,7 bilhão de estrelas), em
projeção equirretangular e coordenadas celestes. As estrelas do app (HYG e Gaia DR3) continuam desenhadas por cima.

Saídas (convenção do app: coluna 0 em AR 0h, AR crescendo para a direita; linha 0 em +90° de declinação):
  via-lactea-ceu-8192.jpg  8192 x 4096 (computador)
  via-lactea-ceu-4096.jpg  4096 x 2048 (celular)
  via-lactea-ceu.json      fonte, arquivo baixado, orientação detectada e estatísticas
A orientação do arquivo original (AR para a esquerda ou direita, 0h na borda ou no centro) é detectada pelo brilho
no centro da Galáxia (AR 266,4°, dec −28,9°), que é a região mais brilhante do mapa.
"""
import json
import re
import urllib.parse
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

PAGINA = 'https://svs.gsfc.nasa.gov/4851'
CENTRO_GALAXIA = (266.405, -28.936)  # AR e dec J2000 (Sgr A*)
POLO_NORTE_GALACTICO = (192.859, 27.128)
Image.MAX_IMAGE_PIXELS = None


def log(*a):
    print(*a, flush=True)


def baixar(url, destino=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'painel-meteo/1.0 (GitHub Actions)'})
    with urllib.request.urlopen(req, timeout=600) as r:
        dados = r.read()
    if destino:
        Path(destino).write_bytes(dados)
    return dados


def escolher_arquivo():
    """Lista os arquivos da página do SVS e escolhe o mapa da Via Láctea em coordenadas celestes, 8k ou o menor acima."""
    html = baixar(PAGINA).decode('utf-8', 'replace')
    links = sorted(set(re.findall(r'href="([^"]+\.(?:exr|tif|tiff|png|jpg))"', html, re.I)))
    log('Arquivos na página:', len(links))
    for l in links:
        log('  ', l)
    candidatos = []
    for l in links:
        nome = l.rsplit('/', 1)[-1].lower()
        if 'milkyway' not in nome or 'gal' in nome.replace('galaxy', '') or 'thumb' in nome or 'print' in nome or 'searchweb' in nome:
            continue
        m = re.search(r'(\d+)k', nome)
        k = int(m.group(1)) if m else 0
        ext = nome.rsplit('.', 1)[-1]
        candidatos.append((0 if k == 8 else 1 if k == 16 else 2 if k == 4 else 3, 0 if ext == 'exr' else 1 if ext.startswith('tif') else 2, l))
    if not candidatos:
        raise SystemExit('Nenhum mapa "milkyway" encontrado na página do SVS')
    candidatos.sort()
    url = candidatos[0][2]
    return url if url.startswith('http') else urllib.parse.urljoin(PAGINA, url)


def ler_imagem(caminho):
    ext = caminho.suffix.lower()
    if ext == '.exr':
        import OpenEXR
        with OpenEXR.File(str(caminho)) as f:
            canais = f.channels()
            log('Canais do EXR:', list(canais.keys()))
            if 'RGB' in canais:
                return np.asarray(canais['RGB'].pixels, dtype=np.float32)
            if 'RGBA' in canais:
                return np.asarray(canais['RGBA'].pixels, dtype=np.float32)[..., :3]
            return np.dstack([np.asarray(canais[c].pixels, dtype=np.float32) for c in ('R', 'G', 'B')])
    if ext in ('.tif', '.tiff'):
        import tifffile
        a = tifffile.imread(str(caminho)).astype(np.float32)
        return a[..., :3] if a.ndim == 3 else np.dstack([a] * 3)
    return np.asarray(Image.open(caminho).convert('RGB'), dtype=np.float32) / 255.0


def media_em(lum, ra, dec, ra0_centro, ra_direita):
    """Brilho médio numa janela de 4° em volta de (ra, dec) para uma convenção de orientação."""
    H, W = lum.shape
    u = ((ra - (180 if ra0_centro else 0)) / 360) % 1.0
    if not ra_direita:
        u = (1 - u) % 1.0
    x, y = int(u * W), int((90 - dec) / 180 * H)
    r = max(2, int(2 / 360 * W))
    xs = [(x + d) % W for d in range(-r, r + 1)]
    return float(lum[max(0, y - r):y + r + 1][:, xs].mean())


def main():
    saida = Path(sys.argv[1])
    saida.mkdir(parents=True, exist_ok=True)
    url = escolher_arquivo()
    log('Baixando', url)
    tmp = Path('/tmp') / url.rsplit('/', 1)[-1]
    baixar(url, tmp)
    log('Tamanho', tmp.stat().st_size)
    img = ler_imagem(tmp)
    img = np.nan_to_num(np.maximum(img, 0), nan=0.0, posinf=0.0)
    H, W, _ = img.shape
    log('Imagem', W, 'x', H, 'mín', float(img.min()), 'máx', float(img.max()))
    lum = img.mean(axis=2)

    # orientação: o centro da Galáxia é mais brilhante que o anticentro (AR 86,4°, dec +28,9°) e que os polos galácticos
    opcoes = []
    for ra0_centro in (False, True):
        for ra_direita in (True, False):
            gc = media_em(lum, *CENTRO_GALAXIA, ra0_centro, ra_direita)
            polo = media_em(lum, *POLO_NORTE_GALACTICO, ra0_centro, ra_direita)
            opcoes.append((gc / max(polo, 1e-9), ra0_centro, ra_direita, gc, polo))
            log(f'0h no centro={ra0_centro} AR para a direita={ra_direita}: centro {gc:.4g}, polo {polo:.4g}')
    opcoes.sort(reverse=True)
    _, ra0_centro, ra_direita, gc, polo = opcoes[0]
    log('Orientação escolhida:', '0h no centro' if ra0_centro else '0h na borda', '· AR para a', 'direita' if ra_direita else 'esquerda')
    if not ra_direita:
        img = img[:, ::-1]
    if ra0_centro:
        img = np.roll(img, -W // 2 if ra_direita else W // 2, axis=1)
    lum = img.mean(axis=2)
    # conferência: na convenção final o centro da Galáxia tem de ser o ponto mais brilhante entre os testados
    final = media_em(lum, *CENTRO_GALAXIA, False, True)
    log('Centro da Galáxia na convenção final:', final)

    # tom: arco-seno hiperbólico (preserva o contraste das nuvens escuras e não estoura o bojo), em sRGB
    p50, p999 = np.percentile(lum, [50, 99.97])
    k = max(p50 * 0.8, 1e-9)
    escala = np.arcsinh(p999 / k)
    rgb = np.arcsinh(img / k) / escala
    rgb = np.clip(rgb, 0, 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    out = Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    estat = {'p50': float(p50), 'p99_97': float(p999), 'k': float(k)}
    log('Estatísticas', estat)
    for largura in (8192, 4096):
        nome = f'via-lactea-ceu-{largura}.jpg'
        out.resize((largura, largura // 2), Image.LANCZOS).save(saida / nome, quality=88 if largura > 4096 else 90, optimize=True, progressive=True)
        log(nome, (saida / nome).stat().st_size)
    (saida / 'via-lactea-ceu.json').write_text(json.dumps({
        'fonte': 'NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC). Domínio público.',
        'pagina': PAGINA, 'arquivo': url, 'larguraOriginal': W, 'alturaOriginal': H,
        'orientacaoOriginal': {'ar0NoCentro': ra0_centro, 'arParaDireita': ra_direita},
        'convencao': 'equirretangular, coluna 0 = AR 0h, AR crescendo para a direita, linha 0 = dec +90°',
        'tom': 'asinh(x/k)/asinh(p99,97/k), k = 0,8·mediana, sRGB', 'estatisticas': estat,
    }, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
