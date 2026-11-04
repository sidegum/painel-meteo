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
3. Em `requestIdleCallback`, desenha os detalhes: `renderHojeDetalhes`, `renderAmanhaDetalhes`, `renderSemana`, `renderModelos` e, se a aba estiver aberta, `renderElNino`. Depois restaura `scrollY` para a tela não pular.

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

- `calibrarPrevisao(prev, { calib, aprendizado, refMs })`: corrige `temperature_2m` hora a hora (a correção de cada hora é interpolada entre a da mínima e a da máxima pela posição da hora entre a mínima e a máxima do dia daquele modelo, de modo que a máxima do gráfico é exatamente a máxima corrigida do dia), a temperatura `current` e multiplica `wind_gusts_10m` e `wind_speed_10m` pelo fator histórico. A antecedência de cada dia é a distância até o dia da busca, mínimo 1, máximo 5.
- `calibrarEnsemble(ens, calib, refMs, offset)`: aplica o fator de rajada aos membros dos cenários, usando o modelo determinístico de mesma origem (`CALIBRACAO_ENSEMBLE`).

Todas as telas (primeira tela, gráficos, Semana, comparação, pressão) leem `estado.prev` e `estado.ens`, então herdam a mesma correção e nunca se contradizem. `analisarDia` não aplica nenhuma correção própria.

As duas camadas só valem a até 50 km da estação onde foram medidas (`calibracaoAplicavel` e `aprendizadoLocal`).

### 3.8 Temperatura no padrão europeu (ECMWF)

Implementado em `app.js` (`MODELO_TEMP = 'ecmwf_ifs'`):

- **Mínima e máxima do dia** (`analisarDia`): a do ECMWF IFS, lida da série já corrigida (3.7). Se o IFS não tiver dado, entra a mediana ponderada dos demais modelos. `tminFaixa` e `tmaxFaixa` guardam o intervalo entre os modelos, como informação de dispersão.
- **Temperatura por hora** (`tempHora` e `serieTemp`): o valor horário do IFS, já corrigido. Se faltar, a mediana ponderada dos modelos.
- **Temperatura "agora"** (`renderAgora`), em ordem de preferência:
  1. A medição da estação mais próxima, a até 25 km e com até 2 h.
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
  | Estável ou subindo | Chuva possível ou provável | "Pressão estável": a chuva prevista não depende de queda de pressão (por exemplo, pancadas de calor) |
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

Mostra a data, a temperatura agora, o ícone do céu (`iconeCeu`, em SVG), a mínima, a máxima e a chance, a resposta "Vai chover", o volume e a janela, o alerta (`linhaAlerta`), a rajada e o gráfico horário com três modos:

- **Chuva** (`graficoChance`):
  - A chance por hora vem de `chanceHoraria(ms)`: a fração de **todos** os membros de cenários com 0,2 mm ou mais na hora, se houver 10 ou mais. Sem isso, a mediana de `precipitation_probability` dos modelos.
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
5. Meteograma.
6. Fontes de dados.

- `previstoMedido(s)` mostra três gráficos sincronizados: temperatura (prevista pelo ECMWF), chuva acumulada e rajadas. A linha tracejada é a previsão e a linha cheia com pontos é a medição. A medição de cada hora é a leitura a até ±30 min. Na chuva acumulada, uma hora sem leitura interrompe a linha medida, para não somar lacunas como zero. Sem histórico de medições, a seção não aparece.
- `meteograma(...)`: gráficos de várias variáveis com zoom por pinça, usando `PAINEIS`.
- `estadoFontes()`: lista curta de onde vem cada dado e como é calculado, mais uma linha de situação ("Sem resposta agora: …" ou "Todas as fontes responderam").

### 5.5 Outras abas

- **Amanhã** (`renderAmanhaDetalhes`): a mesma primeira tela, com `desdeAgora = false`, mais a tabela por modelo (`tabelaModelosDia`) e o índice UV (`textoUv`).
- **Semana** (`renderSemana`, `tabelaLimites`, `tabelaFaixas`): um dia por linha, com as probabilidades de passar limites e as faixas entre modelos.
- **Modelos** (`renderModelos`, `resumoAprendizado`, `tabelaAcerto`): os pesos atuais, o que já foi aprendido e o acerto por modelo e antecedência.
- **El Niño** (`renderElNino`, `painelEnso`, `intensidade`, `barrasProb`, `comparacaoHistorica`): os índices ONI e RONI, a discussão do CPC, as probabilidades do CPC e do IRI, e a estimativa diária do Niño 3.4.

### 5.6 Alertas

- `alertasDoLocal()`:
  - Para Campo Bom, usa a lista oficial de municípios por código IBGE (`municipioPadrao`).
  - Para outros locais, testa se o ponto está dentro do polígono do aviso. `dentroPoligono` usa *ray casting* e roda no aparelho, sem enviar a posição.
  - Sem área (RSS), aceita avisos que citam o RS e os marca como `incerto`.
- `detalheAlertas` abre o texto oficial (riscos e instruções) num diálogo.

### 5.7 Navegação e gestos

- `irPara(aba, rolarTopo, direcao)`: troca a aba visível, atualiza `aria-current` e aplica a animação de entrada (`entra`, `entra-dir`, `entra-esq`). A animação usa só `transform` e `opacity`, que são compostas na GPU.
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
| `/v1/observacoes` | `lat`, `lon` (validados por `lerCoord` e arredondados) | Estações METAR numa caixa de ±1,2° (`normalizarMetar`: nós → km/h, umidade pela fórmula de Magnus) e até 4 estações do INMET a até 120 km. Com token: série de 7 dias. Sem token: última leitura (`ultimaInmet`) somada à série horária gravada no KV. `acumulados` calcula a chuva em 1 h, 24 h, 72 h e 7 dias, exigindo 90% das horas. `normalizarInmet` converte m/s → km/h e a pressão da estação para o nível do mar (fórmula barométrica). |
| `/v1/alertas` | — | Avisos ativos do INMET (`normalizarAvisos`, `poligonosGeojson` simplificado para até 400 pontos por anel, `listaPython`). Se falhar, usa o RSS do INMET (sem área). Se o RSS também falhar, responde 502 `indisponivel`. |
| `/v1/enso` | — | Lê `enso:ultimo` do KV. Se tiver mais de 7 h, chama `atualizarEnso`. |
| `/v1/acerto` | `estacao` | O histórico `acerto:<id>` resumido por `resumirAcerto` (taxa de acerto de chuva, MAE e viés por modelo e antecedência de 1 a 5 dias), mais `calibracao` (pares, índice de Brier e 10 faixas). |
| `/v1/saude` | — | Versão, token configurado (sim ou não) e KV presente. |

### 9.3 Tarefas agendadas (cron)

| Cron | Tarefa |
|---|---|
| `5 * * * *` | `registrarSeries`: guarda a última leitura das estações INMET de verificação em `serie:<id>`, com janela de 8 dias. |
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

- `.github/workflows/testes.yml`: roda `npm test`, `npm audit` e a busca por segredos em cada push e PR.
- `.github/workflows/worker.yml`: publica o Worker quando `worker/**` muda na `main`.
- `.github/workflows/enso.yml`: a cada 3 h, roda `scripts/atualizar-enso.mjs`.
  - O script reaproveita `atualizarEnso` do Worker com um "KV" de arquivo.
  - Também estima o Niño 3.4 diário: a média da temperatura do mar em 18 pontos entre 5°N e 5°S, 170°W e 120°W (Open-Meteo Marine), menos a climatologia mensal de 1991 a 2020 derivada do `sstoi.indices` do CPC e interpolada entre os meios dos meses.
  - O resultado é gravado em `dados/enso.json`.
- `.github/workflows/calibracao.yml`: no dia 5 de cada mês (e quando os scripts da calibração mudam), roda:
  - `scripts/historico.mjs`: baixa os ZIPs anuais do INMET (BDMEP), extrai a A884 (`scripts/lib/inmet.mjs`: leitor de ZIP próprio, CSV em Latin-1, controle de qualidade, dia local) e as previsões passadas da Previous Runs API (6 modelos, 1 a 5 dias antes, blocos de 60 dias). Grava `dados/historico/A884-diario.json` (uma linha por dia, incremental).
  - `scripts/calibrar.mjs`: calcula `dados/calibracao.json` e `docs/calibracao-resultado.md` (`scripts/lib/calibracao.mjs`). Detalhes em CALIBRACAO.md.
- `scripts/configurar.mjs`: grava a URL do Worker em `js/config.js`.
- `test/analise.test.mjs`: 21 testes das funções puras.
- `worker/test/worker.test.mjs`: 24 testes dos parsers e das regras do Worker, com fixtures reais.
- `test/calibracao.test.mjs`: leitor de ZIP e CSV do INMET, agregação diária, viés, fator, validação fora da amostra e aplicação no app (séries, cenários, pesos).
- O comando `npm test` roda os três.

---

## 11. Widget do iPhone (`widget/`)

Guia de uso: `docs/WIDGET.md`.

### 11.1 Arquitetura

O iOS não permite widget de PWA. O widget roda no app Scriptable (`widget/painel-widget.js`) e **não calcula nada**:
abre o próprio painel num `WebView` fora da tela, no modo widget, e só exibe os textos prontos que o painel devolve.
Assim o widget nunca diverge do app (regra de não conflito), e qualquer ajuste de regra ou calibração vale para os dois.

```
Scriptable ── GPS (≈3 km, arredondado a 2 casas) ──► WebView: APP/?widget=1&lat=..&lon=..&nome=..
                                                        │  js/app.js (MODO_WIDGET): atualizar({completo}) → resumoWidget()
◄──────────── JSON (window.painelResumo) ───────────────┘
```

### 11.2 Modo widget em `js/app.js`

- `lerModoWidget(location.search)`: ativa com `widget=1`. Valida `lat` e `lon` (faixas geográficas) e arredonda a 2 casas.
  `nome` é limpo (letras, números e pontuação simples, até 40 caracteres). Sem coordenada válida, usa `CONFIG.padrao`.
- `iniciarWidget()`: no lugar de `iniciar()`. Não usa GPS, não grava preferências, não lê cache e não registra o
  service worker. Chama `atualizar({ forcar: true, completo: true })` com teto de `ESPERA_WIDGET_MS` (20 s) e resolve
  `window.painelResumo` com `resumoWidget()` ou `{ formato, erro }`. A Promise nunca fica pendente.
- `atualizar({ completo })`: com `completo`, só retorna quando todas as fontes terminam (o teto interno de 30 s continua).
  No modo widget, El Niño não é buscado (não entra na tela Hoje).
- `renderTudo()` retorna logo no modo widget: não há telas a desenhar.

### 11.3 Funções compartilhadas pela tela Hoje e pelo widget

- `temperaturaAgora()`: estação a até 25 km e 2 h; senão o valor atual do ECMWF (`MODELO_TEMP`), a mediana ponderada
  dos modelos ou a hora cheia. Usada por `renderAgora()` e `resumoWidget()`.
- `situacaoChuva(a)`: chuva medida agora, chuva chegando pelo radar, frase curta (`respostaChuva`) e texto de detalhe
  (quanto ainda cai, horário de início pelo radar, volume e janela provável). Usada por `renderPrimeira()` e `resumoWidget()`.
- `resumoWidget()`: junta `temperaturaAgora`, `analisarDia(hoje)`, `situacaoChuva`, `avaliarRisco`, `avisosOrdenados`,
  `notaFonte`/`notaPrevisao` e `fmt`.

### 11.4 Contrato do resumo (`FORMATO_RESUMO = 1`)

```js
{
  formato: 1, versao: '1.2.22', geradoMs, previsaoMs,
  valores: {               // só para cor e ícone no widget
    temperatura, temperaturaMedida, chance, chovendo, chegando,
    temporal: 'moderado' | 'alto' | null, aviso: boolean, rajadaKmh,
  },
  textos: {                // exibidos como estão
    local, temperatura, rotuloTemperatura, notaTemperatura, notaPrevisao, minMax,
    chuva, chance, chuvaDetalhe, temporal, temporalFonte, rajada, confianca,
  },
}
```

Em falha: `{ formato: 1, erro: 'mensagem' }`. Mudança incompatível exige subir `FORMATO_RESUMO` em `js/app.js` e
`CONFIG.formatoResumo` no widget juntos (o teste `test/widget.test.mjs` confere que são iguais). Com formato diferente,
o widget não exibe o resumo.

### 11.5 Script do Scriptable (`widget/painel-widget.js`)

- `CONFIG.appUrl`: único endereço a trocar na mudança de hospedagem.
- `obterLocal(parametro)`: parâmetro do widget `"lat,lon"`; senão GPS com `Location.setAccuracyToThreeKilometers()` e
  teto de 8 s, mais o nome da cidade por `Location.reverseGeocode` (4 s); senão o último local; senão nenhum (o painel usa Campo Bom).
- `buscarResumo(local)`: `WebView.loadURL` (15 s) e `evaluateJavaScript(..., true)`, que espera `window.painelResumo`
  por até 25 s e devolve JSON por `completion()`. Valida `formato` e `erro`.
- Cache: último resumo válido e último local em `painel-meteo-widget.json`, na pasta local do Scriptable. Sem resumo
  novo, mostra o guardado com a nota "Sem atualização · dados de HH:MM".
- `montarWidget(resumo, guardado, familia)`: pequeno, médio e grande; na tela bloqueada, `accessoryRectangular`,
  `accessoryCircular` e `accessoryInline`. Toque abre `appUrl`. `refreshAfterDate` pede nova execução em 15 min.
- O Scriptable não tem `setTimeout`: `comLimite()` usa `Timer.schedule`.
- `await principal()` fica no fim do arquivo, depois de todas as declarações `const`.

### 11.6 Instalação

`widget/index.html` (link "Widget do iPhone" no rodapé) mostra os passos e copia o código. No Safari, a cópia usa
`ClipboardItem` com Promise para manter a permissão do toque durante o download (`widget/instalar.js`).

### 11.7 Testes

`test/widget.test.mjs` roda o script com uma simulação mínima da API do Scriptable: local e arredondamento, parâmetro
fixo, cache sem conexão, resumo com erro ou formato diferente, linha de temporal e todos os tamanhos. O Scriptable
real (WebView, GPS e agenda do iOS) só é testado no iPhone.

## 12. Procedimento de alteração

1. Mudar o código. Toda regra numérica nova entra em `analise.js`, com limite em `REGRAS` e teste.
2. Subir `VERSAO` em `js/app.js` e em `sw.js`.
3. Rodar `npm test` e conferir no navegador, no celular (390 px) e no computador.
4. Atualizar este documento na seção afetada.
5. Abrir um PR para a `main`. O Pages publica em cerca de 1 min, e o Worker é publicado pelo workflow quando `worker/**` muda.
