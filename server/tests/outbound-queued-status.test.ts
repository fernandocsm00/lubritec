import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

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

async function loginAs(email = 'q@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string };
}

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('mensagem de saída nasce em queued (não em "entregue")', () => {
  it('persiste delivery_status=queued ao enviar pela Inbox', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'queued-001',
      // A UazAPI devolve isto pra TODO send — "Pending" é fila, não entrega.
      rawPayload: { status: 'Pending', messageid: 'queued-001' },
    });
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000060001' });
    const conv = await createConversation({ phone: '11000060001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(messages).where(eq(messages.id, res.body.id));
    expect(row.deliveryStatus).toBe('queued');
  });

  it('expõe deliveryStatus na resposta do envio', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'queued-002',
      rawPayload: { status: 'Pending' },
    });
    const { token } = await loginAs('q2@x.com');
    const lead = await createLead({ phone: '11000060002' });
    const conv = await createConversation({ phone: '11000060002', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    expect(res.body.deliveryStatus).toBe('queued');
  });

  it('expõe deliveryStatus na listagem de mensagens da conversa', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'queued-003',
      rawPayload: { status: 'Pending' },
    });
    const { token } = await loginAs('q3@x.com');
    const lead = await createLead({ phone: '11000060003' });
    const conv = await createConversation({ phone: '11000060003', leadId: lead.id });
    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`);

    const out = res.body.items.find((m: { direction: string }) => m.direction === 'out');
    expect(out.deliveryStatus).toBe('queued');
  });
});
