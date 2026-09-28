import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { campaigns, deals } from '../db/schema';
import { createUser, createLead, createDeal, createCampaign } from './helpers';

const app = createApp();
const DAY = 86_400_000;
let seq = 0;

async function loginAs(role: 'admin' | 'comercial' | 'recepcao') {
  seq += 1;
  const email = `${role}${seq}@x.com`;
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function newLead() {
  seq += 1;
  return createLead({ phone: `55549900${String(seq).padStart(5, '0')}` });
}

describe('POST /api/campaigns/:id/end', () => {
  it('403 pra recepção', async () => {
    const { token, userId } = await loginAs('recepcao');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed' });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('400 enquanto o disparo não terminou', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({ createdByUserId: userId, status: 'running' });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('400 pra campanha contínua', async () => {
    const { token, userId } = await loginAs('admin');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed', isContinuous: true });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('fecha os cards abertos, termina a vigência agora e marca como varrida', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      name: 'Teste Andrei III', createdByUserId: userId, status: 'completed',
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const card = await createDeal({ leadId: (await newLead()).id, stage: 'proposta_enviada', campaignId: c.id });
    const before = Date.now();

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ closedCards: 1 });
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.validityEnd!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(camp.validityEnd!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(camp.cardsClosedAt).not.toBeNull();
    const [d] = await db.select().from(deals).where(eq(deals.id, card.id));
    expect(d.stage).toBe('perdido');
    expect(d.lossReason).toBe('campanha_encerrada');
  });

  it('campanha antiga já marcada como varrida no deploy: o botão fecha mesmo assim', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      name: 'Campanha Teste', createdByUserId: userId, status: 'completed',
      cardsClosedAt: new Date(Date.now() - DAY),
    });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id });

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ closedCards: 1 });
  });

  it('início da vigência no futuro vira agora (sem violar a ordem início ≤ fim)', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      createdByUserId: userId, status: 'cancelled',
      validityStart: new Date(Date.now() + 2 * DAY), validityEnd: new Date(Date.now() + 9 * DAY),
    });

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.validityStart!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('GET /api/campaigns/:id — openCardsCount', () => {
  it('conta os cards abertos da campanha', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed' });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', campaignId: c.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'ganho', proposalValue: 1, closedAt: new Date(), campaignId: c.id });

    const res = await request(app).get(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.openCardsCount).toBe(2);
  });
});

describe('DELETE /api/campaigns/:id', () => {
  it('lead com card aberto da campanha E card aberto sem campanha: apaga sem 500, fecha só o card da campanha', async () => {
    const { token, userId } = await loginAs('admin');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed' });
    const lead = await newLead();
    const daCampanha = await createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: c.id });
    const semCampanha = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: null });

    const res = await request(app).delete(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    const [semCampanhaAfter] = await db.select().from(deals).where(eq(deals.id, semCampanha.id));
    expect(semCampanhaAfter.stage).toBe('lead_no_comercial');
    const [daCampanhaAfter] = await db.select().from(deals).where(eq(deals.id, daCampanha.id));
    expect(daCampanhaAfter.stage).toBe('perdido');
    expect(daCampanhaAfter.lossReason).toBe('campanha_encerrada');
    expect(daCampanhaAfter.campaignId).toBeNull();
  });
});
