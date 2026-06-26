---
title: 'CAP-6 — Relatório semanal de padrões comportamentais (lazy + cache)'
type: 'feature'
created: '2026-06-26'
status: 'done'
baseline_commit: 'd24596c04f508293a41680222ebd09f6262339f6'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cap-7b-nutritionist-pattern-analysis.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O web app autenticado não expõe análise de padrões comportamentais. Hugo só acessa análise de padrões via links de nutricionista (CAP-7b), que têm período fixo e são temporários — não servem para revisão pessoal da última semana.

**Approach:** Adicionar aba "Relatório" no web app autenticado. `GET /report/weekly` serve os últimos 7 dias rolling (America/Sao_Paulo). Na primeira abertura do dia gera via `analyzePatterns`; acessos seguintes no mesmo dia servem do cache em `weekly_reports`.

## Boundaries & Constraints

**Always:**
- Janela: últimos 7 dias rolling (hoje inclusive, AT TIME ZONE 'America/Sao_Paulo'). Cache válido quando `period_end = hoje SP` **e** `generated_at >= início do dia atual SP`.
- Guard de suficiência: entradas em ≥3 dias locais distintos antes de chamar a IA; senão `{insufficient:true}` sem upsert.
- Auth: Bearer token obrigatório no endpoint (mesmo padrão de `authenticate()` de `entries.ts`). 401 em token ausente/inválido.
- Persistência: tabela `weekly_reports` com `UNIQUE(user_id)`; upsert no generate. Resultado `insufficient` nunca é persistido.
- Reutilizar `analyzePatterns(entries: PatternEntryInput[])` de `src/services/ai.ts` sem modificação.
- Chamada ao Claude sob `withOutboundAudit('anthropic','analyze-patterns',{...},run)` — já embutido em `analyzePatterns`.

**Ask First:**
- Se Hugo quiser forçar regeneração manual (botão "atualizar"), pause e pergunte antes de implementar.
- Se Hugo quiser ver histórico de relatórios anteriores além do mais recente.

**Never:**
- Sem cron, worker background, e-mail ou push WhatsApp.
- Não modificar o endpoint `/shared/:token/patterns` nem a tabela `share_links`.
- Sem nova variável de ambiente.
- Sem suite de testes (projeto não tem runner).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1º acesso do dia, ≥3 dias com entradas | GET /report/weekly, sem cache válido | 200 `{generated_at, period_start, period_end, analysis: PatternAnalysis}`; upsert no banco | — |
| Acesso com cache do dia | `weekly_reports` com `period_end=hoje SP` e `generated_at>=início hoje SP` | 200 com cache; sem chamada ao Claude | — |
| <3 dias com entradas nos últimos 7 | — | 200 `{insufficient:true}`; sem Claude; sem upsert | — |
| Claude falha / Zod rejeita | SDK lança ou schema inválido | 502 `{error:'Não foi possível gerar o relatório'}`; sem upsert | UI mostra retry |
| Token ausente ou inválido | header Authorization ausente/inválido | 401 `{error:'Não autorizado'}` | — |

</frozen-after-approval>

## Code Map

- [`src/db/migrations/009_weekly_reports.sql`](../../src/db/migrations/009_weekly_reports.sql) -- NOVO: `CREATE TABLE IF NOT EXISTS weekly_reports` + `CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_user_id_idx`; idempotente
- [`src/types/models.ts:206`](../../src/types/models.ts#L206) -- NOVO: `WeeklyReportRow` (user_id, period_start, period_end, analysis_json: PatternAnalysis, generated_at)
- [`src/routes/report.ts:46`](../../src/routes/report.ts#L46) -- NOVO `reportRoutes`: `GET /report/weekly` — auth (L7) → cache check SQL (L59–92) → janela 7d (L95–101) → query entradas com JOIN (L104–124) → guard ≥3 dias (L127–130) → `analyzePatterns` (L153) → UPSERT (L161–170) → responder
- [`src/app.ts:11`](../../src/app.ts#L11) -- importa e registra `reportRoutes` (L46)
- [`web/src/types.ts:113`](../../web/src/types.ts#L113) -- NOVO: `WeeklyReportPayload` union type
- [`web/src/api.ts:237`](../../web/src/api.ts#L237) -- NOVO: `fetchWeeklyReport()` — usa helper `request<T>` autenticado; 401 → `UnauthorizedError`; 502 → `Error`
- [`web/src/App.tsx:944`](../../web/src/App.tsx#L944) -- NOVO: `WeeklyReportView` com `useRef` dedupe (L949), 4 estados, render de observações (L1048); aba wired na Shell (L195/L201)
- [`web/src/styles.css:356`](../../web/src/styles.css#L356) -- NOVO: `.patterns`, `.pattern-list`, `.pattern-card`, `.pattern-cat/title/detail`, `.patterns-meta`, `.patterns-summary`, `.weekly-report-header`, `.weekly-report-period`

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/009_weekly_reports.sql` -- CREATE TABLE weekly_reports (id UUID PK, user_id UUID UNIQUE FK→users ON DELETE CASCADE, period_start DATE, period_end DATE, analysis_json JSONB NOT NULL, generated_at TIMESTAMPTZ NOT NULL DEFAULT now()) -- base de persistência
- [x] `src/types/models.ts` -- adicionar `WeeklyReportRow` -- contrato do DB
- [x] `src/routes/report.ts` -- `GET /report/weekly`: autenticar → buscar cache → carregar entradas 7d (AT TIME ZONE SP) com LEFT JOIN food_items + context_tags → checar ≥3 dias locais → `analyzePatterns` → UPSERT ON CONFLICT(user_id) → responder -- backend principal
- [x] `src/app.ts` -- `app.register(reportRoutes)` -- wiring
- [x] `web/src/types.ts` -- `WeeklyReportPayload` -- tipos web
- [x] `web/src/api.ts` -- `fetchWeeklyReport()` com Bearer token; reusa padrão de erro de `api.ts` -- camada HTTP web
- [x] `web/src/App.tsx` + `web/src/styles.css` -- aba "Relatório" lazy (useRef dedupe) com 4 estados + estilos -- interface

**Acceptance Criteria:**
- Given usuário autenticado com ≥3 dias de entradas nos últimos 7, when abre a aba "Relatório" pela 1ª vez no dia, then vê ≥3 observações com período coberto exibido, e nova row de audit `analyze-patterns` é criada.
- Given a aba já carregada no dia, when é reaberta, then conteúdo vem do cache e nenhuma nova row de audit `analyze-patterns` é criada.
- Given usuário com entradas em <3 dias nos últimos 7, when abre a aba, then vê mensagem de insuficiência sem linha de audit.
- Given token ausente/inválido, when `GET /report/weekly`, then 401 e web app não exibe a aba (ou exibe erro de auth).
- Given Claude falha, when 1ª abertura do dia, then UI mostra estado de erro com retry; sem upsert no banco.

## Design Notes

Cache check SQL:
```sql
SELECT * FROM weekly_reports WHERE user_id = $1
-- cache válido se:
--   period_end = (now() AT TIME ZONE 'America/Sao_Paulo')::date
--   AND generated_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
--                        AT TIME ZONE 'America/Sao_Paulo'
```

Upsert no generate:
```sql
INSERT INTO weekly_reports (user_id, period_start, period_end, analysis_json)
VALUES ($1, $2, $3, $4::jsonb)
ON CONFLICT (user_id) DO UPDATE
  SET period_start = EXCLUDED.period_start,
      period_end   = EXCLUDED.period_end,
      analysis_json = EXCLUDED.analysis_json,
      generated_at  = now()
```

Janela de 7 dias (period_start/period_end em SP):
```sql
-- period_end  = (now() AT TIME ZONE 'America/Sao_Paulo')::date
-- period_start = period_end - INTERVAL '6 days'
-- filtro em entries: (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $period_start AND $period_end
```

`analysis_json` é JSONB: pg entrega já parseado; no INSERT passar `JSON.stringify(analysis)`.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (backend)
- `cd web && npm run build` -- expected: `tsc` + `vite build` sem erros (web)
- `npm run db:migrate` -- expected: aplica 009; idempotente ao re-rodar

**Manual checks:**
- Abrir aba "Relatório" com ≥3 dias de entradas → observações visíveis + período exibido; verificar nova row em outbound audit (`analyze-patterns`).
- Fechar e reabrir a aba → sem nova row de audit (cache).
- Forçar `analysis_json = NULL` em `weekly_reports` via SQL → aba regenera na próxima abertura.
- Período com <3 dias → mensagem de insuficiência, nenhuma row de audit.

## Suggested Review Order

**Backend — entry point e cache**

- Rota principal: autenticação → cache check → carga → guard → IA → upsert.
  [`report.ts:30`](../../src/routes/report.ts#L30)

- Cache check via SQL: `period_end = hoje SP` E `generated_at >= início-do-dia SP`.
  [`report.ts:43`](../../src/routes/report.ts#L43)

- Janela rolling 7d calculada no banco (America/Sao_Paulo) — evita aritmética JS.
  [`report.ts:79`](../../src/routes/report.ts#L79)

**Backend — load + guard + IA**

- Query de entradas: `json_agg FILTER (WHERE fi.id IS NOT NULL)` garante `[]` sem foods.
  [`report.ts:88`](../../src/routes/report.ts#L88)

- Guard de suficiência: ≥3 dias distintos em SP antes de pagar a IA.
  [`report.ts:111`](../../src/routes/report.ts#L111)

- Upsert `ON CONFLICT (user_id)`: `generated_at` vem do `RETURNING` do banco (não do app clock).
  [`report.ts:144`](../../src/routes/report.ts#L144)

**Schema**

- Tabela `weekly_reports` idempotente: `IF NOT EXISTS` + unique index por `user_id`.
  [`009_weekly_reports.sql:6`](../../src/db/migrations/009_weekly_reports.sql#L6)

**Web — componente lazy**

- `WeeklyReportView`: `useRef` dedupe, 4 estados, load ao montar (primeiro acesso da aba).
  [`App.tsx:944`](../../web/src/App.tsx#L944)

- `load()`: chama `fetchWeeklyReport`, discrimina `insufficient` vs analysis vs error.
  [`App.tsx:952`](../../web/src/App.tsx#L952)

- Render dos 4 estados: loading / insufficient / error+retry / ok (lista de observations).
  [`App.tsx:998`](../../web/src/App.tsx#L998)

**Periféricos**

- `fetchWeeklyReport()`: delega ao helper `request<T>` autenticado; 401 → `UnauthorizedError`.
  [`api.ts:237`](../../web/src/api.ts#L237)

- `WeeklyReportPayload`: union discriminada por `generated_at` vs `insufficient`.
  [`types.ts:113`](../../web/src/types.ts#L113)

- `EntryQueryRow` + `WeeklyReportRow`: tipos do DB movidos para models.ts (sem inline em route).
  [`models.ts:203`](../../src/types/models.ts#L203)

- CSS do relatório: `.weekly-report-header`, `.pattern-card`, `.patterns-meta`.
  [`styles.css:356`](../../web/src/styles.css#L356)

- Registro do route em `buildApp`.
  [`app.ts:46`](../../src/app.ts#L46)
