import type { InstanceStatus } from '@shared/types';

export class UazapiInstanceError extends Error {
  constructor(public status: number, public body: string) {
    super(`UazAPI instance error ${status}: ${body}`);
  }
}

export interface UazapiInstanceConfig {
  baseUrl: string;
  token: string;          // token da conta UazAPI (auth)
  instanceId?: string;    // preenchido após init
}

export interface UazapiInitResponse {
  instanceId: string;
  token?: string;         // alguns providers retornam um token de instância separado
  rawPayload: unknown;
}

export interface UazapiStatusResponse {
  status: InstanceStatus;
  qrCode: string | null;        // base64 (só durante pairing)
  phoneNumber: string | null;   // pareado
  profileName: string | null;   // pareado
  rawPayload: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function call(
  cfg: UazapiInstanceConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UazapiInstanceError(res.status, text);
  }
  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Cria uma nova instância no UazAPI. O `name` é só rótulo interno do provider.
 */
export async function initInstance(
  cfg: UazapiInstanceConfig,
  name: string,
): Promise<UazapiInitResponse> {
  const json = (await call(cfg, 'POST', '/v1/instance/init', { name })) as Record<string, unknown>;
  const instanceId =
    (json?.instanceId as string | undefined) ??
    (json?.id as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.id) as string | undefined;
  if (!instanceId) {
    throw new UazapiInstanceError(500, `Missing instanceId: ${JSON.stringify(json)}`);
  }
  const token =
    (json?.token as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.token as string | undefined);
  return { instanceId, token, rawPayload: json };
}

/**
 * Consulta o status atual da instância.
 */
export async function getInstanceStatus(
  cfg: UazapiInstanceConfig,
): Promise<UazapiStatusResponse> {
  if (!cfg.instanceId) {
    throw new UazapiInstanceError(400, 'instanceId required for status');
  }
  const json = (await call(
    cfg,
    'GET',
    `/v1/instance/status?instance_id=${encodeURIComponent(cfg.instanceId)}`,
  )) as Record<string, unknown>;

  // Mapeia campos comuns. UazAPI exata pode variar — best-effort.
  const rawStatus =
    (json?.status as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.status as string | undefined) ??
    'disconnected';

  const status: InstanceStatus = mapStatus(rawStatus);
  const qrCode =
    (json?.qrcode as string | undefined) ??
    (json?.qr_code as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.qrcode as string | undefined) ??
    null;
  const phoneNumber =
    (json?.phone_number as string | undefined) ??
    (json?.phone as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.phone as string | undefined) ??
    null;
  const profileName =
    (json?.profile_name as string | undefined) ??
    (json?.profileName as string | undefined) ??
    ((json?.data as Record<string, unknown> | undefined)?.profileName as string | undefined) ??
    null;

  return { status, qrCode, phoneNumber, profileName, rawPayload: json };
}

function mapStatus(raw: string): InstanceStatus {
  const s = raw.toLowerCase();
  if (s.includes('connect') || s === 'open' || s === 'paired') return 'connected';
  if (s.includes('qr') || s.includes('pair') || s.includes('connecting')) return 'pairing';
  if (s.includes('error') || s.includes('fail')) return 'error';
  return 'disconnected';
}

/**
 * Faz logout da instância (sem deletar — pode reconectar depois).
 */
export async function logoutInstance(cfg: UazapiInstanceConfig): Promise<void> {
  if (!cfg.instanceId) throw new UazapiInstanceError(400, 'instanceId required');
  await call(cfg, 'POST', `/v1/instance/logout?instance_id=${encodeURIComponent(cfg.instanceId)}`);
}

/**
 * Deleta a instância no UazAPI.
 */
export async function deleteInstance(cfg: UazapiInstanceConfig): Promise<void> {
  if (!cfg.instanceId) throw new UazapiInstanceError(400, 'instanceId required');
  await call(cfg, 'DELETE', `/v1/instance?instance_id=${encodeURIComponent(cfg.instanceId)}`);
}

/**
 * Configura o webhook na instância.
 */
export async function setWebhook(
  cfg: UazapiInstanceConfig,
  opts: { url: string; secret: string; events: string[] },
): Promise<void> {
  if (!cfg.instanceId) throw new UazapiInstanceError(400, 'instanceId required');
  await call(cfg, 'POST', `/v1/instance/webhook?instance_id=${encodeURIComponent(cfg.instanceId)}`, {
    url: opts.url,
    secret: opts.secret,
    events: opts.events,
  });
}
