/**
 * Ring buffer in-memory dos últimos N webhooks recebidos pela uazapiGO.
 *
 * Existe APENAS para diagnóstico. Acessível via GET /api/whatsapp-instance/debug-events
 * (admin only). Reseta quando o processo reinicia — não persistimos nada.
 */

export interface WebhookDebugEntry {
  receivedAt: string;       // ISO timestamp
  headers: Record<string, string>;
  body: unknown;
  bodyKeys: string[] | null;
  result:
    | { kind: 'auth_failed'; reason: string }
    | { kind: 'no_secret_configured' }
    | { kind: 'non_object_body' }
    | { kind: 'extracted'; messageId: string; from: string; messageKind: string; fromMe: boolean }
    | { kind: 'not_a_message'; reason: string }
    | { kind: 'inserted' | 'duplicate' | 'ignored'; messageId: string }
    | { kind: 'error'; message: string };
}

const BUFFER_SIZE = 50;
const buffer: WebhookDebugEntry[] = [];

const SAFE_HEADER_NAMES = [
  'x-webhook-token',
  'token',
  'apikey',
  'authorization',
  'content-type',
  'user-agent',
  'host',
  'x-forwarded-for',
];

export function summarizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SAFE_HEADER_NAMES.includes(k.toLowerCase())) continue;
    if (k.toLowerCase() === 'authorization') {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string') {
      // Mascaramos valores de token longos pra não vazar segredos no JSON.
      out[k] = v.length > 12 ? `${v.slice(0, 6)}…(${v.length} chars)` : v;
    } else if (Array.isArray(v)) {
      out[k] = v.join(',');
    }
  }
  return out;
}

export function pushDebugEntry(entry: WebhookDebugEntry): void {
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) {
    buffer.splice(0, buffer.length - BUFFER_SIZE);
  }
}

export function listDebugEntries(): WebhookDebugEntry[] {
  // Mais recente primeiro.
  return [...buffer].reverse();
}

export function clearDebugEntries(): void {
  buffer.length = 0;
}
