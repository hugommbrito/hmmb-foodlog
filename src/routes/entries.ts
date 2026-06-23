import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { query } from '../db/client';
import { enqueueAnalysis, waitForAnalysis } from '../queues/entry';
import { uploadPhoto } from '../services/storage';
import { User, Entry, FoodItem, EntryAnalysisView, PhotoCaptureResponse } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Resolves the authenticated user from the Bearer token, or null if absent/invalid.
async function resolveUser(request: FastifyRequest): Promise<User | null> {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }
  const users = await query<User>('SELECT id FROM users WHERE api_token = $1', [token]);
  return users.length > 0 ? users[0] : null;
}

// Loads an entry owned by userId with its food_items, or null if missing/not owned.
// analysis_status derives from ai_cycles (the worker bumps it once analysis persists).
async function loadEntryView(entryId: string, userId: string): Promise<EntryAnalysisView | null> {
  const entries = await query<Entry>(
    'SELECT * FROM entries WHERE id = $1 AND user_id = $2',
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
    ai_confidence_overall: entry.ai_confidence_overall,
    reviewed: entry.reviewed,
    ai_cycles: entry.ai_cycles,
    analysis_status: entry.ai_cycles > 0 ? 'done' : 'pending',
    foods,
  };
}

export async function entriesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/entries/photo', async (request, reply) => {
    const user = await resolveUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization token' });
    }

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
    const body: PhotoCaptureResponse = {
      entry_id: entryId,
      analysis_status: view?.analysis_status ?? 'pending',
      title: view?.title ?? null,
      ai_confidence_overall: view?.ai_confidence_overall ?? 0,
      foods: view?.foods ?? [],
    };
    return reply.status(201).send(body);
  });

  app.get<{ Params: { id: string } }>('/entries/:id', async (request, reply) => {
    const user = await resolveUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization token' });
    }

    // A non-UUID id would otherwise reach Postgres and raise "invalid input
    // syntax for type uuid" (500); treat it as a missing entry instead.
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Entry not found' });
    }

    const view = await loadEntryView(request.params.id, user.id);
    if (!view) {
      return reply.status(404).send({ error: 'Entry not found' });
    }
    return reply.status(200).send(view);
  });
}
