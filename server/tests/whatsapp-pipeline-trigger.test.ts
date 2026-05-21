import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

vi.mock('../services/whatsapp/uazapi/client', () => ({
  uazapiClient: { sendMessage: vi.fn() },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));
import { uazapiClient } from '../services/whatsapp/uazapi/client';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345') {
  const u = await createUser({ email, password, role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('POST /api/conversations/:id/messages → pipeline trigger', () => {
  it('mandar imagem em conversa Comercial cria deal automaticamente', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-img-001',
      rawPayload: { ok: true },
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000110001' });
    const conv = await createConversation({
      phone: '11000110001',
      leadId: lead.id,
      queue: 'comercial',
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/abc.jpg',
        mediaMime: 'image/jpeg',
      });
    expect(res.status).toBe(200);

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d).toBeDefined();
    expect(d.stage).toBe('lead_no_comercial');
    expect(d.ownerUserId).toBe(userId);
  });

  it('mandar texto em conversa Comercial NÃO cria deal', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-txt-001',
      rawPayload: {},
    });
    const { token } = await loginAs('c2@x.com');
    const lead = await createLead({ phone: '11000110010' });
    const conv = await createConversation({
      phone: '11000110010',
      leadId: lead.id,
      queue: 'comercial',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(0);
  });

  it('mandar imagem em conversa Recepção NÃO cria deal', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-img-002',
      rawPayload: {},
    });
    const { token } = await loginAs('c3@x.com');
    const lead = await createLead({ phone: '11000110020' });
    const conv = await createConversation({
      phone: '11000110020',
      leadId: lead.id,
      queue: 'recepcao',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/xyz.jpg',
      });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(0);
  });
});
