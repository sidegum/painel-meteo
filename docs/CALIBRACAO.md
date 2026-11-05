# Calibração com histórico

Este documento explica como o painel usa o histórico real de Campo Bom para corrigir os modelos. Os números atuais, gerados automaticamente a cada execução, ficam em [calibracao-resultado.md](calibracao-resultado.md).

## 1. Ideia em uma frase

Para cada modelo, o painel compara **o que ele previu de 1 a 5 dias antes** com **o que a estação do INMET em Campo Bom mediu**, dia após dia. Com isso, descobre os erros que se repetem (por exemplo, "o ECMWF esfria a máxima em 1 °C no verão" ou "o UKMO exagera as rajadas em 25%") e os desconta da previsão.

Exemplo concreto: se, em 200 dias de verão, o ECMWF previu em média 29,0 °C de máxima quando a estação mediu 30,2 °C, o viés é −1,2 °C. Uma previsão nova de 31 °C para um dia de verão passa a ser mostrada como 32,2 °C.

## 2. Fontes

| O quê | Fonte | Período | Observação |
|---|---|---|---|
| Medições hora a hora | INMET, BDMEP: `https://portal.inmet.gov.br/uploads/dadoshistoricos/{ANO}.zip`, estação automática A884 Campo Bom | todo o período coletado | Um ZIP por ano com um CSV por estação. Licença: citar a fonte (INMET). |
| Previsões passadas | Open-Meteo Previous Runs API, `https://previous-runs-api.open-meteo.com/v1/forecast`, variáveis `<var>_previous_day1` a `_previous_day5` | GFS (temperatura) desde mar/2021; demais modelos desde jan/2024 ou depois (doc oficial) | CC BY 4.0. `_previous_dayN` = valor previsto N dias antes da hora válida. |

Modelos coletados:

| Modelo | Identificador | Uso |
|---|---|---|
| ECMWF IFS (9 km) | `ecmwf_ifs` | painel (temperatura principal, chuva, vento) |
| ECMWF AIFS | `ecmwf_aifs025_single` | painel (não tem rajada) |
| UKMO 10 km | `ukmo_global_deterministic_10km` | painel |
| ECMWF IFS 0,25° | `ecmwf_ifs025` | referência; também calibra a rajada dos cenários ECMWF ENS, que usam a mesma grade |
| GFS | `ncep_gfs_seamless` | só referência no relatório |
| ICON | `dwd_icon_global` | só referência no relatório |

Por que "todo o histórico" começa em 2021/2024: a calibração precisa de **pares** previsão × medição. O INMET tem medições de Campo Bom desde a fundação da estação, mas os arquivos públicos de previsões passadas por antecedência só existem a partir dessas datas. Medição sem previsão correspondente não ensina nada sobre o erro do modelo. O coletor pede tudo desde mar/2021 e guarda o que existir, então qualquer dado que a Open-Meteo acrescentar ao arquivo entra sozinho na próxima execução.

## 3. Coleta (`scripts/historico.mjs`)

1. **INMET.** Baixa o ZIP de cada ano, procura a entrada com `_A884_` no nome e extrai com um leitor de ZIP próprio (`scripts/lib/inmet.mjs`, `listarZip` e `extrairZip`, sem dependências). Anos fechados ficam em cache no GitHub Actions.
2. **CSV** (`lerCsvInmet`). Latin-1, separador `;`, decimal com vírgula, ausente = vazio ou −9999. As colunas são achadas pelo nome sem acento (o INMET muda a grafia entre anos). Vento e rajada vêm em m/s e viram km/h (× 3,6). Horas em UTC.
3. **Controle de qualidade** (`controleQualidade`). Descarta, sem tentar corrigir: temperatura fora de −10 a 45 °C; chuva negativa ou acima de 120 mm/h; rajada acima de 200 km/h; vento acima de 150 km/h; picos isolados de temperatura (mais de 8 °C diferente das duas horas vizinhas, na mesma direção); rajada menor que o vento médio da mesma hora. As contagens de descartes ficam em `dados/historico/A884-diario.json` (`qc`).
4. **Dia local** (`diasLocais`). Fuso fixo −3 h (o Brasil não tem horário de verão desde 2019). A leitura das 03:00 UTC fecha o dia anterior, igual à convenção da Open-Meteo (o valor da hora T cobre a hora que termina em T). O dia só entra com dados suficientes: 22 horas para a chuva, 20 para máxima, mínima, rajada e vento. Máxima e mínima usam as colunas "máxima/mínima na hora anterior", que pegam o extremo entre as leituras.
5. **Previsões** (`prevDiaria`). Uma chamada por modelo a cada 60 dias, com as 4 variáveis × 5 antecedências, `timezone=America/Sao_Paulo`, `wind_speed_unit=kmh`. O dia de previsão segue as mesmas regras de horas mínimas (24 para a soma de chuva).
6. **Tabela.** `dados/historico/A884-diario.json`, uma linha por dia: `{ obs: { chuva, tmax, tmin, rajada, vento, horas }, prev: { modelo: { antecedência: [chuva, tmax, tmin, rajada, vento] } } }`. É incremental: na execução mensal só os dias novos (e os 10 mais recentes, que o INMET completa com atraso) são buscados.

## 4. Cálculo (`scripts/calibrar.mjs` e `scripts/lib/calibracao.mjs`)

### 4.1 Temperatura: viés aditivo por estação do ano

Para cada modelo e antecedência:

```
viés anual        = média(previsto − medido)                        (erros limitados a ±10 °C)
viés da estação   = (n_e · média_e + K · viés anual) / (n_e + K)      K = 20 dias
previsão corrigida = previsão − viés da estação
```

O termo com K é um **encolhimento**: com poucos dias numa estação do ano, o valor fica perto do anual; com muitos, vale o da estação. Exemplo: 10 dias de inverno com viés −2 °C e viés anual −0,5 °C dão (10·(−2) + 20·(−0,5)) / 30 = −1,0 °C.

Estações do ano (hemisfério sul): verão = dez, jan, fev; outono = mar, abr, mai; inverno = jun, jul, ago; primavera = set, out, nov.

### 4.2 Rajada e vento: fator multiplicativo por estação do ano

```
fator anual       = soma(medido) / soma(previsto)
fator da estação  = (n_e · fator_e + K · fator anual) / (n_e + K)
previsão corrigida = previsão × fator              (limitado entre 0,5 e 1,6)
```

Multiplicativo, e não aditivo, porque o erro de rajada cresce com a força do vento e porque assim vento previsto zero continua zero. Como o fator é positivo, o máximo do dia corrigido é o máximo corrigido de cada hora, então aplicar hora a hora (no app) é exatamente o que foi validado no máximo diário.

Ressalva medida, não suposta: a estação mede o vento num ponto, a 10 m, com o entorno dela; o modelo representa uma área de alguns quilômetros. O fator corrige para o que se mede **na estação de Campo Bom**, que é o mais próximo do que se sente na cidade.

### 4.3 Chuva: mapeamento de quantis (`scripts/lib/chuva.mjs`)

Achado medido: os modelos do painel preveem dia com chuva (1 mm ou mais) **1,5 a 2 vezes** mais do que chove em Campo Bom (garoa prevista que não acontece) e somam 20 a 30% a mais de volume. Um fator único não resolve: garoa de 0,5 mm e temporal de 40 mm erram de jeitos diferentes.

Método: para cada modelo e estação do ano, com as antecedências de 1 a 5 dias somadas (a distribuição pouco muda com a antecedência), calcula 51 quantis do total diário previsto e 51 do medido nos mesmos dias. O total previsto é levado ao valor medido de mesma posição (`mapearChuva`, em js/analise.js, a mesma função no app e no script): o 70º percentil previsto vira o 70º percentil medido. A ordem não muda (dia mais chuvoso continua mais chuvoso); a garoa abaixo do limiar real vira zero e o volume fica na escala medida. Acima do maior quantil, mantém a razão do topo. A tabela da estação do ano encolhe para a anual com `K = 100` pares.

Validação: um mês de fora, como o resto. Usada (`chuvaQuantis.usar`) só se o acerto sim/não subir pelo menos 1 ponto e o erro em mm não piorar mais que 2%. Resultado (fora da amostra, antecedências somadas): ECMWF IFS 74% → 80%, AIFS 71% → 84%, UKMO 76% → 79%; frequência prevista ÷ real cai para cerca de 1,0. A detecção cai (de cerca de 85% para 65 a 70%): o modelo para de "prever chuva sempre"; dias de chuva fraca que ele já previa com pouco volume passam a não contar. É o preço de parar com os alarmes falsos, e ele aparece no relatório.

Onde entra no app: `calibrarPrevisao` mapeia o total de cada dia local de cada modelo e escala as horas do dia na mesma proporção; `calibrarEnsemble` faz o mesmo com cada membro dos cenários, usando a tabela do determinístico de mesma origem (ECMWF ENS → `ecmwf_ifs025`, MOGREPS-G → UKMO 10 km). Suposição, não testada: o viés de garoa é do sistema (física e grade), não do membro. O AIFS ENS fica sem correção, porque é treinado de outro jeito que o AIFS determinístico. Assim a chance de chuva (cenários), o volume e a comparação de modelos saem da mesma série corrigida.

### 4.4 Pesos dos modelos

Em datas comuns aos três modelos do painel (comparação justa), o erro absoluto médio de chuva, máxima e rajada (média das antecedências 1 a 5) vira um peso relativo:

```
peso relativo = média, entre as medidas, de (erro médio dos modelos / erro do modelo)
```

No app (`pesosModelos`), esse peso ajusta o peso inicial global: `pesoInicial × (1 + c·(r − 1))`, com `c = dias / (dias + 30)`, limitado a 0,7–1,3. O aprendizado diário refina por cima.

### 4.5 Validação honesta: um mês de fora

Uma correção ajustada e testada nos mesmos dados sempre parece melhor do que é. Por isso, para cada mês do histórico:

1. ajusta a correção com **todos os outros meses**;
2. corrige o mês deixado de fora;
3. mede o erro desse mês.

O erro "depois" do relatório é a média desses meses nunca vistos pela calibração. Uma correção só recebe `usar: true` (e só então é aplicada no app) se reduzir o erro absoluto médio em pelo menos 2% (`PARAM.ganhoMinimo`). O mês inteiro sai junto para que dias vizinhos, parecidos entre si, não vazem informação para o teste.

### 4.6 Temperatura hora a hora (`scripts/lib/temperatura-horaria.mjs`)

Por quê: o erro do modelo muda ao longo do dia (no verão, o ECMWF costuma esfriar demais a tarde e errar menos de madrugada). A correção só de máxima e mínima desloca a curva inteira; a correção por hora acerta também as 15 h, as 18 h e a noite.

Dados (`dados/historico/A884-horario.json`): temperatura medida na hora cheia (INMET A884) e, para ECMWF IFS, AIFS e UKMO, a prevista hora a hora: `h0` = primeiras horas de cada rodada (Historical Forecast, desde 2022) e `p1…p5` = prevista 1 a 5 dias antes (Previous Runs; ECMWF IFS desde out/2025, os outros desde 2024).

Ajuste em duas etapas, a mesma conta no app (`prepararCorrecaoDia`):

1. **Viés por hora do dia e estação do ano.** Primeiro com `h0` (quatro anos: a base); depois, para cada antecedência, `(n·média + 20·base) / (n + 20)` por estação e hora. A base de curto prazo dá estabilidade; os dias de 1 a 5 dias antes ajustam o que muda com a antecedência.
2. **Ajuste residual de máxima e mínima.** A hora cheia não pega o pico entre duas leituras; o INMET mede máxima e mínima da hora anterior. Depois da etapa 1, o viés diário (como em 4.1) entre o extremo da série corrigida e o extremo medido entra pela mesma interpolação do método diário.

Validação: um mês de fora (inclusive da base) e três versões comparadas no mês deixado de fora: bruta, método diário (4.1) e horário. O horário só é usado (`temperaturaHoraria.modelos[m].leads[L].usar`) se reduzir o erro hora a hora em pelo menos 2% frente ao **método diário** sem piorar máxima e mínima em mais de 0,05 °C. Sem aprovação, vale o método diário. Números em `calibracao-resultado.md`.

No app, `correcaoTemperaturaDia` decide por modelo, antecedência e mês: horário quando aprovado, senão diário. O aprendizado recente do Worker soma, aos extremos, o que acrescenta ao histórico diário. A ancoragem na medição de agora (`ancorarTemperatura`) vem depois, sobre a série já corrigida.

### 4.7 Ponto de orvalho e sensação térmica (`scripts/lib/sensacao.mjs`)

A sensação térmica não é medida por um instrumento: é uma conta com temperatura, umidade e vento. O painel usa uma conta só, para a previsão e para a medição (`sensacaoTermica`, em js/analise.js), no padrão do serviço meteorológico dos EUA (NWS), o mesmo da maioria dos apps de tempo:

```
frio (T ≤ 10 °C, vento > 4,8 km/h):  13,12 + 0,6215·T − 11,37·v^0,16 + 0,3965·T·v^0,16   v em km/h
                                     entre 10 e 15 °C o efeito do vento cai em linha reta até zero
demais casos (índice de calor, °F):   HI = 0,5·(T + 61 + 1,2·(T − 68) + 0,094·UR)
                                     se (HI + T)/2 ≥ 80 °F: regressão de Rothfusz com os ajustes do NWS
                                     resultado nunca abaixo de T
UR = 100·e / es(T)    e = 6,105·exp(17,27·Td / (237,7 + Td))   Td = ponto de orvalho (°C)
```

Exemplos: 30 °C com orvalho 24 °C dá 35,1 °C; 21,1 °C com 100% de umidade dá 21,9 °C; 5 °C com vento de 30 km/h dá 0,1 °C.

Até a versão 1.2.26 o painel usava a temperatura aparente de Steadman na forma da Bureau of Meteorology (T + 0,33·e − 0,70·v − 4,00). Ela exagerava o abafamento em temperaturas amenas e úmidas: na madrugada de 05/11/2026, com 21,1 °C, 100% de umidade e vento de 1 km/h na A884, dava 25,1 °C (o INMET publicou 23,9 °C). O NWS dá 21,9 °C. A sensação que o INMET publica (`TEM_SEN`) não é usada: a fórmula dela não é documentada.

No app (`umidadeESensacao`, chamada em `calibrarPrevisao`), a sensação prevista é refeita hora a hora com a temperatura corrigida (4.1 e 4.6), o vento corrigido (4.2) e o ponto de orvalho corrigido pelo viés da hora do dia e estação do ano, quando aprovado. A umidade relativa é refeita com o mesmo vapor: com a temperatura corrigida para cima e o mesmo orvalho, a umidade cai, como no ar de verdade. A `apparent_temperature` da Open-Meteo não é usada, porque a fórmula dela não é a mesma da sensação medida.

Ponto de orvalho: viés por hora do dia e estação do ano, medido na véspera (orvalho previsto 1 dia antes × medido no INMET A884) e usado em todas as antecedências, com validação de um mês de fora e ganho mínimo de 2%.

Conferência: para a véspera, a sensação prevista (bruta e corrigida como o painel mostra) é comparada hora a hora com a sensação calculada pelas medições do INMET A884 na mesma hora, pela mesma fórmula. O relatório traz o erro por hora, à tarde, na sensação máxima e na mínima do dia. Ressalva: o fator do vento usado na conferência é o ajustado com todos os meses (não fora da amostra); o efeito dele na sensação é pequeno (0,7 °C por m/s).

## 5. Arquivo `dados/calibracao.json`

```
{
  versao: 1, geradoEm, estacao: { id, nome, lat, lon }, periodo: { ini, fim, diasComMedicao },
  metodo: { validacao, encolhimentoDias, ganhoMinimo, limitesFatorVento },
  cobertura: { modelo: { ini, fim, dias } },
  pesos: { modelo: pesoRelativo }, maeComum: { modelo: { chuva, tmax, rajada } }, diasComuns,
  resumo: { temperaturaEcmwf: { tmax|tmin: { lead: { n, maeAntes, maeDepois, usar } } },
            rajadaMediana: { lead: { n, maeAntes, maeDepois, viesAntes, viesDepois } } },
  modelos: { modelo: {
    tmax|tmin: { lead: { usar, n, viesAnual, vies: { verao, outono, inverno, primavera }, nEstacao, maeAntes, maeDepois, ganho } },
    rajada|vento: { lead: { usar, n, fatorAnual, fator: { ... }, nEstacao, maeAntes, maeDepois, viesAntes, viesDepois, ganho } },
    chuva: { lead: { n, mae, vies, razaoVolume, acerto, pod, far, viesFrequencia, csi } } } }
}
```

## 6. Uso no app

Resumo (detalhes em [TECNICO.md](TECNICO.md), seção 3.7):

- `buscarCalibracao` (js/dados.js) lê o arquivo do próprio GitHub Pages, uma vez por dia, e guarda no cache local.
- `recalibrar` (js/app.js) é a **fonte única**: a partir das séries brutas, gera as séries calibradas que todas as telas usam. Nenhuma tela faz ajuste próprio, então primeira tela, gráficos, Semana, comparação de modelos e análise de pressão sempre mostram os mesmos números.
- `calibrarPrevisao` (js/analise.js) corrige a temperatura (hora a hora quando aprovada, seção 4.6; senão interpolando entre a correção da mínima e a da máxima), a temperatura atual prevista, rajada, vento e chuva (seção 4.3), e refaz orvalho, umidade e sensação térmica com os valores corrigidos (seção 4.7).
- `calibrarEnsemble` aplica o fator de rajada e a tabela de chuva aos cenários (ECMWF ENS com os do `ecmwf_ifs025`; MOGREPS-G com os do UKMO 10 km). Suposição, não testada: o erro de escala é do sistema (física e grade), e não de cada membro. O AIFS não tem rajada, e o AIFS ENS fica sem correção de chuva.
- `correcaoTemperatura` mistura o viés histórico com o aprendizado diário do Worker: `(n·recente + 20·histórico) / (n + 20)`. O histórico dá o ponto de partida no primeiro dia; o recente capta mudanças (atualização de modelo, mudança no entorno da estação).
- Tudo só vale a até 50 km da A884 (`calibracaoAplicavel`). Fora disso, o painel mostra os modelos sem correção histórica.

## 7. Ajustes

| Onde | Parâmetro | Efeito |
|---|---|---|
| `scripts/lib/calibracao.mjs`, `PARAM` | `encolhimento` (20) | maior = estações do ano mais parecidas com o anual |
| | `ganhoMinimo` (0,02) | ganho mínimo fora da amostra para usar uma correção |
| | `fatorVento` ([0,5; 1,6]) | limites do fator de rajada e vento |
| `scripts/lib/chuva.mjs`, `PARAM_CHUVA` | `encolhimento` (100), `ganhoAcerto` (0,01), `perdaMaxErro` (0,02) | tabela de chuva por estação do ano e critério de uso |
| `scripts/lib/temperatura-horaria.mjs`, `PARAM_HORARIO` | `encolhimento` (20), `minDias` (60) | viés hora a hora e mínimo de dias |
| `js/analise.js`, `REGRAS.calibracao` | `forcaHistorico` (20) | peso do histórico frente ao aprendizado diário |
| | `leadMax` (5) | antecedência máxima medida; acima disso usa a de 5 dias |
| `js/analise.js`, `REGRAS.aprendizado` | `viesMax` (3) | correção máxima de temperatura, em °C |

## 8. Como rodar

- Automático: `.github/workflows/calibracao.yml`, todo dia às 07:40 (Brasília), publica no mesmo branch.
- À mão: na aba Actions do GitHub, "Calibração com histórico" → "Run workflow".
- Local (com rede liberada para INMET e Open-Meteo): `node scripts/historico.mjs && node scripts/calibrar.mjs`.
- Só recalcular, sem rede: `node scripts/calibrar.mjs`.

## 9. Limites conhecidos

- Uma estação só. A calibração vale para Campo Bom e arredores (50 km); outras cidades usam os modelos sem correção histórica.
- O histórico por antecedência começa em 2024 para os modelos do painel. Com cerca de dois anos, cada estação do ano tem perto de 180 dias por modelo e antecedência: suficiente para viés e fator, ainda pouco para casos raros (temporais fortes).
- A chance de chuva dos cenários não é medida diretamente pelo histórico, porque a Previous Runs não guarda os cenários: ela herda a correção de garoa do modelo de mesma origem (seção 4.3), e o aprendizado diário do Worker (`calibrarProb`) ajusta o resto.
- A calibração por hora do dia e estação do ano da **chance** de chuva não é possível com o arquivo disponível (pelo mesmo motivo). A correção de volume é diária; a distribuição das horas dentro do dia segue o modelo.
- Erro de situação (frente fria atrasada, nebulosidade que o modelo não viu, como em 04/11/2026 às 16 h, 4,5 °C abaixo do medido) não é viés fixo e nenhuma calibração estatística o remove. Para as próximas horas, quem corrige é a ancoragem na medição de agora.
- O fator de rajada dos cenários é uma suposição (seção 6).
