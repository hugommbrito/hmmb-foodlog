---
title: 'Story 4.1 — Calendário Aprimorado na Vista Compartilhada'
type: 'feature'
created: '2026-07-01'
status: 'done'
baseline_commit: 'bdf905605107718d1c938b0a9e63732de55639ce'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O calendário da Vista Compartilhada tem células de 56px de altura e miniaturas de 16×16px — pequenas demais para o nutricionista identificar rapidamente dias com e sem fotos. Dias com entradas sem foto aparecem idênticos a dias sem nenhuma entrada.

**Approach:** Em viewport ≥ 760px, aumentar células para min-height 72px e thumbnails para 24×24px. Adicionar um ponto de 8px com `--accent` nos dias que têm entradas mas nenhuma foto — distinguindo visualmente dos dias realmente vazios.

## Boundaries & Constraints

**Always:**
- Manter o comportamento atual intacto em viewport < 760px (sem regressão mobile).
- O ponto só aparece quando há entradas e nenhuma delas tem foto. Dia com pelo menos uma foto → thumbnail, sem ponto.
- Nenhuma chamada extra de API — usar os dados já carregados via `fetchShared`.
- Sem autenticação Bearer — a Vista Compartilhada é pública via token na URL.
- Usar `var(--accent)` para a cor do ponto.

**Ask First:**
- Se surgir necessidade de ajustar o layout em algum breakpoint intermediário não documentado (ex.: 480–759px).

**Never:**
- Alterar backend ou criar novos endpoints.
- Adicionar interatividade (clique, tooltip) ao ponto ou às células do calendário.
- Modificar a vista Lista, Padrões ou qualquer outra parte da PublicShare além do CalendarView.
- Mudar os tamanhos de thumbnail em viewport < 760px.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dia com fotos | `dayEntries` com pelo menos 1 `photos[0]` | Thumbnail(s) 24×24px (≥760px), sem ponto | N/A |
| Dia sem foto mas com entradas | `dayEntries.length > 0`, todos com `photos: []` | Ponto 8px `--accent`, sem thumbnail | N/A |
| Dia sem entradas | `dayEntries.length === 0` | Célula vazia (sem ponto, sem thumbnail) | N/A |
| Dia fora do range | `day < start \|\| day > end` | Classe `out`, opacidade 0.4 — sem alteração | N/A |
| Viewport < 760px | Qualquer entrada | Comportamento original: min-height 56px, thumb 16×16px | N/A |

</frozen-after-approval>

## Code Map

- `web/src/Share.tsx` -- componente `CalendarView` (linhas 288–348): adicionar ponto de acento quando `thumbs.length === 0 && dayEntries.length > 0`
- `web/src/styles.css` -- regras `.cal-cell` (linha 441–444) e `.cal-thumbs img` (linha 449): adicionar media query `@media (min-width: 760px)` com novos tamanhos

## Tasks & Acceptance

**Execution:**
- [x] `web/src/styles.css` -- Adicionar `@media (min-width: 760px)` com `.cal-cell { min-height: 72px; }` e `.cal-thumbs img { width: 24px; height: 24px; }` — aumentar legibilidade em desktop sem quebrar mobile
- [x] `web/src/Share.tsx` -- Em `CalendarView`, quando `thumbs.length === 0 && dayEntries.length > 0 && inRange`, renderizar um `<div>` de 8×8px com `background: var(--accent)`, `border-radius: 50%`, abaixo do número do dia — indicar entrada sem foto

**Acceptance Criteria:**
- Given viewport ≥ 760px, when visualizo o calendário, then cada `.cal-cell` tem `min-height: 72px`
- Given viewport ≥ 760px e célula com fotos, when visualizo, then o thumbnail é 24×24px
- Given viewport < 760px, when visualizo o calendário, then `.cal-cell` mantém `min-height: 56px` e thumbnails 16×16px (sem regressão)
- Given dia com entradas e todas sem foto (`photos: []`), when visualizo a célula em qualquer viewport, then aparece ponto de 8px com `background: var(--accent)` e sem thumbnail
- Given dia com pelo menos uma foto, when visualizo a célula, then aparece thumbnail, sem o ponto de acento
- Given dia sem entradas (`dayEntries.length === 0`), when visualizo a célula, then ela permanece vazia sem ponto
- Given acesso via link compartilhado (`/shared/:token`), when carrego a Vista Compartilhada, then nenhuma chamada de API adicional é feita além de `fetchShared`

## Verification

**Commands:**
- `cd web && npm run build` -- expected: build sem erros de TypeScript

**Manual checks (if no CLI):**
- Abrir a Vista Compartilhada em viewport ≥ 760px: células têm altura visivelmente maior, thumbnails maiores
- Dias com entradas sem foto exibem ponto azul; dias com fotos exibem thumbnail; dias vazios permanecem em branco
- Redimensionar viewport < 760px: sem diferença visual em relação ao estado anterior

## Suggested Review Order

**Lógica de detecção — dia com entradas sem foto**

- Condição derivada: `inRange && dayEntries.length > 0 && thumbs.length === 0` garante exclusividade com o bloco de thumbs
  [`Share.tsx:329`](../../web/src/Share.tsx#L329)

- Renderização condicional do ponto com aria-label acessível
  [`Share.tsx:341`](../../web/src/Share.tsx#L341)

**Estilos — ponto e responsividade desktop**

- `.cal-dot` (8px, accent, border-radius 50%) + media query `≥760px` para min-height e thumbs
  [`styles.css:451`](../../web/src/styles.css#L451)
