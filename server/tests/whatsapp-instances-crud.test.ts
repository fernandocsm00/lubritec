import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance, conversations, leads, messages } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/whatsapp/uazapi/instanceClient', () => ({
  initInstance: vi.fn(),
  connectInstance: vi.fn().mockResolvedValue({
    status: 'pairing', qrCode: 'data:image/png;base64,QR',
    phoneNumber: null, profileName: null, rawPayload: {},
  }),
  getInstanceStatus: vi.fn().mockResolvedValue({
    status: 'disconnected', qrCode: null, phoneNumber: null, profileName: null,
  }),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  probeWebhookConfig: vi.fn(),
  probeRecentMessages: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(body); }
  },
}));

const app = createApp();

beforeEach(async () => {
  process.env.APP_URL = 'http://localhost:3000';
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(whatsappInstance);
  await db.delete(leads);
});

async function loginAs(role: 'admin' | 'comercial') {
  await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login')
    .send({ email: `${role}@x.com`, password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('GET /api/whatsapp/instances', () => {
  it('lists all non-archived instances', async () => {
    const token = await loginAs('admin');
    await createWhatsappInstance({ displayName: 'A', isDefault: true });
    await createWhatsappInstance({ displayName: 'B' });
    await createWhatsappInstance({ displayName: 'C', isArchived: true });
    const res = await request(app).get('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: any) => i.displayName).sort()).toEqual(['A', 'B']);
  });

  it('blocks non-admin', async () => {
    const token = await loginAs('comercial');
    const res = await request(app).get('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/whatsapp/instances', () => {
  it('creates a UazAPI instance with display name', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'uazapi',
        displayName: 'Atendimento',
        uazapi: { baseUrl: 'https://api.uazapi.com' },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.provider).toBe('uazapi');
    expect(res.body.displayName).toBe('Atendimento');
    const [row] = await db.select().from(whatsappInstance);
    expect((row.providerConfig as any).baseUrl).toBe('https://api.uazapi.com');
  });

  it('marks first created instance as default automatically', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'uazapi', displayName: 'A' });
    expect(res.body.isDefault).toBe(true);
  });

  it('rejects 501 for meta_cloud (not implemented in Plan A)', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud',
        displayName: 'Oficial',
        metaCloud: { wabaId: 'x', phoneNumberId: 'y', accessToken: 'z', appSecret: 'w' },
      });
    expect(res.status).toBe(501);
  });

  it('blocks non-admin', async () => {
    const token = await loginAs('comercial');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'uazapi', displayName: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/whatsapp/instances/:id', () => {
  it('updates display_name', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'Old' });
    const res = await request(app).patch(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('New');
  });

  it('setting isDefault=true unsets the previous default', async () => {
    const token = await loginAs('admin');
    await createWhatsappInstance({ displayName: 'A', isDefault: true });
    const b = await createWhatsappInstance({ displayName: 'B' });
    const res = await request(app).patch(`/api/whatsapp/instances/${b.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isDefault: true });
    expect(res.status).toBe(200);
    const rows = await db.select().from(whatsappInstance);
    const defaults = rows.filter(r => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(b.id);
  });
});

describe('DELETE /api/whatsapp/instances/:id', () => {
  it('deletes an instance with no conversations', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'X' });
    const res = await request(app).delete(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(whatsappInstance)).toHaveLength(0);
  });

  it('rejects 409 when conversations reference the instance', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'X' });
    const [lead] = await db.insert(leads).values({ name: 'L', phone: '5511999' }).returning();
    await db.insert(conversations).values({
      phone: '5511999', leadId: lead.id, instanceId: row.id,
    });
    const res = await request(app).delete(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error || res.body.message).toMatch(/conversa|conversation/i);
  });
});
