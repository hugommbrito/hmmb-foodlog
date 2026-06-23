---
title: 'Módulo de auditabilidade — captura de requisições inbound com visualização no web app'
type: 'feature'
created: '2026-06-23'
status: 'done'
baseline_commit: '898f6e62c181f605f4ea8e88b6c764ad386ac1b7'
context: ['{project-root}/_bmad-output/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Depurar chamadas ao backend hoje depende do log do Railway (ruim) e nem o Z-API nem o Shortcuts do iPhone mostram detalhes das requisições recebidas. Falta um registro persistente e navegável do que entra na API.

**Approach:** Persistir no Postgres toda requisição HTTP recebida (inbound) via hooks globais do Fastify — com segredos redigidos e binários omitidos — e exibir/filtrar esses registros numa nova aba "Auditoria" no web app React existente, reusando a auth por Bearer token. (Captura de chamadas outbound foi diferida em `deferred-work.md`.)

## Boundaries & Constraints

**Always:**
- O logging é **fire-and-forget e à prova de falha**: nunca lança, nunca altera a resposta, nunca atrasa o handler. Qualquer erro ao gravar é apenas `console.error`.
- Preservar o invariante do webhook Z-API: **sempre HTTP 200**; o hook não pode mudar status nem corpo retornado.
- **Redigir segredos** em headers (`authorization`, `client-token`, `cookie`) e em qualquer texto logado — substituindo valores conhecidos de `config` por `***`.
- **Omitir binários**: corpos multipart (upload de foto) nunca são gravados — apenas placeholder. Truncar qualquer corpo a no máximo 16 KB.
- Migration **idempotente** (`IF NOT EXISTS`) — o runner reaplica todas as migrations a cada execução.
- Endpoints de auditoria exigem Bearer token válido (mesma regra de `users.api_token`).

**Ask First:**
- Antes de extrair `authenticate`/`extractBearerToken` de `routes/entries.ts` para módulo compartilhado (mexe no caminho crítico) — por padrão, duplicar a função mínima em `routes/audit.ts`.
- Antes de pular `/health` da captura (atualmente captura tudo, exceto os próprios `/audit/*`).

**Never:**
- Sem captura outbound nesta entrega (diferida).
- Sem expiração/limpeza automática (retenção manual via endpoint `DELETE`).
- Sem gravar binário/foto ou segredos em claro.
- Sem auth nova (sem login/sessão) — só o Bearer token existente.
- Sem fila/worker para o logging; gravação não-aguardada via `query()`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inbound JSON | POST `/webhook/whatsapp` com body JSON | 1 row inbound: headers redigidos, request/response body em texto, status, `duration_ms` | resposta ao cliente inalterada |
| Inbound multipart | POST `/entries/photo` | 1 row inbound com `request_body='[multipart omitido]'` | nunca grava binário |
| Header sensível | request com `Authorization: Bearer ...` | header gravado como `***` | — |
| Falha ao gravar | INSERT lança | requisição original conclui normal | só `console.error` |
| `AUDIT_ENABLED=false` | qualquer requisição | nada gravado | — |
| Rota própria | GET `/audit/requests` | não gera row (pulada) | — |
| GET logs sem token | sem `Authorization` | 401 | — |
| DELETE logs | `DELETE /audit/requests[?before=YYYY-MM-DD]` | remove todos/anteriores à data; retorna nº removido | 400 em data inválida |

</frozen-after-approval>

## Code Map

- `src/db/migrations/003_add_request_logs.sql` -- NOVO: tabela `request_logs` + índice `created_at DESC` (idempotente)
- `src/services/audit.ts` -- NOVO: `scrubSecrets`, `redactHeaders`, `truncate`, `logInbound` (fire-and-forget)
- `src/plugins/audit.ts` -- NOVO: `registerAuditHooks(app)` com `onRequest` (marca início) + `onSend` (grava inbound), pulando `/audit/*`
- `src/routes/audit.ts` -- NOVO: `GET /audit/requests`, `GET /audit/requests/:id`, `DELETE /audit/requests`
- `src/app.ts` -- registrar hooks + `auditRoutes`
- `src/config.ts` + `.env.example` -- flag `AUDIT_ENABLED` (default `true`)
- `src/types/models.ts` -- interface `RequestLog`
- `web/src/types.ts` / `web/src/api.ts` -- tipo `RequestLog` + `fetchRequestLogs`/`purgeRequestLogs`
- `web/src/App.tsx` / `web/src/styles.css` -- abas (Revisão | Auditoria) + tela de auditoria

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/003_add_request_logs.sql` -- criar `request_logs(id uuid pk default gen_random_uuid(), created_at timestamptz default now(), method text, path text, query text, status_code int, duration_ms int, request_headers jsonb, request_body text, response_body text, remote_ip text)` + `idx_request_logs_created_at` (idempotente) -- registro consultável
- [x] `src/services/audit.ts` -- `scrubSecrets(text)` substitui cada valor de `config` (ZAPI_TOKEN, ANTHROPIC_API_KEY, R2_*, ZAPI_WEBHOOK_SECRET, DATABASE_URL, REDIS_URL) por `***`; `redactHeaders(headers)` mascara `authorization`/`client-token`/`cookie`; `truncate(s, 16000)`; `logInbound(record)` faz `query(INSERT...)` **sem `await`** no caller e captura erro em `console.error` (nunca lança) -- núcleo à prova de falha
- [x] `src/plugins/audit.ts` -- `registerAuditHooks(app)`: `onRequest` grava `request.auditStartedAt`; `onSend(request, reply, payload)` calcula duração, monta record (method, url/path, query, `redactHeaders(request.headers)`, `request.body` serializado via `scrubSecrets` ou `'[multipart omitido]'` quando ausente, `reply.statusCode`, `payload` truncado/scrubbed, `request.ip`) e chama `logInbound`; **retorna o `payload` inalterado**; pular paths que começam com `/audit`; respeitar `config.AUDIT_ENABLED` -- captura inbound global
- [x] `src/routes/audit.ts` -- auth Bearer (helper local mínimo, espelhando `entries.ts`); `GET /audit/requests?limit&q&before` (limit default 50, máx 500; `q` = substring em `path`; `before` = `created_at <`; ordenar `created_at DESC`); `GET /audit/requests/:id` (404 se não-UUID/ausente); `DELETE /audit/requests?before=` (valida data como em `entries.ts`, retorna `{deleted: n}`) -- API de consulta
- [x] `src/app.ts` -- chamar `registerAuditHooks(app)` e `app.register(auditRoutes)` -- ativação
- [x] `src/config.ts` + `.env.example` -- `AUDIT_ENABLED` (`z.string().default('true')`; usar `=== 'true'`) -- liga/desliga
- [x] `src/types/models.ts` -- interface `RequestLog` -- tipagem backend
- [x] `web/src/types.ts` + `web/src/api.ts` -- tipo `RequestLog` (datas como string ISO) + `fetchRequestLogs(params)` e `purgeRequestLogs(before?)` reusando `request<T>()` -- cliente
- [x] `web/src/App.tsx` + `web/src/styles.css` -- estado de aba (Revisão | Auditoria) acima de `Review`; componente `Audit` com filtro de busca por path, lista mostrando método/path/status/duração/horário, linha expansível com headers e corpos (req/resp), botões "Atualizar" e "Limpar" (chama `purgeRequestLogs`) -- UI

**Acceptance Criteria:**
- Given o webhook Z-API recebe um POST, when ele responde 200, then existe 1 row em `request_logs` com headers redigidos e o corpo do payload visível na aba Auditoria, e a resposta `{received:...}` permanece inalterada.
- Given um POST multipart em `/entries/photo`, when é logado, then `request_body` é `'[multipart omitido]'` (nenhum binário gravado).
- Given `logInbound` falha ao gravar, when ocorre o erro, then a requisição original conclui normalmente (apenas `console.error`).
- Given `AUDIT_ENABLED=false`, when chega qualquer requisição, then nada é gravado.
- Given o usuário abre a aba Auditoria com token válido, when filtra por path e expande uma linha, then vê headers redigidos e os corpos de requisição/resposta.

## Design Notes

- **Hooks globais sem `fastify-plugin`:** `app.addHook('onRequest'|'onSend', ...)` chamados na raiz em `buildApp()` rodam para todas as rotas filhas — a lib `fastify-plugin` não está instalada, então não usar plugin encapsulado.
- **`onSend` é o ponto certo** para inbound: dá acesso a `request.body` (já parseado) e ao `payload` (resposta serializada); `onResponse` não expõe o corpo da resposta. Sempre `return payload` sem modificar.
- **Redação por valor conhecido:** `scrubSecrets` varre o texto e troca cada segredo de `config` por `***` — robusto e sem regex frágil.
- **Multipart:** em `/entries/photo` o `request.body` é `undefined` (consumido como stream), então o binário nunca entra no log naturalmente — gravar placeholder.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (strict)
- `npm run db:migrate` -- expected: aplica `003_add_request_logs.sql` sem erro (idempotente em re-run)
- `cd web && npm run build` -- expected: `tsc && vite build` sem erros

**Manual checks:**
- Subir o backend (`npm run dev`), enviar uma foto pelo WhatsApp e fazer um GET `/entries`; abrir a aba Auditoria no web app e confirmar as rows inbound (webhook, /entries) com segredos mascarados e sem binários.
- Confirmar que a resposta do webhook permanece `200 {received:...}` inalterada e que `/audit/*` não aparece nos logs.

## Suggested Review Order

**Captura inbound (núcleo — invariantes em jogo)**

- Entry point: como toda requisição é capturada sem afetar a resposta (retorna `payload` inalterado).
  [`audit.ts:57`](../../src/plugins/audit.ts#L57)
- Pular `/audit/*` evita o web app logar a si mesmo a cada polling.
  [`audit.ts:59`](../../src/plugins/audit.ts#L59)
- Ativação fire-and-forget: hooks registrados na raiz antes das rotas; respeita `AUDIT_ENABLED`.
  [`audit.ts:48`](../../src/plugins/audit.ts#L48)
- Wiring no app: hooks antes dos `register` de rotas; `auditRoutes` por último.
  [`app.ts:32`](../../src/app.ts#L32)

**Segurança dos dados (redação + à prova de falha)**

- `scrubSecrets`: troca cada segredo de `config` por `***` (split/join, sem regex).
  [`audit.ts:24`](../../src/services/audit.ts#L24)
- `redactHeaders`: mascara `authorization`/`client-token`/`cookie`.
  [`audit.ts:39`](../../src/services/audit.ts#L39)
- `logInbound`: INSERT não-aguardado, só `console.error` em falha (nunca lança).
  [`audit.ts:70`](../../src/services/audit.ts#L70)

**API de consulta**

- Auth Bearer local (espelha `entries.ts`) + `GET /audit/requests` com filtro/limite.
  [`audit.ts:41`](../../src/routes/audit.ts#L41)
- `DELETE /audit/requests` para limpeza manual (retenção é manual).
  [`audit.ts:98`](../../src/routes/audit.ts#L98)

**UI web**

- Shell com abas Revisão | Auditoria, mesmo Bearer token.
  [`App.tsx:54`](../../web/src/App.tsx#L54)
- Tela `Audit`: lista, filtro por path, expandir detalhe, Atualizar/Limpar.
  [`App.tsx:264`](../../web/src/App.tsx#L264)

**Periféricos (schema, config, tipos)**

- Migration idempotente da tabela `request_logs`.
  [`003_add_request_logs.sql:3`](../../src/db/migrations/003_add_request_logs.sql#L3)
- Flag `AUDIT_ENABLED` no schema Zod.
  [`config.ts:23`](../../src/config.ts#L23)
- Tipo `RequestLog` (backend) e espelho no web.
  [`models.ts:90`](../../src/types/models.ts#L90)
