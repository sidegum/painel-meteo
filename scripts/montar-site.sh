#!/usr/bin/env bash
# Monta a pasta publicada no Cloudflare Pages: só os arquivos que o navegador usa, sem compilação.
# Uso: scripts/montar-site.sh <pasta-de-saida> [pasta-com-os-dados-do-globo]
#
# Fica de fora tudo que não é do app (worker/, scripts/, test/, docs/, dados/historico/, package*.json), para o site
# não expor código e dados internos quando o repositório for privado. Os campos do Globo (branch globo-dados) entram
# em globo-dados/ (o repositório é privado; o app lê tudo do próprio site).
set -euo pipefail

saida=${1:?informe a pasta de saída}
globo=${2:-}
raiz=$(cd "$(dirname "$0")/.." && pwd)

mkdir -p "$saida" && saida=$(cd "$saida" && pwd)
case "$raiz/" in "$saida"/*) echo "A pasta de saída não pode conter o repositório: $saida" >&2; exit 1 ;; esac
rm -rf "$saida" && mkdir -p "$saida"
mkdir -p "$saida/dados"
[ -z "$globo" ] || globo=$(cd "$globo" && pwd)
cd "$raiz"
cp index.html privacidade.html manifest.json sw.js app.css "$saida/"
cp -R js vendor icones "$saida/"
cp dados/*.json "$saida/dados/"
cp cloudflare/_headers cloudflare/404.html "$saida/"

if [ -n "$globo" ]; then
  [ -f "$globo/manifest.json" ] || { echo "Dados do globo sem manifest.json em $globo" >&2; exit 1; }
  mkdir -p "$saida/globo-dados"
  cp -R "$globo"/. "$saida/globo-dados/"
  rm -rf "$saida/globo-dados/.git"
fi

# Confere se nenhum arquivo do app ficou para trás: todo arquivo guardado pelo service worker precisa existir.
node -e '
  const fs = require("fs"), path = require("path");
  const sw = fs.readFileSync(path.join(process.argv[1], "sw.js"), "utf8");
  const lista = [...sw.matchAll(/'"'"'\.\/([^'"'"']*)'"'"'/g)].map((m) => m[1]).filter(Boolean);
  const faltam = lista.filter((f) => !fs.existsSync(path.join(process.argv[1], f)));
  if (faltam.length) { console.error("Faltam no site:", faltam.join(", ")); process.exit(1); }
' "$saida"

echo "Site montado em $saida: $(find "$saida" -type f | wc -l) arquivos, $(du -sh "$saida" | cut -f1)."
