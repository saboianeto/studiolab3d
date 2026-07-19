/* Medição própria — sem cookie, sem identificar ninguém.
   Só conta: qual página foi vista e em que a pessoa clicou.       */
(function () {
  "use strict";

  var ENVIADO = {};   // evita contar o mesmo clique duas vezes por engano

  function origem() {
    try {
      var p = new URLSearchParams(location.search);
      var utm = p.get("utm_source");
      if (utm) return utm.toLowerCase().slice(0, 40);
      var r = document.referrer;
      if (!r) return "direto";
      var h = new URL(r).hostname.replace(/^www\./, "");
      if (h === location.hostname) return "";              // navegação interna não é origem nova
      if (/instagram/.test(h))  return "instagram";
      if (/tiktok/.test(h))     return "tiktok";
      if (/google/.test(h))     return "google";
      if (/facebook|fb\.com/.test(h)) return "facebook";
      if (/whatsapp|wa\.me/.test(h))  return "whatsapp";
      if (/bing|duckduckgo|yahoo/.test(h)) return "outra busca";
      return h.slice(0, 40);
    } catch (e) { return "direto"; }
  }

  function envia(tipo, alvo, org) {
    var corpo = JSON.stringify({ tipo: tipo, alvo: alvo, origem: org || "direto" });
    try {
      if (navigator.sendBeacon) {
        // sendBeacon sobrevive à navegação — é o que garante contar o clique
        // que leva a pessoa embora do site
        navigator.sendBeacon("/api/evento", new Blob([corpo], { type: "application/json" }));
        return;
      }
    } catch (e) {}
    fetch("/api/evento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: corpo, keepalive: true
    }).catch(function () {});
  }

  // --- página vista ---
  var org = origem();
  if (org !== "") {
    var pag = location.pathname.replace(/\/$/, "") || "/";
    if (pag === "/") pag = "/index.html";
    envia("pagina", pag, org);
  }

  // --- cliques ---
  document.addEventListener("click", function (ev) {
    var alvo = ev.target.closest("a, .cat-add, [data-medir]");
    if (!alvo) return;

    // botão + do catálogo
    if (alvo.classList && alvo.classList.contains("cat-add")) {
      var cod = (alvo.getAttribute("aria-label") || "").match(/OOMM-\d+/);
      envia("peca", cod ? cod[0] : "peça");
      envia("whatsapp", "botão + do catálogo");
      return;
    }

    var href = alvo.getAttribute && alvo.getAttribute("href");
    if (!href) return;

    var chave = href + "|" + Date.now().toString().slice(0, -3);
    if (ENVIADO[chave]) return;
    ENVIADO[chave] = 1;

    if (/wa\.me|whatsapp/i.test(href)) {
      envia("whatsapp", rotulo(alvo));
    } else if (/shp\.ee|shopee/i.test(href)) {
      envia("loja", "Shopee");
    } else if (/meli\.la|mercadolivre/i.test(href)) {
      envia("loja", "Mercado Livre");
    } else if (/instagram\.com/i.test(href)) {
      envia("link", "Instagram");
    } else if (/tiktok\.com/i.test(href)) {
      envia("link", "TikTok");
    } else if (/^mailto:/i.test(href)) {
      envia("link", "E-mail");
    } else if (/^https?:/i.test(href) && href.indexOf(location.hostname) === -1) {
      envia("link", rotulo(alvo));
    }
  }, true);

  function rotulo(el) {
    var t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!t) t = el.getAttribute("aria-label") || "link";
    return t.slice(0, 60);
  }
})();
