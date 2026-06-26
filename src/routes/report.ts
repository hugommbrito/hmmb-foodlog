import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { analyzePatterns } from '../services/ai';
import { EntryQueryRow, PatternEntryInput, User, WeeklyReportRow } from '../types/models';

// Minimal local copy of Bearer-token auth (same convention as routes/entries.ts).
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

// Local day key in America/Sao_Paulo for the entries sufficiency guard.
// Returns 'YYYY-MM-DD' using the SP timezone (mirrors share.ts spDayKey).
function toSPDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // CAP-6: authenticated weekly behavioral-pattern report.
  // Lazy + cached: generated on first access of the day (SP timezone) and served
  // from the `weekly_reports` cache on subsequent accesses.
  app.get('/report/weekly', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Não autorizado' });
    }

    // --- Compute the SP rolling window ---
    // period_end  = today in SP
    // period_start = today - 6 days  (7 days inclusive)
    const cacheRows = await query<WeeklyReportRow>(
      `SELECT user_id,
         to_char(period_start, 'YYYY-MM-DD') AS period_start,
         to_char(period_end,   'YYYY-MM-DD') AS period_end,
         analysis_json,
         generated_at
       FROM weekly_reports WHERE user_id = $1`,
      [userId]
    );

    if (cacheRows.length > 0) {
      const cached = cacheRows[0];
      // Cache is valid when:
      //   period_end = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      //   AND generated_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      //                       AT TIME ZONE 'America/Sao_Paulo'
      // We perform this check in SQL to keep timezone arithmetic server-authoritative.
      const validRows = await query<{ valid: boolean }>(
        `SELECT (
           $1::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
           AND $2::timestamptz >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                                  AT TIME ZONE 'America/Sao_Paulo'
         ) AS valid`,
        [cached.period_end, cached.generated_at]
      );
      if (validRows[0]?.valid) {
        return reply.status(200).send({
          generated_at: cached.generated_at.toISOString(),
          period_start: cached.period_start,
          period_end: cached.period_end,
          analysis: cached.analysis_json,
        });
      }
    }

    // --- Compute dynamic 7-day window in SP ---
    const windowRows = await query<{ period_start: string; period_end: string }>(
      `SELECT
         to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '6 days', 'YYYY-MM-DD') AS period_start,
         to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date,                     'YYYY-MM-DD') AS period_end`,
      []
    );
    const { period_start, period_end } = windowRows[0];

    // --- Load entries for the window ---
    const rawEntries = await query<EntryQueryRow>(
      `SELECT e.created_at,
              ct.name AS context,
              COALESCE(json_agg(json_build_object(
                'description', fi.description,
                'quantity_g',  fi.quantity,
                'kcal',        fi.kcal,
                'protein_g',   fi.protein_g,
                'carbs_g',     fi.carbs_g,
                'fat_g',       fi.fat_g,
                'confidence',  fi.confidence
              ) ORDER BY fi.confidence DESC) FILTER (WHERE fi.id IS NOT NULL), '[]') AS foods
       FROM entries e
       LEFT JOIN food_items fi ON fi.entry_id = e.id
       LEFT JOIN context_tags ct ON ct.id = e.context_tag_id
       WHERE e.user_id = $1
         AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
       GROUP BY e.id, e.created_at, ct.name
       ORDER BY e.created_at ASC`,
      [userId, period_start, period_end]
    );

    // --- Sufficiency guard: need entries in ≥ 3 distinct local SP days ---
    const distinctDays = new Set(rawEntries.map((e) => toSPDateStr(e.created_at)));
    if (distinctDays.size < 3) {
      return reply.status(200).send({ insufficient: true });
    }

    // --- Build PatternEntryInput[] ---
    const entries: PatternEntryInput[] = rawEntries.map((row) => ({
      created_at: row.created_at,
      context: row.context,
      foods: row.foods.map((f) => ({
        // FoodItem shape used by analyzePatterns via formatEntryLine
        id: '',              // not used by analyzePatterns
        entry_id: '',        // not used by analyzePatterns
        description: f.description,
        quantity: f.quantity_g ?? null,
        kcal: f.kcal,
        protein_g: f.protein_g,
        fat_g: f.fat_g,
        carbs_g: f.carbs_g,
        confidence: f.confidence,
      })),
    }));

    // --- Call analyzePatterns (may throw → 502) ---
    let analysis;
    try {
      analysis = await analyzePatterns(entries);
    } catch (err) {
      app.log.error({ err: (err as Error).message }, '[report] weekly pattern analysis failed');
      return reply.status(502).send({ error: 'Não foi possível gerar o relatório' });
    }

    // --- Upsert cache ---
    const upsertResult = await query<{ generated_at: Date }>(
      `INSERT INTO weekly_reports (user_id, period_start, period_end, analysis_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET period_start  = EXCLUDED.period_start,
             period_end    = EXCLUDED.period_end,
             analysis_json = EXCLUDED.analysis_json,
             generated_at  = now()
       RETURNING generated_at`,
      [userId, period_start, period_end, JSON.stringify(analysis)]
    );

    return reply.status(200).send({
      generated_at: upsertResult[0].generated_at.toISOString(),
      period_start,
      period_end,
      analysis,
    });
  });
}
