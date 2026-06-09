# Auto-trigger Enrichment Post-Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Após uma importação CSV com leads incompletos (sem telefone), disparar automaticamente o job de enriquecimento BrasilAPI — criando novo job se não houver ativo, ou anexando ao existente.

**Architecture:** Nova função `appendLeadsToActiveJob` em `enrichmentJobs.ts` com `ON CONFLICT DO NOTHING` pra dedupe. Função local `triggerAutoEnrichment` em `leadsImport.ts` orquestra append-or-start. `importLeadsFromCsv` recebe `userId` via opts e chama o trigger no pós-commit, com try/catch que nunca propaga erro pro import. Resposta enriquecida com bloco `enrichmentTriggered` consumido pelo frontend pra toast informativo.

**Tech Stack:** Express + Drizzle ORM + Postgres, React + TanStack Query, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-06-09-auto-trigger-enrichment-post-import-design.md`

---

## File Structure

**Modificações backend:**
- `shared/types.ts` — adicionar campo `enrichmentTriggered` opcional em `ImportReport`
- `server/services/enrichmentJobs.ts` — nova função `appendLeadsToActiveJob`
- `server/services/leadsImport.ts` — função local `triggerAutoEnrichment`, opts.userId, chamada no pós-commit
- `server/controllers/leadsController.ts` — passa `req.user!.userId` pro service

**Modificações frontend:**
- `src/features/leads/ImportCsvDialog.tsx` — toast usa `enrichmentTriggered`

**Testes:**
- `server/tests/enrichment-append.test.ts` (novo) — cobre `appendLeadsToActiveJob` em unidade
- `server/tests/leads-import-auto-enrichment.test.ts` (novo) — cobre o fluxo end-to-end via service

**Decomposição:** Mantém `triggerAutoEnrichment` privada dentro de `leadsImport.ts` (caller único; não justifica arquivo separado). `appendLeadsToActiveJob` fica em `enrichmentJobs.ts` ao lado de `startBulkEnrichment` pra coesão.

---

## Task 1: Tipo `enrichmentTriggered` em `ImportReport`

**Files:**
- Modify: `shared/types.ts` (interface `ImportReport`)

- [ ] **Step 1: Localizar a interface**

Procurar a interface `ImportReport` no arquivo:

```bash
cd C:/Saas_lubritec/lubritec-main && grep -n "interface ImportReport" shared/types.ts
```

- [ ] **Step 2: Adicionar o campo opcional**

Adicionar a propriedade `enrichmentTriggered` ao final da interface (antes do `}` de fechamento):

```ts
export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
  enrichmentTriggered?: {
    jobId: string;
    mode: 'started' | 'appended';
    newLeadsQueued: number;
    estimatedMinutes: number;
  } | null;
}
```

Se a interface atual já tiver outros campos extras, preservá-los — só ADICIONAR `enrichmentTriggered`. Se a interface atual tiver um shape diferente do mostrado acima, manter o shape atual e só adicionar o novo campo.

- [ ] **Step 3: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa.

- [ ] **Step 4: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add shared/types.ts
git commit -m "feat: add enrichmentTriggered field to ImportReport"
```

---

## Task 2: `appendLeadsToActiveJob` — teste primeiro (TDD)

**Files:**
- Test: `server/tests/enrichment-append.test.ts` (criar)
- Modify (próxima task): `server/services/enrichmentJobs.ts`

- [ ] **Step 1: Inspecionar os helpers de teste existentes**

Antes de escrever os testes, ler `server/tests/helpers.ts` e `server/tests/setup.ts` pra confirmar as APIs (`createLead`, `createUser`, `seedAuth`, e como o `resetDb`/setup global trunca tabelas):

```bash
cd C:/Saas_lubritec/lubritec-main && head -80 server/tests/helpers.ts
```

Adaptar os imports do teste abaixo se necessário (alguns projetos usam `import { createApp } from '../app'` em vez de `import { app }` — verifique padrão usado em `server/tests/enrichment-jobs.test.ts`).

- [ ] **Step 2: Criar o arquivo de teste**

Criar `server/tests/enrichment-append.test.ts` com:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads, leads } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { appendLeadsToActiveJob, startBulkEnrichment } from '../services/enrichmentJobs';
import { createLead, createUser } from './helpers';

// CNPJs com dígito verificador válido (14 dígitos).
const VALID_CNPJ_A = '11222333000181';
const VALID_CNPJ_B = '11444777000161';
const VALID_CNPJ_C = '00000000000191'; // CNPJ "Banco do Brasil" — válido
const VALID_CPF    = '11144477735';    // 11 dígitos — deve ser filtrado fora

describe('appendLeadsToActiveJob', () => {
  it('retorna null quando não há job ativo', async () => {
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const result = await appendLeadsToActiveJob([lead.id]);
    expect(result).toBeNull();
  });

  it('anexa novos leads ao job ativo e incrementa total_leads', async () => {
    const user = await createUser({ email: 'append-owner@x.com', role: 'admin' });
    // Cria 1 lead pré-existente em 'incomplete' pra haver candidato pro startBulkEnrichment.
    const seed = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    expect(job.totalLeads).toBe(1);

    // Agora cria 2 novos leads (simulam um import futuro) e anexa.
    const newA = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    const newB = await createLead({ phone: null, cnpj: VALID_CNPJ_C });
    const result = await appendLeadsToActiveJob([newA.id, newB.id]);

    expect(result).not.toBeNull();
    expect(result!.appended).toBe(2);
    expect(result!.jobId).toBe(job.id);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(3);

    const rows = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.leadId).sort()).toEqual([seed.id, newA.id, newB.id].sort());

    // Não usado, só pra silenciar lint
    void seed;
  });

  it('dedupe — não anexa leads que já estão no snapshot', async () => {
    const user = await createUser({ email: 'append-dup@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    // Tenta anexar o mesmo lead que já foi snapshotado.
    const result = await appendLeadsToActiveJob([lead.id]);
    expect(result!.appended).toBe(0);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(1); // Inalterado.
  });

  it('filtra CPFs (11 dígitos) silenciosamente', async () => {
    const user = await createUser({ email: 'append-cpf@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);

    const cpfLead = await createLead({ phone: null, cnpj: VALID_CPF });
    const result = await appendLeadsToActiveJob([cpfLead.id]);
    expect(result!.appended).toBe(0);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(1);
  });

  it('anexa em job pausado', async () => {
    const user = await createUser({ email: 'append-paused@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);
    // Move pra paused diretamente no banco.
    await db.update(enrichmentJobs).set({ status: 'paused' }).where(eq(enrichmentJobs.id, job.id));

    const newLead = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    const result = await appendLeadsToActiveJob([newLead.id]);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(1);

    const rows = await db.select().from(enrichmentJobLeads)
      .where(and(eq(enrichmentJobLeads.jobId, job.id), eq(enrichmentJobLeads.leadId, newLead.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('lista vazia retorna { appended: 0 } com jobId do ativo', async () => {
    const user = await createUser({ email: 'append-empty@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    const job = await startBulkEnrichment(user.id);

    const result = await appendLeadsToActiveJob([]);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(0);
    expect(result!.jobId).toBe(job.id);
  });
});
```

**IMPORTANTE — sobre `createLead`:** o helper de teste pode não aceitar `phone: null` ou `cnpj` arbitrário. Antes de prosseguir, leia `server/tests/helpers.ts` e ajuste as chamadas (ex: pode ser preciso passar `phone: ''` + `flowStage: 'incomplete'` manualmente). O importante é que os leads de teste tenham `flow_stage='incomplete'` E CNPJ válido (14 dígitos pros que devem aparecer no snapshot; 11 dígitos pro caso CPF).

- [ ] **Step 3: Rodar o teste pra confirmar falha**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- enrichment-append 2>&1 | tail -30
```

Esperado: 6 testes falham (função `appendLeadsToActiveJob` não existe ou não tem o comportamento esperado).

Se a falha for por causa de import inexistente (`appendLeadsToActiveJob` não exportado), tudo certo — Task 3 implementa.

- [ ] **Step 4: Commit do teste (vermelho)**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/tests/enrichment-append.test.ts
git commit -m "test: add failing tests for appendLeadsToActiveJob"
```

---

## Task 3: Implementar `appendLeadsToActiveJob`

**Files:**
- Modify: `server/services/enrichmentJobs.ts` (adicionar nova função após `startBulkEnrichment`)

- [ ] **Step 1: Adicionar a nova função**

Em `server/services/enrichmentJobs.ts`, após o fechamento de `startBulkEnrichment` (em torno da linha 135), adicionar:

```ts
// ---------------------------------------------------------------------------
// appendLeadsToActiveJob — anexa novos leads incompletos ao snapshot do job
// em curso. Usado pelo auto-disparo pós-importação de CSV.
//
// Filtros aplicados:
//  - Apenas leads com flow_stage='incomplete' E cnpj com 14 dígitos (CNPJ;
//    CPFs não são enriquecíveis via BrasilAPI).
//  - Dedupe via ON CONFLICT DO NOTHING contra a PK composta (job_id, lead_id).
// ---------------------------------------------------------------------------

export async function appendLeadsToActiveJob(
  leadIds: string[],
): Promise<{ jobId: string; appended: number } | null> {
  const job = await loadActiveRow();
  if (!job) return null;

  if (leadIds.length === 0) {
    return { jobId: job.id, appended: 0 };
  }

  // Filtra os leadIds pra incluir apenas incompletos com CNPJ válido (14 dig).
  const eligible = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(
      inArray(leads.id, leadIds),
      eq(leads.flowStage, 'incomplete'),
      sql`${leads.cnpj} IS NOT NULL`,
      sql`length(${leads.cnpj}) = 14`,
    ));

  if (eligible.length === 0) {
    return { jobId: job.id, appended: 0 };
  }

  let appended = 0;
  await db.transaction(async (tx) => {
    // Insert com ON CONFLICT (job_id, lead_id) DO NOTHING — dedupe nativo.
    // Chunks de 500 pra evitar SQL gigante.
    const CHUNK = 500;
    for (let i = 0; i < eligible.length; i += CHUNK) {
      const slice = eligible.slice(i, i + CHUNK);
      const result = await tx
        .insert(enrichmentJobLeads)
        .values(slice.map((c) => ({ jobId: job.id, leadId: c.id })))
        .onConflictDoNothing()
        .returning({ leadId: enrichmentJobLeads.leadId });
      appended += result.length;
    }

    if (appended > 0) {
      await tx
        .update(enrichmentJobs)
        .set({
          totalLeads: sql`${enrichmentJobs.totalLeads} + ${appended}`,
          updatedAt: new Date(),
        })
        .where(eq(enrichmentJobs.id, job.id));
    }
  });

  return { jobId: job.id, appended };
}
```

**Importante:**
- Reusa imports já existentes no topo do arquivo (`db`, `enrichmentJobs`, `enrichmentJobLeads`, `leads`, `and`, `eq`, `isNull`, `inArray`, `sql`). Verifique no topo do arquivo se `inArray` está importado — se não estiver, adicionar.
- `onConflictDoNothing()` no Drizzle é equivalente ao `ON CONFLICT DO NOTHING` SQL. Funciona porque a tabela `enrichment_job_leads` tem PK composta `(job_id, lead_id)` (ver migration `018_enrichment_jobs.sql:38`).
- `returning({ leadId })` no insert com `onConflictDoNothing` devolve apenas os rows efetivamente inseridos — perfeito pra contar o `appended` real.

- [ ] **Step 2: Verificar imports**

Conferir o topo de `server/services/enrichmentJobs.ts` (linhas 1–14). Os imports precisam incluir todos esses:

```ts
import { db } from '../db/client';
import {
  enrichmentJobs,
  enrichmentJobLeads,
  leads,
  type EnrichmentJob,
} from '../db/schema';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
```

Se `inArray` ou `leads` não estavam importados, adicionar.

- [ ] **Step 3: Rodar os testes**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- enrichment-append 2>&1 | tail -30
```

Esperado: os 6 testes passam.

Se algum falhar por causa de signature do helper `createLead` no Task 2, ajustar o teste ou criar leads diretamente via `db.insert(leads).values(...)` no teste.

- [ ] **Step 4: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa.

- [ ] **Step 5: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/services/enrichmentJobs.ts
git commit -m "feat: add appendLeadsToActiveJob with onConflict dedupe"
```

---

## Task 4: Função `triggerAutoEnrichment` + opts.userId em `importLeadsFromCsv`

**Files:**
- Modify: `server/services/leadsImport.ts`

- [ ] **Step 1: Adicionar imports**

No topo de `server/services/leadsImport.ts` (após a linha 12, junto dos imports relativos), adicionar:

```ts
import {
  startBulkEnrichment,
  appendLeadsToActiveJob,
  ENRICHMENT_TICK_MS,
} from './enrichmentJobs';
```

- [ ] **Step 2: Adicionar a função local `triggerAutoEnrichment` no topo do arquivo (após os helpers existentes)**

Logo após a função `normalizePhone` (em torno da linha 209), adicionar:

```ts
/**
 * Dispara enriquecimento BrasilAPI pra leads recém-criados em flow_stage='incomplete'.
 *
 * Estratégia:
 *  - Se há job ativo (pending/running/paused), anexa os novos IDs via
 *    appendLeadsToActiveJob (dedupe nativo).
 *  - Caso contrário, cria novo job via startBulkEnrichment, que snapshota TODOS
 *    os incompletes (cobre backlog antigo de graça).
 *
 * Try/catch envolvendo tudo: erro nunca falha o import. Retorna null em qualquer
 * falha (incluindo HttpError 400 "Nenhum lead incompleto…" do startBulkEnrichment).
 */
async function triggerAutoEnrichment(
  newLeadIds: string[],
  userId: string,
): Promise<NonNullable<ImportReport['enrichmentTriggered']> | null> {
  try {
    const appended = await appendLeadsToActiveJob(newLeadIds);
    if (appended) {
      const minutes = Math.ceil((appended.appended * ENRICHMENT_TICK_MS) / 60_000);
      return {
        jobId: appended.jobId,
        mode: 'appended',
        newLeadsQueued: appended.appended,
        estimatedMinutes: minutes,
      };
    }
    // Sem job ativo — cria um novo.
    const job = await startBulkEnrichment(userId);
    const minutes = Math.ceil((job.totalLeads * ENRICHMENT_TICK_MS) / 60_000);
    return {
      jobId: job.id,
      mode: 'started',
      newLeadsQueued: job.totalLeads,
      estimatedMinutes: minutes,
    };
  } catch (err) {
    console.error('[auto-enrichment] trigger failed:', err);
    return null;
  }
}
```

Nota sobre o tipo de retorno: `NonNullable<ImportReport['enrichmentTriggered']>` pega o tipo do campo do `ImportReport` retirando `null` e `undefined` — DRY com a definição do tipo no `shared/types.ts`.

- [ ] **Step 3: Atualizar a assinatura de `importLeadsFromCsv`**

Localizar a assinatura atual (linha 336):

```ts
export async function importLeadsFromCsv(
  buf: Buffer,
  _opts: { throttleMs?: number } = {},
): Promise<ImportReport> {
```

Substituir por:

```ts
export async function importLeadsFromCsv(
  buf: Buffer,
  opts: { throttleMs?: number; userId?: string } = {},
): Promise<ImportReport> {
```

(Renomeou de `_opts` pra `opts` porque agora é usado.)

- [ ] **Step 4: Adicionar a chamada do trigger no pós-commit**

No final da função (após o loop `for (const leadId of toEnroll) await tryEnrollSafe(leadId)`, em torno da linha 452, ANTES do `return { inserted, updated, skipped: 0, rejected };`), substituir o return por:

```ts
  // Auto-disparo de enriquecimento — best-effort. Pega os leads novos que
  // ficaram em 'incomplete' e os anexa ao job ativo (ou cria um novo).
  let enrichmentTriggered: ImportReport['enrichmentTriggered'] = null;
  const newIncompleteIds = newLeads
    .filter((l) => l.stage === 'incomplete')
    .map((l) => l.id);
  if (opts.userId && newIncompleteIds.length > 0) {
    enrichmentTriggered = await triggerAutoEnrichment(newIncompleteIds, opts.userId);
  }

  return { inserted, updated, skipped: 0, rejected, enrichmentTriggered };
```

- [ ] **Step 5: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa.

- [ ] **Step 6: Confirmar testes existentes ainda passam**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- leads-service 2>&1 | tail -20
```

Esperado: todos os testes existentes de `importLeadsFromCsv` continuam passando (eles não passam `userId`, então `enrichmentTriggered` será `null` — comportamento backwards-compat).

- [ ] **Step 7: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/services/leadsImport.ts
git commit -m "feat: triggerAutoEnrichment from importLeadsFromCsv"
```

---

## Task 5: Teste de integração end-to-end via service

**Files:**
- Test: `server/tests/leads-import-auto-enrichment.test.ts` (criar)

- [ ] **Step 1: Criar arquivo de teste**

Criar `server/tests/leads-import-auto-enrichment.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads, leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { importLeadsFromCsv } from '../services/leadsImport';
import * as enrichmentJobsService from '../services/enrichmentJobs';
import * as cnpjLookup from '../services/cnpjLookup';
import { createUser, createLead } from './helpers';

const VALID_CNPJ_1 = '11222333000181';
const VALID_CNPJ_2 = '11444777000161';
const VALID_CNPJ_3 = '00000000000191';
const VALID_CPF    = '11144477735';

describe('importLeadsFromCsv — auto-disparo de enrichmento', () => {
  beforeEach(() => {
    // BrasilAPI mockado pra não rodar de verdade — o worker NÃO é exercitado
    // neste teste; só verificamos que o snapshot/append acontece.
    vi.spyOn(cnpjLookup, 'lookupCnpj').mockImplementation(async (cnpj: string) => ({
      cnpj,
      status: 'active',
      razaoSocial: 'Test Co.',
      situacaoCadastral: 'ATIVA',
      telefone: null,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('não dispara quando todos os leads têm phone (sem incompletos novos)', async () => {
    const user = await createUser({ email: 'noauto-allphone@x.com', role: 'admin' });
    const csv = `name,phone,cnpj\nA,11999990001,${VALID_CNPJ_1}\nB,11999990002,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(2);
    expect(report.enrichmentTriggered).toBeNull();

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(0);
  });

  it('cria novo job quando não há ativo e há incompletos novos', async () => {
    const user = await createUser({ email: 'noauto-newjob@x.com', role: 'admin' });
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\nB,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(2);
    expect(report.enrichmentTriggered).not.toBeNull();
    expect(report.enrichmentTriggered!.mode).toBe('started');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(2);
    expect(report.enrichmentTriggered!.estimatedMinutes).toBeGreaterThan(0);

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('running');
    expect(jobs[0].totalLeads).toBe(2);
  });

  it('anexa quando já existe job ativo', async () => {
    const user = await createUser({ email: 'noauto-append@x.com', role: 'admin' });
    // Pre-cria job com 1 lead em snapshot.
    await createLead({ phone: null, cnpj: VALID_CNPJ_3 });
    const job = await enrichmentJobsService.startBulkEnrichment(user.id);
    expect(job.totalLeads).toBe(1);

    // Agora importa 2 novos incompletos.
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\nB,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.enrichmentTriggered!.mode).toBe('appended');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(2);
    expect(report.enrichmentTriggered!.jobId).toBe(job.id);

    const [updated] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(updated.totalLeads).toBe(3);
  });

  it('CPFs incompletos não são anexados', async () => {
    const user = await createUser({ email: 'noauto-cpf@x.com', role: 'admin' });
    await createLead({ phone: null, cnpj: VALID_CNPJ_3 });
    const job = await enrichmentJobsService.startBulkEnrichment(user.id);

    const csv = `name,cnpj\nPessoa Fisica,${VALID_CPF}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered!.mode).toBe('appended');
    expect(report.enrichmentTriggered!.newLeadsQueued).toBe(0);
    expect(report.enrichmentTriggered!.jobId).toBe(job.id);

    const [unchanged] = await db.select().from(enrichmentJobs).where(eq(enrichmentJobs.id, job.id));
    expect(unchanged.totalLeads).toBe(1);
  });

  it('falha do trigger NUNCA propaga — import retorna OK', async () => {
    const user = await createUser({ email: 'noauto-failsafe@x.com', role: 'admin' });
    // Mocka startBulkEnrichment pra throw — simula BrasilAPI off / erro de banco.
    vi.spyOn(enrichmentJobsService, 'startBulkEnrichment').mockRejectedValueOnce(
      new Error('simulated outage'),
    );

    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { userId: user.id });

    // Import sucesso, mas trigger null.
    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered).toBeNull();
    // Lead foi inserido mesmo assim.
    const inserted = await db.select().from(leads).where(eq(leads.cnpj, VALID_CNPJ_1));
    expect(inserted).toHaveLength(1);
  });

  it('sem userId no opts → não dispara (backwards-compat com testes antigos)', async () => {
    const csv = `name,cnpj\nA,${VALID_CNPJ_1}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(1);
    expect(report.enrichmentTriggered).toBeFalsy(); // null ou undefined — tudo bem.

    const jobs = await db.select().from(enrichmentJobs);
    expect(jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar o teste**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- leads-import-auto-enrichment 2>&1 | tail -30
```

Esperado: os 6 testes passam.

Possíveis ajustes se falhar:
- Se `createLead({ phone: null })` não funcionar, criar via insert direto do drizzle no banco com `phone: null, flowStage: 'incomplete', cnpj: ..., source: 'csv'`.
- Se o teste de "failsafe" falhar porque a mock não pega o spy: `vi.spyOn` em ES modules pode precisar de `{ virtual: true }` ou usar `vi.mock()` em vez de `vi.spyOn`. Adaptar conforme padrão do projeto (ver outros testes que mockam `enrichmentJobsService` ou `cnpjLookup` — `leads-service.test.ts` já mocka `cnpjLookup` via `vi.spyOn`).

- [ ] **Step 3: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/tests/leads-import-auto-enrichment.test.ts
git commit -m "test: end-to-end auto-enrichment trigger from CSV import"
```

---

## Task 6: Passar `userId` pelo controller

**Files:**
- Modify: `server/controllers/leadsController.ts` (handler `importHandler`)

- [ ] **Step 1: Alterar `importHandler`**

Localizar a função `importHandler` em `server/controllers/leadsController.ts` (linha 138). A versão atual:

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

Substituir por:

```ts
export async function importHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    const report = await importLeadsFromCsv(req.file.buffer, {
      userId: req.user!.userId,
    });
    res.json(report);
  } catch (e) {
    next(e);
  }
}
```

Nota: a rota `/api/leads/import` já está protegida pelo `authGuard` (ver `server/routes/leads.ts:42–69`), então `req.user!.userId` é seguro.

- [ ] **Step 2: Confirmar testes da API continuam passando**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- leads-api 2>&1 | tail -20
```

Esperado: os testes do controller passam. Se algum começar a falhar com `enrichmentTriggered` aparecendo na resposta inesperadamente, ajustar a asserção ou aceitar o novo comportamento — é comportamento NOVO esperado.

- [ ] **Step 3: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa.

- [ ] **Step 4: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/controllers/leadsController.ts
git commit -m "feat: forward userId from import handler to enrichment trigger"
```

---

## Task 7: Frontend — toast usando `enrichmentTriggered`

**Files:**
- Modify: `src/features/leads/ImportCsvDialog.tsx`

- [ ] **Step 1: Atualizar a função `onUpload`**

Localizar `onUpload` em `src/features/leads/ImportCsvDialog.tsx` (linhas 28–44). A versão atual mostra um toast genérico de import OK. Substituir pelo bloco que distingue os 3 estados (sem auto-disparo, started, appended).

Substituir a função `onUpload` por:

```tsx
async function onUpload() {
  if (!file) return;
  try {
    const r = await importMut.mutateAsync(file);
    setReport(r);

    const baseMsg = `Import concluído: ${r.inserted} novos, ${r.updated} atualizados.`;

    if (r.enrichmentTriggered && r.enrichmentTriggered.newLeadsQueued > 0) {
      const et = r.enrichmentTriggered;
      const tail =
        et.mode === 'started'
          ? `${et.newLeadsQueued} leads na fila de enriquecimento — conclui em ~${et.estimatedMinutes}min.`
          : `${et.newLeadsQueued} leads anexados ao job de enriquecimento em andamento (+~${et.estimatedMinutes}min).`;
      toast.success(`${baseMsg}\n${tail}`, { duration: 8_000 });
    } else {
      toast.success(
        `${baseMsg}\n` +
        `Validação de CNPJ na Receita Federal rolando em background — leads com problema aparecem em "Com problemas" no filtro.`,
        { duration: 8_000 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? translateError(e.message) : 'Erro ao importar.';
    toast.error(msg);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa (o campo `enrichmentTriggered` foi adicionado em Task 1).

- [ ] **Step 3: Smoke test visual (manual)**

Rodar `npm run dev` em outro terminal. Em `/cadastros`, abrir o dialog de import e subir:

1. **CSV com phone + CNPJ**: toast deve mostrar mensagem antiga (validação em background) — sem menção a enrichment job.
2. **CSV só com CNPJ (sem phone)**: toast deve mostrar "X leads na fila de enriquecimento — conclui em ~Ymin" (mode `started`).
3. **Subir um segundo CSV só com CNPJ enquanto o job anterior ainda está rodando**: toast deve mostrar "X leads anexados ao job em andamento (+~Ymin)" (mode `appended`).

Se o smoke não der pra rodar agora (sem banco local pronto), os testes E2E do Task 5 já cobrem o backend; o frontend é só visual.

- [ ] **Step 4: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add src/features/leads/ImportCsvDialog.tsx
git commit -m "feat: toast shows enrichment auto-trigger summary in import dialog"
```

---

## Task 8: Verificação final

- [ ] **Step 1: Rodar a suite focada nos arquivos tocados**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- enrichment-append leads-import-auto-enrichment leads-service leads-api 2>&1 | tail -20
```

Esperado: tudo passa.

Se o embedded postgres reclamar de diretório suja (`initdb: error: directory ... exists but is not empty`), limpar antes:

```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

E rodar de novo.

- [ ] **Step 2: Typecheck completo**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run typecheck
```

Esperado: passa.

- [ ] **Step 3: Verificar git log**

```bash
cd C:/Saas_lubritec/lubritec-main && git log --oneline -8
```

Esperado: ver os 7 commits da feature (Task 1 a Task 7) em ordem cronológica.

- [ ] **Step 4 (opcional): Smoke E2E manual**

Subir o app local e exercitar o fluxo descrito no Task 7 Step 3.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| Comportamento "sem novos incompletos não dispara" | Task 4 (filtro `newIncompleteIds.length > 0`) + teste Task 5 |
| Comportamento "sem job ativo → cria novo" | Task 4 (`startBulkEnrichment`) + testes Task 5 |
| Comportamento "com job ativo → anexa" | Task 3 (`appendLeadsToActiveJob`) + testes Tasks 2 e 5 |
| Filtra CPF do snapshot | Task 3 (filtro `length(cnpj)=14`) + testes Tasks 2 e 5 |
| Dedupe via `ON CONFLICT DO NOTHING` | Task 3 + teste Task 2 |
| `triggerAutoEnrichment` envolto em try/catch | Task 4 + teste failsafe Task 5 |
| `ImportReport.enrichmentTriggered` | Task 1 + Task 4 |
| Controller passa `req.user!.userId` | Task 6 |
| Toast informativo nos 3 estados (no-op, started, appended) | Task 7 |
| Backwards-compat com testes antigos (sem userId) | Task 4 (opt) + teste Task 5 |
| Anexa em job paused | Task 3 (loadActiveRow já cobre 'paused') + teste Task 2 |

**Placeholder scan:** nenhum TBD/TODO. Cada step tem código completo ou comando exato. As notas "se o helper X não funcionar, ajustar Y" são orientações de fallback, não placeholders — fornecem o caminho exato a tomar caso o sintoma apareça.

**Type consistency:**
- `appendLeadsToActiveJob` retorna `{ jobId: string; appended: number } | null` em todos os usos (Task 2, 3, 4).
- `triggerAutoEnrichment` usa `NonNullable<ImportReport['enrichmentTriggered']>` pra DRY com `shared/types.ts`.
- `ImportReport.enrichmentTriggered.mode` é literal union `'started' | 'appended'` consistente entre Tasks 1, 4 e 7.
- `ENRICHMENT_TICK_MS` importado em Task 4 do mesmo módulo que define a constante (Task 3 / `enrichmentJobs.ts:16`).
