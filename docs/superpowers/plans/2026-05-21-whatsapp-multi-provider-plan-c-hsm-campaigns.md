# Plan C — HSM Templates + Multi-Instance Campaigns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meta HSM (Highly Structured Message) templates as first-class entities in LubriConnect, plus rework campaigns to be multi-instance with optional HSM template selection. This unlocks mass campaigns through the official Meta Cloud API (with approved templates) while preserving the existing UazAPI free-form campaign flow.

**Architecture:**
- New table `whatsapp_hsm_templates` stores DRAFTs locally and mirrors APPROVED/PENDING templates synced from Meta WABAs. Status updates arrive via the webhook event `message_template_status_update` (push) with manual sync as fallback.
- New backend module `server/services/whatsapp/metaCloud/templates.ts` wraps Meta Graph endpoints (`POST/GET/DELETE /{waba_id}/message_templates`).
- `MetaCloudProvider.sendTemplate` (stub from Plan B) is replaced with the real implementation that posts to `/{phone_number_id}/messages` with `type: template` + components.
- `campaigns` table gains `instance_id` (required, default backfill), `hsm_template_id` (nullable), `hsm_variables` (JSONB). Constraint: exactly one of `template_id` (free-form, UazAPI) or `hsm_template_id` (Meta) must be set.
- Campaign worker dispatches based on the instance's provider + template type. Variable interpolation uses `hsm_variables` mapping (`static` value or `lead_field` lookup).
- Frontend: new `/settings/whatsapp/templates` page with list + editor wizard. Campaign creation wizard gains an instance-picker step and (for Meta instances) an HSM template selector with variable mapping.

**Tech Stack:** Node 20+ / TypeScript, Express, Drizzle ORM + Postgres (Supabase), Vitest + supertest, React 19 + TanStack Query + Tailwind, Meta Graph API v20.0.

---

## File Structure

**Criar:**
- `server/db/migrations/027_whatsapp_hsm_templates_and_campaigns.sql`
- `server/services/whatsapp/metaCloud/templates.ts` — Meta Graph API CRUD for templates
- `server/services/hsmTemplateService.ts` — local DB + Meta sync orchestration
- `server/controllers/hsmTemplatesController.ts` — HTTP layer
- `server/routes/hsmTemplates.ts`
- `server/tests/hsm-templates-crud.test.ts`
- `server/tests/meta-cloud-send-template.test.ts`
- `server/tests/meta-cloud-template-status-webhook.test.ts`
- `server/tests/campaigns-multi-instance.test.ts`
- `server/tests/fixtures/meta-webhook-template-status.json`
- `src/features/settings/whatsapp/templates/TemplatesListPage.tsx`
- `src/features/settings/whatsapp/templates/TemplateEditor.tsx`
- `src/features/settings/whatsapp/templates/TemplateComponentsEditor.tsx`
- `src/features/settings/whatsapp/templates/TemplatePreview.tsx`
- `src/features/settings/whatsapp/templates/api.ts`
- `src/features/settings/whatsapp/templates/types.ts`
- `src/features/campaigns/InstancePickerStep.tsx`
- `src/features/campaigns/HsmTemplatePickerStep.tsx`
- `src/features/campaigns/HsmVariablesMapper.tsx`

**Modificar:**
- `server/db/schema.ts` — add `whatsappHsmTemplates` table; add `instanceId`, `hsmTemplateId`, `hsmVariables` to `campaigns`
- `shared/types.ts` — add HSM types + `CampaignHsmVariable` type
- `server/tests/helpers.ts` — `createHsmTemplate` helper; `createCampaign` accepts new fields
- `server/services/whatsapp/metaCloud/provider.ts` — replace `sendTemplate` stub with real impl; replace `listTemplates`/`createTemplate`/`deleteTemplate` stubs by delegating to `templates.ts`
- `server/services/whatsapp/metaCloud/webhookHandler.ts` — handle `message_template_status_update` events
- `server/services/campaignsDispatcher.ts` (or equivalent) — resolve provider via instance, branch on free-form vs HSM, interpolate variables
- `server/controllers/campaignsController.ts` — accept `instanceId` + `hsmTemplateId` + `hsmVariables` on create
- `server/routes/whatsappInstances.ts` — `POST /:id/sync-templates` (Meta only)
- `src/features/campaigns/CreateCampaignWizard.tsx` (or equivalent) — insert instance-picker step + branch to HSM picker for Meta
- `src/pages/settings/WhatsappConnectionTab.tsx` — link to new `/templates` page (or expose as sub-tab)
- `src/features/settings/whatsapp/InstanceCard.tsx` — add "Sincronizar templates" button for Meta instances
- `CHANGELOG.md`

---

## Task 1: Migration 027 + schema + helpers

**Files:**
- Create: `server/db/migrations/027_whatsapp_hsm_templates_and_campaigns.sql`
- Modify: `server/db/schema.ts`
- Modify: `shared/types.ts`
- Modify: `server/tests/helpers.ts`

### Step 1.1: SQL migration

Create `server/db/migrations/027_whatsapp_hsm_templates_and_campaigns.sql`:

```sql
BEGIN;

-- ── whatsapp_hsm_templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_hsm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES whatsapp_instance(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED')),
  components JSONB NOT NULL,
  variable_count INT NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsm_instance_name_lang
  ON whatsapp_hsm_templates(instance_id, name, language);
CREATE INDEX IF NOT EXISTS idx_hsm_status ON whatsapp_hsm_templates(status);

-- ── campaigns: instance_id + hsm_template_id + hsm_variables ───────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS instance_id UUID
    REFERENCES whatsapp_instance(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hsm_template_id UUID
    REFERENCES whatsapp_hsm_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hsm_variables JSONB DEFAULT '[]'::jsonb;

-- Backfill instance_id from default row
UPDATE campaigns
SET instance_id = (SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1)
WHERE instance_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campaigns WHERE instance_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set campaigns.instance_id NOT NULL: NULL values remain';
  END IF;
  ALTER TABLE campaigns ALTER COLUMN instance_id SET NOT NULL;
END $$;

COMMIT;
```

### Step 1.2: Drizzle schema

Edit `server/db/schema.ts`:

Add `whatsappHsmTemplates` after the existing `whatsappInstance` definition:

```ts
import { sql } from 'drizzle-orm';

export const whatsappHsmTemplates = pgTable('whatsapp_hsm_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'cascade' }),
  metaTemplateId: text('meta_template_id'),
  name: text('name').notNull(),
  language: text('language').notNull(),
  category: text('category', { enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] }).notNull(),
  status: text('status', { enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'] }).notNull(),
  components: jsonb('components').notNull(),
  variableCount: integer('variable_count').notNull().default(0),
  rejectionReason: text('rejection_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
}, (t) => ({
  instanceNameLangUniq: uniqueIndex('idx_hsm_instance_name_lang').on(t.instanceId, t.name, t.language),
  statusIdx: index('idx_hsm_status').on(t.status),
}));
```

Find the `campaigns` table and ADD fields (preserve existing fields):
```ts
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'restrict' }),
  hsmTemplateId: uuid('hsm_template_id').references(() => whatsappHsmTemplates.id, { onDelete: 'restrict' }),
  hsmVariables: jsonb('hsm_variables').default([]),
```

### Step 1.3: shared/types.ts

Add:

```ts
export const HSM_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type HsmCategory = typeof HSM_CATEGORIES[number];

export const HSM_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'] as const;
export type HsmStatus = typeof HSM_STATUSES[number];

export interface HsmHeaderText { type: 'HEADER'; format: 'TEXT'; text: string; example?: { header_text: string[] } }
export interface HsmHeaderMedia { type: 'HEADER'; format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; example?: { header_handle: string[] } }
export type HsmHeader = HsmHeaderText | HsmHeaderMedia;

export interface HsmBody {
  type: 'BODY';
  text: string;
  example?: { body_text: string[][] };
}

export interface HsmFooter { type: 'FOOTER'; text: string }

export interface HsmQuickReplyButton { type: 'QUICK_REPLY'; text: string }
export interface HsmUrlButton { type: 'URL'; text: string; url: string }
export interface HsmPhoneButton { type: 'PHONE_NUMBER'; text: string; phone_number: string }
export type HsmButton = HsmQuickReplyButton | HsmUrlButton | HsmPhoneButton;

export interface HsmButtons { type: 'BUTTONS'; buttons: HsmButton[] }

export type HsmComponent = HsmHeader | HsmBody | HsmFooter | HsmButtons;

export interface HsmTemplateRecord {
  id: string;
  instanceId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: HsmCategory;
  status: HsmStatus;
  components: HsmComponent[];
  variableCount: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

export interface CreateHsmTemplateRequest {
  name: string;          // snake_case
  language: string;
  category: HsmCategory;
  components: HsmComponent[];
  submitNow?: boolean;   // if true → status=PENDING + POST to Meta; else → DRAFT
}

export interface CampaignHsmVariable {
  index: number;                       // 1, 2, ...
  source: 'static' | 'lead_field';
  value: string;                       // literal for static, field name for lead_field (e.g. "name", "phone")
}
```

### Step 1.4: Test helpers

Edit `server/tests/helpers.ts`. Add at end:

```ts
import { whatsappHsmTemplates } from '../db/schema';
import type { HsmCategory, HsmStatus, HsmComponent } from '@shared/types';

export async function createHsmTemplate(opts: {
  instanceId: string;
  createdBy: string;
  name?: string;
  language?: string;
  category?: HsmCategory;
  status?: HsmStatus;
  components?: HsmComponent[];
  metaTemplateId?: string | null;
  variableCount?: number;
}) {
  const [row] = await db.insert(whatsappHsmTemplates).values({
    instanceId: opts.instanceId,
    createdBy: opts.createdBy,
    name: opts.name ?? `tpl_${Date.now()}`,
    language: opts.language ?? 'pt_BR',
    category: opts.category ?? 'MARKETING',
    status: opts.status ?? 'DRAFT',
    components: opts.components ?? [{ type: 'BODY', text: 'Default body {{1}}' }],
    metaTemplateId: opts.metaTemplateId ?? null,
    variableCount: opts.variableCount ?? 0,
  }).returning();
  return row;
}
```

Update `createCampaign` signature to accept (and pass through) `instanceId`, `hsmTemplateId`, `hsmVariables`. If `instanceId` isn't provided, use `getOrCreateDefaultInstance()`.

### Step 1.5: Run + commit

```
powershell -NoProfile -Command "Get-Process postgres -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2; if (Test-Path \"$env:TEMP\lubritec-embedded-pg\") { Remove-Item -Recurse -Force \"$env:TEMP\lubritec-embedded-pg\" }"

npx vitest --run server/tests/crypto.test.ts server/tests/conversations-list.test.ts
```

Expected: 7 + 11 = 18 passing (smoke: migration applies cleanly + schema reads still work).

```
git add server/db/migrations/027_whatsapp_hsm_templates_and_campaigns.sql \
        server/db/schema.ts \
        shared/types.ts \
        server/tests/helpers.ts
git commit -m "feat(db): migration 027 — whatsapp_hsm_templates + campaigns multi-instance columns"
```

---

## Task 2: Meta Graph templates client

**Files:** Create `server/services/whatsapp/metaCloud/templates.ts`.

Implements Meta Graph endpoints (NO DB code, NO provider class):

```ts
import { MetaGraphError } from './client';
import type { HsmComponent } from '@shared/types';

const DEFAULT_API_VERSION = 'v20.0';
function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? DEFAULT_API_VERSION}`;
}

async function metaFetch(path: string, init: RequestInit & { accessToken: string }) {
  const { accessToken, ...rest } = init;
  const res = await fetch(`${graphBase()}${path}`, {
    ...rest,
    headers: { ...rest.headers, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let body: unknown = text; try { body = JSON.parse(text); } catch { /* keep */ }
  if (!res.ok) {
    const err = body as { error?: { code?: number } };
    throw new MetaGraphError(res.status, err?.error?.code ?? null, body);
  }
  return body;
}

export interface CreateTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: HsmComponent[];
}

export interface CreateTemplateResult {
  metaTemplateId: string;
  status: string;
  category: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
  const body = await metaFetch(`/${input.wabaId}/message_templates`, {
    method: 'POST', accessToken: input.accessToken,
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    }),
  });
  const b = body as { id: string; status: string; category: string };
  return { metaTemplateId: b.id, status: b.status, category: b.category };
}

export interface FetchedTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: HsmComponent[];
  rejected_reason?: string;
}

export async function listTemplatesOnMeta(input: {
  wabaId: string; accessToken: string; limit?: number;
}): Promise<FetchedTemplate[]> {
  const limit = input.limit ?? 200;
  const body = await metaFetch(
    `/${input.wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=${limit}`,
    { method: 'GET', accessToken: input.accessToken },
  );
  const b = body as { data: FetchedTemplate[] };
  return b.data ?? [];
}

export async function deleteTemplateOnMeta(input: {
  wabaId: string; accessToken: string; name: string;
}): Promise<void> {
  await metaFetch(
    `/${input.wabaId}/message_templates?name=${encodeURIComponent(input.name)}`,
    { method: 'DELETE', accessToken: input.accessToken },
  );
}

export interface SendTemplateInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  name: string;
  language: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    sub_type?: 'quick_reply' | 'url';
    index?: number;
    parameters: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: { link: string } }
      | { type: 'video'; video: { link: string } }
      | { type: 'document'; document: { link: string } }
    >;
  }>;
}

export async function sendTemplateMessage(input: SendTemplateInput): Promise<{ messageId: string; rawPayload: unknown }> {
  const body = await metaFetch(`/${input.phoneNumberId}/messages`, {
    method: 'POST', accessToken: input.accessToken,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        components: input.components ?? [],
      },
    }),
  });
  const b = body as { messages?: Array<{ id: string }> };
  if (!b.messages?.length) throw new MetaGraphError(500, null, body);
  return { messageId: b.messages[0].id, rawPayload: body };
}
```

Commit:
```
git add server/services/whatsapp/metaCloud/templates.ts
git commit -m "feat(meta): add Meta Graph templates API client (create/list/delete/send)"
```

---

## Task 3: HSM template service + CRUD endpoints

**Files:**
- Create: `server/services/hsmTemplateService.ts`
- Create: `server/controllers/hsmTemplatesController.ts`
- Create: `server/routes/hsmTemplates.ts`
- Modify: `server/app.ts` — mount router
- Modify: `server/routes/whatsappInstances.ts` — add `POST /:id/sync-templates`
- Create: `server/tests/hsm-templates-crud.test.ts`

### Step 3.1: `hsmTemplateService.ts`

```ts
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { whatsappHsmTemplates, whatsappInstance } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import { decryptSecret } from '../lib/crypto';
import { metaCloudConfigSchema } from './whatsapp/metaCloud/configSchema';
import {
  createTemplate as createOnMeta,
  listTemplatesOnMeta,
  deleteTemplateOnMeta,
  type FetchedTemplate,
} from './whatsapp/metaCloud/templates';
import { MetaGraphError } from './whatsapp/metaCloud/client';
import type { HsmComponent } from '@shared/types';

export interface CreateLocalInput {
  instanceId: string;
  createdBy: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: HsmComponent[];
  submitNow: boolean;
}

function countVariables(components: HsmComponent[]): number {
  for (const c of components) {
    if (c.type === 'BODY') {
      const matches = c.text.match(/\{\{\d+\}\}/g);
      return matches ? new Set(matches).size : 0;
    }
  }
  return 0;
}

async function loadMetaCfg(instanceId: string) {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row) throw new HttpError(404, 'Instance not found');
  if (row.provider !== 'meta_cloud') {
    throw new HttpError(400, 'HSM templates are only supported on meta_cloud instances');
  }
  return metaCloudConfigSchema.parse(row.providerConfig);
}

export async function createTemplate(input: CreateLocalInput) {
  if (!/^[a-z0-9_]+$/.test(input.name)) {
    throw new HttpError(422, 'name must be snake_case (lowercase + digits + underscore)');
  }
  const variableCount = countVariables(input.components);

  let metaTemplateId: string | null = null;
  let status: 'DRAFT' | 'PENDING' = 'DRAFT';

  if (input.submitNow) {
    const cfg = await loadMetaCfg(input.instanceId);
    try {
      const res = await createOnMeta({
        wabaId: cfg.wabaId,
        accessToken: decryptSecret(cfg.accessToken),
        name: input.name, language: input.language,
        category: input.category, components: input.components,
      });
      metaTemplateId = res.metaTemplateId;
      status = 'PENDING';
    } catch (err) {
      if (err instanceof MetaGraphError) {
        throw new HttpError(422, `Meta template creation failed: ${err.message}`);
      }
      throw err;
    }
  }

  const [row] = await db.insert(whatsappHsmTemplates).values({
    instanceId: input.instanceId,
    createdBy: input.createdBy,
    name: input.name,
    language: input.language,
    category: input.category,
    status,
    components: input.components,
    metaTemplateId,
    variableCount,
    lastSyncedAt: metaTemplateId ? new Date() : null,
  }).returning();
  return row;
}

export async function listTemplates(instanceId: string) {
  return db.select().from(whatsappHsmTemplates)
    .where(eq(whatsappHsmTemplates.instanceId, instanceId))
    .orderBy(whatsappHsmTemplates.createdAt);
}

export async function deleteTemplate(instanceId: string, templateId: string) {
  const [row] = await db.select().from(whatsappHsmTemplates)
    .where(and(
      eq(whatsappHsmTemplates.id, templateId),
      eq(whatsappHsmTemplates.instanceId, instanceId),
    )).limit(1);
  if (!row) throw new HttpError(404, 'Template not found');

  if (row.metaTemplateId) {
    const cfg = await loadMetaCfg(instanceId);
    try {
      await deleteTemplateOnMeta({
        wabaId: cfg.wabaId,
        accessToken: decryptSecret(cfg.accessToken),
        name: row.name,
      });
    } catch (err) {
      if (!(err instanceof MetaGraphError)) throw err;
      // Best-effort: log and proceed with local delete
      console.warn('[hsm] Meta delete failed but proceeding with local delete:', err);
    }
  }

  await db.delete(whatsappHsmTemplates).where(eq(whatsappHsmTemplates.id, templateId));
}

export async function syncTemplates(instanceId: string): Promise<{ synced: number; created: number; updated: number }> {
  const cfg = await loadMetaCfg(instanceId);
  const fetched = await listTemplatesOnMeta({
    wabaId: cfg.wabaId,
    accessToken: decryptSecret(cfg.accessToken),
  });
  let created = 0, updated = 0;
  for (const t of fetched) {
    const [existing] = await db.select().from(whatsappHsmTemplates)
      .where(and(
        eq(whatsappHsmTemplates.instanceId, instanceId),
        eq(whatsappHsmTemplates.metaTemplateId, t.id),
      )).limit(1);
    const variableCount = countVariables(t.components);
    if (existing) {
      await db.update(whatsappHsmTemplates).set({
        status: t.status as never,
        components: t.components,
        rejectionReason: t.rejected_reason ?? null,
        variableCount,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(whatsappHsmTemplates.id, existing.id));
      updated++;
    } else {
      // Synced-only template (created on Meta UI, not via SaaS) — needs a sentinel created_by
      // For now, use the first admin user in the org. If none exists, skip.
      const [adminUser] = await db.execute<{ id: string }>(
        // raw SQL since drizzle doesn't have role enum here; safer to use existing user FK
        `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1` as never,
      ) as unknown as { rows: Array<{ id: string }> };
      const adminId = (adminUser as unknown as { rows?: Array<{ id: string }> })?.rows?.[0]?.id;
      if (!adminId) continue;   // no admin to attribute — skip
      await db.insert(whatsappHsmTemplates).values({
        instanceId,
        createdBy: adminId,
        metaTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category as never,
        status: t.status as never,
        components: t.components,
        variableCount,
        rejectionReason: t.rejected_reason ?? null,
        lastSyncedAt: new Date(),
      });
      created++;
    }
  }
  return { synced: fetched.length, created, updated };
}
```

NOTE: the `db.execute` pattern for the admin lookup is awkward — prefer using `db.select().from(users).where(eq(users.role, 'admin')).orderBy(users.createdAt).limit(1)` if the schema makes that clean. Pseudo-code above; adapt to actual project conventions during implementation.

### Step 3.2: Controller (`hsmTemplatesController.ts`)

Standard CRUD handlers calling the service. Sample:

```ts
import { z } from 'zod';
import { HSM_CATEGORIES } from '@shared/types';
import * as svc from '../services/hsmTemplateService';
// ... import Request/Response, HttpError, etc.

const createSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/),
  language: z.string().min(2),
  category: z.enum(HSM_CATEGORIES),
  components: z.array(z.any()).min(1),
  submitNow: z.boolean().optional().default(false),
});

export async function listHandler(req, res, next) {
  try {
    const items = await svc.listTemplates(req.params.instanceId);
    res.json({ items });
  } catch (e) { next(e); }
}

export async function createHandler(req, res, next) {
  try {
    const body = createSchema.parse(req.body);
    const row = await svc.createTemplate({
      instanceId: req.params.instanceId,
      createdBy: req.user!.id,
      ...body,
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function deleteHandler(req, res, next) {
  try {
    await svc.deleteTemplate(req.params.instanceId, req.params.tid);
    res.sendStatus(204);
  } catch (e) { next(e); }
}

export async function syncHandler(req, res, next) {
  try {
    const result = await svc.syncTemplates(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
}
```

### Step 3.3: Routes

`server/routes/hsmTemplates.ts`:
```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { listHandler, createHandler, deleteHandler } from '../controllers/hsmTemplatesController';

const router = Router({ mergeParams: true });
const adminOnly = [authGuard, requireRole('admin')];
router.get('/', ...adminOnly, listHandler);
router.post('/', ...adminOnly, createHandler);
router.delete('/:tid', ...adminOnly, deleteHandler);
export default router;
```

Mount in `app.ts`:
```ts
import hsmTemplatesRouter from './routes/hsmTemplates';
// ...
app.use('/api/whatsapp/instances/:instanceId/templates', hsmTemplatesRouter);
```

Add the sync route in `routes/whatsappInstances.ts`:
```ts
import { syncHandler } from '../controllers/hsmTemplatesController';
router.post('/:id/sync-templates', ...adminOnly, syncHandler);
```

### Step 3.4: Tests

Write `server/tests/hsm-templates-crud.test.ts` covering:
- POST as DRAFT (no Meta call) → row inserted with status=DRAFT
- POST with `submitNow=true` → Meta `createTemplate` called → status=PENDING + meta_template_id set
- POST with submitNow + Meta error → 422, no row inserted
- GET lists templates for instance
- DELETE deletes locally + calls Meta delete (mocked)
- DELETE returns 404 if not found
- Sync via POST /:id/sync-templates → creates/updates from Meta listTemplatesOnMeta
- Reject for uazapi instance → 400
- 403 for non-admin

### Step 3.5: Commit

```
git add server/services/hsmTemplateService.ts \
        server/controllers/hsmTemplatesController.ts \
        server/routes/hsmTemplates.ts \
        server/app.ts \
        server/routes/whatsappInstances.ts \
        server/tests/hsm-templates-crud.test.ts
git commit -m "feat(hsm): template CRUD service + endpoints + sync from Meta"
```

---

## Task 4: Real `MetaCloudProvider.sendTemplate` + tests

**Files:**
- Modify: `server/services/whatsapp/metaCloud/provider.ts` — replace `sendTemplate` stub
- Modify: `server/services/whatsapp/metaCloud/provider.ts` — also wire `listTemplates`, `createTemplate`, `deleteTemplate` to delegate to `templates.ts` (using the existing instance's WABA + token)
- Create: `server/tests/meta-cloud-send-template.test.ts`

The `WhatsAppProvider.sendTemplate` interface takes `{ to, templateName, language, variables: [{index, value}], headerMedia?: {...} }`. Implementation:

```ts
async sendTemplate(opts: SendTemplateOpts): Promise<SendResult> {
  const components: SendTemplateInput['components'] = [];

  // Header media (optional)
  if (opts.headerMedia) {
    components.push({
      type: 'header',
      parameters: [{
        type: opts.headerMedia.kind,
        [opts.headerMedia.kind]: { link: opts.headerMedia.url },
      } as never],
    });
  }

  // Body variables (ordered)
  if (opts.variables.length > 0) {
    const sorted = [...opts.variables].sort((a, b) => a.index - b.index);
    components.push({
      type: 'body',
      parameters: sorted.map((v) => ({ type: 'text' as const, text: v.value })),
    });
  }

  try {
    const res = await sendTemplateMessage({
      phoneNumberId: this.cfg.phoneNumberId,
      accessToken: this.decToken(),
      to: opts.to,
      name: opts.templateName,
      language: opts.language,
      components,
    });
    return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
  } catch (err) {
    this.translateAndRethrow(err);
  }
}
```

Tests cover: simple body-only template, body with variables (correctly sorted), template with header image, Meta error → ProviderError.

Commit:
```
git add server/services/whatsapp/metaCloud/provider.ts \
        server/tests/meta-cloud-send-template.test.ts
git commit -m "feat(meta): implement MetaCloudProvider.sendTemplate (replaces Plan B stub)"
```

---

## Task 5: Webhook event `message_template_status_update`

**Files:**
- Modify: `server/services/whatsapp/metaCloud/webhookHandler.ts` — handle `message_template_status_update` field
- Create: `server/tests/meta-cloud-template-status-webhook.test.ts`
- Create: `server/tests/fixtures/meta-webhook-template-status.json`

Sample fixture:
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID_123",
    "changes": [{
      "field": "message_template_status_update",
      "value": {
        "event": "APPROVED",
        "message_template_id": 99887766,
        "message_template_name": "boas_vindas_pos_troca",
        "message_template_language": "pt_BR",
        "reason": null
      }
    }]
  }]
}
```

Add in `processMetaWebhook`:
```ts
if (change.field === 'message_template_status_update') {
  const v = change.value as {
    event: string; message_template_id: number | string;
    message_template_name: string; message_template_language: string;
    reason?: string | null;
  };
  await updateTemplateStatus({
    instanceId,
    metaTemplateId: String(v.message_template_id),
    name: v.message_template_name,
    language: v.message_template_language,
    status: v.event,
    reason: v.reason ?? null,
  });
}
```

Plus an exported `updateTemplateStatus` helper in `hsmTemplateService.ts`.

Tests: POST webhook fixture with valid HMAC → DB row status updated.

Commit:
```
git add server/services/whatsapp/metaCloud/webhookHandler.ts \
        server/services/hsmTemplateService.ts \
        server/tests/meta-cloud-template-status-webhook.test.ts \
        server/tests/fixtures/meta-webhook-template-status.json
git commit -m "feat(meta): webhook handler for message_template_status_update"
```

---

## Task 6: Campaign service + worker — multi-instance + HSM

**Files:**
- Modify: `server/services/campaignsDispatcher.ts` (or equivalent — find the file that processes campaign recipients)
- Modify: `server/controllers/campaignsController.ts` — accept new fields on create
- Modify: `server/tests/campaigns-*.test.ts` — fix any tests broken by `instance_id` becoming required
- Create: `server/tests/campaigns-multi-instance.test.ts`

### Create endpoint changes

Campaign create payload now accepts:
```ts
{
  ...existing fields...,
  instanceId: string,                                    // required
  templateId?: string | null,                            // UazAPI free-form (existing)
  hsmTemplateId?: string | null,                         // Meta HSM (new)
  hsmVariables?: CampaignHsmVariable[],                  // new
}
```

Validation:
- `instanceId` required
- Exactly one of (`templateId`, `hsmTemplateId`) must be set
- If `hsmTemplateId` set, fetch template, require `status === 'APPROVED'`, validate that `hsmVariables` covers all `{{N}}` in the template

### Worker changes

For each recipient:
1. Resolve provider via `resolveProvider(campaign.instanceId)`
2. If `hsmTemplateId`:
   - Load template, resolve each variable from `hsmVariables` (static value or lead field lookup)
   - Call `provider.sendTemplate({ to, templateName, language, variables, headerMedia? })`
3. Else (free-form):
   - Render template body with placeholders → call `provider.sendText({ to, text })`
4. Persist message + result as before

### Tests

- Create campaign with Meta instance + HSM template → recipient processing calls `provider.sendTemplate` with correctly mapped variables
- Create with UazAPI instance + free-form template → calls `sendText`
- Validation: campaign with `hsm_template_id` but template not APPROVED → 422 on dispatch
- Validation: missing `instance_id` → 422
- Validation: both `template_id` AND `hsm_template_id` → 422

Commit:
```
git add server/controllers/campaignsController.ts \
        server/services/campaignsDispatcher.ts \
        server/tests/campaigns-*.test.ts
git commit -m "feat(campaigns): multi-instance + HSM template support in worker"
```

---

## Task 7: Frontend templates list page + hooks

**Files:**
- Create: `src/features/settings/whatsapp/templates/api.ts` (hooks)
- Create: `src/features/settings/whatsapp/templates/types.ts` (re-exports)
- Create: `src/features/settings/whatsapp/templates/TemplatesListPage.tsx`
- Modify: `src/pages/settings/WhatsappConnectionTab.tsx` (or add a new route) — link to templates page
- Modify: `src/features/settings/whatsapp/InstanceCard.tsx` — add "Sincronizar templates" button for Meta instances

Hooks (api.ts):
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { HsmTemplateRecord, CreateHsmTemplateRequest } from '@shared/types';

export function useTemplates(instanceId: string | null) {
  return useQuery({
    queryKey: ['hsm-templates', instanceId],
    queryFn: () => api<{ items: HsmTemplateRecord[] }>(`/whatsapp/instances/${instanceId}/templates`),
    enabled: !!instanceId,
  });
}

export function useCreateTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHsmTemplateRequest) =>
      api<HsmTemplateRecord>(`/whatsapp/instances/${instanceId}/templates`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hsm-templates', instanceId] }),
  });
}

export function useDeleteTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      api<void>(`/whatsapp/instances/${instanceId}/templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hsm-templates', instanceId] }),
  });
}

export function useSyncTemplates(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ synced: number; created: number; updated: number }>(
      `/whatsapp/instances/${instanceId}/sync-templates`, { method: 'POST' }
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hsm-templates', instanceId] }),
  });
}
```

`TemplatesListPage.tsx`: dropdown selects Meta instance, lists templates as cards with status badge, buttons for "New", "Sync from Meta", per-card "Edit (DRAFT only)" / "Delete".

Commit.

---

## Task 8: Template editor wizard

**Files:**
- Create: `TemplateEditor.tsx`, `TemplateComponentsEditor.tsx`, `TemplatePreview.tsx`

This is the largest UI piece. Editor structure:

- **Form**: name (snake_case validation inline) + language dropdown + category radio
- **HEADER (optional)**: type select (None / Text / Image / Video / Document) + conditional input
- **BODY (required)**: textarea with `{{N}}` highlighting, live count of detected variables, "Examples" inputs for each variable (Meta requires examples for submission)
- **FOOTER (optional)**: text input, max 60 chars
- **BUTTONS (optional, max 3)**: list of buttons, each one has type select (Quick Reply / URL / Phone) + fields per type
- **PREVIEW**: right-side panel showing WhatsApp-style rendering
- **Actions**: Cancel | Save as DRAFT | Submit for approval

On submit, build the `components` array per `HsmComponent` types and POST.

This is genuinely complex UI. Implementation should:
- Use controlled inputs everywhere
- Validate inline (snake_case on name, max length on footer, max 3 buttons)
- Show Meta's expected payload visually so admin understands what gets sent

Commit.

---

## Task 9: Campaign wizard — instance picker + HSM picker + variable mapping

**Files:**
- Modify: `src/features/campaigns/CreateCampaignWizard.tsx` (or equivalent)
- Create: `InstancePickerStep.tsx`, `HsmTemplatePickerStep.tsx`, `HsmVariablesMapper.tsx`

Step 0 (new): pick instance from list of non-archived instances.
- If UazAPI selected → continue with existing free-form template editor
- If Meta selected → new flow with HSM template picker + variable mapper

`HsmTemplatePickerStep`: lists templates with `status='APPROVED'` for the picked instance, shows preview.

`HsmVariablesMapper`: for each `{{N}}` in selected template's body, shows a row:
```
{{1}}: (•) Valor fixo: [____]
       ( ) Campo do lead: [Nome ▼]
```
Available lead fields: name, phone, cnpj, email, notes.

Saves to `campaigns.hsm_variables` JSONB.

Commit.

---

## Task 10: Finalization

**Files:**
- Modify: `CHANGELOG.md` — prepend Plan C entry
- Optionally: `docs/whatsapp-hsm-setup.md` — admin docs

Full TS build, full Vite build, full test suite. Commit + push + report PR URL.

---

## Self-review

Coverage of spec sections 3.5, 3.6, 6, 7.3, 8, 9:

- ✅ §3.5 whatsapp_hsm_templates table — Task 1
- ✅ §3.6 campaigns.instance_id / hsm_template_id / hsm_variables — Task 1
- ✅ §6.1 Templates list page — Task 7
- ✅ §6.2 Editor wizard — Task 8
- ✅ §6.3 Meta payload mapping — Task 3 (createTemplate)
- ✅ §6.4 Push (webhook) + pull (sync) — Tasks 3 + 5
- ✅ §6.5 Edit/delete rules — Task 3 + Task 8
- ✅ §7.3 sendTemplate Meta API call — Task 4
- ✅ §8 Inbox provider routing — already in place from Plan A/B (uses last_inbound_at + capabilities)
- ✅ §9.1 Campaign wizard with instance picker — Task 9
- ✅ §9.2 Variable mapping — Task 9
- ✅ §9.3 Worker uses provider per instance — Task 6
- ✅ §9.4 Pre-dispatch validation — Task 6

**Pontos a observar durante execução:**
- Task 3's "synced-only template" path needs a sentinel `created_by` user — pseudocode in plan is approximate; implementer should refine to use proper Drizzle query.
- Task 6 (campaign worker) is the most likely to surface pre-existing test breakages — be ready to update tests that don't pass `instance_id`.
- Task 8 (template editor) is genuinely large UI work — may need to be split into multiple sub-tasks during execution.
- Plan C as a whole is substantial. Consider executing backend (Tasks 1-6) in one session and frontend (Tasks 7-9) in another if context becomes a concern.
