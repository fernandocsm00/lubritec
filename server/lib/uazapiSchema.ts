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
  text: string | null;
  kind: MessageKind;
  mediaUrl: string | null;
  mediaMime: string | null;
  timestamp: Date;
  fromMe: boolean;
}

/** Eventos que indicam mensagem recebida — varia por versão da uazapiGO. */
const INBOUND_EVENT_NAMES = new Set([
  'message.received',
  'message',
  'messages',
  'messages.upsert',
  'messages_upsert',
  'MESSAGES_UPSERT',
]);

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

/** Mapeia o `type`/`messageType` da uazapiGO pro nosso MessageKind. */
function mapKind(raw: string | null): MessageKind {
  if (!raw) return 'unknown';
  const t = raw.toLowerCase();
  if (t === 'text' || t === 'conversation' || t === 'extendedtextmessage') return 'text';
  if (t === 'image' || t.includes('image')) return 'image';
  if (t === 'audio' || t.includes('audio') || t.includes('ptt')) return 'audio';
  if (t === 'video' || t.includes('video')) return 'video';
  if (t === 'document' || t.includes('document')) return 'document';
  return 'unknown';
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
export function extractInbound(payload: UazapiInbound): InboundMessage | null {
  const event = pickString(payload, ['event', 'EventType', 'type']);
  // Sem evento explícito, aceita se houver objeto `message` (alguns providers omitem evento).
  const eventOk = event ? INBOUND_EVENT_NAMES.has(event) : true;
  if (!eventOk) return null;

  // O objeto da mensagem pode estar em `message`, `data`, `data.message` ou no root.
  const directMsg = asObj(payload.message) ?? asObj(payload.data);
  const nestedMsg = asObj(asObj(payload.data)?.message);
  const msg = nestedMsg ?? directMsg ?? payload;

  const id = pickString(msg, ['id', 'messageid', 'messageId', 'key.id']);
  const from = pickString(msg, [
    'from', 'sender', 'chatid', 'chatId', 'remoteJid', 'jid', 'key.remoteJid',
  ]);
  if (!id || !from) return null;

  const fromMe = pickBool(msg, ['fromMe', 'from_me', 'isFromMe']);
  if (fromMe) return null;

  const rawType = pickString(msg, ['type', 'messageType', 'message_type']);
  const kind = mapKind(rawType);

  // Texto pode estar em vários lugares.
  const text =
    pickString(msg, ['text', 'body', 'conversation', 'caption']) ??
    pickString(asObj(msg.message), ['conversation', 'text']) ??
    pickString(asObj(asObj(msg.message)?.extendedTextMessage), ['text']);

  const mediaUrl = pickString(msg, [
    'media_url', 'mediaUrl', 'url', 'fileUrl', 'file_url',
  ]);
  const mediaMime = pickString(msg, ['mimetype', 'mimeType', 'mime_type', 'mime']);

  const timestamp = parseTimestamp(
    msg.timestamp ?? msg.t ?? msg.messageTimestamp ?? payload.timestamp,
  );

  return {
    id,
    from,
    text: kind === 'text' ? text : null,
    kind,
    mediaUrl: kind === 'text' ? null : mediaUrl,
    mediaMime: kind === 'text' ? null : mediaMime,
    timestamp,
    fromMe,
  };
}
