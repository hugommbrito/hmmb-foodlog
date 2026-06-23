import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { AiAnalysisResult } from '../types/models';

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
  foods: z.array(aiFoodItemSchema),
});

const SYSTEM_PROMPT =
  'You are a nutritionist AI analyzing meal photos. Identify all food items visible. ' +
  'Return ONLY valid JSON with this exact structure: ' +
  '{"title":string|null,"overall_confidence":number,"foods":[{"description":string,"quantity":string|null,' +
  '"kcal":number|null,"protein_g":number|null,"fat_g":number|null,"carbs_g":number|null,"confidence":number}]}. ' +
  'IMPORTANT: write every textual value (title, description, quantity) in Brazilian Portuguese (pt-BR). ' +
  'Keep the JSON keys exactly as shown above, in English. ' +
  'Confidence values are floats 0.0-1.0. Nutritional fields are null when uncertain. No markdown — JSON only.';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

async function fetchImageAsBase64(url: string): Promise<{ data: string; media_type: AllowedMediaType }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
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

export async function analyzeEntry(photos: string[], recentFoods: string[]): Promise<AiAnalysisResult> {
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

  content.push({
    type: 'text',
    text: `${foodsCtx}Analyze the meal in the photo(s) above and return the JSON.`,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

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
