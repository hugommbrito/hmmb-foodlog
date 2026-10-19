import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { invalidateAnalysesCoveringDay, isDayMarkStatus, loadDayMarks } from '../services/day-marks';
import { DayMark, DayMarkStatus, User } from '../types/models';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Upper bound for GET /days ranges — a year plus slack; the dashboard asks for ≤90.
const MAX_RANGE_DAYS = 400;

// Minimal local copy of the Bearer-token auth (same convention as routes/tags.ts).
async function authenticate(request: FastifyRequest): Promise<string | null> {
  const header = request.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1].trim();
  if (token.length === 0) {
    return null;
  }
  const users = await query<User>('SELECT id FROM users WHERE api_token = $1', [token]);
  return users.length > 0 ? users[0].id : null;
}

// Shape + calendar validity (mirrors routes/entries.ts): '2026-02-30' passes the
// regex but is not a real date and would blow up at the ::date cast.
function isValidCalendarDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) {
    return false;
  }
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
}

// Today's local day in America/Sao_Paulo — a day that hasn't happened yet can't
// be "not filled", so marking is refused past this.
function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function daysRoutes(app: FastifyInstance): Promise<void> {
  // Marks for an inclusive date range (only marked days are returned; a day with
  // no row is a normal day). Owner-only.
  app.get<{ Querystring: { start?: string; end?: string } }>('/days', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const { start, end } = request.query;
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
      return reply.status(400).send({ error: 'start e end são obrigatórios (YYYY-MM-DD)' });
    }
    if (start > end) {
      return reply.status(400).send({ error: 'end deve ser >= start' });
    }
    if (daysBetween(start, end) > MAX_RANGE_DAYS) {
      return reply.status(400).send({ error: `Período muito longo (máx ${MAX_RANGE_DAYS} dias)` });
    }

    const marks: DayMark[] = await loadDayMarks(userId, start, end);
    return reply.status(200).send(marks);
  });

  // Set or clear a day's mark. `status: null` clears (mirrors PATCH /entries/:id/context).
  // Any cached AI analysis covering the day is invalidated when the mark actually changes.
  app.patch<{ Params: { date: string }; Body: { status?: DayMarkStatus | null } }>(
    '/days/:date',
    async (request, reply) => {
      const userId = await authenticate(request);
      if (!userId) {
        return reply.status(401).send({ error: 'Missing or invalid token' });
      }

      const { date } = request.params;
      if (!isValidCalendarDate(date)) {
        return reply.status(400).send({ error: 'Data inválida (use YYYY-MM-DD)' });
      }
      if (date > todaySP()) {
        return reply.status(400).send({ error: 'Não é possível marcar um dia futuro' });
      }

      const status = request.body?.status ?? null;
      if (status !== null && !isDayMarkStatus(status)) {
        return reply.status(400).send({ error: 'status inválido (use skipped, partial ou null)' });
      }

      // RETURNING tells us whether anything actually changed, so an idempotent
      // repeat (same status twice, or clearing a day with no mark) does not
      // needlessly throw away cached analyses.
      let changed: { day: string }[];
      if (status === null) {
        changed = await query<{ day: string }>(
          'DELETE FROM day_marks WHERE user_id = $1 AND day = $2::date RETURNING day::text AS day',
          [userId, date]
        );
      } else {
        changed = await query<{ day: string }>(
          `INSERT INTO day_marks (user_id, day, status) VALUES ($1, $2::date, $3)
           ON CONFLICT (user_id, day) DO UPDATE
             SET status = EXCLUDED.status, updated_at = now()
             WHERE day_marks.status IS DISTINCT FROM EXCLUDED.status
           RETURNING day::text AS day`,
          [userId, date, status]
        );
      }
      if (changed.length > 0) {
        await invalidateAnalysesCoveringDay(userId, date);
      }

      return reply.status(200).send({ day: date, status });
    }
  );
}
