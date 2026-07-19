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

  // Avisa o servidor que a peça ganhou (ou perdeu) um coração. Vai só o número
  // da peça — nada que identifique quem clicou.
  function avisar(id, tirou) {
    var corpo = JSON.stringify({ peca: String(id), tirou: !!tirou });
    try {
      if (navigator.sendBeacon)
        return navigator.sendBeacon("/api/favorito", new Blob([corpo], { type: "application/json" }));
    } catch (e) {}
    fetch("/api/favorito", { method: "POST", headers: { "Content-Type": "application/json" },
      body: corpo, keepalive: true }).catch(function () {});
  }

  // Marca fraca do navegador, usada só para evitar que a mesma pessoa vote
  // várias vezes na mesma peça. Não identifica ninguém.
  function marca() {
    try {
      var m = localStorage.getItem("oomm_marca");
      if (!m) {
        m = Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem("oomm_marca", m);
      }
      return m;
    } catch (e) { return "sem-marca"; }
  }

  function notaDada(id) {
    try { return Number(JSON.parse(localStorage.getItem("oomm_notas") || "{}")[id]) || 0; }
    catch (e) { return 0; }
  }

  function guardarNota(id, n) {
    try {
      var o = JSON.parse(localStorage.getItem("oomm_notas") || "{}");
      o[id] = n;
      localStorage.setItem("oomm_notas", JSON.stringify(o));
    } catch (e) {}
  }

  return {
    marca: marca,
    notaDada: notaDada,
    guardarNota: guardarNota,
    lista: ler,
    tem: function (id) { return ler().indexOf(Number(id)) !== -1; },
    quantos: function () { return ler().length; },
    alternar: function (id) {
      id = Number(id);
      var l = ler(), i = l.indexOf(id);
      if (i === -1) l.unshift(id); else l.splice(i, 1);
      gravar(l);
      avisar(id, i !== -1);
      return i === -1;
    },
    limpar: function () { gravar([]); }
  };
})();
