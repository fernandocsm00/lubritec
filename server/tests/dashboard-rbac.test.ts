import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';
import { signAccessToken } from '../lib/jwt';

describe('dashboard RBAC', () => {
  it('GET summary view=org as comercial → 403', async () => {
    const app = createApp();
    const u = await createUser({ role: 'comercial' });
    const t = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).get('/api/dashboard/summary?view=org&period=month').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(403);
  });

  it('GET summary view=me as comercial → 200', async () => {
    const app = createApp();
    const u = await createUser({ role: 'comercial' });
    const t = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).get('/api/dashboard/summary?view=me&period=month').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('kpis');
  });

  it('GET summary view=org as admin → 200 with leaderboard', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const t = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).get('/api/dashboard/summary?view=org&period=month').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(200);
    expect(r.body.leaderboard).not.toBeNull();
  });

  it('GET attention works for both roles, scoped accordingly', async () => {
    const app = createApp();
    const ad = await createUser({ role: 'admin' });
    const co = await createUser({ role: 'comercial', email: 'c@x.com' });
    for (const u of [ad, co]) {
      const t = signAccessToken({ userId: u.id, role: u.role });
      const r = await request(app).get(`/api/dashboard/attention?view=${u.role === 'admin' ? 'org' : 'me'}`).set('Authorization', `Bearer ${t}`);
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('items');
    }
  });

  it('GET whatsapp restricted to admin', async () => {
    const app = createApp();
    const co = await createUser({ role: 'comercial' });
    const t = signAccessToken({ userId: co.id, role: co.role });
    const r = await request(app).get('/api/dashboard/whatsapp').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(403);
  });
});
