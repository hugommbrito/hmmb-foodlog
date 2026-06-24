-- Auditabilidade OUTBOUND: distingue requisições recebidas (inbound) das
-- chamadas a serviços externos (outbound) na mesma tabela request_logs.
-- Idempotente — o runner reaplica todas as migrations a cada execução.
-- Rows pré-existentes (todas inbound) recebem o default 'inbound'.
ALTER TABLE request_logs
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound';

CREATE INDEX IF NOT EXISTS idx_request_logs_direction_created_at
  ON request_logs (direction, created_at DESC);
