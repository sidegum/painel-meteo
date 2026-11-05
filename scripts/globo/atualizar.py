#!/usr/bin/env python3
"""Gera os dados globais da aba Globo (rodado pelo GitHub Actions a cada hora; à mão: python3 scripts/globo/atualizar.py SAIDA).

Por que um script em Python: o único formato público e gratuito das previsões globais do GFS é GRIB2, e a leitura
confiável de GRIB2 depende da biblioteca ecCodes (ECMWF), cuja ligação oficial é em Python. O resto do repo é em
JavaScript; este é o único script fora dele, pelo motivo acima.

Fontes (nenhuma libera CORS para o navegador, por isso passam por aqui):
  - GFS 0,5° (NOAA NCEP, via NOMADS, filtro GRIB): vento a 10 m, rajada, temperatura a 2 m, pressão ao nível do mar,
    taxa de chuva e nuvens baixas, médias e altas, de 0 a 48 h a cada 3 h. Domínio público.
  - NASA GIBS (WMS): imagem infravermelha dos satélites geoestacionários (GOES-Leste, GOES-Oeste, Himawari),
    composta num mosaico global. Domínio público (NASA/NOAA/JMA).
  - Ciclones: NHC (Atlântico e Pacífico Leste) e GDACS (resto do mundo).
  - Satélites: elementos orbitais do CelesTrak (grupos estações, mais brilhantes, meteorológicos e GPS).
  - Sondas e telescópios espaciais: vetores de estado do JPL Horizons (API oficial, NASA/JPL), uma vez por dia.

Saída (pasta SAIDA, publicada no branch "globo-dados"):
  manifest.json           descrição da rodada, horas, grade e escala de cada canal
  vento-HH.png            RGB 720 x 361: R = u10 (m/s), G = v10 (m/s), B = rajada (m/s)
  campo-HH.png            RGB 720 x 361: R = temperatura 2 m (°C), G = pressão (hPa), B = chuva (mm/h, escala raiz)
  nuvens-HH.png           RGB 720 x 361: R = nuvens baixas (%), G = médias (%), B = altas (%)
  satelite.png            RGB 2048 x 1024: R = transparência da nuvem (0-255), G = peso da cobertura, B = brilho infravermelho
  ciclones.json           lista de ciclones ativos com posição, vento e fonte
  satelites.json          elementos orbitais (OMM) por grupo
  sondas.json             trajetória e posição de agora de cada sonda (heliocêntrica, eclíptica J2000, UA e UA/dia)
  corpos.json             elementos orbitais de luas (Horizons), corpos menores e populações dos cinturões (SBDB)

Cada canal é um inteiro de 0 a 255 que o app converte de volta pela faixa [min, max] gravada no manifest. O PNG
nunca usa o canal alfa, porque o navegador pré-multiplica a transparência e isso corromperia os valores.
Os arquivos de horas que falharem não são gravados: o manifest só lista o que existe.
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

import numpy as np
from PIL import Image, ImageFilter

AGENTE = 'painel-meteo-pessoal/1.0 (globo; uso pessoal)'
HORAS = list(range(0, 49, 3))
LARG, ALT = 720, 361  # grade GFS 0,5°: longitudes -180..179,5 e latitudes 90..-90

# Faixas de cada canal (min, max). Valores fora da faixa são saturados.
CANAIS = {
    'vento': {'R': ['u10', 'm/s', -50, 50], 'G': ['v10', 'm/s', -50, 50], 'B': ['rajada', 'm/s', 0, 70]},
    'campo': {'R': ['t2m', '°C', -70, 55], 'G': ['pressao', 'hPa', 920, 1080], 'B': ['chuva', 'mm/h', 0, 40, 'raiz']},
    'nuvens': {'R': ['nuvens_baixas', '%', 0, 100], 'G': ['nuvens_medias', '%', 0, 100], 'B': ['nuvens_altas', '%', 0, 100]},
}


def log(*a):
    print(datetime.now(timezone.utc).strftime('%H:%M:%S'), *a, flush=True)


def baixar(url, timeout=120, tentativas=3, binario=True):
    """GET com tentativas e intervalo crescente. Devolve bytes (ou texto)."""
    erro = None
    for k in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': AGENTE})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                dados = r.read()
                return dados if binario else dados.decode('utf-8', 'replace')
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            erro = e
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                break
            time.sleep(3 * (k + 1))
    raise RuntimeError(f'falha ao baixar {url}: {erro}')


def existe(url):
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': AGENTE})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except Exception:
        return False


def quantizar(valores, minimo, maximo, escala=None):
    """Converte um campo float em inteiros 0-255 na faixa dada ('raiz' comprime valores altos, para chuva)."""
    v = np.clip(np.nan_to_num(valores, nan=minimo), minimo, maximo)
    t = (v - minimo) / (maximo - minimo)
    if escala == 'raiz':
        t = np.sqrt(t)
    return np.round(t * 255).astype(np.uint8)


# ------------------------------------------------------------------ GFS

def rodada_gfs_disponivel():
    """Última rodada do GFS com o arquivo de 48 h já publicado (ciclos 00, 06, 12 e 18 UTC)."""
    agora = datetime.now(timezone.utc)
    for atraso_h in range(3, 30):
        t = (agora - timedelta(hours=atraso_h)).replace(minute=0, second=0, microsecond=0)
        if t.hour % 6:
            continue
        base = f'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.{t:%Y%m%d}/{t:%H}/atmos/'
        if existe(base + f'gfs.t{t:%H}z.pgrb2full.0p50.f{HORAS[-1]:03d}'):
            return t
    raise RuntimeError('nenhuma rodada completa do GFS 0,5° encontrada nas últimas 30 h')


def url_filtro_gfs(rodada, hora):
    q = {
        'dir': f'/gfs.{rodada:%Y%m%d}/{rodada:%H}/atmos',
        'file': f'gfs.t{rodada:%H}z.pgrb2full.0p50.f{hora:03d}',
        'var_UGRD': 'on', 'var_VGRD': 'on', 'var_GUST': 'on', 'var_TMP': 'on', 'var_PRMSL': 'on', 'var_PRATE': 'on',
        'var_LCDC': 'on', 'var_MCDC': 'on', 'var_HCDC': 'on', 'var_TCDC': 'on',
        'lev_10_m_above_ground': 'on', 'lev_2_m_above_ground': 'on', 'lev_surface': 'on', 'lev_mean_sea_level': 'on',
        'lev_low_cloud_layer': 'on', 'lev_middle_cloud_layer': 'on', 'lev_high_cloud_layer': 'on', 'lev_entire_atmosphere': 'on',
    }
    return 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p50.pl?' + urllib.parse.urlencode(q)


def mensagens_grib(dados):
    """Separa as mensagens de um arquivo GRIB2 em memória (cabeçalho "GRIB", tamanho nos bytes 8-16, fim "7777")."""
    pos = 0
    while True:
        pos = dados.find(b'GRIB', pos)
        if pos < 0:
            return
        tamanho = int.from_bytes(dados[pos + 8:pos + 16], 'big')
        if tamanho <= 0:
            return
        yield dados[pos:pos + tamanho]
        pos += tamanho


def decodificar_grib(dados):
    """Lê todas as mensagens GRIB2 e devolve {shortName@typeOfLevel: matriz 361 x 720 com longitudes de -180 a 179,5}."""
    import eccodes  # importado aqui para o resto do script funcionar sem ecCodes (ex.: só satélite)
    campos = {}
    for msg in mensagens_grib(dados):
        h = eccodes.codes_new_from_message(msg)
        try:
            nome = eccodes.codes_get(h, 'shortName')
            nivel = eccodes.codes_get(h, 'typeOfLevel')
            ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
            if (ni, nj) != (LARG, ALT):
                continue
            v = eccodes.codes_get_values(h).reshape(nj, ni)
            if eccodes.codes_get(h, 'jScansPositively'):
                v = v[::-1]  # queremos a linha 0 no polo norte
            lon0 = eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees')
            if abs(lon0) < 1e-6:
                v = np.roll(v, LARG // 2, axis=1)  # 0..359,5 -> -180..179,5
            campos[f'{nome}@{nivel}'] = v
        finally:
            eccodes.codes_release(h)
    return campos


def gerar_gfs(saida, rodada):
    horas_ok = []
    for hora in HORAS:
        try:
            dados = baixar(url_filtro_gfs(rodada, hora), timeout=180)
            if len(dados) < 10000 or dados[:4] != b'GRIB':
                raise RuntimeError(f'resposta não é GRIB ({len(dados)} bytes)')
            c = decodificar_grib(dados)
            u, v = c['10u@heightAboveGround'], c['10v@heightAboveGround']
            rajada = c.get('gust@surface', np.hypot(u, v) * 1.3)
            t2m = c['2t@heightAboveGround'] - 273.15
            pressao = c['prmsl@meanSea'] / 100.0
            chuva = c.get('prate@surface', np.zeros_like(u)) * 3600.0
            baixas = c.get('lcc@lowCloudLayer', np.zeros_like(u))
            medias = c.get('mcc@middleCloudLayer', np.zeros_like(u))
            altas = c.get('hcc@highCloudLayer', np.zeros_like(u))
            if hora == 0 and 'tcc@atmosphere' in c and not any(k in c for k in ('lcc@lowCloudLayer',)):
                baixas = c['tcc@atmosphere']
            vento = np.dstack([quantizar(u, *CANAIS['vento']['R'][2:4]), quantizar(v, *CANAIS['vento']['G'][2:4]), quantizar(rajada, *CANAIS['vento']['B'][2:4])])
            campo = np.dstack([quantizar(t2m, *CANAIS['campo']['R'][2:4]), quantizar(pressao, *CANAIS['campo']['G'][2:4]), quantizar(chuva, 0, 40, 'raiz')])
            nuvens = np.dstack([quantizar(baixas, 0, 100), quantizar(medias, 0, 100), quantizar(altas, 0, 100)])
            Image.fromarray(vento, 'RGB').save(os.path.join(saida, f'vento-{hora:02d}.png'), optimize=True)
            Image.fromarray(campo, 'RGB').save(os.path.join(saida, f'campo-{hora:02d}.png'), optimize=True)
            Image.fromarray(nuvens, 'RGB').save(os.path.join(saida, f'nuvens-{hora:02d}.png'), optimize=True)
            horas_ok.append(hora)
            log(f'GFS +{hora:02d} h ok: chaves {sorted(c.keys())}' if hora == 0 else f'GFS +{hora:02d} h ok')
        except Exception as e:  # uma hora com falha não derruba as outras
            log(f'GFS +{hora:02d} h falhou: {e}')
    return horas_ok


# ------------------------------------------------------------------ satélite (NASA GIBS)

GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
# Satélites geoestacionários: camada no GIBS e longitude do ponto subsatélite (para pesar o mosaico pelo ângulo de visão).
SATELITES_IR = [
    {'camada': 'GOES-East_ABI_Band13_Clean_Infrared', 'lon': -75.2},
    {'camada': 'GOES-West_ABI_Band13_Clean_Infrared', 'lon': -137.0},
    {'camada': 'Himawari_AHI_Band13_Clean_Infrared', 'lon': 140.7},
]
ZENITE_MAX = 70.0  # graus a partir do ponto subsatélite: além disso a imagem fica distorcida demais


def tempos_gibs():
    """Lê o GetCapabilities e devolve {camada: último instante disponível (ISO)} das camadas infravermelhas."""
    xml = baixar(GIBS_WMS + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0', timeout=120, binario=False)
    raiz = ElementTree.fromstring(xml)
    ns = {'w': 'http://www.opengis.net/wms'}
    tempos = {}
    for camada in raiz.iter('{http://www.opengis.net/wms}Layer'):
        nome = camada.findtext('w:Name', default='', namespaces=ns)
        if re.search(r'Band13|Meteosat|SEVIRI|Himawari|GOES', nome):
            dim = camada.find('w:Dimension', ns)
            texto = (dim.text or '').strip() if dim is not None else ''
            fim = None
            for trecho in texto.split(','):
                partes = trecho.strip().split('/')
                if len(partes) >= 2:
                    fim = max(fim or '', partes[1])
            tempos[nome] = {'ultimo': fim, 'padrao': dim.get('default') if dim is not None else None}
    return tempos


def peso_zenite(larg, alt, lon_sat):
    """Peso de cada pixel pelo cosseno do ângulo entre a vertical local e a direção do satélite (0 além de ZENITE_MAX)."""
    lon = np.radians(np.linspace(-180 + 180 / larg, 180 - 180 / larg, larg))
    lat = np.radians(np.linspace(90 - 90 / alt, -90 + 90 / alt, alt))
    cosd = np.cos(lat)[:, None] * np.cos(lon - np.radians(lon_sat))[None, :]
    limite = math.cos(math.radians(ZENITE_MAX))
    w = np.clip((cosd - limite) / (1 - limite), 0, 1)
    return (w * w).astype(np.float32)


def gerar_satelite(saida):
    tempos = tempos_gibs()
    log('GIBS camadas:', json.dumps(tempos)[:1500])
    larg, alt = 2048, 1024
    soma = np.zeros((alt, larg), dtype=np.float32)
    pesos = np.zeros((alt, larg), dtype=np.float32)
    usadas = []
    for sat in SATELITES_IR:
        camada = sat['camada']
        info = tempos.get(camada) or {}
        candidatos = [t for t in (info.get('ultimo'), info.get('padrao'), None) if t is not None] + [None]
        for instante in candidatos:
            q = {'SERVICE': 'WMS', 'REQUEST': 'GetMap', 'VERSION': '1.3.0', 'LAYERS': camada, 'CRS': 'EPSG:4326',
                 'BBOX': '-90,-180,90,180', 'WIDTH': larg, 'HEIGHT': alt, 'FORMAT': 'image/png', 'TRANSPARENT': 'TRUE'}
            if instante:
                q['TIME'] = instante
            try:
                png = baixar(GIBS_WMS + '?' + urllib.parse.urlencode(q), timeout=180)
                a = np.asarray(Image.open(io.BytesIO(png)).convert('RGBA'))
                cinza = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]).astype(np.float32)
                tem = a[..., 3] > 0
                if tem.sum() < 10000:
                    log(f'GIBS {camada} @ {instante}: sem dado ({int(tem.sum())} px)')
                    continue
                w = peso_zenite(larg, alt, sat['lon']) * tem
                soma += cinza * w
                pesos += w
                usadas.append({'camada': camada, 'instante': instante or 'padrão', 'pixelsComDado': int(tem.sum())})
                log(f'GIBS {camada} @ {instante}: {int(tem.sum())} px com dado')
                break
            except Exception as e:
                log(f'GIBS {camada} @ {instante} falhou: {e}')
    if not usadas:
        raise RuntimeError('nenhuma camada infravermelha disponível no GIBS')
    com = pesos > 0.02
    brilho = np.where(com, soma / np.maximum(pesos, 1e-6), 0).astype(np.float32)
    # Transparência das nuvens a partir do brilho infravermelho (quente = escuro = sem nuvem; frio = claro = nuvem).
    # Faixas medidas no mosaico de 2026-11-05: terra quente 11-76, superfície típica 90-120, nuvens 140-200.
    # Os topos mais frios saem pretos na paleta do GIBS: um pixel muito escuro cercado de nuvem clara é nuvem densa.
    alfa = np.clip((brilho - 112.0) / (185.0 - 112.0), 0, 1)
    alfa = alfa * alfa * (3 - 2 * alfa)
    vizinhanca = np.asarray(Image.fromarray(brilho.astype(np.uint8)).filter(ImageFilter.BoxBlur(3)), dtype=np.float32)
    nucleo = (brilho < 35) & (vizinhanca > 125) & com
    alfa = np.where(nucleo, 1.0, alfa)
    cobertura = np.clip(pesos / 0.3, 0, 1) * 255  # transição suave até 255 para o app misturar com o modelo
    Image.fromarray(np.dstack([(alfa * 255).astype(np.uint8), cobertura.astype(np.uint8), brilho.astype(np.uint8)]), 'RGB').save(os.path.join(saida, 'satelite.png'), optimize=True)
    return usadas


# ------------------------------------------------------------------ ciclones

def gerar_ciclones():
    lista = []
    try:
        j = json.loads(baixar('https://www.nhc.noaa.gov/CurrentStorms.json', binario=False))
        for s in j.get('activeStorms', []):
            lista.append({'nome': s.get('name'), 'tipo': s.get('classification'), 'lat': s.get('latitudeNumeric'), 'lon': s.get('longitudeNumeric'),
                          'ventoKmh': round(float(s.get('intensity', 0)) * 1.852), 'pressaoHpa': s.get('pressure'), 'bacia': s.get('binNumber'),
                          'fonte': 'NHC', 'atualizado': s.get('lastUpdate')})
        log(f'NHC: {len(lista)} sistemas ativos')
    except Exception as e:
        log(f'NHC falhou: {e}')
    try:
        xml = baixar('https://www.gdacs.org/xml/rss.xml', binario=False)
        raiz = ElementTree.fromstring(xml)
        n = 0
        for item in raiz.iter('item'):
            g = {el.tag.split('}')[-1]: (el.text or '').strip() for el in item}
            if g.get('eventtype') != 'TC' or g.get('iscurrent', '').lower() != 'true':
                continue
            try:
                lat, lon = float(g.get('lat')), float(g.get('long'))
            except (TypeError, ValueError):
                continue
            vento = None
            m = re.search(r'(\d+)\s*km/h', g.get('severity', '') + ' ' + g.get('description', ''))
            if m:
                vento = int(m.group(1))
            lista.append({'nome': g.get('eventname') or g.get('title', 'Ciclone')[:40], 'tipo': g.get('alertlevel', 'TC'), 'lat': lat, 'lon': lon,
                          'ventoKmh': vento, 'pressaoHpa': None, 'bacia': g.get('country'), 'fonte': 'GDACS', 'atualizado': g.get('pubDate')})
            n += 1
        log(f'GDACS: {n} ciclones atuais')
    except Exception as e:
        log(f'GDACS falhou: {e}')
    return lista


# ------------------------------------------------------------------ satélites (CelesTrak)

GRUPOS_TLE = {'estacoes': 'stations', 'brilhantes': 'visual', 'meteorologicos': 'weather', 'gps': 'gps-ops'}
CAMPOS_OMM = ['OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER',
              'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'CLASSIFICATION_TYPE', 'NORAD_CAT_ID', 'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT']


def gerar_satelites():
    grupos = {}
    for chave, grupo in GRUPOS_TLE.items():
        try:
            j = json.loads(baixar(f'https://celestrak.org/NORAD/elements/gp.php?GROUP={grupo}&FORMAT=json', binario=False))
            grupos[chave] = [{k: s.get(k) for k in CAMPOS_OMM} for s in j]
            log(f'CelesTrak {grupo}: {len(j)} objetos')
            time.sleep(2)
        except Exception as e:
            log(f'CelesTrak {grupo} falhou: {e}')
    return grupos


# ------------------------------------------------------------------ sondas e telescópios (JPL Horizons)

# id: código do alvo no Horizons (negativo = nave); de: lançamento (a trajetória começa 2 dias depois).
# O Horizons devolve o nome oficial do alvo, gravado em "alvo" para conferir que o código é o esperado.
SONDAS = [
    {'id': '-170', 'chave': 'jwst', 'de': '2021-12-27'},
    {'id': '-31', 'chave': 'voyager1', 'de': '1977-09-08'},
    {'id': '-32', 'chave': 'voyager2', 'de': '1977-08-23'},
    {'id': '-98', 'chave': 'newhorizons', 'de': '2006-01-21'},
    {'id': '-96', 'chave': 'parker', 'de': '2018-08-14'},
    {'id': '-61', 'chave': 'juno', 'de': '2011-08-07'},
    {'id': '-159', 'chave': 'europaclipper', 'de': '2024-10-16'},
    {'id': '-28', 'chave': 'juice', 'de': '2023-04-16'},
    {'id': '-255', 'chave': 'psyche', 'de': '2023-10-15'},
    {'id': '-49', 'chave': 'lucy', 'de': '2021-10-18'},
    {'id': '-121', 'chave': 'bepicolombo', 'de': '2018-10-22'},
    {'id': '-144', 'chave': 'solarorbiter', 'de': '2020-02-12'},
    {'id': '-64', 'chave': 'osirisapex', 'de': '2016-09-10'},
    {'id': '-91', 'chave': 'hera', 'de': '2024-10-09'},
    {'id': '-23', 'chave': 'pioneer10', 'de': '1972-03-05'},
    {'id': '-24', 'chave': 'pioneer11', 'de': '1973-04-08'},
]
HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api'
MESES = {m: i + 1 for i, m in enumerate(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'])}


def horizons_vetores(alvo, inicio, fim, passo, centro='500@10'):
    """Vetores de estado (x, y, z em UA; vx, vy, vz em UA/dia) na eclíptica J2000. Se o pedido passar da cobertura
    da efeméride, o Horizons avisa a data limite; o intervalo é cortado nela e o pedido refeito (uma vez por lado)."""
    for _ in range(8):
        q = {'format': 'json', 'COMMAND': f"'{alvo}'", 'OBJ_DATA': 'NO', 'MAKE_EPHEM': 'YES', 'EPHEM_TYPE': 'VECTORS', 'CENTER': f"'{centro}'",
             'START_TIME': f"'{inicio:%Y-%m-%d %H:%M}'", 'STOP_TIME': f"'{fim:%Y-%m-%d %H:%M}'", 'STEP_SIZE': f"'{passo}'",
             'VEC_TABLE': '2', 'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'OUT_UNITS': 'AU-D', 'CSV_FORMAT': 'YES', 'VEC_LABELS': 'NO'}
        url = HORIZONS + '?' + urllib.parse.urlencode(q)
        try:
            j = json.loads(baixar(url, timeout=90, binario=False))
        except RuntimeError as e:
            raise RuntimeError(f'Horizons {alvo}: {e}')
        texto = j.get('result', '') + ' ' + j.get('error', '')
        m = re.search(r'(prior to|after) A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})', texto)
        lacuna = re.search(r'Insufficient ephemeris data.*?epoch (\d{4}) ([A-Z]{3}) (\d{2})', texto, re.S)
        if '$$SOE' not in texto and lacuna:  # buraco no meio da efeméride (ex.: Lucy em 2023): recomeça depois dele
            inicio = datetime(int(lacuna.group(1)), MESES[lacuna.group(2)], int(lacuna.group(3)), tzinfo=timezone.utc) + timedelta(days=3)
            if fim <= inicio:
                raise RuntimeError(f'Horizons {alvo}: sem efeméride no intervalo')
            continue
        if '$$SOE' not in texto and m:
            limite = datetime(int(m.group(2)), MESES[m.group(3)], int(m.group(4)), int(m.group(5)), int(m.group(6)), tzinfo=timezone.utc)
            if m.group(1) == 'prior to':
                inicio = limite + timedelta(hours=1)
            else:
                fim = limite - timedelta(hours=1)
            if fim <= inicio:
                raise RuntimeError(f'Horizons {alvo}: sem efeméride no intervalo')
            continue
        if '$$SOE' not in texto:
            raise RuntimeError(f'Horizons {alvo}: resposta sem dados ({texto[:300]})')
        nome = re.search(r'Target body name:\s*([^{\n]+?)\s*(?:\{|$)', texto, re.M)
        linhas = texto.split('$$SOE', 1)[1].split('$$EOE', 1)[0].strip().splitlines()
        pontos = []
        for ln in linhas:
            c = [x.strip() for x in ln.split(',')]
            if len(c) < 8:
                continue
            jd = float(c[0])
            pontos.append([round((jd - 2440587.5) * 86400000)] + [float(v) for v in c[2:8]])
        return (nome.group(1).strip() if nome else str(alvo)), pontos
    raise RuntimeError(f'Horizons {alvo}: intervalo não resolvido')


def gerar_sondas(agora):
    """Trajetória desde o lançamento até 2 anos à frente (até ~600 pontos), o trecho recente de 200 dias para cada
    lado com passo de 1 dia (12 h para a Parker) e um trecho fino em volta de agora (de 6 em 6 h, 3 dias antes e 4
    depois), para o app desenhar curvas lisas e interpolar a posição do instante com precisão."""
    sondas = {}
    hoje = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    for s in SONDAS:
        try:
            de = datetime.fromisoformat(s['de']).replace(tzinfo=timezone.utc)
            ate = hoje + timedelta(days=730)
            dias = (ate - de).days
            passo = f'{max(1, math.ceil(dias / 600))} d'
            try:
                nome, rota = horizons_vetores(s['id'], de, ate, passo)
            except RuntimeError as e:  # lacunas na efeméride (ex.: Lucy): pede por ano e junta os trechos que existem
                log(f"Horizons {s['id']}: rota inteira falhou ({e}); pedindo por ano")
                nome, rota, ini = str(s['id']), [], de
                while ini < ate:
                    fim_t = min(ate, ini + timedelta(days=365))
                    try:
                        nome, trecho = horizons_vetores(s['id'], ini, fim_t, passo)
                        rota += [p for p in trecho if not rota or p[0] > rota[-1][0]]
                    except RuntimeError as e2:
                        log(f"Horizons {s['id']}: sem trecho {ini:%Y-%m-%d} a {fim_t:%Y-%m-%d} ({e2})")
                    ini = fim_t
                    time.sleep(1)
                if len(rota) < 2:
                    raise RuntimeError('rota vazia')
            time.sleep(1)
            _, perto = horizons_vetores(s['id'], hoje - timedelta(days=3), hoje + timedelta(days=4), '6 h')
            time.sleep(1)
            arred = lambda p: [p[0]] + [round(v, 7) for v in p[1:]]
            # trecho recente (meio ano para trás e para a frente) com passo curto: no periélio a Parker dá meia volta no
            # Sol em poucos dias, e a rota longa (passo de dias) não desenha essa curva
            ini_r = max(de, hoje - timedelta(days=200))
            try:
                _, recente = horizons_vetores(s['id'], ini_r, hoje + timedelta(days=200), '12 h' if s['chave'] == 'parker' else '1 d')
            except Exception as e:  # sem o trecho recente o app desenha pela rota longa
                log(f"Horizons {s['id']}: trecho recente indisponível ({e})")
                recente = []
            time.sleep(1)
            item = {'alvo': nome, 'id': s['id'], 'rota': [arred(p) for p in rota], 'recente': [arred(p) for p in recente], 'perto': [arred(p) for p in perto]}
            if s['chave'] == 'jwst':  # em volta da Terra: distância e órbita de halo em torno de L2, no último ano
                _, geo = horizons_vetores(s['id'], hoje - timedelta(days=365), hoje + timedelta(days=4), '2 d', centro='500@399')
                item['geo'] = [arred(p) for p in geo]
                time.sleep(1)
            sondas[s['chave']] = item
            log(f"Horizons {s['id']} ({nome}): {len(rota)} pontos de rota, {len(recente)} recentes, {len(perto)} perto de agora")
        except Exception as e:
            log(f"Horizons {s['id']} falhou: {e}")
    return sondas


# ------------------------------------------------------------------ luas, corpos menores e cinturões (JPL)

# Luas: elementos osculantes do JPL Horizons em relação ao centro do planeta (eclíptica J2000), para o app propagar
# a órbita kepleriana. As luas de Júpiter (Io, Europa, Ganimedes e Calisto) e a nossa Lua vêm do Astronomy Engine.
LUAS = [
    ('fobos', '401', '499'), ('deimos', '402', '499'),
    ('mimas', '601', '699'), ('encelado', '602', '699'), ('tetis', '603', '699'), ('dione', '604', '699'),
    ('reia', '605', '699'), ('tita', '606', '699'), ('japeto', '608', '699'),
    ('miranda', '705', '799'), ('ariel', '701', '799'), ('umbriel', '702', '799'), ('titania', '703', '799'), ('oberon', '704', '799'),
    ('tritao', '801', '899'), ('caronte', '901', '999'),
]
# Corpos menores pelo SBDB (Small-Body Database): elementos heliocêntricos da eclíptica J2000 e diâmetro, quando há.
PEQUENOS = [
    ('ceres', '1', 'anao'), ('eris', '136199', 'anao'), ('haumea', '136108', 'anao'), ('makemake', '136472', 'anao'),
    ('gonggong', '225088', 'anao'), ('quaoar', '50000', 'anao'), ('orco', '90482', 'anao'), ('sedna', '90377', 'anao'),
    ('vesta', '4', 'asteroide'), ('palas', '2', 'asteroide'), ('higia', '10', 'asteroide'), ('psique', '16', 'asteroide'),
    ('eros', '433', 'asteroide'), ('bennu', '101955', 'asteroide'), ('apofis', '99942', 'asteroide'), ('didymos', '65803', 'asteroide'),
    ('ryugu', '162173', 'asteroide'), ('itokawa', '25143', 'asteroide'), ('patroclo', '617', 'asteroide'), ('eurybates', '3548', 'asteroide'),
    ('arrokoth', '486958', 'asteroide'),
    ('halley', '1P', 'cometa'), ('encke', '2P', 'cometa'), ('churyumov', '67P', 'cometa'), ('swifttuttle', '109P', 'cometa'),
    ('tempeltuttle', '55P', 'cometa'), ('hartley', '103P', 'cometa'), ('ponsbrooks', '12P', 'cometa'),
]
# Populações reais (pontos dos cinturões): asteroides numerados do cinturão principal, troianos de Júpiter e TNOs.
POPULACOES = [('principal', 'MBA', 6000), ('troianos', 'TJN', 1500), ('kuiper', 'TNO', 1500)]
SBDB = 'https://ssd-api.jpl.nasa.gov/sbdb.api'
SBDB_CONSULTA = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api'
JD_UNIX = 2440587.5


def horizons_elementos(alvo, centro, agora):
    """Elementos osculantes (a em UA, e, i, Ω, ω, M em graus, n em graus/dia) no instante de hoje à 0 h TDB."""
    dia = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    q = {'format': 'json', 'COMMAND': f"'{alvo}'", 'OBJ_DATA': 'NO', 'MAKE_EPHEM': 'YES', 'EPHEM_TYPE': 'ELEMENTS', 'CENTER': f"'500@{centro}'",
         'START_TIME': f"'{dia:%Y-%m-%d}'", 'STOP_TIME': f"'{dia + timedelta(days=1):%Y-%m-%d}'", 'STEP_SIZE': "'1 d'",
         'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'OUT_UNITS': 'AU-D', 'CSV_FORMAT': 'YES'}
    j = json.loads(baixar(HORIZONS + '?' + urllib.parse.urlencode(q), timeout=90, binario=False))
    texto = j.get('result', '')
    if '$$SOE' not in texto:
        raise RuntimeError(f"Horizons {alvo}: sem elementos ({(texto + j.get('error', ''))[:300]})")
    antes = texto.split('$$SOE', 1)[0].strip().splitlines()
    cab = next((ln for ln in reversed(antes) if 'JDTDB' in ln), '')
    nomes = [c.strip() for c in cab.split(',')]
    linha = texto.split('$$SOE', 1)[1].split('$$EOE', 1)[0].strip().splitlines()[0]
    val = dict(zip(nomes, [c.strip() for c in linha.split(',')]))
    nome = re.search(r'Target body name:\s*([^{\n]+?)\s*(?:\{|$)', texto, re.M)
    return {'nome': nome.group(1).strip() if nome else alvo, 'epoca': round((float(val['JDTDB']) - JD_UNIX) * 86400000),
            'a': float(val['A']), 'e': float(val['EC']), 'i': float(val['IN']), 'om': float(val['OM']), 'w': float(val['W']),
            'ma': float(val['MA']), 'n': float(val['N'])}


def sbdb_corpo(sstr):
    """Elementos e diâmetro de um corpo menor pelo SBDB (valores em UA, graus e dias; época em JD TDB)."""
    q = {'sstr': sstr, 'phys-par': '1', 'full-prec': '1'}  # full-prec: elementos com todos os dígitos (o padrão arredonda)
    try:
        j = json.loads(baixar(SBDB + '?' + urllib.parse.urlencode(q), timeout=60, binario=False))
    except Exception:
        del q['full-prec']
        j = json.loads(baixar(SBDB + '?' + urllib.parse.urlencode(q), timeout=60, binario=False))
    if 'orbit' not in j:
        raise RuntimeError(f"SBDB {sstr}: {str(j)[:200]}")
    el = {e['name']: e['value'] for e in j['orbit']['elements']}
    fis = {p['name']: p['value'] for p in j.get('phys_par') or []}
    item = {'nome': j['object'].get('fullname', sstr), 'epoca': round((float(j['orbit']['epoch']) - JD_UNIX) * 86400000),
            'a': float(el['a']) if el.get('a') else None, 'e': float(el['e']), 'i': float(el['i']), 'om': float(el['om']), 'w': float(el['w']),
            'q': float(el['q']), 'tp': round((float(el['tp']) - JD_UNIX) * 86400000) if el.get('tp') else None,
            'ma': float(el['ma']) if el.get('ma') else None, 'n': float(el['n']) if el.get('n') else None}
    if fis.get('diameter'):
        item['diametro_km'] = float(fis['diameter'])
    return item


def sbdb_populacao(classe, limite):
    """Elementos dos primeiros `limite` asteroides numerados de uma classe orbital do SBDB."""
    q = {'fields': 'a,e,i,om,w,ma,epoch', 'sb-kind': 'a', 'sb-ns': 'n', 'sb-class': classe, 'limit': str(limite)}
    j = json.loads(baixar(SBDB_CONSULTA + '?' + urllib.parse.urlencode(q), timeout=120, binario=False))
    saida = []
    for d in j.get('data') or []:
        try:
            a, e, i, om, w, ma, ep = (float(x) for x in d)
        except (TypeError, ValueError):
            continue
        saida.append([round(a, 4), round(e, 4), round(i, 3), round(om, 3), round(w, 3), round(ma, 3), round(ep - 2460000, 1)])
    return saida


def gerar_corpos(agora):
    luas, pequenos, populacoes = {}, {}, {}
    for chave, alvo, centro in LUAS:
        try:
            luas[chave] = dict(horizons_elementos(alvo, centro, agora), pai=centro, id=alvo)
            time.sleep(1)
        except Exception as e:
            log(f'Lua {chave} falhou: {e}')
    for chave, sstr, tipo in PEQUENOS:
        try:
            pequenos[chave] = dict(sbdb_corpo(sstr), tipo=tipo, id=sstr)
            time.sleep(0.5)
        except Exception as e:
            log(f'SBDB {sstr} falhou: {e}')
    for chave, classe, limite in POPULACOES:
        try:
            populacoes[chave] = sbdb_populacao(classe, limite)
            time.sleep(1)
        except Exception as e:
            log(f'SBDB {classe} falhou: {e}')
    log(f'corpos: {len(luas)} luas, {len(pequenos)} corpos menores, ' + ', '.join(f'{k} {len(v)}' for k, v in populacoes.items()))
    return {'luas': luas, 'pequenos': pequenos, 'populacoes': populacoes, 'epocaPopulacoes': 'JD 2460000 + valor'}


# ------------------------------------------------------------------ principal

def main():
    saida = sys.argv[1] if len(sys.argv) > 1 else 'saida/globo'
    os.makedirs(saida, exist_ok=True)
    anterior = {}
    try:
        with open(os.path.join(saida, 'manifest.json'), encoding='utf-8') as f:
            anterior = json.load(f)
    except Exception:
        pass
    agora = datetime.now(timezone.utc)
    manifest = {
        'gerado': agora.strftime('%Y-%m-%dT%H:%M:%SZ'), 'versao': 1,
        'grade': {'largura': LARG, 'altura': ALT, 'lat0': 90, 'lat1': -90, 'lon0': -180, 'lon1': 179.5},
        'canais': CANAIS, 'gfs': anterior.get('gfs'), 'satelite': anterior.get('satelite'), 'ciclones': [], 'satelites': anterior.get('satelites'),
        'sondas': anterior.get('sondas'),
    }
    so = os.environ.get('GLOBO_SO', '').split(',') if os.environ.get('GLOBO_SO') else None

    if not so or 'gfs' in so:
        try:
            rodada = rodada_gfs_disponivel()
            if anterior.get('gfs', {}).get('rodada') == rodada.strftime('%Y-%m-%dT%H:%MZ') and anterior.get('gfs', {}).get('horas') == HORAS:
                log(f'GFS: rodada {rodada:%Y-%m-%d %H}Z já publicada')
            else:
                log(f'GFS: rodada {rodada:%Y-%m-%d %H}Z')
                horas = gerar_gfs(saida, rodada)
                if horas:
                    manifest['gfs'] = {'modelo': 'GFS 0,5°', 'fonte': 'NOAA NCEP via NOMADS', 'rodada': rodada.strftime('%Y-%m-%dT%H:%MZ'), 'horas': horas,
                                       'arquivos': {'vento': 'vento-{h}.png', 'campo': 'campo-{h}.png', 'nuvens': 'nuvens-{h}.png'}}
        except Exception as e:
            log(f'GFS falhou: {e}')

    if not so or 'satelite' in so:
        try:
            usadas = gerar_satelite(saida)
            manifest['satelite'] = {'arquivo': 'satelite.png', 'largura': 2048, 'altura': 1024, 'fonte': 'NASA GIBS (GOES-Leste, GOES-Oeste e Himawari, banda 13)',
                                    'camadas': usadas, 'instante': max(u['instante'] for u in usadas), 'alfa': True}
        except Exception as e:
            log(f'Satélite falhou: {e}')

    if not so or 'ciclones' in so:
        manifest['ciclones'] = gerar_ciclones()

    if not so or 'satelites' in so:
        grupos = gerar_satelites()
        if grupos:
            with open(os.path.join(saida, 'satelites.json'), 'w', encoding='utf-8') as f:
                json.dump({'gerado': manifest['gerado'], 'fonte': 'CelesTrak', 'grupos': grupos}, f, separators=(',', ':'))
            manifest['satelites'] = {'arquivo': 'satelites.json', 'gerado': manifest['gerado'], 'grupos': {k: len(v) for k, v in grupos.items()}}

    # sondas: uma vez por dia (as trajetórias mudam devagar; poupa o Horizons) ou quando pedido
    ultima = (anterior.get('sondas') or {}).get('gerado', '')
    if (so and 'sondas' in so) or (not so and ultima[:10] != manifest['gerado'][:10]):
        sondas = gerar_sondas(agora)
        if sondas:
            with open(os.path.join(saida, 'sondas.json'), 'w', encoding='utf-8') as f:
                json.dump({'gerado': manifest['gerado'], 'fonte': 'JPL Horizons (NASA/JPL)', 'referencia': 'heliocêntrica, eclíptica J2000; UA e UA/dia',
                           'sondas': sondas}, f, separators=(',', ':'))
            manifest['sondas'] = {'arquivo': 'sondas.json', 'gerado': manifest['gerado'], 'lista': sorted(sondas)}

    # luas, corpos menores e cinturões: uma vez por dia, junto das sondas, ou quando pedido
    ultima = (anterior.get('corpos') or {}).get('gerado', '')
    manifest['corpos'] = anterior.get('corpos')
    if (so and 'corpos' in so) or (not so and ultima[:10] != manifest['gerado'][:10]):
        corpos = gerar_corpos(agora)
        if corpos['luas'] or corpos['pequenos']:
            with open(os.path.join(saida, 'corpos.json'), 'w', encoding='utf-8') as f:
                json.dump(dict(corpos, gerado=manifest['gerado'], fonte='JPL Horizons e JPL Small-Body Database (NASA/JPL)',
                               referencia='eclíptica J2000; luas em relação ao centro do planeta; UA, graus e graus/dia'), f, ensure_ascii=False, separators=(',', ':'))
            manifest['corpos'] = {'arquivo': 'corpos.json', 'gerado': manifest['gerado']}

    with open(os.path.join(saida, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    log('manifest:', json.dumps({k: (v if k != 'canais' else '...') for k, v in manifest.items()}, ensure_ascii=False)[:2000])


if __name__ == '__main__':
    main()
