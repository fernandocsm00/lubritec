import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { appendLeadsToActiveJob, startBulkEnrichment } from '../services/enrichmentJobs';
import { createLead, createUser } from './helpers';

// CNPJs com dígito verificador válido (14 dígitos).
const VALID_CNPJ_A = '11222333000181';
const VALID_CNPJ_B = '11444777000161';
const VALID_CNPJ_C = '00000000000191';
// CPF (11 dígitos) — deve ser filtrado fora do snapshot.
const VALID_CPF    = '11144477735';

describe('appendLeadsToActiveJob', () => {
  it('retorna null quando não há job ativo', async () => {
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const result = await appendLeadsToActiveJob([lead.id]);
    expect(result).toBeNull();
  });

  it('anexa novos leads ao job ativo e incrementa total_leads', async () => {
    const user = await createUser({ email: 'append-owner@x.com', role: 'admin' });
    // 1 lead pré-existente em 'incomplete' pro startBulkEnrichment ter algo pra snapshot.
    const seed = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    expect(job.totalLeads).toBe(1);

    // 2 novos leads, anexar.
    const newA = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    const newB = await createLead({ phone: null, cnpj: VALID_CNPJ_C });
    const result = await appendLeadsToActiveJob([newA.id, newB.id]);

    expect(result).not.toBeNull();
    expect(result!.appended).toBe(2);
    expect(result!.jobId).toBe(job.id);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(3);

    const rows = await db.select().from(enrichmentJobLeads).where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.leadId).sort()).toEqual([seed.id, newA.id, newB.id].sort());
  });

  it('dedupe — não anexa leads que já estão no snapshot', async () => {
    const user = await createUser({ email: 'append-dup@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    // Anexa o mesmo lead que já foi snapshotado.
    const result = await appendLeadsToActiveJob([lead.id]);
    expect(result!.appended).toBe(0);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(1);
  });

  it('filtra CPFs (11 dígitos) silenciosamente', async () => {
    const user = await createUser({ email: 'append-cpf@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);

    const cpfLead = await createLead({ phone: null, cnpj: VALID_CPF });
    const result = await appendLeadsToActiveJob([cpfLead.id]);
    expect(result!.appended).toBe(0);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(1);
  });

  it('anexa em job pausado', async () => {
    const user = await createUser({ email: 'append-paused@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    // Move pra paused diretamente no banco.
    await db.update(enrichmentJobs).set({ status: 'paused' }).where(eq(enrichmentJobs.id, job.id));

    const newLead = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    const result = await appendLeadsToActiveJob([newLead.id]);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(1);

    const rows = await db.select().from(enrichmentJobLeads)
      .where(and(eq(enrichmentJobLeads.jobId, job.id), eq(enrichmentJobLeads.leadId, newLead.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('lista vazia retorna { appended: 0 } com jobId do ativo', async () => {
    const user = await createUser({ email: 'append-empty@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);

    const result = await appendLeadsToActiveJob([]);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(0);
    expect(result!.jobId).toBe(job.id);
  });
});
