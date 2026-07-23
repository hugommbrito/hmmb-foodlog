import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { analyzePatterns } from '../services/ai';
import { PatternAnalysis, SharedEntry, User } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// Row shape for the owner-facing link, with period dates kept as plain strings
// (to_char) so they never shift across the pg DATE→JS Date timezone parse.
interface ShareLinkRow {
  id: string;
  share_no: string; // BIGSERIAL comes back as a string from pg
  period_start: string;
  period_end: string;
  expires_at: Date;
  created_at: Date;
}

// Owner's entries within the period (inclusive, America/Sao_Paulo day), each with
// its foods. Only public fields are selected — no user_id/PII reaches the client.
// Shared by the public read view (CAP-7a) and the pattern analysis (CAP-7b).
function loadPeriodEntries(userId: string, periodStart: string, periodEnd: string): Promise<SharedEntry[]> {
  return query<SharedEntry>(
    `SELECT e.id, e.created_at, e.photos, e.title, ct.name AS context,
            COALESCE(
              json_agg(f.* ORDER BY f.confidence DESC, f.id ASC) FILTER (WHERE f.id IS NOT NULL),
              '[]'
            ) AS foods
     FROM entries e
     LEFT JOIN food_items f ON f.entry_id = e.id
     LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
     WHERE e.user_id = $1
       AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
           BETWEEN $2::date AND $3::date
     GROUP BY e.id, ct.name
     ORDER BY e.created_at ASC`,
    [userId, periodStart, periodEnd]
  );
}

// Local day key in the same timezone the period filter uses, for the sufficiency guard.
function spDayKey(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(d));
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // Create a share link for a chosen period with an expiration. Owner-only.
  app.post<{ Body: { period_start?: string; period_end?: string; expires_at?: string } }>(
    '/share-links',
    async (request, reply) => {
      const userId = await authenticate(request);
      if (!userId) {
        return reply.status(401).send({ error: 'Missing or invalid token' });
      }

      const { period_start, period_end, expires_at } = request.body ?? {};
      if (!isValidCalendarDate(period_start) || !isValidCalendarDate(period_end)) {
        return reply.status(400).send({ error: 'Datas do período inválidas (use YYYY-MM-DD)' });
      }
      if (period_start > period_end) {
        return reply.status(400).send({ error: 'Início do período deve ser <= fim' });
      }
      const exp = typeof expires_at === 'string' ? new Date(expires_at) : new Date(NaN);
      if (Number.isNaN(exp.getTime())) {
        return reply.status(400).send({ error: 'Data de expiração inválida' });
      }
      if (exp.getTime() <= Date.now()) {
        return reply.status(400).send({ error: 'A expiração deve ser no futuro' });
      }

      const rows = await query<ShareLinkRow>(
        `INSERT INTO share_links (user_id, period_start, period_end, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, share_no,
           to_char(period_start, 'YYYY-MM-DD') AS period_start,
           to_char(period_end, 'YYYY-MM-DD') AS period_end,
           expires_at, created_at`,
        [userId, period_start, period_end, exp.toISOString()]
      );
      const row = rows[0];
      return reply.status(201).send({
        id: row.id,
        token: Number(row.share_no),
        period_start: row.period_start,
        period_end: row.period_end,
        expires_at: row.expires_at,
        created_at: row.created_at,
        status: 'active', // just validated expires_at > now
      });
    }
  );

  // List the owner's share links, newest first, with a computed active/expired status.
  app.get('/share-links', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    const rows = await query<ShareLinkRow & { active: boolean }>(
      `SELECT id, share_no,
         to_char(period_start, 'YYYY-MM-DD') AS period_start,
         to_char(period_end, 'YYYY-MM-DD') AS period_end,
         expires_at, created_at,
         (expires_at > now()) AS active
       FROM share_links
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        token: Number(r.share_no),
        period_start: r.period_start,
        period_end: r.period_end,
        expires_at: r.expires_at,
        created_at: r.created_at,
        status: r.active ? 'active' : 'expired',
      }))
    );
  });

  // Revoke a share link (hard delete). Scoped to the owner via user_id.
  app.delete<{ Params: { id: string } }>('/share-links/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Link not found' });
    }
    const rows = await query<{ id: string }>(
      'DELETE FROM share_links WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Link not found' });
    }
    return reply.status(200).send({ deleted: true });
  });

  // PUBLIC, no auth: the nutritionist's read-only window into a period.
  // Token is the sequential share_no. Parse to an integer BEFORE any query so a
  // non-numeric path yields 404 instead of a 500 from an invalid cast.
  app.get<{ Params: { token: string } }>('/shared/:token', async (request, reply) => {
    // Digits only (leading zeros allowed: /share/001 → 1); rejects '1abc', '', '-1'.
    const raw = request.params.token;
    const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isInteger(n) || n <= 0) {
      return reply.status(404).send({ error: 'Link inválido' });
    }

    const links = await query<{ user_id: string; period_start: string; period_end: string; expires_at: Date }>(
      `SELECT user_id,
         to_char(period_start, 'YYYY-MM-DD') AS period_start,
         to_char(period_end, 'YYYY-MM-DD') AS period_end,
         expires_at
       FROM share_links WHERE share_no = $1`,
      [n]
    );
    if (links.length === 0) {
      return reply.status(404).send({ error: 'Link inválido' });
    }
    const link = links[0];
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      return reply.status(410).send({ error: 'Link expirado' });
    }

    const entries = await loadPeriodEntries(link.user_id, link.period_start, link.period_end);

    return reply.status(200).send({
      period_start: link.period_start,
      period_end: link.period_end,
      expires_at: link.expires_at,
      entries,
    });
  });

  // PUBLIC, no auth: CAP-7b — AI behavioral-pattern analysis for the period.
  // Lazy + cached: computed (one paid Claude call) on first access and stored on
  // the link; later accesses serve the cache. Separate endpoint so the calendar/
  // list view (GET /shared/:token) stays fast and never triggers the AI.
  app.get<{ Params: { token: string } }>('/shared/:token/patterns', async (request, reply) => {
    const raw = request.params.token;
    const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isInteger(n) || n <= 0) {
      return reply.status(404).send({ error: 'Link inválido' });
    }

    const links = await query<{
      id: string;
      user_id: string;
      period_start: string;
      period_end: string;
      expires_at: Date;
      analysis_json: PatternAnalysis | null;
      analysis_generated_at: Date | null;
    }>(
      `SELECT id, user_id,
         to_char(period_start, 'YYYY-MM-DD') AS period_start,
         to_char(period_end, 'YYYY-MM-DD') AS period_end,
         expires_at, analysis_json, analysis_generated_at
       FROM share_links WHERE share_no = $1`,
      [n]
    );
    if (links.length === 0) {
      return reply.status(404).send({ error: 'Link inválido' });
    }
    const link = links[0];
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      return reply.status(410).send({ error: 'Link expirado' });
    }

    // Cache hit: serve the stored analysis, no Claude call.
    if (link.analysis_json) {
      return reply.status(200).send({
        generated_at: link.analysis_generated_at,
        analysis: link.analysis_json,
      });
    }

    const entries = await loadPeriodEntries(link.user_id, link.period_start, link.period_end);

    // Need entries spread over >= 3 local days for meaningful patterns; otherwise
    // skip the (paid) Claude call and don't cache, so a later access can recompute.
    const distinctDays = new Set(entries.map((e) => spDayKey(e.created_at)));
    if (distinctDays.size < 3) {
      return reply.status(200).send({ insufficient: true });
    }

    let analysis: PatternAnalysis;
    try {
      analysis = await analyzePatterns(entries);
    } catch (err) {
      request.log.error({ err: (err as Error).message }, '[share] pattern analysis failed');
      return reply.status(502).send({ error: 'Não foi possível gerar a análise' });
    }

    const saved = await query<{ analysis_generated_at: Date }>(
      `UPDATE share_links SET analysis_json = $1, analysis_generated_at = now()
       WHERE id = $2 RETURNING analysis_generated_at`,
      [JSON.stringify(analysis), link.id]
    );

    return reply.status(200).send({
      generated_at: saved[0]?.analysis_generated_at ?? null,
      analysis,
    });
  });
}
