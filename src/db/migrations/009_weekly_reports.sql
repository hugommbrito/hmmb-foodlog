-- CAP-6: relatório semanal de padrões comportamentais (lazy + cache).
-- Cache por (user_id, period_start, period_end) — índice gerenciado pela 010.
-- Idempotente: db:migrate re-roda cada .sql a cada invocação.

CREATE TABLE IF NOT EXISTS weekly_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start   DATE        NOT NULL,
  period_end     DATE        NOT NULL,
  analysis_json  JSONB       NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
