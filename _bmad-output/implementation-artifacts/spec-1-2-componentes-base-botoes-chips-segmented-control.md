---
title: 'Story 1.2 — Componentes Base: Botões, Chips e Segmented Control'
type: 'feature'
created: '2026-06-29'
status: 'done'
route: 'one-shot'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Os componentes base de interação (botão primário, link, chip ativo e segmented control ativo) têm inconsistências com o design system: o botão carece de `font-weight: 600`; o cursor do estado desabilitado usa `default` em vez de `not-allowed`; falta hover no botão link; `.chip.active` e `.seg-btn.active` usam `--text` como cor de seleção em vez de `--accent`, quebrando o sinal visual de destaque em dark mode.

**Approach:** Cinco mudanças cirúrgicas em `web/src/styles.css` — todos os seletores afetados já existem; é substituição de valores. Dois patches adicionais da revisão adversarial: reset de `font-weight` em `.log-head` (herdaria 600 indevidamente) e hover para `.link.danger` (evita perda do sinal de cor vermelha no hover).

</frozen-after-approval>

## Suggested Review Order

**Mudança de maior impacto visual — active state de seleção**

- `.chip.active` e `.seg-btn.active` passam de `--text` para `--accent` — chips de contexto e filtros de segmento agora usam azul sky como cor de seleção
  [`styles.css:309`](../../web/src/styles.css#L309)
  [`styles.css:273`](../../web/src/styles.css#L273)

**Botão primário completo**

- `font-weight: 600` adicionado ao seletor `button`; `cursor: not-allowed` substitui `default` no estado desabilitado
  [`styles.css:62`](../../web/src/styles.css#L62)
  [`styles.css:72`](../../web/src/styles.css#L72)

**Hover no botão link + patch de danger**

- `.link:hover` → `color: var(--text)`; `.link.danger:hover` → `color: var(--danger)` (evita perda do sinal vermelho)
  [`styles.css:73`](../../web/src/styles.css#L73)

**Patch de revisão — `.log-head` reseta font-weight**

- `.log-head` (botão-linha do log de auditoria) recebe `font-weight: 400` para não herdar o 600 do seletor base `button`
  [`styles.css:258`](../../web/src/styles.css#L258)
