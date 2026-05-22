import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { eq } from 'drizzle-orm';
import {
  whatsappHsmTemplates,
  conversations,
  messages,
  leads,
  campaigns,
  campaignRecipients,
  whatsappInstance,
} from '../db/schema';
import {
  createUser,
  createWhatsappInstance,
  createHsmTemplate,
  createLead,
  createCampaign,
  createCampaignRecipient,
} from './helpers';
import type { WhatsAppProvider } from '../services/whatsapp/provider';

// Mock the provider registry — tests should not make real API calls
vi.mock('../services/whatsapp/providerRegistry', () => ({
  resolveProvider: vi.fn(),
  resolveDefaultProvider: vi.fn(),
  invalidateProvider: vi.fn(),
  _clearCache: vi.fn(),
}));
import { resolveProvider } from '../services/whatsapp/providerRegistry';

// Mock Meta template API calls
vi.mock('../services/whatsapp/metaCloud/templates', () => ({
  createTemplate: vi.fn(),
  listTemplatesOnMeta: vi.fn(),
  deleteTemplateOnMeta: vi.fn(),
  sendTemplateMessage: vi.fn(),
}));

const mockProvider: WhatsAppProvider = {
  kind: 'meta_cloud',
  instanceId: 'mock-meta-instance',
  getStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  sendTemplate: vi.fn(),
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  capabilities: vi.fn(),
};

const app = createApp();

beforeEach(async () => {
  // Clean up in dependency order
  await db.delete(campaignRecipients);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(campaigns);
  await db.delete(whatsappHsmTemplates);
  await db.delete(whatsappInstance);
  await db.delete(leads);

  vi.mocked(resolveProvider).mockResolvedValue(mockProvider);
  vi.mocked(mockProvider.sendTemplate).mockReset();
  vi.mocked(mockProvider.sendText).mockReset();
});

async function loginAdmin(email = 'admin-mi@test.com') {
  await createUser({ email, password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

// ── CREATE validation tests ────────────────────────────────────────────────

describe('POST /api/campaigns — validation', () => {
  it('400 when instanceId missing (Zod required field)', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'No instance',
        messageBody: 'Hello',
        audienceFilter: {},
      });
    // instanceId is a required field — Zod validation returns 400
    expect(res.status).toBe(400);
  });

  it('422 when both templateId AND hsmTemplateId set (XOR violation)', async () => {
    const u = await createUser({ email: 'creator-xor@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    // Use a real approved HSM template so the XOR check is reached
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello' }],
    });
    const token = await loginAdmin('admin-mi2@test.com');
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'XOR violation',
        instanceId: inst.id,
        templateId: tpl.id,      // valid UUID from DB
        hsmTemplateId: tpl.id,   // also valid UUID from DB — triggers XOR check
        messageBody: 'Hello',
        audienceFilter: {},
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/templateId.*hsmTemplateId|both/i);
  });

  it('422 when hsmTemplateId points to PENDING (not APPROVED) template', async () => {
    const u = await createUser({ email: 'creator-mi@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      status: 'PENDING',
      components: [{ type: 'BODY', text: 'Hello {{1}}' }],
    });
    const token = await loginAdmin('admin-mi4@test.com');
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Pending template',
        instanceId: inst.id,
        hsmTemplateId: tpl.id,
        hsmVariables: [{ index: 1, source: 'static', value: 'world' }],
        audienceFilter: {},
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/APPROVED|PENDING/i);
  });

  it('422 when hsmTemplateId belongs to different instance', async () => {
    const u = await createUser({ email: 'creator-mi2@test.com', role: 'admin' });
    const instA = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const instB = await createWhatsappInstance({ provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: instA.id,
      createdBy: u.id,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello' }],
    });
    const token = await loginAdmin('admin-mi5@test.com');
    // Campaign uses instB but template belongs to instA
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Wrong instance',
        instanceId: instB.id,
        hsmTemplateId: tpl.id,
        audienceFilter: {},
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/instance/i);
  });

  it('422 when hsmVariables missing required {{N}} variable', async () => {
    const u = await createUser({ email: 'creator-mi3@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      status: 'APPROVED',
      // Template has {{1}} and {{2}} in BODY
      components: [{ type: 'BODY', text: 'Dear {{1}}, your order {{2}} is ready.' }],
    });
    const token = await loginAdmin('admin-mi6@test.com');
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Missing var',
        instanceId: inst.id,
        hsmTemplateId: tpl.id,
        // Only provides index 1, missing index 2
        hsmVariables: [{ index: 1, source: 'static', value: 'Customer' }],
        audienceFilter: {},
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/missing index 2/i);
  });

  it('201 success: HSM campaign created with APPROVED template', async () => {
    const u = await createUser({ email: 'creator-mi4@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello {{1}}!' }],
    });
    const token = await loginAdmin('admin-mi7@test.com');
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'HSM Campaign',
        instanceId: inst.id,
        hsmTemplateId: tpl.id,
        hsmVariables: [{ index: 1, source: 'static', value: 'World' }],
        audienceFilter: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('draft');
  });
});

// ── Dispatch: HSM recipient sends template via provider ─────────────────────

import { processCampaign } from '../services/campaignsDispatcher';

describe('processCampaign — HSM dispatch', () => {
  it('calls provider.sendTemplate with resolved variables for HSM campaign', async () => {
    vi.mocked(mockProvider.sendTemplate).mockResolvedValue({
      providerMsgId: 'meta-msg-1',
      rawPayload: { id: 'meta-msg-1' },
    });

    const u = await createUser({ email: 'creator-d@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      name: 'promo_tpl',
      language: 'pt_BR',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá {{1}}, confira nossa promoção!' }],
    });
    const lead = await createLead({ name: 'Maria', phone: '5511999991234' });
    const camp = await createCampaign({
      status: 'running',
      ratePerMinute: 600,
      createdByUserId: u.id,
      instanceId: inst.id,
      hsmTemplateId: tpl.id,
      hsmVariables: [{ index: 1, source: 'lead_field', value: 'name' }],
    });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, phone: lead.phone! });

    await processCampaign({ ...camp, status: 'running' });

    // Recipient should be marked sent
    const [r] = await db.select().from(campaignRecipients).where(
      eq(campaignRecipients.campaignId, camp.id),
    );
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();

    // provider.sendTemplate should have been called with resolved variable
    expect(vi.mocked(mockProvider.sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: lead.phone,
        templateName: 'promo_tpl',
        language: 'pt_BR',
        variables: expect.arrayContaining([
          { index: 1, value: 'Maria' },
        ]),
      }),
    );
  });

  it('marks recipient failed when HSM template is not APPROVED at dispatch time', async () => {
    const u = await createUser({ email: 'creator-d2@test.com', role: 'admin' });
    const inst = await createWhatsappInstance({ isDefault: true, provider: 'meta_cloud' });
    const tpl = await createHsmTemplate({
      instanceId: inst.id,
      createdBy: u.id,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello {{1}}' }],
    });
    const lead = await createLead({ name: 'Test', phone: '5511999995678' });
    const camp = await createCampaign({
      status: 'running',
      ratePerMinute: 600,
      createdByUserId: u.id,
      instanceId: inst.id,
      hsmTemplateId: tpl.id,
      hsmVariables: [{ index: 1, source: 'static', value: 'Hello' }],
    });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, phone: lead.phone! });

    // Simulate template being rejected between creation and dispatch
    await db.update(whatsappHsmTemplates)
      .set({ status: 'REJECTED' })
      .where(eq(whatsappHsmTemplates.id, tpl.id));

    await processCampaign({ ...camp, status: 'running' });

    const [r] = await db.select().from(campaignRecipients).where(
      eq(campaignRecipients.campaignId, camp.id),
    );
    expect(r.status).toBe('failed');
    expect(r.failureReason).toMatch(/REJECTED/i);
    expect(vi.mocked(mockProvider.sendTemplate)).not.toHaveBeenCalled();
  });
});
