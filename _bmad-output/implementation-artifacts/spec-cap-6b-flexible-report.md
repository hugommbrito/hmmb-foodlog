---
title: 'CAP-6b — Relatório flexível: período customizável e refresh manual'
type: 'feature'
created: '2026-06-26'
status: 'done'
baseline_commit: '92218626c345ce8576f4e490d159a58687c262de'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O relatório de padrões (CAP-6) usa sempre os últimos 7 dias rolling e é cacheado uma vez por dia — o usuário não consegue pedir análise para um período diferente nem regenerar o relatório no mesmo dia após novos registros (ex.: incluir o almoço gerado à tarde).

**Approach:** Adicionar `start_date`, `end_date` (YYYY-MM-DD) e `force` (boolean) como query params opcionais em `GET /report/weekly`. Trocar a chave de cache de `(user_id)` para `(user_id, period_start, period_end)` via migration. Atualizar o frontend com seletor de período (presets 7d / 14d / 30d + personalizado) e botão "Regenerar".

## Boundaries & Constraints

**Always:**
- Sem parâmetros: comportamento idêntico ao atual (7d rolling, cache diário)
- `start_date` e `end_date` devem ser fornecidos juntos ou nenhum dos dois — caso contrário 400
- `end_date >= start_date` — caso contrário 400
- Cache válido quando `generated_at >= início do dia (America/Sao_Paulo)` para a chave `(user_id, period_start, period_end)` — aplicar tanto a ranges históricos quanto ao 7d rolling
- Guardrail de ≥3 dias distintos com dados mantido para qualquer período
- `force=true` sempre re-gera e faz upsert, ignorando cache

**Ask First:**
- Limpeza automática de rows de cache antigas (ex.: `period_end < hoje - 30 dias`): on-demand manual ou via cron?

**Never:**
- Modificar `analyzePatterns` em `src/services/ai.ts` — apenas mudar o caller
- Renomear ou remover a rota `/report/weekly`
- Introduzir biblioteca de datas no frontend — usar `Date` nativo + `toLocaleString`

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error |
|---|---|---|---|
| Default (sem params) | GET /report/weekly | Análise 7d rolling; cache ou fresca | N/A |
| Range customizado | ?start_date=2026-06-01&end_date=2026-06-15 | Análise do período exato, cacheada ou fresca | N/A |
| Force refresh | ?force=true (+ params opcionais) | Análise fresca — IA invocada; upsert cache | N/A |
| Dados insuficientes | qualquer período com <3 dias de dados | `{ insufficient: true }` | N/A |
| Apenas um dos params | ?start_date=X sem end_date | 400 com mensagem clara | 400 |
| end_date < start_date | datas invertidas | 400 com mensagem clara | 400 |

</frozen-after-approval>

## Code Map

- `src/db/migrations/010_report_period_index.sql` — migration: troca unique index `(user_id)` → `(user_id, period_start, period_end)`
- `src/routes/report.ts` — endpoint `GET /report/weekly`: adicionar query params, validações, cache por período, flag force
- `src/types/models.ts` — adicionar `ReportQuery` type para os query params tipados
- `web/src/api.ts` — atualizar `fetchWeeklyReport` para aceitar e serializar params opcionais
- `web/src/types.ts` — espelhar `ReportQueryParams` no frontend
- `web/src/App.tsx` — componente `WeeklyReportView`: seletor de período + botão Regenerar

## Tasks & Acceptance

**Execution:**

- [x] `src/db/migrations/010_report_period_index.sql` — DROP `weekly_reports_user_id_idx`, CREATE UNIQUE INDEX em `(user_id, period_start, period_end)`; executar via `npm run db:migrate`

- [x] `src/types/models.ts` — adicionar `interface ReportQuery { start_date?: string; end_date?: string; force?: boolean }`

- [x] `src/routes/report.ts` — estender `GET /report/weekly` com Fastify generics para `Query: ReportQuery`:
  1. Parsear `start_date`, `end_date`, `force` da query
  2. Validar: ambos ou nenhum; `end_date >= start_date` → 400 em erro
  3. Calcular `periodStart`/`periodEnd`: sem params → rolling 7d (atual); com params → usar os valores recebidos
  4. Cache lookup: `WHERE user_id=$1 AND period_start=$2 AND period_end=$3 AND generated_at >= today_sp_start` — pular se `force=true`
  5. Upsert: `ON CONFLICT (user_id, period_start, period_end) DO UPDATE SET analysis_json=$4, generated_at=now()`

- [x] `web/src/api.ts` — atualizar `fetchWeeklyReport(params?: ReportQueryParams): Promise<WeeklyReportPayload>` para serializar e appendar query string a `/report/weekly`

- [x] `web/src/types.ts` — adicionar `type ReportQueryParams = { start_date?: string; end_date?: string; force?: boolean }`

- [x] `web/src/App.tsx` — componente `WeeklyReportView`:
  - Adicionar estado `preset: 7 | 14 | 30 | 'custom'` (default `7`)
  - Adicionar estados `customStart: string`, `customEnd: string` (visíveis só quando `preset='custom'`)
  - Função `computeDates(preset)`: devolve `{ start_date, end_date }` — presets usam `Date` + `toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })` para calcular hoje no SP; custom usa `customStart`/`customEnd`
  - Botões de preset (7d / 14d / 30d / Personalizado) + campos de data (ocultos até preset='custom') + botão "Aplicar" no modo custom
  - Botão "Regenerar" (visível quando `status === 'ok' || status === 'insufficient'`) → chama fetch com `{ ...computeDates(preset), force: true }`
  - Ao trocar preset → resetar `requested.current = false`, limpar `report`, setar `status='idle'`, re-fetch

**Acceptance Criteria:**
- Given relatório 7d carregado, when "Regenerar" clicado, then frontend busca com `force=true` e backend re-invoca a IA e atualiza o cache
- Given sem parâmetros, when GET /report/weekly, then comportamento idêntico ao atual (7d rolling)
- Given `?start_date=2026-06-01&end_date=2026-06-15`, when GET /report/weekly, then análise do período exato e upsert da chave `(user_id, 2026-06-01, 2026-06-15)`
- Given mesmo range já cacheado hoje, when GET sem force, then retorna cache sem chamar IA
- Given `?start_date=X` sem `end_date`, when GET /report/weekly, then 400 com mensagem de erro clara
- Given `end_date < start_date`, when GET /report/weekly, then 400
- Given preset 14d selecionado, when usuário muda para 30d, then nova requisição disparada com datas recalculadas

## Suggested Review Order

**Validação e resolução de período (entry point)**

- Endpoint estendido: aceita `start_date`, `end_date`, `force`; valida formato e paridade
  [`report.ts:35`](../../src/routes/report.ts#L35)

- Regex YYYY-MM-DD + validação de paridade + string-compare para end >= start
  [`report.ts:43`](../../src/routes/report.ts#L43)

- Resolução do período: sem params → SQL rolling 7d; com params → usa os valores recebidos
  [`report.ts:62`](../../src/routes/report.ts#L62)

**Cache com chave composta**

- Cache lookup escopo por `(user_id, period_start, period_end)` + TTL diário SP; pulado se `force=true`
  [`report.ts:81`](../../src/routes/report.ts#L81)

- Upsert com `ON CONFLICT (user_id, period_start, period_end)` — chave composta nova
  [`report.ts:168`](../../src/routes/report.ts#L168)

- Migration que troca o índice único de `(user_id)` para `(user_id, period_start, period_end)`
  [`010_report_period_index.sql:1`](../../src/db/migrations/010_report_period_index.sql#L1)

**Frontend — lógica de preset e regeneração**

- `presetToDates`: preset=7 → `{}` (server default); 14/30 → datas explícitas; custom → campos do usuário
  [`App.tsx:955`](../../web/src/App.tsx#L955)

- `doLoad`: dispara fetch e gerencia estado; `useEffect([preset])` re-busca ao trocar preset
  [`App.tsx:976`](../../web/src/App.tsx#L976)

- `handleRegenerar`: guard contra datas custom vazias antes de passar `force: true`
  [`App.tsx:1009`](../../web/src/App.tsx#L1009)

**Frontend — UI**

- Campos de data custom (visíveis só em preset='custom') + botão Aplicar
  [`App.tsx:1063`](../../web/src/App.tsx#L1063)

- Botão Regenerar no estado `insufficient` e no header do relatório carregado
  [`App.tsx:1096`](../../web/src/App.tsx#L1096)

**Tipos e API**

- `fetchWeeklyReport(params?)`: serializa params em query string
  [`api.ts:231`](../../web/src/api.ts#L231)

- Tipos backend/frontend: `ReportQuery` (string `force`) e `ReportQueryParams` (boolean `force`)
  [`models.ts:205`](../../src/types/models.ts#L205)

## Spec Change Log

## Design Notes

**Cache key change:** migration 010 substitui o índice único `(user_id)` por `(user_id, period_start, period_end)`. A row existente de cada usuário persiste sem alteração de dados — a nova chave é retrocompatível. Rows antigas (period_end muito antigo) não são retornadas nas queries normais; limpeza pode ser feita manualmente quando incomodar.

**Timezone no frontend:** `new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))` produz a data SP. Subtrair `n-1` dias para o `start_date` dos presets. Imprecisão de ±1 dia no fuso é aceitável — o guardrail de ≥3 dias cobre o pior caso.

## Verification

**Commands:**
- `npm run db:migrate` — expected: migration 010 aplicada sem erro
- `npx tsc --noEmit` — expected: 0 erros TypeScript no backend
- `cd web && npx tsc --noEmit` — expected: 0 erros TypeScript no frontend

**Manual checks:**
- GET /report/weekly sem params → mesmo resultado de antes (7d)
- GET /report/weekly?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD → análise do período
- GET /report/weekly?force=true → nova chamada à IA (`generated_at` mais recente)
- GET /report/weekly?start_date=X (sem end_date) → 400 com mensagem clara
- Frontend: trocar preset re-busca; "Regenerar" dispara force; preset "Personalizado" exibe campos de data
