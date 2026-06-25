import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { AiAnalysisResult } from '../types/models';
import { scrubSecrets, withOutboundAudit } from './audit';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000 });

const aiFoodItemSchema = z.object({
  description: z.string(),
  quantity: z.string().nullable(),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});

const aiResponseSchema = z.object({
  title: z.string().nullable(),
  overall_confidence: z.number().min(0).max(1),
  // CAP-9: suggested context tag name. Defaults to null if the model omits it so a
  // missing field never fails the whole analysis.
  context: z.string().nullable().default(null),
  foods: z.array(aiFoodItemSchema),
});

const SYSTEM_PROMPT =
  'You are a nutritionist AI analyzing meal photos. Identify all food items visible. ' +
  'Return ONLY valid JSON with this exact structure: ' +
  '{"title":string|null,"overall_confidence":number,"context":string|null,"foods":[{"description":string,"quantity":string|null,' +
  '"kcal":number|null,"protein_g":number|null,"fat_g":number|null,"carbs_g":number|null,"confidence":number}]}. ' +
  'The "context" field is the meal setting: choose EXACTLY one name from the list of available contexts given in the ' +
  'user message (copy it verbatim), or null if none fits or none are provided. ' +
  'IMPORTANT: write every textual value (title, description, quantity) in Brazilian Portuguese (pt-BR). ' +
  'Keep the JSON keys exactly as shown above, in English. ' +
  'Confidence values are floats 0.0-1.0. Nutritional fields are null when uncertain. No markdown — JSON only.';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

async function fetchImageAsBase64(url: string): Promise<{ data: string; media_type: AllowedMediaType }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await withOutboundAudit('r2', 'fetch-image', { url: scrubSecrets(url) }, () =>
      fetch(url, { signal: controller.signal })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching image from R2`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    const media_type = ALLOWED_MEDIA_TYPES.includes(contentType as AllowedMediaType)
      ? (contentType as AllowedMediaType)
      : 'image/jpeg';
    return { data: buffer.toString('base64'), media_type };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeEntry(
  photos: string[],
  recentFoods: string[],
  contextTags: string[],
  correction?: string
): Promise<AiAnalysisResult> {
  const content: Anthropic.MessageParam['content'] = [];

  for (const photoUrl of photos) {
    const { data, media_type } = await fetchImageAsBase64(photoUrl);
    content.push({
      type: 'image',
      source: { type: 'base64', media_type, data },
    });
  }

  const foodsCtx = recentFoods.length > 0
    ? `Recent foods for this user: ${recentFoods.join(', ')}. `
    : '';

  const contextCtx = contextTags.length > 0
    ? `Available contexts (choose exactly one for "context", verbatim, or null): ${contextTags.join(', ')}. `
    : 'No contexts available; set "context" to null. ';

  // CAP-4: on a re-analysis the user has corrected a previous result. Treat the
  // correction as ground truth — keep the descriptions the user gave and only
  // recompute the nutrition/confidence; do not second-guess the corrected items.
  const correctionCtx = correction && correction.trim()
    ? `O usuário corrigiu uma análise anterior desta refeição. Trate a correção a seguir como verdade: ` +
      `mantenha as descrições informadas pelo usuário e apenas recalcule a nutrição (kcal, macros) e a confiança. ` +
      `Correção do usuário:\n${correction.trim()}\n\n`
    : '';

  content.push({
    type: 'text',
    text: `${foodsCtx}${contextCtx}${correctionCtx}Analyze the meal in the photo(s) above and return the JSON.`,
  });

  const response = await withOutboundAudit(
    'anthropic',
    'messages.create',
    { model: 'claude-sonnet-4-6', photos: photos.length },
    () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      })
  );

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`[ai] No JSON found in Claude response: ${rawText.slice(0, 200)}`);
  }

  const parsed: unknown = JSON.parse(rawText.slice(start, end + 1));
  return aiResponseSchema.parse(parsed);
}
