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
viz='https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-out.all&-out.max=unlimited&-source='
baixar() { # nome url
  if curl -fsSL --retry 3 --max-time 300 -A 'painel-meteo (GitHub Actions)' -o "$pasta/$1.tmp" "$2"; then
    mv "$pasta/$1.tmp" "$pasta/$1"; echo "ok $1 ($(wc -c < "$pasta/$1") bytes)"; head -c 1500 "$pasta/$1"; echo; echo ---
  else
    rm -f "$pasta/$1.tmp"; echo "falhou $1 ($2)"
  fi
}
baixar reid2019-masers.tsv "${viz}J/ApJ/885/131"
baixar harris2010.tsv "${viz}VII/202"
baixar mcconnachie2012.tsv "${viz}J/AJ/144/4"
baixar baumgardt-gc.txt 'https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt'
baixar mcconnachie-atual.dat 'https://www.astro.uvic.ca/~alan/Nearby_Dwarfs_Database_files/NearbyGalaxies.dat'
ls -la "$pasta"
