---
title: 'CAP-7b — Análise de padrões por IA na view do nutricionista (read-only)'
type: 'feature'
created: '2026-06-25'
status: 'done'
baseline_commit: 'c64927d23fb4a99bb193e91dab0d55e47938a233'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cap-7a-nutritionist-share-link.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A CAP-7a entregou o link read-only com 2 visualizações (calendário + lista), mas a 3ª exigida pelo SPEC CAP-7 — **análise de padrões por IA** — ficou diferida. Sem ela o nutricionista vê os dados crus, não as tendências (horários recorrentes, variação de macros por tipo de dia, correlações contexto × escolha).

**Approach:** Reusar a infra de share-link da CAP-7a. Adicionar um endpoint público **lazy** `GET /shared/:token/patterns` que, no 1º acesso, manda o **digest textual** das entradas do período ao Claude (texto, sem fotos), recebe ≥3 observações estruturadas em pt-BR e **cacheia** o resultado em `share_links`. Acessos seguintes servem do cache (custo único por link). No web app, adicionar uma 3ª aba "Padrões" ao `PublicShare`, carregada sob demanda só quando aberta.

## Boundaries & Constraints

**Always:**
- Detecção **100% por IA** (decisão de Hugo, 2026-06-25): uma chamada ao Claude recebe o digest e devolve as observações. NÃO calcular padrões deterministicamente.
- **Cache no link**: computa uma vez (1º acesso à aba), grava em `share_links.analysis_json`+`analysis_generated_at`; acessos seguintes servem do cache sem chamar o Claude (protege contra custo repetido e enumeração do token).
- **Lazy**: a IA só roda quando a aba "Padrões" abre — `GET /shared/:token` (calendário+lista da CAP-7a) fica **inalterado** e rápido, sem IA.
- Endpoint público read-only sem auth, isolado por `user_id` do link, mesmas regras de token da CAP-7a (parse inteiro antes de qualquer query; 404 não-inteiro/inexistente/revogado; 410 expirado) — ver matriz.
- Digest ao Claude = **texto puro** das entradas do período (data+hora SP, contexto, alimentos+macros) — **nunca** fotos/`user_id`/telefone/token. Saída validada por Zod; textos em pt-BR. Chamada sob `withOutboundAudit('anthropic','analyze-patterns',{...},run)`, modelo `claude-sonnet-4-6`.

**Ask First:**
- Invalidar o cache quando uma entrada do período muda após a 1ª geração — registrado: **manter imutável** nesta sessão (período histórico, uso pessoal).
- Trocar para motor híbrido (agregados + redação IA) p/ baratear períodos longos — **manter 100% IA** nesta sessão.

**Never:**
- Sem fundir com a CAP-6 agora: a `analyzePatterns` nasce reutilizável, mas só a view pública read-only é escopo aqui.
- Sem acesso interativo do nutricionista (Non-goal). Não tocar captura/correção/calendário/lista; sem export PDF; sem nova suíte de testes (projeto sem runner).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1º acesso, dados suficientes | `GET /shared/:token/patterns`, sem cache, ≥3 dias com entradas | 200 `{generated_at, analysis:{observations:[≥3 {category,title,detail}], summary}}`; persiste em `analysis_json`/`analysis_generated_at` | — |
| Acesso com cache | `analysis_json` já preenchido | 200 com o cache; **não** chama o Claude | — |
| Dados insuficientes | entradas em <3 dias locais distintos | 200 `{insufficient:true}`; não chama Claude; não cacheia | — |
| Link expirado | `expires_at<=now` | 410 `{error:'Link expirado'}` | — |
| Token inválido/inexistente/revogado | não-inteiro ou `share_no` desconhecido | 404 `{error:'Link inválido'}` | parse inteiro antes de query |
| Falha do Claude / JSON inválido | SDK lança ou Zod rejeita | 502 `{error:'Não foi possível gerar a análise'}`; não cacheia | erro logado; UI mostra retry |

</frozen-after-approval>

## Code Map

- `src/db/migrations/008_share_link_analysis.sql` -- NOVO: `ALTER TABLE share_links ADD COLUMN IF NOT EXISTS analysis_json JSONB` + `analysis_generated_at TIMESTAMPTZ` (idempotente).
- `src/types/models.ts` -- `PatternObservation` (`category,title,detail`), `PatternAnalysis` (`observations[]`, `summary`), e a linha de entrada do digest (`PatternEntryInput`).
- `src/services/ai.ts` -- NOVO `analyzePatterns(entries): Promise<PatternAnalysis>`: monta o digest textual, chama o Claude (texto, sem imagem) sob `withOutboundAudit`, extrai+valida JSON via Zod (mesmo padrão de `analyzeEntry`).
- `src/routes/share.ts` -- NOVO `GET /shared/:token/patterns`: reusa parse-do-token/lookup/410; checa cache → senão carrega entradas do período (mesma query do `/shared/:token`, reaproveitada), aplica guard de suficiência, chama `analyzePatterns`, persiste cache, responde.
- `web/src/types.ts` -- `PatternObservation`, `PatternAnalysis`, `PatternsPayload` (`generated_at`/`analysis`/`insufficient`).
- `web/src/api.ts` -- `fetchSharedPatterns(token)` (fetch público sem Authorization; reusa `ShareExpiredError`/`ShareInvalidError`; trata 502).
- `web/src/Share.tsx` -- 3ª aba "Padrões" no `PublicShare`: estado próprio (loading/insufficient/error/ok), fetch lazy só quando a aba é aberta a 1ª vez; render das observações.
- `web/src/styles.css` -- cartões de observação de padrão.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/008_share_link_analysis.sql` -- colunas de cache (idempotente) -- base do cache
- [x] `src/types/models.ts` -- `PatternObservation`/`PatternAnalysis`/`PatternEntryInput` -- contrato compartilhado
- [x] `src/services/ai.ts` -- `analyzePatterns` (digest textual + Claude + Zod + audit) -- motor de detecção (reutilizável p/ CAP-6)
- [x] `src/routes/share.ts` -- `GET /shared/:token/patterns` (cache→guard→IA→persist; 404/410/502) -- backend
- [x] `web/src/{types.ts,api.ts}` -- tipos + `fetchSharedPatterns` -- camada web
- [x] `web/src/Share.tsx` + `web/src/styles.css` -- aba "Padrões" lazy + estados + estilo -- view do nutricionista

**Acceptance Criteria:**
- Given um link válido com entradas em ≥3 dias, when o nutricionista abre a aba "Padrões" pela 1ª vez, then vê ≥3 observações (incluindo horários, macros e contexto×escolha quando os dados permitirem), sem login.
- Given a aba "Padrões" já foi aberta uma vez, when é reaberta (mesmo ou outro acesso), then o conteúdo vem do cache e nenhuma nova chamada ao Claude é feita.
- Given um link com poucas entradas (<3 dias), when a aba é aberta, then mostra "dados insuficientes" e nenhuma chamada ao Claude ocorre.
- Given um link expirado/revogado, when a aba é aberta, then mostra "expirado" (410) / "inválido" (404), sem análise.
- Given o calendário e a lista da CAP-7a, when a aba "Padrões" existe, then aqueles continuam funcionando sem chamar IA (payload de `/shared/:token` inalterado).

## Design Notes

Endpoint separado (não embutir no payload da CAP-7a) p/ manter calendário+lista rápidos e não pagar IA a cada carregamento. Fluxo do `GET /shared/:token/patterns`:

```ts
// 1. parse inteiro + lookup share_no + checagem expires_at (copiar de /shared/:token)
// 2. if (link.analysis_json) return { generated_at, analysis: link.analysis_json }  // cache
// 3. carregar entradas do período (mesma query/JOIN do /shared/:token)
// 4. if (new Set(entries.map(spDate)).size < 3) return { insufficient: true }  // sem Claude/cache
// 5. const analysis = await analyzePatterns(entries)   // pode lançar -> 502
// 6. UPDATE share_links SET analysis_json=$1, analysis_generated_at=now() WHERE id=$2
// 7. return { generated_at, analysis }
```

Digest (texto, sem fotos): 1 linha/entrada `DD/MM HH:MM · <contexto|sem contexto> · <desc (kcal/P/G/C), ...>`. System prompt em inglês (como `SYSTEM_PROMPT`) exigindo JSON exato `{"observations":[{"category","title","detail"}],"summary":string|null}`, ≥3 observations cobrindo horários, macros por tipo de dia e contexto×escolha **quando os dados sustentarem** (não inventar), textos em pt-BR. Extração JSON com o mesmo `indexOf('{')`/`lastIndexOf('}')` de `analyzeEntry`. `analysis_json` é JSONB: pg lê já parseado; no UPDATE passar `JSON.stringify(analysis)`.

Concorrência (2 primeiros-acessos simultâneos → 2 chamadas, last-writer-wins): mesma classe já diferida em CAP-4/5; aceitável p/ uso pessoal — registrar em deferred-work, não corrigir aqui.

## Verification

**Commands:**
- `npm run build` -- expected: `tsc` sem erros (backend)
- `cd web && npm run build` -- expected: `tsc` + `vite build` sem erros (web)
- `npm run db:migrate` -- expected: aplica 008 e é idempotente ao re-rodar

**Manual checks:**
- Criar link cobrindo um período com entradas em ≥3 dias; abrir `/share/<token>`, clicar "Padrões" → ≥3 observações; recarregar → sem nova row `anthropic`/`analyze-patterns` no audit (cache).
- Forçar `analysis_json` para NULL no banco e reabrir → recomputa (nova row de audit).
- Período curto (<3 dias) → "dados insuficientes", nenhuma row de audit `analyze-patterns`.
- Link expirado/revogado → aba mostra expirado/inválido.

## Suggested Review Order

**Endpoint público lazy + cache (entry point)**

- Ponto de entrada: nova rota lazy; cache→guard→IA→persist, mantendo as regras de token da CAP-7a.
  [`share.ts:213`](../../src/routes/share.ts#L213)

- Cache hit serve `analysis_json` sem chamar o Claude (protege custo no endpoint sem auth).
  [`share.ts:245`](../../src/routes/share.ts#L245)

- Guard de suficiência: exige entradas em ≥3 dias locais antes de pagar a IA; senão `insufficient`.
  [`share.ts:256`](../../src/routes/share.ts#L256)

- Falha da IA → 502 não-cacheado (retryável); sucesso persiste o cache.
  [`share.ts:266`](../../src/routes/share.ts#L266)

- Query de entradas do período extraída p/ reuso entre `/shared/:token` e patterns (sem duplicar SQL).
  [`share.ts:52`](../../src/routes/share.ts#L52)

**Motor de detecção (IA)**

- `analyzePatterns`: digest textual (sem fotos) → 1 chamada Claude sob `withOutboundAudit`.
  [`ai.ts:190`](../../src/services/ai.ts#L190)

- Schema valida saída e exige `.min(3)` observações (falha alto em vez de cachear resultado deficiente).
  [`ai.ts:129`](../../src/services/ai.ts#L129)

- Linha por entrada: data/hora SP · contexto · alimentos+macros (macros nulos omitidos).
  [`ai.ts:162`](../../src/services/ai.ts#L162)

**Camada web (aba "Padrões" lazy)**

- Trigger lazy com `useRef` p/ dedupe — evita o estado preso em 'loading' ao trocar de aba mid-fetch.
  [`Share.tsx:111`](../../web/src/Share.tsx#L111)

- `PatternsView`: estados loading/insufficient/error(retry)/ok + guard de lista vazia.
  [`Share.tsx:205`](../../web/src/Share.tsx#L205)

- Fetch público sem Authorization; reusa as classes de erro 410/404 da CAP-7a; trata 502.
  [`api.ts:168`](../../web/src/api.ts#L168)

**Suporte**

- Migration 008: colunas de cache aditivas e idempotentes.
  [`008_share_link_analysis.sql:6`](../../src/db/migrations/008_share_link_analysis.sql#L6)
