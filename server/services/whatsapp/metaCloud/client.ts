import { retry } from '../../../lib/retry';

const DEFAULT_API_VERSION = 'v20.0';

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? DEFAULT_API_VERSION}`;
}

export class MetaGraphError extends Error {
  constructor(public status: number, public code: number | null, public body: unknown) {
    super(`Meta Graph API error ${status} (code ${code ?? 'n/a'}): ${JSON.stringify(body)}`);
    this.name = 'MetaGraphError';
  }
}

interface MetaApiError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

async function metaFetch(
  path: string,
  init: RequestInit & { accessToken: string },
): Promise<unknown> {
  const { accessToken, ...rest } = init;
  const url = `${graphBase()}${path}`;
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok) {
    const errBody = body as MetaApiError;
    throw new MetaGraphError(res.status, errBody?.error?.code ?? null, body);
  }
  return body;
}

// ── Validation: GET phone number info to confirm credentials work ────────
export interface PhoneNumberInfo {
  display_phone_number: string;
  verified_name: string;
  id: string;
}

export async function getPhoneNumberInfo(input: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<PhoneNumberInfo> {
  const res = await metaFetch(
    `/${input.phoneNumberId}?fields=display_phone_number,verified_name`,
    { method: 'GET', accessToken: input.accessToken },
  );
  return res as PhoneNumberInfo;
}

// ── Send: text ────────────────────────────────────────────────────────────
export interface SendTextInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}

export interface SendResult {
  messageId: string;
  rawPayload: unknown;
}

export async function sendText(input: SendTextInput): Promise<SendResult> {
  return retry(async () => {
    const body = await metaFetch(`/${input.phoneNumberId}/messages`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.to,
        type: 'text',
        text: { body: input.text },
      }),
    });
    const msgs = (body as { messages?: Array<{ id: string }> }).messages;
    if (!msgs || msgs.length === 0) {
      throw new MetaGraphError(500, null, body);
    }
    return { messageId: msgs[0].id, rawPayload: body };
  }, {
    attempts: 3,
    baseDelayMs: 500,
    shouldRetry: (err) => err instanceof MetaGraphError && err.status >= 500,
  });
}

// ── Send: media (image/video/audio/document via URL) ─────────────────────
export interface SendMediaInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  mediaUrl: string;
  caption?: string;
}

export async function sendMedia(input: SendMediaInput): Promise<SendResult> {
  const mediaObj: Record<string, unknown> = { link: input.mediaUrl };
  // Caption is supported by image, video, document — NOT audio
  if (input.caption && input.kind !== 'audio') {
    mediaObj.caption = input.caption;
  }
  return retry(async () => {
    const body = await metaFetch(`/${input.phoneNumberId}/messages`, {
      method: 'POST',
      accessToken: input.accessToken,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.to,
        type: input.kind,
        [input.kind]: mediaObj,
      }),
    });
    const msgs = (body as { messages?: Array<{ id: string }> }).messages;
    if (!msgs || msgs.length === 0) {
      throw new MetaGraphError(500, null, body);
    }
    return { messageId: msgs[0].id, rawPayload: body };
  }, {
    attempts: 3,
    baseDelayMs: 500,
    shouldRetry: (err) => err instanceof MetaGraphError && err.status >= 500,
  });
}

// ── Inbound media download ───────────────────────────────────────────────
/**
 * Meta delivers inbound media as an id. Resolve to a downloadable URL via
 * GET /{media_id}. The URL is short-lived (5min) and requires the same auth
 * token to download. Returns the URL — caller is responsible for downloading
 * and persisting.
 */
export async function getMediaUrl(input: {
  mediaId: string;
  accessToken: string;
}): Promise<{ url: string; mimeType: string }> {
  const res = await metaFetch(`/${input.mediaId}?fields=url,mime_type`, {
    method: 'GET',
    accessToken: input.accessToken,
  });
  return {
    url: (res as { url: string }).url,
    mimeType: (res as { mime_type: string }).mime_type,
  };
}

/**
 * Detection helper for "out of session window" Meta error.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 * Code 131047 = re-engagement message outside 24h customer service window.
 */
export function isOutOfSessionError(err: unknown): boolean {
  if (!(err instanceof MetaGraphError)) return false;
  return err.code === 131047 || err.status === 470;
}
