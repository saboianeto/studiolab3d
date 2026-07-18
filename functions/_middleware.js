// Protege /admin/*: sem cookie de sessão válido, ninguém passa.
// Esta é a parte que um site estático NÃO consegue fazer.

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/admin")) return next();

  const cookie = request.headers.get("Cookie") || "";
  const token  = (cookie.match(/(?:^|;\s*)sessao=([^;]+)/) || [])[1];
  if (token && await valido(token, env)) return next();

  return new Response(pagina401(), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function valido(token, env) {
  const partes = String(token).split(".");
  if (partes.length !== 3) return false;
  const [email, expira, assinatura] = partes;
  if (email !== String(env.ADMIN_EMAIL || "").trim().toLowerCase()) return false;
  if (!expira || Date.now() > Number(expira)) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSAO_SEGREDO),
              { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", k, hexParaBytes(assinatura), new TextEncoder().encode(email + "." + expira));
}
function hexParaBytes(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a.buffer;
}
function pagina401() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Acesso restrito</title><style>body{font-family:system-ui,sans-serif;background:#F4ECE3;color:#2A2126;
display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}
a{color:#9B3A58}</style></head><body><div><h1>Acesso restrito</h1>
<p>Faça login para entrar na área administrativa.</p>
<p><a href="/admin/">Ir para o login</a></p></div></body></html>`;
}
