import { describe, it, expect } from 'vitest';
import { getCampaignById, listCampaigns } from '../services/campaignsService';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

// As contagens sent/failed/skipped exibidas devem vir das linhas de
// campaign_recipients (fonte única), não dos contadores desnormalizados da
// tabela campaigns, que driftavam (mostrava "N ignoradas" sem recipient skipped).

async function seedCampaignWithWrongCounters() {
  const u = await createUser({ email: 'c-counts@x.com', password: 'pw12345', role: 'admin' });
  // Contadores armazenados PROPOSITALMENTE errados (divergentes da realidade).
  const camp = await createCampaign({
    createdByUserId: u.id,
    status: 'completed',
    sentCount: 99,
    failedCount: 99,
    skippedCount: 99,
    audienceTotal: 5,
  });
  const leads = await Promise.all([
    createLead({}), createLead({}), createLead({}), createLead({}), createLead({}),
  ]);
  // Realidade: 2 sent, 1 failed, 2 skipped (1 cooldown + 1 outro motivo).
  await createCampaignRecipient({ campaignId: camp.id, leadId: leads[0].id, status: 'sent' });
  await createCampaignRecipient({ campaignId: camp.id, leadId: leads[1].id, status: 'sent' });
  await createCampaignRecipient({ campaignId: camp.id, leadId: leads[2].id, status: 'failed', failureReason: 'boom' });
  await createCampaignRecipient({ campaignId: camp.id, leadId: leads[3].id, status: 'skipped', failureReason: 'cooldown_24h' });
  await createCampaignRecipient({ campaignId: camp.id, leadId: leads[4].id, status: 'skipped', failureReason: null });
  return camp;
}

describe('campaign counts derivados dos recipients (não dos contadores armazenados)', () => {
  it('getCampaignById retorna contagens REAIS dos recipients', async () => {
    const camp = await seedCampaignWithWrongCounters();
    const pub = await getCampaignById(camp.id);
    expect(pub.sentCount).toBe(2);
    expect(pub.failedCount).toBe(1);
    expect(pub.skippedCount).toBe(2);
    expect(pub.skippedByCooldown).toBe(1);
  });

  it('listCampaigns também usa as contagens reais', async () => {
    const camp = await seedCampaignWithWrongCounters();
    const res = await listCampaigns({});
    const found = res.items.find((c) => c.id === camp.id);
    expect(found).toBeDefined();
    expect(found!.sentCount).toBe(2);
    expect(found!.skippedCount).toBe(2);
    expect(found!.skippedByCooldown).toBe(1);
  });

  it('campanha sem recipients → tudo zero (não herda contador armazenado errado)', async () => {
    const u = await createUser({ email: 'z-counts@x.com', password: 'pw12345', role: 'admin' });
    const camp = await createCampaign({ createdByUserId: u.id, sentCount: 42, skippedCount: 7 });
    const pub = await getCampaignById(camp.id);
    expect(pub.sentCount).toBe(0);
    expect(pub.skippedCount).toBe(0);
  });
});
