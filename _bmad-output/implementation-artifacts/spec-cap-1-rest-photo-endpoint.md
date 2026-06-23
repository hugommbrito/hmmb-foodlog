---
title: 'CAP-1 — Endpoint REST de captura de foto (iPhone Shortcut)'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: '3aa943b89b8f9a6da0e54a6ad24a078c3d515186'
context:
  - _bmad-output/project-context.md
  - _bmad-output/specs/spec-foodlog/SPEC.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A captura de fotos hoje só existe via webhook do WhatsApp. CAP-1 exige um caminho de captura em ≤10s a partir do iPhone (Shortcut/widget/Siri) sem depender do WhatsApp.

**Approach:** Adicionar `POST /entries/photo` que recebe 1+ imagens via `multipart/form-data`, autentica por token Bearer por-usuário (nova coluna `api_token`), faz upload das fotos no R2, cria UMA Entry com o array de fotos e enfileira a análise de IA — reusando exatamente o fluxo R2→INSERT→enqueue do webhook.

## Boundaries & Constraints

**Always:**
- Upload R2 ANTES do INSERT; Entry criada com `reviewed: false`, `ai_confidence_overall: 0.0`, `ai_cycles: 0`; `food_items` vazio.
- `photos` sempre como array `TEXT[]`, mesmo com 1 foto. Chave R2 no formato `photos/{user_id}/{timestamp}-{uuidv4}`.
- Acessar env só via `config.ts`; SQL parametrizado (`$1,$2`); `query<T>()` de `db/client.ts`; integração externa em `src/services/`, tipos em `models.ts`.
- Validar tamanho ≤ `MAX_PHOTO_BYTES` (20MB) por foto e mimetype `image/*` antes do upload.
- Após enfileirar, enfileiramento é fire-and-forget (não bloqueia a resposta), igual ao webhook.

**Ask First:**
- Qualquer mudança no schema além de adicionar `users.api_token`.
- Adicionar geração/rotação de token via endpoint (provisionar token é manual via SQL por ora).

**Never:**
- NÃO retornar 200 para tudo (isso é regra exclusiva do webhook Z-API); este endpoint REST usa códigos HTTP corretos.
- NÃO criar uma Entry por foto — múltiplas fotos da mesma requisição = 1 Entry.
- NÃO chamar Claude/IA inline (continua assíncrono via fila).
- NÃO aceitar campo `context`/`meal_type` nesta fase (captura livre); sem frontend; sem suíte de testes nova (projeto não tem harness — verificação por build + curl manual).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1 foto | Bearer válido + 1 imagem | 201 `{ entry_id }`; 1 Entry `photos=[url]`; análise enfileirada | N/A |
| N fotos | Bearer válido + N imagens | 201 `{ entry_id }`; 1 Entry `photos=[url1..urlN]` | N/A |
| Token ausente/inválido | sem header `Authorization` ou token desconhecido | 401 `{ error }` | zero persistência |
| Sem arquivo | Bearer válido, multipart sem nenhum file | 400 `{ error }` | zero persistência |
| Não-imagem | Bearer válido + arquivo mimetype ≠ `image/*` | 400 `{ error }` | rejeita antes do upload |
| Foto > 20MB | arquivo excede `MAX_PHOTO_BYTES` | 413 `{ error }` | plugin aborta; nada persistido |
| Falha no R2 | `uploadPhoto` lança | 500 `{ error }` | nenhum INSERT |
| Falha no INSERT | INSERT lança após upload(s) | 500 `{ error }` | fotos ficam órfãs no R2 (aceitável) |

</frozen-after-approval>

## Code Map

- `src/db/migrations/002_add_users_api_token.sql` -- NOVO: `ALTER TABLE users ADD COLUMN api_token`.
- `package.json` -- adicionar dep `@fastify/multipart`; estender script `db:migrate` para rodar 002.
- `src/types/models.ts` -- adicionar `api_token: string | null` em `User`; tipo de resposta `{ entry_id: string }`.
- `src/app.ts` -- registrar `@fastify/multipart` e `entriesRoutes`.
- `src/routes/entries.ts` -- NOVO: handler `POST /entries/photo` (auth Bearer + parse multipart + R2 + INSERT + enqueue).
- `src/services/storage.ts` -- `uploadPhoto` reusado sem alteração.
- `src/queues/entry.ts` -- `enqueueAnalysis` reusado sem alteração.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/002_add_users_api_token.sql` -- criar com `ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE;` -- habilita auth por-usuário.
- [x] `package.json` -- adicionar `@fastify/multipart` em dependencies e alterar `db:migrate` para `psql $DATABASE_URL -f .../001...sql && psql $DATABASE_URL -f .../002...sql` -- registra a dep e roda a migration nova (001 é idempotente).
- [x] `src/types/models.ts` -- adicionar `api_token: string | null` em `User` e exportar `PhotoCaptureResponse { entry_id: string }` -- tipagem sem tipos inline na rota.
- [x] `src/routes/entries.ts` -- implementar `POST /entries/photo`: extrair Bearer de `Authorization`, resolver usuário por `api_token` (401 se ausente/desconhecido); iterar `request.files()`, validar mimetype `image/*` e tamanho (400/413); fazer `uploadPhoto` de cada uma coletando URLs (500 em falha); INSERT de 1 Entry com `photos` array e invariantes; `enqueueAnalysis(entryId)` fire-and-forget; responder 201 `{ entry_id }` -- núcleo da capability.
- [x] `src/app.ts` -- `app.register(multipart, { limits: { fileSize: 20MB, files: <max> } })` e `app.register(entriesRoutes)` -- expõe a rota.

**Acceptance Criteria:**
- Given um usuário com `api_token` provisionado, when faz `POST /entries/photo` com Bearer correto e 2 imagens, then recebe 201 com `entry_id` e existe 1 Entry com `photos` de 2 URLs do R2 e `reviewed=false`, e um job `analyze-entry` foi enfileirado.
- Given um token ausente ou desconhecido, when chama o endpoint, then recebe 401 e nada é gravado no R2 nem no banco.
- Given um arquivo não-imagem ou acima de 20MB, when é enviado, then recebe 400/413 respectivamente e nenhuma Entry é criada.

## Spec Change Log

## Verification

**Commands:**
- `npm install` -- expected: `@fastify/multipart` v9 instalado (compatível com Fastify 5 — v8 trava o boot com `expected '4.x'`).
- `npm run build` -- expected: `tsc` compila sem erros (strict mode).
- boot test (`app.register(multipart)` + `app.ready()`) -- expected: `BOOT OK`, sem erro de versão do `fastify-plugin`.
- `npm run db:migrate` -- expected: coluna `api_token` presente em `users` (requer DATABASE_URL).

**Manual checks (if no CLI):**
- Provisionar token: `UPDATE users SET api_token='<token>' WHERE phone_number='<num>';`
- `curl -X POST $URL/entries/photo -H "Authorization: Bearer <token>" -F "photo=@a.jpg" -F "photo=@b.jpg"` → 201 `{ entry_id }`.
- Repetir sem header → 401; com arquivo `.txt` → 400.

## Suggested Review Order

**Autenticação por token**

- Ponto de entrada: handler do endpoint e resolução do usuário por `api_token`.
  [`entries.ts:22`](../../src/routes/entries.ts#L22)
- Extração do Bearer com guard de token vazio/whitespace (evita autenticar `api_token=''`).
  [`entries.ts:8`](../../src/routes/entries.ts#L8)
- Migration que adiciona a coluna `api_token` (UNIQUE, idempotente).
  [`002_add_users_api_token.sql:1`](../../src/db/migrations/002_add_users_api_token.sql#L1)

**Parsing multipart e validação**

- Loop que drena TODAS as partes (evita hang do plugin) e valida mimetype/zero-byte acumulando erro.
  [`entries.ts:48`](../../src/routes/entries.ts#L48)
- Mapeamento de erros do plugin: too-large e too-many → 413; resto → 400.
  [`entries.ts:65`](../../src/routes/entries.ts#L65)
- Registro do plugin com limites de tamanho/quantidade (compatível com Fastify 5 via v9).
  [`app.ts:13`](../../src/app.ts#L13)

**Persistência (R2 antes do INSERT)**

- Upload de cada foto ao R2 coletando URLs; falha → 500 sem INSERT.
  [`entries.ts:87`](../../src/routes/entries.ts#L87)
- INSERT de UMA Entry com array de fotos e invariantes (`reviewed=false`, IA zerada); enqueue fire-and-forget; 201.
  [`entries.ts:97`](../../src/routes/entries.ts#L97)

**Periféricos**

- Tipos `User.api_token` e `PhotoCaptureResponse`.
  [`models.ts:1`](../../src/types/models.ts#L1)
- Dependência v9 e `db:migrate` encadeando a migration 002.
  [`package.json:11`](../../package.json#L11)
