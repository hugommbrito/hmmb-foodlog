import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { query } from '../db/client';
import { enqueueAnalysis, waitForAnalysis } from '../queues/entry';
import { uploadPhoto } from '../services/storage';
import {
  extractPhotoFromWebhook,
  extractTextFromWebhook,
  downloadPhoto,
  sendTextMessage,
  formatEntrySummary,
} from '../services/whatsapp';
import { WebhookPayload, User, Entry, FoodItem } from '../types/models';

// CAP-5: handle a free-text correction. Finds the user's most recent entry of
// today (America/Sao_Paulo); if none, nudges them to send a photo first. Otherwise
// acks immediately and re-analyzes in the background so the webhook returns 200 fast.
async function processCorrection(userId: string, phone: string, text: string): Promise<void> {
  const rows = await query<{ id: string; ai_cycles: number }>(
    `SELECT id, ai_cycles FROM entries
     WHERE user_id = $1
       AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date
           = (now() AT TIME ZONE 'America/Sao_Paulo')::date
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    await sendTextMessage(phone, 'Não encontrei uma entrada de hoje para corrigir. Envie a foto primeiro 📸');
    return;
  }

  const { id: entryId, ai_cycles: priorCycles } = rows[0];
  await sendTextMessage(phone, '✏️ Entendi! Recalculando sua entrada...');

  // Fire-and-forget: the re-analysis can take ~10–50s; the webhook must not wait.
  // Errors are logged and never rethrown — we already responded 200 to Z-API.
  void finalizeCorrection(entryId, priorCycles, phone, text).catch((err) =>
    console.error(`[webhook] Correction finalize failed for entry ${entryId}:`, (err as Error).message)
  );
}

// CAP-5 (background): enqueue the re-analysis, wait for it, then confirm in-thread.
// Success is detected by ai_cycles advancing (mirrors POST /entries/:id/reanalyze):
// if it didn't advance (timeout / zero foods → worker preserves the prior result),
// send a friendly failure message instead of a stale summary.
async function finalizeCorrection(
  entryId: string,
  priorCycles: number,
  phone: string,
  correction: string
): Promise<void> {
  try {
    const job = await enqueueAnalysis(entryId, correction);
    await waitForAnalysis(job, config.ANALYSIS_WAIT_TIMEOUT_MS);
  } catch (err) {
    console.warn(`[webhook] Re-analysis not ready for entry ${entryId}: ${(err as Error).message}`);
  }

  const entries = await query<Entry>('SELECT * FROM entries WHERE id = $1', [entryId]);
  if (entries.length === 0) {
    return;
  }
  const entry = entries[0];

  if (entry.ai_cycles === priorCycles) {
    await sendTextMessage(phone, 'Não consegui processar a correção agora 😕 Confira a entrada no app.');
    return;
  }

  const foods = await query<FoodItem>(
    'SELECT * FROM food_items WHERE entry_id = $1 ORDER BY confidence DESC',
    [entryId]
  );
  await sendTextMessage(phone, formatEntrySummary(entry.title, foods, entry.ai_confidence_overall));
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: WebhookPayload }>('/webhook/whatsapp', async (request, reply) => {
    const payload = request.body;

    if (config.ZAPI_WEBHOOK_SECRET) {
      const token = request.headers['client-token'];
      if (token !== config.ZAPI_WEBHOOK_SECRET) {
        return reply.status(200).send({ received: false });
      }
    }

    if (payload.fromMe) {
      return reply.status(200).send({ received: false });
    }

    const phone = payload.phone;
    if (!phone || typeof phone !== 'string') {
      return reply.status(200).send({ received: false });
    }

    const users = await query<User>(
      'SELECT id FROM users WHERE phone_number = $1',
      [phone]
    );

    if (users.length === 0) {
      return reply.status(200).send({ received: false });
    }

    const user = users[0];

    const imageUrl = extractPhotoFromWebhook(payload);
    if (!imageUrl) {
      // CAP-5: no photo → a free-text message is treated as a correction of the
      // user's most recent entry of today. Photos always take priority over text.
      const text = extractTextFromWebhook(payload);
      if (text) {
        await processCorrection(user.id, phone, text);
        return reply.status(200).send({ received: true });
      }
      return reply.status(200).send({ received: false });
    }

    const photoData = await downloadPhoto(imageUrl);
    if (!photoData) {
      console.error(`[webhook] Failed to download photo for user ${user.id}`);
      return reply.status(200).send({ received: false });
    }

    const key = `photos/${user.id}/${Date.now()}-${uuidv4()}`;

    let photoUrl: string;
    try {
      photoUrl = await uploadPhoto(photoData.buffer, key, photoData.mimetype);
    } catch (err) {
      console.error(`[webhook] R2 upload failed for user ${user.id}:`, err);
      return reply.status(200).send({ received: false });
    }

    let entryId: string;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO entries (user_id, photos, ai_confidence_overall, reviewed, ai_cycles)
         VALUES ($1, $2, 0.0, false, 0) RETURNING id`,
        [user.id, [photoUrl]]
      );
      entryId = rows[0].id;
    } catch (err) {
      console.error(`[webhook] DB insert failed for user ${user.id}:`, err);
      return reply.status(200).send({ received: false });
    }

    enqueueAnalysis(entryId).catch((err) =>
      console.error(`[webhook] Failed to enqueue analysis for entry ${entryId}:`, (err as Error).message)
    );

    await sendTextMessage(phone, '📸 Foto recebida!');

    return reply.status(200).send({ received: true });
  });
}
