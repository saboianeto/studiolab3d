# Login por código de e-mail — passo a passo

## O caminho mudou (para melhor)

Eu tinha escrito um backend próprio para gerar e enviar o código. **Jogue fora.**
A Cloudflare já tem isso pronto e sem código: chama-se **Cloudflare Access**,
com login por **One-time PIN**. Você cadastra o e-mail numa regra e acabou.

Menos peça para configurar, menos coisa para quebrar, nenhuma chave de API
guardada por aí. Por isso removi a pasta `functions/` do projeto.

Tempo total: cerca de 40 minutos de trabalho, mais a espera do DNS.
Custo: zero. Tudo cabe no plano gratuito.

---

## PARTE 1 — Levar o domínio para a Cloudflare

O Access só funciona em domínios cujo DNS está na Cloudflare. Este passo é
obrigatório e é o único que envolve espera.

1. Crie conta em **dash.cloudflare.com**.
2. **Add a site** → digite `studiolab3d.com.br` → escolha o plano **Free**.
3. A Cloudflare importa seus registros DNS atuais. **Confira antes de seguir**
   que estão lá os quatro registros A do GitHub:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   e o CNAME de `www` apontando para `saboianeto.github.io`.
   Faltou algum? Adicione na mão agora.
4. A Cloudflare mostra **dois nameservers** (algo como `xxx.ns.cloudflare.com`).
5. Vá no site onde você registrou o domínio (Registro.br, GoDaddy, onde for),
   procure **servidores DNS** ou **nameservers**, e substitua os que estão lá
   pelos dois da Cloudflare.
6. Espere. Costuma levar de 15 minutos a algumas horas — o limite é 24h.
   A Cloudflare manda e-mail quando reconhece.

**Enquanto espera, o site continua no ar normalmente.** Não quebra nada.

---

## PARTE 2 — Trocar GitHub Pages por Cloudflare Pages

Dá para manter o GitHub Pages e só colocar a Cloudflare na frente, mas isso
tem uma armadilha conhecida: se o modo de SSL ficar em "Flexible", o site entra
em **loop infinito de redirecionamento** e para de abrir. Publicar direto pelo
Cloudflare Pages evita o problema inteiro. É o caminho mais curto.

1. No painel da Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
2. Autorize o GitHub e escolha o repositório do site.
3. Configuração da build:
   - Framework preset: **None**
   - Build command: **deixe vazio**
   - Build output directory: **/**
4. **Save and Deploy**. Em um ou dois minutos sai um endereço `.pages.dev`.
   Abra e confira se o site está inteiro.
5. No projeto: **Custom domains → Set up a custom domain** →
   `studiolab3d.com.br`. Repita para `www.studiolab3d.com.br`.
6. **Passo que não pode ser esquecido:** volte ao GitHub →
   **Settings → Pages → Custom domain → Remove**.
   Se os dois ficarem disputando o mesmo domínio, o site fica instável.

O HTTPS passa a ser da Cloudflare, automático. O `Enforce HTTPS` do GitHub
deixa de importar.

---

## PARTE 3 — Ligar o login por código

Aqui está o que você pediu, e são cinco minutos.

1. No menu lateral da Cloudflare, abra **Zero Trust**.
2. Escolha um nome de time (ex.: `oommstudio`). Ele vira o endereço da tela de
   login: `oommstudio.cloudflareaccess.com`. Selecione o plano **Free**.
3. **Access → Applications → Add an application → Self-hosted**.
4. Preencha:
   - Application name: `Admin OOMM`
   - Session duration: `24 hours` (quanto tempo antes de pedir código de novo)
   - Subdomain: deixe vazio · Domain: `studiolab3d.com.br` · **Path: `admin`**
5. Em **Identity providers**, o **One-time PIN** já vem ligado. Não mexa.
6. **Next**. Agora a regra de quem entra:
   - Policy name: `Somente o dono`
   - Action: **Allow**
   - Include → seletor **Emails** → `saboianeto@yahoo.com.br`
7. **Save**.

Pronto. Ao abrir `studiolab3d.com.br/admin/` aparece a tela da Cloudflare
pedindo o e-mail. O código chega na sua caixa, vale **10 minutos**, e só esse
endereço passa.

O painel reconhece sozinho que você entrou pelo Access e **pula a tela de login
interna** — você cai direto no painel, com seu e-mail no topo.

---

## Detalhes que evitam dor de cabeça

- **O código vem de `noreply@notify.cloudflare.com`.** Yahoo às vezes joga na
  promoções ou no spam. Marque como confiável no primeiro código que chegar.
- **E-mail errado não recebe nada, mas a tela diz que enviou.** É de propósito:
  ninguém descobre qual é o e-mail certo testando. Se você não recebeu, confira
  se digitou exatamente `saboianeto@yahoo.com.br`.
- **Path `admin` protege `/admin` e tudo abaixo.** O resto do site continua
  público.
- **Proteja também o outro arquivo:** o `editor-catalogo.html` está solto na
  raiz. Mova para dentro de `/admin/` para ele ficar protegido junto.
- **Quem entra na sua conta da Cloudflare contorna tudo isso.** Ative
  verificação em duas etapas lá — e no Yahoo também. O código chega no e-mail:
  **sua caixa de entrada é o elo mais fraco de todo o sistema.** Isso vale mais
  que qualquer configuração deste arquivo.

---

## O que continua manual

Publicar. O painel gera um ZIP e você sobe os arquivos para o repositório.

Automatizar isso exigiria dar à Cloudflare permissão de escrita no seu GitHub —
mais uma credencial poderosa circulando. **Use assim por algumas semanas.**
Se o passo de subir o ZIP realmente incomodar, aí vale automatizar. Se não
incomodar, você economizou trabalho e uma chave a menos guardada.

---

## Resumo

| Passo | Onde | Tempo |
|---|---|---|
| 1. Domínio para a Cloudflare | dash.cloudflare.com + registrador | 10 min + espera do DNS |
| 2. Publicar pelo Cloudflare Pages | Workers & Pages | 15 min |
| 3. Access com One-time PIN | Zero Trust → Access | 5 min |
