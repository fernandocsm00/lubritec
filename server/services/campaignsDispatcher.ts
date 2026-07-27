import { db } from '../db/client';
import { campaigns, campaignRecipients, conversations, messages, leads, orgSettings } from '../db/schema';
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
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
let lastTickAt: Date | null = null;

const TICK_INTERVAL_MS = 60_000;
// Retry de falha transiente: total de tentativas por recipient (1 original + 2 retries).
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_MS = 2 * 60_000; // backoff: 2min, 4min
// Re-checa status da campanha (pause/cancel) a cada N envios — antes era a cada
// envio, gerando N queries extras por batch sem necessidade.
const STATUS_CHECK_EVERY = 10;
// 'sending' órfão: claim feito por um processo que morreu antes de concluir.
const STALE_SENDING_MS = 10 * 60_000;

/** Timestamp do último tick concluído — exposto pro healthcheck. */
export function getDispatcherLastTickAt(): Date | null {
  return lastTickAt;
}

/**
 * Falha que vale retry: provider fora do ar (5xx), rate limit (429) ou erro de
 * rede. Erros 4xx e de negócio (lead sem phone, template reprovado) são
 * permanentes — retry só desperdiçaria tentativas.
 */
function isTransientSendError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') return status >= 500 || status === 429;
  const code = String(
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code ?? '',
  );
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|socket hang up|network|timed? ?out/i.test(msg);
}

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
    // Recupera claims órfãos: recipients presos em 'sending' há >10min são de um
    // processo que morreu durante o envio. NÃO voltam pra 'pending' — a mensagem
    // PODE ter sido entregue antes do crash, e re-enviar arriscaria mensagem
    // duplicada pro cliente (risco de ban do chip). Marca failed pra auditoria.
    const stale = await db.update(campaignRecipients).set({
      status: 'failed',
      failureReason: 'interrompido: processo reiniciou durante o envio',
      updatedAt: new Date(),
    }).where(and(
      eq(campaignRecipients.status, 'sending'),
      lt(campaignRecipients.updatedAt, new Date(Date.now() - STALE_SENDING_MS)),
    )).returning({ campaignId: campaignRecipients.campaignId });
    if (stale.length > 0) {
      const byCampaign = new Map<string, number>();
      for (const s of stale) byCampaign.set(s.campaignId, (byCampaign.get(s.campaignId) ?? 0) + 1);
      for (const [campaignId, n] of byCampaign) {
        await db.update(campaigns).set({
          failedCount: sql`${campaigns.failedCount} + ${n}`,
          updatedAt: new Date(),
        }).where(eq(campaigns.id, campaignId));
      }
      console.warn(`[campaigns] ${stale.length} recipient(s) órfãos em 'sending' marcados como failed`);
    }

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
    lastTickAt = new Date();
  } finally {
    isProcessing = false;
  }
}

export async function processCampaign(c: Campaign): Promise<void> {
  const limit = c.ratePerMinute;

  // Claim atômico: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE status='sending'
  // na mesma transação. Duas instâncias do app (ou dois ticks sobrepostos num
  // deploy) nunca reivindicam o mesmo recipient — sem isso a mesma campanha
  // podia disparar em dobro pros mesmos leads.
  // Recipients com next_attempt_at no futuro estão aguardando backoff de retry.
  const recipients = await db.transaction(async (tx) => {
    const rows = await tx.select()
      .from(campaignRecipients)
      .where(and(
        eq(campaignRecipients.campaignId, c.id),
        eq(campaignRecipients.status, 'pending'),
        or(
          isNull(campaignRecipients.nextAttemptAt),
          lte(campaignRecipients.nextAttemptAt, new Date()),
        ),
      ))
      .orderBy(campaignRecipients.createdAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (rows.length > 0) {
      await tx.update(campaignRecipients)
        .set({ status: 'sending', updatedAt: new Date() })
        .where(inArray(campaignRecipients.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  if (recipients.length === 0) {
    if (c.isContinuous) {
      await maybeEmitCooldownAlert(c);
      return;
    }
    // Só completa quando não sobrou NADA pendente — inclusive retries agendados
    // (next_attempt_at futuro), que o claim acima não retorna.
    const [pendingLeft] = await db.select({ n: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(and(
        eq(campaignRecipients.campaignId, c.id),
        inArray(campaignRecipients.status, ['pending', 'sending']),
      ));
    if (pendingLeft.n === 0) {
      await db.update(campaigns).set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(campaigns.id, c.id));
    }
    await maybeEmitCooldownAlert(c);
    return;
  }

  const intervalMs = Math.max(100, Math.floor(60_000 / limit));

  let cursor = 0;
  try {
    for (; cursor < recipients.length; cursor++) {
      // Re-checa pause/cancel a cada N envios (não a cada envio — era 1 query
      // extra por recipient). Pior caso: até N mensagens saem após o pause.
      if (cursor % STATUS_CHECK_EVERY === 0) {
        const [fresh] = await db.select({ status: campaigns.status })
          .from(campaigns).where(eq(campaigns.id, c.id));
        if (!fresh || fresh.status !== 'running') break;
      }

      await sendOne(c, recipients[cursor]);
      await sleep(intervalMs);
    }
  } finally {
    // Devolve pra 'pending' os claims que não chegaram a ser processados
    // (pause/cancel no meio do batch ou erro inesperado). Filtra por status
    // 'sending' pra não sobrescrever os que o sendOne já resolveu.
    const unsent = recipients.slice(cursor).map((r) => r.id);
    if (unsent.length > 0) {
      await db.update(campaignRecipients)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(and(
          inArray(campaignRecipients.id, unsent),
          eq(campaignRecipients.status, 'sending'),
        ));
    }
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

    const provider = await resolveProvider(c.instanceId);

    let sentResult: { providerMsgId: string; rawPayload: unknown };
    let msgBody: string;
    let msgKind: 'text' | 'image' = 'text';
    let msgMediaUrl: string | null = null;
    let msgMediaMime: string | null = null;
    let providerKind: 'uazapi' | 'meta_cloud' = 'uazapi';
    let usedPhone = r.phone;

    // Tentativa de envio. Se falhar e o lead tiver phone2, tenta de novo no
    // numero secundario. Conversation eh criada/buscada com o numero
    // efetivamente utilizado pra nao misturar threads.
    type SendFn = (to: string) => Promise<{ providerMsgId: string; rawPayload: unknown }>;
    let sendFn: SendFn;
    let interpolated = '';
    if (c.hsmTemplateId) {
      const tpl = await getTemplateById(c.hsmTemplateId);
      if (!tpl || tpl.status !== 'APPROVED') {
        throw new Error(`HSM template not approved (status: ${tpl?.status ?? 'not found'})`);
      }
      const variables = resolveHsmVariables(
        (c.hsmVariables as CampaignHsmVariable[] | null) ?? [],
        { lead },
      );
      sendFn = (to) => provider.sendTemplate({
        to,
        templateName: tpl.name,
        language: tpl.language,
        variables,
        // Header de imagem: envia a URL pública (Supabase) como link do header.
        ...(tpl.headerMediaUrl ? { headerMedia: { kind: 'image' as const, url: tpl.headerMediaUrl } } : {}),
      });
      msgBody = tpl.name;
      providerKind = 'meta_cloud';
    } else {
      const variant = c.isContinuous ? pickVariant(c) : { body: c.messageBody, mediaUrl: c.mediaUrl, mediaMime: c.mediaMime };
      interpolated = interpolatePlaceholders(variant.body, lead);
      msgBody = interpolated;
      if (variant.mediaUrl) {
        msgKind = 'image';
        msgMediaUrl = variant.mediaUrl;
        msgMediaMime = variant.mediaMime ?? null;
        sendFn = (to) => provider.sendMedia({
          to,
          kind: 'image',
          mediaUrl: absoluteUrl(variant.mediaUrl!),
          mediaMime: variant.mediaMime ?? undefined,
          caption: interpolated,
        });
      } else {
        sendFn = (to) => provider.sendText({ to, text: interpolated });
      }
      providerKind = provider.kind as 'uazapi' | 'meta_cloud';
    }

    try {
      sentResult = await sendFn(r.phone);
    } catch (primaryErr) {
      // Fallback Telefone 2: tenta se houver phone2 cadastrado e diferente do
      // phone1. Se T2 tambem falhar, propaga o erro original do T1 (mais
      // informativo do que o do T2).
      if (lead.phone2 && lead.phone2 !== r.phone) {
        try {
          sentResult = await sendFn(lead.phone2);
          usedPhone = lead.phone2;
        } catch {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    const conv = await getOrCreateConversationForCampaign(usedPhone, lead.id, c.id, c.instanceId);

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
    // Falha transiente (provider 5xx/429, rede): devolve pra 'pending' com
    // backoff exponencial em vez de queimar o recipient — instabilidade de
    // minutos no UazAPI deixava de entregar mensagens definitivamente.
    const attempt = r.attemptCount + 1;
    if (isTransientSendError(err) && attempt < MAX_SEND_ATTEMPTS) {
      const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      await db.update(campaignRecipients).set({
        status: 'pending',
        attemptCount: attempt,
        nextAttemptAt: new Date(Date.now() + delayMs),
        failureReason: `tentativa ${attempt}/${MAX_SEND_ATTEMPTS} falhou (transiente, retry em ${Math.round(delayMs / 60_000)}min): ${String(err).slice(0, 400)}`,
        updatedAt: new Date(),
      }).where(eq(campaignRecipients.id, r.id));
      return;
    }

    await db.update(campaignRecipients).set({
      status: 'failed',
      attemptCount: attempt,
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
  // Lookup tem que filtrar por (instance_id, phone) — alinhado com o webhook
  // e com o UNIQUE index. Sem instanceId o dispatcher podia pegar conversa de
  // outra instancia, causando mensagens cruzadas.
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.instanceId, instanceId), eq(conversations.phone, phone)))
    .limit(1);
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
