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

## Melhorias técnicas diferidas — CAP-6 relatório semanal (encontradas na revisão)

Aceitas conscientemente para uso pessoal single-user.

- **Formato de log do erro de `analyzePatterns`**: já corrigido em CAP-6b (`app.log.error(err, ...)` no `src/routes/report.ts`).
- **Race condition no cache miss**: dois `GET /report/weekly` simultâneos para o mesmo usuário no mesmo momento do dia ambos passam pelo cache-miss, chamam `analyzePatterns` em paralelo e fazem UPSERT (last-writer-wins). Mesma classe de concorrência já diferida em CAP-4/5/7b; aceitável para uso pessoal single-user. Mitigação futura: advisory lock por `user_id` no Postgres ou mutex em memória (single-process).

## Melhorias técnicas diferidas — CAP-6b relatório flexível (encontradas na revisão)

Aceitas conscientemente para uso pessoal single-user.

- **Rate limit em `force=true`**: qualquer chamada autenticada a `GET /report/weekly?force=true` re-invoca a IA, ignorando o cache. Não há cooldown ou cota. Risco de custo amplificado se o endpoint ficar exposto a múltiplos usuários. Mitigação futura: rate limit por `user_id` (ex.: 1 forced re-gen / hora) ou custo-cap no provider.
- **Cache midnight thundering herd**: o cache invalida à meia-noite no fuso de São Paulo — todos os usuários que acessarem o relatório logo após a virada de dia re-geram em paralelo. Irrelevante para uso pessoal single-user; mitigar com jitter de expiração se for multiusuário.

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

## CAP-8 — Busca no histórico por alimento ✅ ENTREGUE em `spec-cap-8-food-search.md`

Implementado em 2026-06-26. Itens diferidos encontrados na revisão:

- **Índice pg_trgm para performance**: quando o histórico ultrapassar ~5 k entries, adicionar `CREATE EXTENSION IF NOT EXISTS pg_trgm` e `CREATE INDEX ON food_items USING gin(lower(description) gin_trgm_ops)`. Hoje usa ILIKE sem índice (adequado para single-user pessoal).
- **Acento inconsistente entre server e Share.tsx**: `GET /entries/search` usa `lower() ILIKE` (nativo do PG; acento-ciente no collation `pt_BR.UTF-8`), enquanto o filtro client-side da view do nutricionista (`Share.tsx`) usa `String.prototype.toLowerCase().includes()` (JS simples). Para pt-BR o comportamento é equivalente, mas pode divergir em strings com acento especial fora do plano básico. Mitigação: normalizar com `Intl.Collator` no frontend se for reportado divergência.
- **Reanalyze deixa entry obsoleta em searchResults**: após re-análise, uma entry pode ficar visível em searchResults com foods atualizados que já não batem com o termo buscado. O usuário não é confundido (pode limpar e rebuscar), mas idealmente searchResults seria invalidado e rebuscado após reanalyze em search mode.

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

## Goal diferido — CAP-7b: análise de padrões por IA na view do nutricionista

Separado conscientemente da CAP-7a (link + acesso sem login + calendário + lista) em 2026-06-25 (decisão de Hugo). A 3ª visualização exigida pelo SPEC CAP-7 ("análise de padrões por IA") foi diferida porque:

- Introduz **nova dependência/custo**: novas chamadas ao Claude para sumarizar o período do link.
- **Sobrepõe-se à CAP-6** (relatório semanal de padrões comportamentais) — candidata a ser implementada **junto/fundida** com a CAP-6, reusando o mesmo motor de detecção de padrões.
- Não bloqueia o valor central do link (apresentar histórico ao nutricionista): calendário + lista já cobrem isso.

**Quando retomar:** implementar a detecção de padrões (≥3 observações: horários recorrentes, variação de macros por tipo de dia, correlações contexto × escolha) uma vez só, e expô-la tanto no relatório semanal (CAP-6, web app autenticado) quanto na view pública do link (CAP-7b, read-only). Reusar a infra de share-link da CAP-7a (token, período, expiração).

## Melhorias técnicas diferidas — CAP-7b análise de padrões (encontradas na revisão)

Entregue em `spec-cap-7b-nutritionist-pattern-analysis.md` (endpoint público lazy `GET /shared/:token/patterns` que computa via Claude e cacheia em `share_links.analysis_json`). Itens abaixo aceitos conscientemente para uso pessoal single-user; revisar se a view virar exposta/multiusuário.

- **Concorrência sem lock no preenchimento do cache**: em `src/routes/share.ts` (`/shared/:token/patterns`) a checagem `analysis_json IS NULL` e o `UPDATE` não são atômicos. Dois primeiros-acessos simultâneos (endpoint **público sem auth**) disparam 2 chamadas pagas ao Claude (last-writer-wins no UPDATE). Já registrado como decisão consciente no spec (mesma classe de CAP-4/5). Mitigação se exposto: `UPDATE ... WHERE id=$2 AND analysis_json IS NULL` + re-SELECT, ou `SELECT ... FOR UPDATE` numa transação.
- **Sem cap no tamanho do digest enviado ao Claude**: `analyzePatterns` (`src/services/ai.ts`) serializa **todas** as entradas do período sem limite de quantidade/caracteres. Período muito longo (ex.: 90 dias com muitas refeições) infla o prompt (custo/latência) e pode truncar a saída (`max_tokens: 1536`) → `JSON.parse` falha → 502 não-cacheado → reabrir re-tenta e paga de novo. Irrelevante no volume pessoal; se exposto/longo, capar nº de entradas/tamanho do digest e/ou detectar `stop_reason === 'max_tokens'`.
- **Cache nunca invalida após mudança nas entradas do período**: decisão "Ask First" do spec — `analysis_json` é imutável até o link expirar. Se o dono corrigir/apagar/adicionar entradas depois da 1ª geração, o nutricionista vê uma análise desatualizada. Aceitável para período histórico/uso pessoal. Mitigação: limpar `analysis_json` ao mutar entradas cobertas, ou guardar um fingerprint das entradas e recomputar na divergência.

## Epic 1 — Story 1.2: tab active state usa --text em vez de --accent

- **`.tab.active` usa `color: var(--text)` e `border-bottom-color: var(--text)`** em vez de `var(--accent)`. Isso é inconsistente com `.chip.active` e `.seg-btn.active` que foram atualizados para `--accent` na Story 1.2. Em dark mode, a aba ativa fica com sublinhado quase branco, divergindo do padrão visual de seleção com accent. Corrigir na Story 2.1 (Reorganização da Navegação) junto com as demais mudanças do tab bar (5 abas, Auditoria fora do nav).

## Epic 1 — Design System: valores sub-grade diferidos (encontrados na revisão da Story 1.1)

Valores abaixo de `--space-1` (4px) e acima de `--space-6` (32px) que ficaram hardcoded em `web/src/styles.css`. Visualmente corretos e pre-existentes; migrar quando a escala de tokens for expandida.

- **`2px` em elementos decorativos do calendário e card**: `.cal-cell { gap: 2px }`, `.cal-weekday { padding-bottom: 2px }`, `.card-head .totals { margin-top: 2px }` — valores sub-grade necessários para a densidade visual do calendário e alinhamento sutil de metadados.
- **`1px` em pills compactas**: `.ctx-tag { padding: 1px var(--space-2) }`, `.pattern-cat { padding: 1px var(--space-2) }` — padding de 1px top/bottom intencional para pills de texto muito pequenas (`0.68rem`–`0.72rem`); `--space-1` (4px) as tornaria altas demais.
- **`48px` em `.empty`**: `padding: 48px var(--space-4)` — valor acima de `--space-6` (32px); exige adicionar `--space-12: 48px` ou similar à escala se padronizado.
- **`2px` em `.search-date-label`**: `padding: 4px 0 2px` — o `4px` já é `--space-1` (corrigível trivialmente); o `2px` inferior é sub-grade.
- **`3px` em `.cal-thumbs img`**: `border-radius: 3px` — entre `--radius-sm` (6px) e nenhum raio; valor cosmético pré-existente.
