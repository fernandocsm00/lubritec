import crypto from 'node:crypto';
import { db } from '../../../db/client';
import { whatsappInstance } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { decryptSecret } from '../../../lib/crypto';
import { metaCloudConfigSchema, type MetaCloudConfig } from './configSchema';
import { ingestInboundMessage, type NormalizedInbound } from '../../whatsappWebhookService';
import { getMediaUrl } from './client';
import type { MessageKind } from '@shared/types';

interface MetaInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; caption?: string; filename?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: { phone_number_id: string; display_phone_number: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: MetaInboundMessage[];
  statuses?: Array<unknown>;
}

interface MetaWebhookEntry {
  id: string;
  changes: Array<{ field: string; value: MetaWebhookValue }>;
}

export interface MetaWebhookBody {
  object: string;
  entry: MetaWebhookEntry[];
}

export async function loadMetaInstance(instanceId: string): Promise<{
  cfg: MetaCloudConfig;
  rowId: string;
} | null> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row || row.provider !== 'meta_cloud') return null;
  return { cfg: metaCloudConfigSchema.parse(row.providerConfig), rowId: row.id };
}

export function verifyHmac(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function mapKind(type: string): MessageKind | null {
  switch (type) {
    case 'text': return 'text';
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'document': return 'document';
    case 'button': return 'text';
    case 'interactive': return 'text';
    default: return null;
  }
}

function extractText(msg: MetaInboundMessage): string | undefined {
  if (msg.text) return msg.text.body;
  if (msg.button) return msg.button.text;
  if (msg.interactive?.button_reply) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply) return msg.interactive.list_reply.title;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.caption) return msg.document.caption;
  return undefined;
}

function extractMediaId(msg: MetaInboundMessage): { mediaId: string; mime: string } | null {
  if (msg.image) return { mediaId: msg.image.id, mime: msg.image.mime_type };
  if (msg.video) return { mediaId: msg.video.id, mime: msg.video.mime_type };
  if (msg.audio) return { mediaId: msg.audio.id, mime: msg.audio.mime_type };
  if (msg.document) return { mediaId: msg.document.id, mime: msg.document.mime_type };
  return null;
}

async function processOneMessage(
  instanceId: string,
  accessToken: string,
  contactName: string | undefined,
  msg: MetaInboundMessage,
): Promise<void> {
  const kind = mapKind(msg.type);
  if (!kind) {
    console.warn('[meta-webhook] unsupported message type:', msg.type);
    return;
  }
  let mediaUrl: string | undefined;
  let mediaMime: string | undefined;
  const media = extractMediaId(msg);
  if (media) {
    try {
      const { url, mimeType } = await getMediaUrl({ mediaId: media.mediaId, accessToken });
      mediaUrl = url;
      mediaMime = mimeType;
    } catch (err) {
      console.warn('[meta-webhook] failed to resolve media URL:', err);
    }
  }
  const normalized: NormalizedInbound = {
    instanceId,
    provider: 'meta_cloud',
    leadPhone: msg.from,
    leadName: contactName,
    kind,
    text: extractText(msg),
    mediaUrl,
    mediaMime,
    providerMsgId: msg.id,
    sentAt: new Date(parseInt(msg.timestamp, 10) * 1000),
    rawPayload: msg,
  };
  await ingestInboundMessage(normalized);
}

export async function processMetaWebhook(
  instanceId: string,
  cfg: MetaCloudConfig,
  body: MetaWebhookBody,
): Promise<void> {
  const accessToken = decryptSecret(cfg.accessToken);
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'messages' && change.value.messages) {
        const contactName = change.value.contacts?.[0]?.profile?.name;
        for (const msg of change.value.messages) {
          try {
            await processOneMessage(instanceId, accessToken, contactName, msg);
          } catch (err) {
            console.error('[meta-webhook] message ingest failed:', err);
          }
        }
      }
      // status updates + template status: v1 ignores (Plan C handles templates)
    }
  }
}

export async function markWebhookSubscribed(instanceId: string): Promise<void> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row || row.provider !== 'meta_cloud') return;
  const cfg = metaCloudConfigSchema.parse(row.providerConfig);
  if (cfg.webhookSubscribed) return;
  const next: MetaCloudConfig = { ...cfg, webhookSubscribed: true };
  await db.update(whatsappInstance)
    .set({ providerConfig: next, updatedAt: new Date() })
    .where(eq(whatsappInstance.id, instanceId));
}
