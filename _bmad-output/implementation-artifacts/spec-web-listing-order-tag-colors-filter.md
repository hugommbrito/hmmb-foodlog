---
title: 'Revisão web: ordenar por data, cores de tag, filtro por tag e badge único no card'
type: 'feature'
created: '2026-06-24'
status: 'done'
baseline_commit: '3a366012e1925c0cb0da9640e3f864ad29f8f5cf'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A listagem da revisão diária não reflete o que o usuário quer: a ordem é por "pendentes/menor confiança" (não por data), as tags de contexto (CAP-9) não têm cor, não há como filtrar a lista por tag, e cada card mostra TODAS as tags como chips — poluindo o card em vez de exibir só a tag daquele registro.

**Approach:** (1) Ordenar a lista puramente por `created_at`, com botão para alternar crescente/decrescente. (2) Dar cor a cada tag: nova coluna `context_tags.color` (HEX) editável por um color picker nativo na aba Tags. (3) Filtro de seleção única na revisão: `Todas | <tags coloridas> | Sem tag` (client-side). (4) No card, exibir só a tag atual como badge colorido; tocar o badge abre o seletor de chips para trocar/limpar.

## Boundaries & Constraints

**Always:**
- Cor é HEX `#RRGGBB` validado (`/^#[0-9a-f]{6}$/i`) no backend; toda query parametrizada via `query<T>()`; auth Bearer (cópia local em `tags.ts`, padrão atual).
- Migration idempotente (`ADD COLUMN IF NOT EXISTS`, default neutro `#9ca3af`); `db:migrate` re-roda todos os `.sql`.
- Ordenação e filtro são **client-side** sobre os entries já carregados — `GET /entries` não muda. `pending` continua contando todos os não-revisados (independe do filtro).
- O badge/seletor reusa o endpoint existente `PATCH /entries/:id/context` (setar/limpar) — sem novo endpoint de contexto. A cor do badge vem do `tags` já carregado no `Review` (match por `context_tag_id`), não de um novo campo em `/entries`.
- Texto do badge usa cor de contraste (preto/branco) calculada pela luminância da cor da tag.

**Ask First:**
- Qualquer mudança no contrato de `GET /entries` (ex.: ordenar/filtrar no servidor).
- Persistir a preferência de ordem/filtro (localStorage) — fora do escopo salvo se pedido.

**Never:**
- Não tocar no fluxo de captura (WhatsApp / `POST /entries/photo`), na fila de IA, nem na sugestão de tag pela IA.
- Não auto-atribuir cores distintas às 4 tags default na migration (evita clobber em re-run) — começam neutras, usuário customiza.
- Sem nova suíte de testes (projeto não tem runner).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Criar tag com cor | `POST /tags {name,color:"#4f8cff"}` | 201 `{id,name,color}` | nome inválido → 400; duplicado → 409; cor inválida → 400 |
| Criar tag sem cor | `POST /tags {name}` | 201 com `color` = default `#9ca3af` | — |
| Mudar cor | `PATCH /tags/:id {color:"#e11d48"}` | 200 `{id,name,color}`; nome inalterado | cor inválida → 400; não-dono → 404 |
| Renomear (sem cor) | `PATCH /tags/:id {name:"padaria"}` | 200; cor inalterada | duplicado → 409; inválido → 400 |
| PATCH vazio | `PATCH /tags/:id {}` | 400 (nada para atualizar) | — |
| Ordenar | toggle asc/desc na revisão | lista reordena por `created_at` na direção escolhida | — |
| Filtrar por tag | seleciona uma tag | só entries com aquele `context_tag_id` | — |
| Filtrar "Sem tag" | seleciona "Sem tag" | só entries com `context_tag_id === null` | — |
| Card com tag | entry com `context_tag_id` | badge colorido com o nome; toque abre seletor | — |
| Card sem tag | `context_tag_id === null` | botão discreto "+ Tag" que abre o seletor | — |

</frozen-after-approval>

## Code Map

- `src/db/migrations/006_context_tag_color.sql` -- NOVO: `ALTER TABLE context_tags ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#9ca3af'`.
- `src/types/models.ts` -- `ContextTag` ganha `color: string`.
- `src/routes/tags.ts` -- `listTags`/POST/PATCH passam a ler/gravar `color`; `validateColor` (HEX); POST aceita `color?` (default); PATCH aceita `name?` e/ou `color?` (≥1 obrigatório, SET dinâmico).
- `web/src/types.ts` -- `ContextTag` ganha `color: string`.
- `web/src/api.ts` -- `createTag(name, color?)`; trocar `renameTag` por `updateTag(id, {name?, color?})`.
- `web/src/App.tsx` -- Review: estado de direção (`'desc'|'asc'`) + toggle e `sortByCreated` (substitui `sortForReview`); estado de filtro de tag + segmento `Todas|tags|Sem tag`; `visible = useMemo(filtra+ordena)`. EntryCard: badge colorido único da tag atual + toque abre o seletor de chips existente (estado `pickerOpen`); helper `textOn(hex)` para contraste. TagsManager: `<input type="color">` por linha e na criação, chamando `updateTag`/`createTag`.
- `web/src/styles.css` -- `.tag-badge` (badge colorido), `.tag-filter` (segmento), ajuste do toggle de ordem e do swatch de cor na aba Tags.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/006_context_tag_color.sql` -- adicionar coluna `color` com default neutro, idempotente -- base do modelo de cor
- [x] `src/types/models.ts` -- `ContextTag.color: string` -- contrato compartilhado
- [x] `src/routes/tags.ts` -- ler/gravar `color`; `validateColor`; POST `color?`; PATCH `name?`/`color?` com SET dinâmico e validação "≥1 campo" -- API de cor (req 2)
- [x] `web/src/{types.ts,api.ts}` -- tipo `color`; `createTag(name,color?)` + `updateTag(id,{name?,color?})` -- camada web
- [x] `web/src/App.tsx` -- ordenação por data + toggle (req 1); filtro por tag (req 3); badge único + seletor sob toque no card (req 4); color picker na aba Tags (req 2) -- UI
- [x] `web/src/styles.css` -- estilos de badge, filtro, toggle e swatch -- acabamento visual

**Acceptance Criteria:**
- Given entries de um dia, when alterno a ordem, then a lista reordena 100% por data de criação na direção escolhida (sem agrupar por revisado/confiança).
- Given uma cor definida na aba Tags, when recarrego, then a cor persiste e aparece no badge do card e no segmento de filtro.
- Given seleciono uma tag (ou "Sem tag") no filtro, when a lista renderiza, then só aparecem os registros correspondentes; "Todas" mostra tudo; o contador de pendentes não muda.
- Given um card com tag, when toco o badge, then abre o seletor para trocar/limpar via `PATCH /entries/:id/context`, sem marcar a entry como revisada; um card sem tag mostra "+ Tag" que abre o mesmo seletor.

## Design Notes

A cor do badge no card vem do array `tags` que o `Review` já carrega (lookup por `context_tag_id`), evitando alterar `GET /entries`. Contraste do texto por luminância:

```ts
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}
```

PATCH dinâmico em `tags.ts`: montar `SET` só com os campos presentes (`name`/`color`), validando cada um; rejeitar 400 se ambos ausentes. Mantém o 409 case-insensitive já existente no rename.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (backend)
- `cd web && npm run build` -- expected: `tsc` + `vite build` sem erros (web)
- `npm run db:migrate` -- expected: aplica 006 e é idempotente ao re-rodar

**Manual checks:**
- Aba Tags: mudar a cor de uma tag persiste após reload; criar tag nasce com a cor escolhida (ou neutra).
- Revisão: toggle inverte a ordem por data; filtrar por tag e por "Sem tag" restringe a lista; "Todas" volta tudo.
- Card: mostra só a tag atual (badge colorido); tocar abre o seletor, trocar/limpar persiste e não marca como revisado.

## Suggested Review Order

**Cor da tag (modelo → API)**

- Ponto de entrada: coluna `color` aditiva, default neutro, sem auto-colorir defaults (idempotente).
  [`006_context_tag_color.sql:9`](../../src/db/migrations/006_context_tag_color.sql#L9)

- Validação HEX `#RRGGBB` reutilizada por POST e PATCH.
  [`tags.ts:47`](../../src/routes/tags.ts#L47)

- PATCH com SET dinâmico: aceita `name` e/ou `color`, 400 se ambos ausentes.
  [`tags.ts:132`](../../src/routes/tags.ts#L132)

- Contrato compartilhado ganha `color`.
  [`models.ts:15`](../../src/types/models.ts#L15)

**Ordenação e filtro (req 1 e 3)**

- Ordem pura por `created_at`, direção alternável — substitui o sort por revisão/confiança.
  [`App.tsx:69`](../../web/src/App.tsx#L69)

- `visible`: filtra por tag/`all`/`none` e ordena; `pending` segue sobre todos.
  [`App.tsx:287`](../../web/src/App.tsx#L287)

- Segmento de filtro `Todas | tags coloridas | Sem tag`.
  [`App.tsx:323`](../../web/src/App.tsx#L323)

**Badge único no card (req 4)**

- Contraste de texto por luminância da cor da tag.
  [`App.tsx:77`](../../web/src/App.tsx#L77)

- Badge da tag atual; toque abre o seletor de chips (troca/limpa via `PATCH /context`).
  [`App.tsx:518`](../../web/src/App.tsx#L518)

**Color picker na aba Tags (req 2)**

- Persiste no `onBlur` (não onChange) para não disparar PATCH a cada tick do picker.
  [`App.tsx:789`](../../web/src/App.tsx#L789)

- `createTag(name,color?)` + `updateTag(id,{name?,color?})`.
  [`api.ts:85`](../../web/src/api.ts#L85)
