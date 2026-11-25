#!/usr/bin/env bash
# Baixa os catálogos da escala do universo da aba Globo (do Grupo Local até a radiação cósmica de fundo) para
# scripts/globo/fontes/universo/. Roda no GitHub Actions (workflow universo-fontes.yml): os servidores não são
# acessíveis do ambiente de desenvolvimento. O app usa vendor/ceu/universo.*, montado por scripts/globo/montar-universo.py.
#
# Uso: baixar-fontes-universo.sh <pasta> [amostra]
#   amostra: baixa só 3 linhas de cada tabela (com todas as colunas) e imprime, para conferir os nomes das colunas.
set -uo pipefail
pasta=${1:-scripts/globo/fontes/universo}
modo=${2:-completo}
mkdir -p "$pasta"
espelhos=(https://vizier.cds.unistra.fr https://vizier.cfa.harvard.edu https://vizier.nao.ac.jp)

baixar() { # nome url...
  local nome=$1; shift
  for url in "$@"; do
    if curl -fsSL --connect-timeout 20 --retry 2 --max-time 900 -A 'painel-meteo (GitHub Actions)' -o "$pasta/$nome.tmp" "$url"; then
      mv "$pasta/$nome.tmp" "$pasta/$nome"; echo "ok $nome ($(wc -c < "$pasta/$nome") bytes) de $url"
      return 0
    fi
    echo "falhou $nome em $url"
  done
  rm -f "$pasta/$nome.tmp"; return 1
}

# nome fonte colunas (vírgulas; "all" = todas) [restrições extras, já codificadas para URL]
vizier() {
  local nome=$1 fonte=$2 colunas=$3 extra=${4:-} urls=() saida max=unlimited
  if [ "$modo" = amostra ]; then colunas=all; max=3; fi
  if [ "$colunas" = all ]; then saida='-out.all'; else saida="-out=${colunas}"; fi
  for e in "${espelhos[@]}"; do urls+=("$e/viz-bin/asu-tsv?${saida}&-out.max=${max}&-source=${fonte}${extra}"); done
  baixar "$nome" "${urls[@]}" && if [ "$modo" = amostra ]; then grep -v '^#[^N]' "$pasta/$nome" | grep -v '^$' | head -c 6000; echo; echo ---; fi
}

# 2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26): 44.599 galáxias de todo o céu com velocidade radial.
vizier 2mrs.tsv J/ApJS/199/26 "${COL_2MRS:-all}"
# Catálogo atualizado de galáxias próximas (Karachentsev et al. 2013, AJ 145, 101): ~870 galáxias até ~11 Mpc com distância medida.
vizier ungc.tsv J/AJ/145/101 "${COL_UNGC:-all}"
# MCXC (Piffaretti et al. 2011, A&A 534, A109): 1.743 aglomerados de galáxias detectados em raios X (ROSAT).
vizier mcxc.tsv J/A+A/534/A109 "${COL_MCXC:-all}"
# MSCC (Chow-Martínez et al. 2014, MNRAS 445, 4073): superaglomerados de aglomerados de Abell até z = 0,15.
vizier mscc.tsv J/MNRAS/445/4073 "${COL_MSCC:-all}"
# Vazios cósmicos do SDSS DR7 (Pan et al. 2012, MNRAS 421, 926).
vizier vazios.tsv J/MNRAS/421/926 "${COL_VAZIOS:-all}"
# Cosmicflows-4 (Tully et al. 2023, ApJ 944, 94): distâncias independentes do desvio para o vermelho.
vizier cf4.tsv J/ApJ/944/94 "${COL_CF4:-all}"
# Quasares do SDSS DR16 (Lyke et al. 2020, ApJS 250, 8; VizieR VII/289).
vizier dr16q.tsv VII/289 "${COL_DR16Q:-all}"

if [ "$modo" = amostra ]; then
  for u in \
    https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_2048_R3.00_full.fits \
    https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits \
    'https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=COM_CMB_IQU-smica_1024_R2.02_full.fits'; do
    echo "HEAD $u"; curl -sIL --max-time 60 "$u" | grep -iE '^(HTTP|content-length|content-type)' ; done
fi
ls -la "$pasta"
