import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { InstanceStatusResponse, InstanceStatus } from '@shared/types';
import {
  initInstance,
  connectInstance,
  getInstanceStatus,
  logoutInstance,
  deleteInstance,
  setWebhook,
  UazapiInstanceError,
} from './uazapiInstanceClient';

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Lê a row única do DB. Se não existe e env vars completas, faz seed inicial.
 * Retorna null se não há config (DB vazio E env incompleto).
 */
async function loadOrSeed(): Promise<typeof whatsappInstance.$inferSelect | null> {
  const [existing] = await db.select().from(whatsappInstance).limit(1);
  if (existing) return existing;

  // Seed automático: env vars completas → cria row inicial.
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = uazapiTokenFromEnv();
  const instanceId = process.env.UAZAPI_INSTANCE_ID;
  const webhookSecret = process.env.UAZAPI_WEBHOOK_SECRET;

  if (!baseUrl || !token || !instanceId || !webhookSecret) {
    return null;
  }

  try {
    const [created] = await db
      .insert(whatsappInstance)
      .values({
        baseUrl,
        instanceId,
        instanceToken: token,
        webhookSecret,
        webhookUrl: buildWebhookUrl(),
        webhookSynced: true,  // Assume that env-configured webhook está ativo
      })
      .returning();
    return created;
  } catch {
    // Race: outra request fez o seed antes. Refaz a query.
    const [retry] = await db.select().from(whatsappInstance).limit(1);
    return retry ?? null;
  }
}

function buildWebhookUrl(): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  return `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook`;
}

function uazapiTokenFromEnv(): string | undefined {
  return process.env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_TOKEN || undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

/**
 * Retorna estado atual da instância pra frontend.
 * - Sem row no DB → emptyResponse.
 * - Com row mas sem instanceId → "configured: false" (admin precisa clicar conectar).
 * - Com instanceId → consulta UazAPI live e atualiza cache (last_status, etc).
 */
export async function getStatus(): Promise<InstanceStatusResponse> {
  const row = await loadOrSeed();
  if (!row) return emptyResponse();

  if (!row.instanceId || !row.instanceToken) {
    return {
      configured: false,
      status: 'disconnected',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      webhookSynced: row.webhookSynced,
      baseUrl: row.baseUrl,
      lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
    };
  }

  // Consulta UazAPI live
  let liveStatus: InstanceStatus = 'error';
  let qrCode: string | null = null;
  let phoneNumber: string | null = row.phoneNumber;
  let profileName: string | null = row.profileName;

  try {
    const live = await getInstanceStatus({
      baseUrl: row.baseUrl,
      token: row.instanceToken,
    });
    liveStatus = live.status;
    qrCode = live.qrCode;
    phoneNumber = live.phoneNumber ?? row.phoneNumber;
    profileName = live.profileName ?? row.profileName;
  } catch {
    // UazAPI fora — retorna erro mas mantém cache anterior pra UI.
    liveStatus = 'error';
  }

  // Atualiza cache no DB (best-effort)
  try {
    await db
      .update(whatsappInstance)
      .set({
        lastStatus: liveStatus,
        lastStatusAt: new Date(),
        phoneNumber,
        profileName,
        updatedAt: new Date(),
      })
      .where(eq(whatsappInstance.id, row.id));
  } catch {
    // Ignora — cache é informativo.
  }

  return {
    configured: true,
    status: liveStatus,
    qrCode,
    phoneNumber,
    profileName,
    webhookSynced: row.webhookSynced,
    baseUrl: row.baseUrl,
    lastStatusAt: new Date().toISOString(),
  };
}

/**
 * Conecta a instância: cria no UazAPI se ainda não existe, registra webhook, retorna QR.
 */
export async function connect(input: {
  baseUrl?: string;
  instanceToken?: string;
}): Promise<InstanceStatusResponse> {
  // Garante row
  let [row] = await db.select().from(whatsappInstance).limit(1);
  const envToken = uazapiTokenFromEnv();
  if (!row) {
    const baseUrl = input.baseUrl ?? process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com';
    [row] = await db
      .insert(whatsappInstance)
      .values({ baseUrl, instanceToken: input.instanceToken ?? envToken ?? null })
      .returning();
  } else {
    // Atualiza credenciais quando admin enviou novas OU quando a row existe sem token e há env disponível
    const nextBaseUrl = input.baseUrl ?? row.baseUrl;
    const nextToken = input.instanceToken ?? row.instanceToken ?? envToken ?? null;
    if (nextBaseUrl !== row.baseUrl || nextToken !== row.instanceToken) {
      [row] = await db
        .update(whatsappInstance)
        .set({
          baseUrl: nextBaseUrl,
          instanceToken: nextToken,
          updatedAt: new Date(),
        })
        .where(eq(whatsappInstance.id, row.id))
        .returning();
    }
  }

  // Cria instância no UazAPI se ainda não tem ID (usa AdminToken — admin auth).
  // O token per-instance que volta vai pra DB e é usado nas demais ops.
  let instanceId = row.instanceId;
  let instanceToken = row.instanceToken;
  if (!instanceId) {
    const adminToken = envToken;
    if (!adminToken) {
      throw new HttpError(400, 'UAZAPI_ADMIN_TOKEN required to init a new instance');
    }
    try {
      const init = await initInstance(
        { baseUrl: row.baseUrl, token: adminToken },
        'lubritec',
      );
      instanceId = init.instanceId;
      instanceToken = init.token;  // sempre o per-instance token devolvido por uazapiGO
      [row] = await db
        .update(whatsappInstance)
        .set({ instanceId, instanceToken, updatedAt: new Date() })
        .where(eq(whatsappInstance.id, row.id))
        .returning();
    } catch (err) {
      if (err instanceof UazapiInstanceError) {
        throw new HttpError(502, `UazAPI init failed: ${err.message}`);
      }
      throw err;
    }
  }

  if (!instanceToken) {
    throw new HttpError(500, 'Instance token missing after init');
  }

  // Garante webhook_secret e registra webhook (usa instance token).
  let webhookSecret = row.webhookSecret ?? generateWebhookSecret();
  const webhookUrl = buildWebhookUrl();

  try {
    const setWebhookResp = await setWebhook(
      { baseUrl: row.baseUrl, token: instanceToken },
      { url: webhookUrl, secret: webhookSecret, events: ['message.received'] },
    );
    console.log('[whatsapp:connect] setWebhook response:', JSON.stringify(setWebhookResp));
    [row] = await db
      .update(whatsappInstance)
      .set({
        webhookSecret,
        webhookUrl,
        webhookSynced: true,
        updatedAt: new Date(),
      })
      .where(eq(whatsappInstance.id, row.id))
      .returning();
  } catch (err) {
    console.error('[whatsapp:connect] setWebhook FAILED:', err instanceof Error ? err.message : err);
    // Webhook pode falhar mas instância já existe — marca como não sincronizado.
    [row] = await db
      .update(whatsappInstance)
      .set({ webhookSecret, webhookUrl, webhookSynced: false, updatedAt: new Date() })
      .where(eq(whatsappInstance.id, row.id))
      .returning();
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `Webhook config failed: ${err.message}`);
    }
    throw err;
  }

  // Inicia o pareamento — uazapiGO gera o QR via /instance/connect (chamada explícita).
  // Sem isso a instância fica em "disconnected" pra sempre.
  try {
    await connectInstance({ baseUrl: row.baseUrl, token: instanceToken });
  } catch (err) {
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `UazAPI connect failed: ${err.message}`);
    }
    throw err;
  }

  // Marca como pareando — frontend vai começar a pollar pelo QR
  await db
    .update(whatsappInstance)
    .set({ lastStatus: 'pairing', lastStatusAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappInstance.id, row.id));

  // Retorna status atualizado (que vai chamar UazAPI e pegar o QR)
  return getStatus();
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Logout sem deletar — admin pode reconectar depois.
 */
export async function disconnect(): Promise<InstanceStatusResponse> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row || !row.instanceId || !row.instanceToken) {
    throw new HttpError(400, 'No instance to disconnect');
  }

  try {
    await logoutInstance({
      baseUrl: row.baseUrl,
      token: row.instanceToken,
    });
  } catch (err) {
    if (err instanceof UazapiInstanceError) {
      throw new HttpError(502, `UazAPI logout failed: ${err.message}`);
    }
    throw err;
  }

  await db
    .update(whatsappInstance)
    .set({
      lastStatus: 'disconnected',
      lastStatusAt: new Date(),
      phoneNumber: null,
      profileName: null,
      updatedAt: new Date(),
    })
    .where(eq(whatsappInstance.id, row.id));

  return getStatus();
}

/**
 * Apaga a instância — UazAPI delete + DB delete. Admin only.
 */
export async function destroy(): Promise<void> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row) throw new HttpError(404, 'No instance to delete');

  // Tenta deletar no UazAPI (best-effort)
  if (row.instanceId && row.instanceToken) {
    try {
      await deleteInstance({
        baseUrl: row.baseUrl,
        token: row.instanceToken,
      });
    } catch {
      // Ignora — a row local vai ser apagada de qualquer jeito.
    }
  }

  await db.delete(whatsappInstance).where(eq(whatsappInstance.id, row.id));
}

// ---------------------------------------------------------------------------
// Internal: usado pelo uazapiClient e webhook handler
// ---------------------------------------------------------------------------

export interface SendUazapiConfig {
  baseUrl: string;
  instanceId: string;
  token: string;
}

/**
 * Carrega config para envio de mensagens (lê DB com fallback pra env).
 * Lança UazapiInstanceError(503) se não há config configurada.
 */
export async function loadSendConfig(): Promise<SendUazapiConfig> {
  const row = await loadOrSeed();
  if (!row || !row.instanceId || !row.instanceToken) {
    throw new UazapiInstanceError(503, 'WhatsApp instance not configured');
  }
  return {
    baseUrl: row.baseUrl,
    instanceId: row.instanceId,
    token: row.instanceToken,
  };
}

/**
 * Carrega o webhook secret ativo. Tenta DB primeiro, depois env como fallback.
 */
export async function loadWebhookSecret(): Promise<string | null> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (row?.webhookSecret) return row.webhookSecret;
  return process.env.UAZAPI_WEBHOOK_SECRET ?? null;
}

/**
 * Tokens aceitos para autenticar webhook recebido da UazAPI.
 *
 * uazapiGO não armazena nosso `webhook_secret` — quando dispara o webhook,
 * inclui o `token` da própria instância no body do payload. Por isso aceitamos
 * AMBOS: o webhook_secret (caso uma versão futura suporte) e o instance_token
 * (que é o que vem na prática hoje).
 */
export async function loadValidWebhookTokens(): Promise<string[]> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  const tokens: string[] = [];
  if (row?.webhookSecret) tokens.push(row.webhookSecret);
  if (row?.instanceToken) tokens.push(row.instanceToken);
  if (process.env.UAZAPI_WEBHOOK_SECRET) tokens.push(process.env.UAZAPI_WEBHOOK_SECRET);
  return tokens;
}

/**
 * Diagnóstico — pergunta direto pra UazAPI o que ela tem cadastrado de webhook.
 * Retorna o que cada path tentado respondeu + o que NÓS armazenamos no DB
 * (URL/secret/synced) pra comparação.
 */
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
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row || !row.instanceToken) {
    return { ours: null, uazapi: [] };
  }
  const { probeWebhookConfig } = await import('./uazapiInstanceClient');
  const uazapi = await probeWebhookConfig({
    baseUrl: row.baseUrl,
    token: row.instanceToken,
  });
  return {
    ours: {
      webhookUrl: row.webhookUrl,
      webhookSecretPresent: !!row.webhookSecret,
      webhookSynced: row.webhookSynced,
      instanceId: row.instanceId,
      baseUrl: row.baseUrl,
    },
    uazapi,
  };
}

/**
 * Diagnóstico — busca mensagens recentes direto da UazAPI (sem usar webhook).
 * Se a UazAPI tiver mensagens armazenadas mas webhook não disparou, isolou o bug.
 */
export async function probeMessages(): Promise<{
  uazapi: Array<{ path: string; method: string; status: number; body: unknown }>;
}> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row || !row.instanceToken) return { uazapi: [] };
  const { probeRecentMessages } = await import('./uazapiInstanceClient');
  const uazapi = await probeRecentMessages({
    baseUrl: row.baseUrl,
    token: row.instanceToken,
  });
  return { uazapi };
}

/**
 * Diagnóstico — auto-fire de um payload sintético na nossa própria URL de webhook.
 * Usa o secret correto. Permite validar TODO o pipeline de ingest sem depender da UazAPI.
 */
export async function selfTestWebhook(): Promise<{
  posted: { url: string; bodyPreview: Record<string, unknown> };
  response: { status: number; body: unknown };
}> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row) {
    throw new HttpError(503, 'WhatsApp instance not configured');
  }
  const url = row.webhookUrl
    ?? `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/whatsapp/webhook`;
  const token = row.instanceToken ?? row.webhookSecret;
  if (!token) {
    throw new HttpError(503, 'No instance token or webhook secret available');
  }

  const fakeMsgId = `selftest-${Date.now()}`;
  const fakePhone = `5511${String(Date.now()).slice(-8)}`;
  const body: Record<string, unknown> = {
    EventType: 'messages',
    instance: row.instanceId,
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

  return {
    posted: { url, bodyPreview: body },
    response: { status: res.status, body: respBody },
  };
}
