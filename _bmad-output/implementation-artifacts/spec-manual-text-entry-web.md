---
title: 'Registro manual por texto na web (IA segrega alimentos e pesos)'
type: 'feature'
created: '2026-06-25'
status: 'done'
baseline_commit: 'ac30ab8f7158848459c224c0c69f4b467edc02d1'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hoje só dá pra criar uma entry pela foto (WhatsApp/REST). Quem comeu algo sem tirar foto — ou prefere só descrever — não tem como registrar pela web. Falta um caminho de captura manual.

**Approach:** Um botão "Novo registro" no web app abre um formulário onde o usuário escreve em **texto livre** o que comeu, opcionalmente anexa foto(s) e escolhe a data/hora. O backend cria a entry e roda o **mesmo pipeline de IA** (síncrono, como a captura por foto): a IA **segrega os alimentos e estima as quantidades/pesos e macros** a partir do texto (e da foto, se houver). O usuário **nunca digita macros** — continua sendo a IA que calcula; isto é distinto do non-goal "preenchimento nutricional manual".

## Boundaries & Constraints

**Always:**
- Auth `Authorization: Bearer {api_token}` na rota nova — reusar `authenticate()`; só opera nos dados do próprio `user_id`.
- `description` (texto) é **obrigatória** e não-vazia (trim) → 400 caso contrário.
- Foto é **opcional**; quando presente, validar como em `POST /entries/photo` (mimetype `image/*`, não-vazia, limites do `@fastify/multipart`) e fazer upload ao R2 **antes** do INSERT (invariante do projeto). Sem foto → `photos = []` (a coluna `TEXT[] NOT NULL` aceita array vazio).
- Análise **síncrona** (igual à captura por foto): `enqueueAnalysis` + `waitForAnalysis(ANALYSIS_WAIT_TIMEOUT_MS)`; timeout/falha da IA → **201** com `analysis_status:'pending'` (foods preenchidos depois via GET), **nunca 5xx** por falha de IA.
- Entry nasce `reviewed:false`, `ai_cycles:0`, `ai_confidence_overall:0.0` — IA é a única fonte de `food_items`/macros/pesos.
- Reusar `analyzeEntry`/worker/queue — **estender minimamente**, sem novo pipeline. O caminho da foto e a re-análise (CAP-4/5) seguem inalterados em comportamento.

**Ask First:**
- Qualquer migration/alteração de schema (não é necessária — `entries.photos` aceita `[]`, `created_at` aceita valor explícito, `food_items` já existe).

**Never:**
- Usuário digitar kcal/proteína/gordura/carbo (macros são sempre da IA).
- Login/senha/sessão (auth é só Bearer) ou alterar o fluxo do webhook/WhatsApp.
- Aceitar data futura para `created_at`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Texto só | `POST /entries/manual` multipart, `description` preenchida, sem foto, sem `created_at` | 201; entry com `photos:[]`, `created_at=now()`; IA segrega alimentos+pesos+macros; view com `foods[]` | — |
| Texto + foto + data | `description` + 1..N arquivos + `created_at` ISO válido (≤ agora) | 201; foto no R2; `created_at` aplicado; IA usa texto+foto | — |
| Sem descrição | `description` ausente/só espaços | 400 `{ error }` | nada persiste; nenhum upload |
| Foto inválida | parte não-`image/*` ou vazia | 400 `{ error }` | drena todas as partes; nada persiste |
| `created_at` malformado/futuro | string não-ISO ou data no futuro | 400 `{ error }` | nada persiste |
| Timeout/falha da IA | job não conclui no timeout | 201 `analysis_status:'pending'`; entry existe, `foods` vem depois via GET | log warn; sem 5xx |
| Token ausente/inválido | sem Bearer válido | 401 `{ error }` | sem vazar dados |

</frozen-after-approval>

## Code Map

- `src/routes/entries.ts` -- adicionar `POST /entries/manual` (multipart): auth, parsear campos `description`/`created_at` + arquivos (drenar todas as partes como o `/photo`), validar (400), upload R2 se houver foto, INSERT com `created_at` explícito quando informado, `enqueueAnalysis(id, undefined, description)` + `waitForAnalysis`, retornar `loadEntryView` (201). Reusar `authenticate`, `loadEntryView`, padrões de validação multipart do `POST /entries/photo`.
- `src/queues/entry.ts` -- `enqueueAnalysis(entryId, correction?, description?)` grava `description` no job data.
- `src/types/models.ts` -- `AnalyzeEntryJobData` ganha `description?: string`.
- `src/workers/analyze-entry.ts` -- ler `description` do job; guard de pular vira `if (photos.length === 0 && !description) skip`; passar `description` para `analyzeEntry`. (guard `ai_cycles>0 && !correction` permanece — captura manual inicial tem `ai_cycles:0`, roda normal.)
- `src/services/ai.ts` -- `analyzeEntry(photos, recentFoods, contextTags, correction?, description?)`: quando há `description`, injetar bloco pt-BR instruindo a IA a segregar os alimentos e **estimar quantidades/pesos e nutrição** a partir do texto (verdade do que foi consumido); ajustar a linha final de instrução ("foto(s) acima" vs "refeição descrita acima" vs ambos); generalizar o `SYSTEM_PROMPT` de "meal photos / visible" para "photos e/ou descrição em texto / present".
- `web/src/api.ts` -- `createManualEntry({ description, createdAt?, photos? }): Promise<EntryAnalysisView>` montando `FormData` (reusar `request`, que não força `Content-Type` — o browser define o boundary).
- `web/src/App.tsx` (+ `web/src/styles.css`) -- botão "Novo registro" no header → formulário (textarea `description`, `datetime-local` default agora, input file múltiplo opcional); submit chama `createManualEntry`, trata `UnauthorizedError` e estado `busy` (síncrono, até ~timeout); ao concluir, se o dia (SP-local) da entry criada == `date` atual recarrega `fetchEntries(date)`, senão `setDate(diaCriado)` (dispara refetch). O card já renderiza `photos:[]` sem quebrar.

## Tasks & Acceptance

**Execution:**
- [x] `src/types/models.ts` -- adicionar `description?: string` em `AnalyzeEntryJobData`.
- [x] `src/queues/entry.ts` -- `enqueueAnalysis(entryId, correction?, description?)` propaga `description` no job data.
- [x] `src/services/ai.ts` -- `analyzeEntry` aceita `description?`; injeta instrução pt-BR (segregar alimentos + estimar pesos/macros do texto), adapta a linha de fechamento conforme há foto e/ou texto, e generaliza o `SYSTEM_PROMPT`.
- [x] `src/workers/analyze-entry.ts` -- ler `description`; ajustar guard de "sem foto" para `photos.length===0 && !description`; repassar `description` ao `analyzeEntry`.
- [x] `src/routes/entries.ts` -- `POST /entries/manual` (multipart) conforme Code Map; validações 400/401; INSERT com `created_at` explícito quando informado; análise síncrona; 201 com a view.
- [x] `web/src/api.ts` -- `createManualEntry()` com `FormData`.
- [x] `web/src/App.tsx` + `web/src/styles.css` -- botão + formulário de novo registro; integra `createManualEntry`, refetch/navegação de dia, estados busy/erro.
- [x] Verificar `npm run build` (raiz) e `cd web && npm run build`; revisão manual (sem suite de testes).

**Acceptance Criteria:**
- Given um token válido, when escrevo "2 ovos mexidos e uma fatia de pão integral", sem foto, e envio, then é criada uma entry com `foods` segregados (ovos, pão) com quantidades/pesos e macros estimados pela IA, `reviewed:false`, e o card aparece na revisão do dia.
- Given anexo foto(s) e escolho uma data/hora passada, when envio, then a foto vai ao R2 antes do INSERT, `created_at` é o escolhido, e a IA combina texto+foto.
- Given a IA estoura o timeout, when a rota responde, then retorna 201 com `analysis_status:'pending'` e a entry existe (sem 5xx); os `foods` aparecem depois via `GET /entries`.
- Given descrição vazia ou data futura, when envio, then recebo 400 e nada é persistido (nenhum upload R2).
- Given `npm run build` (raiz e web), when executado, then compila sem erros de tipo.

## Design Notes

**`created_at` manual — exceção consciente:** o project-context diz "nunca passar timestamp manualmente no INSERT". Esta feature passa `created_at` deliberadamente (o usuário escolhe a data/hora); é justificado e **não exige migration** (a coluna já tem `DEFAULT now()` e aceita valor). Quando o campo vem vazio, NÃO passar a coluna (deixa o `DEFAULT now()` agir).

**Fuso da data/hora:** o `datetime-local` é hora de parede local; o frontend envia o instante ISO (`new Date(valor).toISOString()`) — como o device está em SP, o instante fica correto. O backend valida ISO + "≤ agora"; a revisão diária já bucketiza por dia local `America/Sao_Paulo`.

**Reuso vs. correção:** `description` é um campo NOVO no job (não reusar `correction`): correção tem semântica de "verdade sobre uma análise anterior" e o worker a usa pra liberar re-análise com `ai_cycles>0`. Captura manual é análise inicial (`ai_cycles:0`); manter os conceitos separados evita acoplar os guards.

## Verification

**Commands:**
- `npm run build` (raiz) -- expected: `tsc` compila o backend sem erros.
- `cd web && npm run build` -- expected: Vite/tsc compila o SPA sem erros.
- `curl -sX POST -H "Authorization: Bearer $TOKEN" -F 'description=2 ovos mexidos e pão integral' http://localhost:3000/entries/manual` -- expected: 201 com `foods[]` segregados e macros; sem `description` → 400.

**Manual checks:**
- Com Redis + worker rodando: criar registro só-texto no web app → card aparece com alimentos/pesos/macros da IA, `reviewed:false`. Anexar foto + data passada → foto no R2, entry no dia escolhido. Forçar timeout → entry criada com `pending`, foods chegam no refresh.

## Suggested Review Order

**Orquestração da rota (entry point)**

- Comece aqui: a rota que parseia multipart, valida, sobe ao R2 antes do INSERT e roda a análise síncrona.
  [`entries.ts:346`](../../src/routes/entries.ts#L346)
- Análise síncrona: `description` (não `correction`) alimenta o job; timeout → 201 `pending`, nunca 5xx.
  [`entries.ts:462`](../../src/routes/entries.ts#L462)

**Validação de `created_at` (boundary)**

- Teto (futuro, 60s de skew) e piso (passado absurdo) — evita entry filada num dia inalcançável.
  [`entries.ts:417`](../../src/routes/entries.ts#L417)
- Piso da app (sem dados antes de 2020) — uma data anterior é typo, não backdating real.
  [`entries.ts:13`](../../src/routes/entries.ts#L13)

**Pipeline de IA (extensão mínima)**

- Injeta a descrição como verdade do que foi consumido; a IA segrega itens e estima pesos/macros.
  [`ai.ts:102`](../../src/services/ai.ts#L102)
- Instrução final adaptada às fontes presentes (foto, texto, ou ambos).
  [`ai.ts:110`](../../src/services/ai.ts#L110)
- Guard photoless só pula quando não há descrição **nem** correção — re-análise de entry só-texto funciona.
  [`analyze-entry.ts:34`](../../src/workers/analyze-entry.ts#L34)
- `description` propagada no job data, ao lado de `correction`.
  [`entry.ts:21`](../../src/queues/entry.ts#L21)

**Frontend**

- Cria a entry e leva o usuário até ela: refetch do dia atual ou troca o seletor para o dia da entry.
  [`App.tsx:326`](../../web/src/App.tsx#L326)
- Formulário; converte o `datetime-local` com offset fixo de SP (-03:00), robusto a qualquer fuso do device.
  [`App.tsx:461`](../../web/src/App.tsx#L461)
- Client `FormData` multipart (reusa `request`, que não força `Content-Type`).
  [`api.ts:93`](../../web/src/api.ts#L93)
