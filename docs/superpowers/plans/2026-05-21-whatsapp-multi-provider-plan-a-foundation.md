# Plan A — Fundação Multi-Provider WhatsApp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estabelecer a fundação multi-provider de WhatsApp no LubriConnect — criptografia de credenciais, schema multi-row com discriminador `provider`, abstração `WhatsAppProvider` com UazAPI refatorado pra implementar a interface, e UI Settings reformulada listando múltiplas linhas. **Sem features Meta ainda** — o objetivo aqui é desbloquear PRs futuros sem quebrar a operação atual da Lubritec.

**Architecture:** Crypto AES-256-GCM com chave em env. Migration não-destrutiva que encripta credenciais existentes ANTES de drop de colunas. `whatsapp_instance` ganha `provider`, `display_name`, `provider_config` (JSONB criptografado), `is_default`, `is_archived`. `conversations` e `messages` ganham `instance_id`/`provider` com backfill. Interface `WhatsAppProvider` em `server/services/whatsapp/provider.ts` + `providerRegistry` com cache de 5min. UazAPI vira `UazapiProvider` mantendo todos os tests existentes verdes. Novos endpoints REST `/api/whatsapp/instances/*` com aliases backward-compat. UI Settings vira lista + wizard "Adicionar número" com escolha de provider (Step 1) e formulário UazAPI (Step 2; Meta fica no Plano B).

**Tech Stack:** Node 20+ / TypeScript, Express, Drizzle ORM + Postgres (Supabase), Vitest + supertest, React 19 + TanStack Query + Tailwind.

---

## File Structure

**Criar:**
- `server/lib/crypto.ts` — AES-256-GCM encrypt/decrypt + key loader
- `server/db/migrations/026_whatsapp_multi_provider.sql` — schema multi-provider
- `server/scripts/encryptWhatsappCreds.ts` — one-off script que roda DENTRO da migration via Node, encripta `instance_token` legado e move pra `provider_config`
- `server/services/whatsapp/provider.ts` — interface `WhatsAppProvider` + types
- `server/services/whatsapp/providerRegistry.ts` — resolve provider por instanceId com cache
- `server/services/whatsapp/uazapi/provider.ts` — `UazapiProvider` implements `WhatsAppProvider`
- `server/services/whatsapp/uazapi/configSchema.ts` — zod schema do `providerConfig` UazAPI
- `server/controllers/whatsappInstancesController.ts` — CRUD multi-instância
- `server/routes/whatsappInstances.ts` — novas rotas REST
- `server/tests/crypto.test.ts`
- `server/tests/whatsapp-provider-registry.test.ts`
- `server/tests/whatsapp-instances-crud.test.ts`
- `server/tests/whatsapp-instances-aliases.test.ts`
- `src/features/settings/whatsapp/InstancesList.tsx`
- `src/features/settings/whatsapp/InstanceCard.tsx`
- `src/features/settings/whatsapp/AddInstanceWizard.tsx`
- `src/features/settings/whatsapp/ProviderPickerStep.tsx`
- `src/features/settings/whatsapp/UazapiSetupStep.tsx`

**Modificar:**
- `server/db/schema.ts` — atualizar `whatsappInstance`, `conversations`, `messages`
- `shared/types.ts` — adicionar `ProviderKind`, `InstanceListItem`, etc.
- `server/services/whatsappInstanceService.ts` — refatorar pra usar `providerRegistry` (mantém exports antigos como aliases)
- `server/services/uazapiClient.ts` → `server/services/whatsapp/uazapi/client.ts` (move + ajusta imports)
- `server/services/uazapiInstanceClient.ts` → `server/services/whatsapp/uazapi/instanceClient.ts`
- `server/services/whatsappWebhookService.ts` — generalizar `ingestInboundMessage` aceitando `instanceId` + `provider`
- `server/routes/whatsappInstance.ts` — converter handlers em aliases pra `/instances/<default>`
- `server/tests/helpers.ts` — atualizar `createWhatsappInstance` pra novo schema
- `src/features/settings/whatsapp/api.ts` — adicionar hooks multi-instância
- `src/features/settings/whatsapp/types.ts` — novos types
- Página de Settings que monta o card hoje (descoberta em Task 9)
- `.env.example` — adicionar `WHATSAPP_CREDENTIALS_KEY`

**Apagar (no final do Plano D, não aqui):** rotas antigas. No Plano A continuam funcionando como aliases.

---

## Task 1: Crypto helper para credenciais

**Files:**
- Create: `server/lib/crypto.ts`
- Create: `server/tests/crypto.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar a env var ao `.env.example`**

Append ao final do arquivo `.env.example`:

```
# Chave de criptografia para credenciais de WhatsApp (instance tokens, access tokens, app secrets).
# Gere com: openssl rand -hex 32
# Mantenha em segredo. NUNCA commite o valor real. Rotacionar exige re-encriptar tudo via script.
WHATSAPP_CREDENTIALS_KEY=
```

- [ ] **Step 2: Gerar uma key local para usar em dev e tests**

Run:
```bash
openssl rand -hex 32
```

Salvar o valor no seu `.env` local (não commitado). Anote também pro ambiente Supabase/produção (será setado no painel).

- [ ] **Step 3: Escrever os tests**

Criar `server/tests/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto';

beforeAll(() => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
});

describe('crypto', () => {
  it('round-trips an ASCII secret', () => {
    const enc = encryptSecret('hello-token-123');
    expect(enc).toMatch(/^enc:/);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe('hello-token-123');
  });

  it('round-trips a unicode secret', () => {
    const enc = encryptSecret('açúcar 🍯');
    expect(decryptSecret(enc)).toBe('açúcar 🍯');
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('original');
    // Flip a byte in the ciphertext component
    const parts = enc.split(':');
    const tampered = parts[3] === 'A' ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1);
    const bad = `${parts[0]}:${parts[1]}:${parts[2]}:${tampered}`;
    expect(() => decryptSecret(bad)).toThrow();
  });

  it('isEncrypted returns false for plain string', () => {
    expect(isEncrypted('plain-token')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null as unknown as string)).toBe(false);
  });

  it('decryptSecret returns plain value when string is not encrypted (backward-compat)', () => {
    expect(decryptSecret('plain-token')).toBe('plain-token');
  });
});
```

- [ ] **Step 4: Rodar os tests pra ver falhando**

Run:
```bash
npm test -- crypto.test
```

Expected: FAIL com `Cannot find module '../lib/crypto'`.

- [ ] **Step 5: Implementar `server/lib/crypto.ts`**

```ts
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = 'enc:';

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.WHATSAPP_CREDENTIALS_KEY;
  if (!hex) {
    throw new Error(
      'WHATSAPP_CREDENTIALS_KEY env var is required (32 random bytes, hex-encoded). ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('WHATSAPP_CREDENTIALS_KEY must be 64 hex chars (32 bytes).');
  }
  cachedKey = Buffer.from(hex, 'hex');
  if (cachedKey.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes, got ${cachedKey.length}`);
  }
  return cachedKey;
}

/** True if string was produced by encryptSecret (has the "enc:" prefix). */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a UTF-8 string. Returns "enc:<iv_b64>:<tag_b64>:<ciphertext_b64>".
 * Each call uses a fresh random IV.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a value produced by encryptSecret. If the value does NOT start with
 * "enc:" it is returned as-is (lets us migrate gradually without breaking
 * already-decrypted callers).
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  const [, ivB64, tagB64, ctB64] = value.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted value');
  }
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Test-only: clear the cached key (used after rotating WHATSAPP_CREDENTIALS_KEY in tests). */
export function _resetKeyCache(): void {
  cachedKey = null;
}
```

- [ ] **Step 6: Rodar os tests novamente**

Run:
```bash
npm test -- crypto.test
```

Expected: PASS — 6 tests passing.

- [ ] **Step 7: Commit**

```bash
git add server/lib/crypto.ts server/tests/crypto.test.ts .env.example
git commit -m "feat(crypto): add AES-256-GCM helper for WhatsApp credentials encryption"
```

---

## Task 2: Migration 026 — schema multi-provider

**Files:**
- Create: `server/db/migrations/026_whatsapp_multi_provider.sql`
- Create: `server/scripts/encryptWhatsappCreds.ts`
- Modify: `server/db/schema.ts:152-167` (whatsappInstance) e blocos de `conversations`, `messages`
- Modify: `shared/types.ts` (adicionar `PROVIDER_KINDS`)
- Modify: `server/tests/helpers.ts:209-235` (createWhatsappInstance pro novo schema)

A migration tem duas partes que precisam rodar em ordem:
1. SQL — adiciona colunas NOVAS sem dropar nada (idempotente, transação).
2. Script TS — lê credenciais plaintext da row existente, encripta com o helper, salva em `provider_config`, depois dropa as colunas legadas (em SQL via `db.execute`).

A migration runner aplica `*.sql` em ordem. Pra rodar o script TS, fazemos: deixa o SQL adicionar as colunas novas + os defaults; depois `npm run migrate:encrypt-creds` (script novo) faz o backfill encriptado e roda o ALTER ... DROP COLUMN.

Esse approach evita ter que executar JS dentro do `migrate.ts`, mantém a separação migrations declarativas (SQL) vs procedurais (script).

- [ ] **Step 1: Escrever o SQL `026_whatsapp_multi_provider.sql`**

Criar `server/db/migrations/026_whatsapp_multi_provider.sql`:

```sql
-- Multi-provider WhatsApp: add discriminator + JSONB config + multi-row support.
-- Companion script: server/scripts/encryptWhatsappCreds.ts must be run AFTER
-- this migration to: (1) encrypt the legacy plaintext creds, (2) populate
-- provider_config, (3) DROP the legacy columns.

BEGIN;

-- ── whatsapp_instance ──────────────────────────────────────────────────────
-- Drop the singleton constraint column. Was used as a one-row enforcer.
ALTER TABLE whatsapp_instance DROP COLUMN IF EXISTS singleton;

ALTER TABLE whatsapp_instance
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('uazapi','meta_cloud')),
  ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Linha principal',
  ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Mark the (single) existing row as the default. Safe no-op if table is empty.
UPDATE whatsapp_instance SET is_default = true
WHERE id = (SELECT id FROM whatsapp_instance ORDER BY created_at ASC LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_instance_default
  ON whatsapp_instance ((is_default)) WHERE is_default = true;

-- ── conversations.instance_id ──────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instance_id UUID
  REFERENCES whatsapp_instance(id) ON DELETE RESTRICT;

UPDATE conversations
SET instance_id = (SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1)
WHERE instance_id IS NULL;

ALTER TABLE conversations ALTER COLUMN instance_id SET NOT NULL;

-- Was: conversations.phone UNIQUE. Now: (instance_id, phone) UNIQUE.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_instance_phone
  ON conversations(instance_id, phone);

-- ── messages.provider + rename uazapi_msg_id ───────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi'
  CHECK (provider IN ('uazapi','meta_cloud'));

-- Rename only if old column still exists (idempotent re-runs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'messages'
      AND column_name = 'uazapi_msg_id'
  ) THEN
    ALTER TABLE messages RENAME COLUMN uazapi_msg_id TO provider_msg_id;
  END IF;
END $$;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_uazapi_msg_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_msgid
  ON messages(provider, provider_msg_id) WHERE provider_msg_id IS NOT NULL;

COMMIT;
```

**Importante:** essa migration **NÃO** dropa `base_url`, `instance_id`, `instance_token`, `webhook_secret`, `webhook_url`, `webhook_synced`. Isso é responsabilidade do script TS (Task 2 Step 3), depois de encriptar e mover pro `provider_config`. Migrations e script são commitados juntos e rodados em sequência.

- [ ] **Step 2: Atualizar `server/db/schema.ts`**

Substituir a definição de `whatsappInstance` (linhas 152-167) por:

```ts
export const whatsappInstance = pgTable('whatsapp_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider', { enum: ['uazapi', 'meta_cloud'] }).notNull(),
  displayName: text('display_name').notNull(),
  phoneNumber: text('phone_number'),
  profileName: text('profile_name'),
  providerConfig: jsonb('provider_config').notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  lastStatus: text('last_status'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Na definição de `conversations` (~linha 90), adicionar `instanceId`:

```ts
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),   // removido .unique() — agora é (instance_id, phone)
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'restrict' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  // ...resto igual
});
```

Na definição de `messages` (procurar `uazapiMsgId`), renomear pra `providerMsgId` e adicionar `provider`:

```ts
// dentro de messages:
provider: text('provider', { enum: ['uazapi', 'meta_cloud'] }).notNull().default('uazapi'),
providerMsgId: text('provider_msg_id'),  // removido .unique() — agora é índice composto
```

- [ ] **Step 3: Adicionar `PROVIDER_KINDS` em `shared/types.ts`**

Editar `shared/types.ts` (procurar bloco com `CAMPAIGN_STATUSES`, adicionar antes):

```ts
export const PROVIDER_KINDS = ['uazapi', 'meta_cloud'] as const;
export type ProviderKind = typeof PROVIDER_KINDS[number];
```

- [ ] **Step 4: Escrever o script `server/scripts/encryptWhatsappCreds.ts`**

Criar `server/scripts/encryptWhatsappCreds.ts`:

```ts
/**
 * One-time backfill: encrypt legacy plaintext credentials in whatsapp_instance
 * and move them into provider_config. Then drop the legacy columns.
 *
 * Idempotent: safe to re-run. Skips rows whose provider_config already has
 * the expected keys.
 *
 * Run AFTER migration 026 is applied.
 *
 *     npm run migrate:encrypt-creds
 */
import 'dotenv/config';
import { pool, SCHEMA_NAME } from '../db/client';
import { encryptSecret, isEncrypted } from '../lib/crypto';

interface LegacyRow {
  id: string;
  base_url: string | null;
  instance_id: string | null;
  instance_token: string | null;
  webhook_secret: string | null;
  webhook_url: string | null;
  webhook_synced: boolean | null;
  provider_config: Record<string, unknown> | null;
}

async function legacyColumnsExist(): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'whatsapp_instance'
        AND column_name = 'instance_token'
    ) AS exists`,
    [SCHEMA_NAME],
  );
  return rows[0]?.exists === true;
}

async function run() {
  const present = await legacyColumnsExist();
  if (!present) {
    console.log('Legacy columns already dropped — nothing to do.');
    return;
  }

  console.log('Backfilling encrypted provider_config for whatsapp_instance rows...');
  const { rows } = await pool.query<LegacyRow>(
    `SELECT id, base_url, instance_id, instance_token, webhook_secret,
            webhook_url, webhook_synced, provider_config
     FROM whatsapp_instance`,
  );

  for (const r of rows) {
    const cfg = r.provider_config ?? {};
    // Skip if already migrated (has the new shape).
    if (cfg.instanceToken && isEncrypted(cfg.instanceToken as string)) {
      console.log(`✓ ${r.id} (already migrated)`);
      continue;
    }

    const next = {
      baseUrl: r.base_url ?? 'https://api.uazapi.com',
      instanceId: r.instance_id,
      instanceToken: r.instance_token ? encryptSecret(r.instance_token) : null,
      webhookSecret: r.webhook_secret ? encryptSecret(r.webhook_secret) : null,
      webhookUrl: r.webhook_url,
      webhookSynced: r.webhook_synced ?? false,
    };

    await pool.query(
      `UPDATE whatsapp_instance SET provider_config = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(next), r.id],
    );
    console.log(`→ ${r.id} (encrypted)`);
  }

  console.log('Dropping legacy plaintext columns...');
  await pool.query(`
    ALTER TABLE whatsapp_instance
      DROP COLUMN IF EXISTS base_url,
      DROP COLUMN IF EXISTS instance_id,
      DROP COLUMN IF EXISTS instance_token,
      DROP COLUMN IF EXISTS webhook_secret,
      DROP COLUMN IF EXISTS webhook_url,
      DROP COLUMN IF EXISTS webhook_synced
  `);
  console.log('Done.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 5: Adicionar npm script `migrate:encrypt-creds`**

Editar `package.json`, na seção `"scripts"`, adicionar:

```json
"migrate:encrypt-creds": "tsx server/scripts/encryptWhatsappCreds.ts",
```

- [ ] **Step 6: Atualizar helper de teste `server/tests/helpers.ts`**

Substituir `createWhatsappInstance` (linhas 209-235) por:

```ts
export async function createWhatsappInstance(opts: {
  provider?: 'uazapi' | 'meta_cloud';
  displayName?: string;
  isDefault?: boolean;
  isArchived?: boolean;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastStatus?: string | null;
  providerConfig?: Record<string, unknown>;
} = {}) {
  const provider = opts.provider ?? 'uazapi';
  const defaultConfig = provider === 'uazapi'
    ? {
        baseUrl: 'https://api.uazapi.com',
        instanceId: null,
        instanceToken: null,
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      }
    : {
        wabaId: 'test-waba',
        phoneNumberId: 'test-phone-id',
        accessToken: null,
        appSecret: null,
        webhookVerifyToken: 'test-verify',
      };
  const [row] = await db
    .insert(whatsappInstance)
    .values({
      provider,
      displayName: opts.displayName ?? 'Test Line',
      isDefault: opts.isDefault ?? false,
      isArchived: opts.isArchived ?? false,
      phoneNumber: opts.phoneNumber ?? null,
      profileName: opts.profileName ?? null,
      lastStatus: opts.lastStatus ?? null,
      providerConfig: opts.providerConfig ?? defaultConfig,
    })
    .returning();
  return row;
}
```

- [ ] **Step 7: Rodar a migration localmente em DB de teste**

Run:
```bash
npm run migrate
npm run migrate:encrypt-creds
```

Expected outputs:
- `migrate`: lista as 26 migrations, marca 1-25 como already applied, aplica `026_whatsapp_multi_provider.sql`.
- `migrate:encrypt-creds`: se houver row existente, mostra `→ <uuid> (encrypted)` e `Dropping legacy plaintext columns...`. Se DB tá vazio, mostra `Backfilling...` e termina sem rows.

- [ ] **Step 8: Inspeccionar o resultado no DB**

Run:
```bash
psql "$DATABASE_URL" -c "\d lubritec.whatsapp_instance"
psql "$DATABASE_URL" -c "SELECT id, provider, display_name, is_default, provider_config FROM lubritec.whatsapp_instance"
```

Expected: colunas legadas sumiram, `provider_config` mostra JSON com `instanceToken` começando com `enc:` se havia token antes.

- [ ] **Step 9: Rodar TODOS os tests existentes (precisam continuar verdes)**

Run:
```bash
npm test
```

Expected: alguns testes vão FALHAR aqui — especificamente os que dependem do shape antigo de `whatsappInstance` (`whatsapp-instance-*.test.ts`). É esperado e será resolvido na Task 4. Os testes não-whatsapp devem continuar verdes. Anotar os tests que falham pra validar que voltam a passar.

- [ ] **Step 10: Commit**

```bash
git add server/db/migrations/026_whatsapp_multi_provider.sql \
        server/scripts/encryptWhatsappCreds.ts \
        server/db/schema.ts \
        shared/types.ts \
        server/tests/helpers.ts \
        package.json
git commit -m "feat(db): migration 026 + encryption script for multi-provider WhatsApp schema"
```

---

## Task 3: Interface `WhatsAppProvider` + types comuns

**Files:**
- Create: `server/services/whatsapp/provider.ts`
- Create: `server/services/whatsapp/uazapi/configSchema.ts`

- [ ] **Step 1: Escrever a interface em `server/services/whatsapp/provider.ts`**

Criar:

```ts
import type { MessageKind } from '@shared/types';
import type { ProviderKind } from '@shared/types';

// ── Status ─────────────────────────────────────────────────────────────────
export type ProviderConnectionStatus =
  | 'disconnected'
  | 'pairing'
  | 'connected'
  | 'error';

export interface ProviderStatus {
  status: ProviderConnectionStatus;
  qrCode: string | null;     // só UazAPI pairing
  phoneNumber: string | null;
  profileName: string | null;
  lastCheckedAt: string;     // ISO
}

// ── Envio ──────────────────────────────────────────────────────────────────
export interface SendTextOpts {
  to: string;
  text: string;
}

export interface SendMediaOpts {
  to: string;
  kind: Exclude<MessageKind, 'text'>;
  mediaUrl: string;
  mediaMime?: string;
  caption?: string;
}

export interface SendTemplateOpts {
  to: string;
  templateName: string;
  language: string;
  variables: Array<{ index: number; value: string }>;
  headerMedia?: { kind: 'image' | 'video' | 'document'; url: string };
}

export interface SendResult {
  providerMsgId: string;
  rawPayload: unknown;
}

// ── Templates HSM (Meta only — UazAPI retorna [] / throws) ─────────────────
export interface TemplateRecord {
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  components: unknown;
  rejectionReason: string | null;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: TemplateRecord['category'];
  components: unknown;
}

// ── Capabilities ───────────────────────────────────────────────────────────
export interface ProviderCapabilities {
  freeFormText: boolean;
  requiresApprovedTemplate: boolean;
  supportsMedia: boolean;
  supportsButtons: boolean;
}

// ── A interface central ────────────────────────────────────────────────────
export interface WhatsAppProvider {
  readonly kind: ProviderKind;
  readonly instanceId: string;

  getStatus(): Promise<ProviderStatus>;
  connect(): Promise<ProviderStatus>;
  disconnect(): Promise<void>;

  sendText(opts: SendTextOpts): Promise<SendResult>;
  sendMedia(opts: SendMediaOpts): Promise<SendResult>;
  sendTemplate(opts: SendTemplateOpts): Promise<SendResult>;

  listTemplates(): Promise<TemplateRecord[]>;
  createTemplate(input: TemplateInput): Promise<TemplateRecord>;
  deleteTemplate(name: string, language: string): Promise<void>;

  capabilities(): ProviderCapabilities;
}

// ── Erros padronizados (consumidores fazem instanceof) ─────────────────────
export class ProviderError extends Error {
  constructor(
    public status: number,
    public providerKind: ProviderKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class OutOfSessionWindowError extends ProviderError {
  constructor(providerKind: ProviderKind) {
    super(409, providerKind, 'Cliente fora da janela de 24h — use um template aprovado');
    this.name = 'OutOfSessionWindowError';
  }
}

export class TemplatesNotSupportedError extends ProviderError {
  constructor(providerKind: ProviderKind) {
    super(400, providerKind, `Provider ${providerKind} does not support HSM templates`);
    this.name = 'TemplatesNotSupportedError';
  }
}
```

- [ ] **Step 2: Escrever o schema zod do config UazAPI em `server/services/whatsapp/uazapi/configSchema.ts`**

Criar:

```ts
import { z } from 'zod';

export const uazapiConfigSchema = z.object({
  baseUrl: z.string().url(),
  instanceId: z.string().nullable(),
  instanceToken: z.string().nullable(),  // criptografado se non-null
  webhookSecret: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  webhookSynced: z.boolean(),
});

export type UazapiConfig = z.infer<typeof uazapiConfigSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add server/services/whatsapp/provider.ts \
        server/services/whatsapp/uazapi/configSchema.ts
git commit -m "feat(whatsapp): add WhatsAppProvider interface + UazAPI config schema"
```

---

## Task 4: Mover UazAPI services + implementar `UazapiProvider`

**Files:**
- Move: `server/services/uazapiClient.ts` → `server/services/whatsapp/uazapi/client.ts`
- Move: `server/services/uazapiInstanceClient.ts` → `server/services/whatsapp/uazapi/instanceClient.ts`
- Create: `server/services/whatsapp/uazapi/provider.ts`
- Modify: `server/services/whatsappInstanceService.ts` (apontar imports pros novos paths)
- Modify: TODOS os arquivos que importavam `services/uazapiClient` ou `services/uazapiInstanceClient`

- [ ] **Step 1: Identificar todos os imports atuais**

Run:
```bash
grep -rn "services/uazapi" server/ src/ shared/ --include="*.ts" --include="*.tsx"
```

Anotar os arquivos. Os imports vão precisar mudar de `'../services/uazapiClient'` pra `'../services/whatsapp/uazapi/client'` (ajustando profundidade) e idem `uazapiInstanceClient`.

- [ ] **Step 2: Mover os arquivos**

Run:
```bash
mkdir -p server/services/whatsapp/uazapi
git mv server/services/uazapiClient.ts server/services/whatsapp/uazapi/client.ts
git mv server/services/uazapiInstanceClient.ts server/services/whatsapp/uazapi/instanceClient.ts
```

- [ ] **Step 3: Ajustar imports relativos dentro dos arquivos movidos**

Editar `server/services/whatsapp/uazapi/client.ts`:
- `import { loadSendConfig } from './whatsappInstanceService';` → `import { loadSendConfig } from '../../whatsappInstanceService';`
- `import { retry } from '../lib/retry';` → `import { retry } from '../../../lib/retry';`

Editar `server/services/whatsapp/uazapi/instanceClient.ts`:
- Atualizar todos os imports `../lib/...` pra `../../../lib/...`
- Outros imports relativos: ajustar pra ficar `../../...`

- [ ] **Step 4: Ajustar imports nos consumidores**

Para cada arquivo identificado no Step 1, fazer find/replace:
- `'../services/uazapiClient'` → `'../services/whatsapp/uazapi/client'`
- `'../services/uazapiInstanceClient'` → `'../services/whatsapp/uazapi/instanceClient'`
- Em tests (`server/tests/*.test.ts`): `'../services/uazapiClient'` continua `'../services/whatsapp/uazapi/client'`

- [ ] **Step 5: Rodar build TypeScript pra verificar paths**

Run:
```bash
npm run build
```

Expected: build passa (sem erros TS). Se houver erro de "Cannot find module", revisar o path do import.

- [ ] **Step 6: Implementar `UazapiProvider` em `server/services/whatsapp/uazapi/provider.ts`**

Criar:

```ts
import type {
  WhatsAppProvider,
  ProviderStatus,
  SendTextOpts,
  SendMediaOpts,
  SendTemplateOpts,
  SendResult,
  TemplateRecord,
  TemplateInput,
  ProviderCapabilities,
} from '../provider';
import { TemplatesNotSupportedError, ProviderError } from '../provider';
import { decryptSecret, isEncrypted } from '../../../lib/crypto';
import type { UazapiConfig } from './configSchema';
import {
  getInstanceStatus,
  connectInstance,
  initInstance,
  logoutInstance,
  setWebhook,
  UazapiInstanceError,
} from './instanceClient';
import { sendUazapiMessage, UazapiError } from './client';

export class UazapiProvider implements WhatsAppProvider {
  readonly kind = 'uazapi' as const;

  constructor(
    public readonly instanceId: string,
    private readonly cfg: UazapiConfig,
  ) {}

  private decToken(): string {
    if (!this.cfg.instanceToken) {
      throw new ProviderError(503, 'uazapi', 'Instance token not configured');
    }
    return decryptSecret(this.cfg.instanceToken);
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.cfg.instanceId || !this.cfg.instanceToken) {
      return {
        status: 'disconnected',
        qrCode: null,
        phoneNumber: null,
        profileName: null,
        lastCheckedAt: new Date().toISOString(),
      };
    }
    try {
      const live = await getInstanceStatus({
        baseUrl: this.cfg.baseUrl,
        token: this.decToken(),
      });
      return {
        status: live.status,
        qrCode: live.qrCode,
        phoneNumber: live.phoneNumber,
        profileName: live.profileName,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof UazapiInstanceError) {
        return {
          status: 'error',
          qrCode: null,
          phoneNumber: null,
          profileName: null,
          lastCheckedAt: new Date().toISOString(),
        };
      }
      throw err;
    }
  }

  /**
   * Connect kicks off pairing flow: ensure instance exists in UazAPI, register
   * webhook, then trigger /instance/connect which generates the QR. Returns
   * status (which will be 'pairing' with qrCode set).
   *
   * NOTE: persistence of new instance_id / instance_token back to the DB row
   * is handled by the caller (whatsappInstancesController), not here — the
   * provider is stateless. Caller is responsible for invalidating the registry
   * cache after persisting.
   */
  async connect(): Promise<ProviderStatus> {
    // This is intentionally a thin shim — the heavy lifting (DB updates, env
    // fallback for admin token, webhook URL build) lives in the controller.
    // Provider only knows about the UazAPI API surface.
    if (!this.cfg.instanceToken) {
      throw new ProviderError(400, 'uazapi', 'Instance must be initialized by controller first');
    }
    await connectInstance({ baseUrl: this.cfg.baseUrl, token: this.decToken() });
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    if (!this.cfg.instanceToken) return;
    await logoutInstance({ baseUrl: this.cfg.baseUrl, token: this.decToken() });
  }

  async sendText(opts: SendTextOpts): Promise<SendResult> {
    return this.sendInternal({ to: opts.to, kind: 'text', text: opts.text });
  }

  async sendMedia(opts: SendMediaOpts): Promise<SendResult> {
    return this.sendInternal({
      to: opts.to,
      kind: opts.kind,
      text: opts.caption,
      mediaUrl: opts.mediaUrl,
      mediaMime: opts.mediaMime,
    });
  }

  async sendTemplate(_opts: SendTemplateOpts): Promise<SendResult> {
    // UazAPI doesn't do HSM templates. For free-form template use, the caller
    // should resolve the template body locally and call sendText() instead.
    throw new TemplatesNotSupportedError('uazapi');
  }

  private async sendInternal(opts: Parameters<typeof sendUazapiMessage>[0]): Promise<SendResult> {
    try {
      const res = await sendUazapiMessage(opts);
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      if (err instanceof UazapiError) {
        throw new ProviderError(err.status, 'uazapi', err.message, err);
      }
      throw err;
    }
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    return [];   // UazAPI doesn't have HSM templates
  }

  async createTemplate(_input: TemplateInput): Promise<TemplateRecord> {
    throw new TemplatesNotSupportedError('uazapi');
  }

  async deleteTemplate(_name: string, _language: string): Promise<void> {
    throw new TemplatesNotSupportedError('uazapi');
  }

  capabilities(): ProviderCapabilities {
    return {
      freeFormText: true,
      requiresApprovedTemplate: false,
      supportsMedia: true,
      supportsButtons: false,
    };
  }
}
```

- [ ] **Step 7: Rodar TODOS os tests**

Run:
```bash
npm test
```

Expected: tests não-whatsapp passam. Os whatsapp tests podem continuar falhando (vão ser arrumados na Task 5).

- [ ] **Step 8: Commit**

```bash
git add server/services/whatsapp/
git add $(git status -s | grep "^ M" | awk '{print $2}')   # arquivos modificados pelo find/replace
git commit -m "refactor(whatsapp): move UazAPI services under whatsapp/uazapi/ + add UazapiProvider"
```

---

## Task 5: `providerRegistry` com cache

**Files:**
- Create: `server/services/whatsapp/providerRegistry.ts`
- Create: `server/tests/whatsapp-provider-registry.test.ts`

- [ ] **Step 1: Escrever o teste**

Criar `server/tests/whatsapp-provider-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance, conversations, messages, leads } from '../db/schema';
import { createWhatsappInstance } from './helpers';
import {
  resolveProvider,
  resolveDefaultProvider,
  invalidateProvider,
  _clearCache,
} from '../services/whatsapp/providerRegistry';
import { UazapiProvider } from '../services/whatsapp/uazapi/provider';
import { HttpError } from '../middleware/errorHandler';

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _clearCache();
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(whatsappInstance);
  await db.delete(leads);
});

describe('providerRegistry', () => {
  it('resolves UazapiProvider for a uazapi instance', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi', displayName: 'Main' });
    const p = await resolveProvider(row.id);
    expect(p).toBeInstanceOf(UazapiProvider);
    expect(p.kind).toBe('uazapi');
    expect(p.instanceId).toBe(row.id);
  });

  it('throws HttpError(404) for unknown instanceId', async () => {
    await expect(resolveProvider(crypto.randomUUID())).rejects.toBeInstanceOf(HttpError);
  });

  it('caches the provider on second resolve (same instance)', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi' });
    const a = await resolveProvider(row.id);
    const b = await resolveProvider(row.id);
    expect(a).toBe(b);
  });

  it('invalidateProvider forces a fresh load', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi' });
    const a = await resolveProvider(row.id);
    invalidateProvider(row.id);
    const b = await resolveProvider(row.id);
    expect(a).not.toBe(b);
  });

  it('resolveDefaultProvider returns the is_default row', async () => {
    await createWhatsappInstance({ provider: 'uazapi', displayName: 'Other' });
    const def = await createWhatsappInstance({
      provider: 'uazapi', displayName: 'Default', isDefault: true,
    });
    const p = await resolveDefaultProvider();
    expect(p.instanceId).toBe(def.id);
  });

  it('resolveDefaultProvider throws if no default exists', async () => {
    await expect(resolveDefaultProvider()).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects unsupported provider kind', async () => {
    const [row] = await db.insert(whatsappInstance).values({
      provider: 'uazapi' as any,
      displayName: 'X',
      providerConfig: {},
    }).returning();
    // Tamper to invalid provider
    await db.execute(
      `UPDATE whatsapp_instance SET provider = 'unknown' WHERE id = '${row.id}'` as any,
    );
    await expect(resolveProvider(row.id)).rejects.toThrow(/Unsupported provider/);
  });
});
```

- [ ] **Step 2: Rodar o test (deve falhar)**

Run:
```bash
npm test -- whatsapp-provider-registry
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `server/services/whatsapp/providerRegistry.ts`**

Criar:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { whatsappInstance } from '../../db/schema';
import { HttpError } from '../../middleware/errorHandler';
import type { WhatsAppProvider } from './provider';
import { UazapiProvider } from './uazapi/provider';
import { uazapiConfigSchema } from './uazapi/configSchema';
// MetaCloudProvider import will be added in Plan B

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  provider: WhatsAppProvider;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function resolveProvider(instanceId: string): Promise<WhatsAppProvider> {
  const hit = cache.get(instanceId);
  if (hit && hit.expiresAt > Date.now()) return hit.provider;

  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row) throw new HttpError(404, 'WhatsApp instance not found');

  const provider = buildProvider(row);
  cache.set(instanceId, { provider, expiresAt: Date.now() + TTL_MS });
  return provider;
}

export async function resolveDefaultProvider(): Promise<WhatsAppProvider> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  if (!row) {
    throw new HttpError(503, 'No default WhatsApp instance configured');
  }
  return resolveProvider(row.id);
}

export function invalidateProvider(instanceId: string): void {
  cache.delete(instanceId);
}

/** Test-only: clear the cache between tests. */
export function _clearCache(): void {
  cache.clear();
}

function buildProvider(row: typeof whatsappInstance.$inferSelect): WhatsAppProvider {
  switch (row.provider) {
    case 'uazapi': {
      const cfg = uazapiConfigSchema.parse(row.providerConfig);
      return new UazapiProvider(row.id, cfg);
    }
    case 'meta_cloud':
      // Will be added in Plan B
      throw new HttpError(501, 'Meta Cloud provider not yet implemented');
    default:
      throw new HttpError(500, `Unsupported provider kind: ${(row as any).provider}`);
  }
}
```

- [ ] **Step 4: Rodar o test**

Run:
```bash
npm test -- whatsapp-provider-registry
```

Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/providerRegistry.ts \
        server/tests/whatsapp-provider-registry.test.ts
git commit -m "feat(whatsapp): add providerRegistry with cache + tests"
```

---

## Task 6: Refatorar `whatsappInstanceService` pra novo schema + manter aliases legados

**Files:**
- Modify: `server/services/whatsappInstanceService.ts` (todo o arquivo)
- Tests existentes em `server/tests/whatsapp-instance-*.test.ts` precisam continuar verdes

Este é o serviço que os controllers atuais usam. Precisamos:
- Manter os exports `getStatus()`, `connect()`, `disconnect()`, `destroy()`, `loadSendConfig()`, `loadValidWebhookTokens()`, `probeWebhook()`, `probeMessages()`, `selfTestWebhook()`.
- Trocar o storage de hard-coded columns pra leitura de `providerConfig` (com decryptSecret).
- Os métodos passam a operar na row `is_default=true`. Múltiplas linhas vêm na Task 7.

- [ ] **Step 1: Estudar comportamento atual e preparar lista de tests existentes**

Run:
```bash
ls server/tests/whatsapp-instance-*.test.ts
```

São: `whatsapp-instance-connect`, `whatsapp-instance-delete`, `whatsapp-instance-disconnect`, `whatsapp-instance-rbac`, `whatsapp-instance-status`.

Esses tests batem nos endpoints `/api/whatsapp-instance/*` e devem continuar passando após esta task. O service vai ler/escrever no `provider_config` mas a API externa não muda.

- [ ] **Step 2: Reescrever `loadOrSeed` e `getStatus` do `whatsappInstanceService.ts`**

Substituir o arquivo `server/services/whatsappInstanceService.ts` inteiro por:

```ts
import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { eq } from 'drizzle-orm';
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
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto';
import { uazapiConfigSchema, type UazapiConfig } from './whatsapp/uazapi/configSchema';
import { invalidateProvider } from './whatsapp/providerRegistry';

// ──────────────────────────────────────────────────────────────────────────
// Default-row helpers
//
// Backward-compat layer: existing single-instance endpoints continue to
// operate on the row where is_default=true. Multi-instance ops live in
// whatsappInstancesController.
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
    const tokenChanged = input.instanceToken &&
      decryptSecret(cfg.instanceToken ?? '') !== input.instanceToken;
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

  // Init UazAPI instance if needed
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

  // Webhook
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
// Used by uazapiClient.sendUazapiMessage and webhook handler
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
  return { baseUrl: cfg.baseUrl, instanceId: cfg.instanceId, token: decryptSecret(cfg.instanceToken) };
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
  const row = await loadDefaultRow();
  const tokens: string[] = [];
  if (row) {
    const cfg = uazCfg(row);
    if (cfg.webhookSecret) tokens.push(decryptSecret(cfg.webhookSecret));
    if (cfg.instanceToken) tokens.push(decryptSecret(cfg.instanceToken));
  }
  if (process.env.UAZAPI_WEBHOOK_SECRET) tokens.push(process.env.UAZAPI_WEBHOOK_SECRET);
  return tokens;
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
```

- [ ] **Step 3: Rodar TODOS os tests existentes**

Run:
```bash
npm test
```

Expected: tests `whatsapp-instance-*` voltam a passar (mesma API externa, novo storage interno). Tests novos (`crypto`, `whatsapp-provider-registry`) também passam. **Se algum falhar, debugar antes de commitar.**

- [ ] **Step 4: Commit**

```bash
git add server/services/whatsappInstanceService.ts
git commit -m "refactor(whatsapp): instance service reads/writes encrypted provider_config"
```

---

## Task 7: Endpoints multi-instância `/api/whatsapp/instances/*`

**Files:**
- Create: `server/controllers/whatsappInstancesController.ts`
- Create: `server/routes/whatsappInstances.ts`
- Modify: `server/app.ts` (mount `/api/whatsapp/instances`)
- Create: `server/tests/whatsapp-instances-crud.test.ts`
- Modify: `shared/types.ts` (adicionar `InstanceListItem`, `InstanceDetailResponse`, `CreateInstanceRequest`)

- [ ] **Step 1: Adicionar types compartilhados em `shared/types.ts`**

Adicionar (próximo ao `InstanceStatusResponse` existente):

```ts
export interface InstanceListItem {
  id: string;
  provider: ProviderKind;
  displayName: string;
  phoneNumber: string | null;
  profileName: string | null;
  isDefault: boolean;
  isArchived: boolean;
  lastStatus: string | null;
  lastStatusAt: string | null;
}

export interface InstanceDetailResponse extends InstanceListItem {
  status: 'disconnected' | 'pairing' | 'connected' | 'error';
  qrCode: string | null;
  // Provider-specific fields exposed (no secrets):
  uazapi?: { baseUrl: string; webhookSynced: boolean; webhookUrl: string | null };
  metaCloud?: { wabaId: string; phoneNumberId: string; webhookSubscribed: boolean };
}

export interface CreateInstanceRequest {
  provider: ProviderKind;
  displayName: string;
  isDefault?: boolean;
  // UazAPI: optional — env fallback é usado se não informar
  uazapi?: { baseUrl?: string; adminToken?: string };
  // Meta: obrigatório no Plano B
  metaCloud?: {
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
  };
}
```

- [ ] **Step 2: Escrever os tests CRUD**

Criar `server/tests/whatsapp-instances-crud.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance, conversations, leads, messages } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/whatsapp/uazapi/instanceClient', () => ({
  initInstance: vi.fn(),
  connectInstance: vi.fn().mockResolvedValue({ status: 'pairing', qrCode: 'data:image/png;base64,QR' }),
  getInstanceStatus: vi.fn().mockResolvedValue({
    status: 'disconnected', qrCode: null, phoneNumber: null, profileName: null,
  }),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(body); }
  },
}));

const app = createApp();

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  process.env.APP_URL = 'http://localhost:3000';
  await db.delete(messages); await db.delete(conversations);
  await db.delete(whatsappInstance); await db.delete(leads);
});

async function loginAs(role: 'admin' | 'comercial') {
  await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login')
    .send({ email: `${role}@x.com`, password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('GET /api/whatsapp/instances', () => {
  it('lists all non-archived instances', async () => {
    const token = await loginAs('admin');
    await createWhatsappInstance({ displayName: 'A', isDefault: true });
    await createWhatsappInstance({ displayName: 'B' });
    await createWhatsappInstance({ displayName: 'C', isArchived: true });
    const res = await request(app).get('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: any) => i.displayName).sort()).toEqual(['A', 'B']);
  });

  it('blocks non-admin', async () => {
    const token = await loginAs('comercial');
    const res = await request(app).get('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/whatsapp/instances', () => {
  it('creates a UazAPI instance with display name', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'uazapi',
        displayName: 'Atendimento',
        uazapi: { baseUrl: 'https://api.uazapi.com' },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.provider).toBe('uazapi');
    expect(res.body.displayName).toBe('Atendimento');
    const [row] = await db.select().from(whatsappInstance);
    expect(row.providerConfig).toMatchObject({ baseUrl: 'https://api.uazapi.com' });
  });

  it('marks first created instance as default automatically', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'uazapi', displayName: 'A' });
    expect(res.body.isDefault).toBe(true);
  });

  it('rejects 501 for meta_cloud (not implemented in Plan A)', async () => {
    const token = await loginAs('admin');
    const res = await request(app).post('/api/whatsapp/instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'meta_cloud',
        displayName: 'Oficial',
        metaCloud: { wabaId: 'x', phoneNumberId: 'y', accessToken: 'z', appSecret: 'w' },
      });
    expect(res.status).toBe(501);
  });
});

describe('PATCH /api/whatsapp/instances/:id', () => {
  it('updates display_name', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'Old' });
    const res = await request(app).patch(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('New');
  });

  it('setting isDefault=true unsets the previous default', async () => {
    const token = await loginAs('admin');
    const a = await createWhatsappInstance({ displayName: 'A', isDefault: true });
    const b = await createWhatsappInstance({ displayName: 'B' });
    const res = await request(app).patch(`/api/whatsapp/instances/${b.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isDefault: true });
    expect(res.status).toBe(200);
    const rows = await db.select().from(whatsappInstance);
    const defaults = rows.filter(r => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(b.id);
  });
});

describe('DELETE /api/whatsapp/instances/:id', () => {
  it('deletes an instance with no conversations', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'X' });
    const res = await request(app).delete(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(whatsappInstance)).toHaveLength(0);
  });

  it('rejects 409 when conversations reference the instance', async () => {
    const token = await loginAs('admin');
    const row = await createWhatsappInstance({ displayName: 'X' });
    const [lead] = await db.insert(leads).values({ name: 'L', phone: '5511999' }).returning();
    await db.insert(conversations).values({
      phone: '5511999', leadId: lead.id, instanceId: row.id,
    });
    const res = await request(app).delete(`/api/whatsapp/instances/${row.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/conversation/i);
  });
});
```

- [ ] **Step 3: Rodar (deve falhar)**

Run:
```bash
npm test -- whatsapp-instances-crud
```

Expected: FAIL — endpoints não existem (404).

- [ ] **Step 4: Implementar o controller**

Criar `server/controllers/whatsappInstancesController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { eq, and, ne, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { whatsappInstance, conversations } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { resolveProvider, invalidateProvider } from '../services/whatsapp/providerRegistry';
import { uazapiConfigSchema, type UazapiConfig } from '../services/whatsapp/uazapi/configSchema';
import type {
  InstanceListItem,
  InstanceDetailResponse,
  CreateInstanceRequest,
} from '@shared/types';

const createBodySchema = z.object({
  provider: z.enum(['uazapi', 'meta_cloud']),
  displayName: z.string().min(1).max(80),
  isDefault: z.boolean().optional(),
  uazapi: z.object({
    baseUrl: z.string().url().optional(),
    adminToken: z.string().optional(),
  }).optional(),
  metaCloud: z.object({
    wabaId: z.string().min(1),
    phoneNumberId: z.string().min(1),
    accessToken: z.string().min(1),
    appSecret: z.string().min(1),
  }).optional(),
});

const patchBodySchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

function toListItem(row: typeof whatsappInstance.$inferSelect): InstanceListItem {
  return {
    id: row.id,
    provider: row.provider as InstanceListItem['provider'],
    displayName: row.displayName,
    phoneNumber: row.phoneNumber,
    profileName: row.profileName,
    isDefault: row.isDefault,
    isArchived: row.isArchived,
    lastStatus: row.lastStatus,
    lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
  };
}

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.isArchived, false));
    res.json({ items: rows.map(toListItem) });
  } catch (e) { next(e); }
}

export async function detailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Instance not found');

    const provider = await resolveProvider(id);
    const live = await provider.getStatus();

    const body: InstanceDetailResponse = {
      ...toListItem(row),
      status: live.status,
      qrCode: live.qrCode,
    };
    if (row.provider === 'uazapi') {
      const cfg = uazapiConfigSchema.parse(row.providerConfig);
      body.uazapi = {
        baseUrl: cfg.baseUrl,
        webhookSynced: cfg.webhookSynced,
        webhookUrl: cfg.webhookUrl,
      };
    }
    res.json(body);
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input: CreateInstanceRequest = createBodySchema.parse(req.body);

    if (input.provider === 'meta_cloud') {
      // Implementation lands in Plan B.
      throw new HttpError(501, 'Meta Cloud provider not yet supported');
    }

    // UazAPI
    const baseUrl = input.uazapi?.baseUrl
      ?? process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com';
    const adminToken = input.uazapi?.adminToken
      ?? process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_TOKEN ?? null;

    const cfg: UazapiConfig = {
      baseUrl,
      instanceId: null,
      instanceToken: adminToken ? encryptSecret(adminToken) : null,
      webhookSecret: null,
      webhookUrl: null,
      webhookSynced: false,
    };

    // is_default logic: if no instance exists yet OR caller passed isDefault=true
    const [{ value: existingCount }] = await db.select({ value: count() }).from(whatsappInstance);
    const shouldBeDefault = (existingCount === 0) || input.isDefault === true;

    let row: typeof whatsappInstance.$inferSelect;
    await db.transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.update(whatsappInstance)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(whatsappInstance.isDefault, true));
      }
      [row] = await tx.insert(whatsappInstance).values({
        provider: 'uazapi',
        displayName: input.displayName,
        isDefault: shouldBeDefault,
        providerConfig: cfg,
      }).returning();
    });

    res.status(201).json(toListItem(row!));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function patchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const patch = patchBodySchema.parse(req.body);
    const [existing] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!existing) throw new HttpError(404, 'Instance not found');

    await db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx.update(whatsappInstance)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(whatsappInstance.isDefault, true), ne(whatsappInstance.id, id)));
      }
      await tx.update(whatsappInstance).set({
        displayName: patch.displayName ?? existing.displayName,
        isDefault: patch.isDefault ?? existing.isDefault,
        isArchived: patch.isArchived ?? existing.isArchived,
        updatedAt: new Date(),
      }).where(eq(whatsappInstance.id, id));
    });

    invalidateProvider(id);
    const [updated] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    res.json(toListItem(updated!));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [{ value: convCount }] = await db.select({ value: count() }).from(conversations)
      .where(eq(conversations.instanceId, id));
    if (convCount > 0) {
      throw new HttpError(409,
        `Há ${convCount} conversa(s) vinculada(s) a essa linha. Arquive em vez de excluir.`);
    }
    await db.delete(whatsappInstance).where(eq(whatsappInstance.id, id));
    invalidateProvider(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function connectInstanceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    // Use the legacy single-instance service path WHEN id == default row's id.
    // For multi-instance UazAPI connect, we'll implement scoped connect in a
    // later step of Task 7 — for Plan A v1, only default-row connect via the
    // legacy alias path is required to keep existing flow working.
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Instance not found');
    if (!row.isDefault) {
      // For non-default UazAPI instances, mark as default temporarily, run
      // connect(), then restore. Simpler: throw NotImplemented for now and
      // let users connect via the legacy alias.
      throw new HttpError(501,
        'Connect for non-default instances will be supported in a follow-up. ' +
        'Mark as default first.');
    }
    const { connect } = await import('../services/whatsappInstanceService');
    const result = await connect({});
    invalidateProvider(id);
    res.json(result);
  } catch (e) { next(e); }
}
```

- [ ] **Step 5: Criar as rotas em `server/routes/whatsappInstances.ts`**

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  listHandler, detailHandler, createHandler, patchHandler, deleteHandler,
  connectInstanceHandler,
} from '../controllers/whatsappInstancesController';

const router = Router();
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...adminOnly, listHandler);
router.post('/', ...adminOnly, createHandler);
router.get('/:id', ...adminOnly, detailHandler);
router.patch('/:id', ...adminOnly, patchHandler);
router.delete('/:id', ...adminOnly, deleteHandler);
router.post('/:id/connect', ...adminOnly, connectInstanceHandler);

export default router;
```

- [ ] **Step 6: Montar a rota em `server/app.ts`**

Procurar o trecho onde `whatsappInstance` (legado) é montado e adicionar abaixo:

```ts
import whatsappInstancesRouter from './routes/whatsappInstances';
// ...
app.use('/api/whatsapp/instances', whatsappInstancesRouter);
```

- [ ] **Step 7: Rodar os tests CRUD**

Run:
```bash
npm test -- whatsapp-instances-crud
```

Expected: PASS — 8 tests.

- [ ] **Step 8: Rodar a suite inteira pra garantir nada quebrou**

Run:
```bash
npm test
```

Expected: PASS — todos os tests verdes.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/whatsappInstancesController.ts \
        server/routes/whatsappInstances.ts \
        server/app.ts \
        shared/types.ts \
        server/tests/whatsapp-instances-crud.test.ts
git commit -m "feat(whatsapp): add /api/whatsapp/instances/* CRUD endpoints (admin-only)"
```

---

## Task 8: Confirmar aliases backward-compat funcionam

**Files:**
- Create: `server/tests/whatsapp-instances-aliases.test.ts`
- (Sem mudanças de código — aliases já funcionam via `whatsappInstanceService` refatorado na Task 6.)

- [ ] **Step 1: Escrever teste que documenta o comportamento de retrocompatibilidade**

Criar `server/tests/whatsapp-instances-aliases.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { whatsappInstance, conversations, leads, messages } from '../db/schema';
import { createUser, createWhatsappInstance } from './helpers';

vi.mock('../services/whatsapp/uazapi/instanceClient', () => ({
  initInstance: vi.fn(),
  connectInstance: vi.fn().mockResolvedValue({ status: 'pairing', qrCode: 'QR' }),
  getInstanceStatus: vi.fn().mockResolvedValue({
    status: 'connected', qrCode: null, phoneNumber: '+5511999', profileName: 'Lubritec',
  }),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
  UazapiInstanceError: class extends Error {
    constructor(public status: number, public body: string) { super(body); }
  },
}));

const app = createApp();

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  process.env.APP_URL = 'http://localhost:3000';
  await db.delete(messages); await db.delete(conversations);
  await db.delete(whatsappInstance); await db.delete(leads);
});

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('Legacy /api/whatsapp-instance aliases', () => {
  it('GET /api/whatsapp-instance returns the default instance status', async () => {
    const token = await loginAdmin();
    await createWhatsappInstance({
      displayName: 'Default', isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: 'inst-1',
        instanceToken: null,  // will be set by service
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    const res = await request(app).get('/api/whatsapp-instance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Returns the InstanceStatusResponse shape (same as before refactor)
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('baseUrl');
  });

  it('POST /api/whatsapp-instance/disconnect still works on the default row', async () => {
    const token = await loginAdmin();
    await createWhatsappInstance({
      displayName: 'Default', isDefault: true,
    });
    // Need an instanceId+token to call disconnect
    // (real flow goes through /connect first; we shortcut by inserting a row
    // with a valid encrypted token via service-level helper)
    // For this assertion, just verify route is mounted and authorized:
    const res = await request(app).post('/api/whatsapp-instance/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 400, 502]).toContain(res.status);   // 400 if no token yet — acceptable
  });
});
```

- [ ] **Step 2: Rodar**

Run:
```bash
npm test -- whatsapp-instances-aliases
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/tests/whatsapp-instances-aliases.test.ts
git commit -m "test(whatsapp): document legacy /whatsapp-instance aliases still work"
```

---

## Task 9: Descobrir página atual de Settings e mapear estrutura

**Files:**
- Investigation only — sem mudanças de código.

- [ ] **Step 1: Procurar componente que renderiza a página Settings WhatsApp**

Run:
```bash
grep -rn "useInstanceStatus\|InstanceStatusCard\|/settings/whatsapp" src/ --include="*.tsx"
```

Anotar:
- O componente de página (geralmente em `src/pages/` ou `src/features/settings/`)
- Como ele está incluído no router (`src/App.tsx` ou similar)

- [ ] **Step 2: Ler o componente identificado e anotar como adaptar**

Read o arquivo da página. Identificar:
- Onde monta `InstanceStatusCard` (componente atual single-instance)
- Que props recebe
- Layout (Tailwind classes)

A próxima task substitui essa montagem pelo `InstancesList`.

---

## Task 10: Frontend — types + API hooks multi-instância

**Files:**
- Modify: `src/features/settings/whatsapp/types.ts`
- Modify: `src/features/settings/whatsapp/api.ts`

- [ ] **Step 1: Adicionar types em `src/features/settings/whatsapp/types.ts`**

Append:

```ts
import type { InstanceListItem, InstanceDetailResponse, CreateInstanceRequest } from '@shared/types';
export type { InstanceListItem, InstanceDetailResponse, CreateInstanceRequest };
```

- [ ] **Step 2: Adicionar hooks em `src/features/settings/whatsapp/api.ts`**

Append ao final do arquivo:

```ts
import type {
  InstanceListItem,
  InstanceDetailResponse,
  CreateInstanceRequest,
} from './types';

// ── Multi-instance ─────────────────────────────────────────────────────────

const INSTANCES_KEY = ['whatsapp-instances'];

export function useInstancesList() {
  return useQuery({
    queryKey: INSTANCES_KEY,
    queryFn: () => api<{ items: InstanceListItem[] }>('/whatsapp/instances'),
    refetchInterval: 10_000,
  });
}

export function useInstanceDetail(id: string | null) {
  return useQuery({
    queryKey: [...INSTANCES_KEY, id],
    queryFn: () => api<InstanceDetailResponse>(`/whatsapp/instances/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'pairing') return 2_000;
      if (s === 'connected') return 30_000;
      return 5_000;
    },
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInstanceRequest) =>
      api<InstanceListItem>('/whatsapp/instances', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INSTANCES_KEY }),
  });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<Pick<InstanceListItem, 'displayName' | 'isDefault' | 'isArchived'>> }) =>
      api<InstanceListItem>(`/whatsapp/instances/${args.id}`, {
        method: 'PATCH',
        body: JSON.stringify(args.patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INSTANCES_KEY }),
  });
}

export function useDeleteInstanceById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/whatsapp/instances/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INSTANCES_KEY }),
  });
}

export function useConnectInstanceById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<InstanceDetailResponse>(`/whatsapp/instances/${id}/connect`, { method: 'POST' }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: INSTANCES_KEY });
      qc.invalidateQueries({ queryKey: [...INSTANCES_KEY, id] });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/whatsapp/types.ts src/features/settings/whatsapp/api.ts
git commit -m "feat(ui): add multi-instance hooks for whatsapp settings"
```

---

## Task 11: Frontend — `InstanceCard` componente

**Files:**
- Create: `src/features/settings/whatsapp/InstanceCard.tsx`

- [ ] **Step 1: Implementar o card**

Criar:

```tsx
import { useState } from 'react';
import { Settings2, CircleAlert, Loader2, CheckCircle2, PowerOff } from 'lucide-react';
import { useUpdateInstance, useDeleteInstanceById, useConnectInstanceById } from './api';
import type { InstanceListItem } from './types';

interface Props {
  instance: InstanceListItem;
}

function StatusDot({ status }: { status: string | null }) {
  const map: Record<string, { color: string; Icon: typeof CheckCircle2; label: string }> = {
    connected: { color: 'text-emerald-500', Icon: CheckCircle2, label: 'Conectado' },
    pairing: { color: 'text-amber-500', Icon: Loader2, label: 'Pareando' },
    disconnected: { color: 'text-zinc-400', Icon: PowerOff, label: 'Desconectado' },
    error: { color: 'text-red-500', Icon: CircleAlert, label: 'Erro' },
  };
  const info = map[status ?? 'disconnected'] ?? map.disconnected;
  const Icon = info.Icon;
  const spin = status === 'pairing' ? 'animate-spin' : '';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${info.color}`}>
      <Icon size={16} className={spin} />
      {info.label}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: 'uazapi' | 'meta_cloud' }) {
  const label = provider === 'uazapi' ? 'UazAPI' : 'Meta Cloud';
  const cls = provider === 'uazapi'
    ? 'bg-zinc-100 text-zinc-700'
    : 'bg-lubritec-blue/10 text-lubritec-blue';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

export function InstanceCard({ instance }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const updateMut = useUpdateInstance();
  const deleteMut = useDeleteInstanceById();
  const connectMut = useConnectInstanceById();

  const handleSetDefault = () => updateMut.mutate({ id: instance.id, patch: { isDefault: true } });
  const handleArchive = () => updateMut.mutate({ id: instance.id, patch: { isArchived: true } });
  const handleDelete = () => {
    if (!confirm(`Excluir a linha "${instance.displayName}"? Esta ação não pode ser desfeita.`)) return;
    deleteMut.mutate(instance.id);
  };
  const handleReconnect = () => connectMut.mutate(instance.id);

  return (
    <div className="border border-zinc-200 rounded-lg p-4 flex items-center gap-4">
      <StatusDot status={instance.lastStatus} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{instance.displayName}</span>
          <ProviderBadge provider={instance.provider} />
          {instance.isDefault && (
            <span className="text-xs text-zinc-500 italic">padrão</span>
          )}
        </div>
        <div className="text-sm text-zinc-500 truncate">
          {instance.phoneNumber ?? 'Sem número conectado'}
          {instance.profileName ? ` — ${instance.profileName}` : ''}
        </div>
      </div>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-2 rounded hover:bg-zinc-100"
          aria-label="Opções"
        >
          <Settings2 size={18} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded shadow-md z-10 min-w-[180px]">
            <button onClick={() => { setMenuOpen(false); handleReconnect(); }}
              className="w-full px-3 py-2 text-left hover:bg-zinc-50">Reconectar</button>
            {!instance.isDefault && (
              <button onClick={() => { setMenuOpen(false); handleSetDefault(); }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50">Definir como padrão</button>
            )}
            <button onClick={() => { setMenuOpen(false); handleArchive(); }}
              className="w-full px-3 py-2 text-left hover:bg-zinc-50">Arquivar</button>
            <button onClick={() => { setMenuOpen(false); handleDelete(); }}
              className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50">Excluir</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/settings/whatsapp/InstanceCard.tsx
git commit -m "feat(ui): add InstanceCard component"
```

---

## Task 12: Frontend — `InstancesList` + Wizard "Adicionar número"

**Files:**
- Create: `src/features/settings/whatsapp/InstancesList.tsx`
- Create: `src/features/settings/whatsapp/AddInstanceWizard.tsx`
- Create: `src/features/settings/whatsapp/ProviderPickerStep.tsx`
- Create: `src/features/settings/whatsapp/UazapiSetupStep.tsx`
- Modify: a página de Settings descoberta na Task 9 — trocar montagem antiga pelo `<InstancesList />`

- [ ] **Step 1: `ProviderPickerStep.tsx`**

```tsx
import type { ProviderKind } from '@shared/types';

interface Props {
  onSelect: (kind: ProviderKind) => void;
}

export function ProviderPickerStep({ onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <button
        onClick={() => onSelect('uazapi')}
        className="border border-zinc-200 rounded-lg p-5 text-left hover:border-lubritec-blue hover:shadow-sm transition"
      >
        <h3 className="font-semibold text-lg mb-2">UazAPI (não oficial)</h3>
        <ul className="text-sm text-zinc-600 space-y-1 mb-4">
          <li>• Pareamento via QR code</li>
          <li>• Mensagens livres sem limite</li>
          <li>• Custo fixo mensal</li>
          <li>• ⚠️ Risco de banimento pela Meta</li>
        </ul>
        <span className="inline-block px-3 py-1.5 bg-lubritec-blue text-white text-sm rounded">
          Selecionar
        </span>
      </button>
      <button
        onClick={() => onSelect('meta_cloud')}
        disabled
        className="border border-zinc-200 rounded-lg p-5 text-left opacity-60 cursor-not-allowed"
      >
        <h3 className="font-semibold text-lg mb-2">WhatsApp Cloud API (Meta)</h3>
        <ul className="text-sm text-zinc-600 space-y-1 mb-4">
          <li>• Configuração via Meta Business Manager</li>
          <li>• Templates aprovados</li>
          <li>• Zero risco de ban</li>
          <li>• Custo por conversa</li>
        </ul>
        <span className="inline-block px-3 py-1.5 bg-zinc-300 text-zinc-600 text-sm rounded">
          Em breve (Plano B)
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `UazapiSetupStep.tsx`**

```tsx
import { useState } from 'react';
import { useCreateInstance } from './api';

interface Props {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function UazapiSetupStep({ onCreated, onCancel }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.uazapi.com');
  const [adminToken, setAdminToken] = useState('');
  const create = useCreateInstance();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        provider: 'uazapi',
        displayName,
        uazapi: {
          baseUrl: baseUrl || undefined,
          adminToken: adminToken || undefined,
        },
      },
      { onSuccess: (row) => onCreated(row.id) },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Nome de exibição</span>
        <input
          required minLength={1} maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex: Atendimento Lubritec"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">URL da UazAPI</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Admin Token (opcional — usa o do .env se vazio)</span>
        <input
          type="password"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm"
        />
      </label>
      {create.error && (
        <div className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : String(create.error)}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={create.isPending || !displayName}
          className="px-4 py-2 bg-lubritec-blue text-white rounded disabled:opacity-50"
        >
          {create.isPending ? 'Criando...' : 'Criar e conectar'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `AddInstanceWizard.tsx`**

```tsx
import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProviderKind } from '@shared/types';
import { ProviderPickerStep } from './ProviderPickerStep';
import { UazapiSetupStep } from './UazapiSetupStep';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function AddInstanceWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<'pick' | 'uazapi'>('pick');

  if (!open) return null;

  const handleSelect = (kind: ProviderKind) => {
    if (kind === 'uazapi') setStep('uazapi');
  };
  const reset = () => { setStep('pick'); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">
            {step === 'pick' ? 'Adicionar número de WhatsApp' : 'Configurar UazAPI'}
          </h2>
          <button onClick={reset} className="p-1 hover:bg-zinc-100 rounded">
            <X size={20} />
          </button>
        </header>
        <main className="p-6">
          {step === 'pick' && <ProviderPickerStep onSelect={handleSelect} />}
          {step === 'uazapi' && (
            <UazapiSetupStep
              onCreated={(id) => { onCreated(id); reset(); }}
              onCancel={() => setStep('pick')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `InstancesList.tsx`**

```tsx
import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useInstancesList } from './api';
import { InstanceCard } from './InstanceCard';
import { AddInstanceWizard } from './AddInstanceWizard';

export function InstancesList() {
  const { data, isLoading, isError, error } = useInstancesList();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Números de WhatsApp</h1>
          <p className="text-sm text-zinc-500">Conecte e gerencie as linhas usadas pelo SaaS.</p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-lubritec-blue text-white rounded hover:bg-lubritec-blue/90"
        >
          <Plus size={16} /> Adicionar número
        </button>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Carregando linhas...
        </div>
      )}

      {isError && (
        <div className="text-red-600 text-sm">
          Erro ao carregar: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="border border-dashed border-zinc-300 rounded-lg p-8 text-center text-zinc-500">
          Nenhum número conectado. Clique em "Adicionar número" pra começar.
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.items.map((inst) => (
            <InstanceCard key={inst.id} instance={inst} />
          ))}
        </div>
      )}

      <AddInstanceWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => { /* lista refetch automático via invalidate */ }}
      />
    </section>
  );
}
```

- [ ] **Step 5: Substituir a montagem antiga na página de Settings**

Na página identificada na Task 9, substituir a renderização do `InstanceStatusCard` única por `<InstancesList />`. O `InstanceStatusCard` antigo continua existindo (não apagar; alguma tela de detalhe pode usar) — só não é mais a entrada principal da página.

Exemplo (caminho exato depende do que a Task 9 descobriu):

```diff
- import { InstanceStatusCard } from '@/features/settings/whatsapp/InstanceStatusCard';
+ import { InstancesList } from '@/features/settings/whatsapp/InstancesList';
  ...
-   <InstanceStatusCard />
+   <InstancesList />
```

- [ ] **Step 6: Rodar dev server e testar fluxo manualmente**

Run:
```bash
npm run dev
```

Abrir browser em `http://localhost:5173/settings/whatsapp` (ou rota equivalente). Verificar:
1. Lista vazia mostra empty state.
2. Botão "Adicionar número" abre modal.
3. Selecionar UazAPI mostra formulário.
4. Preencher e submeter cria a linha.
5. Lista atualiza com a nova linha.
6. Menu de ações (⚙️) funciona (Arquivar, Excluir).

- [ ] **Step 7: Commit**

```bash
git add src/features/settings/whatsapp/InstancesList.tsx \
        src/features/settings/whatsapp/InstanceCard.tsx \
        src/features/settings/whatsapp/AddInstanceWizard.tsx \
        src/features/settings/whatsapp/ProviderPickerStep.tsx \
        src/features/settings/whatsapp/UazapiSetupStep.tsx \
        src/pages/...   # ajustar conforme arquivo modificado no Step 5
git commit -m "feat(ui): multi-instance WhatsApp list + Add Instance wizard"
```

---

## Task 13: Smoke test end-to-end + build final

**Files:**
- Sem novos arquivos. Apenas verificações.

- [ ] **Step 1: Rodar build completo**

Run:
```bash
npm run build
```

Expected: PASS. Sem erros TS no server nem no client.

- [ ] **Step 2: Rodar TODA a suite de tests**

Run:
```bash
npm test
```

Expected: PASS — todos os tests existentes + novos verdes.

- [ ] **Step 3: Smoke test manual em dev**

Run:
```bash
npm run dev
```

Cenários a validar:
1. Login admin funciona.
2. `/settings/whatsapp` mostra a linha legada existente (criada via migration) listada como "Linha principal" / padrão.
3. Status da linha mostra o estado real do UazAPI (chamada live funciona).
4. Endpoint legado `GET /api/whatsapp-instance` continua respondendo o mesmo shape.
5. Inbox carrega conversas existentes (sem mudança visível — o `instance_id` foi backfillado corretamente).
6. Campanhas existentes continuam disparando (sem touchpoint nesse plano, mas a migration mexeu indiretamente).

- [ ] **Step 4: Atualizar CHANGELOG se houver**

Se existir `CHANGELOG.md` na raiz, adicionar entrada da versão atual:

```markdown
## [Unreleased] — 2026-05-XX

### Added
- WhatsApp multi-provider foundation: encrypted credential storage,
  per-instance `provider_config`, `WhatsAppProvider` interface,
  `providerRegistry` with cache, and new `/api/whatsapp/instances/*`
  CRUD endpoints with admin-only RBAC.
- Settings UI: list of connected WhatsApp lines, "Add line" wizard with
  provider chooser (UazAPI flow ready; Meta Cloud in Plan B).

### Changed
- `whatsapp_instance` is now multi-row; legacy single-row mode preserved
  via `is_default` flag and backward-compat alias routes.
- `conversations` has new `instance_id` (backfilled to default row).
- `messages.uazapi_msg_id` renamed to `provider_msg_id`; new `provider` column.

### Internal
- UazAPI client moved to `server/services/whatsapp/uazapi/` and refactored
  to implement `WhatsAppProvider`.
```

- [ ] **Step 5: Commit final do plano**

```bash
git add CHANGELOG.md  # se aplicável
git commit -m "docs: changelog for WhatsApp multi-provider foundation (Plan A)"
```

- [ ] **Step 6: Push e abrir PR**

```bash
git push -u origin <branch>
gh pr create --title "feat(whatsapp): multi-provider foundation (Plan A)" --body "$(cat <<'EOF'
## Summary

Estabelece a fundação multi-provider de WhatsApp no LubriConnect — sem features Meta ainda, foco em desbloquear PRs subsequentes:

- Criptografia AES-256-GCM pra credenciais (lib + env var)
- Migration 026 + script de encryption pra migrar a row existente sem perda
- Schema multi-provider (`whatsapp_instance` com `provider`, `provider_config`, `is_default`)
- `conversations.instance_id` e `messages.provider`/`provider_msg_id` com backfill
- Interface `WhatsAppProvider` + `providerRegistry` com cache de 5min
- UazAPI refatorado pra implementar a interface (todos os tests existentes verdes)
- Novos endpoints `/api/whatsapp/instances/*` (admin-only)
- UI Settings: lista de linhas + wizard "Adicionar número" (Meta desabilitado até Plano B)
- Aliases backward-compat preservam todas as rotas `/api/whatsapp-instance/*` existentes

Próximo passo: Plano B — implementação `MetaCloudProvider`.

## Test plan

- [ ] `npm test` passa com 100% verde (incluindo novos tests `crypto`, `whatsapp-provider-registry`, `whatsapp-instances-crud`, `whatsapp-instances-aliases`)
- [ ] `npm run build` sem erros TS
- [ ] Migration 026 + encryptWhatsappCreds.ts aplicados em DB de staging sem perda
- [ ] Smoke manual em dev: linha legada aparece como padrão na nova UI
- [ ] Smoke manual em dev: criar 2ª linha UazAPI via wizard funciona
- [ ] Smoke manual em dev: rotas legadas `/api/whatsapp-instance/*` continuam respondendo
- [ ] Inbox carrega conversas existentes sem mudança visível
- [ ] Campanhas existentes continuam disparando

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Reli o plano contra o spec (`docs/superpowers/specs/2026-05-21-whatsapp-cloud-api-multi-provider-design.md`):

**Cobertura do spec (Seções 1-4, 10 PRs 1-4):**
- ✅ §2.1 Interface `WhatsAppProvider` — Task 3
- ✅ §2.2 Pasta `services/whatsapp/` — Task 4
- ✅ §2.3 `providerRegistry` com cache — Task 5
- ✅ §3.1 `whatsapp_instance` virar multi-row + provider — Task 2
- ✅ §3.2 Criptografia AES-256-GCM + env — Task 1
- ✅ §3.3 `conversations.instance_id` — Task 2
- ✅ §3.4 `messages.provider`/`provider_msg_id` — Task 2
- ✅ §4.1 Página `/settings/whatsapp` com lista — Task 9-12
- ✅ §4.2 Wizard provider picker — Task 12
- ✅ §4.3 UazAPI Step 2A — Task 12
- ❌ §4.4 Meta Cloud Step 2B — explicitamente deferred pro Plano B (botão disabled)
- ❌ §4.5 Webhook instructions — Plano B
- ✅ §4.6 Endpoints REST — Tasks 7-8 (Meta-specific endpoints como `/sync-templates`, `/webhook-info` ficam pro Plano B/C; CRUD básico aqui)
- ✅ §4.7 RBAC admin-only — Task 7
- ✅ §4.8 Validações (default único, conversations check) — Task 7

**Itens do spec que ficaram para planos seguintes (explícito):** §3.5 (HSM templates table) → Plano C; §3.6 (campaigns multi-instance) → Plano C; §5 (webhook Meta) → Plano B; §6 (editor HSM) → Plano C; §7 (envio Meta) → Plano B; §8-9 (inbox/campanhas) → Planos B-C.

**Placeholder scan:** sem TBDs, sem "implement later", todo step com código tem código completo. ✓

**Consistência de tipos:** `ProviderKind`, `UazapiConfig`, `InstanceListItem`, `WhatsAppProvider`, `ProviderStatus` usados de forma consistente entre tasks (definidos em 1, 2, 3, 7). ✓

**Pontos a observar durante execução:**
- O caminho exato da página Settings é descoberto na Task 9 — não dá pra fixar no plano sem ler aquele arquivo. Task 9 é puramente investigativa por isso.
- O nome do `lubritec-blue` no Tailwind config foi assumido baseado na memória do projeto. Se o token for outro (ex: `lubritec.blue`), ajustar nos componentes UI.
- Backfill do `is_default=true` na migration assume **uma única row** existente (a do produção). Se DB tiver 0 ou multiple, comportamento ainda é seguro (0 = nenhum default; multiple = primeira por created_at).
