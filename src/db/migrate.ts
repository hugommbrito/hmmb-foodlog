import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './client';

async function migrate(): Promise<void> {
  const dir = join(__dirname, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] No migration files found.');
    return;
  }

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    console.log(`[migrate] Applying ${file}...`);
    await pool.query(sql);
  }

  console.log(`[migrate] Done. Applied ${files.length} migration(s).`);
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[migrate] Failed:', (err as Error).message);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
