/* Favoritos guardados no próprio navegador da pessoa.
   Nada vai para o servidor — some se ela limpar os dados do navegador,
   e não acompanha ninguém de um aparelho para outro.                    */
window.Favoritos = (function () {
  "use strict";
  var CHAVE = "oomm_favoritos";

  function ler() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE) || "[]");
      return Array.isArray(v) ? v.map(Number).filter(function (n) { return n > 0; }) : [];
    } catch (e) { return []; }
  }

  function gravar(l) {
    try { localStorage.setItem(CHAVE, JSON.stringify(l.slice(0, 200))); } catch (e) {}
    window.dispatchEvent(new CustomEvent("favoritos:mudou", { detail: l }));
  }

  return {
    lista: ler,
    tem: function (id) { return ler().indexOf(Number(id)) !== -1; },
    quantos: function () { return ler().length; },
    alternar: function (id) {
      id = Number(id);
      var l = ler(), i = l.indexOf(id);
      if (i === -1) l.unshift(id); else l.splice(i, 1);
      gravar(l);
      return i === -1;
    },
    limpar: function () { gravar([]); }
  };
})();
