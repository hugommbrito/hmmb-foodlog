import { config } from './config';
import { buildApp } from './app';
import { startWorker, closeWorker } from './workers/analyze-entry';
import { closeQueue } from './queues/entry';

const app = buildApp();

try {
  startWorker();
} catch (err) {
  console.error('[server] Worker failed to start:', err);
  process.exit(1);
}

app.listen({ port: config.PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});

async function shutdown(): Promise<void> {
  try {
    await closeWorker();
    await closeQueue();
    await app.close();
  } catch (err) {
    console.error('[server] Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
