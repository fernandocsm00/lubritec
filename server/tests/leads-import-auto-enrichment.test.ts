import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { importLeadsFromCsv } from '../services/leadsImport';
import * as enrichmentJobsService from '../services/enrichmentJobs';
import * as cnpjLookup from '../services/cnpjLookup';
import { createUser, createLead } from './helpers';

// Usar vi.mock com importActual para que os testes 1-4 e 6 usem a implementação
// real enquanto o teste 5 pode sobrescrever startBulkEnrichment pra simular falha.
// Isso contorna o problema de ESM binding: leadsImport.ts importa startBulkEnrichment
// via named import e o spy no namespace não intercepta — o vi.mock garante intercepção.
vi.mock('../services/enrichmentJobs', async (importActual) => {
  const real = await importActual<typeof import('../services/enrichmentJobs')>();
  return {
    ...real,
    startBulkEnrichment: vi.fn((...args: Parameters<typeof real.startBulkEnrichment>) =>
      real.startBulkEnrichment(...args),
    ),
    appendLeadsToActiveJob: vi.fn((...args: Parameters<typeof real.appendLeadsToActiveJob>) =>
      real.appendLeadsToActiveJob(...args),
    ),
  };
});

const VALID_CNPJ_1 = '11222333000181';
const VALID_CNPJ_2 = '11444777000161';
const VALID_CNPJ_3 = '00000000000191';
const VALID_CPF    = '11144477735';

describe('importLeadsFromCsv — auto-disparo de enriquecimento', () => {
  beforeEach(() => {
    // BrasilAPI mockado pra não rodar de verdade.
    vi.spyOn(cnpjLookup, 'lookupCnpj').mockImplementation(async (cnpj: string) => ({
      cnpj,
      status: 'active',
      razaoSocial: 'Test Co.',
      situacaoCadastral: 'ATIVA',
      telefone: null,
    }));

    // Restaura startBulkEnrichment e appendLeadsToActiveJob para passthrough real
    // a cada test — o teste 5 vai sobrescrever só pra si mesmo.
    vi.mocked(enrichmentJobsService.startBulkEnrichment).mockRestore
      ? vi.mocked(enrichmentJobsService.startBulkEnrichment).mockRestore()
      : null;
    vi.mocked(enrichmentJobsService.appendLeadsToActiveJob).mockRestore
      ? vi.mocked(enrichmentJobsService.appendLeadsToActiveJob).mockRestore()
      : null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('não dispara quando todos os leads têm phone (sem incompletos novos)', async () => {
    const user = await createUser({ email: 'noauto-allphone@x.com', role: 'admin' });
    const csv = `name,phone,cnpj\nA,11999990001,${VALID_CNPJ_1}\nB,11999990002,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(2);
    expect(report.enrichmentTriggered).toBeNull();

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(0);
  });

  it('cria novo job quando não há ativo e há incompletos novos', async () => {
    const user = await createUser({ email: 'noauto-newjob@x.com', role: 'admin' });
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\nB,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(2);
    expect(report.enrichmentTriggered).not.toBeNull();
    expect(report.enrichmentTriggered!.mode).toBe('started');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(2);
    expect(report.enrichmentTriggered!.estimatedMinutes).toBeGreaterThan(0);

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('running');
    expect(jobs[0].totalLeads).toBe(2);
  });

  it('anexa quando já existe job ativo', async () => {
    const user = await createUser({ email: 'noauto-append@x.com', role: 'admin' });
    // Pre-cria job com 1 lead em snapshot.
    await createLead({ phone: null, cnpj: VALID_CNPJ_3 });
    const job = await enrichmentJobsService.startBulkEnrichment(user.id);
    expect(job.totalLeads).toBe(1);

    // Importa 2 novos incompletos.
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\nB,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.enrichmentTriggered!.mode).toBe('appended');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(2);
    expect(report.enrichmentTriggered!.jobId).toBe(job.id);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(3);
  });

  it('CPFs incompletos não são anexados', async () => {
    const user = await createUser({ email: 'noauto-cpf@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_3 });
    const job = await enrichmentJobsService.startBulkEnrichment(user.id);

    const csv = `name,cnpj\nPessoa Fisica,${VALID_CPF}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered!.mode).toBe('appended');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(0);
    expect(report.enrichmentTriggered!.jobId).toBe(job.id);

    const [unchanged] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(unchanged.totalLeads).toBe(1);
  });

  it('falha do trigger NUNCA propaga — import retorna OK', async () => {
    const user = await createUser({ email: 'noauto-failsafe@x.com', role: 'admin' });
    // Mocka startBulkEnrichment pra throw — simula BrasilAPI off / erro de banco.
    vi.mocked(enrichmentJobsService.startBulkEnrichment).mockRejectedValueOnce(
      new Error('simulated outage'),
    );

    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    // Import sucesso, mas trigger null.
    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered).toBeNull();
    // Lead foi inserido mesmo assim.
    const inserted = await db.select().from(leads).where(eq(leads.cnpj, VALID_CNPJ_1));
    expect(inserted).toHaveLength(1);
  });

  it('sem userId no opts → não dispara (backwards-compat com testes antigos)', async () => {
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered).toBeFalsy(); // null ou undefined — tudo bem.

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(0);
  });
});
