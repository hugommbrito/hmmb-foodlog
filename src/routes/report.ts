import { FastifyInstance, FastifyRequest } from 'fastify';
import { query } from '../db/client';
import { analyzePatterns } from '../services/ai';
import { EntryQueryRow, PatternEntryInput, ReportQuery, User, WeeklyReportRow } from '../types/models';

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
  // CAP-6 / CAP-6b: authenticated behavioral-pattern report with flexible period.
  // Optional query params: start_date + end_date (YYYY-MM-DD, must be paired);
  // force=true bypasses the daily cache and always re-generates via AI.
  // Without params: defaults to the rolling 7-day window (original CAP-6 behavior).
  app.get<{ Querystring: ReportQuery }>('/report/weekly', async (request, reply) => {
    const userId = await authenticate(request);
    if (!userId) {
      return reply.status(401).send({ error: 'Não autorizado' });
    }

    const { start_date, end_date, force } = request.query;

    // Validate: both or neither; YYYY-MM-DD format; end >= start.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const hasStart = Boolean(start_date?.trim());
    const hasEnd = Boolean(end_date?.trim());
    if (hasStart !== hasEnd) {
      return reply.status(400).send({ error: 'start_date e end_date devem ser fornecidos juntos' });
    }
    if (hasStart && !dateRe.test(start_date!)) {
      return reply.status(400).send({ error: 'start_date deve estar no formato YYYY-MM-DD' });
    }
    if (hasEnd && !dateRe.test(end_date!)) {
      return reply.status(400).send({ error: 'end_date deve estar no formato YYYY-MM-DD' });
    }
    if (hasStart && hasEnd && start_date! > end_date!) {
      return reply.status(400).send({ error: 'end_date deve ser >= start_date' });
    }

    const forceRefresh = force === 'true';

    // --- Resolve period ---
    let periodStart: string;
    let periodEnd: string;

    if (hasStart && hasEnd) {
      periodStart = start_date!;
      periodEnd = end_date!;
    } else {
      // Server-computed rolling 7d window in SP timezone (original CAP-6 behavior).
      const windowRows = await query<{ period_start: string; period_end: string }>(
        `SELECT
           to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '6 days', 'YYYY-MM-DD') AS period_start,
           to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date,                     'YYYY-MM-DD') AS period_end`,
        []
      );
      periodStart = windowRows[0].period_start;
      periodEnd = windowRows[0].period_end;
    }

    // --- Cache lookup (skipped when force=true) ---
    if (!forceRefresh) {
      const cacheRows = await query<WeeklyReportRow>(
        `SELECT user_id,
           to_char(period_start, 'YYYY-MM-DD') AS period_start,
           to_char(period_end,   'YYYY-MM-DD') AS period_end,
           analysis_json,
           generated_at
         FROM weekly_reports
         WHERE user_id    = $1
           AND period_start = $2::date
           AND period_end   = $3::date
           AND generated_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo')`,
        [userId, periodStart, periodEnd]
      );

      if (cacheRows.length > 0) {
        const cached = cacheRows[0];
        return reply.status(200).send({
          generated_at: cached.generated_at.toISOString(),
          period_start: cached.period_start,
          period_end: cached.period_end,
          analysis: cached.analysis_json,
        });
      }
    }

    // --- Load entries for the period ---
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
      [userId, periodStart, periodEnd]
    );

    // --- Sufficiency guard: need entries in ≥3 distinct local SP days ---
    const distinctDays = new Set(rawEntries.map((e) => toSPDateStr(e.created_at)));
    if (distinctDays.size < 3) {
      return reply.status(200).send({ insufficient: true });
    }

    // --- Build PatternEntryInput[] ---
    const entries: PatternEntryInput[] = rawEntries.map((row) => ({
      created_at: row.created_at,
      context: row.context,
      foods: row.foods.map((f) => ({
        id: '',
        entry_id: '',
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
      app.log.error(err, '[report] pattern analysis failed');
      const detail = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: 'Não foi possível gerar o relatório', detail });
    }

    // --- Upsert cache (conflict on the composite key user_id + period) ---
    const upsertResult = await query<{ generated_at: Date }>(
      `INSERT INTO weekly_reports (user_id, period_start, period_end, analysis_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, period_start, period_end) DO UPDATE
         SET analysis_json = EXCLUDED.analysis_json,
             generated_at  = now()
       RETURNING generated_at`,
      [userId, periodStart, periodEnd, JSON.stringify(analysis)]
    );

    return reply.status(200).send({
      generated_at: upsertResult[0].generated_at.toISOString(),
      period_start: periodStart,
      period_end: periodEnd,
      analysis,
    });
  });
}
