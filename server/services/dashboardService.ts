import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { deals, dealActivities, leads, conversations, messages, users, whatsappInstance, campaignRecipients } from '../db/schema';
import { getOrgSettings } from './orgSettingsService';
import { resolvePeriod, type PeriodKey } from '../lib/period';
import type {
  DashboardSummary,
  DashboardView,
  DashboardAttentionItem,
  DashboardAttentionResponse,
  DashboardWhatsappStats,
} from '../../shared/types';

/**
 * Recortes opcionais por atributos do lead. Quando nenhum vem preenchido,
 * o dashboard agrega normalmente (mesmo comportamento de sempre).
 * Filtra apenas KPIs/funil relacionados a leads — métricas de WhatsApp,
 * IA e atividades recentes seguem agregadas (são da operação inteira).
 */
export interface DashboardLeadFilters {
  imbp?: string;
  segment?: string;
  city?: string;
}

function hasAnyLeadFilter(f?: DashboardLeadFilters): boolean {
  return !!(f && (f.imbp || f.segment || f.city));
}

/** WHERE adicional p/ subquery EXISTS contra leads.id. */
function leadFilterExists(alias: string, f?: DashboardLeadFilters) {
  if (!hasAnyLeadFilter(f)) return sql``;
  const conds = [] as ReturnType<typeof sql>[];
  if (f!.imbp) conds.push(sql`l.imbp = ${f!.imbp}`);
  if (f!.segment) conds.push(sql`l.segment = ${f!.segment}`);
  if (f!.city) conds.push(sql`lower(l.city) = lower(${f!.city})`);
  return sql` AND EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = ${sql.raw(alias)}.lead_id
      AND ${sql.join(conds, sql` AND `)}
  )`;
}

/** Filtros aplicados diretamente na tabela leads (sem subquery). */
function leadFilterDirect(f?: DashboardLeadFilters) {
  if (!hasAnyLeadFilter(f)) return sql``;
  const conds = [] as ReturnType<typeof sql>[];
  if (f!.imbp) conds.push(sql`${leads.imbp} = ${f!.imbp}`);
  if (f!.segment) conds.push(sql`${leads.segment} = ${f!.segment}`);
  if (f!.city) conds.push(sql`lower(${leads.city}) = lower(${f!.city})`);
  return sql` AND ${sql.join(conds, sql` AND `)}`;
}

interface SummaryArgs {
  view: DashboardView;
  period: PeriodKey;
  userId?: string;     // required when view='me'
  now?: Date;          // override for tests
  leadFilters?: DashboardLeadFilters;
}

function pctChange(value: number, prev: number): number {
  if (prev === 0) return value === 0 ? 0 : 100;
  return Math.round(((value - prev) / prev) * 100);
}

function ppDiff(value: number, prev: number): number {
  // For win rate, deltaPct is interpreted as percentage-point change (rounded).
  return Math.round(value - prev);
}

async function salesKpi(start: Date, end: Date, ownerUserId: string | null, leadFilters?: DashboardLeadFilters) {
  const filter = leadFilterExists('deals', leadFilters);
  const ownerSql = ownerUserId ? sql`AND ${deals.ownerUserId} = ${ownerUserId}` : sql``;
  const [row] = await db.execute<{ sum: string; cnt: number }>(sql`
    SELECT coalesce(sum(${deals.proposalValue}), 0) as sum, count(*)::int as cnt
    FROM ${deals}
    WHERE ${deals.stage} = 'ganho'
      AND ${deals.closedAt} >= ${start}
      AND ${deals.closedAt} < ${end}
      ${ownerSql}
      ${filter}
  `).then((r) => ((r as any).rows ?? r) as { sum: string; cnt: number }[]);
  return { value: Number(row.sum), count: Number(row.cnt) };
}

async function lostCount(start: Date, end: Date, ownerUserId: string | null, leadFilters?: DashboardLeadFilters) {
  const filter = leadFilterExists('deals', leadFilters);
  const ownerSql = ownerUserId ? sql`AND ${deals.ownerUserId} = ${ownerUserId}` : sql``;
  const [row] = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt
    FROM ${deals}
    WHERE ${deals.stage} = 'perdido'
      AND ${deals.closedAt} >= ${start}
      AND ${deals.closedAt} < ${end}
      ${ownerSql}
      ${filter}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);
  return Number(row.cnt);
}

async function proposalsCount(start: Date, end: Date, actorUserId: string | null, leadFilters?: DashboardLeadFilters) {
  // dealActivities.deal_id → deals.lead_id. Pra filtrar por lead, juntamos
  // deals quando algum lead filter está ativo.
  if (hasAnyLeadFilter(leadFilters)) {
    const actorSql = actorUserId ? sql`AND da.actor_user_id = ${actorUserId}` : sql``;
    const filter = leadFilterExists('d', leadFilters);
    const [row] = await db.execute<{ cnt: number }>(sql`
      SELECT count(*)::int as cnt
      FROM ${dealActivities} da
      JOIN ${deals} d ON d.id = da.deal_id
      WHERE da.kind = 'created'
        AND da.created_at >= ${start}
        AND da.created_at < ${end}
        ${actorSql}
        ${filter}
    `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);
    return Number(row.cnt);
  }
  const where = actorUserId
    ? and(eq(dealActivities.kind, 'created'), gte(dealActivities.createdAt, start), lt(dealActivities.createdAt, end), eq(dealActivities.actorUserId, actorUserId))
    : and(eq(dealActivities.kind, 'created'), gte(dealActivities.createdAt, start), lt(dealActivities.createdAt, end));
  const [row] = await db.select({ cnt: sql<number>`count(*)::int` }).from(dealActivities).where(where);
  return row.cnt;
}

async function funnelOrg(start: Date, end: Date, leadFilters?: DashboardLeadFilters) {
  // Filtros aplicam direto em leads (newLeads) ou via subquery EXISTS contra
  // leads pelas tabelas downstream (conversations/deals — usam lead_id).
  const fLeads = hasAnyLeadFilter(leadFilters) ? leadFilterDirect(leadFilters) : sql``;
  const fConv = leadFilterExists('conversations', leadFilters);
  const fDeals = leadFilterExists('deals', leadFilters);

  const [newLeadsRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt FROM ${leads}
    WHERE ${leads.createdAt} >= ${start} AND ${leads.createdAt} < ${end}
    ${fLeads}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

  const [withConvRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(distinct ${conversations.leadId})::int as cnt FROM ${conversations}
    WHERE ${conversations.createdAt} >= ${start} AND ${conversations.createdAt} < ${end}
    ${fConv}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

  const [withPropRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(distinct ${deals.leadId})::int as cnt FROM ${deals}
    WHERE ${deals.createdAt} >= ${start} AND ${deals.createdAt} < ${end}
    ${fDeals}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

  const [wonRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt FROM ${deals}
    WHERE ${deals.stage} = 'ganho'
      AND ${deals.closedAt} >= ${start} AND ${deals.closedAt} < ${end}
    ${fDeals}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

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

async function funnelMe(start: Date, end: Date, userId: string, leadFilters?: DashboardLeadFilters) {
  const fDeals = leadFilterExists('deals', leadFilters);
  // messages.conversationId → conversations.leadId. Filtra via subquery EXISTS.
  const fMsgs = hasAnyLeadFilter(leadFilters)
    ? sql` AND EXISTS (
        SELECT 1 FROM conversations c
        JOIN leads l ON l.id = c.lead_id
        WHERE c.id = ${messages.conversationId}
          ${leadFilters!.imbp ? sql`AND l.imbp = ${leadFilters!.imbp}` : sql``}
          ${leadFilters!.segment ? sql`AND l.segment = ${leadFilters!.segment}` : sql``}
          ${leadFilters!.city ? sql`AND lower(l.city) = lower(${leadFilters!.city})` : sql``}
      )`
    : sql``;

  const [respRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(distinct ${messages.conversationId})::int as cnt FROM ${messages}
    WHERE ${messages.sentByUserId} = ${userId}
      AND ${messages.sentAt} >= ${start} AND ${messages.sentAt} < ${end}
    ${fMsgs}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

  const [propRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt FROM ${deals}
    WHERE ${deals.ownerUserId} = ${userId}
      AND ${deals.createdAt} >= ${start} AND ${deals.createdAt} < ${end}
    ${fDeals}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

  const [wonRow] = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt FROM ${deals}
    WHERE ${deals.ownerUserId} = ${userId}
      AND ${deals.stage} = 'ganho'
      AND ${deals.closedAt} >= ${start} AND ${deals.closedAt} < ${end}
    ${fDeals}
  `).then((r) => ((r as any).rows ?? r) as { cnt: number }[]);

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
    ? and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, eq(deals.ownerUserId, ownerUserId))
    : sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`;
  const rows = await db
    .select({
      stage: deals.stage,
      cnt: sql<number>`count(*)::int`,
      // Quantos TÊM valor. count(coluna) ignora NULL — é o que separa "somei
      // tudo" de "somei o que existe". Sem isso o totalValue parece o pipeline
      // inteiro quando na prática a maioria dos deals entra como zero.
      withValue: sql<number>`count(${deals.proposalValue})::int`,
      sum: sql<string>`coalesce(sum(${deals.proposalValue}), 0)`,
      avgAge: sql<string>`coalesce(avg(extract(epoch from (now() - ${deals.createdAt})) / 86400), 0)`,
    })
    .from(deals)
    .where(where)
    .groupBy(deals.stage);

  const byStage = rows.map((r) => ({
    stage: r.stage as 'lead_no_comercial' | 'proposta_enviada' | 'em_negociacao',
    count: r.cnt,
    valueSum: Number(r.sum),
  }));
  const totalValue = byStage.reduce((acc, r) => acc + r.valueSum, 0);

  // Weighted avg age across all rows
  const totalCount = byStage.reduce((acc, r) => acc + r.count, 0);
  const weightedAge = rows.reduce((acc, r) => acc + Number(r.avgAge) * r.cnt, 0);
  const avgAgeDays = totalCount === 0 ? 0 : Math.round((weightedAge / totalCount) * 10) / 10;
  const withValueCount = rows.reduce((acc, r) => acc + r.withValue, 0);

  return { byStage, totalValue, avgAgeDays, openCount: totalCount, withValueCount };
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

async function countProposalOld(ownerUserId: string | null): Promise<number> {
  const where = ownerUserId
    ? and(eq(deals.stage, 'proposta_enviada'), sql`${deals.updatedAt} < now() - interval '14 days'`, eq(deals.ownerUserId, ownerUserId))
    : and(eq(deals.stage, 'proposta_enviada'), sql`${deals.updatedAt} < now() - interval '14 days'`);
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(deals).where(where);
  return r.cnt;
}

async function countDealStale(ownerUserId: string | null): Promise<number> {
  const where = ownerUserId
    ? and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, sql`${deals.updatedAt} < now() - interval '5 days'`, eq(deals.ownerUserId, ownerUserId))
    : and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, sql`${deals.updatedAt} < now() - interval '5 days'`);
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(deals).where(where);
  return r.cnt;
}

async function countConvExpired(ownerUserId: string | null): Promise<number> {
  // "Expired without our reply": last inbound was >24h ago AND nothing went out since
  // (lastMessageAt <= lastInboundAt means the most recent message is the inbound one).
  const base = and(
    sql`${conversations.status} != 'encerrada'`,
    sql`${conversations.lastInboundAt} IS NOT NULL`,
    sql`${conversations.lastInboundAt} < now() - interval '24 hours'`,
    sql`${conversations.lastMessageAt} <= ${conversations.lastInboundAt}`,
  );
  const where = ownerUserId ? and(base, eq(conversations.assignedTo, ownerUserId)) : base;
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(conversations).where(where);
  return r.cnt;
}

async function countQueuePending(ownerUserId: string | null): Promise<number> {
  const base = and(eq(conversations.queue, 'comercial'), eq(conversations.status, 'aguardando_atendimento'));
  const where = ownerUserId ? and(base, eq(conversations.assignedTo, ownerUserId)) : base;
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(conversations).where(where);
  return r.cnt;
}

export async function attention(args: { view: DashboardView; userId?: string }): Promise<DashboardAttentionResponse> {
  const owner = args.view === 'me' ? args.userId! : null;
  const [proposalOld, dealStale, convExpired, queuePending] = await Promise.all([
    countProposalOld(owner),
    countDealStale(owner),
    countConvExpired(owner),
    countQueuePending(owner),
  ]);

  const meFilter = args.view === 'me' ? { owner: 'me' } : {};
  const candidates: DashboardAttentionItem[] = [
    { severity: 'critical' as const, kind: 'proposal_old',  count: proposalOld,  route: '/inside-sales', filter: { ...meFilter, stage: 'proposta_enviada', stale: true } },
    { severity: 'critical' as const, kind: 'conv_expired',  count: convExpired,  route: '/whatsapp',     filter: { ...meFilter, expired24h: true } },
    { severity: 'warning'  as const, kind: 'deal_stale',    count: dealStale,    route: '/inside-sales', filter: { ...meFilter, stale: true } },
    { severity: 'info'     as const, kind: 'queue_pending', count: queuePending, route: '/whatsapp',     filter: { ...meFilter, queue: 'comercial', status: 'aguardando_atendimento' } },
  ];
  const items = candidates.filter((i) => i.count > 0);

  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  return { items };
}

export async function summary(args: SummaryArgs): Promise<DashboardSummary> {
  const period = resolvePeriod(args.period, args.now);
  const owner = args.view === 'me' ? args.userId! : null;
  const lf = args.leadFilters;

  // KPIs (current + previous in parallel)
  const [salesCur, salesPrev, lostCur, lostPrev, propsCur, propsPrev] = await Promise.all([
    salesKpi(period.start, period.end, owner, lf),
    salesKpi(period.prevStart, period.prevEnd, owner, lf),
    lostCount(period.start, period.end, owner, lf),
    lostCount(period.prevStart, period.prevEnd, owner, lf),
    proposalsCount(period.start, period.end, owner, lf),
    proposalsCount(period.prevStart, period.prevEnd, owner, lf),
  ]);

  const winRateCur  = salesCur.count + lostCur === 0 ? 0 : Math.round((salesCur.count / (salesCur.count + lostCur)) * 100);
  const winRatePrev = salesPrev.count + lostPrev === 0 ? 0 : Math.round((salesPrev.count / (salesPrev.count + lostPrev)) * 100);

  const avgTicketCur  = salesCur.count === 0 ? 0 : Math.round(salesCur.value / salesCur.count);
  const avgTicketPrev = salesPrev.count === 0 ? 0 : Math.round(salesPrev.value / salesPrev.count);

  // Independent secondary aggregations — fire in parallel (was 4 sequential round-trips)
  // Pipeline aberto / leaderboard / recentes seguem agregados (visão global do
  // estado atual, não da janela filtrada) — só o funil e KPIs respeitam filtros.
  const [goal, funnel, pipeline, leaderOrRecent] = await Promise.all([
    goalFn(args.view, args.period, salesCur.value),
    args.view === 'org'
      ? funnelOrg(period.start, period.end, lf)
      : funnelMe(period.start, period.end, args.userId!, lf),
    pipelineOpenFn(owner),
    args.view === 'org'
      ? leaderboardFn(period.start, period.end)
      : recentActivitiesMe(args.userId!),
  ]);

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
    goal,
    funnel,
    pipelineOpen: pipeline,
    leaderboard: args.view === 'org' ? (leaderOrRecent as Awaited<ReturnType<typeof leaderboardFn>>) : null,
    recentActivities: args.view === 'me' ? (leaderOrRecent as Awaited<ReturnType<typeof recentActivitiesMe>>) : null,
  };
}

// ---------------------------------------------------------------------------
// Macro funnel (Sprint 5 + 6.4) — visão do fluxo end-to-end por flow_stage,
// agora com date range customizado e tempo médio em cada etapa.
// ---------------------------------------------------------------------------

import type { DashboardMacroFunnel, LeadFlowStage } from '../../shared/types';
import { leadStageTransitions } from '../db/schema';

interface MacroFunnelArgs {
  period?: PeriodKey;
  // Alternativa: range explícito ISO (precedência sobre period quando provided)
  rangeStart?: Date;
  rangeEnd?: Date;
  now?: Date;
  leadFilters?: DashboardLeadFilters;
  // Filtro por campanha(s): quando presente, o funil mostra os leads dessas
  // campanhas e IGNORA o período (base completa da(s) campanha(s)).
  campaignIds?: string[];
}

export async function macroFunnel(args: MacroFunnelArgs): Promise<DashboardMacroFunnel> {
  // Aceita period OU range customizado.
  let start: Date;
  let end: Date;
  let label: string;

  if (args.rangeStart && args.rangeEnd) {
    start = args.rangeStart;
    end = args.rangeEnd;
    label = `${start.toLocaleDateString('pt-BR')} – ${end.toLocaleDateString('pt-BR')}`;
  } else {
    const period = resolvePeriod(args.period ?? '30d', args.now);
    start = period.start;
    end = period.end;
    label = period.label;
  }

  const lf = args.leadFilters;
  // Escopo por campanha: ignora o período e restringe aos leads que participaram
  // das campanhas selecionadas (via campaign_recipients).
  const scopedByCampaign = (args.campaignIds?.length ?? 0) > 0;
  if (scopedByCampaign) {
    label = args.campaignIds!.length === 1 ? 'Campanha selecionada' : `${args.campaignIds!.length} campanhas`;
  }
  const periodPart = scopedByCampaign
    ? sql``
    : sql` AND ${leads.createdAt} >= ${start} AND ${leads.createdAt} < ${end}`;
  const campaignPart = scopedByCampaign
    ? sql` AND EXISTS (SELECT 1 FROM ${campaignRecipients} cr WHERE cr.lead_id = ${leads.id} AND cr.campaign_id IN (${sql.join(args.campaignIds!.map((id) => sql`${id}`), sql`, `)}))`
    : sql``;

  // Counts cumulativos por stage — uma query.
  const filterDirect = leadFilterDirect(lf);
  const [row] = await db.execute<{
    total: number; incomplete: number; complete: number; dispatched: number;
    engaged: number; qualified: number; handed_off: number; lost: number; won: number;
  }>(sql`
    SELECT
      count(*)::int as total,
      count(*) filter (where ${leads.flowStage} = 'incomplete')::int as incomplete,
      count(*) filter (where ${leads.flowStage} in ('complete','dispatched','engaged','qualified','handed_off'))::int as complete,
      count(*) filter (where ${leads.flowStage} in ('dispatched','engaged','qualified','handed_off'))::int as dispatched,
      count(*) filter (where ${leads.flowStage} in ('engaged','qualified','handed_off'))::int as engaged,
      count(*) filter (where ${leads.flowStage} in ('qualified','handed_off'))::int as qualified,
      count(*) filter (where ${leads.flowStage} = 'handed_off')::int as handed_off,
      count(*) filter (where ${leads.flowStage} = 'lost')::int as lost,
      count(*) filter (where EXISTS (SELECT 1 FROM ${deals} d WHERE d.lead_id = ${leads.id} AND d.stage = 'ganho'))::int as won
    FROM ${leads}
    WHERE 1=1${periodPart}${campaignPart}
    ${filterDirect}
  `).then((r) => ((r as any).rows ?? r) as any[]);
  const handedOff = row.handed_off;

  // Tempo médio em cada etapa — janela LEAD por lead, computa diff até a próxima
  // transição. Cohort restrita aos leads criados no mesmo período.
  const durFilter = hasAnyLeadFilter(lf)
    ? sql`
        ${lf!.imbp ? sql`AND l.imbp = ${lf!.imbp}` : sql``}
        ${lf!.segment ? sql`AND l.segment = ${lf!.segment}` : sql``}
        ${lf!.city ? sql`AND lower(l.city) = lower(${lf!.city})` : sql``}
      `
    : sql``;
  const durationRows = await db.execute<{
    stage: string;
    avg_seconds: string | number;
    transition_count: string | number;
  }>(sql`
    WITH ranked AS (
      SELECT
        t.lead_id,
        t.to_stage,
        t.changed_at,
        LEAD(t.changed_at) OVER (PARTITION BY t.lead_id ORDER BY t.changed_at) as next_changed_at
      FROM ${leadStageTransitions} t
      JOIN ${leads} l ON l.id = t.lead_id
      WHERE l.created_at >= ${start} AND l.created_at < ${end}
      ${durFilter}
    )
    SELECT
      to_stage as stage,
      AVG(EXTRACT(EPOCH FROM (next_changed_at - changed_at))) as avg_seconds,
      COUNT(*) as transition_count
    FROM ranked
    WHERE next_changed_at IS NOT NULL
    GROUP BY to_stage
  `);

  // db.execute retorna { rows: [...] } com pg driver. Em alguns paths drizzle
  // devolve array direto. Cobrimos os dois.
  type DurRow = { stage: string; avg_seconds: string | number; transition_count: string | number };
  const durRaw = durationRows as unknown as DurRow[] | { rows?: DurRow[] };
  const durArr: DurRow[] = Array.isArray(durRaw) ? durRaw : (durRaw.rows ?? []);

  const total = row.total;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  const conv = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;

  return {
    period: { start: start.toISOString(), end: end.toISOString(), label },
    total,
    stages: {
      imported:   { count: total,         pctOfTotal: 100 },
      complete:   { count: row.complete,   pctOfTotal: pct(row.complete),   convFromPrev: conv(row.complete, total) },
      dispatched: { count: row.dispatched, pctOfTotal: pct(row.dispatched), convFromPrev: conv(row.dispatched, row.complete) },
      engaged:    { count: row.engaged,    pctOfTotal: pct(row.engaged),    convFromPrev: conv(row.engaged, row.dispatched) },
      qualified:  { count: row.qualified,  pctOfTotal: pct(row.qualified),  convFromPrev: conv(row.qualified, row.engaged) },
      handedOff:  { count: handedOff,      pctOfTotal: pct(handedOff),      convFromPrev: conv(handedOff, row.qualified) },
      won:        { count: row.won,        pctOfTotal: pct(row.won),        convFromPrev: conv(row.won, handedOff) },
    },
    sidelines: {
      incomplete: { count: row.incomplete, pctOfTotal: pct(row.incomplete) },
      lost:       { count: row.lost,       pctOfTotal: pct(row.lost) },
    },
    avgDurationByStage: durArr
      .map((d) => ({
        stage: d.stage as LeadFlowStage,
        avgSeconds: Math.round(Number(d.avg_seconds)),
        transitionCount: Number(d.transition_count),
      }))
      .sort((a, b) => a.stage.localeCompare(b.stage)),
  };
}

export async function whatsappStats(): Promise<DashboardWhatsappStats> {
  const [instRow] = await db
    .select({ lastStatus: whatsappInstance.lastStatus })
    .from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true))
    .limit(1);
  const instanceConnected = instRow?.lastStatus === 'connected';

  // "Conversas em fila" = conversas abertas (não encerradas) que REALMENTE
  // aparecem na Inbox. Aplica o mesmo filtro de visibilidade do listConversations
  // (lastInboundAt IS NOT NULL OR originKind != 'campaign'): sem ele, contava
  // centenas de disparos de campanha nunca respondidos (número inflado/irreal).
  // Casa com o link do card (statusChips=aguardando,em_atendimento = não-encerradas).
  const [inQueueRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(
      sql`${conversations.status} != 'encerrada'`,
      sql`(${conversations.lastInboundAt} IS NOT NULL OR ${conversations.originKind} != 'campaign')`,
    ));

  const [expiredRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(
      sql`${conversations.status} != 'encerrada'`,
      sql`${conversations.lastInboundAt} IS NOT NULL`,
      sql`${conversations.lastInboundAt} < now() - interval '24 hours'`,
      sql`${conversations.lastMessageAt} <= ${conversations.lastInboundAt}`,
    ));

  // Average first-response time over conversations created in last 7d
  const avgRes = await db.execute<{ avg_sec: string | null }>(sql`
    SELECT avg(extract(epoch from (first_out.sent_at - first_in.sent_at)))::text AS avg_sec
    FROM conversations c
    JOIN LATERAL (SELECT sent_at FROM messages WHERE conversation_id = c.id AND direction = 'in'  ORDER BY sent_at ASC LIMIT 1) AS first_in ON TRUE
    JOIN LATERAL (SELECT sent_at FROM messages WHERE conversation_id = c.id AND direction = 'out' AND sent_at > first_in.sent_at ORDER BY sent_at ASC LIMIT 1) AS first_out ON TRUE
    WHERE c.created_at >= now() - interval '7 days'
  `);
  const avgRows = (avgRes as any).rows ?? avgRes;
  const avgSec = avgRows?.[0]?.avg_sec;
  const avgFirstResponseSec = avgSec ? Math.round(Number(avgSec)) : 0;

  const noRespRes = await db.execute<{ cnt: string }>(sql`
    SELECT count(*)::text AS cnt
    FROM conversations c
    WHERE c.last_inbound_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
      AND (c.last_message_at <= c.last_inbound_at OR c.last_message_at IS NULL)
  `);
  const noRespRows = (noRespRes as any).rows ?? noRespRes;
  const noResponseToday = Number(noRespRows[0].cnt);

  return {
    inQueue: inQueueRow.cnt,
    avgFirstResponseSec,
    expired24h: expiredRow.cnt,
    noResponseToday,
    instanceConnected,
  };
}
