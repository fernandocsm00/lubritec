import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// O webhook da UazAPI só AGENDA a resposta da IA; quem junta as mensagens
// quebradas e responde uma vez é o aiInboundBatch, depois da espera.
const scheduleAiReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/aiInboundBatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiInboundBatch')>()),
  scheduleAiReply: scheduleAiReplyMock,
}));
const processInboundWithAiMock = vi.hoisted(() => vi.fn());
vi.mock('../services/aiAtendimento', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiAtendimento')>()),
  processInboundWithAi: processInboundWithAiMock,
}));

import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, leads } from '../db/schema';
import { createWhatsappInstance } from './helpers';

const app = createApp();
const SECRET = 'test-webhook-secret';

beforeEach(async () => {
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
  scheduleAiReplyMock.mockClear();
  processInboundWithAiMock.mockClear();
  await createWhatsappInstance({ isDefault: true });
});

function inboundText(id: string, text: string) {
  return request(app)
    .post('/api/whatsapp/webhook')
    .set('X-Webhook-Token', SECRET)
    .send({
      EventType: 'messages',
      message: {
        messageid: id,
        sender: '5554981673077@s.whatsapp.net',
        messageType: 'conversation',
        text,
        timestamp: 1790000000,
      },
    });
}

describe('webhook UazAPI → resposta da IA', () => {
  it('cada fragmento reagenda a resposta; nenhum dispara a IA na hora', async () => {
    await inboundText('FRAG-1', 'bom dia');
    await inboundText('FRAG-2', 'queria falar com um vendedor');

    expect(processInboundWithAiMock).not.toHaveBeenCalled();
    expect(scheduleAiReplyMock).toHaveBeenCalledTimes(2);
    const [conv] = await db.select().from(conversations);
    const [lead] = await db.select().from(leads);
    expect(scheduleAiReplyMock).toHaveBeenLastCalledWith({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5554981673077',
    });
  });
});
