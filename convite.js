/* Convite para o grupo do WhatsApp, depois de dois minutos de navegação.
   O tempo é somado entre páginas — quem lê 4 páginas de 30s também vê.
   Quem fecha não vê de novo por 7 dias.                                   */
(function () {
  "use strict";
  var ESPERA = 120000;                 // 2 minutos
  // Link padrão da comunidade. Dá para trocar no painel, em Textos do site.
  // Campo apagado (vazio) desliga o convite; campo nunca preenchido usa este.
  var PADRAO = "https://chat.whatsapp.com/Ln4poGVtnyM3Ok3ftarS9h";
  var K_TEMPO = "oomm_tempo";
  var K_VISTO = "oomm_convite_visto";

  function agora() { return Date.now(); }

  function jaViu() {
    try {
      var v = Number(localStorage.getItem(K_VISTO) || 0);
      return v && (agora() - v) < 7 * 86400000;
    } catch (e) { return false; }
  }

  function somar() {
    try {
      var t = Number(localStorage.getItem(K_TEMPO) || 0);
      localStorage.setItem(K_TEMPO, String(t + 1000));
      return t + 1000;
    } catch (e) { return 0; }
  }

  function marcarVisto() {
    try { localStorage.setItem(K_VISTO, String(agora())); } catch (e) {}
  }

  function mostrar(link) {
    if (document.getElementById("conviteZap")) return;
    var el = document.createElement("div");
    el.className = "convite";
    el.id = "conviteZap";
    el.innerHTML =
      '<button class="fechar" aria-label="Fechar">×</button>' +
      '<h4>Entra no nosso grupo?</h4>' +
      '<p>Lançamentos, promoções e as peças novas saindo da impressora — em primeira mão.</p>' +
      '<a class="btn btn-primary" href="' + link + '" target="_blank" rel="noopener">Entrar no grupo</a>' +
      '<button class="depois">Agora não</button>';
    el.querySelector(".fechar").onclick = function () { marcarVisto(); el.remove(); };
    el.querySelector(".depois").onclick = function () { marcarVisto(); el.remove(); };
    el.querySelector("a").onclick = function () {
      marcarVisto();
      try {
        var corpo = JSON.stringify({ tipo: "link", alvo: "Grupo do WhatsApp", origem: "convite" });
        if (navigator.sendBeacon)
          navigator.sendBeacon("/api/evento", new Blob([corpo], { type: "application/json" }));
      } catch (e) {}
    };
    document.body.appendChild(el);
  }

  if (jaViu()) return;

  fetch("/api/catalogo", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var cfg = (d && d.config) || {};
      var link = (cfg.grupoZap === undefined) ? PADRAO : cfg.grupoZap;
      if (!link) return;                       // campo apagado de propósito: não incomoda ninguém
      var contador = setInterval(function () {
        if (somar() >= ESPERA) { clearInterval(contador); mostrar(link); }
      }, 1000);
    })
    .catch(function () {
      // servidor fora do ar: ainda assim vale convidar
      var contador = setInterval(function () {
        if (somar() >= ESPERA) { clearInterval(contador); mostrar(PADRAO); }
      }, 1000);
    });
})();
