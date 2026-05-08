import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { campaignRecipients, campaigns } from '../db/schema';
import {
  createUser,
  createLead,
  createConversation,
  createMessage,
} from './helpers';
import { filterEligibleLeads, COOLDOWN_REASON } from '../services/campaignsCooldown';

async function createCampaign(input: {
  name?: string;
  status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  createdByUserId: string;
}) {
  const [c] = await db.insert(campaigns).values({
    name: input.name ?? 'Test',
    status: input.status ?? 'running',
    messageBody: 'oi',
    createdByUserId: input.createdByUserId,
  }).returning();
  return c;
}

describe('filterEligibleLeads', () => {
  it('lead com outbound há 5h é bloqueado por recent_outbound', async () => {
    const u = await createUser({ role: 'comercial' });
    const lead = await createLead({ phone: '5511900001001' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([]);
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lead com outbound há 25h é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u2@x.com' });
    const lead = await createLead({ phone: '5511900001002' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
    expect(r.blocked).toEqual([]);
  });

  it('lead pendente em campanha running é bloqueado', async () => {
    const u = await createUser({ role: 'comercial', email: 'u3@x.com' });
    const lead = await createLead({ phone: '5511900001003' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'pending_other_campaign' }]);
  });

  it('lead pendente em campanha draft é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u4@x.com' });
    const lead = await createLead({ phone: '5511900001004' });
    const camp = await createCampaign({ status: 'draft', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('excludeCampaignId ignora pendência da própria campanha', async () => {
    const u = await createUser({ role: 'comercial', email: 'u5@x.com' });
    const lead = await createLead({ phone: '5511900001005' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], { excludeCampaignId: camp.id });
    expect(r.eligible).toEqual([lead.id]);
  });

  it('precedência: recent_outbound > pending_other_campaign', async () => {
    const u = await createUser({ role: 'comercial', email: 'u6@x.com' });
    const lead = await createLead({ phone: '5511900001006' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lista vazia retorna eligible=[] blocked=[]', async () => {
    const r = await filterEligibleLeads([], {});
    expect(r).toEqual({ eligible: [], blocked: [] });
  });

  it('mensagem inbound não bloqueia', async () => {
    const lead = await createLead({ phone: '5511900001008' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'in',
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('exporta COOLDOWN_REASON = "cooldown_24h"', () => {
    expect(COOLDOWN_REASON).toBe('cooldown_24h');
  });
});
