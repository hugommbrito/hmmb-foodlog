import { config } from '../config';
import { WebhookPayload, FoodItem } from '../types/models';
import { scrubSecrets, withOutboundAudit } from './audit';

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

// CAP-5: a text-only message (no photo) is a correction. Returns the trimmed
// message, or null when there is no usable text.
export function extractTextFromWebhook(payload: WebhookPayload): string | null {
  const message = payload.text?.message;
  if (typeof message !== 'string') {
    return null;
  }
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// CAP-5: render the re-analyzed entry as a WhatsApp confirmation in pt-BR
// (title + food bullets with quantity and non-null macros + overall confidence).
export function formatEntrySummary(
  title: string | null,
  foods: FoodItem[],
  confidence: number
): string {
  const lines = [`✅ Entrada atualizada!`, `🍽 ${title?.trim() || 'Refeição'}`, ''];

  for (const food of foods) {
    const qty = food.quantity?.trim() ? ` (${food.quantity.trim()})` : '';
    const macros: string[] = [];
    if (food.kcal != null) macros.push(`${food.kcal} kcal`);
    if (food.protein_g != null) macros.push(`P ${food.protein_g}g`);
    if (food.carbs_g != null) macros.push(`C ${food.carbs_g}g`);
    if (food.fat_g != null) macros.push(`G ${food.fat_g}g`);
    const macrosStr = macros.length > 0 ? ` — ${macros.join(' · ')}` : '';
    lines.push(`• ${food.description}${qty}${macrosStr}`);
  }

  lines.push('', `Confiança: ${Math.round(confidence * 100)}%`);
  return lines.join('\n');
}

export async function downloadPhoto(imageUrl: string): Promise<PhotoData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await withOutboundAudit(
      'z-api',
      'download-photo',
      { url: scrubSecrets(imageUrl) },
      () => fetch(imageUrl, { signal: controller.signal })
    );
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
    const response = await withOutboundAudit('z-api', 'send-text', { phone, message: text }, () =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: text }),
        signal: controller.signal,
      })
    );

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
