import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance, conversations, messages, leads } from '../db/schema';
import { createWhatsappInstance, createLead, createConversation, createMessage } from './helpers';
import { eq } from 'drizzle-orm';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';

vi.mock('../services/whatsapp/metaCloud/client', () => ({
  getPhoneNumberInfo: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  isOutOfSessionError: vi.fn().mockReturnValue(false),
  MetaGraphError: class extends Error {},
}));

const app = createApp();
const APP_SECRET = 'test-app-secret';

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCache();
  await db.delete(messages); await db.delete(conversations);
  await db.delete(whatsappInstance); await db.delete(leads);
});

async function seedMetaInstance() {
  return createWhatsappInstance({
    provider: 'meta_cloud',
    displayName: 'Meta Test',
    isDefault: true,
    providerConfig: {
      wabaId: 'WABA_ID_123',
      phoneNumberId: 'PHONE_NUMBER_ID_456',
      accessToken: encryptSecret('access-token'),
      appSecret: encryptSecret(APP_SECRET),
      webhookVerifyToken: 'test-verify-token-very-long-string',
      webhookSubscribed: false,
    },
  });
}

async function seedOutbound(instanceId: string, wamid: string) {
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id, instanceId });
  return createMessage({
    conversationId: conv.id,
    direction: 'out',
    providerMsgId: wamid,
    provider: 'meta_cloud',
  });
}

function statusPayload(statuses: unknown[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID_123',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            phone_number_id: 'PHONE_NUMBER_ID_456',
            display_phone_number: '+55 11 99999-0000',
          },
          statuses,
        },
      }],
    }],
  };
}

async function postStatus(instanceId: string, statuses: unknown[]) {
  const body = JSON.stringify(statusPayload(statuses));
  const sig = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  return request(app)
    .post(`/api/whatsapp/webhook/meta/${instanceId}`)
    .set('X-Hub-Signature-256', sig)
    .set('Content-Type', 'application/json')
    .send(body);
}

async function readBack(id: string) {
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  return row;
}

describe('ACK de entrega da Meta Cloud (array statuses)', () => {
  it('marca delivered quando a Meta reporta delivered', async () => {
    const inst = await seedMetaInstance();
    const msg = await seedOutbound(inst.id, 'wamid.ACK1');

    const res = await postStatus(inst.id, [
      { id: 'wamid.ACK1', status: 'delivered', timestamp: '1729200000', recipient_id: '5511988887777' },
    ]);

    expect(res.status).toBe(200);
    expect((await readBack(msg.id)).deliveryStatus).toBe('delivered');
  });

  it('marca read quando a Meta reporta read', async () => {
    const inst = await seedMetaInstance();
    const msg = await seedOutbound(inst.id, 'wamid.ACK2');

    await postStatus(inst.id, [{ id: 'wamid.ACK2', status: 'read', timestamp: '1729200000' }]);

    expect((await readBack(msg.id)).deliveryStatus).toBe('read');
  });

  it('marca failed com o código do erro quando a Meta reporta failed', async () => {
    const inst = await seedMetaInstance();
    const msg = await seedOutbound(inst.id, 'wamid.ACK3');

    await postStatus(inst.id, [{
      id: 'wamid.ACK3',
      status: 'failed',
      timestamp: '1729200000',
      errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable' }],
    }]);

    const row = await readBack(msg.id);
    expect(row.deliveryStatus).toBe('failed');
    expect(row.deliveryErrorCode).toBe('131026');
    expect(row.deliveryErrorMessage).toContain('undeliverable');
  });

  it('aplica todos os status de um lote com várias mensagens', async () => {
    const inst = await seedMetaInstance();
    const a = await seedOutbound(inst.id, 'wamid.ACK4');
    const b = await seedOutbound(inst.id, 'wamid.ACK5');

    await postStatus(inst.id, [
      { id: 'wamid.ACK4', status: 'sent', timestamp: '1729200000' },
      { id: 'wamid.ACK5', status: 'read', timestamp: '1729200001' },
    ]);

    expect((await readBack(a.id)).deliveryStatus).toBe('sent');
    expect((await readBack(b.id)).deliveryStatus).toBe('read');
  });

  it('responde 200 para status de mensagem que não existe localmente', async () => {
    const inst = await seedMetaInstance();

    const res = await postStatus(inst.id, [{ id: 'wamid.DESCONHECIDO', status: 'delivered' }]);

    expect(res.status).toBe(200);
  });
});
