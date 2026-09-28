import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { getDealByLeadId } from '../services/dealsService';
import { getCaseSheet } from '../services/caseSheetService';
import { createUser, createLead, createConversation, createDeal, createCampaign } from './helpers';

const app = createApp();
const DAY = 86_400_000;
let seq = 0;

async function login(email: string, name = 'Vendedor') {
  await createUser({ email, name, password: 'pw12345', role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function twoOpenCards(createdBy: string, owners: { velho?: string | null; novo?: string | null } = {}) {
  seq += 1;
  const lead = await createLead({ phone: `55549500${String(seq).padStart(5, '0')}` });
  const antiga = await createCampaign({ name: 'Campanha Teste', createdByUserId: createdBy });
  const nova = await createCampaign({ name: 'Teste Andrei III', createdByUserId: createdBy });
  const velho = await createDeal({
    leadId: lead.id, stage: 'proposta_enviada', campaignId: antiga.id,
    ownerUserId: owners.velho ?? null, createdAt: new Date(Date.now() - 120 * DAY),
  });
  const novo = await createDeal({
    leadId: lead.id, stage: 'lead_no_comercial', campaignId: nova.id,
    ownerUserId: owners.novo ?? null, createdAt: new Date(Date.now() - DAY),
  });
  return { lead, antiga, nova, velho, novo };
}

async function ownerOf(id: string) {
  return (await db.select({ o: deals.ownerUserId }).from(deals).where(eq(deals.id, id)))[0].o;
}

describe('lead com mais de um card aberto', () => {
  it('getDealByLeadId devolve o aberto mais recente', async () => {
    const u = await createUser({ email: 'mk1@x.com' });
    const { lead, novo } = await twoOpenCards(u.id);
    expect((await getDealByLeadId(lead.id))!.id).toBe(novo.id);
  });

  it('sem card aberto, devolve o fechado mais recentemente (não o criado mais recentemente)', async () => {
    const u = await createUser({ email: 'mk4@x.com' });
    const lead = await createLead({ phone: '5554950099001' });
    const campA = await createCampaign({ name: 'Campanha A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'Campanha B', createdByUserId: u.id });
    // Criado ANTES, mas fechado DEPOIS (foi reaberto e voltou a fechar tarde).
    const criadoAntesFechadoDepois = await createDeal({
      leadId: lead.id, stage: 'ganho', proposalValue: 100, campaignId: campA.id,
      createdAt: new Date(Date.now() - 10 * DAY), closedAt: new Date(Date.now() - DAY),
    });
    // Criado DEPOIS, mas fechado ANTES.
    await createDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', campaignId: campB.id,
      createdAt: new Date(Date.now() - 5 * DAY), closedAt: new Date(Date.now() - 8 * DAY),
    });

    expect((await getDealByLeadId(lead.id))!.id).toBe(criadoAntesFechadoDepois.id);
  });

  it('GET /deals/by-lead/:leadId/open lista os abertos, mais recente primeiro', async () => {
    const { token, userId } = await login('v1@x.com');
    const { lead, velho, novo } = await twoOpenCards(userId);
    await createDeal({ leadId: lead.id, stage: 'ganho', proposalValue: 10, closedAt: new Date() });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}/open`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([novo.id, velho.id]);
    expect(res.body[0].campaignName).toBe('Teste Andrei III');
  });

  it('ficha do caso usa o card aberto mais recente', async () => {
    const u = await createUser({ email: 'mk2@x.com' });
    const { lead, novo } = await twoOpenCards(u.id);
    expect((await getCaseSheet(lead.id)).dealId).toBe(novo.id);
  });

  it('pegar a conversa leva todos os cards abertos do lead', async () => {
    const julia = await login('julia@x.com', 'Julia');
    const carla = await createUser({ email: 'carla@x.com', name: 'Carla' });
    const { lead, velho, novo } = await twoOpenCards(julia.userId);
    // Terceiro card, de outra campanha, entregue à Carla no pipeline: fica com ela.
    const outra = await createCampaign({ name: 'Outra', createdByUserId: julia.userId });
    const daCarla = await createDeal({ leadId: lead.id, stage: 'em_negociacao', campaignId: outra.id, ownerUserId: carla.id });
    const conv = await createConversation({ phone: lead.phone!, leadId: lead.id, queue: 'comercial' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${julia.token}`);
    expect(res.status).toBe(200);

    expect(await ownerOf(velho.id)).toBe(julia.userId);
    expect(await ownerOf(novo.id)).toBe(julia.userId);
    expect(await ownerOf(daCarla.id)).toBe(carla.id);
  });

  it('Reativar: só barra quando há outro aberto da MESMA campanha', async () => {
    const { token, userId } = await login('v2@x.com');
    const { lead, antiga } = await twoOpenCards(userId);
    const fechadoDaAntigaOutroCiclo = await createDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: antiga.id,
    });
    const u2 = await createUser({ email: 'mk3@x.com' });
    const terceira = await createCampaign({ name: 'Terceira', createdByUserId: u2.id });
    const fechadoDaTerceira = await createDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: terceira.id,
    });

    const bloqueado = await request(app)
      .post(`/api/deals/${fechadoDaAntigaOutroCiclo.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(bloqueado.status).toBe(409);

    const liberado = await request(app)
      .post(`/api/deals/${fechadoDaTerceira.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(liberado.status).toBe(200);
  });
});
