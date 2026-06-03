import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('GET /api/users/assignable', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/users/assignable');
    expect(res.status).toBe(401);
  });

  it('200 para qualquer role autenticada (admin, comercial, recepcao)', async () => {
    const tAdmin = await loginAs('aa@x.com', 'admin');
    const tCom = await loginAs('cc@x.com', 'comercial');
    const tRec = await loginAs('rr@x.com', 'recepcao');

    for (const t of [tAdmin, tCom, tRec]) {
      const res = await request(app).get('/api/users/assignable').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    }
  });

  it('só lista admin/comercial ativos; não inclui recepcao', async () => {
    const tAdmin = await loginAs('a2@x.com', 'admin');
    await createUser({ email: 'c2@x.com', password: 'pw12345', role: 'comercial' });
    await createUser({ email: 'r2@x.com', password: 'pw12345', role: 'recepcao' });

    const res = await request(app).get('/api/users/assignable').set('Authorization', `Bearer ${tAdmin}`);
    const roles = res.body.users.map((u: { role: string }) => u.role);
    expect(roles).toContain('admin');
    expect(roles).toContain('comercial');
    expect(roles).not.toContain('recepcao');

    const sample = res.body.users[0];
    expect(Object.keys(sample).sort()).toEqual(['id', 'name', 'role']);
  });

  it('GET /api/users continua 403 pra comercial e recepcao', async () => {
    const tCom = await loginAs('c3@x.com', 'comercial');
    const tRec = await loginAs('r3@x.com', 'recepcao');
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${tCom}`)).status).toBe(403);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${tRec}`)).status).toBe(403);
  });
});

describe('GET /api/users/conversation-assignees', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/users/conversation-assignees');
    expect(res.status).toBe(401);
  });

  it('inclui admin, comercial E recepcao ativos', async () => {
    const tAdmin = await loginAs('a4@x.com', 'admin');
    await createUser({ email: 'c4@x.com', password: 'pw12345', role: 'comercial' });
    await createUser({ email: 'r4@x.com', password: 'pw12345', role: 'recepcao' });

    const res = await request(app)
      .get('/api/users/conversation-assignees')
      .set('Authorization', `Bearer ${tAdmin}`);
    expect(res.status).toBe(200);
    const roles = res.body.users.map((u: { role: string }) => u.role);
    expect(roles).toContain('admin');
    expect(roles).toContain('comercial');
    expect(roles).toContain('recepcao');
  });
});
