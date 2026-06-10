import { describe, it, expect } from 'vitest';
import { listBoard, listHistory } from '../services/dealsService';
import {
  createUser,
  createLead,
  createCampaign,
  createCampaignRecipient,
  createDeal,
} from './helpers';

async function admin() {
  return createUser({
    email: `a${Math.random().toString(36).slice(2, 8)}@x.com`,
    password: 'pw12345',
    role: 'admin',
  });
}

const userCtx = {
  ownerFilter: 'all' as const,
  currentUserId: '00000000-0000-0000-0000-000000000000',
};

describe('listBoard — agregacao de campaigns e filtro campaignIds', () => {
  it('attaches empty campaigns when deal lead has no sent recipient', async () => {
    const lead = await createLead({ name: 'No camp', phone: '5554911111111' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    expect(r.stages.lead_no_comercial[0].campaigns).toEqual([]);
  });

  it('attaches sent campaigns to deal, desc-ordered', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Multi', phone: '5554922222222' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const ca = await createCampaign({ name: 'Antiga', createdByUserId: u.id });
    const cr = await createCampaign({ name: 'Recente', createdByUserId: u.id });
    await createCampaignRecipient({
      campaignId: ca.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date('2026-01-01'),
    });
    await createCampaignRecipient({
      campaignId: cr.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date('2026-05-01'),
    });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Multi');
    expect(deal).toBeDefined();
    expect(deal!.campaigns.map((c) => c.name)).toEqual(['Recente', 'Antiga']);
  });

  it('filters board by campaignIds (OR)', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'In A', phone: '5554933333333' });
    const leadB = await createLead({ name: 'In B', phone: '5554944444444' });
    const leadN = await createLead({ name: 'In none', phone: '5554955555555' });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadN.id, stage: 'lead_no_comercial' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createCampaignRecipient({
      campaignId: campA.id,
      leadId: leadA.id,
      status: 'sent',
      sentAt: new Date(),
    });
    await createCampaignRecipient({
      campaignId: campB.id,
      leadId: leadB.id,
      status: 'sent',
      sentAt: new Date(),
    });
    const r = await listBoard({ ...userCtx, campaignIds: [campA.id, campB.id] });
    const names = r.stages.lead_no_comercial.map((d) => d.lead.name).sort();
    expect(names).toEqual(['In A', 'In B']);
  });
});

describe('listHistory — campaigns', () => {
  it('attaches campaigns and filters by campaignIds', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Won', phone: '5554900000001' });
    // closedAt must be older than KANBAN_TERMINAL_VISIBLE_DAYS (7 days) to show in history
    const oldClosed = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await createDeal({ leadId: lead.id, stage: 'ganho', closedAt: oldClosed });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    await createCampaignRecipient({
      campaignId: camp.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date(),
    });
    const r = await listHistory({ ...userCtx, campaignIds: [camp.id] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['A']);
  });
});
