import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import {
  aiCallLogs, leads, conversations, whatsappInstance, campaigns, deals, users, messages,
} from '../db/schema';
import { getCaseSheet } from '../services/caseSheetService';

describe('getCaseSheet', () => {
  it('retorna ficha vazia (mas válida) para lead sem decisão de IA', async () => {
    const [l] = await db.insert(leads).values({ name: 'Sem IA', phone: '5511000000200' })
      .returning({ id: leads.id });
    const sheet = await getCaseSheet(l.id);
    expect(sheet.leadId).toBe(l.id);
    expect(sheet.aiCallLogId).toBeNull();
    expect(sheet.qualified).toBeNull();
    expect(sheet.dealId).toBeNull();
  });

  it('compõe ficha completa de lead qualificado direto via campanha', async () => {
    const [u] = await db.insert(users).values({
      email: `cs-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'i', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    const [c] = await db.insert(campaigns).values({
      name: 'Camp X', messageBody: 'Quer trocar óleo?',
      qualificationQuestion: 'Você precisa trocar o óleo agora?',
      createdByUserId: u.id, instanceId: inst.id,
    }).returning({ id: campaigns.id });
    const [l] = await db.insert(leads).values({ name: 'Lead Camp', phone: '5511000000201' })
      .returning({ id: leads.id });
    const [conv] = await db.insert(conversations).values({
      phone: '5511000000201', instanceId: inst.id, leadId: l.id,
      originKind: 'campaign', originCampaignId: c.id,
    }).returning({ id: conversations.id });
    await db.insert(messages).values({
      conversationId: conv.id, direction: 'in', kind: 'text',
      body: 'Sim, preciso urgente!', rawPayload: {}, sentAt: new Date(),
    });
    await db.insert(aiCallLogs).values({
      conversationId: conv.id, leadId: l.id, model: 'gemini',
      inputTokens: 50, outputTokens: 20, latencyMs: 500,
      qualified: true, humanIntent: false,
      decisionReason: 'Pediu urgente',
      qualificationPath: 'campaign_direct',
      campaignId: c.id,
      questionsAnswers: [{ question: 'Você precisa?', answer: 'Sim, urgente!', consideredAt: new Date().toISOString() }],
    });

    const sheet = await getCaseSheet(l.id);
    expect(sheet.qualified).toBe(true);
    expect(sheet.qualificationPath).toBe('campaign_direct');
    expect(sheet.decisionReason).toBe('Pediu urgente');
    expect(sheet.campaignId).toBe(c.id);
    expect(sheet.campaignName).toBe('Camp X');
    expect(sheet.qualificationQuestion).toBe('Você precisa trocar o óleo agora?');
    expect(sheet.firstInboundReply).toBe('Sim, preciso urgente!');
    expect(sheet.questionsAnswers.length).toBe(1);
  });
});
