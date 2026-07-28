import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { createUser, createLead, createConversation, createMessage, createWhatsappInstance } from './helpers';
import { ingestInboundMessage } from '../services/whatsappWebhookService';
import { listMessages } from '../services/conversationsService';

const { sendUazapiMessageMock } = vi.hoisted(() => ({ sendUazapiMessageMock: vi.fn() }));
vi.mock('../services/whatsapp/uazapi/client', () => ({
  sendUazapiMessage: sendUazapiMessageMock,
  uazapiClient: { sendMessage: sendUazapiMessageMock, deleteMessage: vi.fn(), editMessage: vi.fn() },
  UazapiError: class extends Error { constructor(public status: number, public body: string) { super(`UazAPI ${status}`); } },
}));

const app = createApp();

async function loginAs(email = 'qr@x.com') {
  await createUser({ email, password: 'pw12345', role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => { sendUazapiMessageMock.mockReset(); });

describe('responder citando (quoted reply)', () => {
  it('envio: guarda replyToMessageId e devolve o snapshot da citada', async () => {
    const token = await loginAs('qr-send@x.com');
    const lead = await createLead({ phone: '11000060001' });
    const conv = await createConversation({ phone: '11000060001', leadId: lead.id });

    sendUazapiMessageMock.mockResolvedValueOnce({ messageId: 'wamid-1', rawPayload: {} });
    const first = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Primeira' });
    expect(first.status).toBe(200);

    sendUazapiMessageMock.mockResolvedValueOnce({ messageId: 'wamid-2', rawPayload: {} });
    const reply = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Respondendo', replyToMessageId: first.body.id });

    expect(reply.status).toBe(200);
    expect(reply.body.replyTo?.id).toBe(first.body.id);

    const [row] = await db.select().from(messages).where(eq(messages.id, reply.body.id));
    expect(row.replyToMessageId).toBe(first.body.id);
  });

  it('inbound: mapeia o context (wamid citado) pro nosso registro', async () => {
    const inst = (await createWhatsappInstance()).id;
    const lead = await createLead({ phone: '5511990002222' });
    const conv = await createConversation({
      phone: '5511990002222', leadId: lead.id, instanceId: inst,
    });
    // Mensagem NOSSA que o lead vai citar.
    const ours = await createMessage({
      conversationId: conv.id, direction: 'out', body: 'Segue o portfólio',
      providerMsgId: 'wamid-OUR', provider: 'meta_cloud',
    });

    await ingestInboundMessage({
      instanceId: inst,
      provider: 'meta_cloud',
      leadPhone: '5511990002222',
      kind: 'text',
      text: 'quero sim',
      providerMsgId: 'wamid-IN-1',
      replyToProviderMsgId: 'wamid-OUR',
      sentAt: new Date(),
      rawPayload: {},
    });

    const [inbound] = await db.select().from(messages).where(eq(messages.providerMsgId, 'wamid-IN-1'));
    expect(inbound.replyToMessageId).toBe(ours.id);

    // listMessages resolve o snapshot da citada.
    const { items } = await listMessages(conv.id);
    const inMsg = items.find((m) => m.id === inbound.id);
    expect(inMsg?.replyTo?.id).toBe(ours.id);
    expect(inMsg?.replyTo?.body).toBe('Segue o portfólio');
  });
});
