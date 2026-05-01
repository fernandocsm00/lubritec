import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

vi.mock('../services/uazapiClient', () => ({
  uazapiClient: {
    sendMessage: vi.fn(),
  },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));

import { uazapiClient } from '../services/uazapiClient';

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
    expect(res.body.body).toBe('Olá! Posso ajudar?');

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sentByUserId).toBe(userId);
    expect(rows[0].uazapiMsgId).toBe('uazapi-out-001');
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
});
