import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { campaignRecipients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead } from './helpers';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('POST /api/campaigns/dry-run', () => {
  it('200 retorna total + preview', async () => {
    await createLead({ phone: '5511000080001', status: 'frio' });
    await createLead({ phone: '5511000080002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ['frio'] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});

describe('POST /api/campaigns', () => {
  it('200 cria campanha + materializa recipients', async () => {
    await createLead({ phone: '5511000090001', status: 'frio' });
    await createLead({ phone: '5511000090002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lembrete frio',
        messageBody: 'Olá {{nome}}, hora de trocar!',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.status).toBe(200);
    expect(res.body.audienceTotal).toBe(2);

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, res.body.id));
    expect(recipients).toHaveLength(2);
  });

  it('snapshot de messageBody preservado mesmo após template mudar', async () => {
    await createLead({ phone: '5511000091001', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'X',
        messageBody: 'Texto original',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.body.messageBody).toBe('Texto original');
  });
});
