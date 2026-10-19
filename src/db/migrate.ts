import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './client';

// Arbitrary but fixed key for the session-level advisory lock that serializes
// concurrent boots (two instances starting at once must not race on CREATE TABLE).
const MIGRATION_LOCK_KEY = 7_262_001;

// The .sql files live in src/db/migrations. When running from the compiled
// build (dist/db/migrate.js) they are either copied next to it by `npm run
// build` or still available in the source tree two levels up.
function resolveMigrationsDir(): string {
  const candidates = [
    join(__dirname, 'migrations'),
    join(__dirname, '..', '..', 'src', 'db', 'migrations'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(`[migrate] Migrations directory not found. Looked in: ${candidates.join(', ')}`);
  }
  return found;
}

// Applies every migration file, in order, on one connection under an advisory
// lock. Every .sql is idempotent by project convention, so re-running the whole
// set on each call is safe — this is what lets the server run it at boot and
// stay correct on hosts that have no "pre-deploy" hook (Railway had one; the
// current VPS pipeline does not). Resolves with the number of files applied.
export async function runMigrations(): Promise<number> {
  const dir = resolveMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] No migration files found.');
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      for (const file of files) {
        const sql = readFileSync(join(dir, file), 'utf8');
        console.log(`[migrate] Applying ${file}...`);
        await client.query(sql);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  console.log(`[migrate] Done. Applied ${files.length} migration(s).`);
  return files.length;
}

// CLI mode (`npm run db:migrate`): run once and exit. Importing this module from
// the server does NOT trigger this block.
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('[migrate] Failed:', (err as Error).message);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
