import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { ContextTag, User } from '../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_TAG_LEN = 30;
const DEFAULT_TAGS = ['casa', 'restaurante', 'trabalho', 'rua'];
const DEFAULT_COLOR = '#9ca3af';
const PG_UNIQUE_VIOLATION = '23505';

// Minimal local copy of the Bearer-token auth used by the other route modules —
// kept local on purpose (same convention as src/routes/audit.ts).
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

// Trims and validates a tag name. Returns the normalized name or an error string.
function validateName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') {
    return { error: 'Nome obrigatório' };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { error: 'Nome obrigatório' };
  }
  if (name.length > MAX_TAG_LEN) {
    return { error: `Nome muito longo (máx ${MAX_TAG_LEN})` };
  }
  return { name };
}

// Validates a HEX color #RRGGBB. Returns the normalized (lowercased) value or an error.
function validateColor(raw: unknown): { color: string } | { error: string } {
  if (typeof raw !== 'string' || !HEX_COLOR_RE.test(raw.trim())) {
    return { error: 'Cor inválida (use #RRGGBB)' };
  }
  return { color: raw.trim().toLowerCase() };
}

type TagView = Pick<ContextTag, 'id' | 'name' | 'color'>;

async function listTags(userId: string): Promise<TagView[]> {
  return query<TagView>(
    'SELECT id, name, color FROM context_tags WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );
}

export async function tagsRoutes(app: FastifyInstance): Promise<void> {
  // List the user's context tags. Auto-seeds the four defaults the first time a
  // user has none (covers users created manually after the seed migration).
  app.get('/tags', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    let tags = await listTags(userId);
    if (tags.length === 0) {
      await query(
        `INSERT INTO context_tags (user_id, name)
         SELECT $1, name FROM unnest($2::text[]) AS name
         ON CONFLICT DO NOTHING`,
        [userId, DEFAULT_TAGS]
      );
      tags = await listTags(userId);
    }
    return reply.status(200).send(tags);
  });

  app.post<{ Body: { name?: string; color?: string } }>('/tags', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }

    const result = validateName(request.body?.name);
    if ('error' in result) {
      return reply.status(400).send({ error: result.error });
    }

    // Color is optional on create — fall back to the neutral default. When present it must be valid.
    let color = DEFAULT_COLOR;
    if (request.body?.color !== undefined) {
      const c = validateColor(request.body.color);
      if ('error' in c) {
        return reply.status(400).send({ error: c.error });
      }
      color = c.color;
    }

    try {
      const rows = await query<TagView>(
        'INSERT INTO context_tags (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
        [userId, result.name, color]
      );
      return reply.status(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        return reply.status(409).send({ error: 'Já existe uma tag com esse nome' });
      }
      request.log.error(err, '[tags] create failed');
      return reply.status(500).send({ error: 'Failed to create tag' });
    }
  });

  // Update a tag's name and/or color. At least one field must be present; each is
  // validated only when supplied (a color-only change leaves the name untouched).
  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string } }>('/tags/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    // Build the SET clause dynamically from the fields actually provided.
    const sets: string[] = [];
    const params: unknown[] = [request.params.id, userId];
    if (request.body?.name !== undefined) {
      const result = validateName(request.body.name);
      if ('error' in result) {
        return reply.status(400).send({ error: result.error });
      }
      params.push(result.name);
      sets.push(`name = $${params.length}`);
    }
    if (request.body?.color !== undefined) {
      const c = validateColor(request.body.color);
      if ('error' in c) {
        return reply.status(400).send({ error: c.error });
      }
      params.push(c.color);
      sets.push(`color = $${params.length}`);
    }
    if (sets.length === 0) {
      return reply.status(400).send({ error: 'Nada para atualizar (informe name e/ou color)' });
    }

    try {
      const rows = await query<TagView>(
        `UPDATE context_tags SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING id, name, color`,
        params
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Tag not found' });
      }
      return reply.status(200).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        return reply.status(409).send({ error: 'Já existe uma tag com esse nome' });
      }
      request.log.error(err, '[tags] rename failed');
      return reply.status(500).send({ error: 'Failed to rename tag' });
    }
  });

  // Delete a tag. Entries that referenced it keep existing with context_tag_id
  // set to NULL (ON DELETE SET NULL on entries.context_tag_id).
  app.delete<{ Params: { id: string } }>('/tags/:id', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Missing or invalid token' });
    }
    if (!UUID_RE.test(request.params.id)) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    const rows = await query<{ id: string }>(
      'DELETE FROM context_tags WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Tag not found' });
    }
    return reply.status(200).send({ deleted: true });
  });
}
