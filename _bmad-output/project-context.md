---
project_name: 'hmmb-foodlog'
user_name: 'HugoMMBrito'
date: '2026-06-16'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'database_rules', 'external_services', 'critical_business_rules']
status: 'complete'
rule_count: 38
optimized_for_llm: true
---

# Contexto do Projeto para Agentes de IA

_Este arquivo contém regras e padrões críticos que agentes de IA devem seguir ao implementar código neste projeto. Foco em detalhes não-óbvios que os agentes podem deixar passar._

---

## Technology Stack & Versions

- **Runtime:** Node.js, module system: CommonJS (`"type": "commonjs"`)
- **Language:** TypeScript ^5.5.3 — strict mode habilitado (`"strict": true`)
- **Framework HTTP:** Fastify ^4.28.1
- **Banco de dados:** PostgreSQL via `pg` ^8.12.0 — pool de conexões com SSL auto-detectado
- **Object Storage:** Cloudflare R2 via `@aws-sdk/client-s3` ^3.600.0
- **WhatsApp:** Z-API (REST, sem SDK oficial) — chamado via `fetch` nativo
- **Validação de env:** Zod ^3.23.8
- **IDs:** UUID v4 via `uuid` ^10.0.0
- **Dev runner:** `tsx` ^4.16.2 (sem compilar para dev)
- **Build:** `tsc` → `dist/` (target ES2020, CommonJS)
- **Pendente (Spec B):** BullMQ + Redis (REDIS_URL já reservado no .env), Claude claude-sonnet-4-6 com visão

## Language-Specific Rules

### TypeScript
- **Strict mode obrigatório** — `"strict": true` no tsconfig; nenhuma exceção
- **Imports:** sempre relativos com extensão omitida (ex.: `'../config'`, não `'../config.ts'` nem `'../config.js'`)
- **CommonJS:** usar `import/export` ESM no fonte (TypeScript faz a transpilação); NÃO usar `require()`
- **Tipagem de generics:** a função `query<T>()` usa `T extends QueryResultRow` — sempre tipar o retorno explicitamente (ex.: `query<User>(...)`)
- **Null-safety:** preferir retorno `null` explícito a `undefined` para ausência de valor (padrão do código existente)
- **Error handling em catch:** cast explícito `(err as Error).name` ou `(err as Error).message` — sem `any` implícito
- **Env vars:** NUNCA acessar `process.env.VARIAVEL` diretamente — sempre importar do `config.ts` que já valida e tipifica via Zod
- **Dotenv:** `import 'dotenv/config'` somente no `config.ts` — não importar em outros módulos

## Framework-Specific Rules

### Fastify
- **Estrutura de app:** factory function `buildApp()` em `app.ts` — NÃO instanciar Fastify diretamente em rotas ou serviços
- **Rotas:** cada grupo de rotas é uma função `async (app: FastifyInstance): Promise<void>` registrada via `app.register()`
- **Tipagem de rotas:** usar generics do Fastify para tipar Body/Params/Query (ex.: `app.post<{ Body: WebhookPayload }>`)
- **Logger:** Fastify inicializado com `{ logger: true }` — usar `app.log.error()` / `app.log.info()` dentro de handlers de rota; usar `console.error()` em serviços e fora do contexto do request
- **Resposta:** sempre usar `reply.status(X).send(obj)` com `return` explícito — nunca retornar sem reply
- **Prefixo de rota:** sem prefixo global configurado — rotas usam caminhos completos (ex.: `/webhook/whatsapp`, `/health`)
- **Plugin sem prefixo:** `app.register()` sem opções de prefixo — adicionar prefixo dentro da própria função de rota se necessário

## Database Rules

### PostgreSQL / pg
- **Acesso:** sempre usar a função `query<T>(sql, params)` de `src/db/client.ts` — nunca instanciar Pool ou Client diretamente em rotas/serviços
- **SSL:** o pool detecta automaticamente — `ssl: false` se `localhost`, `{ rejectUnauthorized: false }` para hosts remotos (Railway); não sobrescrever isso
- **Parâmetros:** sempre usar placeholders `$1, $2, ...` — NUNCA interpolação de string em SQL
- **IDs:** UUIDs gerados pelo PostgreSQL via `gen_random_uuid()` (extensão `pgcrypto`) — não gerar IDs no Node a não ser para chaves compostas de storage (ex.: chave R2)
- **Timestamps:** coluna `created_at TIMESTAMPTZ DEFAULT now()` — nunca passar timestamp manualmente no INSERT
- **Array de fotos:** `photos TEXT[]` — passar como array JavaScript `[url1, url2]` no parâmetro pg (não serializar como JSON)
- **Migrations:** arquivos `.sql` em `src/db/migrations/` numerados sequencialmente; executar via `npm run db:migrate`
- **Schema:** extensão `pgcrypto` deve estar habilitada — a migration 001 já faz isso com `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`
- **Contexto da entrada (CAP-9):** `entries.context_tag_id` é FK para `context_tags` (`ON DELETE SET NULL`) — taxonomia gerenciável por usuário, NÃO mais um enum fixo. Nomes únicos por usuário (case-insensitive), ≤ 30 chars. Leituras resolvem o nome via `LEFT JOIN context_tags`. A migration 005 dropou a coluna `context`/CHECK antigos

## External Services Rules

### Z-API (WhatsApp)
- **Autenticação:** URL da API segue o padrão `https://api.z-api.io/instances/{ZAPI_INSTANCE}/token/{ZAPI_TOKEN}/{endpoint}` — sempre construir a partir das vars de config, nunca hardcoded
- **Segredo do webhook:** header `client-token` (minúsculas) — validar contra `ZAPI_WEBHOOK_SECRET` quando presente
- **Payload de imagem:** a foto vem em `payload.image.imageUrl` — verificar `payload.image` antes de acessar `.imageUrl`
- **Campo `fromMe`:** ignorar silenciosamente mensagens onde `fromMe === true` — são mensagens enviadas pelo próprio bot
- **Timeout:** todas as chamadas HTTP externas usam `AbortController` com 8000ms (`FETCH_TIMEOUT_MS`) — manter esse padrão em novos serviços
- **Fire-and-forget:** `sendTextMessage()` não lança exceção — erros são apenas logados; o webhook já respondeu 200 antes dessa chamada

### Cloudflare R2
- **Client:** S3Client com `region: 'auto'` e endpoint `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- **Chave de objeto:** formato `photos/{user_id}/{timestamp}-{uuidv4}` — manter esse padrão para novas categorias de upload
- **URL pública:** concatenar `R2_PUBLIC_URL` (sem barra final) + `/` + key — nunca construir URL via SDK
- **Ordem crítica:** upload R2 ANTES do INSERT no banco — se o R2 falhar, nada é persistido; se o INSERT falhar após o upload, a foto fica órfã no R2 (aceitável, não reverter o upload)
- **Tamanho máximo:** 20 MB por foto (`MAX_PHOTO_BYTES`) — validar antes do upload

## Critical Business Rules & Anti-Patterns

### Webhook Z-API — Regras Invioláveis
- **SEMPRE retornar HTTP 200** para o Z-API, em qualquer cenário — inclusive erros internos; retornos != 200 disparam retries automáticos do Z-API
- **Usuários não cadastrados:** ignorar silenciosamente — zero resposta ao WhatsApp, zero persistência no banco
- **Uma foto = uma Entry** — cada mensagem WhatsApp com imagem cria uma Entry independente, mesmo que o usuário envie múltiplas fotos em sequência
- **Confirmação obrigatória:** enviar `'📸 Foto recebida!'` ao usuário após persistir com sucesso; nunca enviar antes da foto estar salva

### Modelo de Dados — Invariantes
- **Entry recém-criada:** sempre com `reviewed: false`, `ai_confidence_overall: 0.0`, `ai_cycles: 0` — nunca criar Entry com valores de IA preenchidos
- **`food_items`:** tabela vazia para novas entries — preenchida apenas pela Spec B (pipeline de IA); nunca inserir `food_items` manualmente no fluxo de captura
- **`photos` é array:** mesmo com uma única foto, armazenar como `[url]` — o tipo é `TEXT[]` no Postgres

### Escopo — O que NÃO implementar neste projeto (diferido)
- **Autenticação de usuário:** sem login, senha, OAuth ou sessão exposta — autenticação é por número de telefone no banco
- **Análise de IA inline:** nenhuma chamada ao Claude no fluxo síncrono do webhook — é Spec B (assíncrono via fila)
- **UI:** sem frontend nesta fase
- **Estrutura de refeição obrigatória:** sem campo `meal_type` (café/almoço/jantar) — a captura é livre

### Organização de Código
- **Serviços:** lógica de integração externa fica em `src/services/` — nunca colocar chamadas a APIs externas diretamente em rotas
- **Tipos:** todas as interfaces TypeScript em `src/types/models.ts` — sem tipos inline em arquivos de rota
- **Config:** adicionar novas variáveis de ambiente sempre no schema Zod de `src/config.ts` E no `.env.example`
- **Sem testes ainda:** o projeto não tem suite de testes configurada — ao adicionar testes, criar `jest.config.ts` ou `vitest.config.ts` antes

---

## Usage Guidelines

**Para agentes de IA:**
- Ler este arquivo antes de implementar qualquer código
- Seguir TODAS as regras exatamente como documentadas
- Em caso de dúvida, preferir a opção mais restritiva
- Propor atualização deste arquivo se novos padrões emergirem

**Para humanos:**
- Manter este arquivo enxuto e focado nas necessidades dos agentes
- Atualizar quando a stack tecnológica mudar
- Revisar periodicamente para remover regras que se tornaram óbvias

_Última atualização: 2026-06-16_
