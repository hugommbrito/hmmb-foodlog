import { Queue, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { AnalyzeEntryJobData } from '../types/models';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.error('[queue] Redis error:', (err as Error).message));

// QueueEvents uses blocking Redis commands, so it needs its own connection.
const eventsConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
eventsConnection.on('error', (err) => console.error('[queue-events] Redis error:', (err as Error).message));

const queue = new Queue<AnalyzeEntryJobData>('analyze-entry', { connection });
const queueEvents = new QueueEvents('analyze-entry', { connection: eventsConnection });

export async function enqueueAnalysis(entryId: string): Promise<Job<AnalyzeEntryJobData>> {
  return queue.add('analyze-entry', { entryId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

// Resolves when the job completes; rejects on job failure or after timeoutMs.
// Callers should treat a rejection as "analysis not ready yet", not a capture failure.
export async function waitForAnalysis(job: Job<AnalyzeEntryJobData>, timeoutMs: number): Promise<void> {
  await job.waitUntilFinished(queueEvents, timeoutMs);
}

export async function closeQueue(): Promise<void> {
  await queueEvents.close();
  await queue.close();
  await connection.quit();
  await eventsConnection.quit();
}
