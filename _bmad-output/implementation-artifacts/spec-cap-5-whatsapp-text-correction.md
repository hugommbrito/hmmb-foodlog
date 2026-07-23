---
title: 'CAP-5 — Correção de entrada via WhatsApp (texto)'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: '0982773b4ef413298ab7a86e28ab969216de0c07'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hoje o usuário só corrige uma entrada pela web (CAP-4). No WhatsApp, após "📸 Foto recebida!", não há como ajustar a interpretação da IA sem abrir o app — quebra o baixo atrito que é a razão do canal existir.

**Approach:** Estender o webhook do Z-API para tratar mensagens de **texto** (sem foto) como correção da entrada **mais recente de hoje** do usuário. O texto verbatim alimenta o pipeline de re-análise já existente da CAP-4 (`enqueueAnalysis(entryId, correction)`), sem nova lógica de IA. O webhook responde 200 na hora, envia um ack e, ao concluir a re-análise, confirma na mesma thread com resumo completo (título + alimentos + macros). Áudio fica fora de escopo (diferido).

## Boundaries & Constraints

**Always:**
- Webhook SEMPRE retorna 200 ao Z-API; nº não cadastrado ou `fromMe===true` é ignorado em silêncio (regras invioláveis Z-API).
- Foto tem prioridade: mensagem com imagem segue o fluxo de captura existente — texto/caption NÃO vira correção.
- Reusar o pipeline da CAP-4 sem alterá-lo (`enqueueAnalysis`, worker `analyze-entry`, `analyzeEntry`): o worker já trata correção como verdade, faz DELETE+INSERT transacional e reseta `reviewed=false`.
- Re-análise é assíncrona: o webhook não segura a conexão. A confirmação final é fire-and-forget (`waitForAnalysis` em background; fora do request → log com `console.*`).
- Dia = `America/Sao_Paulo` (convenção de `GET /entries`); todo envio ao Z-API passa por `sendTextMessage` (nunca lança).

**Ask First:**
- Introduzir provedor/dependência de transcrição (áudio está fora deste spec).
- Mudar o pipeline da CAP-4 ou o contrato de `POST /entries/:id/reanalyze`.

**Never:**
- Transcrição de áudio (diferida — ver `deferred-work.md`).
- Criar entrada nova a partir de texto (texto sem foto NUNCA cria entry).
- Preencher nutrição a partir do texto: é correção em linguagem natural; a IA recalcula.
- Lock/idempotência por entry (aceito para single-user — ver Design Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Foto recebida | payload com `image.imageUrl` | Fluxo de captura existente, inalterado | já coberto |
| Correção válida | texto de nº cadastrado; existe entry de hoje | 200 `{received:true}`; ack "✏️…"; em background re-analisa e envia resumo completo na thread | timeout/erro da fila → log + msg "não consegui agora, confira no app" |
| Sem entry hoje | texto de nº cadastrado; nenhuma entry hoje | 200 `{received:true}`; msg "Não encontrei uma entrada de hoje para corrigir 📸" | N/A |
| Texto vazio/whitespace | `text.message` ausente ou só espaços | 200 `{received:false}`; nada enviado | N/A |
| Re-análise sem alimentos | IA retorna 0 foods na correção | worker mantém análise anterior (`ai_cycles` não avança); msg "não consegui interpretar a correção" | já coberto no worker |
| Não cadastrado / fromMe | — | 200 `{received:false}`; ignorado | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/webhook.ts` -- handler principal; adicionar branch de correção por texto (após o branch de foto) + orquestração assíncrona da confirmação
- `src/services/whatsapp.ts` -- adicionar `extractTextFromWebhook(payload)` (espelha `extractPhotoFromWebhook`) e `formatEntrySummary(...)` (resumo pt-BR para a thread)
- `src/types/models.ts` -- adicionar `text?: { message?: string }` em `WebhookPayload`
- `src/queues/entry.ts` -- reuso de `enqueueAnalysis` + `waitForAnalysis` (sem alteração)
- `src/workers/analyze-entry.ts` -- reuso do caminho de correção (sem alteração)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- atualizar item CAP-5: texto entregue, áudio diferido

## Tasks & Acceptance

**Execution:**
- [x] `src/types/models.ts` -- adicionar campo opcional `text?: { message?: string }` em `WebhookPayload` -- modelar o payload de texto do Z-API
- [x] `src/services/whatsapp.ts` -- adicionar `extractTextFromWebhook(payload): string | null` (retorna `message` trimado ou null) e `formatEntrySummary(title, foods, confidence): string` (resumo com título, bullets de alimentos com `quantity` e macros não-nulas, e confiança em %) -- centralizar extração e formatação da mensagem
- [x] `src/routes/webhook.ts` -- após o branch de imagem, adicionar: extrair texto; se nulo → `received:false`; senão buscar a entry mais recente de **hoje** (`user_id`, filtro de dia `America/Sao_Paulo`, `ORDER BY created_at DESC LIMIT 1`, selecionando `id, ai_cycles`); se não houver → enviar msg "sem entrada de hoje" e `received:true`; senão enviar ack, e em **background** (`void` com `.catch`) `enqueueAnalysis(id, texto)` → `waitForAnalysis(job, config.ANALYSIS_WAIT_TIMEOUT_MS)` → recarregar entry+foods → se `ai_cycles` avançou enviar `formatEntrySummary`, senão enviar msg de falha -- conectar o canal WhatsApp ao pipeline de re-análise
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- editar o item "CAP-5" para registrar que a correção por **texto** foi entregue e que **áudio** (transcrição via provedor externo) permanece diferido

**Acceptance Criteria:**
- Given um nº cadastrado com ao menos uma entrada hoje, when ele envia um texto livre (ex.: "era arroz integral, não branco"), then o webhook responde 200 imediatamente, dispara a re-análise com o texto como correção e, ao concluir, envia na mesma thread um resumo com título + alimentos + macros.
- Given uma mensagem com foto (com ou sem caption), when processada, then segue o fluxo de captura existente e NUNCA é tratada como correção.
- Given um nº cadastrado sem nenhuma entrada hoje, when envia texto, then recebe a mensagem orientando a enviar a foto e nenhuma re-análise é enfileirada.
- Given a re-análise estourar o timeout ou retornar zero alimentos, when o background finaliza, then o usuário recebe uma mensagem de falha amigável e a análise anterior permanece intacta (`ai_cycles` inalterado).
- Given `npm run build`, when executado, then compila sem erros de tipo.

## Design Notes

**Confirmação assíncrona:** a captura já envia `sendTextMessage` fire-and-forget após o 200. Para correção (re-análise ~10–50s), NÃO bloquear a resposta: ack síncrono → disparar a finalização sem `await` (com `.catch`, para nunca deixar rejeição não tratada) → o background espera o job e envia o resumo. O worker fica agnóstico de canal — a lógica WhatsApp mora na rota/serviço.

**Detecção de sucesso:** capturar `ai_cycles` ANTES de enfileirar; após `waitForAnalysis`, recarregar e comparar — se avançou, a re-análise landou (mesma técnica de `POST /entries/:id/reanalyze`). Se não (timeout ou 0 foods → worker preserva o anterior), enviar mensagem de falha.

**Exemplo de resumo:**
```
✅ Entrada atualizada!
🍽 Café da manhã reforçado

• Pão integral (2 fatias) — 140 kcal · P 6g · C 24g · G 2g
• Ovo mexido (2 un) — 180 kcal · P 12g · G 14g

Confiança: 82%
```

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` compila sem erros

**Manual checks (if no CLI):**
- Com Redis + worker rodando, simular POST `/webhook/whatsapp` com `{phone:<cadastrado>, text:{message:"era frango grelhado"}}` após existir uma entry de hoje → resposta 200 imediata; logs mostram enqueue; ao concluir, `sendTextMessage` é chamado com o resumo.
- POST com `image.imageUrl` → segue captura (cria entry nova), texto ignorado.
- POST com texto e sem entry de hoje → mensagem orientando enviar foto; nenhum job enfileirado.

## Suggested Review Order

**Roteamento (entry point)**

- Onde a decisão acontece: sem foto + texto presente → vira correção; foto sempre tem prioridade.
  [`webhook.ts:111`](../../src/routes/webhook.ts#L111)

**Orquestração da correção**

- Acha a entry mais recente de hoje, manda o ack e dispara a re-análise em background (200 rápido).
  [`webhook.ts:19`](../../src/routes/webhook.ts#L19)

- Background fire-and-forget: enfileira, espera, confirma na thread; reusa o pipeline da CAP-4 intacto.
  [`webhook.ts:48`](../../src/routes/webhook.ts#L48)

- Detecção de sucesso por avanço de `ai_cycles` (mesma técnica do `POST /entries/:id/reanalyze`).
  [`webhook.ts:67`](../../src/routes/webhook.ts#L67)

**Serviço WhatsApp**

- Extrai o texto da mensagem (trim + null-safe), espelhando `extractPhotoFromWebhook`.
  [`whatsapp.ts:21`](../../src/services/whatsapp.ts#L21)

- Formata o resumo pt-BR (título + alimentos com macros não-nulas + confiança).
  [`whatsapp.ts:32`](../../src/services/whatsapp.ts#L32)

**Tipos (periférico)**

- Campo `text?` no `WebhookPayload` para o payload de texto do Z-API.
  [`models.ts:133`](../../src/types/models.ts#L133)
