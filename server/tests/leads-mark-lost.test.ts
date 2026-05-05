import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { leads } from '../db/schema';
import { listLeadTransitions } from '../services/stageTransitions';
import { createUser, createLead } from './helpers';

const app = createApp();

async function loginAs(role: 'admin' | 'recepcao' = 'admin') {
  const u = await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string };
}

describe('POST /api/leads/:id/lost', () => {
  it('401 sem token', async () => {
    const r = await request(app).post('/api/leads/00000000-0000-0000-0000-000000000000/lost').send({});
    expect(r.status).toBe(401);
  });

  it('404 quando lead não existe', async () => {
    const { token } = await loginAs();
    const r = await request(app)
      .post('/api/leads/00000000-0000-0000-0000-000000000000/lost')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(404);
  });

  it('200 marca lead como perdido + grava transition manual_lost', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ flowStage: 'engaged' });

    const r = await request(app)
      .post(`/api/leads/${lead.id}/lost`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'cliente sem interesse' });
    expect(r.status).toBe(200);
    expect(r.body.flowStage).toBe('lost');

    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.flowStage).toBe('lost');

    const transitions = await listLeadTransitions(lead.id);
    expect(transitions[0].fromStage).toBe('engaged');
    expect(transitions[0].toStage).toBe('lost');
    expect(transitions[0].source).toBe('manual_lost');
    expect(transitions[0].metadata).toEqual({ reason: 'cliente sem interesse' });
  });

  it('400 quando lead já está lost', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ flowStage: 'lost' });
    const r = await request(app)
      .post(`/api/leads/${lead.id}/lost`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(400);
  });

  it('400 quando lead já está handed_off (deve fechar deal em vez de marcar lost)', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ flowStage: 'handed_off' });
    const r = await request(app)
      .post(`/api/leads/${lead.id}/lost`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/comercial/i);
  });

  it('200 sem reason → metadata null', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ flowStage: 'complete' });

    await request(app)
      .post(`/api/leads/${lead.id}/lost`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const transitions = await listLeadTransitions(lead.id);
    expect(transitions[0].metadata).toBeNull();
  });
});
