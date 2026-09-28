import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, dealActivities, deals, notifications } from '../db/schema';
import { closeCampaignCards, closeEndedCampaigns } from '../services/campaignClosure';
import { reactivateDeal } from '../services/dealsService';
import { createUser, createLead, createDeal, createCampaign } from './helpers';

const DAY = 86_400_000;
let seq = 0;

async function newLead() {
  seq += 1;
  return createLead({ phone: `55549800${String(seq).padStart(5, '0')}` });
}

async function row(id: string) {
  return (await db.select().from(deals).where(eq(deals.id, id)))[0];
}

describe('closeCampaignCards', () => {
  it('fecha só os cards ABERTOS da campanha, com motivo e histórico', async () => {
    const julia = await createUser({ email: 'julia@x.com', name: 'Julia' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: julia.id });
    const outra = await createCampaign({ name: 'Outra', createdByUserId: julia.id });
    const a = await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: julia.id });
    const b = await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', proposalValue: 900, campaignId: camp.id });
    const ganho = await createDeal({
      leadId: (await newLead()).id, stage: 'ganho', proposalValue: 500,
      closedAt: new Date(Date.now() - DAY), campaignId: camp.id,
    });
    const deOutra = await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: outra.id });

    const r = await closeCampaignCards(camp.id, null);

    expect(r.closed).toBe(2);
    for (const id of [a.id, b.id]) {
      const d = await row(id);
      expect(d.stage).toBe('perdido');
      expect(d.lossReason).toBe('campanha_encerrada');
      expect(d.closedAt).not.toBeNull();
      expect(d.leadQualityFeedback).toBeNull();
    }
    expect((await row(ganho.id)).stage).toBe('ganho');
    expect((await row(deOutra.id)).stage).toBe('lead_no_comercial');

    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(c.cardsClosedAt).not.toBeNull();

    const lost = await db.select().from(dealActivities)
      .where(and(eq(dealActivities.dealId, a.id), eq(dealActivities.kind, 'lost')));
    expect(lost).toHaveLength(1);
    expect(lost[0].actorUserId).toBeNull();
    expect(lost[0].metadata).toMatchObject({ reason: 'campanha_encerrada', via: 'campaign_closed', campaignId: camp.id });
  });

  it('avisa cada dono uma vez, com a contagem; card sem dono não gera aviso', async () => {
    const julia = await createUser({ email: 'julia2@x.com', name: 'Julia' });
    const pedro = await createUser({ email: 'pedro@x.com', name: 'Pedro' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'proposta_enviada', campaignId: camp.id, ownerUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: pedro.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id });

    await closeCampaignCards(camp.id, null);

    const notifs = await db.select().from(notifications).where(eq(notifications.kind, 'campaign_cards_closed'));
    expect(notifs).toHaveLength(2);
    const daJulia = notifs.find((n) => n.userId === julia.id)!;
    expect(daJulia.body).toContain('2 cards seus foram fechados');
    expect(daJulia.body).toContain('Teste Andrei III');
    expect(daJulia.actionUrl).toBe(`/inside-sales?tab=history&stage=perdido&reason=campanha_encerrada&owner=mine&campaignIds=${camp.id}`);
    expect(notifs.find((n) => n.userId === pedro.id)!.body).toContain('1 card seu foi fechado');
  });
});

describe('closeEndedCampaigns', () => {
  it('varre só campanha comum vencida e ainda não varrida', async () => {
    const u = await createUser({ email: 'u@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 9 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    const vigente = await createCampaign({
      name: 'Vigente', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const continua = await createCampaign({ name: 'Contínua', createdByUserId: u.id, isContinuous: true });
    const jaVarrida = await createCampaign({
      name: 'Já varrida', createdByUserId: u.id,
      validityEnd: new Date(Date.now() - 2 * DAY), cardsClosedAt: new Date(Date.now() - DAY),
    });
    const semVigencia = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });

    const cardOf: Record<string, string> = {};
    for (const c of [vencida, vigente, continua, jaVarrida, semVigencia]) {
      cardOf[c.name] = (await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id })).id;
    }

    const r = await closeEndedCampaigns();

    expect(r).toEqual({ campaigns: 1, cards: 1 });
    expect((await row(cardOf['Vencida'])).stage).toBe('perdido');
    for (const nome of ['Vigente', 'Contínua', 'Já varrida', 'Sem vigência']) {
      expect((await row(cardOf[nome])).stage).toBe('lead_no_comercial');
    }
  });

  it('card reativado depois do fechamento não é fechado de novo', async () => {
    const u = await createUser({ email: 'u2@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 9 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    const card = await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', campaignId: vencida.id });

    await closeEndedCampaigns();
    await reactivateDeal({ dealId: card.id, actorUserId: u.id });
    await closeEndedCampaigns();

    expect((await row(card.id)).stage).toBe('proposta_enviada');
  });
});
