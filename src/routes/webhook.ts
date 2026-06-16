import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { query } from '../db/client';
import { uploadPhoto } from '../services/storage';
import {
  extractPhotoFromWebhook,
  downloadPhoto,
  sendTextMessage,
} from '../services/whatsapp';
import { WebhookPayload, User } from '../types/models';

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

    try {
      await query(
        `INSERT INTO entries (user_id, photos, ai_confidence_overall, reviewed, ai_cycles)
         VALUES ($1, $2, 0.0, false, 0)`,
        [user.id, [photoUrl]]
      );
    } catch (err) {
      console.error(`[webhook] DB insert failed for user ${user.id}:`, err);
      return reply.status(200).send({ received: false });
    }

    await sendTextMessage(phone, '📸 Foto recebida!');

    return reply.status(200).send({ received: true });
  });
}
