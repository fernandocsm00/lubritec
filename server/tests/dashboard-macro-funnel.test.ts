import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { macroFunnel } from '../services/dashboardService';
import { createUser, createLead } from './helpers';

const app = createApp();

async function loginAs(role: 'admin' | 'recepcao' = 'admin') {
  const u = await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe('macroFunnel service', () => {
  it('zero leads → todas as etapas em 0', async () => {
    const r = await macroFunnel({ period: 'today' });
    expect(r.total).toBe(0);
    expect(r.stages.imported.count).toBe(0);
    expect(r.stages.complete.count).toBe(0);
    expect(r.stages.dispatched.count).toBe(0);
    expect(r.stages.engaged.count).toBe(0);
    expect(r.stages.qualified.count).toBe(0);
    expect(r.stages.handedOff.count).toBe(0);
    expect(r.sidelines.incomplete.count).toBe(0);
    expect(r.sidelines.lost.count).toBe(0);
  });

  it('cumulative counts: handed_off conta em todas as etapas até handedOff', async () => {
    // createdAt fixo antes de "agora" pra garantir que cai dentro da janela 30d
    const past = new Date(Date.now() - 60_000);
    await createLead({ flowStage: 'incomplete', phone: null, createdAt: past });
    await createLead({ flowStage: 'complete', createdAt: past });
    await createLead({ flowStage: 'dispatched', createdAt: past });
    await createLead({ flowStage: 'engaged', createdAt: past });
    await createLead({ flowStage: 'qualified', createdAt: past });
    await createLead({ flowStage: 'handed_off', createdAt: past });
    await createLead({ flowStage: 'lost', createdAt: past });

    const r = await macroFunnel({ period: '30d' });
    expect(r.total).toBe(7);
    // imported = todos
    expect(r.stages.imported.count).toBe(7);
    // complete inclui complete + dispatched + engaged + qualified + handed_off = 5
    expect(r.stages.complete.count).toBe(5);
    // dispatched inclui dispatched + engaged + qualified + handed_off = 4
    expect(r.stages.dispatched.count).toBe(4);
    // engaged inclui engaged + qualified + handed_off = 3
    expect(r.stages.engaged.count).toBe(3);
    // qualified inclui qualified + handed_off = 2
    expect(r.stages.qualified.count).toBe(2);
    // handedOff só ele = 1
    expect(r.stages.handedOff.count).toBe(1);
    // sidelines exatos
    expect(r.sidelines.incomplete.count).toBe(1);
    expect(r.sidelines.lost.count).toBe(1);
  });

  it('convFromPrev calcula taxa de conversão entre etapas', async () => {
    const past = new Date(Date.now() - 60_000);
    // 10 leads complete, 5 viram dispatched (50%), 1 vira engaged (20% dos 5)
    for (let i = 0; i < 5; i++) await createLead({ flowStage: 'complete', createdAt: past });
    for (let i = 0; i < 4; i++) await createLead({ flowStage: 'dispatched', createdAt: past });
    await createLead({ flowStage: 'engaged', createdAt: past });

    const r = await macroFunnel({ period: '30d' });
    // imported=10, complete=10 (todos com phone), dispatched=5, engaged=1
    expect(r.stages.complete.count).toBe(10);
    expect(r.stages.dispatched.count).toBe(5);
    expect(r.stages.engaged.count).toBe(1);
    // taxa dispatched/complete = 5/10 = 50%
    expect(r.stages.dispatched.convFromPrev).toBe(50);
    // taxa engaged/dispatched = 1/5 = 20%
    expect(r.stages.engaged.convFromPrev).toBe(20);
  });

  it('pctOfTotal calcula proporção sobre o total importado', async () => {
    const past = new Date(Date.now() - 60_000);
    for (let i = 0; i < 6; i++) await createLead({ flowStage: 'complete', createdAt: past });
    for (let i = 0; i < 4; i++) await createLead({ flowStage: 'incomplete', phone: null, createdAt: past });

    const r = await macroFunnel({ period: '30d' });
    expect(r.total).toBe(10);
    // 6 complete = 60%
    expect(r.stages.complete.pctOfTotal).toBe(60);
    // 4 incomplete = 40%
    expect(r.sidelines.incomplete.pctOfTotal).toBe(40);
  });
});

describe('GET /api/dashboard/macro-funnel', () => {
  it('401 sem token', async () => {
    const r = await request(app).get('/api/dashboard/macro-funnel?period=today');
    expect(r.status).toBe(401);
  });

  it('403 quando não é admin', async () => {
    const { token } = await loginAs('recepcao');
    const r = await request(app)
      .get('/api/dashboard/macro-funnel?period=today')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('200 admin recebe shape correto', async () => {
    const { token } = await loginAs('admin');
    await createLead({ flowStage: 'engaged' });
    const r = await request(app)
      .get('/api/dashboard/macro-funnel?period=30d')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.stages.imported.count).toBeGreaterThanOrEqual(1);
    expect(r.body.stages.engaged.count).toBeGreaterThanOrEqual(1);
    expect(r.body.period.label).toBeDefined();
  });

  it('400 quando period inválido', async () => {
    const { token } = await loginAs('admin');
    const r = await request(app)
      .get('/api/dashboard/macro-funnel?period=invalid')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(400);
  });

  it('aceita date range customizado via from+to', async () => {
    const { token } = await loginAs('admin');
    const past = new Date(Date.now() - 60_000);
    await createLead({ flowStage: 'engaged', createdAt: past });

    const from = new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const r = await request(app)
      .get(`/api/dashboard/macro-funnel?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.stages.engaged.count).toBeGreaterThanOrEqual(1);
    expect(r.body.period.label).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('400 quando from > to', async () => {
    const { token } = await loginAs('admin');
    const from = new Date().toISOString();
    const to = new Date(Date.now() - 86400_000).toISOString();
    const r = await request(app)
      .get(`/api/dashboard/macro-funnel?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(400);
  });

  it('400 quando nem period nem from+to fornecidos', async () => {
    const { token } = await loginAs('admin');
    const r = await request(app)
      .get('/api/dashboard/macro-funnel')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(400);
  });
});

describe('avgDurationByStage', () => {
  it('vazio quando não há transições no período', async () => {
    const { token } = await loginAs('admin');
    const r = await request(app)
      .get('/api/dashboard/macro-funnel?period=today')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.avgDurationByStage).toEqual([]);
  });

  it('computa avgSeconds entre transições do mesmo lead', async () => {
    const { token } = await loginAs('admin');
    const past = new Date(Date.now() - 60_000);
    const lead = await createLead({ flowStage: 'engaged', createdAt: past });

    // Insere transições manualmente: incomplete (10 min atrás) → complete (5 min atrás) → engaged (agora)
    const tenMin = new Date(Date.now() - 10 * 60_000);
    const fiveMin = new Date(Date.now() - 5 * 60_000);
    const now = new Date();
    const { db } = await import('../db/client');
    const { leadStageTransitions } = await import('../db/schema');
    await db.insert(leadStageTransitions).values([
      { leadId: lead.id, fromStage: null, toStage: 'incomplete', source: 'create', changedAt: tenMin },
      { leadId: lead.id, fromStage: 'incomplete', toStage: 'complete', source: 'enrichment', changedAt: fiveMin },
      { leadId: lead.id, fromStage: 'complete', toStage: 'engaged', source: 'webhook_inbound', changedAt: now },
    ]);

    const r = await request(app)
      .get('/api/dashboard/macro-funnel?period=30d')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    const durations = r.body.avgDurationByStage as Array<{ stage: string; avgSeconds: number; transitionCount: number }>;
    // Esperamos 2 entries: incomplete (5min entre as 2 primeiras) e complete (5min entre 2 últimas).
    // engaged não tem next_changed_at, então não entra.
    const incomplete = durations.find((d) => d.stage === 'incomplete');
    const complete = durations.find((d) => d.stage === 'complete');
    expect(incomplete).toBeDefined();
    expect(complete).toBeDefined();
    expect(incomplete!.avgSeconds).toBeGreaterThan(290); // ~300s = 5min, com tolerância
    expect(incomplete!.avgSeconds).toBeLessThan(310);
    expect(complete!.avgSeconds).toBeGreaterThan(290);
    expect(complete!.avgSeconds).toBeLessThan(310);
  });
});
