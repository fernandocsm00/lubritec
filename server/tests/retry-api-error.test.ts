import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { startRetryApiErrorJob, startBulkEnrichment } from '../services/enrichmentJobs';
import { createLead, createUser } from './helpers';

const VALID_CNPJ_A = '11222333000181';
const VALID_CNPJ_B = '11444777000161';
const VALID_CNPJ_C = '00000000000191';
const VALID_CNPJ_D = '91839456000103';
const VALID_CNPJ_E = '11888777000150';
const VALID_CPF    = '11144477735';

async function seedJobAndApiError(opts: {
  userId: string;
  leadId: string;
  resultStatus?: string;
  jobStatus?: 'running' | 'completed' | 'cancelled' | 'paused';
}): Promise<string> {
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      status: opts.jobStatus ?? 'completed',
      totalLeads: 1,
      processedCount: 1,
      succeededCount: opts.resultStatus === 'phone_found' ? 1 : 0,
      failedCount: opts.resultStatus === 'phone_found' ? 0 : 1,
      startedAt: new Date(),
      completedAt: opts.jobStatus === 'completed' || opts.jobStatus == null ? new Date() : null,
      createdByUserId: opts.userId,
    })
    .returning();

  await db.insert(enrichmentJobLeads).values({
    jobId: job.id,
    leadId: opts.leadId,
    status: opts.resultStatus === 'phone_found' ? 'succeeded' : 'failed',
    resultStatus: opts.resultStatus ?? 'api_error',
    processedAt: new Date(),
  });

  return job.id;
}

describe('startRetryApiErrorJob', () => {
  it('409 quando já existe job ativo', async () => {
    const user = await createUser({ email: 'retry-409@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await startBulkEnrichment(user.id);

    await expect(startRetryApiErrorJob(user.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/em andamento/i),
    });
  });

  it('400 quando zero candidatos com api_error', async () => {
    const user = await createUser({ email: 'retry-400@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });

    await expect(startRetryApiErrorJob(user.id)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Nenhum lead com erro BrasilAPI/i),
    });
  });

  it('snapshot inclui SÓ leads incompletos com api_error e CNPJ 14 dig', async () => {
    const user = await createUser({ email: 'retry-filter@x.com', role: 'admin' });

    const wanted1 = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({ userId: user.id, leadId: wanted1.id });

    const wanted2 = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    await seedJobAndApiError({ userId: user.id, leadId: wanted2.id });

    // já promovido → NÃO entra
    const promoted = await createLead({ phone: '5511999999999', cnpj: VALID_CNPJ_C });
    await seedJobAndApiError({ userId: user.id, leadId: promoted.id });

    // permanente → NÃO entra
    const notFound = await createLead({ phone: null, cnpj: VALID_CNPJ_D });
    await seedJobAndApiError({
      userId: user.id, leadId: notFound.id, resultStatus: 'cnpj_not_found',
    });

    // fora de escopo → NÃO entra
    const noPhone = await createLead({ phone: null, cnpj: VALID_CNPJ_E });
    await seedJobAndApiError({
      userId: user.id, leadId: noPhone.id, resultStatus: 'phone_not_in_brasilapi',
    });

    // CPF → NÃO entra
    const cpfLead = await createLead({ phone: null, cnpj: VALID_CPF });
    await seedJobAndApiError({ userId: user.id, leadId: cpfLead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(2);
    expect(job.status).toBe('running');
    expect(job.processedCount).toBe(0);

    const rows = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.leadId).sort()).toEqual([wanted1.id, wanted2.id].sort());
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });

  it('lead com múltiplas tentativas api_error entra UMA vez (DISTINCT)', async () => {
    const user = await createUser({ email: 'retry-distinct@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });

    await seedJobAndApiError({ userId: user.id, leadId: lead.id });
    await seedJobAndApiError({ userId: user.id, leadId: lead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(1);

    const rows = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].leadId).toBe(lead.id);
  });

  it('cria job em running com createdByUserId correto', async () => {
    const user = await createUser({ email: 'retry-owner@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({ userId: user.id, leadId: lead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.status).toBe('running');
    const [row] = await db
      .select()
      .from(enrichmentJobs)
      .where(eq(enrichmentJobs.id, job.id));
    expect(row.createdByUserId).toBe(user.id);
    expect(row.startedAt).not.toBeNull();
  });

  it('lead com api_error em job cancelled ainda elegível pra retry', async () => {
    const user = await createUser({ email: 'retry-cancelled@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({
      userId: user.id, leadId: lead.id, jobStatus: 'cancelled',
    });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(1);
  });
});
