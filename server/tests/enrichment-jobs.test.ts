import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { leads, enrichmentJobs, enrichmentJobLeads } from '../db/schema';
import {
  startBulkEnrichment,
  cancelCurrentJob,
  getCurrentJob,
  processNextEnrichment,
} from '../services/enrichmentJobs';
import { createUser, createLead } from './helpers';

vi.mock('../services/cnpjLookup', () => ({
  lookupCnpj: vi.fn(),
}));

import { lookupCnpj } from '../services/cnpjLookup';

const app = createApp();

async function loginAs(role: 'admin' | 'recepcao' = 'admin') {
  const u = await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

beforeEach(() => {
  vi.mocked(lookupCnpj).mockReset();
});

describe('startBulkEnrichment', () => {
  it('400 quando não há leads incomplete com CNPJ', async () => {
    const u = await createUser({ role: 'admin' });
    await expect(startBulkEnrichment(u.id)).rejects.toThrow(/Nenhum lead incompleto/);
  });

  it('cria job + snapshot de leads incomplete com CNPJ', async () => {
    const u = await createUser({ role: 'admin' });
    // 3 leads incompletos com cnpj
    const l1 = await createLead({ flowStage: 'incomplete', phone: null });
    const l2 = await createLead({ flowStage: 'incomplete', phone: null });
    const l3 = await createLead({ flowStage: 'incomplete', phone: null });
    // 1 lead completo (não entra)
    await createLead({ flowStage: 'complete' });

    const job = await startBulkEnrichment(u.id);
    expect(job.totalLeads).toBe(3);
    expect(job.status).toBe('running');
    expect(job.processedCount).toBe(0);

    const snapshot = await db.select().from(enrichmentJobLeads).where(eq(enrichmentJobLeads.jobId, job.id));
    expect(snapshot).toHaveLength(3);
    const ids = snapshot.map((s) => s.leadId).sort();
    expect(ids).toEqual([l1.id, l2.id, l3.id].sort());
  });

  it('409 quando já existe job ativo', async () => {
    const u = await createUser({ role: 'admin' });
    await createLead({ flowStage: 'incomplete', phone: null });
    await startBulkEnrichment(u.id);
    await createLead({ flowStage: 'incomplete', phone: null });
    await expect(startBulkEnrichment(u.id)).rejects.toThrow(/em andamento/);
  });

  it('exclui leads sem CNPJ do snapshot', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ flowStage: 'incomplete', phone: null });
    // remove cnpj manualmente
    await db.update(leads).set({ cnpj: null }).where(eq(leads.id, lead.id));
    await expect(startBulkEnrichment(u.id)).rejects.toThrow(/Nenhum lead incompleto/);
  });
});

describe('cancelCurrentJob', () => {
  it('cancela job ativo', async () => {
    const u = await createUser({ role: 'admin' });
    await createLead({ flowStage: 'incomplete', phone: null });
    await startBulkEnrichment(u.id);
    const cancelled = await cancelCurrentJob();
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe('cancelled');
  });

  it('null quando não há job ativo', async () => {
    const r = await cancelCurrentJob();
    expect(r).toBeNull();
  });
});

describe('processNextEnrichment', () => {
  it('no_job quando não há job ativo', async () => {
    const r = await processNextEnrichment();
    expect(r.status).toBe('no_job');
  });

  it('processa lead e marca succeeded quando BrasilAPI retorna telefone', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ flowStage: 'incomplete', phone: null, cnpj: '11444777000161' });
    const job = await startBulkEnrichment(u.id);

    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000161',
      status: 'active',
      razaoSocial: 'X',
      situacaoCadastral: 'ATIVA',
      telefone: '5499456069',
    });

    const r = await processNextEnrichment();
    expect(r.status).toBe('processed');
    expect(r.resultStatus).toBe('phone_found');

    const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updatedLead.phone).toBe('555499456069');
    expect(updatedLead.flowStage).toBe('complete');

    const updatedJob = await getCurrentJob();
    expect(updatedJob).not.toBeNull();
    // Esse era o último lead → job deve estar completed após processar.
    expect(updatedJob!.processedCount).toBe(1);
    expect(updatedJob!.succeededCount).toBe(1);

    // Próximo tick → completa o job
    const r2 = await processNextEnrichment();
    expect(r2.status).toBe('job_completed');
    const finalJob = await getCurrentJob();
    expect(finalJob!.status).toBe('completed');
  });

  it('marca failed quando BrasilAPI não tem telefone', async () => {
    const u = await createUser({ role: 'admin' });
    await createLead({ flowStage: 'incomplete', phone: null, cnpj: '11444777000161' });
    const job = await startBulkEnrichment(u.id);

    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000161',
      status: 'active',
      razaoSocial: 'X',
      situacaoCadastral: 'ATIVA',
      telefone: null,
    });

    const r = await processNextEnrichment();
    expect(r.status).toBe('processed');
    expect(r.resultStatus).toBe('phone_not_in_brasilapi');

    const [snap] = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(snap.status).toBe('failed');
    expect(snap.resultStatus).toBe('phone_not_in_brasilapi');

    const updated = await getCurrentJob();
    expect(updated!.failedCount).toBe(1);
    expect(updated!.succeededCount).toBe(0);
  });

  it('processNextEnrichment NÃO toca em leads que já viraram complete entre snapshot e tick', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ flowStage: 'incomplete', phone: null, cnpj: '11444777000161' });
    await startBulkEnrichment(u.id);

    // Simula que alguém preencheu o phone manualmente entre snapshot e tick
    await db.update(leads).set({ phone: '5511999990000', flowStage: 'complete' }).where(eq(leads.id, lead.id));

    const r = await processNextEnrichment();
    expect(r.status).toBe('processed');
    expect(r.resultStatus).toBe('already_has_phone');
    // Phone preserved
    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone).toBe('5511999990000');
  });
});

describe('GET /api/leads/enrich-bulk', () => {
  it('401 sem token', async () => {
    const r = await request(app).get('/api/leads/enrich-bulk');
    expect(r.status).toBe(401);
  });

  it('403 quando não admin', async () => {
    const { token } = await loginAs('recepcao');
    const r = await request(app)
      .get('/api/leads/enrich-bulk')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('200 admin retorna { job: null } quando não há job', async () => {
    const { token } = await loginAs('admin');
    const r = await request(app)
      .get('/api/leads/enrich-bulk')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.job).toBeNull();
  });
});

describe('POST /api/leads/enrich-bulk', () => {
  it('200 cria job + retorna shape PublicEnrichmentJob', async () => {
    const { token } = await loginAs('admin');
    await createLead({ flowStage: 'incomplete', phone: null });

    const r = await request(app)
      .post('/api/leads/enrich-bulk')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.totalLeads).toBe(1);
    expect(r.body.status).toBe('running');
    expect(r.body.pctComplete).toBe(0);
  });

  it('409 quando já existe job', async () => {
    const { token } = await loginAs('admin');
    await createLead({ flowStage: 'incomplete', phone: null });
    await request(app).post('/api/leads/enrich-bulk').set('Authorization', `Bearer ${token}`);

    const r = await request(app)
      .post('/api/leads/enrich-bulk')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(409);
  });
});
