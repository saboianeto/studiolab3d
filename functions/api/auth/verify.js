// POST /api/auth/verify  { email, codigo }
// Confere o código e devolve um cookie de sessão assinado, válido por 8 horas.
// Variável extra necessária:  SESSAO_SEGREDO  -> string longa e aleatória

export async function onRequestPost({ request, env }) {
  const json = (o, s = 200, h = {}) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });

  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }

  const email  = String(corpo.email  || "").trim().toLowerCase();
  const codigo = String(corpo.codigo || "").trim();
  const autorizado = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (email !== autorizado || !/^\d{6}$/.test(codigo))
    return json({ erro: "Código inválido ou expirado." }, 401);

  const guardado = await env.CODIGOS.get("codigo:" + email);
  if (!guardado) return json({ erro: "Código inválido ou expirado." }, 401);

  const hash = await sha256(codigo + "|" + email);
  if (!iguais(hash, guardado)) return json({ erro: "Código inválido ou expirado." }, 401);

  await env.CODIGOS.delete("codigo:" + email);          // uso único
  const expira = Date.now() + 8 * 3600 * 1000;
  const token  = email + "." + expira + "." + await hmac(email + "." + expira, env.SESSAO_SEGREDO);

  return json({ ok: true }, 200, {
    "Set-Cookie": "sessao=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800"
  });
}

async function sha256(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hmac(msg, segredo) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo),
              { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map(x => x.toString(16).padStart(2, "0")).join("");
}
// comparação em tempo constante: não vaza informação pelo tempo de resposta
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
