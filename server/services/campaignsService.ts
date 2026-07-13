import { db } from '../db/client';
import { campaigns, campaignRecipients, leads, conversations, messages, deals, users, whatsappInstance } from '../db/schema';
import { eq, and, or, ilike, desc, sql, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicCampaign,
  CampaignFunnel,
  CampaignsAggregateStats,
  CampaignsTimeseries,
  CampaignsTimeseriesBucket,
  TopCampaign,
  CampaignStatus,
  AudienceFilters,
  PublicCampaignRecipient,
  LossReason,
  CampaignHsmVariable,
  CampaignCalibrationMetrics,
} from '@shared/types';
import { LOSS_REASONS } from '@shared/types';
import { resolveAudience, materializeCsvLeads } from './campaignsAudience';
import { filterEligibleLeads } from './campaignsCooldown';
import { getTemplateById, countBodyVariables } from './hsmTemplateService';
import type { HsmComponent } from '@shared/types';

const LIST_PAGE_SIZE = 50;
const RECIPIENTS_PAGE_SIZE = 50;

function toPublicCampaign(
  row: typeof campaigns.$inferSelect,
  creator: typeof users.$inferSelect | null,
  skippedByCooldown: number,
): PublicCampaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as CampaignStatus,
    templateId: row.templateId,
    messageBody: row.messageBody,
    qualificationQuestion: row.qualificationQuestion ?? null,
    mediaUrl: row.mediaUrl,
    mediaMime: row.mediaMime,
    audienceFilter: (row.audienceFilter as AudienceFilters) ?? {},
    audienceTotal: row.audienceTotal,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    skippedByCooldown,
    ratePerMinute: row.ratePerMinute,
    createdBy: creator
      ? { id: creator.id, name: creator.name }
      : { id: row.createdByUserId, name: 'Usuário' },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function countSkippedByCooldown(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int` })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));
  return row?.n ?? 0;
}

// list
export async function listCampaigns(input: {
  q?: string;
  status?: CampaignStatus;
  page?: number;
}): Promise<{ items: PublicCampaign[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];
  if (input.status) conds.push(eq(campaigns.status, input.status));
  if (input.q) {
    const pat = `%${input.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(ilike(campaigns.name, pat));
  }
  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(where);

  const rows = await db
    .select({ campaign: campaigns, creator: users })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.createdByUserId, users.id))
    .where(where)
    .orderBy(desc(campaigns.createdAt))
    .limit(LIST_PAGE_SIZE)
    .offset((page - 1) * LIST_PAGE_SIZE);

  const ids = rows.map((r) => r.campaign.id);
  const cooldownCounts = ids.length
    ? await db
        .select({
          campaignId: campaignRecipients.campaignId,
          n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int`,
        })
        .from(campaignRecipients)
        .where(inArray(campaignRecipients.campaignId, ids))
        .groupBy(campaignRecipients.campaignId)
    : [];
  const cooldownMap = new Map(cooldownCounts.map((c) => [c.campaignId, c.n]));

  return {
    items: rows.map((r) => toPublicCampaign(r.campaign, r.creator, cooldownMap.get(r.campaign.id) ?? 0)),
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
  };
}

// getById
export async function getCampaignById(id: string): Promise<PublicCampaign> {
  const [row] = await db
    .select({ campaign: campaigns, creator: users })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.createdByUserId, users.id))
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  const skippedByCooldown = await countSkippedByCooldown(id);
  return toPublicCampaign(row.campaign, row.creator, skippedByCooldown);
}

// create + materialize recipients
export async function createCampaign(input: {
  name: string;
  description?: string | null;
  templateId?: string | null;
  messageBody: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter: AudienceFilters;
  scheduledAt?: Date | null;
  ratePerMinute?: number;
  createdByUserId: string;
  instanceId: string;
  hsmTemplateId?: string | null;
  hsmVariables?: CampaignHsmVariable[];
  qualificationQuestion?: string | null;
}): Promise<PublicCampaign> {
  // ── XOR validation: exactly one of templateId or hsmTemplateId must be set ──
  const hasTemplate = !!input.templateId;
  const hasHsm = !!input.hsmTemplateId;
  if (hasTemplate && hasHsm) {
    throw new HttpError(422, 'Provide either templateId or hsmTemplateId, not both');
  }

  // ── HSM template validation ─────────────────────────────────────────────────
  if (hasHsm) {
    const tpl = await getTemplateById(input.hsmTemplateId!);
    if (!tpl) throw new HttpError(422, 'HSM template not found');
    if (tpl.status !== 'APPROVED') {
      throw new HttpError(422, `HSM template must be APPROVED (current status: ${tpl.status})`);
    }
    if (tpl.instanceId !== input.instanceId) {
      throw new HttpError(422, 'HSM template does not belong to the specified instance');
    }
    // Validate variable coverage
    const requiredCount = countBodyVariables(tpl.components as HsmComponent[]);
    const providedIndices = new Set((input.hsmVariables ?? []).map((v) => v.index));
    for (let i = 1; i <= requiredCount; i++) {
      if (!providedIndices.has(i)) {
        throw new HttpError(422, `hsmVariables must cover all template variables: missing index ${i}`);
      }
    }
  }

  // Se a audiência tem CSV de telefones, materializa como leads os números que
  // ainda não existem na base ANTES de resolver a audiência — assim eles entram
  // como destinatários. Idempotente e por telefone canônico (não duplica).
  await materializeCsvLeads(input.audienceFilter);

  const audience = await resolveAudience(input.audienceFilter);
  const audienceIds = audience.map((a) => a.leadId);
  const { eligible } = await filterEligibleLeads(audienceIds, {});

  const instanceId = input.instanceId;

  // Bloqueados por cooldown 24h NÃO entram como destinatários — a campanha
  // dispara apenas para quem foi efetivamente selecionado (eligible). O preview
  // (dryRun) ainda exibe os bloqueados pro vendedor saber quem ficou de fora.
  // Decisão tomada em 2026-05-28 (Fernando): se quiser disparar pra alguém em
  // cooldown, agendar a campanha para depois da janela.
  // Safety-net do dispatcher continua ativo — se alguém entrar em cooldown
  // entre criação e envio (caso comum em campanhas agendadas), o tick pula.
  const eligibleSet = new Set(eligible);
  const eligibleRows = audience.filter((a) => eligibleSet.has(a.leadId));
  const excludedByCooldownCount = audience.length - eligibleRows.length;

  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      templateId: input.templateId ?? null,
      messageBody: input.messageBody,
      mediaUrl: input.mediaUrl ?? null,
      mediaMime: input.mediaMime ?? null,
      audienceFilter: input.audienceFilter as object,
      audienceTotal: eligibleRows.length,
      skippedCount: 0,
      scheduledAt: input.scheduledAt ?? null,
      ratePerMinute: input.ratePerMinute ?? 20,
      createdByUserId: input.createdByUserId,
      instanceId,
      hsmTemplateId: input.hsmTemplateId ?? null,
      hsmVariables: (input.hsmVariables ?? []) as object[],
      qualificationQuestion: input.qualificationQuestion ?? null,
    }).returning();

    if (eligibleRows.length > 0) {
      await tx.insert(campaignRecipients)
        .values(eligibleRows.map((a) => ({
          campaignId: c.id,
          leadId: a.leadId,
          phone: a.phone,
        })))
        .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.leadId] });
    }

    const [creator] = await tx.select().from(users).where(eq(users.id, input.createdByUserId)).limit(1);
    // skippedByCooldown no retorno reflete os excluídos do filtro original —
    // útil pro frontend exibir "X contatos em cooldown ficaram de fora".
    return toPublicCampaign(c, creator ?? null, excludedByCooldownCount);
  });
}

// State transitions
export async function dispatchCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'draft') {
    throw new HttpError(400, `Cannot dispatch campaign in status '${row.status}'`);
  }

  const newStatus: CampaignStatus = row.scheduledAt && row.scheduledAt > new Date()
    ? 'scheduled'
    : 'running';

  await db.update(campaigns).set({
    status: newStatus,
    startedAt: newStatus === 'running' ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, id));

  return getCampaignById(id);
}

export async function pauseCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'running') throw new HttpError(400, 'Only running campaigns can be paused');
  await db.update(campaigns).set({ status: 'paused', updatedAt: new Date() }).where(eq(campaigns.id, id));
  return getCampaignById(id);
}

export async function resumeCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'paused') throw new HttpError(400, 'Only paused campaigns can be resumed');
  await db.update(campaigns).set({ status: 'running', updatedAt: new Date() }).where(eq(campaigns.id, id));
  return getCampaignById(id);
}

export async function cancelCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (!['scheduled', 'running', 'paused', 'draft'].includes(row.status)) {
    throw new HttpError(400, `Cannot cancel campaign in status '${row.status}'`);
  }

  await db.transaction(async (tx) => {
    await tx.update(campaignRecipients).set({
      status: 'skipped',
      updatedAt: new Date(),
    }).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, 'pending'),
    ));

    const [{ skipped }] = await tx.select({
      skipped: sql<number>`count(*)::int`,
    }).from(campaignRecipients).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, 'skipped'),
    ));

    await tx.update(campaigns).set({
      status: 'cancelled',
      skippedCount: skipped,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, id));
  });

  return getCampaignById(id);
}

export async function deleteCampaign(id: string): Promise<void> {
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

// Recipients listing
export async function listRecipients(input: {
  campaignId: string;
  status?: 'pending' | 'sent' | 'failed' | 'skipped';
  page?: number;
}): Promise<{ items: PublicCampaignRecipient[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [eq(campaignRecipients.campaignId, input.campaignId)];
  if (input.status) conds.push(eq(campaignRecipients.status, input.status));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(campaignRecipients).where(where);

  const rows = await db.select({
    recipient: campaignRecipients,
    leadName: leads.name,
  })
    .from(campaignRecipients)
    .leftJoin(leads, eq(campaignRecipients.leadId, leads.id))
    .where(where)
    .orderBy(desc(campaignRecipients.createdAt))
    .limit(RECIPIENTS_PAGE_SIZE)
    .offset((page - 1) * RECIPIENTS_PAGE_SIZE);

  return {
    items: rows.map((r) => ({
      id: r.recipient.id,
      leadId: r.recipient.leadId,
      leadName: r.leadName ?? 'Lead',
      phone: r.recipient.phone,
      status: r.recipient.status,
      sentAt: r.recipient.sentAt?.toISOString() ?? null,
      failureReason: r.recipient.failureReason,
    })),
    total,
    page,
    pageSize: RECIPIENTS_PAGE_SIZE,
  };
}

/**
 * Agrega metricas de campanhas no periodo dado.
 *
 * Filtros:
 *   - period (start/end): filtra atividade (recipients.sent_at e deals.closed_at).
 *     totalCampaigns conta campanhas com atividade no periodo.
 *   - kind: 'all' | 'one_shot' | 'continuous' — filtra por campaigns.is_continuous.
 *
 * Para period-over-period (Δ%), o handler chama essa funcao 2 vezes:
 *   uma com periodo atual, outra com periodo anterior (mesma duracao).
 */
export interface ReportLeadFilters {
  /** Recorte por IMBP do lead destinatário. */
  imbp?: string;
  /** Recorte por Segmento (derivado do IMBP). */
  segment?: string;
  /** Recorte por cidade exata (case-insensitive). */
  city?: string;
}

export interface AggregateStatsInput extends ReportLeadFilters {
  start: Date;
  end: Date;
  kind?: 'all' | 'one_shot' | 'continuous';
}

/**
 * Monta WHERE adicional para filtrar campaign_recipients pelos atributos do lead
 * destinatário. Retorna `sql``` vazio quando nenhum filtro foi passado, o que
 * preserva o comportamento original quando o usuário não escolhe recorte.
 *
 * Usado por aggregate/timeseries/top — sempre via subquery EXISTS contra
 * `leads l` para evitar precisar incluir JOIN explicito em cada query.
 */
function leadFilterClause(alias: string, f: ReportLeadFilters): SQL {
  if (!f.imbp && !f.segment && !f.city) return sql``;
  const conds: SQL[] = [];
  if (f.imbp) conds.push(sql`l.imbp = ${f.imbp}`);
  if (f.segment) conds.push(sql`l.segment = ${f.segment}`);
  if (f.city) conds.push(sql`lower(l.city) = lower(${f.city})`);
  // alias.lead_id é o ID que liga campaign_recipients/deals/etc ao lead
  return sql`AND EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = ${sql.raw(alias)}.lead_id
      AND ${sql.join(conds, sql` AND `)}
  )`;
}

export async function getCampaignsAggregateStats(input: AggregateStatsInput): Promise<Omit<CampaignsAggregateStats, 'period' | 'kind' | 'compareWith'>> {
  const { start, end } = input;
  const kind = input.kind ?? 'all';
  const leadCrFilter = leadFilterClause('cr', input);
  const leadDealFilter = leadFilterClause('d', input);

  // SQL fragments reutilizaveis pra filtro de kind via subquery em campaign_recipients.
  const kindCampaignFilter = kind === 'all'
    ? sql``
    : kind === 'continuous'
      ? sql`AND c.is_continuous = true`
      : sql`AND c.is_continuous = false`;

  const kindRecipientFilter = kind === 'all'
    ? sql``
    : kind === 'continuous'
      ? sql`AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cr.campaign_id AND c.is_continuous = true)`
      : sql`AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cr.campaign_id AND c.is_continuous = false)`;

  // Contagem de campanhas com atividade no periodo (ao menos 1 recipient sent_at no range).
  const campaignCountRows = await db.execute(sql`
    SELECT
      COUNT(DISTINCT cr.campaign_id)::int AS total,
      COUNT(DISTINCT cr.campaign_id) FILTER (WHERE c.status = 'completed')::int AS completed,
      COUNT(DISTINCT cr.campaign_id) FILTER (WHERE c.status IN ('running', 'scheduled'))::int AS active
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE cr.sent_at >= ${start} AND cr.sent_at < ${end}
      ${kindCampaignFilter}
      ${leadCrFilter}
  `);
  const cc = campaignCountRows.rows[0] as { total: number; completed: number; active: number };

  // Sent recipients no periodo.
  const sentRows = await db.execute(sql`
    SELECT COUNT(*)::int AS sent
    FROM campaign_recipients cr
    WHERE cr.status = 'sent'
      AND cr.sent_at >= ${start} AND cr.sent_at < ${end}
      ${kindRecipientFilter}
      ${leadCrFilter}
  `);
  const sent = (sentRows.rows[0] as { sent: number }).sent ?? 0;

  // Replied: leads distintos que receberam disparo no periodo E responderam (inbound apos sent_at).
  const repliedRows = await db.execute(sql`
    SELECT COUNT(DISTINCT cr.lead_id)::int AS replied
    FROM campaign_recipients cr
    WHERE cr.status = 'sent'
      AND cr.sent_at >= ${start} AND cr.sent_at < ${end}
      ${kindRecipientFilter}
      ${leadCrFilter}
      AND EXISTS (
        SELECT 1 FROM conversations c2
        JOIN messages m ON m.conversation_id = c2.id
        WHERE c2.lead_id = cr.lead_id
          AND m.direction = 'in'
          AND m.sent_at > cr.sent_at
      )
  `);
  const replied = (repliedRows.rows[0] as { replied: number }).replied ?? 0;

  // Deals agregados: usa closed_at quando ganho/perdido (estagios terminais), senao
  // usa created_at — captura tanto deals fechados no periodo quanto deals abertos no periodo.
  const dealsAgg = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE d.stage IN ('lead_no_comercial','proposta_enviada','em_negociacao')
                       AND d.created_at >= ${start} AND d.created_at < ${end})::int AS in_deal,
      COUNT(*) FILTER (WHERE d.stage = 'ganho'
                       AND COALESCE(d.closed_at, d.created_at) >= ${start}
                       AND COALESCE(d.closed_at, d.created_at) < ${end})::int AS won,
      COUNT(*) FILTER (WHERE d.stage = 'perdido'
                       AND COALESCE(d.closed_at, d.created_at) >= ${start}
                       AND COALESCE(d.closed_at, d.created_at) < ${end})::int AS lost,
      COALESCE(SUM(CASE WHEN d.stage = 'ganho'
                        AND COALESCE(d.closed_at, d.created_at) >= ${start}
                        AND COALESCE(d.closed_at, d.created_at) < ${end}
                   THEN d.proposal_value ELSE 0 END), 0) AS won_value
    FROM deals d
    WHERE EXISTS (
      SELECT 1 FROM campaign_recipients cr
      JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.lead_id = d.lead_id
        ${kindCampaignFilter}
    )
    ${leadDealFilter}
  `);
  const deal = dealsAgg.rows[0] as { in_deal: number; won: number; lost: number; won_value: string | number };
  const inDeal = deal.in_deal ?? 0;
  const won = deal.won ?? 0;
  const lost = deal.lost ?? 0;
  const wonValue = Number(deal.won_value ?? 0);

  // Motivos de perda agregados (so deals perdidos vindos de campanha no periodo).
  const lostReasonsRows = await db.execute(sql`
    SELECT d.loss_reason AS reason, COUNT(*)::int AS n
    FROM deals d
    WHERE d.stage = 'perdido'
      AND COALESCE(d.closed_at, d.created_at) >= ${start}
      AND COALESCE(d.closed_at, d.created_at) < ${end}
      AND d.loss_reason IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM campaign_recipients cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE cr.lead_id = d.lead_id
          ${kindCampaignFilter}
      )
      ${leadDealFilter}
    GROUP BY 1
  `);
  const lostByReason: Record<LossReason, number> = {
    condicoes_comerciais: 0,
    preco: 0,
    sem_retorno: 0,
    fora_do_perfil: 0,
  };
  for (const r of lostReasonsRows.rows as { reason: string; n: number }[]) {
    if (LOSS_REASONS.includes(r.reason as LossReason)) {
      lostByReason[r.reason as LossReason] = r.n;
    }
  }

  const replyRate = sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 10;
  const conversionRate = sent === 0 ? 0 : Math.round((won / sent) * 1000) / 10;

  return {
    totalCampaigns: cc.total ?? 0,
    completedCampaigns: cc.completed ?? 0,
    activeCampaigns: cc.active ?? 0,
    totalSent: sent,
    totalReplied: replied,
    replyRate,
    totalInDeal: inDeal,
    totalWon: won,
    totalLost: lost,
    totalWonValue: wonValue,
    conversionRate,
    lostByReason,
  };
}

/**
 * Top N campanhas no periodo, ranqueadas por mensagens enviadas (sent DESC).
 * Inclui sent/replied/replyRate/won/wonValue por campanha pra exibir tabela.
 */
export async function getTopCampaigns(input: {
  start: Date;
  end: Date;
  kind?: 'all' | 'one_shot' | 'continuous';
  limit?: number;
} & ReportLeadFilters): Promise<TopCampaign[]> {
  const { start, end } = input;
  const kind = input.kind ?? 'all';
  const limit = Math.min(50, Math.max(1, input.limit ?? 5));
  const leadCrFilter = leadFilterClause('cr', input);

  const kindFilter = kind === 'all'
    ? sql``
    : kind === 'continuous'
      ? sql`AND c.is_continuous = true`
      : sql`AND c.is_continuous = false`;

  // Agrega sent/replied/won/wonValue por campaign_id. Replied via subquery EXISTS.
  const rows = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.status,
      c.is_continuous,
      COUNT(cr.id) FILTER (WHERE cr.status = 'sent')::int AS sent,
      COUNT(DISTINCT cr.lead_id) FILTER (
        WHERE cr.status = 'sent'
          AND EXISTS (
            SELECT 1 FROM conversations c2
            JOIN messages m ON m.conversation_id = c2.id
            WHERE c2.lead_id = cr.lead_id
              AND m.direction = 'in'
              AND m.sent_at > cr.sent_at
          )
      )::int AS replied,
      COUNT(DISTINCT d.id) FILTER (
        WHERE d.stage = 'ganho'
          AND COALESCE(d.closed_at, d.created_at) >= ${start}
          AND COALESCE(d.closed_at, d.created_at) < ${end}
      )::int AS won,
      COALESCE(SUM(CASE
        WHEN d.stage = 'ganho'
          AND COALESCE(d.closed_at, d.created_at) >= ${start}
          AND COALESCE(d.closed_at, d.created_at) < ${end}
        THEN d.proposal_value ELSE 0 END), 0) AS won_value
    FROM campaigns c
    JOIN campaign_recipients cr ON cr.campaign_id = c.id
    LEFT JOIN deals d ON d.lead_id = cr.lead_id
    WHERE cr.sent_at >= ${start} AND cr.sent_at < ${end}
      ${kindFilter}
      ${leadCrFilter}
    GROUP BY c.id, c.name, c.status, c.is_continuous
    HAVING COUNT(cr.id) FILTER (WHERE cr.status = 'sent') > 0
    ORDER BY sent DESC
    LIMIT ${limit}
  `);

  return (rows.rows as Array<{
    id: string;
    name: string;
    status: string;
    is_continuous: boolean;
    sent: number;
    replied: number;
    won: number;
    won_value: string | number;
  }>).map((r) => {
    const sent = r.sent ?? 0;
    const replied = r.replied ?? 0;
    return {
      id: r.id,
      name: r.name,
      status: r.status as CampaignStatus,
      isContinuous: r.is_continuous ?? false,
      sent,
      replied,
      replyRate: sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 10,
      won: r.won ?? 0,
      wonValue: Number(r.won_value ?? 0),
    };
  });
}

/**
 * Serie temporal diaria de sent/replied/won pra grafico no relatorio dedicado.
 * Buckets cobrem dia completo em America/Sao_Paulo (UTC-3 fixo, sem DST).
 * Datas sem atividade aparecem com 0 (zero-fill).
 */
export async function getCampaignsTimeseries(input: {
  start: Date;
  end: Date;
  kind?: 'all' | 'one_shot' | 'continuous';
} & ReportLeadFilters): Promise<CampaignsTimeseriesBucket[]> {
  const { start, end } = input;
  const kind = input.kind ?? 'all';
  const leadCrFilter = leadFilterClause('cr', input);
  const leadDealFilter = leadFilterClause('d', input);
  const kindRecipientFilter = kind === 'all'
    ? sql``
    : kind === 'continuous'
      ? sql`AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cr.campaign_id AND c.is_continuous = true)`
      : sql`AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cr.campaign_id AND c.is_continuous = false)`;
  const kindCampaignFilter = kind === 'all'
    ? sql``
    : kind === 'continuous'
      ? sql`AND c.is_continuous = true`
      : sql`AND c.is_continuous = false`;

  // Dias do periodo no timezone SP (cada bucket fecha em [00:00, 23:59:59.999]).
  const sentByDay = await db.execute(sql`
    SELECT
      to_char(cr.sent_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS d,
      COUNT(*)::int AS sent,
      COUNT(DISTINCT cr.lead_id) FILTER (WHERE EXISTS (
        SELECT 1 FROM conversations c2
        JOIN messages m ON m.conversation_id = c2.id
        WHERE c2.lead_id = cr.lead_id
          AND m.direction = 'in'
          AND m.sent_at > cr.sent_at
      ))::int AS replied
    FROM campaign_recipients cr
    WHERE cr.status = 'sent'
      AND cr.sent_at >= ${start} AND cr.sent_at < ${end}
      ${kindRecipientFilter}
      ${leadCrFilter}
    GROUP BY 1
  `);

  const wonByDay = await db.execute(sql`
    SELECT
      to_char(COALESCE(d.closed_at, d.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS d,
      COUNT(*)::int AS won
    FROM deals d
    WHERE d.stage = 'ganho'
      AND COALESCE(d.closed_at, d.created_at) >= ${start}
      AND COALESCE(d.closed_at, d.created_at) < ${end}
      AND EXISTS (
        SELECT 1 FROM campaign_recipients cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE cr.lead_id = d.lead_id
          ${kindCampaignFilter}
      )
      ${leadDealFilter}
    GROUP BY 1
  `);

  // Indexa por data.
  const byDate = new Map<string, CampaignsTimeseriesBucket>();
  for (const r of sentByDay.rows as { d: string; sent: number; replied: number }[]) {
    byDate.set(r.d, { date: r.d, sent: r.sent ?? 0, replied: r.replied ?? 0, won: 0 });
  }
  for (const r of wonByDay.rows as { d: string; won: number }[]) {
    const ex = byDate.get(r.d);
    if (ex) ex.won = r.won ?? 0;
    else byDate.set(r.d, { date: r.d, sent: 0, replied: 0, won: r.won ?? 0 });
  }

  // Zero-fill: gera array continuo de dias entre start e end.
  const buckets: CampaignsTimeseriesBucket[] = [];
  const dayMs = 86_400_000;
  // start ja eh UTC; convertemos pra dia SP usando offset fixo -3h.
  const cursor = new Date(start.getTime() - 3 * 3600_000);
  cursor.setUTCHours(0, 0, 0, 0);
  const endShifted = end.getTime() - 3 * 3600_000;
  while (cursor.getTime() < endShifted) {
    const dateStr = cursor.toISOString().slice(0, 10);
    buckets.push(byDate.get(dateStr) ?? { date: dateStr, sent: 0, replied: 0, won: 0 });
    cursor.setTime(cursor.getTime() + dayMs);
  }
  return buckets;
}

// Funnel
export async function getCampaignFunnel(id: string): Promise<CampaignFunnel> {
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');

  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    sent: sql<number>`count(*) FILTER (WHERE status = 'sent')::int`,
    failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
    skipped: sql<number>`count(*) FILTER (WHERE status = 'skipped')::int`,
    skippedByCooldown: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int`,
    skippedOther: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND (failure_reason IS NULL OR failure_reason <> 'cooldown_24h'))::int`,
  }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));

  const repliedRows = await db.execute(sql`
    SELECT COUNT(DISTINCT cr.lead_id)::int AS replied
    FROM campaign_recipients cr
    WHERE cr.campaign_id = ${id}
      AND cr.status = 'sent'
      AND EXISTS (
        SELECT 1 FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.lead_id = cr.lead_id
          AND m.direction = 'in'
          AND m.sent_at > cr.sent_at
      )
  `);
  const replied = (repliedRows.rows[0] as { replied: number }).replied;

  const dealsRows = await db.select({
    stage: deals.stage,
    lossReason: deals.lossReason,
    proposalValue: deals.proposalValue,
  })
    .from(deals)
    .innerJoin(campaignRecipients, eq(deals.leadId, campaignRecipients.leadId))
    .where(eq(campaignRecipients.campaignId, id));

  let inDeal = 0;
  let won = 0;
  let lost = 0;
  let totalWonValue = 0;
  const lostByReason: Record<LossReason, number> = {
    condicoes_comerciais: 0,
    preco: 0,
    sem_retorno: 0,
    fora_do_perfil: 0,
  };

  for (const d of dealsRows) {
    if (d.stage === 'lead_no_comercial' || d.stage === 'proposta_enviada' || d.stage === 'em_negociacao') inDeal++;
    if (d.stage === 'ganho') {
      won++;
      if (d.proposalValue != null) totalWonValue += Number(d.proposalValue);
    }
    if (d.stage === 'perdido') {
      lost++;
      if (d.lossReason && LOSS_REASONS.includes(d.lossReason as LossReason)) {
        lostByReason[d.lossReason as LossReason]++;
      }
    }
  }

  return {
    totalRecipients: counts.total,
    sent: counts.sent,
    failed: counts.failed,
    skipped: counts.skipped,
    skippedByCooldown: counts.skippedByCooldown,
    skippedOther: counts.skippedOther,
    replied,
    inDeal,
    won,
    lost,
    lostByReason,
    totalWonValue,
  };
}

export async function listUnqualifiedLeads(campaignId: string): Promise<Array<{
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadCnpj: string | null;
  decidedAt: string;
  decisionReason: string | null;
  ageInDays: number;
  reattemptCount: number;
}>> {
  // Leads que esta campanha disparou + IA marcou não qualificado.
  // JOIN: campaign_recipients × ai_call_logs onde qualified=false.
  const result = await db.execute(sql`
    SELECT
      l.id as lead_id,
      l.name as lead_name,
      l.phone,
      l.cnpj,
      acl.created_at as decided_at,
      acl.decision_reason,
      EXTRACT(DAY FROM (now() - acl.created_at))::int as age_days,
      (SELECT COUNT(*)::int FROM campaign_recipients cr2 WHERE cr2.lead_id = l.id) as reattempt_count
    FROM ai_call_logs acl
    INNER JOIN leads l ON l.id = acl.lead_id
    INNER JOIN campaign_recipients cr ON cr.lead_id = l.id
    WHERE cr.campaign_id = ${campaignId}
      AND acl.qualified = false
      AND acl.campaign_id = ${campaignId}
    ORDER BY acl.created_at DESC
    LIMIT 500
  `);
  type Row = { lead_id: string; lead_name: string; phone: string | null; cnpj: string | null;
    decided_at: Date | string; decision_reason: string | null; age_days: number; reattempt_count: number };
  return (result.rows as Row[]).map((r) => ({
    leadId: r.lead_id,
    leadName: r.lead_name,
    leadPhone: r.phone,
    leadCnpj: r.cnpj,
    decidedAt: new Date(r.decided_at).toISOString(),
    decisionReason: r.decision_reason,
    ageInDays: r.age_days,
    reattemptCount: r.reattempt_count,
  }));
}

export async function getCalibrationMetrics(campaignId: string): Promise<CampaignCalibrationMetrics> {
  // 3 queries independentes — paralelizadas pra cortar latencia (~3x RTT -> 1x).
  // Filtra stubs de reanalise (model = 'reanalysis-stub') pra nao contabilizar
  // reanalises como decisoes reais.
  type DecisionRow = { qualified: boolean; count: number };
  type FeedbackRow = { feedback: string | null; count: number };
  type AuditRow = { outcome: string | null; status: string; count: number };

  const [decisionResult, feedbackResult, auditResult] = await Promise.all([
    db.execute(sql`
      SELECT qualified, COUNT(*)::int as count
      FROM ai_call_logs
      WHERE campaign_id = ${campaignId}
        AND human_intent = false
        AND model <> 'reanalysis-stub'
      GROUP BY qualified
    `),
    db.execute(sql`
      SELECT d.lead_quality_feedback as feedback, COUNT(*)::int as count
      FROM deals d
      INNER JOIN ai_call_logs acl ON acl.lead_id = d.lead_id
      WHERE acl.campaign_id = ${campaignId}
        AND acl.qualified = true
        AND acl.model <> 'reanalysis-stub'
      GROUP BY d.lead_quality_feedback
    `),
    db.execute(sql`
      SELECT outcome, status, COUNT(*)::int as count
      FROM audit_sample_assignments
      WHERE campaign_id = ${campaignId}
      GROUP BY outcome, status
    `),
  ]);

  const decisionRows = decisionResult.rows as DecisionRow[];
  const totalQualifiedByAi = decisionRows.find((r) => r.qualified === true)?.count ?? 0;
  const totalNotQualifiedByAi = decisionRows.find((r) => r.qualified === false)?.count ?? 0;

  const feedbackRows = feedbackResult.rows as FeedbackRow[];
  const feedbackGoodCount = feedbackRows.find((r) => r.feedback === 'good')?.count ?? 0;
  const feedbackBadCount = feedbackRows.find((r) => r.feedback === 'bad')?.count ?? 0;
  const feedbackGivenCount = feedbackGoodCount + feedbackBadCount;
  const precision = feedbackGivenCount > 0 ? feedbackGoodCount / feedbackGivenCount : null;

  const auditRows = auditResult.rows as AuditRow[];
  const auditTotal = auditRows.reduce((a, r) => a + r.count, 0);
  const auditContacted = auditRows.filter((r) => r.status === 'contacted').reduce((a, r) => a + r.count, 0);
  const auditGood = auditRows.filter((r) => r.outcome === 'good').reduce((a, r) => a + r.count, 0);
  const auditBad = auditRows.filter((r) => r.outcome === 'bad').reduce((a, r) => a + r.count, 0);

  // Recall estimado: extrapola auditGood de 10% pra 100% dos rejeitados.
  // recall ≈ trueQualified / (trueQualified + estimatedMissed)
  // estimatedMissed = (auditGood / auditContacted) * totalNotQualifiedByAi se auditContacted > 0
  let estimatedRecall: number | null = null;
  if (auditContacted > 0) {
    const missRate = auditGood / auditContacted;
    const estimatedMissed = missRate * totalNotQualifiedByAi;
    const trueQualified = feedbackGoodCount;
    const denom = trueQualified + estimatedMissed;
    estimatedRecall = denom > 0 ? trueQualified / denom : null;
  }

  return {
    campaignId,
    totalQualifiedByAi,
    totalNotQualifiedByAi,
    feedbackGivenCount,
    feedbackGoodCount,
    feedbackBadCount,
    precision,
    auditTotal,
    auditContacted,
    auditGood,
    auditBad,
    estimatedRecall,
  };
}

/**
 * Lista cidades distintas (com contagem) presentes em leads que aparecem em
 * algum campaign_recipients. Usado pelo combobox de Cidade no filtro do
 * relatório — evita listar todas as cidades cadastradas que nunca foram
 * destinatárias de campanha.
 *
 * Ordenado por contagem DESC pra trazer as cidades mais relevantes no topo.
 */
export async function listCampaignReportCities(): Promise<Array<{ city: string; count: number }>> {
  const rows = await db.execute(sql`
    SELECT l.city AS city, COUNT(DISTINCT l.id)::int AS count
    FROM leads l
    WHERE l.city IS NOT NULL AND length(trim(l.city)) > 0
      AND EXISTS (SELECT 1 FROM campaign_recipients cr WHERE cr.lead_id = l.id)
    GROUP BY l.city
    ORDER BY count DESC, l.city ASC
    LIMIT 500
  `);
  return (rows.rows as Array<{ city: string; count: number }>).map((r) => ({
    city: r.city,
    count: r.count ?? 0,
  }));
}
