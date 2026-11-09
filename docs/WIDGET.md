# Widget do iPhone

O widget mostra na tela de início do iPhone a temperatura de agora, a chuva de hoje, o risco de temporal e a rajada. Os números são os mesmos do painel, porque quem calcula é o próprio painel.

O iPhone não deixa um app web criar widget. Por isso o widget roda no **Scriptable**, um app gratuito da App Store que executa pequenos programas em JavaScript.

## Instalar

O jeito mais fácil é abrir no iPhone a página **Widget do iPhone**, no rodapé do painel (endereço do painel + `widget/`). Ela tem o botão que copia o código. Os passos são estes:

1. Instale o **Scriptable** na App Store.
2. Na página do widget, toque em **Copiar código do widget**.
3. Abra o Scriptable, toque em **+**, cole o código e dê o nome **Painel do tempo**. Toque em **Concluído**.
4. Na tela de início, toque e segure num espaço vazio. Toque em **Editar** e depois em **Adicionar Widget**. Escolha **Scriptable** e o tamanho médio ou pequeno.
5. Toque e segure o widget e escolha **Editar Widget**. Em **Script**, escolha **Painel do tempo**.
6. Na primeira vez, permita que o Scriptable use a sua localização.

Opcional: no campo **Parameter** do widget, escreva uma coordenada fixa no formato `-29.68, -51.05`. Assim o widget mostra sempre esse ponto, sem GPS.

Também funciona na tela bloqueada (tamanhos retangular, circular e em linha), com menos informação.

## O que aparece

| Parte | De onde vem |
|---|---|
| Temperatura e "agora" ou "agora (prevista)" | Mesma regra do topo do painel: estação a até 25 km com leitura de até 2 h; sem ela, o ECMWF |
| Sensação térmica (tamanho médio) | Mesma do resumo de Hoje |
| Mínima e máxima | Mesmas da tela Hoje (ECMWF corrigido) |
| Chuva (frase, chance e detalhe) | Mesma frase e chance da tela Hoje, inclusive "Chovendo agora" e "Chuva chegando" |
| Risco de temporal | Mesmo cartão da tela Hoje. Sem risco moderado ou alto, aparece a linha de avisos do INMET |
| Rajada | Mesmo pico do dia da tela Hoje |
| Notas no rodapé | "Fonte · Horário", como no painel |

Tocar no widget abre o painel.

## Limites

- Quem decide quando atualizar é o iPhone. O widget pede a cada 15 minutos, mas na prática costuma ser entre 15 e 30 minutos, às vezes mais.
- Sem conexão, o widget mostra o último resumo guardado e troca a nota do rodapé por "Sem atualização · dados de HH:MM", em vermelho.
- O widget não é fonte oficial. Em situação de risco, siga a Defesa Civil (199) e o INMET.

## Quando o endereço do painel mudar

O script aponta para `https://tempo-rs.pages.dev/`. Se o endereço mudar, troque só a linha `appUrl` no começo do script, dentro do Scriptable. Nada mais precisa mudar.
