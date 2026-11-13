# Resultado da calibração (gerado automaticamente)

Gerado em 2026-11-13 18:04 UTC por `scripts/calibrar.mjs`. Método em [CALIBRACAO.md](CALIBRACAO.md).

Estação: INMET A884 Campo Bom. Medições de 2021-03-01 a 2026-10-31 (2071 dias válidos).

Todos os números de "depois" são **fora da amostra**: cada mês foi corrigido com uma calibração que não viu aquele mês.

## Cobertura das previsões passadas

| Modelo | No painel | De | Até | Dias |
|---|---|---|---|---|
| ECMWF IFS | sim | 2022-01-01 | 2026-11-12 | 1777 |
| ECMWF AIFS | sim | 2025-02-18 | 2026-11-12 | 633 |
| UKMO 10 km | sim | 2022-03-01 | 2026-11-12 | 1718 |
| ECMWF IFS 0,25° | referência | 2024-02-04 | 2026-11-12 | 1013 |
| GFS | referência | 2021-03-24 | 2026-11-12 | 2060 |
| ICON | referência | 2022-11-17 | 2026-11-12 | 1457 |

## Temperatura exibida (ECMWF IFS): erro médio em °C

| Antecedência | Máx. antes | Máx. depois | Mín. antes | Mín. depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 1,9 | 1,3 | 0,9 | 0,9 | 364 |
| 2 dia(s) | 2,0 | 1,4 | 1,1 | 1,0 | 367 |
| 3 dia(s) | 2,1 | 1,6 | 1,0 | 1,0 | 362 |
| 4 dia(s) | 2,3 | 1,7 | 1,1 | 1,1 | 381 |
| 5 dia(s) | 2,5 | 1,9 | 1,4 | 1,4 | 360 |

## Temperatura hora a hora (ECMWF IFS): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2022-01-01 (1641 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 1641 | 1,2 / – / 1,2 | 1,6 / – / 1,5 | 2,0 / – / 1,2 | 0,8 / – / 0,8 | base |
| 1 dia(s) | 364 | 1,4 / 1,3 / 1,2 | 1,7 / 1,5 / 1,5 | 1,9 / 1,3 / 1,3 | 0,9 / 0,9 / 0,9 | sim |
| 2 dia(s) | 363 | 1,5 / 1,4 / 1,3 | 1,8 / 1,6 / 1,6 | 2,0 / 1,4 / 1,4 | 1,1 / 1,0 / 1,0 | sim |
| 3 dia(s) | 362 | 1,6 / 1,5 / 1,4 | 2,0 / 1,8 / 1,7 | 2,1 / 1,6 / 1,6 | 1,0 / 1,0 / 1,1 | sim |
| 4 dia(s) | 379 | 1,6 / 1,6 / 1,5 | 2,2 / 1,9 / 1,9 | 2,3 / 1,7 / 1,7 | 1,1 / 1,1 / 1,1 | sim |
| 5 dia(s) | 360 | 1,8 / 1,8 / 1,7 | 2,4 / 2,1 / 2,1 | 2,5 / 1,9 / 1,9 | 1,4 / 1,4 / 1,4 | não |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -0,8 | -0,7 | -0,3 | 0,2 | -0,3 | -1,0 | -1,8 | -1,9 | -1,9 | -1,0 |
| outono | -0,6 | -0,6 | -0,5 | 0,2 | -0,4 | -0,9 | -1,2 | -1,5 | -1,2 | -0,5 |
| inverno | -0,4 | -0,2 | -0,5 | -0,2 | -0,1 | -0,1 | -0,2 | -0,1 | -0,3 | -0,2 |
| primavera | -0,8 | -0,6 | -0,5 | -0,1 | 0,1 | -0,3 | -0,7 | -1,0 | -1,3 | -0,9 |

## Temperatura hora a hora (ECMWF AIFS): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2025-02-17 (498 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 498 | 1,2 / – / 1,1 | 1,4 / – / 1,4 | 2,0 / – / 0,9 | 0,9 / – / 0,9 | base |
| 1 dia(s) | 497 | 1,4 / 1,4 / 1,3 | 1,8 / 1,5 / 1,6 | 2,4 / 1,0 / 1,1 | 1,0 / 0,9 / 1,0 | não |
| 2 dia(s) | 496 | 1,5 / 1,4 / 1,3 | 1,8 / 1,6 / 1,6 | 2,4 / 1,1 / 1,1 | 1,1 / 1,0 / 1,1 | não |
| 3 dia(s) | 495 | 1,5 / 1,5 / 1,4 | 1,8 / 1,6 / 1,6 | 2,3 / 1,2 / 1,2 | 1,1 / 1,1 / 1,1 | não |
| 4 dia(s) | 480 | 1,6 / 1,6 / 1,5 | 1,9 / 1,8 / 1,8 | 2,4 / 1,4 / 1,4 | 1,2 / 1,1 / 1,2 | sim |
| 5 dia(s) | 479 | 1,7 / 1,7 / 1,6 | 2,0 / 1,9 / 1,9 | 2,6 / 1,6 / 1,6 | 1,3 / 1,2 / 1,3 | não |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -1,0 | -0,3 | 2,2 | -0,0 | -1,3 | -1,3 | -1,3 | -1,6 | -1,5 | -0,8 |
| outono | -0,7 | -0,3 | 1,0 | -0,7 | -1,9 | -1,2 | -0,9 | -0,8 | 0,2 | -0,3 |
| inverno | -0,6 | -0,2 | 0,3 | -0,4 | -1,7 | -1,0 | -1,0 | -0,6 | 0,3 | -0,3 |
| primavera | -0,9 | -0,5 | 1,4 | -0,3 | -1,3 | -1,1 | -1,1 | -1,3 | -1,1 | -0,8 |

## Temperatura hora a hora (UKMO 10 km): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2022-03-01 (1582 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 1582 | 1,2 / – / 1,1 | 1,6 / – / 1,4 | 2,0 / – / 1,2 | 0,9 / – / 0,8 | base |
| 1 dia(s) | 510 | 1,4 / 1,4 / 1,3 | 1,8 / 1,6 / 1,6 | 2,2 / 1,4 / 1,4 | 1,0 / 1,0 / 1,0 | sim |
| 2 dia(s) | 582 | 1,5 / 1,5 / 1,5 | 2,0 / 1,7 / 1,8 | 2,4 / 1,4 / 1,4 | 1,1 / 1,1 / 1,1 | sim |
| 3 dia(s) | 557 | 1,6 / 1,6 / 1,5 | 2,1 / 1,9 / 1,9 | 2,5 / 1,6 / 1,6 | 1,1 / 1,1 / 1,1 | sim |
| 4 dia(s) | 527 | 1,7 / 1,7 / 1,6 | 2,2 / 2,0 / 2,1 | 2,6 / 1,8 / 1,9 | 1,2 / 1,2 / 1,2 | sim |
| 5 dia(s) | 566 | 1,9 / 1,9 / 1,9 | 2,5 / 2,4 / 2,4 | 2,8 / 2,1 / 2,1 | 1,4 / 1,4 / 1,4 | sim |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -0,1 | -0,4 | -0,1 | -1,1 | -1,1 | -1,1 | -1,2 | -1,0 | -0,5 | -0,1 |
| outono | -0,2 | -0,6 | -0,6 | -1,0 | -1,4 | -1,4 | -1,3 | -1,1 | -0,3 | 0,1 |
| inverno | -0,1 | 0,0 | -0,2 | -0,4 | -1,2 | -1,0 | -0,9 | -0,5 | -0,4 | 0,1 |
| primavera | -0,4 | -0,5 | -0,4 | -1,1 | -1,0 | -0,9 | -0,9 | -0,9 | -0,6 | -0,4 |

## Sensação térmica na véspera: erro médio em °C

Fórmula, igual na previsão e na medição: NWS: índice de calor (Rothfusz/WPC) e vento frio (≤ 10 °C, transição até 15 °C) (e = pressão de vapor pelo ponto de orvalho, hPa; v = vento médio, m/s). Medida = calculada com temperatura, orvalho e vento do INMET A884 na mesma hora. "Corrigida" = como o painel mostra (temperatura, orvalho e vento corrigidos, fora da amostra; o fator do vento é o anual da estação do ano).

| Modelo | Dias | Por hora: bruta → corrigida | Tarde | Sensação máxima do dia | Sensação mínima do dia | Viés da máxima (corrigida) |
|---|---|---|---|---|---|---|
| ECMWF IFS | 351 | 1,7 → 1,4 | 2,4 → 1,9 | 2,6 → 1,8 | 1,1 → 1,0 | 0,3 |
| ECMWF AIFS | 495 | 1,6 → 1,6 | 2,2 → 1,9 | 2,6 → 1,6 | 1,0 → 1,0 | 0,3 |
| UKMO 10 km | 377 | 1,7 → 1,5 | 2,5 → 2,0 | 2,8 → 1,8 | 1,1 → 1,1 | 0,1 |

Ponto de orvalho (umidade do ar), véspera, por hora:

| Modelo | Dias | Erro antes | Erro depois | Viés antes | Em uso |
|---|---|---|---|---|---|
| ECMWF IFS | 379 | 1,4 | 1,0 | -1,1 | sim |
| ECMWF AIFS | 497 | 1,0 | 0,9 | -0,3 | sim |
| UKMO 10 km | 433 | 1,4 | 1,4 | -0,8 | sim |

## Rajada exibida (mediana dos modelos): erro médio em km/h

| Antecedência | Antes | Depois | Viés antes | Viés depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 23,7 | 16,3 | 21,6 | 11,4 | 518 |
| 2 dia(s) | 10,9 | 6,4 | 8,4 | 0,8 | 525 |
| 3 dia(s) | 25,1 | 18,5 | 22,1 | 12,1 | 510 |
| 4 dia(s) | 10,7 | 6,7 | 7,7 | 0,2 | 505 |
| 5 dia(s) | 23,4 | 17,3 | 20,0 | 10,4 | 457 |

## Placar de acerto da véspera

Chuva: consenso dos modelos do painel já corrigidos (1 mm ou mais). Máxima e mínima: ECMWF IFS corrigido, acerto = até ±2 °C. Rajada: mediana corrigida, acerto = até ±10 km/h.

| Período | Chuva | Máxima | Mínima | Rajada |
|---|---|---|---|---|
| últimos 30 dias (2026-10-01 a 2026-10-30) | 77% | 73% | 100% | 87% |
| todo o período (2025-10-16 a 2026-10-30, 318 dias) | 86% | 80% | 95% | 79% |

## Rajada de curto prazo (Historical Forecast) e coerência entre antecedências

Fator medido ÷ previsto. "Varia entre antecedências" = maior ÷ menor fator anual de 1 a 5 dias na Previous Runs.

| Modelo | Fator curto prazo | Erro antes | Erro depois | Dias | Fator 1 a 5 dias | Varia entre antecedências | Em uso no painel |
|---|---|---|---|---|---|---|---|
| ECMWF IFS | 0,75 | 9,2 | 4,8 | 1639 | – | – | curto prazo |
| ECMWF AIFS | – | – | – | – | – | – | não |
| UKMO 10 km | 0,76 | 10,0 | 5,5 | 1580 | 0,52 / 0,73 / 0,51 / 0,74 / 0,53 | 1,47× | curto prazo |
| ECMWF IFS 0,25° | 0,74 | 9,7 | 5,1 | 594 | – | – | curto prazo |
| GFS | 0,90 | 7,2 | 6,2 | 1639 | 0,85 / 0,84 / 0,84 / 0,83 / 0,87 | 1,05× | por antecedência |
| ICON | 0,71 | 10,8 | 5,0 | 1320 | 0,69 / 0,69 / 0,68 / 0,70 / 0,71 | 1,04× | por antecedência |

## Viés de cada modelo por estação do ano (antecedência de 1 dia)

Temperatura: previsto − medido, em °C (positivo = o modelo esquenta demais). Rajada: fator medido ÷ previsto.

| Modelo | Medida | Verão | Outono | Inverno | Primavera | Usado |
|---|---|---|---|---|---|---|
| ECMWF IFS | máxima | -1,9 | -1,6 | -0,5 | -1,1 | sim |
| ECMWF IFS | mínima | -0,3 | -0,2 | -0,2 | -0,5 | sim |
| ECMWF IFS | rajada | 0,75 | 0,75 | 0,76 | 0,76 | sim |
| ECMWF IFS | vento | 0,59 | 0,59 | 0,62 | 0,56 | sim |
| ECMWF AIFS | máxima | -2,7 | -2,4 | -1,9 | -2,4 | sim |
| ECMWF AIFS | mínima | 0,6 | 0,6 | 0,4 | 0,2 | sim |
| ECMWF AIFS | vento | 0,77 | 0,74 | 0,76 | 0,72 | sim |
| UKMO 10 km | máxima | -2,0 | -2,1 | -1,5 | -1,7 | sim |
| UKMO 10 km | mínima | -0,2 | -0,3 | 0,1 | -0,4 | sim |
| UKMO 10 km | rajada | 0,71 | 0,77 | 0,83 | 0,73 | sim |
| UKMO 10 km | vento | 0,57 | 0,59 | 0,67 | 0,60 | sim |
| ECMWF IFS 0,25° | máxima | -2,6 | -1,7 | -0,9 | -1,7 | sim |
| ECMWF IFS 0,25° | mínima | -0,3 | -0,0 | 0,1 | -0,3 | não |
| ECMWF IFS 0,25° | rajada | 0,73 | 0,73 | 0,76 | 0,74 | sim |
| ECMWF IFS 0,25° | vento | 0,59 | 0,59 | 0,61 | 0,56 | sim |
| GFS | máxima | 0,4 | -0,4 | -0,7 | -0,9 | sim |
| GFS | mínima | -0,6 | -0,1 | 0,7 | -0,2 | sim |
| GFS | rajada | 0,84 | 0,83 | 0,89 | 0,85 | sim |
| GFS | vento | 0,62 | 0,71 | 0,86 | 0,71 | sim |
| ICON | máxima | -0,9 | -0,9 | -0,6 | -0,8 | sim |
| ICON | mínima | 0,6 | 0,9 | 1,5 | 0,9 | sim |
| ICON | rajada | 0,69 | 0,69 | 0,69 | 0,69 | sim |
| ICON | vento | 0,65 | 0,73 | 0,80 | 0,68 | sim |

## Correção da chuva (mapeamento de quantis), fora da amostra

Antecedências de 1 a 5 dias somadas. Usada quando o acerto sim/não sobe pelo menos 1 ponto e o erro em mm não piora mais que 2%.

| Modelo | Pares | Acerto sim/não | Alarme falso | Detecta | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) | Em uso |
|---|---|---|---|---|---|---|---|---|
| ECMWF IFS | 1607 | 74% → 80% | 47% → 36% | 85% → 65% | 1,62 → 1,00 | 1,25 → 1,05 | 4,3 → 4,1 | sim |
| ECMWF AIFS | 2216 | 70% → 85% | 53% → 30% | 96% → 73% | 2,06 → 1,03 | 1,18 → 1,04 | 3,4 → 3,2 | sim |
| UKMO 10 km | 2366 | 76% → 80% | 45% → 36% | 81% → 65% | 1,46 → 1,01 | 1,21 → 1,03 | 4,8 → 4,5 | sim |
| ECMWF IFS 0,25° | 4119 | 79% → 82% | 40% → 30% | 85% → 69% | 1,41 → 0,99 | 1,06 → 0,99 | 4,5 → 4,6 | sim |
| GFS | 4200 | 82% → 83% | 34% → 28% | 82% → 71% | 1,24 → 0,99 | 0,84 → 0,99 | 4,4 → 4,9 | não |
| ICON | 4190 | 81% → 82% | 36% → 30% | 82% → 69% | 1,28 → 0,99 | 1,06 → 0,98 | 4,9 → 4,9 | sim |

## Chuva diária por modelo, sem correção (dia com chuva = 1 mm ou mais)

| Modelo | Antecedência | Acerto sim/não | Detecta | Alarme falso | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) |
|---|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | 77% | 90% | 44% | 1,61 | 1,21 | 3,6 |
| ECMWF IFS | 3 | 71% | 84% | 50% | 1,68 | 1,26 | 4,5 |
| ECMWF IFS | 5 | 73% | 82% | 48% | 1,58 | 1,33 | 5,0 |
| ECMWF AIFS | 1 | 71% | 98% | 52% | 2,03 | 1,19 | 3,2 |
| ECMWF AIFS | 3 | 72% | 98% | 52% | 2,02 | 1,14 | 3,2 |
| ECMWF AIFS | 5 | 66% | 95% | 56% | 2,18 | 1,27 | 3,9 |
| UKMO 10 km | 1 | 80% | 86% | 40% | 1,44 | 1,14 | 4,1 |
| UKMO 10 km | 3 | 77% | 85% | 44% | 1,51 | 1,27 | 5,2 |
| UKMO 10 km | 5 | 72% | 75% | 49% | 1,45 | 1,27 | 5,7 |
| ECMWF IFS 0,25° | 1 | 81% | 90% | 37% | 1,43 | 1,09 | 4,0 |
| ECMWF IFS 0,25° | 3 | 78% | 85% | 41% | 1,44 | 1,07 | 4,5 |
| ECMWF IFS 0,25° | 5 | 76% | 80% | 43% | 1,39 | 1,04 | 5,4 |
| GFS | 1 | 84% | 84% | 30% | 1,21 | 0,96 | 4,2 |
| GFS | 3 | 83% | 86% | 34% | 1,31 | 0,92 | 4,5 |
| GFS | 5 | 79% | 68% | 37% | 1,08 | 0,52 | 4,5 |
| ICON | 1 | 84% | 87% | 32% | 1,27 | 1,09 | 4,3 |
| ICON | 3 | 81% | 82% | 36% | 1,28 | 1,00 | 4,7 |
| ICON | 5 | 77% | 78% | 41% | 1,32 | 1,10 | 5,5 |

## Porto Alegre Jardim Botânico (A801), sem correção: 2071 dias de 2021-03-01 a 2026-10-31

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | 78% | 3,4 | 1,6 | – | 383 |
| ECMWF IFS | 3 | 74% | 3,7 | 1,8 | – | 370 |
| ECMWF IFS | 5 | 72% | 4,5 | 2,1 | – | 379 |
| ECMWF AIFS | 1 | 78% | 2,8 | 1,8 | – | 608 |
| ECMWF AIFS | 3 | 76% | 3,0 | 1,8 | – | 606 |
| ECMWF AIFS | 5 | 71% | 3,6 | 2,0 | – | 592 |
| UKMO 10 km | 1 | 82% | 3,4 | 1,4 | 24,6 | 647 |
| UKMO 10 km | 3 | 78% | 4,3 | 1,7 | 28,1 | 647 |
| UKMO 10 km | 5 | 73% | 4,9 | 2,1 | 24,2 | 642 |

## Canoas (SBCO), sem correção: 2083 dias de 2021-03-01 a 2026-11-12

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | – | – | 1,3 | – | 382 |
| ECMWF IFS | 3 | – | – | 1,5 | – | 378 |
| ECMWF IFS | 5 | – | – | 1,9 | – | 374 |
| ECMWF AIFS | 1 | – | – | 1,3 | – | 622 |
| ECMWF AIFS | 3 | – | – | 1,4 | – | 620 |
| ECMWF AIFS | 5 | – | – | 1,7 | – | 604 |
| UKMO 10 km | 1 | – | – | 1,3 | 22,1 | 622 |
| UKMO 10 km | 3 | – | – | 1,5 | 25,3 | 658 |
| UKMO 10 km | 5 | – | – | 1,9 | 21,9 | 652 |

## Porto Alegre aeroporto (SBPA), sem correção: 1926 dias de 2021-03-01 a 2026-11-12

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | – | – | 1,2 | – | 383 |
| ECMWF IFS | 3 | – | – | 1,4 | – | 379 |
| ECMWF IFS | 5 | – | – | 1,7 | – | 375 |
| ECMWF AIFS | 1 | – | – | 1,3 | – | 623 |
| ECMWF AIFS | 3 | – | – | 1,3 | – | 621 |
| ECMWF AIFS | 5 | – | – | 1,6 | – | 605 |
| UKMO 10 km | 1 | – | – | 1,2 | 12,7 | 572 |
| UKMO 10 km | 3 | – | – | 1,4 | 12,8 | 574 |
| UKMO 10 km | 5 | – | – | 1,8 | 13,1 | 569 |

## Pesos dos modelos do painel (621 dias comuns)

| Modelo | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Peso relativo |
|---|---|---|---|---|
| ECMWF IFS | 4,3 | 2,2 | – | 1,02 |
| ECMWF AIFS | 3,4 | 2,4 | – | 1,10 |
| UKMO 10 km | 4,8 | 2,4 | 10,8 | 0,92 |
