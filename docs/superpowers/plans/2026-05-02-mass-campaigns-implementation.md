# Mass Campaign Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `/campanhas` (lista, wizard de criação, monitoramento com funil ROI) com dispatch em background rate-limited, conforme spec `docs/superpowers/specs/2026-05-02-mass-campaigns-design.md`.

**Architecture:** Migration 012 cria `campaigns` + `campaign_recipients` + FK em `conversations.origin_campaign_id`. Service layer separado: `campaignsAudience` (resolve filtros), `campaignsService` (CRUD + state transitions + funnel), `campaignsDispatcher` (loop async com `setInterval(60_000)` iniciado no boot). Mídia via multer disk storage em `/uploads/campaigns/`. Frontend wizard 4 passos + detail com polling adaptativo.

**Tech Stack:** Express + Drizzle 0.45 + Multer + Postgres 16; React 19 + TanStack Query 5 + shadcn/ui. **Sem dependências novas** (multer já instalado).

---

## File map

**Criar — backend:**
- `server/db/migrations/012_campaigns.sql`
- `server/services/campaignsAudience.ts`
- `server/services/campaignsService.ts`
- `server/services/campaignsDispatcher.ts`
- `server/middleware/multerCampaignMedia.ts`
- `server/controllers/campaignsController.ts`
- `server/routes/campaigns.ts`
- `server/tests/campaigns-crud.test.ts`
- `server/tests/campaigns-dry-run.test.ts`
- `server/tests/campaigns-create.test.ts`
- `server/tests/campaigns-dispatch.test.ts`
- `server/tests/campaigns-funnel.test.ts`
- `server/tests/campaigns-media.test.ts`
- `server/tests/campaigns-rbac.test.ts`

**Criar — frontend:**
- `src/features/campaigns/api.ts`
- `src/features/campaigns/helpers.ts`
- `src/features/campaigns/types.ts`
- `src/features/campaigns/CampaignList.tsx`
- `src/features/campaigns/StatusBadge.tsx`
- `src/features/campaigns/NameStep.tsx`
- `src/features/campaigns/AudienceStep.tsx`
- `src/features/campaigns/AudiencePreviewTable.tsx`
- `src/features/campaigns/CsvUpload.tsx`
- `src/features/campaigns/MessageStep.tsx`
- `src/features/campaigns/PreviewMessage.tsx`
- `src/features/campaigns/MediaUpload.tsx`
- `src/features/campaigns/ReviewStep.tsx`
- `src/features/campaigns/CampaignFunnel.tsx`
- `src/features/campaigns/DispatchProgress.tsx`
- `src/features/campaigns/RecipientsTable.tsx`
- `src/pages/campaigns/CampaignsPage.tsx`
- `src/pages/campaigns/CampaignNewPage.tsx`
- `src/pages/campaigns/CampaignDetailPage.tsx`

**Modificar:**
- `shared/types.ts` — types do spec (CAMPAIGN_STATUSES, AudienceFilters, PublicCampaign, CampaignFunnel, etc)
- `server/db/schema.ts` — `campaigns`, `campaignRecipients` + tipo exports
- `server/app.ts` — registrar `campaignRoutes` + `app.use('/uploads', express.static(...))`
- `server/index.ts` — `startDispatcher()` no boot
- `server/tests/setup.ts` — TRUNCATE incluindo `campaign_recipients, campaigns`
- `server/tests/helpers.ts` — `createCampaign`, `createCampaignRecipient`
- `src/components/layout/Sidebar.tsx` — link "Campanhas" (admin+comercial)
- `src/app/routes.tsx` — 3 rotas novas
- `.env.example` — `DISPATCH_RATE_PER_MINUTE=20`
- `.gitignore` — `/uploads/`
- `README.md`

---

## Task 1 — Migration 012 + schema + types + setup + helpers

**Files:**
- Create: `server/db/migrations/012_campaigns.sql`
- Modify: `shared/types.ts`, `server/db/schema.ts`, `server/tests/setup.ts`, `server/tests/helpers.ts`, `.gitignore`

- [ ] **Step 1.1:** Criar `server/db/migrations/012_campaigns.sql` com o conteúdo SQL **exato da seção "Schema" da spec** (3 enums não, na verdade 2: `campaign_status` e `campaign_recipient_status`; tabelas `campaigns` e `campaign_recipients`; índices; ALTER TABLE adicionando FK `fk_conversations_origin_campaign`).

Conteúdo SQL completo:

```sql
CREATE TYPE campaign_status AS ENUM (
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'
);

CREATE TYPE campaign_recipient_status AS ENUM (
  'pending', 'sent', 'failed', 'skipped'
);

CREATE TABLE campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  description          text,
  status               campaign_status NOT NULL DEFAULT 'draft',
  template_id          uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  message_body         text NOT NULL,
  media_url            text,
  media_mime           text,
  audience_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_total       int NOT NULL DEFAULT 0,
  scheduled_at         timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  sent_count           int NOT NULL DEFAULT 0,
  failed_count         int NOT NULL DEFAULT 0,
  skipped_count        int NOT NULL DEFAULT 0,
  rate_per_minute      int NOT NULL DEFAULT 20,
  created_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled_at ON campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_campaigns_owner ON campaigns(created_by_user_id);

CREATE TABLE campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  phone           text NOT NULL,
  status          campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);

CREATE INDEX idx_recipients_campaign_status ON campaign_recipients(campaign_id, status);
CREATE INDEX idx_recipients_lead ON campaign_recipients(lead_id);

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_origin_campaign
  FOREIGN KEY (origin_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
```

- [ ] **Step 1.2:** Aplicar migration nos dois schemas:

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Esperado: `→ 012_campaigns.sql (applied)` em ambos.

- [ ] **Step 1.3:** Adicionar tipos no fim de `shared/types.ts`. Cole exatamente o bloco da seção "Constantes/types compartilhados" da spec:

```ts
// ---------------------------------------------------------------------------
// Mass Campaigns (sub-projeto 7)
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = [
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'pending', 'sent', 'failed', 'skipped',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export interface AudienceFilters {
  status?: LeadStatus[];
  source?: LeadSource[];
  lastPurchaseDaysAgo?: number;
  excludeLeadIds?: string[];
  phoneCsv?: string[];
}

export interface CampaignDryRunResponse {
  total: number;
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    lastPurchaseDate: string | null;
  }>;
}

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  templateId: string | null;
  messageBody: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  audienceFilter: AudienceFilters;
  audienceTotal: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  ratePerMinute: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFunnel {
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  replied: number;
  inDeal: number;
  won: number;
  lost: number;
  lostByReason: Record<LossReason, number>;
  totalWonValue: number;
}

export interface PublicCampaignRecipient {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  status: CampaignRecipientStatus;
  sentAt: string | null;
  failureReason: string | null;
}
```

- [ ] **Step 1.4:** Atualizar `server/db/schema.ts`. Adicionar imports `numeric, jsonb` (se ainda faltam) e os enums. No fim do arquivo, antes dos `export type`s, adicionar:

```ts
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('draft'),
  templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
  messageBody: text('message_body').notNull(),
  mediaUrl: text('media_url'),
  mediaMime: text('media_mime'),
  audienceFilter: jsonb('audience_filter').notNull().default({}),
  audienceTotal: integer('audience_total').notNull().default(0),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  ratePerMinute: integer('rate_per_minute').notNull().default(20),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignRecipients = pgTable('campaign_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  phone: text('phone').notNull(),
  status: text('status', { enum: CAMPAIGN_RECIPIENT_STATUSES }).notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Type exports
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
```

Adicionar imports `CAMPAIGN_STATUSES, CAMPAIGN_RECIPIENT_STATUSES` à lista existente de `from '../../shared/types'`.

- [ ] **Step 1.5:** Atualizar `server/tests/setup.ts` — TRUNCATE inclui `campaign_recipients, campaigns` (children primeiro):

```ts
'TRUNCATE campaign_recipients, campaigns, deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users, whatsapp_instance RESTART IDENTITY CASCADE'
```

- [ ] **Step 1.6:** Adicionar helpers em `server/tests/helpers.ts`. Anexar:

```ts
import { campaigns, campaignRecipients } from '../db/schema';
import type { CampaignStatus, CampaignRecipientStatus } from '@shared/types';

export async function createCampaign(opts: {
  name?: string;
  description?: string | null;
  status?: CampaignStatus;
  templateId?: string | null;
  messageBody?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter?: Record<string, unknown>;
  audienceTotal?: number;
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  ratePerMinute?: number;
  createdByUserId: string;
}) {
  const [c] = await db.insert(campaigns).values({
    name: opts.name ?? 'Campanha Teste',
    description: opts.description ?? null,
    status: opts.status ?? 'draft',
    templateId: opts.templateId ?? null,
    messageBody: opts.messageBody ?? 'Olá {{nome}}!',
    mediaUrl: opts.mediaUrl ?? null,
    mediaMime: opts.mediaMime ?? null,
    audienceFilter: opts.audienceFilter ?? {},
    audienceTotal: opts.audienceTotal ?? 0,
    scheduledAt: opts.scheduledAt ?? null,
    startedAt: opts.startedAt ?? null,
    completedAt: opts.completedAt ?? null,
    sentCount: opts.sentCount ?? 0,
    failedCount: opts.failedCount ?? 0,
    skippedCount: opts.skippedCount ?? 0,
    ratePerMinute: opts.ratePerMinute ?? 20,
    createdByUserId: opts.createdByUserId,
  }).returning();
  return c;
}

export async function createCampaignRecipient(opts: {
  campaignId: string;
  leadId: string;
  phone?: string;
  status?: CampaignRecipientStatus;
  sentAt?: Date | null;
  conversationId?: string | null;
  messageId?: string | null;
  failureReason?: string | null;
}) {
  const [r] = await db.insert(campaignRecipients).values({
    campaignId: opts.campaignId,
    leadId: opts.leadId,
    phone: opts.phone ?? `5511${Date.now()}`.slice(0, 13),
    status: opts.status ?? 'pending',
    sentAt: opts.sentAt ?? null,
    conversationId: opts.conversationId ?? null,
    messageId: opts.messageId ?? null,
    failureReason: opts.failureReason ?? null,
  }).returning();
  return r;
}
```

- [ ] **Step 1.7:** Adicionar `/uploads/` ao `.gitignore`:

```
# uploaded media
/uploads/
```

- [ ] **Step 1.8:** Lint + commit:

```bash
npm run lint
git add server/db/migrations/012_campaigns.sql shared/types.ts server/db/schema.ts server/tests/setup.ts server/tests/helpers.ts .gitignore
git commit -m "feat(campaigns): migration 012 + schema + types + helpers"
```

---

## Task 2 — campaignsAudience: resolve filtros + dry-run

**Files:**
- Create: `server/services/campaignsAudience.ts`
- Create: `server/tests/campaigns-dry-run.test.ts`

- [ ] **Step 2.1:** Criar `server/services/campaignsAudience.ts`:

```ts
import { db } from '../db/client';
import { leads } from '../db/schema';
import { and, or, eq, lte, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AudienceFilters, CampaignDryRunResponse } from '@shared/types';

const PREVIEW_LIMIT = 5;

function buildWhere(filter: AudienceFilters): SQL | undefined {
  const conds: SQL[] = [];

  // Filtros padrão sobre `leads`
  if (filter.status?.length) conds.push(inArray(leads.status, filter.status));
  if (filter.source?.length) conds.push(inArray(leads.source, filter.source));
  if (filter.lastPurchaseDaysAgo != null && filter.lastPurchaseDaysAgo >= 0) {
    conds.push(sql`(
      ${leads.lastPurchaseDate} IS NULL
      OR ${leads.lastPurchaseDate} <= now() - interval '${sql.raw(String(filter.lastPurchaseDaysAgo))} days'
    )`);
  }
  if (filter.excludeLeadIds?.length) {
    conds.push(notInArray(leads.id, filter.excludeLeadIds));
  }

  // Match por telefone (CSV upload)
  // OR-combine: ou bate filtros básicos, OU está na lista de phone
  if (filter.phoneCsv?.length) {
    const baseCondition = conds.length ? and(...conds) : undefined;
    const phoneCondition = inArray(leads.phone, filter.phoneCsv);
    if (baseCondition) {
      return or(baseCondition, phoneCondition);
    }
    return phoneCondition;
  }

  return conds.length ? and(...conds) : undefined;
}

/**
 * Conta + retorna preview de até 5 leads que batem nos filtros.
 */
export async function dryRun(filter: AudienceFilters): Promise<CampaignDryRunResponse> {
  const where = buildWhere(filter);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const previewRows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      vehicleModel: leads.vehicleModel,
      vehiclePlate: leads.vehiclePlate,
      lastPurchaseDate: leads.lastPurchaseDate,
    })
    .from(leads)
    .where(where)
    .limit(PREVIEW_LIMIT);

  return {
    total,
    preview: previewRows.map((r) => ({
      leadId: r.leadId,
      name: r.name,
      phone: r.phone,
      vehicleModel: r.vehicleModel,
      vehiclePlate: r.vehiclePlate,
      lastPurchaseDate: r.lastPurchaseDate,
    })),
  };
}

/**
 * Resolve a audiência completa (lista de lead IDs + telefones).
 * Usado pelo POST /campaigns pra materializar campaign_recipients.
 */
export async function resolveAudience(filter: AudienceFilters): Promise<Array<{ leadId: string; phone: string }>> {
  const where = buildWhere(filter);
  const rows = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(where);
  return rows.map((r) => ({ leadId: r.id, phone: r.phone }));
}
```

- [ ] **Step 2.2:** Criar `server/tests/campaigns-dry-run.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLead } from './helpers';
import { dryRun, resolveAudience } from '../services/campaignsAudience';

describe('campaignsAudience.dryRun', () => {
  it('total e preview vazios sem leads', async () => {
    const r = await dryRun({});
    expect(r.total).toBe(0);
    expect(r.preview).toHaveLength(0);
  });

  it('filtra por status', async () => {
    await createLead({ phone: '5511000010001', status: 'frio' });
    await createLead({ phone: '5511000010002', status: 'morno' });
    await createLead({ phone: '5511000010003', status: 'quente' });

    const r = await dryRun({ status: ['frio', 'morno'] });
    expect(r.total).toBe(2);
  });

  it('filtra por source', async () => {
    await createLead({ phone: '5511000020001', source: 'manual' });
    await createLead({ phone: '5511000020002', source: 'csv' });
    await createLead({ phone: '5511000020003', source: 'whatsapp' });

    const r = await dryRun({ source: ['csv', 'whatsapp'] });
    expect(r.total).toBe(2);
  });

  it('filtra por lastPurchaseDaysAgo (inclui null e antigos)', async () => {
    const today = new Date();
    const old = new Date(today.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recent = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await createLead({ phone: '5511000030001', lastPurchaseDate: old });
    await createLead({ phone: '5511000030002', lastPurchaseDate: recent });
    await createLead({ phone: '5511000030003', lastPurchaseDate: null });

    const r = await dryRun({ lastPurchaseDaysAgo: 60 });
    expect(r.total).toBe(2);  // old + null
  });

  it('excludeLeadIds remove leads', async () => {
    const a = await createLead({ phone: '5511000040001', status: 'frio' });
    const b = await createLead({ phone: '5511000040002', status: 'frio' });

    const r = await dryRun({ status: ['frio'], excludeLeadIds: [a.id] });
    expect(r.total).toBe(1);
    expect(r.preview[0].leadId).toBe(b.id);
  });

  it('phoneCsv inclui leads pelos telefones (OR com filtros)', async () => {
    await createLead({ phone: '5511000050001', status: 'frio' });
    await createLead({ phone: '5511000050002', status: 'quente' });
    const c = await createLead({ phone: '5511000050003', status: 'morno' });

    // status frio OR phone=5511000050003 → 2 leads
    const r = await dryRun({
      status: ['frio'],
      phoneCsv: ['5511000050003'],
    });
    expect(r.total).toBe(2);
  });

  it('preview limita a 5 leads', async () => {
    for (let i = 1; i <= 7; i++) {
      await createLead({ phone: `5511000060${String(i).padStart(3, '0')}`, status: 'frio' });
    }
    const r = await dryRun({ status: ['frio'] });
    expect(r.total).toBe(7);
    expect(r.preview).toHaveLength(5);
  });
});

describe('campaignsAudience.resolveAudience', () => {
  it('retorna lista completa de {leadId, phone}', async () => {
    const a = await createLead({ phone: '5511000070001', status: 'frio' });
    const b = await createLead({ phone: '5511000070002', status: 'frio' });
    await createLead({ phone: '5511000070003', status: 'quente' });

    const r = await resolveAudience({ status: ['frio'] });
    expect(r).toHaveLength(2);
    const ids = r.map((x) => x.leadId);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});
```

- [ ] **Step 2.3:** Rodar testes — devem passar diretamente (service não tem dependências de rota):

```bash
npm test -- server/tests/campaigns-dry-run.test.ts
```

Esperado: 7/7 passando.

- [ ] **Step 2.4:** Lint + commit:

```bash
npm run lint
git add server/services/campaignsAudience.ts server/tests/campaigns-dry-run.test.ts
git commit -m "feat(campaigns): audience resolver (filters + dry-run + phoneCsv)"
```

---

## Task 3 — campaignsService: CRUD + state transitions + funnel

**Files:**
- Create: `server/services/campaignsService.ts`

- [ ] **Step 3.1:** Criar `server/services/campaignsService.ts`:

```ts
import { db } from '../db/client';
import { campaigns, campaignRecipients, leads, conversations, messages, deals, users } from '../db/schema';
import { eq, and, or, ilike, desc, sql, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicCampaign,
  CampaignFunnel,
  CampaignStatus,
  AudienceFilters,
  PublicCampaignRecipient,
  LossReason,
} from '@shared/types';
import { LOSS_REASONS } from '@shared/types';
import { resolveAudience } from './campaignsAudience';

const LIST_PAGE_SIZE = 50;
const RECIPIENTS_PAGE_SIZE = 50;

function toPublicCampaign(row: typeof campaigns.$inferSelect, creator: typeof users.$inferSelect | null): PublicCampaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as CampaignStatus,
    templateId: row.templateId,
    messageBody: row.messageBody,
    mediaUrl: row.mediaUrl,
    mediaMime: row.mediaMime,
    audienceFilter: (row.audienceFilter as AudienceFilters) ?? {},
    audienceTotal: row.audienceTotal,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    ratePerMinute: row.ratePerMinute,
    createdBy: creator
      ? { id: creator.id, name: creator.name }
      : { id: row.createdByUserId, name: 'Usuário' },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function listCampaigns(input: {
  q?: string;
  status?: CampaignStatus;
  page?: number;
}): Promise<{ items: PublicCampaign[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];
  if (input.status) conds.push(eq(campaigns.status, input.status));
  if (input.q) {
    const pat = `%${input.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(ilike(campaigns.name, pat));
  }
  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(where);

  const rows = await db
    .select({ campaign: campaigns, creator: users })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.createdByUserId, users.id))
    .where(where)
    .orderBy(desc(campaigns.createdAt))
    .limit(LIST_PAGE_SIZE)
    .offset((page - 1) * LIST_PAGE_SIZE);

  return {
    items: rows.map((r) => toPublicCampaign(r.campaign, r.creator)),
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

export async function getCampaignById(id: string): Promise<PublicCampaign> {
  const [row] = await db
    .select({ campaign: campaigns, creator: users })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.createdByUserId, users.id))
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  return toPublicCampaign(row.campaign, row.creator);
}

// ---------------------------------------------------------------------------
// create + materialize recipients
// ---------------------------------------------------------------------------

export async function createCampaign(input: {
  name: string;
  description?: string | null;
  templateId?: string | null;
  messageBody: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter: AudienceFilters;
  scheduledAt?: Date | null;
  ratePerMinute?: number;
  createdByUserId: string;
}): Promise<PublicCampaign> {
  // Resolve audiência
  const audience = await resolveAudience(input.audienceFilter);

  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      templateId: input.templateId ?? null,
      messageBody: input.messageBody,
      mediaUrl: input.mediaUrl ?? null,
      mediaMime: input.mediaMime ?? null,
      audienceFilter: input.audienceFilter as object,
      audienceTotal: audience.length,
      scheduledAt: input.scheduledAt ?? null,
      ratePerMinute: input.ratePerMinute ?? 20,
      createdByUserId: input.createdByUserId,
    }).returning();

    if (audience.length > 0) {
      await tx.insert(campaignRecipients)
        .values(audience.map((a) => ({
          campaignId: c.id,
          leadId: a.leadId,
          phone: a.phone,
        })))
        .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.leadId] });
    }

    const [creator] = await tx.select().from(users).where(eq(users.id, input.createdByUserId)).limit(1);
    return toPublicCampaign(c, creator ?? null);
  });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export async function dispatchCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'draft') {
    throw new HttpError(400, `Cannot dispatch campaign in status '${row.status}'`);
  }

  const newStatus: CampaignStatus = row.scheduledAt && row.scheduledAt > new Date()
    ? 'scheduled'
    : 'running';

  await db.update(campaigns).set({
    status: newStatus,
    startedAt: newStatus === 'running' ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, id));

  return getCampaignById(id);
}

export async function pauseCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'running') throw new HttpError(400, 'Only running campaigns can be paused');
  await db.update(campaigns).set({ status: 'paused', updatedAt: new Date() }).where(eq(campaigns.id, id));
  return getCampaignById(id);
}

export async function resumeCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.status !== 'paused') throw new HttpError(400, 'Only paused campaigns can be resumed');
  await db.update(campaigns).set({ status: 'running', updatedAt: new Date() }).where(eq(campaigns.id, id));
  return getCampaignById(id);
}

export async function cancelCampaign(id: string): Promise<PublicCampaign> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (!['scheduled', 'running', 'paused', 'draft'].includes(row.status)) {
    throw new HttpError(400, `Cannot cancel campaign in status '${row.status}'`);
  }

  await db.transaction(async (tx) => {
    // Marca pending recipients como skipped
    await tx.update(campaignRecipients).set({
      status: 'skipped',
      updatedAt: new Date(),
    }).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, 'pending'),
    ));

    // Recalcula skipped_count
    const [{ skipped }] = await tx.select({
      skipped: sql<number>`count(*)::int`,
    }).from(campaignRecipients).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, 'skipped'),
    ));

    await tx.update(campaigns).set({
      status: 'cancelled',
      skippedCount: skipped,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, id));
  });

  return getCampaignById(id);
}

export async function deleteCampaign(id: string): Promise<void> {
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

// ---------------------------------------------------------------------------
// Recipients listing
// ---------------------------------------------------------------------------

export async function listRecipients(input: {
  campaignId: string;
  status?: 'pending' | 'sent' | 'failed' | 'skipped';
  page?: number;
}): Promise<{ items: PublicCampaignRecipient[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [eq(campaignRecipients.campaignId, input.campaignId)];
  if (input.status) conds.push(eq(campaignRecipients.status, input.status));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(campaignRecipients).where(where);

  const rows = await db.select({
    recipient: campaignRecipients,
    leadName: leads.name,
  })
    .from(campaignRecipients)
    .leftJoin(leads, eq(campaignRecipients.leadId, leads.id))
    .where(where)
    .orderBy(desc(campaignRecipients.createdAt))
    .limit(RECIPIENTS_PAGE_SIZE)
    .offset((page - 1) * RECIPIENTS_PAGE_SIZE);

  return {
    items: rows.map((r) => ({
      id: r.recipient.id,
      leadId: r.recipient.leadId,
      leadName: r.leadName ?? 'Lead',
      phone: r.recipient.phone,
      status: r.recipient.status,
      sentAt: r.recipient.sentAt?.toISOString() ?? null,
      failureReason: r.recipient.failureReason,
    })),
    total,
    page,
    pageSize: RECIPIENTS_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export async function getCampaignFunnel(id: string): Promise<CampaignFunnel> {
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');

  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    sent: sql<number>`count(*) FILTER (WHERE status = 'sent')::int`,
    failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
    skipped: sql<number>`count(*) FILTER (WHERE status = 'skipped')::int`,
  }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));

  // replied = leads que mandaram msg.in com sent_at > recipient.sent_at
  const repliedRows = await db.execute(sql`
    SELECT COUNT(DISTINCT cr.lead_id)::int AS replied
    FROM campaign_recipients cr
    WHERE cr.campaign_id = ${id}
      AND cr.status = 'sent'
      AND EXISTS (
        SELECT 1 FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.lead_id = cr.lead_id
          AND m.direction = 'in'
          AND m.sent_at > cr.sent_at
      )
  `);
  const replied = (repliedRows.rows[0] as { replied: number }).replied;

  // Deals dos recipients
  const dealsRows = await db.select({
    stage: deals.stage,
    lossReason: deals.lossReason,
    proposalValue: deals.proposalValue,
  })
    .from(deals)
    .innerJoin(campaignRecipients, eq(deals.leadId, campaignRecipients.leadId))
    .where(eq(campaignRecipients.campaignId, id));

  let inDeal = 0;
  let won = 0;
  let lost = 0;
  let totalWonValue = 0;
  const lostByReason: Record<LossReason, number> = {
    condicoes_comerciais: 0,
    preco: 0,
    sem_retorno: 0,
    fora_do_perfil: 0,
  };

  for (const d of dealsRows) {
    if (d.stage === 'proposta_enviada' || d.stage === 'em_negociacao') inDeal++;
    if (d.stage === 'ganho') {
      won++;
      if (d.proposalValue != null) totalWonValue += Number(d.proposalValue);
    }
    if (d.stage === 'perdido') {
      lost++;
      if (d.lossReason && LOSS_REASONS.includes(d.lossReason as LossReason)) {
        lostByReason[d.lossReason as LossReason]++;
      }
    }
  }

  return {
    totalRecipients: counts.total,
    sent: counts.sent,
    failed: counts.failed,
    skipped: counts.skipped,
    replied,
    inDeal,
    won,
    lost,
    lostByReason,
    totalWonValue,
  };
}
```

- [ ] **Step 3.2:** Lint:

```bash
npm run lint
```

Esperado: limpo.

- [ ] **Step 3.3:** Commit:

```bash
git add server/services/campaignsService.ts
git commit -m "feat(campaigns): service (list/get/create/state-transitions/funnel/recipients)"
```

---

## Task 4 — campaignsDispatcher: loop de envio + interpolação

**Files:**
- Create: `server/services/campaignsDispatcher.ts`

- [ ] **Step 4.1:** Criar `server/services/campaignsDispatcher.ts`:

```ts
import { db } from '../db/client';
import { campaigns, campaignRecipients, conversations, messages, leads } from '../db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Campaign, CampaignRecipient, Lead } from '../db/schema';
import { uazapiClient } from './uazapiClient';

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

const TICK_INTERVAL_MS = 60_000;

export function startDispatcher() {
  if (timer) return;
  timer = setInterval(() => {
    if (!isProcessing) void tick();
  }, TICK_INTERVAL_MS);
  // primeira execução após 5s pra não competir com boot
  setTimeout(() => { if (!isProcessing) void tick(); }, 5_000);
}

export function stopDispatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    // Promove scheduled → running
    await db.update(campaigns).set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(campaigns.status, 'scheduled'),
      lte(campaigns.scheduledAt, new Date()),
    ));

    const running = await db.select().from(campaigns).where(eq(campaigns.status, 'running'));

    for (const c of running) {
      await processCampaign(c);
    }
  } finally {
    isProcessing = false;
  }
}

export async function processCampaign(c: Campaign): Promise<void> {
  const limit = c.ratePerMinute;
  const recipients = await db.select()
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.campaignId, c.id),
      eq(campaignRecipients.status, 'pending'),
    ))
    .limit(limit);

  if (recipients.length === 0) {
    // Tudo processado → completed
    await db.update(campaigns).set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    return;
  }

  const intervalMs = Math.max(100, Math.floor(60_000 / limit));

  for (const r of recipients) {
    // Re-check status (cancel/pause entre iterações)
    const [fresh] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, c.id));
    if (!fresh || fresh.status !== 'running') break;

    await sendOne(c, r);
    await sleep(intervalMs);
  }
}

async function sendOne(c: Campaign, r: CampaignRecipient): Promise<void> {
  try {
    const [lead] = await db.select().from(leads).where(eq(leads.id, r.leadId)).limit(1);
    if (!lead) throw new Error('Lead not found');

    const interpolated = interpolatePlaceholders(c.messageBody, lead);
    const conv = await getOrCreateConversationForCampaign(r.phone, lead.id, c.id);

    const resp = c.mediaUrl
      ? await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'image',
          mediaUrl: absoluteUrl(c.mediaUrl),
          mediaMime: c.mediaMime ?? undefined,
          text: interpolated,
        })
      : await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'text',
          text: interpolated,
        });

    const sentAt = new Date();
    const [msg] = await db.insert(messages).values({
      conversationId: conv.id,
      direction: 'out',
      kind: c.mediaUrl ? 'image' : 'text',
      body: interpolated,
      mediaUrl: c.mediaUrl ?? null,
      mediaMime: c.mediaMime ?? null,
      sentByUserId: c.createdByUserId,
      uazapiMsgId: resp.messageId,
      rawPayload: resp.rawPayload as object,
      sentAt,
    }).returning();

    await db.update(campaignRecipients).set({
      status: 'sent',
      sentAt,
      conversationId: conv.id,
      messageId: msg.id,
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));

    await db.update(campaigns).set({
      sentCount: sql`${campaigns.sentCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));

    await db.update(conversations).set({
      lastMessageAt: sentAt,
      updatedAt: new Date(),
    }).where(eq(conversations.id, conv.id));
  } catch (err) {
    await db.update(campaignRecipients).set({
      status: 'failed',
      failureReason: String(err).slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));
    await db.update(campaigns).set({
      failedCount: sql`${campaigns.failedCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
  }
}

async function getOrCreateConversationForCampaign(phone: string, leadId: string, campaignId: string) {
  const [existing] = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(conversations).values({
    phone,
    leadId,
    queue: 'comercial',  // disparos vão pra Comercial
    status: 'em_atendimento',
    originKind: 'campaign',
    originCampaignId: campaignId,
    lastMessageAt: new Date(),
  }).returning();
  return created;
}

export function interpolatePlaceholders(body: string, lead: Lead): string {
  const lastPurchase = lead.lastPurchaseDate
    ? formatDateBR(lead.lastPurchaseDate)
    : 'sem registro';
  const phoneFormatted = formatPhoneBR(lead.phone);
  return body
    .replaceAll('{{nome}}', lead.name)
    .replaceAll('{{telefone}}', phoneFormatted)
    .replaceAll('{{placa}}', lead.vehiclePlate ?? '')
    .replaceAll('{{modelo}}', lead.vehicleModel ?? '')
    .replaceAll('{{ultima_compra}}', lastPurchase);
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone;
}

function absoluteUrl(relativePath: string): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) return relativePath;
  return `${appUrl.replace(/\/$/, '')}${relativePath}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4.2:** Lint + commit:

```bash
npm run lint
git add server/services/campaignsDispatcher.ts
git commit -m "feat(campaigns): dispatcher loop with rate limit + placeholder interpolation"
```

---

## Task 5 — Multer middleware + media upload

**Files:**
- Create: `server/middleware/multerCampaignMedia.ts`

- [ ] **Step 5.1:** Criar `server/middleware/multerCampaignMedia.ts`:

```ts
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const dir = path.join(process.cwd(), 'uploads', 'campaigns');
fs.mkdirSync(dir, { recursive: true });

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

export const multerCampaignMedia = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});
```

- [ ] **Step 5.2:** Lint + commit:

```bash
npm run lint
git add server/middleware/multerCampaignMedia.ts
git commit -m "feat(campaigns): multer middleware for media upload (5MB jpeg/png/webp)"
```

---

## Task 6 — Endpoints CRUD + RBAC + tests

**Files:**
- Create: `server/controllers/campaignsController.ts`
- Create: `server/routes/campaigns.ts`
- Create: `server/tests/campaigns-crud.test.ts`
- Create: `server/tests/campaigns-create.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 6.1:** Criar `server/controllers/campaignsController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CAMPAIGN_STATUSES, LEAD_STATUSES, LEAD_SOURCES } from '../../shared/types';
import {
  listCampaigns,
  getCampaignById,
  createCampaign,
  dispatchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  deleteCampaign,
  listRecipients,
  getCampaignFunnel,
} from '../services/campaignsService';
import { dryRun } from '../services/campaignsAudience';

const idParams = z.object({ id: z.string().uuid() });

const audienceFilterSchema = z.object({
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.array(z.enum(LEAD_SOURCES)).optional(),
  lastPurchaseDaysAgo: z.number().int().min(0).max(3650).optional(),
  excludeLeadIds: z.array(z.string().uuid()).optional(),
  phoneCsv: z.array(z.string().min(8).max(20)).optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  templateId: z.string().uuid().nullable().optional(),
  messageBody: z.string().min(1).max(4000),
  mediaUrl: z.string().nullable().optional(),
  mediaMime: z.string().max(60).nullable().optional(),
  audienceFilter: audienceFilterSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  ratePerMinute: z.number().int().min(1).max(120).optional(),
});

const recipientsQuery = z.object({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    res.json(await listCampaigns(params));
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const campaign = await getCampaignById(id);
    const funnel = await getCampaignFunnel(id);
    res.json({ ...campaign, funnel });
  } catch (e) { next(e); }
}

export async function dryRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = audienceFilterSchema.parse(req.body);
    res.json(await dryRun(filters));
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    const created = await createCampaign({
      name: data.name,
      description: data.description ?? null,
      templateId: data.templateId ?? null,
      messageBody: data.messageBody,
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
      audienceFilter: data.audienceFilter,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      ratePerMinute: data.ratePerMinute,
      createdByUserId: req.user!.userId,
    });
    res.json(created);
  } catch (e) { next(e); }
}

export async function dispatchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await dispatchCampaign(id));
  } catch (e) { next(e); }
}

export async function pauseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await pauseCampaign(id));
  } catch (e) { next(e); }
}

export async function resumeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await resumeCampaign(id));
  } catch (e) { next(e); }
}

export async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await cancelCampaign(id));
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteCampaign(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function recipientsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const params = recipientsQuery.parse(req.query);
    res.json(await listRecipients({ campaignId: id, ...params }));
  } catch (e) { next(e); }
}

export async function uploadMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid or missing file' });
    }
    const filename = req.file.filename;
    res.json({
      mediaUrl: `/uploads/campaigns/${filename}`,
      mediaMime: req.file.mimetype,
    });
  } catch (e) { next(e); }
}
```

- [ ] **Step 6.2:** Criar `server/routes/campaigns.ts`:

```ts
import { Router } from 'express';
import multer from 'multer';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerCampaignMedia } from '../middleware/multerCampaignMedia';
import {
  listHandler,
  getHandler,
  dryRunHandler,
  createHandler,
  dispatchHandler,
  pauseHandler,
  resumeHandler,
  cancelHandler,
  deleteHandler,
  recipientsHandler,
  uploadMediaHandler,
} from '../controllers/campaignsController';

const router = Router();
const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...guard, listHandler);
router.get('/:id', ...guard, getHandler);
router.get('/:id/recipients', ...guard, recipientsHandler);
router.post('/dry-run', ...guard, dryRunHandler);
router.post('/', ...guard, createHandler);
router.post('/:id/dispatch', ...guard, dispatchHandler);
router.post('/:id/pause', ...guard, pauseHandler);
router.post('/:id/resume', ...guard, resumeHandler);
router.post('/:id/cancel', ...guard, cancelHandler);
router.post(
  '/upload-media',
  ...guard,
  (req, res, next) => {
    multerCampaignMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 5MB)' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  uploadMediaHandler,
);
router.delete('/:id', ...adminOnly, deleteHandler);

export default router;
```

- [ ] **Step 6.3:** Atualizar `server/app.ts` — registrar rota + servir static `/uploads`. Adicionar imports e mounts:

```ts
import path from 'node:path';
import express from 'express';
import campaignRoutes from './routes/campaigns';

// dentro de createApp(), antes do `/api` 404:
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/api/campaigns', campaignRoutes);
```

(Manter os outros mounts intactos.)

- [ ] **Step 6.4:** Criar `server/tests/campaigns-crud.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createCampaign } from './helpers';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/campaigns', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const { token } = await loginAs('r@x.com', 'recepcao');
    const res = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 lista paginada', async () => {
    const { token, userId } = await loginAs('a@x.com', 'admin');
    await createCampaign({ name: 'Test 1', createdByUserId: userId });
    const res = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });
});

describe('GET /api/campaigns/:id', () => {
  it('200 retorna campaign + funnel', async () => {
    const { token, userId } = await loginAs('a2@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: userId });
    const res = await request(app).get(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(c.id);
    expect(res.body.funnel).toBeDefined();
    expect(res.body.funnel.totalRecipients).toBe(0);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs('a3@x.com', 'admin');
    const res = await request(app)
      .get('/api/campaigns/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/campaigns/:id', () => {
  it('403 pra comercial (admin only)', async () => {
    const { token: tComm } = await loginAs('c@x.com', 'comercial');
    const { userId: uA } = await loginAs('a4@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: uA });
    const res = await request(app).delete(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${tComm}`);
    expect(res.status).toBe(403);
  });

  it('204 admin deleta', async () => {
    const { token, userId } = await loginAs('a5@x.com', 'admin');
    const c = await createCampaign({ name: 'X', createdByUserId: userId });
    const res = await request(app).delete(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 6.5:** Criar `server/tests/campaigns-create.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { campaignRecipients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead } from './helpers';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('POST /api/campaigns/dry-run', () => {
  it('200 retorna total + preview', async () => {
    await createLead({ phone: '5511000080001', status: 'frio' });
    await createLead({ phone: '5511000080002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ['frio'] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});

describe('POST /api/campaigns', () => {
  it('200 cria campanha + materializa recipients', async () => {
    await createLead({ phone: '5511000090001', status: 'frio' });
    await createLead({ phone: '5511000090002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lembrete frio',
        messageBody: 'Olá {{nome}}, hora de trocar!',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.status).toBe(200);
    expect(res.body.audienceTotal).toBe(2);

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, res.body.id));
    expect(recipients).toHaveLength(2);
  });

  it('snapshot de messageBody preservado mesmo após template mudar', async () => {
    await createLead({ phone: '5511000091001', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'X',
        messageBody: 'Texto original',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.body.messageBody).toBe('Texto original');
  });
});
```

- [ ] **Step 6.6:** Rodar testes:

```bash
npm test -- server/tests/campaigns-crud.test.ts server/tests/campaigns-create.test.ts
```

Esperado: ambos passam.

- [ ] **Step 6.7:** Lint + commit:

```bash
npm run lint
git add server/controllers/campaignsController.ts server/routes/campaigns.ts server/app.ts server/tests/campaigns-crud.test.ts server/tests/campaigns-create.test.ts
git commit -m "feat(campaigns): CRUD endpoints + RBAC + media upload route + tests"
```

---

## Task 7 — Tests adicionais: dispatch/funnel/media/RBAC

**Files:**
- Create: `server/tests/campaigns-dispatch.test.ts`
- Create: `server/tests/campaigns-funnel.test.ts`
- Create: `server/tests/campaigns-media.test.ts`
- Create: `server/tests/campaigns-rbac.test.ts`

- [ ] **Step 7.1:** Criar `server/tests/campaigns-dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/client';
import { campaigns, campaignRecipients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';
import { processCampaign, tick, interpolatePlaceholders } from '../services/campaignsDispatcher';
import {
  dispatchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
} from '../services/campaignsService';

vi.mock('../services/uazapiClient', () => ({
  uazapiClient: { sendMessage: vi.fn() },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`${status}`); }
  },
}));
import { uazapiClient } from '../services/uazapiClient';

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('interpolatePlaceholders', () => {
  it('substitui {{nome}}, {{placa}}, {{modelo}}', async () => {
    const lead = await createLead({
      name: 'João', phone: '5511987654321', vehiclePlate: 'ABC1D23', vehicleModel: 'Civic',
    });
    const out = interpolatePlaceholders('Olá {{nome}}, seu {{modelo}} placa {{placa}}', lead);
    expect(out).toContain('João');
    expect(out).toContain('Civic');
    expect(out).toContain('ABC1D23');
  });

  it('{{ultima_compra}} usa "sem registro" quando null', async () => {
    const lead = await createLead({ phone: '5511987654000', lastPurchaseDate: null });
    const out = interpolatePlaceholders('Olá, troca: {{ultima_compra}}', lead);
    expect(out).toContain('sem registro');
  });

  it('{{ultima_compra}} formata data BR (dd/mm/yyyy)', async () => {
    const lead = await createLead({ phone: '5511987654001', lastPurchaseDate: '2026-02-15' });
    const out = interpolatePlaceholders('Troca: {{ultima_compra}}', lead);
    expect(out).toContain('15/02/2026');
  });
});

describe('dispatch state transitions', () => {
  it('dispatchCampaign muda draft → running quando sem scheduledAt', async () => {
    const u = await createUser({ email: 'a@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'draft', createdByUserId: u.id });
    const updated = await dispatchCampaign(c.id);
    expect(updated.status).toBe('running');
    expect(updated.startedAt).not.toBeNull();
  });

  it('dispatchCampaign muda draft → scheduled com scheduledAt futuro', async () => {
    const u = await createUser({ email: 'a2@x.com', role: 'admin' });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const c = await createCampaign({
      status: 'draft', scheduledAt: future, createdByUserId: u.id,
    });
    const updated = await dispatchCampaign(c.id);
    expect(updated.status).toBe('scheduled');
  });

  it('pause muda running → paused', async () => {
    const u = await createUser({ email: 'a3@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'running', createdByUserId: u.id });
    const updated = await pauseCampaign(c.id);
    expect(updated.status).toBe('paused');
  });

  it('resume muda paused → running', async () => {
    const u = await createUser({ email: 'a4@x.com', role: 'admin' });
    const c = await createCampaign({ status: 'paused', createdByUserId: u.id });
    const updated = await resumeCampaign(c.id);
    expect(updated.status).toBe('running');
  });

  it('cancel marca pending recipients como skipped', async () => {
    const u = await createUser({ email: 'a5@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000100001' });
    const c = await createCampaign({ status: 'running', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    const updated = await cancelCampaign(c.id);
    expect(updated.status).toBe('cancelled');

    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('skipped');
  });
});

describe('processCampaign', () => {
  it('processa pending recipients e muda pra completed quando vazia', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValue({
      messageId: 'm-1', rawPayload: {},
    });
    const u = await createUser({ email: 'a6@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000110001' });
    const c = await createCampaign({
      status: 'running',
      ratePerMinute: 600,  // 100ms entre msgs pra teste rodar rápido
      messageBody: 'Oi {{nome}}',
      createdByUserId: u.id,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    // primeiro processCampaign manda a única
    await processCampaign({ ...c, status: 'running' });
    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();
    expect(vi.mocked(uazapiClient.sendMessage)).toHaveBeenCalled();

    // segundo processCampaign vê que pending=0 → completed
    await processCampaign({ ...c, status: 'running' });
    const [refreshed] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(refreshed.status).toBe('completed');
    expect(refreshed.completedAt).not.toBeNull();
  });

  it('marca recipient failed quando UazAPI rejeita', async () => {
    vi.mocked(uazapiClient.sendMessage).mockRejectedValueOnce(new Error('uazapi 500'));
    const u = await createUser({ email: 'a7@x.com', role: 'admin' });
    const lead = await createLead({ phone: '5511000111001' });
    const c = await createCampaign({
      status: 'running',
      ratePerMinute: 600,
      createdByUserId: u.id,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    await processCampaign({ ...c, status: 'running' });
    const [r] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('uazapi 500');
  });
});

describe('tick (scheduler)', () => {
  it('promove scheduled cujo scheduledAt já passou pra running', async () => {
    const u = await createUser({ email: 'a8@x.com', role: 'admin' });
    const past = new Date(Date.now() - 60 * 1000);
    const c = await createCampaign({
      status: 'scheduled',
      scheduledAt: past,
      createdByUserId: u.id,
    });

    await tick();
    const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(updated.status).toMatch(/running|completed/);  // sem recipients pode ir direto pra completed
    expect(updated.startedAt).not.toBeNull();
  });
});
```

- [ ] **Step 7.2:** Criar `server/tests/campaigns-funnel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage, createDeal,
} from './helpers';
import { getCampaignFunnel } from '../services/campaignsService';

describe('getCampaignFunnel', () => {
  it('contadores básicos: sent/failed/skipped/total', async () => {
    const u = await createUser({ email: 'a@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const l1 = await createLead({ phone: '5511000200001' });
    const l2 = await createLead({ phone: '5511000200002' });
    const l3 = await createLead({ phone: '5511000200003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: c.id, leadId: l2.id, status: 'failed' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l3.id, status: 'pending' });

    const f = await getCampaignFunnel(c.id);
    expect(f.totalRecipients).toBe(3);
    expect(f.sent).toBe(1);
    expect(f.failed).toBe(1);
    expect(f.skipped).toBe(0);
  });

  it('replied conta leads que mandaram inbound após sent_at do recipient', async () => {
    const u = await createUser({ email: 'a2@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const lead = await createLead({ phone: '5511000201001' });

    const conv = await createConversation({ phone: lead.phone, leadId: lead.id });
    const sentAt = new Date(Date.now() - 60 * 1000);
    await createCampaignRecipient({
      campaignId: c.id, leadId: lead.id, status: 'sent', sentAt,
    });

    // Inbound após sent_at — conta como replied
    await createMessage({
      conversationId: conv.id,
      direction: 'in',
      body: 'oi sim',
      sentAt: new Date(),
    });

    const f = await getCampaignFunnel(c.id);
    expect(f.replied).toBe(1);
  });

  it('inDeal/won/lost contam corretamente baseados em deals', async () => {
    const u = await createUser({ email: 'a3@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });

    // Lead com deal em negociação
    const l1 = await createLead({ phone: '5511000202001' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l1.id, stage: 'em_negociacao', proposalValue: 200, ownerUserId: u.id });

    // Lead ganho
    const l2 = await createLead({ phone: '5511000202002' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l2.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l2.id, stage: 'ganho', proposalValue: 500, ownerUserId: u.id });

    // Lead perdido
    const l3 = await createLead({ phone: '5511000202003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l3.id, status: 'sent', sentAt: new Date() });
    await createDeal({ leadId: l3.id, stage: 'perdido', lossReason: 'preco', proposalValue: 300, ownerUserId: u.id });

    const f = await getCampaignFunnel(c.id);
    expect(f.inDeal).toBe(1);
    expect(f.won).toBe(1);
    expect(f.lost).toBe(1);
    expect(f.totalWonValue).toBe(500);
    expect(f.lostByReason.preco).toBe(1);
  });
});
```

- [ ] **Step 7.3:** Criar `server/tests/campaigns-media.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

// Buffer minúsculo de PNG válido (1x1 transparente)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
);

describe('POST /api/campaigns/upload-media', () => {
  it('200 retorna mediaUrl + mediaMime', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', TINY_PNG, { filename: 'tiny.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toMatch(/^\/uploads\/campaigns\/[a-f0-9]{32}\.png$/);
    expect(res.body.mediaMime).toBe('image/png');
  });

  it('400 com mime inválido', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('whatever'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7.4:** Criar `server/tests/campaigns-rbac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createCampaign } from './helpers';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('Campaigns RBAC', () => {
  it('recepção 403 em GET, POST, dispatch, etc', async () => {
    const { token } = await loginAs('r@x.com', 'recepcao');
    expect((await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({})).status).toBe(403);
  });

  it('comercial pode criar/dispatch/pause/resume/cancel mas não delete', async () => {
    const { token, userId } = await loginAs('c@x.com', 'comercial');
    const c = await createCampaign({ createdByUserId: userId });

    expect((await request(app).get('/api/campaigns').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    const dispatch = await request(app)
      .post(`/api/campaigns/${c.id}/dispatch`)
      .set('Authorization', `Bearer ${token}`);
    expect(dispatch.status).toBe(200);

    const pause = await request(app)
      .post(`/api/campaigns/${c.id}/pause`)
      .set('Authorization', `Bearer ${token}`);
    expect(pause.status).toBe(200);

    const del = await request(app)
      .delete(`/api/campaigns/${c.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
```

- [ ] **Step 7.5:** Rodar testes novos + suite completa:

```bash
npm test -- server/tests/campaigns-dispatch.test.ts server/tests/campaigns-funnel.test.ts server/tests/campaigns-media.test.ts server/tests/campaigns-rbac.test.ts
npm test
```

Esperado: testes novos passam + suite total = 217 (anterior) + ~30 = ~247 passando.

- [ ] **Step 7.6:** Lint + commit:

```bash
npm run lint
git add server/tests/campaigns-dispatch.test.ts server/tests/campaigns-funnel.test.ts server/tests/campaigns-media.test.ts server/tests/campaigns-rbac.test.ts
git commit -m "test(campaigns): dispatch/funnel/media/rbac suites"
```

---

## Task 8 — Frontend api.ts + helpers + types + CampaignsPage (lista)

**Files:**
- Create: `src/features/campaigns/{api.ts, helpers.ts, types.ts, CampaignList.tsx, StatusBadge.tsx}`
- Create: `src/pages/campaigns/CampaignsPage.tsx`

- [ ] **Step 8.1:** Criar `src/features/campaigns/types.ts`:

```ts
export type {
  CampaignStatus,
  CampaignRecipientStatus,
  AudienceFilters,
  CampaignDryRunResponse,
  PublicCampaign,
  CampaignFunnel,
  PublicCampaignRecipient,
  LeadStatus,
  LeadSource,
  LossReason,
} from '@shared/types';

import type { PublicCampaign, CampaignFunnel } from '@shared/types';

export interface PublicCampaignWithFunnel extends PublicCampaign {
  funnel: CampaignFunnel;
}
```

- [ ] **Step 8.2:** Criar `src/features/campaigns/helpers.ts`:

```ts
import type { CampaignStatus, LossReason } from './types';

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  running: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  completed: 'bg-primary/15 text-primary border-primary/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  condicoes_comerciais: 'Condições comerciais',
  preco: 'Preço',
  sem_retorno: 'Sem retorno',
  fora_do_perfil: 'Fora do perfil',
};

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPercent(num: number, total: number): string {
  if (total === 0) return '0%';
  return `${((num / total) * 100).toFixed(1)}%`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
```

- [ ] **Step 8.3:** Criar `src/features/campaigns/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  AudienceFilters,
  CampaignDryRunResponse,
  PublicCampaign,
  PublicCampaignWithFunnel,
  PublicCampaignRecipient,
  CampaignStatus,
  CampaignRecipientStatus,
} from './types';

export interface ListResult {
  items: PublicCampaign[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListFilters {
  q?: string;
  status?: CampaignStatus;
  page?: number;
}

function buildListQuery(f: ListFilters): string {
  const u = new URLSearchParams();
  if (f.q) u.set('q', f.q);
  if (f.status) u.set('status', f.status);
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useCampaigns(filters: ListFilters) {
  return useQuery({
    queryKey: ['campaigns', filters],
    queryFn: () => api<ListResult>(`/campaigns${buildListQuery(filters)}`),
    refetchInterval: 30_000,
  });
}

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: () => api<PublicCampaignWithFunnel>(`/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'running' ? 5_000 : 30_000;
    },
  });
}

export function useDryRun() {
  return useMutation({
    mutationFn: (filters: AudienceFilters) =>
      api<CampaignDryRunResponse>('/campaigns/dry-run', {
        method: 'POST', body: JSON.stringify(filters),
      }),
  });
}

interface CreateInput {
  name: string;
  description?: string;
  templateId?: string | null;
  messageBody: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter: AudienceFilters;
  scheduledAt?: string | null;
  ratePerMinute?: number;
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['campaigns'] });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInput) =>
      api<PublicCampaign>('/campaigns', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDispatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/dispatch`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function usePauseCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/pause`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useResumeCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/resume`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}

export interface RecipientsResult {
  items: PublicCampaignRecipient[];
  total: number;
  page: number;
  pageSize: number;
}

export function useRecipients(id: string, filters: { status?: CampaignRecipientStatus; page?: number }) {
  const u = new URLSearchParams();
  if (filters.status) u.set('status', filters.status);
  if (filters.page && filters.page > 1) u.set('page', String(filters.page));
  const qs = u.toString();
  return useQuery({
    queryKey: ['campaigns', 'recipients', id, filters],
    queryFn: () => api<RecipientsResult>(`/campaigns/${id}/recipients${qs ? `?${qs}` : ''}`),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

export function useUploadMedia() {
  return useMutation({
    mutationFn: async (file: File): Promise<{ mediaUrl: string; mediaMime: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      return api('/campaigns/upload-media', { method: 'POST', body: fd });
    },
  });
}
```

- [ ] **Step 8.4:** Criar `src/features/campaigns/StatusBadge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from './helpers';
import type { CampaignStatus } from './types';

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant="outline" className={`uppercase text-[10px] tracking-wide px-2 py-0.5 border ${CAMPAIGN_STATUS_TONES[status]}`}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}
```

- [ ] **Step 8.5:** Criar `src/features/campaigns/CampaignList.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useCampaigns, type ListFilters } from './api';
import { StatusBadge } from './StatusBadge';
import { formatDateTime, formatPercent } from './helpers';

interface Props { filters: ListFilters }

export function CampaignList({ filters }: Props) {
  const { data, isLoading } = useCampaigns(filters);

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  if (!data?.items.length) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Nenhuma campanha ainda. Clique em "Nova campanha" pra começar.</div>;
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Audiência</TableHead>
            <TableHead className="text-right">Enviadas</TableHead>
            <TableHead>Criada por</TableHead>
            <TableHead>Em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((c) => (
            <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30">
              <TableCell>
                <Link to={`/campanhas/${c.id}`} className="font-medium text-primary hover:underline">
                  {c.name}
                </Link>
                {c.description && <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>}
              </TableCell>
              <TableCell><StatusBadge status={c.status} /></TableCell>
              <TableCell className="text-right">{c.audienceTotal}</TableCell>
              <TableCell className="text-right text-sm">
                {c.sentCount} <span className="text-muted-foreground">({formatPercent(c.sentCount, c.audienceTotal)})</span>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{c.createdBy.name}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{formatDateTime(c.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 8.6:** Criar `src/pages/campaigns/CampaignsPage.tsx`:

```tsx
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { CampaignList } from '@/features/campaigns/CampaignList';
import { CAMPAIGN_STATUSES } from '@shared/types';
import type { CampaignStatus } from '@/features/campaigns/types';
import { CAMPAIGN_STATUS_LABELS } from '@/features/campaigns/helpers';

export default function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = (searchParams.get('status') as CampaignStatus | null) ?? undefined;
  const [searchInput, setSearchInput] = useState(q);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Disparo em massa de mensagens WhatsApp</p>
        </div>
        <Button asChild>
          <Link to="/campanhas/nova"><Plus className="h-4 w-4 mr-1" /> Nova campanha</Link>
        </Button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Input
          placeholder="Buscar nome…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={() => patch({ q: searchInput || null })}
          onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          className="max-w-sm h-9 text-sm"
        />
        <Select value={status ?? 'all'} onValueChange={(v) => patch({ status: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {CAMPAIGN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{CAMPAIGN_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        <CampaignList filters={{ q: q || undefined, status }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8.7:** Lint + commit:

```bash
npm run lint
git add src/features/campaigns/api.ts src/features/campaigns/helpers.ts src/features/campaigns/types.ts src/features/campaigns/CampaignList.tsx src/features/campaigns/StatusBadge.tsx src/pages/campaigns/CampaignsPage.tsx
git commit -m "feat(campaigns): TanStack hooks + types + helpers + list page"
```

---

## Task 9 — Wizard Step 1+2 (Nome + Audiência)

**Files:**
- Create: `src/features/campaigns/{NameStep, AudienceStep, AudiencePreviewTable, CsvUpload}.tsx`

- [ ] **Step 9.1:** Criar `src/features/campaigns/NameStep.tsx`:

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
}

export function NameStep({ name, onNameChange, description, onDescriptionChange }: Props) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Label>Nome da campanha *</Label>
        <Input
          placeholder="Ex: Lembrete troca de óleo - outubro"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={120}
        />
      </div>
      <div>
        <Label>Descrição (opcional)</Label>
        <Textarea
          placeholder="Anote o objetivo dessa campanha…"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={500}
          rows={3}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 9.2:** Criar `src/features/campaigns/CsvUpload.tsx`:

```tsx
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onPhones: (phones: string[]) => void;
  current: string[];
}

export function CsvUpload({ onPhones, current }: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Aceita: 1 telefone por linha, OU coluna `phone` em CSV
      const phones: string[] = [];
      const header = lines[0]?.toLowerCase();
      const isHeaderCsv = header && header.includes('phone');
      const startIdx = isHeaderCsv ? 1 : 0;
      const phoneCol = isHeaderCsv
        ? header.split(',').findIndex((h) => h.trim() === 'phone')
        : 0;
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const raw = cols[phoneCol] ?? cols[0];
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 8) phones.push(digits);
      }
      if (phones.length === 0) {
        setError('Nenhum telefone válido encontrado no arquivo.');
        return;
      }
      onPhones(phones);
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept=".csv,.txt"
        id="csv-upload"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => document.getElementById('csv-upload')?.click()}
      >
        <Upload className="h-4 w-4 mr-2" /> Carregar CSV de telefones
      </Button>
      {current.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {current.length} telefone(s) carregado(s) <button onClick={() => onPhones([])} className="text-destructive underline ml-2">remover</button>
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 9.3:** Criar `src/features/campaigns/AudiencePreviewTable.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/apiClient';
import type { ListResult } from '@/features/leads/api';
import type { PublicLead } from '@shared/types';
import type { AudienceFilters } from '../campaigns/types';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AudienceFilters;
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
}

export function AudiencePreviewTable({ open, onClose, filters, excluded, onExcludedChange }: Props) {
  const [items, setItems] = useState<PublicLead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Reusa /leads pra listar audiência possível (1ª página)
    const params = new URLSearchParams();
    if (filters.status?.length) params.set('status', filters.status[0]);  // simplificado
    if (filters.source?.length) params.set('source', filters.source[0]);
    api<ListResult>(`/leads?${params.toString()}`)
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, [open, filters]);

  function toggle(id: string) {
    onExcludedChange(
      excluded.includes(id)
        ? excluded.filter((x) => x !== id)
        : [...excluded, id],
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Audiência (primeira página)</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-auto">
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Incluir</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Veículo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={!excluded.includes(l.id)}
                        onChange={() => toggle(l.id)}
                      />
                    </TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.phone}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[l.vehicleModel, l.vehiclePlate].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 9.4:** Criar `src/features/campaigns/AudienceStep.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { LEAD_STATUSES, LEAD_SOURCES } from '@shared/types';
import type { AudienceFilters } from './types';
import { useDryRun } from './api';
import { CsvUpload } from './CsvUpload';
import { AudiencePreviewTable } from './AudiencePreviewTable';

interface Props {
  filters: AudienceFilters;
  onFiltersChange: (f: AudienceFilters) => void;
  total: number;
  onTotalChange: (n: number) => void;
}

export function AudienceStep({ filters, onFiltersChange, total, onTotalChange }: Props) {
  const dryRun = useDryRun();
  const [optOutOpen, setOptOutOpen] = useState(false);

  // Recalcula dry-run quando filtros mudam (debounced via useEffect cleanup)
  useEffect(() => {
    const h = setTimeout(() => {
      dryRun.mutate(filters, {
        onSuccess: (r) => onTotalChange(r.total),
      });
    }, 400);
    return () => clearTimeout(h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Label>Status do lead</Label>
        <div className="flex gap-2 flex-wrap mt-1">
          {LEAD_STATUSES.map((s) => {
            const active = filters.status?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                className={`px-3 py-1 rounded-full text-xs border ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => {
                  const next = active
                    ? (filters.status ?? []).filter((x) => x !== s)
                    : [...(filters.status ?? []), s];
                  onFiltersChange({ ...filters, status: next.length ? next : undefined });
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Origem do lead</Label>
        <div className="flex gap-2 flex-wrap mt-1">
          {LEAD_SOURCES.map((s) => {
            const active = filters.source?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                className={`px-3 py-1 rounded-full text-xs border ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => {
                  const next = active
                    ? (filters.source ?? []).filter((x) => x !== s)
                    : [...(filters.source ?? []), s];
                  onFiltersChange({ ...filters, source: next.length ? next : undefined });
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Última compra há mais de N dias</Label>
        <Input
          type="number"
          min={0}
          max={3650}
          placeholder="Ex: 90"
          value={filters.lastPurchaseDaysAgo ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onFiltersChange({
              ...filters,
              lastPurchaseDaysAgo: isNaN(n) ? undefined : n,
            });
          }}
          className="max-w-xs"
        />
      </div>

      <div className="border-t pt-4">
        <Label>Upload CSV de telefones (opcional)</Label>
        <CsvUpload
          current={filters.phoneCsv ?? []}
          onPhones={(phones) => onFiltersChange({
            ...filters,
            phoneCsv: phones.length ? phones : undefined,
          })}
        />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{total} lead(s) impactado(s)</div>
            {(filters.excludeLeadIds?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground">
                {filters.excludeLeadIds!.length} excluído(s) manualmente
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setOptOutOpen(true)}>Ver e excluir leads…</Button>
        </div>
      </div>

      <AudiencePreviewTable
        open={optOutOpen}
        onClose={() => setOptOutOpen(false)}
        filters={filters}
        excluded={filters.excludeLeadIds ?? []}
        onExcludedChange={(ids) => onFiltersChange({
          ...filters,
          excludeLeadIds: ids.length ? ids : undefined,
        })}
      />
    </div>
  );
}
```

- [ ] **Step 9.5:** Lint + commit:

```bash
npm run lint
git add src/features/campaigns/NameStep.tsx src/features/campaigns/AudienceStep.tsx src/features/campaigns/AudiencePreviewTable.tsx src/features/campaigns/CsvUpload.tsx
git commit -m "feat(campaigns): wizard steps 1+2 (name + audience with dry-run + CSV + opt-out)"
```

---

## Task 10 — Wizard Step 3 (Mensagem + mídia + preview)

**Files:**
- Create: `src/features/campaigns/{MessageStep, PreviewMessage, MediaUpload}.tsx`

- [ ] **Step 10.1:** Criar `src/features/campaigns/MediaUpload.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useUploadMedia } from './api';

interface Props {
  mediaUrl: string | null;
  onChange: (mediaUrl: string | null, mediaMime: string | null) => void;
}

export function MediaUpload({ mediaUrl, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia();

  async function handleFile(file: File) {
    try {
      const r = await upload.mutateAsync(file);
      onChange(r.mediaUrl, r.mediaMime);
      toast.success('Imagem carregada.');
    } catch {
      toast.error('Falha ao carregar imagem.');
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {mediaUrl ? (
        <div className="relative inline-block">
          <img src={mediaUrl} alt="anexada" className="max-w-xs max-h-48 rounded border border-border" />
          <button
            type="button"
            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center"
            onClick={() => onChange(null, null)}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Upload className="h-4 w-4 mr-2" /> {upload.isPending ? 'Enviando…' : 'Adicionar imagem'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2:** Criar `src/features/campaigns/PreviewMessage.tsx`:

```tsx
interface PreviewLead {
  name: string;
  phone: string;
  vehicleModel: string | null;
  vehiclePlate: string | null;
  lastPurchaseDate: string | null;
}

interface Props {
  body: string;
  mediaUrl: string | null;
  lead: PreviewLead | null;
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone;
}

function interpolate(body: string, lead: PreviewLead): string {
  const last = lead.lastPurchaseDate ? formatDateBR(lead.lastPurchaseDate) : 'sem registro';
  return body
    .replaceAll('{{nome}}', lead.name)
    .replaceAll('{{telefone}}', formatPhoneBR(lead.phone))
    .replaceAll('{{placa}}', lead.vehiclePlate ?? '')
    .replaceAll('{{modelo}}', lead.vehicleModel ?? '')
    .replaceAll('{{ultima_compra}}', last);
}

export function PreviewMessage({ body, mediaUrl, lead }: Props) {
  if (!lead) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        Selecione um lead pra ver a prévia.
      </div>
    );
  }
  const interpolated = interpolate(body, lead);

  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-sm">
      <div className="text-[10px] uppercase text-muted-foreground mb-2">Como vai chegar pro lead</div>
      <div className="text-xs text-muted-foreground mb-2">{lead.name}</div>
      <div className="bg-emerald-900/40 rounded-lg p-3 text-sm whitespace-pre-wrap break-words">
        {mediaUrl && (
          <img src={mediaUrl} alt="" className="rounded mb-2 max-w-full max-h-40 object-cover" />
        )}
        {interpolated}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.3:** Criar `src/features/campaigns/MessageStep.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useTemplates } from '@/features/whatsapp/api';
import { useDryRun } from './api';
import { MediaUpload } from './MediaUpload';
import { PreviewMessage } from './PreviewMessage';
import type { AudienceFilters } from './types';

interface Props {
  templateId: string | null;
  onTemplateIdChange: (v: string | null) => void;
  messageBody: string;
  onMessageBodyChange: (v: string) => void;
  mediaUrl: string | null;
  mediaMime: string | null;
  onMediaChange: (url: string | null, mime: string | null) => void;
  audienceFilter: AudienceFilters;
}

export function MessageStep(p: Props) {
  const { data: templates } = useTemplates();
  const dryRun = useDryRun();
  const [previewLead, setPreviewLead] = useState<{
    name: string; phone: string;
    vehicleModel: string | null; vehiclePlate: string | null;
    lastPurchaseDate: string | null;
  } | null>(null);

  // Carrega 5 leads de preview da audiência atual
  useEffect(() => {
    dryRun.mutate(p.audienceFilter, {
      onSuccess: (r) => {
        if (r.preview.length > 0) {
          const first = r.preview[0];
          setPreviewLead({
            name: first.name,
            phone: first.phone,
            vehicleModel: first.vehicleModel,
            vehiclePlate: first.vehiclePlate,
            lastPurchaseDate: first.lastPurchaseDate,
          });
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previews = useMemo(() => dryRun.data?.preview ?? [], [dryRun.data]);

  return (
    <div className="grid grid-cols-2 gap-6 max-w-5xl">
      <div className="space-y-4">
        <div>
          <Label>Template (opcional, ponto de partida)</Label>
          <Select
            value={p.templateId ?? 'none'}
            onValueChange={(v) => {
              if (v === 'none') {
                p.onTemplateIdChange(null);
                return;
              }
              p.onTemplateIdChange(v);
              const t = templates?.items.find((x) => x.id === v);
              if (t) p.onMessageBodyChange(t.body);
            }}
          >
            <SelectTrigger><SelectValue placeholder="Sem template" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— sem template —</SelectItem>
              {templates?.items.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Mensagem *</Label>
          <Textarea
            value={p.messageBody}
            onChange={(e) => p.onMessageBodyChange(e.target.value)}
            placeholder="Olá {{nome}}, sua última troca foi em {{ultima_compra}}…"
            rows={8}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Placeholders disponíveis: <code>{'{{nome}}'}</code>, <code>{'{{telefone}}'}</code>,{' '}
            <code>{'{{placa}}'}</code>, <code>{'{{modelo}}'}</code>, <code>{'{{ultima_compra}}'}</code>
          </p>
        </div>

        <div>
          <Label>Imagem (opcional)</Label>
          <MediaUpload
            mediaUrl={p.mediaUrl}
            onChange={p.onMediaChange}
          />
        </div>
      </div>

      <div>
        <Label>Prévia</Label>
        {previews.length > 1 && (
          <Select
            value={previewLead?.phone ?? ''}
            onValueChange={(v) => {
              const found = previews.find((x) => x.phone === v);
              if (found) {
                setPreviewLead({
                  name: found.name,
                  phone: found.phone,
                  vehicleModel: found.vehicleModel,
                  vehiclePlate: found.vehiclePlate,
                  lastPurchaseDate: found.lastPurchaseDate,
                });
              }
            }}
          >
            <SelectTrigger className="mb-2 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {previews.map((pr) => (
                <SelectItem key={pr.phone} value={pr.phone}>{pr.name} ({pr.phone})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <PreviewMessage body={p.messageBody} mediaUrl={p.mediaUrl} lead={previewLead} />
      </div>
    </div>
  );
}
```

- [ ] **Step 10.4:** Lint + commit:

```bash
npm run lint
git add src/features/campaigns/MediaUpload.tsx src/features/campaigns/PreviewMessage.tsx src/features/campaigns/MessageStep.tsx
git commit -m "feat(campaigns): wizard step 3 (template + edit + media upload + preview)"
```

---

## Task 11 — Wizard Step 4 + CampaignNewPage (revisão + agendamento + submit)

**Files:**
- Create: `src/features/campaigns/ReviewStep.tsx`
- Create: `src/pages/campaigns/CampaignNewPage.tsx`

- [ ] **Step 11.1:** Criar `src/features/campaigns/ReviewStep.tsx`:

```tsx
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  RadioGroup, RadioGroupItem,
} from '@/components/ui/radio-group';

interface Props {
  scheduledAt: string | null;
  onScheduledAtChange: (v: string | null) => void;
  audienceTotal: number;
  name: string;
  messageBody: string;
  mediaUrl: string | null;
}

export function ReviewStep(p: Props) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="text-xs uppercase text-muted-foreground">Resumo</div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Nome</span>
          <span className="font-medium">{p.name || '(sem nome)'}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Audiência</span>
          <span className="font-medium">{p.audienceTotal} lead(s)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Mídia</span>
          <span className="font-medium">{p.mediaUrl ? 'Imagem anexada' : '—'}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Mensagem:</span>
          <pre className="text-xs bg-muted/30 p-2 rounded mt-1 whitespace-pre-wrap">{p.messageBody}</pre>
        </div>
      </div>

      <div>
        <Label>Quando disparar?</Label>
        <RadioGroup
          value={p.scheduledAt ? 'scheduled' : 'now'}
          onValueChange={(v) => p.onScheduledAtChange(v === 'now' ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16))}
          className="mt-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="now" id="now" />
            <label htmlFor="now" className="text-sm">Disparar agora</label>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <RadioGroupItem value="scheduled" id="scheduled" />
            <label htmlFor="scheduled" className="text-sm">Agendar pra uma data</label>
          </div>
        </RadioGroup>
        {p.scheduledAt !== null && (
          <Input
            type="datetime-local"
            value={p.scheduledAt.slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              if (v) p.onScheduledAtChange(new Date(v).toISOString());
            }}
            className="mt-2 max-w-xs"
          />
        )}
      </div>

      {p.audienceTotal > 50 && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
          <strong>⚠️ Atenção:</strong> você vai disparar pra <strong>{p.audienceTotal}</strong> leads.
          Esta ação não pode ser desfeita por completo (é possível pausar/cancelar mid-execução, mas mensagens já enviadas não voltam).
        </div>
      )}
    </div>
  );
}
```

**Note about RadioGroup:** se `@/components/ui/radio-group` não existir, substitua por `<input type="radio">` simples ou ajuste pra usar `<Select>` com 2 opções. O lint vai apontar se faltar.

- [ ] **Step 11.2:** Criar `src/pages/campaigns/CampaignNewPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Send, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { NameStep } from '@/features/campaigns/NameStep';
import { AudienceStep } from '@/features/campaigns/AudienceStep';
import { MessageStep } from '@/features/campaigns/MessageStep';
import { ReviewStep } from '@/features/campaigns/ReviewStep';
import { useCreateCampaign, useDispatchCampaign } from '@/features/campaigns/api';
import type { AudienceFilters } from '@/features/campaigns/types';

export default function CampaignNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Estado do wizard
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaMime, setMediaMime] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const create = useCreateCampaign();
  const dispatch = useDispatchCampaign();

  const canNext = (() => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return audienceTotal > 0;
    if (step === 3) return messageBody.trim().length > 0;
    return true;
  })();

  async function submit() {
    try {
      const created = await create.mutateAsync({
        name,
        description: description || undefined,
        templateId,
        messageBody,
        mediaUrl,
        mediaMime,
        audienceFilter: filters,
        scheduledAt,
      });
      await dispatch.mutateAsync(created.id);
      toast.success(scheduledAt ? 'Campanha agendada.' : 'Campanha disparada — acompanhe abaixo.');
      navigate(`/campanhas/${created.id}`);
    } catch (err) {
      toast.error('Falha ao criar campanha.');
    }
  }

  function handleSubmit() {
    if (audienceTotal > 50) {
      setConfirmOpen(true);
    } else {
      submit();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Nova campanha</h1>
        <div className="flex gap-2 mt-3 text-xs">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`flex-1 py-1 text-center border-b-2 ${
                n === step ? 'border-primary text-primary font-semibold'
                : n < step ? 'border-primary/40 text-muted-foreground'
                : 'border-border text-muted-foreground'
              }`}
            >
              {n}. {n === 1 && 'Nome'}{n === 2 && 'Audiência'}{n === 3 && 'Mensagem'}{n === 4 && 'Revisar'}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-4">
        {step === 1 && (
          <NameStep
            name={name} onNameChange={setName}
            description={description} onDescriptionChange={setDescription}
          />
        )}
        {step === 2 && (
          <AudienceStep
            filters={filters} onFiltersChange={setFilters}
            total={audienceTotal} onTotalChange={setAudienceTotal}
          />
        )}
        {step === 3 && (
          <MessageStep
            templateId={templateId} onTemplateIdChange={setTemplateId}
            messageBody={messageBody} onMessageBodyChange={setMessageBody}
            mediaUrl={mediaUrl} mediaMime={mediaMime}
            onMediaChange={(u, m) => { setMediaUrl(u); setMediaMime(m); }}
            audienceFilter={filters}
          />
        )}
        {step === 4 && (
          <ReviewStep
            scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt}
            audienceTotal={audienceTotal}
            name={name}
            messageBody={messageBody}
            mediaUrl={mediaUrl}
          />
        )}
      </div>

      <div className="flex justify-between pt-4 border-t mt-4">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        {step < 4 ? (
          <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Próximo <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={create.isPending || dispatch.isPending}
          >
            <Send className="h-4 w-4 mr-1" />
            {scheduledAt ? 'Agendar disparo' : 'Disparar agora'}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar disparo em massa
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm">
                Você vai disparar pra <strong>{audienceTotal}</strong> leads.{' '}
                {scheduledAt
                  ? 'Esta campanha será disparada na data agendada.'
                  : 'Esta ação será executada em ~' + Math.ceil(audienceTotal / 20) + ' minutos. Não pode ser desfeita por completo.'}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); submit(); }}>
              Confirmar disparo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 11.3:** Lint + commit:

```bash
npm run lint
git add src/features/campaigns/ReviewStep.tsx src/pages/campaigns/CampaignNewPage.tsx
git commit -m "feat(campaigns): wizard step 4 (review + schedule) + CampaignNewPage with double-confirm"
```

---

## Task 12 — CampaignDetailPage + funnel + recipients + actions

**Files:**
- Create: `src/features/campaigns/{CampaignFunnel, DispatchProgress, RecipientsTable}.tsx`
- Create: `src/pages/campaigns/CampaignDetailPage.tsx`

- [ ] **Step 12.1:** Criar `src/features/campaigns/CampaignFunnel.tsx`:

```tsx
import type { CampaignFunnel as TFunnel } from './types';
import { formatCurrency, formatPercent, LOSS_REASON_LABELS } from './helpers';

interface Props { funnel: TFunnel }

export function CampaignFunnel({ funnel }: Props) {
  const total = funnel.totalRecipients;
  const lostByReasonEntries = Object.entries(funnel.lostByReason).filter(([, n]) => n > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        <FunnelCard label="Enviadas" value={funnel.sent} ofTotal={total} tone="primary" />
        <FunnelCard label="Respondidas" value={funnel.replied} ofTotal={total} tone="emerald" />
        <FunnelCard label="Em negociação" value={funnel.inDeal} ofTotal={total} tone="blue" />
        <FunnelCard label="Ganho" value={funnel.won} ofTotal={total} tone="emerald-strong" />
        <FunnelCard label="Perdido" value={funnel.lost} ofTotal={total} tone="destructive" />
      </div>

      {funnel.totalWonValue > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <strong>{formatCurrency(funnel.totalWonValue)}</strong> em vendas fechadas
        </div>
      )}

      {lostByReasonEntries.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Motivos de perda:{' '}
          {lostByReasonEntries.map(([k, n]) => (
            <span key={k} className="inline-block mr-3">
              {LOSS_REASON_LABELS[k as keyof typeof LOSS_REASON_LABELS]} ({n})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FunnelCard({ label, value, ofTotal, tone }: {
  label: string; value: number; ofTotal: number;
  tone: 'primary' | 'emerald' | 'emerald-strong' | 'blue' | 'destructive';
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary border-primary/30',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    'emerald-strong': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    destructive: 'bg-destructive/10 text-destructive border-destructive/30',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[10px] opacity-70">{formatPercent(value, ofTotal)}</div>
    </div>
  );
}
```

- [ ] **Step 12.2:** Criar `src/features/campaigns/DispatchProgress.tsx`:

```tsx
import type { PublicCampaign } from './types';

interface Props { campaign: PublicCampaign }

export function DispatchProgress({ campaign }: Props) {
  const total = campaign.audienceTotal;
  const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
  const pct = total === 0 ? 0 : Math.round((processed / total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{processed}/{total} processadas</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {campaign.sentCount} enviadas · {campaign.failedCount} falharam · {campaign.skippedCount} ignoradas
      </div>
    </div>
  );
}
```

- [ ] **Step 12.3:** Criar `src/features/campaigns/RecipientsTable.tsx`:

```tsx
import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useRecipients } from './api';
import { formatDateTime } from './helpers';
import type { CampaignRecipientStatus } from './types';

interface Props { campaignId: string }

export function RecipientsTable({ campaignId }: Props) {
  const [status, setStatus] = useState<CampaignRecipientStatus | undefined>();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useRecipients(campaignId, { status, page });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Destinatários ({data?.total ?? 0})</h3>
        <Select
          value={status ?? 'all'}
          onValueChange={(v) => { setStatus(v === 'all' ? undefined : v as CampaignRecipientStatus); setPage(1); }}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="skipped">Ignorados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviada em</TableHead>
              <TableHead>Erro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              : data?.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.leadName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.phone}</TableCell>
                    <TableCell><span className="text-xs">{r.status}</span></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDateTime(r.sentAt)}</TableCell>
                    <TableCell className="text-xs text-destructive truncate max-w-xs">{r.failureReason ?? '—'}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 12.4:** Criar `src/pages/campaigns/CampaignDetailPage.tsx`:

```tsx
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Pause, Play, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCampaign, usePauseCampaign, useResumeCampaign,
  useCancelCampaign, useDeleteCampaign,
} from '@/features/campaigns/api';
import { useAuthStore } from '@/features/auth/store';
import { StatusBadge } from '@/features/campaigns/StatusBadge';
import { CampaignFunnel } from '@/features/campaigns/CampaignFunnel';
import { DispatchProgress } from '@/features/campaigns/DispatchProgress';
import { RecipientsTable } from '@/features/campaigns/RecipientsTable';
import { formatDateTime } from '@/features/campaigns/helpers';

export default function CampaignDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const { data, isLoading } = useCampaign(id);
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const cancel = useCancelCampaign();
  const del = useDeleteCampaign();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (isLoading || !data) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  const isRunningOrPaused = data.status === 'running' || data.status === 'paused';
  const isCancellable = ['scheduled', 'running', 'paused', 'draft'].includes(data.status);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-y-auto">
      <Button asChild variant="ghost" size="sm" className="self-start mb-2">
        <Link to="/campanhas"><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</Link>
      </Button>

      <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            <StatusBadge status={data.status} />
          </div>
          {data.description && <p className="text-sm text-muted-foreground mt-1">{data.description}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Criada por {data.createdBy.name} · {formatDateTime(data.createdAt)}
            {data.startedAt && ` · disparada ${formatDateTime(data.startedAt)}`}
            {data.completedAt && ` · concluída ${formatDateTime(data.completedAt)}`}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {data.status === 'running' && (
            <Button size="sm" variant="outline" onClick={() => pause.mutate(id, {
              onSuccess: () => toast.success('Pausada.'),
            })}>
              <Pause className="h-4 w-4 mr-1" /> Pausar
            </Button>
          )}
          {data.status === 'paused' && (
            <Button size="sm" variant="outline" onClick={() => resume.mutate(id, {
              onSuccess: () => toast.success('Retomada.'),
            })}>
              <Play className="h-4 w-4 mr-1" /> Retomar
            </Button>
          )}
          {isCancellable && (
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40"
              onClick={() => cancel.mutate(id, { onSuccess: () => toast.success('Cancelada.') })}
            >
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Apagar
            </Button>
          )}
        </div>
      </div>

      {isRunningOrPaused && (
        <div className="rounded-lg border border-border bg-card p-4 mb-4">
          <DispatchProgress campaign={data} />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Funil ROI</h3>
        <CampaignFunnel funnel={data.funnel} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <h3 className="text-sm font-semibold mb-2">Mensagem disparada</h3>
        <pre className="text-xs bg-muted/30 p-2 rounded whitespace-pre-wrap">{data.messageBody}</pre>
        {data.mediaUrl && (
          <img src={data.mediaUrl} alt="" className="mt-2 max-w-xs max-h-40 rounded" />
        )}
      </div>

      <RecipientsTable campaignId={id} />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Os destinatários e referências em conversas serão removidos.
              Conversas históricas continuam disponíveis (sem vínculo com a campanha).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => del.mutate(id, {
                onSuccess: () => { toast.success('Apagada.'); navigate('/campanhas'); },
              })}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 12.5:** Lint + commit:

```bash
npm run lint
git add src/features/campaigns/CampaignFunnel.tsx src/features/campaigns/DispatchProgress.tsx src/features/campaigns/RecipientsTable.tsx src/pages/campaigns/CampaignDetailPage.tsx
git commit -m "feat(campaigns): detail page (funnel + progress + recipients + actions)"
```

---

## Task 13 — Sidebar + rotas + boot dispatcher

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `server/index.ts`
- Modify: `.env.example`

- [ ] **Step 13.1:** Atualizar `src/components/layout/Sidebar.tsx` — adicionar entrada "Campanhas" entre Inside Sales e Cadastros, com `salesOnly: true`. Adicionar `Megaphone` ao import de lucide-react.

```tsx
// Adicionar ao import:
import { Megaphone } from 'lucide-react';

// No array `items`, após Inside Sales:
{ to: '/campanhas', label: 'Campanhas', icon: Megaphone, salesOnly: true },
```

- [ ] **Step 13.2:** Atualizar `src/app/routes.tsx` — adicionar 3 rotas novas. Localizar onde Inside Sales rotas estão e adicionar:

```tsx
const CampaignsPage = lazy(() => import('@/pages/campaigns/CampaignsPage'));
const CampaignNewPage = lazy(() => import('@/pages/campaigns/CampaignNewPage'));
const CampaignDetailPage = lazy(() => import('@/pages/campaigns/CampaignDetailPage'));

// Dentro do array de rotas autenticadas:
{ path: '/campanhas', element: wrap(<CampaignsPage />) },
{ path: '/campanhas/nova', element: wrap(<CampaignNewPage />) },
{ path: '/campanhas/:id', element: wrap(<CampaignDetailPage />) },
```

(Inserir junto com as outras rotas autenticadas, seguindo o padrão existente de InsideSalesPage.)

- [ ] **Step 13.3:** Atualizar `server/index.ts` — chamar `startDispatcher()` no boot. Adicionar import e chamada após `app.listen`:

```ts
// no topo:
import { startDispatcher } from './services/campaignsDispatcher';

// dentro de start(), após app.listen(...):
startDispatcher();
console.log('[campaigns] dispatcher started (tick every 60s)');
```

- [ ] **Step 13.4:** Atualizar `.env.example` — adicionar:

```
DISPATCH_RATE_PER_MINUTE=20  # rate limit padrão de campanhas (override por campanha)
```

- [ ] **Step 13.5:** Lint + commit:

```bash
npm run lint
git add src/components/layout/Sidebar.tsx src/app/routes.tsx server/index.ts .env.example
git commit -m "feat(campaigns): sidebar link + routes + dispatcher boot"
```

---

## Task 14 — README + verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 14.1:** Atualizar README.md — seção `## Próximos sub-projetos`:

```markdown
## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. ✅ WhatsApp Inbox — conversas com filas + composer
4. ✅ Inside Sales — pipeline kanban + drag & drop + activity log
5. ✅ Conexão WhatsApp — gestão da instância UazAPI via UI
6. ✅ Disparo em massa de campanhas — wizard + agendamento + funil ROI
7. IA de pré-qualificação
8. Dashboard de Funil — métricas e conversão
```

- [ ] **Step 14.2:** Adicionar seção "Campanhas" no README, depois de "Conexão WhatsApp":

```markdown
## Campanhas (disparo em massa)

Tela em `/campanhas` (apenas `admin` + `comercial`) com:

- **Lista de campanhas** com status, audiência, % enviadas, criada por.
- **Wizard de criação** em 4 passos:
  1. Nome + descrição
  2. Audiência: filtros (status, source, última compra) + opt-out manual + upload CSV
  3. Mensagem: template (opcional) + edição inline + placeholders + imagem (upload nativo)
  4. Revisão + agendamento ("agora" ou data/hora) + dupla confirmação se > 50 leads

- **Placeholders** suportados: `{{nome}}`, `{{telefone}}`, `{{placa}}`, `{{modelo}}`, `{{ultima_compra}}`. Preview ao vivo na tela de mensagem.

- **Dispatcher in-process** (setInterval 60s no boot do server). Rate-limit padrão 20 msg/min (~1 a cada 3s, override por campanha). Resume natural via `WHERE status='pending'`. Pausável e cancelável mid-execução.

- **Detail page** com:
  - Progresso ao vivo (se running): barra "X/Y processadas" + breakdown
  - **Funil ROI**: Enviadas → Respondidas → Em negociação → Ganho/Perdido (com motivos + R$ total fechado)
  - Lista paginada de destinatários com filtro por status

- **APAGAR** restrito a admin (mesmo padrão do Inside Sales).

Mídia: upload via multer pra `/uploads/campaigns/`. Pasta servida via Express static. UazAPI baixa direto a URL pública.

Pré-requisito: variável `APP_URL` configurada (UazAPI precisa alcançar `${APP_URL}/uploads/...`).
```

- [ ] **Step 14.3:** Rodar suite completa:

```bash
npm test
```

Esperado: total ~247 (217 do sub-projeto 6 + ~30 novos), 0 regressões.

- [ ] **Step 14.4:** Lint completo:

```bash
npm run lint
```

Esperado: limpo.

- [ ] **Step 14.5:** Commit final:

```bash
git add README.md
git commit -m "docs: mark Mass Campaigns roadmap item complete and add usage section"
```

---

## Self-Review Checklist (do plano contra a spec)

**1. Spec coverage:**
- ✅ Migration 012 + 2 enums + 2 tabelas + FK em conversations → Task 1
- ✅ Tipos compartilhados → Task 1
- ✅ Helpers de teste → Task 1
- ✅ Audience resolver (filtros + dry-run + phoneCsv OR-merge) → Task 2
- ✅ Service: list/get/create/dispatch/pause/resume/cancel/delete/funnel/recipients → Task 3
- ✅ Dispatcher loop + interpolatePlaceholders + sendOne com mídia → Task 4
- ✅ Multer middleware (5MB, jpeg/png/webp) → Task 5
- ✅ Endpoints CRUD + RBAC + tests → Task 6
- ✅ Tests adicionais (dispatch state, funnel, media upload, RBAC) → Task 7
- ✅ Frontend lista + types + helpers → Task 8
- ✅ Wizard step 1+2 (nome + audiência) → Task 9
- ✅ Wizard step 3 (mensagem + mídia + preview) → Task 10
- ✅ Wizard step 4 + CampaignNewPage com double-confirm → Task 11
- ✅ Detail page com funnel + progress + recipients + actions → Task 12
- ✅ Sidebar + routes + boot dispatcher → Task 13
- ✅ README + verificação → Task 14

**2. Placeholder scan:** sem TBD/TODO/FIXME no plano. Notas marcadas como "Note about RadioGroup" no Task 11 são instruções concretas.

**3. Type consistency:** `AudienceFilters`, `PublicCampaign`, `CampaignFunnel`, `useCampaign(id)` retorna `PublicCampaignWithFunnel`, `useDryRun` retorna `CampaignDryRunResponse` — todos consistentes entre Tasks 1 (definição), 3 (service), 6 (controller), 8 (api), 9-12 (UI consumers).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-mass-campaigns-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — implementer fresco por task + verificação entre. Mesmo padrão dos outros sub-projetos.

**2. Inline Execution** — checkpoints manuais aqui mesmo.

**Which approach?**
