import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import { decryptSecret } from '../lib/crypto';
import { INBOUND_MEDIA_KINDS, isInboundMediaFallbackLabel, type PublicMessage } from '@shared/types';
import { loadPublicMessage } from './conversationsService';
import { loadMetaInstance } from './whatsapp/metaCloud/webhookHandler';
import { metaMediaRef, fetchAndPersistMetaMedia } from './whatsapp/metaCloud/inboundMedia';
import { MetaGraphError } from './whatsapp/metaCloud/client';
import { downloadUazapiMedia } from './whatsapp/uazapi/client';
import { loadSendConfig } from './whatsappInstanceService';
import { persistInboundMedia } from './whatsapp/inboundMediaStore';

/**
 * "Tentar de novo" da Inbox: baixa outra vez o arquivo de uma mensagem RECEBIDA
 * que ficou sem mídia (download falhou no webhook — token vencido, instabilidade,
 * disco). Usa o que o ingest guardou: media id no raw_payload (Meta) ou o
 * provider_msg_id (UazAPI). Se der certo, troca o rótulo fallback pelo arquivo.
 */
export async function retryInboundMedia(conversationId: string, messageId: string): Promise<PublicMessage> {
  const [row] = await db
    .select({ msg: messages, instanceId: conversations.instanceId })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row || row.msg.conversationId !== conversationId) throw new HttpError(404, 'Message not found');

  const { msg } = row;
  if (msg.direction !== 'in' || !(INBOUND_MEDIA_KINDS as readonly string[]).includes(msg.kind)) {
    throw new HttpError(400, 'Só dá pra recarregar arquivo de mensagem recebida');
  }
  // Idempotente: clique duplo ou outra aba já resolveu.
  if (msg.mediaUrl?.startsWith('/uploads/')) return loadPublicMessage(messageId);

  let saved: { mediaUrl: string; mediaMime: string | null };
  try {
    saved = msg.provider === 'meta_cloud'
      ? await downloadFromMeta(row.instanceId, msg.rawPayload, msg.kind)
      : await downloadFromUazapi(row.instanceId, msg.providerMsgId, msg.mediaMime);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[inbound-media-retry] download failed:', messageId, err);
    throw new HttpError(502, describeFailure(err));
  }

  await db
    .update(messages)
    .set({
      mediaUrl: saved.mediaUrl,
      mediaMime: saved.mediaMime,
      // O rótulo ("🎵 Áudio") só existia porque faltava o arquivo; legenda real fica.
      ...(isInboundMediaFallbackLabel(msg.body) ? { body: null } : {}),
    })
    .where(eq(messages.id, messageId));

  return loadPublicMessage(messageId);
}

async function downloadFromMeta(instanceId: string, rawPayload: unknown, kind: typeof messages.$inferSelect.kind) {
  const ref = metaMediaRef(rawPayload, kind);
  if (!ref) throw new HttpError(409, 'A mensagem não guardou a referência do arquivo — não dá pra baixar de novo');
  const inst = await loadMetaInstance(instanceId);
  if (!inst) throw new HttpError(409, 'A linha dessa conversa não é mais uma linha oficial da Meta');
  return fetchAndPersistMetaMedia({
    mediaId: ref.mediaId,
    mimeHint: ref.mime,
    accessToken: decryptSecret(inst.cfg.accessToken),
  });
}

async function downloadFromUazapi(instanceId: string, providerMsgId: string | null, mimeHint: string | null) {
  if (!providerMsgId) throw new HttpError(409, 'A mensagem não guardou o id do WhatsApp — não dá pra baixar de novo');
  const cfg = await loadSendConfig(instanceId);
  const { buffer, mime } = await downloadUazapiMedia(providerMsgId, { baseUrl: cfg.baseUrl, token: cfg.token });
  const resolvedMime = mime ?? mimeHint;
  return { mediaUrl: await persistInboundMedia(buffer, resolvedMime), mediaMime: resolvedMime };
}

function describeFailure(err: unknown): string {
  if (err instanceof MetaGraphError) {
    // 190 = access token inválido/expirado (vem com 401 ou 400).
    if (err.status === 401 || err.code === 190) {
      return 'A Meta recusou a credencial dessa linha (token expirado). Atualize o token e tente de novo.';
    }
    if (err.status === 404 || err.status === 400) {
      return 'O arquivo não está mais disponível no WhatsApp (a Meta guarda por tempo limitado).';
    }
    return `A Meta não entregou o arquivo (erro ${err.status}).`;
  }
  return 'Não foi possível baixar o arquivo agora. Tente de novo em instantes.';
}
