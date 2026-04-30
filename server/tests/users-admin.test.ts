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
  it('admin list returns users sorted with admin first then by name', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin', name: 'Zed Admin' });
    await createUser({ email: 'a@b.com', password: 'pw12345', role: 'comercial', name: 'Alice' });
    await createUser({ email: 'b@b.com', password: 'pw12345', role: 'recepcao', name: 'Bob' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.users[0].email).toBe('admin@b.com');
    expect(res.body.users[1].name).toBe('Alice');
    expect(res.body.users[2].name).toBe('Bob');
  });

  it('admin list omits password_hash and exposes has_password boolean', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    await createUser({ email: 'pending@b.com', name: 'Pending', role: 'comercial' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const pending = res.body.users.find((u: { email: string }) => u.email === 'pending@b.com');
    expect(pending).toBeDefined();
    expect(pending.has_password).toBe(false);
    expect('password_hash' in pending).toBe(false);
    const admin = res.body.users.find((u: { email: string }) => u.email === 'admin@b.com');
    expect(admin.has_password).toBe(true);
  });

  it('non-admin gets 403', async () => {
    await createUser({ email: 'com@b.com', password: 'pw12345', role: 'comercial' });
    const { accessToken } = await loginAs('com@b.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
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
