# Texturas da Terra

Imagens da NASA, domínio público (NASA Visible Earth e NASA Earth Observatory), obtidas pelas cópias públicas do projeto
three-globe (github.com/vasturiano/three-globe) em 2026-11-05 e reprocessadas aqui (recompressão e mapa de normais):

| Arquivo | Origem | Processamento |
|---|---|---|
| terra-dia-4096.jpg, terra-dia-1024.jpg | NASA Blue Marble: Next Generation (cor da superfície) | recompressão JPEG q82 / redução para 1024 px |
| terra-noite-2048.jpg | NASA Black Marble 2016 (luzes noturnas) | redução para 2048 px |
| terra-noite-4096.jpg | NASA Black Marble 2016 (luzes noturnas) | recompressão JPEG q84 (carregada depois da de 2048) |
| terra-normal-2048.jpg | NASA/USGS topografia e batimetria (mapa de altura) | convertido em mapa de normais (derivadas do relevo) |
| terra-mascaras-2048.png | máscara de água (R) e altura (G) | R: máscara de oceanos; G: relevo |

Atribuição mostrada no app: "Texturas: NASA Visible Earth".

# Mapas das luas e de Plutão (`corpos/`)

Mapas cilíndricos das missões Voyager, Galileo, Cassini e New Horizons (NASA, JPL, USGS, SSI, LPI, JHUAPL, SwRI),
de domínio público ou licença livre, obtidos do Wikimedia Commons pelo workflow `mapas-corpos.yml` e reduzidos para
2048 e 1024 px. O arquivo de origem, o autor e a licença de cada um estão em `corpos/mapas.json`.

