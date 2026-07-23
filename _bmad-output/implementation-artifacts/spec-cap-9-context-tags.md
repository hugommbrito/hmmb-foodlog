---
title: 'CAP-9 — Tags de contexto gerenciáveis, seleção com um toque e sugestão por IA'
type: 'feature'
created: '2026-06-24'
baseline_commit: '6e49d6d0f12d95cf81d321cf246d8d8f59c15a5f'
status: 'done'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/specs/spec-foodlog/data-model.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A coluna `entries.context` existe (enum fixo `casa|restaurante|trabalho|rua`) mas não há caminho de escrita nem UI — a CAP-9 nunca foi usável. O usuário pediu mais do que o SPEC original: tags **gerenciáveis** (criar/renomear/apagar), **sugestão automática pela IA** e seleção com um toque na revisão. Isso desvia conscientemente do contrato "exatamente 4 opções fixas" do SPEC-foodlog, que será atualizado.

**Approach:** Substituir o enum fixo por uma tabela `context_tags` por usuário (4 defaults semeados). `entries` referencia a tag via FK `context_tag_id` (`ON DELETE SET NULL`). Endpoints CRUD de tags + um endpoint para setar/limpar a tag de uma entry. A IA recebe os nomes das tags do usuário e sugere uma no resultado; o worker aplica a sugestão **apenas quando a entry ainda não tem tag** (nunca sobrescreve escolha do usuário). No web app: chips de um toque no card da revisão + uma aba de gestão de tags.

## Boundaries & Constraints

**Always:**
- Toda query parametrizada (`$1,$2`), acesso via `query<T>()` de `src/db/client.ts`; auth por Bearer token (cópia local do helper, como em `src/routes/audit.ts`).
- Tags são **por usuário** e isoladas por `user_id` em toda leitura/escrita; nome trimado, não-vazio, ≤ 30 chars, único por usuário **case-insensitive**.
- A sugestão da IA só preenche `context_tag_id` se ele estiver `NULL` e o nome retornado casar (case-insensitive) com uma tag existente do usuário; caso contrário, ignora (fica `NULL`). Re-análise (CAP-4) nunca sobrescreve uma tag já escolhida.
- Migration idempotente (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) — `db:migrate` re-roda todos os `.sql`.
- Atualizar SPEC, data-model e project-context para refletir o desvio (parte do escopo desta sessão).

**Ask First:**
- Apagar a coluna física `entries.context` (texto) em vez de mantê-la órfã. (Decisão registrada: **apagar** — nunca houve caminho de escrita, então está sempre `NULL`; sem perda de dados.)

**Never:**
- Não tocar no fluxo de captura (`POST /entries/photo` / WhatsApp) para seleção de contexto — seleção é só na revisão web (decisão do usuário).
- Não marcar a entry como `reviewed` ao setar/trocar a tag (é ação independente do "Aceitar").
- Sem CHECK fixo de valores de contexto no banco após esta migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Listar tags | `GET /tags`, usuário com tags | 200, `[{id,name}]` ordenado por `name` | — |
| Listar tags (vazio) | `GET /tags`, usuário sem nenhuma tag | Semeia os 4 defaults e retorna-os (auto-heal) | — |
| Criar tag | `POST /tags {name:"padaria"}` | 201, `{id,name}` | nome vazio/>30 → 400; duplicado (case-insensitive) → 409 |
| Renomear tag | `PATCH /tags/:id {name:"casa da mãe"}` | 200, `{id,name}`; entries que a usam refletem o novo nome (FK) | não-dono/inexistente → 404; duplicado → 409; nome inválido → 400 |
| Apagar tag | `DELETE /tags/:id` | 200 `{deleted:true}`; entries que a usavam ficam com `context_tag_id=NULL` | não-dono/inexistente → 404 |
| Setar contexto | `PATCH /entries/:id/context {context_tag_id}` | 200, view da entry; `reviewed` inalterado | entry não-dono → 404; tag não-dono/inexistente → 400 |
| Limpar contexto | `PATCH /entries/:id/context {context_tag_id:null}` | 200, contexto removido | — |
| IA sugere tag | worker, entry sem tag, IA retorna `context:"restaurante"` casando uma tag | `context_tag_id` setado para essa tag no mesmo commit da análise | nome não casa → fica `NULL` |
| IA sugere sobre escolha do usuário | re-análise, entry já com `context_tag_id` | sugestão da IA é ignorada | — |

</frozen-after-approval>

## Code Map

- `src/db/migrations/005_context_tags.sql` -- NOVO: cria `context_tags`, índice único `(user_id, lower(name))`, semeia 4 defaults por usuário; em `entries` dropa CHECK + coluna `context`, adiciona `context_tag_id UUID REFERENCES context_tags(id) ON DELETE SET NULL`.
- `src/types/models.ts` -- `ContextTag {id,user_id,name,created_at}`; `Entry`/`EntryAnalysisView`/`EntryWithFoods`: trocar `context` union por `context: string | null` (nome resolvido) + `context_tag_id: string | null`; `AiAnalysisResult.context: string | null`.
- `src/routes/tags.ts` -- NOVO: `GET/POST/PATCH/DELETE` de tags (auth Bearer local), validação nome, 409 em duplicado, auto-seed no GET vazio.
- `src/routes/entries.ts` -- `PATCH /entries/:id/context`; `loadEntryView` e `GET /entries` resolvem nome via `LEFT JOIN context_tags` e expõem `context` (nome) + `context_tag_id`.
- `src/services/ai.ts` -- `analyzeEntry(..., contextTags: string[])`; `aiResponseSchema` ganha `context: z.string().nullable()`; prompt instrui escolher um nome da lista fornecida ou `null`.
- `src/workers/analyze-entry.ts` -- buscar tags do usuário (`{id,name}`), passar nomes à IA; mapear `result.context` → tag id (case-insensitive) e incluir `context_tag_id` no UPDATE **apenas se a entry estava com `context_tag_id NULL`**.
- `src/app.ts` -- `app.register(tagsRoutes)`.
- `web/src/types.ts` -- `ContextTag {id,name}`; `context_tag_id` em `EntryWithFoods`/`EntryAnalysisView`.
- `web/src/api.ts` -- `fetchTags`/`createTag`/`renameTag`/`deleteTag`/`setEntryContext`.
- `web/src/App.tsx` -- chips de tag (um toque, toggle) no card de revisão; nova aba "Tags" com gestão (criar/renomear/apagar).
- `web/src/styles.css` -- estilos de chips e da tela de gestão.
- `_bmad-output/specs/spec-foodlog/SPEC.md` + `data-model.md` + `_bmad-output/project-context.md` -- refletir o desvio (tags gerenciáveis, sugestão por IA, schema de saída da IA com `context`).

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/005_context_tags.sql` -- criar tabela + índice único + seed defaults; dropar CHECK e coluna `context`; adicionar `context_tag_id` FK -- base do modelo gerenciável
- [x] `src/types/models.ts` -- atualizar tipos (ContextTag, context_tag_id, AiAnalysisResult.context) -- contrato compartilhado
- [x] `src/routes/tags.ts` + `src/app.ts` -- CRUD de tags com validação e auto-seed; registrar rota -- G3
- [x] `src/routes/entries.ts` -- `PATCH /entries/:id/context` + resolver `context`/`context_tag_id` nas leituras -- G1
- [x] `src/services/ai.ts` + `src/workers/analyze-entry.ts` -- passar tags à IA, schema/prompt, mapear sugestão sem sobrescrever -- G2
- [x] `web/src/{types.ts,api.ts}` -- tipos + funções de API de tags e de contexto -- camada web
- [x] `web/src/App.tsx` + `web/src/styles.css` -- chips de um toque no card + aba de gestão de tags -- G1/G3 UI
- [x] `_bmad-output/specs/spec-foodlog/SPEC.md` + `data-model.md` + `_bmad-output/project-context.md` -- documentar o desvio -- contrato canônico

**Acceptance Criteria:**
- Given um usuário existente após `db:migrate`, when abre a aba Tags, then vê as 4 tags default e pode criar/renomear/apagar.
- Given uma entry na revisão, when toca um chip de tag, then a tag persiste sem marcar a entry como revisada e o chip ativo reflete a escolha (toque no ativo limpa).
- Given uma tag é apagada, when ela estava em entries, then essas entries continuam existindo com contexto vazio (sem erro 500).
- Given uma foto nova analisada e o usuário ainda não escolheu contexto, when a IA identifica um cenário que casa uma tag, then a entry vem com essa tag pré-selecionada; e uma re-análise posterior não troca uma tag já escolhida pelo usuário.

## Design Notes

`entries.context_tag_id` com `ON DELETE SET NULL` torna renomear/apagar triviais (sem cascata manual nem strings órfãs). As leituras devolvem `context` (nome resolvido via JOIN) para compatibilidade de render + `context_tag_id` para o chip ativo. Auto-seed no `GET /tags` vazio cobre usuários criados manualmente após a migration.

Worker — aplicar sugestão sem clobber (resumo):
```ts
// entry.context_tag_id capturado antes da análise
let ctxId = entry.context_tag_id; // preserva escolha do usuário
if (ctxId == null && result.context) {
  const match = tags.find(t => t.name.toLowerCase() === result.context!.toLowerCase());
  if (match) ctxId = match.id;
}
// UPDATE entries SET ..., context_tag_id = $n WHERE id = $1
```

## Verification

**Commands:**
- `npm run build` -- expected: tsc sem erros (backend)
- `cd web && npm run build` -- expected: tsc + vite build sem erros (web)
- `npm run db:migrate` -- expected: aplica 005 sem erro e é idempotente ao re-rodar

**Manual checks:**
- `GET /tags` retorna 4 defaults para o usuário; `POST` duplicado → 409.
- Tocar chip na revisão persiste (recarregar mantém) e não muda `reviewed`.
- Apagar uma tag em uso: a entry continua na lista com contexto vazio.
- Foto nova: conferir se a IA pré-seleciona um contexto plausível; re-análise não troca tag já escolhida.

## Suggested Review Order

**Mudança de modelo (comece aqui)**

- Ponto de entrada: o enum fixo vira tabela gerenciável + FK `ON DELETE SET NULL`; seed idempotente.
  [`005_context_tags.sql:4`](../../src/db/migrations/005_context_tags.sql#L4)

- Tipos compartilhados: `ContextTag`, `context_tag_id`, e `context` (nome resolvido) substituem o union fixo.
  [`models.ts:11`](../../src/types/models.ts#L11)

**Tags CRUD (G3)**

- CRUD por usuário com auto-seed no GET vazio e 409 case-insensitive via índice `lower(name)`.
  [`tags.ts:54`](../../src/routes/tags.ts#L54)

**Seleção de contexto na entrada (G1)**

- Endpoint dedicado: seta/limpa a tag sem mexer em `reviewed`; valida posse da tag.
  [`entries.ts:172`](../../src/routes/entries.ts#L172)

- Leitura resolve o nome da tag via LEFT JOIN (e a lista usa `GROUP BY e.id, ct.name`).
  [`entries.ts:56`](../../src/routes/entries.ts#L56)

**Sugestão por IA (G2)**

- Worker mapeia o nome sugerido → id e só preenche slot vazio; `COALESCE` evita clobber concorrente.
  [`analyze-entry.ts:83`](../../src/workers/analyze-entry.ts#L83)

- Schema/prompt da IA ganham `context` (default null) e a lista de tags entra no prompt do usuário.
  [`ai.ts:24`](../../src/services/ai.ts#L24)

**UI web (G1/G3)**

- Chips de um toque no card (toggle limpa o ativo); estado vem de `context_tag_id`.
  [`App.tsx:438`](../../web/src/App.tsx#L438)

- Aba de gestão de tags: criar/renomear inline/apagar com confirmação.
  [`App.tsx:539`](../../web/src/App.tsx#L539)

**Contrato canônico atualizado**

- Desvio registrado no SPEC (CAP-9), data-model (ContextTag) e project-context.
  [`SPEC.md:51`](../specs/spec-foodlog/SPEC.md#L51)
