# Cadastros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar CRUD de leads + import CSV em `/cadastros`, conforme spec `docs/superpowers/specs/2026-04-30-cadastros-design.md`.

**Architecture:** Backend Express com endpoints em `/api/leads/*` atrás de `authGuard` (sem `requireRole` — qualquer role autenticado). Service layer separa CRUD de import (parse + persist em duas fases). Frontend espelha o módulo `admin` (TanStack Query + shadcn/ui + dialogs). Migration 008 adiciona email/notes/status/source à tabela `leads`.

**Tech Stack:** Express + Drizzle 0.45 + Zod 4 + multer + csv-parse + Postgres 16 (schemas `lubritec` / `lubritec_test`); React 19 + Vite + TanStack Query + shadcn/ui + react-hook-form + sonner.

---

## File map

**Criar:**
- `server/db/migrations/008_leads_extra.sql`
- `server/services/leadsService.ts` (CRUD)
- `server/services/leadsImport.ts` (parse CSV + validação)
- `server/controllers/leadsController.ts` (handlers + Zod)
- `server/routes/leads.ts`
- `server/middleware/multerCsv.ts` (config multer + filtro mime)
- `server/tests/leads-service.test.ts`
- `server/tests/leads-api.test.ts`
- `server/tests/fixtures/leads-sample.csv`
- `src/features/leads/api.ts`
- `src/features/leads/translateError.ts`
- `src/features/leads/LeadsTable.tsx`
- `src/features/leads/LeadFilters.tsx`
- `src/features/leads/LeadDialog.tsx`
- `src/features/leads/LeadActions.tsx`
- `src/features/leads/ImportCsvDialog.tsx`

**Modificar:**
- `shared/types.ts` (adicionar `LEAD_STATUSES`, `LEAD_SOURCES`, `PublicLead`, `ImportReport`)
- `server/db/schema.ts` (adicionar `email`, `notes`, `status`, `source` em `leads`)
- `server/app.ts` (registrar `leadRoutes`)
- `src/pages/cadastros/CadastrosPage.tsx` (substituir placeholder)
- `README.md` (marcar item 2 do roadmap, adicionar seção "Cadastros")

---

## Task 1 — Schema, migration e tipos compartilhados

**Files:**
- Create: `server/db/migrations/008_leads_extra.sql`
- Modify: `shared/types.ts`
- Modify: `server/db/schema.ts`

- [ ] **Step 1.1:** Escrever a migration SQL.

Cria `server/db/migrations/008_leads_extra.sql`:

```sql
ALTER TABLE leads
  ADD COLUMN email TEXT,
  ADD COLUMN notes TEXT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'frio'
    CHECK (status IN ('frio', 'morno', 'quente')),
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'whatsapp'));

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created_at ON leads(created_at);
```

- [ ] **Step 1.2:** Aplicar migration nos dois schemas.

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Esperado: `→ 008_leads_extra.sql (applied)` em ambos.

- [ ] **Step 1.3:** Adicionar constantes e tipos em `shared/types.ts`.

Editar `shared/types.ts`. Antes da última linha do arquivo, adicionar:

```ts
export const LEAD_STATUSES = ['frio', 'morno', 'quente'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['manual', 'csv', 'whatsapp'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface PublicLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  lastPurchaseDate: string | null;
  avgMileagePerDay: number | null;
  status: LeadStatus;
  source: LeadSource;
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}
```

- [ ] **Step 1.4:** Atualizar drizzle schema em `server/db/schema.ts`.

Localizar `export const leads = pgTable(...)` (linha ~64). Adicionar import do topo se faltar:

```ts
import { LEAD_STATUSES, LEAD_SOURCES } from '../../shared/types';
```

Substituir o bloco da tabela `leads` por:

```ts
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  notes: text('notes'),
  vehiclePlate: text('vehicle_plate'),
  vehicleModel: text('vehicle_model'),
  lastPurchaseDate: date('last_purchase_date'),
  avgMileagePerDay: integer('avg_mileage_per_day').default(50),
  status: text('status', { enum: LEAD_STATUSES }).notNull().default('frio'),
  source: text('source', { enum: LEAD_SOURCES }).notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 1.5:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo (sem erros).

- [ ] **Step 1.6:** Commit.

```bash
git add server/db/migrations/008_leads_extra.sql shared/types.ts server/db/schema.ts
git commit -m "feat(leads): schema migration 008 + shared types"
```

---

## Task 2 — Helper de teste para leads

**Files:**
- Modify: `server/tests/helpers.ts`

- [ ] **Step 2.1:** Adicionar helper `createLead` em `server/tests/helpers.ts`.

Adicionar imports no topo (manter os já existentes de `users`/etc):

```ts
import { leads } from '../db/schema';
import type { LeadStatus, LeadSource } from '@shared/types';
```

Adicionar no fim do arquivo:

```ts
export async function createLead(opts: {
  name?: string;
  phone?: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
  status?: LeadStatus;
  source?: LeadSource;
}) {
  const [l] = await db
    .insert(leads)
    .values({
      name: opts.name ?? 'Lead Test',
      phone: opts.phone ?? `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: opts.email ?? null,
      notes: opts.notes ?? null,
      vehiclePlate: opts.vehiclePlate ?? null,
      vehicleModel: opts.vehicleModel ?? null,
      lastPurchaseDate: opts.lastPurchaseDate ?? null,
      avgMileagePerDay: opts.avgMileagePerDay ?? null,
      status: opts.status ?? 'frio',
      source: opts.source ?? 'manual',
    })
    .returning();
  return l;
}
```

- [ ] **Step 2.2:** Lint e commit.

```bash
npm run lint
git add server/tests/helpers.ts
git commit -m "test(leads): add createLead helper"
```

---

## Task 3 — leadsService: createLead (TDD)

**Files:**
- Create: `server/services/leadsService.ts`
- Create: `server/tests/leads-service.test.ts`

- [ ] **Step 3.1:** Escrever testes vermelhos para `createLead`.

Criar `server/tests/leads-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLead, listLeads, updateLead, deleteLead } from '../services/leadsService';
import { HttpError } from '../middleware/errorHandler';
import { createLead as seedLead } from './helpers';

describe('createLead', () => {
  it('cria lead com defaults frio/manual', async () => {
    const lead = await createLead({ name: 'Maria', phone: '11999998888' });
    expect(lead.status).toBe('frio');
    expect(lead.source).toBe('manual');
    expect(lead.phone).toBe('11999998888');
    expect(lead.id).toBeDefined();
  });

  it('normaliza phone (remove não-dígitos)', async () => {
    const lead = await createLead({ name: 'Joao', phone: '(11) 99999-7777' });
    expect(lead.phone).toBe('11999997777');
  });

  it('rejeita phone duplicado com 409', async () => {
    await createLead({ name: 'A', phone: '11999996666' });
    await expect(createLead({ name: 'B', phone: '11999996666' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('aceita campos opcionais', async () => {
    const lead = await createLead({
      name: 'Carlos',
      phone: '11888887777',
      email: 'carlos@x.com',
      notes: 'cliente VIP',
      vehiclePlate: 'ABC1D23',
      vehicleModel: 'Civic',
      lastPurchaseDate: '2026-01-15',
      avgMileagePerDay: 80,
    });
    expect(lead.email).toBe('carlos@x.com');
    expect(lead.notes).toBe('cliente VIP');
    expect(lead.vehiclePlate).toBe('ABC1D23');
    expect(lead.lastPurchaseDate).toBe('2026-01-15');
    expect(lead.avgMileagePerDay).toBe(80);
  });
});
```

- [ ] **Step 3.2:** Rodar e ver vermelho.

```bash
npm test -- leads-service
```

Esperado: 4 testes falham com "Cannot find module '../services/leadsService'".

- [ ] **Step 3.3:** Implementar `createLead`.

Criar `server/services/leadsService.ts`:

```ts
import { db } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead } from '@shared/types';

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function toPublic(row: typeof leads.$inferSelect): PublicLead {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    vehiclePlate: row.vehiclePlate,
    vehicleModel: row.vehicleModel,
    lastPurchaseDate: row.lastPurchaseDate,
    avgMileagePerDay: row.avgMileagePerDay,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createLead(input: {
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
}): Promise<PublicLead> {
  const phone = normalizePhone(input.phone);
  const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (existing) throw new HttpError(409, 'Phone already in use');
  const [row] = await db
    .insert(leads)
    .values({
      name: input.name,
      phone,
      email: input.email ?? null,
      notes: input.notes ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      vehicleModel: input.vehicleModel ?? null,
      lastPurchaseDate: input.lastPurchaseDate ?? null,
      avgMileagePerDay: input.avgMileagePerDay ?? null,
    })
    .returning();
  return toPublic(row);
}
```

- [ ] **Step 3.4:** Rodar e ver verde.

```bash
npm test -- leads-service
```

Esperado: 4/4 passando.

- [ ] **Step 3.5:** Commit.

```bash
git add server/services/leadsService.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): createLead service with phone normalization"
```

---

## Task 4 — leadsService: updateLead, deleteLead (TDD)

**Files:**
- Modify: `server/services/leadsService.ts`
- Modify: `server/tests/leads-service.test.ts`

- [ ] **Step 4.1:** Adicionar testes vermelhos.

Adicionar no fim de `server/tests/leads-service.test.ts`:

```ts
describe('updateLead', () => {
  it('atualiza nome e status', async () => {
    const seed = await seedLead({ name: 'Old', phone: '11999990000' });
    const updated = await updateLead({ id: seed.id, name: 'New', status: 'morno' });
    expect(updated.name).toBe('New');
    expect(updated.status).toBe('morno');
  });

  it('partial update preserva campos não enviados', async () => {
    const seed = await seedLead({ name: 'Mario', phone: '11999991111', email: 'm@x.com' });
    const updated = await updateLead({ id: seed.id, notes: 'novo' });
    expect(updated.name).toBe('Mario');
    expect(updated.email).toBe('m@x.com');
    expect(updated.notes).toBe('novo');
  });

  it('404 quando id não existe', async () => {
    await expect(
      updateLead({ id: '00000000-0000-0000-0000-000000000000', name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('deleteLead', () => {
  it('deleta e retorna void', async () => {
    const seed = await seedLead({ phone: '11999992222' });
    await deleteLead(seed.id);
    await expect(deleteLead(seed.id)).rejects.toMatchObject({ status: 404 });
  });

  it('404 quando id não existe', async () => {
    await expect(deleteLead('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
  });
});
```

- [ ] **Step 4.2:** Rodar e ver vermelho.

```bash
npm test -- leads-service
```

Esperado: 5 testes novos falham com `updateLead is not a function` / `deleteLead is not a function`.

- [ ] **Step 4.3:** Implementar `updateLead` e `deleteLead`.

Adicionar em `server/services/leadsService.ts`:

```ts
import type { LeadStatus } from '@shared/types';

export async function updateLead(input: {
  id: string;
  name?: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
  status?: LeadStatus;
}): Promise<PublicLead> {
  const { id, ...rest } = input;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) patch[k] = v;
  }
  patch.updatedAt = new Date();
  const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  if (!row) throw new HttpError(404, 'Lead not found');
  return toPublic(row);
}

export async function deleteLead(id: string): Promise<void> {
  const [row] = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
  if (!row) throw new HttpError(404, 'Lead not found');
}
```

- [ ] **Step 4.4:** Rodar e ver verde.

```bash
npm test -- leads-service
```

Esperado: 9/9 passando.

- [ ] **Step 4.5:** Commit.

```bash
git add server/services/leadsService.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): updateLead + deleteLead services"
```

---

## Task 5 — leadsService: listLeads com filtros, sort, paginação (TDD)

**Files:**
- Modify: `server/services/leadsService.ts`
- Modify: `server/tests/leads-service.test.ts`

- [ ] **Step 5.1:** Adicionar testes vermelhos.

Adicionar em `server/tests/leads-service.test.ts`:

```ts
describe('listLeads', () => {
  it('paginação retorna 50 e total correto', async () => {
    for (let i = 0; i < 60; i++) {
      await seedLead({ phone: `551199990${String(i).padStart(4, '0')}`, name: `Lead ${i}` });
    }
    const page1 = await listLeads({ page: 1 });
    expect(page1.items).toHaveLength(50);
    expect(page1.total).toBe(60);
    expect(page1.pageSize).toBe(50);
    const page2 = await listLeads({ page: 2 });
    expect(page2.items).toHaveLength(10);
  });

  it('filtra por status', async () => {
    await seedLead({ phone: '11000000001', status: 'frio' });
    await seedLead({ phone: '11000000002', status: 'morno' });
    await seedLead({ phone: '11000000003', status: 'quente' });
    const res = await listLeads({ status: 'morno' });
    expect(res.total).toBe(1);
    expect(res.items[0].status).toBe('morno');
  });

  it('filtra por source', async () => {
    await seedLead({ phone: '11000000010', source: 'manual' });
    await seedLead({ phone: '11000000011', source: 'csv' });
    const res = await listLeads({ source: 'csv' });
    expect(res.total).toBe(1);
    expect(res.items[0].source).toBe('csv');
  });

  it('busca por name (q)', async () => {
    await seedLead({ name: 'Antonio Silva', phone: '11000000020' });
    await seedLead({ name: 'Beatriz Souza', phone: '11000000021' });
    const res = await listLeads({ q: 'Antonio' });
    expect(res.total).toBe(1);
    expect(res.items[0].name).toBe('Antonio Silva');
  });

  it('busca por phone (q)', async () => {
    await seedLead({ name: 'X', phone: '11000000030' });
    const res = await listLeads({ q: '030' });
    expect(res.total).toBe(1);
  });

  it('busca por placa (q)', async () => {
    await seedLead({ name: 'Y', phone: '11000000040', vehiclePlate: 'ABC1D23' });
    const res = await listLeads({ q: 'ABC1D23' });
    expect(res.total).toBe(1);
  });

  it('sort por name asc', async () => {
    await seedLead({ name: 'Charlie', phone: '11000000050' });
    await seedLead({ name: 'Alice', phone: '11000000051' });
    await seedLead({ name: 'Bob', phone: '11000000052' });
    const res = await listLeads({ sort: 'name', order: 'asc' });
    expect(res.items.map((l) => l.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('default sort é created_at desc', async () => {
    const a = await seedLead({ name: 'Old', phone: '11000000060' });
    await new Promise((r) => setTimeout(r, 10));
    const b = await seedLead({ name: 'New', phone: '11000000061' });
    const res = await listLeads({});
    expect(res.items[0].id).toBe(b.id);
    expect(res.items[1].id).toBe(a.id);
  });
});
```

- [ ] **Step 5.2:** Rodar e ver vermelho.

```bash
npm test -- leads-service
```

Esperado: 8 novos testes falham com `listLeads is not a function`.

- [ ] **Step 5.3:** Implementar `listLeads`.

Adicionar em `server/services/leadsService.ts`. Atualizar imports do drizzle:

```ts
import { eq, and, or, ilike, desc, asc, sql } from 'drizzle-orm';
import type { LeadStatus, LeadSource } from '@shared/types';
```

Adicionar a função:

```ts
const PAGE_SIZE = 50;
type SortKey = 'name' | 'created_at' | 'last_purchase_date';
const SORT_COLUMNS = {
  name: leads.name,
  created_at: leads.createdAt,
  last_purchase_date: leads.lastPurchaseDate,
} as const;

export async function listLeads(params: {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  sort?: SortKey;
  order?: 'asc' | 'desc';
  page?: number;
}): Promise<{ items: PublicLead[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const sortKey: SortKey = params.sort ?? 'created_at';
  const orderFn = params.order === 'asc' ? asc : desc;
  const sortCol = SORT_COLUMNS[sortKey];

  const conditions = [];
  if (params.status) conditions.push(eq(leads.status, params.status));
  if (params.source) conditions.push(eq(leads.source, params.source));
  if (params.q) {
    const pat = `%${params.q}%`;
    conditions.push(
      or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.vehiclePlate, pat))!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return { items: rows.map(toPublic), total, page, pageSize: PAGE_SIZE };
}
```

- [ ] **Step 5.4:** Rodar e ver verde.

```bash
npm test -- leads-service
```

Esperado: 17/17 passando (4 createLead + 5 update/delete + 8 listLeads).

- [ ] **Step 5.5:** Commit.

```bash
git add server/services/leadsService.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): listLeads with filters, sort, pagination"
```

---

## Task 6 — Controller + rotas: GET, POST, PATCH, DELETE (TDD)

**Files:**
- Create: `server/controllers/leadsController.ts`
- Create: `server/routes/leads.ts`
- Create: `server/tests/leads-api.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 6.1:** Escrever testes vermelhos das 4 rotas.

Criar `server/tests/leads-api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead } from './helpers';

const app = createApp();

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function seedAuth() {
  await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao' });
  return loginAs('r@x.com');
}

describe('GET /api/leads', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
  });

  it('200 com lista paginada', async () => {
    const token = await seedAuth();
    await createLead({ name: 'A', phone: '11000001001' });
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });
});

describe('POST /api/leads', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/leads').send({ name: 'X', phone: '11000002001' });
    expect(res.status).toBe(401);
  });

  it('cria lead 200 com defaults', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pedro', phone: '11000002002' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('frio');
    expect(res.body.source).toBe('manual');
  });

  it('400 quando phone tem menos de 8 dígitos após normalização', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Curto', phone: '(11) 12' });
    expect(res.status).toBe(400);
  });

  it('409 quando phone duplicado', async () => {
    const token = await seedAuth();
    await createLead({ phone: '11000002003' });
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup', phone: '11000002003' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/leads/:id', () => {
  it('401 sem token', async () => {
    const lead = await createLead({ phone: '11000003001' });
    const res = await request(app).patch(`/api/leads/${lead.id}`).send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('200 atualiza campos permitidos', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000003002', name: 'Old' });
    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', status: 'quente' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.status).toBe('quente');
  });

  it('400 quando phone está no body', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000003003' });
    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '11000003999' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Phone cannot be edited');
  });

  it('404 quando id não existe', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .patch('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/leads/:id', () => {
  it('401 sem token', async () => {
    const lead = await createLead({ phone: '11000004001' });
    const res = await request(app).delete(`/api/leads/${lead.id}`);
    expect(res.status).toBe(401);
  });

  it('204 ao deletar', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000004002' });
    const res = await request(app)
      .delete(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('404 quando id não existe', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .delete('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6.2:** Rodar e ver vermelho.

```bash
npm test -- leads-api
```

Esperado: testes falham — `Cannot GET/POST/PATCH/DELETE /api/leads` (rota não registrada).

- [ ] **Step 6.3:** Criar controller.

Criar `server/controllers/leadsController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES } from '../../shared/types';
import { createLead, listLeads, updateLead, deleteLead } from '../services/leadsService';

const phoneInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().min(8, 'Phone must have at least 8 digits'));

const editableCore = {
  name: z.string().min(2).max(120),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  vehiclePlate: z.string().max(10).nullable().optional(),
  vehicleModel: z.string().max(60).nullable().optional(),
  lastPurchaseDate: z.string().date().nullable().optional(),
  avgMileagePerDay: z.number().int().nonnegative().nullable().optional(),
};

const createSchema = z.object({ phone: phoneInput, ...editableCore });
const updateSchema = z
  .object({
    ...editableCore,
    status: z.enum(LEAD_STATUSES).optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const idParams = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(['manual', 'csv', 'whatsapp'] as const).optional(),
  sort: z.enum(['name', 'created_at', 'last_purchase_date']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    const result = await listLeads(params);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSchema.parse(req.body);
    const lead = await createLead(body);
    res.json(lead);
  } catch (e) {
    next(e);
  }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if ('phone' in req.body) {
      return res.status(400).json({ error: 'Phone cannot be edited' });
    }
    const { id } = idParams.parse(req.params);
    const body = updateSchema.parse(req.body);
    const lead = await updateLead({ id, ...body });
    res.json(lead);
  } catch (e) {
    next(e);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteLead(id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 6.4:** Criar router.

Criar `server/routes/leads.ts`:

```ts
import { Router } from 'express';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} from '../controllers/leadsController';
import { authGuard } from '../middleware/authGuard';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);

export default router;
```

- [ ] **Step 6.5:** Registrar router em `server/app.ts`.

Adicionar import no topo:

```ts
import leadRoutes from './routes/leads';
```

Adicionar logo após `app.use('/api/users', userRoutes);`:

```ts
app.use('/api/leads', leadRoutes);
```

- [ ] **Step 6.6:** Rodar e ver verde.

```bash
npm test -- leads-api
```

Esperado: 13/13 passando.

- [ ] **Step 6.7:** Lint e commit.

```bash
npm run lint
git add server/controllers/leadsController.ts server/routes/leads.ts server/app.ts server/tests/leads-api.test.ts
git commit -m "feat(leads): GET/POST/PATCH/DELETE endpoints"
```

---

## Task 7 — Service de import CSV: parse e validação (TDD)

**Files:**
- Create: `server/services/leadsImport.ts`
- Modify: `server/tests/leads-service.test.ts`

- [ ] **Step 7.1:** Escrever testes vermelhos do parser.

Adicionar em `server/tests/leads-service.test.ts`:

```ts
import { parseLeadsCsv } from '../services/leadsImport';

describe('parseLeadsCsv', () => {
  it('aceita header EN com vírgula', async () => {
    const csv = `name,phone,email\nAlice,11999990001,a@x.com\nBob,11999990002,\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Alice', phone: '11999990001', email: 'a@x.com' });
    expect(rows[1].email).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('aceita header PT com ponto-e-vírgula', async () => {
    const csv = `nome;telefone;placa\nMaria;(11) 99999-0003;ABC1D23\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: 'Maria',
      phone: '11999990003',
      vehiclePlate: 'ABC1D23',
    });
    expect(rejected).toEqual([]);
  });

  it('rejeita linha com phone vazio', async () => {
    const csv = `name,phone\nA,11999990010\nB,\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].line).toBe(3);
    expect(rejected[0].reason).toMatch(/phone/i);
  });

  it('rejeita linha com email inválido', async () => {
    const csv = `name,phone,email\nA,11999990020,bad-email\n`;
    const { rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/email/i);
  });

  it('rejeita avg_mileage_per_day não numérico', async () => {
    const csv = `name,phone,km_dia\nA,11999990030,abc\n`;
    const { rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toHaveLength(1);
  });

  it('aceita data DD/MM/YYYY e converte para ISO', async () => {
    const csv = `name,phone,ultima_compra\nA,11999990040,15/03/2025\n`;
    const { rows } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows[0].lastPurchaseDate).toBe('2025-03-15');
  });

  it('reporta missingHeaders quando faltam name ou phone', async () => {
    const csv = `nome,email\nA,a@x.com\n`;
    const { missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toContain('phone');
  });

  it('ignora colunas extras', async () => {
    const csv = `name,phone,foo,bar\nA,11999990050,x,y\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rejected).toEqual([]);
  });
});
```

- [ ] **Step 7.2:** Rodar e ver vermelho.

```bash
npm test -- leads-service
```

Esperado: 8 novos testes falham (parseLeadsCsv não existe).

- [ ] **Step 7.3:** Implementar `parseLeadsCsv`.

Criar `server/services/leadsImport.ts`:

```ts
import { parse } from 'csv-parse/sync';

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  nome: 'name',
  phone: 'phone',
  telefone: 'phone',
  email: 'email',
  notes: 'notes',
  observacoes: 'notes',
  observações: 'notes',
  vehicle_plate: 'vehiclePlate',
  placa: 'vehiclePlate',
  vehicle_model: 'vehicleModel',
  modelo: 'vehicleModel',
  last_purchase_date: 'lastPurchaseDate',
  ultima_compra: 'lastPurchaseDate',
  última_compra: 'lastPurchaseDate',
  avg_mileage_per_day: 'avgMileagePerDay',
  km_dia: 'avgMileagePerDay',
};

const REQUIRED = ['name', 'phone'] as const;

export interface CsvRow {
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  lastPurchaseDate: string | null;
  avgMileagePerDay: number | null;
}

function detectDelimiter(buf: Buffer): ',' | ';' {
  const head = buf.subarray(0, 1024).toString('utf8');
  const first = head.split(/\r?\n/)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

function parseDateBR(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export async function parseLeadsCsv(buf: Buffer): Promise<{
  rows: CsvRow[];
  rejected: { line: number; reason: string }[];
  missingHeaders: string[];
}> {
  const delimiter = detectDelimiter(buf);
  const records = parse(buf, { delimiter, columns: false, skip_empty_lines: true, trim: true });
  if (records.length === 0) return { rows: [], rejected: [], missingHeaders: [...REQUIRED] };

  const headerRow = records[0] as string[];
  const mapped = headerRow.map(normalizeHeader);
  const missingHeaders = REQUIRED.filter((req) => !mapped.includes(req));
  if (missingHeaders.length > 0) return { rows: [], rejected: [], missingHeaders };

  const rows: CsvRow[] = [];
  const rejected: { line: number; reason: string }[] = [];

  for (let i = 1; i < records.length; i++) {
    const line = i + 1;
    const raw = records[i] as string[];
    const obj: Record<string, string> = {};
    mapped.forEach((key, idx) => {
      if (key) obj[key] = raw[idx] ?? '';
    });

    const name = (obj.name ?? '').trim();
    if (!name) {
      rejected.push({ line, reason: 'name vazio' });
      continue;
    }

    const phoneRaw = (obj.phone ?? '').trim();
    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      rejected.push({ line, reason: 'phone vazio ou inválido' });
      continue;
    }

    const email = (obj.email ?? '').trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rejected.push({ line, reason: 'email inválido' });
      continue;
    }

    let lastPurchaseDate: string | null = null;
    const dateRaw = (obj.lastPurchaseDate ?? '').trim();
    if (dateRaw) {
      lastPurchaseDate = parseDateBR(dateRaw);
      if (!lastPurchaseDate) {
        rejected.push({ line, reason: 'data inválida' });
        continue;
      }
    }

    let avgMileagePerDay: number | null = null;
    const mileageRaw = (obj.avgMileagePerDay ?? '').trim();
    if (mileageRaw) {
      const n = Number(mileageRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        rejected.push({ line, reason: 'avg_mileage_per_day inválido' });
        continue;
      }
      avgMileagePerDay = n;
    }

    rows.push({
      name,
      phone,
      email,
      notes: (obj.notes ?? '').trim() || null,
      vehiclePlate: (obj.vehiclePlate ?? '').trim() || null,
      vehicleModel: (obj.vehicleModel ?? '').trim() || null,
      lastPurchaseDate,
      avgMileagePerDay,
    });
  }

  return { rows, rejected, missingHeaders: [] };
}
```

- [ ] **Step 7.4:** Rodar e ver verde.

```bash
npm test -- leads-service
```

Esperado: todos os testes verdes.

- [ ] **Step 7.5:** Commit.

```bash
git add server/services/leadsImport.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): CSV parser with PT/EN headers and per-line validation"
```

---

## Task 8 — Service de persistência do import (TDD)

**Files:**
- Modify: `server/services/leadsImport.ts`
- Modify: `server/tests/leads-service.test.ts`

- [ ] **Step 8.1:** Escrever testes vermelhos do importer.

Adicionar em `server/tests/leads-service.test.ts`:

```ts
import { importLeadsFromCsv } from '../services/leadsImport';

describe('importLeadsFromCsv', () => {
  it('insere linhas novas com source=csv e status=frio', async () => {
    const csv = `name,phone\nA,11888880001\nB,11888880002\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.rejected).toEqual([]);
    const list = await listLeads({ source: 'csv' });
    expect(list.total).toBe(2);
    expect(list.items[0].status).toBe('frio');
  });

  it('upsert seletivo: preenche só campos vazios, nunca sobrescreve', async () => {
    await seedLead({
      name: 'Maria Original',
      phone: '11888880010',
      email: 'maria@x.com',
      notes: null,
      source: 'manual',
    });
    const csv = `name,phone,email,notes\nMaria CSV,11888880010,csv@x.com,nota nova\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(1);
    const list = await listLeads({ q: '11888880010' });
    expect(list.items[0].name).toBe('Maria Original');
    expect(list.items[0].email).toBe('maria@x.com');
    expect(list.items[0].notes).toBe('nota nova');
    expect(list.items[0].source).toBe('manual');
  });

  it('linhas inválidas viram rejected, não abortam', async () => {
    const csv = `name,phone\nA,11888880020\n,11888880021\nB,11888880022\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(2);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].line).toBe(3);
  });

  it('retorna missingHeaders quando faltam obrigatórias (sem persistir)', async () => {
    const csv = `nome\nA\n`;
    await expect(importLeadsFromCsv(Buffer.from(csv))).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 8.2:** Rodar e ver vermelho.

```bash
npm test -- leads-service
```

Esperado: 4 testes novos falham (`importLeadsFromCsv` não existe).

- [ ] **Step 8.3:** Implementar `importLeadsFromCsv`.

Adicionar em `server/services/leadsImport.ts`:

```ts
import { db } from '../db/client';
import { leads } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { ImportReport } from '@shared/types';

const TEXT_FIELDS: (keyof CsvRow)[] = [
  'name',
  'email',
  'notes',
  'vehiclePlate',
  'vehicleModel',
];

export async function importLeadsFromCsv(buf: Buffer): Promise<ImportReport> {
  const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
  if (missingHeaders.length > 0) {
    throw new HttpError(400, `Missing required column: ${missingHeaders.join(', ')}`);
  }
  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(eq(leads.phone, row.phone))
        .limit(1);

      if (!existing) {
        await tx.insert(leads).values({
          name: row.name,
          phone: row.phone,
          email: row.email,
          notes: row.notes,
          vehiclePlate: row.vehiclePlate,
          vehicleModel: row.vehicleModel,
          lastPurchaseDate: row.lastPurchaseDate,
          avgMileagePerDay: row.avgMileagePerDay,
          source: 'csv',
          status: 'frio',
        });
        inserted++;
        continue;
      }

      const patch: Record<string, unknown> = {};
      for (const key of TEXT_FIELDS) {
        const incoming = row[key];
        const current = (existing as Record<string, unknown>)[key];
        if (incoming != null && (current == null || current === '')) {
          patch[key] = incoming;
        }
      }
      if (row.lastPurchaseDate && existing.lastPurchaseDate == null) {
        patch.lastPurchaseDate = row.lastPurchaseDate;
      }
      if (row.avgMileagePerDay != null && existing.avgMileagePerDay == null) {
        patch.avgMileagePerDay = row.avgMileagePerDay;
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
      }
      updated++;
    }
  });

  return { inserted, updated, skipped: 0, rejected };
}
```

- [ ] **Step 8.4:** Rodar e ver verde.

```bash
npm test -- leads-service
```

Esperado: todos verdes.

- [ ] **Step 8.5:** Commit.

```bash
git add server/services/leadsImport.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): import CSV with selective upsert in transaction"
```

---

## Task 9 — Endpoint de import com multer (TDD)

**Files:**
- Create: `server/middleware/multerCsv.ts`
- Create: `server/tests/fixtures/leads-sample.csv`
- Modify: `server/controllers/leadsController.ts`
- Modify: `server/routes/leads.ts`
- Modify: `server/tests/leads-api.test.ts`

- [ ] **Step 9.1:** Criar fixture CSV.

Criar `server/tests/fixtures/leads-sample.csv`:

```
name,phone,email,placa
Ana Importada,11000099001,ana@imp.com,XYZ1A23
Bruno Importado,11000099002,,
,11000099003,sem-nome@x.com,
```

(3 linhas: 2 válidas, 1 rejeitada por name vazio)

- [ ] **Step 9.2:** Escrever testes vermelhos.

Adicionar em `server/tests/leads-api.test.ts`:

```ts
import path from 'path';

describe('POST /api/leads/import', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/leads/import')
      .attach('file', path.resolve(__dirname, 'fixtures/leads-sample.csv'));
    expect(res.status).toBe(401);
  });

  it('importa fixture, retorna relatório', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', path.resolve(__dirname, 'fixtures/leads-sample.csv'));
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].line).toBe(4);
  });

  it('400 quando header obrigatório falta', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('nome\nA\n'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required column/);
  });

  it('400 quando mime inválido', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('whatever'), { filename: 'bad.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/);
  });
});
```

- [ ] **Step 9.3:** Rodar e ver vermelho.

```bash
npm test -- leads-api
```

Esperado: 4 novos testes falham (rota não existe).

- [ ] **Step 9.4:** Criar middleware multer.

Criar `server/middleware/multerCsv.ts`:

```ts
import multer from 'multer';
import type { Request } from 'express';

const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/csv',
  'text/plain',
]);

export const multerCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(null, false);
  },
});
```

- [ ] **Step 9.5:** Adicionar handler em `leadsController.ts`.

Adicionar import no topo:

```ts
import { importLeadsFromCsv } from '../services/leadsImport';
```

Adicionar handler:

```ts
export async function importHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    const report = await importLeadsFromCsv(req.file.buffer);
    res.json(report);
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 9.6:** Adicionar rota e tratamento de tamanho em `server/routes/leads.ts`.

Substituir o conteúdo por:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  importHandler,
} from '../controllers/leadsController';
import { authGuard } from '../middleware/authGuard';
import { multerCsv } from '../middleware/multerCsv';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);
router.post(
  '/import',
  authGuard,
  (req: Request, res: Response, next: NextFunction) => {
    multerCsv.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
      }
      if (err) return next(err);
      next();
    });
  },
  importHandler,
);

export default router;
```

- [ ] **Step 9.7:** Rodar e ver verde.

```bash
npm test -- leads-api
```

Esperado: todos os testes da rota verdes.

- [ ] **Step 9.8:** Lint, full test, commit.

```bash
npm run lint
npm test
```

Esperado: tudo verde, ~28 testes novos passando.

```bash
git add server/middleware/multerCsv.ts server/controllers/leadsController.ts server/routes/leads.ts server/tests/leads-api.test.ts server/tests/fixtures/leads-sample.csv
git commit -m "feat(leads): import endpoint with multer (5MB, mime filter)"
```

---

## Task 10 — Frontend: hooks TanStack Query

**Files:**
- Create: `src/features/leads/api.ts`
- Create: `src/features/leads/translateError.ts`

- [ ] **Step 10.1:** Criar `translateError.ts`.

Criar `src/features/leads/translateError.ts`:

```ts
const MAP: Record<string, string> = {
  'Phone already in use': 'Telefone já cadastrado.',
  'Phone cannot be edited': 'Telefone não pode ser alterado.',
  'Phone must have at least 8 digits': 'Telefone precisa ter pelo menos 8 dígitos.',
  'Lead not found': 'Lead não encontrado.',
  'File too large': 'Arquivo maior que 5MB.',
  'Invalid file type': 'Tipo de arquivo inválido. Envie .csv.',
  'Validation error': 'Dados inválidos. Confira os campos.',
};

export function translateError(msg: string): string {
  if (msg.startsWith('Missing required column')) {
    return `Coluna obrigatória ausente no CSV: ${msg.split(': ')[1]}.`;
  }
  return MAP[msg] ?? msg;
}
```

- [ ] **Step 10.2:** Criar `api.ts`.

Criar `src/features/leads/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { PublicLead, ImportReport, LeadStatus, LeadSource } from '@shared/types';

export interface ListParams {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  sort?: 'name' | 'created_at' | 'last_purchase_date';
  order?: 'asc' | 'desc';
  page?: number;
}

export interface ListResult {
  items: PublicLead[];
  total: number;
  page: number;
  pageSize: number;
}

function buildQuery(p: ListParams): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useLeads(params: ListParams) {
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api<ListResult>(`/leads${buildQuery(params)}`),
    staleTime: 30_000,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone: string;
      email?: string | null;
      notes?: string | null;
      vehiclePlate?: string | null;
      vehicleModel?: string | null;
      lastPurchaseDate?: string | null;
      avgMileagePerDay?: number | null;
    }) => api<PublicLead>('/leads', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      email?: string | null;
      notes?: string | null;
      vehiclePlate?: string | null;
      vehicleModel?: string | null;
      lastPurchaseDate?: string | null;
      avgMileagePerDay?: number | null;
      status?: LeadStatus;
    }) => {
      const { id, ...body } = input;
      return api<PublicLead>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useImportLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ImportReport>('/leads/import', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
```

- [ ] **Step 10.3:** Lint e commit.

```bash
npm run lint
git add src/features/leads/api.ts src/features/leads/translateError.ts
git commit -m "feat(leads): TanStack Query hooks + PT-BR error map"
```

---

## Task 11 — Frontend: shadcn primitives faltantes

**Files:**
- Create (via CLI): qualquer primitivo shadcn que falte

- [ ] **Step 11.1:** Verificar primitivos disponíveis.

```bash
ls src/components/ui
```

Necessários para Cadastros: `button`, `dialog`, `alert-dialog`, `dropdown-menu`, `form`, `input`, `select`, `table`, `badge`, `textarea`, `skeleton`. Os de Admin já existem; faltam provavelmente `table`, `badge`, `textarea`, `skeleton`.

- [ ] **Step 11.2:** Instalar primitivos faltantes.

```bash
npx shadcn@latest add table badge textarea skeleton --yes
```

- [ ] **Step 11.3:** Lint e commit.

```bash
npm run lint
git add src/components/ui/
git commit -m "chore(ui): add table/badge/textarea/skeleton primitives"
```

---

## Task 12 — Frontend: LeadsTable + LeadFilters + paginação

**Files:**
- Create: `src/features/leads/LeadFilters.tsx`
- Create: `src/features/leads/LeadsTable.tsx`

- [ ] **Step 12.1:** Criar `LeadFilters.tsx`.

```tsx
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LeadStatus, LeadSource } from '@shared/types';

interface Props {
  q: string;
  status: LeadStatus | 'all';
  source: LeadSource | 'all';
  onQChange: (v: string) => void;
  onStatusChange: (v: LeadStatus | 'all') => void;
  onSourceChange: (v: LeadSource | 'all') => void;
}

export function LeadFilters({
  q,
  status,
  source,
  onQChange,
  onStatusChange,
  onSourceChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Input
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Buscar por nome, telefone ou placa..."
        className="max-w-sm"
      />
      <Select value={status} onValueChange={(v) => onStatusChange(v as LeadStatus | 'all')}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          <SelectItem value="frio">Frio</SelectItem>
          <SelectItem value="morno">Morno</SelectItem>
          <SelectItem value="quente">Quente</SelectItem>
        </SelectContent>
      </Select>
      <Select value={source} onValueChange={(v) => onSourceChange(v as LeadSource | 'all')}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as origens</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
          <SelectItem value="csv">CSV</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 12.2:** Criar `LeadsTable.tsx`.

```tsx
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PublicLead } from '@shared/types';
import { LeadActions } from './LeadActions';

type SortKey = 'name' | 'created_at' | 'last_purchase_date';

interface Props {
  items: PublicLead[];
  loading: boolean;
  sort: SortKey;
  order: 'asc' | 'desc';
  onSortChange: (sort: SortKey) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

const STATUS_LABEL: Record<PublicLead['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  frio: { label: 'Frio', variant: 'secondary' },
  morno: { label: 'Morno', variant: 'default' },
  quente: { label: 'Quente', variant: 'destructive' },
};

const SOURCE_LABEL: Record<PublicLead['source'], string> = {
  manual: 'Manual',
  csv: 'CSV',
  whatsapp: 'WhatsApp',
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function SortHeader({
  label,
  myKey,
  sort,
  order,
  onClick,
}: {
  label: string;
  myKey: SortKey;
  sort: SortKey;
  order: 'asc' | 'desc';
  onClick: () => void;
}) {
  const Icon = sort !== myKey ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}

export function LeadsTable(props: Props) {
  const { items, loading, sort, order, onSortChange, page, pageSize, total, onPageChange } = props;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortHeader label="Nome" myKey="name" sort={sort} order={order} onClick={() => onSortChange('name')} />
              </TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>
                <SortHeader
                  label="Última compra"
                  myKey="last_purchase_date"
                  sort={sort}
                  order={order}
                  onClick={() => onSortChange('last_purchase_date')}
                />
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : items.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Nenhum lead encontrado.
                    </TableCell>
                  </TableRow>
                )
                : items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>{l.phone}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_LABEL[l.status].variant}>{STATUS_LABEL[l.status].label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABEL[l.source]}</TableCell>
                    <TableCell>{fmtDate(l.lastPurchaseDate)}</TableCell>
                    <TableCell><LeadActions lead={l} /></TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Total: {total.toLocaleString('pt-BR')} leads</span>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Anterior
          </Button>
          <span>Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 12.3:** Lint e commit.

```bash
npm run lint
git add src/features/leads/LeadsTable.tsx src/features/leads/LeadFilters.tsx
git commit -m "feat(leads): LeadsTable + LeadFilters components"
```

---

## Task 13 — Frontend: LeadDialog (create/edit)

**Files:**
- Create: `src/features/leads/LeadDialog.tsx`

- [ ] **Step 13.1:** Criar `LeadDialog.tsx`.

```tsx
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateLead, useUpdateLead } from './api';
import { translateError } from './translateError';
import { LEAD_STATUSES, type PublicLead } from '@shared/types';

const baseSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(120),
  phone: z.string().min(8, 'Telefone muito curto'),
  email: z.string().email('Email inválido').or(z.literal('')).optional(),
  vehiclePlate: z.string().max(10).optional(),
  vehicleModel: z.string().max(60).optional(),
  lastPurchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').or(z.literal('')).optional(),
  avgMileagePerDay: z.string().regex(/^\d*$/, 'Apenas números').optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

type FormData = z.infer<typeof baseSchema>;

function nullify<T extends string | undefined>(v: T): string | null {
  return v == null || v === '' ? null : v;
}

export function LeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: PublicLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLead();
  const update = useUpdateLead();
  const isEdit = lead !== null;

  const form = useForm<FormData>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      vehiclePlate: '',
      vehicleModel: '',
      lastPurchaseDate: '',
      avgMileagePerDay: '',
      notes: '',
      status: 'frio',
    },
  });

  useEffect(() => {
    if (open) {
      if (lead) {
        form.reset({
          name: lead.name,
          phone: lead.phone,
          email: lead.email ?? '',
          vehiclePlate: lead.vehiclePlate ?? '',
          vehicleModel: lead.vehicleModel ?? '',
          lastPurchaseDate: lead.lastPurchaseDate ?? '',
          avgMileagePerDay: lead.avgMileagePerDay?.toString() ?? '',
          notes: lead.notes ?? '',
          status: lead.status,
        });
      } else {
        form.reset({
          name: '',
          phone: '',
          email: '',
          vehiclePlate: '',
          vehicleModel: '',
          lastPurchaseDate: '',
          avgMileagePerDay: '',
          notes: '',
          status: 'frio',
        });
      }
    }
  }, [open, lead, form]);

  async function onSubmit(values: FormData) {
    const payload = {
      name: values.name,
      email: nullify(values.email),
      vehiclePlate: nullify(values.vehiclePlate),
      vehicleModel: nullify(values.vehicleModel),
      lastPurchaseDate: nullify(values.lastPurchaseDate),
      avgMileagePerDay: values.avgMileagePerDay ? Number(values.avgMileagePerDay) : null,
      notes: nullify(values.notes),
    };
    try {
      if (isEdit && lead) {
        await update.mutateAsync({ id: lead.id, ...payload, status: values.status });
        toast.success('Lead atualizado.');
      } else {
        await create.mutateAsync({ phone: values.phone, ...payload });
        toast.success('Lead criado.');
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao salvar.';
      toast.error(msg);
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone *</FormLabel>
                    <FormControl><Input {...field} disabled={isEdit} /></FormControl>
                    {isEdit && (
                      <p className="text-xs text-muted-foreground">
                        Telefone não pode ser alterado. Para mudar, exclua e cadastre novamente.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input {...field} type="email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEdit && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="frio">Frio</SelectItem>
                          <SelectItem value="morno">Morno</SelectItem>
                          <SelectItem value="quente">Quente</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="vehiclePlate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Placa</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vehicleModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastPurchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Última compra</FormLabel>
                    <FormControl><Input {...field} type="date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="avgMileagePerDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Km/dia (média)</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl><Textarea {...field} rows={3} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.2:** Lint e commit.

```bash
npm run lint
git add src/features/leads/LeadDialog.tsx
git commit -m "feat(leads): LeadDialog (create/edit) with phone-locked edit mode"
```

---

## Task 14 — Frontend: LeadActions

**Files:**
- Create: `src/features/leads/LeadActions.tsx`

- [ ] **Step 14.1:** Criar `LeadActions.tsx`.

```tsx
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Button } from '@/components/ui/button';
import { LeadDialog } from './LeadDialog';
import { useDeleteLead } from './api';
import { translateError } from './translateError';
import type { PublicLead } from '@shared/types';

export function LeadActions({ lead }: { lead: PublicLead }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useDeleteLead();

  async function onDelete() {
    try {
      await del.mutateAsync(lead.id);
      toast.success('Lead excluído.');
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao excluir.';
      toast.error(msg);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ações para ${lead.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Editar</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive">
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LeadDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {lead.name}?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 14.2:** Lint e commit.

```bash
npm run lint
git add src/features/leads/LeadActions.tsx
git commit -m "feat(leads): LeadActions (edit + delete dropdown)"
```

---

## Task 15 — Frontend: ImportCsvDialog

**Files:**
- Create: `src/features/leads/ImportCsvDialog.tsx`

- [ ] **Step 15.1:** Criar `ImportCsvDialog.tsx`.

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useImportLeads } from './api';
import { translateError } from './translateError';
import type { ImportReport } from '@shared/types';

export function ImportCsvDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const importMut = useImportLeads();

  async function onUpload() {
    if (!file) return;
    try {
      const r = await importMut.mutateAsync(file);
      setReport(r);
      toast.success(`Import concluído: ${r.inserted} novos, ${r.updated} atualizados.`);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao importar.';
      toast.error(msg);
    }
  }

  function reset() {
    setFile(null);
    setReport(null);
  }

  function downloadRejected() {
    if (!report || report.rejected.length === 0) return;
    const csv =
      'linha,motivo\n' +
      report.rejected.map((r) => `${r.line},"${r.reason.replace(/"/g, '""')}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads-rejeitados.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar leads (CSV)</DialogTitle>
        </DialogHeader>

        {!report ? (
          <div className="space-y-3">
            <div className="rounded-md border-2 border-dashed p-6 text-center">
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm">{file.name}</span>
                  <Button variant="ghost" size="icon" onClick={() => setFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Arraste um arquivo .csv ou clique para selecionar
                  </p>
                  <input
                    id="csv-input"
                    type="file"
                    accept=".csv,text/csv,application/vnd.ms-excel"
                    className="sr-only"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <label htmlFor="csv-input">
                    <Button variant="outline" size="sm" className="mt-3" asChild>
                      <span>Selecionar arquivo</span>
                    </Button>
                  </label>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Colunas reconhecidas: nome/name, telefone/phone (obrigatórios), email, observacoes, placa, modelo, ultima_compra, km_dia. Tamanho máx: 5MB.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Inseridos" value={report.inserted} variant="success" />
              <Stat label="Atualizados" value={report.updated} variant="info" />
              <Stat label="Pulados" value={report.skipped} variant="muted" />
              <Stat label="Rejeitados" value={report.rejected.length} variant="danger" />
            </div>
            {report.rejected.length > 0 && (
              <>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm">
                  {report.rejected.map((r) => (
                    <div key={r.line} className="font-mono">
                      linha {r.line}: {r.reason}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={downloadRejected}>
                  Baixar rejeitados (CSV)
                </Button>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!report ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMut.isPending}>
                Cancelar
              </Button>
              <Button onClick={onUpload} disabled={!file || importMut.isPending}>
                {importMut.isPending ? 'Importando…' : 'Importar'}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'success' | 'info' | 'muted' | 'danger';
}) {
  const color = {
    success: 'text-green-600',
    info: 'text-blue-600',
    muted: 'text-muted-foreground',
    danger: 'text-red-600',
  }[variant];
  return (
    <div className="rounded-md border p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
```

- [ ] **Step 15.2:** Lint e commit.

```bash
npm run lint
git add src/features/leads/ImportCsvDialog.tsx
git commit -m "feat(leads): ImportCsvDialog with drop zone and report view"
```

---

## Task 16 — Frontend: CadastrosPage

**Files:**
- Modify: `src/pages/cadastros/CadastrosPage.tsx`

- [ ] **Step 16.1:** Substituir o placeholder pela composição final.

Substituir todo o conteúdo de `src/pages/cadastros/CadastrosPage.tsx` por:

```tsx
import { useEffect, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LeadFilters } from '@/features/leads/LeadFilters';
import { LeadsTable } from '@/features/leads/LeadsTable';
import { LeadDialog } from '@/features/leads/LeadDialog';
import { ImportCsvDialog } from '@/features/leads/ImportCsvDialog';
import { useLeads, type ListParams } from '@/features/leads/api';
import type { LeadStatus, LeadSource } from '@shared/types';

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function CadastrosPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [source, setSource] = useState<LeadSource | 'all'>('all');
  const [sort, setSort] = useState<NonNullable<ListParams['sort']>>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const debouncedQ = useDebounced(q, 300);

  const params: ListParams = {
    q: debouncedQ || undefined,
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
    sort,
    order,
    page,
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, source]);

  const { data, isLoading } = useLeads(params);

  function toggleSort(key: NonNullable<ListParams['sort']>) {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder('asc');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cadastros</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Importar CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo lead
          </Button>
        </div>
      </div>

      <LeadFilters
        q={q}
        status={status}
        source={source}
        onQChange={setQ}
        onStatusChange={setStatus}
        onSourceChange={setSource}
      />

      <LeadsTable
        items={data?.items ?? []}
        loading={isLoading}
        sort={sort}
        order={order}
        onSortChange={toggleSort}
        page={data?.page ?? 1}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />

      <LeadDialog lead={null} open={createOpen} onOpenChange={setCreateOpen} />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
```

- [ ] **Step 16.2:** Lint, full test, commit.

```bash
npm run lint
npm test
```

Esperado: lint limpo, todos os testes verdes.

```bash
git add src/pages/cadastros/CadastrosPage.tsx
git commit -m "feat(cadastros): wire up page with filters, table, dialogs"
```

---

## Task 17 — Atualizar README e marcar roadmap

**Files:**
- Modify: `README.md`

- [ ] **Step 17.1:** Adicionar seção "Cadastros" e atualizar roadmap.

Localizar o bloco "## Próximos sub-projetos" no `README.md`. Substituir:

```markdown
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. Cadastros — leads completos + import CSV
```

por:

```markdown
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
```

Antes do bloco "## Próximos sub-projetos", adicionar:

```markdown
## Cadastros

Tela em `/cadastros` (qualquer usuário autenticado) com:
- Lista server-paginada (50/page) com search (nome/telefone/placa) + filtros (status, origem) + ordenação clicável.
- Criar/editar/excluir lead. Telefone é normalizado (só dígitos) e não editável após criação.
- Importação CSV com headers em PT ou EN, delimitador `,` ou `;`, máximo 5MB. Linhas válidas são inseridas/atualizadas em uma transação; inválidas voltam num relatório com motivo.
- Upsert seletivo no import: se o phone já existe, só preenche colunas vazias — nunca sobrescreve dados existentes. Status e source de leads existentes ficam intocados.

```

- [ ] **Step 17.2:** Commit.

```bash
git add README.md
git commit -m "docs: mark Cadastros roadmap item complete and add usage section"
```

---

## Self-review (a executar antes de iniciar)

**1. Spec coverage:**
- Migration 008 + indexes → Task 1 ✓
- Constantes shared (LEAD_STATUSES/LEAD_SOURCES) + types (PublicLead/ImportReport) → Task 1 ✓
- Schema drizzle → Task 1 ✓
- POST /api/leads (create + 409 phone) → Task 6 ✓
- PATCH /api/leads/:id (sem phone, com status) → Task 6 ✓
- DELETE /api/leads/:id (hard delete + 404) → Task 6 ✓
- GET /api/leads (q, status, source, sort, order, page, total) → Task 5 + 6 ✓
- POST /api/leads/import (multer + parse + persist + 400/413) → Tasks 7, 8, 9 ✓
- Phone normalization (digits-only, transform no Zod, normalizada no service e no parser CSV) → Tasks 3, 6, 7 ✓
- CSV header aliases PT/EN, delimiter detection, ignore extras → Task 7 ✓
- Per-line rejection + missingHeaders aborta → Tasks 7, 8 ✓
- Selective upsert (preenche só vazios, não muda status/source) → Task 8 ✓
- Frontend hooks (useLeads/useCreate/useUpdate/useDelete/useImport) → Task 10 ✓
- Frontend list view com search debounced + filtros + sort + paginação → Tasks 12, 16 ✓
- Frontend LeadDialog (phone disabled em edit, status só em edit) → Task 13 ✓
- Frontend ImportCsvDialog (drop zone, report, download rejected) → Task 15 ✓
- translateError PT-BR → Task 10 ✓
- README + roadmap → Task 17 ✓

**2. Placeholders:** revisei steps 1.1–17.2; todos têm código completo, comandos exatos e expected outputs.

**3. Type consistency:**
- `PublicLead.lastPurchaseDate: string | null` em shared/types e `toPublic` em service ✓
- `LeadStatus`/`LeadSource` derivados das constantes em ambos os lados ✓
- `ImportReport.rejected: { line: number; reason: string }[]` consistente em service, controller e UI ✓
- `parseLeadsCsv` retorna `{ rows, rejected, missingHeaders }` e é consumido por `importLeadsFromCsv` exatamente assim ✓
- `CsvRow` keys batem com `leads.$inferInsert` (camelCase) ✓
