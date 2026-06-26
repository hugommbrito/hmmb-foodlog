---
title: 'CAP-8 — Busca no histórico por nome de alimento'
type: 'feature'
created: '2026-06-26'
status: 'done'
baseline_commit: 'e7662bfc614c4f805c4871de2094db73f68e7d0c'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Não há como encontrar entradas contendo um alimento específico ao longo de todo o histórico; o usuário não consegue responder "quando comi pizza pela última vez?" sem percorrer dia a dia.

**Approach:** Adicionar endpoint autenticado `GET /entries/search?q=pizza` que busca em `food_items.description` via `ILIKE`, retornando `EntryWithFoods[]` em ordem cronológica; adicionar campo de busca no web app (modo busca × modo calendário); na view do nutricionista, filtrar client-side os dados já carregados.

## Boundaries & Constraints

**Always:**
- Query mínima de 2 caracteres — abaixo disso, retornar 400 `{ error: "Query muito curta (mínimo 2 caracteres)" }`
- Busca case-insensitive via `lower(description) LIKE lower('%' || $2 || '%')`
- Retornar **toda** a entry (com todos os `food_items`) para entries onde ao menos um item bate — não filtrar os itens internos
- Resultado em ordem cronológica crescente (`created_at ASC`)
- Autenticação via Bearer token, igual aos demais endpoints de `/entries`
- Registrar no audit log de outbound se houver chamadas externas (não há nesta CAP)

**Ask First:**
- Se o dataset do usuário ultrapassar 10 mil entries e a busca ficar lenta, propor adicionar índice `pg_trgm` antes de prosseguir.

**Never:**
- Paginação (app single-user, dataset pequeno)
- Full-text search com `tsvector`/`tsquery` nesta iteração
- Busca na view do nutricionista via endpoint separado — usar filtro client-side
- Alterar o fluxo de captura ou re-análise

## I/O & Edge-Case Matrix

| Cenário | Input / Estado | Saída Esperada | Tratamento de Erro |
|---------|---------------|----------------|-------------------|
| Happy path | `?q=pizza`, user tem entries com "Pizza Margherita" | Array com entries contendo esse food, ordem cronológica | N/A |
| Sem resultados | `?q=quinoa`, sem match | `[]` (200 OK) | N/A |
| Query curta | `?q=a` | 400 `{ error: "Query muito curta (mínimo 2 caracteres)" }` | mensagem exibida no UI |
| Query vazia | `?q=` ou sem `q` | 400 igual | mensagem exibida no UI |
| Entry com vários foods | entry com "Arroz", "Feijão", "Frango" buscando "feijão" | Retorna a entry inteira com os 3 foods | N/A |
| Busca no nutricionista | Digitar "frango" na view do link compartilhado | Filtra localmente as entries já carregadas | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/entries.ts` — rota GET `/entries` existente; adicionar GET `/entries/search`
- `src/types/models.ts` — interfaces `EntryWithFoods`, `FoodItem` (sem alteração — reusar)
- `web/src/api.ts` — cliente HTTP do frontend; adicionar `searchEntries(q)`
- `web/src/App.tsx` — view principal de revisão; adicionar barra de busca + modo resultados
- `web/src/Share.tsx` — view read-only do nutricionista; adicionar filtro client-side
- `web/src/types.ts` — tipos frontend (sem alteração esperada)

## Tasks & Acceptance

**Execution:**

- [x] `src/routes/entries.ts` — adicionar `GET /entries/search` com query param `q`: validar ≥2 chars (400 se inválido); query SQL com `EXISTS` em `food_items` via `ILIKE`, `LEFT JOIN food_items` e `json_agg` igual ao padrão do `GET /entries`; retornar `EntryWithFoods[]` em `created_at ASC`

- [x] `web/src/api.ts` — adicionar função `searchEntries(q: string, token: string): Promise<EntryWithFoods[]>` chamando `GET /entries/search?q={q}` com Bearer token

- [x] `web/src/App.tsx` — adicionar campo de busca no topo; quando preenchido (≥2 chars), exibir modo "resultados da busca" em vez do calendário; cada resultado exibe a entry card com data, alimentos e macros; botão/ação para limpar busca e voltar ao calendário

- [x] `web/src/Share.tsx` — adicionar input de filtro por nome de alimento; filtrar client-side o array de entries já carregado (`entries.some(food => food.description.toLowerCase().includes(q.toLowerCase()))`); exibir contador de resultados

**Acceptance Criteria:**

- Dado que o usuário tem entries com "Pizza Margherita", quando busca "pizza", então vê todas as entries contendo pizza em ordem cronológica
- Dado busca com 1 caractere, quando submete, então a API retorna 400 e o UI exibe mensagem de erro
- Dado busca sem resultados, quando submete, então vê lista vazia com mensagem "Nenhum resultado para X"
- Dado nutricionista na view compartilhada, quando digita no campo de filtro, então as entries são filtradas client-side sem chamada ao servidor
- Dado entry com 3 foods onde apenas 1 bate, quando a busca retorna essa entry, então todos os 3 foods são exibidos no card

## Suggested Review Order

**Ponto de entrada — contrato da API**

- Validação de `q`, escape de wildcards e SQL EXISTS com ILIKE
  [`entries.ts:150`](../../src/routes/entries.ts#L150)

- Escape de `%`/`_` para literais no LIKE (patch de revisão)
  [`entries.ts:162`](../../src/routes/entries.ts#L162)

**Frontend — estado e efeito de busca**

- Estado de busca (searchQuery, searchResults, isSearchMode) e derivação
  [`App.tsx:234`](../../web/src/App.tsx#L234)

- useEffect debounced 300ms com cancellação e loading defer
  [`App.tsx:275`](../../web/src/App.tsx#L275)

**Frontend — UI e modo resultados**

- Barra de busca + botão Limpar no header do Review
  [`App.tsx:464`](../../web/src/App.tsx#L464)

- Condicional search mode vs. calendar mode; ResultadosCount
  [`App.tsx:513`](../../web/src/App.tsx#L513)

- SearchEntryCard: date label + EntryCard como siblings `<li>`
  [`App.tsx:909`](../../web/src/App.tsx#L909)

**Sync de estado após mutações**

- handleAccept/handleDelete/handleReanalyze/handleSetContext atualizando searchResults
  [`App.tsx:302`](../../web/src/App.tsx#L302)

**View do nutricionista — filtro client-side**

- filteredEntries useMemo; filtro aplicado a CalendarView e ListView
  [`Share.tsx:131`](../../web/src/Share.tsx#L131)

- Input de filtro visível quando view ≠ patterns; contador de resultados
  [`Share.tsx:196`](../../web/src/Share.tsx#L196)

**Cliente HTTP**

- searchEntries com encodeURIComponent para evitar injeção de query string
  [`api.ts:68`](../../web/src/api.ts#L68)

## Spec Change Log

## Design Notes

**SQL query pattern para `/entries/search`:**
```sql
SELECT e.id, e.user_id, e.created_at, e.photos, e.title,
       e.context_tag_id, e.ai_confidence_overall, e.reviewed, e.ai_cycles,
       ct.name AS context,
       COALESCE(json_agg(fi.*) FILTER (WHERE fi.id IS NOT NULL), '[]') AS foods
FROM entries e
LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
LEFT JOIN food_items fi ON fi.entry_id = e.id
WHERE e.user_id = $1
  AND EXISTS (
    SELECT 1 FROM food_items fi2
    WHERE fi2.entry_id = e.id
      AND lower(fi2.description) LIKE '%' || lower($2) || '%'
  )
GROUP BY e.id, ct.name
ORDER BY e.created_at ASC
```

**Índice diferido:** Para dataset > 5 k entries, adicionar `CREATE EXTENSION IF NOT EXISTS pg_trgm` e `CREATE INDEX ON food_items USING gin(lower(description) gin_trgm_ops)`. Adiado para dívida técnica.

## Verification

**Commands:**
- `cd "/Users/hugommbrito/Documents/CODE/Projetos Pessoais/hmmb-foodlog" && npx tsc --noEmit` -- expected: zero erros de tipo
- `cd "/Users/hugommbrito/Documents/CODE/Projetos Pessoais/hmmb-foodlog/web" && npx tsc --noEmit` -- expected: zero erros de tipo no frontend

**Manual checks:**
- `GET /entries/search?q=a` com token válido → 400 com mensagem de erro
- `GET /entries/search?q=arroz` com token válido → array de entries (ou `[]` se não houver)
- No web app, digitar "pizza" na barra de busca → muda para modo resultados
- Limpar busca → volta para calendário
- Na view do nutricionista, digitar no filtro → filtra sem reload
