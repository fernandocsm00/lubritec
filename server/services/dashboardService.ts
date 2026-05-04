import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { deals, dealActivities, leads, conversations, messages, users } from '../db/schema';
import { getOrgSettings } from './orgSettingsService';
import { resolvePeriod, type PeriodKey } from '../lib/period';
import type {
  DashboardSummary,
  DashboardView,
} from '../../shared/types';

interface SummaryArgs {
  view: DashboardView;
  period: PeriodKey;
  userId?: string;     // required when view='me'
  now?: Date;          // override for tests
}

function pctChange(value: number, prev: number): number {
  if (prev === 0) return value === 0 ? 0 : 100;
  return Math.round(((value - prev) / prev) * 100);
}

function ppDiff(value: number, prev: number): number {
  // For win rate, deltaPct is interpreted as percentage-point change (rounded).
  return Math.round(value - prev);
}

async function salesKpi(start: Date, end: Date, ownerUserId: string | null) {
  const where = ownerUserId
    ? and(eq(deals.stage, 'ganho'), gte(deals.closedAt!, start), lt(deals.closedAt!, end), eq(deals.ownerUserId, ownerUserId))
    : and(eq(deals.stage, 'ganho'), gte(deals.closedAt!, start), lt(deals.closedAt!, end));
  const [row] = await db
    .select({
      sum: sql<string>`coalesce(sum(${deals.proposalValue}), 0)`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(deals)
    .where(where);
  return { value: Number(row.sum), count: row.cnt };
}

async function lostCount(start: Date, end: Date, ownerUserId: string | null) {
  const where = ownerUserId
    ? and(eq(deals.stage, 'perdido'), gte(deals.closedAt!, start), lt(deals.closedAt!, end), eq(deals.ownerUserId, ownerUserId))
    : and(eq(deals.stage, 'perdido'), gte(deals.closedAt!, start), lt(deals.closedAt!, end));
  const [row] = await db.select({ cnt: sql<number>`count(*)::int` }).from(deals).where(where);
  return row.cnt;
}

async function proposalsCount(start: Date, end: Date, actorUserId: string | null) {
  const where = actorUserId
    ? and(eq(dealActivities.kind, 'created'), gte(dealActivities.createdAt, start), lt(dealActivities.createdAt, end), eq(dealActivities.actorUserId, actorUserId))
    : and(eq(dealActivities.kind, 'created'), gte(dealActivities.createdAt, start), lt(dealActivities.createdAt, end));
  const [row] = await db.select({ cnt: sql<number>`count(*)::int` }).from(dealActivities).where(where);
  return row.cnt;
}

async function funnelOrg(start: Date, end: Date) {
  const [newLeadsRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(gte(leads.createdAt, start), lt(leads.createdAt, end)));

  const [withConvRow] = await db
    .select({ cnt: sql<number>`count(distinct ${conversations.leadId})::int` })
    .from(conversations)
    .where(and(gte(conversations.createdAt, start), lt(conversations.createdAt, end)));

  const [withPropRow] = await db
    .select({ cnt: sql<number>`count(distinct ${deals.leadId})::int` })
    .from(deals)
    .where(and(gte(deals.createdAt, start), lt(deals.createdAt, end)));

  const [wonRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.stage, 'ganho'), gte(deals.closedAt!, start), lt(deals.closedAt!, end)));

  const newLeads = newLeadsRow.cnt;
  const withConversation = withConvRow.cnt;
  const withProposal = withPropRow.cnt;
  const won = wonRow.cnt;

  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
  return {
    kind: 'org' as const,
    newLeads, withConversation, withProposal, won,
    convLeadToConv: pct(withConversation, newLeads),
    convConvToProposal: pct(withProposal, withConversation),
    convProposalToWon: pct(won, withProposal),
  };
}

async function funnelMe(start: Date, end: Date, userId: string) {
  const [respRow] = await db
    .select({ cnt: sql<number>`count(distinct ${messages.conversationId})::int` })
    .from(messages)
    .where(and(eq(messages.sentByUserId, userId), gte(messages.sentAt, start), lt(messages.sentAt, end)));

  const [propRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.ownerUserId, userId), gte(deals.createdAt, start), lt(deals.createdAt, end)));

  const [wonRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.ownerUserId, userId), eq(deals.stage, 'ganho'), gte(deals.closedAt!, start), lt(deals.closedAt!, end)));

  const respondedConversations = respRow.cnt;
  const myProposals = propRow.cnt;
  const myWon = wonRow.cnt;
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
  return {
    kind: 'me' as const,
    respondedConversations, myProposals, myWon,
    convRespToProposal: pct(myProposals, respondedConversations),
    convProposalToWon: pct(myWon, myProposals),
  };
}

async function recentActivitiesMe(userId: string) {
  const rows = await db
    .select({
      id: dealActivities.id,
      kind: dealActivities.kind,
      dealId: dealActivities.dealId,
      leadName: leads.name,
      createdAt: dealActivities.createdAt,
    })
    .from(dealActivities)
    .innerJoin(deals, eq(deals.id, dealActivities.dealId))
    .innerJoin(leads, eq(leads.id, deals.leadId))
    .where(eq(dealActivities.actorUserId, userId))
    .orderBy(sql`${dealActivities.createdAt} DESC`)
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    dealId: r.dealId,
    leadName: r.leadName,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function pipelineOpenFn(ownerUserId: string | null) {
  const where = ownerUserId
    ? and(sql`${deals.stage} IN ('proposta_enviada', 'em_negociacao')`, eq(deals.ownerUserId, ownerUserId))
    : sql`${deals.stage} IN ('proposta_enviada', 'em_negociacao')`;
  const rows = await db
    .select({
      stage: deals.stage,
      cnt: sql<number>`count(*)::int`,
      sum: sql<string>`coalesce(sum(${deals.proposalValue}), 0)`,
      avgAge: sql<string>`coalesce(avg(extract(epoch from (now() - ${deals.createdAt})) / 86400), 0)`,
    })
    .from(deals)
    .where(where)
    .groupBy(deals.stage);

  const byStage = rows.map((r) => ({
    stage: r.stage as 'proposta_enviada' | 'em_negociacao',
    count: r.cnt,
    valueSum: Number(r.sum),
  }));
  const totalValue = byStage.reduce((acc, r) => acc + r.valueSum, 0);

  // Weighted avg age across all rows
  const totalCount = byStage.reduce((acc, r) => acc + r.count, 0);
  const weightedAge = rows.reduce((acc, r) => acc + Number(r.avgAge) * r.cnt, 0);
  const avgAgeDays = totalCount === 0 ? 0 : Math.round((weightedAge / totalCount) * 10) / 10;

  return { byStage, totalValue, avgAgeDays };
}

async function leaderboardFn(start: Date, end: Date) {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      wonValue: sql<string>`coalesce(sum(${deals.proposalValue}), 0)`,
      wonCount: sql<number>`count(*)::int`,
    })
    .from(deals)
    .innerJoin(users, eq(users.id, deals.ownerUserId))
    .where(and(eq(deals.stage, 'ganho'), gte(deals.closedAt!, start), lt(deals.closedAt!, end)))
    .groupBy(users.id, users.name)
    .orderBy(sql`coalesce(sum(${deals.proposalValue}), 0) DESC`)
    .limit(5);

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    wonValue: Number(r.wonValue),
    wonCount: r.wonCount,
  }));
}

async function goalFn(view: 'org' | 'me', periodKey: PeriodKey, currentMonthSales: number) {
  if (view !== 'org' || periodKey !== 'month') return null;
  const s = await getOrgSettings();
  if (s.monthlySalesGoal == null || s.monthlySalesGoal === 0) return null;
  const percent = Math.min(200, Math.round((currentMonthSales / s.monthlySalesGoal) * 100));
  return { monthlyTarget: s.monthlySalesGoal, currentMonthSales, percent };
}

export async function summary(args: SummaryArgs): Promise<DashboardSummary> {
  const period = resolvePeriod(args.period, args.now);
  const owner = args.view === 'me' ? args.userId! : null;

  // KPIs (current + previous in parallel)
  const [salesCur, salesPrev, lostCur, lostPrev, propsCur, propsPrev] = await Promise.all([
    salesKpi(period.start, period.end, owner),
    salesKpi(period.prevStart, period.prevEnd, owner),
    lostCount(period.start, period.end, owner),
    lostCount(period.prevStart, period.prevEnd, owner),
    proposalsCount(period.start, period.end, owner),
    proposalsCount(period.prevStart, period.prevEnd, owner),
  ]);

  const winRateCur  = salesCur.count + lostCur === 0 ? 0 : Math.round((salesCur.count / (salesCur.count + lostCur)) * 100);
  const winRatePrev = salesPrev.count + lostPrev === 0 ? 0 : Math.round((salesPrev.count / (salesPrev.count + lostPrev)) * 100);

  const avgTicketCur  = salesCur.count === 0 ? 0 : Math.round(salesCur.value / salesCur.count);
  const avgTicketPrev = salesPrev.count === 0 ? 0 : Math.round(salesPrev.value / salesPrev.count);

  return {
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      prevStart: period.prevStart.toISOString(),
      prevEnd: period.prevEnd.toISOString(),
      label: period.label,
    },
    kpis: {
      sales:     { value: salesCur.value, prev: salesPrev.value, deltaPct: pctChange(salesCur.value, salesPrev.value), count: salesCur.count, prevCount: salesPrev.count },
      proposals: { value: propsCur,        prev: propsPrev,        deltaPct: pctChange(propsCur, propsPrev) },
      winRate:   { value: winRateCur,      prev: winRatePrev,      deltaPct: ppDiff(winRateCur, winRatePrev) },
      avgTicket: { value: avgTicketCur,    prev: avgTicketPrev,    deltaPct: pctChange(avgTicketCur, avgTicketPrev) },
    },
    goal: await goalFn(args.view, args.period, salesCur.value),
    funnel: args.view === 'org'
      ? await funnelOrg(period.start, period.end)
      : await funnelMe(period.start, period.end, args.userId!),
    pipelineOpen: await pipelineOpenFn(owner),
    leaderboard: args.view === 'org' ? await leaderboardFn(period.start, period.end) : null,
    recentActivities: args.view === 'me' ? await recentActivitiesMe(args.userId!) : null,
  };
}
