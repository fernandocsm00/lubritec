import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance, conversations, leads, messages } from '../db/schema';
import { createUser } from './helpers';
import { _resetKeyCache } from '../lib/crypto';

vi.mock('../services/whatsapp/metaCloud/client', () => ({
  getPhoneNumberInfo: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  getMediaUrl: vi.fn(),
  isOutOfSessionError: vi.fn(),
  MetaGraphError: class extends Error {
    constructor(public status: number, public code: number | null, public body: unknown) {
      super(`${status}`); this.name = 'MetaGraphError';
    }
  },
}));
import { getPhoneNumberInfo, MetaGraphError } from '../services/whatsapp/metaCloud/client';

const app = createApp();

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  process.env.APP_URL = 'http://localhost:3000';
  _resetKeyCache();
  await db.delete(messages); await db.delete(conversations);
  await db.delete(whatsappInstance); await db.delete(leads);
  vi.mocked(getPhoneNumberInfo).mockReset();
});

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const r = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return r.body.accessToken as string;
}

describe('POST /api/whatsapp/instances (meta_cloud path)', () => {
  it('creates a Meta instance when credentials validate', async () => {
    vi.mocked(getPhoneNumberInfo).mockResolvedValueOnce({
      id: 'pn-456',
      display_phone_number: '+55 11 99999-0000',
      verified_name: 'Lubritec',
    });
    const token = await loginAdmin();
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud',
        displayName: 'Oficial',
        metaCloud: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'at', appSecret: 'as' },
      });
    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('meta_cloud');
    expect(res.body.phoneNumber).toBe('+55 11 99999-0000');
    expect(res.body.profileName).toBe('Lubritec');
    const [row] = await db.select().from(whatsappInstance);
    const cfg = row.providerConfig as Record<string, unknown>;
    expect(cfg.wabaId).toBe('w');
    expect((cfg.accessToken as string).startsWith('enc:')).toBe(true);
    expect((cfg.appSecret as string).startsWith('enc:')).toBe(true);
    expect((cfg.webhookVerifyToken as string).length).toBeGreaterThanOrEqual(16);
  });

  it('returns 422 when Meta Graph rejects the credentials', async () => {
    vi.mocked(getPhoneNumberInfo).mockRejectedValueOnce(
      new MetaGraphError(401, 190, { error: { message: 'invalid' } }),
    );
    const token = await loginAdmin();
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud', displayName: 'Bad',
        metaCloud: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'bad', appSecret: 'as' },
      });
    expect(res.status).toBe(422);
    expect(await db.select().from(whatsappInstance)).toHaveLength(0);
  });

  it('returns 422 when metaCloud block is missing', async () => {
    const token = await loginAdmin();
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'meta_cloud', displayName: 'Missing' });
    expect(res.status).toBe(422);
  });

  it('retorna 422 (não 500) quando a validação falha por erro não-Meta (rede/header)', async () => {
    vi.mocked(getPhoneNumberInfo).mockRejectedValueOnce(new Error('Invalid header value'));
    const token = await loginAdmin();
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud', displayName: 'NetFail',
        metaCloud: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'at', appSecret: 'as' },
      });
    expect(res.status).toBe(422);
    expect(await db.select().from(whatsappInstance)).toHaveLength(0);
  });

  it('faz trim nas credenciais coladas (evita header HTTP inválido por espaço/\\n)', async () => {
    vi.mocked(getPhoneNumberInfo).mockResolvedValueOnce({
      id: 'pn', display_phone_number: '+1', verified_name: 'X',
    });
    const token = await loginAdmin();
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud', displayName: 'Trim',
        metaCloud: { wabaId: '  w  ', phoneNumberId: ' p\n', accessToken: '  at\n', appSecret: 'as ' },
      });
    expect(res.status).toBe(201);
    expect(vi.mocked(getPhoneNumberInfo)).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'p', accessToken: 'at' }),
    );
    const [row] = await db.select().from(whatsappInstance);
    const cfg = row.providerConfig as Record<string, unknown>;
    expect(cfg.wabaId).toBe('w');
    expect(cfg.phoneNumberId).toBe('p');
  });
});

describe('GET /api/whatsapp/instances/:id/webhook-info', () => {
  it('returns callback URL + verify token for Meta instance', async () => {
    vi.mocked(getPhoneNumberInfo).mockResolvedValueOnce({
      id: 'pn', display_phone_number: '+1', verified_name: 'X',
    });
    const token = await loginAdmin();
    const createRes = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud', displayName: 'X',
        metaCloud: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'at', appSecret: 'as' },
      });
    const id = createRes.body.id;
    const res = await request(app).get(`/api/whatsapp/instances/${id}/webhook-info`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.callbackUrl).toBe(`http://localhost:3000/api/whatsapp/webhook/meta/${id}`);
    expect(res.body.verifyToken).toBeTruthy();
    expect(res.body.subscribed).toBe(false);
  });

  it('returns 400 for uazapi instance', async () => {
    const { createWhatsappInstance } = await import('./helpers');
    const token = await loginAdmin();
    const row = await createWhatsappInstance({ provider: 'uazapi', displayName: 'U' });
    const res = await request(app).get(`/api/whatsapp/instances/${row.id}/webhook-info`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
