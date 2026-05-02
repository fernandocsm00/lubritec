# Inside Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar pipeline kanban em `/inside-sales` (4 etapas, drag & drop, drawer com activity log, histórico paginado) com auto-trigger via imagem em conversa Comercial do WhatsApp Inbox, conforme spec `docs/superpowers/specs/2026-05-02-inside-sales-design.md`.

**Architecture:** Backend Express com endpoints em `/api/deals/*` atrás de `authGuard` + `requireRole('admin', 'comercial')`. Service layer separa CRUD de integração (pipelineIntegration é chamado pelo `sendMessage` do WhatsApp). Activity log gerado pelo service em cada mutação. Frontend dark com `@dnd-kit` pra drag & drop entre 4 colunas. Migration 010 cria 2 tabelas (`deals`, `deal_activities`) + 3 enums.

**Tech Stack:** Express + Drizzle 0.45 + Zod 4 + Postgres 16; React 19 + Vite + TanStack Query 5 + shadcn/ui + react-hook-form + sonner + **@dnd-kit/core + @dnd-kit/sortable** (deps novas).

---

## File map

**Criar — backend:**
- `server/db/migrations/010_pipeline.sql`
- `server/services/dealsService.ts`
- `server/services/pipelineIntegration.ts`
- `server/controllers/dealsController.ts`
- `server/routes/deals.ts`
- `server/tests/deals-list.test.ts`
- `server/tests/deals-actions.test.ts`
- `server/tests/deals-history.test.ts`
- `server/tests/deals-rbac.test.ts`
- `server/tests/pipeline-integration.test.ts`
- `server/tests/whatsapp-pipeline-trigger.test.ts`

**Criar — frontend:**
- `src/features/inside-sales/api.ts`
- `src/features/inside-sales/helpers.ts`
- `src/features/inside-sales/types.ts`
- `src/features/inside-sales/KanbanBoard.tsx`
- `src/features/inside-sales/KanbanColumn.tsx`
- `src/features/inside-sales/DealCard.tsx`
- `src/features/inside-sales/DealDrawer.tsx`
- `src/features/inside-sales/ActivityLog.tsx`
- `src/features/inside-sales/LossReasonDialog.tsx`
- `src/features/inside-sales/GanhoValueDialog.tsx`
- `src/features/inside-sales/ValueInput.tsx`
- `src/features/inside-sales/AddDealDialog.tsx`
- `src/features/inside-sales/HistoryTable.tsx`
- `src/pages/inside-sales/HistoryPage.tsx`

**Modificar:**
- `shared/types.ts` — adicionar `DEAL_STAGES`, `LOSS_REASONS`, `DEAL_ACTIVITY_KINDS`, `PublicDeal`, `PublicDealActivity`, `BoardResponse`
- `server/db/schema.ts` — adicionar `deals`, `dealActivities`
- `server/app.ts` — registrar `dealsRoutes`
- `server/tests/setup.ts` — incluir `deal_activities, deals` no TRUNCATE
- `server/tests/helpers.ts` — adicionar `createDeal`, `createDealActivity`
- `server/services/conversationsService.ts` — chamar `pipelineIntegration` no fim do `sendMessage`
- `server/services/leadsService.ts` — join opcional com `deals` no list (pra filtro "No pipeline")
- `server/controllers/leadsController.ts` — aceitar query param `pipeline`
- `src/pages/inside-sales/InsideSalesPage.tsx` — substituir placeholder por tabs Pipeline/Histórico
- `src/components/layout/Sidebar.tsx` — restringir link `/inside-sales` a `admin` + `comercial`
- `src/features/whatsapp/LeadSidebar.tsx` — adicionar seção "Pipeline"
- `src/features/leads/api.ts` — aceitar filtro `pipeline`
- `src/features/leads/LeadFilters.tsx` — adicionar select "Pipeline"
- `src/features/leads/LeadsTable.tsx` — coluna "Pipeline" com chip
- `package.json` — adicionar `@dnd-kit/core` e `@dnd-kit/sortable`
- `README.md` — marcar item 4 do roadmap, adicionar seção "Inside Sales"

---

## Task 1 — Migration 010 + schema + tipos compartilhados + dnd-kit

**Files:**
- Create: `server/db/migrations/010_pipeline.sql`
- Modify: `shared/types.ts`
- Modify: `server/db/schema.ts`
- Modify: `server/tests/setup.ts`
- Modify: `package.json` (via npm install)

- [ ] **Step 1.1:** Instalar dependências do dnd-kit.

```bash
npm install @dnd-kit/core @dnd-kit/sortable
```

Esperado: versões mais recentes (≥ 6.x) instaladas. Confirmar em `package.json` que ambas aparecem em `dependencies`.

- [ ] **Step 1.2:** Criar `server/db/migrations/010_pipeline.sql`:

```sql
-- Enums
CREATE TYPE deal_stage AS ENUM (
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido'
);
CREATE TYPE loss_reason AS ENUM (
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil'
);
CREATE TYPE deal_activity_kind AS ENUM (
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed'
);

-- Deals
CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE RESTRICT,
  stage           deal_stage NOT NULL DEFAULT 'proposta_enviada',
  proposal_value  numeric(12,2),
  loss_reason     loss_reason,
  notes           text,
  owner_user_id   uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_stage_updated ON deals(stage, updated_at DESC);
CREATE INDEX idx_deals_owner ON deals(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_deals_closed_at ON deals(closed_at) WHERE closed_at IS NOT NULL;

-- Activity log
CREATE TABLE deal_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind           deal_activity_kind NOT NULL,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dealact_deal_created ON deal_activities(deal_id, created_at DESC);
```

- [ ] **Step 1.3:** Aplicar migration nos dois schemas.

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Esperado: `→ 010_pipeline.sql (applied)` em ambos.

- [ ] **Step 1.4:** Adicionar constantes e tipos no fim de `shared/types.ts`:

```ts
// ---------------------------------------------------------------------------
// Inside Sales (sub-projeto 5)
// ---------------------------------------------------------------------------

export const DEAL_STAGES = [
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const LOSS_REASONS = [
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const DEAL_ACTIVITY_KINDS = [
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed',
] as const;
export type DealActivityKind = (typeof DEAL_ACTIVITY_KINDS)[number];

export interface PublicDeal {
  id: string;
  lead: {
    id: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    status: LeadStatus;
  };
  stage: DealStage;
  proposalValue: number | null;
  lossReason: LossReason | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  closedAt: string | null;
  isStale: boolean;
  enteredCurrentStageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDealActivity {
  id: string;
  dealId: string;
  kind: DealActivityKind;
  actor: { id: string; name: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DealStageTotal {
  count: number;
  valueSum: number;
}

export interface BoardResponse {
  stages: Record<DealStage, PublicDeal[]>;
  totals: Record<DealStage, DealStageTotal>;
}
```

- [ ] **Step 1.5:** Atualizar `server/db/schema.ts`. Adicionar imports no topo (junto com os existentes):

```ts
import {
  DEAL_STAGES,
  LOSS_REASONS,
  DEAL_ACTIVITY_KINDS,
} from '../../shared/types';
```

Acrescentar `numeric` no import de `drizzle-orm/pg-core` (somar à lista existente).

Adicionar **no fim do arquivo**, antes da seção de `export type ...`:

```ts
export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().unique().references(() => leads.id, { onDelete: 'restrict' }),
  stage: text('stage', { enum: DEAL_STAGES }).notNull().default('proposta_enviada'),
  proposalValue: numeric('proposal_value', { precision: 12, scale: 2 }),
  lossReason: text('loss_reason', { enum: LOSS_REASONS }),
  notes: text('notes'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dealActivities = pgTable('deal_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: DEAL_ACTIVITY_KINDS }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

E adicionar os type exports no fim:

```ts
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DealActivity = typeof dealActivities.$inferSelect;
export type NewDealActivity = typeof dealActivities.$inferInsert;
```

- [ ] **Step 1.6:** Atualizar `server/tests/setup.ts` — incluir as 2 tabelas novas no início do TRUNCATE (ordem importa: filhas antes das pais):

Localizar:
```ts
'TRUNCATE message_templates, messages, conversations, leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE'
```

Substituir por:
```ts
'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE'
```

- [ ] **Step 1.7:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 1.8:** Commit.

```bash
git add server/db/migrations/010_pipeline.sql shared/types.ts server/db/schema.ts server/tests/setup.ts package.json package-lock.json
git commit -m "feat(deals): migration 010 + schema + shared types + dnd-kit deps"
```

---

## Task 2 — Test helpers

**Files:**
- Modify: `server/tests/helpers.ts`

- [ ] **Step 2.1:** Adicionar imports e helpers no fim de `server/tests/helpers.ts`. **Não remover** o que já existe; adicionar:

```ts
import { deals, dealActivities } from '../db/schema';
import type {
  DealStage,
  DealActivityKind,
  LossReason,
} from '@shared/types';

export async function createDeal(opts: {
  leadId: string;
  stage?: DealStage;
  proposalValue?: number | null;
  lossReason?: LossReason | null;
  notes?: string | null;
  ownerUserId?: string | null;
  closedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const [d] = await db
    .insert(deals)
    .values({
      leadId: opts.leadId,
      stage: opts.stage ?? 'proposta_enviada',
      // numeric must be passed as string by drizzle-orm
      proposalValue: opts.proposalValue == null ? null : String(opts.proposalValue),
      lossReason: opts.lossReason ?? null,
      notes: opts.notes ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      closedAt: opts.closedAt ?? null,
      createdAt: opts.createdAt ?? new Date(),
      updatedAt: opts.updatedAt ?? new Date(),
    })
    .returning();
  return d;
}

export async function createDealActivity(opts: {
  dealId: string;
  kind?: DealActivityKind;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  const [a] = await db
    .insert(dealActivities)
    .values({
      dealId: opts.dealId,
      kind: opts.kind ?? 'created',
      actorUserId: opts.actorUserId ?? null,
      metadata: opts.metadata ?? {},
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning();
  return a;
}
```

- [ ] **Step 2.2:** Verificar lint.

```bash
npm run lint
```

- [ ] **Step 2.3:** Commit.

```bash
git add server/tests/helpers.ts
git commit -m "test(deals): add createDeal/createDealActivity helpers"
```

---

## Task 3 — dealsService: queries (list board, list history, getById)

**Files:**
- Create: `server/services/dealsService.ts`

- [ ] **Step 3.1:** Criar `server/services/dealsService.ts`:

```ts
import { db } from '../db/client';
import { deals, dealActivities, leads, users } from '../db/schema';
import {
  eq, and, or, ilike, desc, sql, inArray, gte, lte,
  type SQL,
} from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicDeal,
  PublicDealActivity,
  BoardResponse,
  DealStage,
  DealStageTotal,
  LossReason,
} from '@shared/types';
import { DEAL_STAGES } from '@shared/types';

const HISTORY_PAGE_SIZE = 50;
const STALE_DAYS = 3;
const KANBAN_TERMINAL_VISIBLE_DAYS = 7;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

interface RawDealRow {
  deal: typeof deals.$inferSelect;
  lead: typeof leads.$inferSelect | null;
  owner: typeof users.$inferSelect | null;
  enteredCurrentStageAt: Date;
  isStale: boolean;
}

function toPublic(row: RawDealRow): PublicDeal {
  const lead = row.lead!;
  return {
    id: row.deal.id,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      vehicleModel: lead.vehicleModel,
      vehiclePlate: lead.vehiclePlate,
      status: lead.status,
    },
    stage: row.deal.stage,
    proposalValue: row.deal.proposalValue == null ? null : Number(row.deal.proposalValue),
    lossReason: row.deal.lossReason,
    notes: row.deal.notes,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    closedAt: row.deal.closedAt?.toISOString() ?? null,
    isStale: row.isStale,
    enteredCurrentStageAt: row.enteredCurrentStageAt.toISOString(),
    createdAt: row.deal.createdAt.toISOString(),
    updatedAt: row.deal.updatedAt.toISOString(),
  };
}

// SQL fragment that resolves to the timestamp the deal entered its current
// stage. Falls back to created_at if no stage_changed/reactivated activity.
const enteredStageSql = sql<Date>`COALESCE(
  (
    SELECT MAX(da.created_at) FROM deal_activities da
    WHERE da.deal_id = ${deals.id}
      AND da.kind IN ('stage_changed', 'reactivated', 'created')
  ),
  ${deals.createdAt}
)`;

// SQL fragment computing isStale: true if no non-note activity in current
// stage for > STALE_DAYS days (and stage is active).
const isStaleSql = sql<boolean>`(
  ${deals.stage} IN ('proposta_enviada', 'em_negociacao')
  AND COALESCE(
    (
      SELECT MAX(da.created_at) FROM deal_activities da
      WHERE da.deal_id = ${deals.id}
        AND da.kind != 'note_added'
        AND da.created_at >= COALESCE(
          (
            SELECT MAX(da2.created_at) FROM deal_activities da2
            WHERE da2.deal_id = ${deals.id}
              AND da2.kind IN ('stage_changed', 'reactivated', 'created')
          ),
          ${deals.createdAt}
        )
    ),
    ${deals.createdAt}
  ) < now() - interval '${sql.raw(String(STALE_DAYS))} days'
)`;

// ---------------------------------------------------------------------------
// listBoard — kanban
// ---------------------------------------------------------------------------

export async function listBoard(input: {
  ownerFilter: 'mine' | 'all';
  q?: string;
  currentUserId: string;
}): Promise<BoardResponse> {
  const conds: SQL[] = [];

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  }

  // Show: active stages OR (terminal AND closed_at within last 7 days)
  conds.push(
    sql`(
      ${deals.stage} IN ('proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      )
    )`,
  );

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.vehiclePlate, pat));
    if (search) conds.push(search);
  }

  const where = and(...conds);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.updatedAt));

  const stages: BoardResponse['stages'] = {
    proposta_enviada: [],
    em_negociacao: [],
    ganho: [],
    perdido: [],
  };
  const totals: BoardResponse['totals'] = {
    proposta_enviada: { count: 0, valueSum: 0 },
    em_negociacao: { count: 0, valueSum: 0 },
    ganho: { count: 0, valueSum: 0 },
    perdido: { count: 0, valueSum: 0 },
  };

  for (const row of rows) {
    const pub = toPublic(row);
    stages[pub.stage].push(pub);
    totals[pub.stage].count += 1;
    totals[pub.stage].valueSum += pub.proposalValue ?? 0;
  }

  return { stages, totals };
}

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

export async function listHistory(input: {
  ownerFilter: 'mine' | 'all';
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: Date;
  to?: Date;
  page?: number;
  currentUserId: string;
}): Promise<{ items: PublicDeal[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];

  conds.push(
    sql`${deals.stage} IN ('ganho', 'perdido') AND ${deals.closedAt} <= now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'`,
  );

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  }
  if (input.stage) conds.push(eq(deals.stage, input.stage));
  if (input.lossReason) conds.push(eq(deals.lossReason, input.lossReason));
  if (input.from) conds.push(gte(deals.closedAt, input.from));
  if (input.to) conds.push(lte(deals.closedAt, input.to));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.vehiclePlate, pat));
    if (search) conds.push(search);
  }

  const where = and(...conds);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .where(where);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.closedAt))
    .limit(HISTORY_PAGE_SIZE)
    .offset((page - 1) * HISTORY_PAGE_SIZE);

  return {
    items: rows.map(toPublic),
    total,
    page,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// getDealById
// ---------------------------------------------------------------------------

export async function getDealById(id: string): Promise<PublicDeal & { activities: PublicDealActivity[] }> {
  const [row] = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(eq(deals.id, id))
    .limit(1);

  if (!row) throw new HttpError(404, 'Deal not found');

  const acts = await db
    .select({ activity: dealActivities, actor: users })
    .from(dealActivities)
    .leftJoin(users, eq(dealActivities.actorUserId, users.id))
    .where(eq(dealActivities.dealId, id))
    .orderBy(desc(dealActivities.createdAt));

  const activities: PublicDealActivity[] = acts.map((a) => ({
    id: a.activity.id,
    dealId: a.activity.dealId,
    kind: a.activity.kind,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    metadata: (a.activity.metadata as Record<string, unknown>) ?? {},
    createdAt: a.activity.createdAt.toISOString(),
  }));

  return { ...toPublic(row), activities };
}
```

- [ ] **Step 3.2:** Verificar lint.

```bash
npm run lint
```

- [ ] **Step 3.3:** Commit.

```bash
git add server/services/dealsService.ts
git commit -m "feat(deals): board/history/byId queries with stale + entered-stage SQL"
```

---

## Task 4 — dealsService: mutações (create, update, changeStage, delete, reactivate)

**Files:**
- Modify: `server/services/dealsService.ts`

- [ ] **Step 4.1:** Anexar no fim de `server/services/dealsService.ts`:

```ts
// ---------------------------------------------------------------------------
// Mutations (todas registram activity no log)
// ---------------------------------------------------------------------------

async function logActivity(tx: typeof db, opts: {
  dealId: string;
  kind: import('@shared/types').DealActivityKind;
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
}) {
  await tx.insert(dealActivities).values({
    dealId: opts.dealId,
    kind: opts.kind,
    actorUserId: opts.actorUserId,
    metadata: opts.metadata ?? {},
  });
}

export async function createDeal(input: {
  leadId: string;
  proposalValue?: number | null;
  ownerUserId: string;
  source: 'manual' | 'auto_image';
}): Promise<PublicDeal> {
  // Idempotente: se já existe deal pra esse lead, retorna o existing.
  const [existing] = await db.select().from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
  if (existing) {
    return getDealById(existing.id);
  }

  const dealId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(deals)
      .values({
        leadId: input.leadId,
        stage: 'proposta_enviada',
        proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
        ownerUserId: input.ownerUserId,
      })
      .returning({ id: deals.id });
    await logActivity(tx, {
      dealId: created.id,
      kind: 'created',
      actorUserId: input.source === 'auto_image' ? null : input.ownerUserId,
      metadata: { source: input.source },
    });
    return created.id;
  });

  return getDealById(dealId);
}

export async function updateDeal(input: {
  id: string;
  actorUserId: string;
  proposalValue?: number | null;
  notes?: string | null;
  ownerUserId?: string | null;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (input.proposalValue !== undefined) {
      const newVal = input.proposalValue == null ? null : String(input.proposalValue);
      const oldVal = current.proposalValue;
      if (newVal !== oldVal) {
        patch.proposalValue = newVal;
        await logActivity(tx, {
          dealId: input.id,
          kind: 'value_changed',
          actorUserId: input.actorUserId,
          metadata: {
            from: oldVal == null ? null : Number(oldVal),
            to: newVal == null ? null : Number(newVal),
          },
        });
      }
    }

    if (input.notes !== undefined && input.notes !== current.notes) {
      patch.notes = input.notes;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'note_added',
        actorUserId: input.actorUserId,
        metadata: { note: input.notes ?? '' },
      });
    }

    if (input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId) {
      patch.ownerUserId = input.ownerUserId;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'owner_changed',
        actorUserId: input.actorUserId,
        metadata: {
          fromUserId: current.ownerUserId,
          toUserId: input.ownerUserId,
        },
      });
    }

    if (Object.keys(patch).length > 1) {
      await tx.update(deals).set(patch).where(eq(deals.id, input.id));
    }
  });

  return getDealById(input.id);
}

export async function changeStage(input: {
  id: string;
  actorUserId: string;
  stage: DealStage;
  lossReason?: LossReason;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  if (input.stage === 'perdido' && !input.lossReason) {
    throw new HttpError(400, 'lossReason is required when moving to perdido');
  }
  if (input.stage === 'ganho' && current.proposalValue == null) {
    throw new HttpError(400, 'proposalValue is required before marking as ganho');
  }
  if (input.stage === current.stage) {
    return getDealById(input.id);
  }

  const isTerminalNow = current.stage === 'ganho' || current.stage === 'perdido';
  const movingToActive = input.stage === 'proposta_enviada' || input.stage === 'em_negociacao';
  const reactivating = isTerminalNow && movingToActive;

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {
      stage: input.stage,
      updatedAt: new Date(),
    };
    // closed_at: set when entering terminal, clear when leaving terminal
    if (input.stage === 'ganho' || input.stage === 'perdido') {
      patch.closedAt = new Date();
    } else {
      patch.closedAt = null;
    }
    // loss_reason: set when going to perdido, clear otherwise
    patch.lossReason = input.stage === 'perdido' ? input.lossReason : null;

    await tx.update(deals).set(patch).where(eq(deals.id, input.id));

    if (reactivating) {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'reactivated',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    } else {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'stage_changed',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    }

    if (input.stage === 'ganho') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'won',
        actorUserId: input.actorUserId,
        metadata: { value: Number(current.proposalValue) },
      });
    }
    if (input.stage === 'perdido') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'lost',
        actorUserId: input.actorUserId,
        metadata: { reason: input.lossReason },
      });
    }
  });

  return getDealById(input.id);
}

export async function deleteDeal(id: string): Promise<void> {
  const [row] = await db.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
  if (!row) throw new HttpError(404, 'Deal not found');
}

export async function reactivateDeal(input: {
  dealId: string;
  actorUserId: string;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.dealId)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');
  if (current.stage !== 'ganho' && current.stage !== 'perdido') {
    return getDealById(input.dealId);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({
        stage: 'proposta_enviada',
        closedAt: null,
        lossReason: null,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, input.dealId));
    await logActivity(tx, {
      dealId: input.dealId,
      kind: 'reactivated',
      actorUserId: input.actorUserId,
      metadata: { from: current.stage, to: 'proposta_enviada' },
    });
  });

  return getDealById(input.dealId);
}
```

- [ ] **Step 4.2:** Verificar lint.

```bash
npm run lint
```

- [ ] **Step 4.3:** Commit.

```bash
git add server/services/dealsService.ts
git commit -m "feat(deals): mutations (create/update/changeStage/delete/reactivate) with activity log"
```

---

## Task 5 — Endpoints + RBAC (TDD: list, board, history, get)

**Files:**
- Create: `server/controllers/dealsController.ts`
- Create: `server/routes/deals.ts`
- Create: `server/tests/deals-list.test.ts`
- Create: `server/tests/deals-history.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 5.1:** Escrever testes de list/board ANTES — `server/tests/deals-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' | 'recepcao' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/deals', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/deals');
    expect(res.status).toBe(401);
  });

  it('403 pra recepcao', async () => {
    const { token } = await loginAs('r@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 retorna board agrupado por stage com totals', async () => {
    const { token, userId } = await loginAs();
    const lead1 = await createLead({ phone: '11000060001' });
    await createDeal({ leadId: lead1.id, stage: 'proposta_enviada', proposalValue: 280, ownerUserId: userId });
    const lead2 = await createLead({ phone: '11000060002' });
    await createDeal({ leadId: lead2.id, stage: 'em_negociacao', proposalValue: 580, ownerUserId: userId });

    const res = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages.proposta_enviada).toHaveLength(1);
    expect(res.body.stages.em_negociacao).toHaveLength(1);
    expect(res.body.stages.ganho).toHaveLength(0);
    expect(res.body.totals.proposta_enviada.count).toBe(1);
    expect(res.body.totals.proposta_enviada.valueSum).toBe(280);
    expect(res.body.totals.em_negociacao.valueSum).toBe(580);
  });

  it('owner=mine filtra só meus, owner=all pega todos', async () => {
    const { token, userId } = await loginAs();
    const otherUser = await createUser({ email: 'other@x.com', password: 'pw12345', role: 'comercial' });
    const lead1 = await createLead({ phone: '11000061001' });
    await createDeal({ leadId: lead1.id, ownerUserId: userId });
    const lead2 = await createLead({ phone: '11000061002' });
    await createDeal({ leadId: lead2.id, ownerUserId: otherUser.id });

    const mine = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(mine.body.stages.proposta_enviada).toHaveLength(1);

    const all = await request(app).get('/api/deals?owner=all').set('Authorization', `Bearer ${token}`);
    expect(all.body.stages.proposta_enviada).toHaveLength(2);
  });

  it('terminais aparecem se closed_at < 7 dias, somem se >= 7 dias', async () => {
    const { token, userId } = await loginAs();
    const recent = await createLead({ phone: '11000062001' });
    await createDeal({
      leadId: recent.id,
      stage: 'ganho',
      proposalValue: 540,
      ownerUserId: userId,
      closedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const old = await createLead({ phone: '11000062002' });
    await createDeal({
      leadId: old.id,
      stage: 'ganho',
      proposalValue: 700,
      ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals?owner=mine').set('Authorization', `Bearer ${token}`);
    expect(res.body.stages.ganho).toHaveLength(1);
    expect(res.body.stages.ganho[0].lead.phone).toBe('11000062001');
  });

  it('busca q filtra por nome, telefone, placa do lead', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000063001', name: 'João Silva' });
    await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app).get('/api/deals?owner=mine&q=Silva').set('Authorization', `Bearer ${token}`);
    expect(res.body.stages.proposta_enviada).toHaveLength(1);
  });
});
```

- [ ] **Step 5.2:** Escrever testes de history — `server/tests/deals-history.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/deals/history', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/deals/history');
    expect(res.status).toBe(401);
  });

  it('200 retorna deals com closed_at >= 7 dias atrás', async () => {
    const { token, userId } = await loginAs();
    const recent = await createLead({ phone: '11000070001' });
    await createDeal({
      leadId: recent.id, stage: 'ganho', proposalValue: 100, ownerUserId: userId,
      closedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const old = await createLead({ phone: '11000070002' });
    await createDeal({
      leadId: old.id, stage: 'perdido', lossReason: 'preco', proposalValue: 200, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lead.phone).toBe('11000070002');
    expect(res.body.pageSize).toBe(50);
  });

  it('filtra por stage=perdido', async () => {
    const { token, userId } = await loginAs();
    const a = await createLead({ phone: '11000071001' });
    await createDeal({
      leadId: a.id, stage: 'ganho', proposalValue: 300, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const b = await createLead({ phone: '11000071002' });
    await createDeal({
      leadId: b.id, stage: 'perdido', lossReason: 'preco', proposalValue: 400, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history?stage=perdido').set('Authorization', `Bearer ${token}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].stage).toBe('perdido');
  });

  it('filtra por lossReason', async () => {
    const { token, userId } = await loginAs();
    const a = await createLead({ phone: '11000072001' });
    await createDeal({
      leadId: a.id, stage: 'perdido', lossReason: 'preco', proposalValue: 300, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const b = await createLead({ phone: '11000072002' });
    await createDeal({
      leadId: b.id, stage: 'perdido', lossReason: 'sem_retorno', proposalValue: 500, ownerUserId: userId,
      closedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/deals/history?lossReason=preco').set('Authorization', `Bearer ${token}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lossReason).toBe('preco');
  });
});

describe('GET /api/deals/:id', () => {
  it('200 retorna deal + activities', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000073001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app).get(`/api/deals/${d.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(d.id);
    expect(res.body.activities).toBeInstanceOf(Array);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .get('/api/deals/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5.3:** Rodar — devem falhar.

```bash
npm test -- server/tests/deals-list.test.ts server/tests/deals-history.test.ts
```

Esperado: todos falham (404 por rotas não registradas).

- [ ] **Step 5.4:** Implementar `server/controllers/dealsController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DEAL_STAGES, LOSS_REASONS } from '../../shared/types';
import {
  listBoard,
  listHistory,
  getDealById,
} from '../services/dealsService';

const idParams = z.object({ id: z.string().uuid() });

const boardQuery = z.object({
  owner: z.enum(['mine', 'all']).optional(),
  q: z.string().optional(),
});

const historyQuery = z.object({
  owner: z.enum(['mine', 'all']).optional(),
  q: z.string().optional(),
  stage: z.enum(['ganho', 'perdido']).optional(),
  lossReason: z.enum(LOSS_REASONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function boardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = boardQuery.parse(req.query);
    const result = await listBoard({
      ownerFilter: params.owner ?? 'mine',
      q: params.q,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function historyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = historyQuery.parse(req.query);
    const result = await listHistory({
      ownerFilter: params.owner ?? 'all',
      q: params.q,
      stage: params.stage,
      lossReason: params.lossReason,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      page: params.page,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getDealById(id));
  } catch (e) { next(e); }
}

// Re-exports usados na tarefa 6
export { DEAL_STAGES, LOSS_REASONS };
```

- [ ] **Step 5.5:** Criar `server/routes/deals.ts`:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  boardHandler,
  historyHandler,
  getHandler,
} from '../controllers/dealsController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];

// IMPORTANTE: /history antes de /:id senão "history" vira id e dá 400 (UUID inválido).
router.get('/history', ...guard, historyHandler);
router.get('/', ...guard, boardHandler);
router.get('/:id', ...guard, getHandler);

export default router;
```

- [ ] **Step 5.6:** Registrar rota em `server/app.ts`. Adicionar `import dealRoutes from './routes/deals';` e `app.use('/api/deals', dealRoutes);` antes do 404 fallback.

```ts
// no topo:
import dealRoutes from './routes/deals';

// dentro do createApp(), antes do app.use('/api', ...) 404:
app.use('/api/deals', dealRoutes);
```

- [ ] **Step 5.7:** Rodar testes.

```bash
npm test -- server/tests/deals-list.test.ts server/tests/deals-history.test.ts
```

Esperado: todos passam.

- [ ] **Step 5.8:** Lint + commit.

```bash
npm run lint
git add server/controllers/dealsController.ts server/routes/deals.ts server/tests/deals-list.test.ts server/tests/deals-history.test.ts server/app.ts
git commit -m "feat(deals): board + history + getById endpoints"
```

---

## Task 6 — Endpoints de mutação (TDD: create, patch, stage, delete)

**Files:**
- Modify: `server/controllers/dealsController.ts`
- Modify: `server/routes/deals.ts`
- Create: `server/tests/deals-actions.test.ts`

- [ ] **Step 6.1:** Escrever testes — `server/tests/deals-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals, dealActivities } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345', role: 'comercial' | 'admin' = 'comercial') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('POST /api/deals (create)', () => {
  it('200 cria deal manual e loga activity created', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000080001' });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id, proposalValue: 280 });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('proposta_enviada');
    expect(res.body.proposalValue).toBe(280);
    expect(res.body.owner.id).toBe(userId);

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, res.body.id));
    expect(acts.find((a) => a.kind === 'created')).toBeDefined();
  });

  it('200 idempotente: 2x mesmo lead → retorna deal existente', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000080010' });
    const existing = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
  });
});

describe('PATCH /api/deals/:id', () => {
  it('200 edita valor e loga value_changed', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000081001' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 280, ownerUserId: userId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ proposalValue: 320 });
    expect(res.status).toBe(200);
    expect(res.body.proposalValue).toBe(320);

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'value_changed')).toBeDefined();
  });

  it('200 edita notes e loga note_added', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000081010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'cliente pediu desconto' });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('cliente pediu desconto');

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'note_added')).toBeDefined();
  });
});

describe('POST /api/deals/:id/stage', () => {
  it('200 move stage e loga stage_changed', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('em_negociacao');

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'stage_changed')).toBeDefined();
  });

  it('400 quando perdido sem lossReason', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'perdido' });
    expect(res.status).toBe(400);
  });

  it('200 perdido com lossReason limpa value, seta closed_at, loga lost', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082020' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 280, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'perdido', lossReason: 'preco' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('perdido');
    expect(res.body.lossReason).toBe('preco');
    expect(res.body.closedAt).not.toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'lost')).toBeDefined();
  });

  it('400 ganho sem proposal_value', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082030' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });  // sem valor

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'ganho' });
    expect(res.status).toBe(400);
  });

  it('200 ganho com value seta closed_at e loga won', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082040' });
    const d = await createDeal({ leadId: lead.id, proposalValue: 540, ownerUserId: userId });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'ganho' });
    expect(res.status).toBe(200);
    expect(res.body.closedAt).not.toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'won')).toBeDefined();
  });

  it('200 reativando (perdido → proposta_enviada) loga reactivated, limpa closed_at e lossReason', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000082050' });
    const d = await createDeal({
      leadId: lead.id,
      stage: 'perdido',
      lossReason: 'sem_retorno',
      proposalValue: 200,
      ownerUserId: userId,
      closedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/deals/${d.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'proposta_enviada' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('proposta_enviada');
    expect(res.body.closedAt).toBeNull();
    expect(res.body.lossReason).toBeNull();

    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, d.id));
    expect(acts.find((a) => a.kind === 'reactivated')).toBeDefined();
  });
});

describe('DELETE /api/deals/:id', () => {
  it('204 admin deleta', async () => {
    const { token: adminToken } = await loginAs('a@x.com', 'pw12345', 'admin');
    const { userId: cUserId } = await loginAs('c2@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000083001' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: cUserId });

    const res = await request(app)
      .delete(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row).toBeUndefined();
  });

  it('403 comercial não pode deletar', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000083010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: userId });

    const res = await request(app)
      .delete(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6.2:** Rodar — devem falhar.

```bash
npm test -- server/tests/deals-actions.test.ts
```

- [ ] **Step 6.3:** Adicionar handlers em `server/controllers/dealsController.ts`. Anexar **no fim do arquivo** (mantendo o que já existe):

```ts
import {
  createDeal,
  updateDeal,
  changeStage,
  deleteDeal,
} from '../services/dealsService';

const createBody = z.object({
  leadId: z.string().uuid(),
  proposalValue: z.number().nonnegative().optional(),
});

const patchBody = z
  .object({
    proposalValue: z.number().nonnegative().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const stageBody = z.object({
  stage: z.enum(DEAL_STAGES),
  lossReason: z.enum(LOSS_REASONS).optional(),
});

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    const deal = await createDeal({
      leadId: data.leadId,
      proposalValue: data.proposalValue ?? null,
      ownerUserId: req.user!.userId,
      source: 'manual',
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function patchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = patchBody.parse(req.body);
    const deal = await updateDeal({
      id,
      actorUserId: req.user!.userId,
      proposalValue: data.proposalValue,
      notes: data.notes,
      ownerUserId: data.ownerUserId,
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function stageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = stageBody.parse(req.body);
    const deal = await changeStage({
      id,
      actorUserId: req.user!.userId,
      stage: data.stage,
      lossReason: data.lossReason,
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteDeal(id);
    res.status(204).end();
  } catch (e) { next(e); }
}
```

- [ ] **Step 6.4:** Atualizar `server/routes/deals.ts`. Substituir o arquivo todo por:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  boardHandler,
  historyHandler,
  getHandler,
  createHandler,
  patchHandler,
  stageHandler,
  deleteHandler,
} from '../controllers/dealsController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/history', ...guard, historyHandler);
router.get('/', ...guard, boardHandler);
router.get('/:id', ...guard, getHandler);
router.post('/', ...guard, createHandler);
router.patch('/:id', ...guard, patchHandler);
router.post('/:id/stage', ...guard, stageHandler);
router.delete('/:id', ...adminOnly, deleteHandler);

export default router;
```

- [ ] **Step 6.5:** Rodar testes.

```bash
npm test -- server/tests/deals-actions.test.ts
```

Esperado: 12/12 passando.

- [ ] **Step 6.6:** Lint + commit.

```bash
npm run lint
git add server/controllers/dealsController.ts server/routes/deals.ts server/tests/deals-actions.test.ts
git commit -m "feat(deals): create/patch/stage/delete endpoints with activity log"
```

---

## Task 7 — RBAC tests (cobertura específica de roles)

**Files:**
- Create: `server/tests/deals-rbac.test.ts`

- [ ] **Step 7.1:** Criar `server/tests/deals-rbac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createDeal } from './helpers';

const app = createApp();

async function loginAs(email: string, password = 'pw12345', role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password, role });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('Deals RBAC', () => {
  it('recepcao recebe 403 em GET /api/deals', async () => {
    const { token } = await loginAs('r1@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em GET /api/deals/history', async () => {
    const { token } = await loginAs('r2@x.com', 'pw12345', 'recepcao');
    const res = await request(app).get('/api/deals/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em POST /api/deals', async () => {
    const { token } = await loginAs('r3@x.com', 'pw12345', 'recepcao');
    const lead = await createLead({ phone: '11000090001' });
    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id });
    expect(res.status).toBe(403);
  });

  it('recepcao recebe 403 em PATCH /api/deals/:id', async () => {
    const { token } = await loginAs('r4@x.com', 'pw12345', 'recepcao');
    const { userId: cId } = await loginAs('c5@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000090010' });
    const d = await createDeal({ leadId: lead.id, ownerUserId: cId });

    const res = await request(app)
      .patch(`/api/deals/${d.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ proposalValue: 100 });
    expect(res.status).toBe(403);
  });

  it('comercial pode tudo exceto deletar', async () => {
    const { token, userId } = await loginAs('c6@x.com', 'pw12345', 'comercial');
    const lead = await createLead({ phone: '11000090020' });

    const post = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId: lead.id, proposalValue: 200 });
    expect(post.status).toBe(200);

    const dealId = post.body.id;

    const patch = await request(app)
      .patch(`/api/deals/${dealId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'teste' });
    expect(patch.status).toBe(200);

    const stage = await request(app)
      .post(`/api/deals/${dealId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(stage.status).toBe(200);

    const del = await request(app).delete(`/api/deals/${dealId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});
```

- [ ] **Step 7.2:** Rodar testes.

```bash
npm test -- server/tests/deals-rbac.test.ts
```

Esperado: 5/5 passando (rotas e RBAC já estão configurados nos Tasks 5 e 6).

- [ ] **Step 7.3:** Lint + commit.

```bash
npm run lint
git add server/tests/deals-rbac.test.ts
git commit -m "test(deals): RBAC coverage (recepcao 403, comercial OK, admin only delete)"
```

---

## Task 8 — pipelineIntegration + hook no sendMessage do WhatsApp (TDD)

**Files:**
- Create: `server/services/pipelineIntegration.ts`
- Create: `server/tests/pipeline-integration.test.ts`
- Create: `server/tests/whatsapp-pipeline-trigger.test.ts`
- Modify: `server/services/conversationsService.ts`

- [ ] **Step 8.1:** Criar `server/services/pipelineIntegration.ts`:

```ts
import { db } from '../db/client';
import { conversations, deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { MessageKind } from '@shared/types';
import { createDeal, reactivateDeal } from './dealsService';

export async function maybeAddDealFromConversation(opts: {
  conversationId: string;
  messageKind: MessageKind;
  userId: string;
}): Promise<void> {
  if (opts.messageKind !== 'image') return;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, opts.conversationId))
    .limit(1);
  if (!conv || conv.queue !== 'comercial') return;

  const [existing] = await db.select().from(deals).where(eq(deals.leadId, conv.leadId)).limit(1);

  if (!existing) {
    await createDeal({
      leadId: conv.leadId,
      ownerUserId: opts.userId,
      source: 'auto_image',
    });
  } else if (existing.stage === 'ganho' || existing.stage === 'perdido') {
    await reactivateDeal({ dealId: existing.id, actorUserId: opts.userId });
  }
  // else: deal ativo já existe — no-op
}
```

- [ ] **Step 8.2:** Criar testes diretos do service — `server/tests/pipeline-integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation, createDeal } from './helpers';
import { maybeAddDealFromConversation } from '../services/pipelineIntegration';

describe('maybeAddDealFromConversation', () => {
  it('ignora se kind != image', async () => {
    const u = await createUser({ email: 'p1@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100001' });
    const conv = await createConversation({ phone: '11000100001', leadId: lead.id, queue: 'comercial' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'text',
      userId: u.id,
    });

    const all = await db.select().from(deals);
    expect(all).toHaveLength(0);
  });

  it('ignora se queue != comercial', async () => {
    const u = await createUser({ email: 'p2@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100010' });
    const conv = await createConversation({ phone: '11000100010', leadId: lead.id, queue: 'recepcao' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const all = await db.select().from(deals);
    expect(all).toHaveLength(0);
  });

  it('cria deal se imagem em conversa Comercial e lead sem deal', async () => {
    const u = await createUser({ email: 'p3@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100020' });
    const conv = await createConversation({ phone: '11000100020', leadId: lead.id, queue: 'comercial' });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d).toBeDefined();
    expect(d.stage).toBe('proposta_enviada');
    expect(d.ownerUserId).toBe(u.id);
  });

  it('no-op se já existe deal ativo', async () => {
    const u = await createUser({ email: 'p4@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100030' });
    const conv = await createConversation({ phone: '11000100030', leadId: lead.id, queue: 'comercial' });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', ownerUserId: u.id });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(1);
    expect(all[0].stage).toBe('em_negociacao');  // não mudou
  });

  it('reativa se deal está em ganho/perdido', async () => {
    const u = await createUser({ email: 'p5@x.com', role: 'comercial' });
    const lead = await createLead({ phone: '11000100040' });
    const conv = await createConversation({ phone: '11000100040', leadId: lead.id, queue: 'comercial' });
    await createDeal({
      leadId: lead.id,
      stage: 'perdido',
      lossReason: 'sem_retorno',
      ownerUserId: u.id,
      closedAt: new Date(),
    });

    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: 'image',
      userId: u.id,
    });

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d.stage).toBe('proposta_enviada');
    expect(d.closedAt).toBeNull();
    expect(d.lossReason).toBeNull();
  });
});
```

- [ ] **Step 8.3:** Rodar testes do pipeline-integration.

```bash
npm test -- server/tests/pipeline-integration.test.ts
```

Esperado: 5/5 passando (independente do hook do WhatsApp ainda não estar plugado).

- [ ] **Step 8.4:** Modificar `server/services/conversationsService.ts` — função `sendMessage`. Após o `db.transaction` (e antes do `const [sender] = await db.select()...`), adicionar bloco try/catch:

Localizar o bloco (linhas ~338-370):

```ts
  const [msg] = await db.transaction(async (tx) => {
    // ... insere msg, atualiza conv ...
    return [inserted];
  });

  // Carrega o autor para o retorno público.
  const [sender] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
```

Inserir entre o `})` do transaction e o `// Carrega o autor`:

```ts
  // Pipeline Inside Sales: imagem em conversa Comercial pode criar/reativar deal.
  // Best-effort — falha aqui não derruba o envio.
  try {
    const { maybeAddDealFromConversation } = await import('./pipelineIntegration');
    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: input.kind,
      userId: input.userId,
    });
  } catch (err) {
    console.warn('[pipeline] maybeAddDealFromConversation failed:', err);
  }
```

(Usamos `await import(...)` dinâmico pra evitar criar ciclo de import entre conversationsService → pipelineIntegration → dealsService. Os módulos não dependem um do outro em tempo de carregamento.)

- [ ] **Step 8.5:** Criar teste de integração — `server/tests/whatsapp-pipeline-trigger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

vi.mock('../services/uazapiClient', () => ({
  uazapiClient: { sendMessage: vi.fn() },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));
import { uazapiClient } from '../services/uazapiClient';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345') {
  const u = await createUser({ email, password, role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('POST /api/conversations/:id/messages → pipeline trigger', () => {
  it('mandar imagem em conversa Comercial cria deal automaticamente', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-img-001',
      rawPayload: { ok: true },
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000110001' });
    const conv = await createConversation({
      phone: '11000110001',
      leadId: lead.id,
      queue: 'comercial',
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/abc.jpg',
        mediaMime: 'image/jpeg',
      });
    expect(res.status).toBe(200);

    const [d] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(d).toBeDefined();
    expect(d.stage).toBe('proposta_enviada');
    expect(d.ownerUserId).toBe(userId);
  });

  it('mandar texto em conversa Comercial NÃO cria deal', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-txt-001',
      rawPayload: {},
    });
    const { token } = await loginAs('c2@x.com');
    const lead = await createLead({ phone: '11000110010' });
    const conv = await createConversation({
      phone: '11000110010',
      leadId: lead.id,
      queue: 'comercial',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(0);
  });

  it('mandar imagem em conversa Recepção NÃO cria deal', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-img-002',
      rawPayload: {},
    });
    const { token } = await loginAs('c3@x.com');
    const lead = await createLead({ phone: '11000110020' });
    const conv = await createConversation({
      phone: '11000110020',
      leadId: lead.id,
      queue: 'recepcao',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/xyz.jpg',
      });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all).toHaveLength(0);
  });
});
```

- [ ] **Step 8.6:** Rodar.

```bash
npm test -- server/tests/whatsapp-pipeline-trigger.test.ts
```

Esperado: 3/3 passando.

- [ ] **Step 8.7:** Rodar suíte completa pra garantir nada quebrou (testes anteriores do WhatsApp Inbox passam normal mesmo com o hook).

```bash
npm test
```

Esperado: 0 regressões. Total esperado: ~178 testes (151 anteriores + 27 novos do Inside Sales backend).

- [ ] **Step 8.8:** Lint + commit.

```bash
npm run lint
git add server/services/pipelineIntegration.ts server/services/conversationsService.ts server/tests/pipeline-integration.test.ts server/tests/whatsapp-pipeline-trigger.test.ts
git commit -m "feat(deals): pipeline integration hook in sendMessage (image in Comercial → create deal)"
```

---

## Task 9 — Frontend api.ts + helpers + types

**Files:**
- Create: `src/features/inside-sales/api.ts`
- Create: `src/features/inside-sales/helpers.ts`
- Create: `src/features/inside-sales/types.ts`

- [ ] **Step 9.1:** Criar `src/features/inside-sales/types.ts`:

```ts
export type {
  PublicDeal,
  PublicDealActivity,
  DealStage,
  DealActivityKind,
  LossReason,
  BoardResponse,
  DealStageTotal,
} from '@shared/types';
```

- [ ] **Step 9.2:** Criar `src/features/inside-sales/helpers.ts`:

```ts
import type { DealStage, LossReason, DealActivityKind } from './types';

export function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function parseCurrencyInput(s: string): number | null {
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isFinite(n) && n >= 0 ? n : null;
}

export const STAGE_LABELS: Record<DealStage, string> = {
  proposta_enviada: 'Proposta enviada',
  em_negociacao: 'Em negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

export const STAGE_COLORS: Record<DealStage, string> = {
  proposta_enviada: 'text-primary',
  em_negociacao: 'text-primary',
  ganho: 'text-emerald-500',
  perdido: 'text-destructive',
};

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  condicoes_comerciais: 'Condições comerciais',
  preco: 'Preço',
  sem_retorno: 'Sem retorno',
  fora_do_perfil: 'Fora do perfil',
};

export const ACTIVITY_ICONS: Record<DealActivityKind, string> = {
  created: '+',
  stage_changed: '↔',
  value_changed: '💰',
  note_added: '📝',
  won: '✅',
  lost: '❌',
  reactivated: '🔄',
  owner_changed: '👤',
};

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ontem';
  if (diffD < 7) return `há ${diffD} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (/^\d+$/.test(name.replace(/\D/g, ''))) return '?';
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
```

- [ ] **Step 9.3:** Criar `src/features/inside-sales/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  BoardResponse,
  PublicDeal,
  PublicDealActivity,
  DealStage,
  LossReason,
} from './types';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface BoardFilters {
  owner?: 'mine' | 'all';
  q?: string;
}

function buildBoardQuery(f: BoardFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useBoard(filters: BoardFilters) {
  return useQuery({
    queryKey: ['deals', 'board', filters],
    queryFn: () => api<BoardResponse>(`/deals${buildBoardQuery(filters)}`),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  owner?: 'mine' | 'all';
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: string;
  to?: string;
  page?: number;
}

export interface HistoryResult {
  items: PublicDeal[];
  total: number;
  page: number;
  pageSize: number;
}

function buildHistoryQuery(f: HistoryFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  if (f.stage) u.set('stage', f.stage);
  if (f.lossReason) u.set('lossReason', f.lossReason);
  if (f.from) u.set('from', f.from);
  if (f.to) u.set('to', f.to);
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useHistory(filters: HistoryFilters) {
  return useQuery({
    queryKey: ['deals', 'history', filters],
    queryFn: () => api<HistoryResult>(`/deals/history${buildHistoryQuery(filters)}`),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Deal detail
// ---------------------------------------------------------------------------

export interface DealDetail extends PublicDeal {
  activities: PublicDealActivity[];
}

export function useDeal(id: string | null) {
  return useQuery({
    queryKey: ['deals', 'detail', id],
    queryFn: () => api<DealDetail>(`/deals/${id}`),
    enabled: !!id,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['deals'] });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId: string; proposalValue?: number }) =>
      api<PublicDeal>('/deals', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function usePatchDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; proposalValue?: number | null; notes?: string | null; ownerUserId?: string | null }) => {
      const { id, ...body } = input;
      return api<PublicDeal>(`/deals/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useChangeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; stage: DealStage; lossReason?: LossReason }) => {
      const { id, ...body } = input;
      return api<PublicDeal>(`/deals/${id}/stage`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/deals/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}
```

- [ ] **Step 9.4:** Lint.

```bash
npm run lint
```

- [ ] **Step 9.5:** Commit.

```bash
git add src/features/inside-sales/api.ts src/features/inside-sales/helpers.ts src/features/inside-sales/types.ts
git commit -m "feat(deals): TanStack Query hooks + helpers + types"
```

---

## Task 10 — Page shell + tabs + Sidebar RBAC

**Files:**
- Modify: `src/pages/inside-sales/InsideSalesPage.tsx`
- Create: `src/pages/inside-sales/HistoryPage.tsx` (placeholder por enquanto)
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 10.1:** Atualizar `src/components/layout/Sidebar.tsx` para restringir acesso a Inside Sales. Substituir o array `items` por:

```tsx
const items = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { to: '/inside-sales', label: 'Inside Sales', icon: Briefcase, salesOnly: true },
  { to: '/cadastros', label: 'Cadastros', icon: Users },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
  { to: '/settings', label: 'Configurações', icon: SettingsIcon },
];
```

E substituir a função filter:

```tsx
const visible = items.filter((i) => {
  if (i.adminOnly && role !== 'admin') return false;
  if (i.salesOnly && role !== 'admin' && role !== 'comercial') return false;
  return true;
});
```

(Recepção não vê o link.)

- [ ] **Step 10.2:** Substituir `src/pages/inside-sales/InsideSalesPage.tsx` pelo shell de tabs:

```tsx
import { useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const KanbanBoard = lazy(() =>
  import('@/features/inside-sales/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);
const HistoryPage = lazy(() => import('./HistoryPage'));

const Loader = () => <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;

export default function InsideSalesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as 'pipeline' | 'history') || 'pipeline';

  function setTab(t: 'pipeline' | 'history') {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Inside Sales</h1>
          <p className="text-sm text-muted-foreground">Pipeline de leads em negociação ativa</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'pipeline'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'history'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('history')}
        >
          Histórico
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {tab === 'pipeline' ? <KanbanBoard /> : <HistoryPage />}
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.3:** Criar placeholder `src/pages/inside-sales/HistoryPage.tsx`:

```tsx
export default function HistoryPage() {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Histórico — Task 16
    </div>
  );
}
```

- [ ] **Step 10.4:** Lint + commit.

```bash
npm run lint
git add src/pages/inside-sales/InsideSalesPage.tsx src/pages/inside-sales/HistoryPage.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(deals): page shell with tabs + restrict sidebar to admin/comercial"
```

---

## Task 11 — KanbanBoard + KanbanColumn (sem DnD ainda) + DealCard

**Files:**
- Create: `src/features/inside-sales/KanbanBoard.tsx`
- Create: `src/features/inside-sales/KanbanColumn.tsx`
- Create: `src/features/inside-sales/DealCard.tsx`

- [ ] **Step 11.1:** Criar `src/features/inside-sales/DealCard.tsx`:

```tsx
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { avatarInitials, formatCurrency, relativeTime, LOSS_REASON_LABELS } from './helpers';
import type { PublicDeal } from './types';

interface Props {
  deal: PublicDeal;
  currentUserId: string;
  onClick: () => void;
}

export function DealCard({ deal, currentUserId, onClick }: Props) {
  const isMine = deal.owner?.id === currentUserId;
  const ownerLabel = !deal.owner
    ? 'Sem dono'
    : isMine
    ? 'Você'
    : deal.owner.name;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-[10px] font-semibold">
            {avatarInitials(deal.lead.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 truncate font-semibold text-sm">
          {deal.lead.name}
        </div>
        {deal.isStale && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
            parado
          </Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-2 truncate">
        {[deal.lead.vehicleModel, deal.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
      </div>

      {deal.stage === 'perdido' && deal.lossReason && (
        <div className="mb-2">
          <Badge variant="outline" className="text-[10px] px-2 py-0 border-destructive/40 text-destructive">
            {LOSS_REASON_LABELS[deal.lossReason]}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-1">
        <span className={`text-sm font-bold ${deal.proposalValue == null ? 'text-muted-foreground font-normal' : 'text-emerald-500'}`}>
          {formatCurrency(deal.proposalValue)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {ownerLabel} · {relativeTime(deal.updatedAt)}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 11.2:** Criar `src/features/inside-sales/KanbanColumn.tsx`:

```tsx
import { DealCard } from './DealCard';
import { formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';
import type { DealStage, PublicDeal, DealStageTotal } from './types';

interface Props {
  stage: DealStage;
  items: PublicDeal[];
  total: DealStageTotal;
  currentUserId: string;
  onCardClick: (deal: PublicDeal) => void;
}

export function KanbanColumn({ stage, items, total, currentUserId, onCardClick }: Props) {
  return (
    <div className="flex flex-col bg-background border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border bg-muted/30 flex justify-between items-center">
        <span className={`text-xs font-semibold uppercase tracking-wide ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full inline-block">
            {total.count}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {formatCurrency(total.valueSum)}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {items.map((d) => (
          <DealCard key={d.id} deal={d} currentUserId={currentUserId} onClick={() => onCardClick(d)} />
        ))}
        {items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">vazio</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.3:** Criar `src/features/inside-sales/KanbanBoard.tsx` (versão sem DnD ainda — Task 13 adiciona):

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import { useBoard } from './api';
import { KanbanColumn } from './KanbanColumn';
import { DEAL_STAGES } from '@shared/types';
import type { DealStage, PublicDeal } from './types';

export function KanbanBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = (searchParams.get('owner') as 'mine' | 'all') || 'mine';
  const q = searchParams.get('q') ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const [searchInput, setSearchInput] = useState(q);
  const [, setSelectedDealId] = useState<string | null>(null);  // Task 15 wires drawer

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading, isError } = useBoard({ owner, q: q || undefined });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 mb-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, placa…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => patch({ q: searchInput || null })}
            onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          />
        </div>
        <div className="flex gap-1.5">
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'mine'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'mine' })}
          >
            Meus deals
          </button>
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'all'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'all' })}
          >
            Todos
          </button>
        </div>
      </div>

      {isError && (
        <div className="text-sm text-destructive p-4">Erro ao carregar o pipeline.</div>
      )}

      <div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden">
        {isLoading || !data ? (
          DEAL_STAGES.map((s) => (
            <div key={s} className="flex flex-col gap-2 p-2 bg-background border border-border rounded-lg">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))
        ) : (
          DEAL_STAGES.map((s: DealStage) => (
            <KanbanColumn
              key={s}
              stage={s}
              items={data.stages[s]}
              total={data.totals[s]}
              currentUserId={currentUserId}
              onCardClick={(deal: PublicDeal) => setSelectedDealId(deal.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.4:** Lint + smoke (`npm run dev`, abrir `/inside-sales`, deve mostrar 4 colunas vazias).

```bash
npm run lint
```

- [ ] **Step 11.5:** Commit.

```bash
git add src/features/inside-sales/DealCard.tsx src/features/inside-sales/KanbanColumn.tsx src/features/inside-sales/KanbanBoard.tsx
git commit -m "feat(deals): kanban board with 4 columns + cards (no DnD yet)"
```

---

## Task 12 — Add Deal dialog (manual entry)

**Files:**
- Create: `src/features/inside-sales/AddDealDialog.tsx`
- Create: `src/features/inside-sales/ValueInput.tsx`
- Modify: `src/features/inside-sales/KanbanBoard.tsx`

- [ ] **Step 12.1:** Criar `src/features/inside-sales/ValueInput.tsx`:

```tsx
import { Input } from '@/components/ui/input';
import { parseCurrencyInput } from './helpers';

interface Props {
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;
}

export function ValueInput({ value, onChange, placeholder, className }: Props) {
  const display = value == null ? '' : value.toLocaleString('pt-BR', { minimumFractionDigits: 0 });
  return (
    <Input
      value={display}
      placeholder={placeholder ?? 'R$ 0,00'}
      className={className}
      onChange={(e) => onChange(parseCurrencyInput(e.target.value))}
      inputMode="decimal"
    />
  );
}
```

- [ ] **Step 12.2:** Criar `src/features/inside-sales/AddDealDialog.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';
import { useCreateDeal } from './api';
import { api } from '@/lib/apiClient';
import type { PublicLead } from '@shared/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LeadSearchResponse {
  items: PublicLead[];
}

export function AddDealDialog({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PublicLead[]>([]);
  const [selected, setSelected] = useState<PublicLead | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const create = useCreateDeal();

  async function doSearch(query: string) {
    setSearch(query);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await api<LeadSearchResponse>(`/leads?q=${encodeURIComponent(query)}`);
      setResults(res.items.slice(0, 10));
    } catch {
      setResults([]);
    }
  }

  async function submit() {
    if (!selected) return;
    try {
      await create.mutateAsync({ leadId: selected.id, proposalValue: value ?? undefined });
      toast.success('Adicionado ao pipeline.');
      onOpenChange(false);
      setSelected(null);
      setValue(null);
      setSearch('');
      setResults([]);
    } catch {
      toast.error('Falha ao adicionar.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar ao pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Buscar lead</Label>
            <Input
              placeholder="Nome ou telefone…"
              value={selected ? selected.name : search}
              onChange={(e) => {
                setSelected(null);
                doSearch(e.target.value);
              }}
            />
            {!selected && results.length > 0 && (
              <div className="mt-1 border border-border rounded-md max-h-40 overflow-y-auto">
                {results.map((l) => (
                  <button
                    key={l.id}
                    className="w-full text-left p-2 hover:bg-muted text-sm"
                    onClick={() => { setSelected(l); setResults([]); setSearch(''); }}
                  >
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.phone} {l.vehiclePlate ? `· ${l.vehiclePlate}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Valor da proposta (opcional)</Label>
            <ValueInput value={value} onChange={setValue} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!selected || create.isPending}>
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 12.3:** Atualizar `KanbanBoard.tsx` pra incluir o botão "+ Adicionar ao pipeline". Adicionar imports:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { AddDealDialog } from './AddDealDialog';
```

E adicionar estado e botão no header (logo após o `<div className="flex gap-3 mb-4 items-center">` existente — adicionar mais um botão alinhado à direita):

Substituir todo o bloco do header por:

```tsx
<div className="flex gap-3 mb-4 items-center">
  <div className="relative flex-1 max-w-sm">
    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input
      placeholder="Buscar por nome, telefone, placa…"
      className="pl-8 h-9 text-sm"
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      onBlur={() => patch({ q: searchInput || null })}
      onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
    />
  </div>
  <div className="flex gap-1.5">
    <button
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        owner === 'mine' ? 'bg-primary/10 text-primary border-primary/40' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
      }`}
      onClick={() => patch({ owner: 'mine' })}
    >
      Meus deals
    </button>
    <button
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        owner === 'all' ? 'bg-primary/10 text-primary border-primary/40' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
      }`}
      onClick={() => patch({ owner: 'all' })}
    >
      Todos
    </button>
  </div>
  <div className="flex-1" />
  <Button size="sm" onClick={() => setAddOpen(true)}>
    <Plus className="h-4 w-4 mr-1" /> Adicionar ao pipeline
  </Button>
</div>
<AddDealDialog open={addOpen} onOpenChange={setAddOpen} />
```

E adicionar `const [addOpen, setAddOpen] = useState(false);` junto dos outros `useState`.

- [ ] **Step 12.4:** Lint + commit.

```bash
npm run lint
git add src/features/inside-sales/AddDealDialog.tsx src/features/inside-sales/ValueInput.tsx src/features/inside-sales/KanbanBoard.tsx
git commit -m "feat(deals): add deal dialog + value input"
```

---

## Task 13 — Drag & Drop com @dnd-kit + dialogs de transição

**Files:**
- Create: `src/features/inside-sales/LossReasonDialog.tsx`
- Create: `src/features/inside-sales/GanhoValueDialog.tsx`
- Modify: `src/features/inside-sales/KanbanColumn.tsx`
- Modify: `src/features/inside-sales/DealCard.tsx`
- Modify: `src/features/inside-sales/KanbanBoard.tsx`

- [ ] **Step 13.1:** Criar `src/features/inside-sales/LossReasonDialog.tsx`:

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LOSS_REASON_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason } from './types';

interface Props {
  open: boolean;
  onConfirm: (reason: LossReason) => void;
  onCancel: () => void;
}

export function LossReasonDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<LossReason | ''>('');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Por que você está perdendo este deal?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Motivo</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as LossReason)}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {LOSS_REASONS.map((r) => (
                <SelectItem key={r} value={r}>{LOSS_REASON_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!reason}
            onClick={() => reason && onConfirm(reason)}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.2:** Criar `src/features/inside-sales/GanhoValueDialog.tsx`:

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';

interface Props {
  open: boolean;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

export function GanhoValueDialog({ open, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar fechamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pra marcar como ganho precisamos do valor final fechado.
          </p>
          <Label>Valor da venda</Label>
          <ValueInput value={value} onChange={setValue} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={value == null || value <= 0}
            onClick={() => value != null && onConfirm(value)}
          >
            Marcar como ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.3:** Tornar `DealCard.tsx` arrastável. Substituir o conteúdo por:

```tsx
import { useDraggable } from '@dnd-kit/core';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { avatarInitials, formatCurrency, relativeTime, LOSS_REASON_LABELS } from './helpers';
import type { PublicDeal } from './types';

interface Props {
  deal: PublicDeal;
  currentUserId: string;
  onClick: () => void;
}

export function DealCard({ deal, currentUserId, onClick }: Props) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, fromStage: deal.stage },
  });

  const isMine = deal.owner?.id === currentUserId;
  const ownerLabel = !deal.owner
    ? 'Sem dono'
    : isMine
    ? 'Você'
    : deal.owner.name;

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : { opacity: isDragging ? 0.4 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Click só conta se não houve drag.
        if (!isDragging) onClick();
      }}
      className="bg-card border border-border rounded-lg p-3 hover:border-primary transition-colors cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-[10px] font-semibold">
            {avatarInitials(deal.lead.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 truncate font-semibold text-sm">
          {deal.lead.name}
        </div>
        {deal.isStale && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
            parado
          </Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-2 truncate">
        {[deal.lead.vehicleModel, deal.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
      </div>

      {deal.stage === 'perdido' && deal.lossReason && (
        <div className="mb-2">
          <Badge variant="outline" className="text-[10px] px-2 py-0 border-destructive/40 text-destructive">
            {LOSS_REASON_LABELS[deal.lossReason]}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-1">
        <span className={`text-sm font-bold ${deal.proposalValue == null ? 'text-muted-foreground font-normal' : 'text-emerald-500'}`}>
          {formatCurrency(deal.proposalValue)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {ownerLabel} · {relativeTime(deal.updatedAt)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.4:** Tornar `KanbanColumn.tsx` drop zone. Substituir por:

```tsx
import { useDroppable } from '@dnd-kit/core';
import { DealCard } from './DealCard';
import { formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';
import type { DealStage, PublicDeal, DealStageTotal } from './types';

interface Props {
  stage: DealStage;
  items: PublicDeal[];
  total: DealStageTotal;
  currentUserId: string;
  onCardClick: (deal: PublicDeal) => void;
}

export function KanbanColumn({ stage, items, total, currentUserId, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { stage },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col bg-background border rounded-lg overflow-hidden transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="px-3 py-2.5 border-b border-border bg-muted/30 flex justify-between items-center">
        <span className={`text-xs font-semibold uppercase tracking-wide ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full inline-block">
            {total.count}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {formatCurrency(total.valueSum)}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
        {items.map((d) => (
          <DealCard key={d.id} deal={d} currentUserId={currentUserId} onClick={() => onCardClick(d)} />
        ))}
        {items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">vazio</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 13.5:** Atualizar `KanbanBoard.tsx` pra envolver as colunas em `<DndContext>` e processar drops. Substituir o arquivo todo por:

```tsx
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { useBoard, useChangeStage } from './api';
import { KanbanColumn } from './KanbanColumn';
import { AddDealDialog } from './AddDealDialog';
import { LossReasonDialog } from './LossReasonDialog';
import { GanhoValueDialog } from './GanhoValueDialog';
import { DEAL_STAGES } from '@shared/types';
import type { DealStage, PublicDeal, LossReason } from './types';

interface PendingMove {
  dealId: string;
  toStage: DealStage;
  fromStage: DealStage;
  proposalValue: number | null;
}

export function KanbanBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = (searchParams.get('owner') as 'mine' | 'all') || 'mine';
  const q = searchParams.get('q') ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const [searchInput, setSearchInput] = useState(q);
  const [, setSelectedDealId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const filters = useMemo(() => ({ owner, q: q || undefined }), [owner, q]);
  const { data, isLoading, isError } = useBoard(filters);
  const changeStage = useChangeStage();

  function handleDragEnd(e: DragEndEvent) {
    const dealId = e.active.id as string;
    const overId = e.over?.id as string | undefined;
    if (!overId) return;
    const toStage = (overId.replace('column-', '') as DealStage);
    if (!DEAL_STAGES.includes(toStage)) return;

    const fromStage = (e.active.data.current?.fromStage as DealStage) ?? toStage;
    if (fromStage === toStage) return;

    // Encontra o deal pra ler proposalValue
    const all = data
      ? [...data.stages.proposta_enviada, ...data.stages.em_negociacao, ...data.stages.ganho, ...data.stages.perdido]
      : [];
    const deal = all.find((d) => d.id === dealId);
    if (!deal) return;

    if (toStage === 'perdido') {
      setPendingMove({ dealId, toStage, fromStage, proposalValue: deal.proposalValue });
      return;
    }
    if (toStage === 'ganho' && deal.proposalValue == null) {
      setPendingMove({ dealId, toStage, fromStage, proposalValue: null });
      return;
    }
    void doMove({ dealId, toStage, fromStage });
  }

  async function doMove(opts: { dealId: string; toStage: DealStage; fromStage: DealStage; lossReason?: LossReason; ganhoValue?: number }) {
    try {
      // Se Ganho com valor novo, primeiro atualiza valor (PATCH) e depois muda stage.
      // Aqui simplificamos: o backend já valida que ganho exige value preenchido,
      // então salvamos o valor antes via PATCH se foi fornecido.
      if (opts.toStage === 'ganho' && opts.ganhoValue != null) {
        const { usePatchDeal } = await import('./api');
        // Não dá pra usar hook aqui — usamos o api direto:
        const { api: apiCall } = await import('@/lib/apiClient');
        await apiCall(`/deals/${opts.dealId}`, {
          method: 'PATCH',
          body: JSON.stringify({ proposalValue: opts.ganhoValue }),
        });
      }
      await changeStage.mutateAsync({
        id: opts.dealId,
        stage: opts.toStage,
        lossReason: opts.lossReason,
      });
      toast.success('Movido.');
    } catch (err) {
      toast.error('Falha ao mover.');
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 mb-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, placa…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => patch({ q: searchInput || null })}
            onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          />
        </div>
        <div className="flex gap-1.5">
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'mine' ? 'bg-primary/10 text-primary border-primary/40' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'mine' })}
          >
            Meus deals
          </button>
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'all' ? 'bg-primary/10 text-primary border-primary/40' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'all' })}
          >
            Todos
          </button>
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar ao pipeline
        </Button>
      </div>

      {isError && <div className="text-sm text-destructive p-4">Erro ao carregar o pipeline.</div>}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden">
          {isLoading || !data ? (
            DEAL_STAGES.map((s) => (
              <div key={s} className="flex flex-col gap-2 p-2 bg-background border border-border rounded-lg">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))
          ) : (
            DEAL_STAGES.map((s: DealStage) => (
              <KanbanColumn
                key={s}
                stage={s}
                items={data.stages[s]}
                total={data.totals[s]}
                currentUserId={currentUserId}
                onCardClick={(deal: PublicDeal) => setSelectedDealId(deal.id)}
              />
            ))
          )}
        </div>
      </DndContext>

      <AddDealDialog open={addOpen} onOpenChange={setAddOpen} />

      <LossReasonDialog
        open={pendingMove?.toStage === 'perdido'}
        onCancel={() => setPendingMove(null)}
        onConfirm={(reason) => {
          if (pendingMove) {
            void doMove({ ...pendingMove, lossReason: reason });
            setPendingMove(null);
          }
        }}
      />
      <GanhoValueDialog
        open={pendingMove?.toStage === 'ganho'}
        onCancel={() => setPendingMove(null)}
        onConfirm={(value) => {
          if (pendingMove) {
            void doMove({ ...pendingMove, ganhoValue: value });
            setPendingMove(null);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 13.6:** Lint + smoke (`npm run dev`, criar deal, arrastar entre colunas, validar dialog em Perdido/Ganho).

```bash
npm run lint
```

- [ ] **Step 13.7:** Commit.

```bash
git add src/features/inside-sales/LossReasonDialog.tsx src/features/inside-sales/GanhoValueDialog.tsx src/features/inside-sales/KanbanColumn.tsx src/features/inside-sales/DealCard.tsx src/features/inside-sales/KanbanBoard.tsx
git commit -m "feat(deals): drag & drop with @dnd-kit + loss reason / ganho value dialogs"
```

---

## Task 14 — DealDrawer + ActivityLog

**Files:**
- Create: `src/features/inside-sales/ActivityLog.tsx`
- Create: `src/features/inside-sales/DealDrawer.tsx`
- Modify: `src/features/inside-sales/KanbanBoard.tsx` (wire drawer)

- [ ] **Step 14.1:** Criar `src/features/inside-sales/ActivityLog.tsx`:

```tsx
import { ACTIVITY_ICONS, STAGE_LABELS, LOSS_REASON_LABELS, formatCurrency, relativeTime } from './helpers';
import type { PublicDealActivity, DealStage, LossReason } from './types';

interface Props {
  activities: PublicDealActivity[];
}

function describe(a: PublicDealActivity): string {
  const md = a.metadata as Record<string, unknown>;
  const actor = a.actor?.name ?? 'Sistema';
  switch (a.kind) {
    case 'created': {
      const source = md.source === 'auto_image' ? 'automaticamente (imagem enviada)' : 'manualmente';
      return `Deal criado ${source}`;
    }
    case 'stage_changed':
      return `${actor} moveu de ${STAGE_LABELS[md.from as DealStage]} → ${STAGE_LABELS[md.to as DealStage]}`;
    case 'value_changed':
      return `${actor} editou valor: ${formatCurrency(md.from as number | null)} → ${formatCurrency(md.to as number | null)}`;
    case 'note_added':
      return `${actor} adicionou nota`;
    case 'won':
      return `${actor} marcou como ganho — ${formatCurrency(md.value as number)}`;
    case 'lost':
      return `${actor} marcou como perdido — ${LOSS_REASON_LABELS[md.reason as LossReason]}`;
    case 'reactivated':
      return `${actor} reativou (estava em ${STAGE_LABELS[md.from as DealStage]})`;
    case 'owner_changed':
      return `${actor} mudou o dono`;
  }
}

export function ActivityLog({ activities }: Props) {
  if (!activities.length) {
    return <p className="text-xs text-muted-foreground p-3">Sem atividade ainda.</p>;
  }
  return (
    <div className="space-y-1">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-2 py-1.5 text-xs">
          <div className="w-6 h-6 flex items-center justify-center bg-muted rounded-full flex-shrink-0">
            <span className="text-[11px]">{ACTIVITY_ICONS[a.kind]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-foreground leading-tight">{describe(a)}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">{relativeTime(a.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 14.2:** Criar `src/features/inside-sales/DealDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeal, usePatchDeal } from './api';
import { ActivityLog } from './ActivityLog';
import { ValueInput } from './ValueInput';
import { avatarInitials, formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';

interface Props {
  dealId: string | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function DealDrawer({ dealId, onClose, readOnly = false }: Props) {
  const { data: deal, isLoading } = useDeal(dealId);
  const patch = usePatchDeal();
  const [valueDraft, setValueDraft] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  useEffect(() => {
    if (deal) {
      setValueDraft(deal.proposalValue);
      setNotesDraft(deal.notes ?? '');
    }
  }, [deal?.id, deal?.proposalValue, deal?.notes]);

  async function saveValue() {
    if (!deal || readOnly) return;
    if (valueDraft === deal.proposalValue) return;
    try {
      await patch.mutateAsync({ id: deal.id, proposalValue: valueDraft });
    } catch {
      toast.error('Falha ao salvar valor.');
      setValueDraft(deal.proposalValue);
    }
  }

  async function saveNotes() {
    if (!deal || readOnly) return;
    if (notesDraft === (deal.notes ?? '')) return;
    try {
      await patch.mutateAsync({ id: deal.id, notes: notesDraft || null });
    } catch {
      toast.error('Falha ao salvar nota.');
      setNotesDraft(deal.notes ?? '');
    }
  }

  if (!dealId) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-[440px] bg-background border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-start justify-between p-4 border-b border-border">
        {isLoading || !deal ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm font-semibold">
                {avatarInitials(deal.lead.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-semibold text-sm">{deal.lead.name}</div>
              <div className="text-xs text-muted-foreground">
                {[deal.lead.phone, deal.lead.vehicleModel, deal.lead.vehiclePlate].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        )}
        <button onClick={onClose} className="p-1 hover:bg-muted rounded">
          <X className="h-4 w-4" />
        </button>
      </div>

      {(isLoading || !deal) ? (
        <div className="p-4 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Etapa</span>
              <span className={`font-semibold ${STAGE_COLORS[deal.stage]} bg-primary/10 px-2 py-0.5 rounded text-xs`}>
                {STAGE_LABELS[deal.stage]}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Valor</span>
              {readOnly ? (
                <span className="font-semibold">{formatCurrency(deal.proposalValue)}</span>
              ) : (
                <div className="w-32">
                  <ValueInput
                    value={valueDraft}
                    onChange={setValueDraft}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Dono</span>
              <span className="font-semibold">{deal.owner?.name ?? 'Sem dono'}</span>
            </div>
          </div>

          <div className="p-4 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Notas</h4>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Anotações privadas sobre o deal…"
              className="min-h-[80px] text-sm"
              disabled={readOnly}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Atividade</h4>
            <ActivityLog activities={deal.activities} />
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 border-t border-border">
            <Button asChild variant="outline" size="sm">
              <Link to={`/whatsapp?conv=${deal.lead.id}`}>Abrir conversa</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/cadastros">Editar lead</Link>
            </Button>
          </div>

          {!readOnly && valueDraft !== deal.proposalValue && (
            <div className="p-2 border-t border-border bg-muted/30">
              <Button size="sm" className="w-full" onClick={saveValue}>
                Salvar valor
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 14.3:** Plugar drawer no `KanbanBoard.tsx`. Adicionar import:

```tsx
import { DealDrawer } from './DealDrawer';
```

E substituir `const [, setSelectedDealId] = useState<string | null>(null);` por `const [selectedDealId, setSelectedDealId] = useState<string | null>(null);`. Adicionar antes do `</DndContext>` final no JSX:

(Não, melhor adicionar `<DealDrawer />` no fim do componente, antes do `</div>` mais externo do return:)

```tsx
<DealDrawer dealId={selectedDealId} onClose={() => setSelectedDealId(null)} />
```

- [ ] **Step 14.4:** Lint + smoke (criar deal, clicar pra abrir drawer, editar valor/notes, ver activity log).

```bash
npm run lint
```

- [ ] **Step 14.5:** Commit.

```bash
git add src/features/inside-sales/ActivityLog.tsx src/features/inside-sales/DealDrawer.tsx src/features/inside-sales/KanbanBoard.tsx
git commit -m "feat(deals): deal drawer with activity log + inline value/notes editing"
```

---

## Task 15 — HistoryPage (tabela paginada com filtros)

**Files:**
- Create: `src/features/inside-sales/HistoryTable.tsx`
- Modify: `src/pages/inside-sales/HistoryPage.tsx`

- [ ] **Step 15.1:** Criar `src/features/inside-sales/HistoryTable.tsx`:

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useHistory } from './api';
import { DealDrawer } from './DealDrawer';
import { formatCurrency, LOSS_REASON_LABELS, STAGE_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason } from './types';

export function HistoryTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stageFilter = searchParams.get('stage') as 'ganho' | 'perdido' | null;
  const reasonFilter = searchParams.get('reason') as LossReason | null;
  const fromFilter = searchParams.get('from') ?? '';
  const toFilter = searchParams.get('to') ?? '';
  const ownerFilter = (searchParams.get('owner') as 'mine' | 'all') || 'all';
  const q = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const [searchInput, setSearchInput] = useState(q);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in updates)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useHistory({
    owner: ownerFilter,
    q: q || undefined,
    stage: stageFilter ?? undefined,
    lossReason: reasonFilter ?? undefined,
    from: fromFilter ? new Date(fromFilter).toISOString() : undefined,
    to: toFilter ? new Date(toFilter).toISOString() : undefined,
    page,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input
          placeholder="Buscar nome / telefone / placa…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={() => patch({ q: searchInput || null })}
          onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          className="max-w-sm h-9 text-sm"
        />
        <Select value={stageFilter ?? 'all'} onValueChange={(v) => patch({ stage: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="ganho">Ganhos</SelectItem>
            <SelectItem value="perdido">Perdidos</SelectItem>
          </SelectContent>
        </Select>
        {stageFilter === 'perdido' && (
          <Select value={reasonFilter ?? 'all'} onValueChange={(v) => patch({ reason: v === 'all' ? null : v })}>
            <SelectTrigger className="w-[180px] h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer motivo</SelectItem>
              {LOSS_REASONS.map((r) => (
                <SelectItem key={r} value={r}>{LOSS_REASON_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="date"
          value={fromFilter}
          onChange={(e) => patch({ from: e.target.value || null })}
          className="w-[150px] h-9 text-sm"
          aria-label="De"
        />
        <Input
          type="date"
          value={toFilter}
          onChange={(e) => patch({ to: e.target.value || null })}
          className="w-[150px] h-9 text-sm"
          aria-label="Até"
        />
        <Select value={ownerFilter} onValueChange={(v) => patch({ owner: v })}>
          <SelectTrigger className="w-[120px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="mine">Meus</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Dono</TableHead>
              <TableHead>Fechado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.items.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedId(d.id)}>
                    <TableCell className="font-medium">{d.lead.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {[d.lead.vehicleModel, d.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(d.proposalValue)}</TableCell>
                    <TableCell>{STAGE_LABELS[d.stage]}</TableCell>
                    <TableCell>{d.lossReason ? LOSS_REASON_LABELS[d.lossReason] : '—'}</TableCell>
                    <TableCell>{d.owner?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.closedAt ? new Date(d.closedAt).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum deal no histórico.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && totalPages > 1 && (
        <div className="flex justify-between items-center pt-3 text-sm text-muted-foreground">
          <span>Página {data.page} de {totalPages} · {data.total} deals</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={data.page <= 1}
              onClick={() => patch({ page: String(data.page - 1) })}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= totalPages}
              onClick={() => patch({ page: String(data.page + 1) })}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <DealDrawer dealId={selectedId} onClose={() => setSelectedId(null)} readOnly />
    </div>
  );
}
```

- [ ] **Step 15.2:** Substituir o placeholder em `src/pages/inside-sales/HistoryPage.tsx`:

```tsx
import { HistoryTable } from '@/features/inside-sales/HistoryTable';

export default function HistoryPage() {
  return <HistoryTable />;
}
```

- [ ] **Step 15.3:** Lint + smoke (gerar deals fechados há mais de 7 dias, abrir tab Histórico, testar filtros).

```bash
npm run lint
```

- [ ] **Step 15.4:** Commit.

```bash
git add src/features/inside-sales/HistoryTable.tsx src/pages/inside-sales/HistoryPage.tsx
git commit -m "feat(deals): history tab with filters + paginated table"
```

---

## Task 16 — Sidebar do WhatsApp Inbox: chip "No pipeline" + botão "Adicionar"

**Files:**
- Modify: `src/features/whatsapp/LeadSidebar.tsx`

- [ ] **Step 16.1:** Atualizar `src/features/whatsapp/LeadSidebar.tsx` adicionando seção "Pipeline" abaixo de "Atendimento". Primeiro, adicionar imports no topo:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { useDeal, useCreateDeal } from '@/features/inside-sales/api';
import { STAGE_LABELS, formatCurrency } from '@/features/inside-sales/helpers';
```

E reescrever o componente — Após o bloco "Atendimento" e ANTES do bloco `<div className="mt-auto p-4 space-y-2">`, adicionar:

```tsx
{/* Pipeline section — só pra admin/comercial */}
<PipelineSection leadId={conv.lead.id} />
```

E definir a sub-componente no fim do arquivo (antes do `function Row(...)`):

```tsx
function PipelineSection({ leadId }: { leadId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const visible = role === 'admin' || role === 'comercial';
  const create = useCreateDeal();

  // Hack: usamos useDeal com um "fake id" não. Em vez disso, fazemos uma query
  // simples chamando /api/deals?owner=all&q=<phone>. Pra simplicidade aqui,
  // usamos createDeal idempotente — se já existe, retorna o existing.
  // Visualmente: mostramos apenas o botão; depois de clicar, navega pra IS.

  if (!visible) return null;

  async function addToPipeline() {
    try {
      const deal = await create.mutateAsync({ leadId });
      toast.success('Adicionado ao pipeline.');
      window.location.href = `/inside-sales?owner=all`;
    } catch {
      toast.error('Falha ao adicionar.');
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border">
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Pipeline</h4>
      <Button size="sm" variant="outline" className="w-full" onClick={addToPipeline} disabled={create.isPending}>
        + Adicionar ao pipeline
      </Button>
    </div>
  );
}
```

**Nota:** A versão "rica" que mostra o estado atual do deal (chip + valor) requer um endpoint que aceite `?leadId=<uuid>` no `/api/deals` ou um endpoint dedicado `/api/deals/by-lead/:leadId`. Pra evitar inflar o escopo, esta v1 mostra **só o botão**: o backend é idempotente (se já existe deal, retorna o existing — então nunca duplica) e ao clicar redireciona pra Inside Sales onde o usuário vê o estado.

Se preferir a versão rica em vez do botão simples, **pula esta task** e adiciona TODO no spec — sub-tarefa futura adiciona endpoint `/api/leads/:id/deal` e ajusta a UI.

- [ ] **Step 16.2:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/LeadSidebar.tsx
git commit -m "feat(whatsapp): pipeline section in lead sidebar (admin/comercial only)"
```

---

## Task 17 — Cadastros: filtro "No pipeline" + chip na tabela

**Files:**
- Modify: `server/services/leadsService.ts`
- Modify: `server/controllers/leadsController.ts`
- Modify: `src/features/leads/api.ts`
- Modify: `src/features/leads/LeadFilters.tsx`
- Modify: `src/features/leads/LeadsTable.tsx`

- [ ] **Step 17.1:** Atualizar `server/services/leadsService.ts` — adicionar suporte a filter `pipeline`. Localizar a função `listLeads`. Adicionar `pipeline?: 'yes' | 'no'` ao tipo `params`. Adicionar import `import { deals } from '../db/schema';` e `import { exists, notExists } from 'drizzle-orm';` (se não existirem).

Dentro da construção de `conditions`, adicionar:

```ts
if (params.pipeline === 'yes') {
  conditions.push(sql`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
}
if (params.pipeline === 'no') {
  conditions.push(sql`NOT EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
}
```

(Importar `sql` do drizzle-orm se não estiver.)

Modificar a interface `listLeads(params: { ... })` pra incluir `pipeline?: 'yes' | 'no';`.

Adicionar também à response type `PublicLead` ou retornar info auxiliar — mas pra simplicidade, retornamos só os leads e a UI faz query separada se precisa mostrar chip. **Decisão:** o chip "● No pipeline" na tabela é renderizado a partir de uma 2ª query agregada `useLeadsWithPipeline()` que busca `pipelineLeadIds: string[]` em batch.

Pra evitar bagunça, vamos enriquecer o response do leads com a flag. Modificar o `toPublic`:

```ts
function toPublic(row: typeof leads.$inferSelect & { hasDeal?: boolean }): PublicLead & { hasDeal: boolean } {
  return {
    id: row.id, name: row.name, phone: row.phone, /* ... resto igual */
    hasDeal: row.hasDeal ?? false,
  };
}
```

E modificar o select pra fazer left join com deals e expor `EXISTS` como flag computada:

```ts
const rows = await db
  .select({
    lead: leads,
    hasDeal: sql<boolean>`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`,
  })
  .from(leads)
  .where(where)
  .orderBy(orderFn(sortCol))
  .limit(PAGE_SIZE)
  .offset((page - 1) * PAGE_SIZE);

return {
  items: rows.map((r) => toPublic({ ...r.lead, hasDeal: r.hasDeal })),
  total, page, pageSize: PAGE_SIZE,
};
```

E adicionar `hasDeal: boolean;` à interface `PublicLead` em `shared/types.ts`. Default `false`.

- [ ] **Step 17.2:** Atualizar `server/controllers/leadsController.ts` — adicionar `pipeline: z.enum(['yes', 'no']).optional()` ao `listQuery` e passar adiante.

- [ ] **Step 17.3:** Atualizar `src/features/leads/api.ts` — adicionar `pipeline?: 'yes' | 'no';` em `ListParams` e mapear em `buildQuery`.

- [ ] **Step 17.4:** Atualizar `src/features/leads/LeadFilters.tsx` — adicionar select "Pipeline" com opções "Todos / Sim / Não". Pode seguir o padrão dos outros selects do arquivo. (Se o arquivo passa props da config, adicionar `pipeline` à lista de filtros e ao state da pai.)

(O detalhe específico depende da estrutura atual de LeadFilters; basicamente adicionar o select novo e propagar via props.)

- [ ] **Step 17.5:** Atualizar `src/features/leads/LeadsTable.tsx` — adicionar coluna "Pipeline" entre "Status" e "Ações". Renderizar:

```tsx
<TableCell>
  {lead.hasDeal && (
    <Badge variant="outline" className="text-xs border-primary/40 text-primary">
      ● No pipeline
    </Badge>
  )}
</TableCell>
```

E adicionar `<TableHead>Pipeline</TableHead>` no header correspondente.

- [ ] **Step 17.6:** Lint + smoke.

```bash
npm run lint
```

- [ ] **Step 17.7:** Commit.

```bash
git add shared/types.ts server/services/leadsService.ts server/controllers/leadsController.ts src/features/leads/api.ts src/features/leads/LeadFilters.tsx src/features/leads/LeadsTable.tsx
git commit -m "feat(leads): pipeline filter + chip on Cadastros table"
```

---

## Task 18 — README + roadmap update + verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 18.1:** Atualizar a seção `## Próximos sub-projetos` do README.md:

```markdown
## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. ✅ WhatsApp Inbox — conversas com filas + composer
4. ✅ Inside Sales — pipeline kanban + drag & drop + activity log
5. Disparo em massa de campanhas
6. IA de pré-qualificação
7. Dashboard de Funil — métricas e conversão
```

- [ ] **Step 18.2:** Adicionar seção "Inside Sales" no README.md após a seção "WhatsApp Inbox":

```markdown
## Inside Sales

Tela em `/inside-sales` (apenas `admin` + `comercial`) com:

- 4 colunas: **Proposta enviada** → **Em negociação** → **Ganho** / **Perdido**.
- **Drag & drop** entre colunas (`@dnd-kit`). Mover pra Perdido abre dialog com motivo (4 opções: condições comerciais, preço, sem retorno, fora do perfil). Mover pra Ganho exige valor da proposta preenchido.
- **Card de deal** mostra: avatar, nome, veículo · placa, valor (R$) ou "—", dono, tempo. Tag amarela "parado" se deal sem atividade há > 3 dias.
- **Drawer lateral** ao clicar no card: dados do lead, valor editável inline, notas, **timeline de atividades** (created, stage_changed, value_changed, won, lost, reactivated, etc.), atalhos pra `/whatsapp` e `/cadastros`.
- **Tab "Histórico"**: deals com `closed_at` há mais de 7 dias, paginado, com filtros (período, etapa, motivo, dono).
- **Auto-trigger:** quando Comercial manda **imagem** numa conversa da fila Comercial do WhatsApp Inbox, o lead **entra automaticamente** no pipeline em "Proposta enviada". Idempotente — se já existe deal ativo, no-op; se está em terminal, reativa.
- **Polling 5s** (lista) / **5s** (drawer). URL params persistem filtros pra deep-linking.

Acesso pra Recepção: 403 (não vê o link na sidebar nem acessa a página).
```

- [ ] **Step 18.3:** Rodar suíte completa.

```bash
npm test
```

Esperado: 0 regressões. Total: ~178 testes (151 anteriores + 27 novos do Inside Sales).

- [ ] **Step 18.4:** Lint completo.

```bash
npm run lint
```

Esperado: limpo.

- [ ] **Step 18.5:** Commit final.

```bash
git add README.md
git commit -m "docs: mark Inside Sales roadmap item complete and add usage section"
```

---

## Self-Review Checklist (do plano contra a spec)

**1. Spec coverage:**
- ✅ Migration 010 + schema (3 enums, 2 tabelas, indexes) → Task 1
- ✅ Tipos compartilhados (DEAL_STAGES, LOSS_REASONS, DEAL_ACTIVITY_KINDS, PublicDeal, PublicDealActivity, BoardResponse) → Task 1
- ✅ Test helpers → Task 2
- ✅ dealsService queries (listBoard com totals, listHistory, getDealById com activities, isStale, enteredCurrentStageAt) → Task 3
- ✅ dealsService mutations (createDeal idempotente, updateDeal, changeStage com validações Ganho/Perdido, deleteDeal, reactivateDeal) → Task 4
- ✅ Activity log gerado em todas as mutações → Task 4
- ✅ Endpoints REST (GET list/history/:id, POST, PATCH, POST :id/stage, DELETE admin-only) → Tasks 5-6
- ✅ RBAC com requireRole('admin', 'comercial') + delete admin-only → Tasks 5-7
- ✅ pipelineIntegration.maybeAddDealFromConversation + hook em sendMessage → Task 8
- ✅ Idempotência: image-only, comercial-queue-only, no-op em ativo, reativação em terminal → Task 8
- ✅ Frontend hooks TanStack Query (useBoard 5s, useHistory, useDeal, mutations) → Task 9
- ✅ Page shell com tabs Pipeline/Histórico + RBAC sidebar → Task 10
- ✅ KanbanBoard + Column + Card (4 colunas, totals, search, owner chips) → Task 11
- ✅ AddDealDialog (busca lead + valor) + ValueInput → Task 12
- ✅ Drag & drop com @dnd-kit + LossReasonDialog + GanhoValueDialog → Task 13
- ✅ DealDrawer + ActivityLog + edição inline (valor, notas) → Task 14
- ✅ HistoryTable (filtros: período, etapa, motivo, dono, busca, paginação) → Task 15
- ✅ Sidebar do WhatsApp: botão "+ Adicionar ao pipeline" → Task 16
- ✅ Cadastros: filtro "No pipeline" + chip na tabela → Task 17
- ✅ README + roadmap → Task 18

**2. Placeholder scan:** sem TBD/TODO/FIXME no plano. Task 16 documenta uma simplificação justificada (botão simples em vez de chip rico) com caminho claro pra v2.

**3. Type consistency:**
- `BoardResponse` tem `stages` e `totals` — usado consistentemente em Task 3 (return), Task 5 (response), Task 9 (TanStack hook), Task 11 (consumo).
- `useBoard(filters)` aceita `BoardFilters` — usado em Task 9, 11, 13.
- `useChangeStage()` retorna mutation com `{ id, stage, lossReason }` — usado em Task 13.
- `PublicDeal` tem `proposalValue: number | null` — consistente entre service (`Number(row.proposal_value)`) e UI (`formatCurrency`).
- `usePatchDeal()` aceita `proposalValue?, notes?, ownerUserId?` — consistente em Tasks 9, 14.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-inside-sales-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatcher agent + um implementer subagent por task + dois revisores (spec compliance + code quality) por task. Mesmo padrão que rodou bem no WhatsApp Inbox (19 tasks, 151 testes verdes).

**2. Inline Execution** — executar inline com checkpoints manuais.

**Which approach?**
