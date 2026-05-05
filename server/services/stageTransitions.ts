import { db } from '../db/client';
import { leadStageTransitions } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import type {
  LeadFlowStage,
  TransitionSource,
  PublicLeadStageTransition,
} from '@shared/types';

/**
 * Registra uma transição de flow_stage. Best-effort — erros são logados e
 * SUPRIMIDOS pra não derrubar a operação que disparou a transição (insert
 * de lead, update, webhook ingest, etc).
 *
 * Append-only — nunca atualiza linhas existentes.
 */
export async function recordTransition(opts: {
  leadId: string;
  fromStage: LeadFlowStage | null;
  toStage: LeadFlowStage;
  source: TransitionSource;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(leadStageTransitions).values({
      leadId: opts.leadId,
      fromStage: opts.fromStage,
      toStage: opts.toStage,
      source: opts.source,
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    console.warn('[stage-transitions] recordTransition failed:', {
      leadId: opts.leadId,
      from: opts.fromStage,
      to: opts.toStage,
      source: opts.source,
      err: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Lista o histórico de transições de um lead (mais recente primeiro).
 */
export async function listLeadTransitions(leadId: string): Promise<PublicLeadStageTransition[]> {
  const rows = await db
    .select()
    .from(leadStageTransitions)
    .where(eq(leadStageTransitions.leadId, leadId))
    .orderBy(desc(leadStageTransitions.changedAt));

  return rows.map((r) => ({
    id: r.id,
    fromStage: (r.fromStage ?? null) as LeadFlowStage | null,
    toStage: r.toStage as LeadFlowStage,
    source: r.source as TransitionSource,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
    changedAt: r.changedAt.toISOString(),
  }));
}
