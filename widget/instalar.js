// Página de instalação do widget: copia o código de painel-widget.js para colar no app Scriptable.
// No Safari, a cópia precisa começar no mesmo toque do botão: por isso o texto entra como Promise num
// ClipboardItem (o download termina depois, mas a permissão do toque continua valendo).
const botao = document.getElementById('btn-copiar');
const estado = document.getElementById('copiar-estado');

/** Baixa o código do widget como Blob de texto. */
async function codigoDoWidget() {
  const resposta = await fetch('painel-widget.js', { cache: 'no-cache' });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return new Blob([await resposta.text()], { type: 'text/plain' });
}

botao.addEventListener('click', async () => {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': codigoDoWidget() })]);
    } else {
      await navigator.clipboard.writeText(await (await codigoDoWidget()).text());
    }
    estado.textContent = 'Código copiado. Agora abra o Scriptable e cole num script novo.';
  } catch {
    estado.textContent = 'Não deu para copiar. Use o link do código logo abaixo.';
  }
});
