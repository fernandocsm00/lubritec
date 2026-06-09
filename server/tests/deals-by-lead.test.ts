import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../app';
import { createLead, createUser } from './helpers';
import { createDeal } from '../services/dealsService';

const app = createApp();

async function loginAs(email: string, password = 'pw12345', role: 'admin' | 'comercial' | 'recepcao' = 'comercial') {
  await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function seedAuth() {
  return loginAs('seed-bylead@x.com', 'pw12345', 'admin');
}

describe('GET /deals/by-lead/:leadId', () => {
  it('retorna o deal vigente quando o lead já está no pipeline', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020001' });
    const owner = await createUser({ email: 'owner-bylead@x.com', role: 'comercial' });
    const deal = await createDeal({
      leadId: lead.id,
      ownerUserId: owner.id,
      source: 'manual',
    });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    expect(res.body.id).toBe(deal.id);
    expect(res.body.lead.id).toBe(lead.id);
    expect(res.body.stage).toBe('lead_no_comercial');
  });

  it('retorna null quando o lead não tem deal', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020002' });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('bloqueia role recepcao com 403', async () => {
    const lead = await createLead({ phone: '11000020003' });
    const token = await loginAs('recep-bylead@x.com', 'pw123456', 'recepcao');

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
