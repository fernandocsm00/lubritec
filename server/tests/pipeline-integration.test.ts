import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation, createDeal, createCampaign, createCampaignRecipient } from './helpers';
import { maybeAddDealFromConversation } from '../services/pipelineIntegration';

const DAY = 86_400_000;

describe('maybeAddDealFromConversation', () => {
  it('ignora se kind != image', async () => {
    const u = await createUser({ email: 'p1@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100001' });
    const conv = await createConversation({ phone: '11000100001', leadId: lead.id, queue: 'comercial' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'text',
      userId: u.id,
    });

    const all = await db.select().from(deals);
    expect(all).toHaveLength(0);
  });

  it('ignora se queue != comercial', async () => {
    const u = await createUser({ email: 'p2@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100010' });
    const conv = await createConversation({ phone: '11000100010', leadId: lead.id, queue: 'recepcao' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const all = await db.select().from(deals);
    expect(all).toHaveLength(0);
  });

  it('cria deal se imagem em conversa Comercial e lead sem deal', async () => {
    const u = await createUser({ email: 'p3@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100020' });
    const conv = await createConversation({ phone: '11000100020', leadId: lead.id, queue: 'comercial' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d).toBeDefined();
    expect(d.stage).toBe('lead_no_comercial');
    expect(d.ownerUserId).toBe(u.id);
  });

  it('imagem enviada por outra pessoa em conversa com dono: card nasce com o dono da conversa', async () => {
    const julia = await createUser({ email: 'julia@x.com', role: 'comercial' });
    const pedro = await createUser({ email: 'pedro@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100025' });
    const conv = await createConversation({
      phone: '11000100025', leadId: lead.id, queue: 'comercial', assignedTo: julia.id,
    });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: pedro.id,
    });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d.ownerUserId).toBe(julia.id);
  });

  it('lead com card aberto de outra campanha: imagem não cria nem reativa nada', async () => {
    const u = await createUser({ email: 'p6@x.com', role: 'comercial' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    const lead = await createLead({ phone: '11000100050' });
    const conv = await createConversation({ phone: '11000100050', leadId: lead.id, queue: 'comercial' });
    await createDeal({ leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date() });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: camp.id });

    await maybeAddDealFromConversation({ conversationId: conv.id, messageKind: 'image', userId: u.id });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all.map((d) => d.stage).sort()).toEqual(['lead_no_comercial', 'perdido']);
  });

  it('no-op se já existe deal ativo', async () => {
    const u = await createUser({ email: 'p4@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100030' });
    const conv = await createConversation({ phone: '11000100030', leadId: lead.id, queue: 'comercial' });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', ownerUserId: u.id });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(1);
    expect(all[0].stage).toBe('em_negociacao');  // não mudou
  });

  it('lead sem card, disparo de campanha vigente: card novo nasce com a campanha', async () => {
    const u = await createUser({ email: 'p7@x.com', role: 'comercial' });
    const camp = await createCampaign({
      name: 'Teste Andrei III', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const lead = await createLead({ phone: '11000100060' });
    const conv = await createConversation({ phone: '11000100060', leadId: lead.id, queue: 'comercial' });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    await maybeAddDealFromConversation({ conversationId: conv.id, messageKind: 'image', userId: u.id });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d).toBeDefined();
    expect(d.campaignId).toBe(camp.id);
  });

  it('reativa se deal está em ganho/perdido', async () => {
    const u = await createUser({ email: 'p5@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100040' });
    const conv = await createConversation({ phone: '11000100040', leadId: lead.id, queue: 'comercial' });
    await createDeal({
      leadId: lead.id,
      stage: 'perdido',
      lossReason: 'sem_retorno',
      ownerUserId: u.id,
      closedAt: new Date(),
    });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d.stage).toBe('proposta_enviada');
    expect(d.closedAt).toBeNull();
    expect(d.lossReason).toBeNull();
  });
});
