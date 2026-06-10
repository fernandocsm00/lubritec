import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { campaignRecipients, campaigns } from '../db/schema';
import {
  createUser,
  createLead,
  createConversation,
  createMessage,
  createCampaign,
} from './helpers';
import { filterEligibleLeads, COOLDOWN_REASON } from '../services/campaignsCooldown';

describe('filterEligibleLeads', () => {
  it('lead com outbound há 5h é bloqueado por recent_outbound', async () => {
    const u = await createUser({ role: 'comercial' });
    const lead = await createLead({ phone: '5511900001001' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([]);
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lead com outbound há 25h é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u2@x.com' });
    const lead = await createLead({ phone: '5511900001002' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
    expect(r.blocked).toEqual([]);
  });

  it('lead pendente em campanha running é bloqueado', async () => {
    const u = await createUser({ role: 'comercial', email: 'u3@x.com' });
    const lead = await createLead({ phone: '5511900001003' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'pending_other_campaign' }]);
  });

  it('lead pendente em campanha draft é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u4@x.com' });
    const lead = await createLead({ phone: '5511900001004' });
    const camp = await createCampaign({ status: 'draft', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('excludeCampaignId ignora pendência da própria campanha', async () => {
    const u = await createUser({ role: 'comercial', email: 'u5@x.com' });
    const lead = await createLead({ phone: '5511900001005' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], { excludeCampaignId: camp.id });
    expect(r.eligible).toEqual([lead.id]);
  });

  it('precedência: recent_outbound > pending_other_campaign', async () => {
    const u = await createUser({ role: 'comercial', email: 'u6@x.com' });
    const lead = await createLead({ phone: '5511900001006' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lista vazia retorna eligible=[] blocked=[]', async () => {
    const r = await filterEligibleLeads([], {});
    expect(r).toEqual({ eligible: [], blocked: [] });
  });

  it('mensagem inbound não bloqueia', async () => {
    const lead = await createLead({ phone: '5511900001008' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'in',
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('exporta COOLDOWN_REASON = "cooldown_24h"', () => {
    expect(COOLDOWN_REASON).toBe('cooldown_24h');
  });
});

import { eq } from 'drizzle-orm';
import { createCampaign as createCampaignService } from '../services/campaignsService';
import { createWhatsappInstance } from './helpers';

describe('createCampaign + cooldown', () => {
  it('insere apenas elegíveis; bloqueados por cooldown ficam de fora da campanha', async () => {
    const u = await createUser({ role: 'comercial', email: 'cc1@x.com' });
    const ok = await createLead({ phone: '5511900060001', status: 'frio' });
    const blocked = await createLead({ phone: '5511900060002', status: 'frio' });

    const conv = await createConversation({ leadId: blocked.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const inst = await createWhatsappInstance({ isDefault: false });
    const c = await createCampaignService({
      name: 'cooldown-test',
      messageBody: 'oi {{nome}}',
      audienceFilter: { status: ['frio'] },
      createdByUserId: u.id,
      instanceId: inst.id,
    });

    // Apenas o lead elegível entra como destinatário; o bloqueado é silenciosamente
    // excluído pra não aparecer como IGNORADO na lista da campanha (decisão 2026-05-28).
    const recs = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, c.id));
    expect(recs).toHaveLength(1);
    expect(recs[0].leadId).toBe(ok.id);
    expect(recs[0].status).toBe('pending');

    const [campRow] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(campRow.audienceTotal).toBe(1);
    expect(campRow.skippedCount).toBe(0);
  });
});

import { listCampaigns, getCampaignById } from '../services/campaignsService';

describe('PublicCampaign.skippedByCooldown', () => {
  it('createCampaign retorna excludedByCooldownCount no campo skippedByCooldown', async () => {
    // Bloqueados não são mais inseridos como recipients (vide decisão 2026-05-28),
    // mas o retorno do createCampaign ainda informa quantos foram excluídos do
    // filtro original pra que o frontend possa avisar o vendedor.
    const u = await createUser({ role: 'comercial', email: 'pc1@x.com' });
    await createLead({ phone: '5511900110001', status: 'frio' });
    const blocked = await createLead({ phone: '5511900110002', status: 'frio' });
    const conv = await createConversation({ leadId: blocked.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const inst = await createWhatsappInstance({ isDefault: false });
    const c = await createCampaignService({
      name: 'pc-cool',
      messageBody: 'oi',
      audienceFilter: { status: ['frio'] },
      createdByUserId: u.id,
      instanceId: inst.id,
    });

    // skippedByCooldown no momento da criação = quantos o filtro pegou mas foram
    // descartados por cooldown (informativo, não materializado em recipients).
    expect(c.skippedByCooldown).toBe(1);
    // skippedCount agora reflete só os pulos materializados via dispatcher (0 aqui).
    expect(c.skippedCount).toBe(0);

    // Após a criação, listagens e getById derivam skippedByCooldown da tabela
    // campaign_recipients (rows com failure_reason='cooldown_24h'). Como não
    // inserimos mais essas rows na criação, esses retornos serão 0 — só vão
    // crescer se o safety-net do dispatcher pular alguém.
    const fetched = await getCampaignById(c.id);
    expect(fetched.skippedByCooldown).toBe(0);

    const list = await listCampaigns({});
    const found = list.items.find((x) => x.id === c.id);
    expect(found?.skippedByCooldown).toBe(0);
  });
});

import { tick } from '../services/campaignsDispatcher';
import { vi } from 'vitest';
import { resolveProvider } from '../services/whatsapp/providerRegistry';
import type { WhatsAppProvider } from '../services/whatsapp/provider';

vi.mock('../services/whatsapp/providerRegistry', () => ({
  resolveProvider: vi.fn(),
  resolveDefaultProvider: vi.fn(),
  invalidateProvider: vi.fn(),
  _clearCache: vi.fn(),
}));

const cooldownMockProvider: WhatsAppProvider = {
  kind: 'uazapi',
  instanceId: 'mock-instance',
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

describe('dispatcher + cooldown safety net', () => {
  it('lead que ficou em cooldown entre criação e dispatch é skipped', async () => {
    vi.mocked(resolveProvider).mockResolvedValue(cooldownMockProvider);
    vi.mocked(cooldownMockProvider.sendText).mockReset();

    const u = await createUser({ role: 'comercial', email: 'ds1@x.com' });
    const lead = await createLead({ phone: '5511900080001', status: 'frio' });

    // Criar campanha running com recipient pending — simula campanha já materializada.
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });

    // Cooldown ativa AGORA: alguém mandou outbound há 1h.
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await tick();

    const [r] = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, camp.id));
    expect(r.status).toBe('skipped');
    expect(r.failureReason).toBe(COOLDOWN_REASON);
    // sendText should never have been called (cooldown skips before any send)
    expect(vi.mocked(cooldownMockProvider.sendText)).not.toHaveBeenCalled();

    const [campAfter] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(campAfter.skippedCount).toBe(1);
    expect(campAfter.sentCount).toBe(0);
  });
});
