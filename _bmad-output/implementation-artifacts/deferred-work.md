# Deferred Work

Capacidades do SPEC-foodlog diferidas para implementação após a fundação (CAP-10 + CAP-1 + CAP-2).

## Melhorias técnicas diferidas — Spec B (encontradas na revisão)

- **pg Pool timeouts**: configurar `connectionTimeoutMillis` e `idleTimeoutMillis` em `src/db/client.ts` quando o volume de tráfego crescer (worker + webhook fazem 2 checkouts simultâneos por burst).
- **sendTextMessage sem tratamento de erro**: `src/routes/webhook.ts` — se `sendTextMessage` lançar exceção, o Z-API recebe 500 e pode retentar o webhook. Adicionar try/catch ao redor da chamada como pre-existing fix da Spec A.
- **Extração JSON do Claude**: abordagem `indexOf/lastIndexOf` pode falhar se Claude adicionar prosa com `}` após o JSON. Considerar brace-depth tracking em `src/services/ai.ts` se forem observadas falhas de parse em produção.
- **Limite 5MB por imagem para Anthropic**: fotos grandes do R2 podem exceder o limite da API e queimar retries. Adicionar guard de tamanho em `fetchImageAsBase64` (`src/services/ai.ts`) se forem observados erros 400 da API.

## Melhorias técnicas diferidas — CAP-1 REST endpoint (encontradas na revisão)

- **Hashing do `api_token`**: hoje o token é armazenado em plaintext em `users.api_token` e comparado verbatim (`src/routes/entries.ts`). Aceitável para uso pessoal, mas um vazamento de DB expõe a credencial. Considerar armazenar SHA-256 do token e comparar pelo hash quando houver mais de um usuário/uso externo.
- **Buffering em memória no upload multipart**: `src/routes/entries.ts` faz `toBuffer()` de cada foto e acumula todas em memória antes do upload ao R2 (até 10×20MB = ~200MB por requisição). Para uso pessoal é ok; se o endpoint ficar exposto, considerar streaming direto ao R2 e/ou reduzir `MAX_PHOTOS_PER_REQUEST` em `src/app.ts`.

## Melhorias técnicas diferidas — CAP-3 web app de revisão (encontradas na revisão)

- **Filtro de dia não-sargável em `GET /entries`**: `(e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date` (`src/routes/entries.ts`) aplica função por linha e não usa o índice `(user_id, created_at DESC)`. Irrelevante no volume pessoal; quando o histórico crescer, trocar por filtro de range `created_at >= $start AND created_at < $end` (calculando o intervalo do dia SP em JS ou via CTE) para usar o índice.

## Melhorias técnicas diferidas — CAP-4 correção + re-análise (encontradas na revisão)

- **Re-análise concorrente sem idempotência**: `POST /entries/:id/reanalyze` não usa `jobId` no BullMQ, então dois POSTs simultâneos para a mesma entry enfileiram jobs paralelos (duas transações DELETE+INSERT, `ai_cycles` dobrado). Risco baixíssimo no uso pessoal single-user (a UI desabilita o botão durante o `busy`) e o retry do BullMQ só ocorre em falha pré-commit (rollback, seguro). `jobId=entryId` NÃO serve (quebraria a sequência captura→re-análise, pois o job concluído da captura ficaria retido e dedupliparia a re-análise). Se o endpoint ficar exposto/multiusuário, adicionar um lock por entry (ex.: advisory lock no Postgres ou flag `reanalyzing`).
- **Sem limite de tamanho da correção/itens**: `correction` e `foods[].description` entram verbatim no prompt da IA sem cap de tamanho nem limite de itens (`src/routes/entries.ts` `buildCorrection`). Para uso pessoal com Bearer single-user é aceitável (DoS auto-infligido; injeção contra a própria IA não é ameaça). Se o endpoint ficar exposto, adicionar limites de tamanho/quantidade e considerar sanitização anti-injeção.

## Melhorias técnicas diferidas — CAP-5 correção por texto no WhatsApp (encontradas na revisão)

Todos aceitos conscientemente para uso pessoal single-user. Revisar se o canal virar multiusuário/exposto.

- **Alvo = "última entry de hoje" sem confirmação**: `processCorrection` (`src/routes/webhook.ts`) corrige sempre a entry mais recente de hoje. Se o usuário mandar 2 fotos e quiser corrigir a 1ª, o texto atinge a 2ª. Mitigação futura: ecoar o título da entry corrigida ou usar o quoted-message do Z-API para identificar a entry exata.
- **Sem idempotência por message-ID / concorrência**: mesma classe do item da CAP-4. O webhook responde 200 antes da re-análise terminar; um redelivery do Z-API (mesmo `messageId`) dispararia uma segunda correção (segundo ciclo, `ai_cycles` dobrado, summary duplicado). Duas correções simultâneas correm no `ai_cycles` (a detecção de sucesso por `priorCycles` fica ambígua). Uma correção enquanto a análise inicial ainda está pendente (`ai_cycles=0`) roda concorrente ao job de captura. Mitigação: dedupe por `messageId` + lock por entry (advisory lock Postgres).
- **Qualquer texto vira correção (sem intent-gating)**: um "oi"/emoji acidental de número cadastrado dispara re-análise e pode sobrescrever uma boa análise. Mitigação: gating por palavra-chave/prefixo ou heurística antes de enfileirar. Aplicar junto o cap de tamanho do texto (mesmo item da CAP-4).
- **Confirmação não-durável**: a confirmação é fire-and-forget em memória; se o processo reiniciar durante a re-análise, o usuário não recebe o resumo (a re-análise em si fica persistida). Mitigação: rastrear promises em voo no shutdown gracioso, ou job durável de confirmação.
- **Borda de fuso na virada do dia**: foto às 23:59 + correção às 00:01 (America/Sao_Paulo) caem em `::date` diferentes → "Não encontrei uma entrada de hoje". Inerente à escolha "só entries de hoje"; revisitar se incomodar.

## Melhorias técnicas diferidas — CAP-9 tags de contexto (encontradas na revisão)

Aceitas conscientemente para uso pessoal single-user; revisar se virar multiusuário/exposto.

- **FK violation → 500/retry ao apagar uma tag concorrentemente**: em `PATCH /entries/:id/context` (`src/routes/entries.ts`) há janela TOCTOU entre o SELECT de posse da tag e o UPDATE; e no worker (`src/workers/analyze-entry.ts`) entre buscar as tags e o UPDATE com a tag sugerida pela IA. Se a tag for apagada nesse instante, o UPDATE viola a FK (`23503`) → 500 no endpoint ou job falho/retentado no worker. Janela de milissegundos e ator único (mesma classe de concorrência já diferida em CAP-4/CAP-5). Mitigação se exposto: `try/catch` do código `23503` → 400/`SET NULL`, ou lock por entry.
- **Match IA case-insensitive em JS vs `lower()` do Postgres**: o worker casa `result.context` com as tags via `String.toLowerCase()` em vez do `lower()` do PG (índice único). Idêntico para pt-BR; só divergiria em locales exóticos (ex.: I turco). Trocar por match em SQL se houver tags fora de pt-BR.

## Melhoria técnica diferida — runner de migration não-transacional (pré-existente)

- **`src/db/migrate.ts` roda cada arquivo `.sql` via um único `pool.query(sql)` sem `BEGIN/COMMIT`**: uma falha no meio de um arquivo deixa estado parcial (sem tabela de migrations aplicadas, o re-run depende de `IF NOT EXISTS`/`ON CONFLICT`, que não corrige definições divergentes de uma aplicação parcial anterior). Afeta todas as migrations, não só a 005. Mitigação: envolver a execução de cada arquivo em transação no runner.

---

## Spec B — AI Pipeline (CAP-2)

BullMQ + Redis worker que consome entries criadas pela Spec A. Job `analyze-entry` busca a entry, monta contexto dos últimos 20 alimentos distintos mais frequentes do usuário, invoca Claude claude-sonnet-4-6 com visão, valida JSON de saída, persiste `food_items` e atualiza `ai_confidence_overall`. 3 tentativas com backoff exponencial; após esgotamento, `ai_confidence_overall: 0.0` e erro logado.

---

## CAP-1 parcial — iPhone Shortcut / REST endpoint de captura

Endpoint REST (`POST /entries/photo`) que aceita multipart com uma ou mais fotos, autenticando via token fixo (sem WhatsApp). Permite captura via iPhone Shortcut com tempo ≤10s.

## CAP-3 — Web app de revisão diária

Interface responsiva para revisar e aceitar/corrigir entradas do dia. Triagem automática por nível de confiança. Um toque aceita, dois toques abre detalhe para correção.

## CAP-4 — Correção + re-análise

Usuário reescreve descrição ou apaga campos na revisão → dispara novo ciclo de análise da IA sem preencher dados nutricionais manualmente.

## CAP-5 — Correção via WhatsApp — ÁUDIO (texto já entregue)

A correção por **texto** foi entregue em `spec-cap-5-whatsapp-text-correction.md` (mensagem de texto sem foto corrige a entry mais recente de hoje, reusando o pipeline de re-análise da CAP-4, com resumo de confirmação na mesma thread). Permanece diferida a correção por **áudio**: o Claude/Anthropic não transcreve áudio nativamente, então exige um provedor externo de transcrição (ex.: OpenAI Whisper ou Groq Whisper — nova dependência + chave + custo). Implementar: extrair `audio.audioUrl` do payload Z-API, baixar e transcrever para texto, e então alimentar o mesmo `processCorrection` (`src/routes/webhook.ts`) já existente.

## CAP-6 — Relatório semanal de padrões comportamentais

Gerado automaticamente toda semana. Disponível apenas no web app. Contém ≥3 observações de padrão (horários, variação de macros, correlações contexto × escolhas).

## CAP-7 — Link temporário para nutricionista

Gera link com prazo configurável. Nutricionista acessa 3 visualizações (calendário, lista com macros, análise de padrões) sem login. Link expirado retorna erro.

## CAP-8 — Busca no histórico por alimento

Busca por nome de alimento retorna todas as entradas correspondentes em ordem cronológica (usa full-text search do PostgreSQL).

## CAP-9 — Tag de contexto (casa/restaurante/trabalho/rua)

Campo opcional nas entradas. Selecionável com um toque na interface de captura (Shortcut) ou revisão (web app). 4 opções fixas.

## Melhorias técnicas diferidas — Auditabilidade OUTBOUND (encontradas na revisão)

Entregue em `spec-audit-outbound-logging.md`. Itens abaixo aceitos conscientemente para uso pessoal single-user; revisar se a auditoria virar multiusuário/exposta.

- **PII em summaries outbound**: `send-text` grava `{phone, message}` e `download-photo` grava a URL do Z-API (que pode conter token na query string) em `request_logs.request_body` (`src/services/whatsapp.ts`). `scrubSecrets` só mascara os segredos conhecidos do config — não normaliza telefone nem strips de query-string arbitrária. O webhook *inbound* já loga o mesmo payload, então a exposição marginal é baixa. Mitigação futura: gravar `{phone, chars}` em vez da mensagem inteira e fazer strip de query-string em URLs de terceiros nos summaries.
- **HTTP não-2xx logado como sucesso**: para as 3 chamadas baseadas em `fetch` (`download-photo`, `send-text`, `fetch-image`), `ok` reflete só que a promise resolveu — uma resposta 4xx/5xx resolve e vira row `status_code=200` `[ok]`. Decisão consciente do spec (menor blast radius; o `console.error` existente ainda registra o HTTP). Mitigação se incomodar: checar `res.ok` dentro do thunk e lançar, ou gravar o status real. (A chamada Anthropic não tem essa lacuna — o SDK lança em não-2xx.)
- **Retries do worker multiplicam rows outbound**: uma falha em `analyzeEntry` re-tenta até 3× (BullMQ `attempts:3`), e cada tentativa re-busca as fotos do R2 — gerando até 3 rows `anthropic` + 6 rows `fetch-image` por entry, sem chave de correlação (jobId/entryId) que as agrupe. Auditar cada tentativa é o desejado; se virar ruído na tabela (purga manual), adicionar uma coluna/summary de correlação.

## Auditabilidade — captura OUTBOUND — ✅ ENTREGUE em `spec-audit-outbound-logging.md`

As 5 chamadas a serviços externos agora gravam rows `direction='outbound'` em `request_logs` via `withOutboundAudit(target, operation, summary, run)` (`src/services/audit.ts`): `sendTextMessage`/`downloadPhoto` (whatsapp), `anthropic.messages.create`/`fetchImageAsBase64` (ai), `s3.send` (storage). Migration 004 adicionou a coluna `direction` (default `'inbound'`); `logOutbound` e o filtro `direction` na tela web foram criados nesta entrega (NÃO existiam antes, como a nota original presumia). Tradeoffs conscientes registrados acima ("Melhorias técnicas diferidas — Auditabilidade OUTBOUND").

---

## Melhorias técnicas diferidas (encontradas na revisão da Spec A)

- **SSL verificação do banco**: `rejectUnauthorized: false` é padrão aceitável para Railway, mas idealmente usar o certificado CA do Railway no futuro.
- **Pool de conexões pg**: configurar `max`, `connectionTimeoutMillis` e `idleTimeoutMillis` explicitamente quando o tráfego crescer.
- **Normalização de número de telefone**: validar/normalizar formato E.164 antes de lookup no banco (relevante se números puderem ser cadastrados em formatos diferentes).
- **Zod validation no webhook body**: adicionar schema Zod no route para rejeitar payloads malformados mais cedo (baixa prioridade enquanto Z-API for a única fonte).
- **POST /entries/photo síncrono segura conexão até ~50s** (introduzido em `spec-entry-analysis-ptbr-and-results`): o POST aguarda a análise da IA via `waitUntilFinished`. Sob proxy/load balancer com timeout de gateway abaixo disso, ou sob carga (cada captura em voo prende uma conexão HTTP + um consumidor Redis), pode haver gateway timeout / exaustão de conexões. Mitigações futuras: SSE/long-poll, webhook de conclusão, ou reduzir o timeout e depender mais do `GET /entries/:id`. Trade-off aceito conscientemente (modo síncrono escolhido pelo usuário).
