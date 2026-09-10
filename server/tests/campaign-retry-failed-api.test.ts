import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';
import { INTERRUPTED_MID_SEND_REASON } from '../services/campaignsDispatcher';

const app = createApp();
let seq = 0;

async function loginAs(role: 'admin' | 'comercial' | 'recepcao') {
  const email = `rfa${++seq}@x.com`;
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

async function completedCampaignWithFailures(userId: string) {
  const c = await createCampaign({
    createdByUserId: userId, status: 'completed', failedCount: 2, completedAt: new Date(),
  });
  const l1 = await createLead({});
  const l2 = await createLead({});
  await createCampaignRecipient({
    campaignId: c.id, leadId: l1.id, status: 'failed', failureReason: 'UazAPI error 400',
  });
  await createCampaignRecipient({
    campaignId: c.id, leadId: l2.id, status: 'failed', failureReason: INTERRUPTED_MID_SEND_REASON,
  });
  return c;
}

describe('POST /api/campaigns/:id/retry-failed', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/campaigns/x/retry-failed');
    expect(res.status).toBe(401);
  });

  it('403 para recepção', async () => {
    const { token } = await loginAs('recepcao');
    const res = await request(app)
      .post('/api/campaigns/00000000-0000-0000-0000-000000000000/retry-failed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('comercial reenfileira e recebe a contagem do que ficou de fora', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await completedCampaignWithFailures(userId);

    const res = await request(app)
      .post(`/api/campaigns/${c.id}/retry-failed`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.requeued).toBe(1);
    expect(res.body.skippedInterrupted).toBe(1);
    expect(res.body.campaignStatus).toBe('running');
  });

  it('404 para campanha inexistente', async () => {
    const { token } = await loginAs('admin');
    const res = await request(app)
      .post('/api/campaigns/00000000-0000-0000-0000-000000000000/retry-failed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('400 para campanha cancelada', async () => {
    const { token, userId } = await loginAs('admin');
    const c = await createCampaign({ createdByUserId: userId, status: 'cancelled' });

    const res = await request(app)
      .post(`/api/campaigns/${c.id}/retry-failed`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});
