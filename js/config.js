// Configuração pública do app. Não coloque segredos aqui: este arquivo é publicado.
// Para preencher o endereço do Worker, rode: node scripts/configurar.mjs https://SEU-WORKER.workers.dev
export const CONFIG = {
  workerUrl: 'https://painel-meteo.painel-566f64cc.workers.dev',
  // Centro de Campo Bom, RS (praça central, coordenada pública da cidade)
  padrao: { nome: 'Campo Bom', regiao: 'RS, BR', lat: -29.68, lon: -51.05 },
  intervalos: {            // minutos
    medicoes: 10, alertas: 10, radar: 10, previsao: 15, cenarios: 15, enso: 360, acerto: 1440,
  },
  atualizarTelaAbertaMin: 10, // com a tela aberta e sem toque em atualizar, atualiza tudo a cada 10 min
  idadeMaxMedicaoMin: 180, // leituras mais antigas são descartadas
  // Campos globais da aba Globo, gerados pelo GitHub Actions (.github/workflows/globo.yml) e publicados na pasta
  // globo-dados/ do próprio site a cada publicação no Cloudflare Pages (scripts/publicar-pages.sh).
  globoDados: 'globo-dados/',
  radarOficial: 'https://defesacivil.rs.gov.br/monitoramento-radar-meteorologico',
};
