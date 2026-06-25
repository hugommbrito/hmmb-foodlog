import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { AiAnalysisResult, PatternAnalysis, PatternEntryInput } from '../types/models';
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
  'You are a nutritionist AI analyzing meals from photos and/or a text description. ' +
  'Identify all food items present (visible in the photo or described in the text). ' +
  'When working from a text description, segregate the individual foods and estimate ' +
  'their quantities/weights and nutrition. ' +
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
  correction?: string,
  description?: string
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

  // Manual web entry: the user typed what they ate. Treat it as ground truth for
  // WHAT was consumed; the AI still segregates the items and estimates the weights
  // and nutrition (the "user never types macros" invariant holds).
  const hasDescription = Boolean(description && description.trim());
  const descriptionCtx = hasDescription
    ? `O usuário descreveu a refeição em texto. Trate a descrição como a verdade do que foi consumido: ` +
      `segregue os alimentos individuais e estime as quantidades/pesos e a nutrição (kcal, macros) de cada um. ` +
      `Descrição do usuário:\n${description!.trim()}\n\n`
    : '';

  // The meal can come from a photo, a text description, or both — point the closing
  // instruction at whatever sources are actually present.
  const target = photos.length > 0
    ? hasDescription
      ? 'in the photo(s) above and the description provided'
      : 'in the photo(s) above'
    : 'described above';

  content.push({
    type: 'text',
    text: `${foodsCtx}${contextCtx}${correctionCtx}${descriptionCtx}Analyze the meal ${target} and return the JSON.`,
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

// CAP-7b: pattern analysis for the nutritionist's read-only view.

const patternAnalysisSchema = z.object({
  // The SPEC requires AT LEAST 3 observations. Enforce it here so a deficient
  // model response throws (→ 502, retryable) instead of being cached as a
  // spec-violating result.
  observations: z
    .array(
      z.object({
        category: z.string(),
        title: z.string(),
        detail: z.string(),
      })
    )
    .min(3),
  // `summary` defaults to null if the model omits it so a missing field never
  // fails the whole analysis (same convention as `context` in aiResponseSchema).
  summary: z.string().nullable().default(null),
});

const PATTERNS_SYSTEM_PROMPT =
  'You are a nutritionist AI analyzing a patient food log to surface BEHAVIORAL PATTERNS for the ' +
  "patient's nutritionist. You receive one text line per meal (date+time in America/Sao_Paulo, " +
  'context/setting, and the foods with macros). Identify recurring patterns across the period. ' +
  'Return ONLY valid JSON with this exact structure: ' +
  '{"observations":[{"category":string,"title":string,"detail":string}],"summary":string|null}. ' +
  'Provide AT LEAST 3 observations. Cover these angles WHEN the data supports them (do not invent): ' +
  'recurring meal times/schedules, variation of macros by day type (e.g. weekday vs weekend), and ' +
  'correlations between context/setting and food choices. Base every claim ONLY on the provided data — ' +
  'never fabricate numbers or trends not present. ' +
  'IMPORTANT: write every textual value (category, title, detail, summary) in Brazilian Portuguese (pt-BR). ' +
  'Keep the JSON keys exactly as shown above, in English. No markdown — JSON only.';

// One compact text line per entry: "DD/MM HH:MM · <context> · <food (kcal/P/G/C); ...>".
// Macros are omitted per-field when null. Photos/user_id/PII are never included.
function formatEntryLine(e: PatternEntryInput): string {
  const dt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(e.created_at);
  const ctx = e.context ?? 'sem contexto';
  const foods =
    e.foods.length > 0
      ? e.foods
          .map((f) => {
            const macros = [
              f.kcal != null ? `${f.kcal}kcal` : null,
              f.protein_g != null ? `P${f.protein_g}` : null,
              f.fat_g != null ? `G${f.fat_g}` : null,
              f.carbs_g != null ? `C${f.carbs_g}` : null,
            ]
              .filter(Boolean)
              .join('/');
            return macros ? `${f.description} (${macros})` : f.description;
          })
          .join('; ')
      : 'sem alimentos identificados';
  return `${dt} · ${ctx} · ${foods}`;
}

export async function analyzePatterns(entries: PatternEntryInput[]): Promise<PatternAnalysis> {
  const digest = entries.map(formatEntryLine).join('\n');

  const response = await withOutboundAudit(
    'anthropic',
    'analyze-patterns',
    { model: 'claude-sonnet-4-6', entries: entries.length },
    () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1536,
        system: PATTERNS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Food log for the period (one line per meal):\n${digest}\n\nReturn the JSON.`,
          },
        ],
      })
  );

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`[ai] No JSON found in patterns response: ${rawText.slice(0, 200)}`);
  }

  const parsed: unknown = JSON.parse(rawText.slice(start, end + 1));
  return patternAnalysisSchema.parse(parsed);
}
