import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.error('[queue] Redis error:', (err as Error).message));

const queue = new Queue('analyze-entry', { connection });

export async function enqueueAnalysis(entryId: string): Promise<void> {
  await queue.add('analyze-entry', { entryId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

export async function closeQueue(): Promise<void> {
  await queue.close();
  await connection.quit();
}
