import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import {
  whatsappInstance, conversations, messages, leads,
} from '../db/schema';
import { createWhatsappInstance } from './helpers';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';
import textFixture from './fixtures/meta-webhook-text.json';

vi.mock('../services/whatsapp/metaCloud/client', () => ({
  getPhoneNumberInfo: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  getMediaUrl: vi.fn().mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp_business/.../media',
    mimeType: 'image/jpeg',
  }),
  isOutOfSessionError: vi.fn().mockReturnValue(false),
  MetaGraphError: class extends Error {
    constructor(public status: number, public code: number | null, public body: unknown) {
      super(`${status}`); this.name = 'MetaGraphError';
    }
  },
}));

const app = createApp();

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token-very-long-string';

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
      webhookVerifyToken: VERIFY_TOKEN,
      webhookSubscribed: false,
    },
  });
}

function signBody(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

describe('GET /api/whatsapp/webhook/meta/:instanceId (verify)', () => {
  it('echoes hub.challenge when verify_token matches', async () => {
    const row = await seedMetaInstance();
    const res = await request(app)
      .get(`/api/whatsapp/webhook/meta/${row.id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '12345' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('returns 403 when verify_token does not match', async () => {
    const row = await seedMetaInstance();
    const res = await request(app)
      .get(`/api/whatsapp/webhook/meta/${row.id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown instanceId', async () => {
    const res = await request(app)
      .get(`/api/whatsapp/webhook/meta/${crypto.randomUUID()}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '12345' });
    expect(res.status).toBe(404);
  });

  it('returns 404 if instance exists but provider is not meta_cloud', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi', displayName: 'U' });
    const res = await request(app)
      .get(`/api/whatsapp/webhook/meta/${row.id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '12345' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/whatsapp/webhook/meta/:instanceId (events)', () => {
  it('returns 401 when X-Hub-Signature-256 is missing', async () => {
    const row = await seedMetaInstance();
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${row.id}`)
      .send(textFixture);
    expect(res.status).toBe(401);
  });

  it('returns 401 when HMAC signature does not match', async () => {
    const row = await seedMetaInstance();
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${row.id}`)
      .set('X-Hub-Signature-256', 'sha256=' + 'a'.repeat(64))
      .send(textFixture);
    expect(res.status).toBe(401);
  });

  it('returns 200 and persists message when HMAC is valid', async () => {
    const row = await seedMetaInstance();
    const body = JSON.stringify(textFixture);
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${row.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);

    // async pipeline — give it a tick
    await new Promise((r) => setTimeout(r, 200));

    const persistedMessages = await db.select().from(messages);
    expect(persistedMessages).toHaveLength(1);
    expect(persistedMessages[0].provider).toBe('meta_cloud');
    expect(persistedMessages[0].providerMsgId).toBe('wamid.HBgN1234ABCD');

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    expect(convs[0].instanceId).toBe(row.id);
    expect(convs[0].phone).toBe('5511988887777');

    const ldRows = await db.select().from(leads);
    expect(ldRows).toHaveLength(1);
    expect(ldRows[0].phone).toBe('5511988887777');
    expect(ldRows[0].name).toBe('João Silva');
  });
});
