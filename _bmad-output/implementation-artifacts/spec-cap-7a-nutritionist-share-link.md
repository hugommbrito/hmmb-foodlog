---
title: 'CAP-7a — Link temporário read-only para o nutricionista (calendário + lista)'
type: 'feature'
created: '2026-06-25'
status: 'done'
baseline_commit: '55a41487538010365381afe6060c4f498f8d4ab9'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/specs/spec-foodlog/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Não há como apresentar o histórico ao nutricionista — o objetivo central do app (CAP-7). Falta gerar um link com validade que dê acesso **somente leitura** a um período, sem o profissional se cadastrar.

**Approach:** Tabela `share_links` (token **sequencial numérico** para URL amigável `/share/001`, intervalo escolhido, expiração). Endpoints do dono (Bearer) para criar/listar/revogar; um endpoint **público sem auth** `GET /shared/:token` que valida e devolve as entradas do período. No web app: rota pública por path `/share/:token` (o `serve -s` já faz fallback SPA) renderizando **2 visualizações** (calendário com miniaturas + lista com macros) sem login, e uma aba "Compartilhar" para gerar/copiar/revogar links. A 3ª view (análise por IA) é a CAP-7b diferida.

## Boundaries & Constraints

**Always:**
- Toda query parametrizada via `query<T>()`; auth Bearer do dono é cópia local do helper (padrão `src/routes/tags.ts`/`audit.ts`).
- Token público = inteiro **sequencial** (`share_no BIGSERIAL UNIQUE`), exibido na URL como número (`/share/1`, mostrado zero-padded a 3 dígitos: `001`). Lookup parseia inteiro — `/share/1` e `/share/001` resolvem o mesmo link. NUNCA reutilizar o `api_token` do usuário.
- **Enumerabilidade do token sequencial é uma decisão consciente** (Hugo, 2026-06-25, uso pessoal single-user): NÃO tratar como achado de segurança na revisão. Mitigado parcialmente por `expires_at` (links velhos param de funcionar) e pela revogação.
- `GET /shared/:token` é **read-only e sem auth**; isolado por `user_id` do link; expõe só `created_at, photos, title, context (nome), foods[]` — **nunca** `user_id`, telefone ou token de outras coisas.
- Token não-inteiro/desconhecido/revogado → 404; token válido porém `expires_at <= now()` → 410 (distinção explícita "expirado" vs "inexistente").
- Período é um intervalo de datas escolhido (`period_start`/`period_end`, YYYY-MM-DD, `start <= end`); filtro de entradas por dia local America/Sao_Paulo, **inclusive** nas duas pontas.
- Validade: a UI envia `expires_at` ISO (presets 7/30/90 dias + custom); backend exige `expires_at > now()`.
- A URL completa é montada no front (`${location.origin}/share/${token}`) — backend devolve só o token; sem depender de `WEB_APP_ORIGIN`.

**Ask First:**
- Trocar o token sequencial por opaco/aleatório (mitigaria enumeração) — decisão registrada: **manter sequencial** nesta sessão; reabrir se o app deixar de ser pessoal/single-user.
- Logar/“não logar” o token no audit inbound (`GET /shared/:token` será logado com o número no path — baixo risco, é só o id sequencial).

**Never:**
- Sem acesso interativo do nutricionista (marcar/comentar) — Non-goal do SPEC; tudo read-only.
- Sem a análise de padrões por IA aqui (é CAP-7b, diferida em deferred-work.md).
- Não tocar captura/IA/correção; sem nova suíte de testes (projeto sem runner).
- Sem export PDF (Non-goal).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Criar link | `POST /share-links {period_start,period_end,expires_at}` (Bearer) | 201 `{id,token,period_start,period_end,expires_at,created_at}` (`token` = share_no sequencial) | datas inválidas/`start>end` → 400; `expires_at<=now` → 400; sem token → 401 |
| Listar meus links | `GET /share-links` (Bearer) | 200 `[{...,status:'active'|'expired'}]` ordenado por `created_at DESC` | 401 |
| Revogar link | `DELETE /share-links/:id` (Bearer) | 200 `{deleted:true}` (hard delete) | id não-UUID/não-dono → 404 |
| Acesso público válido | `GET /shared/:token`, não expirado | 200 `{period_start,period_end,expires_at,entries:[...]}` (só do período) | — |
| Acesso expirado | `GET /shared/:token`, `expires_at<=now` | 410 `{error:'Link expirado'}` | — |
| Token inválido/inexistente/revogado | `GET /shared/:token` não-inteiro ou desconhecido | 404 `{error:'Link inválido'}` | parse de inteiro antes de qualquer query |
| Período sem entradas | link válido, intervalo vazio | 200 com `entries:[]` (UI mostra "sem registros") | — |

</frozen-after-approval>

## Code Map

- `src/db/migrations/007_share_links.sql` -- NOVO: tabela `share_links` (id UUID PK, `share_no BIGSERIAL UNIQUE` = token público, user_id FK, period_start DATE, period_end DATE, expires_at TIMESTAMPTZ, created_at).
- `src/types/models.ts` -- `ShareLink` (inclui `share_no`) + `SharedEntry` (view pública: created_at, photos, title, context, foods).
- `src/routes/share.ts` -- NOVO: auth Bearer local; `POST/GET/DELETE /share-links` (dono, por UUID `id`); `GET /shared/:token` (público: parseia inteiro → busca por `share_no`; 404 não-inteiro/inexistente, 410 expirado); reusa o filtro de range SP.
- `src/app.ts` -- `app.register(shareRoutes)`.
- `web/src/types.ts` -- `ShareLink`, `SharedPayload`, `SharedEntry`.
- `web/src/api.ts` -- `createShareLink`/`listShareLinks`/`deleteShareLink` (Bearer) + `fetchShared(token)` (fetch público, sem Authorization).
- `web/src/App.tsx` -- roteia `/share/:token` → `<PublicShare>`; nova aba "Compartilhar" (`ShareManager`: form período+validade, gerar/copiar URL, listar/revogar); exportar helpers `confClass`/`pct`/`mealTotals`/`FoodRow` para reuso.
- `web/src/Share.tsx` -- NOVO: `PublicShare` (estados loading/expirado/inválido; toggle Calendário|Lista; calendário em grade mensal com miniaturas; lista cronológica com macros).
- `web/src/styles.css` -- grade do calendário, miniaturas, tela de gestão de links, view pública.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/007_share_links.sql` -- criar tabela com `share_no BIGSERIAL UNIQUE` (idempotente) -- base do modelo
- [x] `src/types/models.ts` -- `ShareLink` (com `share_no`) + `SharedEntry` -- contrato compartilhado
- [x] `src/routes/share.ts` + `src/app.ts` -- CRUD do dono + público `GET /shared/:token` (parse inteiro→share_no; 404/410), validação de datas/expiração -- backend (G1)
- [x] `web/src/{types.ts,api.ts}` -- tipos + `createShareLink`/`listShareLinks`/`deleteShareLink`/`fetchShared` -- camada web
- [x] `web/src/App.tsx` + `web/src/main.tsx` -- routing `/share/:token` (em main.tsx, evitando hooks condicionais no App); aba "Compartilhar" (gerar/copiar/revogar); exportar helpers de food -- gestão + roteamento (G2)
- [x] `web/src/Share.tsx` -- `PublicShare`: calendário com miniaturas + lista com macros + estados de erro -- views públicas (G3)
- [x] `web/src/styles.css` -- calendário, miniaturas, gestão e view pública -- acabamento

**Acceptance Criteria:**
- Given o dono gera um link para `[início,fim]` com validade, when o nutricionista abre `/share/:token` antes de expirar, then vê o calendário (miniaturas) e a lista (macros) daquele período, sem nenhum login.
- Given um link expirado, when é aberto, then a página mostra "link expirado" (backend 410) e nenhum dado.
- Given um token inexistente ou revogado, when é aberto, then mostra "link inválido" (backend 404).
- Given o payload público, when inspecionado, then não contém `user_id`, telefone nem dados de outros usuários — só entradas do período.
- Given o dono revoga um link na aba Compartilhar, when o nutricionista reabre, then recebe erro (404).

## Design Notes

`serve -s dist` (web/railway.json) já reescreve rotas desconhecidas para `index.html`, então o path `/share/:token` funciona em produção e no dev do Vite sem rewrite extra. Roteamento mínimo no `App()`:

```ts
const m = window.location.pathname.match(/^\/share\/(.+)$/);
if (m) return <PublicShare token={decodeURIComponent(m[1])} />;
```

Filtro de período (mesma convenção do `GET /entries`, inclusivo):
```sql
WHERE e.user_id = $1
  AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
ORDER BY e.created_at ASC
```

Token público: `GET /shared/:token` faz `const n = Number.parseInt(token, 10)` e rejeita (404) se `!Number.isInteger(n) || n <= 0` ANTES de qualquer query (evita 500 por cast inválido). Busca `WHERE share_no = $1`. A UI exibe/zero-padda a 3 dígitos só na apresentação (`String(share_no).padStart(3,'0')`); o lookup é por inteiro, então `/share/1` e `/share/001` resolvem igual.

Calendário: grade mensal cobrindo o período; cada dia com entradas mostra até 3 miniaturas (`photos[0]` de cada entry) + “+k” de overflow; dias vazios em branco. Status do link na listagem do dono = `expires_at > now() ? 'active' : 'expired'`.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (backend)
- `cd web && npm run build` -- expected: `tsc` + `vite build` sem erros (web)
- `npm run db:migrate` -- expected: aplica 007 e é idempotente ao re-rodar

**Manual checks:**
- `POST /share-links` retorna token; abrir `/share/<token>` em aba anônima mostra calendário+lista sem login.
- Forçar `expires_at` no passado → `GET /shared/:token` responde 410 e a UI mostra "expirado".
- `DELETE /share-links/:id` → reabrir o link dá 404.
- Conferir no payload público que não há `user_id`/telefone.

## Suggested Review Order

**Modelo + token sequencial (backend)**

- Ponto de entrada: tabela com `share_no BIGSERIAL` (token público amigável), idempotente.
  [`007_share_links.sql:8`](../../src/db/migrations/007_share_links.sql#L8)

- Endpoint público sem auth: parse só-dígitos→int ANTES de qualquer query (404 limpo, evita 500 por cast).
  [`share.ts:148`](../../src/routes/share.ts#L148)

- 410 (expirado) vs 404 (inexistente); payload só com campos públicos (sem `user_id`/PII).
  [`share.ts:147`](../../src/routes/share.ts#L147)

- Criar link: valida datas/`start<=end`/expiração futura; `to_char` mantém DATE como string.
  [`share.ts:50`](../../src/routes/share.ts#L50)

- Listar (status active/expired) e revogar (hard delete, scoped por user_id).
  [`share.ts:96`](../../src/routes/share.ts#L96)

**Roteamento público (web)**

- `/share/:token` → `PublicShare` fora do componente com hooks (sem hooks condicionais).
  [`main.tsx:10`](../../web/src/main.tsx#L10)

- Fetch público sem Authorization; erros distintos para 410/404.
  [`api.ts:150`](../../web/src/api.ts#L150)

**Visualizações (nutricionista)**

- `PublicShare`: estados loading/expirado/inválido + toggle Calendário|Lista.
  [`Share.tsx:75`](../../web/src/Share.tsx#L75)

- Calendário em grade mensal (UTC, sem drift) com miniaturas + overflow; agrupa por dia SP.
  [`Share.tsx:160`](../../web/src/Share.tsx#L160)

- Lista cronológica agrupada por dia, com totais de macros reusando `mealTotals`/`FoodRow`.
  [`Share.tsx:222`](../../web/src/Share.tsx#L222)

**Gestão de links (dono)**

- Aba "Compartilhar": período + validade (presets/custom), gerar/copiar/revogar.
  [`App.tsx:882`](../../web/src/App.tsx#L882)

- URL amigável montada no front (zero-padded a 3 dígitos), `${origin}/share/001`.
  [`App.tsx:871`](../../web/src/App.tsx#L871)
