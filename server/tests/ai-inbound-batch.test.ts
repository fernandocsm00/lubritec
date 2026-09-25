import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';

// Zera o delay humanizado da IA — a suíte não espera "digitação".
process.env.AI_REPLY_MIN_MS = '0';

import { db } from '../db/client';
import { conversations, messages, orgSettings, aiCallLogs } from '../db/schema';
import { processInboundWithAi } from '../services/aiAtendimento';
import {
  collectInboundBatch,
  replyToPendingInbound,
  scheduleAiReply,
  cancelScheduledAiReply,
} from '../services/aiInboundBatch';
import { processPending } from '../services/aiPendingWorker';
import { createLead, createConversation, createMessage, createUser } from './helpers';

vi.mock('../services/geminiClient', () => ({
  generateReply: vi.fn(),
  generateReplyDetailed: vi.fn(),
  GeminiError: class extends Error {
    constructor(public reason: string) { super(`GeminiError: ${reason}`); }
  },
}));

const sendTextMock = vi.hoisted(() => vi.fn());
vi.mock('../services/whatsapp/providerRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/whatsapp/providerRegistry')>()),
  resolveProvider: vi.fn(async (instanceId: string) => ({
    kind: 'uazapi',
    instanceId,
    sendText: sendTextMock,
  })),
}));

import { generateReplyDetailed } from '../services/geminiClient';

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.mocked(generateReplyDetailed).mockReset();
  sendTextMock.mockReset();
});

function mockGemini(text: string) {
  vi.mocked(generateReplyDetailed).mockResolvedValueOnce({
    text, inputTokens: 100, outputTokens: 50, model: 'gemini-test', latencyMs: 10,
  });
}

async function enableAi() {
  await db.update(orgSettings).set({
    aiEnabled: true,
    aiAgentName: 'Lara',
    aiBusinessName: 'Lubritec',
    aiTone: 'profissional',
    aiQualifyWhen: 'cliente pediu orçamento',
    ai24x7: true,
  }).where(eq(orgSettings.singleton, true));
}

async function conversa(phone: string, opts: { originKind?: 'organic' | 'campaign' } = {}) {
  const lead = await createLead({ phone, name: 'Diego' });
  const conv = await createConversation({
    phone, leadId: lead.id, queue: 'ia', originKind: opts.originKind ?? 'organic',
  });
  return { lead, conv };
}

describe('collectInboundBatch — o que o cliente mandou desde a última resposta', () => {
  it('junta as mensagens quebradas, na ordem', async () => {
    const { conv } = await conversa('5554999000001');
    const disparo = await createMessage({ conversationId: conv.id, direction: 'out', body: 'disparo', sentAt: ago(10 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Bom dia', sentAt: ago(5 * MIN) });
    const ultima = await createMessage({ conversationId: conv.id, direction: 'in', body: 'Queria fazer uma cotação', sentAt: ago(4 * MIN) });

    const batch = await collectInboundBatch(conv.id);

    expect(batch).toEqual({
      text: 'Bom dia\nQueria fazer uma cotação',
      since: disparo.sentAt,
      until: ultima.sentAt,
    });
  });

  it('ignora o que veio antes da última resposta e o que não é texto', async () => {
    const { conv } = await conversa('5554999000002');
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'antiga', sentAt: ago(20 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'resposta', sentAt: ago(10 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', kind: 'image', body: null, sentAt: ago(5 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'oi', sentAt: ago(4 * MIN) });

    expect((await collectInboundBatch(conv.id))?.text).toBe('oi');
  });

  it('aviso de fora do horário não conta como resposta', async () => {
    // O cliente escreveu de noite, recebeu o aviso automático e ainda espera
    // resposta pro que mandou — o worker da manhã tem que enxergar a mensagem.
    const { conv } = await conversa('5554999000003');
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'quero cotação', sentAt: ago(600 * MIN) });
    await createMessage({
      conversationId: conv.id, direction: 'out', body: 'Estamos fora do horário',
      rawPayload: { ai: true, afterHours: true }, sentAt: ago(599 * MIN),
    });

    expect((await collectInboundBatch(conv.id))?.text).toBe('quero cotação');
  });

  it('mensagem que chegou enquanto a IA respondia fica pro próximo lote', async () => {
    // A resposta cobriu até 'a'; 'b' chegou durante a digitação da IA, depois
    // do prompt montado e antes do envio. Sem isto 'b' ficaria sem resposta.
    const { conv } = await conversa('5554999000004');
    const a = await createMessage({ conversationId: conv.id, direction: 'in', body: 'a', sentAt: ago(5 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'b', sentAt: ago(2 * MIN) });
    await createMessage({
      conversationId: conv.id, direction: 'out', body: 'resposta da IA',
      rawPayload: { ai: true, coveredUntil: a.sentAt.toISOString() }, sentAt: ago(1 * MIN),
    });

    expect((await collectInboundBatch(conv.id))?.text).toBe('b');
  });

  it('null quando não há nada esperando resposta', async () => {
    const { conv } = await conversa('5554999000005');
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'oi', sentAt: ago(5 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'olá', sentAt: ago(4 * MIN) });

    expect(await collectInboundBatch(conv.id)).toBeNull();
  });
});

describe('processInboundWithAi com o lote (turn)', () => {
  it('manda o lote como UMA mensagem do cliente, sem repetir os pedaços no histórico', async () => {
    await enableAi();
    mockGemini('Claro! Qual produto você procura?');
    sendTextMock.mockResolvedValueOnce({ providerMsgId: 'ai-1', rawPayload: {} });
    const { lead, conv } = await conversa('5554999000006');
    const lara = await createMessage({ conversationId: conv.id, direction: 'out', body: 'Sou a Lara, da Lubritec.', sentAt: ago(10 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Bom dia', sentAt: ago(5 * MIN) });
    const ultima = await createMessage({ conversationId: conv.id, direction: 'in', body: 'Queria fazer uma cotação', sentAt: ago(4 * MIN) });

    await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: conv.phone,
      inboundText: 'Bom dia\nQueria fazer uma cotação',
      turn: { since: lara.sentAt, until: ultima.sentAt },
    });

    const call = vi.mocked(generateReplyDetailed).mock.calls[0][0];
    expect(call.userMessage).toBe('Bom dia\nQueria fazer uma cotação');
    expect(call.history).toEqual([{ role: 'model', text: 'Sou a Lara, da Lubritec.' }]);
  });

  it('grava na resposta até onde ela cobriu', async () => {
    await enableAi();
    mockGemini('Claro!');
    sendTextMock.mockResolvedValueOnce({ providerMsgId: 'ai-2', rawPayload: {} });
    const { lead, conv } = await conversa('5554999000007');
    const ultima = await createMessage({ conversationId: conv.id, direction: 'in', body: 'oi', sentAt: ago(3 * MIN) });

    await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: conv.phone,
      inboundText: 'oi', turn: { since: null, until: ultima.sentAt },
    });

    const [out] = await db.select().from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'out')));
    expect((out.rawPayload as { coveredUntil?: string }).coveredUntil).toBe(ultima.sentAt.toISOString());
  });

  it('lote de primeira resposta a campanha continua contando como campaign_direct', async () => {
    await enableAi();
    mockGemini('Claro!');
    sendTextMock.mockResolvedValueOnce({ providerMsgId: 'ai-3', rawPayload: {} });
    const owner = await createUser({ email: 'disparo@x.com', role: 'comercial' });
    const { lead, conv } = await conversa('5554999000008', { originKind: 'campaign' });
    const disparo = await createMessage({ conversationId: conv.id, direction: 'out', body: 'disparo', sentByUserId: owner.id, sentAt: ago(10 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'bom dia', sentAt: ago(5 * MIN) });
    const ultima = await createMessage({ conversationId: conv.id, direction: 'in', body: 'tenho interesse', sentAt: ago(4 * MIN) });

    await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: conv.phone,
      inboundText: 'bom dia\ntenho interesse', turn: { since: disparo.sentAt, until: ultima.sentAt },
    });

    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.conversationId, conv.id));
    expect(log.qualificationPath).toBe('campaign_direct');
  });
});

describe('replyToPendingInbound — uma resposta pro lote inteiro', () => {
  it('responde as mensagens quebradas de uma vez só', async () => {
    await enableAi();
    mockGemini('Bom dia, Diego! Como posso ajudar?');
    sendTextMock.mockResolvedValueOnce({ providerMsgId: 'ai-4', rawPayload: {} });
    const { lead, conv } = await conversa('5554999000009');
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Bom dia', sentAt: ago(3 * MIN) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Queria fazer uma cotação', sentAt: ago(3 * MIN - 1_000) });

    const r = await replyToPendingInbound({ conversationId: conv.id, leadId: lead.id, phone: conv.phone });

    expect(r?.status).toBe('replied');
    expect(generateReplyDetailed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateReplyDetailed).mock.calls[0][0].userMessage)
      .toBe('Bom dia\nQueria fazer uma cotação');
    const outs = await db.select().from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'out')));
    expect(outs).toHaveLength(1);

    // Nada novo do cliente: segunda rodada não responde de novo.
    expect(await replyToPendingInbound({ conversationId: conv.id, leadId: lead.id, phone: conv.phone })).toBeNull();
    expect(generateReplyDetailed).toHaveBeenCalledTimes(1);
  });
});

describe('aiPendingWorker com o lote', () => {
  async function pendente(phone: string, lastInboundMsAgo: number) {
    const { lead, conv } = await conversa(phone);
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Bom dia', sentAt: ago(lastInboundMsAgo + 1_000) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'tudo bem?', sentAt: ago(lastInboundMsAgo) });
    await db.update(conversations)
      .set({ pendingAiResponse: true, lastInboundAt: ago(lastInboundMsAgo) })
      .where(eq(conversations.id, conv.id));
    return { lead, conv };
  }

  it('responde o lote inteiro de uma conversa que ficou pendente (ex.: processo caiu na espera)', async () => {
    await enableAi();
    mockGemini('Bom dia! Tudo ótimo.');
    sendTextMock.mockResolvedValueOnce({ providerMsgId: 'ai-5', rawPayload: {} });
    await pendente('5554999000010', 6 * MIN);

    const r = await processPending();

    expect(r.processed).toBe(1);
    expect(vi.mocked(generateReplyDetailed).mock.calls[0][0].userMessage).toBe('Bom dia\ntudo bem?');
  });

  it('não pega conversa ainda dentro da espera de 2 min + processamento', async () => {
    await enableAi();
    await pendente('5554999000011', 4 * MIN);

    const r = await processPending();

    expect(r.processed + r.skipped).toBe(0);
    expect(generateReplyDetailed).not.toHaveBeenCalled();
  });

  it('não rouba conversa que tem resposta agendada neste processo', async () => {
    await enableAi();
    const { lead, conv } = await pendente('5554999000012', 6 * MIN);
    scheduleAiReply({ conversationId: conv.id, leadId: lead.id, phone: conv.phone });

    try {
      await processPending();
      expect(generateReplyDetailed).not.toHaveBeenCalled();
    } finally {
      cancelScheduledAiReply(conv.id);
    }
  });
});
