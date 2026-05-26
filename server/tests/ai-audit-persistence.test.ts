import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { aiCallLogs, leads, conversations, whatsappInstance } from '../db/schema';
import { recordAiCall } from '../services/aiAtendimento';
import { eq } from 'drizzle-orm';

describe('recordAiCall — audit fields', () => {
  let leadId: string;
  let conversationId: string;
  let instanceId: string;

  beforeEach(async () => {
    // Setup mínimo: cria instance, lead, conversation
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'test', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    instanceId = inst.id;
    const [l] = await db.insert(leads).values({ name: 'Lead Audit', phone: '5511999999999' })
      .returning({ id: leads.id });
    leadId = l.id;
    const [c] = await db.insert(conversations).values({
      phone: '5511999999999', instanceId, leadId,
    }).returning({ id: conversations.id });
    conversationId = c.id;
  });

  it('persiste decisionReason, questionsAnswers, promptVersion, qualificationPath', async () => {
    await recordAiCall({
      conversationId,
      leadId,
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 800,
      qualified: true,
      humanIntent: false,
      decisionReason: 'Cliente pediu orçamento explícito',
      qualificationPath: 'conversation',
      questionsAnswers: [
        { question: 'Você troca óleo regularmente?', answer: 'Sim, a cada 5k km', consideredAt: new Date().toISOString() },
      ],
      promptVersion: 'v1-2026-05-26',
    });

    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.leadId, leadId)).limit(1);
    expect(log).toBeDefined();
    expect(log.decisionReason).toBe('Cliente pediu orçamento explícito');
    expect(log.qualificationPath).toBe('conversation');
    expect(Array.isArray(log.questionsAnswers)).toBe(true);
    expect((log.questionsAnswers as unknown[]).length).toBe(1);
    expect(log.promptVersion).toBe('v1-2026-05-26');
  });

  it('aceita audit fields ausentes (backward-compat)', async () => {
    await recordAiCall({
      conversationId,
      leadId,
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 800,
      qualified: false,
      humanIntent: false,
    });
    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.leadId, leadId)).limit(1);
    expect(log).toBeDefined();
    expect(log.decisionReason).toBeNull();
    expect(log.qualificationPath).toBeNull();
    expect(log.questionsAnswers).toEqual([]);
  });
});
