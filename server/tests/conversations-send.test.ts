import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

// O UazapiProvider chama sendUazapiMessage() direto (não via uazapiClient).
// Compartilha a mesma vi.fn entre os dois nomes pra os testes controlarem o envio.
const { sendUazapiMessageMock } = vi.hoisted(() => ({ sendUazapiMessageMock: vi.fn() }));
vi.mock('../services/whatsapp/uazapi/client', () => ({
  sendUazapiMessage: sendUazapiMessageMock,
  uazapiClient: {
    sendMessage: sendUazapiMessageMock,
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
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

describe('POST /api/conversations/:id/messages', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .send({ kind: 'text', body: 'oi' });
    expect(res.status).toBe(401);
  });

  it('404 quando conversa não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });
    expect(res.status).toBe(404);
  });

  it('400 quando body falta para kind=text', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050001' });
    const conv = await createConversation({ phone: '11000050001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text' });
    expect(res.status).toBe(400);
  });

  it('200 envia texto, persiste com direction=out', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-001',
      rawPayload: { ok: true },
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000050010' });
    const conv = await createConversation({ phone: '11000050010', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Olá! Posso ajudar?' });
    expect(res.status).toBe(200);
    expect(res.body.direction).toBe('out');
    expect(res.body.body).toBe('*Test User:*\nOlá! Posso ajudar?');

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sentByUserId).toBe(userId);
    expect(rows[0].providerMsgId).toBe('uazapi-out-001');
  });

  it('502 quando UazAPI falha — nada é persistido', async () => {
    vi.mocked(uazapiClient.sendMessage).mockRejectedValueOnce(new Error('connection lost'));
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050020' });
    const conv = await createConversation({ phone: '11000050020', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'tentativa' });
    expect(res.status).toBe(502);

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(0);
  });

  it('auto-claim: primeira msg outbound atribui usuário se sem dono', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-002',
      rawPayload: {},
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000050030' });
    const conv = await createConversation({
      phone: '11000050030',
      leadId: lead.id,
      assignedTo: null,
      status: 'aguardando_atendimento',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.assignedTo).toBe(userId);
    expect(row.status).toBe('em_atendimento');
  });

  it('handoff IA→COMERCIAL: resposta do Inside Sales pela Inbox tira a conversa da IA', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-ia-01',
      rawPayload: {},
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000050035' });
    const conv = await createConversation({
      phone: '11000050035',
      leadId: lead.id,
      queue: 'ia',
      assignedTo: null,
      status: 'aguardando_atendimento',
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Oi, aqui é o comercial' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.queue).toBe('comercial');
    expect(row.assignedTo).toBe(userId);
    expect(row.status).toBe('em_atendimento');
    expect(row.pendingAiResponse).toBe(false);
    expect(row.enteredQueueAt).not.toBeNull();
  });

  it('conversa fora da IA: envio não altera a fila (recepcao permanece recepcao)', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-rec-01',
      rawPayload: {},
    });
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050037' });
    const conv = await createConversation({
      phone: '11000050037',
      leadId: lead.id,
      queue: 'recepcao',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.queue).toBe('recepcao');
  });

  it('envia mídia: mediaUrl obrigatório, body opcional', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-003',
      rawPayload: {},
    });
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050040' });
    const conv = await createConversation({ phone: '11000050040', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/abc.jpg',
        mediaMime: 'image/jpeg',
      });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('image');
    expect(res.body.mediaUrl).toBe('https://uazapi-cdn.example.com/img/abc.jpg');
  });

  it('400 quando mediaUrl falta para kind!=text', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050050' });
    const conv = await createConversation({ phone: '11000050050', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'image' });
    expect(res.status).toBe(400);
  });

  it('aceita mediaUrl relativa (/uploads/...) e expande pra absoluta na chamada ao provider', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-004',
      rawPayload: {},
    });
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050060' });
    const conv = await createConversation({ phone: '11000050060', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'app.example.com')
      .send({
        kind: 'image',
        mediaUrl: '/uploads/conversations/abc.png',
        mediaMime: 'image/png',
      });
    expect(res.status).toBe(200);
    // DB/UI continua com a relativa (portátil).
    expect(res.body.mediaUrl).toBe('/uploads/conversations/abc.png');
    // Provider recebe a absoluta montada com o host do request.
    const call = vi.mocked(uazapiClient.sendMessage).mock.calls[0][0];
    expect(call.mediaUrl).toBe('http://app.example.com/uploads/conversations/abc.png');
  });

  it('400 quando mediaUrl não é http(s) nem /uploads/', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050070' });
    const conv = await createConversation({ phone: '11000050070', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'file:///etc/passwd',
      });
    expect(res.status).toBe(400);
  });
});
