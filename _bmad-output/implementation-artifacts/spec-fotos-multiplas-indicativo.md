---
title: 'Fotos Múltiplas — Indicativo em Células e Modal'
type: 'feature'
created: '2026-07-01'
status: 'done'
baseline_commit: 'cc445efb5168e1221ab9bee99af32af96aba9d76'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entradas com múltiplas fotos exibem apenas a primeira foto em todos os contextos de visualização (PhotoWall cell, Timeline thumb, PhotoWallModal), sem nenhum indicativo visual de que há mais fotos disponíveis.

**Approach:** Na PhotoWall cell, adicionar uma tira de thumbnails extras (fotos 2–3) na faixa inferior da célula, com badge "+N" para overflow. No Timeline thumb, sobrepor badge "+N" no canto inferior direito quando há fotos extras. No PhotoWallModal, substituir a foto única por uma tira horizontal rolável com todas as fotos.

## Boundaries & Constraints

**Always:**
- Preservar `overflow: hidden` e a animação de hover zoom (`.photowall-cell:hover img { transform: scale(1.08) }`) nas células da PhotoWall — a tira de extras não pode mudar esse comportamento.
- O badge "+N" da Timeline exibe `photos.length - 1` (total de fotos extras além da principal).
- A tira da PhotoWall cell exibe fotos `photos[1]` e `photos[2]` (máximo 2 thumbnails); fotos 4+ são contadas no badge de overflow da tira: N = `photos.length - 3`.
- Quando `photos.length <= 1`, nada é renderizado além do comportamento atual.
- O PhotoWallModal continua read-only; a troca de "foto principal" não é necessária — basta exibir todas em strip.

**Ask First:** nenhum.

**Never:**
- Tocar em `Share.tsx`, backend ou qualquer contrato de API.
- Alterar o `EntryCard` (aba Revisão) — já exibe todas as fotos corretamente.
- Implementar paginação ou lazy-load dentro das tiras.
- Adicionar qualquer ação de edição ao modal ou às células.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PhotoWall — 1 foto | `photos.length === 1` | Célula normal, sem strip | N/A |
| PhotoWall — 2 fotos | `photos.length === 2` | Foto 1 como main; strip inferior com foto 2 | N/A |
| PhotoWall — 3 fotos | `photos.length === 3` | Foto 1 como main; strip com fotos 2 e 3 | N/A |
| PhotoWall — 4+ fotos | `photos.length >= 4` | Foto 1 como main; strip com fotos 2+3 + badge "+N" (N = length−3) | N/A |
| PhotoWall — 0 fotos | `photos.length === 0` | Placeholder normal; sem strip | N/A |
| Timeline — 1 foto | `photos.length === 1` | Thumb normal; sem badge | N/A |
| Timeline — 2+ fotos | `photos.length >= 2` | Thumb com badge "+N" (N = length−1) no canto inferior direito do `.tl-thumb-wrap` | N/A |
| Timeline — 0 fotos | `photos.length === 0` | Placeholder normal; sem badge | N/A |
| Modal — 1 foto | `entry.photos.length === 1` | Strip com única foto (sem scroll visível) | N/A |
| Modal — 2+ fotos | `entry.photos.length >= 2` | Strip horizontal rolável com todas as fotos na largura total do modal | N/A |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:373-410` — `PhotoWallView`: célula da PhotoWall; adicionar tira de extras e badge de overflow
- `web/src/App.tsx:412-481` — `PhotoWallModal`: modal de detalhe; substituir foto única por strip rolável
- `web/src/App.tsx:519-551` — `TimelineView` — bloco do `tl-thumb-wrap`; adicionar badge "+N"
- `web/src/styles.css:618-680` — regras `.photowall-cell` e `.photowall-*`; adicionar `.photowall-extra-strip` e `.photowall-extra-badge`
- `web/src/styles.css:683-754` — regras `.pw-modal-*`; adaptar `.pw-modal-top` e adicionar `.pw-modal-strip`
- `web/src/styles.css:780-808` — regras `.tl-thumb-wrap`; adicionar `.tl-multi-badge`

## Tasks & Acceptance

**Execution:**
- [x] `web/src/styles.css` -- Adicionar regras CSS para `.photowall-extra-strip`, `.photowall-extra-badge`, `.pw-modal-strip`, `.pw-modal-strip img` e `.tl-multi-badge` -- sem CSS, as mudanças no JSX ficam sem estilo
- [x] `web/src/App.tsx` -- Em `PhotoWallView`, quando `e.photos.length > 1`, renderizar `<div className="photowall-extra-strip">` com `photos.slice(1, 3).map(url => <img>)` e, se `photos.length > 3`, adicionar `<span className="photowall-extra-badge">+{photos.length - 3}</span>` -- cobre CAP-1 para a PhotoWall cell
- [x] `web/src/App.tsx` -- Em `PhotoWallModal`, substituir o único `<img className="pw-modal-photo">` por `<div className="pw-modal-strip">{entry.photos.map(url => <img>)}</div>` -- cobre CAP-1 para o modal de detalhe
- [x] `web/src/App.tsx` -- Em `TimelineView`, dentro do bloco `e.photos.length > 0`, tornar o wrapper `tl-thumb-wrap` `position: relative` via classe e, quando `e.photos.length > 1`, adicionar `<span className="tl-multi-badge">+{e.photos.length - 1}</span>` dentro do wrapper -- cobre CAP-1 para o Timeline thumb

**Acceptance Criteria:**
- Given uma PhotoWall cell com `photos.length === 2`, when renderizada, then uma tira com o thumbnail da segunda foto aparece na faixa inferior da célula; a hover zoom na foto principal continua funcionando.
- Given uma PhotoWall cell com `photos.length === 5`, when renderizada, then a tira exibe fotos 2 e 3 e um badge "+2" (5−3=2).
- Given uma PhotoWall cell com `photos.length === 1`, when renderizada, then nenhuma tira ou badge aparece.
- Given um item da Timeline com `photos.length === 3`, when renderizado, then o thumb exibe a primeira foto e um badge "+2" no canto inferior direito.
- Given um item da Timeline com `photos.length === 1`, when renderizado, then nenhum badge aparece.
- Given o PhotoWallModal aberto para uma entry com `photos.length === 4`, when visualizado, then a tira horizontal mostra as 4 fotos e é rolável horizontalmente.
- Given o PhotoWallModal aberto para uma entry com `photos.length === 1`, when visualizado, then a tira exibe apenas a foto única (comportamento visual equivalente ao anterior).
- Esc e clique no backdrop do PhotoWallModal continuam fechando o modal.

## Design Notes

**Strip da PhotoWall cell:** Absolutamente posicionada na base da célula (dentro do `overflow: hidden` existente). Fundo semi-transparente escuro para contraste. Cada thumbnail ocupa 1 unidade de `flex: 1`, limitado a `height: 28px`. A célula mantém `aspect-ratio: 1/1` — a strip é overlay, não expande a célula.

**Badge "+N" do Timeline:** `position: absolute; bottom: 4px; right: 4px` dentro do `.tl-thumb-wrap` que já tem `position: relative` implícito via `overflow: hidden`. Fonte pequena (≤ 0.72rem), fundo escuro semi-transparente, `pointer-events: none`.

**Strip do Modal (`pw-modal-strip`):** `display: flex; overflow-x: auto; gap: var(--space-2); padding: var(--space-2)` dentro de `.pw-modal-top`. Cada `<img>` com `height: 260px; width: auto; flex-shrink: 0; object-fit: cover`. Remove `.pw-modal-photo` (classe de foto única) das imgs da strip.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros de TypeScript e build bem-sucedido

**Manual checks (if no CLI):**
- Abrir o Painel em modo PhotoWall com uma entry de 3+ fotos: verificar strip inferior visível na célula; clicar na célula e verificar strip rolável no modal com todas as fotos.
- Abrir o Painel em modo Timeline com uma entry de 2+ fotos: verificar badge "+N" no canto do thumb.
- Verificar que células de 1 foto não exibem strip ou badge.

## Spec Change Log

## Suggested Review Order

**PhotoWall cell — strip de extras**

- Cálculo de `extraPhotos` (slice 1–3) e `extraOverflow`; gate `length > 0` evita render desnecessário
  [`App.tsx:393`](../../web/src/App.tsx#L393)

- Strip absolutamente posicionada no bottom da célula; `pointer-events: none` preserva click da célula
  [`App.tsx:404`](../../web/src/App.tsx#L404)

- CSS da strip: `flex` distribui thumbnails igualmente; `width: 0` com `flex: 1` força equalização
  [`styles.css:685`](../../web/src/styles.css#L685)

- `z-index: 1` nas labels de hora e kcal garante visibilidade sobre a strip
  [`styles.css:667`](../../web/src/styles.css#L667)

**PhotoWallModal — strip rolável**

- Condicional `length > 1` → strip; `length === 1` → foto única original; `0` → placeholder
  [`App.tsx:475`](../../web/src/App.tsx#L475)

- CSS: `overflow-x: auto; flex-shrink: 0` permite scroll horizontal sem redimensionar o modal
  [`styles.css:775`](../../web/src/styles.css#L775)

**Timeline — badge "+N"**

- Badge sobreposto dentro do `.tl-thumb-wrap` existente (já tem `overflow: hidden`); `position: relative` adicionado ao wrapper
  [`App.tsx:550`](../../web/src/App.tsx#L550)

- CSS do badge: `position: absolute; bottom/right: 4px`; clipado naturalmente pelo `overflow: hidden` do wrapper
  [`styles.css:852`](../../web/src/styles.css#L852)
