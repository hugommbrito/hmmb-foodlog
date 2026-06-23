-- Auditabilidade: registro persistente de toda requisição HTTP recebida (inbound).
-- Idempotente — o runner reaplica todas as migrations a cada execução.
CREATE TABLE IF NOT EXISTS request_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  query           TEXT,
  status_code     INTEGER,
  duration_ms     INTEGER,
  request_headers JSONB,
  request_body    TEXT,
  response_body   TEXT,
  remote_ip       TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs (created_at DESC);
