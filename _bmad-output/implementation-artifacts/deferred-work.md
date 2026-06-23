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

## CAP-5 — Correção via WhatsApp (texto/áudio)

Bot WhatsApp aceita mensagem de texto livre ou áudio para corrigir uma entrada. Transcreve áudio quando necessário, identifica campos a atualizar, confirma na mesma thread.

## CAP-6 — Relatório semanal de padrões comportamentais

Gerado automaticamente toda semana. Disponível apenas no web app. Contém ≥3 observações de padrão (horários, variação de macros, correlações contexto × escolhas).

## CAP-7 — Link temporário para nutricionista

Gera link com prazo configurável. Nutricionista acessa 3 visualizações (calendário, lista com macros, análise de padrões) sem login. Link expirado retorna erro.

## CAP-8 — Busca no histórico por alimento

Busca por nome de alimento retorna todas as entradas correspondentes em ordem cronológica (usa full-text search do PostgreSQL).

## CAP-9 — Tag de contexto (casa/restaurante/trabalho/rua)

Campo opcional nas entradas. Selecionável com um toque na interface de captura (Shortcut) ou revisão (web app). 4 opções fixas.

---

## Melhorias técnicas diferidas (encontradas na revisão da Spec A)

- **SSL verificação do banco**: `rejectUnauthorized: false` é padrão aceitável para Railway, mas idealmente usar o certificado CA do Railway no futuro.
- **Pool de conexões pg**: configurar `max`, `connectionTimeoutMillis` e `idleTimeoutMillis` explicitamente quando o tráfego crescer.
- **Normalização de número de telefone**: validar/normalizar formato E.164 antes de lookup no banco (relevante se números puderem ser cadastrados em formatos diferentes).
- **Zod validation no webhook body**: adicionar schema Zod no route para rejeitar payloads malformados mais cedo (baixa prioridade enquanto Z-API for a única fonte).
- **POST /entries/photo síncrono segura conexão até ~50s** (introduzido em `spec-entry-analysis-ptbr-and-results`): o POST aguarda a análise da IA via `waitUntilFinished`. Sob proxy/load balancer com timeout de gateway abaixo disso, ou sob carga (cada captura em voo prende uma conexão HTTP + um consumidor Redis), pode haver gateway timeout / exaustão de conexões. Mitigações futuras: SSE/long-poll, webhook de conclusão, ou reduzir o timeout e depender mais do `GET /entries/:id`. Trade-off aceito conscientemente (modo síncrono escolhido pelo usuário).
