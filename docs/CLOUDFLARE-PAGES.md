# Publicar no Cloudflare Pages (subdomínio próprio)

O app vai para o Cloudflare Pages pelo GitHub Actions, sem passo de compilação. Os arquivos são só copiados (`scripts/montar-site.sh`) e enviados com o Wrangler (`scripts/publicar-pages.sh`, modo Direct Upload).

O nome do subdomínio fica num lugar só: a variável `PAINEL_DOMINIO` do repositório. Nos exemplos, ele aparece como `tempo.seudominio.com.br`.

## Situação

Desde 05/11/2026, o app está só em `https://tempo-rs.pages.dev/` (projeto `tempo-rs`, padrão no código), e o repositório é privado. O GitHub Pages foi desligado. O antigo `sidegum.github.io/painel-meteo` levou ao novo endereço por algumas horas (versões 1.8.9 e 1.8.10), e esse código já foi removido.

Os passos abaixo servem para ligar um domínio próprio, se um for comprado (os passos 1 e 3 já estão feitos).

## O que você faz (uma vez só)

**1. Dar ao token a permissão do Pages (já feito).** O token que já publica o Worker precisa de mais uma permissão. No painel da Cloudflare, abra a página **API Tokens** (em **My Profile > API Tokens**), edite o token e acrescente **Account > Cloudflare Pages > Edit**. Se preferir criar um token novo, inclua as permissões antigas e troque o segredo `CLOUDFLARE_API_TOKEN` no GitHub.

**2. Informar o subdomínio ao GitHub.** No repositório, vá em **Settings > Secrets and variables > Actions > aba Variables > New repository variable**.
- `PAINEL_DOMINIO` = `tempo.seudominio.com.br` (só o nome, sem `https://`).
- `PAGES_PROJETO` é opcional. O padrão é `tempo-rs`, e o endereço fica `tempo-rs.pages.dev`.

**3. Fazer a primeira publicação (já feito).** Em **Actions > Publicar no Cloudflare Pages > Run workflow**. Na primeira vez, o workflow cria o projeto no Pages. O endereço `*.pages.dev` aparece no fim do log e em **Workers & Pages** no painel da Cloudflare.

**4. Apontar o subdomínio.** No painel da Cloudflare, vá em **Workers & Pages >** projeto **tempo-rs > Custom domains > Set up a domain**. Digite `tempo.seudominio.com.br`, toque em **Continue** e confirme o registro DNS na tela seguinte. Como o domínio já está na Cloudflare, o registro CNAME é criado sozinho. Não crie esse CNAME à mão antes: segundo a documentação, isso dá erro 522. O certificado HTTPS leva de alguns minutos a algumas horas.

**5. Liberar o novo endereço no Worker.** Em **Actions > Publicar Worker > Run workflow**. O log mostra a linha "Origens aceitas", que deve incluir `https://tempo.seudominio.com.br`.

**6. Conferir.** Abra `https://tempo.seudominio.com.br/` no celular. Confira três coisas: Medições agora com dados das estações (isso vem do Worker), o Globo com vento e nuvens, e o app abrindo sem internet depois da primeira visita. Depois, instale na tela inicial a partir do novo endereço.

## Depois disso, nada é manual

| O que muda | Quem publica no Pages |
|---|---|
| Código na `main` (push ou PR mesclado) | `pages.yml` |
| Campos do Globo (a cada 3 h) | `globo.yml`, no mesmo job |
| El Niño (a cada 6 h, só quando muda) | `enso.yml`, no mesmo job |
| Calibração diária, endereço do Worker | `pages.yml`, depois desses workflows |

Cada publicação leva o app da `main` e os campos do Globo juntos. Sem os segredos da Cloudflare, os workflows só avisam e terminam sem erro.

## Com o repositório privado

- O Cloudflare Pages funciona igual: o Direct Upload não lê o repositório, quem envia os arquivos é o GitHub Actions.
- Os campos do Globo, o El Niño e a calibração saem do próprio site (`globo-dados/` e `dados/`), nada vem do `raw.githubusercontent.com`.
- Só vão para o site os arquivos que o navegador usa. Ficam de fora `worker/`, `scripts/`, `test/`, `docs/`, `dados/historico/` e `package*.json`.
- Os minutos do GitHub Actions (2.000 por mês no plano gratuito) foram ajustados no PR #65 para cerca de 750 a 1.150 por mês.

## Detalhes técnicos

- O Cloudflare Pages redireciona `/index.html` para `/` e `/privacidade.html` para `/privacidade`. O service worker trata os dois casos, então o app abre sem internet nos dois endereços.
- `cloudflare/_headers` define cabeçalhos de segurança, `noindex` (o site é pessoal) e cache de 5 min para `globo-dados/`. `cloudflare/404.html` faz um arquivo que não existe responder 404, em vez de devolver o app.
- O Worker aceita as origens de `ALLOWED_ORIGIN` no `worker/wrangler.toml`, mais o endereço real do projeto no Pages (lido da API da Cloudflare) e `https://<PAINEL_DOMINIO>`. Numa publicação feita à mão do computador, acrescente o domínio no `wrangler.toml`.
- Referências: [Direct Upload com CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Headers](https://developers.cloudflare.com/pages/configuration/headers/), [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/), [Limits](https://developers.cloudflare.com/pages/platform/limits/).
