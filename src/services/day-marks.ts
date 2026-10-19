import { query } from '../db/client';
import { DayMark, DayMarkStatus } from '../types/models';

export const DAY_MARK_STATUSES: readonly DayMarkStatus[] = ['skipped', 'partial'];

export function isDayMarkStatus(v: unknown): v is DayMarkStatus {
  return typeof v === 'string' && (DAY_MARK_STATUSES as readonly string[]).includes(v);
}

// Marks within [start, end] (inclusive, 'YYYY-MM-DD') for a user, oldest first.
// `day` goes through to_char so it never shifts across the pg DATE → JS Date parse.
export function loadDayMarks(userId: string, start: string, end: string): Promise<DayMark[]> {
  return query<DayMark>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, status
     FROM day_marks
     WHERE user_id = $1 AND day BETWEEN $2::date AND $3::date
     ORDER BY day ASC`,
    [userId, start, end]
  );
}

// Local day key in America/Sao_Paulo — the same timezone every period filter uses.
function spDayKey(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(d));
}

// Entries that may feed the pattern analysis: everything NOT on a marked day.
// Both 'skipped' and 'partial' days are dropped entirely — a partial day's few
// entries would read as a light day / skipped meals, which is exactly the
// artifact the mark exists to prevent. The marks themselves are passed to the
// AI separately so it knows those dates are gaps on purpose, not fasting.
export function dropMarkedDays<T extends { created_at: Date | string }>(entries: T[], marks: DayMark[]): T[] {
  if (marks.length === 0) {
    return entries;
  }
  const marked = new Set(marks.map((m) => m.day));
  return entries.filter((e) => !marked.has(spDayKey(e.created_at)));
}

// A mark changed on `day`: any cached AI analysis whose period covers that day
// is stale. Drop the weekly-report rows and reset the share-link cache to NULL
// ("not generated yet" — the lazy contract both readers already honor) so the
// next access recomputes with the new exclusion set.
export async function invalidateAnalysesCoveringDay(userId: string, day: string): Promise<void> {
  await query(
    'DELETE FROM weekly_reports WHERE user_id = $1 AND $2::date BETWEEN period_start AND period_end',
    [userId, day]
  );
  await query(
    `UPDATE share_links SET analysis_json = NULL, analysis_generated_at = NULL
     WHERE user_id = $1 AND $2::date BETWEEN period_start AND period_end`,
    [userId, day]
  );
}
