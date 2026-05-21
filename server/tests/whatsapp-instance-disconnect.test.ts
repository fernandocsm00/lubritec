import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';
import { encryptSecret } from '../lib/crypto';

vi.mock('../services/whatsapp/uazapi/instanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { logoutInstance, getInstanceStatus } from '../services/whatsapp/uazapi/instanceClient';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(logoutInstance).mockReset();
  vi.mocked(getInstanceStatus).mockReset();
});

describe('POST /api/whatsapp-instance/disconnect', () => {
  it('400 sem instance no DB', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 chama UazAPI logout e mantém row', async () => {
    await createWhatsappInstance({
      isDefault: true,
      phoneNumber: '5511999999999',
      profileName: 'Old',
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: 'inst-x',
        instanceToken: encryptSecret('tok'),
        webhookSecret: encryptSecret('sec'),
        webhookUrl: null,
        webhookSynced: false,
      },
    });

    vi.mocked(logoutInstance).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'disconnected',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');

    // Row preservada, mas phone/profile limpos
    const [row] = await db.select().from(whatsappInstance);
    expect(row).toBeDefined();
    const cfg = row.providerConfig as Record<string, unknown>;
    expect(cfg.instanceId).toBe('inst-x');
    expect(row.phoneNumber).toBeNull();
    expect(row.profileName).toBeNull();
  });
});
