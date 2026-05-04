import type { MessageKind } from '@shared/types';
import { loadSendConfig } from './whatsappInstanceService';

export class UazapiError extends Error {
  constructor(public status: number, public body: string) {
    super(`UazAPI error ${status}: ${body}`);
  }
}

export interface SendMessageOpts {
  to: string;
  kind: MessageKind;
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
}

export interface UazapiSendResponse {
  messageId: string;
  rawPayload: unknown;
}

// Map MessageKind to uazapiGO `type` field for /send/media.
function mapMediaType(kind: MessageKind): string {
  switch (kind) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'document': return 'document';
    default: return 'document';
  }
}

export async function sendUazapiMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
  const cfg = await loadSendConfig();

  // uazapiGO endpoints:
  //   POST /send/text   { number, text }
  //   POST /send/media  { number, type, file, caption? }
  // Auth: header `token: <instance_token>` (NOT Authorization Bearer).
  // Instance is identified by the token, no need to pass instance_id in body.
  const endpoint = opts.kind === 'text' ? '/send/text' : '/send/media';

  const body: Record<string, unknown> = { number: opts.to };
  if (opts.kind === 'text') {
    body.text = opts.text;
  } else {
    body.type = mapMediaType(opts.kind);
    body.file = opts.mediaUrl;
    if (opts.text) body.caption = opts.text;
  }

  const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      token: cfg.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UazapiError(res.status, text);
  }

  const json = (await res.json()) as Record<string, unknown> | null;
  // uazapiGO response varies by endpoint; defensively look in common spots.
  const msgObj = (json?.message as Record<string, unknown> | undefined) ?? json;
  const messageId =
    (msgObj?.messageid as string | undefined) ??
    (msgObj?.id as string | undefined) ??
    (json?.messageId as string | undefined);
  if (!messageId) {
    throw new UazapiError(500, `Missing messageId in response: ${JSON.stringify(json)}`);
  }
  return { messageId, rawPayload: json };
}

// Backward-compat shim — preserva a interface usada por conversationsService
// e pelos vi.mock dos testes do WhatsApp Inbox.
export const uazapiClient = {
  sendMessage: sendUazapiMessage,
};
