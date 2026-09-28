import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { campaigns, deals } from '../db/schema';
import { createApp } from '../app';
import {
  createUser, createLead, createDeal, createCampaign, createCampaignRecipient,
} from './helpers';

const MIGRATION_049 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../db/migrations/049_deals_campaign.sql',
);
const DAY = 86_400_000;

async function campaignOf(dealId: string) {
  const [row] = await db.select({ c: deals.campaignId }).from(deals).where(eq(deals.id, dealId));
  return row.c;
}

describe('migration 049 — campanha no card', () => {
  it('backfill: campanha do último disparo ao lead ANTES da criação do card', async () => {
    const u = await createUser({ email: 'a@x.com' });
    const lead = await createLead({ phone: '5554990000001' });
    const maio = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
    const julho = await createCampaign({ name: 'Disparo Julho', createdByUserId: u.id });
    const setembro = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: maio.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-20T12:00:00Z') });
    await createCampaignRecipient({ campaignId: julho.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-07-10T12:00:00Z') });
    await createCampaignRecipient({ campaignId: setembro.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-09-25T12:42:00Z') });
    const ganhoJulho = await createDeal({
      leadId: lead.id, stage: 'ganho', proposalValue: 100,
      closedAt: new Date('2026-07-20T00:00:00Z'), createdAt: new Date('2026-07-12T00:00:00Z'),
    });
    const abertoMaio = await createDeal({
      leadId: lead.id, stage: 'lead_no_comercial', createdAt: new Date('2026-05-27T00:00:00Z'),
    });
    const semDisparo = await createDeal({
      leadId: (await createLead({ phone: '5554990000002' })).id, stage: 'lead_no_comercial',
    });

    await pool.query(await readFile(MIGRATION_049, 'utf-8'));

    expect(await campaignOf(abertoMaio.id)).toBe(maio.id);
    expect(await campaignOf(ganhoJulho.id)).toBe(julho.id);
    expect(await campaignOf(semDisparo.id)).toBeNull();
  });

  it('não mexe em etapa e marca como varridas só as campanhas já vencidas', async () => {
    const u = await createUser({ email: 'b@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - 3 * DAY),
    });
    const vigente = await createCampaign({
      name: 'Vigente', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const antiga = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });
    const lead = await createLead({ phone: '5554990000003' });
    await createCampaignRecipient({
      campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY),
    });
    const card = await createDeal({
      leadId: lead.id, stage: 'proposta_enviada', createdAt: new Date(Date.now() - 8 * DAY),
    });

    await pool.query(await readFile(MIGRATION_049, 'utf-8'));

    const [c] = await db.select().from(deals).where(eq(deals.id, card.id));
    expect(c.stage).toBe('proposta_enviada');
    expect(c.campaignId).toBe(vencida.id);
    const swept = async (id: string) =>
      (await db.select({ at: campaigns.cardsClosedAt }).from(campaigns).where(eq(campaigns.id, id)))[0].at;
    expect(await swept(vencida.id)).not.toBeNull();
    expect(await swept(vigente.id)).toBeNull();
    expect(await swept(antiga.id)).toBeNull();
  });
});

describe('índice: um card aberto por lead por campanha', () => {
  it('aceita abertos de campanhas diferentes e recusa dois do mesmo balde', async () => {
    const u = await createUser({ email: 'c@x.com' });
    const a = await createCampaign({ name: 'A', createdByUserId: u.id });
    const b = await createCampaign({ name: 'B', createdByUserId: u.id });
    const lead = await createLead({ phone: '5554990000004' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: a.id });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', campaignId: b.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: null });

    await expect(
      createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: a.id }),
    ).rejects.toThrow();
    await expect(
      createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: null }),
    ).rejects.toThrow();
  });
});

describe('motivo "Campanha encerrada" é só do sistema', () => {
  it('a API recusa mover card pra perdido com campanha_encerrada', async () => {
    const app = createApp();
    await createUser({ email: 'v@x.com', password: 'pw12345', role: 'comercial' });
    const login = await request(app).post('/api/auth/login').send({ email: 'v@x.com', password: 'pw12345' });
    const lead = await createLead({ phone: '5554990000005' });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });

    const res = await request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ stage: 'perdido', lossReason: 'campanha_encerrada', leadQualityFeedback: 'good' });
    expect(res.status).toBe(400);
  });
});
