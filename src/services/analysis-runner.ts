import pool, { query } from '../db/client';
import { analyzeEntry } from './ai';
import { Entry } from '../types/models';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeOnce(entryId: string, correction?: string, description?: string): Promise<void> {
  const entries = await query<Entry>('SELECT * FROM entries WHERE id = $1', [entryId]);
  if (entries.length === 0) {
    console.warn(`[analysis] Entry ${entryId} not found, discarding`);
    return;
  }
  const entry = entries[0];

  // The ai_cycles guard protects the initial-capture path from a duplicate run.
  // A CAP-4 re-analysis always carries a correction, so it is allowed to re-run.
  if (entry.ai_cycles > 0 && !correction) {
    console.warn(`[analysis] Entry ${entryId} already analyzed (ai_cycles=${entry.ai_cycles}), skipping`);
    return;
  }

  // A manual web entry carries a text description instead of a photo, so a
  // photoless entry is only a no-op when there's nothing to analyze at all.
  // A correction also counts: re-analyzing/correcting a text-only entry (CAP-4
  // edits or a CAP-5 WhatsApp reply) carries `correction` but no `description`,
  // and must NOT be silently skipped here.
  if (entry.photos.length === 0 && !description && !correction) {
    console.warn(`[analysis] Entry ${entryId} has no photos, description, or correction, skipping`);
    return;
  }

  const recentFoodsRows = await query<{ description: string }>(
    `SELECT fi.description FROM food_items fi
     JOIN entries e ON fi.entry_id = e.id
     WHERE e.user_id = $1
     GROUP BY fi.description ORDER BY COUNT(*) DESC LIMIT 20`,
    [entry.user_id]
  );
  const recentFoods = recentFoodsRows.map((r) => r.description);

  // CAP-9: the user's context tags are offered to the AI as the allowed set.
  const tags = await query<{ id: string; name: string }>(
    'SELECT id, name FROM context_tags WHERE user_id = $1',
    [entry.user_id]
  );

  const result = await analyzeEntry(entry.photos, recentFoods, tags.map((t) => t.name), correction, description);

  // Map the AI's suggested context name back to a tag id, but only when the entry
  // has no tag yet — never clobber a context the user picked (incl. on re-analysis).
  let contextTagId = entry.context_tag_id;
  if (contextTagId == null && result.context) {
    const match = tags.find((t) => t.name.toLowerCase() === result.context!.toLowerCase());
    if (match) {
      contextTagId = match.id;
    } else {
      console.warn(`[analysis] Entry ${entryId}: AI suggested context "${result.context}" with no matching tag`);
    }
  }

  // A re-analysis that comes back with zero foods must NOT wipe the prior analysis:
  // the DELETE below would commit with no replacement and destroy the user's data.
  // Only bail when there are existing food_items to protect — if the prior analysis
  // was also empty (e.g. initial capture returned nothing), allow the transaction to
  // proceed so ai_cycles advances and the entry exits the pending loop.
  // On initial capture (no correction) an empty result is a legitimate "nothing
  // identified" outcome and is allowed to persist.
  if (correction && result.foods.length === 0) {
    const existingRows = await query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM food_items WHERE entry_id = $1',
      [entryId]
    );
    if (Number(existingRows[0]?.count ?? 0) > 0) {
      console.warn(`[analysis] Re-analysis of ${entryId} returned no foods; keeping previous analysis`);
      return;
    }
  }

  // DELETE + INSERT + UPDATE run in ONE transaction so a re-analysis either fully
  // replaces the food_items or (on failure → rollback) leaves the prior analysis
  // intact — never an intermediate state with no items. A re-analysis also resets
  // reviewed=false so the user re-checks the new result (no-op on initial capture).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM food_items WHERE entry_id = $1', [entryId]);
    await client.query(
      // COALESCE keeps any context the user picked while analysis was running
      // (read-then-write race) — the AI suggestion only fills an empty slot.
      `UPDATE entries SET ai_confidence_overall = $2, ai_cycles = ai_cycles + 1, title = $3, reviewed = false, context_tag_id = COALESCE(context_tag_id, $4) WHERE id = $1`,
      [entryId, result.overall_confidence, result.title, contextTagId]
    );
    for (const food of result.foods) {
      await client.query(
        `INSERT INTO food_items (entry_id, description, quantity, kcal, protein_g, fat_g, carbs_g, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [entryId, food.description, food.quantity, food.kcal, food.protein_g, food.fat_g, food.carbs_g, food.confidence]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Retries like the old BullMQ job options (`attempts: 3, backoff: { type: 'exponential', delay: 1000 }`).
export async function runAnalysis(entryId: string, correction?: string, description?: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await analyzeOnce(entryId, correction, description);
      return;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      console.error(`[analysis] Entry ${entryId} attempt ${attempt} failed, retrying:`, (err as Error).message);
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
}

// Runs the analysis and races it against timeoutMs. If the timeout wins, this
// rejects but the analysis keeps running (it's a plain in-process promise, not
// tied to the caller) — its retries and DB writes complete independently, so a
// later GET picks up the result. Callers must treat a rejection as "not ready
// yet", never as a capture failure (mirrors the old queue's wait-with-timeout
// contract, without needing a persistent worker/Redis connection).
export function waitForAnalysis(
  entryId: string,
  timeoutMs: number,
  correction?: string,
  description?: string
): Promise<void> {
  const analysis = runAnalysis(entryId, correction, description);
  analysis.catch(() => {}); // avoid an unhandled rejection if the timeout below wins the race
  return Promise.race([
    analysis,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Analysis timed out')), timeoutMs)),
  ]);
}
