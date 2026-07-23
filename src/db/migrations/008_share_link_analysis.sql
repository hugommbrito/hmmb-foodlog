-- CAP-7b: cache da análise de padrões por IA na view do nutricionista.
-- A análise é cara (chamada ao Claude) e o endpoint /shared/:token/patterns é
-- público sem auth — então computa-se uma vez (1º acesso) e serve-se do cache.
-- Idempotente: db:migrate re-roda cada .sql a cada invocação.

ALTER TABLE share_links ADD COLUMN IF NOT EXISTS analysis_json JSONB;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS analysis_generated_at TIMESTAMPTZ;
