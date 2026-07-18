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

    // Tudo o mais é arquivo do site. Páginas HTML passam pelo reescritor,
    // que aplica as trocas de foto feitas no admin.
    const resposta = await env.ASSETS.fetch(request);
    const tipo = resposta.headers.get("Content-Type") || "";
    if (!tipo.includes("text/html")) return resposta;

    const trocas = await lerJSON(env, "slots", null);
    if (!trocas) return resposta;

    const pagina = nomeDaPagina(p);
    const doPagina = Object.entries(trocas)
      .filter(([k]) => k.startsWith(pagina + "|"))
      .map(([k, v]) => [Number(k.split("|")[1]), v]);
    if (!doPagina.length) return resposta;

    const mapa = new Map(doPagina);
    let n = -1;
    return new HTMLRewriter()
      .on("main img", {
        element(el) {
          n++;
          if (mapa.has(n)) el.setAttribute("src", mapa.get(n));
        }
      })
      .transform(resposta);
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

  if (p === "/api/admin/slots-atuais" && request.method === "GET") {
    return json(await lerJSON(env, "slots", {}));
  }

  if (p === "/api/admin/slots" && request.method === "PUT") {
    const corpo = await request.json();
    await env.DADOS.put("slots", JSON.stringify(corpo || {}));
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

function nomeDaPagina(caminho) {
  if (caminho === "/" || caminho === "") return "index.html";
  const ultimo = caminho.split("/").filter(Boolean).pop() || "index.html";
  return ultimo.includes(".") ? ultimo : ultimo + ".html";
}
