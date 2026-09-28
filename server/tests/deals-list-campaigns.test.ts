import { describe, it, expect } from 'vitest';
import { listBoard, listHistory } from '../services/dealsService';
import {
  createUser,
  createLead,
  createCampaign,
  createCampaignRecipient,
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

describe('listBoard — campanhas do lead (recipients) e campanha do card', () => {
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
    await createCampaignRecipient({ campaignId: ca.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01') });
    await createCampaignRecipient({ campaignId: cr.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01') });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Multi');
    expect(deal!.campaigns.map((c) => c.name)).toEqual(['Recente', 'Antiga']);
  });

  it('expõe campaignId/Name da campanha DO CARD', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Samuel', phone: '5554900111222' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: camp.id });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Samuel');
    expect(deal!.campaignId).toBe(camp.id);
    expect(deal!.campaignName).toBe('Teste Andrei III');
  });

  it('card sem campanha vem com campaignId/Name nulos', async () => {
    const lead = await createLead({ name: 'Sem campanha', phone: '5554900333444' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Sem campanha');
    expect(deal!.campaignId).toBeNull();
    expect(deal!.campaignName).toBeNull();
  });

  it('dois cards abertos do mesmo lead aparecem os dois, cada um com sua campanha', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Dois cards', phone: '5554900444555' });
    const a = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
    const b = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: a.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: b.id });
    const r = await listBoard(userCtx);
    expect(r.stages.proposta_enviada.map((d) => d.campaignName)).toEqual(['Campanha Teste']);
    expect(r.stages.lead_no_comercial.map((d) => d.campaignName)).toEqual(['Teste Andrei III']);
  });
});

describe('listBoard — filtro por campanha do card', () => {
  it('filtra pela campanha do card', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'In A', phone: '5554933333333' });
    const leadB = await createLead({ name: 'In B', phone: '5554944444444' });
    const leadN = await createLead({ name: 'In none', phone: '5554955555555' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial', campaignId: campA.id });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial', campaignId: campB.id });
    await createDeal({ leadId: leadN.id, stage: 'lead_no_comercial' });

    const r = await listBoard({ ...userCtx, campaignIds: [campA.id, campB.id] });
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name).sort()).toEqual(['In A', 'In B']);
  });

  it('cardCampaigns lista só campanhas com card e ignora o próprio filtro', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'LA', phone: '5554900555666' });
    const leadB = await createLead({ name: 'LB', phone: '5554900777888' });
    const campA = await createCampaign({ name: 'AAA', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'BBB', createdByUserId: u.id });
    await createCampaign({ name: 'CCC sem card', createdByUserId: u.id });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial', campaignId: campA.id });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial', campaignId: campB.id });

    const r = await listBoard({ ...userCtx, campaignIds: [campA.id] });
    expect(r.cardCampaigns.map((c) => c.name).sort()).toEqual(['AAA', 'BBB']);
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['LA']);
  });
});

describe('listBoard — grupo "Recebeu disparo"', () => {
  it('recipientCampaigns lista campanhas que dispararam pro lead mas não são a do card', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Rehit', phone: '5554900999000' });
    const doCard = await createCampaign({ name: 'Lista 1', createdByUserId: u.id });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: doCard.id });
    await createCampaignRecipient({ campaignId: doCard.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01') });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01') });

    const r = await listBoard(userCtx);
    expect(r.cardCampaigns.map((c) => c.name)).toEqual(['Lista 1']);
    expect(r.recipientCampaigns.map((c) => c.name)).toEqual(['Disparo 4']);
  });

  it('filtra o board por campanha que só aparece como disparo', async () => {
    const u = await admin();
    const leadHit = await createLead({ name: 'Recebeu D4', phone: '5554900111000' });
    const leadOther = await createLead({ name: 'Nao recebeu', phone: '5554900222000' });
    await createDeal({ leadId: leadHit.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadOther.id, stage: 'lead_no_comercial' });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: leadHit.id, status: 'sent', sentAt: new Date() });

    const r = await listBoard({ ...userCtx, campaignIds: [disparo4.id] });
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['Recebeu D4']);
  });
});

describe('card fechado por campanha encerrada', () => {
  it('não aparece na coluna Perdido e vai direto pro Histórico', async () => {
    const encerrado = await createLead({ name: 'Encerrado', phone: '5554900000101' });
    const manual = await createLead({ name: 'Perdido manual', phone: '5554900000102' });
    await createDeal({ leadId: encerrado.id, stage: 'perdido', lossReason: 'campanha_encerrada', closedAt: new Date() });
    await createDeal({ leadId: manual.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date() });

    const board = await listBoard(userCtx);
    expect(board.stages.perdido.map((d) => d.lead.name)).toEqual(['Perdido manual']);

    const hist = await listHistory(userCtx);
    expect(hist.items.map((d) => d.lead.name)).toEqual(['Encerrado']);
  });
});

describe('listHistory — campanha do card', () => {
  it('traz a campanha do card e filtra por ela', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Won', phone: '5554900000001' });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    // closedAt mais antigo que KANBAN_TERMINAL_VISIBLE_DAYS (7 dias) pra aparecer no historico.
    const oldClosed = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await createDeal({ leadId: lead.id, stage: 'ganho', closedAt: oldClosed, campaignId: camp.id });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'sent', sentAt: new Date() });

    const r = await listHistory({ ...userCtx, campaignIds: [camp.id] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['A']);
    expect(r.items[0].campaignName).toBe('A');
  });
});
