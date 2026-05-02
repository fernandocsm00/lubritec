import 'dotenv/config';
import { beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../db/client';
import { __resetRateLimitBuckets } from '../middleware/rateLimit';

// Bloqueia envio real de e-mail nos testes
vi.mock('../lib/mailer', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendResetEmail: vi.fn(async () => {}),
}));

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
  __resetRateLimitBuckets();
  if (!dbReady) return;
  await pool.query(
    'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users, whatsapp_instance RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  if (dbReady) {
    await pool.end();
  }
});
