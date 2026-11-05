# Resultado da calibração (gerado automaticamente)

Gerado em 2026-11-05 03:01 UTC por `scripts/calibrar.mjs`. Método em [CALIBRACAO.md](CALIBRACAO.md).

Estação: INMET A884 Campo Bom. Medições de 2021-03-01 a 2026-08-31 (2010 dias válidos).

Todos os números de "depois" são **fora da amostra**: cada mês foi corrigido com uma calibração que não viu aquele mês.

## Cobertura das previsões passadas

| Modelo | No painel | De | Até | Dias |
|---|---|---|---|---|
| ECMWF IFS | sim | 2022-01-01 | 2026-11-03 | 1768 |
| ECMWF AIFS | sim | 2025-02-18 | 2026-11-03 | 624 |
| UKMO 10 km | sim | 2022-03-01 | 2026-11-03 | 1709 |
| ECMWF IFS 0,25° | referência | 2024-02-04 | 2026-11-03 | 1004 |
| GFS | referência | 2021-03-24 | 2026-11-03 | 2051 |
| ICON | referência | 2022-11-17 | 2026-11-03 | 1448 |

## Temperatura exibida (ECMWF IFS): erro médio em °C

| Antecedência | Máx. antes | Máx. depois | Mín. antes | Mín. depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 1,9 | 1,2 | 0,9 | 0,9 | 304 |
| 2 dia(s) | 2,0 | 1,2 | 1,1 | 1,1 | 307 |
| 3 dia(s) | 2,1 | 1,4 | 1,1 | 1,1 | 302 |
| 4 dia(s) | 2,3 | 1,5 | 1,2 | 1,2 | 321 |
| 5 dia(s) | 2,4 | 1,8 | 1,4 | 1,4 | 300 |

## Temperatura hora a hora (ECMWF IFS): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2022-01-01 (1581 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 1581 | 1,2 / – / 1,2 | 1,6 / – / 1,5 | 2,0 / – / 1,2 | 0,8 / – / 0,8 | base |
| 1 dia(s) | 304 | 1,4 / 1,4 / 1,3 | 1,7 / 1,5 / 1,4 | 1,9 / 1,2 / 1,2 | 0,9 / 0,9 / 0,9 | sim |
| 2 dia(s) | 303 | 1,5 / 1,4 / 1,4 | 1,8 / 1,6 / 1,5 | 2,0 / 1,2 / 1,2 | 1,1 / 1,1 / 1,1 | sim |
| 3 dia(s) | 302 | 1,6 / 1,5 / 1,4 | 1,9 / 1,7 / 1,6 | 2,1 / 1,4 / 1,4 | 1,1 / 1,1 / 1,1 | sim |
| 4 dia(s) | 319 | 1,6 / 1,6 / 1,5 | 2,1 / 1,9 / 1,8 | 2,3 / 1,5 / 1,6 | 1,1 / 1,1 / 1,2 | sim |
| 5 dia(s) | 300 | 1,8 / 1,8 / 1,7 | 2,4 / 2,1 / 2,0 | 2,4 / 1,8 / 1,8 | 1,4 / 1,4 / 1,5 | não |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -0,8 | -0,7 | -0,3 | 0,2 | -0,3 | -1,0 | -1,8 | -1,9 | -1,9 | -1,0 |
| outono | -0,6 | -0,6 | -0,5 | 0,2 | -0,4 | -0,9 | -1,2 | -1,5 | -1,2 | -0,5 |
| inverno | -0,5 | -0,2 | -0,5 | -0,2 | -0,0 | -0,0 | -0,2 | -0,0 | -0,3 | -0,2 |
| primavera | -0,9 | -0,6 | -0,5 | -0,1 | -0,2 | -0,7 | -1,2 | -1,4 | -1,9 | -1,1 |

## Temperatura hora a hora (ECMWF AIFS): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2025-02-17 (438 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 438 | 1,2 / – / 1,1 | 1,4 / – / 1,4 | 2,0 / – / 0,9 | 0,9 / – / 0,9 | base |
| 1 dia(s) | 437 | 1,4 / 1,4 / 1,3 | 1,8 / 1,5 / 1,6 | 2,4 / 1,0 / 1,1 | 1,0 / 0,9 / 1,0 | não |
| 2 dia(s) | 436 | 1,5 / 1,5 / 1,4 | 1,8 / 1,6 / 1,6 | 2,4 / 1,1 / 1,1 | 1,1 / 1,0 / 1,1 | não |
| 3 dia(s) | 435 | 1,5 / 1,5 / 1,4 | 1,8 / 1,6 / 1,7 | 2,3 / 1,2 / 1,2 | 1,2 / 1,1 / 1,1 | sim |
| 4 dia(s) | 420 | 1,6 / 1,6 / 1,5 | 1,9 / 1,8 / 1,8 | 2,4 / 1,3 / 1,3 | 1,3 / 1,2 / 1,2 | sim |
| 5 dia(s) | 419 | 1,7 / 1,8 / 1,6 | 2,1 / 1,9 / 2,0 | 2,6 / 1,6 / 1,6 | 1,3 / 1,2 / 1,3 | não |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -1,0 | -0,3 | 2,2 | -0,0 | -1,3 | -1,3 | -1,3 | -1,6 | -1,5 | -0,8 |
| outono | -0,7 | -0,3 | 1,0 | -0,7 | -1,9 | -1,2 | -0,9 | -0,8 | 0,2 | -0,3 |
| inverno | -0,7 | -0,2 | 0,3 | -0,4 | -1,6 | -1,0 | -0,9 | -0,6 | 0,3 | -0,3 |
| primavera | -0,9 | -0,2 | 1,9 | 0,0 | -1,1 | -1,0 | -1,1 | -1,5 | -1,6 | -0,9 |

## Temperatura hora a hora (UKMO 10 km): erro médio em °C

Fora da amostra. "Bruta": como o modelo previu. "Diária": correção só da máxima e da mínima (método anterior). "Horária": viés de cada hora do dia por estação do ano, com base no curto prazo desde 2022-03-01 (1522 dias), mais o ajuste da máxima e da mínima. Tarde: 12 h a 18 h.

| Antecedência | Dias | Por hora: bruta / diária / horária | Tarde: bruta / diária / horária | Máxima: bruta / diária / horária | Mínima: bruta / diária / horária | Em uso |
|---|---|---|---|---|---|---|
| curto prazo | 1522 | 1,2 / – / 1,2 | 1,6 / – / 1,4 | 2,1 / – / 1,2 | 0,9 / – / 0,8 | base |
| 1 dia(s) | 450 | 1,4 / 1,4 / 1,4 | 1,8 / 1,6 / 1,6 | 2,2 / 1,3 / 1,3 | 1,0 / 1,0 / 1,0 | sim |
| 2 dia(s) | 522 | 1,6 / 1,5 / 1,5 | 2,0 / 1,7 / 1,8 | 2,4 / 1,4 / 1,4 | 1,1 / 1,1 / 1,1 | sim |
| 3 dia(s) | 497 | 1,6 / 1,6 / 1,5 | 2,1 / 1,9 / 1,9 | 2,5 / 1,6 / 1,6 | 1,1 / 1,1 / 1,1 | sim |
| 4 dia(s) | 467 | 1,7 / 1,7 / 1,6 | 2,2 / 2,0 / 2,0 | 2,6 / 1,8 / 1,8 | 1,2 / 1,2 / 1,2 | sim |
| 5 dia(s) | 506 | 1,9 / 1,9 / 1,9 | 2,5 / 2,3 / 2,3 | 2,9 / 2,0 / 2,0 | 1,4 / 1,4 / 1,4 | sim |

Viés por hora na véspera (previsto − medido, °C; negativo = o modelo prevê frio demais):

| Estação | 0 h | 3 h | 6 h | 9 h | 12 h | 14 h | 15 h | 16 h | 18 h | 21 h |
|---|---|---|---|---|---|---|---|---|---|---|
| verao | -0,1 | -0,4 | -0,1 | -1,1 | -1,1 | -1,1 | -1,2 | -1,0 | -0,5 | -0,1 |
| outono | -0,2 | -0,6 | -0,6 | -1,0 | -1,4 | -1,4 | -1,3 | -1,1 | -0,3 | 0,1 |
| inverno | -0,2 | -0,0 | -0,2 | -0,3 | -1,1 | -1,0 | -0,8 | -0,5 | -0,4 | 0,1 |
| primavera | -0,3 | -0,5 | -0,4 | -1,2 | -1,2 | -1,1 | -1,1 | -1,1 | -0,7 | -0,4 |

## Sensação térmica na véspera: erro médio em °C

Fórmula, igual na previsão e na medição: NWS: índice de calor (Rothfusz/WPC) e vento frio (≤ 10 °C, transição até 15 °C) (e = pressão de vapor pelo ponto de orvalho, hPa; v = vento médio, m/s). Medida = calculada com temperatura, orvalho e vento do INMET A884 na mesma hora. "Corrigida" = como o painel mostra (temperatura, orvalho e vento corrigidos, fora da amostra; o fator do vento é o anual da estação do ano).

| Modelo | Dias | Por hora: bruta → corrigida | Tarde | Sensação máxima do dia | Sensação mínima do dia | Viés da máxima (corrigida) |
|---|---|---|---|---|---|---|
| ECMWF IFS | 293 | 1,8 → 1,4 | 2,5 → 1,9 | 2,7 → 1,7 | 1,1 → 1,0 | 0,2 |
| ECMWF AIFS | 437 | 1,7 → 1,6 | 2,3 → 2,0 | 2,6 → 1,6 | 1,0 → 1,0 | 0,3 |
| UKMO 10 km | 319 | 1,8 → 1,6 | 2,7 → 2,0 | 3,0 → 1,9 | 1,1 → 1,1 | 0,0 |

Ponto de orvalho (umidade do ar), véspera, por hora:

| Modelo | Dias | Erro antes | Erro depois | Viés antes | Em uso |
|---|---|---|---|---|---|
| ECMWF IFS | 319 | 1,4 | 1,0 | -1,1 | sim |
| ECMWF AIFS | 437 | 1,0 | 0,9 | -0,3 | sim |
| UKMO 10 km | 373 | 1,4 | 1,4 | -0,8 | sim |

## Rajada exibida (mediana dos modelos): erro médio em km/h

| Antecedência | Antes | Depois | Viés antes | Viés depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 25,7 | 17,6 | 23,7 | 13,3 | 459 |
| 2 dia(s) | 11,3 | 6,4 | 9,0 | 1,4 | 466 |
| 3 dia(s) | 27,2 | 20,0 | 24,6 | 14,2 | 451 |
| 4 dia(s) | 11,0 | 6,6 | 8,2 | 0,7 | 446 |
| 5 dia(s) | 25,4 | 18,7 | 22,3 | 12,4 | 398 |

## Placar de acerto da véspera

Chuva: consenso dos modelos do painel já corrigidos (1 mm ou mais). Máxima e mínima: ECMWF IFS corrigido, acerto = até ±2 °C. Rajada: mediana corrigida, acerto = até ±10 km/h.

| Período | Chuva | Máxima | Mínima | Rajada |
|---|---|---|---|---|
| últimos 30 dias (2026-08-01 a 2026-08-30) | 80% | 70% | 93% | 87% |
| todo o período (2025-10-16 a 2026-08-30, 257 dias) | 84% | 83% | 93% | 78% |

## Rajada de curto prazo (Historical Forecast) e coerência entre antecedências

Fator medido ÷ previsto. "Varia entre antecedências" = maior ÷ menor fator anual de 1 a 5 dias na Previous Runs.

| Modelo | Fator curto prazo | Erro antes | Erro depois | Dias | Fator 1 a 5 dias | Varia entre antecedências | Em uso no painel |
|---|---|---|---|---|---|---|---|
| ECMWF IFS | 0,75 | 9,3 | 4,8 | 1580 | – | – | curto prazo |
| ECMWF AIFS | – | – | – | – | – | – | não |
| UKMO 10 km | 0,75 | 10,1 | 5,5 | 1521 | 0,50 / 0,71 / 0,50 / 0,73 / 0,50 | 1,46× | curto prazo |
| ECMWF IFS 0,25° | 0,73 | 9,9 | 5,0 | 535 | – | – | curto prazo |
| GFS | 0,90 | 7,2 | 6,2 | 1580 | 0,85 / 0,84 / 0,84 / 0,82 / 0,87 | 1,05× | por antecedência |
| ICON | 0,71 | 10,9 | 5,0 | 1261 | 0,69 / 0,69 / 0,68 / 0,70 / 0,71 | 1,04× | por antecedência |

## Viés de cada modelo por estação do ano (antecedência de 1 dia)

Temperatura: previsto − medido, em °C (positivo = o modelo esquenta demais). Rajada: fator medido ÷ previsto.

| Modelo | Medida | Verão | Outono | Inverno | Primavera | Usado |
|---|---|---|---|---|---|---|
| ECMWF IFS | máxima | -1,9 | -1,6 | -0,6 | -1,6 | sim |
| ECMWF IFS | mínima | -0,3 | -0,2 | -0,2 | -0,5 | não |
| ECMWF IFS | rajada | 0,75 | 0,75 | 0,76 | 0,76 | sim |
| ECMWF IFS | vento | 0,59 | 0,59 | 0,62 | 0,58 | sim |
| ECMWF AIFS | máxima | -2,7 | -2,4 | -1,9 | -2,4 | sim |
| ECMWF AIFS | mínima | 0,6 | 0,7 | 0,4 | 0,5 | sim |
| ECMWF AIFS | vento | 0,77 | 0,74 | 0,77 | 0,73 | sim |
| UKMO 10 km | máxima | -2,0 | -2,1 | -1,6 | -1,9 | sim |
| UKMO 10 km | mínima | -0,2 | -0,3 | 0,1 | -0,4 | sim |
| UKMO 10 km | rajada | 0,71 | 0,77 | 0,83 | 0,72 | sim |
| UKMO 10 km | vento | 0,57 | 0,59 | 0,67 | 0,60 | sim |
| ECMWF IFS 0,25° | máxima | -2,6 | -1,7 | -1,0 | -2,1 | sim |
| ECMWF IFS 0,25° | mínima | -0,3 | -0,0 | 0,1 | -0,1 | não |
| ECMWF IFS 0,25° | rajada | 0,73 | 0,73 | 0,75 | 0,69 | sim |
| ECMWF IFS 0,25° | vento | 0,59 | 0,59 | 0,61 | 0,56 | sim |
| GFS | máxima | 0,4 | -0,4 | -0,7 | -0,8 | sim |
| GFS | mínima | -0,6 | -0,1 | 0,7 | -0,2 | sim |
| GFS | rajada | 0,84 | 0,83 | 0,89 | 0,84 | sim |
| GFS | vento | 0,62 | 0,71 | 0,86 | 0,70 | sim |
| ICON | máxima | -0,9 | -0,9 | -0,6 | -0,6 | sim |
| ICON | mínima | 0,6 | 0,9 | 1,5 | 1,2 | sim |
| ICON | rajada | 0,69 | 0,69 | 0,69 | 0,69 | sim |
| ICON | vento | 0,65 | 0,73 | 0,80 | 0,68 | sim |

## Correção da chuva (mapeamento de quantis), fora da amostra

Antecedências de 1 a 5 dias somadas. Usada quando o acerto sim/não sobe pelo menos 1 ponto e o erro em mm não piora mais que 2%.

| Modelo | Pares | Acerto sim/não | Alarme falso | Detecta | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) | Em uso |
|---|---|---|---|---|---|---|---|---|
| ECMWF IFS | 1302 | 74% → 80% | 47% → 36% | 82% → 65% | 1,56 → 1,01 | 1,23 → 1,03 | 4,0 → 3,7 | sim |
| ECMWF AIFS | 1911 | 71% → 84% | 53% → 31% | 96% → 72% | 2,04 → 1,03 | 1,21 → 1,03 | 3,2 → 3,0 | sim |
| UKMO 10 km | 2061 | 76% → 79% | 45% → 37% | 80% → 63% | 1,46 → 1,00 | 1,29 → 1,05 | 4,8 → 4,4 | sim |
| ECMWF IFS 0,25° | 3814 | 79% → 82% | 39% → 29% | 84% → 69% | 1,37 → 0,98 | 1,04 → 0,99 | 4,4 → 4,5 | sim |
| GFS | 3895 | 82% → 83% | 33% → 28% | 81% → 71% | 1,21 → 0,98 | 0,83 → 1,00 | 4,4 → 4,9 | não |
| ICON | 3885 | 81% → 82% | 35% → 29% | 82% → 69% | 1,26 → 0,98 | 1,05 → 0,98 | 4,8 → 4,9 | sim |

## Chuva diária por modelo, sem correção (dia com chuva = 1 mm ou mais)

| Modelo | Antecedência | Acerto sim/não | Detecta | Alarme falso | Frequência prevista ÷ real | Volume previsto ÷ medido | Erro médio (mm) |
|---|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | 77% | 88% | 44% | 1,57 | 1,16 | 3,5 |
| ECMWF IFS | 3 | 73% | 80% | 49% | 1,58 | 1,21 | 4,2 |
| ECMWF IFS | 5 | 73% | 79% | 49% | 1,55 | 1,34 | 4,7 |
| ECMWF AIFS | 1 | 73% | 97% | 52% | 2,00 | 1,22 | 3,1 |
| ECMWF AIFS | 3 | 73% | 97% | 52% | 2,00 | 1,16 | 3,1 |
| ECMWF AIFS | 5 | 67% | 95% | 56% | 2,18 | 1,32 | 3,7 |
| UKMO 10 km | 1 | 80% | 86% | 41% | 1,45 | 1,19 | 4,1 |
| UKMO 10 km | 3 | 77% | 82% | 45% | 1,49 | 1,36 | 5,2 |
| UKMO 10 km | 5 | 73% | 76% | 48% | 1,48 | 1,40 | 6,0 |
| ECMWF IFS 0,25° | 1 | 81% | 89% | 37% | 1,40 | 1,07 | 4,0 |
| ECMWF IFS 0,25° | 3 | 79% | 84% | 40% | 1,40 | 1,04 | 4,3 |
| ECMWF IFS 0,25° | 5 | 76% | 79% | 42% | 1,36 | 1,03 | 5,3 |
| GFS | 1 | 85% | 83% | 29% | 1,18 | 0,95 | 4,2 |
| GFS | 3 | 83% | 85% | 33% | 1,28 | 0,91 | 4,6 |
| GFS | 5 | 79% | 66% | 37% | 1,04 | 0,47 | 4,5 |
| ICON | 1 | 85% | 87% | 31% | 1,25 | 1,07 | 4,2 |
| ICON | 3 | 81% | 81% | 36% | 1,27 | 0,98 | 4,7 |
| ICON | 5 | 77% | 77% | 41% | 1,30 | 1,11 | 5,5 |

## Porto Alegre Jardim Botânico (A801), sem correção: 2010 dias de 2021-03-01 a 2026-08-31

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | 78% | 3,2 | 1,6 | – | 322 |
| ECMWF IFS | 3 | 75% | 3,5 | 1,8 | – | 309 |
| ECMWF IFS | 5 | 73% | 4,2 | 2,0 | – | 318 |
| ECMWF AIFS | 1 | 79% | 2,8 | 1,8 | – | 547 |
| ECMWF AIFS | 3 | 77% | 2,9 | 1,8 | – | 545 |
| ECMWF AIFS | 5 | 72% | 3,5 | 2,0 | – | 531 |
| UKMO 10 km | 1 | 82% | 3,5 | 1,4 | 26,7 | 586 |
| UKMO 10 km | 3 | 78% | 4,2 | 1,7 | 30,7 | 586 |
| UKMO 10 km | 5 | 73% | 5,1 | 2,1 | 26,2 | 581 |

## Canoas (SBCO), sem correção: 2074 dias de 2021-03-01 a 2026-11-03

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | – | – | 1,3 | – | 382 |
| ECMWF IFS | 3 | – | – | 1,5 | – | 378 |
| ECMWF IFS | 5 | – | – | 1,9 | – | 374 |
| ECMWF AIFS | 1 | – | – | 1,3 | – | 622 |
| ECMWF AIFS | 3 | – | – | 1,4 | – | 620 |
| ECMWF AIFS | 5 | – | – | 1,7 | – | 604 |
| UKMO 10 km | 1 | – | – | 1,3 | 22,1 | 622 |
| UKMO 10 km | 3 | – | – | 1,5 | 25,2 | 658 |
| UKMO 10 km | 5 | – | – | 1,9 | 22,0 | 652 |

## Porto Alegre aeroporto (SBPA), sem correção: 1917 dias de 2021-03-01 a 2026-11-03

| Modelo | Antecedência | Acerto sim/não | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Dias |
|---|---|---|---|---|---|---|
| ECMWF IFS | 1 | – | – | 1,2 | – | 383 |
| ECMWF IFS | 3 | – | – | 1,5 | – | 379 |
| ECMWF IFS | 5 | – | – | 1,8 | – | 375 |
| ECMWF AIFS | 1 | – | – | 1,3 | – | 623 |
| ECMWF AIFS | 3 | – | – | 1,3 | – | 621 |
| ECMWF AIFS | 5 | – | – | 1,6 | – | 605 |
| UKMO 10 km | 1 | – | – | 1,2 | 12,6 | 572 |
| UKMO 10 km | 3 | – | – | 1,4 | 12,7 | 574 |
| UKMO 10 km | 5 | – | – | 1,9 | 13,1 | 569 |

## Pesos dos modelos do painel (560 dias comuns)

| Modelo | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Peso relativo |
|---|---|---|---|---|
| ECMWF IFS | 4,0 | 2,1 | – | 1,04 |
| ECMWF AIFS | 3,2 | 2,4 | – | 1,10 |
| UKMO 10 km | 4,8 | 2,4 | 11,2 | 0,90 |
