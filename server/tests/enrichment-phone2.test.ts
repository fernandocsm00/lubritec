import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { leads } from '../db/schema';
import {
  startScopedEnrichment,
  startBulkEnrichment,
  processNextEnrichment,
  getCurrentJob,
} from '../services/enrichmentJobs';
import { createUser, createLead } from './helpers';

vi.mock('../services/cnpjLookup', () => ({ lookupCnpj: vi.fn() }));
import { lookupCnpj } from '../services/cnpjLookup';

beforeEach(() => {
  vi.mocked(lookupCnpj).mockReset();
});

const ACTIVE = (cnpj: string, telefone: string) => ({
  cnpj, status: 'active' as const, razaoSocial: 'X', situacaoCadastral: 'ATIVA', telefone,
});

describe('startScopedEnrichment (target=phone2)', () => {
  it('grava o número no phone2 (preserva phone1)', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ phone: '11999990000', cnpj: '11444777000161' });
    const job = await startScopedEnrichment([lead.id], 'phone2', u.id);
    expect(job.target).toBe('phone2');

    vi.mocked(lookupCnpj).mockResolvedValueOnce(ACTIVE('11444777000161', '5499456069'));
    const r = await processNextEnrichment();
    expect(r.resultStatus).toBe('phone_found');

    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone).toBe('11999990000');        // Tel 1 intacto
    expect(updated.phone2).toBe('5554999456069');      // Tel 2 preenchido

    const cur = await getCurrentJob();
    expect(cur!.recentlyFound?.some((f) => f.leadId === lead.id && f.phone2 === '5554999456069')).toBe(true);
  });

  it('não sobrescreve phone2 já preenchido', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ phone: '11999990001', cnpj: '00360305000104' });
    await db.update(leads).set({ phone2: '5511888887777' }).where(eq(leads.id, lead.id));
    await startScopedEnrichment([lead.id], 'phone2', u.id);

    const r = await processNextEnrichment();
    expect(r.resultStatus).toBe('already_has_phone2');
    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone2).toBe('5511888887777');      // inalterado
  });

  it('número igual ao Tel 1 não é gravado', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ phone: '5554999456069', cnpj: '33000167000101' });
    await startScopedEnrichment([lead.id], 'phone2', u.id);

    vi.mocked(lookupCnpj).mockResolvedValueOnce(ACTIVE('33000167000101', '5499456069'));
    const r = await processNextEnrichment();
    expect(r.resultStatus).toBe('phone_not_in_brasilapi');
    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone2).toBeNull();
  });

  it('409 quando já há enriquecimento ativo', async () => {
    const u = await createUser({ role: 'admin' });
    const inc = await createLead({ flowStage: 'incomplete', phone: null, cnpj: '60746948000112' });
    void inc;
    await startBulkEnrichment(u.id); // ocupa o singleton
    const lead = await createLead({ phone: '11999990002', cnpj: '60872504000123' });
    await expect(startScopedEnrichment([lead.id], 'phone2', u.id)).rejects.toMatchObject({ status: 409 });
  });

  it('400 quando nenhum lead tem CNPJ de 14 dígitos', async () => {
    const u = await createUser({ role: 'admin' });
    const lead = await createLead({ phone: '11999990003', cnpj: '11144477735' }); // CPF (11 díg)
    await expect(startScopedEnrichment([lead.id], 'phone2', u.id)).rejects.toMatchObject({ status: 400 });
  });
});
