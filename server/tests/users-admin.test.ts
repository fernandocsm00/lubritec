import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';
import { db } from '../db/client';
import { sessions, authTokens } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = createApp();

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { accessToken: res.body.accessToken as string, cookie: res.headers['set-cookie'] };
}

describe('GET /api/users', () => {
  it.todo('admin list returns users sorted with admin first');
  it.todo('admin list omits password_hash and exposes has_password boolean');
  it.todo('non-admin gets 403');
  it.todo('unauthenticated gets 401');
});

describe('PATCH /api/users/:id', () => {
  it.todo('admin updates name only — no session revoked');
  it.todo('admin changes role — sessions of target user revoked');
  it.todo('admin deactivates user — sessions revoked');
  it.todo('admin cannot change own role — 409');
  it.todo('admin cannot deactivate self — 409');
  it.todo('returns 404 for nonexistent user');
  it.todo('returns 400 for invalid uuid');
  it.todo('returns 400 for empty body');
});

describe('POST /api/users/:id/resend-invite', () => {
  it.todo('admin resends invite — old token invalidated, new token created');
  it.todo('returns 409 if user already activated');
  it.todo('returns 404 for nonexistent user');
});

describe('refresh after deactivation', () => {
  it.todo('refresh returns 401 and revokes session when user is inactive');
});
