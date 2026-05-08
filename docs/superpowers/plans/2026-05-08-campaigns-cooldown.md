# Campaigns 24h Cooldown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que um lead receba mensagens de duas campanhas (e/ou de operador/IA) em janela de 24h. Aviso no preview, contadores no funil/card e notificação proativa.

**Architecture:** Predicado central `filterEligibleLeads(leadIds, opts)` numa única SQL com EXISTS. Aplicado em 4 pontos: dry-run (mostra contagem), criação de campanha (separa pending vs skipped), dispatcher (safety net antes do envio), enrollment contínuo (não enrola). Reaproveita `campaign_recipients.failure_reason` (texto) com a constante `'cooldown_24h'` — sem mudança de schema. Migration nova só pra `campaigns.cooldown_alert_sent_at` (idempotência da notificação).

**Tech Stack:** Postgres + Drizzle ORM, Express, Vitest + supertest (backend); React 19 + TanStack Query (frontend).

**Spec:** [docs/superpowers/specs/2026-05-08-campaigns-cooldown-design.md](../specs/2026-05-08-campaigns-cooldown-design.md)

---

## File Map

**Created:**
- `server/services/campaignsCooldown.ts` — predicado e `filterEligibleLeads`
- `server/db/migrations/025_campaigns_cooldown_alert.sql` — coluna `cooldown_alert_sent_at`
- `server/tests/campaigns-cooldown.test.ts` — predicado + criação + dispatcher
- `server/tests/campaigns-cooldown-notification.test.ts` — trigger e idempotência

**Modified — backend:**
- `shared/types.ts` — `CampaignDryRunResponse` (eligible, blocked); `CampaignFunnel` (skippedByCooldown, skippedOther); `NOTIFICATION_KINDS` ganha `'campaign_cooldown_high'`
- `server/db/schema.ts` — `campaigns.cooldownAlertSentAt`
- `server/services/campaignsAudience.ts` — `dryRun` calcula eligible/blocked
- `server/services/campaignsService.ts` — `createCampaign` separa recipients; `getCampaignFunnel` retorna breakdown
- `server/services/campaignsDispatcher.ts` — `sendOne` safety net; `processCampaign` notificação
- `server/services/continuousCampaign.ts` — `enrollLeadInContinuous` checa cooldown
- `server/tests/campaigns-dry-run.test.ts` — cobertura de eligible/blocked
- `server/tests/campaigns-funnel.test.ts` — cobertura de skippedByCooldown

**Modified — frontend:**
- `src/features/campaigns/types.ts` (e/ou `api.ts`) — tipos `CampaignDryRunResponse`/`CampaignFunnel` re-exportados
- `src/features/campaigns/AudienceStep.tsx` — linha de aviso
- `src/features/campaigns/CampaignList.tsx` — subtotal "Pulados por cooldown"
- `src/features/campaigns/CampaignFunnel.tsx` — breakdown de skipped
- `src/features/campaigns/RecipientsTable.tsx` — label amigável
- `src/features/notifications/NotificationBell.tsx` — `KIND_ICON`/`KIND_TONE` para o kind novo

---

## Task 1 — Migration: `campaigns.cooldown_alert_sent_at`

**Files:**
- Create: `server/db/migrations/025_campaigns_cooldown_alert.sql`

- [ ] **Step 1: Criar migration**

```sql
-- 025_campaigns_cooldown_alert.sql
-- Marca quando a notificação "muitos leads pulados por cooldown" foi enviada
-- pra essa campanha. Idempotência: notificação só dispara uma vez.
ALTER TABLE campaigns ADD COLUMN cooldown_alert_sent_at timestamptz;
```

- [ ] **Step 2: Aplicar**

Run: `npm run migrate`
Expected: log `applied 025_campaigns_cooldown_alert.sql`. Sem erros.

- [ ] **Step 3: Atualizar schema TS**

Em `server/db/schema.ts`, dentro do `pgTable('campaigns', ...)`, adicionar antes de `createdAt`:

```ts
cooldownAlertSentAt: timestamp('cooldown_alert_sent_at', { withTimezone: true }),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```
git add server/db/migrations/025_campaigns_cooldown_alert.sql server/db/schema.ts
git commit -m "db: add cooldown_alert_sent_at to campaigns"
```

---

## Task 2 — Predicado central `campaignsCooldown.ts`

**Files:**
- Create: `server/services/campaignsCooldown.ts`
- Test: `server/tests/campaigns-cooldown.test.ts`

- [ ] **Step 1: Escrever testes falhando**

Criar `server/tests/campaigns-cooldown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { campaignRecipients, campaigns } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createUser,
  createLead,
  createConversation,
  createMessage,
} from './helpers';
import { filterEligibleLeads, COOLDOWN_REASON } from '../services/campaignsCooldown';

async function createCampaign(input: {
  name?: string;
  status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  createdByUserId: string;
}) {
  const [c] = await db.insert(campaigns).values({
    name: input.name ?? 'Test',
    status: input.status ?? 'running',
    messageBody: 'oi',
    createdByUserId: input.createdByUserId,
  }).returning();
  return c;
}

describe('filterEligibleLeads', () => {
  it('lead com outbound há 5h é bloqueado por recent_outbound', async () => {
    const u = await createUser({ role: 'comercial' });
    const lead = await createLead({ phone: '5511900001001' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([]);
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lead com outbound há 25h é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u2@x.com' });
    const lead = await createLead({ phone: '5511900001002' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
    expect(r.blocked).toEqual([]);
  });

  it('lead pendente em campanha running é bloqueado', async () => {
    const u = await createUser({ role: 'comercial', email: 'u3@x.com' });
    const lead = await createLead({ phone: '5511900001003' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'pending_other_campaign' }]);
  });

  it('lead pendente em campanha draft é elegível', async () => {
    const u = await createUser({ role: 'comercial', email: 'u4@x.com' });
    const lead = await createLead({ phone: '5511900001004' });
    const camp = await createCampaign({ status: 'draft', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('excludeCampaignId ignora pendência da própria campanha', async () => {
    const u = await createUser({ role: 'comercial', email: 'u5@x.com' });
    const lead = await createLead({ phone: '5511900001005' });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], { excludeCampaignId: camp.id });
    expect(r.eligible).toEqual([lead.id]);
  });

  it('precedência: recent_outbound > pending_other_campaign', async () => {
    const u = await createUser({ role: 'comercial', email: 'u6@x.com' });
    const lead = await createLead({ phone: '5511900001006' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.blocked).toEqual([{ leadId: lead.id, reason: 'recent_outbound' }]);
  });

  it('lista vazia retorna eligible=[] blocked=[]', async () => {
    const r = await filterEligibleLeads([], {});
    expect(r).toEqual({ eligible: [], blocked: [] });
  });

  it('mensagem inbound não bloqueia', async () => {
    const lead = await createLead({ phone: '5511900001008' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'in',
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    const r = await filterEligibleLeads([lead.id], {});
    expect(r.eligible).toEqual([lead.id]);
  });

  it('exporta COOLDOWN_REASON = "cooldown_24h"', () => {
    expect(COOLDOWN_REASON).toBe('cooldown_24h');
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts`
Expected: FAIL — `Cannot find module '../services/campaignsCooldown'`.

- [ ] **Step 3: Implementar `campaignsCooldown.ts`**

Criar `server/services/campaignsCooldown.ts`:

```ts
import { db } from '../db/client';
import { sql } from 'drizzle-orm';

export const COOLDOWN_HOURS = 24;
export const COOLDOWN_REASON = 'cooldown_24h';

export type CooldownReason = 'recent_outbound' | 'pending_other_campaign';

export interface CooldownBlock {
  leadId: string;
  reason: CooldownReason;
}

export interface FilterResult {
  eligible: string[];
  blocked: CooldownBlock[];
}

/**
 * Para cada leadId, decide se está em cooldown:
 *  (A) recent_outbound  — mensagem outbound nas últimas 24h em qualquer
 *      conversa do lead (campanha, operador, IA — origem irrelevante).
 *  (B) pending_other_campaign — recipient pending em campanha running/scheduled
 *      diferente da informada em excludeCampaignId.
 *
 * Precedência: recent_outbound > pending_other_campaign (envio real é prova
 * mais forte que pendência).
 *
 * Implementação: 1 query só por chamada (CTEs com EXISTS), sem N round-trips.
 */
export async function filterEligibleLeads(
  leadIds: string[],
  opts: { excludeCampaignId?: string },
): Promise<FilterResult> {
  if (leadIds.length === 0) return { eligible: [], blocked: [] };

  const exclude = opts.excludeCampaignId ?? null;

  const result = await db.execute<{
    lead_id: string;
    recent_outbound: boolean;
    pending_other: boolean;
  }>(sql`
    WITH input(lead_id) AS (
      SELECT unnest(${sql.raw(`ARRAY[${leadIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
    )
    SELECT
      i.lead_id::text AS lead_id,
      EXISTS (
        SELECT 1
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.lead_id = i.lead_id
          AND m.direction = 'out'
          AND m.sent_at > now() - interval '${sql.raw(String(COOLDOWN_HOURS))} hours'
      ) AS recent_outbound,
      EXISTS (
        SELECT 1
        FROM campaign_recipients cr
        JOIN campaigns ca ON ca.id = cr.campaign_id
        WHERE cr.lead_id = i.lead_id
          AND cr.status = 'pending'
          AND ca.status IN ('running', 'scheduled')
          AND (${exclude}::uuid IS NULL OR ca.id <> ${exclude}::uuid)
      ) AS pending_other
    FROM input i
  `);

  const rows = result.rows;
  const eligible: string[] = [];
  const blocked: CooldownBlock[] = [];
  for (const r of rows) {
    if (r.recent_outbound) {
      blocked.push({ leadId: r.lead_id, reason: 'recent_outbound' });
    } else if (r.pending_other) {
      blocked.push({ leadId: r.lead_id, reason: 'pending_other_campaign' });
    } else {
      eligible.push(r.lead_id);
    }
  }
  return { eligible, blocked };
}
```

**Nota sobre a query:** a interpolação direta de `leadIds` em `ARRAY[...]` via `sql.raw` é segura aqui porque os ids são UUIDs validados pelo zod nas rotas que chamam essa função. Se algum caller passar string não-UUID, o `::uuid[]` cast falha cedo.

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts`
Expected: 9 PASS.

- [ ] **Step 5: Commit**

```
git add server/services/campaignsCooldown.ts server/tests/campaigns-cooldown.test.ts
git commit -m "campaigns: add filterEligibleLeads cooldown predicate"
```

---

## Task 3 — Tipos compartilhados: `CampaignDryRunResponse` + `CampaignFunnel` + notificação

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Atualizar `PublicCampaign`**

Encontrar a interface `PublicCampaign`. Adicionar campo `skippedByCooldown`:

```ts
export interface PublicCampaign {
  // ...campos existentes...
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  skippedByCooldown: number;   // novo — subtotal de skippedCount com failure_reason='cooldown_24h'
  ratePerMinute: number;
  // ...resto...
}
```

- [ ] **Step 2: Atualizar `CampaignDryRunResponse`**

Em `shared/types.ts`, encontrar e substituir:

```ts
export interface CampaignDryRunResponse {
  total: number;
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    cnpj: string | null;
    createdAt: string;
  }>;
}
```

Por:

```ts
export interface CampaignDryRunResponse {
  total: number;
  eligible: number;
  blocked: {
    recentOutbound: number;
    pendingOtherCampaign: number;
  };
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    cnpj: string | null;
    createdAt: string;
  }>;
}
```

- [ ] **Step 3: Atualizar `CampaignFunnel`**

Encontrar a interface `CampaignFunnel`. Adicionar dois campos:

```ts
export interface CampaignFunnel {
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  skippedByCooldown: number;   // novo
  skippedOther: number;        // novo
  replied: number;
  inDeal: number;
  won: number;
  lost: number;
  lostByReason: Record<LossReason, number>;
  totalWonValue: number;
}
```

(Os campos existentes ficam onde estão; só adiciona os dois novos.)

- [ ] **Step 4: Adicionar kind de notificação**

Encontrar `NOTIFICATION_KINDS` (linha ~544). Adicionar `'campaign_cooldown_high'`:

```ts
export const NOTIFICATION_KINDS = [
  'enrichment_completed',
  'enrichment_cancelled',
  'lead_qualified',
  'dispatch_failed',
  'whatsapp_disconnected',
  'campaign_cooldown_high',   // novo
  'system',
] as const;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: vai mostrar erros nos consumidores que ainda não preencheram os campos novos (campaignsAudience.dryRun, campaignsService.toPublicCampaign + getCampaignFunnel, NotificationBell). Esses serão fixados nas Tasks 4, 5, 6 e 12.

- [ ] **Step 6: Commit**

```
git add shared/types.ts
git commit -m "types: add cooldown fields to PublicCampaign, dryRun, funnel, and notification kind"
```

---

## Task 4 — `campaignsAudience.dryRun`: retorna eligible + blocked

**Files:**
- Modify: `server/services/campaignsAudience.ts`
- Test: `server/tests/campaigns-dry-run.test.ts`

- [ ] **Step 1: Escrever testes falhando**

Adicionar ao final de `server/tests/campaigns-dry-run.test.ts`, dentro do `describe('campaignsAudience.dryRun', () => { ... })`:

```ts
  it('retorna eligible e blocked com cooldown', async () => {
    const u = await (await import('./helpers')).createUser({ role: 'comercial', email: 'dr1@x.com' });
    const eligibleLead = await createLead({ phone: '5511900050001', status: 'frio' });
    const blockedLead = await createLead({ phone: '5511900050002', status: 'frio' });
    const conv = await (await import('./helpers')).createConversation({ leadId: blockedLead.id });
    await (await import('./helpers')).createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const r = await dryRun({ status: ['frio'] });
    expect(r.total).toBe(2);
    expect(r.eligible).toBe(1);
    expect(r.blocked.recentOutbound).toBe(1);
    expect(r.blocked.pendingOtherCampaign).toBe(0);
    expect(r.preview.find((p) => p.leadId === blockedLead.id)).toBeUndefined();
    expect(r.preview.find((p) => p.leadId === eligibleLead.id)).toBeDefined();
  });
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-dry-run.test.ts -t "eligible e blocked"`
Expected: FAIL — `expected undefined to be 1` (campos não existem ainda).

- [ ] **Step 3: Atualizar `dryRun()`**

Em `server/services/campaignsAudience.ts`, substituir a função `dryRun`:

```ts
import { filterEligibleLeads } from './campaignsCooldown';

// ...

export async function dryRun(filter: AudienceFilters): Promise<CampaignDryRunResponse> {
  const where = buildWhere(filter);

  // Resolve TODOS os ids para passar pelo cooldown filter.
  const allRows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      cnpj: leads.cnpj,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where);

  const total = allRows.length;
  const ids = allRows.map((r) => r.leadId);
  const { eligible, blocked } = await filterEligibleLeads(ids, {});

  const eligibleSet = new Set(eligible);
  const previewRows = allRows
    .filter((r) => eligibleSet.has(r.leadId))
    .filter((r): r is typeof r & { phone: string } => r.phone !== null)
    .slice(0, PREVIEW_LIMIT);

  const blockedCounts = blocked.reduce(
    (acc, b) => {
      if (b.reason === 'recent_outbound') acc.recentOutbound++;
      else acc.pendingOtherCampaign++;
      return acc;
    },
    { recentOutbound: 0, pendingOtherCampaign: 0 },
  );

  return {
    total,
    eligible: eligible.length,
    blocked: blockedCounts,
    preview: previewRows.map((r) => ({
      leadId: r.leadId,
      name: r.name,
      phone: r.phone,
      cnpj: r.cnpj,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-dry-run.test.ts`
Expected: todos PASS, incluindo o novo.

- [ ] **Step 5: Commit**

```
git add server/services/campaignsAudience.ts server/tests/campaigns-dry-run.test.ts
git commit -m "campaigns(audience): dryRun returns eligible and blocked breakdown"
```

---

## Task 5 — `createCampaign` materializa pending vs skipped

**Files:**
- Modify: `server/services/campaignsService.ts`
- Test: `server/tests/campaigns-cooldown.test.ts` (estender)

- [ ] **Step 1: Escrever teste falhando**

Adicionar ao final de `server/tests/campaigns-cooldown.test.ts`:

```ts
import { createCampaign } from '../services/campaignsService';

describe('createCampaign + cooldown', () => {
  it('separa elegíveis (pending) de bloqueados (skipped cooldown_24h)', async () => {
    const u = await createUser({ role: 'comercial', email: 'cc1@x.com' });
    const ok = await createLead({ phone: '5511900060001', status: 'frio' });
    const blocked = await createLead({ phone: '5511900060002', status: 'frio' });

    const conv = await createConversation({ leadId: blocked.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const c = await createCampaign({
      name: 'cooldown-test',
      messageBody: 'oi {{nome}}',
      audienceFilter: { status: ['frio'] },
      createdByUserId: u.id,
    });

    const recs = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, c.id));
    expect(recs).toHaveLength(2);
    const pendingR = recs.find((r) => r.leadId === ok.id);
    const skippedR = recs.find((r) => r.leadId === blocked.id);
    expect(pendingR?.status).toBe('pending');
    expect(skippedR?.status).toBe('skipped');
    expect(skippedR?.failureReason).toBe(COOLDOWN_REASON);

    const [campRow] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(campRow.audienceTotal).toBe(2);
    expect(campRow.skippedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts -t "separa elegíveis"`
Expected: FAIL — recipients todos como `pending`, `skippedCount=0`.

- [ ] **Step 3: Atualizar `createCampaign`**

Em `server/services/campaignsService.ts`, no topo:

```ts
import { filterEligibleLeads, COOLDOWN_REASON } from './campaignsCooldown';
```

Substituir o corpo de `createCampaign` (a partir do `return db.transaction(...)`):

```ts
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
  const audience = await resolveAudience(input.audienceFilter);
  const audienceIds = audience.map((a) => a.leadId);
  const { eligible, blocked } = await filterEligibleLeads(audienceIds, {});

  const eligibleSet = new Set(eligible);
  const eligibleRows = audience.filter((a) => eligibleSet.has(a.leadId));
  const blockedRows = audience.filter((a) => !eligibleSet.has(a.leadId));

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
      skippedCount: blockedRows.length,
      scheduledAt: input.scheduledAt ?? null,
      ratePerMinute: input.ratePerMinute ?? 20,
      createdByUserId: input.createdByUserId,
    }).returning();

    if (eligibleRows.length > 0) {
      await tx.insert(campaignRecipients)
        .values(eligibleRows.map((a) => ({
          campaignId: c.id,
          leadId: a.leadId,
          phone: a.phone,
        })))
        .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.leadId] });
    }

    if (blockedRows.length > 0) {
      await tx.insert(campaignRecipients)
        .values(blockedRows.map((a) => ({
          campaignId: c.id,
          leadId: a.leadId,
          phone: a.phone,
          status: 'skipped' as const,
          failureReason: COOLDOWN_REASON,
        })))
        .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.leadId] });
    }

    void blocked; // breakdown blocked-by-reason não é usado aqui (só no dryRun).

    const [creator] = await tx.select().from(users).where(eq(users.id, input.createdByUserId)).limit(1);
    return toPublicCampaign(c, creator ?? null);
  });
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts server/tests/campaigns-create.test.ts`
Expected: todos PASS, incluindo o novo. Os existentes de `campaigns-create.test.ts` precisam continuar verdes — se algum verifica `recipients.length === audienceTotal`, ele continua válido (audience_total inclui bloqueados também).

- [ ] **Step 5: Commit**

```
git add server/services/campaignsService.ts server/tests/campaigns-cooldown.test.ts
git commit -m "campaigns: createCampaign separates pending vs cooldown-skipped recipients"
```

---

## Task 5b — Expor `skippedByCooldown` em `PublicCampaign`

**Files:**
- Modify: `server/services/campaignsService.ts`

A interface `PublicCampaign` ganhou `skippedByCooldown` na Task 3. Falta popular esse campo em todos os caminhos que produzem `PublicCampaign`: `createCampaign`, `getCampaignById`, `listCampaigns`. Cada chamada conta os recipients do tipo cooldown numa query batch.

- [ ] **Step 1: Escrever teste falhando**

Adicionar em `server/tests/campaigns-cooldown.test.ts`:

```ts
import { listCampaigns, getCampaignById } from '../services/campaignsService';

describe('PublicCampaign.skippedByCooldown', () => {
  it('createCampaign retorna skippedByCooldown', async () => {
    const u = await createUser({ role: 'comercial', email: 'pc1@x.com' });
    const ok = await createLead({ phone: '5511900110001', status: 'frio' });
    const blocked = await createLead({ phone: '5511900110002', status: 'frio' });
    const conv = await createConversation({ leadId: blocked.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const c = await (await import('../services/campaignsService')).createCampaign({
      name: 'pc-cool',
      messageBody: 'oi',
      audienceFilter: { status: ['frio'] },
      createdByUserId: u.id,
    });

    expect(c.skippedByCooldown).toBe(1);
    expect(c.skippedCount).toBe(1);

    const fetched = await getCampaignById(c.id);
    expect(fetched.skippedByCooldown).toBe(1);

    const list = await listCampaigns({});
    const found = list.items.find((x) => x.id === c.id);
    expect(found?.skippedByCooldown).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts -t "skippedByCooldown"`
Expected: FAIL — `skippedByCooldown` undefined.

- [ ] **Step 3: Atualizar `toPublicCampaign` (assinatura)**

Em `server/services/campaignsService.ts`, alterar `toPublicCampaign` pra aceitar a contagem:

```ts
function toPublicCampaign(
  row: typeof campaigns.$inferSelect,
  creator: typeof users.$inferSelect | null,
  skippedByCooldown: number,
): PublicCampaign {
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
    skippedByCooldown,
    ratePerMinute: row.ratePerMinute,
    createdBy: creator
      ? { id: creator.id, name: creator.name }
      : { id: row.createdByUserId, name: 'Usuário' },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function countSkippedByCooldown(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int` })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));
  return row?.n ?? 0;
}
```

- [ ] **Step 4: Atualizar `getCampaignById`**

Substituir:

```ts
export async function getCampaignById(id: string): Promise<PublicCampaign> {
  const [row] = await db
    .select({ campaign: campaigns, creator: users })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.createdByUserId, users.id))
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  const skippedByCooldown = await countSkippedByCooldown(id);
  return toPublicCampaign(row.campaign, row.creator, skippedByCooldown);
}
```

- [ ] **Step 5: Atualizar `listCampaigns`**

Substituir o map final por uma versão que pré-carrega o map de contagens em uma query única:

```ts
  const ids = rows.map((r) => r.campaign.id);
  const cooldownCounts = ids.length
    ? await db
        .select({
          campaignId: campaignRecipients.campaignId,
          n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int`,
        })
        .from(campaignRecipients)
        .where(inArray(campaignRecipients.campaignId, ids))
        .groupBy(campaignRecipients.campaignId)
    : [];
  const cooldownMap = new Map(cooldownCounts.map((c) => [c.campaignId, c.n]));

  return {
    items: rows.map((r) => toPublicCampaign(r.campaign, r.creator, cooldownMap.get(r.campaign.id) ?? 0)),
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
  };
}
```

(Garanta que `inArray` já está importado. Está, no topo do arquivo.)

- [ ] **Step 6: Atualizar `createCampaign`**

Na chamada final ao retornar do `db.transaction`, trocar:

```ts
return toPublicCampaign(c, creator ?? null);
```

Por:

```ts
return toPublicCampaign(c, creator ?? null, blockedRows.length);
```

(O `blockedRows` da Task 5 já tem o número exato de cooldown skips.)

- [ ] **Step 7: Rodar testes**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts server/tests/campaigns-create.test.ts server/tests/campaigns-crud.test.ts`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```
git add server/services/campaignsService.ts server/tests/campaigns-cooldown.test.ts
git commit -m "campaigns: expose skippedByCooldown on PublicCampaign across list/getById/create"
```

---

## Task 6 — `getCampaignFunnel`: breakdown skippedByCooldown / skippedOther

**Files:**
- Modify: `server/services/campaignsService.ts`
- Test: `server/tests/campaigns-funnel.test.ts`

- [ ] **Step 1: Escrever teste falhando**

Em `server/tests/campaigns-funnel.test.ts`, adicionar ao final do top-level describe:

```ts
  it('separa skippedByCooldown de skippedOther', async () => {
    const u = await createUser({ role: 'comercial', email: 'fn1@x.com' });
    const lead1 = await createLead({ phone: '5511900070001' });
    const lead2 = await createLead({ phone: '5511900070002' });
    const lead3 = await createLead({ phone: '5511900070003' });

    const c = await createCampaignRow({ createdByUserId: u.id, audienceTotal: 3 });
    await db.insert(campaignRecipients).values([
      { campaignId: c.id, leadId: lead1.id, phone: lead1.phone!, status: 'sent' },
      { campaignId: c.id, leadId: lead2.id, phone: lead2.phone!, status: 'skipped', failureReason: 'cooldown_24h' },
      { campaignId: c.id, leadId: lead3.id, phone: lead3.phone!, status: 'skipped', failureReason: 'uazapi: 401 unauthorized' },
    ]);

    const f = await getCampaignFunnel(c.id);
    expect(f.sent).toBe(1);
    expect(f.skipped).toBe(2);
    expect(f.skippedByCooldown).toBe(1);
    expect(f.skippedOther).toBe(1);
  });
```

(Use os helpers `createCampaignRow`/`createUser`/`createLead` existentes no arquivo. Se não existir um helper para campanha, faça insert direto via `db.insert(campaigns)` como nos outros testes.)

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-funnel.test.ts -t "skippedByCooldown"`
Expected: FAIL — propriedades não existem na resposta.

- [ ] **Step 3: Atualizar `getCampaignFunnel`**

Em `server/services/campaignsService.ts`, substituir o SELECT de counts (linha ~263):

```ts
const [counts] = await db.select({
  total: sql<number>`count(*)::int`,
  sent: sql<number>`count(*) FILTER (WHERE status = 'sent')::int`,
  failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
  skipped: sql<number>`count(*) FILTER (WHERE status = 'skipped')::int`,
  skippedByCooldown: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = 'cooldown_24h')::int`,
  skippedOther: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND (failure_reason IS NULL OR failure_reason <> 'cooldown_24h'))::int`,
}).from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
```

E no `return` final, adicionar:

```ts
  return {
    totalRecipients: counts.total,
    sent: counts.sent,
    failed: counts.failed,
    skipped: counts.skipped,
    skippedByCooldown: counts.skippedByCooldown,
    skippedOther: counts.skippedOther,
    replied,
    inDeal,
    won,
    lost,
    lostByReason,
    totalWonValue,
  };
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-funnel.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```
git add server/services/campaignsService.ts server/tests/campaigns-funnel.test.ts
git commit -m "campaigns(funnel): split skipped into cooldown vs other"
```

---

## Task 7 — Dispatcher: safety net antes do envio

**Files:**
- Modify: `server/services/campaignsDispatcher.ts`
- Test: `server/tests/campaigns-cooldown.test.ts` (estender)

- [ ] **Step 1: Escrever teste falhando**

Adicionar em `server/tests/campaigns-cooldown.test.ts`:

```ts
import { tick } from '../services/campaignsDispatcher';
import { uazapiClient } from '../services/uazapiClient';
import { vi } from 'vitest';

describe('dispatcher + cooldown safety net', () => {
  it('lead que ficou em cooldown entre criação e dispatch é skipped', async () => {
    const u = await createUser({ role: 'comercial', email: 'ds1@x.com' });
    const lead = await createLead({ phone: '5511900080001', status: 'frio' });

    // Recipient pending criado direto (simula campanha já materializada)
    const camp = await createCampaign({ status: 'running', createdByUserId: u.id });
    await db.insert(campaignRecipients).values({
      campaignId: camp.id,
      leadId: lead.id,
      phone: lead.phone!,
      status: 'pending',
    });

    // Cooldown ativa AGORA: alguém mandou outbound há 1h
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const sendSpy = vi.spyOn(uazapiClient, 'sendMessage');

    await tick();

    const [r] = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, camp.id));
    expect(r.status).toBe('skipped');
    expect(r.failureReason).toBe(COOLDOWN_REASON);
    expect(sendSpy).not.toHaveBeenCalled();

    const [campAfter] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(campAfter.skippedCount).toBe(1);
    expect(campAfter.sentCount).toBe(0);

    sendSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts -t "safety net"`
Expected: FAIL — uazapi seria chamado e recipient ficaria sent/failed.

- [ ] **Step 3: Atualizar `sendOne` no dispatcher**

Em `server/services/campaignsDispatcher.ts`, no topo:

```ts
import { filterEligibleLeads, COOLDOWN_REASON } from './campaignsCooldown';
```

No início de `sendOne(c, r)`, **antes** do bloco `try { ... }`, adicionar:

```ts
async function sendOne(c: Campaign, r: CampaignRecipient): Promise<void> {
  // Safety net: cooldown pode ter ativado entre criação e dispatch.
  const { eligible } = await filterEligibleLeads([r.leadId], { excludeCampaignId: c.id });
  if (eligible.length === 0) {
    await db.update(campaignRecipients).set({
      status: 'skipped',
      failureReason: COOLDOWN_REASON,
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));
    await db.update(campaigns).set({
      skippedCount: sql`${campaigns.skippedCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    return;
  }

  try {
    // ...código existente...
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-cooldown.test.ts server/tests/campaigns-dispatch.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```
git add server/services/campaignsDispatcher.ts server/tests/campaigns-cooldown.test.ts
git commit -m "campaigns(dispatcher): cooldown safety net before send"
```

---

## Task 8 — Dispatcher: notificação proativa quando >10% pulado

**Files:**
- Modify: `server/services/campaignsDispatcher.ts`
- Test: `server/tests/campaigns-cooldown-notification.test.ts` (criar)

- [ ] **Step 1: Escrever teste falhando**

Criar `server/tests/campaigns-cooldown-notification.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import {
  campaigns,
  campaignRecipients,
  notifications,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createUser,
  createLead,
  createConversation,
  createMessage,
} from './helpers';
import { tick } from '../services/campaignsDispatcher';

async function createCampaignRow(input: { audienceTotal: number; userId: string }) {
  const [c] = await db.insert(campaigns).values({
    name: 'cool-notif',
    status: 'running',
    messageBody: 'oi',
    audienceTotal: input.audienceTotal,
    createdByUserId: input.userId,
    ratePerMinute: 1000,
  }).returning();
  return c;
}

describe('campaign cooldown notification', () => {
  beforeEach(async () => {
    await db.delete(notifications);
  });

  it('cria notificação campaign_cooldown_high quando >10% pulado por cooldown', async () => {
    const admin = await createUser({ role: 'admin', email: 'na@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 10, userId: u.id });

    // 8 sent (não pulados), 2 skipped por cooldown (=20% > 10%).
    for (let i = 0; i < 8; i++) {
      const lead = await createLead({ phone: `551190009${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!, status: 'sent',
      });
    }
    for (let i = 0; i < 2; i++) {
      const lead = await createLead({ phone: `551190009${String(i + 100).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 2, sentCount: 8 })
      .where(eq(campaigns.id, camp.id));

    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe('campaign_cooldown_high');

    const [after] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(after.cooldownAlertSentAt).not.toBeNull();
  });

  it('idempotência: tick subsequente não duplica', async () => {
    const admin = await createUser({ role: 'admin', email: 'na2@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu2@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 10, userId: u.id });
    for (let i = 0; i < 8; i++) {
      const lead = await createLead({ phone: `551190019${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!, status: 'sent',
      });
    }
    for (let i = 0; i < 2; i++) {
      const lead = await createLead({ phone: `551190019${String(i + 100).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 2, sentCount: 8 })
      .where(eq(campaigns.id, camp.id));

    await tick();
    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(1);
  });

  it('não dispara quando ratio <= 10%', async () => {
    const admin = await createUser({ role: 'admin', email: 'na3@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu3@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 100, userId: u.id });
    for (let i = 0; i < 5; i++) {
      const lead = await createLead({ phone: `551190029${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 5 })
      .where(eq(campaigns.id, camp.id));

    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/campaigns-cooldown-notification.test.ts`
Expected: FAIL — sem notificação criada (lógica não existe ainda).

- [ ] **Step 3: Implementar trigger no dispatcher**

Em `server/services/campaignsDispatcher.ts`, adicionar imports:

```ts
import { emitNotification } from './notifications';
import { COOLDOWN_REASON } from './campaignsCooldown';
```

(`COOLDOWN_REASON` já vem do import da Task 7; ignore se duplicado.)

Adicionar uma função utilitária no arquivo:

```ts
async function maybeEmitCooldownAlert(c: Campaign): Promise<void> {
  if (c.cooldownAlertSentAt) return;
  if (c.audienceTotal <= 0) return;

  const [counts] = await db.select({
    n: sql<number>`count(*) FILTER (WHERE status = 'skipped' AND failure_reason = ${COOLDOWN_REASON})::int`,
  }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));

  const ratio = counts.n / c.audienceTotal;
  if (ratio <= 0.10) return;

  await emitNotification({
    toRoles: ['admin'],
    kind: 'campaign_cooldown_high',
    title: 'Muitos leads pulados por cooldown',
    body: `Campanha "${c.name}": ${counts.n} de ${c.audienceTotal} leads pulados (janela de 24h).`,
    actionUrl: `/campaigns/${c.id}?recipientStatus=skipped`,
    metadata: {
      campaignId: c.id,
      campaignName: c.name,
      skippedCount: counts.n,
      audienceTotal: c.audienceTotal,
      ratio,
    },
  });

  await db.update(campaigns)
    .set({ cooldownAlertSentAt: new Date(), updatedAt: new Date() })
    .where(eq(campaigns.id, c.id));
}
```

Modificar `processCampaign(c)` para chamar `maybeEmitCooldownAlert(c)` ao final, após o loop de envio. **Antes do fim da função**, adicionar:

```ts
await maybeEmitCooldownAlert(c);
```

A chamada deve acontecer mesmo quando `recipients.length === 0`. Estrutura final do `processCampaign`:

```ts
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
    if (c.isContinuous) {
      await maybeEmitCooldownAlert(c);
      return;
    }
    await db.update(campaigns).set({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, c.id));
    await maybeEmitCooldownAlert(c);
    return;
  }

  const intervalMs = Math.max(100, Math.floor(60_000 / limit));

  for (const r of recipients) {
    const [fresh] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, c.id));
    if (!fresh || fresh.status !== 'running') break;

    await sendOne(c, r);
    await sleep(intervalMs);
  }

  await maybeEmitCooldownAlert(c);
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/campaigns-cooldown-notification.test.ts server/tests/campaigns-dispatch.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```
git add server/services/campaignsDispatcher.ts server/tests/campaigns-cooldown-notification.test.ts
git commit -m "campaigns(dispatcher): emit campaign_cooldown_high when >10% skipped"
```

---

## Task 9 — Continuous campaign: enrollment respeita cooldown

**Files:**
- Modify: `server/services/continuousCampaign.ts`
- Test: `server/tests/continuous-campaign.test.ts` (estender)

- [ ] **Step 1: Escrever teste falhando**

Em `server/tests/continuous-campaign.test.ts`, adicionar (no final do top-level describe ou num describe novo):

```ts
import { filterEligibleLeads as _ensureImport } from '../services/campaignsCooldown';
void _ensureImport;

describe('enrollment + cooldown', () => {
  it('lead em cooldown não é enrolado (sem recipient row criado)', async () => {
    // setup: criar campanha contínua running e lead com outbound recente.
    // Use os helpers existentes do arquivo para criar a campanha contínua;
    // se houver helper `createContinuousCampaign`, use-o; senão, insira via db.

    const u = await createUser({ role: 'comercial', email: 'cc-cool@x.com' });
    const lead = await createLead({ phone: '5511900090001', flowStage: 'complete' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    // Criar uma campanha contínua running.
    const [cont] = await db.insert(campaigns).values({
      name: 'cont',
      status: 'running',
      messageBody: 'oi',
      isContinuous: true,
      createdByUserId: u.id,
    }).returning();

    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('lead_in_cooldown');

    const recs = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, cont.id));
    expect(recs).toHaveLength(0);
  });
});
```

(Importe `enrollLeadInContinuous`, `db`, `campaigns`, `campaignRecipients`, `eq` no topo se ainda não estão.)

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run server/tests/continuous-campaign.test.ts -t "cooldown"`
Expected: FAIL — `EnrollResult.status` não tem `'lead_in_cooldown'`.

- [ ] **Step 3: Atualizar tipo e função**

Em `server/services/continuousCampaign.ts`:

```ts
import { filterEligibleLeads } from './campaignsCooldown';
```

Atualizar o tipo `EnrollResult`:

```ts
export type EnrollResult =
  | { status: 'enrolled' }
  | { status: 'no_continuous_campaign' }
  | { status: 'campaign_paused' }
  | { status: 'lead_no_phone' }
  | { status: 'already_enrolled' }
  | { status: 'lead_in_cooldown' }
  | { status: 'lead_not_complete'; currentStage: string };
```

Em `enrollLeadInContinuous(leadId)`, **antes** do `await db.insert(campaignRecipients)...` (logo após o early-return de `already_enrolled`), adicionar:

```ts
  const { eligible } = await filterEligibleLeads([leadId], { excludeCampaignId: cont.id });
  if (eligible.length === 0) {
    return { status: 'lead_in_cooldown' };
  }
```

Também ajustar `tryEnrollSafe` para incluir o novo status na lista de "skip log":

```ts
export async function tryEnrollSafe(leadId: string): Promise<void> {
  try {
    const r = await enrollLeadInContinuous(leadId);
    if (
      r.status !== 'enrolled' &&
      r.status !== 'already_enrolled' &&
      r.status !== 'no_continuous_campaign' &&
      r.status !== 'campaign_paused' &&
      r.status !== 'lead_in_cooldown'
    ) {
      console.log('[continuous] enroll skip:', r.status, leadId);
    }
  } catch (err) {
    console.warn('[continuous] enroll failed for lead', leadId, err);
  }
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/continuous-campaign.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```
git add server/services/continuousCampaign.ts server/tests/continuous-campaign.test.ts
git commit -m "campaigns(continuous): skip enrollment when lead is in cooldown"
```

---

## Task 10 — Frontend: tipos + AudienceStep

**Files:**
- Modify: `src/features/campaigns/types.ts` (re-exports) e/ou `api.ts`
- Modify: `src/features/campaigns/AudienceStep.tsx`

- [ ] **Step 1: Verificar onde `CampaignDryRunResponse` é consumido no frontend**

Run (Grep):
```
pattern: CampaignDryRunResponse
glob: src/features/campaigns/**
```

Os tipos vêm de `@shared/types`. Confirma que `AudienceStep.tsx` usa `CampaignDryRunResponse`. Não precisa re-exportar.

- [ ] **Step 2: Atualizar UI no `AudienceStep.tsx`**

Encontrar o ponto onde o resultado do dryRun é exibido (procurar por `total` ou pelo texto que mostra a contagem de leads). Adicionar abaixo da linha do total:

```tsx
{result && result.total > 0 && (result.blocked.recentOutbound + result.blocked.pendingOtherCampaign) > 0 && (
  <div className="mt-2 text-[12px] text-lc-amber leading-snug">
    <div className="font-medium">
      Elegíveis: {result.eligible} · Pulados por cooldown: {result.blocked.recentOutbound + result.blocked.pendingOtherCampaign}
    </div>
    {result.blocked.recentOutbound > 0 && (
      <div className="ml-3">
        └─ {result.blocked.recentOutbound} receberam mensagem nas últimas 24h
      </div>
    )}
    {result.blocked.pendingOtherCampaign > 0 && (
      <div className="ml-3">
        └─ {result.blocked.pendingOtherCampaign} já estão em outra campanha ativa
      </div>
    )}
  </div>
)}
```

(Substitua `result` pelo nome real da variável que carrega o `CampaignDryRunResponse` no componente — provavelmente `audience`, `dryRun`, ou `data` retornado de um `useQuery`.)

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos. O `AudienceStep` agora consome os campos `eligible` e `blocked` que existem no tipo (Task 3).

- [ ] **Step 4: Commit**

```
git add src/features/campaigns/AudienceStep.tsx
git commit -m "campaigns(audience-ui): show cooldown breakdown in dry-run"
```

---

## Task 11 — Frontend: CampaignList + CampaignFunnel + RecipientsTable

**Files:**
- Modify: `src/features/campaigns/CampaignList.tsx`
- Modify: `src/features/campaigns/CampaignFunnel.tsx`
- Modify: `src/features/campaigns/RecipientsTable.tsx`

- [ ] **Step 1: CampaignList — subtotal de cooldown no card**

Em `src/features/campaigns/CampaignList.tsx`, encontrar onde `skippedCount` é exibido. `PublicCampaign` agora inclui `skippedByCooldown` (Task 5b). Adicionar uma linha condicional logo abaixo do "Pulados":

```tsx
import { Clock } from 'lucide-react';

// ...no card, abaixo da linha de Pulados:
{campaign.skippedByCooldown > 0 && (
  <div className="flex items-center gap-1 text-[11px] text-lc-amber mt-0.5">
    <Clock className="h-3 w-3" />
    <span>{campaign.skippedByCooldown} por cooldown 24h</span>
  </div>
)}
```

(Adapte ao layout exato — o trecho indica o conteúdo, não a estrutura completa do card.)

- [ ] **Step 2: CampaignFunnel — breakdown de skipped**

Em `src/features/campaigns/CampaignFunnel.tsx`, encontrar a linha que mostra `funnel.skipped`. Substituir por:

```tsx
<div>
  <div className="text-xs text-muted-foreground">Pulados</div>
  <div className="text-lg font-semibold">{funnel.skipped}</div>
  {funnel.skippedByCooldown > 0 && (
    <div className="text-[11px] text-lc-amber mt-0.5">
      janela 24h: {funnel.skippedByCooldown}
    </div>
  )}
  {funnel.skippedOther > 0 && (
    <div className="text-[11px] text-muted-foreground">
      outros: {funnel.skippedOther}
    </div>
  )}
</div>
```

(Adapte ao layout exato do componente — o trecho acima é o conteúdo da célula "Pulados" do funnel atual. Mantenha o resto inalterado.)

- [ ] **Step 3: RecipientsTable — label amigável**

Em `src/features/campaigns/RecipientsTable.tsx`, encontrar onde `failureReason` é renderizado. Adicionar uma função de mapeamento no topo do arquivo:

```tsx
function failureReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  if (reason === 'cooldown_24h') return 'Janela de 24h';
  return reason;
}
```

E na coluna que mostra o motivo:

```tsx
<td className="...">{failureReasonLabel(r.failureReason)}</td>
```

(Substitua `r.failureReason` pelo nome real da prop. Se a tabela não mostra failure_reason hoje, adicione uma coluna nova quando o filtro de status for "skipped".)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```
git add src/features/campaigns/CampaignFunnel.tsx src/features/campaigns/RecipientsTable.tsx
git commit -m "campaigns(ui): cooldown breakdown in funnel and friendly label in recipients"
```

---

## Task 12 — Frontend: NotificationBell ganha o kind novo

**Files:**
- Modify: `src/features/notifications/NotificationBell.tsx:18-34`

- [ ] **Step 1: Atualizar `KIND_ICON` e `KIND_TONE`**

Em `src/features/notifications/NotificationBell.tsx`:

a) Adicionar `Clock` ao import do lucide-react:

```tsx
import { Bell, CheckCheck, Inbox, ShieldCheck, Search, Send, Wifi, Clock } from 'lucide-react';
```

b) Adicionar a chave nova ao `KIND_ICON`:

```tsx
const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  enrichment_completed:    Search,
  enrichment_cancelled:    Search,
  lead_qualified:          ShieldCheck,
  dispatch_failed:         Send,
  whatsapp_disconnected:   Wifi,
  campaign_cooldown_high:  Clock,
  system:                  Bell,
};
```

c) Adicionar a chave nova ao `KIND_TONE`:

```tsx
const KIND_TONE: Record<NotificationKind, string> = {
  enrichment_completed:    'text-emerald-600 dark:text-emerald-400',
  enrichment_cancelled:    'text-slate-500',
  lead_qualified:          'text-emerald-600 dark:text-emerald-400',
  dispatch_failed:         'text-destructive',
  whatsapp_disconnected:   'text-amber-600 dark:text-amber-400',
  campaign_cooldown_high:  'text-amber-600 dark:text-amber-400',
  system:                  'text-slate-500',
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erros (Records cobrem todos os kinds, incluindo o novo).

- [ ] **Step 3: Commit**

```
git add src/features/notifications/NotificationBell.tsx
git commit -m "notifications(ui): icon and tone for campaign_cooldown_high"
```

---

## Task 13 — Verificação final

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: sucesso (typecheck client + server + vite build).

- [ ] **Step 2: Suite de testes completa**

Run: `npm test`
Expected: todos os testes do escopo passam. Os 4 testes pré-existentes em `leads-api`/`leads-service` continuam falhando (são pre-existentes; NÃO mexer).

- [ ] **Step 3: Smoke manual end-to-end**

Em `npm run dev`:

1. Login. Criar campanha A com audience "leads frio". Confirmar dry-run mostra "Pulados por cooldown: 0" (oculto se zero).
2. Disparar A (status running). Aguardar pelo menos 1 lead receber.
3. Criar campanha B com audience "leads frio" cobrindo o mesmo público. Dry-run agora deve mostrar pelo menos 1 em `recentOutbound` (lead que recebeu A) e os pendentes de A em `pendingOtherCampaign`.
4. Confirmar criação de B. Olhar `RecipientsTable` filtrando por "skipped" → motivo "Janela de 24h".
5. Olhar `CampaignFunnel` da B → "janela 24h: X" no card de pulados.
6. Se >10% da audiência caiu em cooldown, abrir o sino → notificação `campaign_cooldown_high` com link para `/campaigns/{B}?recipientStatus=skipped`.
7. Reiniciar servidor; voltar a abrir B → notificação não duplica (idempotência via `cooldownAlertSentAt`).

- [ ] **Step 4: Push (somente após confirmação humana)**

Não fazer push automaticamente. O operador valida o smoke manual e dá ok.
