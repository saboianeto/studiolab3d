# Área administrativa — como funciona e como ligar o login

## O problema, direto

Você pediu: enviar foto pelo navegador, ela entrar no catálogo, e um login por
código de e-mail que só o `saboianeto@yahoo.com.br` consiga usar.

O site está no **GitHub Pages**. GitHub Pages entrega arquivos e nada mais. Não
roda código no servidor. Isso significa que, do jeito que está hoje, ele
**não consegue**:

- enviar e-mail (não existe nada rodando para disparar);
- guardar um código e conferir depois (não existe onde guardar);
- receber um arquivo enviado por você (não existe quem receba);
- esconder uma senha (todo JavaScript da página é público — qualquer visitante
  lê o código-fonte e vê o que estiver lá).

Login feito só com JavaScript é **teatro**. Ele engana você, não o invasor.
Por isso eu não fiz isso.

O que existe aqui são dois caminhos, e os dois funcionam.

---

## Caminho A — Modo local (funciona hoje, zero configuração)

Abra `/admin/` no navegador. Sem servidor de e-mail, o painel avisa e entra em
**modo local**. Tudo funciona:

- arrastar fotos e adicionar peças ao catálogo;
- escolher categoria e nome de cada peça;
- tirar peças do catálogo;
- trocar qualquer uma das 23 fotos das páginas do site;
- clicar em **Gerar pacote para publicar** e baixar um ZIP.

O ZIP vem com as imagens já redimensionadas (versão grande e miniatura), o
`produtos.js` atualizado e as páginas HTML alteradas. Você copia o conteúdo para
o repositório, faz commit, e está publicado.

**Por que não tem login aqui:** não precisa. Nada sai do seu computador. As
fotos são redimensionadas pelo próprio navegador. Não existe nada exposto para
proteger.

**A limitação, sem rodeios:** o passo de publicar é manual. Você baixa o ZIP e
sobe os arquivos. É uma tarefa de dois minutos, mas é uma tarefa.

---

## Caminho B — Login por e-mail de verdade (~30 minutos, sem custo)

Para o fluxo que você descreveu — digita o e-mail, recebe o código, entra — é
preciso ter servidor. A migração mais curta mantém tudo: mesmo domínio, mesmo
repositório, mesmo GitHub.

### Passo 1 — Trocar GitHub Pages por Cloudflare Pages

1. Crie conta em `dash.cloudflare.com` (grátis).
2. **Workers & Pages → Create → Pages → Connect to Git**, escolha o repositório.
3. Build command: deixe vazio. Output directory: `/`.
4. Em **Custom domains**, aponte `studiolab3d.com.br`.

O site continua igual. O que muda é que agora a pasta `functions/` passa a
rodar de verdade.

### Passo 2 — Criar o KV (onde os códigos ficam guardados)

**Workers & Pages → KV → Create namespace**, nome `CODIGOS`.
Depois, no projeto: **Settings → Functions → KV namespace bindings**,
variável `CODIGOS` apontando para esse namespace.

### Passo 3 — Conta de envio de e-mail

Crie conta em `resend.com` (grátis até 3.000 e-mails por mês). Verifique o
domínio `studiolab3d.com.br` e gere uma API key.

### Passo 4 — Variáveis de ambiente

Em **Settings → Environment variables**:

| Nome | Valor |
|---|---|
| `ADMIN_EMAIL` | `saboianeto@yahoo.com.br` |
| `RESEND_API_KEY` | a chave gerada no Resend |
| `REMETENTE` | `OOMM Studio <admin@studiolab3d.com.br>` |
| `SESSAO_SEGREDO` | texto longo e aleatório, 40+ caracteres |

Para gerar o segredo, rode no terminal: `openssl rand -hex 32`

### Passo 5 — Publicar

Faça commit da pasta `functions/`. Pronto. A partir daí `/admin/` exige login,
o código chega no seu e-mail, e o middleware bloqueia qualquer acesso sem
sessão válida.

---

## O que o Caminho B ainda não faz

O login e o bloqueio ficam prontos. **Publicar direto pelo painel, não.**
Para isso o servidor precisaria escrever no seu repositório do GitHub, o que
significa: criar um GitHub App, guardar um token com permissão de escrita e
implementar as chamadas de commit via API.

É viável e eu escrevo o código. Mas é mais uma peça para configurar e mais uma
credencial poderosa guardada. **Faça o Caminho B primeiro e use por algumas
semanas.** Se o passo de baixar o ZIP e subir realmente incomodar, aí sim
vale automatizar. Se não incomodar, você economizou o trabalho e uma
credencial a menos circulando.

---

## Segurança — o que está protegido e o que não está

**Protegido:**
- o código tem 6 dígitos, vale 10 minutos e só funciona uma vez;
- fica guardado como hash, não em texto puro;
- máximo de 5 pedidos por hora por IP;
- o cookie de sessão é assinado (HMAC), `HttpOnly` e `Secure`;
- o middleware barra `/admin/*` no servidor, antes de qualquer HTML sair;
- e-mail não autorizado recebe exatamente a mesma resposta que o autorizado —
  ninguém descobre qual e-mail é o certo testando.

**Não protegido, e você precisa saber:**
- **quem tem acesso ao seu e-mail tem acesso ao painel.** O código chega lá. Se
  a conta do Yahoo cair, o admin cai junto. Ative verificação em duas etapas no
  Yahoo hoje — é mais urgente que qualquer coisa neste arquivo;
- **quem tem acesso ao painel do Cloudflare contorna tudo.** Ative 2FA lá também;
- o arquivo `admin-slots.js` é público e mostra a estrutura das páginas. Não tem
  segredo nenhum ali, mas revela que existe um `/admin`. Se preferir, renomeie a
  pasta para algo menos óbvio — vale pouco como defesa, mas reduz varredura
  automática.

---

## Resumo

| | Modo local | Cloudflare + login |
|---|---|---|
| Funciona hoje | sim | precisa migrar |
| Login por e-mail | não precisa | sim |
| Envia foto pelo navegador | sim | sim |
| Publica sozinho | não | não (ainda) |
| Custo | zero | zero |
| Configuração | nenhuma | ~30 min |
