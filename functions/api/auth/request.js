// POST /api/auth/request  { email }
// Gera um código de 6 dígitos, guarda no KV por 10 min e envia por e-mail.
// Variáveis de ambiente necessárias (Cloudflare Pages > Settings > Environment variables):
//   ADMIN_EMAIL     -> saboianeto@yahoo.com.br
//   RESEND_API_KEY  -> chave da conta resend.com (grátis até 3.000 e-mails/mês)
//   REMETENTE       -> ex.: "OOMM Studio <admin@studiolab3d.com.br>" (domínio verificado no Resend)
// Binding de KV necessário:  CODIGOS

export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }

  const email = String(corpo.email || "").trim().toLowerCase();
  const autorizado = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  // Resposta idêntica em qualquer caso: não revela quais e-mails existem.
  if (email !== autorizado) return json({ ok: true });

  // Freio: no máximo 5 pedidos por hora, por IP.
  const ip = request.headers.get("CF-Connecting-IP") || "sem-ip";
  const chaveFreio = "freio:" + ip;
  const tentativas = parseInt(await env.CODIGOS.get(chaveFreio) || "0", 10);
  if (tentativas >= 5) return json({ erro: "Muitas tentativas. Tente de novo em uma hora." }, 429);
  await env.CODIGOS.put(chaveFreio, String(tentativas + 1), { expirationTtl: 3600 });

  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const hash = await sha256(codigo + "|" + email);
  await env.CODIGOS.put("codigo:" + email, hash, { expirationTtl: 600 });

  const envio = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.REMETENTE,
      to: [email],
      subject: "Seu código de acesso · OOMM Studio",
      text:
        "Seu código de acesso à área administrativa é:\n\n    " + codigo + "\n\n" +
        "Ele vale por 10 minutos e só pode ser usado uma vez.\n" +
        "Se não foi você que pediu, ignore este e-mail — ninguém entra sem o código."
    })
  });

  if (!envio.ok) return json({ erro: "Não consegui enviar o e-mail. Verifique a configuração." }, 502);
  return json({ ok: true });
}

async function sha256(txt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
