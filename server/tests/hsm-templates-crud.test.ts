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

vi.mock('../services/whatsapp/metaCloud/templates', () => ({
  createTemplate: vi.fn(),
  listTemplatesOnMeta: vi.fn(),
  deleteTemplateOnMeta: vi.fn(),
  sendTemplateMessage: vi.fn(),
}));
import {
  createTemplate as metaCreate,
  listTemplatesOnMeta as metaList,
  deleteTemplateOnMeta as metaDelete,
} from '../services/whatsapp/metaCloud/templates';

vi.mock('../services/whatsapp/metaCloud/client', async () => {
  const actual = await vi.importActual<typeof import('../services/whatsapp/metaCloud/client')>(
    '../services/whatsapp/metaCloud/client'
  );
  return { ...actual, getPhoneNumberInfo: vi.fn() };
});

const app = createApp();

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  process.env.APP_URL = 'http://localhost:3000';
  _resetKeyCache();
  await db.delete(campaigns);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(whatsappHsmTemplates);
  await db.delete(whatsappInstance);
  await db.delete(leads);
  vi.mocked(metaCreate).mockReset();
  vi.mocked(metaList).mockReset();
  vi.mocked(metaDelete).mockReset();
});

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const r = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return r.body.accessToken as string;
}

async function seedMetaInstance() {
  return createWhatsappInstance({
    provider: 'meta_cloud',
    displayName: 'Meta Test',
    isDefault: true,
    providerConfig: {
      wabaId: 'WABA_X',
      phoneNumberId: 'PN_X',
      accessToken: encryptSecret('atok'),
      appSecret: encryptSecret('asec'),
      webhookVerifyToken: 'vt-xxxxxxxxxxxxxxxx',
      webhookSubscribed: true,
    },
  });
}

async function seedUazapiInstance() {
  return createWhatsappInstance({ provider: 'uazapi', displayName: 'Uaz' });
}

describe('POST /api/whatsapp/instances/:id/templates', () => {
  it('creates DRAFT without calling Meta when submitNow=false', async () => {
    const token = await loginAdmin();
    const inst = await seedMetaInstance();
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'boas_vindas',
        language: 'pt_BR',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Olá {{1}}' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.variableCount).toBe(1);
    expect(res.body.metaTemplateId).toBeNull();
    expect(metaCreate).not.toHaveBeenCalled();
  });

  it('submits to Meta when submitNow=true and sets status=PENDING', async () => {
    const token = await loginAdmin();
    const inst = await seedMetaInstance();
    vi.mocked(metaCreate).mockResolvedValueOnce({
      metaTemplateId: 'mtid_999', status: 'PENDING', category: 'MARKETING',
    });
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'pos_troca',
        language: 'pt_BR',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Aproveite 10% off!' }],
        submitNow: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.metaTemplateId).toBe('mtid_999');
    expect(metaCreate).toHaveBeenCalledOnce();
  });

  it('returns 422 when name is not snake_case', async () => {
    const token = await loginAdmin();
    const inst = await seedMetaInstance();
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'BadName',
        language: 'pt_BR',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'x' }],
      });
    expect(res.status).toBe(422);
  });

  it('returns 400 for uazapi instance', async () => {
    const token = await loginAdmin();
    const inst = await seedUazapiInstance();
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'x', language: 'pt_BR', category: 'MARKETING',
        components: [{ type: 'BODY', text: 'y' }],
      });
    expect(res.status).toBe(400);
  });

  it('blocks non-admin', async () => {
    await createUser({ email: 'c@x.com', password: 'pw12345', role: 'comercial' });
    const r = await request(app).post('/api/auth/login').send({ email: 'c@x.com', password: 'pw12345' });
    const inst = await seedMetaInstance();
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .send({
        name: 'x', language: 'pt_BR', category: 'MARKETING',
        components: [{ type: 'BODY', text: 'y' }],
      });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/whatsapp/instances/:id/templates', () => {
  it('lists templates for the instance', async () => {
    const token = await loginAdmin();
    const [adminRow] = await db.select().from(users).limit(1);
    const inst = await seedMetaInstance();
    await createHsmTemplate({ instanceId: inst.id, createdBy: adminRow.id, name: 'tpl_a' });
    await createHsmTemplate({ instanceId: inst.id, createdBy: adminRow.id, name: 'tpl_b' });
    const res = await request(app)
      .get(`/api/whatsapp/instances/${inst.id}/templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });
});

describe('DELETE /api/whatsapp/instances/:id/templates/:tid', () => {
  it('deletes local + calls Meta for templates with metaTemplateId', async () => {
    const token = await loginAdmin();
    const [adminRow] = await db.select().from(users).limit(1);
    const inst = await seedMetaInstance();
    const tpl = await createHsmTemplate({
      instanceId: inst.id, createdBy: adminRow.id,
      name: 'todelete', metaTemplateId: 'mtid_x',
    });
    vi.mocked(metaDelete).mockResolvedValueOnce(undefined);
    const res = await request(app)
      .delete(`/api/whatsapp/instances/${inst.id}/templates/${tpl.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(metaDelete).toHaveBeenCalledOnce();
    const remaining = await db.select().from(whatsappHsmTemplates);
    expect(remaining).toHaveLength(0);
  });

  it('returns 404 when template does not exist', async () => {
    const token = await loginAdmin();
    const inst = await seedMetaInstance();
    const res = await request(app)
      .delete(`/api/whatsapp/instances/${inst.id}/templates/${crypto.randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/whatsapp/instances/:id/sync-templates', () => {
  it('syncs from Meta — creates new and updates existing', async () => {
    const token = await loginAdmin();
    const [adminRow] = await db.select().from(users).limit(1);
    const inst = await seedMetaInstance();
    // existing local one mirroring Meta
    await createHsmTemplate({
      instanceId: inst.id, createdBy: adminRow.id, name: 'existing',
      status: 'PENDING', metaTemplateId: 'mtid_existing',
    });
    vi.mocked(metaList).mockResolvedValueOnce([
      { id: 'mtid_existing', name: 'existing', language: 'pt_BR', category: 'MARKETING',
        status: 'APPROVED', components: [{ type: 'BODY', text: 'x' }] },
      { id: 'mtid_new', name: 'new_one', language: 'pt_BR', category: 'UTILITY',
        status: 'APPROVED', components: [{ type: 'BODY', text: 'y {{1}}' }] },
    ]);
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/sync-templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(2);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(1);
    const all = await db.select().from(whatsappHsmTemplates);
    expect(all).toHaveLength(2);
    const updated = all.find(t => t.metaTemplateId === 'mtid_existing');
    expect(updated?.status).toBe('APPROVED');
  });

  it('returns 400 for uazapi instance', async () => {
    const token = await loginAdmin();
    const inst = await seedUazapiInstance();
    const res = await request(app)
      .post(`/api/whatsapp/instances/${inst.id}/sync-templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
