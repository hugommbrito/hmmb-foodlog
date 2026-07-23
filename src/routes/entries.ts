import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { query } from '../db/client';
import { enqueueAnalysis, waitForAnalysis } from '../queues/entry';
import { uploadPhoto, compressForAi } from '../services/storage';
import { User, Entry, FoodItem, EntryWithFoods, EntryAnalysisView, PhotoCaptureResponse, ReanalyzeRequest } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildShortcutMessage(
  status: 'pending' | 'done',
  title: string | null,
  foods: FoodItem[]
): string {
  if (status === 'pending') {
    return '📸 Foto capturada! Análise ainda em andamento — verifique o app em instantes.';
  }
  if (foods.length === 0) {
    return '📸 Foto registrada, mas não foi possível identificar os alimentos.';
  }

  const header = title ?? (foods.length === 1 ? foods[0].description : 'Refeição registrada');
  const lines: string[] = [`🍽️ ${header}`];

  for (const food of foods) {
    const parts: string[] = [];
    if (food.quantity) parts.push(food.quantity);
    if (food.kcal != null) parts.push(`${Math.round(food.kcal)} kcal`);
    const detail = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
    lines.push(`• ${food.description}${detail}`);
  }

  const hasNutrition = foods.some((f) => f.kcal != null);
  if (hasNutrition) {
    const totalKcal = foods.reduce((s, f) => s + (f.kcal ?? 0), 0);
    const totalP = foods.reduce((s, f) => s + (f.protein_g ?? 0), 0);
    const totalF = foods.reduce((s, f) => s + (f.fat_g ?? 0), 0);
    const totalC = foods.reduce((s, f) => s + (f.carbs_g ?? 0), 0);
    lines.push(
      `Total: ${Math.round(totalKcal)} kcal | P: ${Math.round(totalP)}g | G: ${Math.round(totalF)}g | C: ${Math.round(totalC)}g`
    );
  }

  return lines.join('\n');
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Floor for a manually picked created_at: the app has no data before this, so an
// earlier date is a typo, not a real backdated meal.
const MIN_ENTRY_DATE = Date.UTC(2020, 0, 1);

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

// Loads an entry owned by userId with its food_items, or null if missing/not owned.
// analysis_status derives from ai_cycles (the worker bumps it once analysis persists).
async function loadEntryView(entryId: string, userId: string): Promise<EntryAnalysisView | null> {
  const entries = await query<Entry & { context: string | null }>(
    `SELECT e.*, ct.name AS context
     FROM entries e
     LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
     WHERE e.id = $1 AND e.user_id = $2`,
    [entryId, userId]
  );
  if (entries.length === 0) {
    return null;
  }
  const entry = entries[0];
  const foods = await query<FoodItem>(
    'SELECT * FROM food_items WHERE entry_id = $1 ORDER BY confidence DESC',
    [entryId]
  );
  return {
    id: entry.id,
    created_at: entry.created_at,
    photos: entry.photos,
    title: entry.title,
    context: entry.context,
    context_tag_id: entry.context_tag_id,
    ai_confidence_overall: entry.ai_confidence_overall,
    reviewed: entry.reviewed,
    ai_cycles: entry.ai_cycles,
    analysis_status: entry.ai_cycles > 0 ? 'done' : 'pending',
    foods,
  };
}

// CAP-4: collapse the user's granular food edits and/or free-text note into the
// single correction string the AI consumes. Returns null when there is nothing to
// correct (so the route can reject with 400). Keeping descriptions verbatim and
// letting the AI recompute nutrition keeps the "user never types macros" invariant.
function buildCorrection(body: ReanalyzeRequest | undefined): string | null {
  const parts: string[] = [];

  const foods = Array.isArray(body?.foods) ? body!.foods : [];
  const validFoods = foods.filter((f) => f && typeof f.description === 'string' && f.description.trim());
  if (validFoods.length > 0) {
    const list = validFoods
      .map((f) => {
        const qty = typeof f.quantity === 'string' && f.quantity.trim() ? ` (${f.quantity.trim()})` : '';
        return `- ${f.description.trim()}${qty}`;
      })
      .join('\n');
    parts.push(`Lista de alimentos corrigida pelo usuário (mantenha estas descrições; recalcule a nutrição):\n${list}`);
  }

  const note = typeof body?.correction === 'string' ? body.correction.trim() : '';
  if (note) {
    parts.push(`Observação do usuário: ${note}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
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
      `SELECT e.*, ct.name AS context,
              COALESCE(
                json_agg(f.* ORDER BY f.confidence ASC, f.id ASC) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS foods
       FROM entries e
       LEFT JOIN food_items f ON f.entry_id = e.id
       LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
       WHERE e.user_id = $1
         AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
             = COALESCE($2::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
       GROUP BY e.id, ct.name
       ORDER BY e.created_at ASC`,
      [userId, date ?? null]
    );

    return reply.status(200).send(entries);
  });

  // CAP-8: search entries by food name across the full history.
  // Returns EntryWithFoods[] (all foods per entry) in chronological order.
  // At least one food_item must match the query (ILIKE) for the entry to appear.
  app.get<{ Querystring: { q?: string } }>('/entries/search', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (q.length < 2) {
      return reply.status(400).send({ error: 'Query muito curta (mínimo 2 caracteres)' });
    }

    // Escape SQL LIKE wildcards so '%' and '_' in the query are treated as literals.
    const escaped = q.replace(/[%_\\]/g, (c) => `\\${c}`);

    const entries = await query<EntryWithFoods>(
      `SELECT e.*, ct.name AS context,
              COALESCE(
                json_agg(f.* ORDER BY f.confidence ASC, f.id ASC) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS foods
       FROM entries e
       LEFT JOIN food_items f ON f.entry_id = e.id
       LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
       WHERE e.user_id = $1
         AND EXISTS (
           SELECT 1 FROM food_items fi2
           WHERE fi2.entry_id = e.id
             AND lower(fi2.description) LIKE '%' || lower($2) || '%' ESCAPE '\\'
         )
       GROUP BY e.id, ct.name
       ORDER BY e.created_at ASC`,
      [userId, escaped]
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

  // CAP-9: set or clear an entry's context tag (one-touch selection in review).
  // Independent of "Accept" — never flips `reviewed`. `context_tag_id: null` clears.
  app.patch<{ Params: { id: string }; Body: { context_tag_id?: string | null } }>(
    '/entries/:id/context',
    async (request, reply) => {
      const userId = await authenticate(request);
      if (!userId) {
        return reply.status(401).send({ error: 'Missing or invalid token' });
      }

      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.status(404).send({ error: 'Entry not found' });
      }

      const tagId = request.body?.context_tag_id ?? null;
      if (tagId !== null) {
        if (typeof tagId !== 'string' || !UUID_RE.test(tagId)) {
          return reply.status(400).send({ error: 'Invalid context_tag_id' });
        }
        // The tag must belong to the same user (prevents pointing at another user's tag).
        const tags = await query<{ id: string }>(
          'SELECT id FROM context_tags WHERE id = $1 AND user_id = $2',
          [tagId, userId]
        );
        if (tags.length === 0) {
          return reply.status(400).send({ error: 'Tag not found' });
        }
      }

      const rows = await query<{ id: string }>(
        'UPDATE entries SET context_tag_id = $3 WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId, tagId]
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Entry not found' });
      }

      const view = await loadEntryView(id, userId);
      if (!view) {
        return reply.status(404).send({ error: 'Entry not found' });
      }
      return reply.status(200).send(view);
    }
  );

  // Delete an entry. Scoped to the owner via user_id; food_items are removed by
  // the ON DELETE CASCADE on food_items.entry_id (no manual cleanup needed).
  app.delete<{ Params: { id: string } }>('/entries/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const { id } = request.params;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    const rows = await query<{ id: string }>(
      'DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    return reply.status(200).send({ deleted: true });
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
        photos.push(await compressForAi(buffer, part.mimetype));
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

    // Capture is now durable. Wait for the analysis job to finish so the response can
    // carry the AI result — but a timeout/failure must NOT fail the capture: we fall
    // back to analysis_status:'pending' and let the client fetch it later via GET.
    try {
      const job = await enqueueAnalysis(entryId);
      await waitForAnalysis(job, config.ANALYSIS_WAIT_TIMEOUT_MS);
    } catch (err) {
      request.log.warn(
        `[entries] Analysis not ready for entry ${entryId}: ${(err as Error).message}`
      );
    }

    const view = await loadEntryView(entryId, user.id);
    const status = view?.analysis_status ?? 'pending';
    const foods = view?.foods ?? [];
    const body: PhotoCaptureResponse = {
      entry_id: entryId,
      analysis_status: status,
      title: view?.title ?? null,
      ai_confidence_overall: view?.ai_confidence_overall ?? 0,
      foods,
      message: buildShortcutMessage(status, view?.title ?? null, foods),
    };
    return reply.status(201).send(body);
  });

  // Manual web entry: the user describes a meal in free text (photo optional) and
  // optionally picks the date/time. Mirrors the photo-capture flow — synchronous AI
  // analysis that segregates the foods and estimates weights/macros from the text
  // (and photo, if any). The user never types macros; the AI is the only source.
  app.post('/entries/manual', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Expected multipart/form-data' });
    }

    // Pass 1: drain every part. Buffer/validate images and capture the text fields.
    // Every part must be consumed even after a validation error, or @fastify/multipart
    // leaves the request hanging (same rule as POST /entries/photo).
    const photos: { buffer: Buffer; mimetype: string }[] = [];
    let description = '';
    let createdAtRaw = '';
    let validationError: string | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (validationError) {
            continue;
          }
          if (!part.mimetype.startsWith('image/')) {
            validationError = `Unsupported file type: ${part.mimetype}`;
            continue;
          }
          if (buffer.length === 0) {
            validationError = 'Empty image file';
            continue;
          }
          photos.push(await compressForAi(buffer, part.mimetype));
        } else if (part.fieldname === 'description') {
          description = typeof part.value === 'string' ? part.value : String(part.value ?? '');
        } else if (part.fieldname === 'created_at') {
          createdAtRaw = typeof part.value === 'string' ? part.value : String(part.value ?? '');
        }
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

    description = description.trim();
    if (!description && photos.length === 0) {
      return reply.status(400).send({ error: 'Description or at least one photo is required' });
    }

    // Optional created_at: a valid ISO 8601 instant, never in the future (60s skew
    // tolerance for client/server clock drift) and not absurdly far in the past
    // (guards a fat-fingered year that would file the entry on an off-screen day).
    // Absent → the DB DEFAULT now() applies.
    let createdAt: Date | null = null;
    if (createdAtRaw.trim()) {
      const parsed = new Date(createdAtRaw.trim());
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({ error: 'Invalid created_at; expected an ISO 8601 timestamp' });
      }
      if (parsed.getTime() > Date.now() + 60_000) {
        return reply.status(400).send({ error: 'created_at cannot be in the future' });
      }
      if (parsed.getTime() < MIN_ENTRY_DATE) {
        return reply.status(400).send({ error: 'created_at is too far in the past' });
      }
      createdAt = parsed;
    }

    // Pass 2: upload to R2 BEFORE any DB write (project invariant). No-op when text-only.
    const photoUrls: string[] = [];
    try {
      for (const photo of photos) {
        const key = `photos/${userId}/${Date.now()}-${uuidv4()}`;
        photoUrls.push(await uploadPhoto(photo.buffer, key, photo.mimetype));
      }
    } catch (err) {
      request.log.error(err, `[entries] R2 upload failed for user ${userId}`);
      return reply.status(500).send({ error: 'Failed to store photo' });
    }

    // created_at is passed explicitly ONLY when the user picked one — otherwise the
    // column is omitted so DEFAULT now() applies. Deliberate exception to the
    // "never pass created_at manually" convention, justified by the date/time picker.
    let entryId: string;
    try {
      const rows = createdAt
        ? await query<{ id: string }>(
            `INSERT INTO entries (user_id, photos, created_at, ai_confidence_overall, reviewed, ai_cycles)
             VALUES ($1, $2, $3, 0.0, false, 0) RETURNING id`,
            [userId, photoUrls, createdAt]
          )
        : await query<{ id: string }>(
            `INSERT INTO entries (user_id, photos, ai_confidence_overall, reviewed, ai_cycles)
             VALUES ($1, $2, 0.0, false, 0) RETURNING id`,
            [userId, photoUrls]
          );
      entryId = rows[0].id;
    } catch (err) {
      request.log.error(err, `[entries] DB insert failed for user ${userId}`);
      return reply.status(500).send({ error: 'Failed to save entry' });
    }

    // Synchronous analysis like the photo capture: wait for the result, but a
    // timeout/failure must NOT fail the capture — fall back to analysis_status:'pending'.
    try {
      const job = await enqueueAnalysis(entryId, undefined, description);
      await waitForAnalysis(job, config.ANALYSIS_WAIT_TIMEOUT_MS);
    } catch (err) {
      request.log.warn(
        `[entries] Analysis not ready for entry ${entryId}: ${(err as Error).message}`
      );
    }

    const view = await loadEntryView(entryId, userId);
    if (!view) {
      return reply.status(500).send({ error: 'Failed to load entry' });
    }
    return reply.status(201).send(view);
  });

  app.get<{ Params: { id: string } }>('/entries/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    // A non-UUID id would otherwise reach Postgres and raise "invalid input
    // syntax for type uuid" (500); treat it as a missing entry instead.
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    const view = await loadEntryView(request.params.id, userId);
    if (!view) {
      return reply.status(404).send({ error: 'Entry not found' });
    }
    return reply.status(200).send(view);
  });

  // CAP-4: correct an entry and re-run the AI. The correction (free text and/or an
  // edited food list) is enqueued with the analysis job; the worker replaces the
  // food_items and resets reviewed=false atomically. Synchronous like the capture
  // POST: a timeout/failure falls back to analysis_status:'pending', never a 5xx.
  app.post<{ Params: { id: string }; Body: ReanalyzeRequest }>(
    '/entries/:id/reanalyze',
    async (request, reply) => {
      const userId = await authenticate(request);
      if (!userId) {
        return reply.status(401).send({ error: 'Missing or invalid token' });
      }

      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.status(404).send({ error: 'Entry not found' });
      }

      // Ownership check before doing any work — also yields the 404 for other users.
      // We capture ai_cycles now so we can tell, after the wait, whether the
      // re-analysis actually landed (the worker bumps ai_cycles on success).
      const owned = await query<{ id: string; ai_cycles: number }>(
        'SELECT id, ai_cycles FROM entries WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (owned.length === 0) {
        return reply.status(404).send({ error: 'Entry not found' });
      }
      const priorCycles = owned[0].ai_cycles;

      const correction = buildCorrection(request.body);
      // When ai_cycles=0 the initial analysis never landed; allow a plain retry
      // without a correction body so the user can unblock without typing food names.
      if (!correction && priorCycles > 0) {
        return reply.status(400).send({ error: 'Nothing to correct: provide a correction or edited foods' });
      }

      try {
        const job = await enqueueAnalysis(id, correction ?? undefined);
        await waitForAnalysis(job, config.ANALYSIS_WAIT_TIMEOUT_MS);
      } catch (err) {
        request.log.warn(
          `[entries] Re-analysis not ready for entry ${id}: ${(err as Error).message}`
        );
      }

      const view = await loadEntryView(id, userId);
      if (!view) {
        return reply.status(404).send({ error: 'Entry not found' });
      }
      // analysis_status derives from ai_cycles > 0, which is already true here from
      // the prior analysis. If ai_cycles did NOT advance, the re-analysis hasn't
      // landed (timed out / still running / produced nothing): the view still shows
      // the PREVIOUS result, so report 'pending' to honor the timeout contract.
      if (view.ai_cycles === priorCycles) {
        view.analysis_status = 'pending';
      }
      return reply.status(200).send(view);
    }
  );
}
