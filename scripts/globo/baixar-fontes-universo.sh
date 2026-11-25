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
    if curl -fsSL --connect-timeout 20 --retry 2 --max-time 2400 -A 'painel-meteo (GitHub Actions)' -o "$pasta/$nome.tmp" "$url"; then
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
# Vazios cósmicos: VoidFinder no SDSS DR7 (Douglass et al. 2023, ApJS 265, 7), tabela 1 (esfera máxima de cada vazio),
# só a cosmologia do Planck 2018.
vizier vazios.tsv J/ApJS/265/7/table1 Cosmo,RAJ2000,DEJ2000,s,Reff,edge '&Cosmo=Planck2018' 
# Quasares do SDSS DR16 (Lyke et al. 2020, ApJS 250, 8; VizieR VII/289): ~750 mil; fica uma amostra regular de 1 em 8.
if vizier dr16q-todos.tsv VII/289/dr16q SDSS,RAJ2000,DEJ2000,z,iMAG && [ "$modo" != amostra ]; then
  awk -F'\t' 'BEGIN{n=0} /^#/ || NF<4 {print; next} {n++; if (n<=3 || n%8==0) print}' "$pasta/dr16q-todos.tsv" > "$pasta/dr16q.tsv"
  rm -f "$pasta/dr16q-todos.tsv"; echo "dr16q.tsv $(wc -l < "$pasta/dr16q.tsv") linhas"
fi

# ---- Via Láctea: o que há catalogado com distância ----
# Aglomerados estelares pelo Gaia DR3 (Hunt & Reffert 2023, A&A 673, A114): 7.167 aglomerados com distância e idade.
vizier aglomerados-estelares.tsv J/A+A/673/A114/clusters all
# Pulsares: catálogo ATNF (Manchester et al. 2005, AJ 129, 1993; VizieR B/psr).
vizier pulsares.tsv B/psr/psr all
# Exoplanetas confirmados: NASA Exoplanet Archive, tabela de parâmetros compostos (um registro por planeta).
baixar exoplanetas.csv 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,ra,dec,sy_dist,sy_pnum,pl_rade,pl_bmasse,pl_orbper,pl_orbsmax,pl_eqt,disc_year,discoverymethod,disc_facility,st_teff,st_spectype,sy_vmag+from+pscomppars&format=csv'

# ---- Levantamentos de galáxias que preenchem o espaço entre o 2MRS e os quasares ----
if [ "$modo" != amostra ]; then
  # 6dF Galaxy Survey DR3 (Jones et al. 2009, MNRAS 399, 683; VizieR VII/259): 125 mil galáxias do céu do sul.
  vizier 6dfgs-todos.tsv VII/259/6dfgs all && python3 scripts/globo/reduzir-tsv.py "$pasta/6dfgs-todos.tsv" "$pasta/6dfgs.tsv" 1 RAJ2000 DEJ2000 cz q_cz z Kmag Ktmag
  # SDSS DR10, amostra principal de galáxias com grupos (Tempel et al. 2014, A&A 566, A1): 588 mil galáxias até z = 0,2.
  vizier sdss-todos.tsv J/A+A/566/A1/galaxies all && python3 scripts/globo/reduzir-tsv.py "$pasta/sdss-todos.tsv" "$pasta/sdss.tsv" 3 RAJ2000 DEJ2000 zobs zcmb z Dist rMAG MAG_r rmag
  rm -f "$pasta/6dfgs-todos.tsv" "$pasta/sdss-todos.tsv"
  # BOSS DR12 (Reid et al. 2016, MNRAS 455, 1553): 1,2 milhão de galáxias vermelhas luminosas, 0,2 < z < 0,75.
  for hemi in North South; do
    baixar "boss-$hemi.fits.gz" "https://data.sdss.org/sas/dr12/boss/lss/galaxy_DR12v5_CMASSLOWZTOT_$hemi.fits.gz"
  done
  pip install --quiet astropy numpy && python3 scripts/globo/reduzir-boss.py "$pasta" 8
  rm -f "$pasta"/boss-*.fits.gz
else
  vizier 6dfgs.tsv VII/259/6dfgs all; vizier sdss.tsv J/A+A/566/A1/galaxies all
  for hemi in North South; do u="https://data.sdss.org/sas/dr12/boss/lss/galaxy_DR12v5_CMASSLOWZTOT_$hemi.fits.gz"; echo "HEAD $u"; curl -sIL --max-time 60 "$u" | grep -iE '^(HTTP|content-length)'; done
fi

if [ "$modo" = amostra ]; then
  for u in \
    https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_2048_R3.00_full.fits \
    https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits \
    'https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=COM_CMB_IQU-smica_1024_R2.02_full.fits'; do
    echo "HEAD $u"; curl -sIL --max-time 60 "$u" | grep -iE '^(HTTP|content-length|content-type)' ; done
fi
ls -la "$pasta"
