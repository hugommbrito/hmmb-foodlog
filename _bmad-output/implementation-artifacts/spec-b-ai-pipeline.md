---
title: 'Spec B — AI Analysis Pipeline'
type: 'feature'
created: '2026-06-16'
status: 'done'
baseline_commit: '4bf8093851f331ed12889d86ca9a32e2af3d0152'
context:
  - _bmad-output/specs/spec-foodlog/data-model.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entries são criadas com `ai_confidence_overall: 0.0` e sem `food_items` — nenhum dado nutricional é gerado; o usuário nunca vê o que a IA identificou nas fotos.

**Approach:** Implementar worker assíncrono com BullMQ + Redis que consome entries criadas pela Spec A. O worker chama Claude claude-sonnet-4-6 com visão nas fotos da entry, valida JSON de saída, persiste `food_items` e atualiza `ai_confidence_overall`, `ai_cycles` e `title` em transação única. 3 tentativas com backoff exponencial; após esgotamento, o erro é logado e a entry permanece inalterada.

## Boundaries & Constraints

**Always:**
- Enfileirar job após INSERT confirmado no webhook — fire-and-forget do ponto de vista do handler
- 3 tentativas por job com backoff exponencial (1s → 2s → 4s)
- INSERT `food_items` + UPDATE `entries` em transação pg única — all-or-nothing
- Incrementar `ai_cycles` apenas na tentativa bem-sucedida (não por retry)
- Após esgotamento: logar erro, não tocar `food_items`, deixar `ai_confidence_overall: 0.0`
- Worker rodando no mesmo processo do Fastify; shutdown gracioso no SIGTERM

**Ask First:**
- (nenhum — comportamento completamente especificado no backlog)

**Never:**
- Chamar Claude de forma síncrona no handler do webhook (quebra o SLA de ≤10s)
- Inserir `food_items` manualmente fora do worker
- Parsear resposta do Claude fora de `ai.ts`
- Chamar `process.exit()` no worker em caso de falha de job — apenas lançar exceção para BullMQ retentar

## I/O & Edge-Case Matrix

| Cenário | Input / Estado | Output / Comportamento | Error Handling |
|---|---|---|---|
| Análise bem-sucedida | Entry com photos R2 públicas, Claude responde JSON válido | `food_items` inseridos, `ai_confidence_overall` > 0, `ai_cycles: 1`, `title` preenchido | — |
| Foto ilegível / zero confiança | Claude retorna `overall_confidence: 0.0`, `foods: []` | `food_items` vazio, `ai_confidence_overall: 0.0`, `ai_cycles: 1` | Caso válido, sem retry |
| Claude API inacessível | Timeout ou erro de rede | Job recolocado na fila | Retry automático 3x (backoff exp.); após esgotamento: log error |
| JSON malformado do Claude | Resposta não-parseável ou schema inválido | Exceção lançada, entry inalterada | Retry automático 3x; após esgotamento: log error |
| Entry não encontrada no DB | `entryId` inválido no payload do job | Log de aviso, job descartado sem retry | Worker captura erro, não re-lança |

</frozen-after-approval>

## Code Map

- `package.json` — adicionar deps `bullmq`, `@anthropic-ai/sdk`
- `src/config.ts` — promover `REDIS_URL` de opcional para obrigatório; adicionar `ANTHROPIC_API_KEY`
- `.env.example` — documentar `REDIS_URL` e `ANTHROPIC_API_KEY` como obrigatórios para Spec B
- `src/types/models.ts` — adicionar interface `AiAnalysisResult` (schema de saída da IA)
- `src/queues/entry.ts` — Queue BullMQ `analyze-entry` + producer `enqueueAnalysis(entryId)`
- `src/services/ai.ts` — `analyzeEntry(photos, recentFoods)` → `AiAnalysisResult`; prompt + chamada Claude + validação Zod
- `src/workers/analyze-entry.ts` — Worker: fetch entry → recent foods → analyzeEntry → transação pg; exports `startWorker()` / `closeWorker()`
- `src/routes/webhook.ts` — adicionar `RETURNING id` ao INSERT; chamar `enqueueAnalysis(id)` após insert
- `src/server.ts` — chamar `startWorker()` no startup; registrar `closeWorker()` no SIGTERM

## Tasks & Acceptance

**Execution:**
- [x] `package.json` — adicionar `bullmq` ^5 e `@anthropic-ai/sdk` ^0.30 a `dependencies`
- [x] `src/config.ts` — alterar `REDIS_URL` de `z.string().optional()` para `z.string().min(1, 'REDIS_URL is required')`; adicionar `ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required')`
- [x] `.env.example` — adicionar entradas `REDIS_URL=redis://...` e `ANTHROPIC_API_KEY=sk-ant-...` com comentários
- [x] `src/types/models.ts` — adicionar interface `AiAnalysisResult { title: string | null; overall_confidence: number; foods: AiFoodItem[] }` e `AiFoodItem` com os campos do data-model (description, quantity, kcal, protein_g, fat_g, carbs_g, confidence)
- [x] `src/queues/entry.ts` — criar arquivo: instanciar `Queue('analyze-entry', { connection: { url: config.REDIS_URL } })`; exportar `enqueueAnalysis(entryId: string): Promise<void>` que adiciona job `{ entryId }` com `{ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`
- [x] `src/services/ai.ts` — criar arquivo: `analyzeEntry(photos: string[], recentFoods: string[]): Promise<AiAnalysisResult>` — constrói blocos `image_url` para cada URL de foto, monta user message com lista de alimentos recentes, chama `claude-sonnet-4-6` com system prompt instruindo retorno JSON, extrai JSON entre primeira `{` e última `}`, valida com Zod schema, retorna `AiAnalysisResult`
- [x] `src/workers/analyze-entry.ts` — criar arquivo: Worker BullMQ para fila `analyze-entry`; no processor: (1) buscar entry por `entryId` — se não encontrar, logar e retornar sem lançar; (2) query recent foods dos últimos 20 mais frequentes do usuário; (3) chamar `analyzeEntry`; (4) executar transação: `UPDATE entries SET ai_confidence_overall=$2, ai_cycles=ai_cycles+1, title=$3 WHERE id=$1` + N `INSERT INTO food_items` para cada item; exportar `startWorker()` e `closeWorker()`
- [x] `src/routes/webhook.ts` — adicionar `RETURNING id` ao INSERT de entries; extrair `id` do resultado; chamar `enqueueAnalysis(id)` após insert (dentro do try, após o insert, antes do `sendTextMessage`)
- [x] `src/server.ts` — importar `startWorker` e `closeWorker`; chamar `startWorker()` antes de `app.listen()`; adicionar `process.on('SIGTERM', async () => { await closeWorker(); await app.close(); })`

**Acceptance Criteria:**
- Dado entry criada via webhook com foto válida, quando o worker executa, então `food_items` tem ≥1 row para essa entry e `ai_confidence_overall > 0.0` e `ai_cycles = 1`
- Dado Claude retornar `foods: []` e `overall_confidence: 0.0`, então entry tem `ai_cycles = 1`, `food_items` não tem rows para essa entry, `ai_confidence_overall = 0.0`
- Dado `REDIS_URL` ausente no `.env`, quando o servidor inicia, então processo encerra com mensagem explícita `REDIS_URL is required`
- Dado `ANTHROPIC_API_KEY` ausente, quando o servidor inicia, então processo encerra com mensagem explícita `ANTHROPIC_API_KEY is required`
- Dado Claude API falhar 3 vezes consecutivas, então job está em estado `failed` no BullMQ, entry permanece com `ai_confidence_overall: 0.0`, e erro é visível nos logs

## Design Notes

**Estrutura do prompt Claude:**
```
System: "You are a nutritionist analyzing meal photos. Return ONLY valid JSON:
{\"title\":string|null,\"overall_confidence\":number,\"foods\":[{\"description\":string,\"quantity\":string|null,\"kcal\":number|null,\"protein_g\":number|null,\"fat_g\":number|null,\"carbs_g\":number|null,\"confidence\":number}]}"

User: [blocos image_url para cada URL em entry.photos]
"The user's recent foods: [lista separada por vírgula].
Identify all food items visible. Return JSON only."
```

**Query alimentos recentes:**
```sql
SELECT fi.description FROM food_items fi
JOIN entries e ON fi.entry_id = e.id
WHERE e.user_id = $1
GROUP BY fi.description ORDER BY COUNT(*) DESC LIMIT 20
```

**Transação de persistência:**
```sql
BEGIN;
UPDATE entries SET ai_confidence_overall=$2, ai_cycles=ai_cycles+1, title=$3 WHERE id=$1;
INSERT INTO food_items (entry_id,description,quantity,kcal,protein_g,fat_g,carbs_g,confidence)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8); -- repetido para cada food item
COMMIT;
```

## Suggested Review Order

**Entry point — orquestração central**

- Ponto de entrada do worker: toda a lógica flui daqui (guards → AI → transação)
  [`analyze-entry.ts:11`](../../src/workers/analyze-entry.ts#L11)

**Enfileiramento fire-and-forget**

- INSERT com RETURNING id + enqueueAnalysis desacoplado via `.catch()` (não falha o webhook)
  [`webhook.ts:64`](../../src/routes/webhook.ts#L64)

- Queue BullMQ com error listener e closeQueue() para shutdown limpo
  [`queues/entry.ts:1`](../../src/queues/entry.ts#L1)

**Serviço de IA**

- fetchImageAsBase64: baixa foto do R2 com AbortController 30s, converte para base64
  [`ai.ts:33`](../../src/services/ai.ts#L33)

- analyzeEntry: monta prompt com imagens + alimentos recentes, chama Claude, extrai JSON, valida Zod
  [`ai.ts:52`](../../src/services/ai.ts#L52)

**Guards de idempotência e integridade**

- Guards: entry ausente → descarta; ai_cycles > 0 → pula (evita duplicatas em retry pós-crash)
  [`analyze-entry.ts:15`](../../src/workers/analyze-entry.ts#L15)

**Transação de persistência**

- BEGIN/COMMIT pg: UPDATE entries + N INSERTs em food_items — all-or-nothing
  [`analyze-entry.ts:38`](../../src/workers/analyze-entry.ts#L38)

**Lifecycle do worker**

- startWorker idempotente com error listener; closeWorker fecha worker E conexão IORedis
  [`analyze-entry.ts:58`](../../src/workers/analyze-entry.ts#L58)

- Shutdown unificado SIGTERM/SIGINT com try/finally garantindo process.exit(0)
  [`server.ts:21`](../../src/server.ts#L21)

**Config + Tipos**

- REDIS_URL e ANTHROPIC_API_KEY promovidos para obrigatórios no schema Zod
  [`config.ts:7`](../../src/config.ts#L7)

- Interfaces AiFoodItem, AiAnalysisResult e AnalyzeEntryJobData centralizadas
  [`models.ts:31`](../../src/types/models.ts#L31)

## Verification

**Commands:**
- `npm run build` -- expected: zero erros TypeScript
- `npm run dev` -- expected: server inicia sem erros; log mostra worker BullMQ conectado ao Redis

**Manual checks:**
- Enviar foto via WhatsApp → aguardar ~5-10s → `SELECT ai_confidence_overall, ai_cycles, title FROM entries ORDER BY created_at DESC LIMIT 1;` — expected: `ai_cycles = 1`, `ai_confidence_overall > 0`
- `SELECT * FROM food_items WHERE entry_id = '<id>';` — expected: ≥1 row com `description` preenchido
