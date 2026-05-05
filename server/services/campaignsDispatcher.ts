import { db } from '../db/client';
import { campaigns, campaignRecipients, conversations, messages, leads } from '../db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Campaign, CampaignRecipient, Lead } from '../db/schema';
import { uazapiClient } from './uazapiClient';

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

    for (const c of running) {
      await processCampaign(c);
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
    // Tudo processado → completed
    await db.update(campaigns).set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    return;
  }

  const intervalMs = Math.max(100, Math.floor(60_000 / limit));

  for (const r of recipients) {
    // Re-check status (cancel/pause entre iterações)
    const [fresh] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, c.id));
    if (!fresh || fresh.status !== 'running') break;

    await sendOne(c, r);
    await sleep(intervalMs);
  }
}

async function sendOne(c: Campaign, r: CampaignRecipient): Promise<void> {
  try {
    const [lead] = await db.select().from(leads).where(eq(leads.id, r.leadId)).limit(1);
    if (!lead) throw new Error('Lead not found');

    const interpolated = interpolatePlaceholders(c.messageBody, lead);
    const conv = await getOrCreateConversationForCampaign(r.phone, lead.id, c.id);

    const resp = c.mediaUrl
      ? await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'image',
          mediaUrl: absoluteUrl(c.mediaUrl),
          mediaMime: c.mediaMime ?? undefined,
          text: interpolated,
        })
      : await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'text',
          text: interpolated,
        });

    const sentAt = new Date();
    const [msg] = await db.insert(messages).values({
      conversationId: conv.id,
      direction: 'out',
      kind: c.mediaUrl ? 'image' : 'text',
      body: interpolated,
      mediaUrl: c.mediaUrl ?? null,
      mediaMime: c.mediaMime ?? null,
      sentByUserId: c.createdByUserId,
      uazapiMsgId: resp.messageId,
      rawPayload: resp.rawPayload as object,
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

async function getOrCreateConversationForCampaign(phone: string, leadId: string, campaignId: string) {
  const [existing] = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(conversations).values({
    phone,
    leadId,
    queue: 'comercial',  // disparos vão pra Comercial
    status: 'em_atendimento',
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
