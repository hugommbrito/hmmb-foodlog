import { config } from './config';
import { buildApp } from './app';
import { runMigrations } from './db/migrate';

const app = buildApp();

// Migrations run at boot, before the server accepts traffic. They are all
// idempotent, so this is a no-op on an up-to-date schema and it guarantees a
// fresh deploy never serves routes against tables that do not exist yet
// (the host's deploy pipeline is not relied on to run `npm run db:migrate`).
// A failure here is fatal on purpose: better a visible crash than 500s.
async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    app.log.error(err, '[server] Database migration failed; not starting');
    process.exit(1);
  }

  app.listen({ port: config.PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`Server listening at ${address}`);
  });
}

void main();

async function shutdown(): Promise<void> {
  try {
    await app.close();
  } catch (err) {
    console.error('[server] Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
