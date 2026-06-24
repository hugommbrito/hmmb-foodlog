---
title: 'Auditabilidade OUTBOUND — instrumentar chamadas a serviços externos'
type: 'feature'
created: '2026-06-24'
status: 'done'
context: ['{project-root}/_bmad-output/project-context.md']
baseline_commit: 'e65f05c637be035656d1490970f5eaab2ae655ff'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A auditoria atual só registra requisições HTTP *inbound* (`request_logs` via hook Fastify). As 5 chamadas a serviços externos (Z-API, Anthropic, R2) não deixam rastro — falhas, latência e payloads enviados são invisíveis no app de auditoria.

**Approach:** Reusar a tabela `request_logs` adicionando uma coluna `direction`. Um helper `withOutboundAudit(target, operation, summary, run)` cronometra a chamada externa, grava uma row `direction='outbound'` fire-and-forget e **re-lança o erro original** sem alterar o comportamento do caller. Envolver as 5 chamadas dentro dos próprios services. A tela web de auditoria ganha um filtro por direção.

## Boundaries & Constraints

**Always:**
- O helper SEMPRE re-lança o erro original do `run()` inalterado (nunca engole nem transforma exceções).
- Logging é fire-and-forget: nunca lança, nunca atrasa, falha de persistência só vai para `console.error` (mesmo padrão de `logInbound`).
- Envolver APENAS a chamada externa de I/O dentro do `run()` — nada da lógica circundante (validação, montagem de payload, parse) entra no `run()`.
- Respeitar `config.AUDIT_ENABLED !== 'true'` → `withOutboundAudit` executa `run()` direto, custo zero, sem persistir.
- Scrubbing: `summary` e mensagens de erro passam por `scrubSecrets`; NUNCA incluir base64 de imagem nem o buffer binário no summary.
- A instrumentação fica DENTRO dos services (`whatsapp.ts`, `ai.ts`, `storage.ts`) — os callers (`webhook.ts`, `entries.ts`, `analyze-entry.ts`) não mudam.

**Ask First:**
- Se for necessário alterar a assinatura pública de qualquer função de service (ex.: `analyzeEntry`, `uploadPhoto`) para instrumentar — HALT e pergunte.

**Never:**
- Não criar nova tabela (reusar `request_logs`).
- Não persistir `Authorization`/`client-token`/tokens/base64/buffers.
- Não tocar nos caminhos críticos de captura/análise além de envolver a chamada externa.
- Sem retenção automática nem novos endpoints além do filtro `direction` no `GET /audit/requests` existente.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chamada externa OK | `run()` resolve | Row `direction='outbound'`, `status_code=200`, `duration_ms` preenchido, `request_body`=summary scrubbed; valor de `run()` retornado intacto | N/A |
| Chamada externa falha | `run()` rejeita | Row `outbound`, `status_code=500`, `response_body`=erro scrubbed; **erro re-lançado** ao caller | erro original propaga |
| `AUDIT_ENABLED!='true'` | qualquer | `run()` executado, nada persistido, retorno/erro intactos | N/A |
| INSERT do log falha | DB indisponível | chamada externa não afetada; só `console.error('[audit] …')` | engolido |
| Filtro UI = Saída | `GET /audit/requests?direction=outbound` | só rows outbound, mais recentes primeiro | N/A |
| Migration reaplicada | runner roda 004 de novo | idempotente; rows existentes mantêm `direction='inbound'` | N/A |

</frozen-after-approval>

## Code Map

- `src/db/migrations/004_add_request_logs_direction.sql` -- NOVA: `ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound'` + índice `(direction, created_at DESC)`
- `src/services/audit.ts` -- adicionar `withOutboundAudit` + `logOutbound` + `OutboundLogRecord`; reusa `scrubSecrets`/`truncate`
- `src/services/whatsapp.ts` -- envolver `fetch` em `sendTextMessage` e `downloadPhoto`
- `src/services/ai.ts` -- envolver `anthropic.messages.create` e o `fetch` de `fetchImageAsBase64`
- `src/services/storage.ts` -- envolver `s3.send`
- `src/routes/audit.ts` -- aceitar query `direction` (whitelist `inbound|outbound`) no `GET /audit/requests`
- `src/types/models.ts` -- add `direction: string` em `RequestLog`
- `web/src/types.ts` -- espelhar `direction`
- `web/src/api.ts` -- `fetchRequestLogs(q?, direction?, limit?)`
- `web/src/App.tsx` -- filtro segmentado (Todos/Entrada/Saída) + badge de direção no `LogRow`; ocultar campos vazios para outbound

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/004_add_request_logs_direction.sql` -- migration idempotente: coluna `direction TEXT NOT NULL DEFAULT 'inbound'` + índice `(direction, created_at DESC)`
- [x] `src/services/audit.ts` -- núcleo: `OutboundLogRecord`, `logOutbound` (INSERT `direction='outbound'`, mapa `operation`→`method`, `target`→`path`, summary→`request_body`, ok→`status_code` 200/500, erro→`response_body`; `.catch` console.error) e `withOutboundAudit<T>(target, operation, summary, run)` (cronometra, serializa+scrub summary, loga, re-lança)
- [x] `src/services/whatsapp.ts` -- envolver `fetch` de `sendTextMessage` (`'z-api'`,`'send-text'`,`{phone, message}`) e de `downloadPhoto` (`'z-api'`,`'download-photo'`,`{url: scrubSecrets(imageUrl)}`); try/catch/timeout externos intactos
- [x] `src/services/ai.ts` -- envolver `anthropic.messages.create` (`'anthropic'`,`'messages.create'`,`{model:'claude-sonnet-4-6', photos: photos.length}`) e `fetch` de `fetchImageAsBase64` (`'r2'`,`'fetch-image'`,`{url: scrubSecrets(url)}`); summary SEM base64
- [x] `src/services/storage.ts` -- envolver `s3.send` (`'r2'`,`'put-object'`,`{key, bytes: buffer.length, mimetype}`)
- [x] `src/types/models.ts` + `web/src/types.ts` -- add `direction: string` em `RequestLog`
- [x] `src/routes/audit.ts` -- `GET /audit/requests`: ler `direction`; se `'inbound'`/`'outbound'` add condição `direction = $n`; inválido → ignorar
- [x] `web/src/api.ts` -- `fetchRequestLogs` aceita `direction?: 'inbound'|'outbound'` como query param
- [x] `web/src/App.tsx` -- `Audit`: filtro segmentado Todos/Entrada/Saída que recarrega; `LogRow` com badge de direção e, p/ outbound, Summary/Resultado no lugar de IP/headers vazios (+ estilos em `web/src/styles.css`)

**Acceptance Criteria:**
- Given `AUDIT_ENABLED='true'`, when uma captura WhatsApp completa (download + upload R2 + análise IA + confirmação), then existem rows outbound para `download-photo`, `put-object`, `fetch-image`, `messages.create` e `send-text`.
- Given uma chamada externa lança, when envolvida por `withOutboundAudit`, then o caller recebe exatamente o mesmo erro (tipo e mensagem) e existe uma row outbound com `status_code=500`.
- Given a tela de auditoria, when seleciono "Saída", then só rows outbound aparecem e nenhum payload contém token, secret ou base64.
- Given `AUDIT_ENABLED='false'`, when qualquer service externo roda, then nenhuma row outbound é criada e o comportamento é idêntico ao atual.

## Spec Change Log

## Design Notes

Desvios conscientes da nota do `deferred-work.md`: (1) a assinatura sugerida tinha `method`+`label` redundantes → uso 4 params (`target`, `operation`, `summary`, `run`); a UI exibe `operation`(coluna `method`) + `target`(coluna `path`). (2) A nota dizia que `logOutbound` e o filtro `direction` "já existiam" — **não existem**; este spec os cria.

Granularidade: envolver SOMENTE o thunk de I/O (`() => fetch(...)` / `() => s3.send(...)`). `ok` reflete sucesso de transporte (thunk resolveu); HTTP-não-2xx segue tratado pelo `console.error` existente — menor blast radius. `logOutbound` espelha `logInbound` (INSERT fire-and-forget + `.catch`); `request_headers`/`query`/`remote_ip` ficam null em rows outbound. `withOutboundAudit` usa `Date.now()` para cronometrar.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (raiz)
- `cd web && npm run build` -- expected: `tsc && vite build` sem erros
- `npm run db:migrate` -- expected: aplica 004 sem erro; reexecução idempotente

**Manual checks:**
- Com `AUDIT_ENABLED=true`, enviar uma foto no WhatsApp e abrir a aba Auditoria → filtro "Saída" lista as 5 chamadas; abrir um detalhe e confirmar ausência de token/base64 no summary.

## Suggested Review Order

**Núcleo — helper de auditoria**

- Entry point: o helper que cronometra a chamada, loga fire-and-forget e re-lança o erro original.
  [`audit.ts:125`](../../src/services/audit.ts#L125)

- Mapeia a forma outbound nas colunas de `request_logs` (operation→method, target→path, ok→200/500).
  [`audit.ts:103`](../../src/services/audit.ts#L103)

**Instrumentação dos 5 call-sites (dentro dos services)**

- Anthropic: envolve só `messages.create`, summary `{model, photos:N}` sem base64.
  [`ai.ts:89`](../../src/services/ai.ts#L89)

- Fetch da imagem no R2, URL passada por `scrubSecrets`.
  [`ai.ts:41`](../../src/services/ai.ts#L41)

- Z-API send-text — observe o summary `{phone, message}` (tradeoff de PII registrado no deferred-work).
  [`whatsapp.ts:106`](../../src/services/whatsapp.ts#L106)

- Z-API download-photo, URL scrubbed.
  [`whatsapp.ts:62`](../../src/services/whatsapp.ts#L62)

- Upload R2 `s3.send`, summary `{key, bytes, mimetype}`.
  [`storage.ts:22`](../../src/services/storage.ts#L22)

**Schema & API**

- Migration idempotente: coluna `direction` (default inbound) + índice.
  [`004_add_request_logs_direction.sql:5`](../../src/db/migrations/004_add_request_logs_direction.sql#L5)

- Filtro `direction` no `GET /audit/requests` (whitelist + numeração de placeholders).
  [`audit.ts:61`](../../src/routes/audit.ts#L61)

**UI**

- Filtro segmentado Todos/Entrada/Saída que recarrega com a query atual.
  [`App.tsx:461`](../../web/src/App.tsx#L461)

- `LogRow`: badge de direção e detalhe Resumo/Resultado para outbound.
  [`App.tsx:562`](../../web/src/App.tsx#L562)
