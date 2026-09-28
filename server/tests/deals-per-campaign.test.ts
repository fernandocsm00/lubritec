import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { createDeal } from '../services/dealsService';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createDeal as seedDeal,
} from './helpers';

const DAY = 86_400_000;
let seq = 0;

/** Lead com card de maio aberto (Campanha Teste) que recebeu um re-disparo vigente. */
async function samuel() {
  seq += 1;
  const u = await createUser({ email: `m${seq}@x.com` });
  const lead = await createLead({ phone: `55549600${String(seq).padStart(5, '0')}`, name: 'Samuel' });
  const antiga = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
  const nova = await createCampaign({
    name: 'Teste Andrei III', createdByUserId: u.id,
    validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
  });
  await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 120 * DAY) });
  await createCampaignRecipient({ campaignId: nova.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });
  const velho = await seedDeal({
    leadId: lead.id, stage: 'lead_no_comercial', campaignId: antiga.id,
    createdAt: new Date(Date.now() - 119 * DAY),
  });
  return { u, lead, antiga, nova, velho };
}

async function cardsOf(leadId: string) {
  return db.select().from(deals).where(eq(deals.leadId, leadId));
}

describe('createDeal — IA abre um card por campanha', () => {
  it('lead com card aberto de outra campanha ganha um SEGUNDO card, da campanha vigente', async () => {
    const { lead, nova, velho } = await samuel();

    const novo = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    expect(novo.id).not.toBe(velho.id);
    expect(novo.stage).toBe('lead_no_comercial');
    const cards = await cardsOf(lead.id);
    expect(cards).toHaveLength(2);
    expect(cards.find((d) => d.id === novo.id)!.campaignId).toBe(nova.id);
    expect(cards.find((d) => d.id === velho.id)!.stage).toBe('lead_no_comercial');
  });

  it('qualificar de novo na mesma campanha devolve o mesmo card', async () => {
    const { lead } = await samuel();
    const d1 = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });
    const d2 = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });
    expect(d2.id).toBe(d1.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('card da mesma campanha já fechado não é recriado', async () => {
    const { lead, nova } = await samuel();
    const perdido = await seedDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: nova.id,
    });

    const r = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    expect(r.id).toBe(perdido.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('qualificação fora da vigência abre card sem campanha', async () => {
    seq += 1;
    const u = await createUser({ email: `f${seq}@x.com` });
    const lead = await createLead({ phone: `55549610${String(seq).padStart(5, '0')}` });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 20 * DAY), validityEnd: new Date(Date.now() - 10 * DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 19 * DAY) });

    const d = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row.campaignId).toBeNull();
  });

  it('duas qualificações simultâneas na mesma campanha terminam num card só', async () => {
    const { lead, nova } = await samuel();

    const [a, b] = await Promise.all([
      createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' }),
      createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' }),
    ]);

    expect(a.id).toBe(b.id);
    const daNova = (await cardsOf(lead.id)).filter((d) => d.campaignId === nova.id);
    expect(daNova).toHaveLength(1);
  });
});

describe('createDeal — manual não abre segundo card', () => {
  it('lead com cards abertos: devolve o mais recente', async () => {
    const { u, lead } = await samuel();
    const novo = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    const manual = await createDeal({ leadId: lead.id, ownerUserId: u.id, source: 'manual' });

    expect(manual.id).toBe(novo.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('todos fechados: recompra cria card sem campanha em em_negociacao', async () => {
    const { u, lead, velho } = await samuel();
    await db.update(deals).set({ stage: 'ganho', proposalValue: '800', closedAt: new Date() }).where(eq(deals.id, velho.id));

    const recompra = await createDeal({ leadId: lead.id, ownerUserId: u.id, source: 'manual' });

    expect(recompra.stage).toBe('em_negociacao');
    const [row] = await db.select().from(deals).where(eq(deals.id, recompra.id));
    expect(row.campaignId).toBeNull();
  });
});
