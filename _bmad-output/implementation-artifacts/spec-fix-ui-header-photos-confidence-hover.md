---
title: 'Fix — fotos sobre header, badge de confiança IA, hover zoom Parede/Timeline'
type: 'bugfix'
created: '2026-07-01'
status: 'done'
route: 'one-shot'
---

# Fix — fotos sobre header, badge de confiança IA, hover zoom Parede/Timeline

## Intent

**Problem:** Na tela de Revisão, fotos dos cards passavam sobre o header fixo durante o scroll (z-index ausente). O percentual de confiança da IA não era exibido visivelmente nos cards. Parede de Fotos e Timeline não tinham feedback visual de hover nas miniaturas.

**Approach:** Três mudanças CSS/JSX independentes: (1) `z-index: 1` no `header` sticky; (2) badge colorido `.conf-pct` no cabeçalho do card usando as classes de confiança já existentes; (3) `transition: transform` + `scale` via wrapper `overflow: hidden` no tl-thumb e diretamente no `.photowall-cell` (que já tinha `overflow: hidden`).

## Suggested Review Order

- [styles.css:117](../../web/src/styles.css) — `z-index: 1` adicionado ao `header`; verifica se valor 1 é suficiente frente ao `z-index: 2` das `.tabs`
- [App.tsx:1244–1257](../../web/src/App.tsx) — badge `conf-pct` no `EntryCard`; verifica guard `> 0` e reuso correto de `confClass()`/`pct()`
- [styles.css:282–291](../../web/src/styles.css) — classe `.conf-pct` que herda background das classes de confiança existentes
- [styles.css:619–627](../../web/src/styles.css) — hover zoom no `.photowall-cell img`
- [styles.css:776–800](../../web/src/styles.css) — `.tl-thumb-wrap` com `overflow: hidden` para clip do zoom
- [App.tsx:520–530](../../web/src/App.tsx) — wrapper `tl-thumb-wrap` adicionado ao img da Timeline

## Spec Change Log

