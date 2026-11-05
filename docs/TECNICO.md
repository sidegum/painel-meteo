# Documentação técnica

Referência técnica do Painel Meteorológico: arquitetura, fluxo de dados, módulos, funções, algoritmos e infraestrutura.
Este documento acompanha o código. Toda alteração no código deve atualizar a seção correspondente aqui.

Versão do app documentada: **1.2.14**. Versão do Worker: **1.1.0**.

Documentos complementares:

- `docs/DESIGN.md`: decisões visuais.
- `docs/SEGURANCA.md`: modelo de ameaças.
- `docs/ENTREGA.md`: implantação.
- `docs/VENDOR.md`: bibliotecas fixadas.

---

## 1. Visão geral da arquitetura

```
┌──────────────────────────── Navegador (PWA, GitHub Pages) ────────────────────────────┐
│ index.html + app.css                                                                  │
│ js/app.js ── orquestração, estado, renderização das abas                              │
│   ├─ js/analise.js  funções puras (estatística, confiança, aprendizado)  ← testado    │
│   ├─ js/dados.js    rede, normalização, cache de dados                                │
│   ├─ js/graficos.js gráficos de linha (uPlot 1.6.32)                                  │
│   ├─ js/faixa.js    "Faixa do Céu" (canvas 2D)                                        │
│   ├─ js/mapa.js     mapa (Leaflet 1.9.4), carregado sob demanda                       │
│   ├─ js/ui.js       criação de DOM segura, formatação, preferências                   │
│   └─ js/config.js   configuração pública (sem segredos)                               │
│ sw.js ── service worker: cache dos arquivos do app (rede primeiro)                    │
└───────────────┬───────────────────────────────────────────────┬───────────────────────┘
                │ HTTPS direto (CORS aberto)                     │ HTTPS, CORS restrito à origem do app
                ▼                                                ▼
   api.open-meteo.com (previsão, grade)            Cloudflare Worker (worker/src/index.js)
   ensemble-api.open-meteo.com (cenários)            /v1/observacoes  INMET + METAR
   geocoding-api.open-meteo.com (cidades)            /v1/alertas      avisos INMET
   api.rainviewer.com + tilecache (radar)            /v1/enso         NOAA CPC + IRI
   tile.openstreetmap.org (mapa base)                /v1/acerto       verificação dos modelos
   dados/enso.json (mesmo domínio)                   /v1/saude
                                                     KV: séries, acerto, previsões, ENSO
                                                     Cron: séries (1 h), ENSO (6 h), acerto (diário)
```

O app é estático: módulos ES nativos, sem build e sem framework. O código de terceiros fica em `vendor/`, com a versão fixada.
O Worker existe por três motivos:

1. Algumas fontes não liberam CORS: INMET, aviationweather.gov, NOAA CPC e IRI.
2. O token do INMET precisa ficar em segredo.
3. A verificação diária dos modelos precisa rodar no servidor.

### 1.1 Princípios de projeto

- **Só dado real.** Uma variável ausente aparece como "sem dado" ou hachurada e nunca é estimada sem aviso. As séries totalmente nulas de um modelo são tratadas como ausentes.
- **Funções puras separadas.** Toda regra numérica fica em `analise.js`, sem DOM e sem rede, e é testada no Node (`test/analise.test.mjs`).
- **Limites centralizados.** Todos os limiares ficam no objeto `REGRAS`.
- **Entrada externa não é confiável.** Os dados recebidos são copiados campo a campo, com validação de tipo e de faixa. O DOM é criado só por `el()` e `svg()` (`textContent`, nunca `innerHTML`). A página não usa `eval`.
- **Privacidade.**
  - Só coordenadas arredondadas para 2 casas (cerca de 1 km) saem do aparelho.
  - A posição exata do GPS fica só em memória (`estado.localExato`).
  - O Worker não grava IP nem localização.

---

## 2. Fluxo de dados no app

### 2.1 Inicialização (`iniciar`)

1. `aplicarTema`, `configurarNavegacao`, `configurarLocal`, `configurarRodape` e `configurarPuxar` registram tema e eventos.
2. **Primeira pintura com o cache.** `lerCache('previsao' | 'ensemble' | 'observacoes')` lê o Cache Storage. Se houver dados e um local salvo, `renderTudo()` desenha na hora e `estado.cacheAntigo = true` gera o aviso "Mostrando dados salvos".
3. **Localização.**
   - Se uma cidade foi escolhida nesta sessão (`sessionStorage.localEscolhido`), o app usa essa cidade.
   - Senão, `atualizar()` começa com o último local salvo, em paralelo com `localizarGps()`.
   - Se a coordenada arredondada mudar depois do GPS, o app busca de novo com `local: true`.
4. `agendar()` registra os gatilhos de atualização (seção 2.3).
5. O service worker é registrado com `updateViaCache: 'none'`. No `controllerchange`, a página recarrega uma vez para assumir a versão nova.

### 2.2 Atualização (`atualizar` e `atualizarTudo`)

`atualizar({ forcar, local, agora })` dispara todas as fontes em paralelo. Cada fonte tem validade própria em `CONFIG.intervalos`, em minutos. `forcar` e `local` ignoram a validade. `local` também descarta cenários, medições e alertas do local anterior.

| Tarefa | Função | Gravado em `estado` | Cache local |
|---|---|---|---|
| Previsão determinística | `buscarPrevisao` | `prev`, `prevEm` | `previsao` |
| Cenários (ensemble) | `buscarEnsemble` | `ens`, `ensEm`, `ensErros` | `ensemble` |
| Medições | `buscarObservacoes` (Worker), com fallback para `buscarObservacoesDireto` | `obs`, `obsEm` | `observacoes` |
| Alertas | `buscarAlertas` (Worker), com fallback para `buscarAlertasDireto` | `alertas`, `alertasEm` | não |
| Chuva sobre o ponto (radar) | `buscarChuvaRadar` | `radarAgora` | não |
| El Niño | `buscarEnso` | `enso`, `ensoEm` | `enso` |
| Acerto dos modelos | `buscarAcerto` × 3 estações | `acerto[id]`, `acertoEm` | não |

Controle de concorrência:

- `atualizando` impede duas buscas automáticas simultâneas. O botão (`forcar`) sempre dispara.
- Uma trava de 40 s libera o estado se o app foi suspenso no meio de uma busca.
- `principal` é a promessa da previsão e `resto` é `Promise.all(tarefas)` com teto de 30 s. A função retorna em `Promise.race([principal, resto])`, então o botão para de girar quando a previsão chega.
- As demais fontes redesenham a tela quando terminam (`renderTudo` no `.then` de `resto`).

`atualizarTudo()` é a atualização completa (botão, puxar para baixo, voltar ao app):

- Roda o GPS e `atualizar({ forcar: true })` em paralelo. Se a posição mudou, busca de novo.
- Controle por `rodada`: uma rodada com mais de 45 s é abandonada. O `vigia` de 50 s chama `pararGiro()` em qualquer caso.
- No fim, pede `registration.update()` ao service worker.

### 2.3 Quando os dados são buscados

Em quatro momentos, todos por `atualizarTudo()`:

1. Ao abrir o app.
2. Ao voltar para ele, pelos eventos `visibilitychange` (página visível) e `pageshow` com `persisted`.
3. No botão Atualizar ou no gesto de puxar para baixo.
4. Com a tela aberta e visível, quando passam `CONFIG.atualizarTelaAbertaMin` (10) minutos desde o início da última rodada (`ultimaRodada`). Qualquer rodada, inclusive a do botão, reinicia essa contagem.

O `setInterval` de 60 s reescreve o cabeçalho ("Atualizado às HH:MM", com ", desatualizado" depois de 45 min) e confere o item 4. Ele não busca nada com a página escondida (`document.hidden`) nem sem conexão (`navigator.onLine === false`).

### 2.4 Renderização

`renderTudo()`:

1. Destrói faixas e gráficos anteriores (`limparGraficos`) para não vazar memória nem observadores.
2. Desenha a primeira tela de Hoje e de Amanhã com `renderPrimeira`, que é o caminho crítico.
3. Pré-desenha os detalhes de todas as abas numa fila (`filaRender`), uma aba por `requestIdleCallback` (prazo de 1,5 s): primeiro a aba aberta, depois Hoje, Amanhã, Semana, Modelos e El Niño. Assim nenhuma tarefa longa trava o toque. Se o usuário abrir uma aba antes da vez dela, `irPara` a desenha na hora (`renderPendente`). Uma atualização nova invalida a fila anterior (`geracao`). Ao esvaziar a fila, `preCarregarGlobo` insere um `<link rel=modulepreload>` do `globo.js`, que baixa e prepara o código sem executá-lo, exceto com economia de dados ligada. Quando a aba desenhada é a aberta, `scrollY` é restaurado para a tela não pular.

### 2.5 Objeto `estado`

| Campo | Conteúdo |
|---|---|
| `local` | `{ nome, regiao, lat, lon, origem: 'gps' \| 'cidade' \| 'padrao' }`. Em `localStorage` fica a versão arredondada. |
| `localExato` | Coordenada exata do GPS, só em memória. É usada para distâncias calculadas no aparelho. |
| `prevBruta` | Saída de `normalizarPrevisao` (seção 4.2), como veio da Open-Meteo. É o que vai para o cache local. |
| `prev` | `prevBruta` calibrada por `recalibrar` (seção 3.7). Todas as telas leem daqui. |
| `ensBruto` | Cenários como vieram da Ensemble API. |
| `calib` | Conteúdo de `dados/calibracao.json` (seção 3.7 e CALIBRACAO.md). |
| `ens` | `ensBruto` com o fator de rajada aplicado. Formato: `{ [modeloEnsemble]: { horas[], membros: { precipitation: [[...]], wind_gusts_10m: [[...]] } } }` |
| `obs` | Resposta de `/v1/observacoes`: `{ fontes: [{ id, tipo, nome, lat, lon, serie[], acumulados }], status }` |
| `alertas` | `{ avisos: [...], semArea?, indisponivel? }` |
| `acerto` | `{ [estacao]: resposta de /v1/acerto }` |
| `erros` | Mensagem por fonte que falhou. É lida pelo cabeçalho e por `estadoFontes`. |
| `*Em` | Instante (ms) da última busca bem-sucedida de cada fonte. |

---

## 3. `js/analise.js`: regras e cálculos (funções puras)

### 3.1 `REGRAS`

| Chave | Valor | Uso |
|---|---|---|
| `chuvaMinimaMm` | 1 | Dia com chuva quando o total passa de 1 mm. |
| `chuvaHoraMm` | 0,2 | Hora com chuva (gráfico horário e janela provável). |
| `ocorrencia` | 0,7 / 0,4 / 0,15 | Probabilidade → "provável" / "possível" / "pouco provável". Abaixo disso, "improvável". |
| `volumeIncertoRazao` | 0,8 | (máx − mín) / mediana dos modelos acima disso marca o volume como incerto. |
| `volumeMinimoRazaoMm` | 2 | Piso da mediana nessa razão. |
| `rajadaIncertaRazao` | 0,35 | Dispersão relativa das rajadas entre modelos. Para cenários, usa o dobro. |
| `rajadaClasses` | 40 / 60 / 80 km/h | Moderadas / fortes / muito fortes. |
| `difSistemas` | 0,3 / 0,5 | Diferença de probabilidade entre sistemas de cenários: −1 / −2 níveis de confiança. |
| `horizonteLongoDias` | 4 | A partir do 5º dia, −1 nível. A partir do 8º, −2. |
| `pesoInicial` | IFS 1,3; AIFS 1,15; UKMO 1,15 | Peso de cada modelo antes do aprendizado. |
| `aprendizado` | ver 3.7 | Meias-vidas e limites das correções. |
| `acerto` | 30 dias; peso entre 0,7 e 1,3; taxa 0,6; 50 km | Uso da verificação local. |
| `divergencia` | 5 mm; 0,6; 25 km/h | Horizonte em que os modelos divergem (blocos de 6 h). |
| `limitesSemana` | chuva 1/10/30 mm; rajada 40/60/80 km/h | Probabilidades de passar limites na aba Semana. |
| `ceu` | 20 / 45 / 75 % | Cobertura média → limpo / poucas nuvens / parcial / nublado. |

`MODELOS` lista os três modelos determinísticos usados na previsão (ECMWF IFS, ECMWF AIFS e UKMO 10 km), com nome, nome curto e cor CSS.

### 3.2 Utilidades numéricas

- `valido(v)`: `true` só para um número finito. É o filtro universal de dados ausentes.
- `mediana(arr, pesos?)`: **mediana ponderada**.
  1. Ordena os pares (valor, peso) válidos.
  2. Acumula os pesos e devolve o primeiro valor em que o acumulado passa da metade do peso total.
  3. Se o acumulado for exatamente a metade, devolve a média dos dois valores vizinhos.
  4. Sem pesos, é a mediana comum. Com um peso maior, o valor desse modelo "puxa" o resultado sem que um modelo discrepante o arraste, como aconteceria numa média.
- `quantil(arr, q)`: quantil com interpolação linear entre as posições `(n−1)·q`.
- `minimo` e `maximo`: ignoram valores inválidos e devolvem `null` se não sobrar nenhum.
- `distanciaKm`: fórmula de haversine com R = 6371 km.
- `arredondaCoord`: arredonda para 2 casas decimais. Toda coordenada enviada para fora passa por aqui.
- `direcaoTexto`: graus → 8 pontos cardeais em português (N, NE, L, SE, S, SO, O, NO).

### 3.3 Tempo

- `isoLocalParaMs(iso, offsetSeg)`: converte o horário local da Open-Meteo (`"2026-11-03T16:00"`) para epoch ms, usando `utc_offset_seconds`. Não depende do fuso do aparelho.
- `partesLocais(ms, offsetSeg)`: decompõe um instante em ano, mês, dia, hora, minuto, dia da semana e data ISO no fuso do local.
- `periodoDoDia(hora)`: devolve madrugada (<6), manhã (<12), tarde (<18) ou noite.

### 3.4 Validação de leituras e escolha de estação

- `leituraValida(variavel, valor)`: rejeita valores sentinela (9999, −9999, 999,9 e outros) e valores fora de `FAIXAS`. Por exemplo, a temperatura precisa estar entre −30 e 50 °C e a pressão entre 870 e 1085 hPa.
- `escolherFonte(fontes, variavel, lat, lon, agoraMs, idadeMaxMin)`:
  1. Para cada estação, calcula a distância no aparelho, a idade da leitura e se ela é válida. Uma leitura com mais de 15 min "no futuro" é recusada.
  2. Ordena as estações por distância.
  3. Devolve `{ escolhida, outras }`, com o motivo de descarte de cada outra estação ("leitura inválida" ou "leitura antiga").

### 3.5 Recortes por dia

- `indicesDoDia(horas, data, offsetSeg, aPartirMs)`: índices horários de uma data local. Com `aPartirMs`, descarta as horas já terminadas. Hoje usa só as horas restantes.
- `soma(serie, idx)` (interna): soma com regra de completude. Se faltar mais de 25% das horas, devolve `null`, para não subestimar o total.
- `resumoModeloDia(prev, modelo, idx)`: por modelo, calcula o total de chuva, a probabilidade máxima, a rajada máxima com hora e direção, o vento máximo, a mínima e a máxima.
- `membrosDia(ens, data, offsetSeg, aPartirMs)`: total diário de chuva e rajada máxima de **cada membro** de cada sistema de cenários. Os totais ficam também agrupados por sistema em `porModelo`, usado para comparar sistemas.

### 3.6 Avaliação do dia e confiança (`avaliarDia`)

Entradas: os resumos por modelo, os membros dos cenários e `ctx = { diaIndice, acerto, pesos, medicaoAgora, calibracao }`.

**1. Probabilidade de chuva (≥ 1 mm no dia)**, em ordem de preferência:

1. Com dois ou mais sistemas de cenários, cada um com 10 ou mais membros: a média das frações de membros com chuva **por sistema**. O UKMO (18 membros) pesa igual ao ECMWF (51), para nenhum sistema dominar só pelo número de membros.
2. Com um sistema só: a fração de membros com chuva.
3. Sem cenários: a fração de modelos determinísticos com chuva.

Em seguida, aplica `calibrarProb` se houver calibração local (seção 3.7). `probBruta` guarda o valor antes da calibração.

**2. Volume se chover.** Com cenários: quantis 10%, 50% e 90% dos membros molhados. Sem cenários: mediana ponderada, mínimo e máximo dos modelos.

**3. Confiança da chuva.** Começa com 3 pontos (alta) e perde pontos por motivos objetivos. Cada motivo vai para `motivos`, que é exibido ao usuário.

- Os sistemas de cenários diferem mais que 0,3 (−1) ou mais que 0,5 (−2).
- Com um sistema só: os modelos determinísticos contradizem os cenários (diferença de fração > 0,5): −1.
- Sem cenários: discordância entre os modelos (−1, ou −2 se a concordância for ≤ 60%).
- Horizonte: −1 a partir do 5º dia, −2 a partir do 8º.
- Acerto local de chuva abaixo de 60%, com 30 ou mais dias e estação a até 50 km: −1.
- Hoje, uma estação ou o radar medem chuva enquanto a previsão dava menos de 20%: −1.

**4. Confiança da rajada.** Dispersão entre os quantis 10% e 90% dos cenários, ou entre os modelos. Só rebaixa quando a rajada é relevante (classe moderada ou mais forte).

Pontos → nível: 0 ou 1 = baixa, 2 = média, 3 = alta. A confiança **geral** é a da chuva, salvo quando a rajada é relevante e tem confiança menor.

A confiança mede o quanto sistemas independentes concordam sobre a estimativa. Ela não mede se a chuva é certa: "30% com confiança alta" significa que todos os sistemas dizem cerca de 30%.

### 3.7 Aprendizado local e calibração com histórico

O painel aprende em duas camadas, que se somam (método completo e números em [CALIBRACAO.md](CALIBRACAO.md)):

1. **Histórico (ponto de partida).** `dados/calibracao.json`, gerado todo mês pelo GitHub Actions (`scripts/historico.mjs` + `scripts/calibrar.mjs`), compara anos de previsões passadas de cada modelo (Open-Meteo Previous Runs) com as medições da estação do INMET A884 Campo Bom. Traz o viés de máxima e mínima e o fator de rajada e vento por modelo, antecedência (1 a 5 dias) e estação do ano, mais os pesos relativos dos modelos. Cada correção só é marcada para uso (`usar: true`) se reduziu o erro fora da amostra.
2. **Aprendizado recente (refino).** O Worker guarda, todo dia, a previsão de cada modelo (de 1 a 5 dias antes) e a medição das estações.

A confiança de cada estimativa cresce com o número de dias:

```
c = n / (n + meia)        n = dias (ou casos) verificados; c = 0,5 quando n = meia
```

1. **Pesos dos modelos (`pesosModelos`).** Ponto de partida: `pesoInicial × (1 + c_h·(r_h − 1))`, em que `r_h` é o peso relativo do histórico (`pesosHistoricos`, erro de chuva, máxima e rajada) e `c_h = diasComuns / (diasComuns + 30)`. Depois, para cada modelo com 7 ou mais dias recentes, o erro relativo recente `r = média dos erros / erro do modelo` na chuva (piso de 0,5 mm) e na máxima (piso de 0,3 °C) ajusta esse ponto de partida: `base × (1 + c·(r − 1))`, com `meiaPesos = 30`. Tudo limitado entre 0,7 e 1,3.
2. **Viés de temperatura (`correcaoTemperatura`).** Média ponderada entre o viés recente (n dias) e o histórico (`viesHistorico`, peso `REGRAS.calibracao.forcaHistorico = 20`): `(n·recente + 20·histórico) / (n + 20)`. Sem histórico, o histórico vale 0 com peso `meiaVies = 10` (comportamento original). Antes de 7 dias recentes, vale só o histórico. Limitado a ±3 °C e **subtraído** da previsão.
   - Exemplo: histórico −1,5 °C (o modelo esfria demais) e 20 dias recentes com +0,5 °C: (20·0,5 + 20·(−1,5)) / 40 = −0,5 °C, ou seja, a previsão sobe 0,5 °C.
3. **Calibração da chance (`calibrarProb`).** Para cada faixa de 10% de chance prevista, o Worker calcula com que frequência choveu de fato. A chance é deslocada em direção a essa frequência, `p + c·(freq − p)`, com `c` por faixa (`meiaCalib = 10` casos). Só vale com 30 ou mais pares no total. (A Previous Runs não guarda cenários, então essa parte só existe no aprendizado recente.)

**Onde é aplicado: uma fonte única.** `recalibrar()` (app.js) recalcula `estado.prev` e `estado.ens` a partir das séries brutas (`estado.prevBruta`, `estado.ensBruto`) sempre que chega previsão, cenários, calibração ou aprendizado. Ela chama:

- `calibrarPrevisao(prev, { calib, aprendizado, refMs })`: por dia local de cada modelo, `correcaoTemperaturaDia` escolhe a correção de temperatura (hora a hora quando `calib.temperaturaHoraria` aprovou o modelo e a antecedência: viés de cada hora do dia + ajuste de máxima e mínima; senão, só máxima e mínima) e `prepararCorrecaoDia` a aplica a `temperature_2m` e à temperatura `current`; a máxima do gráfico é exatamente a máxima corrigida do dia. Multiplica `wind_gusts_10m` e `wind_speed_10m` pelo fator histórico. Passa o total de chuva de cada dia por `mapearChuva` (tabela de quantis `calib.modelos[m].chuvaQuantis`) e escala as horas na mesma proporção (`calibrarChuvaSerie`). A antecedência de cada dia é a distância até o dia da busca, mínimo 1, máximo 5.
- Ainda em `calibrarPrevisao`, `umidadeESensacao` corrige `dew_point_2m` (viés horário `calib.orvalhoHorario`, quando aprovado) e refaz `relative_humidity_2m` e `apparent_temperature` com temperatura, orvalho e vento corrigidos, pela fórmula `sensacaoTermica` (Steadman/BoM, à sombra), a mesma da sensação medida. Vale também sem calibração (fora dos 50 km), para a sensação ter sempre a mesma fórmula.
- `calibrarEnsemble(ens, calib, refMs, offset)`: aplica a tabela de chuva e o fator de rajada aos membros dos cenários, usando o modelo determinístico de mesma origem (`CALIBRACAO_ENSEMBLE`). A chance de chuva dos cenários já sai da série corrigida.
- Depois, `ancorarTemperatura` ajusta as próximas horas pela medição de agora (seção sobre ancoragem).

Todas as telas (primeira tela, gráficos, Semana, comparação, pressão) leem `estado.prev` e `estado.ens`, então herdam a mesma correção e nunca se contradizem. `analisarDia` não aplica nenhuma correção própria.

As duas camadas só valem a até 50 km da estação onde foram medidas (`calibracaoAplicavel` e `aprendizadoLocal`).

### 3.8 Temperatura no padrão europeu (ECMWF)

Implementado em `app.js` (`MODELO_TEMP = 'ecmwf_ifs'`):

- **Mínima e máxima do dia** (`analisarDia`): a do ECMWF IFS, lida da série já corrigida (3.7). Se o IFS não tiver dado, entra a mediana ponderada dos demais modelos. `tminFaixa` e `tmaxFaixa` guardam o intervalo entre os modelos, como informação de dispersão.
- **Temperatura por hora** (`tempHora` e `serieTemp`): o valor horário do IFS, já corrigido. Se faltar, a mediana ponderada dos modelos.
- **Temperatura "agora"** (`renderAgora`), em ordem de preferência:
  1. A medição da estação mais próxima, a até 25 km e com até 2 h, levada até o minuto atual (`temperaturaAgora`, desde a 1.5.1). O INMET publica com 40 a 70 min de atraso; o valor é a previsão sem ancoragem (`estado.prevSemAncora`) interpolada entre as horas para este minuto, mais a diferença entre medição e previsão no horário da leitura, que cai linearmente a zero em `REGRAS.ancoragem.horas` (a mesma regra de `ancorarTemperatura`). No instante da leitura o valor é a própria medição. Atualizado a cada minuto pelo relógio de `agendar`. A sensação de agora usa essa temperatura com o vapor e o vento da leitura. No bloco "Medições agora", temperatura e sensação continuam sendo as da leitura, com a nota "agora cerca de X°" quando a diferença passa de 0,5 °C. Sem ancoragem válida, fica a leitura pura.
  2. O campo `current` do IFS, em resolução de 15 min, corrigido.
  3. A mediana ponderada dos `current` dos modelos.
  4. A hora cheia mais recente.

Chuva continua usando a combinação ponderada dos três modelos, sem correção de volume (motivo em CALIBRACAO.md). Rajada e vento usam a mesma combinação, sobre as séries já corrigidas.

### 3.9 Demais funções

- `palavraOcorrencia(p)` e `respostaChuva(p)`: convertem a probabilidade em texto ("provável" → "Vai chover", e assim por diante).
- `classeRajada(kmh)`: aplica as classes de `rajadaClasses`.
- `probLimites(resumos, membros)`: fração de membros (ou de modelos) acima de cada limite de `limitesSemana`.
- `horasProvaveisDeChuva(prev, idx, modelos)`:
  1. Calcula a probabilidade por hora (mediana de `precipitation_probability`, ou a fração de modelos com 0,2 mm ou mais).
  2. Com pico de 0,3 ou mais, procura o **maior bloco contínuo** acima de `max(0,4; 0,8 × pico)`, pela soma das probabilidades.
  3. Esse bloco é a janela "mais provável" mostrada ao usuário.
- `fraseDoDia(av, janela, offsetSeg)` e `periodosTexto`: montam a frase principal ("Chuva possível à tarde, com rajadas moderadas").
- `horizonteDivergencia(prev, modelos)`: o primeiro bloco futuro de 6 h em que os modelos divergem na chuva (> max(5 mm; 0,6 × mediana)) ou na rajada (> 25 km/h).
- `consensoHorario(prev, variavel, modelos)`: séries de mediana, mínimo e máximo por hora entre os modelos.
- `condicaoCeu(cobertura, dia, probChuva)`:
  1. Calcula a cobertura média das horas de dia (ou de todas as horas, se não houver horas de dia).
  2. Classifica pelos limites de `REGRAS.ceu`.
  3. Combina com a probabilidade de chuva ("Nublado com chuva", "pode chover") e ajusta o texto para a noite.

### 3.10 Pressão atmosférica

Funções puras em `analise.js`, com limites em `REGRAS.pressao`:

- `variacaoSerie(serie, horas, toleranciaMin)`: diferença entre a leitura mais recente e a leitura mais próxima de `horas` antes dela. Se nenhuma leitura estiver a até `toleranciaMin` do instante alvo (40 min para 3 h e 90 min para 24 h), devolve `null` e nada é estimado.
- `classeTendenciaPressao(delta3h)`: termos de tendência de 3 h do Met Office e da OMM. Estável abaixo de 0,1 hPa; devagar de 0,1 a 1,5; sem adjetivo de 1,6 a 3,5; rápido de 3,6 a 6,0; muito rápido acima de 6,0.
- `avaliarPressao({ atual, d3, d24, prev })`: soma pontos de sinal de chuva.

  | Critério | Pontos |
  |---|---|
  | Queda acima de 3,5 hPa em 3 h | +2 |
  | Queda de 1,6 a 3,5 hPa em 3 h | +1 |
  | Subida de 1,6 hPa ou mais em 3 h | −1 |
  | Queda de 6 hPa ou mais em 24 h | +1 |
  | Variação prevista em 12 h ≤ −4 hPa / ≥ +4 hPa | +1 / −1 |
  | Pressão abaixo de 1008 hPa / acima de 1020 hPa | +1 / −1 |

  Os pontos viram o sinal: 3 ou mais = forte; 2 = moderado; 1 = fraco; 0 = nenhum; negativo = firme.
- `leituraPressao(avPressao, prob)`: o texto final. **Regra de não conflito:** a referência é sempre a chance de chuva principal do dia (`analisarDia(...).av.prob`, a mesma da primeira tela, já calibrada). A pressão só confirma ou explica essa previsão.

  | Pressão | Previsão principal | Leitura mostrada |
  |---|---|---|
  | Indica piora | Chuva possível ou provável (≥ 40%) | "Confirma a chuva prevista" |
  | Indica piora | Sem chuva (< 40%) | "Mudança no tempo, sem chuva prevista" (mais nuvens ou vento) |
  | Estável ou subindo | Chuva possível ou provável | "Pressão sem sinal de mudança": a chuva prevista não depende de queda de pressão (por exemplo, pancadas de calor) |
  | Subindo ou alta | Sem chuva | "Tempo firme" |

  O teste `pressão nunca contradiz a chance de chuva principal` percorre combinações de pressão e de chance e garante que a pressão nunca anuncia chuva quando a previsão não tem chuva, nem tempo firme quando a previsão tem chuva.

Em `app.js`, `painelPressao(pr)` monta o destaque no topo do bloco "Medições agora":

1. **Medição.** Usa a série da estação escolhida por `escolherFonte` para `pressao`. O INMET reduz a pressão da estação ao nível do mar pela fórmula barométrica (seção 9.2); o METAR informa a pressão ao nível do mar.
2. **Previsão.** Usa `pressure_msl` do ECMWF IFS, ou a mediana dos modelos quando ele falta. A variável é a pressão reduzida ao nível do mar, em hPa, conforme a documentação da Open-Meteo. Se a leitura medida tiver até 2 h, a série prevista é **ancorada**: deslocada pela diferença entre a medição e o valor previsto para agora. Assim, a menor pressão prevista e o gráfico ficam na mesma referência da estação. As variações não mudam com isso.
3. **Tendências.** As de 3 h e 24 h vêm da série medida. Sem série medida, vêm da previsão, e a tela avisa.
4. **Exibição.** Mostra o valor e a tendência, a variação nas últimas 3 h e 24 h, a variação prevista nas próximas 12 h e a menor pressão nas próximas 24 h, com horário. Depois vem a leitura coerente com a previsão e os motivos. Por fim, um gráfico com as últimas 24 h medidas (linha cheia com pontos) e as próximas 24 h previstas (tracejada), e a explicação em "Como é calculado".

---

## 4. `js/dados.js`: rede e normalização

### 4.1 Camada de rede

- `buscarJson(fonte, url, opcoes)` faz uma nova tentativa após 1,5 s, só em falha de rede ou tempo esgotado.
- `buscarJsonUmaVez(...)`:
  - Verifica a espera por fonte (`emEspera`) e se o aparelho está online.
  - Faz `fetch` com `AbortController` (timeout padrão de 15 s), `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` e `cache: 'no-store'`.
  - Em resposta 429 ou 5xx, aplica **backoff exponencial por fonte** (`aplicarEspera`): 2, 4, 8… até 60 min, persistido em `localStorage` (`espera:<fonte>`).
  - Limita o tamanho da resposta (`maxBytes`), valida o JSON e trata `{ error: true }` da Open-Meteo.
- `ErroFonte(fonte, tipo, detalhe)` é o erro tipado. Os tipos são `rede`, `tempo`, `limite`, `servidor`, `http`, `tamanho`, `formato`, `api` e `offline`.
- `salvarCache` e `lerCache` gravam `{ salvoEm, dados }` no Cache Storage `painel-dados-v1`, na chave sintética `/__dados/<chave>`. A gravação não acontece depois de "Apagar dados".

### 4.2 Previsão determinística

- `urlPrevisao(lat, lon)`: uma única chamada com os três modelos mais o GFS (só para o índice UV diário). Pede as variáveis horárias de `VARS_HORA`, as diárias de `VARS_DIA`, `current=temperature_2m`, `past_days=1` e `forecast_days=16`.
- `normalizarPrevisao(j)` devolve:
  ```
  { lat, lon, elevacao, fuso, offset, horas: [ms],
    modelos: { [m]: { vars: { [variavel]: [valor|null] }, ausentes: [], ate: ms } },
    diario: { datas, nascer, por, uvMax },
    atual: { ms, temp: { [m]: valor }, geral } }
  ```
  Com vários modelos, a Open-Meteo devolve as chaves com sufixo (`temperature_2m_ecmwf_ifs`). Uma série totalmente nula conta como variável ausente.

### 4.3 Cenários (ensemble)

- `MODELOS_ENSEMBLE`: ECMWF ENS (51 membros), ECMWF AIFS ENS (51) e UKMO MOGREPS-G (18).
- `urlEnsemble` faz uma chamada por sistema, para as chaves virem sem sufixo de modelo. `normalizarEnsemble` reconhece `precipitation_memberNN` e `wind_gusts_10m_memberNN` por expressão regular.
- `buscarEnsemble` roda os três em paralelo e devolve `{ ens, erros }`. A falha de um sistema não derruba os outros.

### 4.4 Outras fontes

- `buscarCidades(nome)`: geocodificação da Open-Meteo, com a consulta limitada a 60 caracteres.
- `worker(rota, params)`: chamada às rotas fixas do Worker. `workerConfigurado()` valida a URL do Worker em `config.js`.
- `buscarAlertasDireto` e `buscarObservacoesDireto`: alternativas sem Worker (INMET direto, quando o CORS permite).
- `buscarEnso`: tenta o Worker. Se falhar, lê `dados/enso.json`, publicado no próprio Pages.
- `buscarCalibracao`: lê `dados/calibracao.json` do próprio Pages (sem Worker) e confere `versao` e os campos básicos. É buscada com o mesmo intervalo do acerto (1 vez por dia) e guardada no cache local.
- `buscarRadar`: lê `weather-maps.json` da RainViewer. Valida o host (`*.rainviewer.com`) e o formato dos caminhos dos quadros antes de usá-los.
- `pixelDoPonto(lat, lon, z)`: projeção Web Mercator → tile (x, y) e pixel dentro do tile de 256 px.
- `buscarChuvaRadar(lat, lon)`:
  1. Baixa o tile do quadro mais recente no zoom 7 (cerca de 1,2 km/pixel) e o desenha em `OffscreenCanvas`.
  2. Conta os pixels com alfa > 40 num quadrado de 5 × 5 em volta do ponto.
  3. Com 3 ou mais pixels com eco, conclui que está chovendo.

### 4.5 Grade do mapa

- `GRADE = { n: 11, passo: 0.4 }`: 121 pontos espaçados de 0,4° (cerca de 40 km), centrados na coordenada arredondada. `pontosGrade` devolve os pontos com a linha 0 ao norte e a coluna 0 a oeste.
- `buscarGradeMapa` faz **uma** chamada multiponto à Open-Meteo e devolve campos alinhados com os pontos:
  - `temp`, `nuvens`, `vento`, `rajada` e `direcao`: valores atuais.
  - `chuva24`: soma das próximas 24 h, exigindo pelo menos 20 horas válidas.
  - `tmax5` e `tmin5`: extremos dos próximos 5 dias.

  Cada valor passa por um filtro de faixa (`num`).

---

## 5. `js/app.js`: orquestração e telas

### 5.1 Localização

- `localizarGps(silencioso, recente)`:
  - Chama `getCurrentPosition` com `timeout` de 9 s.
  - Uma **trava de 12 s** encerra a espera mesmo se o navegador não chamar nenhum retorno (caso observado no iOS com o app na tela inicial). A flag `feito` garante uma única resolução.
  - Sem GPS, usa o último local salvo. Se não houver nenhum, usa o centro de Campo Bom.
- `definirLocal(l)` grava em `localStorage` só a coordenada arredondada e devolve se o local mudou.
- `configurarLocal()` cuida do diálogo de busca de cidades, com debounce de 450 ms (uma chamada por busca, não por tecla).

### 5.2 Análise por dia

- `pesosAtuais()` monta, a partir de `aprendizadoLocal()`, o mapa `{ dias, maeChuva, maeTmax }` com antecedência de 1 dia e chama `pesosModelos`.
- `acertoCtx(diaIndice)` calcula a taxa de acerto de chuva (mediana entre os modelos) na antecedência correspondente, o número de amostras e a distância até a estação.
- `analisarDia(data, diaIndice, desdeAgora)` junta tudo:
  - os resumos, os membros e `avaliarDia`;
  - a janela provável de chuva;
  - o pico da rajada (mediana horária, com direção pela **média vetorial**, `direcaoMedia`);
  - a mínima e a máxima no padrão ECMWF (3.8);
  - os limites da Semana.

  O resultado é memorizado em `cacheDias`, com chave pela data e pelos instantes de cada fonte, até 60 entradas.
- `medicaoChuvaAgora()`: há chuva agora se uma estação a até 25 km mediu 0,2 mm ou mais (leitura de até 90 min) **ou** se o radar tem eco num quadro de até 20 min.

### 5.3 Primeira tela (`renderPrimeira`)

Mostra a data, a temperatura agora, o ícone do céu (`iconeCeu`, em SVG), a mínima, a máxima e a chance, a resposta "Vai chover", o volume e a janela, o cartão de risco de temporal (`cartaoTemporal`, só com risco moderado ou alto), a rajada e o gráfico horário com três modos:

- **Chuva** (`graficoChance`):
  - A chance por hora vem de `chanceHoraria(ms)`: a fração de **todos** os membros de cenários com 0,2 mm ou mais na hora, se houver 10 ou mais. Sem isso, a mediana de `precipitation_probability` dos modelos.
  - `tetoDoDia`: a chance de uma hora nunca passa a chance principal do dia (calibrada, 1 mm ou mais no total). Vale para o gráfico, a tabela de horas e os períodos de amanhã, que assim nunca mostram mais chance do que o cartão do dia. Chuva medida ou vista no radar entra depois do teto (e o dia já sobe junto nesses casos).
  - Se está chovendo agora (medido), a barra da hora atual vira 100%, em cor de medição.
  - O eixo vertical vai de 0 a `TETO_CHANCE` = 115%, com marcas a cada 20%. A folga evita que as barras cheias encostem no topo.
- **Temperatura** (`graficoTemperatura`): a série do ECMWF. O eixo vai de pouco abaixo da mínima a pouco acima da máxima, em passos de 2, 3 ou 5 °C conforme a amplitude, com pelo menos dois passos.
- **Céu**: a Faixa do Céu (`faixa.js`).

`barrasComEixo({...})` é o componente genérico de barras:

- Cada hora é um `<button>` com `aria-label` descritivo.
- Linhas-guia nas marcas do eixo e uma linha tracejada (`.gb-agora`) na altura do valor da hora atual.
- O valor exato só aparece na linha `.chance-info` (com `aria-live`) ao tocar num horário.
- A barra da hora atual recebe `gb-atual` (um ponto embaixo).

`chuvaRestante()` calcula quanto ainda deve chover no episódio atual:

1. Soma a mediana ponderada horária desde agora, contando só a fração restante da hora atual.
2. Para na primeira hora com menos de 0,1 mm, com janela máxima de 12 h.
3. Abaixo de 0,2 mm no total, devolve `{ fraca: true }`.

### 5.4 Hoje: detalhes (`renderHojeDetalhes`)

A ordem é:

1. Próximas horas.
2. Medições agora (`instrumentos`), com a pressão atmosférica em destaque no topo (`painelPressao`, seção 3.10).
3. **Previsto x medido.**
4. Mapa.
5. Hora a hora (meteograma, um gráfico por vez).
6. Fontes de dados.

- `previstoMedido(s)` mostra três gráficos sincronizados: temperatura (prevista pelo ECMWF), chuva acumulada e rajadas. A linha tracejada é a previsão e a linha cheia com pontos é a medição. A medição de cada hora é a leitura a até ±30 min. Na chuva acumulada, uma hora sem leitura interrompe a linha medida, para não somar lacunas como zero. Sem histórico de medições, a seção não aparece.
- `meteograma(...)`: gráficos de várias variáveis com zoom por pinça, usando `PAINEIS`.
- `estadoFontes()`: lista curta de onde vem cada dado e como é calculado, mais uma linha de situação ("Sem resposta agora: …" ou "Todas as fontes responderam").

### 5.5 Outras abas

- **Amanhã** (`renderAmanhaDetalhes`): a mesma primeira tela, com `desdeAgora = false`, mais a tabela por modelo (`tabelaModelosDia`) e o índice UV (`textoUv`).
- **Semana** (`renderSemana`, `tabelaLimites`, `tabelaFaixas`): um dia por linha com resumo, números e confiança, sem fontes nem tabela de modelos (o detalhe por modelo fica na aba Modelos). Gráficos e tabelas sem subdescrição.
- **Dia** (aba `dia`, fora da barra; desde a 1.8.3). Tocar num dia da Semana chama `abrirDia(data)`: o dia de hoje vai para a aba Hoje e o de amanhã para a aba Amanhã. Os outros abrem o mesmo painel da Amanhã para aquele dia: `renderPrimeira` com `diaIndice` e `renderDiaDetalhes(alvo, data, diaIndice, id)`, a mesma função que a Amanhã usa.
  - A tela abre mesmo nos dias distantes; a imprecisão aparece na confiança, calculada com o `diaIndice` real.
  - O botão "Semana" (`[data-voltar-semana]`) volta, e a barra mantém Semana marcada.
  - Deslizar passa para o dia seguinte ou anterior (do 3º dia anterior volta para Amanhã).
  - O dia aberto fica em `estado.diaAberto` e é redesenhado na fila de `renderTudo`. Se a data sair da previsão, a tela volta para a Semana.
- **Subdescrições**: um bloco autoexplicativo não leva texto abaixo do título. Ficam só a nota de fonte ("Fonte · Horário") onde ela existe e avisos que mudam a leitura do dado, como `notaConcordancia` (sem ensemble, a fração de modelos é concordância, não probabilidade).
- **Modelos** (`renderModelos`, `resumoAprendizado`, `tabelaAcerto`): os pesos atuais, o que já foi aprendido e o acerto por modelo e antecedência.
- **El Niño** (`renderElNino`, `painelEnso`, `intensidade`, `barrasProb`, `comparacaoHistorica`): os índices ONI e RONI, a discussão do CPC, as probabilidades do CPC e do IRI, e a estimativa diária do Niño 3.4.
  - Desde a 1.8.5, a aba mostra também o que o El Niño faz no RS.
  - **O que o El Niño costuma causar no RS** (`efeitosNoRs`): o padrão de chuva no estado (`ENSO_RS_EFEITOS`, de Fontana e Berlato 1997 e do resumo do CPTEC/INPE). Com episódio em curso, inclui a tendência para a primavera do ano de início e para abril a junho do ano seguinte. As fontes ficam em "De onde vem isso".
  - **Nas notícias do RS** (`noticiasRs`): até 5 notícias dos últimos 45 dias, com título, veículo, data e link, marcadas como conteúdo de terceiros. Vêm da parte `noticias` de `atualizarEnso` (Worker 1.2.0 e GitHub Actions). A busca RSS do Google Notícias (`URL_NOTICIAS_ENSO`) exige "El Niño", o RS e um termo de tempo severo, nos últimos 30 dias. `parseNoticias` tira o veículo do título, aceita só links `https://news.google.com/`, descarta repetidas e devolve as 8 mais recentes.
  - **El Niños marcantes e o que houve no RS** (`comparacaoHistorica` com `eventosEnso`): os episódios fortes pelo pico do índice, mais os de `ENSO_RS_EPISODIOS` (1982, 1997, 2015 e 2023), com o que foi registrado no RS. Um ano pertence ao episódio mais forte que passa por ele. Esses textos são fixos e verificados; revisá-los a cada novo episódio forte.

### 5.6 Alertas

- `alertasDoLocal()`:
  - Para Campo Bom, usa a lista oficial de municípios por código IBGE (`municipioPadrao`).
  - Para outros locais, testa se o ponto está dentro do polígono do aviso. `dentroPoligono` usa *ray casting* e roda no aparelho, sem enviar a posição.
  - Sem área (RSS), aceita avisos que citam o RS e os marca como `incerto`.
- `avisosOrdenados()`: do mais grave ao menos grave; na mesma gravidade, o que começa antes.
- Aba **Avisos** (`renderAvisos`, chamada no início de `renderTudo`, sem depender da previsão): um cartão por aviso do local (`cartaoAviso`: título, gravidade e período visíveis; riscos e orientações em `details`), a nota "INMET · HH:MM" da consulta, os outros avisos do RS recolhidos e os links oficiais. Desde a 1.5.0 os avisos não aparecem mais na primeira tela de Hoje e Amanhã; ficam só o cartão de risco de temporal e o ponto vermelho no botão "Ver mais" (`data-avisos`), só para aviso do local ainda não visto: ao abrir a aba Avisos, os identificadores dos avisos ativos vão para `prefs 'avisosVistos'` (`marcarAvisosVistos`) e o ponto some até chegar um aviso novo (`marcarBotaoAvisos`).
- As listas `riscos` e `instrucoes` chegam do INMET como array JSON; `listaPython` (app e Worker) aceita também o formato antigo em texto `"['a', 'b']"`.

### 5.7 Navegação e gestos

- Barra com Hoje, Amanhã, Semana e **Ver mais** (`#btn-mais`), que abre o diálogo `#dlg-mais` com Avisos, Globo, El Niño e Modelos (`ABAS_MAIS`). Nessas abas o botão Ver mais fica marcado.
- Avisos, El Niño e Modelos têm o botão "Ver mais" (`[data-voltar-mais]`) acima do título, que reabre o menu: é o caminho de volta das telas do menu.
- **Barra de cima recolhível** (`configurarCabecalho`, desde a 1.8.2). A `.cabeca` é `position: fixed`, e o `body` reserva a altura dela em `--alt-cab`, medida por `ResizeObserver`; por isso recolher não move o conteúdo.
  - Recolhe quando a página rola mais de 6 px para baixo depois da altura da barra. No Globo, recolhe também depois de 4 s sem toque na barra (`OCIOSO_GLOBO_MS`).
  - Volta ao rolar para cima, ao chegar ao topo ou ao trocar de aba (`cabecalho.aoMudarAba`).
  - A alça `#alca-cabeca`, centrada na borda de baixo da barra, mostra e oculta a qualquer momento. Mostrada pela alça, a barra não se recolhe sozinha no Globo até a próxima troca de aba.
  - No Globo (desde a 1.8.6), a página não rola: `body[data-aba=globo]` fica fixo do tamanho da janela, sem rodapé nem faixa de estado. Lá a barra só muda pela alça ou pelo tempo sem uso; o ouvinte de rolagem ignora essa aba.
  - Fora da tela, a barra perde a altura (`data-recolhida`). No Globo, o `body` deixa de reservar o espaço (`body[data-aba=globo][data-cab=oculta]`) e um evento `resize` avisa o globo para ocupar a tela.
- Filtros com muitas opções usam `seletor()` (`js/ui.js`): um único botão com a opção atual, que abre a lista nativa do sistema. Hoje isso vale para a camada do mapa e para o gráfico "Hora a hora", que mostra um gráfico por vez (`prefs 'paineis-v2'` guarda o escolhido).
- Ordem de Hoje: Próximas horas (com legenda chance, chuva, vento e rajada), Mapa, Medições agora, Previsto x medido, Hora a hora e Fontes de dados. Os títulos das telas são os mesmos das abas (Semana, não "Próximos 7 dias"). Na Amanhã, o bloco "Confiança" não tem mais a tabela de modelos, que fica na aba Modelos.
- `irPara(aba, rolarTopo, direcao)`: troca a aba visível, atualiza `aria-current` (barra e itens do menu) e aplica a animação de entrada (`entra`, `entra-dir`, `entra-esq`). A animação usa só `transform` e `opacity`, que são compostas na GPU.
- `configurarNavegacao()`: deslizar entre Hoje, Amanhã e Semana. O gesto só vale com:
  - um dedo;
  - duração de até 450 ms;
  - deslocamento horizontal de 80 px ou mais, e 3 vezes maior que o vertical;
  - página que não rolou durante o gesto;
  - início fora das bordas de 24 px (o gesto "voltar" do sistema);
  - início fora de elementos com rolagem horizontal (`rolaHorizontal`).

  Isso elimina trocas de aba acidentais.
- `configurarPuxar()`: puxar para atualizar. O indicador flutua (`transform`) sem empurrar o conteúdo. Dispara com mais de 110 px a partir do topo e é cancelado com movimento lateral acima de 40 px.
- `html { overscroll-behavior-y: none }` desliga o "puxar" nativo do navegador. Os botões usam `touch-action: manipulation`, sem atraso de duplo toque.

### 5.8 Tema e dados locais

- `aplicarTema()` alterna entre automático, claro e escuro (`data-tema` em `<html>`) e atualiza `theme-color`.
- `configurarRodape()`: o botão "Apagar dados" remove os service workers, o Cache Storage, o `localStorage` e o `sessionStorage`.

---

## 6. `js/mapa.js`

- **Carregamento sob demanda.** Um `IntersectionObserver` com margem de 200 px injeta o Leaflet (`carregarLeaflet`) só quando a seção se aproxima da tela.
- **Camadas** (`CAMADAS`), uma de cada vez:
  - Chuva agora: radar RainViewer.
  - Grade Open-Meteo: chuva em 24 h, nuvens, temperatura, calor (`tmax5`), frio (`tmin5`) e vento (rajada).
  - Avisos do INMET: todos, ou só os de calor (`EH_CALOR`) ou de frio (`EH_FRIO`) nas camadas correspondentes.

  A escolha fica gravada em `prefs` (`mapaCamada`).
- **Escalas de cor**: listas de paradas `[valor, r, g, b, alfa]`. `corNa(escala, v)` faz a interpolação linear entre as paradas.
- **`imagemGrade(g, valores, escala)`**: converte a grade 11 × 11 numa imagem de 192 × 192 px por **interpolação bilinear**.
  - Cada pixel combina os 4 pontos vizinhos com pesos `(1−ti)(1−tj)`, `(1−ti)tj`, `ti(1−tj)` e `ti·tj`.
  - Os pontos sem dado saem da conta e os pesos restantes são renormalizados. Abaixo de 0,05 de peso, o pixel fica transparente.

  A imagem vira um `L.imageOverlay` sobre a área da grade.
- `grade(lat, lon)`: cache da grade por 10 min, por ponto. Uma falha limpa o cache.
- **Toque na grade**: mostra o valor do ponto mais próximo, se ele estiver a menos de 0,75 passo.
- **Radar**:
  - O quadro mais recente aparece primeiro. Os anteriores são carregados um a cada 2 s, para respeitar o limite da RainViewer de 100 requisições por minuto.
  - A animação de 700 ms por quadro só começa com todos os quadros carregados.
  - O radar pausa com `prefers-reduced-motion` e quando a página fica oculta.
- **Avisos**: polígonos coloridos pela severidade. `perto()` filtra os avisos com algum vértice a até 4° do local. A camada Avisos ajusta o zoom para 6.
- **Gestos** (`gestosDoisDedos`), em telas de toque (`pointer: coarse`):
  - O Leaflet fica com `dragging` e `touchZoom` desligados. Um dedo rola a página (`touch-action: pan-y`) e mostra a dica "Use dois dedos".
  - Com dois dedos, o zoom é `zoomInicial + log2(distância / distânciaInicial)`. Depois, `panBy` mantém sob os dedos o mesmo ponto geográfico do início do gesto (âncora `ini.ll`).
  - Ao soltar, o zoom assenta no meio nível mais próximo, para os tiles ficarem nítidos.
  - No computador, valem o arraste e a roda do mouse do próprio Leaflet.
- **Mapa base**: OpenStreetMap com `referrerPolicy: 'origin'`, exigido pela política de uso dos tiles. No tema escuro, a classe `mapa-escuro` aplica um filtro CSS.

---

## 7. `js/graficos.js`, `js/faixa.js` e `js/ui.js`

- `criarGrafico(container, cfg)`: um gráfico uPlot com legenda viva, faixas de noite (`noitesDe`, a partir do pôr e do nascer do sol), linha de agora e cursor sincronizado (`bus.on('hora')`). O contêiner rola na horizontal e tem zoom por pinça (`horasVisiveis`, mínimo de 6 h). Um `ResizeObserver` ajusta a largura. O `destroy` também remove os ouvintes e o observador.
- `dataNoFuso(seg, fuso)`: memoriza `uPlot.tzDate` (que é lento, porque usa `toLocaleString`), com no máximo 5000 entradas.
- `limparGraficos(raiz?)`: destrói os gráficos registrados, todos ou só os de uma subárvore.
- `criarFaixa(...)` (Faixa do Céu): um canvas com nuvens altas, médias e baixas, chuva, pressão, vento e rajada por hora, todos pela mediana entre os modelos. A direção do vento é a média vetorial, a noite tem fundo escuro e as horas sem dado aparecem hachuradas. O toque mostra os valores e sincroniza os gráficos.
- `ui.js`:
  - `el()` e `svg()` criam o DOM. O texto entra por `textContent` ou por nós de texto, nunca por HTML. `on*` registra eventos com `addEventListener`, `style` usa `setProperty` e os demais atributos passam por `setAttribute`.
  - `linkExterno()` só aceita endereços `https` e sempre aplica `rel="noopener noreferrer"`.
  - `fmt` formata números, temperaturas, horas e idades no fuso do local.
  - `prefs` lê e grava o `localStorage` com `try/catch`.
  - `bus` é um barramento de eventos mínimo.
  - `secao` e `mostrarInfo` criam a seção padrão e o diálogo.

---

## 8. Service worker (`sw.js`)

- No `install`, guarda os arquivos do app em `painel-app-<versão>`. No `activate`, remove as versões antigas e assume as abas abertas (`clients.claim`).
- No `fetch`, atende só `GET` do mesmo domínio. As APIs externas não passam pelo service worker.
- A estratégia é **rede primeiro**, com `cache: 'no-cache'`, para ignorar os 10 min de cache HTTP do GitHub Pages. O cache local entra sem internet ou quando a rede demora mais de 4 s.
- Todos os caminhos são relativos à pasta do `sw.js`, então o mesmo código serve a subpasta do GitHub Pages (`/painel-meteo/`) e a raiz do domínio no Cloudflare Pages.
- O Cloudflare Pages redireciona `/index.html` para `/` e `/privacidade.html` para `/privacidade`. Uma resposta que passou por redirecionamento não pode ser entregue a uma navegação, então `semRedirecionamento` copia a resposta sem essa marca antes de guardá-la. A política de privacidade é reconhecida com e sem `.html`.
- **A cada release, `VERSAO` sobe em `sw.js` e em `js/app.js`.** Isso troca o cache e mostra a versão no rodapé.

---

## 9. Cloudflare Worker (`worker/src/index.js`)

### 9.1 Segurança

- **Rotas fixas** (`permitidos`), cada uma com uma lista fechada de parâmetros. A rota recusa parâmetros repetidos ou desconhecidos e query string com mais de 200 caracteres.
- **Sem SSRF.** `buscarExterno` só aceita `https:` para hosts de `DESTINOS` e recusa redirecionamentos (`redirect: 'manual'`). Tem timeout (`AbortSignal.timeout`) e limite de bytes por streaming (`lerLimitado`). Tenta decodificar em UTF-8 e cai para latin1 se houver caracteres inválidos.
- **Token do INMET.** Só aparece na URL de `dadosInmet`. A chave de cache usa a URL pública (`x-chave`). Os erros devolvem só "falha interna".
- **CORS** só para as origens de `ALLOWED_ORIGIN`. Os métodos aceitos são `GET` e `OPTIONS`.
- **Limite por cliente** (`limiteExcedido`, padrão de 30 por minuto). O identificador é o SHA-256 de `sal diário + IP`, truncado e guardado só em memória (`janelas`). O sal é aleatório, troca a cada dia e nunca é persistido.
- **XML** (`xmlSeguro`, `itensRss`): recusa DTD e ENTITY e extrai só os campos simples, com `textoPuro`.
- A observabilidade fica desligada no `wrangler.toml`, sem logs persistentes.

### 9.2 Rotas

| Rota | Parâmetros | Função |
|---|---|---|
| `/v1/observacoes` | `lat`, `lon` (validados por `lerCoord` e arredondados) | Estações METAR numa caixa de ±1,2° (`normalizarMetar`: nós → km/h, umidade pela fórmula de Magnus) e até 4 estações do INMET a até 120 km. Com token: série de 7 dias. Sem token: última leitura (`ultimaInmet`) somada à série horária gravada no KV. `acumulados` calcula a chuva em 1 h, 24 h, 72 h e 7 dias: `valor` só com 90% das horas; `soma` (total das horas que existem) sempre, usada pelo app como mínimo garantido ("≥ X mm") quando há pelo menos metade das horas. `normalizarInmet` converte m/s → km/h e a pressão da estação para o nível do mar (fórmula barométrica). |
| `/v1/alertas` | — | Avisos ativos do INMET (`normalizarAvisos`, `poligonosGeojson` simplificado para até 400 pontos por anel, `listaPython`). Se falhar, usa o RSS do INMET (sem área). Se o RSS também falhar, responde 502 `indisponivel`. |
| `/v1/enso` | — | Lê `enso:ultimo` do KV. Se tiver mais de 7 h, chama `atualizarEnso`. |
| `/v1/acerto` | `estacao` | O histórico `acerto:<id>` resumido por `resumirAcerto` (taxa de acerto de chuva, MAE e viés por modelo e antecedência de 1 a 5 dias), mais `calibracao` (pares, índice de Brier e 10 faixas). |
| `/v1/saude` | — | Versão, token configurado (sim ou não) e KV presente. |

### 9.3 Tarefas agendadas (cron)

| Cron | Tarefa |
|---|---|
| `5,25,45 * * * *` | `registrarSeries`: guarda a última leitura das estações INMET de verificação em `serie:<id>`, com janela de 8 dias. Três buscas por hora porque o INMET publica com 40 a 70 min de atraso e a API só dá a leitura mais recente; leitura repetida não é regravada. |
| `0 */6 * * *` | `atualizarEnso`: baixa os índices semanais e mensais, o ONI, o RONI, a discussão, as probabilidades e as intensidades do CPC e o IRI. Se uma parte falhar, mantém a versão anterior marcada como `desatualizado`. |
| `15 9 * * *` | `registrarAcerto`: para o dia anterior, junta as medições (`obsDoDia`, que exige 12 ou mais leituras de temperatura e 22 ou mais de chuva) e as previsões de 1 a 5 dias antes (Previous Runs API, `prevDoDia`) em `acerto:<id>`, com até 120 dias. `registrarPrevisaoPainel`: guarda a chance diária de 1 mm ou mais dos três sistemas de cenários (`probDiariaCenarios`) para os próximos 5 dias em `painel:<id>`, com até 600 registros. |

### 9.4 Esquema do KV

| Chave | Conteúdo |
|---|---|
| `serie:<id>` | `[{ ms, temperatura, umidade, orvalho, pressao, vento, rajada, direcao, chuva, sensacao }]` |
| `inmet:estacoes` | `{ em, lista }` com as estações operantes e o geocode IBGE, renovada a cada 7 dias. |
| `enso:ultimo` | `{ verificadoEm, partes: { [parte]: { ok, dados, em, desatualizado? } } }` |
| `acerto:<id>` | `[{ data, obs: { tmax, tmin, rajada, chuva }, prev: { [modelo]: { [lead]: { chuva, tmax, tmin, rajada } } } }]` |
| `painel:<id>` | `[{ emitido, data, lead, prob, sistemas }]` |

Nenhuma chave contém a localização ou o IP do usuário.

---

## 10. Automação, scripts e testes

- `.github/workflows/testes.yml`: roda `npm test`, `npm audit` e a busca por segredos em cada PR e em cada push na `main`.
- `.github/workflows/globo.yml`: a cada 3 h gera os dados da aba Globo (`scripts/globo/atualizar.py`) e publica no branch `globo-dados` (ver seção 12).
- `.github/workflows/worker.yml`: publica o Worker quando `worker/**` muda na `main`.
- `.github/workflows/enso.yml`: a cada 6 h, roda `scripts/atualizar-enso.mjs`.
  - O script reaproveita `atualizarEnso` do Worker com um "KV" de arquivo.
  - Também estima o Niño 3.4 diário: a média da temperatura do mar em 18 pontos entre 5°N e 5°S, 170°W e 120°W (Open-Meteo Marine), menos a climatologia mensal de 1991 a 2020 derivada do `sstoi.indices` do CPC e interpolada entre os meios dos meses.
  - O resultado é gravado em `dados/enso.json`.
- `.github/workflows/calibracao.yml`: todo dia às 07:40 de Brasília (e quando os scripts da calibração mudam), roda:
  - `scripts/historico.mjs`: baixa os ZIPs anuais do INMET (BDMEP), extrai a A884 (`scripts/lib/inmet.mjs`: leitor de ZIP próprio, CSV em Latin-1, controle de qualidade, dia local) e as previsões passadas da Previous Runs API (6 modelos, 1 a 5 dias antes, blocos de 60 dias). Grava `dados/historico/A884-diario.json` (uma linha por dia, incremental: por modelo, só os 10 dias mais recentes e os que faltam a partir do primeiro dia com dado; blocos que não têm dia faltando não são pedidos).
  - `scripts/calibrar.mjs`: calcula `dados/calibracao.json` e `docs/calibracao-resultado.md` (`scripts/lib/calibracao.mjs`). Detalhes em CALIBRACAO.md.
- `.github/workflows/pages.yml`: publica o site no Cloudflare Pages (Direct Upload, sem compilação) a cada push na `main`, depois da calibração e do workflow do Worker, e à mão. O `globo.yml` (a cada 3 h) e o `enso.yml` (quando o El Niño muda) publicam no próprio job, porque commits feitos com o `GITHUB_TOKEN` não disparam outros workflows. Passo a passo em CLOUDFLARE-PAGES.md.
  - `scripts/montar-site.sh`: copia só o que o navegador usa (`index.html`, `privacidade.html`, `manifest.json`, `sw.js`, `app.css`, `js/`, `vendor/`, `icones/`, `dados/*.json`, `cloudflare/_headers` e `cloudflare/404.html`) e os campos do Globo em `globo-dados/`. Confere que todo arquivo da lista do service worker existe. O `testes.yml` roda essa montagem em cada PR e push na `main`.
  - `scripts/publicar-pages.sh`: busca o branch `globo-dados` (se não vier pronto), monta o site, cria o projeto na primeira vez e publica com `wrangler pages deploy`.
  - No Cloudflare Pages, `CONFIG.globoDados` aponta para `globo-dados/` do próprio site, que continua funcionando com o repositório privado. No GitHub Pages e no computador local, aponta para `raw.githubusercontent.com`.
  - O `404.html` desliga o modo de aplicação de página única do Pages: um arquivo que falta responde 404, e não o `index.html` com status 200.
  - O Worker aceita como origem o que está em `ALLOWED_ORIGIN` no `wrangler.toml` mais `https://<PAGES_PROJETO>.pages.dev` e `https://<PAINEL_DOMINIO>`, variáveis do repositório lidas pelo `worker.yml` e passadas com `wrangler deploy --var`.
- `scripts/configurar.mjs`: grava a URL do Worker em `js/config.js`.
- `test/analise.test.mjs`: 21 testes das funções puras.
- `test/ceu.test.mjs`: cálculos do céu conferidos com fatos publicados (equinócio, solstício, Gemínidas, eclipses de 2026, estrelas circumpolares).
- `worker/test/worker.test.mjs`: 24 testes dos parsers e das regras do Worker, com fixtures reais.
- `test/calibracao.test.mjs`: leitor de ZIP e CSV do INMET, agregação diária, viés, fator, validação fora da amostra e aplicação no app (séries, cenários, pesos).
- O comando `npm test` roda os quatro.

---

## 11. Procedimento de alteração

1. Mudar o código. Toda regra numérica nova entra em `analise.js`, com limite em `REGRAS` e teste.
2. Subir `VERSAO` em `js/app.js` e em `sw.js`.
3. Rodar `npm test` e conferir no navegador, no celular (390 px) e no computador.
4. Atualizar este documento na seção afetada.
5. Abrir um PR para a `main`. O Pages publica em cerca de 1 min, e o Worker é publicado pelo workflow quando `worker/**` muda.

---

## 12. Aba Globo (`js/globo*.js` e `js/ceu.js`)

Módulos, todos ES modules carregados só quando a aba abre:

| Módulo | Papel |
|---|---|
| `globo.js` | cena Three.js, shaders da Terra (dia, noite com luzes das cidades, luar, nuvens, atmosfera), camadas, gestos, painel de toque, laço e qualidade adaptativa |
| `globo-dados.js` | leitura dos arquivos do branch `globo-dados` (manifest, campos GFS, satélite, elementos orbitais, sondas) com validação |
| `globo-regiao.js`, `globo-cidades.js` | mapa detalhado sob a câmera e rótulos de cidades |
| `ceu.js` | cálculo puro do céu (sem DOM, testado): Sol, Lua, planetas e estrelas pelo Astronomy Engine; satélites pelo SGP4; passagens visíveis, chuvas de meteoros (IMO, por longitude solar), eclipses, fases, estações, o resumo "Céu de hoje" e `ondeOlhar` (direção, altura em graus e em punhos, caminho no céu e a referência mais útil por perto: Lua, planeta brilhante ou uma das 24 estrelas e figuras de `REFERENCIAS`) |
| `globo-ceu.js` | textos: bloco "Céu de hoje" e cartões de Sol, Lua, planetas, estrelas, satélites e sondas |
| `globo-astro.js` | pontos subsolar e sublunar e posições para o sistema solar |
| `globo-estrelas.js` | céu: 802.474 estrelas (HYG v4.1: 8.920 até magnitude 6,5 e 110.705 mais fracas; Gaia DR3: 682.849 até G 10,5 fora do Hipparcos, com distância de Bailer-Jones; as fracas carregadas depois em partes), Via Láctea, 12.162 galáxias, nebulosas e aglomerados (Messier, austrais famosos e OpenNGC) e linhas das 88 constelações; precessão e nutação para a data, giro pelo tempo sideral, tamanho e brilho pela magnitude e cor pelo B−V em shader próprio; no sistema solar, estrelas em 3D na distância real |
| `globo-corpos.js` | cálculo puro (testado em `test/corpos.test.mjs`): luas, corpos menores, propagação kepleriana, polos e rotação da IAU (WGCCRE 2015), raios e planetas anões oficiais |
| `globo-espaco.js` | Espaço: satélites, planetas e estrelas tocáveis em volta da Terra, filtros e o sistema solar navegável (planetas, luas, corpos menores, cinturões reais e sondas) |
| `globo-sondas.js` | fichas das missões e interpolação de Hermite dos vetores do JPL Horizons |
| `globo-texturas.js` | texturas procedurais dos astros |

Iluminação da Terra (1.8.1): sempre a real, sem camada própria. Terminador entre o Sol 3° acima e 3° abaixo do
horizonte, faixa quente estreita no nascer e no pôr, luzes das cidades acesas até o fim do crepúsculo civil (−6°) e
apagadas pelas nuvens, noite quase preta com luar pela fase, nuvens noturnas só como sombra escura e reflexo do Sol
no mar discreto.

Referencial da cena: fixo na Terra, raio 1 = 6.371 km, `latLonVec(lat, lon) = (cos·cos, sen, −cos·sen)`. Sol, Lua e
planetas entram pelo ponto sob o astro (ascensão reta menos o tempo sideral, do Astronomy Engine), as estrelas pelo
grupo girado de −GST. No sistema solar, coordenadas heliocêntricas da eclíptica J2000 com distância comprimida
(`1,25·UA^0,45`) e direção real.

Sistema solar (1.7.0):
- Planetas pelo Astronomy Engine (VSOP87); a órbita desenhada é uma volta pela própria efeméride, centrada em agora.
  Cada malha é orientada a cada quadro pelo polo e pelo meridiano principal da IAU (`orientacao`): eixo inclinado
  correto (Urano deitado, rotação retrógrada de Vênus) e, na Terra, Greenwich no lugar do tempo sideral.
- Luas: Lua (ELP/MPP02) e galileanas (L1.2) pelo Astronomy Engine; as outras 16 por elementos osculantes do JPL
  Horizons no dia (`corpos.json`). Em volta do planeta, distância `r·(1 + ln(d/R))` (r raio na tela, R raio real) e
  direção real. Anéis de Saturno nos raios reais (C, B, Cassini, A, Encke) na mesma escala. As luas aparecem quando a
  câmera chega a 40 raios do planeta; a Lua, sempre.
- Corpos menores: 28 do JPL SBDB (planetas anões e candidatos, asteroides visitados por sondas, cometas periódicos),
  órbita kepleriana em volta do Sol; a órbita dos anões fica à mostra, a dos outros ao tocar.
- Cinturões: 6.000 asteroides do cinturão principal, 1.500 troianos de Júpiter e os transnetunianos numerados, com a
  equação de Kepler resolvida no vertex shader (`VERTEX_POP`): atributos P·a, Q·b e (e, M, n); a CPU só passa os
  dias. Sem `corpos.json`, anéis ilustrativos avisados no cartão.
- Navegação: câmera em volta de um foco (`G.foco`); "Ir até" no cartão ou dois toques levam a câmera ao corpo e o
  seguem; planetas com luas enquadram o sistema de luas (16 raios). "Visão geral" volta ao Sol. Zoom multiplicativo.
- Filtros (`prefs` `globo:filtrosEspaco`): estrelas por magnitude, Via Láctea, objetos de céu profundo, nomes, linhas e nomes das constelações, planetas no céu, trilhas, órbitas, luas, corpos menores,
  cinturões, sondas, rotas e nomes.
- Montagem em partes (`pausa` entre planetas, populações e sondas): nenhuma tarefa longa enquanto o Globo abre.

Céu profundo e navegação livre (1.8.0):
- Estrelas em 3D: no sistema solar o grupo das estrelas gira −ε (eclíptica) e cada estrela com paralaxe vai para
  `direção·1,25·(d_pc·206.264,8)^0,45`, a mesma compressão dos planetas. O brilho visto é recalculado no shader a
  partir da distância real até a câmera (`camReal`, descomprimida na CPU): `m = M + 5·log10(d) − 5`. O Sol entra como
  vértice especial (M = 4,83), aceso a partir de 12 unidades da origem; além de 60 (uns 5.000 UA) a maquete do sistema
  solar some e só o rótulo do Sol fica. Estrelas sem distância ficam ao fundo, a 4.000 unidades da câmera.
- `noFundo` (`z = 0,99999·w`): estrelas, Via Láctea e objetos nunca são cortados pelo plano distante. `projetar`
  (`globo-espaco.js`) ignora o plano distante, para tocar e rotular estrelas além dele.
- Via Láctea: polígonos do d3-celestial rasterizados com preenchimento XOR (anéis que dão a volta no céu fechados pela
  borda) em `via-lactea.png`, esfera vista por dentro com mistura aditiva.
- Objetos de céu profundo: pontos dimensionados pelo tamanho angular real (`pxPorGrau = altura/fov`), cor por tipo
  (`TIPOS_OBJETO`), ficha em `cartaoObjeto` (`globo-ceu.js`).
- Filtro por magnitude no shader (`uniforms.limite`): 21 (todas), 6,5, 4,5, 2,5 ou nenhuma.
- Navegação livre (botão no canto inferior direito do sistema solar): câmera solta (`G.livre`: posição, guinada e
  arfagem, Euler YXZ). Arrastar olha em volta; pinça, roda ou W/S avançam com passo proporcional à distância da
  superfície mais próxima (`distanciaProxima`: Sol, planetas, luas, corpos menores, sondas e estrelas); dois toques
  voam até o objeto tocado (parando a 6 raios) ou ao longo do raio tocado; "Ir até" na ficha de uma estrela leva até
  ela. Planos próximo e distante se ajustam à escala. Limite de 7.000 unidades (~1 kpc), porque o catálogo é centrado
  no Sol e fica rarefeito além disso. Um toque no mesmo botão, ou "Visão geral", volta ao modo de órbita.
- `scripts/globo/montar-ceu-profundo.py` gera os quatro arquivos de `vendor/ceu` a partir do CSV do HYG e dos
  `messier.json` e `mw.json` do d3-celestial.
- Gaia DR3 (1.8.7): `scripts/globo/montar-ceu-gaia.py`, rodado pelo workflow `ceu-gaia.yml` (o Gaia Archive não é
  acessível do ambiente de desenvolvimento), consulta o TAP com `MAXREC` (sem ele o serviço corta em 50 mil linhas sem
  avisar) e grava `estrelas-gaia.bin` no próprio branch. O app junta HYG e Gaia num só conjunto de colunas
  (`profundas.nHyg` marca onde o Gaia começa). Em aparelho lento, a qualidade adaptativa desenha só a metade mais
  brilhante do Gaia (nível 2) ou só o HYG (nível 3), por `setDrawRange`, sem tirar nada das fichas.
- Objetos NGC/IC do OpenNGC (`montar-ceu-profundo.py` com `NGC.csv` e `addendum.csv`): sem nome nem anel, só mancha fraca;
  os de Messier, os austrais famosos e os que têm nome em português ganham anel e rótulo.
- Rótulos do espaço não ficam sob os controles visíveis (`zonasDosControles`); com os controles recolhidos, usam a tela toda.

Regras de visibilidade (constantes `VIS` em `ceu.js`): céu escuro com Sol a −6° ou menos (planetas muito brilhantes a
partir de −1° a −4°, pela magnitude); pelo menos 10° de altura; satélite visível só iluminado pelo Sol (sombra
cilíndrica da Terra) com o céu do observador escuro; elementos orbitais com mais de 3 dias são descartados. As nuvens
de cada item usam a mesma mediana dos modelos e os mesmos limites (45% e 75%) da aba Hoje.

Dados gerados pelo `globo.yml` (`scripts/globo/atualizar.py`): GFS 0,5° (NOMADS), mosaico infravermelho (NASA GIBS),
ciclones (GDACS e NHC), elementos orbitais (CelesTrak) e, uma vez por dia, os vetores das 16 sondas pelo JPL Horizons
(`sondas.json`: rota desde o lançamento até 2 anos à frente, trecho recente de 200 dias para cada lado com passo de 1
dia, ou 12 h para a Parker, e trecho fino de 6 h em volta de agora; para o James Webb, também os vetores em relação à
Terra no último ano). Uma vez por dia, também `corpos.json`: elementos das luas (Horizons, centro no planeta), dos 28
corpos menores (`sbdb.api` com `full-prec`) e das populações dos cinturões (`sbdb_query.api`, classes MBA, TJN e
TNO). `workflow_dispatch` com `so=sondas` ou `so=corpos` força a regeração.

Pré-carregamento: assim que a Terra aparece, `prepararEspaco` monta em tempo ocioso os satélites, os planetas no céu e
o sistema solar com as sondas, tudo escondido; abrir Espaço ou Sistema solar só torna visível.

