# hmmb-foodlog

Backend para registro alimentar por foto via WhatsApp — captura em menos de 10 segundos, enriquecimento por IA de forma assíncrona, histórico consultável com nutricionista.

---

## Por que existe

Apps de diário alimentar falham porque exigem preenchimento no momento mais inconveniente: durante a refeição. Este projeto resolve o gargalo da **captura**: a foto vai pelo WhatsApp em segundos, e a inteligência (IA) enriquece os dados depois, sem travar o usuário.

---

## Arquitetura geral

```
Entradas de captura:
  • iPhone / WhatsApp  ──►  Z-API Webhook   (POST /webhook/whatsapp)
  • iPhone Shortcut    ──►  Endpoint REST   (POST /entries/photo, multipart + auth Bearer)
                                  │
                                  ▼
  [BACKEND — Fastify]
       │
       ├──► PostgreSQL       (usuários, entradas, itens alimentares)
       ├──► Cloudflare R2    (fotos em formato permanente)
       ├──► Z-API            (confirmação de recebimento ao usuário)
       └──► Redis (BullMQ)   (fila de análise assíncrona)
                │
                ▼
          [WORKER — analyze-entry]
                │
                └──► Claude Sonnet  (visão: identificação de alimentos e macros)
                └──► PostgreSQL     (persistência dos food_items e scores)

       [futuro]
       └──► Web app  (revisão de entradas, relatórios, link para nutricionista)
```

---

## Status de implementação

| Etapa | Status |
|---|---|
| Webhook WhatsApp (recepção de fotos) | ✅ Implementado |
| Autenticação por número de telefone | ✅ Implementado |
| Upload de fotos para Cloudflare R2 | ✅ Implementado |
| Persistência no PostgreSQL | ✅ Implementado |
| Confirmação de recebimento via WhatsApp | ✅ Implementado |
| Pipeline de análise por IA (BullMQ + Claude vision) | ✅ Implementado |
| Endpoint REST de captura (`POST /entries/photo`, p/ iPhone Shortcut) | ✅ Implementado |
| Autenticação por token Bearer (por-usuário) para o endpoint REST | ✅ Implementado |
| Web app de revisão de entradas | 🔜 Pendente |
| Correção via WhatsApp (texto / áudio) | 🔜 Pendente |
| Relatório semanal de padrões | 🔜 Pendente |
| Link temporário para nutricionista | 🔜 Pendente |
| Busca por alimento no histórico | 🔜 Pendente |
| Atalho iOS (Shortcut) configurado no aparelho | 🔜 Pendente (backend pronto) |

---

## O que está implementado

### Captura de fotos via WhatsApp

O backend recebe fotos enviadas pelo usuário no WhatsApp e as persiste automaticamente.

**Fluxo completo:**
1. Usuário envia foto pelo WhatsApp
2. Z-API encaminha o evento para o endpoint `POST /webhook/whatsapp`
3. O sistema verifica se o número está cadastrado no banco
4. A foto é baixada da URL fornecida pela Z-API (timeout de 8 s, limite de 20 MB)
5. A foto é enviada para o bucket Cloudflare R2
6. Uma entrada (`entry`) é criada no PostgreSQL com o URL público da foto
7. Um job de análise é enfileirado no Redis (fire-and-forget — não bloqueia a resposta)
8. O usuário recebe `📸 Foto recebida!` de confirmação no WhatsApp

Mensagens enviadas pelo próprio bot (`fromMe: true`) e números não cadastrados são silenciosamente ignoradas. O webhook sempre responde HTTP 200 para evitar reenvios automáticos pelo Z-API.

### Pipeline de análise por IA (assíncrona)

Após a captura, um worker processa cada entrada em background via fila BullMQ + Redis.

**Fluxo do worker:**
1. Recebe o `entryId` da fila `analyze-entry`
2. Busca a entrada no banco (ignora se `ai_cycles > 0` — evita duplicações)
3. Carrega os **20 alimentos distintos mais frequentes** do usuário como contexto de calibração
4. Busca as fotos do R2 e as converte para base64
5. Envia para **Claude Sonnet** (`claude-sonnet-4-6`) com visão — retorna JSON estruturado
6. Em transação: atualiza `entries` (título, confidence, ai_cycles) e insere os `food_items`

O job tem **3 tentativas** com backoff exponencial (1 s, 2 s, 4 s) em caso de falha.

### Captura de fotos via endpoint REST (`POST /entries/photo`)

Caminho de captura alternativo ao WhatsApp, pensado para o **iPhone Shortcut** (widget/Siri) ou qualquer cliente externo — captura em ≤10 s sem depender do bot.

**Fluxo completo:**
1. Cliente faz `POST /entries/photo` com uma ou mais imagens em `multipart/form-data`
2. O header `Authorization: Bearer <token>` é validado contra a coluna `users.api_token` (resolve o usuário)
3. Cada foto é validada (mimetype `image/*`, ≤20 MB, não-vazia) e enviada ao Cloudflare R2
4. **Uma única** `entry` é criada com o array de todas as fotos (ângulos diferentes da mesma refeição)
5. Um job de análise é enfileirado (fire-and-forget)
6. Resposta `201 { entry_id }`

Diferente do webhook, este endpoint usa **códigos HTTP corretos**: `401` (token ausente/inválido), `400` (sem arquivo / não-imagem / vazio), `413` (foto >20 MB ou fotos demais), `500` (falha no R2/banco). Limite de 10 fotos por requisição.

### Autenticação por número de telefone

Sem login, senha ou OAuth. O cadastro de usuários autorizados é feito diretamente no banco:

```sql
INSERT INTO users (phone_number) VALUES ('5511999999999');
```

Apenas números presentes na tabela `users` têm suas mensagens processadas.

### Autenticação por token (endpoint REST)

O endpoint `POST /entries/photo` usa um token Bearer por-usuário, armazenado na coluna `users.api_token`. O token é provisionado manualmente no banco:

```sql
UPDATE users SET api_token = 'token-secreto-aqui' WHERE phone_number = '5511999999999';
```

A requisição envia `Authorization: Bearer token-secreto-aqui`; o token resolve o usuário dono da entrada. Tokens vazios/ausentes retornam `401`. (O token é guardado em texto puro — adequado ao uso pessoal atual; ver `deferred-work.md` para hashing futuro.)

### Armazenamento de fotos (Cloudflare R2)

Fotos são armazenadas com a chave `photos/{user_id}/{timestamp}-{uuid}` e acessadas via URL pública configurável. A URL é persistida na coluna `photos TEXT[]` da tabela `entries`.

### Banco de dados PostgreSQL

Três tabelas principais:

- **`users`** — número de telefone como identificador único
- **`entries`** — cada foto enviada gera uma entrada; campos de IA (`title`, `ai_confidence_overall`, `ai_cycles`) são preenchidos pelo worker
- **`food_items`** — itens identificados pela IA, com campos nutricionais por item (kcal, proteína, gordura, carboidratos, confidence)

### Health check

`GET /health` retorna `{ "status": "ok" }` — usado pelo Railway para monitoramento.

---

## Como configurar e rodar

### Pré-requisitos

- Node.js 20+
- PostgreSQL (local ou Railway)
- Redis (local ou Railway)
- Conta na [Z-API](https://z-api.io) com instância WhatsApp conectada
- Bucket Cloudflare R2 com URL pública habilitada
- Chave de API da Anthropic (para Claude Sonnet)

### 1. Clonar e instalar dependências

```bash
git clone <repo>
cd hmmb-foodlog
npm install
```

### 2. Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz com:

```env
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://usuario:senha@host:5432/banco

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Anthropic (Claude vision)
ANTHROPIC_API_KEY=sk-ant-...

# Z-API (WhatsApp)
ZAPI_INSTANCE=sua-instancia
ZAPI_TOKEN=seu-token
ZAPI_WEBHOOK_SECRET=segredo-opcional   # valida o header client-token

# Cloudflare R2
R2_BUCKET=nome-do-bucket
R2_ACCOUNT_ID=id-da-conta
R2_ACCESS_KEY=chave-de-acesso
R2_SECRET_KEY=chave-secreta
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
```

### 3. Criar o schema do banco

```bash
npm run db:migrate
```

Um runner em `tsx` (`src/db/migrate.ts`) carrega o `.env` automaticamente (via `config.ts`) e aplica **todos** os arquivos `src/db/migrations/*.sql` em ordem: `001` cria as tabelas `users`, `entries` e `food_items`; `002` adiciona a coluna `users.api_token`. As migrations são idempotentes. (Não depende do `psql` instalado nem de exportar `DATABASE_URL` no shell.)

### 4. Cadastrar um usuário autorizado

```sql
INSERT INTO users (phone_number) VALUES ('5511999999999');
-- Formato: DDI + DDD + número, sem espaços ou símbolos
```

### 5. Rodar em desenvolvimento

```bash
npm run dev
```

O servidor e o worker sobem no mesmo processo.

### 6. Configurar o webhook no Z-API

No painel da Z-API, aponte o webhook de mensagens recebidas para:

```
https://seu-dominio.com/webhook/whatsapp
```

Se usar `ZAPI_WEBHOOK_SECRET`, configure o mesmo valor no campo "Client Token" do painel Z-API.

### 7. Deploy (Railway)

O arquivo `railway.json` está configurado para o builder **Nixpacks** e define o ciclo completo:

| Fase | Comando | O que faz |
|---|---|---|
| Build | `npm run build` | Compila TypeScript para `dist/` |
| Pré-deploy | `npm run db:migrate` | Aplica todas as migrations **automaticamente** a cada deploy (idempotente) |
| Start | `node dist/server.js` | Sobe o servidor Fastify + worker BullMQ no mesmo processo |

- **Healthcheck:** `GET /health`. **Restart:** `ON_FAILURE` (até 10 tentativas).
- **Versão do Node:** fixada em 20 via `.nvmrc` + `engines` no `package.json`.
- **Serviços a adicionar no projeto Railway:** PostgreSQL e Redis (plugins) — depois preencha `DATABASE_URL` e `REDIS_URL` nas variáveis.
- **Variáveis de ambiente:** configure no painel do Railway todas as do `.env.example` (`DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `ZAPI_*`, `R2_*`). `PORT` é injetada pelo Railway.
- **Observação:** o pré-deploy usa `tsx` (devDependency); não habilite poda de devDependencies (`NPM_CONFIG_PRODUCTION`/`--omit=dev`), senão a migration não roda.

---

## O que está pendente

### Web app de revisão

Interface responsiva para o usuário revisar as entradas do dia:

- Entradas triadas por nível de confiança da IA (verde ≥85%, amarelo/laranja <70%)
- Um toque para aceitar, dois toques para corrigir
- Revisão de um dia normal em ≤2 minutos

### Correção via WhatsApp

Bot que aceita respostas em texto livre ou áudio para corrigir entradas já analisadas, disparando novo ciclo de análise (suportado pelo campo `ai_cycles` já existente no banco).

### Relatório semanal

Gerado automaticamente, sem ação do usuário — disponível no web app com padrões comportamentais (horários, variação de macros, correlações contexto × escolhas).

### Link para nutricionista

Geração de link com prazo de validade configurável, sem necessidade de cadastro pelo profissional. Exibe calendário com miniaturas, lista completa com macros e análise de padrões.

### Busca no histórico

Busca por nome de alimento, retornando todas as entradas onde a IA identificou aquele alimento, em ordem cronológica.

### iPhone Shortcut (lado iOS)

O **backend já está pronto** (`POST /entries/photo` — ver "O que está implementado"). Falta apenas montar o atalho iOS: abrir a câmera, enviar a foto via "Get Contents of URL" com o header Bearer, captura completa em ≤10 segundos a partir do widget ou Siri.

---

## Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Inicia o servidor em modo desenvolvimento (sem compilar, via `tsx`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Inicia o servidor a partir do build compilado |
| `npm run db:migrate` | Aplica todas as migrations (`src/db/migrations/*.sql`) via runner `tsx`, carregando o `.env` automaticamente |

---

## Estrutura do projeto

```
src/
├── server.ts          # Ponto de entrada (inicia Fastify + worker BullMQ)
├── app.ts             # Factory do Fastify (buildApp)
├── config.ts          # Validação de env vars via Zod
├── types/
│   └── models.ts      # Interfaces TypeScript (User, Entry, FoodItem, AiAnalysisResult…)
├── db/
│   ├── client.ts      # Pool PostgreSQL + função query<T>()
│   ├── migrate.ts     # Runner de migrations (tsx): aplica todos os .sql em ordem
│   └── migrations/
│       ├── 001_initial_schema.sql
│       └── 002_add_users_api_token.sql
├── queues/
│   └── entry.ts       # Fila BullMQ + conexão Redis (enqueueAnalysis)
├── routes/
│   ├── health.ts      # GET /health
│   ├── webhook.ts     # POST /webhook/whatsapp
│   └── entries.ts     # POST /entries/photo (captura REST, auth Bearer)
├── services/
│   ├── ai.ts          # Chamada Claude Sonnet vision + parse do JSON de resposta
│   ├── storage.ts     # Upload para Cloudflare R2
│   └── whatsapp.ts    # Download de foto + envio de mensagem via Z-API
└── workers/
    └── analyze-entry.ts  # Worker BullMQ: busca entry → contexto → IA → persiste
```

---

## Decisões de design notáveis

- **Webhook sempre retorna 200** — qualquer outro status dispara retries automáticos do Z-API, causando duplicações.
- **Upload R2 antes do INSERT** — se o banco falhar após o upload, a foto fica órfã no R2 (aceitável); se o R2 falhar, nada é persistido.
- **Enfileiramento fire-and-forget** — o webhook não aguarda a análise de IA; o job é enfileirado após o INSERT e erros de enfileiramento são apenas logados, sem afetar a resposta ao usuário.
- **Idempotência do worker** — jobs com `ai_cycles > 0` são descartados, protegendo contra reprocessamento em caso de retries.
- **Transação no worker** — o UPDATE de `entries` e os INSERTs de `food_items` acontecem em uma única transação; falha em qualquer item faz rollback completo, permitindo nova tentativa limpa.
- **Contexto calibrado de IA** — os 20 alimentos distintos mais frequentes do usuário são passados como calibração; nunca o histórico bruto completo.
- **Autenticação por telefone** — uso pessoal; sem login/senha/OAuth; cadastro manual no banco.
- **Endpoint REST com códigos HTTP corretos** — diferente do webhook (que sempre responde 200 por exigência do Z-API), `POST /entries/photo` retorna 201/400/401/413/500. Múltiplas fotos na mesma requisição viram **uma** entrada (ângulos da mesma refeição); o upload ao R2 também ocorre antes do INSERT.
