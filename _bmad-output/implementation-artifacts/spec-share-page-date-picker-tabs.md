---
title: 'Componentizar Views de Refeição e Reorganizar Share com Date Picker + 2 Tabs'
type: 'refactor'
created: '2026-07-02'
status: 'draft'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** As views visuais de refeições (Parede de Fotos, Timeline, Calendário, Lista) estão duplicadas entre `App.tsx` (Dashboard) e `Share.tsx` — melhorias em uma não propagam automaticamente para a outra. Além disso, a página Share exibe o período completo do link sem permitir focar em um único dia, e tem 5 sub-views em nível flat sem hierarquia.

**Approach:** Extrair as views para `views.tsx` compartilhado, usando um `ViewEntry` interface local que tanto `EntryWithFoods` quanto `SharedEntry` satisfazem estruturalmente (TypeScript duck typing). Dashboard em `App.tsx` adapta seus dados antes de passá-las; `Share.tsx` as usa diretamente. Ao mesmo tempo, reorganizar Share com date picker (filtra por dia dentro do período do link) e 2 tabs top-level: **Painel** (agrupa as 4 views) e **Relatório** (análise de padrões).

## Boundaries & Constraints

**Always:**
- `ViewEntry` interface fica em `web/src/views.tsx` (não em `types.ts`) e contém apenas os campos comuns: `id`, `created_at`, `photos`, `title`, `foods`, `context`, `context_tag_id` — ambos os tipos existentes a satisfazem estruturalmente sem cast
- Loading skeletons ficam exclusivamente no wrapper `Dashboard` em `App.tsx`; os componentes compartilhados recebem só entries já carregadas
- `tags?: ContextTag[]` é prop opcional em `TimelineView` — Share.tsx omite (payload público não tem cores de tag)
- `CalendarView` assinatura atualizada: `onDayClick?: (date: string, dayEntries: ViewEntry[]) => void` — `date` (YYYY-MM-DD) passado explicitamente pelo componente ao chamar o callback
- `selectedDate` em Share inicializa `''`, é setado para `data.period_end` ao carregar dados
- Lazy fetch de patterns em Share dispara quando `topTab === 'relatorio'`; ref `patternsRequested` e lógica de retry idênticos
- `DayModal`, `FoodRow`, `mealTotals` permanecem em `App.tsx` (já exportados e importados por Share.tsx — não mover)

**Ask First:**
- Se o Calendar no Painel do Share deve mostrar dados do período completo ou só do dia selecionado (default proposto: período completo para navegação)
- Qualquer mudança no backend ou nos tipos do payload do share link

**Never:**
- Não adicionar interatividade (accept/delete/reanalyze) nas views compartilhadas
- Não alterar `SharedEntry`, `EntryWithFoods` nem outros tipos da API em `types.ts`
- Não remover o `DayModal` de `App.tsx` mesmo que não seja mais usado no Calendar do Share

## I/O & Edge-Case Matrix

| Scenario | Input / Estado | Comportamento | Erro |
|----------|---------------|---------------|------|
| Dashboard App — loading parcial | slots com mix de `loading`/`done` | Skeletons no wrapper; view compartilhada recebe só entries `done` | — |
| Share Painel — Parede/Timeline/Lista | `selectedDate` com entries | Views mostram apenas entries do dia selecionado | — |
| Share Painel — dia sem entries | `selectedDate` sem dados | "Sem registros em DD/MM/AAAA." abaixo dos controles | — |
| Share Painel — Calendário click | click em dia com entries | `selectedDate` = data clicada, `subView` muda para `'list'` | Só dispara se `dayEntries.length > 0` |
| Share Relatório | `topTab = 'relatorio'` | PatternsView carrega lazily; date picker e sub-views ocultos | — |
| Tags em Timeline — Share | prop `tags` ausente | Timeline renderiza sem cores de tag; sem erro | — |
| Food filter + selectedDate | texto + data selecionada | Filtro aplica sobre entries do dia selecionado | — |

</frozen-after-approval>

## Code Map

- `web/src/views.tsx` -- novo arquivo com `ViewEntry` interface + `PhotoWallView`, `TimelineView`, `CalendarView`, `ListView` compartilhados
- `web/src/App.tsx:229-388` -- `Dashboard` e sub-componentes atuais — mantém skeletons, adapta dados antes de passar às views
- `web/src/Share.tsx:29-219` -- `PublicShare` e sub-componentes — remove views duplicadas, importa de `views.tsx`, reestrutura nav

## Tasks & Acceptance

**Execution:**
- [ ] `web/src/views.tsx` -- Criar arquivo; definir `ViewEntry` interface; migrar `SharePhotoWallView` → `PhotoWallView(entries: ViewEntry[])`, `ShareTimelineView` → `TimelineView(entries: ViewEntry[], tags?: ContextTag[])`, `CalendarView(entries: ViewEntry[], start: string, end: string, selectedDate?: string, onDayClick?: (date: string, day: ViewEntry[]) => void)`, `ListView(entries: ViewEntry[])` — base compartilhada das views visuais
- [ ] `web/src/App.tsx` -- Dashboard: adicionar helper `slotsToEntries(slots: DashboardSlot[]): ViewEntry[]` que filtra slots `done` e achata entries; importar views de `views.tsx`; manter renderização de skeletons para slots `loading` no wrapper antes de invocar as views; passar `tags` ao `TimelineView` -- Dashboard reutiliza views compartilhadas sem regressão
- [ ] `web/src/Share.tsx` -- Remover `SharePhotoWallView`, `ShareTimelineView`, `CalendarView` (local), `ListView`; importar de `views.tsx`; adicionar tipos `TopTab = 'painel' | 'relatorio'` e `SubView = 'photowall' | 'timeline' | 'calendar' | 'list'`; adicionar estados `topTab` (default `'painel'`), `subView` (default `'photowall'`), `selectedDate` (default `''`, setado para `period_end` no efeito de fetch); computar `dateFilteredEntries`; atualizar efeito de patterns para usar `topTab`; reestruturar render: 2 tabs top-level, Painel com date picker + sub-view selector + food filter + conteúdo date-filtered (Calendar recebe `filteredEntries` período completo), Relatório com `PatternsView` -- Share usa views compartilhadas + nova navegação

**Acceptance Criteria:**
- Dado Dashboard no App, quando slots carregam progressivamente, então skeletons aparecem para slots ainda em loading e entries reais renderizam via views compartilhadas (comportamento visual igual ao anterior)
- Dado Dashboard no App, quando Timeline está ativa com tags configuradas, então cores de tag são exibidas nas bordas dos cards (prop `tags` passada)
- Dado Share aberto, quando carrega, então 2 tabs top-level "Painel" e "Relatório" visíveis; Painel ativo com date picker mostrando `period_end`
- Dado Share Painel com Parede/Timeline/Lista, quando data é alterada, então apenas entries do dia aparecem
- Dado Share Painel com Calendário, quando usuário clica em dia com entries, então `selectedDate` atualiza e sub-view muda para Lista
- Dado Share Painel e dia sem entries, quando selectedDate não tem dados, então mensagem com data formatada em BR aparece
- Dado Share Relatório, quando clicado, então lazy fetch de patterns inicia (igual ao comportamento atual de `view === 'patterns'`)

## Spec Change Log

## Design Notes

`slotsToEntries` em App.tsx deve só incluir entries de slots `done` — slots em `loading` ou `error` são ignorados. Os skeletons continuam renderizados pelo wrapper Dashboard acima da view, garantindo o efeito de carregamento progressivo sem precisar que as views conheçam slots.

Para o Calendário no Share Painel: recebe `filteredEntries` (período completo, food-filtered) para servir como navegador visual — o usuário vê quais dias têm registros e clica para navegar. As outras 3 views recebem `dateFilteredEntries` (filtrado ao dia escolhido).

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript, build bem-sucedido

**Manual checks:**
- Dashboard no App: Parede de Fotos, Timeline (com cores de tag), Calendário e Lista sem regressão visual
- Share: 2 tabs top-level; date picker funcional (min/max corretos); sub-views Parede/Timeline/Lista filtram por data; Calendário navega por período e clique muda para Lista; Relatório carrega análise de padrões
