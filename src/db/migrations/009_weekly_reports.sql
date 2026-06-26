-- CAP-6: relatório semanal de padrões comportamentais (lazy + cache).
-- Uma row por usuário (UNIQUE user_id): upsert no generate, re-upsert no próximo
-- dia. Cache válido quando period_end = hoje SP e generated_at >= início do dia SP.
-- Idempotente: db:migrate re-roda cada .sql a cada invocação.

CREATE TABLE IF NOT EXISTS weekly_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start   DATE        NOT NULL,
  period_end     DATE        NOT NULL,
  analysis_json  JSONB       NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_user_id_idx
  ON weekly_reports (user_id);
