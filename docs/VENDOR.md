# Bibliotecas e fontes hospedadas no projeto

Todas com versão fixa, baixadas do registro npm em 2026-11-03. Para atualizar, baixe a nova versão, confira o hash e rode os testes de tela.

| Arquivo | Pacote | Licença | SHA-256 |
|---|---|---|---|
| vendor/uplot/uPlot.iife.min.js | uplot 1.6.32 | MIT | 19c8d4c6ad88929a79f4ae49d6f7161566dfd0ba3d15cc495e974f787eb78f1f |
| vendor/uplot/uPlot.min.css | uplot 1.6.32 | MIT | df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04 |
| vendor/leaflet/leaflet.js | leaflet 1.9.4 | BSD-2-Clause | db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a |
| vendor/leaflet/leaflet.css | leaflet 1.9.4 | BSD-2-Clause | a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6 |
| vendor/fontes/archivo-latin-standard-normal.woff2 | @fontsource-variable/archivo 5.3.0 | OFL-1.1 | e3a28eade21a900c7155a247757f4b2834c07bb7ef07ad7efa55cebaac1e8f5e |
| vendor/fontes/archivo-latin-ext-standard-normal.woff2 | @fontsource-variable/archivo 5.3.0 | OFL-1.1 | 5717f37059660ca5c899bad6c48ee22c3ac55cb3c484055241689d0f905a1a86 |
| vendor/three/three.module.min.js | three 0.187.0 (build/three.module.js minificado com esbuild 0.25.10, só para a aba Globo) | MIT | f0b701b88055285086b2c913486b1230b74c298713780cfdfe69381ece446f43 |
| vendor/satellite/satellite.min.js | satellite.js 7.1.0 (dist/index.js sem a variante WASM, empacotado com esbuild 0.25.10) | MIT | 895a4413217bce76c0e883e1cac3a39cdb673008fde7c3218f5d82af7b4e0752 |
| vendor/astronomy/astronomy.min.js | astronomy-engine 2.1.19 (esm/astronomy.js minificado com esbuild 0.25.10; posições de Sol, Lua, planetas e estrelas, eclipses, fases) | MIT | 9f49bb125ed26ae692174afc51657e365c41590c168a5889dab13695b1aeb2ad |
| vendor/ceu/estrelas.json | HYG Database v4.1 (David Nash; Hipparcos, Yale Bright Star e Gliese): 8.920 estrelas até magnitude 6,5 com movimento próprio até 2026,0, montadas por `scripts/globo/montar-estrelas.py`; linhas das 88 constelações do d3-celestial (Olaf Frohn) | CC BY-SA 4.0 (HYG, `LICENSE-HYG`) e BSD-3-Clause (d3-celestial, `LICENSE-d3-celestial`) | 9ba1c86c4e10159da77779c262bfbc5d1f83f346e13dc6c37b7a08aa3b9f51d3 |
| vendor/ceu/estrelas-profundas.bin, estrelas-profundas.json | HYG Database v4.1: as 110.705 estrelas mais fracas que a magnitude 6,5 (até ~21), em binário compacto (HIP, AR, declinação, log da distância, magnitude, B−V e classe espectral) e nomes à parte, montadas por `scripts/globo/montar-ceu-profundo.py` | CC BY-SA 4.0 (`LICENSE-HYG`) | c23916d5986711ca5a7449110a5a092e8dd54c555a9927df9192fa421c15b965 / bbbd241c6644e5c9034755e44cf62644dd45d96d2f36e09dd34f528274dddd4d |
| vendor/ceu/via-lactea.png | contornos da Via Láctea do d3-celestial (`mw.json`), rasterizados em equiretangular pelo mesmo script | BSD-3-Clause (`LICENSE-d3-celestial`) | 90985a2f9ca60be9fb1088c1b3b0fc86fcfb5e9138ec2858f71e02b930af7932 |
| vendor/ceu/objetos.json | 110 objetos de Messier do d3-celestial, 11 objetos austrais famosos (Nuvens de Magalhães, ω Centauri, 47 Tucanae, Carina, Tarântula e outros) com distâncias publicadas arredondadas e 12.041 objetos NGC/IC do OpenNGC (Mattia Verga; galáxias com distância pelo desvio para o vermelho, H0 = 70) | BSD-3-Clause (`LICENSE-d3-celestial`) e CC BY-SA 4.0 (OpenNGC) | 4b5db838e383b4bc1ccc56b026eacae07955968d194b22e76aa27a3f9ab2fdd1 |
| vendor/ceu/estrelas-gaia.bin, estrelas-gaia.json | Gaia DR3 (ESA/Gaia/DPAC): 682.849 estrelas até G 10,5 fora do Hipparcos, com distância geométrica de Bailer-Jones et al. (2021); V e B−V convertidos de G e BP−RP (Riello et al. 2021). Gerado no GitHub Actions por `scripts/globo/montar-ceu-gaia.py` (workflow `ceu-gaia.yml`) | CC BY-SA 3.0 IGO (ESA/Gaia/DPAC) | e6cc2817067277528eb4440450b38b68d9e2b665f4e7578b0580afc1703de0c0 / 864f42cf813b517e0da10208bb0dd6145adbf0ecb38a03b198ffd0c8efcf833b |
| vendor/ceu/via-lactea-4096.jpg, via-lactea-2048.jpg, via-lactea.bin, via-lactea.json | modelo da Via Láctea vista de fora calculado por `scripts/globo/montar-via-lactea.py` a partir de parâmetros publicados (Reid et al. 2019; Wegg et al. 2015; Bland-Hawthorn & Gerhard 2016; Bennett & Bovy 2019) | gerado neste repositório | 3345025336125ac75e3df060e3d4ec5fa85ac024d63e0b08403ee9b61a9aa921 / 963e43309e4d189fb222067021ba2a034cda54c2ae1ff137cbcd934c7c9ed742 / 8e448a55d1e7e05342f0b3a10078964666eba5a4f0713107f02a9830e65f4a3d |

Texturas da Terra (NASA, domínio público): ver `vendor/texturas/LICENCA.md`. Baixadas em 2026-11-05.

Ferramenta de publicação do Worker: wrangler 4.155.0 (só desenvolvimento, `npm audit` sem vulnerabilidades em 2026-11-03).
