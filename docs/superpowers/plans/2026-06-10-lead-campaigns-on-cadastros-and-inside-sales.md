# Campanhas do lead em Cadastros e Inside Sales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar as campanhas em que cada lead já recebeu disparo (sent) nas telas `/cadastros` e `/inside-sales` (Kanban + Histórico), com filtro multi-select OR por campanha.

**Architecture:** Backend agrega campanhas via subquery JSON na listagem (sem coluna nova no DB), aceita `campaignIds` como CSV de UUIDs. Frontend ganha um componente único `LeadCampaignBadges` (até N visíveis + popover "+N") reutilizado em `LeadsTable` e `DealCard`, e um multi-select `CampaignsMultiSelectFilter` na barra de filtros de cada tela. Estado do filtro vive na URL (`?campaignIds=uuid1,uuid2`).

**Tech Stack:** Drizzle ORM + Postgres (Supabase), Express, React 19, TanStack Query, Radix DropdownMenu (já no projeto), shadcn-style components, vitest + supertest no backend.

**Spec:** [docs/superpowers/specs/2026-06-10-lead-campaigns-on-cadastros-and-inside-sales-design.md](../specs/2026-06-10-lead-campaigns-on-cadastros-and-inside-sales-design.md)

**Testes:** TDD aplica-se apenas ao backend (vitest + supertest, já configurados). O projeto não tem `@testing-library/react` nem `jsdom`/`happy-dom`. Testes de componentes React ficam como **verificação manual** (passos descritos em cada task de UI). Se a equipe quiser adicionar RTL no futuro, é uma task à parte fora do escopo desta entrega.

---

## File Structure

**Create:**

- `server/db/migrations/033_campaign_recipients_lead_sent_partial_index.sql` — índice parcial pra escalar agregação e filtro.
- `server/tests/leads-list-campaigns.test.ts` — testes da agregação e filtro em `listLeads`.
- `server/tests/deals-list-campaigns.test.ts` — testes em `listBoard` e `listHistory`.
- `src/features/leads/LeadCampaignBadges.tsx` — componente reutilizável (badges + popover).
- `src/features/leads/CampaignsMultiSelectFilter.tsx` — multi-select de campanhas.

**Modify:**

- `shared/types.ts` — adiciona `LeadCampaignSummary`, `campaigns` em `PublicLead` e `PublicDeal`.
- `server/services/leadsService.ts` — `listLeads` agrega `campaigns` + aceita `campaignIds`.
- `server/services/dealsService.ts` — `listBoard` e `listHistory` agregam `campaigns` + aceitam `campaignIds`.
- `server/controllers/leadsController.ts` — zod `listQuery` com `campaignIds`.
- `server/controllers/dealsController.ts` — zod `boardQuery` e `historyQuery` com `campaignIds`.
- `src/features/leads/api.ts` — `ListParams.campaignIds` + `buildQuery`.
- `src/features/inside-sales/api.ts` — `BoardFilters.campaignIds`, `HistoryFilters.campaignIds`.
- `src/features/leads/LeadsTable.tsx` — nova coluna "Campanhas" entre "Origem" e "Cadastro".
- `src/features/inside-sales/DealCard.tsx` — badges abaixo do nome do lead.
- `src/pages/cadastros/CadastrosPage.tsx` — estado + URL sync do filtro.
- `src/features/inside-sales/KanbanBoard.tsx` — estado + URL sync do filtro.
- `src/features/inside-sales/HistoryTable.tsx` — estado + URL sync do filtro.

**Total:** 5 criados + 12 modificados.

---

## Task 1: Adicionar `LeadCampaignSummary` ao shared types

**Files:**
- Modify: `shared/types.ts` (após `PublicLead`, antes de `PublicDeal`)

- [ ] **Step 1: Editar shared/types.ts — adicionar tipo novo e campo em PublicLead**

Procure por `export interface PublicLead {` (linha ~125). Adicione `campaigns` como último campo antes de `}` e crie a interface `LeadCampaignSummary` logo acima de `PublicLead`:

```ts
export interface LeadCampaignSummary {
  id: string;
  name: string;
  /** ISO timestamp do `campaign_recipients.sent_at`. Lista vem ordenada desc. */
  sentAt: string;
}

export interface PublicLead {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  cnpj: string | null;
  email: string | null;
  notes: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  imbp: Imbp | null;
  segment: Segment | null;
  status: LeadStatus;
  source: LeadSource;
  flowStage: LeadFlowStage;
  hasDeal: boolean;
  lastEnrichmentResult: LeadEnrichmentResult | null;
  campaigns: LeadCampaignSummary[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Adicionar `campaigns` em PublicDeal**

Procure por `export interface PublicDeal {` (linha ~296). Adicione `campaigns` antes de `createdAt`:

```ts
export interface PublicDeal {
  id: string;
  lead: { id: string; name: string; phone: string | null; cnpj: string | null; status: LeadStatus; };
  stage: DealStage;
  proposalValue: number | null;
  lossReason: LossReason | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  closedAt: string | null;
  leadQualityFeedback: LeadQualityFeedback | null;
  leadQualityFeedbackAt: string | null;
  isStale: boolean;
  enteredCurrentStageAt: string;
  aiSummary: string | null;
  campaigns: LeadCampaignSummary[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Type-check (vai falhar em vários lugares — é esperado)**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: errors apontando que `campaigns` está faltando em retornos de `leadsService.ts` e `dealsService.ts`. Anote os arquivos — vamos corrigi-los nas próximas tasks.

- [ ] **Step 4: Commit**

```bash
git add shared/types.ts
git commit -m "feat(types): add LeadCampaignSummary and campaigns field to PublicLead and PublicDeal"
```

---

## Task 2: Migration 033 — índice parcial em `campaign_recipients`

**Files:**
- Create: `server/db/migrations/033_campaign_recipients_lead_sent_partial_index.sql`

- [ ] **Step 1: Criar a migration**

Conteúdo completo do arquivo:

```sql
-- Migration 033: indice parcial pra acelerar agregacao "campanhas do lead"
-- e filtro "leads em qualquer das campanhas X". So entram registros com
-- sent_at preenchido (semantica "envio efetivado").

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_lead_sent
  ON campaign_recipients (lead_id, campaign_id)
  WHERE sent_at IS NOT NULL;
```

- [ ] **Step 2: Aplicar a migration**

Run: `npm run migrate`
Expected: `✓ 033_campaign_recipients_lead_sent_partial_index.sql (applied)` no log.

- [ ] **Step 3: Verificar índice no banco (opcional, só se quiser conferir)**

Conecta no Supabase via psql/console e roda:

```sql
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'lubritec' AND indexname = 'idx_campaign_recipients_lead_sent';
```

Expected: linha única com `CREATE INDEX ... WHERE (sent_at IS NOT NULL)`.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/033_campaign_recipients_lead_sent_partial_index.sql
git commit -m "feat(db): add partial index on campaign_recipients(lead_id, campaign_id) where sent_at is not null"
```

---

## Task 3: Backend — `listLeads` agrega `campaigns` e aceita `campaignIds`

**Files:**
- Modify: `server/services/leadsService.ts:384-453` (função `listLeads`)
- Modify: `server/controllers/leadsController.ts:84-104` (schema `listQuery`)
- Test: `server/tests/leads-list-campaigns.test.ts` (novo)

- [ ] **Step 1: Escrever os testes que devem falhar**

O projeto já tem helpers em `server/tests/helpers.ts` (`createLead`, `createCampaign`, `createCampaignRecipient`) e um `setup.ts` global que faz TRUNCATE em todas as tabelas no `beforeEach` — não precisa lidar com isolamento manualmente.

Antes do primeiro `createCampaign` numa suíte que envolve campanhas, é necessário criar um usuário admin (campo `createdByUserId` é obrigatório). Veja como outras suítes (`campaigns-crud.test.ts`) fazem.

Crie `server/tests/leads-list-campaigns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listLeads } from '../services/leadsService';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

async function admin() {
  return createUser({ email: `a${Math.random().toString(36).slice(2, 8)}@x.com`, password: 'pw12345', role: 'admin' });
}

describe('listLeads — agregacao de campaigns e filtro campaignIds', () => {
  it('returns empty campaigns array when lead has no recipients', async () => {
    await createLead({ name: 'Solo', phone: '5554911111111' });
    const r = await listLeads({});
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns).toEqual([]);
  });

  it('returns only campaigns with sent_at IS NOT NULL', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Lead A', phone: '5554922222222' });
    const sent = await createCampaign({ name: 'Campanha Enviada', createdByUserId: u.id });
    const pending = await createCampaign({ name: 'Campanha Pendente', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: sent.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01T10:00:00Z') });
    await createCampaignRecipient({ campaignId: pending.id, leadId: lead.id, status: 'pending', sentAt: null });

    const r = await listLeads({});
    expect(r.items[0].campaigns).toHaveLength(1);
    expect(r.items[0].campaigns[0].name).toBe('Campanha Enviada');
  });

  it('orders campaigns desc by sentAt', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Lead B', phone: '5554933333333' });
    const c1 = await createCampaign({ name: 'Campanha Antiga', createdByUserId: u.id });
    const c2 = await createCampaign({ name: 'Campanha Recente', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: c1.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01T10:00:00Z') });
    await createCampaignRecipient({ campaignId: c2.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01T10:00:00Z') });

    const r = await listLeads({});
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['Campanha Recente', 'Campanha Antiga']);
  });

  it('filters with multiple campaignIds (OR semantics)', async () => {
    const u = await admin();
    const inA = await createLead({ name: 'In A', phone: '5554944444444' });
    const inB = await createLead({ name: 'In B', phone: '5554955555555' });
    const inNone = await createLead({ name: 'In none', phone: '5554966666666' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: campA.id, leadId: inA.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: campB.id, leadId: inB.id, status: 'sent', sentAt: new Date() });

    const r = await listLeads({ campaignIds: [campA.id, campB.id] });
    const ids = r.items.map((l) => l.id).sort();
    expect(ids).toEqual([inA.id, inB.id].sort());
    expect(ids).not.toContain(inNone.id);
  });

  it('excludes leads whose recipient is pending when filtering by that campaign', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Pending only', phone: '5554900000001' });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'pending', sentAt: null });

    const r = await listLeads({ campaignIds: [camp.id] });
    expect(r.items).toHaveLength(0);
  });
});
```

Observação: os helpers retornam o objeto completo do lead/campanha/recipient; use `.id` pra pegar o uuid.

- [ ] **Step 2: Rodar testes — devem falhar**

Run: `npx vitest run server/tests/leads-list-campaigns.test.ts`
Expected: FAIL — `campaigns` é `undefined` no retorno e `campaignIds` não é aceito como parâmetro.

- [ ] **Step 3: Modificar `listLeads` em leadsService.ts**

Em `server/services/leadsService.ts`, localize a função `listLeads(params: ...)` (linha ~384). Substitua a assinatura e o corpo:

```ts
export async function listLeads(params: {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  flowStage?: LeadFlowStage;
  pipeline?: 'yes' | 'no';
  withIssues?: boolean;
  campaignIds?: string[];
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
  if (params.flowStage) conditions.push(eq(leads.flowStage, params.flowStage));
  if (params.pipeline === 'yes') {
    conditions.push(sql`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.pipeline === 'no') {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.withIssues) {
    const issuesArr = ISSUE_STATUSES.map((s) => `'${s}'`).join(',');
    conditions.push(sql`(${LATEST_ENRICHMENT_RESULT_SQL}) IN (${sql.raw(issuesArr)})`);
  }
  if (params.campaignIds && params.campaignIds.length > 0) {
    // OR semantics: lead que tem recipient sent em qualquer das campanhas.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.lead_id = ${leads.id}
        AND cr.sent_at IS NOT NULL
        AND cr.campaign_id IN ${params.campaignIds}
    )`);
  }
  if (params.q) {
    const escaped = params.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const searchExpr = or(
      ilike(leads.name, pat),
      ilike(leads.phone, pat),
      ilike(leads.cnpj, pat),
    );
    if (searchExpr) conditions.push(searchExpr);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const campaignsSql = sql<Array<{ id: string; name: string; sentAt: string }>>`COALESCE(
    (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'sentAt', cr.sent_at)
                     ORDER BY cr.sent_at DESC)
     FROM campaign_recipients cr
     JOIN campaigns c ON c.id = cr.campaign_id
     WHERE cr.lead_id = ${leads.id} AND cr.sent_at IS NOT NULL),
    '[]'::json
  )`;

  const rows = await db
    .select({
      lead: leads,
      hasDeal: sql<boolean>`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`,
      lastEnrichmentResult: LATEST_ENRICHMENT_RESULT_SQL,
      campaigns: campaignsSql,
    })
    .from(leads)
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    items: rows.map((r) => toPublic({
      ...r.lead,
      hasDeal: Boolean(r.hasDeal),
      lastEnrichmentResult: r.lastEnrichmentResult,
      campaigns: r.campaigns ?? [],
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}
```

- [ ] **Step 4: Atualizar `toPublic` em leadsService.ts pra repassar `campaigns`**

A função `toPublic` está em `server/services/leadsService.ts:27`. Substitua a assinatura e adicione `campaigns` no retorno:

```ts
function toPublic(row: typeof leads.$inferSelect & {
  hasDeal?: boolean;
  lastEnrichmentResult?: LeadEnrichmentResult | string | null;
  campaigns?: LeadCampaignSummary[];
}): PublicLead {
  const known: ReadonlyArray<LeadEnrichmentResult> = [
    'phone_found', 'phone_not_in_brasilapi', 'cnpj_not_found', 'cnpj_inactive', 'api_error',
  ];
  const result = row.lastEnrichmentResult && known.includes(row.lastEnrichmentResult as LeadEnrichmentResult)
    ? (row.lastEnrichmentResult as LeadEnrichmentResult)
    : null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    phone2: row.phone2,
    cnpj: row.cnpj,
    email: row.email,
    notes: row.notes,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    imbp: row.imbp,
    segment: row.segment,
    status: row.status,
    source: row.source,
    flowStage: row.flowStage,
    hasDeal: row.hasDeal ?? false,
    lastEnrichmentResult: result,
    campaigns: row.campaigns ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

Atenção: outras funções no arquivo que chamam `toPublic` (ex: `createLead`, `getLeadById`) passam um row sem `campaigns`. Como o campo é opcional no tipo e o `?? []` cobre, essas chamadas continuam compilando — apenas vão retornar `campaigns: []` (correto: a tela do detail/create não precisa do agregado).

- [ ] **Step 5: Modificar zod schema no controller**

Em `server/controllers/leadsController.ts:84` (`listQuery`), adicione `campaignIds`:

```ts
const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  flowStage: z.enum(LEAD_FLOW_STAGES).optional(),
  pipeline: z.enum(['yes', 'no']).optional(),
  withIssues: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  campaignIds: z.string().optional().transform((v) => {
    if (!v) return undefined;
    const parts = v.split(',').filter(Boolean);
    // Valida cada UUID; lança erro se algum for malformado.
    for (const p of parts) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) {
        throw new Error(`Invalid UUID in campaignIds: ${p}`);
      }
    }
    return parts;
  }),
  sort: z.enum(['name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});
```

- [ ] **Step 6: Importar `LeadCampaignSummary` no leadsService**

No topo de `server/services/leadsService.ts`, garanta o import:

```ts
import type { PublicLead, LeadStatus, LeadSource, LeadFlowStage, LeadEnrichmentResult, LeadCampaignSummary } from '@shared/types';
```

- [ ] **Step 7: Rodar testes — devem passar**

Run: `npx vitest run server/tests/leads-list-campaigns.test.ts`
Expected: PASS — todos os 6 testes verdes.

- [ ] **Step 8: Type-check geral**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: sem erros relacionados a leads. (Deve sobrar só o que vamos arrumar na Task 4 — `dealsService`.)

- [ ] **Step 9: Commit**

```bash
git add server/services/leadsService.ts server/controllers/leadsController.ts server/tests/leads-list-campaigns.test.ts
git commit -m "feat(leads): aggregate campaigns and accept campaignIds filter in listLeads"
```

---

## Task 4: Backend — `listBoard` e `listHistory` agregam `campaigns` e aceitam `campaignIds`

**Files:**
- Modify: `server/services/dealsService.ts:114-187` (`listBoard`) e `listHistory` (logo abaixo).
- Modify: `server/controllers/dealsController.ts:13-31` (`boardQuery` e `historyQuery`).
- Test: `server/tests/deals-list-campaigns.test.ts` (novo)

- [ ] **Step 1: Escrever os testes que devem falhar**

Crie `server/tests/deals-list-campaigns.test.ts` usando os helpers existentes:

```ts
import { describe, it, expect } from 'vitest';
import { listBoard, listHistory } from '../services/dealsService';
import { createUser, createLead, createCampaign, createCampaignRecipient, createDeal } from './helpers';

async function admin() {
  return createUser({ email: `a${Math.random().toString(36).slice(2, 8)}@x.com`, password: 'pw12345', role: 'admin' });
}

const userCtx = { ownerFilter: 'all' as const, currentUserId: '00000000-0000-0000-0000-000000000000' };

describe('listBoard — agregacao de campaigns e filtro campaignIds', () => {
  it('attaches empty campaigns when deal lead has no sent recipient', async () => {
    const lead = await createLead({ name: 'No camp', phone: '5554911111111' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    expect(r.stages.lead_no_comercial[0].campaigns).toEqual([]);
  });

  it('attaches sent campaigns to deal, desc-ordered', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Multi', phone: '5554922222222' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const ca = await createCampaign({ name: 'Antiga', createdByUserId: u.id });
    const cr = await createCampaign({ name: 'Recente', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: ca.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01') });
    await createCampaignRecipient({ campaignId: cr.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01') });
    const r = await listBoard(userCtx);
    expect(r.stages.lead_no_comercial[0].campaigns.map((c) => c.name)).toEqual(['Recente', 'Antiga']);
  });

  it('filters board by campaignIds (OR)', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'In A', phone: '5554933333333' });
    const leadB = await createLead({ name: 'In B', phone: '5554944444444' });
    const leadN = await createLead({ name: 'In none', phone: '5554955555555' });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadN.id, stage: 'lead_no_comercial' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: campA.id, leadId: leadA.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: campB.id, leadId: leadB.id, status: 'sent', sentAt: new Date() });
    const r = await listBoard({ ...userCtx, campaignIds: [campA.id, campB.id] });
    const names = r.stages.lead_no_comercial.map((d) => d.lead.name).sort();
    expect(names).toEqual(['In A', 'In B']);
  });
});

describe('listHistory — campaigns', () => {
  it('attaches campaigns and filters by campaignIds', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Won', phone: '5554900000001' });
    await createDeal({ leadId: lead.id, stage: 'ganho', closedAt: new Date() });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'sent', sentAt: new Date() });
    const r = await listHistory({ ...userCtx, campaignIds: [camp.id] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['A']);
  });
});
```

Confirme assinatura de `createDeal` em `helpers.ts` antes (linha ~261). Ajuste o `stage` e demais campos conforme a interface.

- [ ] **Step 2: Rodar testes — devem falhar**

Run: `npx vitest run server/tests/deals-list-campaigns.test.ts`
Expected: FAIL — `campaigns` ausente do retorno, `campaignIds` não aceito.

- [ ] **Step 3: Modificar `listBoard` em dealsService.ts**

Em `server/services/dealsService.ts:114`, modifique a assinatura e o select:

```ts
export async function listBoard(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string;
  q?: string;
  campaignIds?: string[];
  currentUserId: string;
}): Promise<BoardResponse> {
  const conds: SQL[] = [];

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  } else if (input.ownerFilter === 'unassigned') {
    conds.push(sql`${deals.ownerUserId} IS NULL`);
  } else if (input.ownerFilter !== 'all') {
    conds.push(eq(deals.ownerUserId, input.ownerFilter));
  }

  conds.push(
    sql`(
      ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      )
    )`,
  );

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.cnpj, pat));
    if (search) conds.push(search);
  }

  if (input.campaignIds && input.campaignIds.length > 0) {
    conds.push(sql`EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.lead_id = ${deals.leadId}
        AND cr.sent_at IS NOT NULL
        AND cr.campaign_id IN ${input.campaignIds}
    )`);
  }

  const where = and(...conds);

  const campaignsSql = sql<Array<{ id: string; name: string; sentAt: string }>>`COALESCE(
    (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'sentAt', cr.sent_at)
                     ORDER BY cr.sent_at DESC)
     FROM campaign_recipients cr
     JOIN campaigns c ON c.id = cr.campaign_id
     WHERE cr.lead_id = ${deals.leadId} AND cr.sent_at IS NOT NULL),
    '[]'::json
  )`;

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.updatedAt));

  const stages: BoardResponse['stages'] = {
    lead_no_comercial: [], proposta_enviada: [], em_negociacao: [], ganho: [], perdido: [],
  };
  const totals: BoardResponse['totals'] = {
    lead_no_comercial: { count: 0, valueSum: 0 },
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
```

- [ ] **Step 4: Atualizar `RawDealRow` e `toPublic` em dealsService.ts**

A interface `RawDealRow` está em `server/services/dealsService.ts:28`. Adicione `campaigns`:

```ts
interface RawDealRow {
  deal: typeof deals.$inferSelect;
  lead: typeof leads.$inferSelect | null;
  owner: typeof users.$inferSelect | null;
  enteredCurrentStageAt: Date;
  isStale: boolean;
  aiSummary: string | null;
  campaigns: Array<{ id: string; name: string; sentAt: string }>;
}
```

E a `toPublic` (linha ~37) — adicione `campaigns` no retorno, antes de `createdAt`:

```ts
function toPublic(row: RawDealRow): PublicDeal {
  const lead = row.lead!;
  return {
    id: row.deal.id,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      cnpj: lead.cnpj,
      status: lead.status,
    },
    stage: row.deal.stage,
    proposalValue: row.deal.proposalValue == null ? null : Number(row.deal.proposalValue),
    lossReason: row.deal.lossReason,
    notes: row.deal.notes,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    closedAt: row.deal.closedAt?.toISOString() ?? null,
    leadQualityFeedback: row.deal.leadQualityFeedback ?? null,
    leadQualityFeedbackAt: row.deal.leadQualityFeedbackAt?.toISOString() ?? null,
    isStale: Boolean(row.isStale),
    enteredCurrentStageAt: new Date(row.enteredCurrentStageAt).toISOString(),
    aiSummary: row.aiSummary,
    campaigns: row.campaigns ?? [],
    createdAt: row.deal.createdAt.toISOString(),
    updatedAt: row.deal.updatedAt.toISOString(),
  };
}
```

Garanta que `import type { LeadCampaignSummary } from '@shared/types';` esteja no topo (não usado pelo `RawDealRow` mas referenciado por `PublicDeal`).

- [ ] **Step 5: Aplicar mesmo padrão em `listHistory`**

Localize `listHistory` em `dealsService.ts` (linha ~193). Adicione `campaignIds?: string[]` na assinatura, adicione o mesmo `EXISTS` filter, adicione `campaignsSql` no `select`, e passe `campaigns` no `toPublic` (já feito no Step 4).

- [ ] **Step 6: Modificar zod schemas no controller**

Em `server/controllers/dealsController.ts`, adicione `campaignIds` em ambos schemas:

```ts
const campaignIdsTransform = z.string().optional().transform((v) => {
  if (!v) return undefined;
  const parts = v.split(',').filter(Boolean);
  for (const p of parts) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) {
      throw new Error(`Invalid UUID in campaignIds: ${p}`);
    }
  }
  return parts;
});

const boardQuery = z.object({
  owner: ownerFilter.optional(),
  q: z.string().optional(),
  campaignIds: campaignIdsTransform,
});

const historyQuery = z.object({
  owner: ownerFilter.optional(),
  q: z.string().optional(),
  stage: z.enum(['ganho', 'perdido']).optional(),
  lossReason: z.enum(LOSS_REASONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  campaignIds: campaignIdsTransform,
  page: z.coerce.number().int().min(1).max(100000).optional(),
});
```

Garanta que o handler passa `campaignIds` ao service.

- [ ] **Step 7: Rodar testes**

Run: `npx vitest run server/tests/deals-list-campaigns.test.ts`
Expected: PASS — todos os 4 testes verdes.

- [ ] **Step 8: Type-check completo**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add server/services/dealsService.ts server/controllers/dealsController.ts server/tests/deals-list-campaigns.test.ts
git commit -m "feat(deals): aggregate campaigns and accept campaignIds filter in listBoard and listHistory"
```

---

## Task 5: Componente `LeadCampaignBadges`

**Files:**
- Create: `src/features/leads/LeadCampaignBadges.tsx`

- [ ] **Step 1: Verificar disponibilidade do DropdownMenu**

Run: `ls src/components/ui/dropdown-menu*`
Expected: arquivo existe. Caso não, vai precisar instalar via shadcn:

```bash
npx shadcn@latest add dropdown-menu
```

- [ ] **Step 2: Criar o componente**

Crie `src/features/leads/LeadCampaignBadges.tsx`:

```tsx
import { Megaphone } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { LeadCampaignSummary } from '@shared/types';

interface LeadCampaignBadgesProps {
  campaigns: LeadCampaignSummary[];
  maxVisible?: number;
}

function CampaignBadge({ campaign }: { campaign: LeadCampaignSummary }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[140px]"
      title={`Campanha: ${campaign.name}`}
    >
      <Megaphone className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{campaign.name}</span>
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function LeadCampaignBadges({ campaigns, maxVisible = 2 }: LeadCampaignBadgesProps) {
  if (campaigns.length === 0) return null;

  const visible = campaigns.slice(0, maxVisible);
  const overflow = campaigns.slice(maxVisible);

  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      {visible.map((c) => (
        <CampaignBadge key={c.id} campaign={c} />
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ver mais ${overflow.length} campanhas`}
              className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
            >
              +{overflow.length}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel className="text-xs">Todas as campanhas</DropdownMenuLabel>
            {campaigns.map((c) => (
              <DropdownMenuItem key={c.id} className="flex flex-col items-start gap-0.5">
                <span className="text-xs font-medium">{c.name}</span>
                <span className="text-[10px] text-muted-foreground">Enviado em {formatDate(c.sentAt)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/LeadCampaignBadges.tsx
git commit -m "feat(leads): add LeadCampaignBadges component with overflow popover"
```

---

## Task 6: Frontend api.ts — adicionar `campaignIds` em `useLeads` e em `useBoard`/`useHistory`

**Files:**
- Modify: `src/features/leads/api.ts:14-49`
- Modify: `src/features/inside-sales/api.ts:18-80`

- [ ] **Step 1: Atualizar `ListParams` em leads/api.ts**

Em `src/features/leads/api.ts`, adicione `campaignIds` em `ListParams` e ajuste `buildQuery`:

```ts
export interface ListParams {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  flowStage?: LeadFlowStage;
  pipeline?: 'yes' | 'no';
  withIssues?: boolean;
  campaignIds?: string[];
  sort?: 'name' | 'created_at';
  order?: 'asc' | 'desc';
  page?: number;
}

function buildQuery(p: ListParams): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) u.set(k, v.join(','));
    } else {
      u.set(k, String(v));
    }
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}
```

- [ ] **Step 2: Atualizar `BoardFilters` e `HistoryFilters` em inside-sales/api.ts**

Em `src/features/inside-sales/api.ts`:

```ts
export interface BoardFilters {
  owner?: OwnerFilter;
  q?: string;
  campaignIds?: string[];
}

function buildBoardQuery(f: BoardFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  if (f.campaignIds && f.campaignIds.length > 0) u.set('campaignIds', f.campaignIds.join(','));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export interface HistoryFilters {
  owner?: OwnerFilter;
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: string;
  to?: string;
  campaignIds?: string[];
  page?: number;
}

function buildHistoryQuery(f: HistoryFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  if (f.stage) u.set('stage', f.stage);
  if (f.lossReason) u.set('lossReason', f.lossReason);
  if (f.from) u.set('from', f.from);
  if (f.to) u.set('to', f.to);
  if (f.campaignIds && f.campaignIds.length > 0) u.set('campaignIds', f.campaignIds.join(','));
  if (f.page) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}
```

(Se o `buildHistoryQuery` atual no arquivo for diferente, mantenha os outros campos e só acrescente `campaignIds`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/api.ts src/features/inside-sales/api.ts
git commit -m "feat(api): add campaignIds to leads and deals query params"
```

---

## Task 7: Coluna "Campanhas" em `LeadsTable`

**Files:**
- Modify: `src/features/leads/LeadsTable.tsx:114-195`

- [ ] **Step 1: Adicionar cabeçalho da coluna**

Em `src/features/leads/LeadsTable.tsx`, localize o bloco `<TableHeader>` (linha ~114). Insira o novo `<TableHead>` entre `<TableHead>Origem</TableHead>` e a coluna `Cadastro`:

```tsx
<TableHead>Origem</TableHead>
<TableHead className="min-w-[180px]">Campanhas</TableHead>
<TableHead>
  <SortHeader
    label="Cadastro"
    myKey="created_at"
    sort={sort}
    order={order}
    onClick={() => onSortChange('created_at')}
  />
</TableHead>
```

- [ ] **Step 2: Adicionar célula no corpo da tabela**

No `<TableBody>`, dentro do `items.map((l) => ...)`, insira a célula entre `<TableCell className="text-muted-foreground">{SOURCE_LABEL[l.source]}</TableCell>` e `<TableCell>{fmtDateTime(l.createdAt)}</TableCell>`:

```tsx
<TableCell className="text-muted-foreground">{SOURCE_LABEL[l.source]}</TableCell>
<TableCell>
  <LeadCampaignBadges campaigns={l.campaigns} />
</TableCell>
<TableCell>{fmtDateTime(l.createdAt)}</TableCell>
```

- [ ] **Step 3: Atualizar colSpan e quantidade de skeletons**

A linha do `Array.from({ length: 9 })` deve virar `length: 10`. O `colSpan={9}` na mensagem vazia deve virar `colSpan={10}`.

- [ ] **Step 4: Importar o componente**

No topo do arquivo, adicione:

```tsx
import { LeadCampaignBadges } from './LeadCampaignBadges';
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Verificação manual**

Run: `npm run dev`
Abra `http://localhost:3000/cadastros`. Confirme:
- Coluna "Campanhas" aparece entre "Origem" e "Cadastro".
- Leads sem campanha mostram célula vazia (sem badges).
- Leads com 1-2 campanhas mostram badges com ícone megafone.
- Leads com 3+ campanhas mostram 2 badges + chip "+N"; clicar no chip abre lista.

- [ ] **Step 7: Commit**

```bash
git add src/features/leads/LeadsTable.tsx
git commit -m "feat(leads): show campaigns column in LeadsTable with overflow popover"
```

---

## Task 8: Badges em `DealCard` (Kanban)

**Files:**
- Modify: `src/features/inside-sales/DealCard.tsx:55-90` (área do nome do lead)

- [ ] **Step 1: Adicionar badges abaixo do nome**

Em `src/features/inside-sales/DealCard.tsx`, localize o `<div>` que renderiza `{deal.lead.name}` (linha ~58). Logo após o `</div>` desse bloco, antes do bloco do owner, insira:

```tsx
<div className="flex-1 min-w-0 truncate font-semibold text-[13px] text-lc-ink">
  {deal.lead.name}
</div>
{deal.campaigns.length > 0 && (
  <div className="mt-1">
    <LeadCampaignBadges campaigns={deal.campaigns} maxVisible={1} />
  </div>
)}
```

- [ ] **Step 2: Importar o componente**

No topo do arquivo:

```tsx
import { LeadCampaignBadges } from '@/features/leads/LeadCampaignBadges';
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abra `/inside-sales`. Confirme:
- Cards de deals cujo lead recebeu disparo de campanha mostram 1 badge + "+N" se houver mais.
- Cards de leads sem campanha disparada não mostram nada.
- Popover do "+N" funciona dentro do card.

- [ ] **Step 5: Commit**

```bash
git add src/features/inside-sales/DealCard.tsx
git commit -m "feat(inside-sales): show campaign badges on deal Kanban cards"
```

---

## Task 9: Componente `CampaignsMultiSelectFilter`

**Files:**
- Create: `src/features/leads/CampaignsMultiSelectFilter.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { useMemo, useState } from 'react';
import { ChevronDown, Megaphone } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useCampaigns } from '@/features/campaigns/api';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export function CampaignsMultiSelectFilter({ value, onChange }: Props) {
  const [search, setSearch] = useState('');
  // Pede uma página grande das campanhas. Filtros adicionais (status/archived)
  // ficam ausentes pra trazer tudo que pode ter sido disparado.
  const { data } = useCampaigns({ page: 1 });

  const all = data?.items ?? [];
  const filtered = useMemo(() => {
    if (!search) return all;
    const s = search.toLowerCase();
    return all.filter((c) => c.name.toLowerCase().includes(s));
  }, [all, search]);

  const selected = new Set(value);

  const label = value.length === 0
    ? 'Todas as campanhas'
    : value.length === 1
    ? all.find((c) => c.id === value[0])?.name ?? '1 campanha'
    : `${value.length} campanhas`;

  function toggle(id: string) {
    if (selected.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  function clear() {
    onChange([]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Megaphone className="h-3.5 w-3.5" />
          <span className="truncate max-w-[180px]">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-h-96 overflow-hidden flex flex-col">
        <div className="p-2">
          <input
            type="text"
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma campanha.</div>
          ) : (
            filtered.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={selected.has(c.id)}
                onCheckedChange={() => toggle(c.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="truncate">{c.name}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="p-2">
          <Button variant="ghost" size="sm" className="w-full" disabled={value.length === 0} onClick={clear}>
            Limpar seleção
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Verificar API do hook `useCampaigns`**

Run: `grep -n "useCampaigns" src/features/campaigns/api.ts`
Confirme a assinatura. Se a interface `ListFilters` exigir mais campos obrigatórios, ajuste o `{ page: 1 }` acima (passe `{}` ou os campos default que ela espera).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/CampaignsMultiSelectFilter.tsx
git commit -m "feat(leads): add CampaignsMultiSelectFilter component"
```

---

## Task 10: Wire-up do filtro em `CadastrosPage`

**Files:**
- Modify: `src/pages/cadastros/CadastrosPage.tsx`

- [ ] **Step 1: Adicionar state `campaignIds`**

Em `src/pages/cadastros/CadastrosPage.tsx`, adicione o state na lista de hooks (perto das outras `useState`):

```tsx
const initialCampaignIds = (() => {
  const v = searchParams.get('campaignIds');
  return v ? v.split(',').filter(Boolean) : [];
})();
const [campaignIds, setCampaignIds] = useState<string[]>(initialCampaignIds);
```

- [ ] **Step 2: Passar `campaignIds` em `params`**

No objeto `params: ListParams`, adicione:

```tsx
const params: ListParams = {
  q: debouncedQ || undefined,
  status: status === 'all' ? undefined : status,
  source: source === 'all' ? undefined : source,
  flowStage: flowStage === 'all' ? undefined : flowStage,
  pipeline: pipeline === 'all' ? undefined : pipeline,
  withIssues: withIssues || undefined,
  campaignIds: campaignIds.length > 0 ? campaignIds : undefined,
  sort,
  order,
  page,
};
```

- [ ] **Step 3: Resetar página no efeito existente**

No `useEffect` que reseta page (linha ~58), adicione `campaignIds.join(',')` na lista de deps:

```tsx
useEffect(() => {
  setPage(1);
}, [debouncedQ, status, source, flowStage, pipeline, withIssues, campaignIds.join(',')]);
```

- [ ] **Step 4: Sync com URL**

No `useEffect` que sincroniza `flowStage` e `withIssues` na URL, adicione `campaignIds`:

```tsx
useEffect(() => {
  const next = new URLSearchParams(searchParams);
  if (flowStage === 'all') next.delete('flowStage');
  else next.set('flowStage', flowStage);
  if (withIssues) next.set('withIssues', 'true');
  else next.delete('withIssues');
  if (campaignIds.length > 0) next.set('campaignIds', campaignIds.join(','));
  else next.delete('campaignIds');
  if (next.toString() !== searchParams.toString()) {
    setSearchParams(next, { replace: true });
  }
}, [flowStage, withIssues, campaignIds, searchParams, setSearchParams]);
```

- [ ] **Step 5: Renderizar o filtro**

Localize o `<LeadFilters>` no JSX. Adicione o `CampaignsMultiSelectFilter` próximo aos outros filtros. Se `LeadFilters` é um componente abstrato que monta os filtros, ou adicione o `CampaignsMultiSelectFilter` no parent (ao lado) ou estenda `LeadFilters` pra aceitar `campaignIds` e `onCampaignIdsChange` props. Padrão recomendado:

No mesmo nível em que `<LeadFilters>` aparece no JSX, adicione:

```tsx
import { CampaignsMultiSelectFilter } from '@/features/leads/CampaignsMultiSelectFilter';

// ... dentro do JSX, próximo a <LeadFilters>:
<div className="flex items-center gap-2 flex-wrap">
  <LeadFilters /* props existentes */ />
  <CampaignsMultiSelectFilter value={campaignIds} onChange={setCampaignIds} />
</div>
```

(Se já há um wrapper, use ele. O importante é que o multi-select fique visualmente ao lado dos outros filtros.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Verificação manual**

`npm run dev`, abra `/cadastros`:
- Multi-select "Todas as campanhas" aparece na barra de filtros.
- Selecionar uma campanha filtra a tabela e atualiza URL com `?campaignIds=...`.
- Selecionar várias filtra com OR (leads que estiveram em qualquer).
- Recarregar a página preserva o filtro.
- "Limpar seleção" zera o filtro.

- [ ] **Step 8: Commit**

```bash
git add src/pages/cadastros/CadastrosPage.tsx
git commit -m "feat(cadastros): add campaigns multi-select filter wired to URL"
```

---

## Task 11: Wire-up do filtro no `KanbanBoard` (Inside Sales — aba Pipeline)

**Files:**
- Modify: `src/features/inside-sales/KanbanBoard.tsx`

- [ ] **Step 1: Ler `campaignIds` da URL**

Localize o bloco que lê `owner` e `q` da URL (linha ~38). Adicione:

```tsx
const campaignIdsRaw = searchParams.get('campaignIds') ?? '';
const campaignIds = useMemo(
  () => (campaignIdsRaw ? campaignIdsRaw.split(',').filter(Boolean) : []),
  [campaignIdsRaw],
);
```

- [ ] **Step 2: Passar `campaignIds` para `useBoard`**

Onde `filters` é montado e passado pra `useBoard(filters)`, adicione:

```tsx
const filters: BoardFilters = useMemo(() => ({
  owner,
  q: q || undefined,
  campaignIds: campaignIds.length > 0 ? campaignIds : undefined,
}), [owner, q, campaignIds.join(',')]);
```

(Adicione `BoardFilters` ao import se faltar.)

- [ ] **Step 3: Renderizar o filtro na toolbar**

Localize a região onde os controles de filtro do board são renderizados (perto do owner select / busca). Adicione:

```tsx
import { CampaignsMultiSelectFilter } from '@/features/leads/CampaignsMultiSelectFilter';

// na JSX, próximo aos outros filtros:
<CampaignsMultiSelectFilter
  value={campaignIds}
  onChange={(next) => {
    const np = new URLSearchParams(searchParams);
    if (next.length > 0) np.set('campaignIds', next.join(','));
    else np.delete('campaignIds');
    setSearchParams(np, { replace: true });
  }}
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificação manual**

`npm run dev`, abra `/inside-sales` (aba Pipeline):
- Multi-select de campanhas na toolbar do board.
- Filtrar reduz os cards do Kanban e persiste em refresh.

- [ ] **Step 6: Commit**

```bash
git add src/features/inside-sales/KanbanBoard.tsx
git commit -m "feat(inside-sales): add campaigns multi-select filter to Kanban board"
```

---

## Task 12: Wire-up do filtro em `HistoryTable` (Inside Sales — aba Histórico)

**Files:**
- Modify: `src/features/inside-sales/HistoryTable.tsx`

- [ ] **Step 1: Ler `campaignIds` da URL**

Onde os outros filtros são lidos de `searchParams` (linha ~20-27):

```tsx
const campaignIdsRaw = searchParams.get('campaignIds') ?? '';
const campaignIds = useMemo(
  () => (campaignIdsRaw ? campaignIdsRaw.split(',').filter(Boolean) : []),
  [campaignIdsRaw],
);
```

- [ ] **Step 2: Passar pro `useHistory`**

```tsx
const filters: HistoryFilters = useMemo(() => ({
  owner: ownerFilter,
  q: q || undefined,
  stage: stageFilter ?? undefined,
  lossReason: reasonFilter ?? undefined,
  from: fromFilter || undefined,
  to: toFilter || undefined,
  campaignIds: campaignIds.length > 0 ? campaignIds : undefined,
  page,
}), [ownerFilter, q, stageFilter, reasonFilter, fromFilter, toFilter, campaignIds.join(','), page]);
```

(Ajuste se a montagem dos filters for diferente; o ponto é incluir `campaignIds`.)

- [ ] **Step 3: Renderizar o filtro**

Próximo aos outros filtros de history:

```tsx
import { CampaignsMultiSelectFilter } from '@/features/leads/CampaignsMultiSelectFilter';

<CampaignsMultiSelectFilter
  value={campaignIds}
  onChange={(next) => {
    const np = new URLSearchParams(searchParams);
    if (next.length > 0) np.set('campaignIds', next.join(','));
    else np.delete('campaignIds');
    setSearchParams(np, { replace: true });
  }}
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificação manual**

`npm run dev`, `/inside-sales?tab=history`:
- Multi-select de campanhas na barra de filtros do histórico.
- Filtra os deals fechados conforme expectativa.

- [ ] **Step 6: Commit**

```bash
git add src/features/inside-sales/HistoryTable.tsx
git commit -m "feat(inside-sales): add campaigns multi-select filter to history table"
```

---

## Task 13: Smoke test final + build

**Files:** nenhum

- [ ] **Step 1: Rodar suíte de testes do backend**

Run: `npm test`
Expected: testes novos (`leads-list-campaigns.test.ts`, `deals-list-campaigns.test.ts`) verdes. Testes pré-existentes mantêm o mesmo status — não introduzir regressões.

- [ ] **Step 2: Build completo (frontend + server)**

Run: `npm run build`
Expected: sem erros TypeScript em nenhum dos dois passos.

- [ ] **Step 3: Smoke manual ponta-a-ponta**

`npm run dev`, com pelo menos um lead já presente que tem >=1 recipient com `sent_at IS NOT NULL`. Verifique nas três telas:

1. `/cadastros`:
   - Coluna "Campanhas" presente entre "Origem" e "Cadastro".
   - Lead com 1 campanha mostra 1 badge. Lead com 3+ mostra 2 + "+N".
   - Multi-select filtra corretamente; URL atualiza; refresh preserva.

2. `/inside-sales` (Pipeline):
   - Cards do Kanban mostram badge da campanha quando aplicável.
   - Filtro de campanhas reduz os cards.

3. `/inside-sales?tab=history`:
   - Filtro de campanhas funciona na lista de fechados.

- [ ] **Step 4: Commit final (opcional)**

Se houve ajustes durante o smoke:

```bash
git add -A
git commit -m "fix(lead-campaigns): smoke test adjustments"
```

---

## Edge cases e como verificá-los

| Caso | Verificação |
|---|---|
| Lead sem nenhum recipient | Célula vazia na coluna Campanhas; card sem badges. |
| Recipient pending | Não aparece nos badges nem ao filtrar pela campanha. |
| Campanha deletada (cascade já existe) | Recipients somem junto; agregação reflete imediato. |
| `campaignIds` com UUID inválido | API retorna 400 (zod). Verificar com `curl '.../leads?campaignIds=foo'`. |
| `campaignIds` com UUID válido inexistente | API retorna 200 com lista vazia (EXISTS não bate). |
| Lead com 50+ campanhas | Badges mostram 2 (ou 1 no Kanban) + "+N"; popover lista todas. |

