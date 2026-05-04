import { describe, it, expect } from 'vitest';
import { summary } from '../services/dashboardService';
import { createUser, createLead, createConversation, createMessage, createDeal, createDealActivity } from './helpers';

const SP_OFFSET_H = 3;
function spDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d, SP_OFFSET_H));
}

describe('summary view=me', () => {
  it('funnel uses owner-scoped data', async () => {
    const me    = await createUser({ role: 'comercial', name: 'Eu', email: 'me@x.com' });
    const other = await createUser({ role: 'comercial', name: 'Outro', email: 'o@x.com' });
    const lA = await createLead({});
    const lB = await createLead({});
    const cA = await createConversation({ leadId: lA.id, queue: 'comercial', assignedTo: me.id });
    const cB = await createConversation({ leadId: lB.id, queue: 'comercial', assignedTo: other.id });

    // I responded to A only
    await createMessage({ conversationId: cA.id, direction: 'out', sentByUserId: me.id, sentAt: spDate(2026, 5, 7) });
    await createMessage({ conversationId: cB.id, direction: 'out', sentByUserId: other.id, sentAt: spDate(2026, 5, 8) });

    // My deals: 1 won
    await createDeal({ leadId: lA.id, stage: 'ganho', proposalValue: 200, ownerUserId: me.id, createdAt: spDate(2026, 5, 9), closedAt: spDate(2026, 5, 10) });
    // Other's deal (must be excluded)
    await createDeal({ leadId: lB.id, stage: 'ganho', proposalValue: 999, ownerUserId: other.id, createdAt: spDate(2026, 5, 9), closedAt: spDate(2026, 5, 10) });

    const r = await summary({ view: 'me', userId: me.id, period: 'month', now: new Date('2026-05-15T16:00:00Z') });
    expect(r.funnel.kind).toBe('me');
    if (r.funnel.kind !== 'me') throw new Error('expected me funnel');
    expect(r.funnel.respondedConversations).toBe(1);
    expect(r.funnel.myProposals).toBe(1);
    expect(r.funnel.myWon).toBe(1);
    expect(r.funnel.convProposalToWon).toBe(100);

    // Leaderboard hidden, recentActivities present (empty here, populated by next assertion)
    expect(r.leaderboard).toBeNull();
    expect(Array.isArray(r.recentActivities)).toBe(true);
  });

  it('recentActivities returns last 10 by me', async () => {
    const me = await createUser({ role: 'comercial' });
    const lead = await createLead({ name: 'Ricardo' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: me.id });
    for (let i = 0; i < 12; i++) {
      await createDealActivity({ dealId: d.id, kind: 'note_added', actorUserId: me.id, createdAt: new Date(Date.now() - i * 60_000) });
    }
    const r = await summary({ view: 'me', userId: me.id, period: 'month' });
    expect(r.recentActivities).toHaveLength(10);
    expect(r.recentActivities![0].leadName).toBe('Ricardo');
  });

  it('pipelineOpen scoped to my deals', async () => {
    const me    = await createUser({ role: 'comercial' });
    const other = await createUser({ role: 'comercial', email: 'o2@x.com' });
    const lA = await createLead({});
    const lB = await createLead({});
    await createDeal({ leadId: lA.id, stage: 'proposta_enviada', proposalValue: 100, ownerUserId: me.id });
    await createDeal({ leadId: lB.id, stage: 'proposta_enviada', proposalValue: 999, ownerUserId: other.id });

    const r = await summary({ view: 'me', userId: me.id, period: 'month' });
    expect(r.pipelineOpen.totalValue).toBe(100);
  });
});
