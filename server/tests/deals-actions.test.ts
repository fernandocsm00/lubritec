import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals, dealActivities } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('POST /api/deals (create)', () => {
  it('200 cria deal manual e loga activity created', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000080001' });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id, proposalValue: 280 });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('proposta_enviada');
    expect(res.body.proposalValue).toBe(280);
    expect(res.body.owner.id).toBe(userId);

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, res.body.id));
    expect(acts.find((a) => a.kind === 'created')).toBeDefined();
  });

  it('200 idempotente: 2x mesmo lead → retorna deal existente', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000080010' });
    const existing = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
  });
});

describe('PATCH /api/deals/:id', () => {
  it('200 edita valor e loga value_changed', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000081001' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 280, ownerUserId: userId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ proposalValue: 320 });
    expect(res.status).toBe(200);
    expect(res.body.proposalValue).toBe(320);

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'value_changed')).toBeDefined();
  });

  it('200 edita notes e loga note_added', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000081010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'cliente pediu desconto' });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('cliente pediu desconto');

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'note_added')).toBeDefined();
  });
});

describe('POST /api/deals/:id/stage', () => {
  it('200 move stage e loga stage_changed', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('em_negociacao');

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'stage_changed')).toBeDefined();
  });

  it('400 quando perdido sem lossReason', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'perdido' });
    expect(res.status).toBe(400);
  });

  it('200 perdido com lossReason limpa value, seta closed_at, loga lost', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082020' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 280, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'perdido', lossReason: 'preco' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('perdido');
    expect(res.body.lossReason).toBe('preco');
    expect(res.body.closedAt).not.toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'lost')).toBeDefined();
  });

  it('400 ganho sem proposal_value', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082030' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });  // sem valor

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'ganho' });
    expect(res.status).toBe(400);
  });

  it('200 ganho com value seta closed_at e loga won', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082040' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 540, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'ganho' });
    expect(res.status).toBe(200);
    expect(res.body.closedAt).not.toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'won')).toBeDefined();
  });

  it('200 reativando (perdido → proposta_enviada) loga reactivated, limpa closed_at e lossReason', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082050' });
    const d = await createDeal({
      leadId: lead.id,
      stage: 'perdido',
      lossReason: 'sem_retorno',
      proposalValue: 200,
      ownerUserId: userId,
      closedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'proposta_enviada' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('proposta_enviada');
    expect(res.body.closedAt).toBeNull();
    expect(res.body.lossReason).toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'reactivated')).toBeDefined();
  });
});

describe('DELETE /api/deals/:id', () => {
  it('204 admin deleta', async () => {
    const { token: adminToken } = await loginAs('a@x.com', 'pw12345', 'admin');
    const { userId: cUserId } = await loginAs('c2@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000083001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: cUserId });

    const res = await request(app)
      .delete(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row).toBeUndefined();
  });

  it('403 comercial não pode deletar', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000083010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .delete(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
