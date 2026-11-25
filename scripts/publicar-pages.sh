#!/usr/bin/env bash
# Monta o site (scripts/montar-site.sh) e publica o mesmo conteúdo nos dois endereços do app:
#   - Cloudflare Pages (https://tempo-rs.pages.dev), por Direct Upload com o Wrangler;
#   - GitHub Pages (https://sidegum.github.io/painel-meteo), pelo branch site-github (scripts/publicar-github-pages.sh).
# Uso: scripts/publicar-pages.sh [pasta-com-os-dados-do-globo]
# Sem a pasta, busca o branch globo-dados do repositório. Cada publicação substitui o site inteiro, então ela sempre
# leva o app da main e os campos do Globo juntos.
#
# Variáveis de ambiente:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID  segredos do repositório (o token precisa de "Cloudflare Pages: Edit")
#   PAGES_PROJETO                                nome do projeto no Pages (padrão: tempo-rs)
#   GITHUB_TOKEN, GITHUB_REPOSITORY              token do workflow ("contents: write") para o GitHub Pages
# Sem os segredos de um dos dois, só avisa e publica no outro.
# Documentação: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
set -euo pipefail

globo=${1:-}
projeto=${PAGES_PROJETO:-tempo-rs}
wrangler=(npx --yes wrangler@4)

raiz=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'git -C "$raiz" worktree remove --force "$tmp/globo" 2>/dev/null || true; rm -rf "$tmp"' EXIT
if [ -z "$globo" ]; then
  if git -C "$raiz" fetch --quiet --depth 1 origin globo-dados && git -C "$raiz" worktree add --quiet --detach "$tmp/globo" FETCH_HEAD; then
    globo="$tmp/globo"
  else
    echo "::warning::Branch globo-dados indisponível; o site sai sem os campos do Globo."
  fi
fi
site="$tmp/site"
"$raiz/scripts/montar-site.sh" "$site" ${globo:+"$globo"}

# Os campos do Globo gerados neste job já estão no branch globo-dados: trazê-los para o repositório local evita
# reenviá-los no push do GitHub Pages.
[ -z "$globo" ] || [ ! -d "$globo/.git" ] || git -C "$raiz" fetch --quiet "$globo" HEAD || true

# Uma falha no GitHub Pages não impede a publicação no Cloudflare; o job só falha no fim.
github=0
"$raiz/scripts/publicar-github-pages.sh" "$site" || github=$?

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::notice::Faltam os segredos CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID. Nada foi publicado no Cloudflare Pages."
  exit "$github"
fi

# Cria o projeto na primeira vez (produção = branch main).
codigo=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$projeto")
if [ "$codigo" != "200" ]; then
  echo "Projeto $projeto não encontrado (HTTP $codigo); criando."
  "${wrangler[@]}" pages project create "$projeto" --production-branch=main || {
    echo "::error::Não consegui criar o projeto $projeto no Pages. Confira se o token tem a permissão Account > Cloudflare Pages > Edit."
    exit 1
  }
fi

"${wrangler[@]}" pages deploy "$site" --project-name="$projeto" --branch=main \
  --commit-hash="$(git -C "$raiz" rev-parse HEAD)" \
  --commit-message="${PAGES_MENSAGEM:-$(git -C "$raiz" log -1 --format=%s)}" --commit-dirty=true

exit "$github"
