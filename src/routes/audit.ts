import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { User, RequestLog } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) {
    return false;
  }
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Minimal local copy of the Bearer-token auth used by entries routes — kept
// self-contained here to avoid touching the critical capture path in entries.ts.
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

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // Recent inbound requests, newest first. Optional path substring (`q`) and
  // `before` cursor (ISO timestamp) for narrowing/pagination.
  app.get<{ Querystring: { limit?: string; q?: string; before?: string } }>(
    '/audit/requests',
    async (request, reply) => {
      const userId = await authenticate(request);
      if (!userId) {
        return reply.status(401).send({ error: 'Missing or invalid token' });
      }

      const rawLimit = Number(request.query.limit);
      const limit =
        Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
      const q = request.query.q?.trim();
      const before = request.query.before;
      if (before !== undefined && Number.isNaN(Date.parse(before))) {
        return reply.status(400).send({ error: 'Invalid before timestamp' });
      }

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (q) {
        params.push(`%${q}%`);
        conditions.push(`path ILIKE $${params.length}`);
      }
      if (before) {
        params.push(before);
        conditions.push(`created_at < $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit);

      const rows = await query<RequestLog>(
        `SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return reply.status(200).send(rows);
    }
  );

  app.get<{ Params: { id: string } }>('/audit/requests/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Log not found' });
    }
    const rows = await query<RequestLog>('SELECT * FROM request_logs WHERE id = $1', [
      request.params.id,
    ]);
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Log not found' });
    }
    return reply.status(200).send(rows[0]);
  });

  // Manual cleanup (retention is manual). Without `before`, purges everything;
  // with `before=YYYY-MM-DD`, removes logs older than that local-naive date.
  app.delete<{ Querystring: { before?: string } }>('/audit/requests', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    const before = request.query.before;
    if (before !== undefined && !isValidCalendarDate(before)) {
      return reply.status(400).send({ error: 'Invalid date; expected YYYY-MM-DD' });
    }
    const rows = before
      ? await query<{ id: string }>(
          'DELETE FROM request_logs WHERE created_at < $1::date RETURNING id',
          [before]
        )
      : await query<{ id: string }>('DELETE FROM request_logs RETURNING id', []);
    return reply.status(200).send({ deleted: rows.length });
  });
}
