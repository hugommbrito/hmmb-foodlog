---
title: 'Story 3.1 — Estrutura do Painel e Seletor de Período'
type: 'feature'
created: '2026-06-30'
status: 'done'
baseline_commit: 'f88049786c57d15bf1a2d9d87ff8c0cf083a3002'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O componente `<Dashboard>` é um stub vazio (`<h1>Painel</h1>`). O Painel precisa de uma estrutura funcional com seletor de período, toggle de vista, e orquestração de dados paralela antes que as vistas de conteúdo (Parede de Fotos, Timeline) possam ser construídas.

**Approach:** Substituir o stub por um componente completo com seletor de período (7d/14d/30d/personalizado), toggle de vista (Parede de Fotos/Timeline), e N requests paralelos e independentes a `GET /entries?date=` com skeleton por slot. Stories 3.2 e 3.3 consumirão os `slots` para renderizar o conteúdo real.

## Boundaries & Constraints

**Always:**
- Período padrão ao montar: `7d`
- Período persiste ao alternar entre vistas (Parede ↔ Timeline) — o toggle de vista não reseta o período
- Período personalizado: máximo 90 dias; datas futuras não selecionáveis; `end >= start` obrigatório
- N requests paralelos e independentes: para cada dia, `fetchEntries(date).then(...)` com atualização imutável por slot (`prev => { const next = [...prev]; next[idx] = ...; return next; }`)
- Cancellation flag (`let cancelled = false`) no `useEffect` para evitar race condition ao trocar período
- `UnauthorizedError` em qualquer slot → chama `onLogout()`
- Skeleton individual por slot até a resposta chegar (resolve de forma isolada, não espera outros slots)
- `getDashboardDays('7d')` inclui hoje: array `[today-6, today-5, ..., today]` (7 elementos)

**Ask First:**
- Se 7d deve incluir hoje ou excluir hoje (spec assume inclusivo — today é o último elemento)

**Never:**
- Criar endpoint novo no backend
- `await Promise.all(...)` que bloquearia todos os slots — usar `.then()` individual
- Resetar `view` ao trocar período
- Permitir intervalo > 90 dias ou start > end no modo personalizado (retornar array vazio sem disparar fetches)
- Chamar `/report/weekly`, `/shared/:token/patterns` ou qualquer endpoint de IA

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Painel abre (montagem inicial) | period: '7d', view: 'photowall' | 7 slots em skeleton; 7 requests disparados em paralelo | — |
| Troca period para 30d | period: '30d' | 30 slots reiniciados para loading; 30 novos requests; fetches anteriores descartados via flag | — |
| Selecionar Personalizado | period: 'custom' | Dois date pickers visíveis; fetches disparados ao confirmar datas válidas | — |
| Período custom start > end | start='2026-06-15', end='2026-06-10' | Array vazio; nenhum fetch; conteúdo vazio sem skeleton | — |
| Período custom > 90 dias | end - start > 90 dias | Clamp: `end = start + 90d`; dispara fetches para os 90 dias | — |
| Toggle Parede ↔ Timeline | view muda | Period, customStart, customEnd inalterados; slots não reiniciados | — |
| Slot carregado sem entradas | entries: [] para aquele dia | Slot status: 'done', entries: [] | — |
| Todos slots done, sem entradas | todos status: 'done', entries.length === 0 | "Sem registros neste período." exibido | — |
| Fetch de slot falha | fetch rejeita (não é UnauthorizedError) | Slot status: 'error'; demais slots não afetados | Erro silencioso |
| Fetch de slot com UnauthorizedError | 401 | Chama `onLogout()` imediatamente | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:226–231` — `Dashboard` stub a substituir integralmente
- `web/src/App.tsx:38–45` — `todayLocal()` — referência para cálculo de datas locais sem UTC offset
- `web/src/api.ts:63–66` — `fetchEntries(date)` — reutilizar; retorna `Promise<EntryWithFoods[]>`
- `web/src/api.ts:22` — `UnauthorizedError` — importada, verificar no catch de cada slot
- `web/src/types.ts:23–35` — `EntryWithFoods` — tipo dos slots
- `web/src/styles.css:315–317` — `.seg` / `.seg-btn` / `.seg-btn.active` — reutilizar para toggle de vista
- `web/src/styles.css:346–354` — `.chip` / `.chip.active` — reutilizar para seletor de período

## Tasks & Acceptance

**Execution:**
- [x] `web/src/App.tsx` — Adicionar acima da função `Dashboard` (linha ~226): type `DashboardSlot = { date: string; status: 'loading' | 'done' | 'error'; entries: EntryWithFoods[] }`, `DashboardPeriod`, `DashboardView`; helper `getDashboardDays(period, start, end): string[]` (para '7d'/'14d'/'30d': N dias terminando em `todayLocal()` inclusive; para 'custom': enumerar `start` até `end`, max 90; se `end < start`, retornar `[]`); helper `addDaysToDate(dateStr: string, days: number): string` que soma N dias a uma data YYYY-MM-DD usando a aritmética de offset `T12:00:00`.
- [x] `web/src/App.tsx` — Substituir a função `Dashboard` (226–231) por implementação completa: estados `period` (default `'7d'`), `customStart` (default `todayLocal()`), `customEnd` (default `todayLocal()`), `view` (default `'photowall'`), `slots`. `useEffect` dependente de `[period, customStart, customEnd, onLogout]` com: (a) cancellation flag; (b) `loggedOut = { current: false }` ref para evitar múltiplos `onLogout()` em 401s concorrentes; (c) `setSlots(days.map(d => (...loading...)))`; (d) por slot: `fetchEntries(d).then(entries => { if (cancelled) return; setSlots(prev => prev.map(s => s.date === d ? { ...s, status: 'done', entries } : s)); }).catch(err => { if (cancelled) return; if (err instanceof UnauthorizedError && !loggedOut.current) { loggedOut.current = true; onLogout(); return; } setSlots(prev => prev.map(s => s.date === d ? { ...s, status: 'error', entries: [] } : s)); })`. (**KEEP**: usar `prev.map(s => s.date === d ? ... : s)` — date-based update, não índice).
- [x] `web/src/App.tsx` — Renderizar no JSX de `Dashboard`: (1) `.period-chips` com 4 `.chip`; (2) `.dashboard-custom-dates` condicional com dois `<input type="date">` — no "Até": `onChange` clamp `addDaysToDate(customStart, 89)` antes de `setCustomEnd`; (3) `.seg` com 2 `.seg-btn`; (4) `isEmpty` (todos slots não-loading com `entries.length === 0`) → `<p className="dashboard-empty">Sem registros neste período.</p>`; (5) quando `slots.length > 0 && !isEmpty` → `{view === 'photowall' ? <PhotoWallView slots={slots} /> : <TimelineView slots={slots} />}`. **Sem bloco de skeleton no nível do Dashboard** — skeleton é responsabilidade de `PhotoWallView`/`TimelineView`.
- [x] `web/src/App.tsx` — Adicionar `PhotoWallView({ slots })` e `TimelineView({ slots })` abaixo de `Dashboard`. Não são stubs `null`: ambas renderizam a estrutura de grade/lista e exibem `.skeleton-cell`/`.skeleton-item` para slots com `status === 'loading'`; retornam `null` para slots done/error (conteúdo real vem em 3.2/3.3). `PhotoWallView` renderiza `.photowall-grid` com um `<div className="skeleton-cell">` por slot loading. `TimelineView` renderiza `.timeline-list` com um `<li className="skeleton-item">` por slot loading.
- [x] `web/src/styles.css` — Adicionar ao fim do arquivo: `.dashboard`, `.period-chips`, `.dashboard-custom-dates` (com label e input[type=date]), `.dashboard-empty`, `@keyframes sk-shimmer`, `.skeleton-cell`, `.skeleton-item`, `.photowall-grid` (2/3/4 colunas por breakpoint), `.timeline-list`.

**Acceptance Criteria:**
- Dado o Painel abre, quando visualizo o seletor, então há 4 opções (7d, 14d, 30d, Personalizado) com 7d ativo por padrão
- Dado period=7d, quando as chamadas chegam, então cada slot de skeleton substitui para o estado resolvido de forma independente (não aguarda todos)
- Dado period='custom' selecionado, quando visualizo, então dois date pickers são exibidos; max=hoje em ambos
- Dado end - start > 90 dias no custom, quando confirmo, então range é clamped a 90 dias
- Dado alternar de Parede para Timeline, quando visualizo o seletor de período, então o período selecionado permanece inalterado
- Dado todos os slots loaded com entries.length===0, quando visualizo, então "Sem registros neste período." é exibido
- Dado qualquer slot em loading, quando inspeciono, então um elemento com animação skeleton está presente
- Dado inspecionar network calls, quando navego para o Painel, então nenhuma chamada a `/report/weekly` ou `/shared/:token/patterns` é feita

## Design Notes

`PhotoWallView` e `TimelineView` NÃO são stubs `null` — elas renderizam a estrutura grid/list com skeletons per-slot para loading. Para slots `done`/`error`, retornam `null` por célula (conteúdo real em 3.2/3.3). Isso permite que o skeleton de cada slot desapareça de forma independente à medida que os fetches resolvem (AC 2).

O Dashboard não possui bloco de skeleton próprio. A grade/lista sempre renderiza quando `slots.length > 0 && !isEmpty`, e as views cuidam do estado interno de cada célula.

`addDaysToDate` usa o mesmo padrão de offset `T12:00:00` do restante do codebase para DST safety. O clamp de 90 dias no "Até" date picker atualiza o `customEnd` state imediatamente no onChange, então o picker exibe o valor clamped.

## Spec Change Log

**Loop 1 — bad_spec (2026-06-30)**

*AC 2 / AC 7 violation:* Task 3/4 originais colocavam bloco de skeleton no Dashboard (`isLoading && <grid>`), mantendo todos os skeletons até o último slot resolver. Viola "cada slot resolve independentemente".
- **Amendado:** Tasks 3/4 reescritas. Skeleton movido para `PhotoWallView`/`TimelineView`. Dashboard sem bloco próprio de skeleton.
- **Known-bad:** skeleton block some de uma vez quando último fetch resolve.
- **KEEP:** `getDashboardDays`; cancellation flag; date-based slot update `prev.map(s => s.date === d ? ... : s)` (não por índice).

*AC 4 violation:* Tasks não especificavam clampar `customEnd` state. Picker mostrava data original enquanto apenas 90 dias eram carregados.
- **Amendado:** Task 3 adiciona clamp no onChange do "Até" via `addDaysToDate(customStart, 89)`. Task 1 adiciona helper `addDaysToDate`.
- **Known-bad:** picker com data não correspondente aos dados carregados.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

## Suggested Review Order

**Orquestração de dados — coração do componente**

- Cancellation flag + `loggedOut` ref: N fetches paralelos independentes sem race condition ou double-logout
  [`App.tsx:274`](../../web/src/App.tsx#L274)

- `getDashboardDays` — aritmética de datas DST-safe, clamp de 90 dias, filtro de datas futuras
  [`App.tsx:239`](../../web/src/App.tsx#L239)

- `addDaysToDate` — helper de soma de dias, mesmo padrão `T12:00:00` do codebase
  [`App.tsx:230`](../../web/src/App.tsx#L230)

**Skeleton por slot — resolução visual independente**

- `PhotoWallView` — grade com skeleton per-slot: loading → `.skeleton-cell`, done → null
  [`App.tsx:366`](../../web/src/App.tsx#L366)

- `TimelineView` — lista com skeleton per-slot: loading → `.skeleton-item`, done → null
  [`App.tsx:378`](../../web/src/App.tsx#L378)

**Seletor de período e clamp de 90 dias**

- `handleEndChange` — clamp de `customEnd` ao `customStart + 89d` no onChange
  [`App.tsx:302`](../../web/src/App.tsx#L302)

- JSX do seletor: period chips, date pickers condicionais, view toggle, isEmpty state
  [`App.tsx:307`](../../web/src/App.tsx#L307)

**CSS**

- `.skeleton-cell` / `.skeleton-item` e animação `sk-shimmer`
  [`styles.css:561`](../../web/src/styles.css#L561)

- `.photowall-grid` com 3 breakpoints responsivos (2/3/4 colunas)
  [`styles.css:580`](../../web/src/styles.css#L580)
