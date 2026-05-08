import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' | 'recepcao' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/deals', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/deals');
    expect(res.status).toBe(401);
  });

  it('403 pra recepcao', async () => {
    const { token } = await loginAs('r@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 retorna board agrupado por stage com totals', async () => {
    const { token, userId } = await loginAs();
    const lead1 = await createLead({ phone: '11000060001' });
    await createDeal({ leadId: lead1.id, stage: 'proposta_enviada', proposalValue: 280, ownerUserId: userId });
    const lead2 = await createLead({ phone: '11000060002' });
    await createDeal({ leadId: lead2.id, stage: 'em_negociacao', proposalValue: 580, ownerUserId: userId });

    const res = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages.proposta_enviada).toHaveLength(1);
    expect(res.body.stages.em_negociacao).toHaveLength(1);
    expect(res.body.stages.ganho).toHaveLength(0);
    expect(res.body.totals.proposta_enviada.count).toBe(1);
    expect(res.body.totals.proposta_enviada.valueSum).toBe(280);
    expect(res.body.totals.em_negociacao.valueSum).toBe(580);
  });

  it('owner=mine filtra só meus, owner=all pega todos', async () => {
    const { token, userId } = await loginAs();
    const otherUser = await createUser({ email: 'other@x.com', password: 'pw12345', role: 'comercial' });
    const lead1 = await createLead({ phone: '11000061001' });
    await createDeal({ leadId: lead1.id, ownerUserId: userId });
    const lead2 = await createLead({ phone: '11000061002' });
    await createDeal({ leadId: lead2.id, ownerUserId: otherUser.id });

    const mine = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(mine.body.stages.proposta_enviada).toHaveLength(1);

    const all = await request(app).get('/api/deals?owner=all').set('Authorization', `Bearer ${token}`);
    expect(all.body.stages.proposta_enviada).toHaveLength(2);
  });

  it('terminais aparecem se closed_at < 7 dias, somem se >= 7 dias', async () => {
    const { token, userId } = await loginAs();
    const recent = await createLead({ phone: '11000062001' });
    await createDeal({
      leadId: recent.id,
      stage: 'ganho',
      proposalValue: 540,
      ownerUserId: userId,
      closedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const old = await createLead({ phone: '11000062002' });
    await createDeal({
      leadId: old.id,
      stage: 'ganho',
      proposalValue: 700,
      ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(res.body.stages.ganho).toHaveLength(1);
    expect(res.body.stages.ganho[0].lead.phone).toBe('11000062001');
  });

  it('busca q filtra por nome, telefone, placa do lead', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000063001', name: 'João Silva' });
    await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app).get('/api/deals?owner=mine&q=Silva').set('Authorization', `Bearer ${token}`);
    expect(res.body.stages.proposta_enviada).toHaveLength(1);
  });

  it('owner=<uuid> filtra deals do usuário específico', async () => {
    const { token, userId } = await loginAs();
    const other = await createUser({ email: 'other2@x.com', password: 'pw12345', role: 'comercial' });
    const lead1 = await createLead({ phone: '11000063001' });
    await createDeal({ leadId: lead1.id, ownerUserId: userId });
    const lead2 = await createLead({ phone: '11000063002' });
    await createDeal({ leadId: lead2.id, ownerUserId: other.id });

    const res = await request(app).get(`/api/deals?owner=${other.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages.proposta_enviada).toHaveLength(1);
    expect(res.body.stages.proposta_enviada[0].owner.id).toBe(other.id);
  });

  it('owner=unassigned filtra deals sem dono', async () => {
    const { token } = await loginAs('me3@x.com');
    const lead = await createLead({ phone: '11000063003' });
    await createDeal({ leadId: lead.id, ownerUserId: null });

    const res = await request(app).get('/api/deals?owner=unassigned').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages.proposta_enviada.length).toBeGreaterThanOrEqual(1);
    expect(res.body.stages.proposta_enviada.every((d: { owner: unknown }) => d.owner === null)).toBe(true);
  });
});
