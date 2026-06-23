import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/client';
import { enqueueAnalysis } from '../queues/entry';
import { uploadPhoto } from '../services/storage';
import { User, PhotoCaptureResponse } from '../types/models';

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

export async function entriesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/entries/photo', async (request, reply) => {
    const token = extractBearerToken(request);
    if (!token) {
      return reply.status(401).send({ error: 'Missing or malformed Authorization header' });
    }

    const users = await query<User>(
      'SELECT id FROM users WHERE api_token = $1',
      [token]
    );
    if (users.length === 0) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
    const user = users[0];

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
