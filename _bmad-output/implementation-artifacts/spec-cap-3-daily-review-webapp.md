---
title: 'CAP-3 — Web app de revisão diária (revisar + aceitar)'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: '9a13891dfc908d21c22dccf91a938fca6dad1fc0'
context:
  - _bmad-output/project-context.md
  - _bmad-output/specs/spec-foodlog/data-model.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** As fotos são capturadas (CAP-1) e a IA gera `food_items` + scores de confiança (CAP-2), mas não existe nenhuma forma de o usuário ver ou revisar esses dados — os resultados da IA ficam invisíveis e nenhuma entry sai de `reviewed: false`.

**Approach:** Um web app SPA (React + Vite, em `web/`) que lista as entries do dia com fotos, alimentos e macros identificados pela IA, aplica triagem visual por nível de confiança e permite **aceitar** uma entry com um toque (`reviewed: true`). Backend ganha dois endpoints REST autenticados por Bearer token (reusando `api_token`): listar entries de um dia e marcar uma entry como revisada. Correção/re-análise (CAP-4) fica de fora.

## Boundaries & Constraints

**Always:**
- Auth via `Authorization: Bearer {api_token}` em TODA rota nova — reusar o padrão de `extractBearerToken` + lookup `SELECT id FROM users WHERE api_token = $1`; nunca expor dados de outro `user_id`.
- "Entries do dia" filtra por dia **local America/Sao_Paulo**, não UTC: `(created_at AT TIME ZONE 'America/Sao_Paulo')::date = $date`.
- Cada entry retorna seus `food_items` aninhados (array `foods`), ordenadas por `created_at`.
- Triagem por confiança segue os thresholds do data-model: ≥0.85 verde, 0.70–0.84 neutro, <0.70 amarelo/laranja, 0.0 vermelho (entries 0.0 no topo da revisão).
- Frontend mobile-first/responsivo; `api_token` guardado em `localStorage`; base da API via `VITE_API_BASE_URL`.

**Ask First:**
- Adicionar qualquer migration ou alterar schema (a coluna `reviewed` já existe — não deve ser preciso).
- Qualquer endpoint de edição/correção de campos ou re-análise (isso é CAP-4).

**Never:**
- Correção de campos, re-análise da IA, busca (CAP-4/CAP-8), tag de contexto editável (CAP-9), link de nutricionista (CAP-7).
- Login/senha/sessão — auth é exclusivamente por `api_token`.
- Preenchimento nutricional manual pelo usuário.
- Inserir/alterar `food_items` (a UI é somente leitura sobre os dados da IA; só `reviewed` muda).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Listar dia | `GET /entries?date=2026-06-23` + token válido | 200; array de entries do dia local (SP) com `foods[]`, ordenadas por `created_at` | — |
| Sem `date` | `GET /entries` + token válido | 200; usa o dia local atual (SP) | — |
| Token ausente/inválido | qualquer rota nova | 401 `{ error }` | sem vazar dados |
| Dia vazio | `GET /entries?date=...` sem entries | 200; array vazio `[]` | UI mostra estado vazio |
| Aceitar entry | `PATCH /entries/:id` token válido, entry do próprio usuário | 200; entry com `reviewed: true` | — |
| Aceitar entry de outro/inexistente | `PATCH /entries/:id` id não pertence ao usuário | 404 `{ error }` | nunca atualiza |
| `date` malformado | `GET /entries?date=abc` | 400 `{ error }` | validar formato YYYY-MM-DD |

</frozen-after-approval>

## Code Map

- `src/routes/entries.ts` -- adicionar `GET /entries` e `PATCH /entries/:id`; extrair helper `authenticate(request) -> userId | null` reusado pelos 3 handlers (POST já existe)
- `src/db/client.ts` -- usar `query<T>()` para SELECT com JOIN entries↔food_items e UPDATE de `reviewed`
- `src/types/models.ts` -- `Entry` e `FoodItem` já existem; adicionar tipo de resposta `EntryWithFoods` (Entry + `foods: FoodItem[]`)
- `src/app.ts` -- registrar `@fastify/cors` (nova dependência)
- `src/config.ts` -- adicionar `WEB_APP_ORIGIN` opcional ao schema Zod (default permissivo p/ uso pessoal)
- `web/` -- novo app Vite + React + TS (SPA de revisão); não existe tooling de frontend hoje
- `.env.example` -- documentar `WEB_APP_ORIGIN`

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/entries.ts` -- extrair `authenticate()` do POST atual; adicionar `GET /entries` (filtro por dia local SP, JOIN food_items → `foods[]`, validar `date`) e `PATCH /entries/:id` (UPDATE `reviewed=true` com `WHERE id=$1 AND user_id=$2`, 404 se 0 linhas)
- [x] `src/types/models.ts` -- adicionar `EntryWithFoods`
- [x] `src/app.ts` + `src/config.ts` + `.env.example` -- registrar `@fastify/cors` usando `WEB_APP_ORIGIN` (reflect/true se ausente); instalar `@fastify/cors`
- [x] `web/` -- scaffold Vite React TS: gate de token (`localStorage`), tela de revisão diária (seletor de data default hoje, cards com fotos, `foods` + macros, cores por confiança, botão "Aceitar" → `PATCH`), estados vazio/erro/loading; client lê `VITE_API_BASE_URL` e envia Bearer
- [x] `web/README.md` ou raiz -- documentar `npm run dev` do web app e variável `VITE_API_BASE_URL`

**Acceptance Criteria:**
- Given um token válido e entries criadas hoje, when abro o web app, then vejo os cards do dia com fotos, alimentos/macros e cores de confiança corretas, com entries de confiança 0.0 no topo.
- Given um card não revisado, when toco em "Aceitar", then a entry vira `reviewed: true` no banco e o card reflete o estado aceito sem recarregar.
- Given nenhum token salvo, when abro o app, then vejo o gate pedindo o `api_token` antes de qualquer chamada.
- Given um token inválido, when o app chama a API, then recebo 401 e a UI orienta a refazer o token.

## Verification

**Commands:**
- `npm run build` (raiz) -- expected: `tsc` compila backend sem erros de tipo
- `cd web && npm run build` -- expected: Vite/tsc compila o SPA sem erros
- `curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/entries?date=$(date +%F)"` -- expected: 200 com JSON array (entries do dia + `foods`)
- `curl -s -X PATCH -H "Authorization: Bearer $TOKEN" http://localhost:3000/entries/$ID` -- expected: 200 com `reviewed: true`

**Manual checks:**
- Abrir `web` no celular (ou devtools responsivo): cards renderizam fotos do R2, cores batem com thresholds, "Aceitar" persiste e some/atualiza o destaque.

## Suggested Review Order

**API — autenticação e isolamento de usuário**

- Entry point: helper Bearer reusado pelos 3 handlers — sem este, nada autentica.
  [`entries.ts:37`](../../src/routes/entries.ts#L37)
- Listagem do dia: filtro por dia local SP e `foods[]` aninhado via `json_agg`.
  [`entries.ts:52`](../../src/routes/entries.ts#L52)
- Aceite escopado ao dono (`WHERE id=$1 AND user_id=$2`, 404 se 0 linhas) — sem vazamento cross-user.
  [`entries.ts:83`](../../src/routes/entries.ts#L83)

**API — robustez de entrada**

- Valida data de calendário real (não só shape) p/ evitar 500 no cast `::date`.
  [`entries.ts:13`](../../src/routes/entries.ts#L13)
- Boundary do dia em `America/Sao_Paulo`, default para hoje quando `date` ausente.
  [`entries.ts:72`](../../src/routes/entries.ts#L72)

**Frontend — camada de dados**

- Cliente HTTP: Bearer no header, `UnauthorizedError` no 401, `localStorage` defensivo.
  [`api.ts:33`](../../web/src/api.ts#L33)

**Frontend — UI de revisão**

- Triagem: cores por threshold de confiança (data-model) e ordenação 0.0 no topo.
  [`App.tsx:19`](../../web/src/App.tsx#L19)
- Aceitar atualiza o card localmente sem recarregar; 401 derruba para o gate.
  [`App.tsx:74`](../../web/src/App.tsx#L74)

**Periféricos — tipos, CORS, config**

- Contrato de resposta `EntryWithFoods` (Entry + foods).
  [`models.ts:37`](../../src/types/models.ts#L37)
- CORS para a origem do SPA (Bearer torna reflect aceitável; `WEB_APP_ORIGIN` fixa).
  [`app.ts:17`](../../src/app.ts#L17)
