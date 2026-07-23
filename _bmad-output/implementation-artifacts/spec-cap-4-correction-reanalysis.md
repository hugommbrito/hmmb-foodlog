---
title: 'CAP-4 — Correção + re-análise da entry (web app)'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: 'fa21fcd783789136189e49450a3712074be6bf96'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A IA gera `food_items` + macros (CAP-2) e o web app permite só revisar/aceitar (CAP-3) — não há como corrigir um resultado errado. Hoje o worker até **bloqueia** re-análise (`if ai_cycles > 0 → skip`) e não substitui itens (re-rodar duplicaria), então o usuário fica preso a uma análise ruim.

**Approach:** No web app, o usuário corrige uma entry de dois jeitos combináveis — **edição granular** (editar descrição/quantidade de alimentos, apagar itens) e **texto livre** — e dispara uma re-análise **síncrona**. O backend compõe essas correções numa instrução, re-invoca a IA sobre a mesma foto tratando a correção como verdade, **substitui** os `food_items`, recalcula `ai_confidence_overall`, incrementa `ai_cycles` e reseta `reviewed=false`. O usuário nunca digita macros — a IA recalcula. O motor de re-análise é reusável pelo CAP-5 (correção via WhatsApp, só texto).

## Boundaries & Constraints

**Always:**
- Auth Bearer; só opera em entry do próprio `user_id` (404 caso contrário) — reusar `authenticate()`.
- Re-análise é **síncrona** (igual ao POST de captura): enfileira com a correção, aguarda `waitForAnalysis` (`ANALYSIS_WAIT_TIMEOUT_MS`), devolve a view; timeout/falha NÃO vira 5xx — responde com a view atual (`analysis_status:'pending'`).
- **Atomicidade:** o worker apaga os `food_items` antigos e insere os novos na MESMA transação (a IA roda antes) — qualquer falha preserva a análise anterior via rollback, nunca um estado sem itens.
- Correção é verdade: a IA mantém as descrições corrigidas e só recalcula nutrição/confiança; a IA segue sendo a única fonte de `food_items` (nunca macros pelo body).
- Re-análise sempre seta `reviewed=false` e `ai_cycles = ai_cycles + 1`.

**Ask First:**
- Qualquer migration/alteração de schema (não deve ser necessária — `reviewed`/`ai_cycles`/`food_items` já existem; FK tem `ON DELETE CASCADE`).
- Persistir o histórico de correções (texto/ciclos) numa nova coluna/tabela.

**Never:**
- Preenchimento manual de kcal/proteína/gordura/carbo pelo usuário.
- Re-análise sem correção alguma (body vazio → 400; nada a corrigir).
- Fluxo inbound do WhatsApp (isso é CAP-5) — apenas deixar o motor reusável.
- Mexer no fluxo do webhook ou na captura inicial.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-análise OK | `POST /entries/:id/reanalyze` token do dono + `{correction}` e/ou `{foods}` | `200` view atualizada: novos `foods`, `reviewed:false`, `ai_cycles` +1, `analysis_status:'done'` | — |
| Só edição granular | body `{ foods:[{description,quantity}] }` (itens apagados já fora da lista) | `200`; IA recalcula macros mantendo as descrições enviadas | — |
| Só texto livre | body `{ correction:"é peixe, não frango" }` | `200`; IA refaz guiada pelo texto | — |
| Body vazio | `{}` / `{foods:[]}` sem texto | `400 { error }` | nada é re-analisado |
| Timeout/falha da IA | job não conclui no timeout | `200` com `analysis_status:'pending'`; food_items anteriores preservados | loga warn; sem 5xx |
| Entry de outro/inexistente | `:id` não pertence ao token ou não-UUID | `404 { error }` | sem vazar dados |
| Sem token | Authorization ausente/inválido | `401 { error }` | — |

</frozen-after-approval>

## Code Map

- `src/routes/entries.ts` -- adicionar `POST /entries/:id/reanalyze`: auth + dono, montar a string de correção a partir de `{correction, foods}` (400 se vazia), `enqueueAnalysis(id, correction)` → `waitForAnalysis` (try/catch p/ timeout) → `loadEntryView`. Reusa `authenticate`, `UUID_RE`, `loadEntryView`.
- `src/queues/entry.ts` -- `enqueueAnalysis(entryId, correction?)` passa `correction` no job data.
- `src/workers/analyze-entry.ts` -- guard vira `if (ai_cycles > 0 && !correction) skip`; passar `correction` para `analyzeEntry`; na transação, `DELETE FROM food_items WHERE entry_id` antes de inserir; UPDATE também seta `reviewed=false`.
- `src/services/ai.ts` -- `analyzeEntry(photos, recentFoods, correction?)`: quando há correção, injetar bloco no conteúdo do usuário instruindo a IA a tratá-la como verdade e recalcular a nutrição.
- `src/types/models.ts` -- `AnalyzeEntryJobData` ganha `correction?: string`; adicionar `ReanalyzeRequest { correction?: string; foods?: { description: string; quantity: string | null }[] }`.
- `web/src/api.ts` -- `reanalyzeEntry(id, payload): Promise<EntryAnalysisView>`.
- `web/src/types.ts` -- mirror de `ReanalyzeRequest` e (se útil) da view de resposta.
- `web/src/App.tsx` (+ `index.css`) -- modo de edição no `EntryCard`: descrições/quantidades editáveis, apagar item, textarea de correção, botão "Re-analisar" → substitui a entry no estado com a resposta; tratar `UnauthorizedError`.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/ai.ts` -- `analyzeEntry` aceita `correction?`; injeta instrução pt-BR ("o usuário corrigiu; trate como verdade, mantenha as descrições, recalcule a nutrição") antes do "Analyze the meal".
- [x] `src/queues/entry.ts` + `src/types/models.ts` -- `enqueueAnalysis(entryId, correction?)` grava `correction` no job; tipos `AnalyzeEntryJobData.correction` e `ReanalyzeRequest`.
- [x] `src/workers/analyze-entry.ts` -- ler `correction` do job; guard `ai_cycles > 0 && !correction`; transação faz `DELETE food_items` → INSERT novos → UPDATE com `ai_cycles+1`, `ai_confidence_overall`, `title`, `reviewed=false`.
- [x] `src/routes/entries.ts` -- `POST /entries/:id/reanalyze` (auth, dono, compõe correção, 400 se vazia, enqueue+wait, retorna `loadEntryView`).
- [x] `web/src/api.ts` + `web/src/types.ts` -- `reanalyzeEntry()` e tipos.
- [x] `web/src/App.tsx` (+ `styles.css`) -- edição granular + textarea no card; "Re-analisar" atualiza o card com a resposta (foods novos, `reviewed:false`).
- [x] Verificar `npm run build` (raiz) e `cd web && npm run build`; revisão manual (sem suite de testes no projeto).

**Acceptance Criteria:**
- Given uma entry com análise errada, when edito alimentos e/ou escrevo uma correção e toco "Re-analisar", then o card mostra os novos `foods`/macros recalculados pela IA e volta a pendente (`reviewed:false`) sem recarregar.
- Given a IA falha/expira na re-análise, when o endpoint responde, then retorna `200` com `analysis_status:'pending'` e os `food_items` anteriores continuam intactos (sem 5xx, sem duplicação).
- Given uma entry já aceita (`reviewed:true`), when re-analiso, then ela volta a `reviewed:false` e `ai_cycles` incrementa.
- Given um `:id` de outro usuário, when chamo `reanalyze`, then `404` sem vazar dados.

## Design Notes

- **Composição da correção (rota → campo único `correction: string`):** `foods` vira "Lista corrigida pelo usuário (mantenha as descrições; recalcule a nutrição): - X (qtd)…" e `correction` vira "Observação do usuário: …"; junta os blocos (ambos vazios → 400). Esse campo único é o que mantém o motor reusável pelo CAP-5 (WhatsApp passa só o texto livre).
- **`analysis_status` continua derivado de `ai_cycles > 0`** na releitura do banco — fonte da verdade, não do sucesso da espera.

## Verification

**Commands:**
- `npm run build` e `cd web && npm run build` -- expected: backend e SPA compilam sem erros.
- `curl -sX POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"correction":"é peixe, ~200g"}' .../entries/$ID/reanalyze` → `200` com `foods` recalculados e `reviewed:false`; body `{}` → `400`.

**Manual checks:**
- No web app: editar alimento + escrever correção → "Re-analisar"; card atualiza com novos macros e volta a pendente. No banco: `food_items` substituídos (não duplicados) e `ai_cycles` subiu.

## Suggested Review Order

**Núcleo — re-análise síncrona (rota)**

- Entry point: a rota que orquestra correção → fila → espera → view; entenda o design aqui primeiro.
  [`entries.ts:288`](../../src/routes/entries.ts#L288)
- Compõe edição granular + texto livre num único campo `correction` (reusável pelo CAP-5); vazio → 400.
  [`entries.ts:83`](../../src/routes/entries.ts#L83)
- Patch de revisão: detecta re-análise que não avançou `ai_cycles` e reporta `'pending'` (honra o contrato de timeout).
  [`entries.ts:334`](../../src/routes/entries.ts#L334)

**Núcleo — worker (substituição atômica)**

- Guard ajustado: re-análise (com `correction`) ignora o bloqueio de `ai_cycles>0`; captura inicial segue protegida.
  [`analyze-entry.ts:23`](../../src/workers/analyze-entry.ts#L23)
- Patch de revisão: re-análise vazia NÃO apaga os itens anteriores (evita perda de dados).
  [`analyze-entry.ts:49`](../../src/workers/analyze-entry.ts#L49)
- `DELETE`+`UPDATE`(`reviewed=false`, `ai_cycles+1`)+`INSERT` na mesma transação — falha faz rollback.
  [`analyze-entry.ts:61`](../../src/workers/analyze-entry.ts#L61)

**IA — correção como verdade**

- Injeta a correção no prompt instruindo a manter descrições e só recalcular nutrição.
  [`ai.ts:75`](../../src/services/ai.ts#L75)

**Frontend — formulário de correção**

- Estado/submit do card: monta `foods` só se editados (`foodsDirty`) + texto; pelo menos um obrigatório.
  [`App.tsx:270`](../../web/src/App.tsx#L270)
- Handler: mescla a view de volta no card in-place (sem re-ordenar mid-interação).
  [`App.tsx:153`](../../web/src/App.tsx#L153)

**Periféricos — client e tipos**

- Client HTTP da re-análise (POST JSON, retorna a view).
  [`api.ts:66`](../../web/src/api.ts#L66)
- Contrato `ReanalyzeRequest` + `correction?` no job data.
  [`models.ts:86`](../../src/types/models.ts#L86)
