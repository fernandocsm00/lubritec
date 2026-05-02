import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/deals/history', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/deals/history');
    expect(res.status).toBe(401);
  });

  it('200 retorna deals com closed_at >= 7 dias atrás', async () => {
    const { token, userId } = await loginAs();
    const recent = await createLead({ phone: '11000070001' });
    await createDeal({
      leadId: recent.id, stage: 'ganho', proposalValue: 100, ownerUserId: userId,
      closedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const old = await createLead({ phone: '11000070002' });
    await createDeal({
      leadId: old.id, stage: 'perdido', lossReason: 'preco', proposalValue: 200, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lead.phone).toBe('11000070002');
    expect(res.body.pageSize).toBe(50);
  });

  it('filtra por stage=perdido', async () => {
    const { token, userId } = await loginAs();
    const a = await createLead({ phone: '11000071001' });
    await createDeal({
      leadId: a.id, stage: 'ganho', proposalValue: 300, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const b = await createLead({ phone: '11000071002' });
    await createDeal({
      leadId: b.id, stage: 'perdido', lossReason: 'preco', proposalValue: 400, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history?stage=perdido').set('Authorization', `Bearer ${token}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].stage).toBe('perdido');
  });

  it('filtra por lossReason', async () => {
    const { token, userId } = await loginAs();
    const a = await createLead({ phone: '11000072001' });
    await createDeal({
      leadId: a.id, stage: 'perdido', lossReason: 'preco', proposalValue: 300, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const b = await createLead({ phone: '11000072002' });
    await createDeal({
      leadId: b.id, stage: 'perdido', lossReason: 'sem_retorno', proposalValue: 500, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history?lossReason=preco').set('Authorization', `Bearer ${token}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lossReason).toBe('preco');
  });
});

describe('GET /api/deals/:id', () => {
  it('200 retorna deal + activities', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000073001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app).get(`/api/deals/${d.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(d.id);
    expect(res.body.activities).toBeInstanceOf(Array);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .get('/api/deals/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
