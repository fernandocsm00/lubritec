import { db } from '../db/client';
import { deals, dealActivities, leads, users } from '../db/schema';
import {
  eq, and, or, ilike, desc, sql, inArray, gte, lte,
  type SQL,
} from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicDeal,
  PublicDealActivity,
  BoardResponse,
  DealStage,
  DealStageTotal,
  LossReason,
  LeadQualityFeedback,
  PublicLead,
} from '@shared/types';
import { DEAL_STAGES } from '@shared/types';

const HISTORY_PAGE_SIZE = 50;
const STALE_DAYS = 3;
const KANBAN_TERMINAL_VISIBLE_DAYS = 7;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

interface RawDealRow {
  deal: typeof deals.$inferSelect;
  lead: typeof leads.$inferSelect | null;
  owner: typeof users.$inferSelect | null;
  enteredCurrentStageAt: Date;
  isStale: boolean;
}

function toPublic(row: RawDealRow): PublicDeal {
  const lead = row.lead!;
  return {
    id: row.deal.id,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      cnpj: lead.cnpj,
      status: lead.status,
    },
    stage: row.deal.stage,
    proposalValue: row.deal.proposalValue == null ? null : Number(row.deal.proposalValue),
    lossReason: row.deal.lossReason,
    notes: row.deal.notes,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    closedAt: row.deal.closedAt?.toISOString() ?? null,
    leadQualityFeedback: row.deal.leadQualityFeedback ?? null,
    leadQualityFeedbackAt: row.deal.leadQualityFeedbackAt?.toISOString() ?? null,
    isStale: Boolean(row.isStale),
    enteredCurrentStageAt: new Date(row.enteredCurrentStageAt).toISOString(),
    createdAt: row.deal.createdAt.toISOString(),
    updatedAt: row.deal.updatedAt.toISOString(),
  };
}

// SQL fragment that resolves to the timestamp the deal entered its current
// stage. Falls back to created_at if no stage_changed/reactivated activity.
const enteredStageSql = sql<Date>`COALESCE(
  (
    SELECT MAX(da.created_at) FROM deal_activities da
    WHERE da.deal_id = ${deals.id}
      AND da.kind IN ('stage_changed', 'reactivated', 'created')
  ),
  ${deals.createdAt}
)`;

// SQL fragment computing isStale: true if no non-note activity in current
// stage for > STALE_DAYS days (and stage is active).
const isStaleSql = sql<boolean>`(
  ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
  AND COALESCE(
    (
      SELECT MAX(da.created_at) FROM deal_activities da
      WHERE da.deal_id = ${deals.id}
        AND da.kind != 'note_added'
        AND da.created_at >= COALESCE(
          (
            SELECT MAX(da2.created_at) FROM deal_activities da2
            WHERE da2.deal_id = ${deals.id}
              AND da2.kind IN ('stage_changed', 'reactivated', 'created')
          ),
          ${deals.createdAt}
        )
    ),
    ${deals.createdAt}
  ) < now() - interval '${sql.raw(String(STALE_DAYS))} days'
)`;

// ---------------------------------------------------------------------------
// listBoard — kanban
// ---------------------------------------------------------------------------

export async function listBoard(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string;
  q?: string;
  currentUserId: string;
}): Promise<BoardResponse> {
  const conds: SQL[] = [];

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  } else if (input.ownerFilter === 'unassigned') {
    conds.push(sql`${deals.ownerUserId} IS NULL`);
  } else if (input.ownerFilter !== 'all') {
    conds.push(eq(deals.ownerUserId, input.ownerFilter));
  }

  // Show: active stages OR (terminal AND closed_at within last 7 days)
  conds.push(
    sql`(
      ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      )
    )`,
  );

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.cnpj, pat));
    if (search) conds.push(search);
  }

  const where = and(...conds);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.updatedAt));

  const stages: BoardResponse['stages'] = {
    lead_no_comercial: [],
    proposta_enviada: [],
    em_negociacao: [],
    ganho: [],
    perdido: [],
  };
  const totals: BoardResponse['totals'] = {
    lead_no_comercial: { count: 0, valueSum: 0 },
    proposta_enviada: { count: 0, valueSum: 0 },
    em_negociacao: { count: 0, valueSum: 0 },
    ganho: { count: 0, valueSum: 0 },
    perdido: { count: 0, valueSum: 0 },
  };

  for (const row of rows) {
    const pub = toPublic(row);
    stages[pub.stage].push(pub);
    totals[pub.stage].count += 1;
    totals[pub.stage].valueSum += pub.proposalValue ?? 0;
  }

  return { stages, totals };
}

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

export async function listHistory(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string;
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: Date;
  to?: Date;
  page?: number;
  currentUserId: string;
}): Promise<{ items: PublicDeal[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];

  conds.push(
    sql`${deals.stage} IN ('ganho', 'perdido') AND ${deals.closedAt} <= now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'`,
  );

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  } else if (input.ownerFilter === 'unassigned') {
    conds.push(sql`${deals.ownerUserId} IS NULL`);
  } else if (input.ownerFilter !== 'all') {
    conds.push(eq(deals.ownerUserId, input.ownerFilter));
  }
  if (input.stage) conds.push(eq(deals.stage, input.stage));
  if (input.lossReason) conds.push(eq(deals.lossReason, input.lossReason));
  if (input.from) conds.push(gte(deals.closedAt, input.from));
  if (input.to) conds.push(lte(deals.closedAt, input.to));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.cnpj, pat));
    if (search) conds.push(search);
  }

  const where = and(...conds);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .where(where);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.closedAt))
    .limit(HISTORY_PAGE_SIZE)
    .offset((page - 1) * HISTORY_PAGE_SIZE);

  return {
    items: rows.map(toPublic),
    total,
    page,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// getDealById
// ---------------------------------------------------------------------------

export async function getDealById(id: string): Promise<PublicDeal & { activities: PublicDealActivity[] }> {
  const [row] = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(eq(deals.id, id))
    .limit(1);

  if (!row) throw new HttpError(404, 'Deal not found');

  const acts = await db
    .select({ activity: dealActivities, actor: users })
    .from(dealActivities)
    .leftJoin(users, eq(dealActivities.actorUserId, users.id))
    .where(eq(dealActivities.dealId, id))
    .orderBy(desc(dealActivities.createdAt));

  const activities: PublicDealActivity[] = acts.map((a) => ({
    id: a.activity.id,
    dealId: a.activity.dealId,
    kind: a.activity.kind,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    metadata: (a.activity.metadata as Record<string, unknown>) ?? {},
    createdAt: a.activity.createdAt.toISOString(),
  }));

  return { ...toPublic(row), activities };
}

// ---------------------------------------------------------------------------
// Mutations (todas registram activity no log)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logActivity(tx: any, opts: {
  dealId: string;
  kind: import('@shared/types').DealActivityKind;
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
}) {
  await tx.insert(dealActivities).values({
    dealId: opts.dealId,
    kind: opts.kind,
    actorUserId: opts.actorUserId,
    metadata: opts.metadata ?? {},
  });
}

export async function createDeal(input: {
  leadId: string;
  proposalValue?: number | null;
  ownerUserId: string | null;       // aceita null (Pull model)
  source: 'manual' | 'auto_image' | 'ai_qualified';
}): Promise<PublicDeal> {
  // Idempotente: se já existe deal pra esse lead, retorna o existing.
  const [existing] = await db.select().from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
  if (existing) {
    return getDealById(existing.id);
  }

  // Captura stage anterior do lead pra audit trail.
  const [leadBefore] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);

  const dealId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(deals)
      .values({
        leadId: input.leadId,
        stage: 'lead_no_comercial',
        proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
        ownerUserId: input.ownerUserId,       // pode ser null agora
      })
      .returning({ id: deals.id });
    await logActivity(tx, {
      dealId: created.id,
      kind: 'created',
      // Sem actor humano quando source e automatizada (ai_qualified, auto_image)
      actorUserId: input.source === 'manual' ? input.ownerUserId : null,
      metadata: { source: input.source },
    });
    // Promove lead pra handed_off quando deal é criado (não regride 'lost').
    await tx
      .update(leads)
      .set({ flowStage: 'handed_off', updatedAt: new Date() })
      .where(and(eq(leads.id, input.leadId), sql`${leads.flowStage} <> 'lost'`));
    return created.id;
  });

  // Audit trail fora do tx.
  if (leadBefore && leadBefore.flowStage !== 'handed_off' && leadBefore.flowStage !== 'lost') {
    const { recordTransition } = await import('./stageTransitions');
    await recordTransition({
      leadId: input.leadId,
      fromStage: leadBefore.flowStage as PublicLead['flowStage'],
      toStage: 'handed_off',
      source: 'deal_created',
      metadata: { dealId, source: input.source, ownerUserId: input.ownerUserId },
    });
  }

  return getDealById(dealId);
}

export async function updateDeal(input: {
  id: string;
  actorUserId: string;
  proposalValue?: number | null;
  notes?: string | null;
  ownerUserId?: string | null;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (input.proposalValue !== undefined) {
      const newVal = input.proposalValue == null ? null : String(input.proposalValue);
      const oldVal = current.proposalValue;
      if (newVal !== oldVal) {
        patch.proposalValue = newVal;
        await logActivity(tx, {
          dealId: input.id,
          kind: 'value_changed',
          actorUserId: input.actorUserId,
          metadata: {
            from: oldVal == null ? null : Number(oldVal),
            to: newVal == null ? null : Number(newVal),
          },
        });
      }
    }

    if (input.notes !== undefined && input.notes !== current.notes) {
      patch.notes = input.notes;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'note_added',
        actorUserId: input.actorUserId,
        metadata: { note: input.notes ?? '' },
      });
    }

    if (input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId) {
      patch.ownerUserId = input.ownerUserId;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'owner_changed',
        actorUserId: input.actorUserId,
        metadata: {
          fromUserId: current.ownerUserId,
          toUserId: input.ownerUserId,
        },
      });
    }

    if (Object.keys(patch).length > 1) {
      await tx.update(deals).set(patch).where(eq(deals.id, input.id));
    }
  });

  return getDealById(input.id);
}

export async function changeStage(input: {
  id: string;
  actorUserId: string;
  stage: DealStage;
  lossReason?: LossReason;
  leadQualityFeedback?: LeadQualityFeedback;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  if (input.stage === 'perdido' && !input.lossReason) {
    throw new HttpError(400, 'lossReason is required when moving to perdido');
  }
  if (input.stage === 'ganho' && current.proposalValue == null) {
    throw new HttpError(400, 'proposalValue is required before marking as ganho');
  }
  // NOVO: feedback obrigatório ao mover pra ganho/perdido
  if ((input.stage === 'ganho' || input.stage === 'perdido') && !input.leadQualityFeedback) {
    throw new HttpError(400, 'leadQualityFeedback is required when moving to ganho/perdido');
  }
  if (input.stage === current.stage) {
    return getDealById(input.id);
  }

  const isTerminalNow = current.stage === 'ganho' || current.stage === 'perdido';
  const movingToActive =
    input.stage === 'lead_no_comercial' ||
    input.stage === 'proposta_enviada' ||
    input.stage === 'em_negociacao';
  const reactivating = isTerminalNow && movingToActive;

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {
      stage: input.stage,
      updatedAt: new Date(),
    };
    // closed_at: set when entering terminal, clear when leaving terminal
    if (input.stage === 'ganho' || input.stage === 'perdido') {
      patch.closedAt = new Date();
    } else {
      patch.closedAt = null;
    }
    // loss_reason: set when going to perdido, clear otherwise
    patch.lossReason = input.stage === 'perdido' ? input.lossReason : null;

    // NOVO: gravar feedback
    if (input.leadQualityFeedback) {
      patch.leadQualityFeedback = input.leadQualityFeedback;
      patch.leadQualityFeedbackAt = new Date();
      patch.leadQualityFeedbackBy = input.actorUserId;
    }

    await tx.update(deals).set(patch).where(eq(deals.id, input.id));

    if (reactivating) {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'reactivated',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    } else {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'stage_changed',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    }

    if (input.stage === 'ganho') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'won',
        actorUserId: input.actorUserId,
        metadata: { value: Number(current.proposalValue) },
      });
    }
    if (input.stage === 'perdido') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'lost',
        actorUserId: input.actorUserId,
        metadata: { reason: input.lossReason },
      });
    }

    // NOVO: activity de quality_feedback
    if (input.leadQualityFeedback) {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'quality_feedback',
        actorUserId: input.actorUserId,
        metadata: { feedback: input.leadQualityFeedback },
      });
    }
  });

  return getDealById(input.id);
}

export async function deleteDeal(id: string): Promise<void> {
  const [row] = await db.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
  if (!row) throw new HttpError(404, 'Deal not found');
}

export async function reactivateDeal(input: {
  dealId: string;
  actorUserId: string;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.dealId)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');
  if (current.stage !== 'ganho' && current.stage !== 'perdido') {
    return getDealById(input.dealId);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({
        stage: 'proposta_enviada',
        closedAt: null,
        lossReason: null,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, input.dealId));
    await logActivity(tx, {
      dealId: input.dealId,
      kind: 'reactivated',
      actorUserId: input.actorUserId,
      metadata: { from: current.stage, to: 'proposta_enviada' },
    });
  });

  return getDealById(input.dealId);
}
