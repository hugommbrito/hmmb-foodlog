---
title: 'Vista Unificada — Modos Cruzados e Modal de Dia (CAP-2 + CAP-3)'
type: 'feature'
created: '2026-07-01'
status: 'done'
baseline_commit: 'b3d49b202673a9306ee27f3732962f29b5c7e818'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O Painel oferece apenas Parede de Fotos e Timeline; o Share oferece apenas Calendário, Lista e Padrões. Nenhum contexto tem os quatro modos, e o Calendário não é clicável — o nutricionista não consegue ver detalhes de um dia específico.

**Approach:** Extrair helpers de calendário para `calendarUtils.ts`; adaptar `PhotoWallView`/`TimelineView` para `SharedEntry[]` no Share (sem campos ausentes); criar `DashboardCalendarView` e `DashboardListView` no Painel reutilizando `slots`; criar `DayModal` exportado de `App.tsx` e ativado ao clicar em células de calendário com entradas em ambos os contextos.

## Boundaries & Constraints

**Always:**
- Troca de modo nunca dispara novo fetch — `slots` (Painel) e `filteredEntries` (Share) são reutilizados.
- `DashboardCalendarView` converte `DashboardSlot[]` → `Map<string, EntryWithFoods[]>` via `useMemo`.
- Adaptações de Share omitem badge de confiança, indicador de revisão e lookup de tags (campos ausentes em `SharedEntry`).
- `DayModal` somente leitura: sem ações de edição, aceite ou exclusão. Fecha em Esc e clique no backdrop.
- Células de calendário sem entries não disparam modal.
- `calendarUtils.ts` é a única cópia de `monthsBetween`/`monthCells`/`monthLabel`/`pad2` — remover duplicatas de `Share.tsx`.

**Ask First:** Nenhuma decisão durante execução requer aprovação humana.

**Never:**
- Nova chamada de API ao trocar modo ou abrir `DayModal`.
- Alterar `EntryCard` na aba Revisão.
- Adicionar "Padrões" ao Painel (já existe como tab "Relatório").
- Editar, aceitar ou excluir entries dentro do `DayModal`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Calendar no Painel, período com entries | `DashboardSlot[]` com `status: 'done'` | Grid de meses com thumbs por dia | Slots `loading`→skeleton; `error`→célula vazia |
| Clique em célula com entries | Dia com ≥ 1 entry, `inRange` | `DayModal` abre com fotos, título, hora e macros | — |
| Clique em célula vazia ou out-of-range | Dia sem entries ou fora do período | Nenhuma ação | — |
| PhotoWall no Share | `SharedEntry[]` sem `ai_confidence_overall` | Cells sem badge de confiança, read-only | — |
| Timeline no Share, entry com `context` | `SharedEntry` com `context: 'casa'` | Exibe `entry.context` direto, sem lookup `tagsById` | — |
| Esc / backdrop no DayModal | Modal aberto | Modal fecha | — |

</frozen-after-approval>

## Code Map

- `web/src/calendarUtils.ts` — novo: `monthsBetween`, `monthCells`, `monthLabel`, `pad2` (extraídos de Share.tsx)
- `web/src/Share.tsx` — View type estendida; seletor com 5 opções; `SharePhotoWallView`, `ShareTimelineView` novos; `CalendarView` com prop `onDayClick`; importa calendarUtils; usa `DayModal` de App.tsx
- `web/src/App.tsx` — `DashboardView` estendida para 4 modos; `DashboardCalendarView`, `DashboardListView` novos; `DayModal` criado e exportado; importa calendarUtils

## Tasks & Acceptance

**Execution:**
- [x] `web/src/calendarUtils.ts` — criar com `monthsBetween`, `monthCells`, `monthLabel`, `pad2`; sem dependências externas
- [x] `web/src/Share.tsx` — importar calendarUtils e remover funções duplicadas locais; estender `View` para incluir `'photowall' | 'timeline'`; adicionar botões "Parede de Fotos" e "Timeline" no `.seg`; criar `SharePhotoWallView({ entries: SharedEntry[] })` — grid de cells read-only, sem badge de confiança; criar `ShareTimelineView({ entries: SharedEntry[] })` — usa `entry.context` direto como texto de tag; em `CalendarView` converter `<div className="cal-cell">` com entries para `<button>` com `onClick={() => onDayClick?.(dayEntries)}`; importar e renderizar `DayModal` de `./App`
- [x] `web/src/App.tsx` — estender `DashboardView` para `'photowall' | 'timeline' | 'calendar' | 'list'`; adicionar botões "Calendário" e "Lista" no `.seg`; criar e exportar `DayModal({ entries, onClose })` — aceita `DayEntry[] = { id; created_at; photos; string[]; title; foods }[]`, backdrop + Esc fecham, exibe fotos+título+hora+macros por entry; criar `DashboardCalendarView({ slots, start, end })` — converte slots em Map via `useMemo`, usa calendarUtils, células com entries disparam `DayModal`; criar `DashboardListView({ slots })` — agrupa por dia (slots em ordem reversa), skeleton para `loading`, lista título+hora+macros para `done`

**Acceptance Criteria:**
- Dado o Painel no modo Calendário com entries no período, quando renderiza, então grid de meses é exibido com thumbs por dia, sem nova chamada de API.
- Dado o Share aberto no modo Parede de Fotos, quando exibe entries, então células não têm badge de confiança nem indicador de revisão.
- Dado o Painel ou Share no modo Calendário, quando o usuário clica em uma célula com ≥ 1 entry, então `DayModal` abre exibindo fotos, título, hora e macros das entries do dia.
- Dado o `DayModal` aberto, quando o usuário pressiona Esc ou clica no backdrop, então o modal fecha sem ação de edição.
- Dado troca de modo no Painel ou Share, então nenhum novo `fetch` é disparado (verificável via DevTools Network).
- Dado `calendarUtils.ts` criado, então `Share.tsx` não contém mais definições locais de `monthsBetween`/`monthCells`/`monthLabel`/`pad2`.

## Spec Change Log

## Design Notes

`DashboardCalendarView` deriva `start`/`end` dos próprios slots: `start = slots[0]?.date ?? todayLocal()`, `end = slots[slots.length-1]?.date ?? todayLocal()`. Slots com `status: 'loading'` contribuem com células skeleton; `status: 'error'` contribui com células vazias.

`DashboardListView` é análogo ao `ListView` do Share mas aceita `DashboardSlot[]`: itera slots em ordem reversa (mais recente primeiro), exibe um skeleton por slot em `loading`, agrupa entries do slot exibindo título, hora e macros — sem foto grande (não é PhotoWall).

`DayModal` usa o mesmo padrão de foco-trap e `keydown` do `PhotoWallModal` existente em `App.tsx`.

## Verification

**Commands:**
- `cd web && npm run build` — expected: zero erros TypeScript, build sem warnings

**Manual checks:**
- Painel → Calendário: grid mensal aparece, thumbs por dia, clique → DayModal
- Painel → Lista: entries agrupadas por dia, skeleton durante carregamento
- Share → Parede de Fotos: cells sem badge de confiança, read-only
- Share → Timeline: hora e `entry.context` exibidos, sem lookup de tags
- Share → Calendário → clique em dia com entries: DayModal somente leitura
- DayModal: Esc e backdrop fecham; célula vazia não abre modal
