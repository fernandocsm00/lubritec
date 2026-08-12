import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/client';
import { conversations, orgSettings } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createUser,
  createLead,
  createCampaign,
  createCampaignRecipient,
  createConversation,
  createMessage,
  createWhatsappInstance,
} from './helpers';
import { processCampaign } from '../services/campaignsDispatcher';
import type { WhatsAppProvider } from '../services/whatsapp/provider';

vi.mock('../services/whatsapp/providerRegistry', () => ({
  resolveProvider: vi.fn(),
  resolveDefaultProvider: vi.fn(),
  invalidateProvider: vi.fn(),
  _clearCache: vi.fn(),
}));
import { resolveProvider } from '../services/whatsapp/providerRegistry';

const mockProvider: WhatsAppProvider = {
  kind: 'uazapi',
  instanceId: 'mock-instance',
  getStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  sendTemplate: vi.fn(),
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  capabilities: vi.fn(),
};

let instanceId: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);

async function setAiEnabled(enabled: boolean) {
  await db.update(orgSettings).set({ aiEnabled: enabled }).where(eq(orgSettings.singleton, true));
}

/**
 * Monta o cenario base: lead + conversa preexistente (IA travada) + campanha
 * running com 1 recipient pendente apontando pro mesmo telefone.
 */
async function scenario(opts: {
  phone: string;
  email: string;
  queue?: 'ia' | 'recepcao' | 'comercial';
  aiDisabled?: boolean;
}) {
  const user = await createUser({ email: opts.email, role: 'admin' });
  const lead = await createLead({ phone: opts.phone });
  const conv = await createConversation({
    phone: opts.phone,
    leadId: lead.id,
    instanceId,
    queue: opts.queue ?? 'recepcao',
    aiDisabled: opts.aiDisabled ?? true,
  });
  const campaign = await createCampaign({
    status: 'running',
    ratePerMinute: 600,
    messageBody: 'Oi {{nome}}',
    createdByUserId: user.id,
    instanceId,
  });
  await createCampaignRecipient({
    campaignId: campaign.id,
    leadId: lead.id,
    phone: opts.phone,
    status: 'pending',
  });
  return { user, lead, conv, campaign };
}

async function reload(conversationId: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  return c;
}

beforeEach(async () => {
  vi.mocked(mockProvider.sendText).mockReset();
  vi.mocked(mockProvider.sendText).mockResolvedValue({ providerMsgId: `m-${Date.now()}`, rawPayload: {} });
  vi.mocked(resolveProvider).mockResolvedValue(mockProvider);
  const inst = await createWhatsappInstance({ isDefault: true, displayName: 'Test default' });
  instanceId = inst.id;
  await setAiEnabled(true);
});

describe('disparo religa a IA em conversa preexistente', () => {
  it('religa quando o ultimo atendimento humano e antigo', async () => {
    const { conv, campaign, user } = await scenario({ phone: '5554999670001', email: 'r1@x.com' });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'atendimento antigo',
      sentAt: daysAgo(30),
    });

    await processCampaign({ ...campaign, status: 'running' });

    expect((await reload(conv.id)).aiDisabled).toBe(false);
  });

  it('NAO religa quando alguem do time respondeu ha pouco', async () => {
    const { conv, campaign, user } = await scenario({ phone: '5554999670002', email: 'r2@x.com' });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'atendimento vivo',
      sentAt: daysAgo(2),
    });

    await processCampaign({ ...campaign, status: 'running' });

    expect((await reload(conv.id)).aiDisabled).toBe(true);
  });

  it('devolve a conversa da fila comercial pra fila ia quando o atendimento e antigo', async () => {
    const { conv, campaign, user } = await scenario({
      phone: '5554999670003', email: 'r3@x.com', queue: 'comercial',
    });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'vendedor tocou isso em outra era',
      sentAt: daysAgo(30),
    });

    await processCampaign({ ...campaign, status: 'running' });

    const after = await reload(conv.id);
    expect(after.aiDisabled).toBe(false);
    expect(after.queue).toBe('ia');
  });

  it('mensagem de campanha anterior nao conta como atendimento humano', async () => {
    const { conv, campaign, lead, user } = await scenario({ phone: '5554999670004', email: 'r4@x.com' });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'atendimento humano de verdade, antigo',
      sentAt: daysAgo(30),
    });
    // Disparo anterior: carrega o createdByUserId da campanha, entao "parece"
    // humano — mas e robo. Nao pode segurar o religamento.
    const oldCampaign = await createCampaign({
      status: 'completed', createdByUserId: user.id, instanceId,
    });
    const oldMsg = await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'disparo anterior',
      sentAt: daysAgo(2),
    });
    await createCampaignRecipient({
      campaignId: oldCampaign.id,
      leadId: lead.id,
      phone: '5554999670004',
      status: 'sent',
      sentAt: daysAgo(2),
      conversationId: conv.id,
      messageId: oldMsg.id,
    });

    await processCampaign({ ...campaign, status: 'running' });

    expect((await reload(conv.id)).aiDisabled).toBe(false);
  });

  it('nao mexe em nada quando a IA esta desligada globalmente', async () => {
    await setAiEnabled(false);
    const { conv, campaign, user } = await scenario({
      phone: '5554999670005', email: 'r5@x.com', queue: 'comercial',
    });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: user.id,
      body: 'atendimento antigo',
      sentAt: daysAgo(30),
    });

    await processCampaign({ ...campaign, status: 'running' });

    const after = await reload(conv.id);
    expect(after.aiDisabled).toBe(true);
    expect(after.queue).toBe('comercial');
  });
});
