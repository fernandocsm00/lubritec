import crypto from 'node:crypto';
import { db } from '../../../db/client';
import { whatsappInstance } from '../../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { decryptSecret } from '../../../lib/crypto';
import { metaCloudConfigSchema, type MetaCloudConfig } from './configSchema';
import { ingestInboundMessage, type NormalizedInbound } from '../../whatsappWebhookService';
import { processInboundWithAi } from '../../aiAtendimento';
import { getMediaUrl, downloadMedia } from './client';
import { persistInboundMedia } from '../inboundMediaStore';
import type { MessageKind } from '@shared/types';
import { updateTemplateStatus } from '../../hsmTemplateService';
import { toCanonicalBrPhone } from '../../../lib/phoneBR';

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
  // "Responder citando": id (wamid) da mensagem que o lead citou.
  context?: { id?: string };
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

/**
 * Resolve a instância meta_cloud dona de um valor de config (phoneNumberId ou
 * wabaId), lido do payload do webhook.
 *
 * Por quê: a Meta permite UMA callback URL por App, mas um App pode ter vários
 * números (WABAs). Como a URL carrega o instanceId, sem isto só a instância da
 * URL receberia inbound. Roteando pelo phone_number_id do payload, uma URL só
 * atende todas as linhas do mesmo App. `field` é sempre um literal controlado
 * (não vem do usuário), então a interpolação no ->> é segura.
 */
async function resolveMetaInstanceByConfig(
  field: 'phoneNumberId' | 'wabaId',
  value: string,
): Promise<{ instanceId: string; cfg: MetaCloudConfig } | null> {
  const [row] = await db.select().from(whatsappInstance)
    .where(and(
      eq(whatsappInstance.provider, 'meta_cloud'),
      sql`${whatsappInstance.providerConfig} ->> ${field} = ${value}`,
    ))
    .limit(1);
  if (!row) return null;
  const parsed = metaCloudConfigSchema.safeParse(row.providerConfig);
  if (!parsed.success) return null;
  return { instanceId: row.id, cfg: parsed.data };
}

export function resolveMetaInstanceByPhoneNumberId(phoneNumberId: string) {
  return resolveMetaInstanceByConfig('phoneNumberId', phoneNumberId);
}

export function resolveMetaInstanceByWabaId(wabaId: string) {
  return resolveMetaInstanceByConfig('wabaId', wabaId);
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
      // A URL da Meta (lookaside) é efêmera e exige Bearer token — inutilizável
      // direto num <img>. Resolve, baixa o binário com o token AGORA (enquanto a
      // URL é válida) e persiste local; grava a URL local servida pelo /uploads.
      const { url, mimeType } = await getMediaUrl({ mediaId: media.mediaId, accessToken });
      const { buffer, mimeType: downloadedMime } = await downloadMedia({ url, accessToken });
      const resolvedMime = downloadedMime ?? mimeType ?? media.mime;
      mediaUrl = await persistInboundMedia(buffer, resolvedMime);
      mediaMime = mimeType ?? media.mime;
    } catch (err) {
      // Não grava a URL lookaside como fallback (geraria imagem quebrada). Sem
      // mediaUrl, a UI mostra só a legenda/texto. O raw_payload guarda o media
      // id pra um eventual reprocessamento.
      console.warn('[meta-webhook] failed to download/persist inbound media:', err);
    }
  }
  const normalized: NormalizedInbound = {
    instanceId,
    provider: 'meta_cloud',
    // Normaliza pra forma canonica BR (com 55 + 9 prefix). Sem isso o mesmo
    // numero pode virar leads/conversations duplicadas. Ver phoneBR.ts.
    leadPhone: toCanonicalBrPhone(msg.from) ?? msg.from.replace(/\D/g, ''),
    leadName: contactName,
    kind,
    text: extractText(msg),
    mediaUrl,
    mediaMime,
    providerMsgId: msg.id,
    replyToProviderMsgId: msg.context?.id ?? null,
    sentAt: new Date(parseInt(msg.timestamp, 10) * 1000),
    rawPayload: msg,
  };
  const ingestResult = await ingestInboundMessage(normalized);

  // Dispara a IA de atendimento em background (fire-and-forget) — espelha o que o
  // webhook da UazAPI ja fazia. Sem isto a linha Meta (que eh a padrao e a que faz
  // os disparos) so marcava pending_ai_response e dependia do aiPendingWorker:
  // na pratica a IA nunca respondia quem respondia campanha.
  // Só texto recem-inserido: duplicata/midia nao aciona (a IA so processa texto).
  if (
    ingestResult.status === 'inserted' &&
    ingestResult.conversationId &&
    ingestResult.leadId &&
    normalized.kind === 'text' &&
    normalized.text
  ) {
    const convId = ingestResult.conversationId;
    const leadId = ingestResult.leadId;
    const inboundText = normalized.text;
    const phone = normalized.leadPhone;
    processInboundWithAi({ conversationId: convId, leadId, phone, inboundText })
      .then((r) => {
        if (r.status === 'gemini_error' || r.status === 'send_error') {
          console.error('[ai] processInbound failed:', r.status, r.errorMessage);
        } else {
          console.log('[ai] processInbound:', r.status);
        }
      })
      .catch((err) => {
        console.error('[ai] processInbound threw:', err);
      });
  }
}

export async function processMetaWebhook(
  fallbackInstanceId: string,
  fallbackCfg: MetaCloudConfig,
  body: MetaWebhookBody,
): Promise<void> {
  const fallback = { instanceId: fallbackInstanceId, cfg: fallbackCfg };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'messages' && change.value.messages) {
        // Roteia pela linha dona do phone_number_id do payload; fallback = instância da URL.
        const phoneNumberId = change.value.metadata?.phone_number_id;
        const target = (phoneNumberId
          ? await resolveMetaInstanceByPhoneNumberId(phoneNumberId)
          : null) ?? fallback;
        const accessToken = decryptSecret(target.cfg.accessToken);
        const contactName = change.value.contacts?.[0]?.profile?.name;
        let ingestedAny = false;
        for (const msg of change.value.messages) {
          try {
            await processOneMessage(target.instanceId, accessToken, contactName, msg);
            ingestedAny = true;
          } catch (err) {
            console.error('[meta-webhook] message ingest failed:', err);
          }
        }
        // Recebeu inbound de fato → marca a assinatura na linha certa (idempotente),
        // pra UI não mostrar "webhook não assinado" numa linha que já funciona via URL compartilhada.
        if (ingestedAny) {
          markWebhookSubscribed(target.instanceId).catch(() => { /* best-effort */ });
        }
      }
      if (change.field === 'message_template_status_update') {
        // Status de template é por WABA (entry.id) — roteia pela linha dona da WABA.
        const target = (entry.id
          ? await resolveMetaInstanceByWabaId(entry.id)
          : null) ?? fallback;
        const v = change.value as unknown as {
          event?: string;
          message_template_id?: number | string;
          message_template_name?: string;
          message_template_language?: string;
          reason?: string | null;
        };
        if (!v.event || !v.message_template_name || !v.message_template_language || v.message_template_id === undefined) {
          console.warn('[meta-webhook] incomplete template status payload:', v);
          continue;
        }
        try {
          await updateTemplateStatus({
            instanceId: target.instanceId,
            metaTemplateId: String(v.message_template_id),
            name: v.message_template_name,
            language: v.message_template_language,
            status: v.event,
            reason: v.reason ?? null,
          });
        } catch (err) {
          console.error('[meta-webhook] template status update failed:', err);
        }
      }
      // other status updates: ignored in v1
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
