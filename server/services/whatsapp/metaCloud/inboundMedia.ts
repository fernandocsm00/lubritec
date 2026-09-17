import type { MessageKind } from '@shared/types';
import { getMediaUrl, downloadMedia } from './client';
import { persistInboundMedia } from '../inboundMediaStore';

/**
 * Referência da mídia dentro da mensagem da Meta (o `raw_payload` gravado no
 * ingest é a própria mensagem): `{ type: 'audio', audio: { id, mime_type } }`.
 * Serve tanto pro webhook quanto pro "Tentar de novo" da Inbox.
 */
export function metaMediaRef(
  rawMessage: unknown,
  kind: MessageKind,
): { mediaId: string; mime: string | null } | null {
  if (!rawMessage || typeof rawMessage !== 'object') return null;
  const media = (rawMessage as Record<string, unknown>)[kind];
  if (!media || typeof media !== 'object') return null;
  const { id, mime_type } = media as { id?: unknown; mime_type?: unknown };
  if (typeof id !== 'string' || !id) return null;
  return { mediaId: id, mime: typeof mime_type === 'string' ? mime_type : null };
}

/**
 * Resolve o media id na Graph API, baixa o binário com o token AGORA (a URL
 * lookaside expira em minutos e exige Bearer) e persiste em /uploads/inbound.
 * Propaga o erro — quem chama decide se engole (webhook) ou mostra (retry).
 */
export async function fetchAndPersistMetaMedia(input: {
  mediaId: string;
  mimeHint: string | null;
  accessToken: string;
}): Promise<{ mediaUrl: string; mediaMime: string | null }> {
  const { url, mimeType } = await getMediaUrl({ mediaId: input.mediaId, accessToken: input.accessToken });
  const { buffer, mimeType: downloadedMime } = await downloadMedia({ url, accessToken: input.accessToken });
  const resolvedMime = downloadedMime ?? mimeType ?? input.mimeHint;
  const mediaUrl = await persistInboundMedia(buffer, resolvedMime);
  return { mediaUrl, mediaMime: mimeType ?? input.mimeHint };
}
