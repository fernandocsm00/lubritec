import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { createUser, createWhatsappInstance, createHsmTemplate } from './helpers';

// Mocka só o resolveProvider — o que importa aqui é QUAL método de envio é
// chamado (sendText vs sendTemplate) e com quais argumentos, não o gateway real.
const { fakeProvider } = vi.hoisted(() => ({
  fakeProvider: {
    kind: 'uazapi' as 'uazapi' | 'meta_cloud',
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

async function loginAs() {
  await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao', name: 'Recep' });
  const res = await request(app).post('/api/auth/login').send({ email: 'r@x.com', password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

beforeEach(() => {
  fakeProvider.kind = 'uazapi';
  fakeProvider.sendText.mockReset().mockResolvedValue({ providerMsgId: 'p-text-1', rawPayload: {} });
  fakeProvider.sendMedia.mockReset().mockResolvedValue({ providerMsgId: 'p-media-1', rawPayload: {} });
  fakeProvider.sendTemplate.mockReset().mockResolvedValue({ providerMsgId: 'p-tpl-1', rawPayload: {} });
});

describe('POST /api/conversations/start — seleção de instância + HSM', () => {
  it('usa a instância passada (instanceId) em vez da default', async () => {
    const { token } = await loginAs();
    await createWhatsappInstance({ isDefault: true, displayName: 'Default A' });
    const lineB = await createWhatsappInstance({ isDefault: false, displayName: 'Linha B' });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511988887777', kind: 'text', body: 'oi pela linha B', instanceId: lineB.id });

    expect(res.status).toBe(200);
    expect(fakeProvider.sendText).toHaveBeenCalledTimes(1);
    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511988887777'));
    expect(conv.instanceId).toBe(lineB.id);
  });

  it('cai na instância default quando instanceId é omitido', async () => {
    const { token } = await loginAs();
    const def = await createWhatsappInstance({ isDefault: true, displayName: 'Default A' });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511977776666', kind: 'text', body: 'oi default' });

    expect(res.status).toBe(200);
    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511977776666'));
    expect(conv.instanceId).toBe(def.id);
  });

  it('400 quando instância é Meta Cloud e nenhum template é informado', async () => {
    const { token } = await loginAs();
    const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511966665555', kind: 'text', body: 'oi', instanceId: meta.id });

    expect(res.status).toBe(400);
    // Nada persistido (validação antes de criar lead/conversa).
    const convs = await db.select().from(conversations).where(eq(conversations.phone, '5511966665555'));
    expect(convs).toHaveLength(0);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });

  it('400 quando instância é UazAPI mas um hsmTemplateId é informado', async () => {
    const { token } = await loginAs();
    const def = await createWhatsappInstance({ isDefault: true, displayName: 'Default A' });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511955554444', kind: 'text', body: 'oi', instanceId: def.id, hsmTemplateId: randomUUID() });

    expect(res.status).toBe(400);
  });

  it('Meta Cloud com template aprovado: dispara sendTemplate com variáveis resolvidas e persiste a mensagem', async () => {
    const { token, userId } = await loginAs();
    const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });
    const tpl = await createHsmTemplate({
      instanceId: meta.id,
      createdBy: userId,
      name: 'promo_troca_oleo',
      language: 'pt_BR',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá {{1}}, aqui é a {{2}}.' }],
      variableCount: 2,
    });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511944443333',
        name: 'Cliente X',
        kind: 'text',
        instanceId: meta.id,
        hsmTemplateId: tpl.id,
        hsmVariables: [
          { index: 1, source: 'lead_field', value: 'name' },
          { index: 2, source: 'static', value: 'Lubritec' },
        ],
      });

    expect(res.status).toBe(200);
    expect(fakeProvider.sendText).not.toHaveBeenCalled();
    expect(fakeProvider.sendTemplate).toHaveBeenCalledTimes(1);
    expect(fakeProvider.sendTemplate).toHaveBeenCalledWith({
      to: '5511944443333',
      templateName: 'promo_troca_oleo',
      language: 'pt_BR',
      variables: [
        { index: 1, value: 'Cliente X' },   // lead_field name → nome do lead criado
        { index: 2, value: 'Lubritec' },    // static
      ],
    });

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511944443333'));
    expect(conv.instanceId).toBe(meta.id);
    expect(conv.originKind).toBe('organic');

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].provider).toBe('meta_cloud');
    expect(msgs[0].providerMsgId).toBe('p-tpl-1');
    // Body renderizado pra inbox legível.
    expect(msgs[0].body).toBe('Olá Cliente X, aqui é a Lubritec.');
  });

  it('404 quando o template pertence a outra instância', async () => {
    const { token, userId } = await loginAs();
    const metaA = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial A' });
    const metaB = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial B' });
    const tplB = await createHsmTemplate({
      instanceId: metaB.id,
      createdBy: userId,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'oi {{1}}' }],
    });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511933332222',
        kind: 'text',
        instanceId: metaA.id,
        hsmTemplateId: tplB.id,
        hsmVariables: [{ index: 1, source: 'static', value: 'x' }],
      });

    expect(res.status).toBe(404);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });

  it('400 quando o template não está aprovado', async () => {
    const { token, userId } = await loginAs();
    const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });
    const tpl = await createHsmTemplate({
      instanceId: meta.id,
      createdBy: userId,
      status: 'PENDING',
      components: [{ type: 'BODY', text: 'oi {{1}}' }],
    });

    const res = await request(app)
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '5511922221111',
        kind: 'text',
        instanceId: meta.id,
        hsmTemplateId: tpl.id,
        hsmVariables: [{ index: 1, source: 'static', value: 'x' }],
      });

    expect(res.status).toBe(400);
    expect(fakeProvider.sendTemplate).not.toHaveBeenCalled();
  });
});
