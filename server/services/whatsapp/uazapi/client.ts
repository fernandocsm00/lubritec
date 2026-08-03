import type { MessageKind } from '@shared/types';
import { loadSendConfig } from '../../whatsappInstanceService';
import { retry } from '../../../lib/retry';

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

/**
 * Config de envio por-instância. Quando o caller (ex.: UazapiProvider resolvido
 * por `resolveProvider(conv.instanceId)`) passa isto, o envio sai pela linha DA
 * CONVERSA. Sem isto, cai em `loadSendConfig()` (linha padrão) — backward-compat
 * pros callers legados que ainda não roteiam por instância.
 */
export interface UazapiSendConfig {
  baseUrl: string;
  token: string;
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

export async function sendUazapiMessage(
  opts: SendMessageOpts,
  sendCfg?: UazapiSendConfig,
): Promise<UazapiSendResponse> {
  const cfg = sendCfg ?? await loadSendConfig();
  const endpoint = opts.kind === 'text' ? '/send/text' : '/send/media';

  const body: Record<string, unknown> = { number: opts.to };
  if (opts.kind === 'text') {
    body.text = opts.text;
  } else {
    body.type = mapMediaType(opts.kind);
    body.file = opts.mediaUrl;
    // UazAPI (/send/media) usa o campo "text" pra legenda de midia, NAO "caption".
    // Antes mandavamos "caption" e a API ignorava silenciosamente — chegava so
    // imagem sem texto. Mandamos ambos pra compatibilidade com forks que ainda
    // possam ler "caption" (custo zero: a API ignora chave extra).
    if (opts.text) {
      body.text = opts.text;
      body.caption = opts.text;
    }
  }

  return retry(
    async () => {
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
      const msgObj = (json?.message as Record<string, unknown> | undefined) ?? json;
      const messageId =
        (msgObj?.messageid as string | undefined) ??
        (msgObj?.id as string | undefined) ??
        (json?.messageId as string | undefined);
      if (!messageId) {
        throw new UazapiError(500, `Missing messageId in response: ${JSON.stringify(json)}`);
      }
      return { messageId, rawPayload: json };
    },
    {
      attempts: 3,
      baseDelayMs: 500,
      shouldRetry: (err) => {
        if (err instanceof UazapiError) {
          // 5xx ou 429 são transitórios. 4xx restantes são deterministicos.
          return err.status >= 500 || err.status === 429;
        }
        // Network/timeout errors são transitórios.
        return true;
      },
    },
  );
}

/**
 * Revoga (apaga pra todos) uma mensagem ja enviada via UazAPI.
 * Endpoint: POST /message/delete  body: { id }
 * O id aceita formato 'owner:messageid' OU 'messageid' puro — ambos os formatos
 * vem do response do /send/* e ficam em messages.provider_msg_id.
 *
 * UazAPI gera webhook 'messages_update' status=Deleted ao concluir.
 */
export async function deleteUazapiMessage(id: string, sendCfg?: UazapiSendConfig): Promise<void> {
  const cfg = sendCfg ?? await loadSendConfig();
  await retry(
    async () => {
      const res = await fetch(`${cfg.baseUrl}/message/delete`, {
        method: 'POST',
        headers: { token: cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new UazapiError(res.status, text);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 500,
      shouldRetry: (err) =>
        err instanceof UazapiError ? err.status >= 500 || err.status === 429 : true,
    },
  );
}

/**
 * Edita o texto de uma mensagem enviada via UazAPI.
 * Endpoint: POST /message/edit  body: { id, text }
 * UazAPI exige que a msg tenha sido enviada pela propria instancia e esteja
 * na janela permitida pelo WhatsApp (~15min). Retorna 4xx fora disso.
 */
export async function editUazapiMessage(id: string, text: string, sendCfg?: UazapiSendConfig): Promise<void> {
  const cfg = sendCfg ?? await loadSendConfig();
  await retry(
    async () => {
      const res = await fetch(`${cfg.baseUrl}/message/edit`, {
        method: 'POST',
        headers: { token: cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new UazapiError(res.status, body);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 500,
      shouldRetry: (err) =>
        err instanceof UazapiError ? err.status >= 500 || err.status === 429 : true,
    },
  );
}

// Backward-compat shim — preserva a interface usada por conversationsService
// e pelos vi.mock dos testes do WhatsApp Inbox.
export const uazapiClient = {
  sendMessage: sendUazapiMessage,
  deleteMessage: deleteUazapiMessage,
  editMessage: editUazapiMessage,
};
