"""Baixa e prepara as texturas reais do Sol, da Lua e dos planetas para o sistema solar do Globo.

Uso: python3 scripts/globo/montar-texturas-planetas.py vendor/texturas/planetas

Fonte: Solar System Scope (INOVE), https://www.solarsystemscope.com/textures/, licença CC BY 4.0. Os mapas são
montados a partir de imagens das missões da NASA e da ESA (MESSENGER, Magellan, Viking, LRO, Cassini, Voyager, SDO).
Saídas: <corpo>-2048.jpg (celular) e <corpo>-4096.jpg (computador), equirretangulares, longitude 0 no centro como no
original; anel de Saturno em PNG com transparência; texturas.json com a lista, os tamanhos e os hashes.
"""
import hashlib
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
BASE = 'https://www.solarsystemscope.com/textures/download/'
# corpo do app -> arquivos tentados na ordem (o maior primeiro)
ARQUIVOS = {
    'sol': ['8k_sun.jpg', '2k_sun.jpg'],
    'mercurio': ['8k_mercury.jpg', '2k_mercury.jpg'],
    'venus': ['4k_venus_atmosphere.jpg', '2k_venus_atmosphere.jpg'],
    'venus-superficie': ['8k_venus_surface.jpg', '2k_venus_surface.jpg'],
    'lua': ['8k_moon.jpg', '2k_moon.jpg'],
    'marte': ['8k_mars.jpg', '2k_mars.jpg'],
    'jupiter': ['8k_jupiter.jpg', '2k_jupiter.jpg'],
    'saturno': ['8k_saturn.jpg', '2k_saturn.jpg'],
    'urano': ['2k_uranus.jpg'],
    'netuno': ['2k_neptune.jpg'],
    'ceres': ['4k_ceres_fictional.jpg', '2k_ceres_fictional.jpg'],
}
ANEL = ['8k_saturn_ring_alpha.png', '2k_saturn_ring_alpha.png']


def baixar(nome):
    for tentativa in range(3):
        try:
            req = urllib.request.Request(BASE + nome, headers={'User-Agent': 'painel-meteo/1.0 (GitHub Actions)'})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - rede: tenta de novo e depois desiste deste arquivo
            print(f'  {nome}: {e}', flush=True)
            time.sleep(5 * (tentativa + 1))
    return None


def main():
    saida = Path(sys.argv[1])
    saida.mkdir(parents=True, exist_ok=True)
    lista = {}
    for corpo, nomes in ARQUIVOS.items():
        if corpo == 'ceres':  # o "fictional" do site não é um mapa real: fica de fora
            continue
        for nome in nomes:
            dados = baixar(nome)
            if not dados:
                continue
            img = Image.open(io.BytesIO(dados)).convert('RGB')
            print(corpo, nome, img.size, flush=True)
            lista[corpo] = {'arquivo': nome, 'original': list(img.size), 'saidas': {}}
            for largura in (2048, 4096):
                if largura > img.width and largura != 2048:
                    continue
                destino = saida / f'{corpo}-{largura}.jpg'
                img.resize((largura, largura // 2), Image.LANCZOS).save(destino, quality=88, optimize=True, progressive=True)
                lista[corpo]['saidas'][destino.name] = hashlib.sha256(destino.read_bytes()).hexdigest()
            break
        else:
            print(f'{corpo}: nenhum arquivo disponível', flush=True)
    for nome in ANEL:
        dados = baixar(nome)
        if not dados:
            continue
        img = Image.open(io.BytesIO(dados)).convert('RGBA')
        print('anel', nome, img.size, flush=True)
        destino = saida / 'saturno-anel.png'
        img.resize((2048, max(1, round(img.height * 2048 / img.width))), Image.LANCZOS).save(destino, optimize=True)
        lista['saturno-anel'] = {'arquivo': nome, 'original': list(img.size), 'saidas': {destino.name: hashlib.sha256(destino.read_bytes()).hexdigest()}}
        break
    (saida / 'texturas.json').write_text(json.dumps({
        'fonte': 'Solar System Scope (INOVE), https://www.solarsystemscope.com/textures/ — CC BY 4.0, a partir de dados da NASA e da ESA',
        'texturas': lista,
    }, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
