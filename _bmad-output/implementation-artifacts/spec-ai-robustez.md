---
title: 'Robustez do serviço de IA — guard 5 MB + extração JSON por brace-depth'
type: 'chore'
created: '2026-06-26'
status: 'done'
route: 'one-shot'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

## Intent

**Problem:** `fetchImageAsBase64` não verificava o tamanho da imagem antes de enviá-la à API da Anthropic (limite de 5 MB), podendo causar erro 400 silencioso. A extração de JSON das respostas do Claude usava `indexOf/lastIndexOf`, que quebra quando o modelo adiciona prosa após o `}` de fechamento.

**Approach:** Adicionar guard de tamanho (pre-check em `Content-Length` + post-check no buffer) em `fetchImageAsBase64`. Substituir `indexOf/lastIndexOf` por `extractJsonObject` com brace-depth tracking e tracking de string literals, compartilhado por `analyzeEntry` e `analyzePatterns`.

## Suggested Review Order

1. [src/services/ai.ts:51–74](../../src/services/ai.ts) — `extractJsonObject`: lógica de brace-depth com escape e string tracking
2. [src/services/ai.ts:77–101](../../src/services/ai.ts) — `fetchImageAsBase64`: pre-check em `Content-Length` + post-check no buffer
3. [src/services/ai.ts:152–158](../../src/services/ai.ts) — uso em `analyzeEntry`
4. [src/services/ai.ts:243–249](../../src/services/ai.ts) — uso em `analyzePatterns`
