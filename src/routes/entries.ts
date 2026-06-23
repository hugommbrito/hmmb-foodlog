import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/client';
import { enqueueAnalysis } from '../queues/entry';
import { uploadPhoto } from '../services/storage';
import { User, PhotoCaptureResponse, EntryWithFoods, Entry } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shape check (DATE_RE) is not enough: '2026-13-40' / '2026-02-30' pass the regex
// but blow up at the Postgres `::date` cast (500). Validate calendar validity too.
function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) {
    return false;
  }
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

// Resolves the authenticated user id from the Bearer token, or null if the
// header is missing/malformed or the token does not match any user.
async function authenticate(request: FastifyRequest): Promise<string | null> {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }
  const users = await query<User>(
    'SELECT id FROM users WHERE api_token = $1',
    [token]
  );
  return users.length > 0 ? users[0].id : null;
}

export async function entriesRoutes(app: FastifyInstance): Promise<void> {
  // Daily review feed: all of a user's entries for one local (America/Sao_Paulo)
  // day, each with its AI-identified food_items nested as `foods`.
  app.get<{ Querystring: { date?: string } }>('/entries', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const date = request.query.date;
    if (date !== undefined && !isValidCalendarDate(date)) {
      return reply.status(400).send({ error: 'Invalid date; expected YYYY-MM-DD' });
    }

    const entries = await query<EntryWithFoods>(
      `SELECT e.*,
              COALESCE(
                json_agg(f.* ORDER BY f.confidence ASC, f.id ASC) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS foods
       FROM entries e
       LEFT JOIN food_items f ON f.entry_id = e.id
       WHERE e.user_id = $1
         AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
             = COALESCE($2::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
       GROUP BY e.id
       ORDER BY e.created_at ASC`,
      [userId, date ?? null]
    );

    return reply.status(200).send(entries);
  });

  // Accept an entry: mark it reviewed. Scoped to the owner via user_id.
  app.patch<{ Params: { id: string } }>('/entries/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const { id } = request.params;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    const rows = await query<Entry>(
      `UPDATE entries SET reviewed = true
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    return reply.status(200).send(rows[0]);
  });

  app.post('/entries/photo', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    const user = { id: userId };

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Expected multipart/form-data' });
    }

    // Pass 1: buffer and validate every image part before touching R2,
    // so a bad mimetype/oversize file fails without leaving orphans.
    // Every part is drained with toBuffer() even after a validation error,
    // because @fastify/multipart requires all parts consumed or the request hangs.
    const photos: { buffer: Buffer; mimetype: string }[] = [];
    let validationError: string | null = null;
    try {
      for await (const part of request.files()) {
        const buffer = await part.toBuffer();
        if (validationError) {
          continue; // keep draining remaining parts, but reject the request
        }
        if (!part.mimetype.startsWith('image/')) {
          validationError = `Unsupported file type: ${part.mimetype}`;
          continue;
        }
        if (buffer.length === 0) {
          validationError = 'Empty image file';
          continue;
        }
        photos.push({ buffer, mimetype: part.mimetype });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({ error: 'Photo exceeds maximum allowed size' });
      }
      if (code === 'FST_FILES_LIMIT') {
        return reply.status(413).send({ error: 'Too many photos in one request' });
      }
      request.log.error(err, '[entries] Failed to read multipart upload');
      return reply.status(400).send({ error: 'Malformed multipart upload' });
    }

    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }
    if (photos.length === 0) {
      return reply.status(400).send({ error: 'No photo provided' });
    }

    // Pass 2: upload to R2 BEFORE any DB write (project invariant).
    const photoUrls: string[] = [];
    try {
      for (const photo of photos) {
        const key = `photos/${user.id}/${Date.now()}-${uuidv4()}`;
        photoUrls.push(await uploadPhoto(photo.buffer, key, photo.mimetype));
      }
    } catch (err) {
      request.log.error(err, `[entries] R2 upload failed for user ${user.id}`);
      return reply.status(500).send({ error: 'Failed to store photo' });
    }

    let entryId: string;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO entries (user_id, photos, ai_confidence_overall, reviewed, ai_cycles)
         VALUES ($1, $2, 0.0, false, 0) RETURNING id`,
        [user.id, photoUrls]
      );
      entryId = rows[0].id;
    } catch (err) {
      request.log.error(err, `[entries] DB insert failed for user ${user.id}`);
      return reply.status(500).send({ error: 'Failed to save entry' });
    }

    enqueueAnalysis(entryId).catch((err) =>
      request.log.error(`[entries] Failed to enqueue analysis for entry ${entryId}: ${(err as Error).message}`)
    );

    const body: PhotoCaptureResponse = { entry_id: entryId };
    return reply.status(201).send(body);
  });
}
