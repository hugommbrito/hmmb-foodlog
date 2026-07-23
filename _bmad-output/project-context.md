---
project_name: 'hmmb-foodlog'
user_name: 'HugoMMBrito'
date: '2026-06-29'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'database_rules', 'external_services', 'critical_business_rules']
status: 'complete'
rule_count: 58
optimized_for_llm: true
---

# Contexto do Projeto para Agentes de IA

_Este arquivo contém regras e padrões críticos que agentes de IA devem seguir ao implementar código neste projeto. Foco em detalhes não-óbvios que os agentes podem deixar passar._

---

## Technology Stack & Versions

- **Runtime:** Node.js, module system: CommonJS (`"type": "commonjs"`)
- **Language:** TypeScript ^5.5.3 — strict mode habilitado (`"strict": true`)
- **Framework HTTP:** Fastify ^5.8.5 (v5 — breaking changes em relação à v4)
- **Banco de dados:** PostgreSQL via `pg` ^8.12.0 — pool de conexões com SSL auto-detectado
- **Object Storage:** Cloudflare R2 via `@aws-sdk/client-s3` ^3.600.0
- **WhatsApp:** Z-API (REST, sem SDK oficial) — chamado via `fetch` nativo
- **Fila/Worker:** BullMQ ^5.0.0 + IORedis ^5.0.0 — `REDIS_URL` obrigatório no env
- **IA:** `@anthropic-ai/sdk ^0.27.0` — modelo `claude-sonnet-4-6` com suporte a visão
- **Compressão de imagem:** `sharp ^0.35.2` — comprime fotos antes do envio à API
- **Validação de env:** Zod ^3.23.8
- **IDs:** UUID v4 via `uuid ^10.0.0`
- **Dev runner:** `tsx ^4.16.2` (sem compilar para dev)
- **Build:** `tsc` → `dist/` (target ES2020, CommonJS)

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
- **`AUDIT_ENABLED`:** variável opcional do tipo `string` (não boolean) no config — intencionalmente string para funcionar com Zod `safeParse`; não converter para boolean
- **Workers BullMQ:** jobs tipados com interface própria em `Worker<JobData>` — nunca usar `any` no payload do job
- **Transações pg:** usar `client.query('BEGIN')` / `COMMIT` / `ROLLBACK` com `try/finally client.release()` — padrão obrigatório para operações atômicas

## Framework-Specific Rules

### Fastify v5
- **Estrutura de app:** factory function `buildApp()` em `app.ts` — NÃO instanciar Fastify diretamente em rotas ou serviços
- **Rotas:** cada grupo de rotas é uma função `async (app: FastifyInstance): Promise<void>` registrada via `app.register()`
- **Tipagem de rotas:** usar generics do Fastify para tipar Body/Params/Query (ex.: `app.post<{ Body: WebhookPayload }>`) — Fastify v5 tem tipagem mais estrita que v4
- **Logger:** Fastify inicializado com `{ logger: true }` — usar `app.log.error()` / `app.log.info()` dentro de handlers de rota; usar `console.error()` em serviços e fora do contexto do request
- **Resposta:** sempre usar `reply.status(X).send(obj)` com `return` explícito — nunca retornar sem reply
- **Prefixo de rota:** sem prefixo global configurado — rotas usam caminhos completos (ex.: `/webhook/whatsapp`, `/health`)
- **Plugins globais:** registrar via `app.register()` em `app.ts` ANTES dos plugins de rota — ordem importa para hooks `onRequest`/`onSend`
- **Audit plugin:** `src/plugins/audit.ts` registra hooks `onRequest` (marca `auditStartedAt`) e `onSend` (captura request+response) — nunca duplicar esses hooks em rotas individuais

## Database Rules

### PostgreSQL / pg
- **Acesso:** sempre usar a função `query<T>(sql, params)` de `src/db/client.ts` — nunca instanciar Pool ou Client diretamente em rotas/serviços
- **SSL:** o pool detecta automaticamente — `ssl: false` se `localhost`, `{ rejectUnauthorized: false }` para hosts remotos (Railway); não sobrescrever isso
- **Parâmetros:** sempre usar placeholders `$1, $2, ...` — NUNCA interpolação de string em SQL
- **IDs:** UUIDs gerados pelo PostgreSQL via `gen_random_uuid()` (extensão `pgcrypto`) — não gerar IDs no Node a não ser para chaves compostas de storage (ex.: chave R2)
- **Timestamps:** coluna `created_at TIMESTAMPTZ DEFAULT now()` — nunca passar timestamp manualmente no INSERT
- **Array de fotos:** `photos TEXT[]` — passar como array JavaScript `[url1, url2]` no parâmetro pg (não serializar como JSON)
- **Migrations:** arquivos `.sql` em `src/db/migrations/` numerados sequencialmente; executar via `npm run db:migrate`
- **Migrations idempotentes:** SEMPRE usar `IF NOT EXISTS` em ALTER TABLE e CREATE TABLE — migrations podem ser re-executadas sem erro
- **Schema:** extensão `pgcrypto` deve estar habilitada — a migration 001 já faz isso com `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`
- **context_tags:** taxonomia gerenciável por usuário — `name` único por user (case-insensitive, ≤30 chars), `color` HEX `#RRGGBB` (default `'#9ca3af'`); `entries.context_tag_id` é FK `ON DELETE SET NULL`. Auto-seed de `['casa','restaurante','trabalho','rua']` no primeiro `GET /tags` se user não tiver tags. Leituras resolvem nome via `LEFT JOIN context_tags`
- **share_links:** `share_no` é BIGSERIAL UNIQUE — token sequencial intencional para uso pessoal (não multi-tenant); nunca substituir por UUID aleatório
- **Cache lazy (JSONB nullable):** `analysis_json` em `share_links` e `weekly_reports` começa NULL — popular no primeiro acesso, nunca no INSERT inicial; NULL indica "ainda não gerado"
- **Chave composta de cache:** `weekly_reports` usa índice único em `(user_id, period_start, period_end)` — permite múltiplos períodos por usuário
- **Transações para re-análise:** DELETE + INSERT de `food_items` + UPDATE de `entries` em uma transação — rollback se qualquer parte falhar; nunca atualizar parcialmente
- **Timezone invariant:** datas de período armazenadas como `DATE` (string `YYYY-MM-DD`) — NUNCA usar `new Date()` diretamente; sempre calcular em `America/Sao_Paulo` antes de converter para string

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
- **Tamanho máximo:** 5 MB por foto (`MAX_IMAGE_BYTES`) — chamar `compressForAi()` de `src/services/storage.ts` ANTES de enviar ao Claude; validar antes do upload ao R2

### Anthropic (Claude Vision + Pattern Analysis)
- **Modelo:** `claude-sonnet-4-6` — não trocar por outro sem atualizar este contexto
- **Compressão obrigatória:** chamar `compressForAi()` ANTES de enviar foto ao Claude — reduz para JPEG q80 ou redimensiona para 2048x2048 q60 se necessário
- **Wrapper de audit:** chamadas ao Claude devem usar `withOutboundAudit()` de `src/services/audit.ts` — loga timing e resultado; SEMPRE re-lança a exceção original
- **`analyzePatterns()`:** recebe `PatternEntryInput[]` — retorno requer mínimo 3 observações; função lança erro se Claude retornar menos (validação no schema Zod)
- **Sem chamadas síncronas no webhook:** toda análise de IA ocorre no worker BullMQ — NUNCA chamar Claude diretamente em handlers de rota

### BullMQ + Redis
- **Conexão:** `IORedis` via `REDIS_URL` do config — nunca instanciar conexão Redis diretamente em serviços ou rotas
- **Worker `analyze-entry` — 3 tipos de job:** (1) captura inicial: sem `correction`/`description` → análise de foto; (2) re-análise com correção do usuário: `correction` presente → IA recalcula nutrição; (3) entrada manual: `description` presente → IA segrega alimentos e estima pesos
- **Safeguard de re-análise:** se re-análise retornar zero foods E entry já tem foods — NÃO sobrescrever; logar e encerrar o job sem erro (previne perda de dados)
- **Context tag mapping:** worker mapeia nome sugerido pela IA para `context_tag_id` apenas se entry ainda não tem tag — nunca sobrescrever tag escolhida pelo usuário

## Critical Business Rules & Anti-Patterns

### Webhook Z-API — Regras Invioláveis
- **SEMPRE retornar HTTP 200** para o Z-API, em qualquer cenário — inclusive erros internos; retornos != 200 disparam retries automáticos do Z-API
- **Usuários não cadastrados:** ignorar silenciosamente — zero resposta ao WhatsApp, zero persistência no banco
- **Uma foto = uma Entry** — cada mensagem WhatsApp com imagem cria uma Entry independente, mesmo que o usuário envie múltiplas fotos em sequência
- **Confirmação obrigatória:** enviar `'📸 Foto recebida!'` ao usuário após persistir com sucesso; nunca enviar antes da foto estar salva

### Modelo de Dados — Invariantes
- **Entry recém-criada:** sempre com `reviewed: false`, `ai_confidence_overall: 0.0`, `ai_cycles: 0` — nunca criar Entry com valores de IA preenchidos
- **`food_items`:** tabela vazia para novas entries — preenchida apenas pelo worker BullMQ; nunca inserir `food_items` manualmente no fluxo de captura
- **`photos` é array:** mesmo com uma única foto, armazenar como `[url]` — o tipo é `TEXT[]` no Postgres

### Share Links — Regras de Negócio
- **Token = share_no (BIGSERIAL):** intencional e enumerável — não é segredo de segurança; é token de conveniência para uso pessoal
- **Expiração validada no acesso:** retornar HTTP 410 Gone se `expires_at < now()` — nunca retornar dados de link expirado
- **Endpoints públicos** `/shared/:token` e `/shared/:token/patterns`: sem autenticação Bearer — autenticar apenas pelo token na URL
- **Insuficiência de dados:** retornar `{ insufficient: true }` se menos de 3 dias de entrada no período — nunca forçar análise com dados insuficientes

### Weekly Reports — Regras de Negócio
- **Cache diário:** reutilizar relatório se `generated_at >= hoje` para o mesmo `(user_id, period_start, period_end)` — query param `force=true` bypassa o cache
- **Período padrão:** 7 dias rolling em `America/Sao_Paulo` — calcular no servidor
- **`start_date` e `end_date`:** ambos obrigatórios se um for fornecido — nunca aceitar apenas um dos dois

### Audit — Anti-Padrões
- **Fire-and-forget obrigatório:** `logInbound()` e `logOutbound()` NUNCA são awaited no fluxo principal — falha no log não pode bloquear a resposta
- **Redação de segredos:** NUNCA persistir `ZAPI_TOKEN`, `ANTHROPIC_API_KEY`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL` em `request_logs` — usar `scrubSecrets()` de `src/services/audit.ts`
- **Loop de auditoria:** rotas `/audit/*` são excluídas do `onSend` hook — manter essa exclusão ao adicionar novas rotas de infra

### Organização de Código
- **Serviços:** lógica de integração externa fica em `src/services/` — nunca colocar chamadas a APIs externas diretamente em rotas
- **Plugins Fastify:** lógica de hooks globais em `src/plugins/` — não embutir hooks diretamente em `app.ts`
- **Tipos:** todas as interfaces TypeScript em `src/types/models.ts` — sem tipos inline em arquivos de rota
- **Config:** adicionar novas variáveis de ambiente sempre no schema Zod de `src/config.ts` E no `.env.example`
- **Sem testes ainda:** o projeto não tem suite de testes configurada — ao adicionar testes, criar `jest.config.ts` ou `vitest.config.ts` antes de qualquer arquivo `.test.ts`
- **Git:** commits diretos na branch `main` — sem feature branches; nunca fazer push sem solicitação explícita do usuário

### Escopo — O que NÃO implementar neste projeto
- **Autenticação de usuário:** sem login, senha, OAuth ou sessão exposta — autenticação é por número de telefone no banco
- **UI:** sem frontend nesta fase

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

_Última atualização: 2026-06-29_
