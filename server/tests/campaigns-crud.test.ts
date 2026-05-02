import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createCampaign } from './helpers';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/campaigns', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const { token } = await loginAs('r@x.com', 'recepcao');
    const res = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 lista paginada', async () => {
    const { token, userId } = await loginAs('a@x.com', 'admin');
    await createCampaign({ name: 'Test 1', createdByUserId: userId });
    const res = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });
});

describe('GET /api/campaigns/:id', () => {
  it('200 retorna campaign + funnel', async () => {
    const { token, userId } = await loginAs('a2@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: userId });
    const res = await request(app).get(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(c.id);
    expect(res.body.funnel).toBeDefined();
    expect(res.body.funnel.totalRecipients).toBe(0);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs('a3@x.com', 'admin');
    const res = await request(app)
      .get('/api/campaigns/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/campaigns/:id', () => {
  it('403 pra comercial (admin only)', async () => {
    const { token: tComm } = await loginAs('c@x.com', 'comercial');
    const { userId: uA } = await loginAs('a4@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: uA });
    const res = await request(app).delete(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${tComm}`);
    expect(res.status).toBe(403);
  });

  it('204 admin deleta', async () => {
    const { token, userId } = await loginAs('a5@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: userId });
    const res = await request(app).delete(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
