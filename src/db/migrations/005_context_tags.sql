-- CAP-9: context tags become a user-managed taxonomy (replaces the fixed enum).
-- Idempotent: db:migrate re-runs every .sql file on each invocation.

CREATE TABLE IF NOT EXISTS context_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique per user, case-insensitive ("Casa" and "casa" collide).
CREATE UNIQUE INDEX IF NOT EXISTS idx_context_tags_user_name
  ON context_tags (user_id, lower(name));

-- Seed the four historical defaults for every existing user. ON CONFLICT keeps
-- this idempotent across re-runs.
INSERT INTO context_tags (user_id, name)
SELECT u.id, t.name
FROM users u
CROSS JOIN (VALUES ('casa'), ('restaurante'), ('trabalho'), ('rua')) AS t(name)
ON CONFLICT DO NOTHING;

-- entries: drop the old fixed-enum CHECK + text column, reference a tag instead.
-- The column was never written (no write path existed) so it is always NULL —
-- nothing is lost. ON DELETE SET NULL makes tag deletion safe for entries.
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_context_check;
ALTER TABLE entries DROP COLUMN IF EXISTS context;
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS context_tag_id UUID REFERENCES context_tags(id) ON DELETE SET NULL;
