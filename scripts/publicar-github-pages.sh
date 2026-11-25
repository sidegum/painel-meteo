#!/usr/bin/env bash
# Publica no GitHub Pages (https://sidegum.github.io/painel-meteo/) o mesmo site montado para o Cloudflare Pages.
# Uso: scripts/publicar-github-pages.sh <pasta-do-site-montado>
#
# O site vai para o branch "site-github" sempre como um único commit (sem histórico), e o GitHub Pages publica esse
# branch ("Deploy from a branch", pasta raiz). O commit é montado no próprio repositório local, então os arquivos que
# já estão na main (vendor/, js/...) não são reenviados a cada publicação; só sobe o que mudou.
#
# Variáveis de ambiente:
#   GITHUB_TOKEN       token do workflow, com "contents: write"
#   GITHUB_REPOSITORY  dono/repositório (o GitHub Actions preenche)
#   PAGES_MENSAGEM     mensagem do commit (opcional)
# Sem o token, só avisa e termina sem erro.
set -euo pipefail

site=${1:?informe a pasta do site montado}
branch=site-github

if [ -z "${GITHUB_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "::notice::Sem GITHUB_TOKEN ou GITHUB_REPOSITORY. Nada foi publicado no GitHub Pages."
  exit 0
fi

raiz=$(cd "$(dirname "$0")/.." && pwd)
site=$(cd "$site" && pwd)
[ -f "$site/index.html" ] || { echo "Site sem index.html em $site" >&2; exit 1; }

# Sem o Jekyll: o site já está pronto e nenhum arquivo pode ser filtrado ou processado.
touch "$site/.nojekyll"

indice=$(mktemp)
trap 'rm -f "$indice"' EXIT
rm -f "$indice"
export GIT_INDEX_FILE=$indice
git -C "$raiz" --work-tree="$site" add -A -f .
arvore=$(git -C "$raiz" write-tree)
unset GIT_INDEX_FILE

mensagem=${PAGES_MENSAGEM:-$(git -C "$raiz" log -1 --format=%s)}
commit=$(GIT_AUTHOR_NAME="github-actions[bot]" GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com" \
  GIT_COMMITTER_NAME="github-actions[bot]" GIT_COMMITTER_EMAIL="41898282+github-actions[bot]@users.noreply.github.com" \
  git -C "$raiz" commit-tree "$arvore" -m "$mensagem" -m "App da main em $(git -C "$raiz" rev-parse --short HEAD).")

# O GitHub às vezes recusa o push com erro interno passageiro: até 4 tentativas, como no globo.yml.
for espera in 0 10 30 60; do
  sleep $espera
  if git -C "$raiz" push --force --quiet "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" \
    "$commit:refs/heads/$branch"; then
    echo "GitHub Pages: branch $branch atualizado ($(git -C "$raiz" rev-parse --short "$commit"))."
    exit 0
  fi
done
echo "::error::Não consegui atualizar o branch $branch do GitHub Pages." >&2
exit 1
