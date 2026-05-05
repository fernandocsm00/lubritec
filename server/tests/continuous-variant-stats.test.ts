import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, campaignRecipients, conversations, messages, leads } from '../db/schema';
import { upsertContinuousCampaign, getVariantStats } from '../services/continuousCampaign';
import {
  createUser,
  createLead,
  createConversation,
  createCampaignRecipient,
  createMessage,
} from './helpers';

describe('getVariantStats', () => {
  it('vazio quando não há recipients', async () => {
    const u = await createUser({ role: 'admin' });
    const camp = await upsertContinuousCampaign(u.id, {
      messageBody: 'olá',
      messageVariants: [
        { name: 'A', body: 'Variante A texto' },
        { name: 'B', body: 'Variante B texto' },
      ],
    });
    const stats = await getVariantStats(camp.id);
    expect(stats).toEqual([]);
  });

  it('agrega sent/replied/qualified por variante', async () => {
    const u = await createUser({ role: 'admin' });
    const camp = await upsertContinuousCampaign(u.id, {
      messageBody: 'fallback',
      messageVariants: [
        { name: 'A', body: 'Mensagem A' },
        { name: 'B', body: 'Mensagem B' },
      ],
    });

    // 3 leads recebem variante A; 2 leads recebem variante B.
    // Variante A: 2 responderam, 1 qualificou.
    // Variante B: 0 responderam, 0 qualificou.
    async function setupRecipient(opts: {
      variantBody: string;
      responded: boolean;
      qualified: boolean;
      phoneSeed: number;
    }) {
      const lead = await createLead({
        phone: `5511900${String(opts.phoneSeed).padStart(5, '0')}`,
        flowStage: opts.qualified ? 'qualified' : opts.responded ? 'engaged' : 'dispatched',
      });
      const conv = await createConversation({ phone: lead.phone!, leadId: lead.id });
      const sentAt = new Date(Date.now() - 60_000);
      // out: a msg do disparo (com variantBody no raw_payload)
      const m = await createMessage({
        conversationId: conv.id,
        direction: 'out',
        body: opts.variantBody,
        sentAt,
        rawPayload: { variantBody: opts.variantBody },
      });
      await createCampaignRecipient({
        campaignId: camp.id,
        leadId: lead.id,
        phone: lead.phone!,
        status: 'sent',
        sentAt,
        conversationId: conv.id,
        messageId: m.id,
      });
      if (opts.responded) {
        await createMessage({
          conversationId: conv.id,
          direction: 'in',
          body: 'Resposta',
          sentAt: new Date(),
        });
      }
    }

    await setupRecipient({ variantBody: 'Mensagem A', responded: true,  qualified: true,  phoneSeed: 1 });
    await setupRecipient({ variantBody: 'Mensagem A', responded: true,  qualified: false, phoneSeed: 2 });
    await setupRecipient({ variantBody: 'Mensagem A', responded: false, qualified: false, phoneSeed: 3 });
    await setupRecipient({ variantBody: 'Mensagem B', responded: false, qualified: false, phoneSeed: 4 });
    await setupRecipient({ variantBody: 'Mensagem B', responded: false, qualified: false, phoneSeed: 5 });

    const stats = await getVariantStats(camp.id);
    // Ordenado por sentCount DESC — A (3) primeiro, B (2) depois.
    expect(stats).toHaveLength(2);
    const a = stats.find((s) => s.variantBody === 'Mensagem A')!;
    const b = stats.find((s) => s.variantBody === 'Mensagem B')!;

    expect(a.sentCount).toBe(3);
    expect(a.repliedCount).toBe(2);
    expect(a.qualifiedCount).toBe(1);
    expect(a.replyRate).toBeCloseTo(66.7, 1);
    expect(a.qualifyRate).toBeCloseTo(33.3, 1);
    expect(a.variantName).toBe('A');

    expect(b.sentCount).toBe(2);
    expect(b.repliedCount).toBe(0);
    expect(b.qualifiedCount).toBe(0);
    expect(b.variantName).toBe('B');
  });

  it('fallback messageBody quando raw_payload não tem variantBody', async () => {
    const u = await createUser({ role: 'admin' });
    const camp = await upsertContinuousCampaign(u.id, {
      messageBody: 'Mensagem padrão sem variantes',
    });

    const lead = await createLead({ phone: '5511944440000', flowStage: 'dispatched' });
    const conv = await createConversation({ phone: lead.phone!, leadId: lead.id });
    const m = await createMessage({
      conversationId: conv.id,
      direction: 'out',
      body: 'qualquer',
      rawPayload: {}, // sem variantBody
    });
    await createCampaignRecipient({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'sent',
      sentAt: new Date(),
      conversationId: conv.id,
      messageId: m.id,
    });

    const stats = await getVariantStats(camp.id);
    expect(stats).toHaveLength(1);
    expect(stats[0].variantBody).toBe('Mensagem padrão sem variantes');
    expect(stats[0].variantName).toBeNull();
  });

  it('PublicContinuousCampaign inclui variantStats', async () => {
    const u = await createUser({ role: 'admin' });
    const camp = await upsertContinuousCampaign(u.id, {
      messageBody: 'oi',
      messageVariants: [{ name: 'A', body: 'A msg' }],
    });
    expect(camp.variantStats).toBeDefined();
    expect(Array.isArray(camp.variantStats)).toBe(true);
  });
});

// Mantém referências usadas pra imports válidos
void campaigns; void conversations; void messages; void leads; void campaignRecipients;
