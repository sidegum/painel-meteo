#!/usr/bin/env bash
# Baixa os catálogos de referência da escala de galáxias da aba Globo para scripts/globo/fontes/ (dados brutos, fora do
# site). Roda no GitHub Actions (workflow galaxia-fontes.yml), porque os servidores não são acessíveis do ambiente de
# desenvolvimento. O app usa vendor/ceu/galaxia.json, montado deles por scripts/globo/montar-galaxia.py.
#
# - Reid et al. 2019 (ApJ 885, 131): paralaxes de masers em regiões de formação de estrelas (VizieR J/ApJ/885/131).
# - Baumgardt & Vasiliev 2021 (MNRAS 505, 5957): distâncias e posições dos aglomerados globulares da Via Láctea.
# - Harris 1996, edição 2010 (VizieR VII/202): catálogo de aglomerados globulares (nomes e reserva das distâncias).
# - McConnachie 2012 (AJ 144, 4), versão atualizada: galáxias do Grupo Local e vizinhas (Nearby Dwarf Galaxies Database).
set -uo pipefail
pasta=${1:-scripts/globo/fontes}
mkdir -p "$pasta"
# VizieR: o servidor principal (CDS, Estrasburgo) e os espelhos oficiais (CfA, Harvard; NAOJ, Tóquio)
espelhos=(https://vizier.cds.unistra.fr https://vizier.cfa.harvard.edu https://vizier.nao.ac.jp)
baixar() { # nome url...
  local nome=$1; shift
  for url in "$@"; do
    if curl -fsSL --connect-timeout 20 --retry 2 --max-time 240 -A 'painel-meteo (GitHub Actions)' -o "$pasta/$nome.tmp" "$url"; then
      mv "$pasta/$nome.tmp" "$pasta/$nome"; echo "ok $nome ($(wc -c < "$pasta/$nome") bytes) de $url"; head -c 1500 "$pasta/$nome"; echo; echo ---
      return 0
    fi
    echo "falhou $nome em $url"
  done
  rm -f "$pasta/$nome.tmp"
}
vizier() { # nome fonte
  local urls=()
  for e in "${espelhos[@]}"; do urls+=("$e/viz-bin/asu-tsv?-out.all&-out.max=unlimited&-source=$2"); done
  baixar "$1" "${urls[@]}"
}
vizier reid2019-masers.tsv J/ApJ/885/131
vizier harris2010.tsv VII/202
vizier mcconnachie2012.tsv J/AJ/144/4
baixar baumgardt-gc.txt 'https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt'
baixar mcconnachie-atual.dat 'https://www.astro.uvic.ca/~alan/Nearby_Dwarfs_Database_files/NearbyGalaxies.dat'
ls -la "$pasta"
