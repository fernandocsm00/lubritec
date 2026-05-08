# Inside Sales — Owner Assignment + Lead no Comercial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar etapa `lead_no_comercial` (default na criação de deals) antes de `proposta_enviada` no Kanban, e permitir atribuir/reatribuir o dono de um deal pela UI com filtro do board por dono.

**Architecture:** Postgres enum `deal_stage` ganha o valor novo via migration; `shared/types.ts` propaga a etapa para front e back. Filtro `owner` do board/history aceita `mine|all|unassigned|<uuid>`. Novo endpoint enxuto `GET /users/assignable` (admin+comercial ativos) alimenta dropdowns de atribuição e filtro. UI do Kanban troca pílulas por `Select` único; DealDrawer ganha `Select` de dono.

**Tech Stack:** Postgres + Drizzle ORM, Express, Zod, Vitest + supertest (backend); React 19 + shadcn `Select` + TanStack Query (frontend).

**Spec:** [docs/superpowers/specs/2026-05-07-inside-sales-owner-and-lead-stage-design.md](../specs/2026-05-07-inside-sales-owner-and-lead-stage-design.md)

---

## File Map

**Created:**
- `server/db/migrations/024_deal_stage_lead_no_comercial.sql`

**Modified — backend:**
- `shared/types.ts` (DEAL_STAGES order)
- `server/services/dealsService.ts` (createDeal default, listBoard active stages, BoardResponse init, owner filter translation)
- `server/services/dashboardService.ts` (3 IN clauses)
- `server/services/campaignsService.ts` (line 306)
- `server/controllers/dealsController.ts` (boardQuery + historyQuery owner zod)
- `server/services/usersService.ts` (listAssignableUsers)
- `server/controllers/usersController.ts` (listAssignableHandler)
- `server/routes/users.ts` (GET /assignable)

**Modified — frontend:**
- `src/features/inside-sales/api.ts` (filter type, useAssignableUsers)
- `src/features/inside-sales/helpers.ts` (STAGE_LABELS, STAGE_COLORS)
- `src/features/inside-sales/DealCard.tsx` (STAGE_ACCENT)
- `src/features/inside-sales/KanbanBoard.tsx` (Select de dono, grid-cols-5)
- `src/features/inside-sales/DealDrawer.tsx` (Select de dono)
- `src/pages/dashboard/components/PipelineOpen.tsx` (label)

**Modified — tests:**
- `server/tests/deals-list.test.ts`
- `server/tests/deals-actions.test.ts`
- `server/tests/deals-rbac.test.ts` (ou novo `users-assignable.test.ts`)

---

## Task 1 — Migration: adicionar `lead_no_comercial` ao enum

**Files:**
- Create: `server/db/migrations/024_deal_stage_lead_no_comercial.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- 024_deal_stage_lead_no_comercial.sql
-- Adiciona etapa de triagem antes de 'proposta_enviada' no Kanban de deals.
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'lead_no_comercial' BEFORE 'proposta_enviada';
```

- [ ] **Step 2: Aplicar migration**

Run: `npm run migrate`
Expected: log `applied 024_deal_stage_lead_no_comercial.sql`. Sem erros.

- [ ] **Step 3: Confirmar enum no banco**

Run (em psql conectado ao Supabase):
```sql
SELECT unnest(enum_range(NULL::lubritec.deal_stage));
```
Expected: linhas na ordem `lead_no_comercial, proposta_enviada, em_negociacao, ganho, perdido`.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/024_deal_stage_lead_no_comercial.sql
git commit -m "db: add lead_no_comercial to deal_stage enum"
```

---

## Task 2 — `shared/types.ts`: ordem do `DEAL_STAGES`

**Files:**
- Modify: `shared/types.ts:172-178`

- [ ] **Step 1: Atualizar a tupla**

Trocar:
```ts
export const DEAL_STAGES = [
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido',
] as const;
```
Por:
```ts
export const DEAL_STAGES = [
  'lead_no_comercial',
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido',
] as const;
```

- [ ] **Step 2: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: erros apontando `Record<DealStage, …>` incompletos em `dealsService.ts`, `helpers.ts` e `DealCard.tsx` (esses serão corrigidos nas próximas tasks). Sem erros não relacionados.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "types: add lead_no_comercial as first deal stage"
```

---

## Task 3 — `dealsService.ts`: default na criação + Records + filtros

**Files:**
- Modify: `server/services/dealsService.ts`

- [ ] **Step 1: Escrever teste falhando — createDeal default**

Em `server/tests/deals-actions.test.ts`, adicionar dentro do `describe('POST /api/deals')` (ou criar um novo `describe` se mais natural):

```ts
it('cria deal com stage lead_no_comercial por padrão', async () => {
  const { token, userId } = await loginAs();
  const lead = await createLead({ phone: '11000099001' });

  const res = await request(app)
    .post('/api/deals')
    .set('Authorization', `Bearer ${token}`)
    .send({ leadId: lead.id });
  expect(res.status).toBe(200);
  expect(res.body.stage).toBe('lead_no_comercial');
  expect(res.body.owner.id).toBe(userId);
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/deals-actions.test.ts -t "lead_no_comercial por padrão"`
Expected: FAIL — `expected 'proposta_enviada' to be 'lead_no_comercial'`.

- [ ] **Step 3: Trocar default em `createDeal`**

Em `server/services/dealsService.ts`, dentro de `createDeal`, no `tx.insert(deals).values(...)`:

```ts
.values({
  leadId: input.leadId,
  stage: 'lead_no_comercial',
  proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
  ownerUserId: input.ownerUserId,
})
```

- [ ] **Step 4: Atualizar `BoardResponse` `stages`/`totals` initialization**

No mesmo arquivo, dentro de `listBoard`:

```ts
const stages: BoardResponse['stages'] = {
  lead_no_comercial: [],
  proposta_enviada: [],
  em_negociacao: [],
  ganho: [],
  perdido: [],
};
const totals: BoardResponse['totals'] = {
  lead_no_comercial: { count: 0, valueSum: 0 },
  proposta_enviada: { count: 0, valueSum: 0 },
  em_negociacao: { count: 0, valueSum: 0 },
  ganho: { count: 0, valueSum: 0 },
  perdido: { count: 0, valueSum: 0 },
};
```

- [ ] **Step 5: Incluir `lead_no_comercial` nas stages ativas do board**

Substituir o IN do bloco "active stages OR (terminal AND closed_at within last 7 days)" em `listBoard`:

```ts
conds.push(
  sql`(
    ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
    OR (
      ${deals.stage} IN ('ganho', 'perdido')
      AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
    )
  )`,
);
```

- [ ] **Step 6: Incluir `lead_no_comercial` no `isStaleSql`**

Substituir o início do `sql<boolean>`:

```ts
const isStaleSql = sql<boolean>`(
  ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
  AND COALESCE(
    ...
```

(o restante do bloco fica igual)

- [ ] **Step 7: Aceitar UUID em `ownerFilter`**

Trocar a assinatura de `listBoard` e `listHistory`:

```ts
export async function listBoard(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string; // string = UUID
  q?: string;
  currentUserId: string;
}): Promise<BoardResponse> {
```

E o branch de filtro:

```ts
if (input.ownerFilter === 'mine') {
  conds.push(eq(deals.ownerUserId, input.currentUserId));
} else if (input.ownerFilter === 'unassigned') {
  conds.push(sql`${deals.ownerUserId} IS NULL`);
} else if (input.ownerFilter !== 'all') {
  // UUID — filtro por usuário específico
  conds.push(eq(deals.ownerUserId, input.ownerFilter));
}
```

Repetir o mesmo branch em `listHistory` (o `if (input.ownerFilter === 'mine')` atual vira o `if/else if` acima).

- [ ] **Step 8: Rodar testes**

Run: `npx vitest run server/tests/deals-actions.test.ts server/tests/deals-list.test.ts`
Expected: PASS — incluindo o teste novo do default.

- [ ] **Step 9: Commit**

```bash
git add server/services/dealsService.ts server/tests/deals-actions.test.ts
git commit -m "deals: default to lead_no_comercial; owner filter accepts uuid/unassigned"
```

---

## Task 4 — `dealsController.ts`: zod do filtro `owner`

**Files:**
- Modify: `server/controllers/dealsController.ts:12-25, 27-37, 39-54`

- [ ] **Step 1: Escrever teste falhando — filtro por UUID**

Em `server/tests/deals-list.test.ts`, adicionar dentro do `describe('GET /api/deals')`:

```ts
it('owner=<uuid> filtra deals do usuário específico', async () => {
  const { token, userId } = await loginAs();
  const other = await createUser({ email: 'other2@x.com', password: 'pw12345', role: 'comercial' });
  const lead1 = await createLead({ phone: '11000063001' });
  await createDeal({ leadId: lead1.id, ownerUserId: userId });
  const lead2 = await createLead({ phone: '11000063002' });
  await createDeal({ leadId: lead2.id, ownerUserId: other.id });

  const res = await request(app).get(`/api/deals?owner=${other.id}`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.stages.proposta_enviada).toHaveLength(1);
  expect(res.body.stages.proposta_enviada[0].owner.id).toBe(other.id);
});

it('owner=unassigned filtra deals sem dono', async () => {
  const { token } = await loginAs('me3@x.com');
  const lead = await createLead({ phone: '11000063003' });
  await createDeal({ leadId: lead.id, ownerUserId: null });

  const res = await request(app).get('/api/deals?owner=unassigned').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.stages.proposta_enviada.length).toBeGreaterThanOrEqual(1);
  expect(res.body.stages.proposta_enviada.every((d: { owner: unknown }) => d.owner === null)).toBe(true);
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/deals-list.test.ts -t "owner="`
Expected: FAIL — zod rejeita `owner=<uuid>` (`Invalid enum value`) e `owner=unassigned`.

- [ ] **Step 3: Atualizar `boardQuery` e `historyQuery`**

Em `server/controllers/dealsController.ts`:

```ts
const ownerFilter = z.union([
  z.enum(['mine', 'all', 'unassigned']),
  z.string().uuid(),
]);

const boardQuery = z.object({
  owner: ownerFilter.optional(),
  q: z.string().optional(),
});

const historyQuery = z.object({
  owner: ownerFilter.optional(),
  q: z.string().optional(),
  stage: z.enum(['ganho', 'perdido']).optional(),
  lossReason: z.enum(LOSS_REASONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/deals-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/dealsController.ts server/tests/deals-list.test.ts
git commit -m "deals: zod accepts owner=uuid and owner=unassigned"
```

---

## Task 5 — `dashboardService.ts` + `campaignsService.ts`: incluir `lead_no_comercial`

**Files:**
- Modify: `server/services/dashboardService.ts:152-153, 213-214, 221-222`
- Modify: `server/services/campaignsService.ts:306`

- [ ] **Step 1: Escrever teste falhando — pipelineOpen inclui lead_no_comercial**

Em `server/tests/dashboard-summary-org.test.ts`, adicionar:

```ts
it('pipelineOpen.byStage inclui lead_no_comercial', async () => {
  const { token, userId } = await loginAs();
  const lead = await createLead({ phone: '11000071001' });
  await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', proposalValue: 500, ownerUserId: userId });

  const res = await request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const stage = res.body.pipelineOpen.byStage.find((s: { stage: string }) => s.stage === 'lead_no_comercial');
  expect(stage).toBeDefined();
  expect(stage.count).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/dashboard-summary-org.test.ts -t "lead_no_comercial"`
Expected: FAIL — stage ausente do `byStage` (filtro `IN ('proposta_enviada','em_negociacao')` exclui).

- [ ] **Step 3: Atualizar `dashboardService.ts`**

Trocar **as três** ocorrências de `('proposta_enviada', 'em_negociacao')`:

Linhas 152-153:
```ts
const stageFilter = ownerUserId
  ? and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, eq(deals.ownerUserId, ownerUserId))
  : sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`;
```

Linha 166 (cast do tipo):
```ts
stage: r.stage as 'lead_no_comercial' | 'proposta_enviada' | 'em_negociacao',
```

Linhas 221-222 (alerts de stale):
```ts
const stale = ownerUserId
  ? and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, sql`${deals.updatedAt} < now() - interval '5 days'`, eq(deals.ownerUserId, ownerUserId))
  : and(sql`${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`, sql`${deals.updatedAt} < now() - interval '5 days'`);
```

(linhas 213-214, que filtram `eq(deals.stage, 'proposta_enviada')` para `proposal_old`, **não mudam** — esse alert é específico de propostas antigas.)

- [ ] **Step 4: Atualizar `campaignsService.ts:306`**

Trocar:
```ts
if (d.stage === 'proposta_enviada' || d.stage === 'em_negociacao') inDeal++;
```
Por:
```ts
if (d.stage === 'lead_no_comercial' || d.stage === 'proposta_enviada' || d.stage === 'em_negociacao') inDeal++;
```

- [ ] **Step 5: Rodar testes do dashboard e campaigns**

Run: `npx vitest run server/tests/dashboard-summary-org.test.ts server/tests/dashboard-summary-me.test.ts server/tests/campaigns-funnel.test.ts`
Expected: PASS — incluindo o teste novo.

- [ ] **Step 6: Commit**

```bash
git add server/services/dashboardService.ts server/services/campaignsService.ts server/tests/dashboard-summary-org.test.ts
git commit -m "dashboard,campaigns: include lead_no_comercial in active stages"
```

---

## Task 6 — Endpoint `GET /users/assignable`

**Files:**
- Modify: `server/services/usersService.ts`
- Modify: `server/controllers/usersController.ts`
- Modify: `server/routes/users.ts`
- Test: `server/tests/users-assignable.test.ts` (criar)

- [ ] **Step 1: Escrever teste falhando**

Criar `server/tests/users-assignable.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('GET /api/users/assignable', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/users/assignable');
    expect(res.status).toBe(401);
  });

  it('200 para qualquer role autenticada (admin, comercial, recepcao)', async () => {
    const tAdmin = await loginAs('aa@x.com', 'admin');
    const tCom = await loginAs('cc@x.com', 'comercial');
    const tRec = await loginAs('rr@x.com', 'recepcao');

    for (const t of [tAdmin, tCom, tRec]) {
      const res = await request(app).get('/api/users/assignable').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    }
  });

  it('só lista admin/comercial ativos; não inclui recepcao', async () => {
    const tAdmin = await loginAs('a2@x.com', 'admin');
    await createUser({ email: 'c2@x.com', password: 'pw12345', role: 'comercial' });
    await createUser({ email: 'r2@x.com', password: 'pw12345', role: 'recepcao' });

    const res = await request(app).get('/api/users/assignable').set('Authorization', `Bearer ${tAdmin}`);
    const roles = res.body.users.map((u: { role: string }) => u.role);
    expect(roles).toContain('admin');
    expect(roles).toContain('comercial');
    expect(roles).not.toContain('recepcao');

    const sample = res.body.users[0];
    expect(Object.keys(sample).sort()).toEqual(['id', 'name', 'role']);
  });

  it('GET /api/users continua 403 pra comercial e recepcao', async () => {
    const tCom = await loginAs('c3@x.com', 'comercial');
    const tRec = await loginAs('r3@x.com', 'recepcao');
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${tCom}`)).status).toBe(403);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${tRec}`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/users-assignable.test.ts`
Expected: FAIL — `404 Not Found` em `/api/users/assignable`.

- [ ] **Step 3: Implementar `listAssignableUsers`**

Em `server/services/usersService.ts`, adicionar:

```ts
export async function listAssignableUsers() {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ['admin', 'comercial'])))
    .orderBy(asc(users.name));
  return rows;
}
```

E garantir os imports no topo:
```ts
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
```

- [ ] **Step 4: Implementar handler**

Em `server/controllers/usersController.ts`, adicionar (depois do `listHandler`):

```ts
export async function listAssignableHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const list = await listAssignableUsers();
    res.json({ users: list });
  } catch (e) {
    next(e);
  }
}
```

E no import no topo, adicionar `listAssignableUsers` à lista vinda de `'../services/usersService'`.

- [ ] **Step 5: Registrar rota**

Em `server/routes/users.ts`, **antes** de `router.patch('/:id', ...)` (pra evitar colisão com `/:id`):

```ts
import {
  inviteHandler,
  listHandler,
  updateHandler,
  resendInviteHandler,
  listAssignableHandler,
} from '../controllers/usersController';
```

E:
```ts
router.get('/assignable', authGuard, listAssignableHandler);
router.get('/', authGuard, requireRole('admin'), listHandler);
```

- [ ] **Step 6: Rodar testes**

Run: `npx vitest run server/tests/users-assignable.test.ts`
Expected: PASS (todos os 4 casos).

- [ ] **Step 7: Commit**

```bash
git add server/services/usersService.ts server/controllers/usersController.ts server/routes/users.ts server/tests/users-assignable.test.ts
git commit -m "users: add GET /users/assignable for any authenticated role"
```

---

## Task 7 — Frontend: `api.ts` (filter type + useAssignableUsers)

**Files:**
- Modify: `src/features/inside-sales/api.ts`

- [ ] **Step 1: Atualizar `BoardFilters` e `HistoryFilters`**

Trocar:
```ts
export interface BoardFilters {
  owner?: 'mine' | 'all';
  q?: string;
}
```
Por:
```ts
export type OwnerFilter = 'mine' | 'all' | 'unassigned' | string; // string = UUID

export interface BoardFilters {
  owner?: OwnerFilter;
  q?: string;
}
```

E em `HistoryFilters`, mesmo: `owner?: OwnerFilter;`.

- [ ] **Step 2: Adicionar hook de usuários atribuíveis**

No final do arquivo:

```ts
// ---------------------------------------------------------------------------
// Usuários atribuíveis (admin + comercial ativos)
// ---------------------------------------------------------------------------

export interface AssignableUser {
  id: string;
  name: string;
  role: 'admin' | 'comercial';
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api<{ users: AssignableUser[] }>('/users/assignable').then((r) => r.users),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: erros apenas nos consumidores (KanbanBoard, DealDrawer) — serão corrigidos nas próximas tasks.

- [ ] **Step 4: Commit**

```bash
git add src/features/inside-sales/api.ts
git commit -m "inside-sales(api): owner filter accepts uuid; add useAssignableUsers"
```

---

## Task 8 — Frontend: helpers + DealCard accent + Dashboard label

**Files:**
- Modify: `src/features/inside-sales/helpers.ts:20-32`
- Modify: `src/features/inside-sales/DealCard.tsx:14-19`
- Modify: `src/pages/dashboard/components/PipelineOpen.tsx:5-8`

- [ ] **Step 1: Atualizar `STAGE_LABELS` e `STAGE_COLORS`**

Em `helpers.ts`:

```ts
export const STAGE_LABELS: Record<DealStage, string> = {
  lead_no_comercial: 'Lead no Comercial',
  proposta_enviada: 'Proposta enviada',
  em_negociacao: 'Em negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

export const STAGE_COLORS: Record<DealStage, string> = {
  lead_no_comercial: 'text-muted-foreground',
  proposta_enviada: 'text-primary',
  em_negociacao: 'text-primary',
  ganho: 'text-emerald-500',
  perdido: 'text-destructive',
};
```

- [ ] **Step 2: Atualizar `STAGE_ACCENT` em DealCard**

Em `DealCard.tsx`:

```ts
const STAGE_ACCENT: Record<string, string> = {
  lead_no_comercial: 'var(--lc-navy-soft)',
  proposta_enviada: 'var(--lc-navy)',
  em_negociacao: 'var(--lc-amber)',
  ganho: 'hsl(var(--success))',
  perdido: 'var(--lc-ruby)',
};
```

- [ ] **Step 3: Atualizar `STAGE_LABEL` no dashboard**

Em `src/pages/dashboard/components/PipelineOpen.tsx`:

```ts
const STAGE_LABEL: Record<string, string> = {
  lead_no_comercial: 'Lead no Comercial',
  proposta_enviada: 'Proposta enviada',
  em_negociacao:    'Em negociação',
};
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: Records de `STAGE_LABELS`/`STAGE_COLORS` agora completos. Restam erros apenas em `KanbanBoard` e `DealDrawer`.

- [ ] **Step 5: Commit**

```bash
git add src/features/inside-sales/helpers.ts src/features/inside-sales/DealCard.tsx src/pages/dashboard/components/PipelineOpen.tsx
git commit -m "inside-sales(ui): labels/colors for lead_no_comercial stage"
```

---

## Task 9 — Frontend: KanbanBoard com Select de dono e 5 colunas

**Files:**
- Modify: `src/features/inside-sales/KanbanBoard.tsx`

- [ ] **Step 1: Imports**

Substituir o bloco de imports do topo por:

```tsx
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { useBoard, useChangeStage, useAssignableUsers, type OwnerFilter } from './api';
import { KanbanColumn } from './KanbanColumn';
import { AddDealDialog } from './AddDealDialog';
import { LossReasonDialog } from './LossReasonDialog';
import { GanhoValueDialog } from './GanhoValueDialog';
import { DealDrawer } from './DealDrawer';
import { DEAL_STAGES } from '@shared/types';
import type { DealStage, PublicDeal, LossReason } from './types';
```

- [ ] **Step 2: Substituir leitura do `owner` (passa a aceitar uuid)**

Trocar:
```tsx
const owner = (searchParams.get('owner') as 'mine' | 'all') || 'mine';
```
Por:
```tsx
const owner: OwnerFilter = (searchParams.get('owner') as OwnerFilter) || 'mine';
```

- [ ] **Step 3: Carregar usuários atribuíveis**

Logo após o `useState(searchInput…)`:

```tsx
const { data: assignableUsers } = useAssignableUsers();
```

- [ ] **Step 4: Substituir as duas pílulas por `Select`**

Trocar todo o bloco:
```tsx
<div className="flex gap-1.5">
  <button … >Meus deals</button>
  <button … >Todos</button>
</div>
```
Por:
```tsx
<Select value={owner} onValueChange={(v) => patch({ owner: v === 'mine' ? null : v })}>
  <SelectTrigger className="h-9 w-[180px] text-xs">
    <SelectValue placeholder="Filtrar por dono" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value="mine">Meus deals</SelectItem>
      <SelectItem value="all">Todos</SelectItem>
      <SelectItem value="unassigned">Sem dono</SelectItem>
    </SelectGroup>
    {assignableUsers && assignableUsers.length > 0 && (
      <>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Por usuário</SelectLabel>
          {assignableUsers.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.id === currentUserId ? `${u.name} (você)` : u.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </>
    )}
  </SelectContent>
</Select>
```

(Observação: `patch({ owner: v === 'mine' ? null : v })` mantém URL limpa quando o filtro é o default.)

- [ ] **Step 5: Trocar grid pra 5 colunas com fallback de scroll**

Trocar:
```tsx
<div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden">
```
Por:
```tsx
<div className="flex-1 grid grid-cols-5 gap-3 overflow-x-auto">
```

E na coluna (KanbanColumn) **não** mexer — `KanbanColumn.tsx` continua com `flex flex-col`. Mas pra resiliência em telas estreitas, garantir `min-w-[220px]` no wrapper raiz da `KanbanColumn`. Editar `src/features/inside-sales/KanbanColumn.tsx` linha 22:

```tsx
className={`flex flex-col min-w-[220px] bg-background border rounded-lg overflow-hidden transition-colors ${
  isOver ? 'border-primary bg-primary/5' : 'border-border'
}`}
```

- [ ] **Step 6: Rodar typecheck e dev server**

Run: `npx tsc --noEmit`
Expected: erros restantes apenas em `DealDrawer.tsx` (próxima task).

Run: `npm run dev` (em outro terminal)
Smoke manual:
- abrir `/inside-sales` — deve aparecer 5 colunas, "Lead no Comercial" à esquerda.
- abrir o `Select` — opções fixas + lista de usuários.
- selecionar um usuário — URL passa a `?owner=<uuid>`, board recarrega filtrado.
- selecionar "Sem dono" — URL passa a `?owner=unassigned`.

- [ ] **Step 7: Commit**

```bash
git add src/features/inside-sales/KanbanBoard.tsx src/features/inside-sales/KanbanColumn.tsx
git commit -m "inside-sales(kanban): owner filter Select + 5-column grid"
```

---

## Task 10 — Frontend: DealDrawer com Select de dono

**Files:**
- Modify: `src/features/inside-sales/DealDrawer.tsx:115-119`

- [ ] **Step 1: Imports**

Adicionar ao bloco de imports:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/features/auth/store';
import { useDeal, usePatchDeal, useAssignableUsers } from './api';
```

(Substitui o `useDeal, usePatchDeal` existente — note o `useAssignableUsers` somado.)

- [ ] **Step 2: Carregar usuário atual e lista**

Logo após `const patch = usePatchDeal();`:

```tsx
const currentUserId = useAuthStore((s) => s.user?.id ?? '');
const { data: assignableUsers } = useAssignableUsers();
```

- [ ] **Step 3: Função de troca**

Logo após `saveNotes`:

```tsx
async function changeOwner(value: string) {
  if (!deal || readOnly) return;
  const next = value === '__none' ? null : value;
  if (next === (deal.owner?.id ?? null)) return;
  try {
    await patch.mutateAsync({ id: deal.id, ownerUserId: next });
  } catch {
    toast.error('Falha ao alterar dono.');
  }
}
```

- [ ] **Step 4: Substituir a linha estática "Dono"**

Trocar:
```tsx
<div className="flex justify-between items-center text-sm">
  <span className="text-muted-foreground">Dono</span>
  <span className="font-semibold">{deal.owner?.name ?? 'Sem dono'}</span>
</div>
```
Por:
```tsx
<div className="flex justify-between items-center text-sm">
  <span className="text-muted-foreground">Dono</span>
  {readOnly ? (
    <span className="font-semibold">{deal.owner?.name ?? 'Sem dono'}</span>
  ) : (
    <Select
      value={deal.owner?.id ?? '__none'}
      onValueChange={changeOwner}
      disabled={patch.isPending}
    >
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Sem dono</SelectItem>
        {assignableUsers?.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.id === currentUserId ? `${u.name} (você)` : u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )}
</div>
```

- [ ] **Step 5: Typecheck + smoke**

Run: `npx tsc --noEmit`
Expected: 0 erros.

Smoke manual:
- abrir um deal no drawer; o Select mostra o dono atual.
- trocar dono → toast some, atividade aparece no log com kind `owner_changed`.
- atribuir "Sem dono" → card no Kanban passa a mostrar "Sem dono" no rodapé.
- abrir deal no histórico → `readOnly=true` mostra texto estático.

- [ ] **Step 6: Commit**

```bash
git add src/features/inside-sales/DealDrawer.tsx
git commit -m "inside-sales(drawer): assign/reassign deal owner via Select"
```

---

## Task 11 — Verificação final

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: sucesso (typecheck client + server + vite build).

- [ ] **Step 2: Suite de testes completa**

Run: `npm test`
Expected: todos os testes passam (incluindo os adicionados nas Tasks 3, 4, 5, 6).

- [ ] **Step 3: Smoke manual end-to-end**

Em `npm run dev`:
1. Login como admin → `/inside-sales`.
2. "Adicionar ao pipeline" um lead → deve cair em **Lead no Comercial** (1ª coluna).
3. Arrastar pra **Proposta enviada** → activity log no drawer registra `stage_changed`.
4. No drawer, trocar o dono pra outro usuário → activity log registra `owner_changed`.
5. No filtro do Kanban, selecionar esse outro usuário → ver só os deals dele.
6. Selecionar "Sem dono" → filtra deals sem owner.
7. Login como `comercial` (não admin) → conseguir trocar dono e listar `/users/assignable` (não pode listar `/users`).
8. Dashboard `/dashboard` — bloco "Pipeline em aberto" deve mostrar a linha **Lead no Comercial**.

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git status
# Se houver mudanças residuais, commitar; caso contrário, pular.
```
