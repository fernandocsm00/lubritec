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
      vehicleModel: lead.vehicleModel,
      vehiclePlate: lead.vehiclePlate,
      status: lead.status,
    },
    stage: row.deal.stage,
    proposalValue: row.deal.proposalValue == null ? null : Number(row.deal.proposalValue),
    lossReason: row.deal.lossReason,
    notes: row.deal.notes,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    closedAt: row.deal.closedAt?.toISOString() ?? null,
    isStale: row.isStale,
    enteredCurrentStageAt: row.enteredCurrentStageAt.toISOString(),
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
  ${deals.stage} IN ('proposta_enviada', 'em_negociacao')
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
  ownerFilter: 'mine' | 'all';
  q?: string;
  currentUserId: string;
}): Promise<BoardResponse> {
  const conds: SQL[] = [];

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  }

  // Show: active stages OR (terminal AND closed_at within last 7 days)
  conds.push(
    sql`(
      ${deals.stage} IN ('proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      )
    )`,
  );

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.vehiclePlate, pat));
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
    proposta_enviada: [],
    em_negociacao: [],
    ganho: [],
    perdido: [],
  };
  const totals: BoardResponse['totals'] = {
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
  ownerFilter: 'mine' | 'all';
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
  }
  if (input.stage) conds.push(eq(deals.stage, input.stage));
  if (input.lossReason) conds.push(eq(deals.lossReason, input.lossReason));
  if (input.from) conds.push(gte(deals.closedAt, input.from));
  if (input.to) conds.push(lte(deals.closedAt, input.to));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.vehiclePlate, pat));
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
