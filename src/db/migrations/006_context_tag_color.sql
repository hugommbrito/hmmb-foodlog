-- CAP-9 follow-up: each context tag gets a HEX color (#RRGGBB) for the review UI
-- (colored badge on cards + filter segment). Idempotent: db:migrate re-runs every
-- .sql file on each invocation.
--
-- The four seeded defaults are intentionally NOT auto-colored here: a re-run would
-- clobber a user's chosen color back to a preset. They start neutral; the user picks
-- colors via the native color picker in the Tags tab.
ALTER TABLE context_tags
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#9ca3af';
