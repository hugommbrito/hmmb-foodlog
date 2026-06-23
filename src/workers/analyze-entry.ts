import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import pool, { query } from '../db/client';
import { analyzeEntry } from '../services/ai';
import { Entry, AnalyzeEntryJobData } from '../types/models';

let worker: Worker<AnalyzeEntryJobData> | null = null;
let workerConnection: IORedis | null = null;

async function processJob(job: Job<AnalyzeEntryJobData>): Promise<void> {
  const { entryId, correction } = job.data;

  const entries = await query<Entry>('SELECT * FROM entries WHERE id = $1', [entryId]);
  if (entries.length === 0) {
    console.warn(`[worker] Entry ${entryId} not found, discarding job`);
    return;
  }
  const entry = entries[0];

  // The ai_cycles guard protects the initial-capture path from a duplicate run.
  // A CAP-4 re-analysis always carries a correction, so it is allowed to re-run.
  if (entry.ai_cycles > 0 && !correction) {
    console.warn(`[worker] Entry ${entryId} already analyzed (ai_cycles=${entry.ai_cycles}), skipping`);
    return;
  }

  if (entry.photos.length === 0) {
    console.warn(`[worker] Entry ${entryId} has no photos, skipping`);
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

  const result = await analyzeEntry(entry.photos, recentFoods, correction);

  // A re-analysis that comes back with zero foods must NOT wipe the prior analysis:
  // the DELETE below would commit with no replacement and destroy the user's data.
  // Keep the previous result intact and bail (ai_cycles stays put, so the route
  // reports 'pending'). On initial capture (no correction) an empty result is a
  // legitimate "nothing identified" outcome and is allowed to persist.
  if (correction && result.foods.length === 0) {
    console.warn(`[worker] Re-analysis of ${entryId} returned no foods; keeping previous analysis`);
    return;
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
      `UPDATE entries SET ai_confidence_overall = $2, ai_cycles = ai_cycles + 1, title = $3, reviewed = false WHERE id = $1`,
      [entryId, result.overall_confidence, result.title]
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

export function startWorker(): void {
  if (worker) return;

  workerConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  workerConnection.on('error', (err) => console.error('[worker] Redis error:', (err as Error).message));

  worker = new Worker<AnalyzeEntryJobData>('analyze-entry', processJob, { connection: workerConnection });

  worker.on('failed', (job, err) => {
    console.error(
      `[worker] Job ${job?.id} (entry: ${job?.data?.entryId}) failed:`,
      (err as Error).message
    );
  });

  console.log('[worker] analyze-entry worker started');
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (workerConnection) {
    await workerConnection.quit();
    workerConnection = null;
  }
}
