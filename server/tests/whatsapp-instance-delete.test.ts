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
import { deleteInstance } from '../services/whatsapp/uazapi/instanceClient';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(deleteInstance).mockReset();
});

describe('DELETE /api/whatsapp-instance', () => {
  it('403 pra comercial (admin only)', async () => {
    const token = await loginAs('c@x.com', 'comercial');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('404 quando DB vazio', async () => {
    const token = await loginAs('a@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('204 admin deleta UazAPI + row', async () => {
    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: 'inst-del',
        instanceToken: encryptSecret('tok'),
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    vi.mocked(deleteInstance).mockResolvedValueOnce(undefined);

    const token = await loginAs('a2@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(whatsappInstance);
    expect(rows).toHaveLength(0);
    expect(vi.mocked(deleteInstance)).toHaveBeenCalled();
  });

  it('204 mesmo se UazAPI delete falhar (best-effort) — apaga local', async () => {
    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: 'inst-fail',
        instanceToken: encryptSecret('tok'),
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    vi.mocked(deleteInstance).mockRejectedValueOnce(new Error('uazapi down'));

    const token = await loginAs('a3@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(whatsappInstance);
    expect(rows).toHaveLength(0);
  });
});
