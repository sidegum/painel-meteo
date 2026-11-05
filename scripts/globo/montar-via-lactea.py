"""Monta o modelo da Via Láctea vista de fora para a escala de galáxias da aba Globo.

Uso: python3 scripts/globo/montar-via-lactea.py vendor/ceu [lado_em_pixels]

Ninguém fotografou a Via Láctea de fora: a imagem é um modelo calculado a partir das medidas publicadas, não uma
ilustração. Cada parte vem de um trabalho com medição direta:
- Braços espirais: espirais logarítmicas com dobra, ajustadas às paralaxes de ~200 masers em regiões de formação de
  estrelas (Reid et al. 2019, ApJ 885, 131, tabela 2: azimute e raio da dobra, ângulo de inclinação antes e depois
  dela e largura de cada braço). O trecho de cada braço fora da faixa medida é extrapolado pela mesma espiral (o lado
  oposto da Galáxia, atrás do centro, não tem medidas de paralaxe).
- Sol a R0 = 8,15 kpc do centro (Reid et al. 2019) e 20,8 pc acima do plano (Bennett & Bovy 2019, MNRAS 482, 1417).
- Barra longa com semieixo de 5,0 kpc a 28° da linha Sol-centro, ponta próxima no primeiro quadrante, e bojo em forma de
  caixa de ~1,5 kpc (Wegg, Gerhard & Portail 2015, MNRAS 450, 4050).
- Disco fino com comprimento de escala de 2,6 kpc e altura de 0,3 kpc; disco jovem com 0,1 kpc (Bland-Hawthorn &
  Gerhard 2016, ARA&A 54, 529).
- Faixas de poeira no lado interno (côncavo) de cada braço, como em galáxias espirais vistas de frente; nuvens de gás e
  aglomerados jovens espalhados ao longo dos braços com textura aleatória fixa (semente constante, saída idêntica a
  cada execução).

Saídas (em vendor/ceu):
- via-lactea-<lado>.jpg (e via-lactea-2048.jpg): vista de frente, do polo norte galáctico, 40 kpc de lado, centro no
  meio, Sol para baixo (eixo y da imagem = -Xg, ver galaxia.json).
- via-lactea.bin: partículas em 3D para quando a Galáxia é vista de lado ou de perto (ver formato em galaxia.json).
- galaxia.json: parâmetros do modelo, posições dos rótulos dos braços e fontes.
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

R0 = 8.15          # kpc, Reid et al. 2019
Z_SOL = 0.0208     # kpc, Bennett & Bovy 2019
METADE = 20.0      # kpc: a imagem cobre de -20 a +20 kpc
SEMENTE = 20191113

# Reid et al. 2019, tabela 2: beta_dobra (graus), R_dobra (kpc), psi antes e depois da dobra (graus), largura (kpc),
# faixa de beta medida (graus). Mais: faixa desenhada, intensidade relativa (braços principais 1,0) e nome.
BRACOS = [
    # chave        bk   Rk     psi<   psi>   w     medido      desenhado     peso  nome
    ('3kpc-perto', 15, 3.52, -4.2, -4.2, 0.18, (15, 18), (-30, 75), 0.35, 'Braço de 3 kpc (próximo)'),
    ('3kpc-longe', 195, 3.52, -4.2, -4.2, 0.18, None, (150, 255), 0.30, 'Braço de 3 kpc (distante)'),
    ('norma', 18, 4.46, -1.0, 19.5, 0.14, (-6, 54), (-80, 95), 0.65, 'Braço de Norma'),
    ('escudo', 23, 4.91, 14.1, 12.1, 0.23, (0, 104), (-260, 205), 1.00, 'Braço Escudo-Centauro'),
    ('sagitario', 24, 6.04, 17.1, 1.0, 0.27, (2, 97), (-215, 180), 0.75, 'Braço Sagitário-Carina'),
    ('local', 9, 8.26, 11.4, 11.4, 0.31, (-8, 34), (-45, 80), 0.50, 'Braço Local (Órion)'),
    ('perseu', 40, 8.87, 10.3, 8.7, 0.35, (-23, 115), (-240, 215), 1.00, 'Braço de Perseu'),
    ('externo', 18, 12.24, 3.0, 9.4, 0.65, (-16, 71), (-90, 130), 0.50, 'Braço Externo'),
]
R_BARRA, ANG_BARRA = 5.0, 28.0  # Wegg et al. 2015
H_DISCO, H_JOVEM, RD = 0.30, 0.10, 2.6


def raio_braco(b, beta):
    _, bk, rk, p1, p2 = b[:5]
    psi = np.where(beta < bk, p1, p2)
    return rk * np.exp(-np.radians(beta - bk) * np.tan(np.radians(psi)))


def janela(b, beta):
    a, z = b[7]
    borda = 25.0
    return np.clip((beta - a) / borda, 0, 1) * np.clip((z - beta) / borda, 0, 1)


def ruido(rng, n, escalas, pesos):
    """Ruído de valor em várias oitavas (bicúbico), média ~0,5."""
    tot = np.zeros((n, n), np.float32)
    for e, p in zip(escalas, pesos):
        base = Image.fromarray(rng.random((e, e), dtype=np.float32), mode='F')
        tot += p * np.asarray(base.resize((n, n), Image.BICUBIC), np.float32)
    return tot / sum(pesos)


def borrar(a, raio_px):
    """Desfoque gaussiano (sigma em pixels) pela FFT; as bordas da imagem são escuras, então a periodicidade não aparece."""
    n0, n1 = a.shape
    f0 = np.fft.fftfreq(n0).astype(np.float32)[:, None]
    f1 = np.fft.rfftfreq(n1).astype(np.float32)[None, :]
    g = np.exp(-2 * (math.pi * raio_px) ** 2 * (f0 ** 2 + f1 ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape).astype(np.float32)


def campos(n, rng):
    """Densidades no plano (n x n) em coordenadas galactocêntricas: X (cena) = Yg, Z (cena) = Xg."""
    px = 2 * METADE / n
    c = (np.arange(n, dtype=np.float32) + 0.5) * px - METADE
    X, Z = np.meshgrid(c, c)  # linhas = Z (de -20, perto do topo, a +20), colunas = X
    R = np.hypot(X, Z)
    beta = np.degrees(np.arctan2(X, -Z))  # 0 na direção do Sol (Z = -R0), cresce para +X (sentido da rotação)
    jovem = np.zeros_like(R)
    velho_braco = np.zeros_like(R)
    poeira = np.zeros_like(R)
    for b in BRACOS:
        sig = b[5]
        for k in (-720, -360, 0, 360):
            bb = beta + k
            jan = janela(b, bb)
            if not jan.any():
                continue
            ra = raio_braco(b, bb)
            psi = np.radians(np.where(bb < b[1], b[3], b[4]))
            d = (R - ra) * np.cos(psi)  # distância perpendicular aproximada ao braço
            alcance = np.clip((ra - 2.6) / 0.8, 0, 1) * np.clip((15.5 - ra) / 2.5, 0, 1)
            w = jan * alcance * b[8]
            s = sig * (0.55 + 0.05 * ra)  # braços se alargam para fora
            jovem += w * np.exp(-0.5 * (d / s) ** 2)
            velho_braco += w * np.exp(-0.5 * (d / (2.6 * s)) ** 2)
            poeira += w * np.exp(-0.5 * ((d + 0.55 * s) / (0.42 * s)) ** 2)  # lado interno (côncavo)
    # barra e bojo
    a = np.radians(ANG_BARRA)
    u = X * math.sin(a) - Z * math.cos(a)   # ao longo da barra (ponta próxima em X > 0, Z < 0)
    v = X * math.cos(a) + Z * math.sin(a)
    barra = np.exp(-(np.abs(u) / 2.1) ** 2.2 - (np.abs(v) / 0.75) ** 2)
    bojo = np.exp(-(np.abs(u) / 0.95) ** 2 - (np.abs(v) / 0.62) ** 2)
    nucleo = np.exp(-(R / 0.12) ** 2)
    disco = np.exp(-R / RD) * np.clip((R - 0.5) / 2.5, 0, 1) ** 0.6 + 0.25 * np.exp(-R / 4.5)
    disco *= np.clip((22 - R) / 6, 0, 1)
    return X, Z, R, beta, jovem, velho_braco, poeira, barra, bojo, nucleo, disco


def montar_imagem(n, rng):
    X, Z, R, beta, jovem, velho_braco, poeira, barra, bojo, nucleo, disco = campos(n, rng)
    px = 2 * METADE / n
    k = n / 2048
    grumos = ruido(rng, n, [48, 128, 320, 800, 1600], [1, 1.2, 1.4, 1.2, 0.8])
    filamentos = ruido(rng, n, [40, 120, 360, 900], [1, 1.3, 1.2, 0.8])
    largas = ruido(rng, n, [5, 9, 16], [1, 1, 0.8])  # trechos de braço mais e menos ativos
    jov = jovem * np.clip(1.9 * grumos - 0.45, 0, None) ** 1.6 * np.clip(2.2 * largas - 0.5, 0.15, 1.6)
    # aglomerados jovens e nuvens de hidrogênio ionizado (rosa) ao longo dos braços
    pontos_az = np.zeros((n, n), np.float32)
    pontos_ro = np.zeros((n, n), np.float32)
    prob = (jovem / jovem.max()).ravel()
    for camada, qtd, brilho in ((pontos_az, 26000, 1.0), (pontos_ro, 5500, 1.0)):
        idx = rng.choice(prob.size, size=qtd, p=prob / prob.sum())
        np.add.at(camada.ravel(), idx, brilho * rng.pareto(2.2, qtd).astype(np.float32))
    pontos_az = borrar(pontos_az, 0.7 * k) * 2.0 + borrar(pontos_az, 2.4 * k) * 0.6
    pontos_ro = borrar(pontos_ro, 1.6 * k) * 3.0 + borrar(pontos_ro, 5 * k) * 1.1
    tau = 2.4 * poeira * np.clip(1.7 * filamentos - 0.25, 0, None) ** 1.3 + 0.35 * np.exp(-R / 3.2) * filamentos
    tau += 1.1 * np.exp(-(np.abs(Z + 0) / 9.9)) * 0  # (sem poeira extra fora dos braços)
    tau *= np.clip((R - 0.8) / 1.5, 0, 1)
    velho = 1.0 * disco + 0.45 * velho_braco * np.exp(-R / 5.0) + 1.6 * barra + 2.2 * bojo + 3.5 * nucleo
    cor_velho = np.array([1.0, 0.80, 0.56], np.float32)
    cor_jovem = np.array([0.56, 0.72, 1.0], np.float32)
    cor_rosa = np.array([1.0, 0.33, 0.48], np.float32)
    cor_az = np.array([0.75, 0.86, 1.0], np.float32)
    lum = (velho[..., None] * cor_velho + 0.9 * (jov * np.exp(-np.clip(R - 9, 0, None) / 5))[..., None] * cor_jovem
           + 0.22 * pontos_az[..., None] * cor_az + 0.45 * pontos_ro[..., None] * cor_rosa)
    ext = np.array([0.55, 0.75, 1.0], np.float32)  # a poeira apaga mais o azul (avermelhamento)
    lum *= np.exp(-tau[..., None] * ext)
    lum += 0.05 * borrar(lum.mean(axis=2), 18 * k)[..., None] * cor_velho  # halo de luz espalhada
    v = 1 - np.exp(-1.15 * lum)        # mapeamento de tons suave (sem estourar o centro)
    v = np.clip(v, 0, 1) ** (1 / 1.25)
    return Image.fromarray((v * 255 + rng.random(v.shape) * 0.999).astype(np.uint8), 'RGB'), (jovem, disco, barra, bojo, poeira, R, X, Z)


def particulas(rng, campos_, n_px):
    """Partículas 3D: amostradas das mesmas densidades da imagem, com espessura do disco (sech² aproximado)."""
    jovem, disco, barra, bojo, poeira, R, X, Z = campos_
    px = 2 * METADE / n_px
    def amostrar(dens, qtd):
        p = np.clip(dens, 0, None).ravel(); p = p / p.sum()
        idx = rng.choice(p.size, size=qtd, p=p)
        i, j = np.divmod(idx, n_px)
        x = (j + rng.random(qtd)) * px - METADE
        z = (i + rng.random(qtd)) * px - METADE
        return x.astype(np.float32), z.astype(np.float32)
    def altura(qtd, h):
        return (h * np.arctanh(np.clip(2 * rng.random(qtd) - 1, -0.999, 0.999))).astype(np.float32)
    blocos = []
    # (densidade, quantidade, altura, cor, brilho, diâmetro do ponto em pc)
    for dens, qtd, h, cor, br, tam in (
        (disco, 90000, H_DISCO, (255, 214, 160), 60, 420),
        (jovem, 70000, H_JOVEM, (150, 185, 255), 90, 200),
        (barra + 0.6 * bojo, 40000, None, (255, 200, 140), 80, 480),
    ):
        x, z = amostrar(dens, qtd)
        if h is None:  # bojo em caixa (formato de amendoim visto de lado)
            y = (0.42 * rng.standard_normal(qtd) * (0.6 + 0.4 * np.abs(np.tanh(np.hypot(x, z) / 1.2)))).astype(np.float32)
        else:
            y = altura(qtd, h * (1 + 0.04 * np.hypot(x, z)))  # disco se alarga para fora
        c = np.array(cor, np.float32) * (0.85 + 0.3 * rng.random((qtd, 1)))
        blocos.append((x, y, z, np.clip(c, 0, 255).astype(np.uint8), np.full(qtd, br, np.uint8), np.full(qtd, tam // 10, np.uint8)))
    estrelas = [np.concatenate(k) for k in zip(*blocos)]
    xd, zd = amostrar(poeira, 30000)
    yd = altura(30000, 0.07)
    return estrelas, (xd, yd, zd)


def main():
    pasta = Path(sys.argv[1])
    lado = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
    rng = np.random.default_rng(SEMENTE)
    img, cps = montar_imagem(lado, rng)
    img.save(pasta / f'via-lactea-{lado}.jpg', quality=90, optimize=True, progressive=True)
    if lado != 2048:
        img.resize((2048, 2048), Image.LANCZOS).save(pasta / 'via-lactea-2048.jpg', quality=88, optimize=True, progressive=True)
    # partículas a partir de uma grade menor (mais rápida; a posição dentro do pixel é aleatória)
    rng2 = np.random.default_rng(SEMENTE + 1)
    n_p = 1024
    _, _, R, beta, jovem, velho_braco, poeira, barra, bojo, nucleo, disco = campos(n_p, rng2)
    X = Z = None
    (x, y, z, cor, br, tam), (xd, yd, zd) = particulas(rng2, (jovem, disco, barra, bojo, poeira, R, X, Z), n_p)
    q = lambda a, e: np.clip(np.round(a / e * 32767), -32767, 32767).astype('<i2')
    with open(pasta / 'via-lactea.bin', 'wb') as f:
        f.write(b'MWG2' + struct.pack('<II', len(x), len(xd)))
        for a, e in ((x, METADE), (y, 4.0), (z, METADE)):
            f.write(q(a, e).tobytes())
        f.write(cor.tobytes()); f.write(br.tobytes()); f.write(tam.tobytes())
        for a, e in ((xd, METADE), (yd, 4.0), (zd, METADE)):
            f.write(q(a, e).tobytes())
    rotulos = []
    for b in BRACOS:
        if b[0] == '3kpc-longe':
            continue
        lo, hi = b[6] if b[6] else b[7]
        meio = (lo + hi) / 2
        r = float(raio_braco(b, np.array([meio]))[0])
        rotulos.append({'chave': b[0], 'nome': b[9], 'x': round(r * math.sin(math.radians(meio)), 3), 'z': round(-r * math.cos(math.radians(meio)), 3),
                        'medido': list(b[6]) if b[6] else None, 'betaDobra': b[1], 'rDobra': b[2], 'psi': [b[3], b[4]], 'largura': b[5]})
    meta = {
        'fonte': 'Modelo calculado a partir de Reid et al. 2019 (braços, R0), Wegg et al. 2015 (barra), Bland-Hawthorn & Gerhard 2016 (disco) e Bennett & Bovy 2019 (altura do Sol)',
        'R0': R0, 'zSol': Z_SOL, 'metade': METADE, 'barra': {'semieixo': R_BARRA, 'angulo': ANG_BARRA},
        'imagem': {'lado': lado, 'nota': 'vista do polo norte galáctico; colunas = X da cena (= Yg, para l = 90° no Sol), linhas = Z da cena (= Xg; Sol em Z = -R0, perto do topo)'},
        'particulas': {'n': int(len(x)), 'nPoeira': int(len(xd)), 'formato': "'MWG2', n, nPoeira (uint32); x, y, z int16[n] (x, z ×20/32767 kpc; y ×4/32767 kpc); cor uint8[n×3]; brilho uint8[n]; diâmetro uint8[n] (×10 pc); poeira x, y, z int16[nPoeira]"},
        'bracos': rotulos,
        'semente': SEMENTE,
    }
    (pasta / 'via-lactea.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f'imagem {lado} px, {len(x)} partículas, {len(xd)} de poeira')


if __name__ == '__main__':
    main()
