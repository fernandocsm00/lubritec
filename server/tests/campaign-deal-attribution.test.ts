import { describe, it, expect } from 'vitest';
import {
  getCampaignFunnel, getCampaignFunnelsBatch, getTopCampaigns,
  getCampaignsAggregateStats, getCampaignsTimeseries,
} from '../services/campaignsService';
import { buildCampaignReport } from '../services/campaignReportService';
import { createUser, createLead, createCampaign, createCampaignRecipient, createDeal } from './helpers';

const DAY = 86_400_000;

/** Samuel recebeu as duas campanhas; ganhou na primeira e tem card aberto na segunda. */
async function seed() {
  const u = await createUser({ email: 'attr@x.com', role: 'admin' });
  const a = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id, status: 'completed' });
  const b = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id, status: 'completed' });
  const lead = await createLead({ phone: '5554991921858', name: 'Samuel' });
  await createCampaignRecipient({ campaignId: a.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 10 * DAY) });
  await createCampaignRecipient({ campaignId: b.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });
  await createDeal({
    leadId: lead.id, stage: 'ganho', proposalValue: 700,
    closedAt: new Date(Date.now() - 2 * DAY), campaignId: a.id,
  });
  await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: b.id });
  return { a, b };
}

describe('card conta só na campanha dele', () => {
  it('funil de cada campanha (e o lote igual ao individual)', async () => {
    const { a, b } = await seed();
    const fa = await getCampaignFunnel(a.id);
    const fb = await getCampaignFunnel(b.id);

    expect([fa.won, fa.inDeal, fa.totalWonValue]).toEqual([1, 0, 700]);
    expect([fb.won, fb.inDeal, fb.totalWonValue]).toEqual([0, 1, 0]);

    const batch = await getCampaignFunnelsBatch([a.id, b.id]);
    expect(batch.get(a.id)).toEqual(fa);
    expect(batch.get(b.id)).toEqual(fb);
  });

  it('relatório em Excel', async () => {
    const { a, b } = await seed();
    const ra = await buildCampaignReport(a.id);
    const rb = await buildCampaignReport(b.id);
    expect([ra.phases.ganho.length, ra.phases.em_negociacao.length]).toEqual([1, 0]);
    expect([rb.phases.ganho.length, rb.phases.em_negociacao.length]).toEqual([0, 1]);
  });

  it('ranking, totais e série diária', async () => {
    await seed();
    const start = new Date(Date.now() - 30 * DAY);
    const end = new Date(Date.now() + DAY);

    const top = await getTopCampaigns({ start, end });
    const byName = Object.fromEntries(top.map((t) => [t.name, t]));
    expect(byName['Campanha Teste'].won).toBe(1);
    expect(byName['Teste Andrei III'].won).toBe(0);

    const agg = await getCampaignsAggregateStats({ start, end });
    expect(agg.totalWon).toBe(1);
    expect(agg.totalInDeal).toBe(1);
    expect(agg.totalWonValue).toBe(700);

    const series = await getCampaignsTimeseries({ start, end });
    expect(series.reduce((s, x) => s + x.won, 0)).toBe(1);
  });

  it('lead com dois cards da mesma campanha (recompra) não dobra o sent no ranking', async () => {
    const u = await createUser({ email: 'attr2@x.com', role: 'admin' });
    const a = await createCampaign({ name: 'Recompra Campanha', createdByUserId: u.id, status: 'completed' });
    const lead = await createLead({ phone: '5554991921900', name: 'Diana' });
    // Um único disparo (um recipient), mas o lead acumulou dois cards da
    // campanha: o ganho de um ciclo anterior e o aberto do ciclo de recompra.
    await createCampaignRecipient({ campaignId: a.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });
    await createDeal({
      leadId: lead.id, stage: 'ganho', proposalValue: 500,
      closedAt: new Date(Date.now() - DAY), campaignId: a.id,
    });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', campaignId: a.id });

    const start = new Date(Date.now() - 30 * DAY);
    const end = new Date(Date.now() + DAY);
    const top = await getTopCampaigns({ start, end });
    const byName = Object.fromEntries(top.map((t) => [t.name, t]));

    expect(byName['Recompra Campanha'].sent).toBe(1);
  });
});
