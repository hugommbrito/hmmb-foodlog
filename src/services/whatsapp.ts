import { config } from '../config';
import { WebhookPayload } from '../types/models';

const FETCH_TIMEOUT_MS = 8000;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB

export interface PhotoData {
  buffer: Buffer;
  mimetype: string;
}

export function extractPhotoFromWebhook(payload: WebhookPayload): string | null {
  if (!payload.image || !payload.image.imageUrl) {
    return null;
  }
  return payload.image.imageUrl;
}

export async function downloadPhoto(imageUrl: string): Promise<PhotoData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[whatsapp] Failed to download image: HTTP ${response.status}`);
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PHOTO_BYTES) {
      console.error(`[whatsapp] Image too large: ${contentLength} bytes`);
      return null;
    }

    const mimetype = response.headers.get('content-type') ?? 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_PHOTO_BYTES) {
      console.error(`[whatsapp] Image too large after download: ${arrayBuffer.byteLength} bytes`);
      return null;
    }

    const buffer = Buffer.from(arrayBuffer);
    return { buffer, mimetype };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[whatsapp] Photo download timed out');
    } else {
      console.error('[whatsapp] Error downloading photo:', err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTextMessage(phone: string, text: string): Promise<void> {
  const url = `https://api.z-api.io/instances/${config.ZAPI_INSTANCE}/token/${config.ZAPI_TOKEN}/send-text`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[whatsapp] Failed to send message: HTTP ${response.status}`);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[whatsapp] sendTextMessage timed out');
    } else {
      console.error('[whatsapp] Error sending text message:', err);
    }
  } finally {
    clearTimeout(timer);
  }
}
