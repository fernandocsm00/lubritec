/**
 * Vitest globalSetup — boots an embedded Postgres cluster once for the entire
 * test suite, applies all SQL migrations, and tears it down at the end.
 *
 * The connection string is injected via process.env so the pool in db/client.ts
 * picks it up when the first worker is forked.
 */

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PG_PORT = 15432;
const PG_USER = 'lubritec_test';
const PG_PASSWORD = 'lubritec_test';
const PG_DATABASE = 'lubritec_test';
const SCHEMA = 'lubritec_test';
const DATA_DIR = path.join(os.tmpdir(), 'lubritec-embedded-pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

let embeddedPg: EmbeddedPostgres | null = null;

export async function setup() {
  // Silence embedded-postgres log noise during tests
  embeddedPg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false,
    // initdb herda o locale do SO: num Windows pt-BR o cluster nasce WIN1252 e
    // QUALQUER emoji estoura no insert ("no equivalent in encoding WIN1252") —
    // ex.: os labels de fallback de mídia ("🖼️ Imagem") e o texto que os
    // clientes mandam no WhatsApp, que é cheio de emoji. Produção (Supabase) é
    // UTF8; forçamos aqui pro teste rodar contra o mesmo encoding.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });

  await embeddedPg.initialise();
  await embeddedPg.start();
  await embeddedPg.createDatabase(PG_DATABASE);

  const connStr = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DATABASE}`;

  // Run migrations directly via node-postgres
  const pool = new pg.Pool({ connectionString: connStr });

  // Bootstrap schema in its own dedicated client
  {
    const bootstrapClient = await pool.connect();
    try {
      await bootstrapClient.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    } finally {
      bootstrapClient.release();
    }
  }

  // Run each migration in a fresh client to honour search_path
  const migrationFiles = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of migrationFiles) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}, public`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  await pool.end();

  // Set env vars so all vitest workers (forked AFTER this) pick them up.
  // vitest globalSetup runs synchronously before any worker is spawned, so
  // process.env mutations here ARE visible to workers.
  process.env.TEST_DATABASE_URL = connStr;
  process.env.TEST_DB_SCHEMA = SCHEMA;
  process.env.NODE_ENV = 'test';

  return () => teardown();
}

async function teardown() {
  if (embeddedPg) {
    await embeddedPg.stop().catch(() => {});
    embeddedPg = null;
  }
}

export default setup;
