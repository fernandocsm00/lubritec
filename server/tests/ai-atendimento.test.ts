import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

// Zera o delay humanizado da IA — pra suite nao esperar 30s por reply.
process.env.AI_REPLY_MIN_MS = '0';

import { db } from '../db/client';
import { conversations, messages, leads, orgSettings } from '../db/schema';
import {
  detectHumanIntent,
  buildSystemPrompt,
  parseQualificationTag,
  processInboundWithAi,
} from '../services/aiAtendimento';
import { createLead, createConversation, createMessage, createUser } from './helpers';

vi.mock('../services/geminiClient', () => ({
  generateReply: vi.fn(),
  generateReplyDetailed: vi.fn(),
  GeminiError: class extends Error {
    constructor(public reason: string) { super(`GeminiError: ${reason}`); }
  },
}));

// A IA envia pelo provider da linha DA conversa (resolveProvider), nao pelo
// cliente UazAPI fixo — senao conversa de linha Meta Cloud quebra no envio.
// `providerKind.current` simula a linha em que a conversa vive.
const sendTextMock = vi.hoisted(() => vi.fn());
const providerKind = vi.hoisted(() => ({ current: 'uazapi' as 'uazapi' | 'meta_cloud' }));
vi.mock('../services/whatsapp/providerRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/whatsapp/providerRegistry')>()),
  resolveProvider: vi.fn(async (instanceId: string) => ({
    kind: providerKind.current,
    instanceId,
    sendText: sendTextMock,
  })),
}));

import { generateReply, generateReplyDetailed } from '../services/geminiClient';
import { resolveProvider } from '../services/whatsapp/providerRegistry';

/** Resposta de envio bem-sucedido no shape do WhatsAppProvider.sendText. */
function mockSendOk(providerMsgId: string) {
  sendTextMock.mockResolvedValueOnce({ providerMsgId, rawPayload: {} });
}

beforeEach(() => {
  vi.mocked(generateReply).mockReset();
  vi.mocked(generateReplyDetailed).mockReset();
  sendTextMock.mockReset();
  vi.mocked(resolveProvider).mockClear();
  providerKind.current = 'uazapi';
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
    // ai24x7=true nos testes pra evitar flakiness por causa do horario comercial.
    // Testes especificos de business-hours setam ai24x7=false explicitamente.
    ai24x7: true,
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
    expect(r.summary).toBeNull();
  });

  it('extrai bloco [RESUMO] junto com [QUALIFICADO]', () => {
    const r = parseQualificationTag(
      'Perfeito, vou conectar você com o comercial.\n' +
      '[RESUMO]\n' +
      'Frota: 8 caminhões.\n' +
      'Interesse: contrato mensal de troca.\n' +
      'Próximo passo: enviar orçamento.\n' +
      '[/RESUMO]\n' +
      '[QUALIFICADO]'
    );
    expect(r.qualification).toBe('qualified');
    expect(r.cleanReply).toBe('Perfeito, vou conectar você com o comercial.');
    expect(r.summary).toContain('Frota: 8 caminhões');
    expect(r.summary).toContain('Próximo passo');
  });

  it('summary=null se IA esquece o bloco RESUMO (degrada gracioso)', () => {
    const r = parseQualificationTag('Vou te conectar. [QUALIFICADO]');
    expect(r.qualification).toBe('qualified');
    expect(r.cleanReply).toBe('Vou te conectar.');
    expect(r.summary).toBeNull();
  });

  it('NAO_QUALIFICADO nao traz summary', () => {
    const r = parseQualificationTag('Sem problemas, obrigado pelo contato. [NAO_QUALIFICADO]');
    expect(r.qualification).toBe('not_qualified');
    expect(r.summary).toBeNull();
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

  it('no-op + limpa o pending quando a conversa saiu das filas da IA', async () => {
    // Antes deste teste a fila 'recepcao' era o caso de no-op. Desde 05/08/2026 a
    // IA atende 'ia' + 'recepcao'; quem sobrou de fora é 'comercial' (humano
    // assumiu). O pending precisa ser limpo pra não ficar pendurado no worker.
    await enableAi();
    const lead = await createLead({ phone: '5511900000002' });
    const conv = await createConversation({ phone: '5511900000002', leadId: lead.id, queue: 'comercial' });
    await db.update(conversations)
      .set({ pendingAiResponse: true })
      .where(eq(conversations.id, conv.id));

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000002',
      inboundText: 'oi',
    });
    expect(r.status).toBe('queue_not_ia');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.pendingAiResponse).toBe(false);
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
    mockSendOk('uazapi-ai-001');

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

  it('auto-reply (<15s): IA responde mas NÃO passa pro comercial mesmo qualificado', async () => {
    await enableAi();
    mockGeminiText('Perfeito, vou te conectar. [QUALIFICADO]');
    mockSendOk('ai-ar-1');
    const owner = await createUser({ email: 'ar-owner@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '5511900000010', flowStage: 'engaged' });
    const conv = await createConversation({ phone: '5511900000010', leadId: lead.id, queue: 'ia', originKind: 'campaign' });
    const t0 = new Date(Date.now() - 60_000);
    // Disparo (outbound de um usuário) + auto-reply 5s depois.
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'disparo', sentByUserId: owner.id, sentAt: t0 });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'auto', sentAt: new Date(t0.getTime() + 5_000) });

    const r = await processInboundWithAi({ conversationId: conv.id, leadId: lead.id, phone: '5511900000010', inboundText: 'auto' });
    expect(r.status).toBe('replied'); // respondeu, mas não handoff
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.queue).toBe('ia'); // ficou na IA
  });

  it('resposta genuína (>=15s): qualificado move pro comercial', async () => {
    await enableAi();
    mockGeminiText('Perfeito, vou te conectar. [QUALIFICADO]');
    mockSendOk('ai-ar-2');
    const owner = await createUser({ email: 'ar-owner2@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '5511900000011', flowStage: 'engaged' });
    const conv = await createConversation({ phone: '5511900000011', leadId: lead.id, queue: 'ia', originKind: 'campaign' });
    const t0 = new Date(Date.now() - 120_000);
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'disparo', sentByUserId: owner.id, sentAt: t0 });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'oi quero orçamento', sentAt: new Date(t0.getTime() + 60_000) });

    const r = await processInboundWithAi({ conversationId: conv.id, leadId: lead.id, phone: '5511900000011', inboundText: 'oi quero orçamento' });
    expect(r.status).toBe('qualified_and_replied');
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.queue).toBe('comercial');
  });

  it('anti-loop: 2º auto-reply após msg da IA é ignorado (nem chama Gemini)', async () => {
    await enableAi();
    const owner = await createUser({ email: 'ar-owner3@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '5511900000012', flowStage: 'engaged' });
    const conv = await createConversation({ phone: '5511900000012', leadId: lead.id, queue: 'ia', originKind: 'campaign' });
    const t0 = new Date(Date.now() - 120_000);
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'disparo', sentByUserId: owner.id, sentAt: t0 });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'auto1', sentAt: new Date(t0.getTime() + 3_000) });
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'resposta IA', sentByUserId: null, sentAt: new Date(t0.getTime() + 6_000) });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'auto2', sentAt: new Date(t0.getTime() + 8_000) });

    const r = await processInboundWithAi({ conversationId: conv.id, leadId: lead.id, phone: '5511900000012', inboundText: 'auto2' });
    expect(r.status).toBe('auto_reply_ignored');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.queue).toBe('ia');
  });

  it('quando Gemini retorna [QUALIFICADO], move conversa pra Comercial + lead pra qualified', async () => {
    await enableAi();
    mockGeminiText('Perfeito, vou conectar você com nosso comercial agora. [QUALIFICADO]');
    mockSendOk('uazapi-ai-002');

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

    // B4: createDeal chamado automaticamente apos qualificacao → flowStage vira 'handed_off'
    const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updatedLead.flowStage).toBe('handed_off');
  });

  it('responde na linha DA conversa — Meta Cloud sai pelo provider da Meta, não pelo UazAPI', async () => {
    // Regressao: a IA enviava sempre via uazapiClient. Numa conversa de linha
    // Meta Cloud isso estourava "WhatsApp instance not configured" (a row meta
    // nao tem instanceToken), entao a IA nunca conseguia responder nessa linha.
    await enableAi();
    providerKind.current = 'meta_cloud';
    mockGeminiText('Claro, temos linha completa de lubrificantes.');
    mockSendOk('wamid.ai-meta-001');

    const lead = await createLead({ phone: '5511900000007', name: 'Meta Lead' });
    const conv = await createConversation({ phone: '5511900000007', leadId: lead.id, queue: 'ia' });

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511900000007',
      inboundText: 'vocês trabalham com qual marca?',
    });
    expect(r.status).toBe('replied');

    // Resolveu o provider pela instância da conversa (multi-linha).
    expect(vi.mocked(resolveProvider)).toHaveBeenCalledWith(conv.instanceId);
    expect(sendTextMock).toHaveBeenCalledWith({
      to: '5511900000007',
      text: 'Claro, temos linha completa de lubrificantes.',
    });
    // E a msg persistida registra o provider real, não 'uazapi' chumbado.
    const [msg] = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msg.provider).toBe('meta_cloud');
  });

  it('responde conversa na fila RECEPÇÃO e a mantém lá (não move pra IA)', async () => {
    await enableAi();
    mockGeminiText('Oi! Aqui é a Lara, da Lubritec. Como posso ajudar?');
    mockSendOk('ai-recep-1');

    const lead = await createLead({ phone: '5511900000020' });
    const conv = await createConversation({ phone: '5511900000020', leadId: lead.id, queue: 'recepcao' });

    const r = await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: '5511900000020', inboundText: 'bom dia',
    });
    expect(r.status).toBe('replied');
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.queue).toBe('recepcao'); // continua visível na Recepção
  });

  it('não responde quando a IA foi desligada naquela conversa (humano assumiu)', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000021' });
    const conv = await createConversation({
      phone: '5511900000021', leadId: lead.id, queue: 'recepcao', aiDisabled: true,
    });

    const r = await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: '5511900000021', inboundText: 'e aí?',
    });
    expect(r.status).toBe('conversation_ai_off');
    expect(vi.mocked(generateReplyDetailed)).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('ai_disabled trava a IA também na fila IA', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000022' });
    const conv = await createConversation({
      phone: '5511900000022', leadId: lead.id, queue: 'ia', aiDisabled: true,
    });

    const r = await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: '5511900000022', inboundText: 'oi',
    });
    expect(r.status).toBe('conversation_ai_off');
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('não responde na fila COMERCIAL (humano já assumiu)', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000023' });
    const conv = await createConversation({ phone: '5511900000023', leadId: lead.id, queue: 'comercial' });

    const r = await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: '5511900000023', inboundText: 'oi',
    });
    expect(r.status).toBe('queue_not_ia');
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('pedido de humano na Recepção desliga a IA da conversa (senão ela responderia de novo)', async () => {
    await enableAi();
    const lead = await createLead({ phone: '5511900000024' });
    const conv = await createConversation({ phone: '5511900000024', leadId: lead.id, queue: 'recepcao' });

    const r = await processInboundWithAi({
      conversationId: conv.id, leadId: lead.id, phone: '5511900000024', inboundText: 'quero falar com um atendente',
    });
    expect(r.status).toBe('transferred_to_human');
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.aiDisabled).toBe(true);
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
    expect(sendTextMock).not.toHaveBeenCalled();
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(0);
  });
});
