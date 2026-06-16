# Deferred Work

Capacidades do SPEC-foodlog diferidas para implementação após a fundação (CAP-10 + CAP-1 + CAP-2).

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
