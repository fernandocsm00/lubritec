import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { InstanceStatusResponse } from '@shared/types';
import {
  initInstance,
  connectInstance,
  getInstanceStatus,
  logoutInstance,
  deleteInstance,
  setWebhook,
  UazapiInstanceError,
} from './whatsapp/uazapi/instanceClient';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { uazapiConfigSchema, type UazapiConfig } from './whatsapp/uazapi/configSchema';
import { invalidateProvider } from './whatsapp/providerRegistry';

// ──────────────────────────────────────────────────────────────────────────
// Default-row helpers
//
// Backward-compat layer: legacy single-instance endpoints operate on the row
// where is_default=true. Multi-instance ops live in
// whatsappInstancesController (Task 7).
// ──────────────────────────────────────────────────────────────────────────

type Row = typeof whatsappInstance.$inferSelect;

async function loadDefaultRow(): Promise<Row | null> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  return row ?? null;
}

async function loadOrSeedDefault(): Promise<Row | null> {
  const existing = await loadDefaultRow();
  if (existing) return existing;

  // Env-var seed for first-boot convenience (preserves old behavior).
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = process.env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_TOKEN;
  const envInstanceId = process.env.UAZAPI_INSTANCE_ID;
  const webhookSecret = process.env.UAZAPI_WEBHOOK_SECRET;
  if (!baseUrl || !token || !envInstanceId || !webhookSecret) return null;

  const cfg: UazapiConfig = {
    baseUrl,
    instanceId: envInstanceId,
    instanceToken: encryptSecret(token),
    webhookSecret: encryptSecret(webhookSecret),
    webhookUrl: buildWebhookUrl(token),
    webhookSynced: true,
  };

  try {
    const [created] = await db.insert(whatsappInstance).values({
      provider: 'uazapi',
      displayName: 'Linha principal',
      isDefault: true,
      providerConfig: cfg,
    }).returning();
    return created;
  } catch {
    return loadDefaultRow();
  }
}

function uazCfg(row: Row): UazapiConfig {
  return uazapiConfigSchema.parse(row.providerConfig);
}

function emptyResponse(): InstanceStatusResponse {
  return {
    configured: false,
    status: 'disconnected',
    qrCode: null,
    phoneNumber: null,
    profileName: null,
    webhookSynced: false,
    baseUrl: process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com',
    lastStatusAt: null,
  };
}

function buildWebhookUrl(instanceToken?: string | null): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const base = `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
  if (instanceToken) {
    return `${base}?instanceToken=${encodeURIComponent(instanceToken)}`;
  }
  return base;
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ──────────────────────────────────────────────────────────────────────────
// Public API — preserved external behavior
// ──────────────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<InstanceStatusResponse> {
  const row = await loadOrSeedDefault();
  if (!row) return emptyResponse();

  const cfg = uazCfg(row);
  if (!cfg.instanceId || !cfg.instanceToken) {
    return {
      configured: false,
      status: 'disconnected',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      webhookSynced: cfg.webhookSynced,
      baseUrl: cfg.baseUrl,
      lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
    };
  }

  let live: Awaited<ReturnType<typeof getInstanceStatus>> | null = null;
  try {
    live = await getInstanceStatus({
      baseUrl: cfg.baseUrl,
      token: decryptSecret(cfg.instanceToken),
    });
  } catch {
    // upstream offline — return cached
  }

  const status = live?.status ?? 'error';
  const phoneNumber = live?.phoneNumber ?? row.phoneNumber;
  const profileName = live?.profileName ?? row.profileName;

  try {
    await db.update(whatsappInstance)
      .set({
        lastStatus: status,
        lastStatusAt: new Date(),
        phoneNumber,
        profileName,
        updatedAt: new Date(),
      })
      .where(eq(whatsappInstance.id, row.id));
  } catch { /* informational cache */ }

  return {
    configured: true,
    status,
    qrCode: live?.qrCode ?? null,
    phoneNumber,
    profileName,
    webhookSynced: cfg.webhookSynced,
    baseUrl: cfg.baseUrl,
    lastStatusAt: new Date().toISOString(),
  };
}

export async function connect(input: {
  baseUrl?: string;
  instanceToken?: string;
}): Promise<InstanceStatusResponse> {
  let row = await loadDefaultRow();
  const envToken = process.env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_TOKEN;
  const baseUrl = input.baseUrl ?? process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com';

  if (!row) {
    const tokenPlain = input.instanceToken ?? envToken ?? null;
    const cfg: UazapiConfig = {
      baseUrl,
      instanceId: null,
      instanceToken: tokenPlain ? encryptSecret(tokenPlain) : null,
      webhookSecret: null,
      webhookUrl: null,
      webhookSynced: false,
    };
    [row] = await db.insert(whatsappInstance).values({
      provider: 'uazapi',
      displayName: 'Linha principal',
      isDefault: true,
      providerConfig: cfg,
    }).returning();
  } else {
    const cfg = uazCfg(row);
    const currentToken = cfg.instanceToken ? decryptSecret(cfg.instanceToken) : '';
    const tokenChanged = input.instanceToken && currentToken !== input.instanceToken;
    if (input.baseUrl !== undefined || tokenChanged) {
      const next: UazapiConfig = {
        ...cfg,
        baseUrl: input.baseUrl ?? cfg.baseUrl,
        instanceToken: input.instanceToken
          ? encryptSecret(input.instanceToken)
          : cfg.instanceToken,
      };
      [row] = await db.update(whatsappInstance)
        .set({ providerConfig: next, updatedAt: new Date() })
        .where(eq(whatsappInstance.id, row.id)).returning();
      invalidateProvider(row.id);
    }
  }

  let cfg = uazCfg(row);
  if (!cfg.instanceId) {
    const adminToken = envToken;
    if (!adminToken) {
      throw new HttpError(400, 'UAZAPI_ADMIN_TOKEN required to init a new instance');
    }
    try {
      const init = await initInstance({ baseUrl: cfg.baseUrl, token: adminToken }, 'lubritec');
      cfg = {
        ...cfg,
        instanceId: init.instanceId,
        instanceToken: encryptSecret(init.token),
      };
      [row] = await db.update(whatsappInstance)
        .set({ providerConfig: cfg, updatedAt: new Date() })
        .where(eq(whatsappInstance.id, row.id)).returning();
      invalidateProvider(row.id);
    } catch (err) {
      if (err instanceof UazapiInstanceError) {
        throw new HttpError(502, `UazAPI init failed: ${err.message}`);
      }
      throw err;
    }
  }

  if (!cfg.instanceToken) throw new HttpError(500, 'Instance token missing after init');
  const tokenPlain = decryptSecret(cfg.instanceToken);

  // Webhook setup
  const webhookSecret = cfg.webhookSecret ? decryptSecret(cfg.webhookSecret) : generateWebhookSecret();
  const webhookUrl = buildWebhookUrl(tokenPlain);

  try {
    await setWebhook(
      { baseUrl: cfg.baseUrl, token: tokenPlain },
      { url: webhookUrl, secret: webhookSecret, events: ['message.received'] },
    );
    cfg = { ...cfg, webhookSecret: encryptSecret(webhookSecret), webhookUrl, webhookSynced: true };
    [row] = await db.update(whatsappInstance)
      .set({ providerConfig: cfg, updatedAt: new Date() })
      .where(eq(whatsappInstance.id, row.id)).returning();
    invalidateProvider(row.id);
  } catch (err) {
    cfg = { ...cfg, webhookSecret: encryptSecret(webhookSecret), webhookUrl, webhookSynced: false };
    await db.update(whatsappInstance)
      .set({ providerConfig: cfg, updatedAt: new Date() })
      .where(eq(whatsappInstance.id, row.id));
    invalidateProvider(row.id);
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `Webhook config failed: ${err.message}`);
    }
    throw err;
  }

  try {
    await connectInstance({ baseUrl: cfg.baseUrl, token: tokenPlain });
  } catch (err) {
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `UazAPI connect failed: ${err.message}`);
    }
    throw err;
  }

  await db.update(whatsappInstance)
    .set({ lastStatus: 'pairing', lastStatusAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappInstance.id, row.id));

  return getStatus();
}

export async function disconnect(): Promise<InstanceStatusResponse> {
  const row = await loadDefaultRow();
  if (!row) throw new HttpError(400, 'No instance to disconnect');
  const cfg = uazCfg(row);
  if (!cfg.instanceId || !cfg.instanceToken) {
    throw new HttpError(400, 'No instance to disconnect');
  }
  try {
    await logoutInstance({ baseUrl: cfg.baseUrl, token: decryptSecret(cfg.instanceToken) });
  } catch (err) {
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `UazAPI logout failed: ${err.message}`);
    }
    throw err;
  }
  await db.update(whatsappInstance).set({
    lastStatus: 'disconnected',
    lastStatusAt: new Date(),
    phoneNumber: null,
    profileName: null,
    updatedAt: new Date(),
  }).where(eq(whatsappInstance.id, row.id));
  invalidateProvider(row.id);
  return getStatus();
}

export async function destroy(): Promise<void> {
  const row = await loadDefaultRow();
  if (!row) throw new HttpError(404, 'No instance to delete');
  const cfg = uazCfg(row);
  if (cfg.instanceId && cfg.instanceToken) {
    try {
      await deleteInstance({ baseUrl: cfg.baseUrl, token: decryptSecret(cfg.instanceToken) });
    } catch { /* best-effort */ }
  }
  await db.delete(whatsappInstance).where(eq(whatsappInstance.id, row.id));
  invalidateProvider(row.id);
}

// ──────────────────────────────────────────────────────────────────────────
// Internal: used by uazapiClient.sendUazapiMessage and webhook handler
// ──────────────────────────────────────────────────────────────────────────

export interface SendUazapiConfig {
  baseUrl: string;
  instanceId: string;
  token: string;
}

export async function loadSendConfig(): Promise<SendUazapiConfig> {
  const row = await loadOrSeedDefault();
  if (!row) throw new UazapiInstanceError(503, 'WhatsApp instance not configured');
  const cfg = uazCfg(row);
  if (!cfg.instanceId || !cfg.instanceToken) {
    throw new UazapiInstanceError(503, 'WhatsApp instance not configured');
  }
  return {
    baseUrl: cfg.baseUrl,
    instanceId: cfg.instanceId,
    token: decryptSecret(cfg.instanceToken),
  };
}

export async function loadWebhookSecret(): Promise<string | null> {
  const row = await loadDefaultRow();
  if (row) {
    const cfg = uazCfg(row);
    if (cfg.webhookSecret) return decryptSecret(cfg.webhookSecret);
  }
  return process.env.UAZAPI_WEBHOOK_SECRET ?? null;
}

export async function loadValidWebhookTokens(): Promise<string[]> {
  // Multi-instância: aceita o token de QUALQUER linha UazAPI ativa (não só a
  // padrão). safeParse ignora linhas cujo providerConfig não é UazAPI (ex.:
  // meta_cloud) sem lançar.
  const rows = await db.select().from(whatsappInstance)
    .where(and(
      eq(whatsappInstance.provider, 'uazapi'),
      eq(whatsappInstance.isArchived, false),
    ));
  const tokens: string[] = [];
  for (const row of rows) {
    const parsed = uazapiConfigSchema.safeParse(row.providerConfig);
    if (!parsed.success) continue;
    if (parsed.data.webhookSecret) tokens.push(decryptSecret(parsed.data.webhookSecret));
    if (parsed.data.instanceToken) tokens.push(decryptSecret(parsed.data.instanceToken));
  }
  if (process.env.UAZAPI_WEBHOOK_SECRET) tokens.push(process.env.UAZAPI_WEBHOOK_SECRET);
  return tokens;
}

/**
 * Mapeia um token de webhook (instanceToken OU webhookSecret) pra qual linha
 * UazAPI ativa ele pertence. Usado pra rotear inbound multi-linha pra instância
 * certa — sem isso o inbound cai sempre na linha padrão. Retorna null se nenhum
 * casar (ex.: token do env UAZAPI_WEBHOOK_SECRET, que não é de uma linha).
 */
export async function resolveInstanceIdByWebhookToken(token: string): Promise<string | null> {
  const rows = await db.select().from(whatsappInstance)
    .where(and(
      eq(whatsappInstance.provider, 'uazapi'),
      eq(whatsappInstance.isArchived, false),
    ));
  for (const row of rows) {
    const parsed = uazapiConfigSchema.safeParse(row.providerConfig);
    if (!parsed.success) continue;
    if (parsed.data.instanceToken && decryptSecret(parsed.data.instanceToken) === token) return row.id;
    if (parsed.data.webhookSecret && decryptSecret(parsed.data.webhookSecret) === token) return row.id;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Diagnostics — preserved
// ──────────────────────────────────────────────────────────────────────────

export async function probeWebhook(): Promise<{
  ours: {
    webhookUrl: string | null;
    webhookSecretPresent: boolean;
    webhookSynced: boolean;
    instanceId: string | null;
    baseUrl: string;
  } | null;
  uazapi: Array<{ path: string; method: string; status: number; body: unknown }>;
}> {
  const row = await loadDefaultRow();
  if (!row) return { ours: null, uazapi: [] };
  const cfg = uazCfg(row);
  if (!cfg.instanceToken) return { ours: null, uazapi: [] };
  const { probeWebhookConfig } = await import('./whatsapp/uazapi/instanceClient');
  const uazapi = await probeWebhookConfig({
    baseUrl: cfg.baseUrl,
    token: decryptSecret(cfg.instanceToken),
  });
  return {
    ours: {
      webhookUrl: cfg.webhookUrl,
      webhookSecretPresent: !!cfg.webhookSecret,
      webhookSynced: cfg.webhookSynced,
      instanceId: cfg.instanceId,
      baseUrl: cfg.baseUrl,
    },
    uazapi,
  };
}

export async function probeMessages(): Promise<{
  uazapi: Array<{ path: string; method: string; status: number; body: unknown }>;
}> {
  const row = await loadDefaultRow();
  if (!row) return { uazapi: [] };
  const cfg = uazCfg(row);
  if (!cfg.instanceToken) return { uazapi: [] };
  const { probeRecentMessages } = await import('./whatsapp/uazapi/instanceClient');
  return {
    uazapi: await probeRecentMessages({
      baseUrl: cfg.baseUrl,
      token: decryptSecret(cfg.instanceToken),
    }),
  };
}

export async function selfTestWebhook(): Promise<{
  posted: { url: string; bodyPreview: Record<string, unknown> };
  response: { status: number; body: unknown };
}> {
  const row = await loadDefaultRow();
  if (!row) throw new HttpError(503, 'WhatsApp instance not configured');
  const cfg = uazCfg(row);
  const url = cfg.webhookUrl
    ?? `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/whatsapp/webhook`;
  const tokenEnc = cfg.instanceToken ?? cfg.webhookSecret;
  if (!tokenEnc) throw new HttpError(503, 'No instance token or webhook secret available');
  const token = decryptSecret(tokenEnc);

  const fakeMsgId = `selftest-${Date.now()}`;
  const fakePhone = `5511${String(Date.now()).slice(-8)}`;
  const body: Record<string, unknown> = {
    EventType: 'messages',
    instance: cfg.instanceId,
    token,
    message: {
      messageid: fakeMsgId,
      sender: `${fakePhone}@s.whatsapp.net`,
      messageType: 'conversation',
      text: 'self-test payload',
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: false,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let respBody: unknown = text;
  try { respBody = JSON.parse(text); } catch { /* keep raw */ }

  return { posted: { url, bodyPreview: body }, response: { status: res.status, body: respBody } };
}
