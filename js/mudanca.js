// Mudança de endereço: do GitHub Pages (sidegum.github.io/painel-meteo) para o endereço oficial (CONFIG.enderecoOficial).
//
// No endereço antigo:
// - No navegador, vai direto para o novo endereço.
// - No app instalado na tela inicial, mostra um aviso com o botão para abrir o novo endereço e instalar de novo. Ir
//   direto abriria o site numa janela do navegador dentro do app, o que confunde.
// - As preferências deste aparelho (local escolhido, tema, camadas, avisos vistos) vão junto no fragmento da URL
//   (#migrar=...), que não é enviado ao servidor.
// No endereço novo, lê o fragmento, grava só as preferências conhecidas, com tamanho limitado, e limpa a URL.
// Este script roda antes do js/app.js, então o app já abre com as preferências.
import { CONFIG } from './config.js';

const PREFS = ['local', 'tema', 'avisosVistos', 'mapaCamada', 'radarPausado', 'horasTodas', 'globoCamada'];
const MARCA = '#migrar=';
const MAX_BYTES = 8000;

const antigo = /(^|\.)github\.io$/.test(location.hostname);
if (antigo && CONFIG.enderecoOficial) mudar();
else if (location.hash.startsWith(MARCA)) receber();

function mudar() {
  const destino = new URL(CONFIG.enderecoOficial);
  if (destino.origin === location.origin) return;
  const prefs = {};
  for (const k of PREFS) {
    try { const v = localStorage.getItem('pref:' + k); if (v !== null) prefs[k] = v; } catch {}
  }
  const pacote = encodeURIComponent(JSON.stringify(prefs));
  destino.hash = pacote.length <= MAX_BYTES && Object.keys(prefs).length ? MARCA.slice(1) + pacote : location.hash.slice(1);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!instalado) { location.replace(destino.href); return; }
  aviso(destino.href);
}

function aviso(href) {
  const caixa = document.createElement('div');
  caixa.className = 'mudanca';
  caixa.setAttribute('role', 'alertdialog');
  caixa.setAttribute('aria-labelledby', 'mudanca-t');
  const t = document.createElement('h2'); t.id = 'mudanca-t'; t.textContent = 'O painel mudou de endereço';
  const p1 = document.createElement('p');
  p1.textContent = `O novo endereço é ${new URL(href).host}. Este ícone vai parar de funcionar em alguns dias.`;
  const p2 = document.createElement('p');
  p2.textContent = 'Copie o endereço, abra o Safari, cole e toque em Compartilhar e em "Adicionar à Tela de Início". Depois, apague este ícone.';
  const copiar = document.createElement('button');
  copiar.type = 'button'; copiar.className = 'mudanca-abrir'; copiar.textContent = 'Copiar o endereço';
  copiar.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(CONFIG.enderecoOficial); copiar.textContent = 'Endereço copiado'; }
    catch { copiar.textContent = CONFIG.enderecoOficial; }
  });
  const abrir = document.createElement('a');
  abrir.className = 'mudanca-abrir'; abrir.href = href; abrir.target = '_blank'; abrir.rel = 'noopener';
  abrir.textContent = 'Abrir o novo endereço';
  const depois = document.createElement('button');
  depois.type = 'button'; depois.className = 'mudanca-depois'; depois.textContent = 'Agora não';
  depois.addEventListener('click', () => caixa.remove());
  caixa.append(t, p1, p2, copiar, abrir, depois);
  document.body.append(caixa);
}

function receber() {
  let prefs;
  try {
    const bruto = location.hash.slice(MARCA.length);
    if (bruto.length > MAX_BYTES) throw new Error('grande demais');
    prefs = JSON.parse(decodeURIComponent(bruto));
  } catch { prefs = null; }
  if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
    for (const k of PREFS) {
      const v = prefs[k];
      if (typeof v !== 'string') continue;
      try { JSON.parse(v); localStorage.setItem('pref:' + k, v); } catch {}
    }
  }
  history.replaceState(null, '', location.pathname + location.search);
}
