import type { InstanceStatus } from '@shared/types';

export class UazapiInstanceError extends Error {
  constructor(public status: number, public body: string) {
    super(`UazAPI instance error ${status}: ${body}`);
  }
}

/**
 * uazapiGO usa dois modos de autenticação:
 * - Admin (header `AdminToken`): apenas para criar instâncias (`/instance/init`).
 * - Instance (header `token`): para tudo que opera sobre uma instância já criada.
 *
 * Esta config carrega o token apropriado dependendo da operação.
 */
export interface UazapiInstanceConfig {
  baseUrl: string;
  token: string;          // admin token (para init) ou instance token (demais ops)
}

export interface UazapiInitResponse {
  instanceId: string;     // `instance.id` no response
  token: string;          // `instance.token` — uazapiGO sempre devolve token per-instance
  status: InstanceStatus;
  rawPayload: unknown;
}

export interface UazapiStatusResponse {
  status: InstanceStatus;
  qrCode: string | null;        // base64 (só durante pairing)
  phoneNumber: string | null;   // `instance.owner` em uazapiGO
  profileName: string | null;
  rawPayload: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;
type AuthMode = 'admin' | 'instance';

async function call(
  cfg: UazapiInstanceConfig,
  authMode: AuthMode,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authMode === 'admin') {
    headers.AdminToken = cfg.token;
  } else {
    headers.token = cfg.token;
  }

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UazapiInstanceError(res.status, text);
  }
  if (res.status === 204) return null;
  return res.json();
}

function extractInstance(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (obj.instance && typeof obj.instance === 'object') {
    return obj.instance as Record<string, unknown>;
  }
  return obj; // fallback se shape diferir
}

function mapStatus(raw: string | undefined): InstanceStatus {
  if (!raw) return 'disconnected';
  const s = raw.toLowerCase();
  if (s === 'connected' || s === 'open' || s === 'paired') return 'connected';
  if (s.includes('connecting') || s.includes('qr') || s.includes('pair')) return 'pairing';
  if (s.includes('error') || s.includes('fail')) return 'error';
  return 'disconnected';
}

function parseStatus(json: unknown): UazapiStatusResponse {
  const inst = extractInstance(json);
  return {
    status: mapStatus(inst?.status as string | undefined),
    qrCode: (inst?.qrcode as string | null | undefined) || null,
    phoneNumber:
      (inst?.owner as string | null | undefined) ??
      (inst?.phone_number as string | null | undefined) ??
      null,
    profileName: (inst?.profileName as string | null | undefined) ?? null,
    rawPayload: json,
  };
}

// ---------------------------------------------------------------------------
// Public API — endpoints uazapiGO
// ---------------------------------------------------------------------------

/**
 * Cria nova instância. Header: `AdminToken`. Path: POST /instance/init.
 * Response: { instance: { id, token, status, ... } }
 */
export async function initInstance(
  cfg: UazapiInstanceConfig,
  name: string,
): Promise<UazapiInitResponse> {
  const json = await call(cfg, 'admin', 'POST', '/instance/init', { name });
  const inst = extractInstance(json);
  const instanceId = inst?.id as string | undefined;
  const token = inst?.token as string | undefined;
  if (!instanceId || !token) {
    throw new UazapiInstanceError(500, `Missing instance.id or instance.token in response: ${JSON.stringify(json)}`);
  }
  return {
    instanceId,
    token,
    status: mapStatus(inst?.status as string | undefined),
    rawPayload: json,
  };
}

/**
 * Inicia o pareamento (gera QR code). Header: `token` (instance).
 * Path: POST /instance/connect.
 */
export async function connectInstance(cfg: UazapiInstanceConfig): Promise<UazapiStatusResponse> {
  const json = await call(cfg, 'instance', 'POST', '/instance/connect');
  return parseStatus(json);
}

/**
 * Consulta status atual da instância. Header: `token`. Path: GET /instance/status.
 */
export async function getInstanceStatus(
  cfg: UazapiInstanceConfig,
): Promise<UazapiStatusResponse> {
  const json = await call(cfg, 'instance', 'GET', '/instance/status');
  return parseStatus(json);
}

/**
 * Desconecta a instância (sem deletar). Header: `token`. Path: POST /instance/disconnect.
 */
export async function logoutInstance(cfg: UazapiInstanceConfig): Promise<void> {
  await call(cfg, 'instance', 'POST', '/instance/disconnect');
}

/**
 * Deleta a instância. Header: `token`. Path: DELETE /instance.
 */
export async function deleteInstance(cfg: UazapiInstanceConfig): Promise<void> {
  await call(cfg, 'instance', 'DELETE', '/instance');
}

/**
 * Configura o webhook. Header: `token`. Path: POST /webhook.
 *
 * Body confirmado via probe contra oriondigital.uazapi.com:
 *   { url, enabled, events, addUrlEvents, addUrlTypesMessages, excludeMessages }
 *
 * `addUrlTypesMessages` é BOOLEAN (true = entregar mensagens recebidas no webhook).
 * Mandar como array faz a UazAPI converter pra false silenciosamente — webhook
 * cadastra OK mas nenhuma mensagem chega.
 */
export async function setWebhook(
  cfg: UazapiInstanceConfig,
  opts: { url: string; secret: string; events: string[] },
): Promise<unknown> {
  // Cobrimos os nomes de evento usados em diferentes versões — UazAPI ignora
  // os que não reconhece.
  void opts.secret; // uazapiGO não armazena secret próprio; auth do webhook é via instance token no body do payload.
  const allEventNames = Array.from(new Set([
    ...opts.events,
    'message',
    'messages',
    'messages.upsert',
  ]));

  const body = {
    url: opts.url,
    enabled: true,
    events: allEventNames,
    addUrlEvents: true,
    addUrlTypesMessages: true,   // ← LIGA entrega de mensagens recebidas
    excludeMessages: [] as string[],
  };

  return call(cfg, 'instance', 'POST', '/webhook', body);
}

/**
 * DIAGNÓSTICO — tenta descobrir o que a uazapiGO tem cadastrado de webhook.
 * Diferentes versões expõem em paths diferentes; tentamos todos e devolvemos
 * o que cada um respondeu (status + corpo cru). Sem throw — sempre retorna.
 */
export async function probeWebhookConfig(
  cfg: UazapiInstanceConfig,
): Promise<Array<{ path: string; method: string; status: number; body: unknown }>> {
  const attempts: Array<{ method: 'GET' | 'POST'; path: string; body?: unknown }> = [
    { method: 'GET', path: '/webhook' },
    { method: 'GET', path: '/instance/webhook' },
    { method: 'GET', path: '/instance' },
    { method: 'GET', path: '/instance/status' },
    { method: 'POST', path: '/webhook/find', body: {} },
  ];
  const out: Array<{ path: string; method: string; status: number; body: unknown }> = [];
  for (const a of attempts) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        token: cfg.token,
      };
      const res = await fetch(`${cfg.baseUrl}${a.path}`, {
        method: a.method,
        headers,
        body: a.body ? JSON.stringify(a.body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text().catch(() => '');
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep raw text */ }
      out.push({ path: a.path, method: a.method, status: res.status, body });
    } catch (err) {
      out.push({
        path: a.path,
        method: a.method,
        status: 0,
        body: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return out;
}
