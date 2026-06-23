---
title: 'Análise da IA em pt-BR e retorno dos resultados na captura de foto'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: '9a13891dfc908d21c22dccf91a938fca6dad1fc0'
context: ['{project-root}/_bmad-output/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O prompt da IA não garante saída em português (a instrução atual está mal concatenada e fraca), e a rota `POST /entries/photo` responde apenas `{ entry_id }`, sem expor o resultado da análise — o cliente (iPhone Shortcut) não tem como ver título, calorias e itens identificados.

**Approach:** Reescrever o prompt para forçar JSON com campos textuais (`title`, `description`, `quantity`) em pt-BR. Tornar o `POST /entries/photo` síncrono, aguardando o job da fila terminar (`QueueEvents.waitUntilFinished` com timeout) e devolvendo a análise; e adicionar `GET /entries/:id` para consulta posterior. Worker e fila permanecem como estão.

## Boundaries & Constraints

**Always:**
- Manter a arquitetura de fila BullMQ — o POST aguarda o job existente terminar, não chama o Claude inline nem duplica a lógica do worker.
- Upload R2 antes do INSERT (invariante do projeto); a captura é considerada sucesso assim que a `entry` é persistida, mesmo que a análise falhe/expire.
- `GET /entries/:id` e o POST exigem o mesmo Bearer token e só retornam entries do próprio usuário (filtrar por `user_id`).
- Chaves do JSON permanecem em inglês (vinculadas ao schema Zod e às colunas); apenas os valores textuais vão para pt-BR.
- Novas env vars no schema Zod de `config.ts` E no `.env.example`.

**Ask First:**
- Alterar o timeout padrão de espera para um valor que segure a conexão HTTP por muito mais que ~50s.

**Never:**
- Não criar autenticação nova (continua por token no banco).
- Não inserir `food_items` fora do worker.
- Não alterar o fluxo do webhook do WhatsApp.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| POST análise concluída | Foto válida + token válido | `201 { entry_id, analysis_status:'done', title, ai_confidence_overall, foods:[...] }` com valores em pt-BR | N/A |
| POST análise expira/falha | Job não termina no timeout ou falha | `201 { entry_id, analysis_status:'pending', foods:[] }` — captura preservada | Loga warning; não falha o request |
| GET concluído | `:id` próprio, `ai_cycles>0` | `200` entry + `analysis_status:'done'` + `foods` | N/A |
| GET pendente | `:id` próprio, `ai_cycles=0` | `200` entry + `analysis_status:'pending'` + `foods:[]` | N/A |
| GET inexistente/de outro usuário | `:id` ausente ou de outro `user_id` | `404 { error }` | N/A |
| GET/POST sem token | Authorization ausente/ inválido | `401 { error }` | N/A |

</frozen-after-approval>

## Code Map

- `src/services/ai.ts` -- `SYSTEM_PROMPT`: reescrever para forçar pt-BR nos valores textuais.
- `src/queues/entry.ts` -- expor `enqueueAnalysis` retornando o `Job` e adicionar `QueueEvents` + helper de espera; fechar no `closeQueue`.
- `src/routes/entries.ts` -- POST síncrono (aguarda job) + nova rota `GET /entries/:id`; helper compartilhado que monta a view (entry + food_items + `analysis_status`).
- `src/types/models.ts` -- adicionar `EntryAnalysisView` (resposta do GET) e atualizar `PhotoCaptureResponse`.
- `src/config.ts` + `.env.example` -- `ANALYSIS_WAIT_TIMEOUT_MS` (default `50000`).
- `src/db/client.ts` -- reusar `query<T>` para buscar `food_items` da entry.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/ai.ts` -- Reescrever `SYSTEM_PROMPT` com instrução clara e bem espaçada: responder SOMENTE JSON, com `title`/`description`/`quantity` em português do Brasil; manter estrutura/chaves em inglês.
- [x] `src/config.ts` + `.env.example` -- Adicionar `ANALYSIS_WAIT_TIMEOUT_MS` (Zod, default `'50000'`, transform Number).
- [x] `src/queues/entry.ts` -- `enqueueAnalysis` retorna `Promise<Job>`; criar `QueueEvents` (conexão própria) e `waitForAnalysis(job, timeoutMs)`; fechá-los em `closeQueue`.
- [x] `src/types/models.ts` -- Adicionar `EntryAnalysisView` (id, created_at, photos, title, context, ai_confidence_overall, reviewed, ai_cycles, analysis_status, foods); ajustar `PhotoCaptureResponse` para `{ entry_id, analysis_status, title, ai_confidence_overall, foods }`.
- [x] `src/routes/entries.ts` -- Helper `loadEntryView(entryId, userId)` (entry + food_items, `analysis_status` por `ai_cycles>0`); POST passa a `await enqueueAnalysis` → `waitForAnalysis` (try/catch p/ timeout) → responde com a view; adicionar `GET /entries/:id` com auth e checagem de dono.
- [x] Verificar compilação e revisar manualmente as respostas (sem suite de testes no projeto).

**Acceptance Criteria:**
- Given uma foto de comida e token válido, when `POST /entries/photo` e a análise conclui dentro do timeout, then a resposta `201` traz `analysis_status:'done'`, `title` e `foods` com textos em português.
- Given a análise não conclui no timeout, when o POST responde, then retorna `201` com `analysis_status:'pending'` e a entry permanece persistida (sem erro 5xx).
- Given uma entry de outro usuário, when `GET /entries/:id` com token que não é o dono, then retorna `404` (sem vazar dados).
- Given o servidor recém-iniciado, when `npm run build`, then compila sem erros de TypeScript.

## Design Notes

- `job.waitUntilFinished(queueEvents, ttlMs)` lança em timeout/falha — capturar e tratar como `pending`. A `analysis_status` final deve ser derivada de `ai_cycles>0` na re-leitura do banco (fonte da verdade), não do sucesso da espera.
- O worker roda no mesmo processo do servidor ([src/server.ts](src/server.ts)), então `QueueEvents` enxerga a conclusão do job normalmente.
- Prompt (exemplo de instrução pt-BR a incluir): "Responda em português do Brasil. Os campos title, description e quantity devem estar em pt-BR. Use APENAS JSON válido, sem markdown."

## Verification

**Commands:**
- `npm run build` -- expected: compila sem erros (tsc → dist/).

**Manual checks:**
- `POST /entries/photo` com foto real → resposta `201` com `foods` em português e `analysis_status:'done'`.
- `GET /entries/:id` logo após captura sem análise → `analysis_status:'pending'`, `foods:[]`; após o worker → `done` com itens.
- `GET /entries/:id` com token de outro usuário → `404`.

## Suggested Review Order

**Retorno síncrono da análise (núcleo da mudança)**

- Entry point — o POST agora espera o job e devolve a análise; timeout/falha não derruba a captura
  [`entries.ts:140`](../../src/routes/entries.ts#L140)
- Mecanismo de espera sobre a fila existente; `QueueEvents` em conexão própria (comandos bloqueantes)
  [`entry.ts:25`](../../src/queues/entry.ts#L25)
- `analysis_status` derivado de `ai_cycles>0` (fonte da verdade no banco), com filtro por dono
  [`entries.ts:36`](../../src/routes/entries.ts#L36)

**Nova rota de consulta**

- `GET /entries/:id` com auth + checagem de dono; id não-UUID vira 404 (evita 500 do Postgres)
  [`entries.ts:163`](../../src/routes/entries.ts#L163)
- Auth compartilhada token→usuário, reutilizada por POST e GET
  [`entries.ts:25`](../../src/routes/entries.ts#L25)

**Prompt pt-BR**

- Instrução explícita: valores textuais em pt-BR, chaves do JSON em inglês
  [`ai.ts:29`](../../src/services/ai.ts#L29)

**Periféricos (tipos e config)**

- Formato de resposta da view (GET) e do POST
  [`models.ts:18`](../../src/types/models.ts#L18)
- Timeout configurável, validado como inteiro positivo (NaN não desliga a proteção)
  [`config.ts:8`](../../src/config.ts#L8)
