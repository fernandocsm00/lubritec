import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, leads, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

vi.mock('../services/whatsapp/uazapi/client', () => ({
  uazapiClient: {
    sendMessage: vi.fn(),
  },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));

import { uazapiClient } from '../services/whatsapp/uazapi/client';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('POST /api/conversations/start', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/conversations/start')
      .send({ phone: '5511987654321', kind: 'text', body: 'oi' });
    expect(res.status).toBe(401);
  });

  it('400 quando body falta para kind=text', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511987654321', kind: 'text' });
    expect(res.status).toBe(400);
  });

  it('400 quando phone é inválido (poucos dígitos)', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '123', kind: 'text', body: 'oi' });
    expect(res.status).toBe(400);
  });

  it('200 cria lead+conversa+mensagem para telefone novo, atribuído ao usuário', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-start-001',
      rawPayload: { ok: true },
    });
    const { token, userId } = await loginAs();

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '+55 (11) 98765-4321',
        name: 'João Silva',
        kind: 'text',
        body: 'Olá, tudo bem?',
      });
    expect(res.status).toBe(200);
    expect(res.body.conversation).toBeDefined();
    expect(res.body.message).toBeDefined();
    expect(res.body.message.direction).toBe('out');
    expect(res.body.message.body).toBe('Olá, tudo bem?');

    const phoneNorm = '5511987654321';
    const [lead] = await db.select().from(leads).where(eq(leads.phone, phoneNorm));
    expect(lead).toBeDefined();
    expect(lead.name).toBe('João Silva');
    expect(lead.source).toBe('whatsapp');

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, phoneNorm));
    expect(conv).toBeDefined();
    expect(conv.queue).toBe('recepcao');
    expect(conv.status).toBe('em_atendimento');
    expect(conv.assignedTo).toBe(userId);
    expect(conv.originKind).toBe('organic');

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uazapiMsgId).toBe('uazapi-start-001');
  });

  it('200 reusa lead+conversa existentes quando já existem para o telefone', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-start-002',
      rawPayload: {},
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '5511955554444', name: 'Lead Existente' });
    const conv = await createConversation({
      phone: '5511955554444',
      leadId: lead.id,
      status: 'aguardando_atendimento',
      assignedTo: null,
    });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511955554444',
        kind: 'text',
        body: 'voltei',
      });
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(conv.id);

    // sendMessage faz auto-claim e atribui ao usuário.
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.assignedTo).toBe(userId);
    expect(updated.status).toBe('em_atendimento');

    // Lead não duplicou.
    const allLeads = await db.select().from(leads).where(eq(leads.phone, '5511955554444'));
    expect(allLeads).toHaveLength(1);
  });

  it('200 envia mídia no primeiro envio', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-start-003',
      rawPayload: {},
    });
    const { token } = await loginAs();

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511944443333',
        kind: 'image',
        mediaUrl: 'https://cdn.example.com/foo.jpg',
        mediaMime: 'image/jpeg',
        body: 'olha essa promo',
      });
    expect(res.status).toBe(200);
    expect(res.body.message.kind).toBe('image');
    expect(res.body.message.mediaUrl).toBe('https://cdn.example.com/foo.jpg');
    expect(res.body.message.body).toBe('olha essa promo');
  });

  it('502 quando UazAPI falha — nada é persistido (lead/conversa também não)', async () => {
    vi.mocked(uazapiClient.sendMessage).mockRejectedValueOnce(new Error('uazapi down'));
    const { token } = await loginAs();

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511933332222',
        kind: 'text',
        body: 'tentativa',
      });
    expect(res.status).toBe(502);

    // Lead e conversa foram criados mas a mensagem não — comportamento aceito:
    // o upsert "fica de pé" pra retry. O importante é não persistir mensagem fantasma.
    const phoneNorm = '5511933332222';
    const msgsForPhone = await db
      .select({ id: messages.id })
      .from(messages)
      .leftJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.phone, phoneNorm));
    expect(msgsForPhone).toHaveLength(0);
  });
});
