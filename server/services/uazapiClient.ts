import type { MessageKind } from '@shared/types';

export class UazapiError extends Error {
  constructor(public status: number, public body: string) {
    super(`UazAPI error ${status}: ${body}`);
  }
}

export interface SendMessageOpts {
  to: string;                                // telefone destino, só dígitos
  kind: MessageKind;
  text?: string;                             // obrigatório para kind='text'
  mediaUrl?: string;                         // obrigatório para kinds de mídia
  mediaMime?: string;
}

export interface UazapiSendResponse {
  messageId: string;                         // ID da mensagem no UazAPI
  rawPayload: unknown;                       // payload completo retornado
}

class UazapiClient {
  private get base() { return process.env.UAZAPI_BASE_URL ?? ''; }
  private get token() { return process.env.UAZAPI_TOKEN ?? ''; }
  private get instanceId() { return process.env.UAZAPI_INSTANCE_ID ?? ''; }

  async sendMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
    const endpoint = opts.kind === 'text'
      ? '/v1/messages/text'
      : '/v1/messages/media';

    const body: Record<string, unknown> = {
      instance_id: this.instanceId,
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

    const res = await fetch(`${this.base}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
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
    // Esperamos um id de mensagem; se não vier, tentamos campos comuns.
    const messageId =
      (json?.messageId as string | undefined) ??
      (json?.id as string | undefined) ??
      (json?.data?.id as string | undefined);
    if (!messageId) {
      throw new UazapiError(500, `Missing messageId in response: ${JSON.stringify(json)}`);
    }
    return { messageId, rawPayload: json };
  }
}

export const uazapiClient = new UazapiClient();
