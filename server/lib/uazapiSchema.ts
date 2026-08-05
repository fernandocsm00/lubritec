import { z } from 'zod';
import type { MessageKind } from '@shared/types';

/**
 * Schema do payload de webhook da uazapiGO — DEFENSIVO.
 *
 * Diferentes versões da uazapiGO usam diferentes naming conventions
 * (`event` vs `EventType`, `id` vs `messageid`, `from` vs `sender`/`chatid`,
 * `type` vs `messageType`, etc.). Em vez de exigir um shape rígido, aceitamos
 * o JSON cru e fazemos a extração tolerante via `extractInbound()`.
 *
 * Para diagnóstico em produção: o controller loga `req.body` cru ANTES de
 * chamar este parse, então mesmo se a extração falhar a operação pode ser
 * inspecionada nos logs do EasyPanel.
 */
export const uazapiInboundSchema = z.record(z.string(), z.unknown());
export type UazapiInbound = z.infer<typeof uazapiInboundSchema>;

// ---------------------------------------------------------------------------
// Extração tolerante
// ---------------------------------------------------------------------------

export interface InboundMessage {
  id: string;
  from: string;
  contactName: string | null;
  text: string | null;
  kind: MessageKind;
  /**
   * URL da mídia. Sai daqui como a URL CRUA do provider (CDN do WhatsApp,
   * conteúdo cifrado — não renderizável) e é SUBSTITUÍDA pela URL local por
   * `materializeInboundMedia()` antes do ingest. Ver uazapi/inboundMedia.ts.
   */
  mediaUrl: string | null;
  mediaMime: string | null;
  /** Figurinha — muda só o label fallback ("🎞️ Figurinha" em vez de "🖼️ Imagem"). */
  isSticker: boolean;
  timestamp: Date;
  fromMe: boolean;
}

/** Eventos que indicam mensagem recebida — verifica por substring (uazapiGO varia). */
function isMessageEvent(value: string | null): boolean {
  if (!value) return true; // sem evento explícito → assume mensagem
  const e = value.toLowerCase();
  return e.includes('message') || e.includes('messages') || e.includes('upsert') || e.includes('receive');
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickBool(obj: Record<string, unknown> | undefined, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
  }
  return false;
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Mapeia o `type`/`messageType`/`mediaType` da uazapiGO pro nosso MessageKind.
 *  Stickers viram 'image' (sao WebP) — quem distingue stickers eh o fallback
 *  de body pra mostrar "🎞️ Figurinha" no UI. */
function mapKind(raw: string | null): MessageKind {
  if (!raw) return 'unknown';
  const t = raw.toLowerCase();
  if (t === 'text' || t === 'conversation' || t === 'extendedtextmessage') return 'text';
  if (t === 'sticker' || t.includes('sticker')) return 'image';
  if (t === 'image' || t.includes('image')) return 'image';
  if (t === 'audio' || t.includes('audio') || t.includes('ptt')) return 'audio';
  if (t === 'video' || t.includes('video')) return 'video';
  if (t === 'document' || t.includes('document')) return 'document';
  return 'unknown';
}

/** Texto fallback pra bubble nao ficar em branco quando nao da pra renderizar
 *  a media (sem URL, kind nao suportado, download falhou, etc). */
export function fallbackBodyFor(kind: MessageKind, isSticker: boolean): string {
  if (isSticker) return '🎞️ Figurinha';
  if (kind === 'image') return '🖼️ Imagem';
  if (kind === 'audio') return '🎵 Áudio';
  if (kind === 'video') return '🎬 Vídeo';
  if (kind === 'document') return '📎 Documento';
  return '📎 Mensagem não suportada';
}

/** URLs placeholder que uazapiGO manda em vez de download direto.
 *  https://a.whatsapp.net eh marker; directPath eh path encriptado nao baixavel sem mediaKey. */
function isUsableMediaUrl(url: string | null | undefined): boolean {
  if (!url || url.length < 20) return false;
  const lower = url.toLowerCase();
  if (lower === 'https://a.whatsapp.net' || lower === 'https://a.whatsapp.net/') return false;
  return /^https?:\/\//.test(url);
}

function parseTimestamp(v: unknown): Date {
  if (typeof v === 'number') {
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) {
      return new Date(n < 1e12 ? n * 1000 : n);
    }
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Tenta extrair uma mensagem inbound do payload bruto. Retorna null se:
 * - O evento não é de mensagem recebida.
 * - Não há objeto de mensagem.
 * - Faltam campos essenciais (id, from).
 * - É mensagem outbound (`fromMe: true`) — já gravamos via sendMessage.
 */
/** Extrai telefone preferindo JIDs com `@` (mais confiáveis). Igual estratégia APP_ORION. */
function extractFrom(msg: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  const key = asObj(msg.key) ?? {};
  const chat = asObj(payload.chat) ?? {};

  // 1. Campos explicitamente "phone"
  const phoneCandidates = [
    pickString(msg, ['phone']),
    pickString(chat, ['phone']),
  ].filter(Boolean) as string[];
  if (phoneCandidates.length > 0) return phoneCandidates[0];

  // 2. JIDs com @ — mais confiáveis (ex: 5511999999999@s.whatsapp.net)
  const jidCandidates = [
    pickString(key, ['remoteJid']),
    pickString(msg, ['remoteJid', 'sender', 'from']),
  ].filter(Boolean) as string[];
  for (const cand of jidCandidates) {
    if (cand.includes('@')) return cand;
  }

  // 3. Fallbacks (chatid, chatId, etc) — podem ser interno do uazapiGO
  return (
    pickString(msg, ['sender', 'from', 'chatid', 'chatId']) ??
    pickString(key, ['participant']) ??
    pickString(chat, ['wa_chatid', 'id'])
  );
}

export function extractInbound(payload: UazapiInbound): InboundMessage | null {
  const event = pickString(payload, ['event', 'EventType', 'type', 'eventType']);
  if (!isMessageEvent(event)) return null;

  // O objeto da mensagem pode estar em `message`, `data`, `data.message` ou no root.
  const directMsg = asObj(payload.message) ?? asObj(payload.data);
  const nestedMsg = asObj(asObj(payload.data)?.message);
  const msg = nestedMsg ?? directMsg ?? payload;

  const key = asObj(msg.key) ?? {};
  const id = pickString(msg, ['id', 'messageid', 'messageId']) ?? pickString(key, ['id']);
  const from = extractFrom(msg, payload);
  if (!id || !from) return null;

  const fromMe =
    pickBool(msg, ['fromMe', 'from_me', 'isFromMe', 'wasSentByApi']) ||
    pickBool(key, ['fromMe']);
  if (fromMe) return null;

  // Filtra grupos (igual APP_ORION)
  const isGroup =
    pickBool(msg, ['isGroup']) ||
    (pickString(key, ['remoteJid']) ?? '').includes('@g.us') ||
    from.includes('@g.us');
  if (isGroup) return null;

  // mediaType (uazapiGO) eh mais especifico: text vem como 'conversation' em
  // messageType, mas mediaType vazio; sticker vem com mediaType='sticker' e
  // messageType='StickerMessage' (com type='media' generico). Preferimos mediaType.
  const rawType = pickString(msg, ['messageType', 'type', 'message_type']);
  const mediaType = pickString(msg, ['mediaType', 'media_type']);
  const kind = mapKind(mediaType ?? rawType);
  const isSticker =
    (mediaType?.toLowerCase().includes('sticker') ?? false) ||
    (rawType?.toLowerCase().includes('sticker') ?? false);

  const text =
    pickString(msg, ['text', 'body', 'conversation', 'caption']) ??
    pickString(asObj(msg.message), ['conversation', 'text']) ??
    pickString(asObj(asObj(msg.message)?.extendedTextMessage), ['text']);

  // Media URL pode vir no root ou dentro de `content` (caso uazapiGO recente).
  const content = asObj(msg.content);
  const rawMediaUrl =
    pickString(msg, ['media_url', 'mediaUrl', 'url', 'fileUrl', 'file_url', 'fileURL']) ??
    pickString(content, ['url', 'URL', 'mediaUrl', 'fileUrl']);
  const mediaUrl = isUsableMediaUrl(rawMediaUrl) ? rawMediaUrl : null;
  const mediaMime =
    pickString(msg, ['mimetype', 'mimeType', 'mime_type', 'mime']) ??
    pickString(content, ['mimetype', 'mimeType', 'mime_type', 'mime']);

  const timestamp = parseTimestamp(
    msg.timestamp ?? msg.t ?? msg.messageTimestamp ?? payload.timestamp,
  );

  // Nome do contato no WhatsApp. Aceita variantes pushName/senderName/notify.
  // Filtra valores inválidos (só símbolos, muito curtos) que vêm de chats sem
  // nome cadastrado — nesses casos volta o telefone como fallback no service.
  const rawContactName =
    pickString(msg, ['pushName', 'senderName', 'notify', 'pushname']) ??
    pickString(asObj(payload.chat), ['name', 'wa_name', 'pushname']);
  const isValidName = !!rawContactName
    && rawContactName.length > 1
    && /[a-zA-Z0-9À-ɏ]/.test(rawContactName);

  // Body final:
  //  - text → o texto da msg
  //  - midia com URL renderizavel → null (UI mostra o anexo)
  //  - midia SEM URL ou kind=unknown → label fallback ("🎞️ Figurinha" etc) pra
  //    bubble nunca ficar em branco no chat.
  let finalText: string | null;
  if (kind === 'text') {
    finalText = text;
  } else if (mediaUrl) {
    finalText = text; // caption opcional do anexo, quando vier
  } else {
    finalText = fallbackBodyFor(kind, isSticker);
  }

  return {
    id,
    from,
    contactName: isValidName ? rawContactName : null,
    text: finalText,
    kind,
    mediaUrl: kind === 'text' ? null : mediaUrl,
    mediaMime: kind === 'text' ? null : mediaMime,
    isSticker,
    timestamp,
    fromMe,
  };
}
