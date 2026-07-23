---
title: 'Story 3.2 — Vista Parede de Fotos com Overlay Modal'
type: 'feature'
created: '2026-07-01'
status: 'done'
baseline_commit: 'b0e44ffb9abc5d6b095cc6b67f1975befca15afd'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `PhotoWallView` é um stub que renderiza apenas skeletons para slots em loading e `null` para slots resolvidos — nenhuma foto ou conteúdo real é exibido no Painel.

**Approach:** Substituir o `null` por células reais de entry (foto + overlay de hora/kcal), ordenadas da mais recente para a mais antiga, e adicionar `PhotoWallModal` para detalhe com foto ampliada e lista de alimentos.

## Boundaries & Constraints

**Always:**
- Ordenação: iterar slots em ordem reversa (índice `slots.length-1` → `0`); dentro de cada slot done, ordenar entries por `created_at` desc
- Slot `loading` → um `.skeleton-cell` (comportamento de 3.1 preservado, sem alteração)
- Slot `error` → nenhuma célula renderizada
- Células com foto: `<img loading="lazy">`, `object-fit: cover`, `aspect-ratio: 1/1`
- Células sem foto (`entry.photos.length === 0`): placeholder com `background: var(--border)`, `role="img"`, `aria-label="Sem foto"`, ícone centralizado em `var(--muted)`
- Overlay: `rgba(0,0,0,.45)` sobre a célula; hora no canto superior direito, kcal no canto inferior esquerdo, texto branco `font-size: 0.8rem`; hora = `toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })`; kcal = `sumMacros(e.foods, 'kcal')` arredondado + `' kcal'`, ou `'–'` se null
- Modal: backdrop `rgba(0,0,0,.75)` full-screen; sheet `max-width: 480px`, `border-radius: var(--radius-card)`, `background: var(--card)`; `role="dialog"`, `aria-modal="true"`; foto no topo em largura total; lista de alimentos scrollável abaixo
- Modal fecha em: clique no backdrop, tecla Escape, botão fechar (`aria-label="Fechar"`)
- Focus trap: ao abrir modal, focar botão fechar; capturar Tab/Shift+Tab dentro do sheet
- Nenhuma chamada de API nova dentro de `PhotoWallView` ou `PhotoWallModal`
- `Dashboard` e `DashboardSlot` não são alterados

**Ask First:** nenhuma decisão depende de aprovação humana

**Never:**
- Remover ou alterar o skeleton de slots `loading` definido em 3.1
- `await Promise.all` ou fetch novo dentro de PhotoWallView
- Modificar `DashboardSlot`, `Dashboard` ou `TimelineView`
- Usar biblioteca externa para modal ou animações

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slot loading | `status: 'loading'` | Um `.skeleton-cell` com animação shimmer | — |
| Slot done, 3 entries com fotos | `done`, entries sorted by created_at desc | 3 células com `<img>`, overlay hora+kcal, mais recente primeiro | — |
| Entry sem foto | `entry.photos: []` | Célula com placeholder `var(--border)`, `role="img"`, `aria-label="Sem foto"`, mesmo overlay | — |
| Kcal null | `sumMacros → null` | Overlay exibe `'–'` em vez de kcal | — |
| Slot error | `status: 'error'` | Nenhuma célula renderizada para esse slot | — |
| Clicar numa célula | entry selecionada | Modal abre: backdrop + sheet + foto + lista de alimentos + botão fechar | — |
| Escape com modal aberto | keydown `Escape` | Modal fecha | — |
| Clique no backdrop | click fora do sheet | Modal fecha | — |
| Tab no último elemento focável do modal | Tab keydown | Foco cicla de volta ao botão fechar | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:366-376` — `PhotoWallView` stub a substituir
- `web/src/App.tsx:83` — `sumMacros(foods, 'kcal')` — usar para kcal do overlay
- `web/src/App.tsx:996-999` — padrão `toLocaleTimeString('pt-BR', ...)` — replicar inline
- `web/src/App.tsx:136` — `textOn(hex)` — disponível se necessário na lista de alimentos
- `web/src/types.ts:23-35` — `EntryWithFoods` — campos `photos`, `created_at`, `foods`, `title`
- `web/src/styles.css:580` — `.photowall-grid` já definida (2/3/4 cols por breakpoint) — não alterar
- `web/src/styles.css:566` — `.skeleton-cell` já definida — não alterar

## Tasks & Acceptance

**Execution:**

- [x] `web/src/App.tsx` — Substituir `PhotoWallView` (linhas 366-376): adicionar `const [modalEntry, setModalEntry] = useState<EntryWithFoods | null>(null)`. No JSX de `.photowall-grid`, iterar `[...slots].reverse()` — para `loading`: emitir `.skeleton-cell` (igual ao atual); para `done`: `slot.entries.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(e => <button key={e.id} className="photowall-cell" onClick={() => setModalEntry(e)}>` com: (a) se `e.photos.length > 0` → `<img src={e.photos[0]} loading="lazy" alt={e.title ?? 'Foto da refeição'} />`, senão → `<div className="photowall-cell-ph" role="img" aria-label="Sem foto"><span className="photowall-ph-icon" aria-hidden="true">🍽</span></div>`; (b) `<div className="photowall-scrim" aria-hidden="true" />`; (c) `<span className="photowall-time">{time}</span>` e `<span className="photowall-kcal">{kcalLabel}</span>` onde `time = new Date(e.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })` e `kcalLabel = (() => { const k = sumMacros(e.foods, 'kcal'); return k != null ? ${Math.round(k)} kcal : '–'; })()`. Após o grid, renderizar `{modalEntry && <PhotoWallModal entry={modalEntry} onClose={() => setModalEntry(null)} />}`. Ajustar import de `useState` se necessário.

- [x] `web/src/App.tsx` — Adicionar função `PhotoWallModal({ entry, onClose }: { entry: EntryWithFoods; onClose: () => void })` logo após `PhotoWallView`: `useRef<HTMLDivElement>(null)` para o sheet; `useEffect` que foca o primeiro botão focável do sheet ao montar e adiciona listener `keydown` para Escape (`onClose()`) e Tab/Shift+Tab (ciclar foco entre elementos focáveis do sheet); renderizar `<div className="pw-modal-backdrop" onClick={onClose}><div ref={sheetRef} className="pw-modal-sheet" role="dialog" aria-modal="true" aria-label={entry.title ?? 'Detalhe da refeição'} onClick={e => e.stopPropagation()}>`: (a) header com `<button className="pw-modal-close" aria-label="Fechar" onClick={onClose}>✕</button>`; (b) se `entry.photos.length > 0` → `<img className="pw-modal-photo" src={entry.photos[0]} alt={entry.title ?? 'Foto da refeição'} />` senão → `<div className="pw-modal-photo pw-modal-ph" role="img" aria-label="Sem foto" />`; (c) `<ul className="pw-modal-foods">` com cada food: `<li key={f.id}><span>{f.description}{f.quantity ? ` (${f.quantity})` : ''}</span><span>{f.kcal != null ? ${Math.round(f.kcal)} kcal : '–'}</span></li>`.

- [x] `web/src/styles.css` — Adicionar ao fim do arquivo, após `.timeline-list`:
  `.photowall-cell` (position: relative; aspect-ratio: 1/1; overflow: hidden; cursor: pointer; border: 0; padding: 0; background: var(--border); border-radius: var(--radius-card); display: block; width: 100%),
  `.photowall-cell img` (width: 100%; height: 100%; object-fit: cover; display: block),
  `.photowall-cell-ph` (width: 100%; height: 100%; display: flex; align-items: center; justify-content: center),
  `.photowall-ph-icon` (font-size: 1.5rem; opacity: 0.5),
  `.photowall-scrim` (position: absolute; inset: 0; background: rgba(0,0,0,.45); pointer-events: none),
  `.photowall-time` (position: absolute; top: var(--space-1); right: var(--space-1); color: #fff; font-size: 0.8rem; pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,.6)),
  `.photowall-kcal` (position: absolute; bottom: var(--space-1); left: var(--space-1); color: #fff; font-size: 0.8rem; pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,.6)),
  `.pw-modal-backdrop` (position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 200; display: flex; align-items: center; justify-content: center; padding: var(--space-4)),
  `.pw-modal-sheet` (background: var(--card); border-radius: var(--radius-card); box-shadow: var(--shadow-card); max-width: 480px; width: 100%; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column),
  `.pw-modal-header` (display: flex; justify-content: flex-end; padding: var(--space-2); flex-shrink: 0),
  `.pw-modal-close` (background: none; border: 0; cursor: pointer; font-size: 1.25rem; color: var(--muted); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm)),
  `.pw-modal-photo` (width: 100%; object-fit: cover; max-height: 300px; display: block; flex-shrink: 0),
  `.pw-modal-ph` (height: 200px; background: var(--border)),
  `.pw-modal-foods` (list-style: none; padding: var(--space-4); margin: 0; display: flex; flex-direction: column; gap: var(--space-2); overflow-y: auto),
  `.pw-modal-foods li` (display: flex; justify-content: space-between; gap: var(--space-2); font-size: 0.95rem)

**Acceptance Criteria:**

- Dado Painel com period=7d e todos slots resolvidos, quando visualizo a Parede de Fotos, então as células aparecem da mais recente (topo-esquerda) para a mais antiga
- Dado uma entry com foto, quando visualizo a célula, então há `<img loading="lazy">` com `object-fit: cover` e overlay com hora (canto superior direito) e kcal (canto inferior esquerdo) em texto branco
- Dado uma entry sem foto, quando visualizo a célula, então há placeholder com `role="img"` e `aria-label="Sem foto"` com mesmo overlay de hora/kcal
- Dado entry com foods todos sem kcal, quando visualizo overlay, então kcal exibe `'–'`
- Dado clicar em qualquer célula, quando o modal abre, então há backdrop `rgba(0,0,0,.75)`, sheet `max-width: 480px`, foto no topo, lista de alimentos scrollável, botão fechar com `aria-label="Fechar"`
- Dado modal aberto, quando pressiono Escape, então o modal fecha
- Dado modal aberto, quando clico no backdrop fora do sheet, então o modal fecha
- Dado modal aberto com foco no keyboard, então Tab/Shift+Tab cicla apenas dentro do sheet (foco não escapa para o fundo)
- Dado um slot em loading, quando visualizo, então um `.skeleton-cell` com animação shimmer está presente (comportamento de 3.1 intacto)
- Dado um slot com status error, quando visualizo, então nenhuma célula é renderizada para aquele slot

## Design Notes

`PhotoWallView` itera `[...slots].reverse()` para preservar a ordenação mais-recente-primeiro sem mutar o array original. Slots `loading` emitem um skeleton; slots `done` emitem N células (uma por entry). O `Dashboard` já controla o estado "Sem registros neste período." quando todos os slots estão done com entries vazias — `PhotoWallView` não precisa tratar esse estado.

O focus trap em `PhotoWallModal` usa `useEffect` para focar o botão `.pw-modal-close` na montagem e capturar Tab. Para simplicidade, usa `querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')` no sheet ref para obter os focusáveis, cicla com index wrap nos extremos.

O emoji `🍽` no placeholder é `aria-hidden="true"` — o `role="img"` + `aria-label="Sem foto"` no wrapper já comunica o estado para leitores de tela.

## Spec Change Log

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

## Suggested Review Order

**Grade de células — renderização e ordenação**

- Stub substituído: slots reversed + done entries sorted desc, um cell por entry
  [`App.tsx:366`](../../web/src/App.tsx#L366)

- Célula com foto: `loading="lazy"`, overlay scrim, hora (top-right), kcal (bottom-left)
  [`App.tsx:386`](../../web/src/App.tsx#L386)

- Célula sem foto: placeholder CSS `::after` com `var(--muted)`, sem emoji
  [`App.tsx:389`](../../web/src/App.tsx#L389)

**Modal — foco, teclado e estrutura**

- `onCloseRef` pattern: dep `[]` evita re-run e roubo de foco a cada render do pai
  [`App.tsx:405`](../../web/src/App.tsx#L405)

- Focus trap: captura Tab/Shift+Tab nos extremos da lista focável do sheet
  [`App.tsx:417`](../../web/src/App.tsx#L417)

- "Foto no topo": photo dentro de `.pw-modal-top`, close button absoluto sobre a foto
  [`App.tsx:444`](../../web/src/App.tsx#L444)

**CSS — células e modal**

- `.photowall-cell` + `.photowall-cell-ph::after`: placeholder com `var(--border)` bg e `var(--muted)` icon
  [`styles.css:620`](../../web/src/styles.css#L620)

- `.pw-modal-sheet` overflow hidden + `.pw-modal-top` relative + `.pw-modal-close` absoluto
  [`styles.css:669`](../../web/src/styles.css#L669)

- `.pw-modal-foods` com `flex: 1` + `overflow-y: auto` (scroll independente da foto)
  [`styles.css:711`](../../web/src/styles.css#L711)
