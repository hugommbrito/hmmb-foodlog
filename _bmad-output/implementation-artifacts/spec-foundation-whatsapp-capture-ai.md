---
title: 'Spec A — Backend Core + WhatsApp Photo Capture'
type: 'feature'
created: '2026-06-15'
status: 'done'
baseline_commit: '4503f05c3ec67371083343f6ddf5fb06c83d8958'
context:
  - _bmad-output/specs/spec-foodlog/data-model.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O projeto está em branco — sem backend, autenticação ou endpoint de captura, nenhuma entrada de dados é possível.

**Approach:** Criar projeto Node.js + Fastify + TypeScript com PostgreSQL (Railway), integrar webhook Z-API para receber fotos via WhatsApp, autenticar por número cadastrado no banco, salvar fotos no Cloudflare R2 e confirmar recebimento ao usuário em ≤10s. Entries ficam com `ai_confidence_overall: 0.0` e `ai_cycles: 0` aguardando o pipeline de IA (Spec B).

## Boundaries & Constraints

**Always:**
- Números de WhatsApp não cadastrados: silenciosamente ignorados — zero resposta, zero persistência (CAP-10)
- Confirmação "📸 Foto recebida!" enviada ao usuário em ≤10s após webhook recebido
- Foto salva no R2 antes de INSERT no banco; `photos` contém array de URLs públicas R2
- Entry criada com `reviewed: false`, `ai_confidence_overall: 0.0`, `ai_cycles: 0`
- Webhook Z-API sempre retorna HTTP 200 — evita retry automático do Z-API em qualquer cenário
- Cada mensagem WhatsApp com foto = uma Entry independente

**Ask First:**
- Número de WhatsApp do Hugo para seed inicial do banco
- Credenciais: Z-API instance ID + token, Cloudflare R2 bucket + access key + secret key + account ID
- URL pública Railway para configurar o webhook no painel Z-API

**Never:**
- Login, senha, OAuth ou token de sessão exposto ao usuário
- Análise da IA ou BullMQ/Redis — escopo da Spec B
- UI de revisão, relatórios, link nutricionista, busca — diferidos
- Estrutura de refeição obrigatória (café/almoço/jantar)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Foto de número cadastrado | Webhook Z-API, `imageMessage`, número no banco | Entry criada, foto no R2, "📸 Foto recebida!" enviado ao usuário | — |
| Número desconhecido | Webhook Z-API, número ausente no banco | Nada persistido, sem resposta ao usuário | HTTP 200 ao Z-API |
| Mensagem não-foto de número cadastrado | Webhook Z-API, tipo ≠ imagem | Ignorado silenciosamente | HTTP 200 ao Z-API |
| Upload R2 falha | Erro de credencial ou rede | Entry não criada | Log error; sem resposta ao usuário; HTTP 200 ao Z-API |

</frozen-after-approval>

## Code Map

- `src/server.ts` -- entry point; inicia Fastify na PORT configurada
- `src/app.ts` -- instância Fastify; registro de plugins e rotas
- `src/config.ts` -- Zod schema para todas as env vars; processo termina com erro explícito se ausente
- `src/db/client.ts` -- pool pg singleton via DATABASE_URL; helper `query<T>(sql, params): Promise<T[]>`
- `src/db/migrations/001_initial_schema.sql` -- tabelas users, entries, food_items
- `src/types/models.ts` -- interfaces TypeScript alinhadas com data-model.md
- `src/services/storage.ts` -- `uploadPhoto(buffer, key): Promise<string>` via AWS SDK v3 S3-compatible (R2)
- `src/services/whatsapp.ts` -- `extractPhotoFromWebhook(payload)` + `sendTextMessage(phone, text)` via Z-API HTTP API
- `src/routes/webhook.ts` -- POST /webhook/whatsapp — handler principal
- `src/routes/health.ts` -- GET /health — liveness check
- `.env.example` -- todas as variáveis com comentários explicativos
- `railway.json` -- configuração de deploy

## Tasks & Acceptance

**Execution:**
- [x] `package.json` + `tsconfig.json` + `.env.example` -- inicializar projeto; deps: `fastify`, `pg`, `@aws-sdk/client-s3`, `zod`, `dotenv`; devDeps: `typescript`, `tsx`, `@types/pg`; scripts: `build`, `start`, `dev`, `db:migrate`
- [x] `src/config.ts` -- Zod schema validando `DATABASE_URL`, `REDIS_URL` (placeholder para Spec B), `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `PORT`; falha com mensagem clara no startup
- [x] `src/db/migrations/001_initial_schema.sql` -- `users(id UUID PK DEFAULT gen_random_uuid(), phone_number TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now())` · `entries(id UUID PK DEFAULT gen_random_uuid(), user_id UUID REFERENCES users NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), photos TEXT[] NOT NULL, title TEXT, context TEXT CHECK (context IN ('casa','restaurante','trabalho','rua')), ai_confidence_overall FLOAT DEFAULT 0.0, reviewed BOOL DEFAULT false, ai_cycles INT DEFAULT 0)` · `food_items(id UUID PK DEFAULT gen_random_uuid(), entry_id UUID REFERENCES entries ON DELETE CASCADE NOT NULL, description TEXT NOT NULL, quantity TEXT, kcal FLOAT, protein_g FLOAT, fat_g FLOAT, carbs_g FLOAT, confidence FLOAT NOT NULL)` · índice `entries(user_id, created_at DESC)`
- [x] `src/db/client.ts` -- pool pg; exporta `query<T>`
- [x] `src/types/models.ts` -- interfaces `User`, `Entry`, `FoodItem` espelhando data-model.md; tipo `WebhookPayload` para Z-API
- [x] `src/services/storage.ts` -- `uploadPhoto(buffer, filename)`: PutObjectCommand para R2 via endpoint `https://<account_id>.r2.cloudflarestorage.com`; retorna URL pública
- [x] `src/services/whatsapp.ts` -- `extractPhotoFromWebhook`: detecta `imageMessage` no payload, baixa mídia via GET `https://api.z-api.io/instances/<id>/token/<token>/download-media` com a mediaUrl; retorna `{buffer, mimetype}` ou `null`; `sendTextMessage`: POST para endpoint send-text Z-API
- [x] `src/routes/webhook.ts` -- (1) busca `users` por `phone_number`; se não encontrado → HTTP 200; (2) chama `extractPhotoFromWebhook`; se null → HTTP 200; (3) `uploadPhoto`; se falha → log + HTTP 200; (4) INSERT entry; (5) `sendTextMessage("📸 Foto recebida!")` ; (6) HTTP 200 `{received: true}`
- [x] `src/routes/health.ts` -- GET /health → `{status: "ok"}`
- [x] `src/app.ts` + `src/server.ts` -- monta app Fastify; registra `/webhook/whatsapp` e `/health`; inicia servidor
- [x] `railway.json` -- `{"deploy": {"startCommand": "npm run build && node dist/server.js", "healthcheckPath": "/health"}}`

**Acceptance Criteria:**
- Dado número cadastrado no banco, quando Z-API envia webhook com foto, então entry existe no banco com `photos` preenchido, arquivo está no R2, e usuário recebeu "📸 Foto recebida!" — tudo em ≤10s
- Dado número não cadastrado, quando webhook chega, então zero rows em `entries` e zero mensagens enviadas
- Dado mensagem de texto (não foto) de número cadastrado, quando webhook chega, então zero rows criados e HTTP 200 retornado
- Dado falha no upload R2, então entry não criada e sem resposta ao usuário
- `GET /health` retorna HTTP 200 com `{status: "ok"}`

## Verification

**Commands:**
- `npm run build` -- expected: zero erros TypeScript
- `psql $DATABASE_URL -f src/db/migrations/001_initial_schema.sql` -- expected: tabelas criadas sem erro
- `curl -s localhost:3000/health` -- expected: `{"status":"ok"}`
- `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/webhook/whatsapp -H "Content-Type: application/json" -d '{"data":{"phone":"5511999999999","message":{}}}' ` -- expected: `200`

**Manual checks:**
- Enviar foto real via WhatsApp → confirmar "📸 Foto recebida!" em ≤10s + row em `entries` + arquivo no R2

## Suggested Review Order

**Auth + Segurança**

- Verificação do webhook secret (ZAPI_WEBHOOK_SECRET) e guard `fromMe`
  [`webhook.ts:17`](../../src/routes/webhook.ts#L17)

- Timeout + size cap no download de imagem (8s / 20 MB)
  [`whatsapp.ts:22`](../../src/services/whatsapp.ts#L22)

- Validação do tipo de `phone` antes do DB lookup
  [`webhook.ts:29`](../../src/routes/webhook.ts#L29)

**Fluxo principal (happy path)**

- Handler completo: auth → lookup → extração → download → upload → insert → ACK
  [`webhook.ts:12`](../../src/routes/webhook.ts#L12)

- Extração da imageUrl do payload Z-API
  [`whatsapp.ts:12`](../../src/services/whatsapp.ts#L12)

- Upload para R2 com mimetype correto e URL pública configurável
  [`storage.ts:13`](../../src/services/storage.ts#L13)

- Envio da confirmação com timeout (8s)
  [`whatsapp.ts:56`](../../src/services/whatsapp.ts#L56)

**Confiabilidade**

- try/catch no INSERT — evita orfanagem de arquivo R2 em falha de DB
  [`webhook.ts:63`](../../src/routes/webhook.ts#L63)

**Schema + Configuração**

- Tabela `entries` com todos os campos do data-model
  [`001_initial_schema.sql:9`](../../src/db/migrations/001_initial_schema.sql#L9)

- Env vars: REDIS_URL opcional, ZAPI_WEBHOOK_SECRET opcional, R2_PUBLIC_URL obrigatório
  [`config.ts:7`](../../src/config.ts#L7)

- Documentação de R2_PUBLIC_URL com opções R2.dev e domínio próprio
  [`.env.example:20`](../../.env.example#L20)

**Periféricos**

- Interfaces TypeScript alinhadas com data-model.md
  [`models.ts:1`](../../src/types/models.ts#L1)

- Pool pg singleton com SSL adaptado ao Railway
  [`client.ts:3`](../../src/db/client.ts#L3)

- Fastify app factory + startup
  [`app.ts:1`](../../src/app.ts#L1)
