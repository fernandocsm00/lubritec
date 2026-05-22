import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import {
  whatsappInstance, whatsappHsmTemplates, conversations, messages, leads, campaigns, users,
} from '../db/schema';
import { createUser, createWhatsappInstance, createHsmTemplate } from './helpers';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';
import templateStatusFixture from './fixtures/meta-webhook-template-status.json';

vi.mock('../services/whatsapp/metaCloud/client', async () => {
  const actual = await vi.importActual<typeof import('../services/whatsapp/metaCloud/client')>(
    '../services/whatsapp/metaCloud/client'
  );
  return {
    ...actual,
    getPhoneNumberInfo: vi.fn(),
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    getMediaUrl: vi.fn(),
    isOutOfSessionError: vi.fn().mockReturnValue(false),
  };
});

const app = createApp();

const APP_SECRET = 'app-sec-test';
const VERIFY_TOKEN = 'verify-token-long-enough';

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCache();
  await db.delete(campaigns);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(whatsappHsmTemplates);
  await db.delete(whatsappInstance);
  await db.delete(leads);
});

function signBody(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

describe('Meta webhook — message_template_status_update', () => {
  it('updates local template status when event arrives', async () => {
    await createUser({ email: 'admin@x.com', password: 'pw12345', role: 'admin' });
    const [adminRow] = await db.select().from(users).limit(1);
    const inst = await createWhatsappInstance({
      provider: 'meta_cloud', displayName: 'Meta', isDefault: true,
      providerConfig: {
        wabaId: 'WABA_X', phoneNumberId: 'PN_X',
        accessToken: encryptSecret('atok'),
        appSecret: encryptSecret(APP_SECRET),
        webhookVerifyToken: VERIFY_TOKEN, webhookSubscribed: true,
      },
    });
    await createHsmTemplate({
      instanceId: inst.id, createdBy: adminRow.id,
      name: 'boas_vindas_pos_troca', language: 'pt_BR',
      status: 'PENDING', metaTemplateId: '99887766',
    });

    const body = JSON.stringify(templateStatusFixture);
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${inst.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const [updated] = await db.select().from(whatsappHsmTemplates);
    expect(updated.status).toBe('APPROVED');
    expect(updated.metaTemplateId).toBe('99887766');
  });

  it('updates status by (name, language) fallback when metaTemplateId not set yet', async () => {
    await createUser({ email: 'admin2@x.com', password: 'pw12345', role: 'admin' });
    const [adminRow] = await db.select().from(users).limit(1);
    const inst = await createWhatsappInstance({
      provider: 'meta_cloud', displayName: 'Meta', isDefault: true,
      providerConfig: {
        wabaId: 'WABA_X', phoneNumberId: 'PN_X',
        accessToken: encryptSecret('atok'),
        appSecret: encryptSecret(APP_SECRET),
        webhookVerifyToken: VERIFY_TOKEN, webhookSubscribed: true,
      },
    });
    // Template exists locally as PENDING, no metaTemplateId yet (unusual but possible race)
    await createHsmTemplate({
      instanceId: inst.id, createdBy: adminRow.id,
      name: 'boas_vindas_pos_troca', language: 'pt_BR',
      status: 'PENDING', metaTemplateId: null,
    });

    const body = JSON.stringify(templateStatusFixture);
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${inst.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const [updated] = await db.select().from(whatsappHsmTemplates);
    expect(updated.status).toBe('APPROVED');
    expect(updated.metaTemplateId).toBe('99887766');   // backfilled
  });
});
