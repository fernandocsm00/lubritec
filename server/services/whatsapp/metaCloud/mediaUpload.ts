import { MetaGraphError } from './client';

const DEFAULT_API_VERSION = 'v20.0';

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? DEFAULT_API_VERSION}`;
}

function parseBody(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export interface UploadResumableInput {
  appId: string;
  /** App Secret do MESMO app do appId — usado pra montar o app access token. */
  appSecret: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Sobe uma mídia de AMOSTRA via Resumable Upload API da Meta e retorna o
 * `header_handle` — o valor usado em components[HEADER].example.header_handle ao
 * criar um template com header de mídia (imagem/vídeo/documento). Sem esse handle
 * a Meta rejeita a criação do template.
 *
 * Fluxo de 2 passos (docs: Graph API › Resumable Upload):
 *   1. POST /{app_id}/uploads?file_name&file_length&file_type  → { id: "upload:..." }
 *   2. POST /{session_id}  (Authorization: OAuth, header file_offset:0, body binário) → { h: handle }
 *
 * Autentica com **app access token** (`{app-id}|{app-secret}`), não com o access
 * token do WhatsApp: o nó `/{app_id}` pertence ao app, e o token de system user
 * da WABA não enxerga esse nó — a Meta responde 400 code 100 subcode 33
 * ("Object with ID ... does not exist, cannot be loaded due to missing
 * permissions"). App ID e App Secret precisam ser do MESMO app.
 */
export async function uploadResumableHeaderSample(input: UploadResumableInput): Promise<string> {
  const appAccessToken = `${input.appId}|${input.appSecret}`;

  // ── Passo 1: cria a sessão de upload ──
  const q = new URLSearchParams({
    file_name: input.fileName,
    file_length: String(input.buffer.byteLength),
    file_type: input.mimeType,
  });
  const startRes = await fetch(`${graphBase()}/${input.appId}/uploads?${q.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${appAccessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const startBody = parseBody(await startRes.text().catch(() => ''));
  if (!startRes.ok) {
    const err = startBody as { error?: { code?: number } };
    throw new MetaGraphError(startRes.status, err?.error?.code ?? null, startBody);
  }
  const sessionId = (startBody as { id?: string }).id;
  if (!sessionId) throw new MetaGraphError(500, null, startBody);

  // ── Passo 2: envia o binário para a sessão ──
  const upRes = await fetch(`${graphBase()}/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${appAccessToken}`,
      file_offset: '0',
    },
    // Uint8Array é BodyInit válido; Buffer direto não tipa no lib.dom.
    body: new Uint8Array(input.buffer),
    signal: AbortSignal.timeout(30_000),
  });
  const upBody = parseBody(await upRes.text().catch(() => ''));
  if (!upRes.ok) {
    const err = upBody as { error?: { code?: number } };
    throw new MetaGraphError(upRes.status, err?.error?.code ?? null, upBody);
  }
  const handle = (upBody as { h?: string }).h;
  if (!handle) throw new MetaGraphError(500, null, upBody);
  return handle;
}
