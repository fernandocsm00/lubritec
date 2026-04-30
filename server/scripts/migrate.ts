import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, SCHEMA_NAME } from '../db/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

async function ensureSchemaAndMigrationsTable() {
  // Schema name was validated in client.ts at import time.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
  // search_path is set by pool.on('connect') so this lands in SCHEMA_NAME.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM _migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  console.log(`Running migrations against schema "${SCHEMA_NAME}"`);
  await ensureSchemaAndMigrationsTable();
  const applied = await appliedSet();
  const all = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of all) {
    if (applied.has(filename)) {
      console.log(`✓ ${filename} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [
        filename,
      ]);
      await client.query('COMMIT');
      console.log(`→ ${filename} (applied)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${filename} (failed):`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('Migrations done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
