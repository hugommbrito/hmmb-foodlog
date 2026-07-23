---
title: 'Placeholder visual para registros sem fotos'
type: 'feature'
created: '2026-06-29'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Registros de refeição criados sem foto (entrada manual ou captura futura sem imagem) exibiam um card sem a coluna lateral de foto, fazendo os cards parecerem inconsistentes visualmente.

**Approach:** Quando `entry.photos` está vazio, renderizar um `<div className="photo-placeholder">` no lugar das imagens — um bloco cinza de 160×160px (responsivo no mobile) que mantém a estrutura visual do card.

## Suggested Review Order

1. [web/src/styles.css:128-138](../../web/src/styles.css#L128) — nova classe `.photo-placeholder` e remoção de `.photos:empty`
2. [web/src/App.tsx:773-780](../../web/src/App.tsx#L773) — condicional no `EntryCard`
3. [web/src/Share.tsx:376-383](../../web/src/Share.tsx#L376) — mesmo padrão no `ListView` da view pública
4. [web/src/styles.css:153](../../web/src/styles.css#L153) — override responsivo no `@media (max-width: 480px)`
