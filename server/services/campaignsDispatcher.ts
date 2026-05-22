import { db } from '../db/client';
import { campaigns, campaignRecipients, conversations, messages, leads, orgSettings } from '../db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Campaign, CampaignRecipient, Lead } from '../db/schema';
import { isWithinDispatchWindow, pickVariant, sweepContinuousReenroll } from './continuousCampaign';
import { recordTransition } from './stageTransitions';
import { filterEligibleLeads, COOLDOWN_REASON } from './campaignsCooldown';
import { emitNotification } from './notifications';
import { resolveProvider } from './whatsapp/providerRegistry';
import { getTemplateById, resolveHsmVariables } from './hsmTemplateService';
import type { ConversationQueue, CampaignHsmVariable } from '@shared/types';

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

const TICK_INTERVAL_MS = 60_000;

export function startDispatcher() {
  if (timer) return;
  timer = setInterval(() => {
    if (!isProcessing) void tick();
  }, TICK_INTERVAL_MS);
  // primeira execução após 5s pra não competir com boot
  setTimeout(() => { if (!isProcessing) void tick(); }, 5_000);
}

export function stopDispatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    // Promove scheduled → running
    await db.update(campaigns).set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(campaigns.status, 'scheduled'),
      lte(campaigns.scheduledAt, new Date()),
    ));

    const running = await db.select().from(campaigns).where(eq(campaigns.status, 'running'));

    // Janela horária — só calcula 1x por tick.
    const window = await isWithinDispatchWindow();

    for (const c of running) {
      // Campanhas contínuas respeitam horário comercial.
      // Campanhas one-shot (manuais) seguem como antes (controle pelo admin).
      if (c.isContinuous && !window.ok) {
        continue;
      }
      await processCampaign(c);
    }

    // Reciclar leads 'complete' que ficaram fora da campanha contínua por
    // cooldown ou outras pendências transitórias. Best-effort, não-bloqueante.
    try {
      await sweepContinuousReenroll({ limit: 50 });
    } catch (e) {
      console.warn('[continuous-reenroll] sweep failed:', e);
    }
  } finally {
    isProcessing = false;
  }
}

export async function processCampaign(c: Campaign): Promise<void> {
  const limit = c.ratePerMinute;
  const recipients = await db.select()
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.campaignId, c.id),
      eq(campaignRecipients.status, 'pending'),
    ))
    .limit(limit);

  if (recipients.length === 0) {
    if (c.isContinuous) {
      await maybeEmitCooldownAlert(c);
      return;
    }
    await db.update(campaigns).set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    await maybeEmitCooldownAlert(c);
    return;
  }

  const intervalMs = Math.max(100, Math.floor(60_000 / limit));

  for (const r of recipients) {
    const [fresh] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, c.id));
    if (!fresh || fresh.status !== 'running') break;

    await sendOne(c, r);
    await sleep(intervalMs);
  }

  await maybeEmitCooldownAlert(c);
}

async function maybeEmitCooldownAlert(c: Campaign): Promise<void> {
  if (c.cooldownAlertSentAt) return;
  if (c.audienceTotal <= 0) return;

  const [counts] = await db.select({
    n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = ${COOLDOWN_REASON})::int`,
  }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));

  const ratio = counts.n / c.audienceTotal;
  if (ratio <= 0.10) return;

  await emitNotification({
    toRoles: ['admin'],
    kind: 'campaign_cooldown_high',
    title: 'Muitos leads pulados por cooldown',
    body: `Campanha "${c.name}": ${counts.n} de ${c.audienceTotal} leads pulados (janela de 24h).`,
    actionUrl: `/campaigns/${c.id}?recipientStatus=skipped`,
    metadata: {
      campaignId: c.id,
      campaignName: c.name,
      skippedCount: counts.n,
      audienceTotal: c.audienceTotal,
      ratio,
    },
  });

  await db.update(campaigns)
    .set({ cooldownAlertSentAt: new Date(), updatedAt: new Date() })
    .where(eq(campaigns.id, c.id));
}

async function sendOne(c: Campaign, r: CampaignRecipient): Promise<void> {
  // Safety net: cooldown pode ter ativado entre criação e dispatch.
  // Re-checa no momento do envio. excludeCampaignId evita que a própria
  // pendência (que ainda está como 'pending' aqui) bloqueie o envio.
  const { eligible } = await filterEligibleLeads([r.leadId], { excludeCampaignId: c.id });
  if (eligible.length === 0) {
    await db.update(campaignRecipients).set({
      status: 'skipped',
      failureReason: COOLDOWN_REASON,
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));
    await db.update(campaigns).set({
      skippedCount: sql`${campaigns.skippedCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    return;
  }

  try {
    const [lead] = await db.select().from(leads).where(eq(leads.id, r.leadId)).limit(1);
    if (!lead) throw new Error('Lead not found');

    const conv = await getOrCreateConversationForCampaign(r.phone, lead.id, c.id, c.instanceId);
    const provider = await resolveProvider(c.instanceId);

    let sentResult: { providerMsgId: string; rawPayload: unknown };
    let msgBody: string;
    let msgKind: 'text' | 'image' = 'text';
    let msgMediaUrl: string | null = null;
    let msgMediaMime: string | null = null;
    let providerKind: 'uazapi' | 'meta_cloud' = 'uazapi';

    if (c.hsmTemplateId) {
      // ── HSM (Meta Cloud) path ─────────────────────────────────────────────
      const tpl = await getTemplateById(c.hsmTemplateId);
      if (!tpl || tpl.status !== 'APPROVED') {
        throw new Error(`HSM template not approved (status: ${tpl?.status ?? 'not found'})`);
      }
      const variables = resolveHsmVariables(
        (c.hsmVariables as CampaignHsmVariable[] | null) ?? [],
        { lead },
      );
      sentResult = await provider.sendTemplate({
        to: r.phone,
        templateName: tpl.name,
        language: tpl.language,
        variables,
      });
      msgBody = tpl.name;   // store template name as body for message record
      providerKind = 'meta_cloud';
    } else {
      // ── Free-form (UazAPI) path ────────────────────────────────────────────
      // Continuous: escolhe variant random (A/B). One-shot: usa messageBody.
      const variant = c.isContinuous ? pickVariant(c) : { body: c.messageBody, mediaUrl: c.mediaUrl, mediaMime: c.mediaMime };
      const interpolated = interpolatePlaceholders(variant.body, lead);
      msgBody = interpolated;

      if (variant.mediaUrl) {
        msgKind = 'image';
        msgMediaUrl = variant.mediaUrl;
        msgMediaMime = variant.mediaMime ?? null;
        sentResult = await provider.sendMedia({
          to: r.phone,
          kind: 'image',
          mediaUrl: absoluteUrl(variant.mediaUrl),
          mediaMime: variant.mediaMime ?? undefined,
          caption: interpolated,
        });
      } else {
        sentResult = await provider.sendText({ to: r.phone, text: interpolated });
      }
      providerKind = provider.kind as 'uazapi' | 'meta_cloud';
    }

    const sentAt = new Date();
    const [msg] = await db.insert(messages).values({
      conversationId: conv.id,
      direction: 'out',
      kind: msgKind,
      body: msgBody,
      mediaUrl: msgMediaUrl,
      mediaMime: msgMediaMime,
      sentByUserId: c.createdByUserId,
      providerMsgId: sentResult.providerMsgId,
      provider: providerKind,
      rawPayload: sentResult.rawPayload as object,
      sentAt,
    }).returning();

    await db.update(campaignRecipients).set({
      status: 'sent',
      sentAt,
      conversationId: conv.id,
      messageId: msg.id,
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));

    await db.update(campaigns).set({
      sentCount: sql`${campaigns.sentCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));

    await db.update(conversations).set({
      lastMessageAt: sentAt,
      updatedAt: new Date(),
    }).where(eq(conversations.id, conv.id));

    // Promove lead.flow_stage de complete → dispatched (continuous + one-shot).
    // Só promove se ainda estiver em 'complete' — não regride stages avançados.
    const promoted = await db.update(leads)
      .set({ flowStage: 'dispatched', updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.flowStage, 'complete')))
      .returning({ id: leads.id });
    if (promoted.length > 0) {
      await recordTransition({
        leadId: lead.id,
        fromStage: 'complete',
        toStage: 'dispatched',
        source: 'campaign_dispatch',
        metadata: { campaignId: c.id, conversationId: conv.id, isContinuous: c.isContinuous },
      });
    }
  } catch (err) {
    await db.update(campaignRecipients).set({
      status: 'failed',
      failureReason: String(err).slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));
    await db.update(campaigns).set({
      failedCount: sql`${campaigns.failedCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
  }
}

async function defaultCampaignQueue(): Promise<ConversationQueue> {
  // Quando IA está ativa, conversa vai pra fila IA (alinhado ao fluxo macro:
  // disparo → cliente responde → IA qualifica → comercial). Quando IA off,
  // cai em recepcao pra humanos atenderem.
  const [s] = await db.select({ aiEnabled: orgSettings.aiEnabled }).from(orgSettings).limit(1);
  return s?.aiEnabled ? 'ia' : 'recepcao';
}

async function getOrCreateConversationForCampaign(
  phone: string,
  leadId: string,
  campaignId: string,
  instanceId: string,
) {
  const [existing] = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
  if (existing) return existing;

  const queue = await defaultCampaignQueue();
  const [created] = await db.insert(conversations).values({
    phone,
    instanceId,
    leadId,
    queue,
    status: queue === 'ia' ? 'aguardando_atendimento' : 'em_atendimento',
    originKind: 'campaign',
    originCampaignId: campaignId,
    lastMessageAt: new Date(),
  }).returning();
  return created;
}

export function interpolatePlaceholders(body: string, lead: Lead): string {
  // Lead com phone null não chega aqui (resolveAudience filtra). Defensivo:
  const phoneFormatted = lead.phone ? formatPhoneBR(lead.phone) : '';
  return body
    .replaceAll('{{nome}}', lead.name)
    .replaceAll('{{telefone}}', phoneFormatted)
    .replaceAll('{{cnpj}}', lead.cnpj ?? '');
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone;
}

function absoluteUrl(relativePath: string): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) return relativePath;
  return `${appUrl.replace(/\/$/, '')}${relativePath}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
