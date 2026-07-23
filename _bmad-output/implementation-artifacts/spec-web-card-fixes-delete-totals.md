---
title: 'Web app: corrige CORS (aceitar/limpar), deleta entry e mostra totais no card'
type: 'feature'
created: '2026-06-24'
status: 'done'
context: ['{project-root}/_bmad-output/project-context.md']
baseline_commit: '6fa62480ea4c8c534844da34df08151334ec96d8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No web app de revisão, os botões "Aceitar" (`PATCH /entries/:id`) e "Limpar" auditoria (`DELETE /audit/requests`) retornam "failed to fetch". A causa raiz é o CORS: o default do `@fastify/cors` v11 é `methods: 'GET,HEAD,POST'` — PATCH e DELETE são bloqueados no preflight (confirmado contra produção). Além disso, falta um botão para excluir uma entry de comida específica, e o card não mostra os totais nutricionais da refeição.

**Approach:** (1) Setar `methods` explícito no CORS incluindo PATCH e DELETE — corrige aceitar e limpar de uma vez e habilita o delete. (2) Adicionar rota `DELETE /entries/:id` (scoped por user_id, cascade em food_items) + cliente API + botão no card. (3) Calcular no front a soma de kcal/proteína/carbo/gordura de `entry.foods` e exibir junto ao título.

## Boundaries & Constraints

**Always:**
- CORS: manter `origin: config.WEB_APP_ORIGIN ?? true`; só ampliar `methods`.
- DELETE de entry sempre scoped por `user_id` (igual a PATCH/GET); UUID inválido → 404; entry inexistente/não-própria → 404.
- Reusar `authenticate()` e o padrão `query<T>()` existentes em `src/routes/entries.ts`.
- Totais: somar apenas campos não-nulos; arredondar com `Math.round`; mesmo padrão visual dos macros já existentes (`FoodRow`).
- Frontend: tratar `UnauthorizedError` chamando `onLogout()` (padrão de `handleAccept`/`handlePurge`).

**Ask First:**
- Qualquer mudança de schema do banco ou migration nova.
- Soft-delete em vez de DELETE físico.

**Never:**
- Não somar "peso/gramas" — `quantity` é texto livre, sem campo numérico (decisão do usuário: só macros).
- Não tocar no fluxo de captura WhatsApp, na fila de IA, nem no endpoint multipart.
- Não adicionar autenticação/sessão nova; segue Bearer token.
- Não criar suíte de testes nova (projeto não tem test runner configurado).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deletar entry própria | `DELETE /entries/:id` com token válido, id existe e é do user | 200 `{ deleted: true }`; food_items removidos por cascade; some do card | N/A |
| Deletar entry de outro user / inexistente | id válido mas não pertence ao user | 404 `{ error: 'Entry not found' }` | UI mostra erro |
| Deletar com UUID malformado | `id` não-UUID | 404 (sem chegar ao Postgres) | N/A |
| Aceitar/Limpar após fix | PATCH/DELETE cross-origin do web app | Preflight permite método → 2xx | — |
| Totais com macros nulos | entry com `kcal=null` em alguns foods | Soma ignora nulos; se todos nulos para um macro, omite aquele macro | N/A |
| Card sem foods | `entry.foods` vazio | Não renderiza linha de totais | N/A |

</frozen-after-approval>

## Code Map

- `src/app.ts` -- registro do CORS; adicionar `methods` (fix dos itens 1 e 2).
- `src/routes/entries.ts` -- adicionar handler `app.delete('/entries/:id')`; reusar `authenticate`, `UUID_RE`, `query`.
- `src/db/migrations/001_initial_schema.sql` -- referência: `food_items.entry_id ... ON DELETE CASCADE` já existe (delete da entry remove os foods).
- `web/src/api.ts` -- adicionar `deleteEntry(id)`.
- `web/src/App.tsx` -- `Review.handleDelete`; prop `onDelete` no `EntryCard`; botão excluir; helper de totais + render no `card-head`.
- `web/src/styles.css` -- classe para a linha de totais (ex.: `.totals`) e, se preciso, ajuste do botão excluir.

## Tasks & Acceptance

**Execution:**
- [x] `src/app.ts` -- no `app.register(cors, {...})`, adicionar `methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']` -- desbloqueia PATCH/DELETE no preflight (itens 1, 2 e habilita 3).
- [x] `src/routes/entries.ts` -- adicionar `app.delete<{ Params: { id: string } }>('/entries/:id')`: autentica → 401; `UUID_RE` falha → 404; `DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id`; 0 linhas → 404; senão 200 `{ deleted: true }`.
- [x] `web/src/api.ts` -- adicionar `deleteEntry(id: string): Promise<{ deleted: boolean }>` via `request(..., { method: 'DELETE' })`.
- [x] `web/src/App.tsx` -- `Review`: `handleDelete` com `window.confirm` que chama `deleteEntry` e remove a entry do state (trata `UnauthorizedError`); passar `onDelete` ao `EntryCard`; botão "Excluir" (`link danger`) na `.actions`.
- [x] `web/src/App.tsx` -- helper que soma kcal/protein_g/fat_g/carbs_g de `entry.foods` (ignorando nulos) e renderiza no `card-head`, abaixo do título, quando houver foods.
- [x] `web/src/styles.css` -- estilo da linha de totais (`.totals`, fonte ~0.85rem, cor `--muted`), discreto como `.macros`.

**Acceptance Criteria:**
- Given o web app de produção apontando para a Railway, when o usuário clica "Aceitar" ou "Limpar", then a requisição completa sem "failed to fetch" (após redeploy do backend).
- Given uma entry própria, when clico "Excluir" e confirmo, then a entry e seus food_items são removidos e o card some sem reload.
- Given um card com alimentos analisados, when o card renderiza, then o título exibe a soma de kcal/proteína/carbo/gordura (sem peso), ignorando valores nulos.

## Design Notes

CORS — o default do `@fastify/cors` v11 é `methods: 'GET,HEAD,POST'` (verificado em `node_modules/@fastify/cors/index.js:11` e no header `access-control-allow-methods` de produção). Por isso PATCH/DELETE nunca funcionaram do browser.

Totais (exemplo de helper):
```ts
function totals(foods: FoodItem[]) {
  const sum = (k: 'kcal'|'protein_g'|'fat_g'|'carbs_g') =>
    foods.reduce((a, f) => a + (f[k] ?? 0), 0);
  return { kcal: sum('kcal'), p: sum('protein_g'), f: sum('fat_g'), c: sum('carbs_g') };
}
// render: `${Math.round(kcal)} kcal · P ${Math.round(p)}g · G ${Math.round(f)}g · C ${Math.round(c)}g`
```

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` compila sem erros (backend).
- `cd web && npm run build` -- expected: build do front sem erros de tipo.

**Manual checks:**
- Após `npm run dev` + web local apontando ao backend local, validar OPTIONS: `curl -i -X OPTIONS http://localhost:3000/entries/<uuid> -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: PATCH'` → `access-control-allow-methods` inclui PATCH/DELETE.
- **Deploy:** o fix de CORS só vale em produção após **rebuild + redeploy na Railway** (`node dist/server.js`). Avisar o usuário.

## Suggested Review Order

**Causa raiz (itens 1 e 2 — "failed to fetch")**

- Comece aqui: o default do `@fastify/cors` v11 é `GET,HEAD,POST`; explicitar `methods` desbloqueia PATCH/DELETE.
  [`app.ts:23`](../../src/app.ts#L23)

**Excluir entry (item 3)**

- Rota nova: auth → UUID → DELETE scoped por user_id; cascade remove os food_items.
  [`entries.ts:164`](../../src/routes/entries.ts#L164)
- Cliente API espelhando o padrão de `acceptEntry`.
  [`api.ts:65`](../../web/src/api.ts#L65)
- Handler com confirm + remoção otimista do state; trata `UnauthorizedError`.
  [`App.tsx:176`](../../web/src/App.tsx#L176)
- Botão "Excluir" (link danger) na linha de ações do card.
  [`App.tsx:392`](../../web/src/App.tsx#L392)

**Totais no título (item 4)**

- Soma só macros não-nulos e finitos; omite macro 100% nulo; sem peso.
  [`App.tsx:40`](../../web/src/App.tsx#L40)
- Render da linha de totais no `card-head`, abaixo do título.
  [`App.tsx:367`](../../web/src/App.tsx#L367)
- Estilo discreto, em paridade com `.macros`.
  [`styles.css:100`](../../web/src/styles.css#L100)
