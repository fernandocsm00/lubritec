import { describe, it, expect } from 'vitest';
import { summary } from '../services/dashboardService';
import { createUser, createLead, createDeal } from './helpers';

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
