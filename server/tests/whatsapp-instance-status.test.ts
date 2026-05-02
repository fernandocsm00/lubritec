import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { getInstanceStatus } from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAs(email = 'a@x.com', role: 'admin' | 'comercial' | 'recepcao' = 'admin') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(getInstanceStatus).mockReset();
  delete process.env.UAZAPI_BASE_URL;
  delete process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_INSTANCE_ID;
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('GET /api/whatsapp-instance', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/whatsapp-instance');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const token = await loginAs('r@x.com', 'recepcao');
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 retorna configured: false quando DB vazio e sem env', async () => {
    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.status).toBe('disconnected');
  });

  it('seed automático quando env vars completas e DB vazio', async () => {
    process.env.UAZAPI_BASE_URL = 'https://api.uazapi.com';
    process.env.UAZAPI_TOKEN = 'env-token';
    process.env.UAZAPI_INSTANCE_ID = 'env-instance';
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    process.env.APP_URL = 'http://localhost:3000';

    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'connected',
      qrCode: null,
      phoneNumber: '5511987654321',
      profileName: 'Test',
      rawPayload: {},
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.status).toBe('connected');
    expect(res.body.phoneNumber).toBe('5511987654321');
    expect(res.body.webhookSynced).toBe(true);
  });

  it('200 com instance_id consulta UazAPI ao vivo', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: 'inst-1',
      instanceToken: 'tok-1',
      webhookSecret: 'sec-1',
      webhookSynced: true,
    });

    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'data:image/png;base64,XXX',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pairing');
    expect(res.body.qrCode).toBe('data:image/png;base64,XXX');
  });

  it('200 retorna status=error quando UazAPI falha', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: 'inst-2',
      instanceToken: 'tok-2',
    });

    vi.mocked(getInstanceStatus).mockRejectedValueOnce(new Error('connection lost'));

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
  });

  it('200 sem instance_id (row criada mas não conectada) retorna configured: false', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: null,
      instanceToken: null,
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});
