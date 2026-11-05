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

Saída (pasta SAIDA, publicada no branch "globo-dados"):
  manifest.json           descrição da rodada, horas, grade e escala de cada canal
  vento-HH.png            RGB 720 x 361: R = u10 (m/s), G = v10 (m/s), B = rajada (m/s)
  campo-HH.png            RGB 720 x 361: R = temperatura 2 m (°C), G = pressão (hPa), B = chuva (mm/h, escala raiz)
  nuvens-HH.png           RGB 720 x 361: R = nuvens baixas (%), G = médias (%), B = altas (%)
  satelite.png            RGB 2048 x 1024: R = brilho infravermelho (nuvem frias claras), G = 255 onde há cobertura
  ciclones.json           lista de ciclones ativos com posição, vento e fonte
  satelites.json          elementos orbitais (OMM) por grupo

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
from PIL import Image

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
CAMADAS_IR = ['GOES-East_ABI_Band13_Clean_Infrared', 'GOES-West_ABI_Band13_Clean_Infrared', 'Himawari_AHI_Band13_Clean_Infrared']


def tempos_gibs():
    """Lê o GetCapabilities e devolve {camada: último instante disponível (ISO)} para as camadas infravermelhas."""
    xml = baixar(GIBS_WMS + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0', timeout=120, binario=False)
    raiz = ElementTree.fromstring(xml)
    ns = {'w': 'http://www.opengis.net/wms'}
    tempos = {}
    for camada in raiz.iter('{http://www.opengis.net/wms}Layer'):
        nome = camada.findtext('w:Name', default='', namespaces=ns)
        if 'Infrared' in nome or 'Band13' in nome:
            dim = camada.find('w:Dimension', ns)
            texto = (dim.text or '').strip() if dim is not None else ''
            fim = None
            for trecho in texto.split(','):
                partes = trecho.strip().split('/')
                if len(partes) >= 2:
                    fim = max(fim or '', partes[1])
            tempos[nome] = {'ultimo': fim, 'padrao': dim.get('default') if dim is not None else None}
    return tempos


def gerar_satelite(saida):
    tempos = tempos_gibs()
    log('GIBS camadas infravermelhas:', json.dumps(tempos)[:1500])
    larg, alt = 2048, 1024
    brilho = np.zeros((alt, larg), dtype=np.uint8)
    cobertura = np.zeros((alt, larg), dtype=np.uint8)
    usadas = []
    for camada in CAMADAS_IR:
        info = tempos.get(camada)
        if not info or not (info.get('ultimo') or info.get('padrao')):
            log(f'GIBS: camada {camada} sem tempo disponível')
            continue
        instante = info.get('ultimo') or info.get('padrao')
        q = {'SERVICE': 'WMS', 'REQUEST': 'GetMap', 'VERSION': '1.3.0', 'LAYERS': camada, 'CRS': 'EPSG:4326',
             'BBOX': '-90,-180,90,180', 'WIDTH': larg, 'HEIGHT': alt, 'FORMAT': 'image/png', 'TRANSPARENT': 'TRUE', 'TIME': instante}
        try:
            png = baixar(GIBS_WMS + '?' + urllib.parse.urlencode(q), timeout=180)
            im = Image.open(io.BytesIO(png)).convert('RGBA')
            a = np.asarray(im)
            cinza = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]).astype(np.uint8)
            tem = a[..., 3] > 0
            brilho = np.where(tem, np.maximum(brilho, cinza), brilho)
            cobertura = np.where(tem, 255, cobertura)
            usadas.append({'camada': camada, 'instante': instante, 'pixelsComDado': int(tem.sum())})
            log(f'GIBS {camada} @ {instante}: {int(tem.sum())} px com dado')
        except Exception as e:
            log(f'GIBS {camada} falhou: {e}')
    if not usadas:
        raise RuntimeError('nenhuma camada infravermelha disponível no GIBS')
    Image.fromarray(np.dstack([brilho, cobertura, np.zeros_like(brilho)]), 'RGB').save(os.path.join(saida, 'satelite.png'), optimize=True)
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
        j = json.loads(baixar('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC', binario=False))
        n = 0
        for f in j.get('features', []):
            p = f.get('properties', {})
            if p.get('iscurrent') not in (True, 'true', 'True', 1):
                continue
            geo = f.get('geometry', {}).get('coordinates', [None, None])
            vento = None
            m = re.search(r'(\d+)\s*km/h', str(p.get('description', '')) + str(p.get('severitydata', {}).get('severitytext', '')))
            if m:
                vento = int(m.group(1))
            lista.append({'nome': p.get('eventname') or p.get('name'), 'tipo': p.get('episodealertlevel') or 'TC', 'lat': geo[1], 'lon': geo[0],
                          'ventoKmh': vento, 'pressaoHpa': None, 'bacia': p.get('country'), 'fonte': 'GDACS', 'atualizado': p.get('todate') or p.get('datemodified')})
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
                                    'camadas': usadas, 'instante': max(u['instante'] for u in usadas)}
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

    with open(os.path.join(saida, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    log('manifest:', json.dumps({k: (v if k != 'canais' else '...') for k, v in manifest.items()}, ensure_ascii=False)[:2000])


if __name__ == '__main__':
    main()
