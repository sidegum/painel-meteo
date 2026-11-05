# Relatório de entrega (2026-11-03)

## O que foi entregue

- App completo nas abas Hoje, Amanhã e Semana, mais Avisos, Globo, El Niño e Modelos no menu Ver mais (desde a 1.5.0), com primeira tela sem rolagem em 360 x 640, Faixa do Céu, meteograma de 7 painéis, previsto x medido, mapa com radar, instrumentos, estado das fontes e página de privacidade.
- Cloudflare Worker com rotas fixas `/v1/observacoes`, `/v1/alertas`, `/v1/enso`, `/v1/acerto` e `/v1/saude`, mais três tarefas agendadas (séries horárias, El Niño, acerto diário).
- PWA instalável (manifest, service worker, ícones).
- 32 testes automáticos (`npm test`), CI no GitHub Actions, Dependabot.
- Documentos: `README.md` (publicação e instalação), `docs/DESIGN.md` (plano visual e wireframes), `docs/SEGURANCA.md` (checklist e riscos), `docs/VENDOR.md` (bibliotecas e hashes).

## Decisões tomadas sem consulta (o Gustavo autorizou)

1. **Modelos** (revisado em 2026-11-03): `ecmwf_ifs`, `ecmwf_aifs025_single` e `ukmo_global_deterministic_10km`, os globais de melhor desempenho nas verificações publicadas; `ncep_gfs_seamless` só para o índice UV diário. Ensemble: `ecmwf_ifs025`, `ecmwf_aifs025_ensemble` e `ukmo_global_ensemble_20km`, uma chamada por modelo, 10 dias. Os identificadores dos ensembles AIFS e UKMO vêm da documentação da Open-Meteo e não foram testados a partir da nuvem, que bateu o limite diário.
2. **Chance de chuva** = fração dos cenários do ensemble com mais de 1 mm no dia. Sem ensemble, vira concordância entre modelos, e o app diz isso.
3. **Volume** = mediana dos cenários ou modelos em que chove, com faixa p10 a p90 (ou menor e maior modelo). Nunca a média.
4. **Confiança**: começa alta e perde um nível por motivo (discordância, cenários divididos, volume ou rajada diferentes, mais de 4 dias, acerto local baixo, medição contraditória). Limites em `REGRAS`, em `js/analise.js`.
5. **El Niño**: o RONI é o índice principal, porque desde 2026 a NOAA classifica pelo RONI. As probabilidades vêm da tabela oficial do CPC. O IRI só publica os números por modelo em imagens, então mostramos o resumo em texto e o link.
6. **INMET sem token**: o Worker usa a última leitura pública (`apiprevmet3 /estacao/proxima`) e grava, a cada hora, as leituras de Campo Bom (A884) e Porto Alegre (A801). Assim o histórico de chuva dessas estações se completa em 7 dias sem token.
7. **App sem Worker**: previsão, cenários, radar, avisos do INMET e a última leitura da A884 vêm direto do navegador, porque essas fontes liberam CORS (testado). METAR e NOAA não liberam e ficam no Worker.
8. **Radar**: a RainViewer limita 100 requisições por minuto, então o quadro mais recente carrega primeiro e os outros 12 entram um a cada 2 s. A animação só começa depois e respeita `prefers-reduced-motion`.
9. **Radar da Defesa Civil RS**: botão para a página oficial. O radar real vem de um iframe em domínio que não deu para testar, então não foi embutido.
10. **CEMADEN**: não foi usado, porque não há acesso público e estável confirmado.
11. **CSS e JS em arquivos separados** em vez de dentro do `index.html`, para a CSP proibir script e estilo inline.

## O que foi testado (com dados reais)

| Teste | Resultado |
|---|---|
| Open-Meteo com 4 modelos, todas as variáveis | ok; ausências por modelo detectadas e mostradas (UV só no GFS; AIFS sem rajada, probabilidade, visibilidade, CAPE e UV; ICON sem visibilidade e UV) |
| Ensemble API | ECMWF ENS respondeu com 51 cenários; GEFS e ICON EPS bateram o limite diário do IP compartilhado da nuvem e o app mostrou a limitação |
| Primeira tela de Hoje e Amanhã em 360 x 640 | toda a resposta principal e a Faixa do Céu acima da navegação (Faixa termina em 550 px; navegação começa em 576 px) |
| Rolagem horizontal da página | nenhuma, nas 5 abas, nos temas claro e escuro (largura 360 px) |
| Deslizar entre abas | Hoje para Amanhã com toque simulado; listas e gráficos não disparam a troca |
| GPS negado | usa Campo Bom e explica; busca de cidades acha Novo Hamburgo e troca o local |
| Coordenadas enviadas | só 2 casas (`-29.68,-51.05`, `-29.68,-51.13`) |
| Sem internet | abre com os dados salvos e avisa que podem estar desatualizados |
| Conexão lenta (400 ms, 50 KB/s), segunda abertura | primeira tela em 160 ms, vinda do cache |
| Apagar dados | localStorage, sessionStorage, caches e service worker zerados |
| Worker local com fontes reais | METAR (SBPA, SBCO, SBCX), 4 estações INMET sem token, avisos (4 para Campo Bom), todas as 8 partes do El Niño, acerto registrado para SBCO e SBPA |
| Worker fora do ar | avisos e leitura da A884 continuam pelo caminho direto |
| Segurança do Worker | proxy aberto, parâmetros inválidos, métodos, CORS, limite por cliente, token em erro, XML malicioso: tudo recusado (ver `docs/SEGURANCA.md`) |
| CSP | nenhuma violação no console em todos os testes de tela |
| `npm audit` | 0 vulnerabilidades |

## O que não pôde ser testado

- Celular real Android e iPhone: só emulação no Chromium (toque, 360 x 640). O Safari do iPhone não foi testado.
- Instalação na tela inicial: o manifest e o service worker foram conferidos, mas o prompt de instalação só aparece em aparelho real.
- Publicação real no GitHub Pages e na Cloudflare: depende das contas do Gustavo. O Worker rodou localmente com as fontes reais.
- Fundo do mapa OpenStreetMap: os tiles responderam 200, mas apareceram cinza no Chromium da nuvem. Os marcadores e o radar carregaram. Suposição: o servidor de tiles entrega imagem diferente para navegador automatizado. Conferir no celular.
- Token do INMET: a rota com token existe (responde "CHAVE INVÁLIDA" para token falso), mas não havia token real.
- Taxa de acerto com 30 dias: o histórico começa a ser gravado quando o Worker for publicado.
- Gesto de pinça nos gráficos: implementado, sem teste automático confiável.

## Limitações conhecidas

- METAR da região não informa chuva acumulada e só informa rajada quando ela ocorre. Ausência de rajada no METAR aparece como "Sem medição", não como zero.
- A Open-Meteo divide os valores do ECMWF IFS em blocos de 3 h depois de cerca de 90 h, então o detalhe hora a hora é menor depois do 4º dia.
- Depois do 7º dia, só restam GFS e ECMWF. Esses dias ficam numa lista separada, com aviso de confiança menor.
- O alerta é ligado ao local pelo polígono oficial do aviso (calculado no aparelho) e, perto de Campo Bom, também pelo código IBGE do município.
- A pressão de algumas estações INMET reduzida ao nível do mar depende da altitude cadastrada. Cachoeirinha (B808) deu 1018,9 hPa contra cerca de 1009 hPa nas vizinhas. O painel usa a estação válida mais próxima e mostra as outras para comparação.
- O cron do Worker grava séries só das estações A884 e A801. Outras estações têm apenas a última leitura sem token.

## Riscos residuais

Ver `docs/SEGURANCA.md`, seção "Riscos residuais".
