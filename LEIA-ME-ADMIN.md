# Painel administrativo — publicação direta

## O que mudou

Antes o painel gerava um ZIP e alguém subia os arquivos no GitHub na mão.
Agora ele **publica direto**: a foto vai para o armazenamento da Cloudflare e a
lista de peças para o banco de chaves. O site lê de lá na hora seguinte.

Quem cadastra não precisa saber o que é GitHub, ZIP ou commit. Abre
`studiolab3d.com.br/admin/`, entra com o código do e-mail, arrasta a foto,
escolhe a categoria e clica em **Publicar no site**.

Para isso funcionar, faltam três configurações de uma vez só. São 15 minutos.

---

## 1. Criar o bucket das fotos (R2)

1. Painel da Cloudflare → **R2** → **Create bucket**
2. Nome: **`oomm-fotos`** (exatamente assim)
3. Location: **Automatic**. Criar.

Plano gratuito cobre 10 GB. As fotos do catálogo somam alguns megabytes.

## 2. Criar o banco da lista de peças (KV)

1. **Storage & Databases → KV** → **Create a namespace**
2. Nome: **`oomm-dados`**
3. Depois de criar, **copie o ID** que aparece na lista

## 3. Ligar os dois ao Worker

Abra o arquivo **`wrangler.jsonc`** no repositório e troque
`COLE_AQUI_O_ID_DO_KV` pelo ID que você copiou. Salve e faça commit.

```jsonc
"kv_namespaces": [
  { "binding": "DADOS", "id": "o-id-que-voce-copiou" }
]
```

Se preferir pelo painel: **Workers & Pages → studiolab3d → Settings → Bindings**,
adicionando `FOTOS` → bucket `oomm-fotos` e `DADOS` → namespace `oomm-dados`.
O arquivo é mais confiável: sobrevive a redeploys.

## 3b. Criar o banco dos números (D1)

O painel tem uma aba **Números** com visitas, cliques no WhatsApp e nas lojas.
Sem este passo ela avisa que falta o banco — o resto do site funciona igual.

1. **Storage & databases → D1 SQLite Database** → **Create**
2. Nome: **`oomm-metricas`**
3. Copie o **Database ID** e cole no `wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "METRICAS", "database_name": "oomm-metricas", "database_id": "o-id-copiado" }
]
```

A tabela é criada sozinha no primeiro acesso. Não precisa rodar SQL.

**Por que D1 e não KV:** o KV gratuito permite mil gravações por dia, e cada
visita é uma gravação. O D1 permite cem mil por dia. Se o site estourar em
alcance, os números continuam sendo contados.

## 4. Proteger a API no Access

**Este passo não é opcional.** Sem ele o painel recusa publicar — de propósito.

1. **Cloudflare One → Access controls → Applications**
2. Abra a aplicação `studiolab3d.com.br` → **Edit**
3. Em **Destinations → + Add public hostname**:
   - Subdomain: vazio
   - Domain: `studiolab3d.com.br`
   - **Path: `api/admin`**
4. Salve

Agora a aplicação tem dois destinos: `admin` (o painel) e `api/admin`
(as rotas que gravam). A mesma regra de e-mail vale para os dois.

**Por que o Worker recusa sem isso:** ele exige o cabeçalho que o Access injeta
ao autenticar. Sem o cabeçalho, a requisição não passou pelo Access, e ele
responde 401. Falha fechada — na dúvida, ninguém grava.

---

## Como sua filha usa

1. Abre `studiolab3d.com.br/admin/`
2. Digita o e-mail, recebe o código, entra
3. Aba **Catálogo**: arrasta as fotos, escolhe categoria e nome de cada uma
4. Aba **Fotos das páginas**: troca qualquer uma das 23 fotos fixas do site
5. **Publicar no site**

O botão mostra o progresso foto a foto. No fim aparece a confirmação verde.

**Se der erro, nada é publicado pela metade.** A mensagem explica o que houve e
as alterações continuam na tela para tentar de novo.

**Detalhe que evita confusão:** depois de publicar, o site pode continuar
mostrando a versão antiga na aba já aberta, por causa do cache do navegador.
Abrir em aba anônima ou dar Ctrl+F5 resolve. Isso não significa que falhou.

---

## Limites que valem saber

- Foto de até 6 MB cada. Fotos de celular passam folgado — o painel já
  reduz o tamanho antes de enviar.
- O plano gratuito do KV permite cerca de mil gravações por dia. Cada
  publicação gasta uma ou duas. Não há como esbarrar nisso no uso normal.
- As fotos que vieram no repositório continuam lá e seguem funcionando.
  Só as novas vão para o R2.
- **Tirar uma peça do catálogo esconde ela do site, mas não apaga a foto**
  do armazenamento. Se quiser apagar de vez, é pelo painel do R2.

## Segurança

Quem entra no e-mail entra no painel — o código chega lá. **Verificação em duas
etapas no Yahoo e na conta Cloudflare** é o que sustenta tudo isso. Vale mais
que qualquer configuração deste arquivo.

Se um dia sua filha deixar de cuidar do catálogo, tire o e-mail dela da regra
em Access controls → Applications → Policies. O acesso morre na hora.
