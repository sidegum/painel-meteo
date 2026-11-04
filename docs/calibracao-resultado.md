# Resultado da calibração (gerado automaticamente)

Gerado em 2026-11-04 15:39 UTC por `scripts/calibrar.mjs`. Método em [CALIBRACAO.md](CALIBRACAO.md).

Estação: INMET A884 Campo Bom. Medições de 2021-03-01 a 2026-08-31 (2010 dias válidos).

Todos os números de "depois" são **fora da amostra**: cada mês foi corrigido com uma calibração que não viu aquele mês.

## Cobertura das previsões passadas

| Modelo | No painel | De | Até | Dias |
|---|---|---|---|---|
| ECMWF IFS | sim | 2025-01-02 | 2026-11-03 | 404 |
| ECMWF AIFS | sim | 2025-02-18 | 2026-11-03 | 624 |
| UKMO 10 km | sim | 2024-08-06 | 2026-11-03 | 820 |
| ECMWF IFS 0,25° | referência | 2024-02-04 | 2026-11-03 | 1004 |
| GFS | referência | 2021-03-24 | 2026-11-03 | 2030 |
| ICON | referência | 2024-01-20 | 2026-11-03 | 1019 |

## Temperatura exibida (ECMWF IFS): erro médio em °C

| Antecedência | Máx. antes | Máx. depois | Mín. antes | Mín. depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 1,9 | 1,2 | 0,9 | 0,9 | 304 |
| 2 dia(s) | 2,0 | 1,2 | 1,1 | 1,1 | 307 |
| 3 dia(s) | 2,1 | 1,4 | 1,1 | 1,1 | 302 |
| 4 dia(s) | 2,3 | 1,5 | 1,2 | 1,2 | 321 |
| 5 dia(s) | 2,4 | 1,8 | 1,4 | 1,4 | 300 |

## Rajada exibida (mediana dos modelos): erro médio em km/h

| Antecedência | Antes | Depois | Viés antes | Viés depois | Dias |
|---|---|---|---|---|---|
| 1 dia(s) | 25,7 | 17,5 | 23,7 | 8,6 | 459 |
| 2 dia(s) | 11,3 | 5,9 | 9,0 | 0,1 | 466 |
| 3 dia(s) | 27,2 | 21,3 | 24,6 | 11,5 | 451 |
| 4 dia(s) | 11,0 | 6,4 | 8,2 | 0,1 | 446 |
| 5 dia(s) | 25,4 | 19,4 | 22,3 | 8,7 | 398 |

## Viés de cada modelo por estação do ano (antecedência de 1 dia)

Temperatura: previsto − medido, em °C (positivo = o modelo esquenta demais). Rajada: fator medido ÷ previsto.

| Modelo | Medida | Verão | Outono | Inverno | Primavera | Usado |
|---|---|---|---|---|---|---|
| ECMWF IFS | máxima | -1,9 | -1,6 | -0,6 | -1,6 | sim |
| ECMWF IFS | mínima | -0,3 | -0,2 | -0,2 | -0,5 | não |
| ECMWF IFS | vento | 0,59 | 0,59 | 0,62 | 0,58 | sim |
| ECMWF AIFS | máxima | -2,7 | -2,4 | -1,9 | -2,4 | sim |
| ECMWF AIFS | mínima | 0,6 | 0,7 | 0,4 | 0,5 | sim |
| ECMWF AIFS | vento | 0,77 | 0,74 | 0,77 | 0,73 | sim |
| UKMO 10 km | máxima | -2,0 | -2,1 | -1,6 | -1,9 | sim |
| UKMO 10 km | mínima | -0,2 | -0,3 | 0,1 | -0,4 | sim |
| UKMO 10 km | rajada | 0,63 | 0,65 | 0,50 | 0,61 | sim |
| UKMO 10 km | vento | 0,57 | 0,59 | 0,67 | 0,60 | sim |
| ECMWF IFS 0,25° | máxima | -2,6 | -1,7 | -1,0 | -2,1 | sim |
| ECMWF IFS 0,25° | mínima | -0,3 | -0,0 | 0,1 | -0,1 | não |
| ECMWF IFS 0,25° | vento | 0,59 | 0,59 | 0,61 | 0,56 | sim |
| GFS | máxima | 0,4 | -0,4 | -0,7 | -0,8 | sim |
| GFS | mínima | -0,6 | -0,1 | 0,7 | -0,2 | sim |
| GFS | rajada | 0,84 | 0,83 | 0,89 | 0,84 | sim |
| GFS | vento | 0,62 | 0,71 | 0,86 | 0,70 | sim |
| ICON | máxima | -0,9 | -0,9 | -0,6 | -0,6 | sim |
| ICON | mínima | 0,6 | 0,9 | 1,5 | 1,2 | sim |
| ICON | rajada | 0,69 | 0,69 | 0,69 | 0,69 | sim |
| ICON | vento | 0,65 | 0,73 | 0,80 | 0,68 | sim |

## Chuva diária por modelo (dia com chuva = 1 mm ou mais)

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

## Pesos dos modelos do painel (335 dias comuns)

| Modelo | Erro chuva (mm) | Erro máxima (°C) | Erro rajada (km/h) | Peso relativo |
|---|---|---|---|---|
| ECMWF IFS | 4,0 | 2,1 | – | 1,04 |
| ECMWF AIFS | 3,2 | 2,5 | – | 1,10 |
| UKMO 10 km | 4,9 | 2,4 | 11,6 | 0,91 |
