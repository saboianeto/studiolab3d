/**
 * OOMM Studio — Worker
 *
 * Serve o site estático e expõe a API da área administrativa.
 *
 *   GET  /api/catalogo          → lista de peças (pública; o catálogo lê daqui)
 *   PUT  /api/admin/catalogo    → grava a lista        (protegido pelo Access)
 *   POST /api/admin/foto?nome=  → grava uma foto no R2 (protegido pelo Access)
 *   PUT  /api/admin/slots       → trocas de foto das páginas (protegido)
 *   GET  /fotos/...             → serve as fotos guardadas no R2
 *
 * Bindings necessários (painel da Cloudflare):
 *   ASSETS  → arquivos estáticos (automático)
 *   FOTOS   → bucket R2
 *   DADOS   → namespace KV
 */

const CACHE_FOTO = "public, max-age=31536000, immutable";
const CACHE_API  = "public, max-age=30";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === "/api/catalogo")        return await catalogoPublico(request, env);
      if (p.startsWith("/api/admin/"))  return await rotaAdmin(request, env, url);
      if (p.startsWith("/fotos/"))      return await servirFoto(request, env, url, ctx);
    } catch (erro) {
      return json({ erro: String(erro && erro.message || erro) }, 500);
    }

    // Tudo o mais é arquivo do site. Páginas HTML passam pelo reescritor, que
    // aplica o que foi editado no painel: fotos trocadas, textos, cards novos
    // e cards escondidos.
    const resposta = await env.ASSETS.fetch(request);
    const tipo = resposta.headers.get("Content-Type") || "";
    if (!tipo.includes("text/html")) return resposta;

    const edicoes = await lerJSON(env, "paginas", null);
    if (!edicoes) return resposta;

    const pagina = nomeDaPagina(p);
    const fotos     = filtrarPorPagina(edicoes.fotos,  pagina);   // {n: url}
    const textos    = edicoes.textos  && edicoes.textos[pagina]  || null;  // {sel: {n: txt}}
    const ocultos   = new Set((edicoes.ocultos && edicoes.ocultos[pagina]) || []);
    const novos     = (edicoes.novos && edicoes.novos[pagina]) || [];

    if (!Object.keys(fotos).length && !textos && !ocultos.size && !novos.length)
      return resposta;

    let rw = new HTMLRewriter();

    // fotos trocadas: n-ésima <img> dentro de <main>
    if (Object.keys(fotos).length) {
      let i = -1;
      rw = rw.on("main img", { element(el) { i++; if (fotos[i]) el.setAttribute("src", fotos[i]); } });
    }

    // textos: para cada seletor, a n-ésima ocorrência
    if (textos) {
      for (const sel of Object.keys(textos)) {
        const mapa = textos[sel];
        let i = -1;
        rw = rw.on(sel, {
          element(el) {
            i++;
            const t = mapa[i];
            if (typeof t === "string" && t.length) el.setInnerContent(t, { html: false });
          }
        });
      }
    }

    // cards escondidos: n-ésimo <article class="prod">
    if (ocultos.size) {
      let i = -1;
      rw = rw.on("main article.prod", { element(el) { i++; if (ocultos.has(i)) el.remove(); } });
    }

    // cards novos: acrescentados ao fim da primeira grade de produtos
    if (novos.length) {
      let feito = false;
      const html = novos.map(cardHTML).join("");
      rw = rw.on("main .prod-grid", {
        element(el) { if (!feito) { feito = true; el.append(html, { html: true }); } }
      });
    }

    return rw.transform(resposta);
  }
};

/* ---------------------------------------------------------------- catálogo */

async function catalogoPublico(request, env) {
  if (request.method !== "GET") return json({ erro: "Método não permitido." }, 405);
  const dados = await lerJSON(env, "catalogo", null);
  // null = ainda não há nada no KV; o site cai no produtos.js que veio no repositório
  return json(dados, 200, { "Cache-Control": CACHE_API });
}

/* ------------------------------------------------------------------ admin */

async function rotaAdmin(request, env, url) {
  // O Cloudflare Access injeta este cabeçalho depois de autenticar. Se ele não
  // existe, a requisição não passou pelo Access — recusamos. Falha fechada:
  // na dúvida, ninguém entra.
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    return json({
      erro: "Esta rota não está protegida pelo Cloudflare Access. " +
            "Adicione o caminho 'api/admin' como destino da aplicação em " +
            "Access controls → Applications antes de usar o painel."
    }, 401);
  }

  const p = url.pathname;

  if (p === "/api/admin/catalogo" && request.method === "PUT") {
    const corpo = await request.json();
    if (!corpo || !Array.isArray(corpo.produtos))
      return json({ erro: "Formato inválido." }, 400);
    await env.DADOS.put("catalogo", JSON.stringify(corpo));
    return json({ ok: true, pecas: corpo.produtos.length });
  }

  if (p === "/api/admin/paginas" && request.method === "GET") {
    return json(await lerJSON(env, "paginas", { fotos:{}, textos:{}, ocultos:{}, novos:{} }));
  }

  if (p === "/api/admin/paginas" && request.method === "PUT") {
    const corpo = await request.json();
    if (!corpo || typeof corpo !== "object") return json({ erro: "Formato inválido." }, 400);
    await env.DADOS.put("paginas", JSON.stringify({
      fotos:   corpo.fotos   || {},
      textos:  corpo.textos  || {},
      ocultos: corpo.ocultos || {},
      novos:   corpo.novos   || {}
    }));
    return json({ ok: true });
  }

  if (p === "/api/admin/foto" && request.method === "POST") {
    const nome = url.searchParams.get("nome");
    if (!nome || !/^[\w./-]{1,80}$/.test(nome) || nome.includes(".."))
      return json({ erro: "Nome de arquivo inválido." }, 400);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength)          return json({ erro: "Arquivo vazio." }, 400);
    if (bytes.byteLength > 6e6)     return json({ erro: "Arquivo acima de 6 MB." }, 413);
    await env.FOTOS.put(nome, bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: CACHE_FOTO }
    });
    return json({ ok: true, url: "/fotos/" + nome });
  }

  if (p === "/api/admin/foto" && request.method === "DELETE") {
    const nome = url.searchParams.get("nome");
    if (nome) await env.FOTOS.delete(nome);
    return json({ ok: true });
  }

  return json({ erro: "Rota não encontrada." }, 404);
}

/* ------------------------------------------------------------------ fotos */

async function servirFoto(request, env, url, ctx) {
  if (request.method !== "GET") return new Response("Método não permitido", { status: 405 });

  const cache = caches.default;
  const naCache = await cache.match(request);
  if (naCache) return naCache;

  const nome = decodeURIComponent(url.pathname.slice("/fotos/".length));
  if (!nome || nome.includes("..")) return new Response("Não encontrado", { status: 404 });

  const obj = await env.FOTOS.get(nome);
  if (!obj) return new Response("Não encontrado", { status: 404 });

  const cabecalhos = new Headers();
  obj.writeHttpMetadata(cabecalhos);
  cabecalhos.set("etag", obj.httpEtag);
  cabecalhos.set("Cache-Control", CACHE_FOTO);

  const resposta = new Response(obj.body, { headers: cabecalhos });
  ctx.waitUntil(cache.put(request, resposta.clone()));
  return resposta;
}

/* ------------------------------------------------------------------ apoio */

function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}

async function lerJSON(env, chave, padrao) {
  try {
    const txt = await env.DADOS.get(chave);
    return txt ? JSON.parse(txt) : padrao;
  } catch { return padrao; }
}

function filtrarPorPagina(fotos, pagina) {
  const saida = {};
  for (const [k, v] of Object.entries(fotos || {})) {
    const [pag, n] = k.split("|");
    if (pag === pagina) saida[Number(n)] = v;
  }
  return saida;
}

function esc(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cardHTML(c) {
  const chips = (c.chips || []).filter(Boolean).slice(0, 3)
    .map(x => '<span class="chip">' + esc(x) + '</span>').join("");
  return '<article class="prod">' +
    '<div class="ph"><img src="' + esc(c.img) + '" loading="lazy" alt="' + esc(c.titulo) + '"></div>' +
    '<div class="body"><h4>' + esc(c.titulo) + '</h4><p>' + esc(c.desc || "") + '</p>' +
    (chips ? '<div class="spec">' + chips + '</div>' : '') +
    '</div></article>';
}

function nomeDaPagina(caminho) {
  if (caminho === "/" || caminho === "") return "index.html";
  const ultimo = caminho.split("/").filter(Boolean).pop() || "index.html";
  return ultimo.includes(".") ? ultimo : ultimo + ".html";
}
