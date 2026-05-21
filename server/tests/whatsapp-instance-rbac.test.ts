import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createWhatsappInstance } from './helpers';
import { encryptSecret } from '../lib/crypto';

vi.mock('../services/whatsapp/uazapi/instanceClient', () => ({
  initInstance: vi.fn().mockResolvedValue({ instanceId: 'x', rawPayload: {} }),
  getInstanceStatus: vi.fn().mockResolvedValue({
    status: 'disconnected', qrCode: null, phoneNumber: null, profileName: null, rawPayload: {},
  }),
  logoutInstance: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
  setWebhook: vi.fn().mockResolvedValue(undefined),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  process.env.UAZAPI_TOKEN = 'env-token';
  process.env.APP_URL = 'http://localhost:3000';
});

describe('Whatsapp Instance RBAC', () => {
  it('recepção 403 em GET /api/whatsapp-instance', async () => {
    const token = await loginAs('r@x.com', 'recepcao');
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepção 403 em POST /connect', async () => {
    const token = await loginAs('r2@x.com', 'recepcao');
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('recepção 403 em POST /disconnect', async () => {
    const token = await loginAs('r3@x.com', 'recepcao');
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepção 403 em DELETE', async () => {
    const token = await loginAs('r4@x.com', 'recepcao');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('comercial: OK em GET; 403 em connect/disconnect/delete (instância é admin-only)', async () => {
    const token = await loginAs('c@x.com', 'comercial');

    const get = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);

    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: 'inst-c',
        instanceToken: encryptSecret('tok'),
        webhookSecret: encryptSecret('sec'),
        webhookUrl: null,
        webhookSynced: false,
      },
    });

    const connect = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(connect.status).toBe(403);

    const disconnect = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect(disconnect.status).toBe(403);

    const del = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
