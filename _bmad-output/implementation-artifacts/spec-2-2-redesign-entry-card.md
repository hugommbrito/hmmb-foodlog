---
title: 'Story 2.2 — Redesign do Entry Card'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: '94f418575151f9b049c77260237516c20c827688'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Os entry cards exibem foto pequena (160px), mostram confiança como badge numérico visível, ficam com 65% de opacidade quando revisados (degradando a leitura), e o placeholder de foto tem `aria-hidden="true"` — sendo invisível para leitores de tela.

**Approach:** Aumentar coluna de foto para 200px no desktop; substituir badge por borda esquerda colorida de 4px com `aria-label` acessível; remover opacidade do estado revisado e adicionar ícone ✓ sobre a foto; corrigir semântica do placeholder para `role="img"` + `aria-label="Sem foto"`; adicionar `box-shadow: var(--shadow-card)` ao card.

## Boundaries & Constraints

**Always:**
- Foto desktop: `.photos { flex: 0 0 200px }` em viewports > 480px
- Mobile (≤ 480px): layout empilhado mantido exatamente igual ao comportamento atual (foto 100% width em cima, texto abaixo) — sem regressão
- Confiança: `<div className="conf-border confClass(...)">` como primeiro filho do `<li>` com `aria-label="Confiança da IA: X.XX"` — badge `.badge` removido
- Classes de confiança reutilizam as existentes: `conf-high`/`conf-mid`/`conf-low`/`conf-zero` (já definem `background`)
- Cards `reviewed: true`: sem `opacity: 0.65`; ícone `✓` com `position: absolute` no canto superior esquerdo da foto, `aria-hidden="true"`
- O botão "Aceitar" substituído por `<span className="accepted">✓ Revisado</span>` (sem ação) — esse comportamento JÁ EXISTE; manter como está
- Placeholder: `role="img"` + `aria-label="Sem foto"` — remover `aria-hidden="true"`
- Todos os tokens CSS via variáveis CSS (`var(--success)`, etc.) — zero valores hardcoded
- Microcopy pt-BR; sem nova lógica de fetch

**Ask First:**
- Se o ícone ✓ revisado precisar de estilo diferente de um círculo semi-transparente (scrim `rgba(0,0,0,0.5)`) sobre a foto

**Never:**
- Chamar qualquer API no componente
- Adicionar animações de transição
- Alterar o comportamento dos botões "Corrigir" e "Excluir"
- Modificar o modo de edição inline (`editing === true`) — sem mudanças aí
- Criar novos tokens CSS fora do `:root`

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card com `ai_confidence_overall: 0.92` | `conf-high` | Borda esquerda 4px verde (`--success`); nenhum percentual visível; `aria-label="Confiança da IA: 0.92"` | — |
| Card com `ai_confidence_overall: 0.0` | `conf-zero` | Borda esquerda 4px vermelho (`--danger`); `aria-label="Confiança da IA: 0.00"` | — |
| Card `reviewed: true` com foto | foto presente | Foto luminosidade normal (sem opacity 0.65); ✓ posicionado absoluto no canto superior esquerdo da foto; texto estático "✓ Revisado" nas actions | — |
| Card `reviewed: true` sem foto | `photos: []` | Placeholder exibido sem opacity 0.65; ✓ overlay sobre o placeholder | — |
| Entrada sem foto (`photos: []`) | não-revisado | Placeholder com `role="img"`, `aria-label="Sem foto"`, dimensões 200×200px desktop | — |
| Viewport ≤ 480px | qualquer card | Layout empilhado (foto em cima 100% width); regressão zero em relação ao comportamento atual | — |
| Card com tag de contexto | `currentTag` presente | Tag badge com cores via `textOn(hex)` — sem mudança nesse comportamento | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:799` — `<li className={…card…reviewed…}>` — raiz do EntryCard, recebe novas classes
- `web/src/App.tsx:800-806` — bloco `.photos` com foto ou placeholder — recebe `position: relative` e overlay ✓
- `web/src/App.tsx:816-818` — `<span className="badge …">` — removido nesta story
- `web/src/App.tsx:805` — `<div className="photo-placeholder" aria-hidden="true" />` — semântica corrigida
- `web/src/App.tsx:881-882` — `<span className="accepted">✓ Revisado</span>` — já existe, mantido
- `web/src/styles.css:145-205` — `.card`, `.card.reviewed`, `.photos`, `.photos img`, `.photo-placeholder`, media query mobile
- `web/src/styles.css:241-244` — `.conf-high/.conf-mid/.conf-low/.conf-zero` — já definem `background`; reusadas pelo `.conf-border`
- `web/src/App.tsx:70-72` — função `confClass()` — reutilizada para o conf-border; sem mudança

## Tasks & Acceptance

**Execution:**
- [x] `web/src/styles.css` — adicionar `box-shadow: var(--shadow-card)` ao `.card`; remover `opacity: 0.65` de `.card.reviewed` — satisfaz AC de luminosidade e shadow-card
- [x] `web/src/styles.css` — mudar `.photos { flex: 0 0 160px }` para `flex: 0 0 200px`; adicionar `position: relative`; atualizar `.photos img` para `width: 200px; height: 200px`; atualizar `.photo-placeholder` para `width: 200px; height: 200px` — aumenta coluna de foto no desktop
- [x] `web/src/styles.css` — adicionar `.conf-border { width: 4px; flex: 0 0 4px; align-self: stretch; }` — cria elemento da borda de confiança (background herdado das classes conf-* existentes)
- [x] `web/src/styles.css` — adicionar `.reviewed-check { position: absolute; top: var(--space-2); left: var(--space-2); background: rgba(0,0,0,0.5); color: #fff; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 700; pointer-events: none; }` — ícone ✓ sobreposto à foto
- [x] `web/src/App.tsx` — no `EntryCard` JSX: adicionar `<div className={`conf-border ${confClass(entry.ai_confidence_overall)}`} aria-label={`Confiança da IA: ${entry.ai_confidence_overall.toFixed(2)}`} />` como **primeiro** filho do `<li>`, antes de `.photos` — cria a borda colorida acessível
- [x] `web/src/App.tsx` — no `EntryCard` JSX: remover `<span className={`badge ${confClass(...)}`}>{pct(...)}</span>` do `card-head` — elimina badge numérico visível
- [x] `web/src/App.tsx` — no `EntryCard` JSX: dentro do bloco `.photos`, adicionar `{entry.reviewed && <span className="reviewed-check" aria-hidden="true">✓</span>}` após o `<img>` / placeholder — adiciona overlay de revisão
- [x] `web/src/App.tsx` — no `EntryCard` JSX: trocar `<div className="photo-placeholder" aria-hidden="true" />` por `<div className="photo-placeholder" role="img" aria-label="Sem foto" />` — corrige acessibilidade do placeholder

**Acceptance Criteria:**
- Dado um entry card em viewport > 480px, quando visualizo, então a coluna de foto tem `flex: 0 0 200px` e o card exibe `box-shadow: var(--shadow-card)`
- Dado um entry card em viewport ≤ 480px, quando visualizo, então o layout é empilhado (foto 100% width em cima) — idêntico ao comportamento anterior
- Dado qualquer entry card, quando visualizo, então nenhum elemento exibe o percentual de confiança como texto visível; existe um elemento `.conf-border` com `aria-label` contendo o valor numérico
- Dado um card com `conf-high`, quando visualizo a borda, então a cor é `var(--success)` (verde)
- Dado um card `reviewed: true`, quando visualizo, então a foto tem a mesma luminosidade que um card não-revisado (sem `opacity: 0.65`) e um ícone ✓ está no canto superior esquerdo da foto com `aria-hidden="true"`
- Dado um card `reviewed: true`, quando visualizo as actions, então há texto estático "✓ Revisado" e os botões "Corrigir" e "Excluir" permanecem visíveis e funcionais
- Dado uma entrada sem foto, quando renderizada, então o placeholder tem `role="img"` e `aria-label="Sem foto"`

## Design Notes

O `<div className="conf-border">` é inserido como primeiro filho do `<li>`, antes de `.photos`. O flex layout do `.card` já é `display: flex; align-items: stretch` — o elemento `conf-border` com `align-self: stretch` vai ocupar a altura total do card naturalmente. `overflow: hidden` no `.card` já arredonda os cantos do conf-border.

O `.reviewed-check` deve ficar dentro do bloco `.photos` (não fora), pois `.photos` recebe `position: relative`. O posicionamento é em relação ao container de fotos, não ao card inteiro.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

**Manual checks:**
- Abrir a aba Revisão → cards com foto maior (200px); sem badge de confiança numérico; borda esquerda colorida visível
- Card revisado → foto com luminosidade normal; ✓ overlay no canto superior esquerdo da foto; "✓ Revisado" nas actions
- Mobile (≤ 480px) → layout empilhado sem regressão; borda esquerda ainda visível como faixa horizontal no topo ou lateral
- Entrada sem foto → placeholder com dimensões corretas (200px desktop); ícone centralizado; sem badge de percentual

## Suggested Review Order

**Borda de confiança — peça central da mudança**

- Primeiro filho do card: faixa de 4px que reutiliza classes conf-* existentes para cor
  [`App.tsx:800`](../../web/src/App.tsx#L800)

- CSS da faixa; `align-self: stretch` para ocupar altura total do card em desktop
  [`styles.css:243`](../../web/src/styles.css#L243)

- Override mobile: `width: 100%` transforma a faixa em stripe horizontal de 4px no topo
  [`styles.css:197`](../../web/src/styles.css#L197)

**Card base — shadow e opacity**

- `box-shadow: var(--shadow-card)` adicionado; `opacity` do revisado vai para 1
  [`styles.css:149`](../../web/src/styles.css#L149)

**Coluna de foto — 160→200px + position: relative**

- `.photos` com novo flex-basis e position para ancorar o overlay
  [`styles.css:163`](../../web/src/styles.css#L163)

**Overlay de revisado + placeholder semântico**

- Span ✓ `position: absolute` inserido como último filho do `.photos`
  [`App.tsx:810`](../../web/src/App.tsx#L810)

- CSS do overlay: scrim semi-transparente, círculo 24px, pointer-events: none
  [`styles.css:245`](../../web/src/styles.css#L245)

- Placeholder: `aria-hidden` → `role="img" aria-label="Sem foto"`
  [`App.tsx:809`](../../web/src/App.tsx#L809)

**Badge removido**

- Remoção do `<span className="badge …">` do card-head — confiança agora só via borda
  [`App.tsx:818`](../../web/src/App.tsx#L818)
