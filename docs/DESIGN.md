# Plano visual

Este documento foi escrito antes do código, como pede a especificação. Ele define a paleta, a tipografia, a grade e o layout das cinco abas, com wireframes em ASCII das primeiras telas em 360 x 640 px.

## Ideia

A referência são as cartas sinóticas: um mar de fundo, linhas de pressão, frentes azuis e vermelhas e escalas de radar. O painel usa esse vocabulário apenas quando ele carrega dado real. Por exemplo, a linha que atravessa a Faixa do Céu é a pressão prevista, não um enfeite. Não há isóbaras decorativas.

## Paleta

Desde a 1.14.0 a paleta é a do bloco "Cores do painel", no começo do `app.css`, que é a referência (a tabela original deste plano, com o "mar" `#17303B` e cores mais fortes, foi substituída). A regra: a cor indica a informação e é discreta, nos dois temas.

| Papel | Escuro (padrão) | Claro | Significado |
|---|---|---|---|
| Fundo | `#111315` | `#F4F5F6` | |
| Superfície | `#1A1D20` e `#23272B` | `#FFFFFF` e `#ECEEF0` | blocos de dados, sem sombra |
| Linha | `#2C3136` | `#DDE1E4` | divisões de 1 px |
| Texto | `#ECEEF0` | `#15181B` | |
| Texto fraco | `#9BA4AC` | `#5D666E` | contraste mínimo 4,5:1 nos dois temas |
| Chuva | `#6C97B3` (texto `#8FB0C6`) | `#5E89A7` (texto `#3D6784`) | só chuva |
| Rajada | `#B39C66` (texto `#C7B588`) | `#9A8348` (texto `#75612D`) | só rajada e vento |
| Frio | `#93A8C7` | `#4C6892` | temperatura mínima, tendência de queda |
| Calor e alerta | `#D19C89` | `#A25743` | temperatura máxima, alertas |
| Radar de tempestade | `#6C97B3`, `#C2B67C`, `#C9955F`, `#C06F63`, `#A878B1` | `#5E89A7`, `#B3A052`, `#BC8247`, `#B3564A`, `#93589D` | chuva fraca, moderada, forte, tempestade e tempestade forte |
| Medido | traço contínuo e ponto cheio | | |
| Previsto | traço contínuo sem ponto, faixa de cenários translúcida | | |

O tema é escolhido em "Ver mais" (Automático, Claro ou Escuro). `test/cores.test.mjs` confere contraste e saturação.

## Tipografia

- Archivo variável (eixos de largura 62 a 125 e peso 100 a 900), hospedada em `vendor/fontes`.
- Frase principal: largura 112, peso 720, 26 px. Larga e firme, legível no sol.
- Números grandes: largura 100, peso 650, números tabulares.
- Rótulos: largura 85, peso 560, 14 px, em caixa normal (nada em maiúsculas).
- Corpo mínimo de 15 px para informação importante e 13 px só para fonte e horário.

## Grade

- Base de 4 px, margens laterais de 16 px.
- 360 px: uma coluna.
- 720 px: duas colunas a partir da seção de detalhes.
- 1100 px: navegação vai para o topo e o conteúdo usa três colunas.
- Navegação inferior fixa de 64 px mais `safe-area-inset-bottom`.

## Como evitar cara de template

- A primeira tela não é um card: é uma faixa inteira com frase, números e a Faixa do Céu, sem bordas.
- Cada seção tem forma própria: lista horizontal por hora, tabela densa de instrumentos, meteograma, mapa. Nada de grade de cards iguais.
- Divisões por linhas de 1 px e mudança de superfície, sem sombras, sem gradientes decorativos, sem vidro.
- Nenhum emoji. Ícones são desenhos simples em SVG: seta de vento, gota, bandeira de rajada.
- A única animação automática é o radar, com botão de pausa. Com `prefers-reduced-motion` o radar começa parado.

Revisão do plano: a primeira ideia era separar chuva, vento e temperatura em três cards lado a lado. Troquei por linhas inteiras com o número grande à esquerda e o contexto à direita, porque três cards iguais em 360 px ficam apertados e parecem template.

## Wireframe: Hoje, 360 x 640

```
+------------------------------------+
| Campo Bom, RS          [Atualizar] |  48 px  local, botão ao alcance
| Atualizado 16:40 (há 3 min)        |
|------------------------------------|
| ! Aviso INMET: chuvas intensas  >  |  36 px  só se houver alerta
|------------------------------------|
| Chuva à tarde, com                 |  64 px  frase principal
| rajadas fortes                     |
|------------------------------------|
| CHUVA  80%   8 mm (3 a 18)         |  76 px
|        mais provável 15h a 18h     |
|        chuva provável, volume      |
|        incerto                     |
|------------------------------------|
| RAJADA 62 km/h  de SE  às 17h      |  48 px
|------------------------------------|
| 17° / 28°        Confiança: média  |  40 px  toque abre a regra
|------------------------------------|
|  Faixa do Céu (próximas 24 h)      |
|  ~~~ nuvens altas ~~~              |
|  ### nuvens baixas ###             | 140 px  dados reais
|  |||| chuva |||                   |
|  ---- pressão ----   ^ agora       |
|  setas de vento, bandeira rajada   |
|  0h   6h   12h   18h   24h         |
|------------------------------------|
| Hoje Amanhã Semana Modelos ElNiño  |  64 px  navegação fixa
+------------------------------------+
```

## Wireframe: Amanhã, 360 x 640

Mesma estrutura de Hoje para comparação rápida. Muda só o título e o período.

```
+------------------------------------+
| Campo Bom, RS          [Atualizar] |
| Amanhã, qua 4 nov                  |
|------------------------------------|
| Seco pela manhã, chuva fraca       |
| à noite                            |
|------------------------------------|
| CHUVA  45%   2 mm (0 a 6)          |
|        mais provável 20h a 23h     |
|------------------------------------|
| RAJADA 38 km/h  de S  às 14h       |
|------------------------------------|
| 15° / 24°         Confiança: alta  |
|------------------------------------|
|  Faixa do Céu (00h a 24h)          |
|------------------------------------|
| Hoje Amanhã Semana Modelos ElNiño  |
+------------------------------------+
```

## Wireframe: Semana, 360 x 640

```
+------------------------------------+
| Campo Bom, RS          [Atualizar] |
| Próximos 7 dias                    |
|------------------------------------|
| ter 3  Chuva à tarde               |
|        80%  8 mm   62 km/h  17/28  |
|        confiança média         [v] |
|------------------------------------|
| qua 4  Chuva fraca à noite         |
|        45%  2 mm   38 km/h  15/24  |
|        confiança alta          [v] |
|------------------------------------|
| qui 5  Seco                        |
|        10%  0 mm   25 km/h  14/26  |
|        confiança alta          [v] |
|------------------------------------|
| sex 6  ...                         |
| sáb 7  ...                         |
| Hoje Amanhã Semana Modelos ElNiño  |
+------------------------------------+
```

Cada linha tem 76 px de altura e é inteira tocável para expandir.

## Modelos e El Niño

- Modelos: frase sobre concordância, depois gráficos de chuva acumulada e rajada com uma linha por modelo e o leque de cenários do ensemble, a hora em que divergem, a tabela de acerto e a regra de confiança.
- El Niño: frase com o status oficial da NOAA, datas lidas da fonte, gráfico dos índices, probabilidades por trimestre, IRI separado, tendência do INMET e comparação histórica.
