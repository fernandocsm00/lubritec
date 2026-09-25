import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import {
  createUser,
  createLead,
  createConversation,
  createWhatsappInstance,
  createHsmTemplate,
} from './helpers';

// Janela de atendimento da Meta: fora de 24h desde a última mensagem DO CLIENTE,
// a linha oficial só aceita template. A Meta devolve 200 no envio e só recusa
// minutos depois (131047, pelo webhook) — então o bloqueio tem que ser nosso,
// antes de chamar o provedor.
const { fakeProvider } = vi.hoisted(() => ({
  fakeProvider: {
    kind: 'meta_cloud' as 'uazapi' | 'meta_cloud',
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendTemplate: vi.fn(),
  },
}));

vi.mock('../services/whatsapp/providerRegistry', async (orig) => {
  const actual = await orig<typeof import('../services/whatsapp/providerRegistry')>();
  return { ...actual, resolveProvider: vi.fn(async () => fakeProvider) };
});

import { createApp } from '../app';

const app = createApp();
const HOUR = 60 * 60 * 1000;

async function loginAs() {
  await createUser({ email: 'v@x.com', password: 'pw12345', role: 'comercial', name: 'Itana' });
  const res = await request(app).post('/api/auth/login').send({ email: 'v@x.com', password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function metaConversation(lastInboundAt: Date | null, phone = '5575991011601') {
  const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });
  const lead = await createLead({ phone, name: 'Wdison' });
  const conv = await createConversation({
    phone,
    leadId: lead.id,
    instanceId: meta.id,
    lastInboundAt,
    status: 'em_atendimento',
  });
  return { meta, lead, conv };
}

beforeEach(() => {
  fakeProvider.kind = 'meta_cloud';
  fakeProvider.sendText.mockReset().mockResolvedValue({ providerMsgId: 'p-text-1', rawPayload: {} });
  fakeProvider.sendMedia.mockReset().mockResolvedValue({ providerMsgId: 'p-media-1', rawPayload: {} });
  fakeProvider.sendTemplate.mockReset().mockResolvedValue({ providerMsgId: 'p-tpl-1', rawPayload: {} });
});

describe('POST /api/conversations/:id/messages — janela de 24h da linha oficial', () => {
  it('409 e não chama o provedor quando o cliente não escreve há mais de 24h', async () => {
    const { token } = await loginAs();
    const { conv } = await metaConversation(new Date(Date.now() - 25 * HOUR));

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Bom dia amigo' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/janela de 24h/i);
    expect(fakeProvider.sendText).not.toHaveBeenCalled();
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(0);
  });

  it('409 quando o cliente nunca escreveu nesta linha', async () => {
    const { token } = await loginAs();
    const { conv } = await metaConversation(null);

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    expect(res.status).toBe(409);
    expect(fakeProvider.sendText).not.toHaveBeenCalled();
  });

  it('409 também para mídia fora da janela', async () => {
    const { token } = await loginAs();
    const { conv } = await metaConversation(new Date(Date.now() - 30 * HOUR));

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'image', mediaUrl: '/uploads/conversations/cotacao.jpg', mediaMime: 'image/jpeg' });

    expect(res.status).toBe(409);
    expect(fakeProvider.sendMedia).not.toHaveBeenCalled();
  });

  it('envia normalmente dentro da janela', async () => {
    const { token } = await loginAs();
    const { conv } = await metaConversation(new Date(Date.now() - 23 * HOUR));

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'segue a cotação' });

    expect(res.status).toBe(200);
    expect(fakeProvider.sendText).toHaveBeenCalledTimes(1);
  });

  it('linha não oficial (UazAPI) não tem janela', async () => {
    fakeProvider.kind = 'uazapi';
    const { token } = await loginAs();
    const lead = await createLead({ phone: '5511900001111' });
    const conv = await createConversation({
      phone: '5511900001111',
      leadId: lead.id,
      lastInboundAt: new Date(Date.now() - 72 * HOUR),
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    expect(res.status).toBe(200);
    expect(fakeProvider.sendText).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/conversations/:id/template — template dentro do chat', () => {
  it('dispara o template na própria conversa, mesmo com a janela fechada', async () => {
    const { token, userId } = await loginAs();
    const { meta, conv } = await metaConversation(new Date(Date.now() - 48 * HOUR));
    const tpl = await createHsmTemplate({
      instanceId: meta.id,
      createdBy: userId,
      name: 'retomada_cotacao_simples',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Olá, {{1}}! Aqui é da Lubritec, sobre a cotação que você nos pediu.' }],
      variableCount: 1,
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/template`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hsmTemplateId: tpl.id,
        hsmVariables: [{ index: 1, source: 'lead_field', value: 'name' }],
      });

    expect(res.status).toBe(200);
    expect(fakeProvider.sendText).not.toHaveBeenCalled();
    expect(fakeProvider.sendTemplate).toHaveBeenCalledWith({
      to: conv.phone,
      templateName: 'retomada_cotacao_simples',
      language: 'pt_BR',
      variables: [{ index: 1, value: 'Wdison' }],
    });
    expect(res.body.conversationId).toBe(conv.id);
    expect(res.body.direction).toBe('out');
    expect(res.body.body).toBe('Olá, Wdison! Aqui é da Lubritec, sobre a cotação que você nos pediu.');

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].providerMsgId).toBe('p-tpl-1');
    expect(rows[0].sentByUserId).toBe(userId);
    // Template NÃO reabre a janela: só a resposta do cliente reabre.
    const [after] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(after.lastInboundAt?.getTime()).toBe(conv.lastInboundAt?.getTime());
  });

  it('400 em conversa de linha não oficial', async () => {
    const { token, userId } = await loginAs();
    const uaz = await createWhatsappInstance({ provider: 'uazapi', displayName: 'Fixo' });
    const lead = await createLead({ phone: '5511900002222' });
    const conv = await createConversation({ phone: '5511900002222', leadId: lead.id, instanceId: uaz.id });
    const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });
    const tpl = await createHsmTemplate({ instanceId: meta.id, createdBy: userId, status: 'APPROVED' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/template`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hsmTemplateId: tpl.id, hsmVariables: [] });

    expect(res.status).toBe(400);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });

  it('404 quando o template é de outra linha', async () => {
    const { token, userId } = await loginAs();
    const { conv } = await metaConversation(null);
    const outra = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Distribuidora' });
    const tpl = await createHsmTemplate({ instanceId: outra.id, createdBy: userId, status: 'APPROVED' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/template`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hsmTemplateId: tpl.id, hsmVariables: [] });

    expect(res.status).toBe(404);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });

  it('400 quando o template não está aprovado', async () => {
    const { token, userId } = await loginAs();
    const { meta, conv } = await metaConversation(null);
    const tpl = await createHsmTemplate({ instanceId: meta.id, createdBy: userId, status: 'PENDING' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/template`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hsmTemplateId: tpl.id, hsmVariables: [] });

    expect(res.status).toBe(400);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });

  it('404 quando a conversa não existe', async () => {
    const { token } = await loginAs();

    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/template')
      .set('Authorization', `Bearer ${token}`)
      .send({ hsmTemplateId: '00000000-0000-0000-0000-000000000000', hsmVariables: [] });

    expect(res.status).toBe(404);
  });
});
