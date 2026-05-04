import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  connectInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import {
  initInstance,
  connectInstance,
  getInstanceStatus,
  setWebhook,
} from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(initInstance).mockReset();
  vi.mocked(connectInstance).mockReset();
  vi.mocked(getInstanceStatus).mockReset();
  vi.mocked(setWebhook).mockReset();
  // connectInstance default: succeed silently (tests can override with mockResolvedValueOnce)
  vi.mocked(connectInstance).mockResolvedValue({
    status: 'pairing',
    qrCode: 'data:image/png;base64,QR',
    phoneNumber: null,
    profileName: null,
    rawPayload: {},
  });
  process.env.APP_URL = 'http://localhost:3000';
  process.env.UAZAPI_TOKEN = 'env-token-fallback';
});

describe('POST /api/whatsapp-instance/connect', () => {
  it('cria row + chama UazAPI init + setWebhook + retorna QR', async () => {
    vi.mocked(initInstance).mockResolvedValueOnce({
      instanceId: 'new-inst-1',
      token: 'instance-token',
      status: 'disconnected',
      rawPayload: {},
    });
    vi.mocked(setWebhook).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'data:image/png;base64,QR',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pairing');
    expect(res.body.qrCode).toBe('data:image/png;base64,QR');
    expect(res.body.webhookSynced).toBe(true);

    expect(vi.mocked(initInstance)).toHaveBeenCalled();
    expect(vi.mocked(setWebhook)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        url: 'http://localhost:3000/api/whatsapp/webhook',
        events: ['message.received'],
      }),
    );
  });

  it('idempotente: se já tem instanceId, reusa em vez de re-criar', async () => {
    await createWhatsappInstance({
      instanceId: 'existing-inst',
      instanceToken: 'tok',
      webhookSecret: 'sec',
    });

    vi.mocked(setWebhook).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'QR',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(vi.mocked(initInstance)).not.toHaveBeenCalled();
    expect(vi.mocked(setWebhook)).toHaveBeenCalled();
  });

  it('502 quando UazAPI init falha', async () => {
    const { UazapiInstanceError } = await import('../services/uazapiInstanceClient');
    vi.mocked(initInstance).mockRejectedValueOnce(new UazapiInstanceError(500, 'down'));

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(502);
  });

  it('webhookSynced=false se setWebhook falhar mas instância criada', async () => {
    vi.mocked(initInstance).mockResolvedValueOnce({
      instanceId: 'new-inst-2',
      token: 'instance-token-2',
      status: 'disconnected',
      rawPayload: {},
    });
    const { UazapiInstanceError } = await import('../services/uazapiInstanceClient');
    vi.mocked(setWebhook).mockRejectedValueOnce(new UazapiInstanceError(500, 'down'));

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(502);

    const [row] = await db.select().from(whatsappInstance);
    expect(row.instanceId).toBe('new-inst-2');
    expect(row.webhookSynced).toBe(false);
  });
});
