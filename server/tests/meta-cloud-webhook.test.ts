import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import {
  whatsappInstance, conversations, messages, leads,
} from '../db/schema';
import { createWhatsappInstance } from './helpers';
import { eq } from 'drizzle-orm';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';
import textFixture from './fixtures/meta-webhook-text.json';
import imageFixture from './fixtures/meta-webhook-image.json';

vi.mock('../services/whatsapp/metaCloud/client', () => ({
  getPhoneNumberInfo: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  getMediaUrl: vi.fn().mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp_business/.../media',
    mimeType: 'image/jpeg',
  }),
  downloadMedia: vi.fn().mockResolvedValue({
    buffer: Buffer.from('fake-jpeg-bytes'),
    mimeType: 'image/jpeg',
  }),
  isOutOfSessionError: vi.fn().mockReturnValue(false),
  MetaGraphError: class extends Error {
    constructor(public status: number, public code: number | null, public body: unknown) {
      super(`${status}`); this.name = 'MetaGraphError';
    }
  },
}));

// A IA roda em fire-and-forget dentro do webhook — mockamos pra observar a
// CHAMADA sem depender do Gemini. recordAiCall e o resto do modulo seguem reais.
const processInboundWithAiMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'ai_disabled' as const }),
);
vi.mock('../services/aiAtendimento', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiAtendimento')>()),
  processInboundWithAi: processInboundWithAiMock,
}));

const app = createApp();

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token-very-long-string';

beforeEach(async () => {
  processInboundWithAiMock.mockClear();
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

  it('imagem inbound: baixa a midia e persiste local (nao guarda a URL lookaside da Meta)', async () => {
    const row = await seedMetaInstance();
    const body = JSON.stringify(imageFixture);
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${row.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));

    const [msg] = await db.select().from(messages);
    expect(msg.kind).toBe('image');
    expect(msg.body).toBe('Olha o motor'); // caption preservada
    // A correcao: media_url tem que ser local (servida pelo nosso dominio),
    // NUNCA a URL lookaside.fbsbx.com (exige Bearer token, quebra no <img>).
    expect(msg.mediaUrl).toMatch(/^\/uploads\/inbound\//);
    expect(msg.mediaUrl).not.toContain('lookaside');
    expect(msg.mediaMime).toBe('image/jpeg');
  });
});

describe('gatilho da IA no inbound Meta Cloud', () => {
  async function postFixture(instanceId: string, fixture: unknown) {
    const body = JSON.stringify(fixture);
    return request(app)
      .post(`/api/whatsapp/webhook/meta/${instanceId}`)
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
  }

  it('dispara processInboundWithAi pra mensagem de texto', async () => {
    // Regressao: o webhook da Meta so ingeria a mensagem e nunca acionava a IA
    // (so o webhook da UazAPI acionava). Como a linha Meta eh a padrao e a que
    // faz os disparos, na pratica a IA nunca respondia quem respondia campanha.
    const row = await seedMetaInstance();
    const res = await postFixture(row.id, textFixture);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));

    expect(processInboundWithAiMock).toHaveBeenCalledTimes(1);
    const [conv] = await db.select().from(conversations);
    const [lead] = await db.select().from(leads);
    expect(processInboundWithAiMock).toHaveBeenCalledWith({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5511988887777',
      inboundText: 'Olá Lubritec',
    });
  });

  it('não dispara pra mídia (IA só processa texto)', async () => {
    const row = await seedMetaInstance();
    const res = await postFixture(row.id, imageFixture);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));
    expect(processInboundWithAiMock).not.toHaveBeenCalled();
  });

  it('não dispara de novo em webhook duplicado (mesmo wamid)', async () => {
    const row = await seedMetaInstance();
    await postFixture(row.id, textFixture);
    await new Promise((r) => setTimeout(r, 250));
    await postFixture(row.id, textFixture);
    await new Promise((r) => setTimeout(r, 250));
    expect(processInboundWithAiMock).toHaveBeenCalledTimes(1);
  });
});

describe('roteamento multi-linha por phone_number_id (1 App / 1 callback URL)', () => {
  it('roteia a mensagem para a instância dona do phone_number_id, não a da URL', async () => {
    // Instância dona do App/callback URL (assina o HMAC) — com OUTRO número.
    const urlInst = await createWhatsappInstance({
      provider: 'meta_cloud', displayName: 'App Owner', isDefault: false,
      providerConfig: {
        wabaId: 'WABA_OWNER', phoneNumberId: 'PHONE_OWNER_999',
        accessToken: encryptSecret('token-owner'), appSecret: encryptSecret(APP_SECRET),
        webhookVerifyToken: VERIFY_TOKEN, webhookSubscribed: true,
      },
    });
    // Instância que de fato recebeu — bate com metadata.phone_number_id da fixture.
    const recipient = await createWhatsappInstance({
      provider: 'meta_cloud', displayName: 'Recipient', isDefault: true,
      providerConfig: {
        wabaId: 'WABA_ID_123', phoneNumberId: 'PHONE_NUMBER_ID_456',
        accessToken: encryptSecret('token-recipient'), appSecret: encryptSecret(APP_SECRET),
        webhookVerifyToken: VERIFY_TOKEN, webhookSubscribed: false,
      },
    });
    const body = JSON.stringify(textFixture);
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${urlInst.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    expect(convs[0].instanceId).toBe(recipient.id);

    // Flag webhookSubscribed é promovido na instância que recebeu (mantém UI honesta).
    const [rec] = await db.select().from(whatsappInstance).where(eq(whatsappInstance.id, recipient.id));
    expect((rec.providerConfig as { webhookSubscribed?: boolean }).webhookSubscribed).toBe(true);
  });

  it('cai na instância da URL quando nenhuma instância bate com o phone_number_id', async () => {
    const urlInst = await createWhatsappInstance({
      provider: 'meta_cloud', displayName: 'Only', isDefault: true,
      providerConfig: {
        wabaId: 'WABA_URL', phoneNumberId: 'PHONE_URL_ONLY',
        accessToken: encryptSecret('t'), appSecret: encryptSecret(APP_SECRET),
        webhookVerifyToken: VERIFY_TOKEN, webhookSubscribed: false,
      },
    });
    const body = JSON.stringify(textFixture); // phone_number_id 456 não bate com PHONE_URL_ONLY
    const sig = signBody(body, APP_SECRET);
    const res = await request(app)
      .post(`/api/whatsapp/webhook/meta/${urlInst.id}`)
      .set('X-Hub-Signature-256', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    expect(convs[0].instanceId).toBe(urlInst.id);
  });
});
