# WhatsApp Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar página `/settings?tab=whatsapp` para gerenciar a instância UazAPI (CONECTAR/DESCONECTAR/APAGAR + QR), com config persistida no DB substituindo env vars (que viram seed inicial), conforme spec `docs/superpowers/specs/2026-05-02-whatsapp-connection-design.md`.

**Architecture:** Migration 011 cria `whatsapp_instance` (single-row via UNIQUE INDEX em coluna constante). `uazapiInstanceClient` é wrapper HTTP puro pras chamadas de management do UazAPI; `whatsappInstanceService` orquestra (DB + UazAPI + seed automático). Refactor crítico: `uazapiClient.sendMessage` (existente) vira async-DB-backed via shim que preserva interface — todos os 188 testes existentes continuam passando. Frontend dark com tabs em Settings, polling adaptativo (2s pairing / 30s connected).

**Tech Stack:** Express + Drizzle 0.45 + Zod 4 + Postgres 16; React 19 + Vite + TanStack Query 5 + shadcn/ui. **Sem dependências novas.**

---

## File map

**Criar — backend:**
- `server/db/migrations/011_whatsapp_instance.sql`
- `server/services/uazapiInstanceClient.ts`
- `server/services/whatsappInstanceService.ts`
- `server/controllers/whatsappInstanceController.ts`
- `server/routes/whatsappInstance.ts`
- `server/tests/whatsapp-instance-status.test.ts`
- `server/tests/whatsapp-instance-connect.test.ts`
- `server/tests/whatsapp-instance-disconnect.test.ts`
- `server/tests/whatsapp-instance-delete.test.ts`
- `server/tests/whatsapp-instance-rbac.test.ts`
- `server/tests/uazapi-config-loader.test.ts`

**Criar — frontend:**
- `src/features/settings/whatsapp/api.ts`
- `src/features/settings/whatsapp/helpers.ts`
- `src/features/settings/whatsapp/types.ts`
- `src/features/settings/whatsapp/StatusBadges.tsx`
- `src/features/settings/whatsapp/QrDisplay.tsx`
- `src/features/settings/whatsapp/InstanceStatusCard.tsx`
- `src/features/settings/whatsapp/ConnectionControls.tsx`
- `src/features/settings/whatsapp/ConfirmDeleteDialog.tsx`
- `src/pages/settings/WhatsappConnectionTab.tsx`

**Modificar:**
- `shared/types.ts` — adicionar `INSTANCE_STATUSES`, `InstanceStatus`, `InstanceStatusResponse`
- `server/db/schema.ts` — adicionar `whatsappInstance` (single-row)
- `server/tests/setup.ts` — incluir `whatsapp_instance` no TRUNCATE
- `server/tests/helpers.ts` — adicionar `createWhatsappInstance`
- `server/services/uazapiClient.ts` — refactor pra async + DB-backed via shim
- `server/controllers/whatsappWebhookController.ts` — secret leitura DB-first, env fallback
- `server/app.ts` — registrar `whatsappInstanceRoutes`
- `src/pages/settings/SettingsPage.tsx` — substituir placeholder por shell de tabs
- `src/components/layout/Sidebar.tsx` — restringir Settings a `admin` + `comercial` (recepção não vê)
- `.env.example` — atualizar nota: vars UazAPI viram seed inicial
- `README.md` — marcar item 6 do roadmap, adicionar seção "Conexão WhatsApp"

---

## Task 1 — Migration 011 + schema + tipos + setup + helper de teste

**Files:**
- Create: `server/db/migrations/011_whatsapp_instance.sql`
- Modify: `shared/types.ts`
- Modify: `server/db/schema.ts`
- Modify: `server/tests/setup.ts`
- Modify: `server/tests/helpers.ts`

- [ ] **Step 1.1:** Criar `server/db/migrations/011_whatsapp_instance.sql`:

```sql
CREATE TABLE whatsapp_instance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton       boolean NOT NULL DEFAULT true,
  base_url        text NOT NULL,
  instance_id     text,
  instance_token  text,
  webhook_secret  text,
  webhook_url     text,
  webhook_synced  boolean NOT NULL DEFAULT false,
  phone_number    text,
  profile_name    text,
  last_status     text,
  last_status_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_whatsapp_instance_singleton
  ON whatsapp_instance(singleton);
```

- [ ] **Step 1.2:** Aplicar migration nos dois schemas.

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Esperado: `→ 011_whatsapp_instance.sql (applied)` em ambos.

- [ ] **Step 1.3:** Adicionar tipos no fim de `shared/types.ts`:

```ts
// ---------------------------------------------------------------------------
// WhatsApp Connection (sub-projeto 6)
// ---------------------------------------------------------------------------

export const INSTANCE_STATUSES = [
  'disconnected',
  'pairing',
  'connected',
  'error',
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export interface InstanceStatusResponse {
  configured: boolean;
  status: InstanceStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  webhookSynced: boolean;
  baseUrl: string;
  lastStatusAt: string | null;
}
```

- [ ] **Step 1.4:** Atualizar `server/db/schema.ts`. Adicionar a tabela no fim (antes da seção de `export type ...`):

```ts
export const whatsappInstance = pgTable('whatsapp_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  singleton: boolean('singleton').notNull().default(true),
  baseUrl: text('base_url').notNull(),
  instanceId: text('instance_id'),
  instanceToken: text('instance_token'),
  webhookSecret: text('webhook_secret'),
  webhookUrl: text('webhook_url'),
  webhookSynced: boolean('webhook_synced').notNull().default(false),
  phoneNumber: text('phone_number'),
  profileName: text('profile_name'),
  lastStatus: text('last_status'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

E adicionar os type exports junto dos outros no fim:

```ts
export type WhatsappInstance = typeof whatsappInstance.$inferSelect;
export type NewWhatsappInstance = typeof whatsappInstance.$inferInsert;
```

- [ ] **Step 1.5:** Atualizar `server/tests/setup.ts` — adicionar `whatsapp_instance` no fim do TRUNCATE (não tem FK pra outras tabelas, ordem não importa muito; coloca no fim):

Localizar:
```ts
'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE'
```

Substituir por:
```ts
'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users, whatsapp_instance RESTART IDENTITY CASCADE'
```

- [ ] **Step 1.6:** Adicionar helper em `server/tests/helpers.ts`. Anexar no fim:

```ts
import { whatsappInstance } from '../db/schema';

export async function createWhatsappInstance(opts: {
  baseUrl?: string;
  instanceId?: string | null;
  instanceToken?: string | null;
  webhookSecret?: string | null;
  webhookUrl?: string | null;
  webhookSynced?: boolean;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastStatus?: string | null;
} = {}) {
  const [row] = await db
    .insert(whatsappInstance)
    .values({
      baseUrl: opts.baseUrl ?? 'https://api.uazapi.com',
      instanceId: opts.instanceId ?? null,
      instanceToken: opts.instanceToken ?? null,
      webhookSecret: opts.webhookSecret ?? null,
      webhookUrl: opts.webhookUrl ?? null,
      webhookSynced: opts.webhookSynced ?? false,
      phoneNumber: opts.phoneNumber ?? null,
      profileName: opts.profileName ?? null,
      lastStatus: opts.lastStatus ?? null,
    })
    .returning();
  return row;
}
```

- [ ] **Step 1.7:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 1.8:** Commit.

```bash
git add server/db/migrations/011_whatsapp_instance.sql shared/types.ts server/db/schema.ts server/tests/setup.ts server/tests/helpers.ts
git commit -m "feat(whatsapp-conn): migration 011 + schema + types + helper"
```

---

## Task 2 — uazapiInstanceClient (HTTP wrapper)

**Files:**
- Create: `server/services/uazapiInstanceClient.ts`

- [ ] **Step 2.1:** Criar `server/services/uazapiInstanceClient.ts`:

```ts
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
    (json?.data as Record<string, unknown> | undefined)?.id as string | undefined;
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
```

- [ ] **Step 2.2:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 2.3:** Commit.

```bash
git add server/services/uazapiInstanceClient.ts
git commit -m "feat(whatsapp-conn): UazAPI instance client (init/status/qr/logout/delete/webhook)"
```

---

## Task 3 — whatsappInstanceService (orquestração + seed)

**Files:**
- Create: `server/services/whatsappInstanceService.ts`

- [ ] **Step 3.1:** Criar `server/services/whatsappInstanceService.ts`:

```ts
import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { InstanceStatusResponse, InstanceStatus } from '@shared/types';
import {
  initInstance,
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
  const token = process.env.UAZAPI_TOKEN;
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
      instanceId: row.instanceId,
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
  if (!row) {
    const baseUrl = input.baseUrl ?? process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com';
    [row] = await db
      .insert(whatsappInstance)
      .values({ baseUrl, instanceToken: input.instanceToken ?? process.env.UAZAPI_TOKEN ?? null })
      .returning();
  } else if (input.baseUrl || input.instanceToken) {
    // Atualiza credenciais se admin enviou novas
    [row] = await db
      .update(whatsappInstance)
      .set({
        baseUrl: input.baseUrl ?? row.baseUrl,
        instanceToken: input.instanceToken ?? row.instanceToken,
        updatedAt: new Date(),
      })
      .where(eq(whatsappInstance.id, row.id))
      .returning();
  }

  if (!row.instanceToken) {
    throw new HttpError(400, 'Instance token required (set UAZAPI_TOKEN env or pass via body)');
  }

  // Cria instância no UazAPI se ainda não tem ID
  let instanceId = row.instanceId;
  let instanceToken = row.instanceToken;
  if (!instanceId) {
    try {
      const init = await initInstance(
        { baseUrl: row.baseUrl, token: instanceToken },
        'lubritec',
      );
      instanceId = init.instanceId;
      // Se UazAPI retornar token específico da instância, usa ele.
      if (init.token) instanceToken = init.token;
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

  // Garante webhook_secret e registra webhook
  let webhookSecret = row.webhookSecret ?? generateWebhookSecret();
  const webhookUrl = buildWebhookUrl();

  try {
    await setWebhook(
      { baseUrl: row.baseUrl, token: instanceToken, instanceId },
      { url: webhookUrl, secret: webhookSecret, events: ['message.received'] },
    );
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
      instanceId: row.instanceId,
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
        instanceId: row.instanceId,
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
```

- [ ] **Step 3.2:** Lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 3.3:** Commit.

```bash
git add server/services/whatsappInstanceService.ts
git commit -m "feat(whatsapp-conn): instance service with auto-seed + connect/disconnect/destroy"
```

---

## Task 4 — Refactor uazapiClient (sendMessage) + webhook controller pra DB-backed

**Files:**
- Modify: `server/services/uazapiClient.ts`
- Modify: `server/controllers/whatsappWebhookController.ts`

**Importante:** essa task NÃO pode quebrar os 188 testes existentes. O shim de retrocompat preserva a interface `uazapiClient.sendMessage(opts)` que os testes mockam via `vi.mock('../services/uazapiClient', ...)`.

- [ ] **Step 4.1:** Substituir `server/services/uazapiClient.ts` por:

```ts
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
```

- [ ] **Step 4.2:** Atualizar `server/controllers/whatsappWebhookController.ts` pra ler secret do DB com fallback de env. Substituir o arquivo todo por:

```ts
import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { loadWebhookSecret } from '../services/whatsappInstanceService';

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Lê secret ativo: DB > env. Sem nenhum, qualquer chamada é 401.
    const expected = await loadWebhookSecret();
    if (!expected) {
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
    const got = req.header('X-Webhook-Token');
    if (got !== expected) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(200).end();
    }
    await ingestInbound(parsed.data, req.body);
    return res.status(200).end();
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 4.3:** Rodar a suite completa pra confirmar que **nada quebrou**. Esse é o gate crítico do task.

```bash
npm test
```

Esperado: 188/188 testes verdes (mesmo número antes do task — sem regressões). Os testes do WhatsApp Inbox (`whatsapp-webhook.test.ts`, `conversations-send.test.ts`, `whatsapp-pipeline-trigger.test.ts`) usam `vi.mock('../services/uazapiClient', ...)` ou setam `process.env.UAZAPI_WEBHOOK_SECRET = SECRET` em `beforeEach`. Ambos casos continuam funcionando:
- Mock de uazapiClient → `uazapiClient.sendMessage` ainda existe como shim, mock substitui no nível do módulo.
- Env webhook secret → `loadWebhookSecret()` cai no fallback de env quando DB vazio (que é o caso nos testes — `setup.ts` faz TRUNCATE de `whatsapp_instance`).

Se algum teste quebrar, **PARE** e reporte. Não suprima testes; fix root cause.

- [ ] **Step 4.4:** Lint.

```bash
npm run lint
```

- [ ] **Step 4.5:** Commit.

```bash
git add server/services/uazapiClient.ts server/controllers/whatsappWebhookController.ts
git commit -m "refactor(whatsapp): uazapiClient + webhook controller read config from DB (env fallback)"
```

---

## Task 5 — Endpoints + RBAC + tests TDD

**Files:**
- Create: `server/controllers/whatsappInstanceController.ts`
- Create: `server/routes/whatsappInstance.ts`
- Create: `server/tests/whatsapp-instance-status.test.ts`
- Create: `server/tests/whatsapp-instance-connect.test.ts`
- Create: `server/tests/whatsapp-instance-disconnect.test.ts`
- Create: `server/tests/whatsapp-instance-delete.test.ts`
- Create: `server/tests/whatsapp-instance-rbac.test.ts`
- Create: `server/tests/uazapi-config-loader.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 5.1:** Escrever `server/tests/whatsapp-instance-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { getInstanceStatus } from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAs(email = 'a@x.com', role: 'admin' | 'comercial' | 'recepcao' = 'admin') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(getInstanceStatus).mockReset();
  // Garante env vars limpas entre testes
  delete process.env.UAZAPI_BASE_URL;
  delete process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_INSTANCE_ID;
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('GET /api/whatsapp-instance', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/whatsapp-instance');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const token = await loginAs('r@x.com', 'recepcao');
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 retorna configured: false quando DB vazio e sem env', async () => {
    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.status).toBe('disconnected');
  });

  it('seed automático quando env vars completas e DB vazio', async () => {
    process.env.UAZAPI_BASE_URL = 'https://api.uazapi.com';
    process.env.UAZAPI_TOKEN = 'env-token';
    process.env.UAZAPI_INSTANCE_ID = 'env-instance';
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    process.env.APP_URL = 'http://localhost:3000';

    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'connected',
      qrCode: null,
      phoneNumber: '5511987654321',
      profileName: 'Test',
      rawPayload: {},
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.status).toBe('connected');
    expect(res.body.phoneNumber).toBe('5511987654321');
    expect(res.body.webhookSynced).toBe(true);
  });

  it('200 com instance_id consulta UazAPI ao vivo', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: 'inst-1',
      instanceToken: 'tok-1',
      webhookSecret: 'sec-1',
      webhookSynced: true,
    });

    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'data:image/png;base64,XXX',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pairing');
    expect(res.body.qrCode).toBe('data:image/png;base64,XXX');
  });

  it('200 retorna status=error quando UazAPI falha', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: 'inst-2',
      instanceToken: 'tok-2',
    });

    vi.mocked(getInstanceStatus).mockRejectedValueOnce(new Error('connection lost'));

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
  });

  it('200 sem instance_id (row criada mas não conectada) retorna configured: false', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://api.uazapi.com',
      instanceId: null,
      instanceToken: null,
    });

    const token = await loginAs();
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});
```

- [ ] **Step 5.2:** Escrever `server/tests/whatsapp-instance-connect.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import {
  initInstance,
  getInstanceStatus,
  setWebhook,
} from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(initInstance).mockReset();
  vi.mocked(getInstanceStatus).mockReset();
  vi.mocked(setWebhook).mockReset();
  process.env.APP_URL = 'http://localhost:3000';
  process.env.UAZAPI_TOKEN = 'env-token-fallback';
});

describe('POST /api/whatsapp-instance/connect', () => {
  it('cria row + chama UazAPI init + setWebhook + retorna QR', async () => {
    vi.mocked(initInstance).mockResolvedValueOnce({
      instanceId: 'new-inst-1',
      token: 'instance-token',
      rawPayload: {},
    });
    vi.mocked(setWebhook).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'data:image/png;base64,QR',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pairing');
    expect(res.body.qrCode).toBe('data:image/png;base64,QR');
    expect(res.body.webhookSynced).toBe(true);

    expect(vi.mocked(initInstance)).toHaveBeenCalled();
    expect(vi.mocked(setWebhook)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        url: 'http://localhost:3000/api/whatsapp/webhook',
        events: ['message.received'],
      }),
    );
  });

  it('idempotente: se já tem instanceId, reusa em vez de re-criar', async () => {
    await createWhatsappInstance({
      instanceId: 'existing-inst',
      instanceToken: 'tok',
      webhookSecret: 'sec',
    });

    vi.mocked(setWebhook).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'pairing',
      qrCode: 'QR',
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(vi.mocked(initInstance)).not.toHaveBeenCalled();
    expect(vi.mocked(setWebhook)).toHaveBeenCalled();
  });

  it('502 quando UazAPI init falha', async () => {
    const { UazapiInstanceError } = await import('../services/uazapiInstanceClient');
    vi.mocked(initInstance).mockRejectedValueOnce(new UazapiInstanceError(500, 'down'));

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(502);
  });

  it('webhookSynced=false se setWebhook falhar mas instância criada', async () => {
    vi.mocked(initInstance).mockResolvedValueOnce({
      instanceId: 'new-inst-2',
      rawPayload: {},
    });
    const { UazapiInstanceError } = await import('../services/uazapiInstanceClient');
    vi.mocked(setWebhook).mockRejectedValueOnce(new UazapiInstanceError(500, 'down'));

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(502);

    const [row] = await db.select().from(whatsappInstance);
    expect(row.instanceId).toBe('new-inst-2');
    expect(row.webhookSynced).toBe(false);
  });
});
```

- [ ] **Step 5.3:** Escrever `server/tests/whatsapp-instance-disconnect.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { logoutInstance, getInstanceStatus } from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(logoutInstance).mockReset();
  vi.mocked(getInstanceStatus).mockReset();
});

describe('POST /api/whatsapp-instance/disconnect', () => {
  it('400 sem instance no DB', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 chama UazAPI logout e mantém row', async () => {
    await createWhatsappInstance({
      instanceId: 'inst-x',
      instanceToken: 'tok',
      phoneNumber: '5511999999999',
      profileName: 'Old',
      webhookSecret: 'sec',
    });

    vi.mocked(logoutInstance).mockResolvedValueOnce(undefined);
    vi.mocked(getInstanceStatus).mockResolvedValueOnce({
      status: 'disconnected',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      rawPayload: {},
    });

    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');

    // Row preservada, mas phone/profile limpos
    const [row] = await db.select().from(whatsappInstance);
    expect(row).toBeDefined();
    expect(row.instanceId).toBe('inst-x');
    expect(row.phoneNumber).toBeNull();
    expect(row.profileName).toBeNull();
  });
});
```

- [ ] **Step 5.4:** Escrever `server/tests/whatsapp-instance-delete.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { deleteInstance } from '../services/uazapiInstanceClient';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(deleteInstance).mockReset();
});

describe('DELETE /api/whatsapp-instance', () => {
  it('403 pra comercial (admin only)', async () => {
    const token = await loginAs('c@x.com', 'comercial');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('404 quando DB vazio', async () => {
    const token = await loginAs('a@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('204 admin deleta UazAPI + row', async () => {
    await createWhatsappInstance({
      instanceId: 'inst-del',
      instanceToken: 'tok',
    });
    vi.mocked(deleteInstance).mockResolvedValueOnce(undefined);

    const token = await loginAs('a2@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(whatsappInstance);
    expect(rows).toHaveLength(0);
    expect(vi.mocked(deleteInstance)).toHaveBeenCalled();
  });

  it('204 mesmo se UazAPI delete falhar (best-effort) — apaga local', async () => {
    await createWhatsappInstance({
      instanceId: 'inst-fail',
      instanceToken: 'tok',
    });
    vi.mocked(deleteInstance).mockRejectedValueOnce(new Error('uazapi down'));

    const token = await loginAs('a3@x.com', 'admin');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(whatsappInstance);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 5.5:** Escrever `server/tests/whatsapp-instance-rbac.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/uazapiInstanceClient', () => ({
  initInstance: vi.fn().mockResolvedValue({ instanceId: 'x', rawPayload: {} }),
  getInstanceStatus: vi.fn().mockResolvedValue({
    status: 'disconnected', qrCode: null, phoneNumber: null, profileName: null, rawPayload: {},
  }),
  logoutInstance: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
  setWebhook: vi.fn().mockResolvedValue(undefined),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

beforeEach(() => {
  process.env.UAZAPI_TOKEN = 'env-token';
  process.env.APP_URL = 'http://localhost:3000';
});

describe('Whatsapp Instance RBAC', () => {
  it('recepção 403 em GET /api/whatsapp-instance', async () => {
    const token = await loginAs('r@x.com', 'recepcao');
    const res = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepção 403 em POST /connect', async () => {
    const token = await loginAs('r2@x.com', 'recepcao');
    const res = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('recepção 403 em POST /disconnect', async () => {
    const token = await loginAs('r3@x.com', 'recepcao');
    const res = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepção 403 em DELETE', async () => {
    const token = await loginAs('r4@x.com', 'recepcao');
    const res = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('comercial 403 só em DELETE; OK em GET/connect/disconnect', async () => {
    const token = await loginAs('c@x.com', 'comercial');

    const get = await request(app)
      .get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);

    await createWhatsappInstance({
      instanceId: 'inst-c',
      instanceToken: 'tok',
      webhookSecret: 'sec',
    });

    const connect = await request(app)
      .post('/api/whatsapp-instance/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(connect.status).toBe(200);

    const disconnect = await request(app)
      .post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect(disconnect.status).toBe(200);

    const del = await request(app)
      .delete('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
```

- [ ] **Step 5.6:** Escrever `server/tests/uazapi-config-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createWhatsappInstance } from './helpers';
import { loadSendConfig, loadWebhookSecret } from '../services/whatsappInstanceService';

beforeEach(() => {
  delete process.env.UAZAPI_BASE_URL;
  delete process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_INSTANCE_ID;
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('loadSendConfig', () => {
  it('lança 503 quando DB vazio e env incompleto', async () => {
    await expect(loadSendConfig()).rejects.toThrow();
  });

  it('lê do DB quando row existe com instanceId+token', async () => {
    await createWhatsappInstance({
      baseUrl: 'https://x.api',
      instanceId: 'i',
      instanceToken: 't',
    });
    const cfg = await loadSendConfig();
    expect(cfg.baseUrl).toBe('https://x.api');
    expect(cfg.instanceId).toBe('i');
    expect(cfg.token).toBe('t');
  });

  it('faz seed automático quando DB vazio mas env completo', async () => {
    process.env.UAZAPI_BASE_URL = 'https://api.uazapi.com';
    process.env.UAZAPI_TOKEN = 'env-token';
    process.env.UAZAPI_INSTANCE_ID = 'env-instance';
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';

    const cfg = await loadSendConfig();
    expect(cfg.instanceId).toBe('env-instance');
    expect(cfg.token).toBe('env-token');

    // Confirma que row foi criada
    const [row] = await db.select().from(whatsappInstance);
    expect(row).toBeDefined();
    expect(row.webhookSynced).toBe(true);
  });
});

describe('loadWebhookSecret', () => {
  it('retorna null quando DB vazio e env vazio', async () => {
    const s = await loadWebhookSecret();
    expect(s).toBeNull();
  });

  it('lê do DB quando preenchido', async () => {
    await createWhatsappInstance({ webhookSecret: 'db-secret' });
    const s = await loadWebhookSecret();
    expect(s).toBe('db-secret');
  });

  it('fallback pra env quando DB vazio mas env preenchido', async () => {
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    const s = await loadWebhookSecret();
    expect(s).toBe('env-secret');
  });

  it('DB tem precedência sobre env', async () => {
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    await createWhatsappInstance({ webhookSecret: 'db-secret' });
    const s = await loadWebhookSecret();
    expect(s).toBe('db-secret');
  });
});
```

- [ ] **Step 5.7:** Rodar testes — devem TODOS falhar (rotas não existem ainda).

```bash
npm test -- server/tests/whatsapp-instance-status.test.ts server/tests/whatsapp-instance-connect.test.ts server/tests/whatsapp-instance-disconnect.test.ts server/tests/whatsapp-instance-delete.test.ts server/tests/whatsapp-instance-rbac.test.ts server/tests/uazapi-config-loader.test.ts
```

Esperado: a maioria falha (404 / rotas não registradas). Os de `uazapi-config-loader.test.ts` podem passar parcialmente se o service já foi escrito em Task 3.

- [ ] **Step 5.8:** Implementar `server/controllers/whatsappInstanceController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getStatus,
  connect,
  disconnect,
  destroy,
} from '../services/whatsappInstanceService';

const connectBody = z.object({
  baseUrl: z.string().url().optional(),
  instanceToken: z.string().min(1).optional(),
}).passthrough();

export async function statusHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getStatus());
  } catch (e) { next(e); }
}

export async function connectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = connectBody.parse(req.body ?? {});
    res.json(await connect({ baseUrl: data.baseUrl, instanceToken: data.instanceToken }));
  } catch (e) { next(e); }
}

export async function disconnectHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await disconnect());
  } catch (e) { next(e); }
}

export async function deleteHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    await destroy();
    res.status(204).end();
  } catch (e) { next(e); }
}
```

- [ ] **Step 5.9:** Criar `server/routes/whatsappInstance.ts`:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  statusHandler,
  connectHandler,
  disconnectHandler,
  deleteHandler,
} from '../controllers/whatsappInstanceController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...guard, statusHandler);
router.post('/connect', ...guard, connectHandler);
router.post('/disconnect', ...guard, disconnectHandler);
router.delete('/', ...adminOnly, deleteHandler);

export default router;
```

- [ ] **Step 5.10:** Registrar rota em `server/app.ts`. Adicionar import e mount antes do `/api` 404 fallback:

```ts
// no topo:
import whatsappInstanceRoutes from './routes/whatsappInstance';

// dentro do createApp(), antes de app.use('/api', ...) 404:
app.use('/api/whatsapp-instance', whatsappInstanceRoutes);
```

- [ ] **Step 5.11:** Rodar testes deste task.

```bash
npm test -- server/tests/whatsapp-instance-status.test.ts server/tests/whatsapp-instance-connect.test.ts server/tests/whatsapp-instance-disconnect.test.ts server/tests/whatsapp-instance-delete.test.ts server/tests/whatsapp-instance-rbac.test.ts server/tests/uazapi-config-loader.test.ts
```

Esperado: todos passam.

- [ ] **Step 5.12:** Rodar suite completa pra confirmar zero regressão.

```bash
npm test
```

Esperado: total = 188 (anteriores) + ~25 (novos) = ~213 passando.

- [ ] **Step 5.13:** Lint + commit.

```bash
npm run lint
git add server/controllers/whatsappInstanceController.ts server/routes/whatsappInstance.ts server/tests/whatsapp-instance-status.test.ts server/tests/whatsapp-instance-connect.test.ts server/tests/whatsapp-instance-disconnect.test.ts server/tests/whatsapp-instance-delete.test.ts server/tests/whatsapp-instance-rbac.test.ts server/tests/uazapi-config-loader.test.ts server/app.ts
git commit -m "feat(whatsapp-conn): instance endpoints + RBAC + tests"
```

---

## Task 6 — Settings shell com tabs + RBAC sidebar

**Files:**
- Modify: `src/pages/settings/SettingsPage.tsx`
- Create: `src/pages/settings/WhatsappConnectionTab.tsx` (placeholder por enquanto — Task 8 enche)
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 6.1:** Atualizar `src/components/layout/Sidebar.tsx` — restringir Settings a admin + comercial. Localizar o array `items` e mudar a entry de Settings:

Substituir:
```tsx
{ to: '/settings', label: 'Configurações', icon: SettingsIcon },
```
Por:
```tsx
{ to: '/settings', label: 'Configurações', icon: SettingsIcon, salesOnly: true },
```

A função `visible` (já existente do Task 10 do Inside Sales) já trata `salesOnly` — admin + comercial veem; recepção não.

- [ ] **Step 6.2:** Criar placeholder `src/pages/settings/WhatsappConnectionTab.tsx`:

```tsx
export default function WhatsappConnectionTab() {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Conexão WhatsApp — Tasks 8-9
    </div>
  );
}
```

- [ ] **Step 6.3:** Substituir `src/pages/settings/SettingsPage.tsx` por shell de tabs:

```tsx
import { useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const WhatsappConnectionTab = lazy(() => import('./WhatsappConnectionTab'));

const Loader = () => <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;

type Tab = 'whatsapp';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'whatsapp';

  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Configurações do sistema</p>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'whatsapp'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('whatsapp')}
        >
          Conexão WhatsApp
        </button>
        {/* Futuras tabs entram aqui */}
      </div>

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {tab === 'whatsapp' && <WhatsappConnectionTab />}
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.4:** Lint.

```bash
npm run lint
```

- [ ] **Step 6.5:** Commit.

```bash
git add src/pages/settings/SettingsPage.tsx src/pages/settings/WhatsappConnectionTab.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(settings): shell with tabs + restrict sidebar to admin/comercial"
```

---

## Task 7 — Frontend api.ts + helpers + types

**Files:**
- Create: `src/features/settings/whatsapp/api.ts`
- Create: `src/features/settings/whatsapp/helpers.ts`
- Create: `src/features/settings/whatsapp/types.ts`

- [ ] **Step 7.1:** Criar `src/features/settings/whatsapp/types.ts`:

```ts
export type {
  InstanceStatus,
  InstanceStatusResponse,
} from '@shared/types';
```

- [ ] **Step 7.2:** Criar `src/features/settings/whatsapp/helpers.ts`:

```ts
import type { InstanceStatus } from './types';

export const STATUS_LABELS: Record<InstanceStatus, string> = {
  disconnected: 'Canal Desconectado',
  pairing: 'Pareando',
  connected: 'Canal Conectado',
  error: 'Erro de Conexão',
};

export const STATUS_TONES: Record<InstanceStatus, string> = {
  disconnected: 'bg-muted text-muted-foreground',
  pairing: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  connected: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return phone;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'agora';
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 7.3:** Criar `src/features/settings/whatsapp/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { InstanceStatusResponse } from './types';

export function useInstanceStatus() {
  return useQuery({
    queryKey: ['whatsapp-instance'],
    queryFn: () => api<InstanceStatusResponse>('/whatsapp-instance'),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'pairing') return 2_000;
      if (status === 'connected') return 30_000;
      return 5_000;
    },
    refetchIntervalInBackground: false,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['whatsapp-instance'] });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseUrl?: string; instanceToken?: string } = {}) =>
      api<InstanceStatusResponse>('/whatsapp-instance/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<InstanceStatusResponse>('/whatsapp-instance/disconnect', { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/whatsapp-instance', { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}
```

- [ ] **Step 7.4:** Lint + commit.

```bash
npm run lint
git add src/features/settings/whatsapp/api.ts src/features/settings/whatsapp/helpers.ts src/features/settings/whatsapp/types.ts
git commit -m "feat(whatsapp-conn): TanStack hooks + helpers + types"
```

---

## Task 8 — Componentes visuais (StatusBadges, QrDisplay, InstanceStatusCard)

**Files:**
- Create: `src/features/settings/whatsapp/StatusBadges.tsx`
- Create: `src/features/settings/whatsapp/QrDisplay.tsx`
- Create: `src/features/settings/whatsapp/InstanceStatusCard.tsx`

- [ ] **Step 8.1:** Criar `src/features/settings/whatsapp/StatusBadges.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, STATUS_TONES } from './helpers';
import type { InstanceStatus } from './types';

interface Props {
  status: InstanceStatus;
  webhookSynced: boolean;
}

export function StatusBadges({ status, webhookSynced }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className={`uppercase tracking-wide text-[10px] px-3 py-1 border ${STATUS_TONES[status]}`}>
        {STATUS_LABELS[status]}
      </Badge>
      <Badge
        variant="outline"
        className={`uppercase tracking-wide text-[10px] px-3 py-1 border ${
          webhookSynced
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {webhookSynced ? 'Webhook Ativo' : 'Webhook Inativo'}
      </Badge>
    </div>
  );
}
```

- [ ] **Step 8.2:** Criar `src/features/settings/whatsapp/QrDisplay.tsx`:

```tsx
interface Props {
  qrCode: string;
}

export function QrDisplay({ qrCode }: Props) {
  // qrCode pode vir como "data:image/png;base64,..." ou só base64 puro.
  const src = qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`;
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="rounded-lg border-2 border-border p-3 bg-white">
        <img src={src} alt="QR Code WhatsApp" className="w-64 h-64" />
      </div>
      <div className="text-center max-w-md">
        <h3 className="text-sm font-semibold mb-2">Escaneie no WhatsApp do celular</h3>
        <ol className="text-xs text-muted-foreground space-y-1 text-left list-decimal list-inside">
          <li>Abra o WhatsApp no seu celular</li>
          <li>Toque em <strong>Configurações &gt; Aparelhos conectados</strong></li>
          <li>Toque em <strong>Conectar um aparelho</strong></li>
          <li>Aponte a câmera pra esse QR</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-3">
          QR atualiza automaticamente. Não feche essa tela durante o pareamento.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3:** Criar `src/features/settings/whatsapp/InstanceStatusCard.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { QrDisplay } from './QrDisplay';
import { formatPhoneBR, relativeTime } from './helpers';
import type { InstanceStatusResponse } from './types';

interface Props {
  data: InstanceStatusResponse | undefined;
  isLoading: boolean;
}

export function InstanceStatusCard({ data, isLoading }: Props) {
  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Empty state — sem instância configurada
  if (!data.configured) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <span className="text-3xl">📱</span>
        </div>
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-2">Pronto para Conectar</h3>
        <p className="text-xs text-muted-foreground max-w-md">
          Assim que você criar ou reconectar a instância, o QR e os detalhes de conexão aparecem aqui.
        </p>
      </div>
    );
  }

  // Pairing — mostra QR
  if (data.status === 'pairing' && data.qrCode) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <QrDisplay qrCode={data.qrCode} />
      </div>
    );
  }

  // Connected — info do número pareado
  if (data.status === 'connected') {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-4">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
            {(data.profileName ?? '?').slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base truncate">
            {data.profileName ?? 'WhatsApp Conectado'}
          </h3>
          {data.phoneNumber && (
            <p className="text-sm text-muted-foreground">{formatPhoneBR(data.phoneNumber)}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Última verificação: {relativeTime(data.lastStatusAt)}
          </p>
        </div>
      </div>
    );
  }

  // Error — falha de comunicação com UazAPI
  if (data.status === 'error') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <h3 className="text-sm font-semibold text-destructive mb-2">Erro de comunicação com UazAPI</h3>
        <p className="text-xs text-muted-foreground">
          Não conseguimos consultar o status da instância. Tentando novamente automaticamente.
        </p>
      </div>
    );
  }

  // Disconnected (configured mas sem pareamento)
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-8 text-center">
      <h3 className="text-sm font-semibold mb-2">Instância configurada, desconectada</h3>
      <p className="text-xs text-muted-foreground">
        Clique em <strong>Conectar instância</strong> para gerar um novo QR.
      </p>
    </div>
  );
}
```

- [ ] **Step 8.4:** Lint + commit.

```bash
npm run lint
git add src/features/settings/whatsapp/StatusBadges.tsx src/features/settings/whatsapp/QrDisplay.tsx src/features/settings/whatsapp/InstanceStatusCard.tsx
git commit -m "feat(whatsapp-conn): status badges + QR display + instance card (4 states)"
```

---

## Task 9 — Controls + ConfirmDelete + integração final

**Files:**
- Create: `src/features/settings/whatsapp/ConnectionControls.tsx`
- Create: `src/features/settings/whatsapp/ConfirmDeleteDialog.tsx`
- Modify: `src/pages/settings/WhatsappConnectionTab.tsx`

- [ ] **Step 9.1:** Criar `src/features/settings/whatsapp/ConfirmDeleteDialog.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

export function ConfirmDeleteDialog({ open, onOpenChange, onConfirm, pending }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar instância de WhatsApp?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Desconecta o WhatsApp</li>
                <li>Apaga a instância no UazAPI</li>
                <li>Limpa as credenciais salvas</li>
              </ul>
              <p className="text-muted-foreground">
                Conversas históricas continuam disponíveis no inbox.
              </p>
              <p className="text-muted-foreground">
                Para reconectar, será necessário escanear o QR novamente.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Apagando…' : 'Apagar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 9.2:** Criar `src/features/settings/whatsapp/ConnectionControls.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plug, PlugZap, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/features/auth/store';
import { useConnect, useDisconnect, useDeleteInstance } from './api';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { InstanceStatusResponse } from './types';

interface Props {
  data: InstanceStatusResponse | undefined;
}

export function ConnectionControls({ data }: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const connect = useConnect();
  const disconnect = useDisconnect();
  const deleteFn = useDeleteInstance();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const configured = !!data?.configured;
  const isConnected = data?.status === 'connected';

  async function doConnect() {
    try {
      await connect.mutateAsync({});
      toast.success(configured ? 'Conexão atualizada.' : 'Instância criada — escaneie o QR.');
    } catch (err) {
      toast.error('Falha ao conectar instância.');
    }
  }

  async function doDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success('Desconectado.');
    } catch {
      toast.error('Falha ao desconectar.');
    }
  }

  async function doDelete() {
    try {
      await deleteFn.mutateAsync();
      toast.success('Instância apagada.');
      setConfirmOpen(false);
    } catch {
      toast.error('Falha ao apagar.');
    }
  }

  return (
    <div className="space-y-3">
      <Button
        size="lg"
        className="w-full"
        onClick={doConnect}
        disabled={connect.isPending}
      >
        {connect.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Plug className="h-4 w-4 mr-2" />
        )}
        {connect.isPending ? 'Conectando…' : 'Conectar Instância'}
      </Button>

      {configured && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={doDisconnect}
            disabled={!isConnected || disconnect.isPending}
          >
            <PlugZap className="h-4 w-4 mr-2" />
            Desconectar
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}
              disabled={deleteFn.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Apagar
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Credenciais protegidas no servidor
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={doDelete}
        pending={deleteFn.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 9.3:** Substituir `src/pages/settings/WhatsappConnectionTab.tsx`:

```tsx
import { useInstanceStatus } from '@/features/settings/whatsapp/api';
import { StatusBadges } from '@/features/settings/whatsapp/StatusBadges';
import { ConnectionControls } from '@/features/settings/whatsapp/ConnectionControls';
import { InstanceStatusCard } from '@/features/settings/whatsapp/InstanceStatusCard';

export default function WhatsappConnectionTab() {
  const { data, isLoading, isError } = useInstanceStatus();

  return (
    <div className="max-w-3xl mx-auto space-y-6 overflow-y-auto h-full pb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Conexão de WhatsApp</h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Siga os passos para criar a instância, conectar o número e publicar seus
            agentes com visibilidade clara do status do canal.
          </p>
        </div>
        <StatusBadges
          status={data?.status ?? 'disconnected'}
          webhookSynced={data?.webhookSynced ?? false}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <ConnectionControls data={data} />
        <InstanceStatusCard data={data} isLoading={isLoading} />
        {isError && (
          <div className="text-sm text-destructive">
            Falha ao carregar status da instância. Verifique sua conexão.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.4:** Lint.

```bash
npm run lint
```

- [ ] **Step 9.5:** Smoke manual (opcional aqui — admin abre /settings, vê tab, badges, empty state). Não bloqueia commit.

- [ ] **Step 9.6:** Commit.

```bash
git add src/features/settings/whatsapp/ConnectionControls.tsx src/features/settings/whatsapp/ConfirmDeleteDialog.tsx src/pages/settings/WhatsappConnectionTab.tsx
git commit -m "feat(whatsapp-conn): controls + delete confirmation + tab integration"
```

---

## Task 10 — README + roadmap update + verificação final

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (atualizar nota)

- [ ] **Step 10.1:** Atualizar nota em `.env.example`. Localizar a seção `# WhatsApp / UazAPI` e substituir por:

```
# WhatsApp / UazAPI
# Estas variáveis são usadas como SEED INICIAL quando o DB ainda não tem
# instância configurada. Após a primeira conexão pela UI (/settings?tab=whatsapp),
# o DB vira a fonte da verdade e as variáveis ficam ignoradas.
# Em produção, pode subir o serviço com elas vazias e configurar tudo pela UI.
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=
UAZAPI_INSTANCE_ID=
UAZAPI_WEBHOOK_SECRET=
NO_RESPONSE_DAYS=7
```

- [ ] **Step 10.2:** Atualizar `README.md` — seção `## Próximos sub-projetos`:

```markdown
## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. ✅ WhatsApp Inbox — conversas com filas + composer
4. ✅ Inside Sales — pipeline kanban + drag & drop + activity log
5. ✅ Conexão WhatsApp — gestão da instância UazAPI via UI
6. Disparo em massa de campanhas
7. IA de pré-qualificação
8. Dashboard de Funil — métricas e conversão
```

- [ ] **Step 10.3:** Adicionar seção "Conexão WhatsApp" no README, depois da seção "Inside Sales":

```markdown
## Conexão WhatsApp

Tela em `/settings?tab=whatsapp` (apenas `admin` + `comercial`) com:

- **Empty state** — "Pronto para conectar". Botão único **CONECTAR INSTÂNCIA**.
- **Pairing** — QR code de 256x256 com instruções (1. Abrir WhatsApp · 2. Aparelhos conectados · 3. Conectar). Polling 2s atualiza o QR automaticamente.
- **Conectado** — avatar + nome do perfil + telefone formatado + última verificação. Polling 30s detecta queda.
- **Erro** — mensagem clara quando UazAPI fora do ar; retorna automaticamente quando voltar.

Ações:
- **CONECTAR** — cria instância no UazAPI (se não existe) + registra webhook + retorna QR. Idempotente (reusa instância existente).
- **DESCONECTAR** — logout sem deletar; admin pode reconectar depois.
- **APAGAR** — `admin` apenas. Apaga instância no UazAPI + zera credenciais. Conversas históricas preservadas.

**Config no DB**, não em env vars: as variáveis `UAZAPI_*` viram seed inicial — após a primeira conexão pela UI, o DB é a fonte da verdade. `webhook_secret` é gerado automaticamente (`crypto.randomBytes(32)`).

**Indicador "● Credenciais protegidas no servidor"** — token UazAPI nunca volta no response do backend; frontend só vê estados booleanos.

Pré-requisito: variável `APP_URL` configurada (ex: `https://app.lubritec.com`). UazAPI precisa conseguir alcançar `${APP_URL}/api/whatsapp/webhook`.
```

- [ ] **Step 10.4:** Rodar suite completa.

```bash
npm test
```

Esperado: ~213 testes passando, 0 regressões.

- [ ] **Step 10.5:** Lint completo.

```bash
npm run lint
```

Esperado: limpo.

- [ ] **Step 10.6:** Commit final.

```bash
git add README.md .env.example
git commit -m "docs: mark WhatsApp Connection roadmap item complete and add usage section"
```

---

## Self-Review Checklist (do plano contra a spec)

**1. Spec coverage:**
- ✅ Migration 011 + schema (single-row via UNIQUE INDEX) → Task 1
- ✅ Tipos compartilhados (INSTANCE_STATUSES, InstanceStatusResponse) → Task 1
- ✅ Test helpers (createWhatsappInstance) → Task 1
- ✅ uazapiInstanceClient (init/status/qr/logout/delete/setWebhook) → Task 2
- ✅ whatsappInstanceService (getStatus, connect, disconnect, destroy + loadSendConfig + loadWebhookSecret + seed automático) → Task 3
- ✅ Refactor uazapiClient (DB-backed via shim) → Task 4
- ✅ Refactor webhook controller (DB-first secret + env fallback) → Task 4
- ✅ Endpoints (GET, POST connect, POST disconnect, DELETE) → Task 5
- ✅ RBAC (admin+comercial; DELETE admin-only) → Tasks 5+6
- ✅ Tests TDD (status, connect, disconnect, delete, RBAC, config-loader) → Task 5
- ✅ **Regression test obrigatório** após Task 4 — confirma 188 testes existentes passando → Task 4 step 4.3
- ✅ Settings shell com tabs → Task 6
- ✅ RBAC sidebar (recepção esconde Settings) → Task 6
- ✅ Frontend hooks (useInstanceStatus polling adaptativo, mutations) → Task 7
- ✅ Helpers (STATUS_LABELS, formatPhoneBR, relativeTime) → Task 7
- ✅ Componentes visuais (StatusBadges, QrDisplay, InstanceStatusCard com 4 estados: empty/pairing/connected/error/disconnected-configured) → Task 8
- ✅ ConnectionControls + ConfirmDeleteDialog + indicador "Credenciais protegidas" → Task 9
- ✅ WhatsappConnectionTab integra tudo → Task 9
- ✅ README + .env.example seed nota → Task 10

**2. Placeholder scan:** sem TBD/TODO/FIXME no plano. Comentário "Futuras tabs entram aqui" no SettingsPage é instrução clara, não placeholder.

**3. Type consistency:**
- `InstanceStatusResponse` tem `configured`, `status`, `qrCode`, `phoneNumber`, `profileName`, `webhookSynced`, `baseUrl`, `lastStatusAt` — usado consistentemente em backend (controller retorna), frontend (hook consome), helpers (`STATUS_LABELS[status]`).
- `useConnect()` aceita `{ baseUrl?, instanceToken? }` — match com Zod schema (Task 5) e service `connect()` signature (Task 3).
- `loadSendConfig` retorna `{ baseUrl, instanceId, token }` — usada em `uazapiClient.sendUazapiMessage` (Task 4) com mesmo shape.
- `loadWebhookSecret` retorna `string | null` — webhook controller (Task 4) trata os dois casos.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-whatsapp-connection-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatcher agent + um implementer subagent por task + dois revisores. Mesmo padrão dos sub-projetos anteriores.

**2. Inline Execution** — checkpoints manuais, executando aqui.

**Which approach?**
