import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email: string, password = 'pw12345', role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('Deals RBAC', () => {
  it('recepcao recebe 403 em GET /api/deals', async () => {
    const { token } = await loginAs('r1@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em GET /api/deals/history', async () => {
    const { token } = await loginAs('r2@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em POST /api/deals', async () => {
    const { token } = await loginAs('r3@x.com', 'pw12345', 'recepcao');
    const lead = await createLead({ phone: '11000090001' });
    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id });
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em PATCH /api/deals/:id', async () => {
    const { token } = await loginAs('r4@x.com', 'pw12345', 'recepcao');
    const { userId: cId } = await loginAs('c5@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000090010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: cId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ proposalValue: 100 });
    expect(res.status).toBe(403);
  });

  it('comercial pode tudo exceto deletar', async () => {
    const { token, userId } = await loginAs('c6@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000090020' });

    const post = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id, proposalValue: 200 });
    expect(post.status).toBe(200);

    const dealId = post.body.id;

    const patch = await request(app)
      .patch(`/api/deals/${dealId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'teste' });
    expect(patch.status).toBe(200);

    const stage = await request(app)
      .post(`/api/deals/${dealId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(stage.status).toBe(200);

    const del = await request(app).delete(`/api/deals/${dealId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
