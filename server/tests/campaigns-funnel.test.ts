import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage, createDeal,
} from './helpers';
import { getCampaignFunnel } from '../services/campaignsService';
import { db } from '../db/client';
import { campaigns, campaignRecipients } from '../db/schema';

describe('getCampaignFunnel', () => {
  it('contadores básicos: sent/failed/skipped/total', async () => {
    const u = await createUser({ email: 'a@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const l1 = await createLead({ phone: '5511000200001' });
    const l2 = await createLead({ phone: '5511000200002' });
    const l3 = await createLead({ phone: '5511000200003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: c.id, leadId: l2.id, status: 'failed' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l3.id, status: 'pending' });

    const f = await getCampaignFunnel(c.id);
    expect(f.totalRecipients).toBe(3);
    expect(f.sent).toBe(1);
    expect(f.failed).toBe(1);
    expect(f.skipped).toBe(0);
  });

  it('replied conta leads que mandaram inbound após sent_at do recipient', async () => {
    const u = await createUser({ email: 'a2@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const lead = await createLead({ phone: '5511000201001' });

    const conv = await createConversation({ phone: lead.phone ?? undefined, leadId: lead.id });
    const sentAt = new Date(Date.now() - 60 * 1000);
    await createCampaignRecipient({
      campaignId: c.id, leadId: lead.id, status: 'sent', sentAt,
    });

    await createMessage({
      conversationId: conv.id,
      direction: 'in',
      body: 'oi sim',
      sentAt: new Date(),
    });

    const f = await getCampaignFunnel(c.id);
    expect(f.replied).toBe(1);
  });

  it('inDeal/won/lost contam corretamente baseados em deals', async () => {
    const u = await createUser({ email: 'a3@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });

    const l1 = await createLead({ phone: '5511000202001' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l1.id, stage: 'em_negociacao', proposalValue: 200, ownerUserId: u.id });

    const l2 = await createLead({ phone: '5511000202002' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l2.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l2.id, stage: 'ganho', proposalValue: 500, ownerUserId: u.id });

    const l3 = await createLead({ phone: '5511000202003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l3.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l3.id, stage: 'perdido', lossReason: 'preco', proposalValue: 300, ownerUserId: u.id });

    const f = await getCampaignFunnel(c.id);
    expect(f.inDeal).toBe(1);
    expect(f.won).toBe(1);
    expect(f.lost).toBe(1);
    expect(f.totalWonValue).toBe(500);
    expect(f.lostByReason.preco).toBe(1);
  });

  it('separa skippedByCooldown de skippedOther', async () => {
    const u = await createUser({ role: 'comercial', email: 'fn1@x.com' });
    const lead1 = await createLead({ phone: '5511900070001' });
    const lead2 = await createLead({ phone: '5511900070002' });
    const lead3 = await createLead({ phone: '5511900070003' });

    const [c] = await db.insert(campaigns).values({
      name: 'fn-cooldown',
      status: 'running',
      messageBody: 'oi',
      audienceTotal: 3,
      createdByUserId: u.id,
    }).returning();

    await db.insert(campaignRecipients).values([
      { campaignId: c.id, leadId: lead1.id, phone: lead1.phone!, status: 'sent' },
      { campaignId: c.id, leadId: lead2.id, phone: lead2.phone!, status: 'skipped', failureReason: 'cooldown_24h' },
      { campaignId: c.id, leadId: lead3.id, phone: lead3.phone!, status: 'skipped', failureReason: 'uazapi: 401 unauthorized' },
    ]);

    const f = await getCampaignFunnel(c.id);
    expect(f.sent).toBe(1);
    expect(f.skipped).toBe(2);
    expect(f.skippedByCooldown).toBe(1);
    expect(f.skippedOther).toBe(1);
  });
});
