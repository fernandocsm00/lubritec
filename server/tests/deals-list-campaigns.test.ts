import { describe, it, expect } from 'vitest';
import { listBoard, listHistory } from '../services/dealsService';
import {
  createUser,
  createLead,
  createCampaign,
  createCampaignRecipient,
  createConversation,
  createDeal,
} from './helpers';

async function admin() {
  return createUser({
    email: `a${Math.random().toString(36).slice(2, 8)}@x.com`,
    password: 'pw12345',
    role: 'admin',
  });
}

const userCtx = {
  ownerFilter: 'all' as const,
  currentUserId: '00000000-0000-0000-0000-000000000000',
};

describe('listBoard — agregacao de campaigns (recipients) e campanha de origem', () => {
  it('attaches empty campaigns when deal lead has no sent recipient', async () => {
    const lead = await createLead({ name: 'No camp', phone: '5554911111111' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    expect(r.stages.lead_no_comercial[0].campaigns).toEqual([]);
  });

  it('attaches sent campaigns to deal, desc-ordered', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Multi', phone: '5554922222222' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const ca = await createCampaign({ name: 'Antiga', createdByUserId: u.id });
    const cr = await createCampaign({ name: 'Recente', createdByUserId: u.id });
    await createCampaignRecipient({
      campaignId: ca.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date('2026-01-01'),
    });
    await createCampaignRecipient({
      campaignId: cr.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date('2026-05-01'),
    });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Multi');
    expect(deal).toBeDefined();
    expect(deal!.campaigns.map((c) => c.name)).toEqual(['Recente', 'Antiga']);
  });

  it('expoe originCampaignId/Name a partir da conversa de origem', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Origem X', phone: '5554900111222' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const camp = await createCampaign({ name: 'Reativacao Maio', createdByUserId: u.id });
    await createConversation({
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: camp.id,
    });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Origem X');
    expect(deal!.originCampaignId).toBe(camp.id);
    expect(deal!.originCampaignName).toBe('Reativacao Maio');
  });

  it('originCampaign nulo quando o deal nao veio de campanha', async () => {
    const lead = await createLead({ name: 'Sem campanha', phone: '5554900333444' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Sem campanha');
    expect(deal!.originCampaignId).toBeNull();
    expect(deal!.originCampaignName).toBeNull();
  });
});

describe('listBoard — filtro por campanha de ORIGEM', () => {
  it('filtra o board pela campanha de origem (OR), nao por recipients', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'In A', phone: '5554933333333' });
    const leadB = await createLead({ name: 'In B', phone: '5554944444444' });
    const leadN = await createLead({ name: 'In none', phone: '5554955555555' });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadN.id, stage: 'lead_no_comercial' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createConversation({ leadId: leadA.id, originKind: 'campaign', originCampaignId: campA.id });
    await createConversation({ leadId: leadB.id, originKind: 'campaign', originCampaignId: campB.id });
    // leadN: conversa organica (sem campanha) — nao deve casar o filtro.
    await createConversation({ leadId: leadN.id, originKind: 'organic' });

    const r = await listBoard({ ...userCtx, campaignIds: [campA.id, campB.id] });
    const names = r.stages.lead_no_comercial.map((d) => d.lead.name).sort();
    expect(names).toEqual(['In A', 'In B']);
  });

  it('originCampaigns lista so campanhas que originaram algum card e ignora o proprio filtro', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'LA', phone: '5554900555666' });
    const leadB = await createLead({ name: 'LB', phone: '5554900777888' });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial' });
    const campA = await createCampaign({ name: 'AAA', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'BBB', createdByUserId: u.id });
    await createCampaign({ name: 'CCC sem card', createdByUserId: u.id }); // nao origina ninguem
    await createConversation({ leadId: leadA.id, originKind: 'campaign', originCampaignId: campA.id });
    await createConversation({ leadId: leadB.id, originKind: 'campaign', originCampaignId: campB.id });

    // Mesmo filtrando por A, o dropdown continua oferecendo A e B (nao encolhe);
    // CCC nao aparece porque nao originou nenhum card.
    const r = await listBoard({ ...userCtx, campaignIds: [campA.id] });
    expect(r.originCampaigns.map((c) => c.name).sort()).toEqual(['AAA', 'BBB']);
    // O board em si traz apenas o card originado por A.
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['LA']);
  });
});

describe('listBoard — grupo "Recebeu disparo" (recipient) e filtro por re-disparo', () => {
  it('recipientCampaigns lista campanhas que dispararam para cards mas nao sao a de origem', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Rehit', phone: '5554900999000' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const origem = await createCampaign({ name: 'Lista 1 origem', createdByUserId: u.id });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    // 'origem' abriu a conversa (define a campanha de origem)
    await createConversation({ leadId: lead.id, originKind: 'campaign', originCampaignId: origem.id });
    // Ambas dispararam pro lead (recipients enviados)
    await createCampaignRecipient({ campaignId: origem.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01') });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01') });

    const r = await listBoard(userCtx);
    // 'origem' fica no grupo de origem.
    expect(r.originCampaigns.map((c) => c.name)).toEqual(['Lista 1 origem']);
    // 'Disparo 4' aparece no grupo "Recebeu disparo"; a de origem NAO se duplica aqui.
    expect(r.recipientCampaigns.map((c) => c.name)).toEqual(['Disparo 4']);
  });

  it('filtra o board por campanha que so aparece como recipient (re-disparo)', async () => {
    const u = await admin();
    const leadHit = await createLead({ name: 'Recebeu D4', phone: '5554900111000' });
    const leadOther = await createLead({ name: 'Nao recebeu', phone: '5554900222000' });
    await createDeal({ leadId: leadHit.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadOther.id, stage: 'lead_no_comercial' });
    const origem = await createCampaign({ name: 'Origem', createdByUserId: u.id });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    // leadHit originou de 'origem' e recebeu re-disparo da 'Disparo 4'.
    await createConversation({ leadId: leadHit.id, originKind: 'campaign', originCampaignId: origem.id });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: leadHit.id, status: 'sent', sentAt: new Date() });
    // leadOther nao tem relacao nenhuma com 'Disparo 4'.

    const r = await listBoard({ ...userCtx, campaignIds: [disparo4.id] });
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['Recebeu D4']);
  });
});

describe('listHistory — campaigns e filtro por origem', () => {
  it('attaches campaigns (recipients) e filtra por campanha de origem', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Won', phone: '5554900000001' });
    // closedAt mais antigo que KANBAN_TERMINAL_VISIBLE_DAYS (7 dias) pra aparecer no historico.
    const oldClosed = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await createDeal({ leadId: lead.id, stage: 'ganho', closedAt: oldClosed });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    await createCampaignRecipient({
      campaignId: camp.id,
      leadId: lead.id,
      status: 'sent',
      sentAt: new Date(),
    });
    await createConversation({ leadId: lead.id, originKind: 'campaign', originCampaignId: camp.id });

    const r = await listHistory({ ...userCtx, campaignIds: [camp.id] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['A']);
    expect(r.items[0].originCampaignName).toBe('A');
  });
});
