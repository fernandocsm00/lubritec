import { describe, it, expect } from 'vitest';
import { listLeads, getLeadById } from '../services/leadsService';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

describe('campos de campanha no lead (derivados)', () => {
  it('campaignCount + lastCampaign refletem as participações', async () => {
    const owner = await createUser({ email: 'lcf-owner@x.com', role: 'comercial' });
    const lead = await createLead({ name: 'Lead Campanhas', phone: '11000012001' });

    // Campanha A: enviada há mais tempo. Campanha B: falhou, mas participação mais recente.
    const campA = await createCampaign({ name: 'Campanha A', status: 'completed', createdByUserId: owner.id });
    await createCampaignRecipient({
      campaignId: campA.id, leadId: lead.id, phone: '11000012001',
      status: 'sent', sentAt: new Date('2026-06-01T10:00:00Z'),
    });
    const campB = await createCampaign({ name: 'Campanha B', status: 'running', createdByUserId: owner.id });
    await createCampaignRecipient({
      campaignId: campB.id, leadId: lead.id, phone: '11000012001',
      status: 'failed', sentAt: null,
    });

    const res = await listLeads({ q: 'Lead Campanhas' });
    const item = res.items.find((l) => l.id === lead.id);
    expect(item).toBeDefined();
    expect(item!.campaignCount).toBe(2);
    // B é a participação mais recente (created_at > sent_at da A).
    expect(item!.lastCampaign?.name).toBe('Campanha B');
    expect(item!.lastCampaign?.recipientStatus).toBe('failed');
    expect(item!.lastCampaign?.campaignStatus).toBe('running');

    // getLeadById devolve os mesmos campos.
    const byId = await getLeadById(lead.id);
    expect(byId.campaignCount).toBe(2);
    expect(byId.lastCampaign?.name).toBe('Campanha B');
  });

  it('lead sem campanha → count 0 e lastCampaign null', async () => {
    const lead = await createLead({ name: 'Sem Campanha', phone: '11000012010' });
    const res = await listLeads({ q: 'Sem Campanha' });
    const item = res.items.find((l) => l.id === lead.id);
    expect(item!.campaignCount).toBe(0);
    expect(item!.lastCampaign).toBeNull();

    const byId = await getLeadById(lead.id);
    expect(byId.campaignCount).toBe(0);
    expect(byId.lastCampaign).toBeNull();
  });
});
