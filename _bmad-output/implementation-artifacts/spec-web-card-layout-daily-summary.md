---
title: 'Revisão web — foto à esquerda no card e resumo do dia no topo'
type: 'feature'
created: '2026-06-25'
status: 'done'
baseline_commit: '06c3008'
context: ['{project-root}/_bmad-output/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Na tela de Revisão, cada card mostra as fotos numa faixa no topo e o conteúdo abaixo, desperdiçando largura; e não existe nenhuma visão agregada dos valores nutricionais do dia — o usuário só vê totais por refeição.

**Approach:** Reorganizar o card para layout horizontal (fotos à esquerda, título/macros/alimentos/ações à direita) e adicionar um cabeçalho de resumo no topo da lista que soma kcal/proteína/gordura/carboidrato das entradas **visíveis** (respeitando o filtro de tag ativo).

## Boundaries & Constraints

**Always:**
- Reaproveitar a lógica de soma de macros já existente (`mealTotals`) — extrair um agregador que some por entrada sem duplicar regras (null≠0, ignorar não-finitos, omitir macro nula em todas).
- O resumo soma apenas as entradas em `visible` (pós-filtro de tag e ordenação), não `entries`.
- Layout horizontal no desktop; abaixo de ~480px o card empilha (foto em cima) para o texto não espremer.
- Cards sem foto continuam válidos: a coluna de foto some e o conteúdo ocupa a largura toda.
- Manter pt-BR e os rótulos curtos existentes (`P`/`G`/`C` + `kcal`).

**Ask First:**
- Adicionar qualquer macro/campo novo não exibido hoje (ex.: peso/quantidade somada).
- Mudar a semântica do contador de "pendentes" (continua sobre TODAS as entradas).

**Never:**
- Tocar em backend, API, tipos do servidor ou outras abas (Tags/Compartilhar/Auditoria).
- Alterar a view pública do nutricionista (`Share.tsx`).
- Introduzir libs novas ou um sistema de design — só CSS e JSX no app existente.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dia com macros | Entradas visíveis com kcal/P/G/C | Resumo soma e exibe `N kcal · P Xg · G Yg · C Zg` + nº de entradas | N/A |
| Macro parcial | Alguns alimentos com macro nula | Soma só os finitos; macro nula em TODAS é omitida (não vira 0) | N/A |
| Sem entradas visíveis | Filtro/dia sem resultados | Resumo não é renderizado (nada de "0 kcal") | N/A |
| Filtro de tag ativo | Subconjunto visível | Resumo reflete só o subconjunto visível | N/A |
| Card sem foto | `photos: []` | Coluna de foto ausente; conteúdo ocupa 100% | N/A |
| Tela estreita (<480px) | Qualquer card | Foto volta ao topo (empilhado) | N/A |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx` -- componente `Review` (lista + header) e `EntryCard` (estrutura `.card`/`.photos`/`.card-body`); função `mealTotals` a reaproveitar; `visible` (useMemo) é a fonte do resumo
- `web/src/styles.css` -- regras `.card`, `.photos`, `.card-body` (hoje empilhadas); ponto de inserção do `.day-summary`

## Tasks & Acceptance

**Execution:**
- [x] `web/src/App.tsx` -- adicionar helper puro `dayTotals(entries: EntryWithFoods[]): string | null` que agrega os macros de todas as entradas reaproveitando a mesma regra de soma de `mealTotals` (refatorar a soma para uma função compartilhada `sumMacros`); exportar para teste futuro
- [x] `web/src/App.tsx` -- em `Review`, computar o resumo a partir de `visible` (useMemo) e renderizar um bloco `.day-summary` logo acima de `<ul className="cards">`, com os totais e a contagem de entradas; não renderizar quando `visible` está vazio
- [x] `web/src/App.tsx` -- em `EntryCard`, manter `.photos` + `.card-body` como filhos diretos de `.card` (já estão) para o flex horizontal funcionar via CSS; nenhum reload de dados
- [x] `web/src/styles.css` -- tornar `.card` um flex horizontal (foto à esquerda, corpo à direita), dar largura fixa à coluna `.photos` e altura total, `.card-body { flex: 1; min-width: 0 }`; media query `@media (max-width: 480px)` voltando para coluna; estilizar `.day-summary` (sticky-friendly dentro do header da review)

**Acceptance Criteria:**
- Given um dia com várias entradas, when a tela de Revisão carrega, then aparece um resumo no topo com a soma de kcal/P/G/C e a quantidade de entradas, e cada card mostra a foto à esquerda e as informações à direita.
- Given um filtro de tag aplicado, when ele muda a lista visível, then o resumo recalcula apenas sobre as entradas visíveis.
- Given uma janela com menos de 480px de largura, when os cards renderizam, then a foto volta para o topo do card (empilhado) sem cortar texto.

## Design Notes

Extrair de `mealTotals` a soma por chave para evitar divergência de regras:

```ts
function sumMacros(foods: FoodItem[], k: 'kcal'|'protein_g'|'fat_g'|'carbs_g'): number | null {
  const vals = foods.map(f => f[k]).filter((v): v is number => v != null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, v) => a + v, 0) : null;
}
```

`mealTotals` passa a usar `sumMacros`; `dayTotals` faz `entries.flatMap(e => e.foods)` e formata com o mesmo padrão `N kcal · P Xg · G Yg · C Zg` (omitindo macro nula em todas), retornando `null` quando não há nada a mostrar.

CSS do card horizontal (esboço):
```css
.card { display: flex; align-items: stretch; }
.photos { flex: 0 0 160px; flex-direction: column; }   /* coluna à esquerda */
.photos img { width: 160px; height: 100%; }
.card-body { flex: 1; min-width: 0; }
@media (max-width: 480px) { .card { flex-direction: column; } .photos { flex-direction: row; } }
```

## Verification

**Commands:**
- `cd web && npm run build` -- expected: `tsc` + `vite build` sem erros de tipo

**Manual checks:**
- `cd web && npm run dev`: abrir a Revisão, conferir foto à esquerda / texto à direita, o resumo no topo, a reação ao filtro de tag, um card sem foto e a largura <480px (empilhado).

## Suggested Review Order

**Agregação de macros (a lógica)**

- Entry point: regra única de soma (null≠0, ignora não-finitos) compartilhada por card e dia.
  [`App.tsx:79`](../../web/src/App.tsx#L79)

- Formata os 4 macros omitindo os nulos; reaproveitado pelos dois totais.
  [`App.tsx:91`](../../web/src/App.tsx#L91)

- `dayTotals` agrega `flatMap(foods)` de todas as entradas passadas.
  [`App.tsx:115`](../../web/src/App.tsx#L115)

**Resumo do dia na UI**

- Resumo memoizado sobre `visible` — reflete o filtro de tag, não `entries`.
  [`App.tsx:385`](../../web/src/App.tsx#L385)

- Barra renderizada só quando há entradas visíveis; totais sob guard.
  [`App.tsx:465`](../../web/src/App.tsx#L465)

**Layout do card (foto à esquerda)**

- `.card` vira flex horizontal; corpo ocupa o resto com `min-width:0`.
  [`styles.css:103`](../../web/src/styles.css#L103)

- Coluna da foto: `align-self:flex-start` evita faixa preta; `max-height` cobre muitas fotos.
  [`styles.css:118`](../../web/src/styles.css#L118)

- Fallback <480px empilha (foto no topo, scroll horizontal).
  [`styles.css:134`](../../web/src/styles.css#L134)

- Estilo da barra de resumo.
  [`styles.css:84`](../../web/src/styles.css#L84)
