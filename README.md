# Organizador de Documentos

Fluxo em um clique só: o cliente sobe os documentos e aperta "Enviar" — a classificação, montagem do PDF e envio por e-mail rodam em sequência, sem passo intermediário. Aceita foto e PDF. Fotos viram página de PDF; PDFs enviados são unidos de verdade (não redesenhados). A IA também detecta se a foto está de ponta-cabeça ou de lado e gira a página automaticamente. Dentro de cada tipo de documento, tenta extrair a data de competência (ex: mês do holerite) e ordena os documentos por ela antes de juntar — quando não identifica data, mantém a ordem de envio.

Duas telas:

- **`/cadastro.html`** — o advogado se cadastra com nome e e-mail e recebe um link único.
- **`/` (index.html)** — o cliente abre o link do advogado, sobe fotos, a IA classifica, e os PDFs organizados chegam por e-mail direto pro advogado dono daquele link.

Cada advogado cadastrado tem seu próprio token embutido no link — os documentos de um advogado nunca vão parar no e-mail de outro.

## O que você precisa antes de começar

1. **Anthropic** — [console.anthropic.com](https://console.anthropic.com), seção "API Keys". Pago por uso (poucos centavos por documento classificado).
2. **Resend** — [resend.com](https://resend.com), tem plano grátis que cobre bem esse volume. Pegue a chave em "API Keys".
3. **Supabase** — [supabase.com](https://supabase.com), plano grátis. É onde ficam guardados os advogados cadastrados (nome, e-mail, token).
4. **Vercel** — [vercel.com](https://vercel.com), grátis, hospeda o site.
5. **GitHub** — pra o Vercel puxar o projeto de lá.

## Passo a passo

### 1. Crie o projeto no Supabase

- Crie um projeto novo em [supabase.com](https://supabase.com)
- Vá em "SQL Editor" e rode:

```sql
create table lawyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  token text not null unique,
  created_at timestamptz default now()
);

create table usage_events (
  id bigserial primary key,
  token text not null,
  created_at timestamptz default now()
);

create index usage_events_token_idx on usage_events (token, created_at);
```

- Vá em "Project Settings" → "API". Copie a **Project URL** (vira `SUPABASE_URL`) e a chave **service_role** (vira `SUPABASE_SERVICE_KEY` — nunca use a chave `anon` aqui, essa fica só no servidor).

### 2. Suba o projeto pro GitHub

Crie um repositório novo e suba esta pasta inteira nele.

### 3. Conecte no Vercel

- "Add New" → "Project" → escolha o repositório
- Não precisa mexer em configuração de build

### 4. Configure as variáveis de ambiente

Em Settings → Environment Variables do projeto no Vercel:

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | sua chave da Anthropic |
| `RESEND_API_KEY` | sua chave do Resend |
| `FROM_EMAIL` | `onboarding@resend.dev` (pra testar) ou um e-mail do seu domínio verificado no Resend |
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_SERVICE_KEY` | chave `service_role` do Supabase |
| `DAILY_LIMIT` | opcional — quantos documentos por dia cada advogado pode classificar antes de ser bloqueado. Padrão: `60` |

### 5. Deploy

Clique em "Deploy". Em menos de um minuto você tem um link tipo `organizador-documentos.vercel.app`.

## Testando

1. Abra `organizador-documentos.vercel.app/cadastro.html`, cadastra um nome e e-mail de teste, copia o link gerado.
2. Abre esse link (algo como `organizador-documentos.vercel.app/?token=xxxxx`) numa aba anônima, simulando o cliente.
3. Digita um nome, sobe umas fotos, classifica, confere, envia.
4. O e-mail deve chegar no endereço que você cadastrou no passo 1.

## Sobre o Resend e o `FROM_EMAIL`

Com `onboarding@resend.dev` como remetente, o Resend permite enviar sem verificar domínio, mas com limitações de teste (geralmente só entrega pro e-mail cadastrado na sua conta Resend). Pra usar com advogados de verdade, verifique um domínio próprio no Resend ("Domains" no painel deles) e use um e-mail desse domínio como `FROM_EMAIL`.

## Se algo travar

- **Cadastro não gera link**: confere `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`, e se a tabela `lawyers` foi criada certinho.
- **Link mostra "Link inválido"**: o token não bateu com nenhum registro na tabela — confere se o cadastro realmente salvou (dá uma olhada na tabela pelo painel do Supabase, aba "Table Editor").
- **Classificação não funciona**: confere `ANTHROPIC_API_KEY` e crédito na conta Anthropic.
- **E-mail não chega**: confere `RESEND_API_KEY` e `FROM_EMAIL`; olha os logs em Vercel → projeto → "Deployments" → deploy → "Functions" → `send-email`.
- **PDFs geram mas o envio falha**: o site já cobre isso — mostra aviso e deixa baixar cada PDF na mão como reserva.

## Sobre compartilhamento do link

Hoje o link de um advogado é o mesmo pra todos os clientes dele — reutilizável, não expira. Isso já resolve o risco principal (documento ir pro e-mail errado). Se o link circular além do cliente pretendido, o dano fica contido: existe um limite diário de documentos por advogado (`DAILY_LIMIT`), então ninguém consegue estourar sua conta na API mesmo se o link vazar. Se o volume legítimo de algum advogado crescer além do limite padrão, é só ajustar a variável no Vercel. Se o volume crescer a ponto de exigir mais controle, o próximo passo é gerar um link descartável por cliente (usa uma vez, expira).

## Próximos passos possíveis (não incluídos aqui)

- Link individual e descartável por cliente, em vez de um link fixo por advogado
- Painel pra o advogado ver o histórico de documentos recebidos
- Salvar direto numa pasta do Google Drive em vez de e-mail
- Cobrança/assinatura, se decidir abrir pra outros advogados além da família
