import { db } from '../db/client';
import { campaigns, campaignRecipients, leads, conversations, messages, deals, users, whatsappInstance } from '../db/schema';
import { eq, and, or, ilike, desc, sql, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicCampaign,
  CampaignFunnel,
  CampaignStatus,
  AudienceFilters,
  PublicCampaignRecipient,
  LossReason,
  CampaignHsmVariable,
} from '@shared/types';
import { LOSS_REASONS } from '@shared/types';
import { resolveAudience } from './campaignsAudience';
import { filterEligibleLeads, COOLDOWN_REASON } from './campaignsCooldown';
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

  const audience = await resolveAudience(input.audienceFilter);
  const audienceIds = audience.map((a) => a.leadId);
  const { eligible } = await filterEligibleLeads(audienceIds, {});

  const instanceId = input.instanceId;

  const eligibleSet = new Set(eligible);
  const eligibleRows = audience.filter((a) => eligibleSet.has(a.leadId));
  const blockedRows = audience.filter((a) => !eligibleSet.has(a.leadId));

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
      audienceTotal: audience.length,
      skippedCount: blockedRows.length,
      scheduledAt: input.scheduledAt ?? null,
      ratePerMinute: input.ratePerMinute ?? 20,
      createdByUserId: input.createdByUserId,
      instanceId,
      hsmTemplateId: input.hsmTemplateId ?? null,
      hsmVariables: (input.hsmVariables ?? []) as object[],
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

    if (blockedRows.length > 0) {
      await tx.insert(campaignRecipients)
        .values(blockedRows.map((a) => ({
          campaignId: c.id,
          leadId: a.leadId,
          phone: a.phone,
          status: 'skipped' as const,
          failureReason: COOLDOWN_REASON,
        })))
        .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.leadId] });
    }

    const [creator] = await tx.select().from(users).where(eq(users.id, input.createdByUserId)).limit(1);
    return toPublicCampaign(c, creator ?? null, blockedRows.length);
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
