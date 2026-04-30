import 'dotenv/config';
import { beforeEach, afterAll } from 'vitest';
import { pool } from '../db/client';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL not set');
}
process.env.NODE_ENV = 'test';

function isDbConfigured(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const password = decodeURIComponent(url.password);
    if (password.startsWith('[') && password.endsWith(']')) return false;
    if (!password) return false;
    return true;
  } catch {
    return false;
  }
}

const dbReady = isDbConfigured(process.env.TEST_DATABASE_URL);

beforeEach(async () => {
  if (!dbReady) return;
  await pool.query(
    'TRUNCATE leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  if (dbReady) {
    await pool.end();
  }
});
