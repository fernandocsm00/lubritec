import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation, createMessage } from './helpers';

// Mock UazAPI: delete/edit nao chamam rede de verdade nos testes.
vi.mock('../services/whatsapp/uazapi/client', () => ({
  uazapiClient: {
    sendMessage: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
  },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));

import { uazapiClient } from '../services/whatsapp/uazapi/client';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao' = 'comercial') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

beforeEach(() => {
  vi.mocked(uazapiClient.deleteMessage).mockReset();
  vi.mocked(uazapiClient.editMessage).mockReset();
});

// Helper pra montar um conv + msg outbound do user com sentAt customizado.
async function setupOutbound(opts: {
  authorEmail: string;
  authorRole?: 'admin' | 'comercial' | 'recepcao';
  ageMs?: number;
  body?: string;
  providerMsgId?: string;
}) {
  const { token, userId } = await loginAs(opts.authorEmail, opts.authorRole);
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id });
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    body: opts.body ?? 'mensagem original',
    sentByUserId: userId,
    providerMsgId: opts.providerMsgId ?? `provid-${Date.now()}-${Math.random()}`,
    sentAt: new Date(Date.now() - (opts.ageMs ?? 0)),
  });
  return { token, userId, conv, msg };
}

describe('DELETE /api/conversations/:id/messages/:msgId', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete(
      '/api/conversations/00000000-0000-0000-0000-000000000000/messages/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(401);
  });

  it('autor consegue apagar: marca deleted_at + chama UazAPI', async () => {
    const { token, conv, msg } = await setupOutbound({ authorEmail: 'a1@x.com' });
    vi.mocked(uazapiClient.deleteMessage).mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).not.toBeNull();
    expect(uazapiClient.deleteMessage).toHaveBeenCalledWith(msg.providerMsgId);

    const [row] = await db.select().from(messages).where(eq(messages.id, msg.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it('admin pode apagar msg de outro usuario', async () => {
    const author = await createUser({ email: 'au1@x.com', password: 'pw12345', role: 'comercial' });
    const { token } = await loginAs('admin1@x.com', 'admin');
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const msg = await createMessage({
      conversationId: conv.id,
      direction: 'out',
      body: 'mensagem do colega',
      sentByUserId: author.id,
      providerMsgId: 'pm-admin-1',
    });
    vi.mocked(uazapiClient.deleteMessage).mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('403 quando user nao-admin tenta apagar msg de outra pessoa', async () => {
    const author = await createUser({ email: 'au2@x.com', password: 'pw12345', role: 'comercial' });
    const { token } = await loginAs('outro@x.com', 'comercial');
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const msg = await createMessage({
      conversationId: conv.id,
      direction: 'out',
      body: 'msg alheia',
      sentByUserId: author.id,
      providerMsgId: 'pm-403-1',
    });

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(uazapiClient.deleteMessage).not.toHaveBeenCalled();
  });

  it('400 quando tenta apagar msg inbound', async () => {
    const { token } = await loginAs('aa@x.com');
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const msg = await createMessage({
      conversationId: conv.id,
      direction: 'in',
      body: 'oi cliente',
      providerMsgId: 'in-1',
    });

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('409 quando msg ja foi apagada antes', async () => {
    const { token, conv, msg } = await setupOutbound({ authorEmail: 'b1@x.com' });
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, msg.id));

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it('409 quando msg tem mais de 48h', async () => {
    const { token, conv, msg } = await setupOutbound({
      authorEmail: 'old@x.com',
      ageMs: 49 * 60 * 60 * 1000,
    });

    const res = await request(app)
      .delete(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(uazapiClient.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/conversations/:id/messages/:msgId', () => {
  it('autor edita: troca body, seta edited_at e snapshot em original_body', async () => {
    const { token, conv, msg } = await setupOutbound({ authorEmail: 'e1@x.com', body: 'texto antigo' });
    vi.mocked(uazapiClient.editMessage).mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'texto novo' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('texto novo');
    expect(res.body.editedAt).not.toBeNull();
    expect(uazapiClient.editMessage).toHaveBeenCalledWith(msg.providerMsgId, 'texto novo');

    const [row] = await db.select().from(messages).where(eq(messages.id, msg.id));
    expect(row.body).toBe('texto novo');
    expect(row.editedAt).not.toBeNull();
    expect(row.originalBody).toBe('texto antigo');
  });

  it('409 quando msg tem mais de 15min', async () => {
    const { token, conv, msg } = await setupOutbound({
      authorEmail: 'old2@x.com',
      ageMs: 16 * 60 * 1000,
    });

    const res = await request(app)
      .patch(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'tarde demais' });
    expect(res.status).toBe(409);
    expect(uazapiClient.editMessage).not.toHaveBeenCalled();
  });

  it('400 quando body vazio', async () => {
    const { token, conv, msg } = await setupOutbound({ authorEmail: 'e2@x.com' });
    const res = await request(app)
      .patch(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('no-op quando body igual ao atual: nao chama UazAPI', async () => {
    const { token, conv, msg } = await setupOutbound({ authorEmail: 'e3@x.com', body: 'mesmo' });
    const res = await request(app)
      .patch(`/api/conversations/${conv.id}/messages/${msg.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'mesmo' });
    expect(res.status).toBe(200);
    expect(uazapiClient.editMessage).not.toHaveBeenCalled();
  });
});
