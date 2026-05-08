import { db } from '../db/client';
import { campaigns, campaignRecipients, leads, messages, type Campaign, type CampaignMessageVariant } from '../db/schema';
import { and, eq, sql, count } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicContinuousCampaign, UpsertContinuousCampaignInput, VariantStat } from '@shared/types';
import { loadOrgSettingsRow } from './orgSettingsService';
import { filterEligibleLeads } from './campaignsCooldown';

const CONTINUOUS_NAME_DEFAULT = 'Disparo automático contínuo';
const RATE_DEFAULT = 20;

// ---------------------------------------------------------------------------
// Janela horária — usado tanto pelo dispatcher quanto pra UI mostrar status.
// ---------------------------------------------------------------------------

export async function isWithinDispatchWindow(now = new Date()): Promise<{
  ok: boolean;
  reason?: 'weekend' | 'before_start' | 'after_end' | 'no_settings';
  startHour?: number;
  endHour?: number;
}> {
  const s = await loadOrgSettingsRow();
  if (!s) return { ok: false, reason: 'no_settings' };

  // Convertemos pra horário do timezone configurado.
  // pt-BR formatter no node retorna hora local do Sao_Paulo (offset -03).
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: s.dispatchTimezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(hourStr);

  // weekday no pt-BR vira "seg", "ter", "qua", "qui", "sex", "sáb", "dom" ou variantes.
  const isWeekend = /^(s[áa]b|dom)/i.test(weekdayStr);
  if (isWeekend && s.dispatchSkipWeekends) {
    return { ok: false, reason: 'weekend', startHour: s.dispatchStartHour, endHour: s.dispatchEndHour };
  }
  if (hour < s.dispatchStartHour) {
    return { ok: false, reason: 'before_start', startHour: s.dispatchStartHour, endHour: s.dispatchEndHour };
  }
  if (hour >= s.dispatchEndHour) {
    return { ok: false, reason: 'after_end', startHour: s.dispatchStartHour, endHour: s.dispatchEndHour };
  }
  return { ok: true, startHour: s.dispatchStartHour, endHour: s.dispatchEndHour };
}

// ---------------------------------------------------------------------------
// CRUD da campanha contínua singleton
// ---------------------------------------------------------------------------

async function loadContinuousRow(): Promise<Campaign | null> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.isContinuous, true)).limit(1);
  return row ?? null;
}

async function buildPublic(row: Campaign): Promise<PublicContinuousCampaign> {
  const [pendingRow] = await db
    .select({ n: count() })
    .from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, row.id), eq(campaignRecipients.status, 'pending')));
  const [enrolledRow] = await db
    .select({ n: count() })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, row.id));

  const variantStats = await getVariantStats(row.id);

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    messageBody: row.messageBody,
    messageVariants: (row.messageVariants ?? []) as CampaignMessageVariant[],
    ratePerMinute: row.ratePerMinute,
    enrolledTotal: Number(enrolledRow?.n ?? 0),
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    pendingCount: Number(pendingRow?.n ?? 0),
    variantStats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Métricas A/B por variante. Lê o `variantBody` que o dispatcher gravou em
 * raw_payload no momento do envio, agrupa, e calcula reply/qualify rate
 * com subqueries EXISTS.
 */
export async function getVariantStats(campaignId: string): Promise<VariantStat[]> {
  // Carrega definição das variantes pra mapear body → name (display).
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return [];
  const definedVariants = (campaign.messageVariants ?? []) as CampaignMessageVariant[];
  const nameByBody = new Map(definedVariants.map((v) => [v.body, v.name ?? null]));

  const rows = await db.execute<{
    variant_body: string;
    sent_count: number;
    replied_count: number;
    qualified_count: number;
  }>(sql`
    SELECT
      coalesce(m.raw_payload->>'variantBody', ${campaign.messageBody}) as variant_body,
      count(r.id)::int as sent_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${messages} m2
        WHERE m2.conversation_id = r.conversation_id
          AND m2.direction = 'in'
          AND m2.sent_at > r.sent_at
      ))::int as replied_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${leads} l
        WHERE l.id = r.lead_id
          AND l.flow_stage IN ('qualified', 'handed_off')
      ))::int as qualified_count
    FROM ${campaignRecipients} r
    JOIN ${messages} m ON m.id = r.message_id
    WHERE r.campaign_id = ${campaignId}
      AND r.status = 'sent'
    GROUP BY variant_body
    ORDER BY sent_count DESC
  `);

  const list = (rows as { rows?: typeof rows } | typeof rows);
  // drizzle's db.execute returns either { rows } (pg-style) or array. Normalize.
  const arr = Array.isArray(list) ? list : (list as { rows: typeof rows }).rows ?? [];

  return (arr as Array<{ variant_body: string; sent_count: number; replied_count: number; qualified_count: number }>).map((r) => {
    const sent = Number(r.sent_count);
    const replied = Number(r.replied_count);
    const qualified = Number(r.qualified_count);
    return {
      variantBody: r.variant_body,
      variantName: nameByBody.get(r.variant_body) ?? null,
      sentCount: sent,
      repliedCount: replied,
      qualifiedCount: qualified,
      replyRate: sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 10,
      qualifyRate: sent === 0 ? 0 : Math.round((qualified / sent) * 1000) / 10,
    };
  });
}

export async function getContinuousCampaign(): Promise<PublicContinuousCampaign | null> {
  const row = await loadContinuousRow();
  return row ? buildPublic(row) : null;
}

/**
 * Cria a campanha contínua singleton OU atualiza a existente.
 * Apenas admin pode chamar (gateado no controller).
 */
export async function upsertContinuousCampaign(
  userId: string,
  input: UpsertContinuousCampaignInput,
): Promise<PublicContinuousCampaign> {
  validateVariants(input.messageVariants);
  if (input.messageBody !== undefined && !input.messageBody.trim() && (input.messageVariants?.length ?? 0) === 0) {
    throw new HttpError(400, 'Defina ao menos messageBody ou uma variant');
  }

  const existing = await loadContinuousRow();
  if (!existing) {
    if (!input.messageBody && (!input.messageVariants || input.messageVariants.length === 0)) {
      throw new HttpError(400, 'Defina messageBody ou messageVariants ao criar a campanha contínua');
    }
    const [created] = await db
      .insert(campaigns)
      .values({
        name: input.name ?? CONTINUOUS_NAME_DEFAULT,
        status: input.status ?? 'paused',
        messageBody: input.messageBody ?? input.messageVariants?.[0].body ?? '',
        messageVariants: input.messageVariants ?? null,
        ratePerMinute: input.ratePerMinute ?? RATE_DEFAULT,
        isContinuous: true,
        audienceFilter: {},
        audienceTotal: 0,
        createdByUserId: userId,
      })
      .returning();
    return buildPublic(created);
  }

  const patch: Partial<typeof campaigns.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  if (input.messageBody !== undefined) patch.messageBody = input.messageBody;
  if (input.messageVariants !== undefined) patch.messageVariants = input.messageVariants;
  if (input.ratePerMinute !== undefined) patch.ratePerMinute = input.ratePerMinute;

  const [updated] = await db
    .update(campaigns)
    .set(patch)
    .where(eq(campaigns.id, existing.id))
    .returning();
  return buildPublic(updated);
}

function validateVariants(variants: CampaignMessageVariant[] | undefined): void {
  if (!variants) return;
  if (variants.length > 10) throw new HttpError(400, 'Máximo 10 variantes A/B');
  for (const v of variants) {
    if (!v.body || !v.body.trim()) throw new HttpError(400, 'Toda variante precisa de body');
    if (v.body.length > 4000) throw new HttpError(400, 'body de variante excede 4000 chars');
  }
}

// ---------------------------------------------------------------------------
// Auto-enroll — chamado quando lead.flow_stage transita pra 'complete'
// ---------------------------------------------------------------------------

export type EnrollResult =
  | { status: 'enrolled' }
  | { status: 'no_continuous_campaign' }
  | { status: 'campaign_paused' }
  | { status: 'lead_no_phone' }
  | { status: 'already_enrolled' }
  | { status: 'lead_in_cooldown' }
  | { status: 'lead_not_complete'; currentStage: string };

/**
 * Tenta enrolar um lead na campanha contínua. Idempotente — se já existir
 * recipient, retorna already_enrolled. Não lança em condições normais.
 *
 * Promove lead.flow_stage de 'complete' pra 'dispatched' SOMENTE depois que
 * o dispatcher efetivamente enviar a mensagem (no campaignsDispatcher.sendOne).
 */
export async function enrollLeadInContinuous(leadId: string): Promise<EnrollResult> {
  const cont = await loadContinuousRow();
  if (!cont) return { status: 'no_continuous_campaign' };
  if (cont.status === 'paused' || cont.status === 'cancelled' || cont.status === 'completed') {
    return { status: 'campaign_paused' };
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return { status: 'lead_no_phone' };
  if (!lead.phone) return { status: 'lead_no_phone' };
  // Só enrola leads que estão exatamente em 'complete'. Já 'engaged'/'qualified'/etc
  // significa que a conversa já avançou — não disparar de novo.
  if (lead.flowStage !== 'complete') {
    return { status: 'lead_not_complete', currentStage: lead.flowStage };
  }

  // Idempotência: já existe recipient (qualquer status) pra este (campaign, lead)?
  const [existing] = await db
    .select({ id: campaignRecipients.id })
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.campaignId, cont.id),
      eq(campaignRecipients.leadId, leadId),
    ))
    .limit(1);
  if (existing) return { status: 'already_enrolled' };

  const { eligible } = await filterEligibleLeads([leadId], { excludeCampaignId: cont.id });
  if (eligible.length === 0) {
    return { status: 'lead_in_cooldown' };
  }

  await db.insert(campaignRecipients).values({
    campaignId: cont.id,
    leadId,
    phone: lead.phone,
    status: 'pending',
  });

  // Atualiza audience_total (cosmético — usado em métricas).
  await db.update(campaigns)
    .set({ audienceTotal: sql`${campaigns.audienceTotal} + 1`, updatedAt: new Date() })
    .where(eq(campaigns.id, cont.id));

  return { status: 'enrolled' };
}

/**
 * Sweep que tenta enrolar leads em 'complete' ainda não cadastrados como
 * recipient da campanha contínua. Existe para reciclar leads que bouncearam
 * por cooldown — sem isso, um lead que entrou em janela de 24h durante o
 * enrollment hook ficaria fora da campanha pra sempre. Roda dentro do tick
 * do dispatcher (60s).
 */
export async function sweepContinuousReenroll(opts: { limit?: number } = {}): Promise<number> {
  const cont = await loadContinuousRow();
  if (!cont) return 0;
  if (cont.status !== 'running') return 0;

  const limit = opts.limit ?? 50;
  const candidates = await db
    .select({ id: leads.id })
    .from(leads)
    .leftJoin(
      campaignRecipients,
      and(
        eq(campaignRecipients.leadId, leads.id),
        eq(campaignRecipients.campaignId, cont.id),
      ),
    )
    .where(and(
      eq(leads.flowStage, 'complete'),
      sql`${leads.phone} IS NOT NULL`,
      sql`${campaignRecipients.id} IS NULL`,
    ))
    .limit(limit);

  let enrolled = 0;
  for (const c of candidates) {
    const r = await enrollLeadInContinuous(c.id);
    if (r.status === 'enrolled') enrolled++;
  }
  return enrolled;
}

/**
 * Best-effort — chamado de hooks (createLead, updateLead, import, enrich).
 * Errors são logados mas nunca propagados — não queremos quebrar uma operação
 * de lead se a campanha contínua estiver mal configurada.
 */
export async function tryEnrollSafe(leadId: string): Promise<void> {
  try {
    const r = await enrollLeadInContinuous(leadId);
    if (
      r.status !== 'enrolled' &&
      r.status !== 'already_enrolled' &&
      r.status !== 'no_continuous_campaign' &&
      r.status !== 'campaign_paused' &&
      r.status !== 'lead_in_cooldown'
    ) {
      console.log('[continuous] enroll skip:', r.status, leadId);
    }
  } catch (err) {
    console.warn('[continuous] enroll failed for lead', leadId, err);
  }
}

/**
 * Helper pro dispatcher: escolhe uma variante aleatória pra usar.
 * Se messageVariants vazio, usa messageBody legado.
 */
export function pickVariant(c: Campaign): { body: string; mediaUrl: string | null; mediaMime: string | null } {
  const variants = (c.messageVariants ?? []) as CampaignMessageVariant[];
  if (variants.length > 0) {
    const v = variants[Math.floor(Math.random() * variants.length)];
    return {
      body: v.body,
      mediaUrl: v.mediaUrl ?? c.mediaUrl ?? null,
      mediaMime: v.mediaMime ?? c.mediaMime ?? null,
    };
  }
  return {
    body: c.messageBody,
    mediaUrl: c.mediaUrl,
    mediaMime: c.mediaMime,
  };
}
