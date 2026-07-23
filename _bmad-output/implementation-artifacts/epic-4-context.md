# Epic 4 Context: Vista Compartilhada para o Nutricionista

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Melhorar a legibilidade do calendário na Vista Compartilhada (`/shared/:token`) para o nutricionista. O calendário existente funciona, mas células pequenas (56px) e miniaturas minúsculas (16×16px) tornam difícil identificar rapidamente dias com e sem fotos. Após esta epic, dias com foto mostram thumbnail 24×24px, dias com entrada mas sem foto mostram um ponto colorido de 8px, e células têm altura mínima de 72px em desktop — tudo isso sem autenticação Bearer.

## Stories

- Story 4.1: Calendário Aprimorado na Vista Compartilhada

## Requirements & Constraints

- Nenhuma alteração de backend ou nova chamada de API — os dados já chegam via `fetchShared(token)`.
- Sem autenticação Bearer: a Vista Compartilhada é pública acessível pelo token na URL.
- Melhoria em viewport ≥ 760px; comportamento anterior mantido em viewport < 760px (sem regressão).
- Células de dias com pelo menos uma foto: thumbnail 24×24px (limite de 3 + overflow).
- Células de dias com entradas mas sem foto em nenhuma delas: ponto de 8px com cor `var(--accent)`, centralizado.
- Células de dias sem nenhuma entrada: permanecem vazias (sem ponto).
- Dias com foto não exibem o ponto — o ponto só aparece quando há entrada mas nenhuma foto.

## Technical Decisions

- Arquivos afetados: `web/src/Share.tsx` (componente `CalendarView`) e `web/src/styles.css`.
- A lógica de "tem entradas mas sem foto" já está disponível no render atual (`thumbs.length === 0 && dayEntries.length > 0`).
- O ponto de 8px deve ser implementado via elemento inline no JSX ou classe CSS auxiliar — não via `::before` (para manter acessibilidade explícita se necessário).
- Breakpoint para min-height e tamanho de thumb: `@media (min-width: 760px)` no CSS.
- Thumbnails: o CSS atual usa seletor `.cal-thumbs img { width: 16px; height: 16px; }` — trocar para 24×24px no breakpoint ≥ 760px.
- Células `cal-cell` com `min-height: 56px` → `min-height: 72px` apenas em ≥ 760px.

## UX & Interaction Patterns

- O calendário é read-only; não há clique/navegação por dia.
- O ponto de 8px deve usar `background: var(--accent)` e `border-radius: 50%`, centralizado na área disponível da célula (abaixo do número do dia).
- Nenhum tooltip ou label de texto adicional necessário no ponto — é um indicador visual simples.

## Cross-Story Dependencies

- O sistema de tokens CSS (Epic 1) já está implementado — `var(--accent)`, `var(--border)`, `var(--radius-sm)`, `var(--card)`, etc. estão disponíveis em styles.css.
- Nenhuma dependência de outras stories do Epic 4 (só há uma story).
