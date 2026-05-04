import { describe, it, expect } from 'vitest';
import { attention } from '../services/dashboardService';
import { createUser, createLead, createConversation, createDeal } from './helpers';

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day);

describe('dashboardService.attention', () => {
  it('counts proposal_old (>14d in proposta_enviada)', async () => {
    const u = await createUser({ role: 'comercial' });
    const l1 = await createLead({});
    const l2 = await createLead({});
    await createDeal({ leadId: l1.id, stage: 'proposta_enviada', ownerUserId: u.id, updatedAt: ago(20) });
    await createDeal({ leadId: l2.id, stage: 'proposta_enviada', ownerUserId: u.id, updatedAt: ago(5) });
    const r = await attention({ view: 'org' });
    const item = r.items.find((i) => i.kind === 'proposal_old');
    expect(item?.count).toBe(1);
    expect(item?.severity).toBe('critical');
  });

  it('counts deal_stale (>5d open) — overlaps proposal_old by design', async () => {
    const u = await createUser({ role: 'comercial' });
    const l1 = await createLead({});
    const l2 = await createLead({});
    await createDeal({ leadId: l1.id, stage: 'em_negociacao', ownerUserId: u.id, updatedAt: ago(7) });
    await createDeal({ leadId: l2.id, stage: 'em_negociacao', ownerUserId: u.id, updatedAt: ago(2) });
    const r = await attention({ view: 'org' });
    const item = r.items.find((i) => i.kind === 'deal_stale');
    expect(item?.count).toBe(1);
  });

  it('counts queue_pending (comercial + aguardando)', async () => {
    const lead = await createLead({});
    await createConversation({ leadId: lead.id, queue: 'comercial', status: 'aguardando_atendimento' });
    await createConversation({ leadId: lead.id, queue: 'recepcao',  status: 'aguardando_atendimento' });
    const r = await attention({ view: 'org' });
    const item = r.items.find((i) => i.kind === 'queue_pending');
    expect(item?.count).toBe(1);
  });

  it('counts conv_expired (>24h since last inbound, status != encerrada)', async () => {
    const lead1 = await createLead({});
    const lead2 = await createLead({});
    await createConversation({ leadId: lead1.id, status: 'em_atendimento', lastInboundAt: ago(2) });   // expired
    await createConversation({ leadId: lead2.id, status: 'em_atendimento', lastInboundAt: ago(0.5) }); // ok
    const r = await attention({ view: 'org' });
    const item = r.items.find((i) => i.kind === 'conv_expired');
    expect(item?.count).toBe(1);
  });

  it('view=me filters by owner', async () => {
    const me = await createUser({ role: 'comercial' });
    const other = await createUser({ role: 'comercial', email: 'o3@x.com' });
    const l1 = await createLead({});
    const l2 = await createLead({});
    await createDeal({ leadId: l1.id, stage: 'proposta_enviada', ownerUserId: me.id, updatedAt: ago(20) });
    await createDeal({ leadId: l2.id, stage: 'proposta_enviada', ownerUserId: other.id, updatedAt: ago(20) });
    const r = await attention({ view: 'me', userId: me.id });
    expect(r.items.find((i) => i.kind === 'proposal_old')?.count).toBe(1);
  });

  it('items are ordered by severity (critical → warning → info)', async () => {
    // Just create one of each so all four show up
    const u = await createUser({ role: 'comercial' });
    const l = await createLead({});
    await createDeal({ leadId: l.id, stage: 'proposta_enviada', ownerUserId: u.id, updatedAt: ago(20) });
    const lc = await createLead({});
    await createConversation({ leadId: lc.id, queue: 'comercial', status: 'aguardando_atendimento' });

    const r = await attention({ view: 'org' });
    const sevs = r.items.map((i) => i.severity);
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < sevs.length; i++) {
      expect(order[sevs[i]]).toBeGreaterThanOrEqual(order[sevs[i - 1]]);
    }
  });
});
