import 'dotenv/config';
import { beforeEach, afterAll } from 'vitest';
import { pool } from '../db/client';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL not set');
}
process.env.NODE_ENV = 'test';

const dbReady = !process.env.TEST_DATABASE_URL.includes('[YOUR-DB-PASSWORD]');

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
