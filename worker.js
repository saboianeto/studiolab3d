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
      if (p === "/api/evento")          return await registrarEvento(request, env);
      if (p === "/sitemap.xml")         return await sitemap(request, env);
      if (p.startsWith("/api/admin/"))  return await rotaAdmin(request, env, url);
      if (p.startsWith("/fotos/"))      return await servirFoto(request, env, url, ctx);
      // O molde não deve ser acessado direto — sem peça, não há o que mostrar.
      if (p === "/produto.html" && !url.searchParams.get("p"))
        return new Response(null, { status: 302, headers: { Location: "/catalogo.html" } });

      if (p.startsWith("/peca/") || (p === "/catalogo.html" && url.searchParams.get("p"))) {
        const r = await paginaDaPeca(request, env, url, p);
        if (r) return r;                       // não achou a peça: segue o fluxo normal
      }
    } catch (erro) {
      return json({ erro: String(erro && erro.message || erro) }, 500);
    }

    // Tudo o mais é arquivo do site. Páginas HTML passam pelo reescritor, que
    // aplica o que foi editado no painel: fotos trocadas, textos, cards novos
    // e cards escondidos.
    const resposta = await env.ASSETS.fetch(request);
    const tipo = resposta.headers.get("Content-Type") || "";
    if (!tipo.includes("text/html")) return resposta;

    const pagina = nomeDaPagina(p);

    const edicoes = await lerJSON(env, "paginas", null);
    if (!edicoes) return resposta;
    const fotos     = filtrarPorPagina(edicoes.fotos,  pagina);   // {n: url}
    const textos    = edicoes.textos  && edicoes.textos[pagina]  || null;  // {sel: {n: txt}}
    const ocultos   = new Set((edicoes.ocultos && edicoes.ocultos[pagina]) || []);
    const novos     = (edicoes.novos && edicoes.novos[pagina]) || [];
    const seo       = edicoes.seo && edicoes.seo[pagina] || null;

    if (!Object.keys(fotos).length && !textos && !ocultos.size && !novos.length && !seo)
      return resposta;

    let rw = new HTMLRewriter();

    // título e descrição para busca e redes sociais
    if (seo) {
      if (seo.titulo) {
        rw = rw.on("title", { element(el) { el.setInnerContent(seo.titulo, { html: false }); } })
               .on('meta[property="og:title"]',    { element(el) { el.setAttribute("content", seo.titulo); } })
               .on('meta[name="twitter:title"]',   { element(el) { el.setAttribute("content", seo.titulo); } });
      }
      if (seo.descricao) {
        rw = rw.on('meta[name="description"]',        { element(el) { el.setAttribute("content", seo.descricao); } })
               .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", seo.descricao); } })
               .on('meta[name="twitter:description"]',{ element(el) { el.setAttribute("content", seo.descricao); } });
      }
    }

    // fotos trocadas: n-ésima <img> dentro de <main>.
    // Se o arquivo for vídeo, a <img> é substituída por um <video> em loop mudo.
    if (Object.keys(fotos).length) {
      let i = -1;
      rw = rw.on("main img", {
        element(el) {
          i++;
          const novo = fotos[i];
          if (!novo) return;
          if (/\.(mp4|webm|mov)$/i.test(novo)) {
            const alt = el.getAttribute("alt") || "";
            el.replace(
              '<video class="video-peca" autoplay muted loop playsinline preload="metadata" ' +
              'aria-label="' + esc(alt) + '"><source src="' + esc(novo) + '" type="video/mp4"></video>',
              { html: true }
            );
          } else {
            el.setAttribute("src", novo);
          }
        }
      });
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

/* ------------------------------------------------------- página de uma peça */

async function paginaDaPeca(request, env, url, p) {
  // Endereço próprio de cada peça: /peca/chaveiro-flor-com-inicial-66
  // O número no fim é a identidade real; o texto antes dele é só para o Google e
  // para o olho humano. Mudar o nome da peça não quebra link já compartilhado —
  // apenas redireciona para o texto novo.
  let idPeca = null, viaCaminho = false;
  if (p.startsWith("/peca/")) {
    const m = p.slice(6).match(/(?:^|-)(\d{1,5})\/?$/);
    if (m) { idPeca = m[1]; viaCaminho = true; }
  } else if (p === "/catalogo.html") {
    idPeca = url.searchParams.get("p");
  }
  if (!idPeca || !/^\d{1,5}$/.test(idPeca)) return null;

  const cat  = await lerJSON(env, "catalogo", null);
  const peca = cat && Array.isArray(cat.produtos)
    ? cat.produtos.find(x => String(x.i) === idPeca) : null;

  const base = url.origin;

  // Peça conhecida: endereço definitivo, com título, descrição e foto próprios.
  if (peca) {
    const nome    = (peca.n && peca.n.trim()) ? peca.n.trim() : "";
    const caminho = "/peca/" + (nome ? apelido(nome) + "-" : "peca-") + peca.i;
    if (p !== caminho) return new Response(null, { status: 301, headers: { Location: caminho } });

    const foto = base + (peca.r ? "/fotos/p" + peca.i + ".jpg"
                                : "/img/catalogo/p" + String(peca.i).padStart(2, "0") + ".jpg");
    const cod    = "OOMM-" + String(peca.i).padStart(3, "0");
    const rotulo = nome || "Peça sob encomenda";
    const desc   = (peca.d && peca.d.trim())
      ? peca.d.trim().slice(0, 200)
      : rotulo + " em impressão 3D. Personalizamos cor, tamanho e acabamento. OOMM Studio, São Paulo.";
    return montarPagina(request, env, {
      idPeca: peca.i, titulo: rotulo + " · " + cod + " · OOMM Studio",
      desc, foto, canonical: base + caminho
    });
  }

  // Catálogo ainda não publicado pelo painel: entrega a página assim mesmo e
  // deixa o navegador procurar a peça na lista que veio no repositório.
  // Melhor uma página que abre sem prévia bonita do que um 404.
  if (viaCaminho) return montarPagina(request, env, { idPeca: Number(idPeca) });

  return null;
}

async function montarPagina(request, env, o) {
  const alvo = new URL(request.url);
  alvo.pathname = "/produto.html";
  alvo.search = "";

  // O servidor de arquivos responde a "/produto.html" com um redirecionamento
  // para "/produto" (ele remove a extensão sozinho). Se repassarmos isso ao
  // navegador, ele sai de /peca/... e a página perde a identidade da peça.
  // Então seguimos o redirecionamento aqui dentro e entregamos o conteúdo.
  let html = await env.ASSETS.fetch(new Request(alvo.toString(), request));
  let voltas = 0;
  while (html.status >= 300 && html.status < 400 && voltas++ < 3) {
    const destino = html.headers.get("Location");
    if (!destino) break;
    html = await env.ASSETS.fetch(new Request(new URL(destino, alvo.origin).toString(), request));
  }
  if (html.status !== 200) return null;

  let rw = new HTMLRewriter()
    // A página vive em /catalogo.html mas é servida em /peca/... Sem esta linha,
    // "img/foto.jpg" viraria "/peca/img/foto.jpg" e nada carregaria.
    .on("head", { element(e) {
      e.prepend('<base href="/">', { html: true });
      e.append('<script>window.__PECA=' + JSON.stringify(o.idPeca) + ';</script>', { html: true });
    }});

  if (o.titulo) {
    rw = rw.on("title",                      { element(e) { e.setInnerContent(o.titulo, { html: false }); } })
           .on('meta[property="og:title"]',  { element(e) { e.setAttribute("content", o.titulo); } });
  }
  if (o.desc) {
    rw = rw.on('meta[name="description"]',        { element(e) { e.setAttribute("content", o.desc); } })
           .on('meta[property="og:description"]', { element(e) { e.setAttribute("content", o.desc); } });
  }
  if (o.foto)      rw = rw.on('meta[property="og:image"]', { element(e) { e.setAttribute("content", o.foto); } });
  if (o.canonical) rw = rw.on('link[rel="canonical"]',     { element(e) { e.setAttribute("href", o.canonical); } })
                          .on('meta[property="og:url"]',   { element(e) { e.setAttribute("content", o.canonical); } });

  return rw.transform(html);
}

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
    return json(await lerJSON(env, "paginas", { fotos:{}, textos:{}, ocultos:{}, novos:{}, seo:{} }));
  }

  if (p === "/api/admin/paginas" && request.method === "PUT") {
    const corpo = await request.json();
    if (!corpo || typeof corpo !== "object") return json({ erro: "Formato inválido." }, 400);
    await env.DADOS.put("paginas", JSON.stringify({
      fotos:   corpo.fotos   || {},
      textos:  corpo.textos  || {},
      ocultos: corpo.ocultos || {},
      novos:   corpo.novos   || {},
      seo:     corpo.seo     || {}
    }));
    return json({ ok: true });
  }

  if (p === "/api/admin/foto" && request.method === "POST") {
    const nome = url.searchParams.get("nome");
    if (!nome || !/^[\w./-]{1,80}$/.test(nome) || nome.includes(".."))
      return json({ erro: "Nome de arquivo inválido." }, 400);
    const video = /\.(mp4|webm|mov)$/i.test(nome);
    const limite = video ? 30e6 : 6e6;
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength)      return json({ erro: "Arquivo vazio." }, 400);
    if (bytes.byteLength > limite)
      return json({ erro: "Arquivo acima de " + (limite / 1e6) + " MB." }, 413);
    await env.FOTOS.put(nome, bytes, {
      httpMetadata: {
        contentType: video ? (nome.endsWith(".webm") ? "video/webm" : "video/mp4") : "image/jpeg",
        cacheControl: CACHE_FOTO
      }
    });
    return json({ ok: true, url: "/fotos/" + nome });
  }

  if (p === "/api/admin/metricas" && request.method === "GET") {
    return json(await metricas(env, Number(url.searchParams.get("dias") || 30)));
  }

  if (p === "/api/admin/foto" && request.method === "DELETE") {
    const nome = url.searchParams.get("nome");
    if (nome) await env.FOTOS.delete(nome);
    return json({ ok: true });
  }

  return json({ erro: "Rota não encontrada." }, 404);
}

/* ---------------------------------------------------------------- métricas */

const TIPOS = new Set(["pagina", "whatsapp", "loja", "peca", "link"]);
let tabelaPronta = false;

async function prepararTabela(env) {
  if (tabelaPronta) return;
  await env.METRICAS.exec(
    "CREATE TABLE IF NOT EXISTS eventos (ts INTEGER NOT NULL, dia TEXT NOT NULL, " +
    "tipo TEXT NOT NULL, alvo TEXT NOT NULL, origem TEXT);"
  );
  await env.METRICAS.exec("CREATE INDEX IF NOT EXISTS idx_dia ON eventos (dia);");
  await env.METRICAS.exec("CREATE INDEX IF NOT EXISTS idx_tipo ON eventos (tipo, dia);");
  tabelaPronta = true;
}

// Robôs de busca e ferramentas não são visita. Sem filtrar isto, os números mentem.
const ROBO = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|headless|lighthouse|preview|monitor|curl|wget|python-requests/i;

async function registrarEvento(request, env) {
  if (request.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  if (!env.METRICAS) return json({ ok: false });          // ainda sem banco: ignora em silêncio

  const ua = request.headers.get("User-Agent") || "";
  if (ROBO.test(ua)) return json({ ok: true });

  let c;
  try { c = await request.json(); } catch { return json({ erro: "Corpo inválido." }, 400); }

  const tipo = String(c.tipo || "");
  if (!TIPOS.has(tipo)) return json({ erro: "Tipo desconhecido." }, 400);
  const alvo   = String(c.alvo   || "").slice(0, 120);
  const origem = String(c.origem || "direto").slice(0, 60);

  try {
    await prepararTabela(env);
    const agora = Date.now();
    await env.METRICAS.prepare(
      "INSERT INTO eventos (ts, dia, tipo, alvo, origem) VALUES (?, ?, ?, ?, ?)"
    ).bind(agora, new Date(agora).toISOString().slice(0, 10), tipo, alvo, origem).run();
  } catch (e) { /* medir nunca pode derrubar o site */ }

  return json({ ok: true });
}

async function metricas(env, dias) {
  if (!env.METRICAS) return { semBanco: true };
  await prepararTabela(env);
  const d = Math.max(1, Math.min(365, dias || 30));
  const corte = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  const q = async (sql) => (await env.METRICAS.prepare(sql).bind(corte).all()).results || [];

  const [totais, porDia, paginas, pecas, lojas, origens] = await Promise.all([
    q("SELECT tipo, COUNT(*) n FROM eventos WHERE dia >= ? GROUP BY tipo"),
    q("SELECT dia, tipo, COUNT(*) n FROM eventos WHERE dia >= ? GROUP BY dia, tipo ORDER BY dia"),
    q("SELECT alvo, COUNT(*) n FROM eventos WHERE dia >= ? AND tipo='pagina' GROUP BY alvo ORDER BY n DESC LIMIT 12"),
    q("SELECT alvo, COUNT(*) n FROM eventos WHERE dia >= ? AND tipo='peca'   GROUP BY alvo ORDER BY n DESC LIMIT 12"),
    q("SELECT alvo, COUNT(*) n FROM eventos WHERE dia >= ? AND tipo='loja'   GROUP BY alvo ORDER BY n DESC LIMIT 10"),
    q("SELECT origem alvo, COUNT(*) n FROM eventos WHERE dia >= ? AND tipo='pagina' GROUP BY origem ORDER BY n DESC LIMIT 10")
  ]);

  const t = {};
  totais.forEach(r => t[r.tipo] = r.n);
  return { dias: d, totais: t, porDia, paginas, pecas, lojas, origens };
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
  const midia = /\.(mp4|webm|mov)$/i.test(c.img || "")
    ? '<video class="video-peca" autoplay muted loop playsinline preload="metadata" aria-label="' +
      esc(c.titulo) + '"><source src="' + esc(c.img) + '" type="video/mp4"></video>'
    : '<img src="' + esc(c.img) + '" loading="lazy" alt="' + esc(c.titulo) + '">';
  return '<article class="prod">' +
    '<div class="ph">' + midia + '</div>' +
    '<div class="body"><h4>' + esc(c.titulo) + '</h4><p>' + esc(c.desc || "") + '</p>' +
    (chips ? '<div class="spec">' + chips + '</div>' : '') +
    '</div></article>';
}

// Transforma "Bandeja Ore e Confie" em "bandeja-ore-e-confie"
function apelido(txt) {
  return String(txt)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "peca";
}

// Mapa do site para os buscadores, montado na hora com todas as peças.
async function sitemap(request, env) {
  const base = new URL(request.url).origin;
  const hoje = new Date().toISOString().slice(0, 10);
  const paginas = ["", "catalogo.html", "corporativo.html", "educacional.html",
                   "casa.html", "festas.html", "conecte.html"];   // produto.html não entra:
                   // ele só existe como molde das páginas /peca/...

  let itens = paginas.map(p =>
    "<url><loc>" + base + "/" + p + "</loc><lastmod>" + hoje +
    "</lastmod><priority>" + (p === "" ? "1.0" : p === "catalogo.html" ? "0.9" : "0.8") + "</priority></url>");

  const cat = await lerJSON(env, "catalogo", null);
  if (cat && Array.isArray(cat.produtos)) {
    cat.produtos.forEach(x => {
      const nome = (x.n && x.n.trim()) ? apelido(x.n.trim()) + "-" : "peca-";
      itens.push("<url><loc>" + base + "/peca/" + nome + x.i + "</loc><lastmod>" + hoje +
                 "</lastmod><priority>0.7</priority></url>");
    });
  }

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    itens.join("\n") + "\n</urlset>",
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } }
  );
}

function nomeDaPagina(caminho) {
  if (caminho === "/" || caminho === "") return "index.html";
  const ultimo = caminho.split("/").filter(Boolean).pop() || "index.html";
  return ultimo.includes(".") ? ultimo : ultimo + ".html";
}
