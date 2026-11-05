// Configuração pública do app. Não coloque segredos aqui: este arquivo é publicado.
// Para preencher o endereço do Worker, rode: node scripts/configurar.mjs https://SEU-WORKER.workers.dev
export const CONFIG = {
  // Endereço oficial do app (subdomínio no Cloudflare Pages). Quem abre pelo endereço antigo do GitHub Pages é levado
  // para cá (js/mudanca.js). Vazio = sem redirecionamento.
  enderecoOficial: 'https://tempo-rs.pages.dev/',
  workerUrl: 'https://painel-meteo.painel-566f64cc.workers.dev',
  // Centro de Campo Bom, RS (praça central, coordenada pública da cidade)
  padrao: { nome: 'Campo Bom', regiao: 'RS, BR', lat: -29.68, lon: -51.05 },
  intervalos: {            // minutos
    medicoes: 10, alertas: 10, radar: 10, previsao: 15, cenarios: 15, enso: 360, acerto: 1440,
  },
  atualizarTelaAbertaMin: 10, // com a tela aberta e sem toque em atualizar, atualiza tudo a cada 10 min
  idadeMaxMedicaoMin: 180, // leituras mais antigas são descartadas
  // Campos globais da aba Globo, gerados pelo GitHub Actions (.github/workflows/globo.yml) no branch globo-dados.
  // No Cloudflare Pages eles são copiados para a pasta globo-dados/ do próprio site a cada publicação (funciona com o
  // repositório privado); no GitHub Pages e no computador local vêm direto do branch.
  globoDados: globoDadosBase(),
  radarOficial: 'https://defesacivil.rs.gov.br/monitoramento-radar-meteorologico',
};

function globoDadosBase() {
  const loc = globalThis.location;
  const doBranch = 'https://raw.githubusercontent.com/sidegum/painel-meteo/globo-dados/';
  if (!loc || /(^|\.)github\.io$|^localhost$|^127\.0\.0\.1$/.test(loc.hostname)) return doBranch;
  return new URL('globo-dados/', loc.href).href;
}
