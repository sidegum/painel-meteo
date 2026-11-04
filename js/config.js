// Configuração pública do app. Não coloque segredos aqui: este arquivo é publicado.
// Para preencher o endereço do Worker, rode: node scripts/configurar.mjs https://SEU-WORKER.workers.dev
export const CONFIG = {
  workerUrl: 'https://painel-meteo.painel-566f64cc.workers.dev',
  // Centro de Campo Bom, RS (praça central, coordenada pública da cidade)
  padrao: { nome: 'Campo Bom', regiao: 'RS, BR', lat: -29.68, lon: -51.05 },
  intervalos: {            // minutos
    medicoes: 10, alertas: 10, radar: 10, previsao: 15, cenarios: 15, enso: 360, acerto: 1440,
  },
  idadeMaxMedicaoMin: 180, // leituras mais antigas são descartadas
  radarOficial: 'https://defesacivil.rs.gov.br/monitoramento-radar-meteorologico',
};
