-- CAP-7a: shareable read-only links for the nutritionist.
-- The public token is a friendly SEQUENTIAL number (share_no) — its enumerability
-- is a conscious decision for personal single-user use (mitigated by expires_at +
-- revocation). Idempotent: db:migrate re-runs every .sql file on each invocation.

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_no BIGSERIAL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
