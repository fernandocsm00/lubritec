import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/client';
import { campaigns, campaignRecipients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createCampaign, createCampaignRecipient, createWhatsappInstance } from './helpers';
import { processCampaign, tick, interpolatePlaceholders } from '../services/campaignsDispatcher';
import {
  dispatchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
} from '../services/campaignsService';

vi.mock('../services/whatsapp/uazapi/client', () => ({
  uazapiClient: { sendMessage: vi.fn() },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { uazapiClient } from '../services/whatsapp/uazapi/client';

beforeEach(async () => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
  await createWhatsappInstance({ isDefault: true, displayName: 'Test default' });
});

describe('interpolatePlaceholders', () => {
  it('substitui {{nome}} e {{cnpj}}', async () => {
    const lead = await createLead({
      name: 'João', phone: '5511987654321', cnpj: '11222333000181',
    });
    const out = interpolatePlaceholders('Olá {{nome}} (CNPJ {{cnpj}})', lead);
    expect(out).toContain('João');
    expect(out).toContain('11222333000181');
  });
});

describe('dispatch state transitions', () => {
  it('dispatchCampaign muda draft → running quando sem scheduledAt', async () => {
    const u = await createUser({ email: 'a@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'draft', createdByUserId: u.id });
    const updated = await dispatchCampaign(c.id);
    expect(updated.status).toBe('running');
    expect(updated.startedAt).not.toBeNull();
  });

  it('dispatchCampaign muda draft → scheduled com scheduledAt futuro', async () => {
    const u = await createUser({ email: 'a2@x.com', role: 'admin' });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const c = await createCampaign({
      status: 'draft', scheduledAt: future, createdByUserId: u.id,
    });
    const updated = await dispatchCampaign(c.id);
    expect(updated.status).toBe('scheduled');
  });

  it('pause muda running → paused', async () => {
    const u = await createUser({ email: 'a3@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'running', createdByUserId: u.id });
    const updated = await pauseCampaign(c.id);
    expect(updated.status).toBe('paused');
  });

  it('resume muda paused → running', async () => {
    const u = await createUser({ email: 'a4@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'paused', createdByUserId: u.id });
    const updated = await resumeCampaign(c.id);
    expect(updated.status).toBe('running');
  });

  it('cancel marca pending recipients como skipped', async () => {
    const u = await createUser({ email: 'a5@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000100001' });
    const c = await createCampaign({ status: 'running', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    const updated = await cancelCampaign(c.id);
    expect(updated.status).toBe('cancelled');

    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('skipped');
  });
});

describe('processCampaign', () => {
  it('processa pending recipients e muda pra completed quando vazia', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValue({
      messageId: 'm-1', rawPayload: {},
    });
    const u = await createUser({ email: 'a6@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000110001' });
    const c = await createCampaign({
      status: 'running',
      ratePerMinute: 600,  // 100ms entre msgs pra teste rodar rápido
      messageBody: 'Oi {{nome}}',
      createdByUserId: u.id,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    await processCampaign({ ...c, status: 'running' });
    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();
    expect(vi.mocked(uazapiClient.sendMessage)).toHaveBeenCalled();

    await processCampaign({ ...c, status: 'running' });
    const [refreshed] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(refreshed.status).toBe('completed');
    expect(refreshed.completedAt).not.toBeNull();
  });

  it('marca recipient failed quando UazAPI rejeita', async () => {
    vi.mocked(uazapiClient.sendMessage).mockRejectedValueOnce(new Error('uazapi 500'));
    const u = await createUser({ email: 'a7@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000111001' });
    const c = await createCampaign({
      status: 'running',
      ratePerMinute: 600,
      createdByUserId: u.id,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    await processCampaign({ ...c, status: 'running' });
    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('uazapi 500');
  });
});

describe('tick (scheduler)', () => {
  it('promove scheduled cujo scheduledAt já passou pra running', async () => {
    const u = await createUser({ email: 'a8@x.com', role: 'admin' });
    const past = new Date(Date.now() - 60 * 1000);
    const c = await createCampaign({
      status: 'scheduled',
      scheduledAt: past,
      createdByUserId: u.id,
    });

    await tick();
    const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(updated.status).toMatch(/running|completed/);
    expect(updated.startedAt).not.toBeNull();
  });
});
