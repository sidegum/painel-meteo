# Segurança e privacidade: checklist e riscos residuais

Nenhum sistema tem risco zero. Este documento lista o que foi feito, como foi verificado e o que continua possível.

## Checklist

| Item | Situação | Como foi verificado |
|---|---|---|
| Sem login, perfil, cookies, analytics, anúncios ou rastreadores | feito | revisão do código; nenhum script de terceiros |
| Localização exata só no aparelho | feito | GPS fica em memória; o salvo é arredondado (`js/app.js`, `definirLocal`) |
| APIs e Worker recebem só 2 casas decimais | feito | teste de tela registrou todas as URLs: só `-29.68,-51.05`; teste do Worker confirma que nenhuma chamada externa leva a coordenada exata |
| Worker não grava localização nem IP | feito | KV guarda só listas de estações, séries de estações públicas, El Niño e acerto; limite de uso usa hash com sal diário em memória; `observability` desligado |
| "Apagar dados deste aparelho" | feito | teste: limpa localStorage, sessionStorage, caches e service worker |
| Página de privacidade | feito | `privacidade.html` |
| `INMET_TOKEN` só como segredo do Worker | feito | teste: token não aparece na resposta, nem quando a fonte devolve erro contendo o token; chave de cache não usa a URL com token |
| `.gitignore` para arquivos de ambiente | feito | `.env`, `.dev.vars`, `.wrangler/` |
| Worker só com rotas fixas e lista fechada de destinos | feito | testes: `?url=`, `/https://...`, `../`, hosts parecidos (`aviationweather.gov.evil.example`) e `http://` são recusados |
| Parâmetros validados e limitados | feito | testes: coordenadas inválidas, fora do Brasil, repetidas, notação 1e3, consulta longa (414) |
| Só GET e OPTIONS | feito | teste: POST, PUT, DELETE, PATCH -> 405 |
| CORS restrito ao domínio do app | feito | teste: origem estranha não recebe `access-control-allow-origin`. Lembrete: `Origin` não autentica |
| Limite por cliente | feito | teste: 31ª requisição no minuto -> 429; outro cliente segue normal |
| Tempo limite, tamanho máximo e cache nas chamadas externas | feito | `buscarExterno`: 8 a 15 s, 0,2 a 6 MB, cache de 10 min a 24 h; redirecionamentos recusados |
| Respostas enxutas | feito | avisos do INMET: 468 KB na fonte, 31 KB no Worker |
| XML/HTML externo como dado não confiável | feito | testes: DOCTYPE/ENTITY recusados, `<script>` removido, link `javascript:` descartado |
| Sem `innerHTML` com dado externo, sem `eval` | feito | busca no código: nenhum `innerHTML`, `eval`, `new Function` ou `document.write` |
| CSP restritiva por `<meta>` | feito | `default-src 'none'`, scripts e estilos só do próprio site; testes de tela sem nenhuma violação de CSP no console |
| Links externos com `noopener noreferrer` | feito | `linkExterno` e rodapé |
| Bibliotecas e fontes no projeto, versões fixas | feito | `docs/VENDOR.md` com SHA-256 |
| Auditoria de dependências | feito | `npm audit`: 0 vulnerabilidades (wrangler 4.155.0); também roda no CI |
| Service worker só com arquivos do app | feito | `sw.js` só intercepta GET do mesmo domínio; dados públicos ficam num cache separado gravado pelo app |
| Respeito aos provedores | feito | cache, espera crescente após 429/5xx (2 a 60 min), radar carregado aos poucos (limite RainViewer de 100/min), atribuições no rodapé |
| 2FA no GitHub e na Cloudflare, secret scanning, Dependabot | depende do Gustavo | instruções no README |

## Riscos residuais

1. Todos os serviços chamados veem o IP de quem usa o app, como em qualquer site.
2. Os quadrados do mapa (OpenStreetMap e RainViewer) revelam a região exibida, com precisão de alguns quilômetros.
3. `Origin` pode ser forjado fora do navegador. Qualquer pessoa pode chamar o Worker; o limite por cliente e o plano gratuito contêm o abuso, mas não o impedem. A regra de rate limiting da Cloudflare (opcional, no README) ajuda.
4. O limite por cliente fica na memória de cada instância do Worker; com muitas instâncias, um abusador pode passar um pouco do limite.
5. Se o token do INMET vazar por outra via, ele precisa ser trocado no INMET; o Worker não consegue detectar isso.
6. Extração de HTML (discussão da NOAA, probabilidades do CPC, resumo do IRI) depende da estrutura dessas páginas. A validação recusa formatos inesperados e o Worker mantém a última versão válida com aviso, mas uma mudança sutil que ainda passe na validação pode gerar texto errado.
7. O plano gratuito da Cloudflare tem limites diários (100 mil requisições e 1.000 gravações no KV). O uso previsto fica bem abaixo (cerca de 80 gravações por dia).
8. A Open-Meteo limita 10 mil chamadas por dia por IP. Com o app aberto o dia todo, o uso estimado fica entre 3 e 4 mil; vários aparelhos na mesma rede somam.
9. Avisos e medições podem atrasar ou falhar sem que o painel saiba. Por isso o painel mostra idade dos dados, "Alertas indisponíveis" e o lembrete dos canais oficiais.
