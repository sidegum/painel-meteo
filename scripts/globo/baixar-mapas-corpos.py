#!/usr/bin/env python3
"""Baixa do Wikimedia Commons os mapas globais reais das luas e dos corpos pequenos do sistema solar do Globo.

Uso: baixar-mapas-corpos.py <manifesto.json> <pasta de saída>

Para cada corpo do manifesto (scripts/globo/mapas-corpos.json):
1. Usa o primeiro arquivo de 'arquivos' que existir no Commons. Sem nenhum, procura pelas frases de 'buscas' e fica com
   o melhor candidato: imagem na proporção 2:1 (projeção cilíndrica simples do corpo inteiro), com pelo menos 1.000 px
   de largura, de licença livre, sem ser mapa com nomes, geológico ou topográfico.
2. Baixa até 4.096 px de largura e grava <id>-4096.jpg (se a fonte chega a 3.000 px), <id>-2048.jpg e <id>-1024.jpg.
Saída: mapas.json (arquivo de origem, página, autor, licença e tamanhos de cada corpo; os candidatos vistos ficam
registrados para conferência) e contato.jpg, uma folha com todos os mapas para conferir a olho.
"""
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
AGENTE = {'User-Agent': 'globo-ceu-bot/1.2 (GitHub Actions; uso educacional; poucas dezenas de pedidos por execução)'}
API = 'https://commons.wikimedia.org/w/api.php?format=json&'
LIVRES = ('public domain', 'pd', 'cc0', 'cc by', 'cc-by', 'cc by-sa', 'cc-by-sa')
BONS = ('map', 'mosaic', 'global', 'cylindrical', 'equirectangular', 'color', 'colour', 'usgs', 'pia', 'albedo', 'basemap', 'texture')
RUINS = ('label', 'name', 'nomenclat', 'geolog', 'topograph', 'elevation', 'grid', 'annotat', 'legend', 'quadrangle', 'chart', 'diagram', 'gravity',
         'thermal', 'temperature', 'infrared', 'false', 'stereo', 'polar', 'fictional', 'artist', 'coverage', 'resolution', 'footprint', 'landing', 'mineral')


def buscar(url, tentativas=4):
    """Baixa um endereço. Em "429 Too Many Requests" espera um minuto ou mais antes de tentar de novo."""
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENTE), timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (rede: tenta de novo e registra)
            print('  falhou', url[:110], e)
            time.sleep(60 * (i + 1) if '429' in str(e) else 5 * (i + 1))
    return None


def texto_puro(html):
    import html as entidades
    return re.sub(r'\s+', ' ', entidades.unescape(re.sub(r'<[^>]+>', '', html or ''))).strip()


def metadados(titulos):
    """Tamanho, endereço, autor e licença de arquivos do Commons (títulos sem 'File:'), numa consulta por lote."""
    achados = {}
    for i in range(0, len(titulos), 40):
        lote = titulos[i:i + 40]
        bruto = buscar(API + 'action=query&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=4096&titles=' + urllib.parse.quote('|'.join('File:' + t for t in lote)))
        time.sleep(4)
        if not bruto:
            continue
        consulta = json.loads(bruto).get('query', {})
        normal = {n['to']: n['from'] for n in consulta.get('normalized', [])}
        for pag in consulta.get('pages', {}).values():
            if 'imageinfo' not in pag:
                continue
            titulo = normal.get(pag['title'], pag['title'])[len('File:'):]
            ii = pag['imageinfo'][0]
            m = ii.get('extmetadata', {})
            v = lambda k: texto_puro(m.get(k, {}).get('value', ''))  # noqa: E731, B023
            achados[titulo] = {'arquivo': titulo, 'url': ii.get('thumburl') or ii['url'], 'pagina': ii.get('descriptionurl'), 'largura': ii.get('width'), 'altura': ii.get('height'),
                               'mime': ii.get('mime'), 'licenca': v('LicenseShortName'), 'autor': v('Artist')[:160], 'credito': v('Credit')[:200]}
    return achados


def procurar(frase):
    """Títulos de arquivos (sem 'File:') que o Commons devolve para a frase."""
    bruto = buscar(API + 'action=query&list=search&srnamespace=6&srlimit=30&srsearch=' + urllib.parse.quote(frase))
    time.sleep(4)
    if not bruto:
        return []
    return [r['title'][len('File:'):] for r in json.loads(bruto).get('query', {}).get('search', [])]


def serve(m):
    """Mapa cilíndrico do corpo inteiro, de licença livre e com resolução útil?"""
    if not m.get('largura') or not m.get('altura') or m.get('mime') not in ('image/jpeg', 'image/png', 'image/tiff'):
        return False
    return m['largura'] >= 1000 and abs(m['largura'] / m['altura'] - 2) < 0.03 and any(k in m['licenca'].lower() for k in LIVRES)


def nota(m, nome):
    """Quanto um candidato parece o mapa de imagem do corpo: nome do corpo, palavras de mapa, sem palavras de outros mapas."""
    t = m['arquivo'].lower()
    if not re.search(r'(?<![a-z])' + re.escape(nome.lower()) + r'(?![a-z])', t):
        return -1
    return sum(2 for k in BONS if k in t) - sum(6 for k in RUINS if k in t) + min(m['largura'], 8192) / 2048


def main():
    manifesto, saida = Path(sys.argv[1]), Path(sys.argv[2])
    saida.mkdir(parents=True, exist_ok=True)
    corpos = json.loads(manifesto.read_text())['corpos']
    fixos = metadados([a for c in corpos for a in c.get('arquivos', [])])
    feitos, folha = {}, []
    for c in corpos:
        escolha = next((fixos[a] for a in c.get('arquivos', []) if a in fixos and serve(fixos[a])), None)
        vistos = []
        if not escolha:
            titulos = []
            for frase in c.get('buscas', []):
                titulos += [t for t in procurar(frase) if t not in titulos]
            cand = [m for m in metadados(titulos[:40]).values() if serve(m) and nota(m, c['nome']) >= 0]
            cand.sort(key=lambda m: -nota(m, c['nome']))
            vistos = [{'arquivo': m['arquivo'], 'largura': m['largura'], 'nota': round(nota(m, c['nome']), 1)} for m in cand[:8]]
            escolha = cand[0] if cand else None
        if not escolha:
            print(c['id'], 'SEM MAPA', vistos)
            continue
        bruto = buscar(escolha['url'])
        time.sleep(4)
        if not bruto:
            print(c['id'], 'falhou o download de', escolha['arquivo'])
            continue
        try:
            img = Image.open(io.BytesIO(bruto)).convert('RGB')
        except Exception as e:  # noqa: BLE001
            print(c['id'], 'imagem ilegível', e)
            continue
        tamanhos = []
        for lado in (4096, 2048, 1024):
            if lado == 4096 and img.width < 3000:
                continue
            w = min(lado, img.width)
            img.resize((w, w // 2), Image.LANCZOS).save(saida / f"{c['id']}-{lado}.jpg", quality=88, optimize=True)
            tamanhos.append(lado)
        feitos[c['id']] = {**{k: escolha[k] for k in ('arquivo', 'pagina', 'autor', 'credito', 'licenca', 'largura', 'altura')}, 'tamanhos': tamanhos, 'candidatos': vistos}
        folha.append((c['id'], img.resize((512, 256), Image.LANCZOS)))
        print(c['id'], 'ok', escolha['arquivo'], escolha['largura'], escolha['licenca'])
    (saida / 'mapas.json').write_text(json.dumps({'fonte': 'Wikimedia Commons (mapas da NASA, do JPL e do USGS, de licença livre)', 'corpos': feitos}, ensure_ascii=False, indent=1))
    if folha:
        colunas = 4
        contato = Image.new('RGB', (512 * colunas, 256 * -(-len(folha) // colunas)))
        for i, (_, im) in enumerate(folha):
            contato.paste(im, (512 * (i % colunas), 256 * (i // colunas)))
        contato.save(saida / 'contato.jpg', quality=80)
    print(len(feitos), 'de', len(corpos), 'corpos com mapa')


if __name__ == '__main__':
    main()
