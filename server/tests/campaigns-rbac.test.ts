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

describe('Campaigns RBAC', () => {
  it('recepção 403 em GET, POST, dispatch, etc', async () => {
    const { token } = await loginAs('r@x.com', 'recepcao');
    expect((await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({})).status).toBe(403);
  });

  it('comercial pode criar/dispatch/pause/resume/cancel mas não delete', async () => {
    const { token, userId } = await loginAs('c@x.com', 'comercial');
    const c = await createCampaign({ createdByUserId: userId });

    expect((await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    const dispatch = await request(app)
      .post(`/api/campaigns/${c.id}/dispatch`)
      .set('Authorization', `Bearer ${token}`);
    expect(dispatch.status).toBe(200);

    const pause = await request(app)
      .post(`/api/campaigns/${c.id}/pause`)
      .set('Authorization', `Bearer ${token}`);
    expect(pause.status).toBe(200);

    const del = await request(app)
      .delete(`/api/campaigns/${c.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
