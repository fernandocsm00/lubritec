import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { summary } from '../services/dashboardService';
import { createUser, createLead, createDeal, createConversation } from './helpers';
import { db } from '../db/client';
import { orgSettings } from '../db/schema';
import { signAccessToken } from '../lib/jwt';

const app = createApp();

async function loginAs(email = 'dash@x.com', role: 'comercial' | 'admin' = 'admin') {
  const u = await createUser({ email, role });
  const token = signAccessToken({ userId: u.id, role: u.role });
  return { token, userId: u.id };
}

const SP_OFFSET_H = 3;  // SP = UTC-3
function spDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d, SP_OFFSET_H));  // 00:00 SP
}

describe('dashboardService.summary (org KPIs)', () => {
  it('computes sales/proposals/winRate/avgTicket for current month with prev-month delta', async () => {
    const owner = await createUser({ role: 'comercial' });
    const lead1 = await createLead({});
    const lead2 = await createLead({});
    const lead3 = await createLead({});
    const lead4 = await createLead({});

    // Current month (May 2026): 2 won @ R$1000+R$2000 = R$3000, 1 lost
    await createDeal({ leadId: lead1.id, stage: 'ganho',    proposalValue: 1000, ownerUserId: owner.id, closedAt: spDate(2026, 5, 10), createdAt: spDate(2026, 5, 5) });
    await createDeal({ leadId: lead2.id, stage: 'ganho',    proposalValue: 2000, ownerUserId: owner.id, closedAt: spDate(2026, 5, 12), createdAt: spDate(2026, 5, 7) });
    await createDeal({ leadId: lead3.id, stage: 'perdido',  proposalValue: 800,  ownerUserId: owner.id, closedAt: spDate(2026, 5, 14), createdAt: spDate(2026, 5, 9) });

    // Previous month (April 2026): 1 won @ R$1500
    await createDeal({ leadId: lead4.id, stage: 'ganho',    proposalValue: 1500, ownerUserId: owner.id, closedAt: spDate(2026, 4, 20), createdAt: spDate(2026, 4, 15) });

    const ref = new Date('2026-05-15T16:00:00.000Z');
    const r = await summary({ view: 'org', period: 'month', now: ref });

    expect(r.kpis.sales.value).toBe(3000);
    expect(r.kpis.sales.count).toBe(2);
    expect(r.kpis.sales.prev).toBe(1500);
    expect(r.kpis.sales.prevCount).toBe(1);
    expect(r.kpis.sales.deltaPct).toBe(100);  // (3000-1500)/1500*100

    expect(r.kpis.winRate.value).toBe(67);    // 2/3 rounded
    expect(r.kpis.winRate.prev).toBe(100);

    expect(r.kpis.avgTicket.value).toBe(1500);
    expect(r.kpis.avgTicket.prev).toBe(1500);
  });
});

describe('dashboardService.summary org — funnel/pipeline/leaderboard/goal', () => {
  beforeEach(async () => {
    // org_settings is a singleton not truncated between tests — reset to null each time
    await db.update(orgSettings).set({ monthlySalesGoal: null });
  });

  it('computes funnel from leads/conversations/deals', async () => {
    const u = await createUser({ role: 'comercial' });
    const l1 = await createLead({});
    const l2 = await createLead({});
    const l3 = await createLead({});
    await createConversation({ leadId: l1.id });
    await createConversation({ leadId: l2.id });
    await createDeal({ leadId: l1.id, stage: 'proposta_enviada', ownerUserId: u.id, createdAt: spDate(2026, 5, 6) });
    await createDeal({ leadId: l2.id, stage: 'ganho', proposalValue: 100, ownerUserId: u.id, createdAt: spDate(2026, 5, 7), closedAt: spDate(2026, 5, 8) });

    const r = await summary({ view: 'org', period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.funnel.kind).toBe('org');
    if (r.funnel.kind !== 'org') throw new Error('expected org funnel');
    expect(r.funnel.newLeads).toBe(3);
    expect(r.funnel.withConversation).toBe(2);
    expect(r.funnel.withProposal).toBe(2);
    expect(r.funnel.won).toBe(1);
    // Conversion rates rounded
    expect(r.funnel.convLeadToConv).toBe(67);
    expect(r.funnel.convConvToProposal).toBe(100);
    expect(r.funnel.convProposalToWon).toBe(50);
  });

  it('computes pipelineOpen byStage and avgAgeDays', async () => {
    const u = await createUser({ role: 'comercial' });
    const lA = await createLead({});
    const lB = await createLead({});
    await createDeal({ leadId: lA.id, stage: 'proposta_enviada', proposalValue: 1000, ownerUserId: u.id, createdAt: spDate(2026, 5, 1) });
    await createDeal({ leadId: lB.id, stage: 'em_negociacao',    proposalValue: 500,  ownerUserId: u.id, createdAt: spDate(2026, 5, 5) });

    const r = await summary({ view: 'org', period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.pipelineOpen.byStage).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'proposta_enviada', count: 1, valueSum: 1000 }),
      expect.objectContaining({ stage: 'em_negociacao',    count: 1, valueSum: 500 }),
    ]));
    expect(r.pipelineOpen.totalValue).toBe(1500);
    expect(r.pipelineOpen.avgAgeDays).toBeGreaterThan(0);
  });

  it('returns leaderboard sorted by wonValue desc, top 5', async () => {
    const u1 = await createUser({ role: 'comercial', name: 'Alice', email: 'a@x.com' });
    const u2 = await createUser({ role: 'comercial', name: 'Bob',   email: 'b@x.com' });
    for (const v of [3000, 5000]) {
      const l = await createLead({});
      await createDeal({ leadId: l.id, stage: 'ganho', proposalValue: v, ownerUserId: u1.id, closedAt: spDate(2026, 5, 10) });
    }
    const lB = await createLead({});
    await createDeal({ leadId: lB.id, stage: 'ganho', proposalValue: 9000, ownerUserId: u2.id, closedAt: spDate(2026, 5, 11) });

    const r = await summary({ view: 'org', period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.leaderboard).toHaveLength(2);
    expect(r.leaderboard![0].name).toBe('Bob');
    expect(r.leaderboard![0].wonValue).toBe(9000);
    expect(r.leaderboard![1].name).toBe('Alice');
    expect(r.leaderboard![1].wonValue).toBe(8000);
  });

  it('returns goal when view=org && period=month && goal set', async () => {
    await db.update(orgSettings).set({ monthlySalesGoal: '20000' });
    const u = await createUser({ role: 'comercial' });
    const l = await createLead({});
    await createDeal({ leadId: l.id, stage: 'ganho', proposalValue: 5000, ownerUserId: u.id, closedAt: spDate(2026, 5, 5) });

    const r = await summary({ view: 'org', period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.goal).toEqual({ monthlyTarget: 20000, currentMonthSales: 5000, percent: 25 });
  });

  it('goal is null when view=me even if period=month', async () => {
    await db.update(orgSettings).set({ monthlySalesGoal: '20000' });
    const u = await createUser({ role: 'comercial' });
    const r = await summary({ view: 'me', userId: u.id, period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.goal).toBeNull();
  });

  it('pipelineOpen.byStage inclui lead_no_comercial', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000071001' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', proposalValue: 500, ownerUserId: userId });

    const res = await request(app).get('/api/dashboard/summary?view=org&period=month').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const stage = res.body.pipelineOpen.byStage.find((s: { stage: string }) => s.stage === 'lead_no_comercial');
    expect(stage).toBeDefined();
    expect(stage.count).toBeGreaterThanOrEqual(1);
  });
});
