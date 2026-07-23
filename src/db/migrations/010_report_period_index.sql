-- Drop old unique index (one cached row per user, regardless of period).
-- The new composite index allows caching different date ranges per user.
DROP INDEX IF EXISTS weekly_reports_user_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_user_period_idx ON weekly_reports (user_id, period_start, period_end);
