import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

// Cadastros reflete a etapa comercial do card (deals.stage) derivando AO VIVO,
// sem persistir em leads.flow_stage. Ver CADASTRO_STAGES / CADASTRO_STAGE_SQL.

const app = createApp();

async function login(email: string) {
  await createUser({ email, password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

async function listLeads(token: string, query: string) {
  const res = await request(app)
    .get(`/api/leads?${query}`)
    .set('Authorization', `Bearer ${token}`);
  return res;
}

describe('Cadastros — etapa derivada do deal (cadastroStage + filtro)', () => {
  it('deal ganho → cadastroStage "won" e aparece no filtro flowStage=won', async () => {
    const token = await login('cs-won@x.com');
    const lead = await createLead({ name: 'RAMADA WON', phone: '11000200001', flowStage: 'handed_off' });
    await createDeal({ leadId: lead.id, stage: 'ganho', proposalValue: 500 });

    const res = await listLeads(token, 'flowStage=won');
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found.cadastroStage).toBe('won');
    expect(found.hasDeal).toBe(true);
    // flow_stage cru continua handed_off (não foi tocado) — dashboard intacto.
    expect(found.flowStage).toBe('handed_off');
  });

  it('deal perdido → cadastroStage "lost" e aparece no filtro flowStage=lost', async () => {
    const token = await login('cs-lost@x.com');
    const lead = await createLead({ name: 'PERDIDO CARD', phone: '11000200002', flowStage: 'handed_off' });
    await createDeal({ leadId: lead.id, stage: 'perdido', proposalValue: 300, lossReason: 'preco' });

    const res = await listLeads(token, 'flowStage=lost');
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found.cadastroStage).toBe('lost');
  });

  it('deal em_negociacao → cadastroStage "em_negociacao" e filtro casa', async () => {
    const token = await login('cs-neg@x.com');
    const lead = await createLead({ name: 'NEGOCIANDO', phone: '11000200003', flowStage: 'handed_off' });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', proposalValue: 200 });

    const res = await listLeads(token, 'flowStage=em_negociacao');
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found.cadastroStage).toBe('em_negociacao');
  });

  it('deal lead_no_comercial → cadastroStage "handed_off" (No comercial)', async () => {
    const token = await login('cs-noc@x.com');
    const lead = await createLead({ name: 'NO COMERCIAL', phone: '11000200004', flowStage: 'handed_off' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });

    const res = await listLeads(token, 'flowStage=handed_off');
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found.cadastroStage).toBe('handed_off');
  });

  it('lead sem deal → cadastroStage espelha flow_stage (qualified)', async () => {
    const token = await login('cs-qual@x.com');
    const lead = await createLead({ name: 'SO LEAD', phone: '11000200005', flowStage: 'qualified' });

    const res = await listLeads(token, 'flowStage=qualified');
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found.cadastroStage).toBe('qualified');

    // E NÃO aparece filtrando por won (tem que ser excludente).
    const resWon = await listLeads(token, 'flowStage=won');
    expect(resWon.body.items.find((l: { id: string }) => l.id === lead.id)).toBeUndefined();
  });
});
