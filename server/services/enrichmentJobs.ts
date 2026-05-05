import { db } from '../db/client';
import {
  enrichmentJobs,
  enrichmentJobLeads,
  leads,
  type EnrichmentJob,
} from '../db/schema';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicEnrichmentJob } from '@shared/types';
import { lookupCnpj } from './cnpjLookup';
import { updateLead } from './leadsService';
import { emitNotification } from './notifications';

// BrasilAPI free tier ~3 req/min → 21s entre chamadas (margem de segurança).
export const ENRICHMENT_TICK_MS = 21_000;

function normalizeBrasilApiPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
}

// ---------------------------------------------------------------------------
// CRUD (singleton)
// ---------------------------------------------------------------------------

async function loadActiveRow(): Promise<EnrichmentJob | null> {
  // "Active" inclui paused — partial unique index garante singleton aqui também.
  const [row] = await db
    .select()
    .from(enrichmentJobs)
    .where(inArray(enrichmentJobs.status, ['pending', 'running', 'paused']))
    .limit(1);
  return row ?? null;
}

async function loadLatestRow(): Promise<EnrichmentJob | null> {
  const [row] = await db
    .select()
    .from(enrichmentJobs)
    .orderBy(sql`${enrichmentJobs.createdAt} DESC`)
    .limit(1);
  return row ?? null;
}

async function buildPublic(row: EnrichmentJob): Promise<PublicEnrichmentJob> {
  const pending = row.totalLeads - row.processedCount;
  const pct = row.totalLeads === 0 ? 100 : Math.round((row.processedCount / row.totalLeads) * 1000) / 10;
  // Estimate: pending * 21s / 60 = minutos restantes (só faz sentido enquanto running OU paused).
  // Quando paused, mostra o tempo que VAI levar quando retomar.
  const remainingMinutes =
    (row.status === 'running' || row.status === 'paused') && pending > 0
      ? Math.ceil((pending * ENRICHMENT_TICK_MS) / 60_000)
      : null;
  return {
    id: row.id,
    status: row.status as PublicEnrichmentJob['status'],
    totalLeads: row.totalLeads,
    processedCount: row.processedCount,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    pendingCount: pending,
    pctComplete: pct,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    lastError: row.lastError,
    estimatedRemainingMinutes: remainingMinutes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Retorna o job ativo (pending/running) se houver. Caso contrário, retorna o
 * mais recente (completed/cancelled) pra UI mostrar histórico do último.
 */
export async function getCurrentJob(): Promise<PublicEnrichmentJob | null> {
  const active = await loadActiveRow();
  if (active) return buildPublic(active);
  const latest = await loadLatestRow();
  return latest ? buildPublic(latest) : null;
}

/**
 * Cria novo job em status='running'. Snapshot dos leads com flow_stage='incomplete'
 * E cnpj presente (sem cnpj não há o que consultar). Throws 409 se já existir
 * job ativo. Throws 400 se não há leads pra enriquecer.
 */
export async function startBulkEnrichment(userId: string): Promise<PublicEnrichmentJob> {
  const active = await loadActiveRow();
  if (active) {
    throw new HttpError(409, 'Já existe um job de enriquecimento em andamento');
  }

  const candidates = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.flowStage, 'incomplete'), sql`${leads.cnpj} IS NOT NULL`));

  if (candidates.length === 0) {
    throw new HttpError(400, 'Nenhum lead incompleto com CNPJ pra enriquecer');
  }

  const now = new Date();
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      status: 'running',
      totalLeads: candidates.length,
      startedAt: now,
      createdByUserId: userId,
    })
    .returning();

  // Insere snapshot em chunks pra evitar SQL gigante (Postgres aceita ~32k params).
  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    await db.insert(enrichmentJobLeads).values(
      slice.map((c) => ({ jobId: job.id, leadId: c.id })),
    );
  }

  return buildPublic(job);
}

export async function cancelCurrentJob(): Promise<PublicEnrichmentJob | null> {
  const active = await loadActiveRow();
  if (!active) return null;
  const [updated] = await db
    .update(enrichmentJobs)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(enrichmentJobs.id, active.id))
    .returning();
  return buildPublic(updated);
}

export async function pauseCurrentJob(): Promise<PublicEnrichmentJob | null> {
  const active = await loadActiveRow();
  if (!active) return null;
  if (active.status !== 'running') {
    throw new HttpError(400, `Job está em status '${active.status}' — não pode ser pausado`);
  }
  const [updated] = await db
    .update(enrichmentJobs)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(enrichmentJobs.id, active.id))
    .returning();
  return buildPublic(updated);
}

export async function resumeCurrentJob(): Promise<PublicEnrichmentJob | null> {
  const active = await loadActiveRow();
  if (!active) return null;
  if (active.status !== 'paused') {
    throw new HttpError(400, `Job está em status '${active.status}' — não pode ser retomado`);
  }
  const [updated] = await db
    .update(enrichmentJobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(enrichmentJobs.id, active.id))
    .returning();
  return buildPublic(updated);
}

// ---------------------------------------------------------------------------
// Worker tick — processa o próximo lead pendente do job running
// ---------------------------------------------------------------------------

export interface TickResult {
  status: 'no_job' | 'job_completed' | 'processed' | 'job_paused';
  jobId?: string;
  leadId?: string;
  resultStatus?: string;
}

/**
 * Pega 1 lead pendente do job running atual, consulta BrasilAPI, atualiza.
 * Marca o job como completed quando processar todos os leads.
 *
 * Idempotente — se chamado sem job ativo, retorna no_job. Se job foi cancelado
 * entre ticks, para de processar.
 */
export async function processNextEnrichment(): Promise<TickResult> {
  const job = await loadActiveRow();
  if (!job || job.status !== 'running') return { status: 'no_job' };

  const [next] = await db
    .select()
    .from(enrichmentJobLeads)
    .where(and(eq(enrichmentJobLeads.jobId, job.id), eq(enrichmentJobLeads.status, 'pending')))
    .limit(1);

  if (!next) {
    // Tudo processado → completed
    const [done] = await db.update(enrichmentJobs)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(enrichmentJobs.id, job.id))
      .returning();
    // Notifica o admin que iniciou o job.
    if (done) {
      await emitNotification({
        userIds: [done.createdByUserId],
        kind: 'enrichment_completed',
        title: 'Enriquecimento concluído',
        body: `${done.succeededCount} telefone${done.succeededCount === 1 ? '' : 's'} encontrado${done.succeededCount === 1 ? '' : 's'} de ${done.totalLeads} leads.`,
        actionUrl: '/cadastros',
        metadata: { jobId: done.id, totalLeads: done.totalLeads, succeeded: done.succeededCount, failed: done.failedCount },
      });
    }
    return { status: 'job_completed', jobId: job.id };
  }

  // Carrega o lead — pode ter sido editado/excluído entre snapshot e processamento.
  const [lead] = await db.select().from(leads).where(eq(leads.id, next.leadId)).limit(1);

  let resultStatus = 'api_error';
  let phoneFound: string | null = null;
  let errorMessage: string | null = null;
  let succeeded = false;

  if (!lead) {
    resultStatus = 'lead_deleted';
    errorMessage = 'Lead removido depois do snapshot';
  } else if (lead.phone) {
    // Já tem phone — alguém preencheu manualmente entre snapshot e agora.
    resultStatus = 'already_has_phone';
  } else if (!lead.cnpj) {
    resultStatus = 'no_cnpj';
  } else {
    try {
      const r = await lookupCnpj(lead.cnpj);
      if (r.status === 'active' && r.telefone) {
        const normalized = normalizeBrasilApiPhone(r.telefone);
        if (normalized) {
          await updateLead({ id: lead.id, phone: normalized });
          phoneFound = normalized;
          resultStatus = 'phone_found';
          succeeded = true;
        } else {
          resultStatus = 'phone_not_in_brasilapi';
        }
      } else if (r.status === 'active') {
        resultStatus = 'phone_not_in_brasilapi';
      } else if (r.status === 'inactive') {
        resultStatus = 'cnpj_inactive';
        errorMessage = r.situacaoCadastral ?? null;
      } else if (r.status === 'not_found') {
        resultStatus = 'cnpj_not_found';
      } else {
        resultStatus = 'api_error';
        errorMessage = r.errorMessage ?? null;
      }
    } catch (err) {
      resultStatus = 'api_error';
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // Marca o lead-row + atualiza counters do job.
  await db.transaction(async (tx) => {
    await tx
      .update(enrichmentJobLeads)
      .set({
        status: succeeded ? 'succeeded' : 'failed',
        resultStatus,
        phoneFound,
        errorMessage,
        processedAt: new Date(),
      })
      .where(and(eq(enrichmentJobLeads.jobId, job.id), eq(enrichmentJobLeads.leadId, next.leadId)));

    await tx
      .update(enrichmentJobs)
      .set({
        processedCount: sql`${enrichmentJobs.processedCount} + 1`,
        succeededCount: succeeded
          ? sql`${enrichmentJobs.succeededCount} + 1`
          : enrichmentJobs.succeededCount,
        failedCount: succeeded
          ? enrichmentJobs.failedCount
          : sql`${enrichmentJobs.failedCount} + 1`,
        lastError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(enrichmentJobs.id, job.id));
  });

  return { status: 'processed', jobId: job.id, leadId: next.leadId, resultStatus };
}

void isNull; // silencia linter caso nunca usemos abaixo