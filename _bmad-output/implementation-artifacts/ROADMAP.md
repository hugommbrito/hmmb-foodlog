# Roadmap — hmmb-foodlog

> Mapa único de **o que já foi feito × o que falta**, com ordem sugerida por sessão.
> Fonte da verdade do escopo: [SPEC.md](../specs/spec-foodlog/SPEC.md) (CAP-1 … CAP-10).
> Dívida técnica diferida vive em [deferred-work.md](./deferred-work.md).
> Atualizado: 2026-06-25 (CAP-7b entregue — análise de padrões por IA na view do nutricionista; CAP-7 completa).

---

## ✅ Já feito (com spec entregue)

| CAP | Capacidade | Spec |
|-----|------------|------|
| CAP-1 | Captura por foto em ≤10s (REST endpoint + iPhone Shortcut + WhatsApp) | [spec-cap-1-rest-photo-endpoint.md](./spec-cap-1-rest-photo-endpoint.md) · [foundation](./spec-foundation-whatsapp-capture-ai.md) |
| CAP-2 | Análise assíncrona por IA → JSON estruturado com macros + confiança | [spec-b-ai-pipeline.md](./spec-b-ai-pipeline.md) · [entry-analysis-ptbr](./spec-entry-analysis-ptbr-and-results.md) |
| CAP-3 | Web app de revisão diária com triagem por confiança | [spec-cap-3-daily-review-webapp.md](./spec-cap-3-daily-review-webapp.md) |
| CAP-4 | Correção + re-análise (reescrever descrição / apagar campos) | [spec-cap-4-correction-reanalysis.md](./spec-cap-4-correction-reanalysis.md) |
| CAP-5 (texto) | Correção via WhatsApp por **texto** | [spec-cap-5-whatsapp-text-correction.md](./spec-cap-5-whatsapp-text-correction.md) |
| CAP-9 | Tags de contexto **gerenciáveis** (CRUD) + seleção com um toque + sugestão por IA | [spec-cap-9-context-tags.md](./spec-cap-9-context-tags.md) |
| CAP-7a | Link temporário read-only p/ nutricionista (validade + calendário com miniaturas + lista com macros) | [spec-cap-7a-nutritionist-share-link.md](./spec-cap-7a-nutritionist-share-link.md) |
| CAP-7b | Análise de padrões por IA na view do nutricionista (lazy + cache no link) | [spec-cap-7b-nutritionist-pattern-analysis.md](./spec-cap-7b-nutritionist-pattern-analysis.md) |
| CAP-10 | Autenticação por número de WhatsApp (sem login) | [foundation](./spec-foundation-whatsapp-capture-ai.md) |

**Trabalho de suporte entregue (fora das CAPs):** auditoria inbound ([spec-audit-request-log.md](./spec-audit-request-log.md)), auditoria outbound ([spec-audit-outbound-logging.md](./spec-audit-outbound-logging.md)), correções do card web + delete + totais ([spec-web-card-fixes-delete-totals.md](./spec-web-card-fixes-delete-totals.md)).

---

## 🔲 A fazer — ordem sugerida

> A ordem abaixo equilibra **valor × esforço × dependências**. É uma sugestão — reordene se a prioridade mudar. Cada item é uma sessão (criar spec → implementar → review).

### 1. CAP-8 — Busca no histórico por nome de alimento
- **Por quê:** valor direto pro usuário e pras views do nutricionista; independente das demais.
- **Success (SPEC):** busca por "pizza" retorna todas as entradas com pizza identificada, ordem cronológica.

### 2. CAP-6 — Relatório semanal de padrões comportamentais
- **Por quê agora:** já existe CAP-9 — se beneficia dos dados de contexto acumulados (correlação contexto × escolhas). **Reusar o motor `analyzePatterns`** já criado na CAP-7b (`src/services/ai.ts`), expondo-o no relatório semanal autenticado.
- **Toca:** geração automática semanal, **somente no web app** (sem entrega ativa por WhatsApp/e-mail — constraint do SPEC).
- **Success (SPEC):** ≥3 observações de padrão (horários recorrentes, variação de macros por tipo de dia, correlações contexto × escolha).

### 3. CAP-5 (áudio) — Correção via WhatsApp por **áudio**
- **Por quê por último:** introduz **nova dependência externa** (Claude não transcreve áudio nativo → precisa de Whisper/Groq + chave + custo). Reusa o `processCorrection` já existente (`src/routes/webhook.ts`).
- **Implementar:** extrair `audio.audioUrl` do payload Z-API → baixar → transcrever → alimentar o pipeline de correção da CAP-5 texto.

---

## 🧹 Dívida técnica diferida (não bloqueia produto)

Todas conscientemente adiadas para **uso pessoal single-user**; revisar se o app virar multiusuário/exposto. Lista completa e detalhada em [deferred-work.md](./deferred-work.md). Resumo:

- Hashing do `api_token` (hoje plaintext).
- Idempotência / lock por entry na re-análise (CAP-4 e CAP-5).
- Timeouts e `max` explícitos no pool `pg`.
- Intent-gating no webhook (qualquer texto vira correção hoje).
- Filtro de dia não-sargável em `GET /entries`.
- `POST /entries/photo` síncrono segura conexão até ~50s.
- Guards de tamanho (imagem >5MB Anthropic, correção/itens sem cap).
- Confirmação não-durável da correção; borda de fuso na virada do dia.

---

## 🚫 Fora de escopo (Non-goals do SPEC — não fazer)

App nativo iOS/Android · banco de alimentos com busca/seleção · preenchimento nutricional manual pelo usuário · acesso interativo do nutricionista · export PDF · fila offline · multiusuário/onboarding público · notificações push / gamificação.

---

## Como usar este arquivo por sessão

1. Abra este roadmap e pegue o **primeiro item não concluído** da ordem sugerida.
2. Rode `bmad-spec` (ou `bmad-quick-dev`) para destilar/implementar a CAP — em janela nova.
3. Ao concluir, mova a CAP para a tabela **✅ Já feito** com o link do spec e atualize a data no topo.
