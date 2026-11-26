// Tema do app (claro ou escuro), aplicado antes da primeira pintura para a tela não piscar na cor errada.
// Script clássico e sem dependências, carregado no <head> antes do app.css terminar de valer: grava em
// <html data-tema="claro|escuro"> o tema em uso. A preferência ("auto", "claro" ou "escuro") fica em
// localStorage, na chave "pref:tema" (a mesma de prefs, em js/ui.js); "auto" segue o tema do aparelho.
// As cores de cada tema ficam todas no começo do app.css.
(function () {
  'use strict';
  var CHAVE = 'pref:tema';
  var claroNoAparelho = window.matchMedia('(prefers-color-scheme: light)');

  /** Preferência salva: "auto" (padrão), "claro" ou "escuro". */
  function preferencia() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE));
      return v === 'claro' || v === 'escuro' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  /** Tema em uso para uma preferência: "auto" vira o tema do aparelho. */
  function emUso(pref) {
    return pref === 'auto' ? (claroNoAparelho.matches ? 'claro' : 'escuro') : pref;
  }

  /** Grava o tema em uso no <html> e devolve o nome dele. */
  function aplicar() {
    var tema = emUso(preferencia());
    document.documentElement.setAttribute('data-tema', tema);
    return tema;
  }

  aplicar();
  window.temaDoApp = { preferencia: preferencia, aplicar: aplicar, aoMudarNoAparelho: function (f) { claroNoAparelho.addEventListener('change', f); } };
})();
