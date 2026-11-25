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
espelhos=(https://vizier.cfa.harvard.edu https://vizier.cds.unistra.fr https://vizier.nao.ac.jp)

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
  baixar "$nome" "${urls[@]}" || return 1
  if [ "$modo" = amostra ] || [ "$colunas" = all ]; then grep -v '^$' "$pasta/$nome" | head -c 5000; echo; echo ---; fi
  local linhas; linhas=$(grep -cv '^#' "$pasta/$nome"); echo "$nome: $linhas linhas"; [ "$linhas" -gt 3 ]
}

# 2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26), tabela 3: 44.599 galáxias de todo o céu com velocidade radial.
vizier 2mrs.tsv J/ApJS/199/26/table3 ID,RAJ2000,DEJ2000,Ktmag,Riso,b%2Fa,type,cz,e_cz,SimbadName
# Catálogo atualizado de galáxias próximas (Karachentsev et al. 2013, AJ 145, 101): ~870 galáxias até ~11 Mpc com
# distância medida (cefeidas, ponta do ramo das gigantes vermelhas, Tully-Fisher etc.).
vizier ungc.tsv J/AJ/145/101/catalog Name,RAJ2000,DEJ2000,a26,b%2Fa,TT,HRV,Dist,f_Dist,A26,BMag,KLum,MHI,Vlg,MD,Tdw
# MCXC (Piffaretti et al. 2011, A&A 534, A109): 1.743 aglomerados de galáxias detectados em raios X (ROSAT).
vizier mcxc.tsv J/A+A/534/A109/mcxc MCXC,OName,AName,RAJ2000,DEJ2000,z,L500,M500,R500
# MSCC (Chow-Martínez et al. 2014, MNRAS 445, 4073): 601 superaglomerados de aglomerados de Abell até z = 0,15.
vizier mscc.tsv J/MNRAS/445/4073/mscc Seq,Nm,RAJ2000,DEJ2000,z,dmax,memCl
# Vazios cósmicos: VoidFinder no SDSS DR7 (Douglass et al. 2023, ApJS 265, 7) ou, em falta, Pan et al. 2012.
vizier vazios-douglass.tsv J/ApJS/265/7 all || true
vizier vazios-pan.tsv J/MNRAS/421/926/voids all || true
# Quasares do SDSS DR16 (Lyke et al. 2020, ApJS 250, 8; VizieR VII/289): ~750 mil; fica uma amostra regular de 1 em 8.
if vizier dr16q-todos.tsv VII/289/dr16q SDSS,RAJ2000,DEJ2000,z,iMAG && [ "$modo" != amostra ]; then
  awk -F'\t' 'BEGIN{n=0} /^#/ || NF<4 {print; next} {n++; if (n<=3 || n%8==0) print}' "$pasta/dr16q-todos.tsv" > "$pasta/dr16q.tsv"
  rm -f "$pasta/dr16q-todos.tsv"; echo "dr16q.tsv $(wc -l < "$pasta/dr16q.tsv") linhas"
fi

if [ "$modo" = amostra ]; then
  for u in \
    https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_2048_R3.00_full.fits \
    https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits \
    'https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=COM_CMB_IQU-smica_1024_R2.02_full.fits'; do
    echo "HEAD $u"; curl -sIL --max-time 60 "$u" | grep -iE '^(HTTP|content-length|content-type)' ; done
fi
ls -la "$pasta"
