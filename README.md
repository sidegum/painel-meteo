# Painel Meteorológico Pessoal

Painel de chuva e vento para celular, com Campo Bom (RS) como local padrão. Compara os três modelos globais mais precisos nas verificações publicadas (ECMWF IFS, ECMWF AIFS e UKMO, do Met Office) e usa a diferença entre eles para dizer quanto dá para confiar na previsão. Não é fonte oficial: em situação de risco, siga a Defesa Civil RS (199) e o INMET.

## Como está organizado

| Parte | Onde | Para quê |
|---|---|---|
| App | `index.html`, `app.css`, `js/` | Frontend estático, publicado no GitHub Pages e no Cloudflare Pages |
| Regras de confiança | `js/analise.js` (objeto `REGRAS`) | Todos os limites ajustáveis num lugar só |
| Worker | `worker/` | Cloudflare Worker gratuito: METAR, INMET, El Niño, acerto dos modelos, tarefas agendadas |
| Instalação | `manifest.json`, `sw.js`, `icones/` | Instalar na tela inicial e abrir sem internet |
| Bibliotecas | `vendor/` | uPlot, Leaflet e fonte Archivo, versões fixas (ver `docs/VENDOR.md`) |
| Documentos | `docs/` | Plano visual, segurança, relatório de entrega |

O app funciona sem o Worker: previsão, cenários, busca de cidades, radar, avisos do INMET e a última leitura da estação INMET de Campo Bom vêm direto do navegador. O Worker acrescenta METAR, estações INMET de qualquer região, histórico de chuva, tendência da pressão, previsto x medido, aba El Niño e taxa de acerto.

## 1. Publicar o app no GitHub Pages

1. Ative a autenticação em dois fatores na conta GitHub.
2. No repositório: Settings > Pages > Source: "Deploy from a branch", branch `main`, pasta `/ (root)`.
3. O endereço será `https://sidegum.github.io/painel-meteo/`. O HTTPS é obrigatório para o GPS.
4. Em Settings > Code security, ative "Secret scanning", "Push protection" e "Dependabot alerts".

## 1b. Publicar no domínio próprio (Cloudflare Pages)

O mesmo app também é publicado no Cloudflare Pages, num subdomínio próprio, pelo GitHub Actions (`.github/workflows/pages.yml`), sem passo de compilação. Continua funcionando com o repositório privado. Passo a passo em [docs/CLOUDFLARE-PAGES.md](docs/CLOUDFLARE-PAGES.md).

## 2. Publicar o Worker (Cloudflare, plano gratuito)

1. Crie a conta Cloudflare, ative dois fatores e não cadastre cartão. O plano gratuito para quando passa do limite diário, não cobra.
2. No computador, dentro do repositório:
   ```
   npm install
   cd worker
   npx wrangler login
   npx wrangler kv namespace create PAINEL_KV
   ```
3. Copie o `id` mostrado para `worker/wrangler.toml` (linha `id = "COLE_AQUI_O_ID_DO_KV"`).
4. Confira `ALLOWED_ORIGIN = "https://sidegum.github.io"` no mesmo arquivo.
5. Publique: `npx wrangler deploy`. Anote o endereço, algo como `https://painel-meteo.SEU-NOME.workers.dev`.
6. Teste: abra `https://painel-meteo.SEU-NOME.workers.dev/v1/saude`.
7. Ligue o app ao Worker, na raiz do repositório:
   ```
   node scripts/configurar.mjs https://painel-meteo.SEU-NOME.workers.dev
   git commit -am "Configura Worker" && git push
   ```
   O script grava o endereço em `js/config.js` e na Content Security Policy do `index.html`.

Opcional: no painel da Cloudflare, crie uma regra de "Rate limiting" para o subdomínio do Worker como segunda barreira.

## 3. Token do INMET (opcional)

Sem token, o Worker usa a última leitura de cada estação e grava, a cada hora, as leituras das estações de Campo Bom (A884) e Porto Alegre (A801). Com isso, o histórico de chuva dessas duas estações se completa em 7 dias. O token libera o histórico completo de qualquer estação.

- Peça o token ao INMET (o portal não documenta mais o pedido; suposição: por e-mail ao INMET).
- Grave só como segredo do Worker: `cd worker && npx wrangler secret put INMET_TOKEN`
- Para trocar: rode o mesmo comando com o token novo. Para remover: `npx wrangler secret delete INMET_TOKEN`
- Nunca coloque o token em arquivo, commit, URL ou mensagem.

## 4. Instalar no celular

- Android (Chrome): abra o endereço do Pages, menu de três pontos, "Instalar app" ou "Adicionar à tela inicial".
- iPhone (Safari): abra o endereço, botão Compartilhar, "Adicionar à Tela de Início".
- Na primeira abertura, permita a localização. Se negar, o app usa o centro de Campo Bom.

## Testes

```
npm test        # regras de confiança e Worker, com respostas reais gravadas em 2026-11-03
npm audit
```

O GitHub Actions roda os dois a cada push (`.github/workflows/testes.yml`).

## Atualizações automáticas

| Dado | Intervalo |
|---|---|
| Medições, alertas, radar | 10 min |
| Previsão e cenários | 15 min |
| El Niño | 6 h (Worker) |
| Acerto dos modelos | 1 vez por dia (Worker) |

O app também atualiza ao voltar para ele, ao puxar a tela para baixo e no botão Atualizar.

## Licenças e atribuições

Previsões: Open-Meteo (CC BY 4.0). Busca de cidades: GeoNames. Radar: RainViewer. Mapa: OpenStreetMap. Medições: INMET e AviationWeather (NOAA). El Niño: NOAA CPC e IRI. Bibliotecas: uPlot (MIT), Leaflet (BSD-2), Archivo (OFL-1.1).

## Dados do El Niño sem Worker

O workflow `.github/workflows/enso.yml` roda a cada 3 horas. Ele executa `scripts/atualizar-enso.mjs` e publica `dados/enso.json` junto com o app.

O arquivo reúne:
- NOAA CPC: índices semanais, ONI, RONI, discussão e probabilidades.
- IRI.
- Uma estimativa diária do Niño 3.4, feita com a temperatura do mar da Open-Meteo Marine.

Para forçar uma atualização, abra Actions > Dados do El Niño > Run workflow.
