# Card por campanha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O card do Inside Sales passa a pertencer a uma campanha: a IA abre um card novo por campanha em que qualifica o lead, os cards de campanhas diferentes convivem, e quando a campanha encerra (fim da vigência ou botão) os cards abertos dela viram perdidos e saem do Kanban.

**Architecture:** Coluna `deals.campaign_id` + índice único "1 card aberto por (lead, campanha)" (migration 049) + motivo de perda `campanha_encerrada` (migration 048). Uma função (`resolveQualificationCampaign`) decide a campanha do card; `createDeal` usa essa campanha como "balde". Um serviço (`closeCampaignCards`) fecha os cards de uma campanha; é chamado por um worker a cada 15 min e pelo botão "Encerrar campanha". Leituras que assumiam "um card por lead" passam a usar o card aberto mais recente; relatórios contam cada card só na própria campanha.

**Tech Stack:** Express + Drizzle ORM 0.45 + Postgres (Supabase, schema `lubritec`), React 19 + TanStack Query, Vitest + supertest com Postgres embutido.

**Spec:** `docs/superpowers/specs/2026-09-28-card-por-campanha-design.md`

## Global Constraints

- Migrations são SQL puro em `server/db/migrations/`, numeradas `048` e `049`. O runner (`server/scripts/migrate.ts` e `server/tests/globalSetup.ts`) envolve **cada arquivo** numa transação. `ALTER TYPE ... ADD VALUE` fica em arquivo próprio (048), porque o valor novo não pode ser usado na mesma transação.
- A 049 precisa ser **idempotente** (`IF NOT EXISTS`, `IF EXISTS`, `WHERE campaign_id IS NULL`): o teste a reexecuta sobre um banco que já a aplicou.
- Vigência: campanha comum é **vigente** quando `validity_end >= now()` (o instante do fim ainda vale — mesma regra de `src/features/campaigns/validity.ts`) e **vencida** quando `validity_end < now()`. Comum sem vigência (`validity_end IS NULL`, anteriores a 31/08/2026) nunca é vigente. Contínua (`is_continuous = true`) é sempre vigente e nunca é varrida.
- Motivo novo: `'campanha_encerrada'`, rótulo `'Campanha encerrada'`. Só o sistema usa: nunca aparece na lista do fechamento manual e a API de mudança de etapa o recusa.
- "Sem campanha" é um balde próprio no índice: `COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)`.
- Rodar testes: `npx vitest run <arquivo>`. O Postgres de teste é embutido, **porta 15432 e pasta fixas**: antes de rodar, conferir que nenhuma outra sessão está rodando a suíte (`tasklist //FI "IMAGENAME eq postgres.exe"`); nunca derrubar o Postgres de outra sessão.
- Typecheck: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`.
- Código e comentários em português, no estilo do arquivo que está sendo editado. Comentário explica o porquê, não repete o código.
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Trabalhar na worktree `.worktrees/card-por-campanha` (branch `feat/card-por-campanha`). **Não** fazer push nem deploy — isso é decisão do Fernando depois do plano executado.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `server/db/migrations/048_loss_reason_campanha_encerrada.sql` (novo) | valor novo no enum `loss_reason` |
| `server/db/migrations/049_deals_campaign.sql` (novo) | `deals.campaign_id`, `campaigns.cards_closed_at`, backfill, índice novo, marcar campanhas já vencidas como varridas |
| `server/services/dealCampaign.ts` (novo) | qual campanha um card novo recebe (`resolveQualificationCampaign`) e a qual campanha a IA atribui um registro (`lastDispatchedCampaign`) |
| `server/services/campaignClosure.ts` (novo) | fechar os cards de uma campanha (`closeCampaignCards`) e varrer as vencidas (`closeEndedCampaigns`) |
| `server/services/campaignClosureWorker.ts` (novo) | timer de 15 min que chama `closeEndedCampaigns` |
| `server/services/dealsService.ts` | criação por balde, campanha do card nas leituras, visibilidade no Kanban/Histórico, cards abertos do lead, dono em todos os abertos, guarda do Reativar |
| `server/services/campaignsService.ts` | `endCampaign`, `openCardsCount`, relatórios por `deals.campaign_id` |
| `server/services/campaignReportService.ts` | Excel por `deals.campaign_id` |
| `server/services/aiAtendimento.ts`, `pipelineIntegration.ts`, `budgetDetection.ts`, `caseSheetService.ts` | consumidores de "o card do lead" |
| `src/features/campaigns/endCampaign.ts` (novo) | regras e textos puros do botão Encerrar |
| `src/features/whatsapp/sidebarDeal.ts` (novo) | escolha do card exibido na barra lateral da Inbox |

---

### Task 1: Base de dados, tipos e motivo "Campanha encerrada"

**Files:**
- Create: `server/db/migrations/048_loss_reason_campanha_encerrada.sql`
- Create: `server/db/migrations/049_deals_campaign.sql`
- Modify: `server/db/schema.ts` (tabela `deals` ~linha 178; tabela `campaigns` ~linha 330)
- Modify: `shared/types.ts:419-425` (`LOSS_REASONS`)
- Modify: `src/features/inside-sales/helpers.ts:37-42`, `src/features/campaigns/helpers.ts:37-42` (rótulos)
- Modify: `src/features/inside-sales/LossReasonDialog.tsx:11,37`
- Modify: `server/controllers/dealsController.ts:109-113` (`stageBody`)
- Modify: `server/services/campaignsService.ts:686-691, 952-957, 1000` (zeros de `lostByReason`)
- Modify: `server/tests/helpers.ts` (`createDeal`, `createCampaign`)
- Test: `server/tests/deals-campaign-schema.test.ts`

**Interfaces:**
- Produces: coluna `deals.campaignId: string | null`; coluna `campaigns.cardsClosedAt: Date | null`; `LossReason` inclui `'campanha_encerrada'`; `MANUAL_LOSS_REASONS` (motivos do fechamento manual); helper de teste `createDeal({ ..., campaignId?: string | null })`; helper `createCampaign({ ..., validityStart?, validityEnd?, cardsClosedAt? })`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/deals-campaign-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { campaigns, deals } from '../db/schema';
import { createApp } from '../app';
import {
  createUser, createLead, createDeal, createCampaign, createCampaignRecipient,
} from './helpers';

const MIGRATION_049 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../db/migrations/049_deals_campaign.sql',
);
const DAY = 86_400_000;

async function campaignOf(dealId: string) {
  const [row] = await db.select({ c: deals.campaignId }).from(deals).where(eq(deals.id, dealId));
  return row.c;
}

describe('migration 049 — campanha no card', () => {
  it('backfill: campanha do último disparo ao lead ANTES da criação do card', async () => {
    const u = await createUser({ email: 'a@x.com' });
    const lead = await createLead({ phone: '5554990000001' });
    const maio = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
    const julho = await createCampaign({ name: 'Disparo Julho', createdByUserId: u.id });
    const setembro = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: maio.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-20T12:00:00Z') });
    await createCampaignRecipient({ campaignId: julho.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-07-10T12:00:00Z') });
    await createCampaignRecipient({ campaignId: setembro.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-09-25T12:42:00Z') });
    const ganhoJulho = await createDeal({
      leadId: lead.id, stage: 'ganho', proposalValue: 100,
      closedAt: new Date('2026-07-20T00:00:00Z'), createdAt: new Date('2026-07-12T00:00:00Z'),
    });
    const abertoMaio = await createDeal({
      leadId: lead.id, stage: 'lead_no_comercial', createdAt: new Date('2026-05-27T00:00:00Z'),
    });
    const semDisparo = await createDeal({
      leadId: (await createLead({ phone: '5554990000002' })).id, stage: 'lead_no_comercial',
    });

    await pool.query(await readFile(MIGRATION_049, 'utf-8'));

    expect(await campaignOf(abertoMaio.id)).toBe(maio.id);
    expect(await campaignOf(ganhoJulho.id)).toBe(julho.id);
    expect(await campaignOf(semDisparo.id)).toBeNull();
  });

  it('não mexe em etapa e marca como varridas só as campanhas já vencidas', async () => {
    const u = await createUser({ email: 'b@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - 3 * DAY),
    });
    const vigente = await createCampaign({
      name: 'Vigente', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const antiga = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });
    const lead = await createLead({ phone: '5554990000003' });
    await createCampaignRecipient({
      campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY),
    });
    const card = await createDeal({
      leadId: lead.id, stage: 'proposta_enviada', createdAt: new Date(Date.now() - 8 * DAY),
    });

    await pool.query(await readFile(MIGRATION_049, 'utf-8'));

    const [c] = await db.select().from(deals).where(eq(deals.id, card.id));
    expect(c.stage).toBe('proposta_enviada');
    expect(c.campaignId).toBe(vencida.id);
    const swept = async (id: string) =>
      (await db.select({ at: campaigns.cardsClosedAt }).from(campaigns).where(eq(campaigns.id, id)))[0].at;
    expect(await swept(vencida.id)).not.toBeNull();
    expect(await swept(vigente.id)).toBeNull();
    expect(await swept(antiga.id)).toBeNull();
  });
});

describe('índice: um card aberto por lead por campanha', () => {
  it('aceita abertos de campanhas diferentes e recusa dois do mesmo balde', async () => {
    const u = await createUser({ email: 'c@x.com' });
    const a = await createCampaign({ name: 'A', createdByUserId: u.id });
    const b = await createCampaign({ name: 'B', createdByUserId: u.id });
    const lead = await createLead({ phone: '5554990000004' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: a.id });
    await createDeal({ leadId: lead.id, stage: 'em_negociacao', campaignId: b.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: null });

    await expect(
      createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: a.id }),
    ).rejects.toThrow();
    await expect(
      createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: null }),
    ).rejects.toThrow();
  });
});

describe('motivo "Campanha encerrada" é só do sistema', () => {
  it('a API recusa mover card pra perdido com campanha_encerrada', async () => {
    const app = createApp();
    await createUser({ email: 'v@x.com', password: 'pw12345', role: 'comercial' });
    const login = await request(app).post('/api/auth/login').send({ email: 'v@x.com', password: 'pw12345' });
    const lead = await createLead({ phone: '5554990000005' });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });

    const res = await request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ stage: 'perdido', lossReason: 'campanha_encerrada', leadQualityFeedback: 'good' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deals-campaign-schema.test.ts`
Expected: FAIL — `ENOENT ... 049_deals_campaign.sql` e erro de tipo/coluna em `campaignId`.

- [ ] **Step 3: Migration 048**

Criar `server/db/migrations/048_loss_reason_campanha_encerrada.sql`:

```sql
-- Migration 048: motivo de perda "campanha_encerrada".
--
-- Card de campanha que encerra (fim da vigência ou botão "Encerrar campanha")
-- vira perdido com este motivo, gravado pelo sistema. Separado de "sem_retorno"
-- de propósito: é o fim da janela comercial, não uma avaliação de vendedor.
--
-- Arquivo próprio porque o runner envolve cada migration numa transação, e um
-- valor novo de enum não pode ser usado na mesma transação em que nasce.

ALTER TYPE loss_reason ADD VALUE IF NOT EXISTS 'campanha_encerrada';
```

- [ ] **Step 4: Migration 049**

Criar `server/db/migrations/049_deals_campaign.sql`:

```sql
-- Migration 049: card por campanha.
--
-- Até aqui o card não guardava campanha e o banco permitia 1 card aberto por
-- lead (036). A IA que qualificava um lead num re-disparo caía no card antigo
-- (caso Samuel/Diana, campanha Teste Andrei III, 25/09/2026). Agora cada card é
-- de uma campanha e o limite é 1 aberto por (lead, campanha); "sem campanha"
-- (orgânico, manual, fora da vigência) é um balde próprio.
--
-- Idempotente: o teste reexecuta este arquivo sobre um banco que já o aplicou.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Varredura de encerramento já rodou pra campanha: cada campanha fecha seus
-- cards uma vez só (card reaberto com "Reativar" depois disso fica aberto).
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS cards_closed_at TIMESTAMPTZ;

-- Backfill: campanha do último disparo ao lead ANTES da criação do card. Num
-- lead re-disparado é a campanha que de fato gerou o card, não a que abriu a
-- conversa (o selo antigo). Sem disparo antes → fica sem campanha.
UPDATE deals d
SET campaign_id = (
  SELECT cr.campaign_id
  FROM campaign_recipients cr
  WHERE cr.lead_id = d.lead_id
    AND cr.sent_at IS NOT NULL
    AND cr.sent_at <= d.created_at
  ORDER BY cr.sent_at DESC
  LIMIT 1
)
WHERE d.campaign_id IS NULL;

-- Dados legados têm no máximo 1 aberto por lead (036), então satisfazem o índice novo.
DROP INDEX IF EXISTS uidx_deals_one_active_per_lead;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_deals_one_active_per_lead_campaign
  ON deals (lead_id, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE stage NOT IN ('ganho', 'perdido');

CREATE INDEX IF NOT EXISTS idx_deals_campaign_id
  ON deals (campaign_id) WHERE campaign_id IS NOT NULL;

-- "Não mexer nos cards atuais" (decisão de 28/09/2026): campanha que já estava
-- vencida no deploy conta como varrida, senão a varredura automática fecharia
-- de uma vez todos os cards antigos. Essas só fecham pelo botão "Encerrar".
UPDATE campaigns
SET cards_closed_at = now()
WHERE validity_end IS NOT NULL
  AND validity_end < now()
  AND cards_closed_at IS NULL;
```

- [ ] **Step 5: Schema do Drizzle**

Em `server/db/schema.ts`, na tabela `deals`, depois de `ownerUserId`:

```ts
  // Campanha do card (migration 049). null = sem campanha: orgânico, manual, ou
  // qualificado fora da vigência.
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
```

e trocar o bloco de índice da tabela `deals`:

```ts
}, (t) => ({
  // No máximo 1 card ABERTO por lead POR CAMPANHA; "sem campanha" é um balde
  // próprio (uuid zero). Terminais acumulam como histórico. Migrations 036 e 049.
  oneActivePerLeadCampaign: uniqueIndex('uidx_deals_one_active_per_lead_campaign')
    .on(t.leadId, sql`COALESCE(${t.campaignId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
    .where(sql`stage NOT IN ('ganho', 'perdido')`),
}));
```

Na tabela `campaigns`, depois de `validityEnd`:

```ts
  // Varredura de encerramento já rodou (migration 049): os cards abertos da
  // campanha foram fechados uma vez. Garante que a rotina não refeche reativados.
  cardsClosedAt: timestamp('cards_closed_at', { withTimezone: true }),
```

- [ ] **Step 6: Tipos compartilhados**

Em `shared/types.ts`, trocar `LOSS_REASONS`:

```ts
export const LOSS_REASONS = [
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil',
  // Só o sistema grava: a campanha do card encerrou com ele aberto (migration 048).
  'campanha_encerrada',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

/** Motivos que um vendedor escolhe ao marcar perdido — sem os do sistema. */
export const MANUAL_LOSS_REASONS = [
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil',
] as const satisfies readonly LossReason[];
```

- [ ] **Step 7: Rótulos e zeros**

Em `src/features/inside-sales/helpers.ts` e `src/features/campaigns/helpers.ts`, acrescentar ao `LOSS_REASON_LABELS`:

```ts
  campanha_encerrada: 'Campanha encerrada',
```

Em `server/services/campaignsService.ts`, criar perto do topo (depois dos imports):

```ts
/** Contagem zerada por motivo de perda — derivada de LOSS_REASONS pra nenhum
 * motivo novo ficar de fora do relatório. */
function emptyLostByReason(): Record<LossReason, number> {
  return Object.fromEntries(LOSS_REASONS.map((r) => [r, 0])) as Record<LossReason, number>;
}
```

e trocar os três literais `{ condicoes_comerciais: 0, preco: 0, sem_retorno: 0, fora_do_perfil: 0 }` (em `getCampaignsAggregateStats`, `getCampaignFunnel` e `emptyFunnel`) por `emptyLostByReason()`.

- [ ] **Step 8: Fechamento manual não oferece nem aceita o motivo do sistema**

Em `src/features/inside-sales/LossReasonDialog.tsx`: trocar o import `import { LOSS_REASONS } from '@shared/types';` por `import { MANUAL_LOSS_REASONS } from '@shared/types';` e `LOSS_REASONS.map((r) => (` por `MANUAL_LOSS_REASONS.map((r) => (`.

Em `server/controllers/dealsController.ts`: acrescentar `MANUAL_LOSS_REASONS` ao import de `'../../shared/types'` e no `stageBody` trocar `lossReason: z.enum(LOSS_REASONS).optional(),` por:

```ts
  // campanha_encerrada é gravado só pelo sistema (campaignClosure.ts).
  lossReason: z.enum(MANUAL_LOSS_REASONS).optional(),
```

- [ ] **Step 9: Helpers de teste**

Em `server/tests/helpers.ts`, no `createDeal`: acrescentar `campaignId?: string | null;` às opções e `campaignId: opts.campaignId ?? null,` aos `values`.

No `createCampaign`: acrescentar às opções

```ts
  validityStart?: Date | null;
  validityEnd?: Date | null;
  cardsClosedAt?: Date | null;
```

e aos `values`:

```ts
    validityStart: opts.validityStart ?? null,
    validityEnd: opts.validityEnd ?? null,
    cardsClosedAt: opts.cardsClosedAt ?? null,
```

- [ ] **Step 10: Rodar o teste e os vizinhos**

Run: `npx vitest run server/tests/deals-campaign-schema.test.ts server/tests/deals-repeat-cycle.test.ts server/tests/deals-actions.test.ts server/tests/campaigns-funnel.test.ts`
Expected: PASS (os de recompra continuam passando: tudo que eles criam fica no balde "sem campanha").

Run: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add server/db/migrations/048_loss_reason_campanha_encerrada.sql server/db/migrations/049_deals_campaign.sql server/db/schema.ts shared/types.ts src/features/inside-sales/helpers.ts src/features/campaigns/helpers.ts src/features/inside-sales/LossReasonDialog.tsx server/controllers/dealsController.ts server/services/campaignsService.ts server/tests/helpers.ts server/tests/deals-campaign-schema.test.ts
git commit -m "feat(inside-sales): card guarda a campanha e um aberto por lead por campanha" -m "Migrations 048 (motivo campanha_encerrada) e 049 (deals.campaign_id, backfill pelo último disparo antes do card, índice por lead+campanha, campanhas já vencidas marcadas como varridas)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Campanha da qualificação

**Files:**
- Create: `server/services/dealCampaign.ts`
- Test: `server/tests/deal-campaign-resolve.test.ts`

**Interfaces:**
- Consumes: `createCampaign` com vigência e `createCampaignRecipient` (Task 1).
- Produces:
  - `resolveQualificationCampaign(leadId: string, now?: Date): Promise<string | null>` — campanha do card novo.
  - `lastDispatchedCampaign(leadId: string, fallbackCampaignId: string | null): Promise<string | null>` — campanha dos registros da IA.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/deal-campaign-resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveQualificationCampaign, lastDispatchedCampaign } from '../services/dealCampaign';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

const DAY = 86_400_000;
let seq = 0;

async function scenario() {
  seq += 1;
  const u = await createUser({ email: `r${seq}@x.com` });
  const lead = await createLead({ phone: `55549700${String(seq).padStart(5, '0')}` });
  return { u, lead };
}

describe('resolveQualificationCampaign', () => {
  it('devolve a campanha do último disparo quando ela está vigente', async () => {
    const { u, lead } = await scenario();
    const antiga = await createCampaign({ name: 'Antiga', createdByUserId: u.id });
    const nova = await createCampaign({
      name: 'Nova', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 60 * DAY) });
    await createCampaignRecipient({ campaignId: nova.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBe(nova.id);
  });

  it('último disparo com vigência vencida → sem campanha', async () => {
    const { u, lead } = await scenario();
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });

  it('campanha comum sem vigência (anterior a 31/08) não conta', async () => {
    const { u, lead } = await scenario();
    const antiga = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });

  it('campanha contínua é sempre vigente', async () => {
    const { u, lead } = await scenario();
    const continua = await createCampaign({ name: 'Contínua', createdByUserId: u.id, isContinuous: true });
    await createCampaignRecipient({ campaignId: continua.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 40 * DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBe(continua.id);
  });

  it('o instante exato do fim da vigência ainda vale', async () => {
    const { u, lead } = await scenario();
    const fim = new Date(Date.now() + DAY);
    const c = await createCampaign({
      name: 'Até o fim', createdByUserId: u.id, validityStart: new Date(Date.now() - DAY), validityEnd: fim,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id, fim)).toBe(c.id);
  });

  it('ignora disparo ainda não enviado e lead sem disparo', async () => {
    const { u, lead } = await scenario();
    const c = await createCampaign({
      name: 'Pendente', createdByUserId: u.id,
      validityStart: new Date(), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });
});

describe('lastDispatchedCampaign', () => {
  it('último disparo, mesmo com a vigência vencida', async () => {
    const { u, lead } = await scenario();
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY) });

    expect(await lastDispatchedCampaign(lead.id, null)).toBe(vencida.id);
  });

  it('sem disparo, devolve a campanha de origem da conversa', async () => {
    const { u, lead } = await scenario();
    const origem = await createCampaign({ name: 'Origem', createdByUserId: u.id });

    expect(await lastDispatchedCampaign(lead.id, origem.id)).toBe(origem.id);
    expect(await lastDispatchedCampaign(lead.id, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deal-campaign-resolve.test.ts`
Expected: FAIL — `Cannot find module '../services/dealCampaign'`.

- [ ] **Step 3: Implementar**

Criar `server/services/dealCampaign.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Campanha a que um card NOVO pertence: a do último disparo recebido pelo lead,
 * se ainda estiver vigente.
 *
 * - Comum: vigente enquanto `validity_end >= now` — o instante do fim ainda vale,
 *   mesma regra do selo de vigência (src/features/campaigns/validity.ts).
 * - Contínua: sempre vigente. Dispara sem parar e não tem vigência.
 * - Comum sem vigência (anterior a 31/08/2026): não conta. Um disparo de meses
 *   atrás não é "a campanha" de uma qualificação de hoje.
 *
 * null = card sem campanha. Card nascer na campanha já encerrada seria card que
 * nasce perdido.
 */
export async function resolveQualificationCampaign(
  leadId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const r = await db.execute<{
    campaign_id: string;
    is_continuous: boolean;
    validity_end: Date | string | null;
  }>(sql`
    SELECT cr.campaign_id::text AS campaign_id, c.is_continuous, c.validity_end
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE cr.lead_id = ${leadId}
      AND cr.sent_at IS NOT NULL
      AND cr.sent_at <= ${now}
    ORDER BY cr.sent_at DESC
    LIMIT 1
  `);
  const last = r.rows[0];
  if (!last) return null;
  if (last.is_continuous) return last.campaign_id;
  if (last.validity_end && new Date(last.validity_end).getTime() >= now.getTime()) {
    return last.campaign_id;
  }
  return null;
}

/**
 * Campanha a que a IA atribui um registro (ai_call_logs.campaign_id — calibração,
 * fila cega, "Não qualificados"): o último disparo recebido pelo lead, SEM olhar
 * vigência. Resposta tardia ainda é da campanha que a provocou. Sem disparo, cai
 * na campanha que abriu a conversa — o comportamento anterior a 28/09/2026.
 */
export async function lastDispatchedCampaign(
  leadId: string,
  fallbackCampaignId: string | null,
): Promise<string | null> {
  const r = await db.execute<{ campaign_id: string }>(sql`
    SELECT cr.campaign_id::text AS campaign_id
    FROM campaign_recipients cr
    WHERE cr.lead_id = ${leadId}
      AND cr.sent_at IS NOT NULL
      AND cr.sent_at <= now()
    ORDER BY cr.sent_at DESC
    LIMIT 1
  `);
  return r.rows[0]?.campaign_id ?? fallbackCampaignId;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/tests/deal-campaign-resolve.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add server/services/dealCampaign.ts server/tests/deal-campaign-resolve.test.ts
git commit -m "feat(inside-sales): regra de qual campanha um card novo recebe" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Criação do card por campanha (IA, imagem, manual)

**Files:**
- Modify: `server/services/dealsService.ts` (`createDeal`, ~linhas 474-553)
- Modify: `server/services/aiAtendimento.ts:502-508` (`campaignIdForLog`)
- Modify: `server/services/pipelineIntegration.ts`
- Test: `server/tests/deals-per-campaign.test.ts` (novo), `server/tests/ai-atendimento.test.ts`, `server/tests/pipeline-integration.test.ts`

**Interfaces:**
- Consumes: `resolveQualificationCampaign`, `lastDispatchedCampaign` (Task 2); `deals.campaignId` (Task 1).
- Produces: `createDeal(input: { leadId; proposalValue?; ownerUserId: string | null; source: 'manual' | 'auto_image' | 'ai_qualified' })` — assinatura igual; comportamento por balde (tabela 4 do spec). Atividade `created` passa a levar `metadata.campaignId`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `server/tests/deals-per-campaign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { createDeal } from '../services/dealsService';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createDeal as seedDeal,
} from './helpers';

const DAY = 86_400_000;
let seq = 0;

/** Lead com card de maio aberto (Campanha Teste) que recebeu um re-disparo vigente. */
async function samuel() {
  seq += 1;
  const u = await createUser({ email: `m${seq}@x.com` });
  const lead = await createLead({ phone: `55549600${String(seq).padStart(5, '0')}`, name: 'Samuel' });
  const antiga = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
  const nova = await createCampaign({
    name: 'Teste Andrei III', createdByUserId: u.id,
    validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
  });
  await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 120 * DAY) });
  await createCampaignRecipient({ campaignId: nova.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });
  const velho = await seedDeal({
    leadId: lead.id, stage: 'lead_no_comercial', campaignId: antiga.id,
    createdAt: new Date(Date.now() - 119 * DAY),
  });
  return { u, lead, antiga, nova, velho };
}

async function cardsOf(leadId: string) {
  return db.select().from(deals).where(eq(deals.leadId, leadId));
}

describe('createDeal — IA abre um card por campanha', () => {
  it('lead com card aberto de outra campanha ganha um SEGUNDO card, da campanha vigente', async () => {
    const { lead, nova, velho } = await samuel();

    const novo = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    expect(novo.id).not.toBe(velho.id);
    expect(novo.stage).toBe('lead_no_comercial');
    const cards = await cardsOf(lead.id);
    expect(cards).toHaveLength(2);
    expect(cards.find((d) => d.id === novo.id)!.campaignId).toBe(nova.id);
    expect(cards.find((d) => d.id === velho.id)!.stage).toBe('lead_no_comercial');
  });

  it('qualificar de novo na mesma campanha devolve o mesmo card', async () => {
    const { lead } = await samuel();
    const d1 = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });
    const d2 = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });
    expect(d2.id).toBe(d1.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('card da mesma campanha já fechado não é recriado', async () => {
    const { lead, nova } = await samuel();
    const perdido = await seedDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: nova.id,
    });

    const r = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    expect(r.id).toBe(perdido.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('qualificação fora da vigência abre card sem campanha', async () => {
    seq += 1;
    const u = await createUser({ email: `f${seq}@x.com` });
    const lead = await createLead({ phone: `55549610${String(seq).padStart(5, '0')}` });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 20 * DAY), validityEnd: new Date(Date.now() - 10 * DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 19 * DAY) });

    const d = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row.campaignId).toBeNull();
  });

  it('duas qualificações simultâneas na mesma campanha terminam num card só', async () => {
    const { lead, nova } = await samuel();

    const [a, b] = await Promise.all([
      createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' }),
      createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' }),
    ]);

    expect(a.id).toBe(b.id);
    const daNova = (await cardsOf(lead.id)).filter((d) => d.campaignId === nova.id);
    expect(daNova).toHaveLength(1);
  });
});

describe('createDeal — manual não abre segundo card', () => {
  it('lead com cards abertos: devolve o mais recente', async () => {
    const { u, lead } = await samuel();
    const novo = await createDeal({ leadId: lead.id, ownerUserId: null, source: 'ai_qualified' });

    const manual = await createDeal({ leadId: lead.id, ownerUserId: u.id, source: 'manual' });

    expect(manual.id).toBe(novo.id);
    expect(await cardsOf(lead.id)).toHaveLength(2);
  });

  it('todos fechados: recompra cria card sem campanha em em_negociacao', async () => {
    const { u, lead, velho } = await samuel();
    await db.update(deals).set({ stage: 'ganho', proposalValue: '800', closedAt: new Date() }).where(eq(deals.id, velho.id));

    const recompra = await createDeal({ leadId: lead.id, ownerUserId: u.id, source: 'manual' });

    expect(recompra.stage).toBe('em_negociacao');
    const [row] = await db.select().from(deals).where(eq(deals.id, recompra.id));
    expect(row.campaignId).toBeNull();
  });
});
```

Em `server/tests/ai-atendimento.test.ts`, acrescentar `aiCallLogs` ao import de `'../db/schema'` e `createCampaign, createCampaignRecipient` ao import de `'./helpers'`; depois do teste `'qualificação em conversa que já tem dono: o card nasce com o dono da conversa'`, acrescentar:

```ts
  it('re-disparo vigente: lead com card antigo aberto ganha um SEGUNDO card, da campanha nova', async () => {
    await enableAi();
    mockGeminiText('Perfeito, vou conectar você com nosso comercial agora. [QUALIFICADO]');
    mockSendOk('uazapi-ai-redisparo');

    const u = await createUser({ email: 'mkt@x.com', role: 'admin' });
    const antiga = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id, status: 'completed' });
    const nova = await createCampaign({
      name: 'Teste Andrei III', createdByUserId: u.id, status: 'completed',
      validityStart: new Date(Date.now() - 60_000), validityEnd: new Date(Date.now() + 7 * 86_400_000),
    });
    const lead = await createLead({ phone: '5554991921858', flowStage: 'engaged' });
    const conv = await createConversation({
      phone: '5554991921858', leadId: lead.id, queue: 'ia',
      originKind: 'campaign', originCampaignId: antiga.id,
    });
    await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-20T12:00:00Z') });
    await createCampaignRecipient({ campaignId: nova.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 60_000) });
    const [velho] = await db.insert(deals)
      .values({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: antiga.id })
      .returning();

    const r = await processInboundWithAi({
      conversationId: conv.id,
      leadId: lead.id,
      phone: '5554991921858',
      inboundText: 'quero fazer um pedido',
    });
    expect(r.status).toBe('qualified_and_replied');

    const cards = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(cards).toHaveLength(2);
    const novo = cards.find((d) => d.id !== velho.id)!;
    expect(novo.campaignId).toBe(nova.id);
    expect(novo.stage).toBe('lead_no_comercial');
    // A qualificação conta pra campanha do re-disparo, não pra que abriu a conversa.
    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.conversationId, conv.id));
    expect(log.campaignId).toBe(nova.id);
  });
```

Em `server/tests/pipeline-integration.test.ts`, acrescentar `createCampaign` ao import de `'./helpers'` e, antes de `it('no-op se já existe deal ativo'`:

```ts
  it('lead com card aberto de outra campanha: imagem não cria nem reativa nada', async () => {
    const u = await createUser({ email: 'p6@x.com', role: 'comercial' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    const lead = await createLead({ phone: '11000100050' });
    const conv = await createConversation({ phone: '11000100050', leadId: lead.id, queue: 'comercial' });
    await createDeal({ leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date() });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: camp.id });

    await maybeAddDealFromConversation({ conversationId: conv.id, messageKind: 'image', userId: u.id });

    const all = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(all.map((d) => d.stage).sort()).toEqual(['lead_no_comercial', 'perdido']);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deals-per-campaign.test.ts server/tests/ai-atendimento.test.ts server/tests/pipeline-integration.test.ts`
Expected: FAIL — `createDeal` devolve o card antigo (1 card só), `log.campaignId` é a campanha de origem, e a imagem tenta reativar o perdido.

- [ ] **Step 3: `createDeal` por balde**

Em `server/services/dealsService.ts`: acrescentar o import `import { resolveQualificationCampaign } from './dealCampaign';` e substituir a função `createDeal` inteira por:

```ts
export async function createDeal(input: {
  leadId: string;
  proposalValue?: number | null;
  ownerUserId: string | null;       // aceita null (Pull model)
  source: 'manual' | 'auto_image' | 'ai_qualified';
}): Promise<PublicDeal> {
  const openStage = sql`${deals.stage} NOT IN ('ganho', 'perdido')`;

  // Manual (vendedor): lead com card aberto → devolve o mais recente. Na mão
  // nunca nasce um segundo card; card manual é sempre sem campanha.
  if (input.source === 'manual') {
    const [open] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.leadId, input.leadId), openStage))
      .orderBy(desc(deals.createdAt))
      .limit(1);
    if (open) return getDealById(open.id);
  }

  // Automático (IA, imagem): o card é da campanha do último disparo vigente.
  // Um card aberto por (lead, campanha); "sem campanha" é um balde próprio.
  const campaignId = input.source === 'manual'
    ? null
    : await resolveQualificationCampaign(input.leadId);
  const sameBucket = and(
    eq(deals.leadId, input.leadId),
    campaignId === null ? isNull(deals.campaignId) : eq(deals.campaignId, campaignId),
  );

  const [active] = await db.select({ id: deals.id }).from(deals).where(and(sameBucket, openStage)).limit(1);
  if (active) return getDealById(active.id);

  let initialStage: DealStage = 'lead_no_comercial';
  if (input.source === 'manual') {
    // Recompra: lead que já teve card (todos fechados) é cliente conhecido e
    // entra direto em negociação.
    const [anyDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
    if (anyDeal) initialStage = 'em_negociacao';
  } else {
    // IA/imagem não reabrem ciclo no MESMO balde: card fechado desta campanha
    // (ou sem campanha) volta como está — evita card fantasma. Balde diferente
    // (campanha nova) abre card novo: é o card por campanha.
    const [closed] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(sameBucket)
      .orderBy(desc(deals.createdAt))
      .limit(1);
    if (closed) return getDealById(closed.id);
  }

  // Captura stage anterior do lead pra audit trail.
  const [leadBefore] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);

  let dealId: string;
  try {
    dealId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(deals)
        .values({
          leadId: input.leadId,
          stage: initialStage,
          proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
          ownerUserId: input.ownerUserId,       // pode ser null agora
          campaignId,
        })
        .returning({ id: deals.id });
      await logActivity(tx, {
        dealId: created.id,
        kind: 'created',
        // Sem actor humano quando source e automatizada (ai_qualified, auto_image)
        actorUserId: input.source === 'manual' ? input.ownerUserId : null,
        metadata: { source: input.source, campaignId },
      });
      // Promove lead pra handed_off quando deal é criado (não regride 'lost').
      await tx
        .update(leads)
        .set({ flowStage: 'handed_off', updatedAt: new Date() })
        .where(and(eq(leads.id, input.leadId), sql`${leads.flowStage} <> 'lost'`));
      return created.id;
    });
  } catch (err) {
    // Duas qualificações simultâneas do mesmo lead na mesma campanha: o índice
    // único barra a segunda — devolve o card que a primeira criou.
    const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
    if (pgErr?.code !== '23505') throw err;
    const [winner] = await db.select({ id: deals.id }).from(deals).where(and(sameBucket, openStage)).limit(1);
    if (!winner) throw err;
    return getDealById(winner.id);
  }

  // Audit trail fora do tx.
  if (leadBefore && leadBefore.flowStage !== 'handed_off' && leadBefore.flowStage !== 'lost') {
    const { recordTransition } = await import('./stageTransitions');
    await recordTransition({
      leadId: input.leadId,
      fromStage: leadBefore.flowStage as PublicLead['flowStage'],
      toStage: 'handed_off',
      source: 'deal_created',
      metadata: { dealId, source: input.source, ownerUserId: input.ownerUserId },
    });
  }

  return getDealById(dealId);
}
```

(`isNull` já está no import de `drizzle-orm` desde a correção do dono; `DealStage` já é importado de `@shared/types`.)

- [ ] **Step 4: Registros da IA na campanha do disparo**

Em `server/services/aiAtendimento.ts`, acrescentar o import `import { lastDispatchedCampaign } from './dealCampaign';` e trocar:

```ts
  const campaignIdForLog = convFull?.originCampaignId ?? null;
```

por:

```ts
  // Registros da IA vão pra campanha do último disparo ao lead: num re-disparo
  // a qualificação é da campanha nova, não da que abriu a conversa. Sem
  // disparo, a de origem, como antes. Ver dealCampaign.ts.
  const campaignIdForLog = await lastDispatchedCampaign(input.leadId, convFull?.originCampaignId ?? null);
```

- [ ] **Step 5: Imagem no Comercial com vários cards**

Em `server/services/pipelineIntegration.ts`, trocar os imports por:

```ts
import { db } from '../db/client';
import { conversations, deals } from '../db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { MessageKind } from '@shared/types';
import { createDeal, reactivateDeal } from './dealsService';
```

e o trecho a partir de `const [existing] = ...` até o fim da função por:

```ts
  // Lead com qualquer card aberto (de qualquer campanha) → nada a fazer.
  const [open] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.leadId, conv.leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
    .limit(1);
  if (open) return;

  const [latest] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.leadId, conv.leadId))
    .orderBy(desc(deals.createdAt))
    .limit(1);

  if (!latest) {
    await createDeal({
      leadId: conv.leadId,
      // O card segue o dono da conversa, não quem mandou a imagem.
      ownerUserId: conv.assignedTo ?? opts.userId,
      source: 'auto_image',
    });
  } else {
    await reactivateDeal({ dealId: latest.id, actorUserId: opts.userId });
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run server/tests/deals-per-campaign.test.ts server/tests/ai-atendimento.test.ts server/tests/pipeline-integration.test.ts server/tests/deals-repeat-cycle.test.ts server/tests/deals-ai-qualified.test.ts server/tests/budget-detections-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/services/dealsService.ts server/services/aiAtendimento.ts server/services/pipelineIntegration.ts server/tests/deals-per-campaign.test.ts server/tests/ai-atendimento.test.ts server/tests/pipeline-integration.test.ts
git commit -m "feat(inside-sales): IA abre um card por campanha em que qualifica o lead" -m "Caso Samuel/Diana (Teste Andrei III, 25/09): a qualificação caía no card de maio. Agora o card é da campanha do último disparo vigente e convive com os de outras campanhas; manual continua devolvendo o card aberto. Registros da IA vão pra campanha do último disparo." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Campanha do card no Kanban e no Histórico

**Files:**
- Modify: `server/services/dealsService.ts` (`RawDealRow`, `toPublic`, `originCampaignSql`, `listBoard`, `campaignAssociationFilter`, `listHistory`, `getDealById`, `getDealByLeadId`)
- Modify: `shared/types.ts` (`PublicDeal`, `BoardResponse`)
- Modify: `src/features/inside-sales/DealCard.tsx:78-89`, `src/features/inside-sales/KanbanBoard.tsx:88-95, 216-245`
- Test: `server/tests/deals-list-campaigns.test.ts` (reescrito)

**Interfaces:**
- Consumes: `deals.campaignId`, motivo `campanha_encerrada` (Task 1).
- Produces: `PublicDeal.campaignId: string | null`, `PublicDeal.campaignName: string | null` (substituem `originCampaignId/Name`); `BoardResponse.cardCampaigns` (substitui `originCampaigns`); constante `cardCampaignSql` em `dealsService.ts`, usada pela Task 5.

- [ ] **Step 1: Reescrever o teste**

Substituir o conteúdo de `server/tests/deals-list-campaigns.test.ts` por:

```ts
import { describe, it, expect } from 'vitest';
import { listBoard, listHistory } from '../services/dealsService';
import {
  createUser,
  createLead,
  createCampaign,
  createCampaignRecipient,
  createDeal,
} from './helpers';

async function admin() {
  return createUser({
    email: `a${Math.random().toString(36).slice(2, 8)}@x.com`,
    password: 'pw12345',
    role: 'admin',
  });
}

const userCtx = {
  ownerFilter: 'all' as const,
  currentUserId: '00000000-0000-0000-0000-000000000000',
};

describe('listBoard — campanhas do lead (recipients) e campanha do card', () => {
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
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Multi');
    expect(deal!.campaigns.map((c) => c.name)).toEqual(['Recente', 'Antiga']);
  });

  it('expõe campaignId/Name da campanha DO CARD', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Samuel', phone: '5554900111222' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: camp.id });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Samuel');
    expect(deal!.campaignId).toBe(camp.id);
    expect(deal!.campaignName).toBe('Teste Andrei III');
  });

  it('card sem campanha vem com campaignId/Name nulos', async () => {
    const lead = await createLead({ name: 'Sem campanha', phone: '5554900333444' });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial' });
    const r = await listBoard(userCtx);
    const deal = r.stages.lead_no_comercial.find((d) => d.lead.name === 'Sem campanha');
    expect(deal!.campaignId).toBeNull();
    expect(deal!.campaignName).toBeNull();
  });

  it('dois cards abertos do mesmo lead aparecem os dois, cada um com sua campanha', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Dois cards', phone: '5554900444555' });
    const a = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id });
    const b = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'proposta_enviada', campaignId: a.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: b.id });
    const r = await listBoard(userCtx);
    expect(r.stages.proposta_enviada.map((d) => d.campaignName)).toEqual(['Campanha Teste']);
    expect(r.stages.lead_no_comercial.map((d) => d.campaignName)).toEqual(['Teste Andrei III']);
  });
});

describe('listBoard — filtro por campanha do card', () => {
  it('filtra pela campanha do card', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'In A', phone: '5554933333333' });
    const leadB = await createLead({ name: 'In B', phone: '5554944444444' });
    const leadN = await createLead({ name: 'In none', phone: '5554955555555' });
    const campA = await createCampaign({ name: 'A', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'B', createdByUserId: u.id });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial', campaignId: campA.id });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial', campaignId: campB.id });
    await createDeal({ leadId: leadN.id, stage: 'lead_no_comercial' });

    const r = await listBoard({ ...userCtx, campaignIds: [campA.id, campB.id] });
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name).sort()).toEqual(['In A', 'In B']);
  });

  it('cardCampaigns lista só campanhas com card e ignora o próprio filtro', async () => {
    const u = await admin();
    const leadA = await createLead({ name: 'LA', phone: '5554900555666' });
    const leadB = await createLead({ name: 'LB', phone: '5554900777888' });
    const campA = await createCampaign({ name: 'AAA', createdByUserId: u.id });
    const campB = await createCampaign({ name: 'BBB', createdByUserId: u.id });
    await createCampaign({ name: 'CCC sem card', createdByUserId: u.id });
    await createDeal({ leadId: leadA.id, stage: 'lead_no_comercial', campaignId: campA.id });
    await createDeal({ leadId: leadB.id, stage: 'lead_no_comercial', campaignId: campB.id });

    const r = await listBoard({ ...userCtx, campaignIds: [campA.id] });
    expect(r.cardCampaigns.map((c) => c.name).sort()).toEqual(['AAA', 'BBB']);
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['LA']);
  });
});

describe('listBoard — grupo "Recebeu disparo"', () => {
  it('recipientCampaigns lista campanhas que dispararam pro lead mas não são a do card', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Rehit', phone: '5554900999000' });
    const doCard = await createCampaign({ name: 'Lista 1', createdByUserId: u.id });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: doCard.id });
    await createCampaignRecipient({ campaignId: doCard.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-01-01') });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: lead.id, status: 'sent', sentAt: new Date('2026-05-01') });

    const r = await listBoard(userCtx);
    expect(r.cardCampaigns.map((c) => c.name)).toEqual(['Lista 1']);
    expect(r.recipientCampaigns.map((c) => c.name)).toEqual(['Disparo 4']);
  });

  it('filtra o board por campanha que só aparece como disparo', async () => {
    const u = await admin();
    const leadHit = await createLead({ name: 'Recebeu D4', phone: '5554900111000' });
    const leadOther = await createLead({ name: 'Nao recebeu', phone: '5554900222000' });
    await createDeal({ leadId: leadHit.id, stage: 'lead_no_comercial' });
    await createDeal({ leadId: leadOther.id, stage: 'lead_no_comercial' });
    const disparo4 = await createCampaign({ name: 'Disparo 4', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: disparo4.id, leadId: leadHit.id, status: 'sent', sentAt: new Date() });

    const r = await listBoard({ ...userCtx, campaignIds: [disparo4.id] });
    expect(r.stages.lead_no_comercial.map((d) => d.lead.name)).toEqual(['Recebeu D4']);
  });
});

describe('card fechado por campanha encerrada', () => {
  it('não aparece na coluna Perdido e vai direto pro Histórico', async () => {
    const encerrado = await createLead({ name: 'Encerrado', phone: '5554900000101' });
    const manual = await createLead({ name: 'Perdido manual', phone: '5554900000102' });
    await createDeal({ leadId: encerrado.id, stage: 'perdido', lossReason: 'campanha_encerrada', closedAt: new Date() });
    await createDeal({ leadId: manual.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date() });

    const board = await listBoard(userCtx);
    expect(board.stages.perdido.map((d) => d.lead.name)).toEqual(['Perdido manual']);

    const hist = await listHistory(userCtx);
    expect(hist.items.map((d) => d.lead.name)).toEqual(['Encerrado']);
  });
});

describe('listHistory — campanha do card', () => {
  it('traz a campanha do card e filtra por ela', async () => {
    const u = await admin();
    const lead = await createLead({ name: 'Won', phone: '5554900000001' });
    const camp = await createCampaign({ name: 'A', createdByUserId: u.id });
    // closedAt mais antigo que KANBAN_TERMINAL_VISIBLE_DAYS (7 dias) pra aparecer no historico.
    const oldClosed = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await createDeal({ leadId: lead.id, stage: 'ganho', closedAt: oldClosed, campaignId: camp.id });
    await createCampaignRecipient({ campaignId: camp.id, leadId: lead.id, status: 'sent', sentAt: new Date() });

    const r = await listHistory({ ...userCtx, campaignIds: [camp.id] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].campaigns.map((c) => c.name)).toEqual(['A']);
    expect(r.items[0].campaignName).toBe('A');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deals-list-campaigns.test.ts`
Expected: FAIL — `campaignName`/`cardCampaigns` indefinidos, e o card encerrado aparece na coluna Perdido.

- [ ] **Step 3: Tipos**

Em `shared/types.ts`, no `PublicDeal`, trocar o bloco de `originCampaignId`/`originCampaignName` (e o comentário acima) por:

```ts
  // Campanha DO CARD (deals.campaign_id). null = card sem campanha: orgânico,
  // manual, ou qualificado fora da vigência.
  campaignId: string | null;
  campaignName: string | null;
```

No `BoardResponse`, trocar `originCampaigns` (e seu comentário) por:

```ts
  // Campanhas dos cards no escopo atual (owner+busca, ignorando o próprio
  // filtro de campanha) — grupo "Campanha do card" do multi-select do Kanban.
  cardCampaigns: Array<{ id: string; name: string }>;
```

e ajustar o comentário de `recipientCampaigns` para "…mas NÃO são a campanha de nenhum card do escopo".

- [ ] **Step 4: Serviço**

Em `server/services/dealsService.ts`:

1. Em `RawDealRow`, trocar `originCampaign: { id: string; name: string } | null;` por `cardCampaign: { id: string; name: string } | null;`.
2. Em `toPublic`, trocar as linhas de `originCampaignId`/`originCampaignName` por:

```ts
    campaignId: row.cardCampaign?.id ?? null,
    campaignName: row.cardCampaign?.name ?? null,
```

3. Substituir a constante `originCampaignSql` (e seu comentário) por:

```ts
// Campanha DO CARD (deals.campaign_id, migration 049). sql.raw pelo mesmo
// motivo do campaignsSql: o Drizzle renderizaria a coluna sem qualificar.
const cardCampaignSql = sql<{ id: string; name: string } | null>`(
  SELECT json_build_object('id', ca.id, 'name', ca.name)
  FROM campaigns ca
  WHERE ca.id = ${sql.raw('deals.campaign_id')}
)`;
```

4. Nos quatro `select` (`listBoard`, `listHistory`, `getDealById`, `getDealByLeadId`), trocar `originCampaign: originCampaignSql,` por `cardCampaign: cardCampaignSql,`.
5. Em `listBoard`, trocar a condição de visibilidade por:

```ts
  // Show: active stages OR (terminal AND closed_at within last 7 days). Perdido
  // por campanha encerrada vai direto pro Histórico: encerrar uma campanha grande
  // não pode inundar a coluna Perdido.
  conds.push(
    sql`(
      ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
        AND ${deals.lossReason} IS DISTINCT FROM 'campanha_encerrada'
      )
    )`,
  );
```

6. Em `listBoard`, substituir a consulta `originCampaigns` (e o comentário) por:

```ts
  // Opções "Campanha do card": campanhas dos cards do escopo atual
  // (owner/busca/stage), SEM aplicar o filtro de campanha.
  const cardCampaigns = await db
    .selectDistinct({ id: campaigns.id, name: campaigns.name })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .innerJoin(campaigns, eq(campaigns.id, deals.campaignId))
    .where(and(...conds))
    .orderBy(campaigns.name);
```

e trocar a exclusão e o retorno:

```ts
  // Exclui as que já são campanha de algum card (o filtro casa card OU disparo,
  // então basta oferecê-las uma vez, no grupo "Campanha do card").
  const cardIds = new Set(cardCampaigns.map((c) => c.id));
  const recipientCampaigns = recipientCampaignsRaw.filter((c) => !cardIds.has(c.id));
```

```ts
  return { stages, totals, cardCampaigns, recipientCampaigns };
```

Atualizar o comentário da consulta `recipientCampaignsRaw` para dizer "mas que não são a campanha do card".

7. Substituir `campaignAssociationFilter` (e o comentário) por:

```ts
// Filtro por campanha: casa o card DA campanha (deals.campaign_id, o selo do
// card) OU cujo lead recebeu disparo dela (campaign_recipients com sent_at).
// Cobre os grupos "Campanha do card" e "Recebeu disparo". Retorna null quando
// não há filtro. Usado por listBoard e listHistory.
function campaignAssociationFilter(campaignIds: string[] | undefined): SQL | null {
  if (!campaignIds || campaignIds.length === 0) return null;
  const ids = sql.join(campaignIds.map((id) => sql`${id}`), sql`, `);
  return sql`(
    ${deals.campaignId} IN (${ids})
    OR EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.lead_id = ${deals.leadId}
        AND cr.sent_at IS NOT NULL
        AND cr.campaign_id IN (${ids})
    )
  )`;
}
```

8. Em `listHistory`, trocar a primeira condição por:

```ts
  // Terminais fora da janela do Kanban — e os fechados por campanha encerrada,
  // que nunca passam pelo Kanban.
  conds.push(
    sql`${deals.stage} IN ('ganho', 'perdido') AND (
      ${deals.closedAt} <= now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      OR ${deals.lossReason} = 'campanha_encerrada'
    )`,
  );
```

- [ ] **Step 5: Front**

Em `src/features/inside-sales/DealCard.tsx`, trocar o bloco da campanha por:

```tsx
      {/* Campanha do card (deals.campaign_id). */}
      {deal.campaignName && (
        <div className="mb-2">
          <span
            className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-full"
            title={`Campanha: ${deal.campaignName}`}
          >
            <Megaphone className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{deal.campaignName}</span>
          </span>
        </div>
      )}
```

Em `src/features/inside-sales/KanbanBoard.tsx`, trocar:

```tsx
  // Opções de campanha (vêm do board, já calculadas ignorando o filtro de
  // campanha pra a lista não encolher):
  //  - origem: campanha que abriu a conversa do card (badge do card);
  //  - "recebeu disparo": campanhas que dispararam pro lead do card mas não são
  //    a de origem (ex.: re-disparo de uma lista nova sobre base já contatada).
  const campaignOptions = data?.originCampaigns ?? [];
```

por:

```tsx
  // Opções de campanha (vêm do board, já calculadas ignorando o filtro de
  // campanha pra a lista não encolher):
  //  - "campanha do card": a campanha gravada no card (selo do card);
  //  - "recebeu disparo": campanhas que dispararam pro lead mas não são a de
  //    nenhum card (ex.: re-disparo em que o lead não foi qualificado).
  const campaignOptions = data?.cardCampaigns ?? [];
```

e, no menu, o rótulo `Campanha de origem` por `Campanha do card`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run server/tests/deals-list-campaigns.test.ts server/tests/deals-list.test.ts server/tests/deals-history.test.ts server/tests/deals-by-lead.test.ts`
Expected: PASS. (`case-sheet.test.ts` e `conversations-list.test.ts` também citam `originCampaign*`, mas da **conversa**, que não muda.)

Run: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts server/services/dealsService.ts src/features/inside-sales/DealCard.tsx src/features/inside-sales/KanbanBoard.tsx server/tests/deals-list-campaigns.test.ts
git commit -m "feat(inside-sales): selo e filtro mostram a campanha do card" -m "O selo vinha da campanha que abriu a conversa e nunca mudava num re-disparo. Card fechado por campanha encerrada vai direto pro Histórico." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leituras com mais de um card aberto por lead

**Files:**
- Modify: `server/services/dealsService.ts` (`getDealByLeadId`, novo `listOpenDealsByLead`, `syncDealOwnerWithConversation`, guarda de reativação em `changeStage`)
- Modify: `server/controllers/dealsController.ts`, `server/routes/deals.ts`
- Modify: `server/services/budgetDetection.ts` (`applyToPipeline`), `server/services/caseSheetService.ts:63`
- Test: `server/tests/deals-multiple-open.test.ts` (novo), `server/tests/budget-auto-apply.test.ts`

**Interfaces:**
- Consumes: `cardCampaignSql`, `PublicDeal.campaignName` (Task 4).
- Produces: `listOpenDealsByLead(leadId: string): Promise<PublicDeal[]>` (abertos, mais recente primeiro); `GET /api/deals/by-lead/:leadId/open` → `PublicDeal[]`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `server/tests/deals-multiple-open.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { getDealByLeadId } from '../services/dealsService';
import { getCaseSheet } from '../services/caseSheetService';
import { createUser, createLead, createConversation, createDeal, createCampaign } from './helpers';

const app = createApp();
const DAY = 86_400_000;
let seq = 0;

async function login(email: string, name = 'Vendedor') {
  await createUser({ email, name, password: 'pw12345', role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function twoOpenCards(createdBy: string, owners: { velho?: string | null; novo?: string | null } = {}) {
  seq += 1;
  const lead = await createLead({ phone: `55549500${String(seq).padStart(5, '0')}` });
  const antiga = await createCampaign({ name: 'Campanha Teste', createdByUserId: createdBy });
  const nova = await createCampaign({ name: 'Teste Andrei III', createdByUserId: createdBy });
  const velho = await createDeal({
    leadId: lead.id, stage: 'proposta_enviada', campaignId: antiga.id,
    ownerUserId: owners.velho ?? null, createdAt: new Date(Date.now() - 120 * DAY),
  });
  const novo = await createDeal({
    leadId: lead.id, stage: 'lead_no_comercial', campaignId: nova.id,
    ownerUserId: owners.novo ?? null, createdAt: new Date(Date.now() - DAY),
  });
  return { lead, antiga, nova, velho, novo };
}

async function ownerOf(id: string) {
  return (await db.select({ o: deals.ownerUserId }).from(deals).where(eq(deals.id, id)))[0].o;
}

describe('lead com mais de um card aberto', () => {
  it('getDealByLeadId devolve o aberto mais recente', async () => {
    const u = await createUser({ email: 'mk1@x.com' });
    const { lead, novo } = await twoOpenCards(u.id);
    expect((await getDealByLeadId(lead.id))!.id).toBe(novo.id);
  });

  it('GET /deals/by-lead/:leadId/open lista os abertos, mais recente primeiro', async () => {
    const { token, userId } = await login('v1@x.com');
    const { lead, velho, novo } = await twoOpenCards(userId);
    await createDeal({ leadId: lead.id, stage: 'ganho', proposalValue: 10, closedAt: new Date() });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}/open`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([novo.id, velho.id]);
    expect(res.body[0].campaignName).toBe('Teste Andrei III');
  });

  it('ficha do caso usa o card aberto mais recente', async () => {
    const u = await createUser({ email: 'mk2@x.com' });
    const { lead, novo } = await twoOpenCards(u.id);
    expect((await getCaseSheet(lead.id)).dealId).toBe(novo.id);
  });

  it('pegar a conversa leva todos os cards abertos do lead', async () => {
    const julia = await login('julia@x.com', 'Julia');
    const carla = await createUser({ email: 'carla@x.com', name: 'Carla' });
    const { lead, velho, novo } = await twoOpenCards(julia.userId);
    // Terceiro card, de outra campanha, entregue à Carla no pipeline: fica com ela.
    const outra = await createCampaign({ name: 'Outra', createdByUserId: julia.userId });
    const daCarla = await createDeal({ leadId: lead.id, stage: 'em_negociacao', campaignId: outra.id, ownerUserId: carla.id });
    const conv = await createConversation({ phone: lead.phone!, leadId: lead.id, queue: 'comercial' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${julia.token}`);
    expect(res.status).toBe(200);

    expect(await ownerOf(velho.id)).toBe(julia.userId);
    expect(await ownerOf(novo.id)).toBe(julia.userId);
    expect(await ownerOf(daCarla.id)).toBe(carla.id);
  });

  it('Reativar: só barra quando há outro aberto da MESMA campanha', async () => {
    const { token, userId } = await login('v2@x.com');
    const { lead, antiga } = await twoOpenCards(userId);
    const fechadoDaAntigaOutroCiclo = await createDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: antiga.id,
    });
    const u2 = await createUser({ email: 'mk3@x.com' });
    const terceira = await createCampaign({ name: 'Terceira', createdByUserId: u2.id });
    const fechadoDaTerceira = await createDeal({
      leadId: lead.id, stage: 'perdido', lossReason: 'preco', closedAt: new Date(), campaignId: terceira.id,
    });

    const bloqueado = await request(app)
      .post(`/api/deals/${fechadoDaAntigaOutroCiclo.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(bloqueado.status).toBe(409);

    const liberado = await request(app)
      .post(`/api/deals/${fechadoDaTerceira.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'em_negociacao' });
    expect(liberado.status).toBe(200);
  });
});
```

Em `server/tests/budget-auto-apply.test.ts`, acrescentar `createCampaign` ao import de `'./helpers'` e, dentro de `describe('aplicacao automatica do orcamento no card'`, o teste:

```ts
  it('lead com dois cards abertos: o valor vai pro mais recente', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 4200, rotulo: 'Valor total' });
    const { lead, msg, seller } = await scenario({ stage: 'lead_no_comercial' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: seller.id });
    const antigo = (await db.select().from(deals).where(eq(deals.leadId, lead.id)))[0];
    await db.update(deals).set({ createdAt: new Date(Date.now() - 90 * 86_400_000) }).where(eq(deals.id, antigo.id));
    const novo = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: camp.id });

    await detectBudgetFromMessage(msg.id);

    const [n] = await db.select().from(deals).where(eq(deals.id, novo.id));
    const [a] = await db.select().from(deals).where(eq(deals.id, antigo.id));
    expect(Number(n.proposalValue)).toBe(4200);
    expect(a.proposalValue).toBeNull();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deals-multiple-open.test.ts server/tests/budget-auto-apply.test.ts`
Expected: FAIL — rota `/open` inexistente (404), dono só em um card, 409 também na terceira campanha, orçamento no card errado.

- [ ] **Step 3: `getDealByLeadId` e `listOpenDealsByLead`**

Em `server/services/dealsService.ts`, no `getDealByLeadId`, trocar o comentário e o `orderBy` por:

```ts
    // Com card por campanha, um lead pode ter mais de um aberto: prefere o
    // ABERTO mais recente; se todos fechados, o mais recente. `false` ordena
    // antes de `true`, então NOT-terminal (false) vem primeiro.
    .orderBy(sql`(${deals.stage} IN ('ganho', 'perdido'))`, desc(deals.createdAt))
```

e acrescentar logo depois da função:

```ts
// Cards ABERTOS do lead, mais recente primeiro. A barra lateral da Inbox usa
// pra alternar quando o lead tem card em mais de uma campanha.
export async function listOpenDealsByLead(leadId: string): Promise<PublicDeal[]> {
  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(and(eq(deals.leadId, leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
    .orderBy(desc(deals.createdAt));
  return rows.map(toPublic);
}
```

- [ ] **Step 4: Rota**

Em `server/controllers/dealsController.ts`, acrescentar `listOpenDealsByLead` ao primeiro import de `'../services/dealsService'` e, no fim do arquivo:

```ts
export async function openByLeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = byLeadParams.parse(req.params);
    res.json(await listOpenDealsByLead(leadId));
  } catch (e) { next(e); }
}
```

Em `server/routes/deals.ts`, acrescentar `openByLeadHandler` ao import e, logo abaixo da rota `/by-lead/:leadId`:

```ts
router.get('/by-lead/:leadId/open', ...guard, openByLeadHandler);
```

- [ ] **Step 5: Dono em todos os abertos**

Substituir o corpo de `syncDealOwnerWithConversation` (mantendo o JSDoc e a assinatura) por:

```ts
  // Com card por campanha o lead pode ter mais de um card aberto: a regra vale
  // pra cada um, independentemente.
  const cards = await db
    .select({ id: deals.id, ownerUserId: deals.ownerUserId })
    .from(deals)
    .where(and(eq(deals.leadId, input.leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`));

  for (const card of cards) {
    if (card.ownerUserId === input.toOwnerId) continue;
    if (card.ownerUserId !== null && card.ownerUserId !== input.fromOwnerId) continue;

    await db.transaction(async (tx) => {
      // Compare-and-set: se alguém mudou o dono do card entre a leitura e aqui,
      // não sobrescreve.
      const [updated] = await tx
        .update(deals)
        .set({ ownerUserId: input.toOwnerId, updatedAt: new Date() })
        .where(and(
          eq(deals.id, card.id),
          card.ownerUserId === null ? isNull(deals.ownerUserId) : eq(deals.ownerUserId, card.ownerUserId),
        ))
        .returning({ id: deals.id });
      if (!updated) return;
      await logActivity(tx, {
        dealId: card.id,
        kind: 'owner_changed',
        actorUserId: input.actorUserId,
        metadata: { fromUserId: card.ownerUserId, toUserId: input.toOwnerId, via: 'conversation' },
      });
    });
  }
```

- [ ] **Step 6: Reativar olha só a mesma campanha**

Em `changeStage`, substituir o bloco `if (reactivating) { ... }` (e o comentário acima dele) por:

```ts
  // Invariante "1 card ativo por (lead, campanha)": reabrir um card fechado
  // quando já há outro ATIVO da mesma campanha (ou do balde sem campanha)
  // violaria o índice parcial. Barra com erro amigável em vez de 500.
  if (reactivating) {
    const [otherActive] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(
        eq(deals.leadId, current.leadId),
        current.campaignId === null ? isNull(deals.campaignId) : eq(deals.campaignId, current.campaignId),
        sql`${deals.id} <> ${input.id}`,
        sql`${deals.stage} NOT IN ('ganho', 'perdido')`,
      ))
      .limit(1);
    if (otherActive) {
      throw new HttpError(409, 'Este lead já tem um negócio ativo desta campanha. Use o card ativo ou feche-o antes de reabrir este.');
    }
  }
```

- [ ] **Step 7: Orçamento e ficha no card mais recente**

Em `server/services/budgetDetection.ts`, trocar o import `import { and, eq, sql } from 'drizzle-orm';` por `import { and, desc, eq, sql } from 'drizzle-orm';` e, em `applyToPipeline`, acrescentar antes do `.limit(1)` da busca do deal:

```ts
    // Lead com card em mais de uma campanha: o orçamento é do ciclo mais recente.
    .orderBy(desc(deals.createdAt))
```

Em `server/services/caseSheetService.ts`, trocar o import `import { eq, and, ne, desc, asc } from 'drizzle-orm';` por `import { eq, and, ne, desc, asc, sql } from 'drizzle-orm';` e a busca do deal por:

```ts
  // Deal: o aberto mais recente; sem aberto, o fechado mais recente.
  const [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.leadId, leadId))
    .orderBy(sql`(${deals.stage} IN ('ganho', 'perdido'))`, desc(deals.createdAt))
    .limit(1);
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run server/tests/deals-multiple-open.test.ts server/tests/budget-auto-apply.test.ts server/tests/deal-owner-follows-conversation.test.ts server/tests/deals-repeat-cycle.test.ts server/tests/deals-by-lead.test.ts server/tests/case-sheet.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/services/dealsService.ts server/controllers/dealsController.ts server/routes/deals.ts server/services/budgetDetection.ts server/services/caseSheetService.ts server/tests/deals-multiple-open.test.ts server/tests/budget-auto-apply.test.ts
git commit -m "feat(inside-sales): leituras que assumiam um card por lead passam a usar o aberto mais recente" -m "Endpoint com os cards abertos do lead; dono da conversa vai pra todos os abertos; Reativar só barra na mesma campanha; orçamento e ficha no card mais recente." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fechamento dos cards de campanha encerrada (serviço, rotina, aviso)

**Files:**
- Create: `server/services/campaignClosure.ts`, `server/services/campaignClosureWorker.ts`
- Modify: `server/index.ts:36-50`
- Modify: `shared/types.ts:1048-1060` (`NOTIFICATION_KINDS`)
- Modify: `src/features/notifications/NotificationBell.tsx` (`KIND_ICON`, `KIND_TONE`)
- Test: `server/tests/campaign-closure.test.ts`

**Interfaces:**
- Consumes: `campaigns.cardsClosedAt`, `deals.campaignId`, motivo `campanha_encerrada` (Task 1); `emitNotification` de `server/services/notifications.ts`.
- Produces:
  - `closeCampaignCards(campaignId: string, actorUserId: string | null): Promise<{ closed: number }>` — usado pela Task 7.
  - `closeEndedCampaigns(now?: Date): Promise<{ campaigns: number; cards: number }>`.
  - `startCampaignClosureWorker(): void`, `stopCampaignClosureWorker(): void`.
  - `NotificationKind` inclui `'campaign_cards_closed'`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/campaign-closure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, dealActivities, deals, notifications } from '../db/schema';
import { closeCampaignCards, closeEndedCampaigns } from '../services/campaignClosure';
import { reactivateDeal } from '../services/dealsService';
import { createUser, createLead, createDeal, createCampaign } from './helpers';

const DAY = 86_400_000;
let seq = 0;

async function newLead() {
  seq += 1;
  return createLead({ phone: `55549800${String(seq).padStart(5, '0')}` });
}

async function row(id: string) {
  return (await db.select().from(deals).where(eq(deals.id, id)))[0];
}

describe('closeCampaignCards', () => {
  it('fecha só os cards ABERTOS da campanha, com motivo e histórico', async () => {
    const julia = await createUser({ email: 'julia@x.com', name: 'Julia' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: julia.id });
    const outra = await createCampaign({ name: 'Outra', createdByUserId: julia.id });
    const a = await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: julia.id });
    const b = await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', proposalValue: 900, campaignId: camp.id });
    const ganho = await createDeal({
      leadId: (await newLead()).id, stage: 'ganho', proposalValue: 500,
      closedAt: new Date(Date.now() - DAY), campaignId: camp.id,
    });
    const deOutra = await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: outra.id });

    const r = await closeCampaignCards(camp.id, null);

    expect(r.closed).toBe(2);
    for (const id of [a.id, b.id]) {
      const d = await row(id);
      expect(d.stage).toBe('perdido');
      expect(d.lossReason).toBe('campanha_encerrada');
      expect(d.closedAt).not.toBeNull();
      expect(d.leadQualityFeedback).toBeNull();
    }
    expect((await row(ganho.id)).stage).toBe('ganho');
    expect((await row(deOutra.id)).stage).toBe('lead_no_comercial');

    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(c.cardsClosedAt).not.toBeNull();

    const lost = await db.select().from(dealActivities)
      .where(and(eq(dealActivities.dealId, a.id), eq(dealActivities.kind, 'lost')));
    expect(lost).toHaveLength(1);
    expect(lost[0].actorUserId).toBeNull();
    expect(lost[0].metadata).toMatchObject({ reason: 'campanha_encerrada', via: 'campaign_closed', campaignId: camp.id });
  });

  it('avisa cada dono uma vez, com a contagem; card sem dono não gera aviso', async () => {
    const julia = await createUser({ email: 'julia2@x.com', name: 'Julia' });
    const pedro = await createUser({ email: 'pedro@x.com', name: 'Pedro' });
    const camp = await createCampaign({ name: 'Teste Andrei III', createdByUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'proposta_enviada', campaignId: camp.id, ownerUserId: julia.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id, ownerUserId: pedro.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: camp.id });

    await closeCampaignCards(camp.id, null);

    const notifs = await db.select().from(notifications).where(eq(notifications.kind, 'campaign_cards_closed'));
    expect(notifs).toHaveLength(2);
    const daJulia = notifs.find((n) => n.userId === julia.id)!;
    expect(daJulia.body).toContain('2 cards seus foram fechados');
    expect(daJulia.body).toContain('Teste Andrei III');
    expect(daJulia.actionUrl).toBe('/inside-sales?tab=history&stage=perdido&reason=campanha_encerrada&owner=mine');
    expect(notifs.find((n) => n.userId === pedro.id)!.body).toContain('1 card seu foi fechado');
  });
});

describe('closeEndedCampaigns', () => {
  it('varre só campanha comum vencida e ainda não varrida', async () => {
    const u = await createUser({ email: 'u@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 9 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    const vigente = await createCampaign({
      name: 'Vigente', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const continua = await createCampaign({ name: 'Contínua', createdByUserId: u.id, isContinuous: true });
    const jaVarrida = await createCampaign({
      name: 'Já varrida', createdByUserId: u.id,
      validityEnd: new Date(Date.now() - 2 * DAY), cardsClosedAt: new Date(Date.now() - DAY),
    });
    const semVigencia = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });

    const cardOf: Record<string, string> = {};
    for (const c of [vencida, vigente, continua, jaVarrida, semVigencia]) {
      cardOf[c.name] = (await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id })).id;
    }

    const r = await closeEndedCampaigns();

    expect(r).toEqual({ campaigns: 1, cards: 1 });
    expect((await row(cardOf['Vencida'])).stage).toBe('perdido');
    for (const nome of ['Vigente', 'Contínua', 'Já varrida', 'Sem vigência']) {
      expect((await row(cardOf[nome])).stage).toBe('lead_no_comercial');
    }
  });

  it('card reativado depois do fechamento não é fechado de novo', async () => {
    const u = await createUser({ email: 'u2@x.com' });
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 9 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    const card = await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', campaignId: vencida.id });

    await closeEndedCampaigns();
    await reactivateDeal({ dealId: card.id, actorUserId: u.id });
    await closeEndedCampaigns();

    expect((await row(card.id)).stage).toBe('proposta_enviada');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/campaign-closure.test.ts`
Expected: FAIL — `Cannot find module '../services/campaignClosure'`.

- [ ] **Step 3: Tipo de notificação**

Em `shared/types.ts`, em `NOTIFICATION_KINDS`, antes de `'system'`:

```ts
  'campaign_cards_closed',  // campanha encerrou e fechou cards do dono
```

Em `src/features/notifications/NotificationBell.tsx`, acrescentar `Archive` ao import de `lucide-react` e as entradas:

```ts
  campaign_cards_closed:   Archive,
```

em `KIND_ICON` e

```ts
  campaign_cards_closed:   'text-slate-500',
```

em `KIND_TONE` (ambas antes de `system`).

- [ ] **Step 4: Serviço de fechamento**

Criar `server/services/campaignClosure.ts`:

```ts
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, dealActivities, deals } from '../db/schema';
import { emitNotification } from './notifications';

const HISTORY_URL = '/inside-sales?tab=history&stage=perdido&reason=campanha_encerrada&owner=mine';

/**
 * Fecha os cards ABERTOS de uma campanha: perdido, motivo "campanha_encerrada".
 *
 * Não passa por changeStage de propósito: lá o fechamento manual exige a
 * avaliação de qualidade do lead, que não existe numa automação. O histórico
 * do card recebe as mesmas atividades do fechamento manual (stage_changed +
 * lost), com actor = quem clicou em "Encerrar" ou null ("Sistema").
 *
 * Marca a campanha como varrida (cards_closed_at) na mesma transação: a rotina
 * automática nunca volta nela, então card reaberto com "Reativar" fica aberto.
 */
export async function closeCampaignCards(
  campaignId: string,
  actorUserId: string | null,
): Promise<{ closed: number }> {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { closed: 0 };

  const closedCards = await db.transaction(async (tx) => {
    const now = new Date();
    const open = await tx
      .select({ id: deals.id, stage: deals.stage, ownerUserId: deals.ownerUserId })
      .from(deals)
      .where(and(eq(deals.campaignId, campaignId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
      .for('update');

    if (open.length > 0) {
      await tx
        .update(deals)
        .set({ stage: 'perdido', lossReason: 'campanha_encerrada', closedAt: now, updatedAt: now })
        .where(inArray(deals.id, open.map((d) => d.id)));
      await tx.insert(dealActivities).values(open.flatMap((d) => [
        {
          dealId: d.id,
          kind: 'stage_changed' as const,
          actorUserId,
          metadata: { from: d.stage, to: 'perdido', via: 'campaign_closed' },
        },
        {
          dealId: d.id,
          kind: 'lost' as const,
          actorUserId,
          metadata: { reason: 'campanha_encerrada', via: 'campaign_closed', campaignId },
        },
      ]));
    }

    await tx.update(campaigns).set({ cardsClosedAt: now }).where(eq(campaigns.id, campaignId));
    return open;
  });

  // Aviso ao dono (fora da transação; emitNotification é best-effort): quem
  // ainda negociava não é pego de surpresa e pode reativar pelo Histórico.
  const byOwner = new Map<string, number>();
  for (const c of closedCards) {
    if (c.ownerUserId) byOwner.set(c.ownerUserId, (byOwner.get(c.ownerUserId) ?? 0) + 1);
  }
  for (const [userId, n] of byOwner) {
    await emitNotification({
      userIds: [userId],
      kind: 'campaign_cards_closed',
      title: 'Campanha encerrada',
      body: `${n} ${n === 1 ? 'card seu foi fechado' : 'cards seus foram fechados'}: campanha ${campaign.name} encerrou.`,
      actionUrl: HISTORY_URL,
      metadata: { campaignId, closed: n },
    });
  }

  return { closed: closedCards.length };
}

/**
 * Varre as campanhas comuns com vigência vencida (validity_end < now) que ainda
 * não foram varridas. Contínuas não têm vigência e nunca entram; comuns sem
 * vigência (anteriores a 31/08/2026) também não — essas só pelo botão.
 */
export async function closeEndedCampaigns(
  now: Date = new Date(),
): Promise<{ campaigns: number; cards: number }> {
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(
      eq(campaigns.isContinuous, false),
      isNull(campaigns.cardsClosedAt),
      lt(campaigns.validityEnd, now),
    ));

  let cards = 0;
  for (const c of due) {
    cards += (await closeCampaignCards(c.id, null)).closed;
  }
  return { campaigns: due.length, cards };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run server/tests/campaign-closure.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Rotina de 15 minutos**

Criar `server/services/campaignClosureWorker.ts`:

```ts
import { closeEndedCampaigns } from './campaignClosure';

/**
 * Rotina que fecha os cards das campanhas cuja vigência acabou. 15 min basta:
 * a vigência é contada em dias, e o botão "Encerrar campanha" fecha na hora.
 *
 * Single-instance assumption, igual ao slaWatchdog: a Lubritec roda num só
 * processo. A varredura é idempotente (cards_closed_at), então um tick
 * duplicado não fecha nada duas vezes.
 */
const TICK_MS = 15 * 60_000;

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startCampaignClosureWorker(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // Tick inicial pouco depois do boot.
  setTimeout(tick, 30_000);
}

export function stopCampaignClosureWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const r = await closeEndedCampaigns();
    if (r.campaigns > 0) {
      console.log(`[campaign-closure] tick: ${r.campaigns} campanha(s) encerrada(s), ${r.cards} card(s) fechado(s)`);
    }
  } catch (err) {
    console.error('[campaign-closure] tick failed:', err);
  } finally {
    isProcessing = false;
  }
}
```

Em `server/index.ts`, acrescentar o import `import { startCampaignClosureWorker } from './services/campaignClosureWorker';` junto dos outros e, depois do `startSlaWatchdog()` e seu log:

```ts
  startCampaignClosureWorker();
  console.log('[campaign-closure] worker started (tick every 15min — fecha cards de campanha encerrada)');
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add server/services/campaignClosure.ts server/services/campaignClosureWorker.ts server/index.ts shared/types.ts src/features/notifications/NotificationBell.tsx server/tests/campaign-closure.test.ts
git commit -m "feat(campanhas): cards de campanha encerrada viram perdidos e o dono é avisado" -m "Rotina a cada 15 min varre as campanhas com vigência vencida, uma vez cada (cards_closed_at); card reativado depois fica aberto." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Botão "Encerrar campanha"

**Files:**
- Modify: `server/services/campaignsService.ts` (`getCampaignById`, novo `endCampaign`)
- Modify: `server/controllers/campaignsController.ts`, `server/routes/campaigns.ts`
- Modify: `shared/types.ts` (`PublicCampaign`)
- Create: `src/features/campaigns/endCampaign.ts`, `src/features/campaigns/endCampaign.test.ts`
- Modify: `src/features/campaigns/api.ts`, `src/pages/campaigns/CampaignDetailPage.tsx`
- Test: `server/tests/campaigns-end.test.ts`

**Interfaces:**
- Consumes: `closeCampaignCards(campaignId, actorUserId)` (Task 6).
- Produces: `endCampaign(id: string, actorUserId: string): Promise<{ closedCards: number }>`; `POST /api/campaigns/:id/end` → `{ closedCards }`; `PublicCampaign.openCardsCount?: number` (só no detalhe); front `canEndCampaign`, `endCampaignConfirmText`, `endCampaignResultMessage`, `useEndCampaign`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `server/tests/campaigns-end.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { campaigns, deals } from '../db/schema';
import { createUser, createLead, createDeal, createCampaign } from './helpers';

const app = createApp();
const DAY = 86_400_000;
let seq = 0;

async function loginAs(role: 'admin' | 'comercial' | 'recepcao') {
  seq += 1;
  const email = `${role}${seq}@x.com`;
  await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function newLead() {
  seq += 1;
  return createLead({ phone: `55549900${String(seq).padStart(5, '0')}` });
}

describe('POST /api/campaigns/:id/end', () => {
  it('403 pra recepção', async () => {
    const { token, userId } = await loginAs('recepcao');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed' });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('400 enquanto o disparo não terminou', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({ createdByUserId: userId, status: 'running' });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('400 pra campanha contínua', async () => {
    const { token, userId } = await loginAs('admin');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed', isContinuous: true });
    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('fecha os cards abertos, termina a vigência agora e marca como varrida', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      name: 'Teste Andrei III', createdByUserId: userId, status: 'completed',
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    const card = await createDeal({ leadId: (await newLead()).id, stage: 'proposta_enviada', campaignId: c.id });
    const before = Date.now();

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ closedCards: 1 });
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.validityEnd!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(camp.validityEnd!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(camp.cardsClosedAt).not.toBeNull();
    const [d] = await db.select().from(deals).where(eq(deals.id, card.id));
    expect(d.stage).toBe('perdido');
    expect(d.lossReason).toBe('campanha_encerrada');
  });

  it('campanha antiga já marcada como varrida no deploy: o botão fecha mesmo assim', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      name: 'Campanha Teste', createdByUserId: userId, status: 'completed',
      cardsClosedAt: new Date(Date.now() - DAY),
    });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id });

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ closedCards: 1 });
  });

  it('início da vigência no futuro vira agora (sem violar a ordem início ≤ fim)', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({
      createdByUserId: userId, status: 'cancelled',
      validityStart: new Date(Date.now() + 2 * DAY), validityEnd: new Date(Date.now() + 9 * DAY),
    });

    const res = await request(app).post(`/api/campaigns/${c.id}/end`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.validityStart!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('GET /api/campaigns/:id — openCardsCount', () => {
  it('conta os cards abertos da campanha', async () => {
    const { token, userId } = await loginAs('comercial');
    const c = await createCampaign({ createdByUserId: userId, status: 'completed' });
    await createDeal({ leadId: (await newLead()).id, stage: 'lead_no_comercial', campaignId: c.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'em_negociacao', campaignId: c.id });
    await createDeal({ leadId: (await newLead()).id, stage: 'ganho', proposalValue: 1, closedAt: new Date(), campaignId: c.id });

    const res = await request(app).get(`/api/campaigns/${c.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.openCardsCount).toBe(2);
  });
});
```

Criar `src/features/campaigns/endCampaign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canEndCampaign, endCampaignConfirmText, endCampaignResultMessage } from './endCampaign';

describe('canEndCampaign', () => {
  it('só campanha comum com disparo terminado', () => {
    expect(canEndCampaign({ isContinuous: false, status: 'completed' })).toBe(true);
    expect(canEndCampaign({ isContinuous: false, status: 'cancelled' })).toBe(true);
    expect(canEndCampaign({ isContinuous: false, status: 'running' })).toBe(false);
    expect(canEndCampaign({ isContinuous: false, status: 'paused' })).toBe(false);
    expect(canEndCampaign({ isContinuous: true, status: 'completed' })).toBe(false);
  });
});

describe('endCampaignConfirmText', () => {
  it('diz quantos cards vão fechar, no singular e no plural', () => {
    expect(endCampaignConfirmText(12)).toContain('12 cards abertos vão para Perdido');
    expect(endCampaignConfirmText(1)).toContain('1 card aberto vai para Perdido');
    expect(endCampaignConfirmText(12)).toContain('Campanha encerrada');
  });

  it('sem card aberto, avisa que só a vigência termina', () => {
    expect(endCampaignConfirmText(0)).toBe('Nenhum card aberto desta campanha. A vigência termina agora.');
  });
});

describe('endCampaignResultMessage', () => {
  it('resume o que foi fechado', () => {
    expect(endCampaignResultMessage(3)).toBe('Campanha encerrada. 3 cards fechados.');
    expect(endCampaignResultMessage(1)).toBe('Campanha encerrada. 1 card fechado.');
    expect(endCampaignResultMessage(0)).toBe('Campanha encerrada.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/campaigns-end.test.ts src/features/campaigns/endCampaign.test.ts`
Expected: FAIL — rota 404 e módulo `./endCampaign` inexistente.

- [ ] **Step 3: Serviço**

Em `shared/types.ts`, no `PublicCampaign`, depois de `validityEnd`:

```ts
  /** Cards abertos da campanha — só no detalhe (getCampaignById), pro
   * "Encerrar campanha" dizer quantos vão fechar. */
  openCardsCount?: number;
```

Em `server/services/campaignsService.ts`, acrescentar `deals` ao import de `'../db/schema'` (se ainda não estiver) e o import `import { closeCampaignCards } from './campaignClosure';`. Em `getCampaignById`, antes do `return pub;`:

```ts
  const [{ openCards }] = await db
    .select({ openCards: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.campaignId, id), sql`${deals.stage} NOT IN ('ganho', 'perdido')`));
  pub.openCardsCount = openCards;
```

Depois de `cancelCampaign`, acrescentar:

```ts
/**
 * "Encerrar campanha": a vigência termina agora e os cards abertos da campanha
 * viram perdidos ("Campanha encerrada"). Só depois do disparo terminado — fechar
 * cards de campanha que ainda envia não faz sentido; cancela antes. Contínua não
 * se encerra: não tem vigência e dispara sem parar.
 *
 * Varre mesmo campanha já marcada como varrida: é ação humana explícita, e é
 * assim que se limpam os cards das campanhas antigas (migration 049).
 */
export async function endCampaign(id: string, actorUserId: string): Promise<{ closedCards: number }> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'Campaign not found');
  if (row.isContinuous) {
    throw new HttpError(400, 'Campanha contínua não se encerra: os cards dela fecham na mão.');
  }
  if (row.status !== 'completed' && row.status !== 'cancelled') {
    throw new HttpError(400, 'Só dá pra encerrar depois que o disparo terminou. Cancele o disparo antes.');
  }

  const now = new Date();
  await db.update(campaigns).set({
    validityEnd: now,
    // CHECK validity_end >= validity_start: início ainda no futuro vira agora.
    ...(row.validityStart && row.validityStart > now ? { validityStart: now } : {}),
    updatedAt: now,
  }).where(eq(campaigns.id, id));

  const { closed } = await closeCampaignCards(id, actorUserId);
  return { closedCards: closed };
}
```

- [ ] **Step 4: Rota**

Em `server/controllers/campaignsController.ts`, acrescentar `endCampaign` ao import de `'../services/campaignsService'` e, depois de `cancelHandler`:

```ts
export async function endHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await endCampaign(id, req.user!.userId));
  } catch (e) { next(e); }
}
```

Em `server/routes/campaigns.ts`, acrescentar `endHandler` ao import do controller e, depois da rota `/:id/cancel`:

```ts
router.post('/:id/end', ...guard, endHandler);
```

- [ ] **Step 5: Regras e textos do front**

Criar `src/features/campaigns/endCampaign.ts`:

```ts
import type { CampaignStatus } from './types';

/** "Encerrar campanha" só aparece em campanha comum com disparo terminado. A
 * contínua não tem vigência; a que ainda dispara precisa ser cancelada antes. */
export function canEndCampaign(c: { isContinuous: boolean; status: CampaignStatus }): boolean {
  return !c.isContinuous && (c.status === 'completed' || c.status === 'cancelled');
}

export function endCampaignConfirmText(openCards: number): string {
  if (openCards === 0) return 'Nenhum card aberto desta campanha. A vigência termina agora.';
  const cards = openCards === 1 ? '1 card aberto vai' : `${openCards} cards abertos vão`;
  return `${cards} para Perdido, com o motivo "Campanha encerrada", e saem do Kanban. `
    + 'Os donos são avisados e podem reabrir pelo Histórico. A vigência termina agora.';
}

export function endCampaignResultMessage(closedCards: number): string {
  if (closedCards === 0) return 'Campanha encerrada.';
  return `Campanha encerrada. ${closedCards} ${closedCards === 1 ? 'card fechado' : 'cards fechados'}.`;
}
```

Em `src/features/campaigns/api.ts`, depois de `useCancelCampaign`:

```ts
export function useEndCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ closedCards: number }>(`/campaigns/${id}/end`, { method: 'POST' }),
    onSuccess: () => {
      invalidate(qc);
      // Os cards da campanha saíram do Kanban pro Histórico.
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}
```

- [ ] **Step 6: Botão e confirmação**

Em `src/pages/campaigns/CampaignDetailPage.tsx`:

1. Acrescentar `Flag` ao import de `lucide-react`; `useEndCampaign` ao import de `'@/features/campaigns/api'`; e o import `import { canEndCampaign, endCampaignConfirmText, endCampaignResultMessage } from '@/features/campaigns/endCampaign';`.
2. Depois de `const retryFailed = useRetryFailedCampaign();`: `const endCampaign = useEndCampaign();` e `const [confirmEndOpen, setConfirmEndOpen] = useState(false);`.
3. Depois do botão "Cancelar" (`{isCancellable && (...)}`):

```tsx
          {canEndCampaign(data) && (
            <Button size="sm" variant="outline" onClick={() => setConfirmEndOpen(true)}>
              <Flag className="h-4 w-4 mr-1" /> Encerrar campanha
            </Button>
          )}
```

4. Antes do `AlertDialog` de apagar:

```tsx
      <AlertDialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              {endCampaignConfirmText(data.openCardsCount ?? 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => endCampaign.mutate(id, {
                onSuccess: (r) => toast.success(endCampaignResultMessage(r.closedCards)),
                onError: onActionError,
              })}
            >
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run server/tests/campaigns-end.test.ts src/features/campaigns/endCampaign.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add server/services/campaignsService.ts server/controllers/campaignsController.ts server/routes/campaigns.ts shared/types.ts src/features/campaigns/endCampaign.ts src/features/campaigns/endCampaign.test.ts src/features/campaigns/api.ts src/pages/campaigns/CampaignDetailPage.tsx server/tests/campaigns-end.test.ts
git commit -m "feat(campanhas): botão Encerrar campanha fecha os cards dela na hora" -m "Termina a vigência agora e fecha os cards abertos; confirmação diz quantos. Só com disparo terminado; contínua não tem o botão." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Relatórios contam cada card só na campanha dele

**Files:**
- Modify: `server/services/campaignsService.ts` (`getCampaignFunnel` ~939-946, `getCampaignFunnelsBatch` ~1005-1016 e ~1091-1099, `getCampaignsAggregateStats` ~638-685, `getTopCampaigns` ~766-768, `getCampaignsTimeseries` ~849-865)
- Modify: `server/services/campaignReportService.ts` (~166-195)
- Test: `server/tests/campaign-deal-attribution.test.ts` (novo); `server/tests/campaigns-funnel.test.ts`, `server/tests/campaigns-export.test.ts`, `server/tests/campaign-report-xlsx.test.ts` (ajustes)

**Interfaces:**
- Consumes: `deals.campaignId` (Task 1).
- Produces: mesmas assinaturas; semântica "card conta só na própria campanha".

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/campaign-deal-attribution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getCampaignFunnel, getCampaignFunnelsBatch, getTopCampaigns,
  getCampaignsAggregateStats, getCampaignsTimeseries,
} from '../services/campaignsService';
import { buildCampaignReport } from '../services/campaignReportService';
import { createUser, createLead, createCampaign, createCampaignRecipient, createDeal } from './helpers';

const DAY = 86_400_000;

/** Samuel recebeu as duas campanhas; ganhou na primeira e tem card aberto na segunda. */
async function seed() {
  const u = await createUser({ email: 'attr@x.com', role: 'admin' });
  const a = await createCampaign({ name: 'Campanha Teste', createdByUserId: u.id, status: 'completed' });
  const b = await createCampaign({ name: 'Teste Andrei III', createdByUserId: u.id, status: 'completed' });
  const lead = await createLead({ phone: '5554991921858', name: 'Samuel' });
  await createCampaignRecipient({ campaignId: a.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 10 * DAY) });
  await createCampaignRecipient({ campaignId: b.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });
  await createDeal({
    leadId: lead.id, stage: 'ganho', proposalValue: 700,
    closedAt: new Date(Date.now() - 2 * DAY), campaignId: a.id,
  });
  await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', campaignId: b.id });
  return { a, b };
}

describe('card conta só na campanha dele', () => {
  it('funil de cada campanha (e o lote igual ao individual)', async () => {
    const { a, b } = await seed();
    const fa = await getCampaignFunnel(a.id);
    const fb = await getCampaignFunnel(b.id);

    expect([fa.won, fa.inDeal, fa.totalWonValue]).toEqual([1, 0, 700]);
    expect([fb.won, fb.inDeal, fb.totalWonValue]).toEqual([0, 1, 0]);

    const batch = await getCampaignFunnelsBatch([a.id, b.id]);
    expect(batch.get(a.id)).toEqual(fa);
    expect(batch.get(b.id)).toEqual(fb);
  });

  it('relatório em Excel', async () => {
    const { a, b } = await seed();
    const ra = await buildCampaignReport(a.id);
    const rb = await buildCampaignReport(b.id);
    expect([ra.phases.ganho.length, ra.phases.em_negociacao.length]).toEqual([1, 0]);
    expect([rb.phases.ganho.length, rb.phases.em_negociacao.length]).toEqual([0, 1]);
  });

  it('ranking, totais e série diária', async () => {
    await seed();
    const start = new Date(Date.now() - 30 * DAY);
    const end = new Date(Date.now() + DAY);

    const top = await getTopCampaigns({ start, end });
    const byName = Object.fromEntries(top.map((t) => [t.name, t]));
    expect(byName['Campanha Teste'].won).toBe(1);
    expect(byName['Teste Andrei III'].won).toBe(0);

    const agg = await getCampaignsAggregateStats({ start, end });
    expect(agg.totalWon).toBe(1);
    expect(agg.totalInDeal).toBe(1);
    expect(agg.totalWonValue).toBe(700);

    const series = await getCampaignsTimeseries({ start, end });
    expect(series.reduce((s, x) => s + x.won, 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/campaign-deal-attribution.test.ts`
Expected: FAIL — o funil e o ranking do "Teste Andrei III" contam o ganho da "Campanha Teste" (`won` = 1).

- [ ] **Step 3: Funil individual e em lote**

Em `getCampaignFunnel`, trocar a consulta `dealsRows` por:

```ts
  // Cada card conta só na campanha dele (deals.campaign_id). Até 28/09/2026 o
  // card de um lead contava em toda campanha que o lead tinha recebido.
  const dealsRows = await db.select({
    stage: deals.stage,
    lossReason: deals.lossReason,
    proposalValue: deals.proposalValue,
  })
    .from(deals)
    .where(eq(deals.campaignId, id));
```

No JSDoc de `getCampaignFunnelsBatch`, trocar a frase "inclusive o join de deals por lead_id sem filtrar status do destinatário (um lead em duas campanhas conta nas duas)" por "inclusive a contagem de cada card só na própria campanha (deals.campaign_id)". Trocar a consulta `dealsRows` por:

```ts
  const dealsRows = await db.select({
    campaignId: deals.campaignId,
    stage: deals.stage,
    lossReason: deals.lossReason,
    proposalValue: deals.proposalValue,
  })
    .from(deals)
    .where(inArray(deals.campaignId, ids));
```

e, no laço logo abaixo, `const f = out.get(d.campaignId);` por `const f = d.campaignId ? out.get(d.campaignId) : undefined;`.

- [ ] **Step 4: Excel**

Em `server/services/campaignReportService.ts`, trocar o comentário e o `WHERE` da consulta `deals`:

```ts
  // Cada card da campanha vira uma linha (deals.campaign_id). Um lead pode ter
  // mais de um card, cada um de uma campanha — aqui entram só os desta.
```

```sql
    WHERE d.campaign_id = ${campaignId}::uuid
```

(substitui o `WHERE d.lead_id IN (SELECT cr.lead_id FROM campaign_recipients cr WHERE cr.campaign_id = ...)`; o resto da consulta fica igual.)

- [ ] **Step 5: Relatório agregado**

Em `getCampaignsAggregateStats`, na consulta `dealsAgg`, trocar o bloco do `FROM` em diante por:

```sql
    FROM deals d
    JOIN campaigns c ON c.id = d.campaign_id
    WHERE TRUE
      ${kindCampaignFilter}
      ${leadDealFilter}
```

e, na consulta `lostReasonsRows`, trocar o `EXISTS (...)` por:

```sql
      AND EXISTS (
        SELECT 1 FROM campaigns c
        WHERE c.id = d.campaign_id
          ${kindCampaignFilter}
      )
```

Trocar o comentário acima de `dealsAgg` para: "Cards que vieram de campanha (deals.campaign_id) — cada um conta uma vez, na campanha dele."

Em `getTopCampaigns`, trocar `LEFT JOIN deals d ON d.lead_id = cr.lead_id` por:

```sql
    LEFT JOIN deals d ON d.lead_id = cr.lead_id AND d.campaign_id = c.id
```

Em `getCampaignsTimeseries`, na consulta `wonByDay`, trocar o `EXISTS (...)` por:

```sql
      AND EXISTS (
        SELECT 1 FROM campaigns c
        WHERE c.id = d.campaign_id
          ${kindCampaignFilter}
      )
```

- [ ] **Step 6: Ajustar os testes antigos à nova regra**

Os cenários desses testes criam o card sem campanha e contavam com a junção pelo lead. Dar ao card a campanha do cenário:

- `server/tests/campaigns-funnel.test.ts`, teste `'inDeal/won/lost contam corretamente baseados em deals'`: acrescentar `campaignId: c.id` nos três `createDeal`.
- `server/tests/campaigns-export.test.ts`, primeiro teste: acrescentar `campaignId: a.id` nos dois `createDeal`.
- `server/tests/campaign-report-xlsx.test.ts`: em `seedFullScenario`, acrescentar `campaignId: c.id` nos três `createDeal`; em `seedOneOfEach`, acrescentar `campaignId: c.id` nos dois `createDeal`.

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run server/tests/campaign-deal-attribution.test.ts server/tests/campaigns-funnel.test.ts server/tests/campaigns-export.test.ts server/tests/campaign-report-xlsx.test.ts server/tests/dashboard-macro-funnel.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/services/campaignsService.ts server/services/campaignReportService.ts server/tests/campaign-deal-attribution.test.ts server/tests/campaigns-funnel.test.ts server/tests/campaigns-export.test.ts server/tests/campaign-report-xlsx.test.ts
git commit -m "fix(relatorios): cada card conta só na campanha dele" -m "Funil, Excel, ranking, totais e série diária juntavam os cards pelo lead: um card contava em toda campanha que o lead recebeu. Os números das campanhas passadas mudam." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inbox — alternar entre os cards abertos do lead

**Files:**
- Create: `src/features/whatsapp/sidebarDeal.ts`, `src/features/whatsapp/sidebarDeal.test.ts`
- Modify: `src/features/inside-sales/api.ts` (novo `useOpenDealsByLead`)
- Modify: `src/features/whatsapp/LeadSidebar.tsx` (`PipelinePhasePicker`)

**Interfaces:**
- Consumes: `GET /api/deals/by-lead/:leadId/open` (Task 5); `PublicDeal.campaignName` (Task 4).
- Produces: `pickSidebarDeal<T extends { id: string }>(openDeals: T[], selectedId: string | null, fallback: T | null): T | null`; `dealOptionLabel(d: { campaignName: string | null; stage: DealStage }): string`; hook `useOpenDealsByLead(leadId: string | null)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/features/whatsapp/sidebarDeal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickSidebarDeal, dealOptionLabel } from './sidebarDeal';

const novo = { id: 'novo' };
const velho = { id: 'velho' };
const fechado = { id: 'fechado' };

describe('pickSidebarDeal', () => {
  it('sem escolha, mostra o aberto mais recente (primeiro da lista)', () => {
    expect(pickSidebarDeal([novo, velho], null, fechado)).toBe(novo);
  });

  it('respeita o card escolhido', () => {
    expect(pickSidebarDeal([novo, velho], 'velho', fechado)).toBe(velho);
  });

  it('escolha que deixou de estar aberta volta pro mais recente', () => {
    expect(pickSidebarDeal([novo], 'velho', fechado)).toBe(novo);
  });

  it('sem nenhum aberto, cai no card fechado mais recente', () => {
    expect(pickSidebarDeal([], null, fechado)).toBe(fechado);
    expect(pickSidebarDeal([], null, null)).toBeNull();
  });
});

describe('dealOptionLabel', () => {
  it('campanha e etapa', () => {
    expect(dealOptionLabel({ campaignName: 'Teste Andrei III', stage: 'lead_no_comercial' }))
      .toBe('Teste Andrei III · Lead no Comercial');
    expect(dealOptionLabel({ campaignName: null, stage: 'proposta_enviada' }))
      .toBe('Sem campanha · Proposta enviada');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/whatsapp/sidebarDeal.test.ts`
Expected: FAIL — módulo `./sidebarDeal` inexistente.

- [ ] **Step 3: Implementar a regra**

Criar `src/features/whatsapp/sidebarDeal.ts`:

```ts
import type { DealStage } from '@shared/types';
import { STAGE_LABELS } from '../inside-sales/helpers';

/**
 * Card exibido na barra lateral da Inbox. Com card por campanha o lead pode ter
 * mais de um aberto: mostra o escolhido pelo vendedor e, sem escolha (ou se o
 * escolhido fechou), o aberto mais recente. Sem aberto nenhum, o fechado mais
 * recente — é o que `/deals/by-lead` devolve.
 */
export function pickSidebarDeal<T extends { id: string }>(
  openDeals: T[],
  selectedId: string | null,
  fallback: T | null,
): T | null {
  if (selectedId) {
    const selected = openDeals.find((d) => d.id === selectedId);
    if (selected) return selected;
  }
  return openDeals[0] ?? fallback;
}

export function dealOptionLabel(d: { campaignName: string | null; stage: DealStage }): string {
  return `${d.campaignName ?? 'Sem campanha'} · ${STAGE_LABELS[d.stage]}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/whatsapp/sidebarDeal.test.ts`
Expected: PASS.

- [ ] **Step 5: Hook**

Em `src/features/inside-sales/api.ts`, depois de `useDealByLead`:

```ts
/** Cards ABERTOS do lead, mais recente primeiro (card por campanha). */
export function useOpenDealsByLead(leadId: string | null) {
  return useQuery({
    queryKey: ['deals', 'by-lead', leadId, 'open'],
    queryFn: () => api<PublicDeal[]>(`/deals/by-lead/${leadId}/open`),
    enabled: !!leadId,
    // Mesmo motivo do useDealByLead: a leitura do print escreve no card em background.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
```

- [ ] **Step 6: Barra lateral**

Em `src/features/whatsapp/LeadSidebar.tsx`:

1. Acrescentar `useOpenDealsByLead` ao import de `'@/features/inside-sales/api'` e o import `import { pickSidebarDeal, dealOptionLabel } from './sidebarDeal';`.
2. No início de `PipelinePhasePicker`, trocar `const { data: deal, isLoading } = useDealByLead(leadId);` por:

```tsx
  const { data: latestDeal, isLoading } = useDealByLead(leadId);
  const { data: openDeals } = useOpenDealsByLead(leadId);
  // Lead com card em mais de uma campanha: o vendedor escolhe qual está vendo.
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const deal = pickSidebarDeal(openDeals ?? [], selectedDealId, latestDeal ?? null);
```

3. No `return`, logo depois de `<div className="space-y-2">` e antes do `<Select value={currentStage} ...>`:

```tsx
      {openDeals && openDeals.length > 1 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            {openDeals.length} negócios abertos
          </p>
          <Select value={deal?.id} onValueChange={setSelectedDealId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {openDeals.map((d) => (
                <SelectItem key={d.id} value={d.id}>{dealOptionLabel(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
```

- [ ] **Step 7: Typecheck e build**

Run: `npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/features/whatsapp/sidebarDeal.ts src/features/whatsapp/sidebarDeal.test.ts src/features/inside-sales/api.ts src/features/whatsapp/LeadSidebar.tsx
git commit -m "feat(inbox): barra lateral alterna entre os cards abertos do lead" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: Suíte inteira**

Conferir antes que nenhuma outra sessão está rodando testes (`tasklist //FI "IMAGENAME eq postgres.exe"`).

Run: `npx vitest run`
Expected: todos os arquivos passam. Se falhar algum teste que dependia de "um card por lead" ou de `originCampaign*`, ajustar o **teste** à regra nova só quando a intenção dele continuar valendo; se a falha revelar comportamento errado, voltar à task correspondente.

- [ ] **Step 2: Typecheck e build de produção**

Run: `npm run build`
Expected: sucesso (roda os dois `tsc` e o `vite build`).

- [ ] **Step 3: Conferir que nada ficou de fora**

Run: `git grep -n "originCampaign" -- server/services/dealsService.ts src/features/inside-sales server/tests/deals-list-campaigns.test.ts`
Expected: nenhuma ocorrência. (A campanha de origem **da conversa** continua existindo em `conversationsService.ts`, `ConversationRow.tsx`, `caseSheetService.ts` e `aiAtendimento.ts` — é outro conceito.)

Run: `git grep -n "uidx_deals_one_active_per_lead" -- server/db/schema.ts server/services`
Expected: nenhuma ocorrência do nome antigo (só `uidx_deals_one_active_per_lead_campaign` no schema).

- [ ] **Step 4: Commit de fechamento (se o Step 1 ajustou testes)**

```bash
git add -A server/tests
git commit -m "test: ajusta testes antigos à regra de um card por campanha" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Parar e reportar**

Não fazer merge, push nem deploy. Reportar ao Fernando: commits da branch, resultado da suíte e do build, e o que o deploy faz sozinho (migrations 048 e 049 rodam no `start:prod`; a 049 **não** fecha card nenhum; a rotina de 15 min começa a fechar cards só de campanhas que vencerem depois do deploy).
