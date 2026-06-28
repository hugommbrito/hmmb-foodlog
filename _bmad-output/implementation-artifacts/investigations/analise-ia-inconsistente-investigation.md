# Investigation: Análise de IA Inconsistente (iPhone Shortcuts + Re-análise)

## Hand-off Brief

1. **O que aconteceu.** A análise de IA falha ou retorna vazio intermitentemente no fluxo de `POST /entries/photo`; dois mecanismos distintos foram identificados: (a) iPhone envia HEIC → bytes são enviados à Anthropic mislabelados como JPEG → falha silenciosa; (b) fotos iPhone > 5 MB passam no upload (limite 20 MB) mas são rejeitadas ao buscar do R2 para a API de IA (limite 5 MB) → job falha permanentemente.
2. **Onde o caso está.** Causa-raiz de dois defeitos de código confirmada por leitura estática; um terceiro defeito de lógica na guard de re-análise cria o comportamento "re-análise também não funciona".
3. **O que é necessário a seguir.** Implementar três correções cirúrgicas: validar/rejeitar HEIC no upload; alinhar o limite de tamanho do upload com o limite da IA; corrigir a guard do worker e permitir retry sem correção quando `ai_cycles = 0`.

## Case Info

| Field            | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Ticket           | N/A                                                                   |
| Date opened      | 2026-06-28                                                            |
| Status           | Concluded — evidence updated 2026-06-28                               |
| System           | Node.js / TypeScript / BullMQ / Anthropic SDK; produção Railway       |
| Evidence sources | Código-fonte (`src/services/ai.ts`, `src/workers/analyze-entry.ts`, `src/routes/entries.ts`, `src/app.ts`) |

## Problem Statement

Usuário reporta: análise de IA retorna vazio intermitentemente, especialmente pelo fluxo de iPhone Shortcuts (que chama `POST /entries/photo`). Após uma falha inicial, tentar re-analisar (`POST /entries/:id/reanalyze`) também não produz resultado.

## Evidence Inventory

| Source                                    | Status    | Notes                                                         |
| ----------------------------------------- | --------- | ------------------------------------------------------------- |
| `src/services/ai.ts`                      | Available | Define `ALLOWED_MEDIA_TYPES` e `MAX_IMAGE_BYTES`              |
| `src/workers/analyze-entry.ts`            | Available | Guard de re-análise (linha 72); guard de duplicata (linha 23) |
| `src/routes/entries.ts`                   | Available | Upload, enqueue, reanalyze endpoint; `buildCorrection`        |
| `src/app.ts`                              | Available | `MAX_PHOTO_BYTES = 20 MB` no plugin multipart                 |
| Logs de produção / audit trail            | Missing   | Confirmaria qual modo de falha ocorre com mais frequência     |
| Shortcut iOS exportada (`.shortcut` file) | Missing   | Confirmaria se envia HEIC ou JPEG                             |

## Investigation Backlog

| #  | Path to Explore                                         | Priority | Status | Notes                                                              |
| -- | ------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------ |
| 1  | Verificar R2 content-type dos objetos orphan recentes   | High     | Open   | Confirma/refuta hipótese HEIC com evidência direta de produção     |
| 2  | Verificar `request_logs` para `path LIKE '/entries/photo'` com status recente | High | Open | Mostra se jobs falham na análise ou na validação de tamanho |
| 3  | Testar Shortcut com configuração "Converter para JPEG" | Medium   | Open   | Workaround imediato e confirma H1                                   |
| 4  | Adicionar log do content-type no worker antes de chamar analyzeEntry | Low | Open | Telemetria para confirmar H1 em produção                  |

## Timeline of Events

| Time          | Event                                                                          | Source                       | Confidence |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------- | ---------- |
| Upload        | iPhone envia foto via Shortcut → `POST /entries/photo`                         | `src/routes/entries.ts:305`  | Confirmed  |
| Upload        | Validação aceita qualquer `image/*` (inclui `image/heic`)                      | `src/routes/entries.ts:305`  | Confirmed  |
| Upload R2     | Foto salva no R2 com `ContentType: image/heic`                                 | `src/services/storage.ts:19` | Deduced    |
| Job enqueued  | Worker busca foto do R2 via `fetchImageAsBase64()`                             | `src/services/ai.ts:72`      | Confirmed  |
| Job enqueued  | content-type não está em ALLOWED_MEDIA_TYPES → fallback para `image/jpeg`      | `src/services/ai.ts:88-91`   | Confirmed  |
| Anthropic API | Recebe bytes HEIC labolados como JPEG → retorna erro ou foods:[]               | `src/services/ai.ts:155-165` | Deduced    |
| Job failed    | 3 tentativas com mesmo resultado → job permanentemente falho, ai_cycles=0      | `src/queues/entry.ts:23-27`  | Deduced    |
| Re-análise    | Usuário chama reanalyze → correction obrigatório → mesmo HEIC buscado → falha  | `src/routes/entries.ts:565`  | Deduced    |

## Confirmed Findings

### Finding 1: ALLOWED_MEDIA_TYPES exclui HEIC mas upload aceita qualquer `image/*`

**Evidence:** `src/services/ai.ts:42` — `const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']`; `src/routes/entries.ts:305` — `if (!part.mimetype.startsWith('image/'))`.

**Detail:** HEIC (`image/heic`) passa na validação do upload mas não está na lista suportada pela Anthropic. O fallback em `src/services/ai.ts:89-91` troca o content-type para `image/jpeg` SEM converter os bytes — a API recebe conteúdo HEIC com cabeçalho JPEG.

### Finding 2: Limite de upload (20 MB) maior que o limite da IA (5 MB)

**Evidence:** `src/app.ts:14` — `MAX_PHOTO_BYTES = 20 * 1024 * 1024`; `src/services/ai.ts:45` — `MAX_IMAGE_BYTES = 5 * 1024 * 1024`.

**Detail:** Fotos iPhone de alta resolução (10–15 MB) passam na etapa de upload/R2 sem erro. O worker falha depois ao bufferizar em `fetchImageAsBase64` (`src/services/ai.ts:84-86`), com `Error: [ai] Image too large for Anthropic API`. BullMQ re-tenta 3× (backoff exponencial), todas falham, job permanentemente falho.

### Finding 3: Worker guard impede re-análise quando análise anterior também era vazia

**Evidence:** `src/workers/analyze-entry.ts:72-75` — `if (correction && result.foods.length === 0) { return; }`.

**Detail:** Quando a análise inicial gravou `ai_cycles = 1` com `foods = []`, e a re-análise com correção TAMBÉM retorna `foods = []`, o guard dispara para "preservar análise anterior" — mas a análise anterior já era vazia. `ai_cycles` não avança. A route detecta `view.ai_cycles === priorCycles` e reporta `analysis_status: 'pending'`. Na próxima requisição GET, `ai_cycles = 1 > 0` → `analysis_status = 'done'` com 0 foods. Loop permanente.

### Finding 4: Re-análise exige `correction` mesmo quando ai_cycles = 0

**Evidence:** `src/routes/entries.ts:565-567` — `const correction = buildCorrection(request.body); if (!correction) { return reply.status(400)... }`.

**Detail:** Quando o job inicial falhou permanentemente (`ai_cycles = 0`), o único caminho para re-tentar é via `POST /entries/:id/reanalyze` com um body de correção. Sem body → 400. Com body de correção → o mesmo HEIC/arquivo grande é buscado do R2 → falha novamente. Não há caminho para recuperação quando a falha é de formato de imagem.

## Deduced Conclusions

### Deduction 1: "Especialmente pelo fluxo de iPhone Shortcuts" aponta para HEIC

**Based on:** Finding 1, Finding 2

**Reasoning:** iPhones salvam fotos em HEIC por padrão desde iOS 11. Outros fluxos (WhatsApp webhook, web app) tendem a processar JPEG (WhatsApp converte; web app usa `<input type="file">` que tipicamente serve JPEG ou PNG). O iPhone Shortcuts, ao enviar diretamente do Photo Library sem conversão explícita, envia HEIC. Isso explica por que o bug é "especialmente" nesse fluxo e não em todos.

**Conclusion:** O conjunto `ALLOWED_MEDIA_TYPES` é o orign da falha específica ao iPhone. O limite 20 MB vs 5 MB é uma falha secundária que afeta qualquer fluxo com fotos grandes.

### Deduction 2: "Re-análise também não funciona" tem duas causas independentes

**Based on:** Finding 3, Finding 4

**Reasoning:** (a) Quando `ai_cycles = 0` (job falhou), a re-análise exige correção e o mesmo arquivo problemático é buscado do R2 — impossível ter sucesso sem converter/substituir a imagem. (b) Quando `ai_cycles = 1, foods = []`, o guard do worker bloqueia o ciclo mesmo com correção válida se a IA voltar a retornar vazio, criando o loop done↔pending.

**Conclusion:** Re-análise não é um caminho de recuperação confiável quando a causa-raiz é o formato ou tamanho da imagem em R2.

## Hypothesized Paths

### Hypothesis 1: HEIC é o vetor principal no fluxo iPhone Shortcuts

**Status:** Refuted

**Theory:** A maioria dos casos de análise vazia via iPhone Shortcuts é causada por HEIC, não por fotos grandes ou inconsistência do modelo.

**Supporting indicators:** Finding 1 (falha de formato), Deduction 1 (iPhone default HEIC)

**Would confirm:** R2 objects com `Content-Type: image/heic` ou `image/heif` em fotos recentes de usuário iPhone; ou `request_logs` mostrando jobs falhos para entradas com fotos iPhone.

**Would refute:** Fotos iPhone no R2 com `Content-Type: image/jpeg` (Shortcut converte automaticamente).

**Resolution:** Usuário verificou o R2: todos os objetos têm `Content-Type: image/jpeg`. O iPhone Shortcut converte para JPEG antes do upload. Hipótese refutada. A causa real é tamanho (Finding 2): fotos de 5.87–7.63 MB (confirmado em produção), todas acima do limite de 5 MB da IA.

### Hypothesis 2: Inconsistência do modelo Anthropic (foods: [] legítimo) contribui minoritariamente

**Status:** Open

**Theory:** Em alguns casos a foto é JPEG válida e pequena, mas o Claude retorna `foods: []` (confiança baixa, foto ambígua, lighting ruim). Isso seria um resultado legítimo, não um bug.

**Supporting indicators:** O worker permite `foods: []` na captura inicial (`src/workers/analyze-entry.ts:69-75` aplica a guard apenas quando `correction` está presente).

**Would confirm:** Casos onde o content-type no R2 é JPEG E foto < 5 MB mas análise retornou vazio.

**Would refute:** Todo caso de vazio corresponde a HEIC ou foto > 5 MB.

**Resolution:** —

## Missing Evidence

| Gap                                          | Impact                                                                | How to Obtain                                             |
| -------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| Content-type real dos objetos R2 de fotos    | Confirma H1 (HEIC) vs H2 (inconsistência modelo)                     | `aws s3api head-object --bucket X --key photos/...`       |
| Mensagens de erro dos jobs BullMQ falhos     | Distingue "Image too large" de falha de API de "HEIC decode error"   | `request_logs` com `path='anthropic'` + `status_code=502` |
| Definição do Shortcut iOS (arquivo .shortcut)| Confirma se envia HEIC ou converte para JPEG antes de enviar          | Usuário exporta e compartilha o Shortcut                  |

## Source Code Trace

| Element       | Detail                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| Error origin  | `src/services/ai.ts:80-86` — `fetchImageAsBase64` — size guard E content-type fallback |
| Trigger       | Worker busca foto do R2 para enviar à Anthropic API                                 |
| Condition     | (A) content-type não está em ALLOWED_MEDIA_TYPES → bytes HEIC enviados como JPEG; (B) buffer > 5 MB após download |
| Related files | `src/workers/analyze-entry.ts:72-75` (guard re-análise); `src/routes/entries.ts:563-590` (reanalyze route); `src/app.ts:14` (upload limit 20 MB) |

## Conclusion

**Confidence:** High (causa-raiz identificada por leitura estática; cenário HEIC deduzido; necessita confirmação de content-type em produção)

Três defeitos independentes combinam-se para o comportamento observado:

1. **HEIC silencioso (Confirmed por leitura, Deduced por produção):** Upload aceita `image/heic`; AI service manda bytes HEIC rotulados como JPEG para a Anthropic → falha/vazio. Explica especificidade do iPhone Shortcuts.

2. **Mismatch de limite de tamanho (Confirmed):** Upload limite 20 MB vs AI limite 5 MB → fotos iPhone grandes causam falha permanente do job sem feedback ao usuário.

3. **Guard de re-análise e ausência de retry simples (Confirmed):** `if (correction && result.foods.length === 0) { return; }` impede overwrite de vazio-com-vazio; re-análise exige `correction` quando `ai_cycles = 0`; ambos criam estados irrecuperáveis sem intervenção manual.

## Recommended Next Steps

### Fix direction

**Fix 1 — Rejeitar HEIC no upload (alta prioridade, elimina bug principal):**
Em `src/routes/entries.ts` (linhas 304-313 e equivalente manual entry), trocar o check de `mimetype.startsWith('image/')` para validar apenas os tipos aceitos pela Anthropic:
```
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
if (!ACCEPTED_PHOTO_TYPES.includes(part.mimetype.toLowerCase())) {
  validationError = `Unsupported image type: ${part.mimetype}. Use JPEG, PNG, GIF ou WebP.`;
}
```

**Fix 2 — Alinhar limite de upload com limite da IA (alta prioridade):**
Em `src/app.ts:14`, trocar `MAX_PHOTO_BYTES = 20 MB` para `5 MB` (ou extrair como constante compartilhada com `src/services/ai.ts:45`). Alternativa: validar o tamanho do buffer depois do `toBuffer()` antes de fazer upload ao R2, retornando 413 imediatamente.

**Fix 3 — Corrigir guard de re-análise no worker (média prioridade):**
Em `src/workers/analyze-entry.ts:72-75`, adicionar condição para verificar se há foods existentes antes de bail:
```ts
const existingFoods = await query<{count: string}>('SELECT COUNT(*) AS count FROM food_items WHERE entry_id = $1', [entryId]);
if (correction && result.foods.length === 0 && Number(existingFoods[0].count) > 0) {
  console.warn(`[worker] Re-analysis returned no foods; keeping previous analysis`);
  return;
}
```

**Fix 4 — Permitir retry sem correção quando ai_cycles = 0 (média prioridade):**
Em `src/routes/entries.ts:565-567`, remover o guard de 400 quando `priorCycles === 0`:
```ts
const correction = buildCorrection(request.body);
if (!correction && priorCycles > 0) {
  return reply.status(400).send({ error: 'Nothing to correct...' });
}
```
No worker, garantir que `ai_cycles === 0 && !correction` também permite execução (já está correto pela guard existente em linha 23: `ai_cycles > 0 && !correction`).

### Diagnostic

Para confirmar antes de implementar os fixes:
1. Verificar content-type de alguns objetos R2 de fotos recentes (identificar se há `image/heic`).
2. Procurar em `request_logs` por chamadas à Anthropic com `response_body` contendo erro de decode ou `foods:[]` consecutivos.
3. Exportar o Shortcut iOS e verificar se usa "Get Photos" (HEIC) ou converte para JPEG explicitamente.

## Reproduction Plan

**Para HEIC (H1):**
1. iPhone → Configurações → Câmera → Formato → "Alta Eficiência" (HEIC ativo por padrão).
2. Criar um Shortcut que leia uma foto da biblioteca e faça `POST /entries/photo` com ela como multipart.
3. Observar: entry criada com `ai_cycles = 0` (job falhou) ou `ai_cycles = 1, foods = []`.

**Para tamanho (Finding 2):**
1. Fotografar em modo ProRAW ou usar foto existente > 5 MB.
2. Fazer upload via `curl` com multipart.
3. Observar `[ai] Image too large` nos logs do worker.

**Para guard de re-análise (Finding 3):**
1. Criar manualmente uma entry com `ai_cycles = 1, foods = []` no banco.
2. Chamar `POST /entries/:id/reanalyze` com qualquer `correction`.
3. Mock ou aguardar resposta de AI com `foods: []`.
4. Observar: `ai_cycles` permanece 1, resposta da route é `analysis_status: 'pending'`.

## Side Findings

- **Evidência de robustez já implementada:** O guard na linha 72 do worker foi adicionado intencionalmente (commit `9221862`) para proteger análises válidas de serem apagadas por re-análises que retornam vazio — a intenção é correta, apenas precisa de uma condição de guarda adicional.
- **Webhook flow (WhatsApp) não é afetado por HEIC:** WhatsApp converte fotos para JPEG antes de entregar via Z-API (`imageUrl` é sempre JPEG), então o fluxo WhatsApp não sofre do bug H1.
- **`ANALYSIS_WAIT_TIMEOUT_MS = 100 s` pode causar timeout em fotos grandes:** A análise demora mais para fotos grandes (download + encode + Anthropic latency), mas isso é secundário — a falha ocorre antes, no download R2.
