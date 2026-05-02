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

export async function sendUazapiMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
  const cfg = await loadSendConfig();

  const endpoint = opts.kind === 'text'
    ? '/v1/messages/text'
    : '/v1/messages/media';

  const body: Record<string, unknown> = {
    instance_id: cfg.instanceId,
    to: opts.to,
  };
  if (opts.kind === 'text') {
    body.text = opts.text;
  } else {
    body.media_url = opts.mediaUrl;
    body.media_mime = opts.mediaMime;
    body.kind = opts.kind;
    if (opts.text) body.caption = opts.text;
  }

  const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UazapiError(res.status, text);
  }

  const json = await res.json();
  const messageId =
    (json?.messageId as string | undefined) ??
    (json?.id as string | undefined) ??
    (json?.data?.id as string | undefined);
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
