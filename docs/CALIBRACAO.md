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

### 4.3 Chuva: só métricas, sem correção de volume

O relatório traz, por modelo e antecedência: acerto sim/não (dia com 1 mm ou mais), detecção (dias de chuva que o modelo previu), alarme falso, frequência prevista ÷ real e volume previsto ÷ medido.

Por que não corrigir o volume: o erro de chuva diária é dominado por posição e horário (a célula de chuva cai 10 km ao lado, ou às 23 h em vez de 01 h), e não por um fator constante. Um multiplicador aplicado aos modelos não se aplicaria de forma coerente aos 120 cenários que dão a chance de chuva, e o painel passaria a mostrar volumes de uma fonte e chances de outra. A chance de chuva continua sendo calibrada pelo aprendizado diário do Worker, que compara a chance que o próprio painel deu com a chuva que caiu.

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
- `calibrarPrevisao` (js/analise.js) corrige temperatura hora a hora (interpolando entre a correção da mínima e a da máxima), a temperatura atual prevista, rajada e vento.
- `calibrarEnsemble` aplica o fator de rajada aos cenários (ECMWF ENS com o fator do `ecmwf_ifs025`; MOGREPS-G com o do UKMO 10 km). Suposição, não testada: o erro de escala da rajada é do sistema (física e grade), e não de cada membro. O AIFS não tem rajada.
- `correcaoTemperatura` mistura o viés histórico com o aprendizado diário do Worker: `(n·recente + 20·histórico) / (n + 20)`. O histórico dá o ponto de partida no primeiro dia; o recente capta mudanças (atualização de modelo, mudança no entorno da estação).
- Tudo só vale a até 50 km da A884 (`calibracaoAplicavel`). Fora disso, o painel mostra os modelos sem correção histórica.

## 7. Ajustes

| Onde | Parâmetro | Efeito |
|---|---|---|
| `scripts/lib/calibracao.mjs`, `PARAM` | `encolhimento` (20) | maior = estações do ano mais parecidas com o anual |
| | `ganhoMinimo` (0,02) | ganho mínimo fora da amostra para usar uma correção |
| | `fatorVento` ([0,5; 1,6]) | limites do fator de rajada e vento |
| `js/analise.js`, `REGRAS.calibracao` | `forcaHistorico` (20) | peso do histórico frente ao aprendizado diário |
| | `leadMax` (5) | antecedência máxima medida; acima disso usa a de 5 dias |
| `js/analise.js`, `REGRAS.aprendizado` | `viesMax` (3) | correção máxima de temperatura, em °C |

## 8. Como rodar

- Automático: `.github/workflows/calibracao.yml`, todo dia 5, publica no mesmo branch.
- À mão: na aba Actions do GitHub, "Calibração com histórico" → "Run workflow".
- Local (com rede liberada para INMET e Open-Meteo): `node scripts/historico.mjs && node scripts/calibrar.mjs`.
- Só recalcular, sem rede: `node scripts/calibrar.mjs`.

## 9. Limites conhecidos

- Uma estação só. A calibração vale para Campo Bom e arredores (50 km); outras cidades usam os modelos sem correção histórica.
- O histórico por antecedência começa em 2024 para os modelos do painel. Com cerca de dois anos, cada estação do ano tem perto de 180 dias por modelo e antecedência: suficiente para viés e fator, ainda pouco para casos raros (temporais fortes).
- A chance de chuva não é calibrada pelo histórico, porque a Previous Runs não guarda os cenários.
- O fator de rajada dos cenários é uma suposição (seção 6).
