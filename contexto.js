/* Faz todo botão de WhatsApp chegar já sabendo do que a pessoa está falando.
   Sem isto, chega "oi" e alguém precisa perguntar de volta o que a pessoa viu. */
(function () {
  "use strict";
  var ZAP = /wa\.me|api\.whatsapp\.com/i;

  var NOME_PAGINA = {
    "index.html":       "",
    "catalogo.html":    "o catálogo",
    "corporativo.html": "a página de brindes corporativos",
    "educacional.html": "a página de kits para eventos",
    "casa.html":        "a página de artigos religiosos",
    "festas.html":      "a página de festas e celebrações",
    "conecte.html":     "a página de contato"
  };

  function pagina() {
    var p = location.pathname.split("/").pop();
    return NOME_PAGINA[p !== undefined && p !== "" ? p : "index.html"] || "";
  }

  // Título do card/seção mais próximo do botão clicado
  function assunto(a) {
    var card = a.closest("article.prod, .line-card, .cta-band, .prod");
    if (card) {
      var h = card.querySelector("h3, h4");
      if (h && h.textContent.trim()) return limpar(h.textContent);
    }
    var sec = a.closest("section");
    if (sec) {
      var h2 = sec.querySelector(".section-head h2");
      if (h2 && h2.textContent.trim()) return limpar(h2.textContent);
    }
    return "";
  }

  // tira aspas do título para não aninhar aspas dentro de aspas na mensagem
  function limpar(t) {
    return t.replace(/[“”"„»«]/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
  }

  function origem() {
    try {
      var utm = new URLSearchParams(location.search).get("utm_source");
      if (utm) return utm;
      var r = document.referrer;
      if (!r) return "";
      var h = new URL(r).hostname;
      if (/instagram/.test(h)) return "Instagram";
      if (/tiktok/.test(h))    return "TikTok";
      return "";
    } catch (e) { return ""; }
  }

  function frase(a) {
    var item = assunto(a), pag = pagina(), org = origem();

    var t;
    if (item) t = "Olá! Me interessei por “" + item + "” que vi no site.";
    else if (pag) t = "Olá! Vim " + (pag.indexOf("o ") === 0 ? "d" + pag : "d" + pag) + " do site e queria um orçamento.";
    else t = "Olá! Vim pelo site e queria um orçamento.";

    if (org) t += " (cheguei pelo " + org + ")";
    return t;
  }

  function ajustar(a) {
    var href = a.getAttribute("href") || "";
    if (!ZAP.test(href)) return;
    if (/[?&]text=/.test(href)) return;          // já tem mensagem própria — não mexe
    a.setAttribute("href", href + (href.indexOf("?") === -1 ? "?" : "&") +
                   "text=" + encodeURIComponent(frase(a)));
  }

  function aplicar() {
    var links = document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    for (var i = 0; i < links.length; i++) ajustar(links[i]);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", aplicar);
  else aplicar();

  // conteúdo que aparece depois (cards novos, catálogo montado por script)
  window.addEventListener("load", aplicar);
})();
