# Dossiê de Documentos

Cliente sobe fotos ou PDFs → IA classifica, reorienta foto de lado/de ponta-cabeça, ordena por página e data → PDFs organizados chegam por e-mail pro advogado.

Cada foto é redimensionada (máximo 1800px no lado maior) e comprimida antes de virar página de PDF — mantém o texto legível, mas evita anexo de e-mail gigante em lotes grandes (testado com 236 páginas num único envio). Antes de tentar enviar, o site calcula o tamanho total e avisa se passar de ~18MB (perto do teto comum de 25MB dos provedores de e-mail), em vez de deixar o envio falhar sem explicação — nesse caso, oferece baixar os PDFs pra mandar manualmente ou em mais de um e-mail. Documentos com conteúdo idêntico ao de outro já enviado na mesma leva (mesma foto selecionada duas vezes, por exemplo) são detectados e ignorados automaticamente, com aviso de quantos foram pulados.

## As telas

- **`/` (index.html)** — sem token na URL: mostra a landing page (venda). Com token válido: mostra a tela de upload do cliente.
- **`/cadastro.html`** — advogado cria conta (nome, e-mail, senha) e já cai direto na tela de teste, usando o próprio token.
- **`/login.html`** — advogado entra com e-mail/senha.
- **`/conta.html`** — depois do login: se ainda não pago, mostra o teste e o PIX; se já pago, mostra o link definitivo pra mandar aos clientes.

Cada advogado tem um token único. Um segundo tipo de link, de uso único por cliente, também existe (gerado via `/api/generate-client-link`, ainda sem tela própria) — os dois tipos de token funcionam nos mesmos lugares.

## Teste grátis e liberação de pagamento

Todo advogado começa **não pago**. Ele mesmo (ou qualquer cliente usando o link dele) pode classificar até `TRIAL_LIMIT` documentos (padrão: 3) no total. Depois disso, a classificação é bloqueada com uma mensagem pedindo pra assinar, até você liberar manualmente.

**Pra liberar depois de confirmar o PIX:**
1. Abre o Supabase → **Table Editor** → tabela `lawyers`.
2. Acha a linha pelo e-mail do advogado.
3. Muda a coluna `paid` de `false` pra `true`.
4. Pronto — no próximo acesso a `/conta.html` ou no próximo documento enviado, o limite de 3 some.

## O que você precisa antes de começar

1. **Anthropic** — [console.anthropic.com](https://console.anthropic.com), seção "API Keys". Pago por uso (poucos centavos por documento).
2. **Resend** — [resend.com](https://resend.com), plano grátis cobre bem esse volume.
3. **Supabase** — [supabase.com](https://supabase.com), plano grátis. Guarda advogados, senhas (com hash), status de pagamento e uso.
4. **Vercel** — [vercel.com](https://vercel.com), grátis, hospeda o site.
5. **GitHub** — pra o Vercel puxar o projeto de lá.

## Passo a passo

### 1. Crie o projeto no Supabase

Crie um projeto novo, vá em "SQL Editor" e rode:

```sql
create table lawyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  token text not null unique,
  password_hash text,
  paid boolean not null default false,
  created_at timestamptz default now()
);

create table usage_events (
  id bigserial primary key,
  token text not null,
  created_at timestamptz default now()
);
create index usage_events_token_idx on usage_events (token, created_at);

create table client_links (
  id uuid primary key default gen_random_uuid(),
  lawyer_token text not null,
  token text not null unique,
  client_name text,
  used boolean not null default false,
  created_at timestamptz default now()
);
```

Se você já tinha as tabelas `lawyers` e `usage_events` criadas de uma versão anterior, roda só o que falta:

```sql
alter table lawyers add column password_hash text;
alter table lawyers add column paid boolean not null default false;
alter table lawyers add constraint lawyers_email_unique unique (email);

create table client_links (
  id uuid primary key default gen_random_uuid(),
  lawyer_token text not null,
  token text not null unique,
  client_name text,
  used boolean not null default false,
  created_at timestamptz default now()
);
```

Depois, em "Project Settings" → "API", copie a **Project URL** (`SUPABASE_URL`) e a chave **service_role** (`SUPABASE_SERVICE_KEY` — nunca a `anon`).

### 2. Suba o projeto pro GitHub

Crie um repositório e suba a pasta inteira, incluindo a pasta `api`.

### 3. Conecte no Vercel

"Add New" → "Project" → escolhe o repositório. Não precisa mexer em configuração de build.

### 4. Configure as variáveis de ambiente

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | sua chave da Anthropic |
| `RESEND_API_KEY` | sua chave do Resend |
| `FROM_EMAIL` | `onboarding@resend.dev` (pra testar) ou um e-mail do seu domínio verificado no Resend |
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_SERVICE_KEY` | chave `service_role` do Supabase |
| `DAILY_LIMIT` | opcional — documentos por dia por advogado. Padrão: `60` |
| `TRIAL_LIMIT` | opcional — documentos grátis antes de exigir pagamento. Padrão: `3` |

### 5. Deploy

Clique em "Deploy".

## Testando

1. Abre a raiz do site (sem token) — deve mostrar a landing.
2. Clica em "Testar grátis" → cria uma conta em `/cadastro.html` → já cai na tela de upload com seu próprio token.
3. Sobe até 3 documentos de teste — no 4º deve bloquear com a mensagem de teste esgotado.
4. Simula a liberação: marca `paid = true` pra esse advogado no Supabase.
5. Faz login em `/login.html` com o e-mail/senha que criou → `/conta.html` deve mostrar o link definitivo, sem menção a teste.
6. Abre esse link numa aba anônima, sobe um documento, confere se chega por e-mail.

## Sobre o Resend e o `FROM_EMAIL`

Com `onboarding@resend.dev`, o Resend só entrega pro e-mail dono da conta Resend, sem verificar domínio. Pra entregar pro e-mail de qualquer advogado, verifique um domínio próprio no Resend ("Domains") e use um e-mail desse domínio como `FROM_EMAIL`.

## Se algo travar

- **Cadastro falha**: confere `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`, se as tabelas existem, e se o e-mail já não está cadastrado (a coluna é `unique`).
- **Login falha**: confere se a conta foi criada depois da coluna `password_hash` existir — contas antigas sem senha não conseguem logar até se recadastrarem.
- **"Link inválido"**: o token não bateu com nada nas tabelas `lawyers` ou `client_links` — confere no Table Editor do Supabase.
- **Teste não libera depois de marcar `paid`**: confere se marcou na linha certa (pelo e-mail) e se salvou de verdade.
- **Classificação não funciona**: confere `ANTHROPIC_API_KEY` e crédito na conta.
- **E-mail não chega**: confere `RESEND_API_KEY`/`FROM_EMAIL`; olha os logs em Vercel → projeto → Deployments → deploy → Functions → `send-email`.

## Sobre segurança do link

O link de um advogado é reutilizável e não expira por padrão — evita vazamento de documento pro e-mail errado, mas um link pode circular além do cliente pretendido. Duas travas contêm o estrago: o limite diário (`DAILY_LIMIT`) e, pra quem não pagou, o teste de `TRIAL_LIMIT` documentos. Existe também suporte a link de uso único por cliente (tabela `client_links`, função `/api/generate-client-link`), pra quando fizer sentido gerar um link novo por atendimento em vez de reutilizar o mesmo sempre.

## Próximos passos possíveis (não incluídos aqui)

- Tela dedicada pra gerar o link de uso único por cliente (a função de backend já existe)
- Pagamento automático com cartão/débito (Mercado Pago ou Asaas) substituindo a liberação manual por PIX
- Painel pro advogado ver o histórico de documentos recebidos
- Salvar direto numa pasta do Google Drive em vez de e-mail
