"""Monta o céu de fundo do Globo a partir do NASA SVS Deep Star Maps 2020 (domínio público, NASA/Goddard).

Uso: python3 scripts/globo/montar-ceu-fundo.py vendor/ceu

Fonte: https://svs.gsfc.nasa.gov/4851 (Ernie Wright, NASA/Goddard Scientific Visualization Studio), em projeção
equirretangular e coordenadas celestes. Dois mapas:
- "starmap": o céu inteiro, 1,7 bilhão de estrelas do Gaia DR2 (mais Hipparcos e Tycho-2 nas brilhantes) com a Via
  Láctea. Vira um cubo de seis faces (computador): nitidez de fotografia em qualquer direção, sem costura nos polos.
- "milkyway": só a luz difusa da Galáxia, sem estrelas individuais. Vira o mapa equirretangular do celular, onde as
  estrelas do app (HYG e Gaia DR3) são desenhadas por cima.

Saídas:
  cubo/ceu-<face>-4096.jpg e -2048.jpg  faces px, nx, py, ny, pz, nz na convenção do WebGL, com os eixos do equador
                                        J2000: x para AR 0h, y para AR 6h, z para o polo norte celeste
  cubo/ceu.json                         fonte, arquivo baixado, orientação detectada, tom e hashes
  via-lactea-ceu-8192.jpg, -4096.jpg    equirretangular (coluna 0 em AR 0h, AR crescendo para a direita; linha 0 em +90°)
  via-lactea-ceu.json                   idem, para o mapa da Via Láctea
A orientação do arquivo original (AR para a esquerda ou direita, 0h na borda ou no centro) é detectada pelo brilho
no centro da Galáxia (AR 266,4°, dec −28,9°), que é a região mais brilhante do céu.
"""
import hashlib
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
FONTE = 'NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC). Domínio público.'


def log(*a):
    print(*a, flush=True)


def baixar(url, destino=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'painel-meteo/1.0 (GitHub Actions)'})
    with urllib.request.urlopen(req, timeout=600) as r:
        dados = r.read()
    if destino:
        Path(destino).write_bytes(dados)
    return dados


def escolher_arquivo(mapa, preferidos):
    """Lista os arquivos da página do SVS e escolhe o mapa pedido em coordenadas celestes, na primeira resolução disponível."""
    html = baixar(PAGINA).decode('utf-8', 'replace')
    links = sorted(set(re.findall(r'href="([^"]+\.(?:exr|tif|tiff|png|jpg))"', html, re.I)))
    log('Arquivos na página:', len(links))
    candidatos = []
    for l in links:
        nome = l.rsplit('/', 1)[-1].lower()
        if not nome.startswith(mapa) or 'gal' in nome.replace('galaxy', '') or 'thumb' in nome or 'print' in nome or 'searchweb' in nome:
            continue
        m = re.search(r'(\d+)k', nome)
        k = int(m.group(1)) if m else 0
        if k not in preferidos:
            continue
        ext = nome.rsplit('.', 1)[-1]
        candidatos.append((preferidos.index(k), 0 if ext == 'exr' else 1 if ext.startswith('tif') else 2, l))
    if not candidatos:
        raise SystemExit(f'Nenhum mapa "{mapa}" encontrado na página do SVS')
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


def carregar(mapa, preferidos):
    """Baixa o mapa e devolve (imagem linear na convenção do app, url, orientação original)."""
    url = escolher_arquivo(mapa, preferidos)
    log('Baixando', url)
    tmp = Path('/tmp') / url.rsplit('/', 1)[-1]
    baixar(url, tmp)
    log('Tamanho', tmp.stat().st_size)
    img = ler_imagem(tmp)
    tmp.unlink()
    np.maximum(img, 0, out=img)
    np.nan_to_num(img, copy=False, nan=0.0, posinf=0.0)
    H, W, _ = img.shape
    log('Imagem', W, 'x', H)
    lum = img[::4, ::4].mean(axis=2)

    # orientação: o centro da Galáxia é mais brilhante que o polo norte galáctico
    opcoes = []
    for ra0_centro in (False, True):
        for ra_direita in (True, False):
            gc = media_em(lum, *CENTRO_GALAXIA, ra0_centro, ra_direita)
            polo = media_em(lum, *POLO_NORTE_GALACTICO, ra0_centro, ra_direita)
            opcoes.append((gc / max(polo, 1e-9), ra0_centro, ra_direita))
            log(f'0h no centro={ra0_centro} AR para a direita={ra_direita}: centro {gc:.4g}, polo {polo:.4g}')
    opcoes.sort(reverse=True)
    _, ra0_centro, ra_direita = opcoes[0]
    log('Orientação escolhida:', '0h no centro' if ra0_centro else '0h na borda', '· AR para a', 'direita' if ra_direita else 'esquerda')
    if not ra_direita:
        img = img[:, ::-1]
    if ra0_centro:
        img = np.roll(img, -W // 2 if ra_direita else W // 2, axis=1)
    return np.ascontiguousarray(img), url, {'ar0NoCentro': ra0_centro, 'arParaDireita': ra_direita}


def tom(img, percentis, curva):
    """Ponto preto e ponto branco pelos percentis do brilho, curva de contraste e sRGB; devolve (uint8, estatísticas)."""
    preto, branco = (float(v) for v in np.percentile(img[::4, ::4].mean(axis=2), percentis))
    saida = np.empty(img.shape, np.uint8)
    for y in range(0, img.shape[0], 1024):  # em faixas, para não dobrar a memória com o mapa de 16k
        rgb = np.clip((img[y:y + 1024] - preto) / (branco - preto), 0, 1) ** curva
        srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
        saida[y:y + 1024] = (np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    return saida, {'preto': preto, 'branco': branco, 'curva': curva}


def via_lactea(saida):
    """Mapa equirretangular da luz difusa da Galáxia (celular). Ponto preto no fundo do céu (percentil 45), branco no
    99,95 (bojo e Nuvens de Magalhães sem estourar), curva 0,8; desfoque de 1,2 px a 8k contra o ruído de contagem."""
    from PIL import ImageFilter
    img, url, orientacao = carregar('milkyway', [8, 16, 4])
    H, W, _ = img.shape
    pixels, estat = tom(img, [45, 99.95], 0.8)
    out = Image.fromarray(pixels, 'RGB').filter(ImageFilter.GaussianBlur(1.2 * W / 8192))
    for largura in (8192, 4096):
        nome = f'via-lactea-ceu-{largura}.jpg'
        out.resize((largura, largura // 2), Image.LANCZOS).save(saida / nome, quality=88 if largura > 4096 else 90, optimize=True, progressive=True)
        log(nome, (saida / nome).stat().st_size)
    (saida / 'via-lactea-ceu.json').write_text(json.dumps({
        'fonte': FONTE, 'pagina': PAGINA, 'arquivo': url, 'larguraOriginal': W, 'alturaOriginal': H, 'orientacaoOriginal': orientacao,
        'convencao': 'equirretangular, coluna 0 = AR 0h, AR crescendo para a direita, linha 0 = dec +90°',
        'tom': '((x − preto)/(branco − preto))^0,8, preto = percentil 45, branco = percentil 99,95, desfoque 1,2 px a 8k, sRGB', 'estatisticas': estat,
    }, ensure_ascii=False, indent=1))


# Faces do cubo na convenção do WebGL: direção (x, y, z) de cada pixel a partir de s (para a direita) e t (para baixo) em −1..1
FACES = {
    'px': lambda s, t: (np.ones_like(s), -t, -s), 'nx': lambda s, t: (-np.ones_like(s), -t, s),
    'py': lambda s, t: (s, np.ones_like(s), t), 'ny': lambda s, t: (s, -np.ones_like(s), -t),
    'pz': lambda s, t: (s, -t, np.ones_like(s)), 'nz': lambda s, t: (-s, -t, -np.ones_like(s)),
}


def cubo(saida):
    """Céu inteiro com estrelas em seis faces (computador), reamostrado do mapa de 16k com interpolação bicúbica."""
    import cv2
    img, url, orientacao = carregar('starmap', [16, 8])
    H, W, _ = img.shape
    pixels, estat = tom(img, [40, 99.9], 0.8)
    del img
    pasta = saida / 'cubo'
    pasta.mkdir(parents=True, exist_ok=True)
    lado = 4096 if W >= 16384 else 2048
    c = (np.arange(lado, dtype=np.float32) + 0.5) / lado * 2 - 1
    s, t = np.meshgrid(c, c)
    arquivos = {}
    for face, direcao in FACES.items():
        x, y, z = direcao(s, t)
        ar = np.arctan2(y, x) % (2 * np.pi)
        dec = np.arctan2(z, np.hypot(x, y))
        mx = (ar / (2 * np.pi) * W - 0.5).astype(np.float32)
        my = ((np.pi / 2 - dec) / np.pi * H - 0.5).astype(np.float32)
        f = Image.fromarray(cv2.remap(pixels, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP), 'RGB')
        for tamanho in sorted({lado, 2048}, reverse=True):
            nome = f'ceu-{face}-{tamanho}.jpg'
            (f if tamanho == lado else f.resize((tamanho, tamanho), Image.LANCZOS)).save(pasta / nome, quality=90, optimize=True, progressive=True)
            arquivos[nome] = hashlib.sha256((pasta / nome).read_bytes()).hexdigest()
            log(nome, (pasta / nome).stat().st_size)
    (pasta / 'ceu.json').write_text(json.dumps({
        'fonte': FONTE, 'pagina': PAGINA, 'arquivo': url, 'larguraOriginal': W, 'alturaOriginal': H, 'orientacaoOriginal': orientacao,
        'convencao': 'cubo do WebGL (px, nx, py, ny, pz, nz) nos eixos do equador J2000: x = AR 0h, y = AR 6h, z = polo norte celeste',
        'tom': '((x − preto)/(branco − preto))^0,8, preto = percentil 40, branco = percentil 99,9, sRGB', 'estatisticas': estat,
        'lados': sorted({lado, 2048}), 'arquivos': arquivos,
    }, ensure_ascii=False, indent=1))


def main():
    saida = Path(sys.argv[1])
    saida.mkdir(parents=True, exist_ok=True)
    quais = sys.argv[2:] or ['cubo', 'via-lactea']
    if 'cubo' in quais:
        cubo(saida)
    if 'via-lactea' in quais:
        via_lactea(saida)


if __name__ == '__main__':
    main()
