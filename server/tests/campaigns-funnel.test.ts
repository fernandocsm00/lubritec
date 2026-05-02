import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage, createDeal,
} from './helpers';
import { getCampaignFunnel } from '../services/campaignsService';

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

    const conv = await createConversation({ phone: lead.phone, leadId: lead.id });
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
});
