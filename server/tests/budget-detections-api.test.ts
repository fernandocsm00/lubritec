import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { budgetDetections, deals } from '../db/schema';
import { createLead, createConversation, createMessage, createUser } from './helpers';

const app = createApp();

// Padrão dos testes de API do projeto: helper local, auth via Bearer.
async function loginAs(
  email = 'c@x.com',
  password = 'pw12345',
  role: 'comercial' | 'admin' | 'recepcao' = 'comercial',
) {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

let phoneSeq = 0;
async function seedPending(value = '3443.04') {
  const phone = `551190000${String(1000 + phoneSeq++).slice(-4)}`;
  const lead = await createLead({ phone });
  const conv = await createConversation({ phone, leadId: lead.id, queue: 'comercial' });
  const msg = await createMessage({
    conversationId: conv.id, direction: 'out', kind: 'image',
    mediaUrl: '/uploads/conversations/x.jpg', mediaMime: 'image/jpeg',
  });
  const [det] = await db.insert(budgetDetections).values({
    messageId: msg.id, leadId: lead.id, detectedValue: value, detectedLabel: 'Valor total',
  }).returning();
  return { lead, det };
}

describe('GET /api/budget-detections/pending/:leadId', () => {
  it('devolve a detecção pendente do lead', async () => {
    const { token } = await loginAs();
    const { lead } = await seedPending();

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.detectedValue).toBe(3443.04);
  });

  it('devolve null quando não há pendente', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '5511900009911' });

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('401 sem token', async () => {
    const { lead } = await seedPending();
    const res = await request(app).get(`/api/budget-detections/pending/${lead.id}`);
    expect(res.status).toBe(401);
  });

  it('403 pra recepcao (mesmo RBAC do pipeline)', async () => {
    const { token } = await loginAs('r@x.com', 'pw12345', 'recepcao');
    const { lead } = await seedPending();

    const res = await request(app)
      .get(`/api/budget-detections/pending/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/budget-detections/:id/confirm', () => {
  it('grava o valor no deal e move a etapa', async () => {
    const { token, userId } = await loginAs();
    const { lead, det } = await seedPending();

    const res = await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 3443.04, stage: 'proposta_enviada' });

    expect(res.status).toBe(200);
    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(Number(deal.proposalValue)).toBe(3443.04);
    expect(deal.stage).toBe('proposta_enviada');
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(row.status).toBe('confirmed');
    // Auditoria: quem confirmou. Sem isso o campo fica null silenciosamente e a
    // tabela perde a razão de existir (rastrear de onde veio o valor do card).
    expect(row.resolvedBy).toBe(userId);
    expect(row.resolvedAt).not.toBeNull();
    expect(deal.ownerUserId).toBe(userId);
  });

  it('usa o valor EDITADO pelo vendedor, não o detectado', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 5000 });

    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(Number(deal.proposalValue)).toBe(5000);
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(Number(row.confirmedValue)).toBe(5000);
  });

  it('confirma sem stage: grava valor e não mexe na etapa', async () => {
    const { token } = await loginAs();
    const { lead, det } = await seedPending();

    await request(app)
      .post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 3443.04 });

    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(deal.stage).toBe('lead_no_comercial');
    expect(Number(deal.proposalValue)).toBe(3443.04);
  });

  it('409 ao confirmar duas vezes', async () => {
    const { token } = await loginAs();
    const { det } = await seedPending();
    const auth = `Bearer ${token}`;

    await request(app).post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', auth).send({ value: 100 });
    const res = await request(app).post(`/api/budget-detections/${det.id}/confirm`)
      .set('Authorization', auth).send({ value: 200 });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/budget-detections/:id/dismiss', () => {
  it('marca dispensada e não toca em deals', async () => {
    const { token, userId } = await loginAs();
    const { lead, det } = await seedPending();

    const res = await request(app)
      .post(`/api/budget-detections/${det.id}/dismiss`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [row] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, det.id));
    expect(row.status).toBe('dismissed');
    expect(row.resolvedBy).toBe(userId);
    const dealRows = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(dealRows).toHaveLength(0);
  });
});
