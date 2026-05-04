import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { deals, dealActivities } from '../db/schema';
// reserved for Task 6/7:
// import { leads, conversations, messages, users } from '../db/schema';
// import { getOrgSettings } from './orgSettingsService';
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
    // PLACEHOLDERS — Tasks 6/7 will replace these with real implementations
    goal: null,       // Task 6 will add goal computation from orgSettings
    funnel: { kind: 'org', newLeads: 0, withConversation: 0, withProposal: 0, won: salesCur.count, convLeadToConv: 0, convConvToProposal: 0, convProposalToWon: 0 },
    pipelineOpen: { byStage: [], totalValue: 0, avgAgeDays: 0 },
    leaderboard: args.view === 'org' ? [] : null,   // Task 7 will populate
    recentActivities: args.view === 'me' ? [] : null, // Task 7 will populate
  };
}
