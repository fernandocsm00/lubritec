import { describe, it, expect } from 'vitest';
import { listLeads } from '../services/leadsService';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

async function admin() {
  return createUser({ email: `a${Math.random().toString(36).slice(2, 8)}@x.com`, password: 'pw12345', role: 'admin' });
}

describe('listLeads — agregacao de campaigns e filtro campaignIds', () => {
  it('returns empty campaigns array when lead has no recipients', async () => {
    await createLead({ name: 'Solo', phone: '5554911111111' });
    const r = await listLeads({});
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns).toEqual([]);
  });

  it('returns only campaigns with sent_at IS NOT NULL', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Lead A', phone: '5554922222222' });
    const sent = await createCampaign({ name: 'Campanha Enviada', createdByUserId: u.id });
    const pending = await createCampaign({ name: 'Campanha Pendente', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: sent.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01T10:00:00Z') });
    await createCampaignRecipient({ campaignId: pending.id, leadId: lead.id, status: 'pending', sentAt: null });

    const r = await listLeads({});
    expect(r.items[0].campaigns).toHaveLength(1);
    expect(r.items[0].campaigns[0].name).toBe('Campanha Enviada');
  });

  it('orders campaigns desc by sentAt', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Lead B', phone: '5554933333333' });
    const c1 = await createCampaign({ name: 'Campanha Antiga', createdByUserId: u.id });
    const c2 = await createCampaign({ name: 'Campanha Recente', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: c1.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01T10:00:00Z') });
    await createCampaignRecipient({ campaignId: c2.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01T10:00:00Z') });

    const r = await listLeads({});
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['Campanha Recente', 'Campanha Antiga']);
  });

  it('filters with multiple campaignIds (OR semantics)', async () => {
    const u = await admin();
    const inA = await createLead({ name: 'In A', phone: '5554944444444' });
    const inB = await createLead({ name: 'In B', phone: '5554955555555' });
    const inNone = await createLead({ name: 'In none', phone: '5554966666666' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: campA.id, leadId: inA.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: campB.id, leadId: inB.id, status: 'sent', sentAt: new Date() });

    const r = await listLeads({ campaignIds: [campA.id, campB.id] });
    const ids = r.items.map((l) => l.id).sort();
    expect(ids).toEqual([inA.id, inB.id].sort());
    expect(ids).not.toContain(inNone.id);
  });

  it('excludes leads whose recipient is pending when filtering by that campaign', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Pending only', phone: '5554900000001' });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'pending', sentAt: null });

    const r = await listLeads({ campaignIds: [camp.id] });
    expect(r.items).toHaveLength(0);
  });
});
