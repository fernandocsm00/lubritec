import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages, leads, orgSettings } from '../db/schema';
import {
  detectHumanIntent,
  buildSystemPrompt,
  parseQualificationTag,
  processInboundWithAi,
} from '../services/aiAtendimento';
import { createLead, createConversation } from './helpers';

vi.mock('../services/geminiClient', () => ({
  generateReply: vi.fn(),
  generateReplyDetailed: vi.fn(),
  GeminiError: class extends Error {
    constructor(public reason: string) { super(`GeminiError: ${reason}`); }
  },
}));

vi.mock('../services/whatsapp/uazapi/client', () => ({
  uazapiClient: { sendMessage: vi.fn() },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));

import { generateReply, generateReplyDetailed } from '../services/geminiClient';
import { uazapiClient } from '../services/whatsapp/uazapi/client';

beforeEach(() => {
  vi.mocked(generateReply).mockReset();
  vi.mocked(generateReplyDetailed).mockReset();
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

// Mocks de Gemini agora retornam shape {text, inputTokens, outputTokens, model, latencyMs}.
// Helper pra reduzir verbosidade nos testes.
function mockGeminiText(text: string) {
  vi.mocked(generateReplyDetailed).mockResolvedValueOnce({
    text,
    inputTokens: 100,
    outputTokens: 50,
    model: 'gemini-2.5-flash',
    latencyMs: 500,
  });
}

async function enableAi() {
  await db.update(orgSettings).set({
    aiEnabled: true,
    aiAgentName: 'Atendente Teste',
    aiBusinessName: 'Lubritec',
    aiBusinessDesc: 'Distribuidora de óleos lubrificantes em Caxias do Sul.',
    aiProducts: 'Óleos sintéticos Mobil/Shell, lubrificantes industriais.',
    aiTargetAudience: 'Oficinas de troca de óleo e transportadoras.',
    aiTone: 'profissional',
    aiObjective: 'Qualificar leads e agendar contato comercial.',
    aiQualifyWhen: 'cliente pediu orçamento ou quer agendar visita',
  }).where(eq(orgSettings.singleton, true));
}

describe('detectHumanIntent', () => {
  it.each([
    'quero falar com humano',
    'preciso de um atendente',
    'me transfira pra alguém',
    'chega de robô',
    'não quero falar com ia',
  ])('detecta: %s', (msg) => {
    expect(detectHumanIntent(msg)).toBe(true);
  });

  it.each([
    'oi tudo bem?',
    'quero saber o preço',
    'humanos são interessantes',
  ])('NÃO detecta: %s', (msg) => {
    expect(detectHumanIntent(msg)).toBe(false);
  });
});

describe('parseQualificationTag', () => {
  it('extrai [QUALIFICADO] do final', () => {
    const r = parseQualificationTag('Vou agendar pra você. [QUALIFICADO]');
    expect(r.qualification).toBe('qualified');
    expect(r.cleanReply).toBe('Vou agendar pra você.');
  });

  it('extrai [NAO_QUALIFICADO] do final', () => {
    const r = parseQualificationTag('Obrigado pelo contato. [NAO_QUALIFICADO]');
    expect(r.qualification).toBe('not_qualified');
    expect(r.cleanReply).toBe('Obrigado pelo contato.');
  });

  it('null quando sem tag', () => {
    const r = parseQualificationTag('Pode me contar mais?');
    expect(r.qualification).toBeNull();
    expect(r.cleanReply).toBe('Pode me contar mais?');
  });
});

describe('buildSystemPrompt', () => {
  it('inclui nome do agente, empresa e regra de qualificação', () => {
    const fake = {
      aiAgentName: 'Maria',
      aiBusinessName: 'OleoCorp',
      aiBusinessDesc: 'Distribuidora.',
      aiProducts: 'Óleo X',
      aiTargetAudience: 'Oficinas',
      aiTone: 'cordial',
      aiObjective: 'qualificar',
      aiDontTalk: 'política',
      aiAlwaysAsk: 'CNPJ',
      aiQualifyWhen: 'pediu orçamento',
      aiBusinessHours: '8h-18h',
    } as Parameters<typeof buildSystemPrompt>[0];
    const prompt = buildSystemPrompt(fake, 'João Silva', '5511999999999');
    expect(prompt).toMatch(/Maria/);
    expect(prompt).toMatch(/OleoCorp/);
    expect(prompt).toMatch(/Óleo X/);
    expect(prompt).toMatch(/política/);
    expect(prompt).toMatch(/CNPJ/);
    expect(prompt).toMatch(/\[QUALIFICADO\]/);
    expect(prompt).toMatch(/\[NAO_QUALIFICADO\]/);
    expect(prompt).toMatch(/João Silva/);
    expect(prompt).toMatch(/5511999999999/);
  });
});

describe('processInboundWithAi', () => {
  it('no-op quando ai_enabled=false', async () => {
    // org_settings já vem com ai_enabled=false no seed da migration
    const lead = await createLead({ phone: '5511900000001' });
    const conv = await createConversation({ phone: '5511900000001', leadId: lead.id, queue: 'ia' });
    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000001',
      inboundText: 'oi',
    });
    expect(r.status).toBe('ai_disabled');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
  });

  it('no-op quando conversa não está na fila IA', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000002' });
    const conv = await createConversation({ phone: '5511900000002', leadId: lead.id, queue: 'recepcao' });
    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000002',
      inboundText: 'oi',
    });
    expect(r.status).toBe('queue_not_ia');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
  });

  it('move pra Recepção quando cliente pede humano', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000003' });
    const conv = await createConversation({ phone: '5511900000003', leadId: lead.id, queue: 'ia' });
    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000003',
      inboundText: 'quero falar com um humano',
    });
    expect(r.status).toBe('transferred_to_human');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.queue).toBe('recepcao');
  });

  it('chama Gemini, manda resposta via UazAPI, persiste msg out', async () => {
    await enableAi();
    mockGeminiText('Olá! Posso te ajudar. Qual o tamanho da sua frota?');
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-ai-001',
      rawPayload: {},
    });

    const lead = await createLead({ phone: '5511900000004', name: 'João' });
    const conv = await createConversation({ phone: '5511900000004', leadId: lead.id, queue: 'ia' });

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000004',
      inboundText: 'oi, quero saber sobre óleo',
    });
    expect(r.status).toBe('replied');

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe('out');
    expect(msgs[0].body).toBe('Olá! Posso te ajudar. Qual o tamanho da sua frota?');
    expect(msgs[0].sentByUserId).toBeNull(); // null = enviado pela IA
    expect(msgs[0].providerMsgId).toBe('uazapi-ai-001');
  });

  it('quando Gemini retorna [QUALIFICADO], move conversa pra Comercial + lead pra qualified', async () => {
    await enableAi();
    mockGeminiText('Perfeito, vou conectar você com nosso comercial agora. [QUALIFICADO]');
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-ai-002',
      rawPayload: {},
    });

    const lead = await createLead({ phone: '5511900000005', flowStage: 'engaged' });
    const conv = await createConversation({ phone: '5511900000005', leadId: lead.id, queue: 'ia' });

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000005',
      inboundText: 'quero fechar negócio agora',
    });
    expect(r.status).toBe('qualified_and_replied');
    // Tag não deve aparecer na msg enviada
    expect(r.reply).toBe('Perfeito, vou conectar você com nosso comercial agora.');

    const [updatedConv] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updatedConv.queue).toBe('comercial');

    const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updatedLead.flowStage).toBe('qualified');
  });

  it('gemini_error não persiste mensagem nem altera fila', async () => {
    await enableAi();
    vi.mocked(generateReplyDetailed).mockRejectedValueOnce(new Error('rate limit'));

    const lead = await createLead({ phone: '5511900000006' });
    const conv = await createConversation({ phone: '5511900000006', leadId: lead.id, queue: 'ia' });

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000006',
      inboundText: 'oi',
    });
    expect(r.status).toBe('gemini_error');
    expect(vi.mocked(uazapiClient.sendMessage)).not.toHaveBeenCalled();
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(0);
  });
});
