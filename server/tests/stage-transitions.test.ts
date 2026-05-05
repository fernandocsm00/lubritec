import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { eq, desc } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { leadStageTransitions, leads } from '../db/schema';
import { listLeadTransitions, recordTransition } from '../services/stageTransitions';
import { createLead, createUser } from './helpers';

const app = createApp();

async function loginAs() {
  const u = await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string };
}

describe('recordTransition + listLeadTransitions', () => {
  it('grava e lê em ordem cronológica reversa', async () => {
    const lead = await createLead({ flowStage: 'incomplete', phone: null });
    await recordTransition({ leadId: lead.id, fromStage: null, toStage: 'incomplete', source: 'create' });
    await new Promise((r) => setTimeout(r, 5));
    await recordTransition({ leadId: lead.id, fromStage: 'incomplete', toStage: 'complete', source: 'enrichment' });
    await new Promise((r) => setTimeout(r, 5));
    await recordTransition({ leadId: lead.id, fromStage: 'complete', toStage: 'dispatched', source: 'campaign_dispatch' });

    const list = await listLeadTransitions(lead.id);
    expect(list).toHaveLength(3);
    expect(list[0].toStage).toBe('dispatched'); // mais recente primeiro
    expect(list[1].toStage).toBe('complete');
    expect(list[2].toStage).toBe('incomplete');
    expect(list[2].fromStage).toBeNull();
    expect(list[2].source).toBe('create');
  });

  it('best-effort: erros não propagam', async () => {
    // lead_id inexistente — deve falhar mas não throw
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(recordTransition({
      leadId: fakeId, fromStage: null, toStage: 'incomplete', source: 'create',
    })).resolves.toBeUndefined();
  });

  it('metadata é persistido como jsonb', async () => {
    const lead = await createLead({ phone: '5511944443333' });
    await recordTransition({
      leadId: lead.id,
      fromStage: 'complete',
      toStage: 'dispatched',
      source: 'campaign_dispatch',
      metadata: { campaignId: 'c1', isContinuous: true },
    });
    const [list] = await listLeadTransitions(lead.id);
    expect(list.metadata).toEqual({ campaignId: 'c1', isContinuous: true });
  });
});

describe('createLead → registra transition de criação', () => {
  it('lead com phone → transition (null → complete) com source=create', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empresa X', phone: '5511944443344', cnpj: '11444777000161' });
    expect(res.status).toBe(200);

    const list = await listLeadTransitions(res.body.id);
    // Pode ter +1 transition se tryEnrollSafe disparou (não dispara — sem campanha contínua)
    expect(list).toHaveLength(1);
    expect(list[0].fromStage).toBeNull();
    expect(list[0].toStage).toBe('complete');
    expect(list[0].source).toBe('create');
  });

  it('lead sem phone → transition (null → incomplete)', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empresa X', cnpj: '11444777000161' });
    expect(res.status).toBe(200);

    const list = await listLeadTransitions(res.body.id);
    expect(list).toHaveLength(1);
    expect(list[0].toStage).toBe('incomplete');
  });
});

describe('updateLead → registra transition quando phone é adicionado', () => {
  it('phone null → setado: incomplete → complete + source=manual_update', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000161' });

    await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '5511933332222' });

    const list = await listLeadTransitions(lead.id);
    expect(list[0].fromStage).toBe('incomplete');
    expect(list[0].toStage).toBe('complete');
    expect(list[0].source).toBe('manual_update');
  });

  it('update sem mudar stage: nenhuma transition extra', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '5511922221111', flowStage: 'engaged' });

    await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renomeado' });

    const list = await listLeadTransitions(lead.id);
    expect(list).toHaveLength(0);
  });
});

describe('GET /api/leads/:id/transitions', () => {
  it('200 com array de transições', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '5511911110000' });
    await recordTransition({ leadId: lead.id, fromStage: 'complete', toStage: 'dispatched', source: 'campaign_dispatch' });

    const res = await request(app)
      .get(`/api/leads/${lead.id}/transitions`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.transitions).toHaveLength(1);
    expect(res.body.transitions[0].toStage).toBe('dispatched');
  });

  it('401 sem token', async () => {
    const lead = await createLead({});
    const res = await request(app).get(`/api/leads/${lead.id}/transitions`);
    expect(res.status).toBe(401);
  });
});

// Mantém referências usadas
void leadStageTransitions; void leads; void desc; void vi;
