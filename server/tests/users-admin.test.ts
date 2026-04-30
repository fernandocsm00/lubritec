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
  it('admin updates name only — no session revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial', name: 'Old' });
    await loginAs('t@b.com'); // cria session
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt === null)).toBe(true);
  });

  it('admin changes role — sessions of target user revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial' });
    await loginAs('t@b.com');
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'recepcao' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('recepcao');
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('admin deactivates user — sessions revoked', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const target = await createUser({ email: 't@b.com', password: 'pw12345', role: 'comercial' });
    await loginAs('t@b.com');
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
    const targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('admin cannot change own role — 409', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'comercial' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/own role or status/i);
  });

  it('admin cannot deactivate self — 409', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(409);
  });

  it('admin can update own name (no role/status fields)', async () => {
    const admin = await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin', name: 'Before' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'After' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('After');
  });

  it('returns 404 for nonexistent user', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid uuid', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch('/api/users/not-a-uuid')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    const target = await createUser({ email: 't@b.com', role: 'comercial' });
    await createUser({ email: 'admin@b.com', password: 'pw12345', role: 'admin' });
    const { accessToken } = await loginAs('admin@b.com');
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/users/:id/resend-invite', () => {
  it.todo('admin resends invite — old token invalidated, new token created');
  it.todo('returns 409 if user already activated');
  it.todo('returns 404 for nonexistent user');
});

describe('refresh after deactivation', () => {
  it.todo('refresh returns 401 and revokes session when user is inactive');
});
