# Retry "BrasilAPI falhou" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar botão no `BulkEnrichmentDialog` que cria um job de enriquecimento snapshotando APENAS leads com `result_status='api_error'` ainda em `flow_stage='incomplete'`.

**Architecture:** Nova função `startRetryApiErrorJob` em `enrichmentJobs.ts` (espelha `startBulkEnrichment` mas com query JOIN restritiva). Novo handler + rota POST `/enrich-bulk/retry-failed` com mesmo guard admin. Novo hook `useRetryFailedBulkEnrichment` e botão `outline` no dialog ao lado de "Iniciar enriquecimento".

**Tech Stack:** Express + Drizzle ORM + Postgres, React + TanStack Query + shadcn/ui, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-06-09-retry-api-error-enrichment-design.md`

---

## File Structure

**Modificações backend:**
- `server/services/enrichmentJobs.ts` — nova função `startRetryApiErrorJob`
- `server/controllers/leadsController.ts` — novo handler `bulkEnrichRetryFailedHandler`
- `server/routes/leads.ts` — registrar rota `POST /enrich-bulk/retry-failed`

**Modificações frontend:**
- `src/features/leads/api.ts` — novo hook `useRetryFailedBulkEnrichment`
- `src/features/leads/BulkEnrichmentDialog.tsx` — botão novo no footer + handler

**Testes:**
- `server/tests/retry-api-error.test.ts` (novo) — unit tests do service
- `server/tests/leads-api.test.ts` — adicionar smoke test de auth da nova rota

---

## Task 1: Testes de unidade do `startRetryApiErrorJob` (TDD)

**Files:**
- Create: `server/tests/retry-api-error.test.ts`

- [ ] **Step 1: Inspecionar helpers**

Antes de escrever, ler `server/tests/helpers.ts` pra confirmar signatures de `createLead`, `createUser`. Confirmar também como `enrichment_job_leads` é populado em testes existentes:

```bash
cd C:/Saas_lubritec/lubritec-main && head -120 server/tests/helpers.ts
grep -n "enrichment_job_leads\|enrichmentJobLeads" server/tests/*.ts | head -20
```

Pontos a confirmar:
- `createLead({ phone: null, cnpj: '...' })` aceita phone null (já confirmado em sessões anteriores deste projeto).
- Para inserir rows em `enrichment_job_leads` direto, usar `db.insert(enrichmentJobLeads).values({...})`. Schema: `{ jobId, leadId, status: 'pending'|'succeeded'|'failed', resultStatus, phoneFound, errorMessage, processedAt }`.

- [ ] **Step 2: Criar o arquivo de teste**

Criar `server/tests/retry-api-error.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads, leads } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { startRetryApiErrorJob, startBulkEnrichment } from '../services/enrichmentJobs';
import { HttpError } from '../middleware/errorHandler';
import { createLead, createUser } from './helpers';

// CNPJs com dígito verificador válido (14 dígitos).
const VALID_CNPJ_A = '11222333000181';
const VALID_CNPJ_B = '11444777000161';
const VALID_CNPJ_C = '00000000000191';
const VALID_CNPJ_D = '91839456000103'; // o do caso real reportado
const VALID_CNPJ_E = '11888777000162';
// CPF (11 dígitos) — deve ser filtrado fora.
const VALID_CPF    = '11144477735';

async function seedJobAndApiError(opts: {
  userId: string;
  leadId: string;
  resultStatus?: string;
  jobStatus?: 'running' | 'completed' | 'cancelled' | 'paused';
}): Promise<string> {
  // Cria um job em status completed (default) e insere uma row em enrichment_job_leads
  // com o resultStatus pedido. Util pra simular jobs antigos que já rodaram.
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      status: opts.jobStatus ?? 'completed',
      totalLeads: 1,
      processedCount: 1,
      succeededCount: opts.resultStatus === 'phone_found' ? 1 : 0,
      failedCount: opts.resultStatus === 'phone_found' ? 0 : 1,
      startedAt: new Date(),
      completedAt: opts.jobStatus === 'completed' || opts.jobStatus == null ? new Date() : null,
      createdByUserId: opts.userId,
    })
    .returning();

  await db.insert(enrichmentJobLeads).values({
    jobId: job.id,
    leadId: opts.leadId,
    status: opts.resultStatus === 'phone_found' ? 'succeeded' : 'failed',
    resultStatus: opts.resultStatus ?? 'api_error',
    processedAt: new Date(),
  });

  return job.id;
}

describe('startRetryApiErrorJob', () => {
  it('409 quando já existe job ativo', async () => {
    const user = await createUser({ email: 'retry-409@x.com', role: 'admin' });
    // Cria um lead pra startBulkEnrichment ter algo, depois força conflito.
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await startBulkEnrichment(user.id); // job em running

    await expect(startRetryApiErrorJob(user.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/em andamento/i),
    });
  });

  it('400 quando zero candidatos com api_error', async () => {
    const user = await createUser({ email: 'retry-400@x.com', role: 'admin' });
    // Cria lead incompleto, mas sem nenhuma tentativa anterior.
    await createLead({ phone: null, cnpj: VALID_CNPJ_A });

    await expect(startRetryApiErrorJob(user.id)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Nenhum lead com erro BrasilAPI/i),
    });
  });

  it('snapshot inclui SÓ leads incompletos com api_error e CNPJ 14 dig', async () => {
    const user = await createUser({ email: 'retry-filter@x.com', role: 'admin' });

    // (1) api_error + incomplete + CNPJ → ENTRA
    const wanted1 = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({ userId: user.id, leadId: wanted1.id });

    // (2) api_error + incomplete + CNPJ → ENTRA
    const wanted2 = await createLead({ phone: null, cnpj: VALID_CNPJ_B });
    await seedJobAndApiError({ userId: user.id, leadId: wanted2.id });

    // (3) api_error MAS já complete (foi promovido manualmente) → NÃO ENTRA
    const promoted = await createLead({ phone: '5511999999999', cnpj: VALID_CNPJ_C });
    await seedJobAndApiError({ userId: user.id, leadId: promoted.id });

    // (4) cnpj_not_found + incomplete → NÃO ENTRA (permanente)
    const notFound = await createLead({ phone: null, cnpj: VALID_CNPJ_D });
    await seedJobAndApiError({
      userId: user.id, leadId: notFound.id, resultStatus: 'cnpj_not_found',
    });

    // (5) phone_not_in_brasilapi + incomplete → NÃO ENTRA (fora de escopo)
    const noPhone = await createLead({ phone: null, cnpj: VALID_CNPJ_E });
    await seedJobAndApiError({
      userId: user.id, leadId: noPhone.id, resultStatus: 'phone_not_in_brasilapi',
    });

    // (6) CPF + api_error + incomplete → NÃO ENTRA (filtro length=14)
    const cpfLead = await createLead({ phone: null, cnpj: VALID_CPF });
    await seedJobAndApiError({ userId: user.id, leadId: cpfLead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(2);
    expect(job.status).toBe('running');
    expect(job.processedCount).toBe(0);

    const rows = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.leadId).sort()).toEqual([wanted1.id, wanted2.id].sort());
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });

  it('lead com múltiplas tentativas api_error entra UMA vez (DISTINCT)', async () => {
    const user = await createUser({ email: 'retry-distinct@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });

    // 2 jobs antigos, ambos com api_error pro mesmo lead.
    await seedJobAndApiError({ userId: user.id, leadId: lead.id });
    await seedJobAndApiError({ userId: user.id, leadId: lead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(1);

    const rows = await db
      .select()
      .from(enrichmentJobLeads)
      .where(eq(enrichmentJobLeads.jobId, job.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].leadId).toBe(lead.id);
  });

  it('cria job em running com createdByUserId correto', async () => {
    const user = await createUser({ email: 'retry-owner@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({ userId: user.id, leadId: lead.id });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.status).toBe('running');
    // Carrega a row real pra checar created_by_user_id (não está exposto no PublicEnrichmentJob).
    const [row] = await db
      .select()
      .from(enrichmentJobs)
      .where(eq(enrichmentJobs.id, job.id));
    expect(row.createdByUserId).toBe(user.id);
    expect(row.startedAt).not.toBeNull();
  });

  it('lead com api_error em job cancelled ainda elegível pra retry', async () => {
    const user = await createUser({ email: 'retry-cancelled@x.com', role: 'admin' });
    const lead = await createLead({ phone: null, cnpj: VALID_CNPJ_A });
    await seedJobAndApiError({
      userId: user.id, leadId: lead.id, jobStatus: 'cancelled',
    });

    const job = await startRetryApiErrorJob(user.id);
    expect(job.totalLeads).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar pra confirmar 6 falhas (função não existe)**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- retry-api-error 2>&1 | tail -30
```

Se embedded-postgres reclamar de diretório suja, limpar e retry:

```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

Esperado: 6 falhas com "startRetryApiErrorJob is not a function" ou import error.

- [ ] **Step 4: Commit dos testes vermelhos**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/tests/retry-api-error.test.ts
git commit -m "test: add failing tests for startRetryApiErrorJob"
```

---

## Task 2: Implementar `startRetryApiErrorJob`

**Files:**
- Modify: `server/services/enrichmentJobs.ts` (adicionar após `appendLeadsToActiveJob`)

- [ ] **Step 1: Adicionar a função**

Localizar `appendLeadsToActiveJob` em `server/services/enrichmentJobs.ts` (foi adicionada em commit `5aafd55`, fica logo após `startBulkEnrichment`). Adicionar a nova função imediatamente após o fechamento de `appendLeadsToActiveJob`:

```ts
// ---------------------------------------------------------------------------
// startRetryApiErrorJob — cria job que processa SÓ leads com result_status='api_error'.
// Útil pra retentar falhas transientes da BrasilAPI sem reprocessar todos os
// incompletes. Filtros: flow_stage='incomplete', cnpj IS NOT NULL e length(cnpj)=14,
// e pelo menos UMA row em enrichment_job_leads com result_status='api_error'.
// DISTINCT garante 1 entrada por lead mesmo com múltiplas tentativas antigas.
// ---------------------------------------------------------------------------

export async function startRetryApiErrorJob(userId: string): Promise<PublicEnrichmentJob> {
  const active = await loadActiveRow();
  if (active) {
    throw new HttpError(409, 'Já existe um job de enriquecimento em andamento');
  }

  const candidates = await db
    .selectDistinct({ id: leads.id })
    .from(leads)
    .innerJoin(enrichmentJobLeads, eq(enrichmentJobLeads.leadId, leads.id))
    .where(and(
      eq(leads.flowStage, 'incomplete'),
      sql`${leads.cnpj} IS NOT NULL`,
      sql`length(${leads.cnpj}) = 14`,
      eq(enrichmentJobLeads.resultStatus, 'api_error'),
    ));

  if (candidates.length === 0) {
    throw new HttpError(400, 'Nenhum lead com erro BrasilAPI pra retentar');
  }

  const now = new Date();
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      status: 'running',
      totalLeads: candidates.length,
      startedAt: now,
      createdByUserId: userId,
    })
    .returning();

  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    await db.insert(enrichmentJobLeads).values(
      slice.map((c) => ({ jobId: job.id, leadId: c.id })),
    );
  }

  return buildPublic(job);
}
```

Notas:
- Reusa `loadActiveRow`, `buildPublic`, e os imports já existentes (`db`, `leads`, `enrichmentJobs`, `enrichmentJobLeads`, `and`, `eq`, `sql`, `HttpError`).
- `selectDistinct` é o Drizzle equivalente a `SELECT DISTINCT`. Funciona com `innerJoin`.
- Chunk de 500 igual ao `startBulkEnrichment` — Postgres aceita ~32k parâmetros por insert.
- `status='running'` e `startedAt=now` igual ao startBulkEnrichment — não tem `paused` aqui, retry é imediato.

- [ ] **Step 2: Rodar testes**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- retry-api-error 2>&1 | tail -15
```

Esperado: 6/6 passam.

- [ ] **Step 3: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

Esperado: passa.

- [ ] **Step 4: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/services/enrichmentJobs.ts
git commit -m "feat: add startRetryApiErrorJob service"
```

---

## Task 3: Handler + rota `POST /enrich-bulk/retry-failed`

**Files:**
- Modify: `server/controllers/leadsController.ts`
- Modify: `server/routes/leads.ts`

- [ ] **Step 1: Adicionar handler**

Em `server/controllers/leadsController.ts`, primeiro adicionar `startRetryApiErrorJob` ao import do enrichmentJobs (linhas 7–13 atualmente). Substituir o bloco de import por:

```ts
import {
  startBulkEnrichment,
  startRetryApiErrorJob,
  getCurrentJob,
  cancelCurrentJob,
  pauseCurrentJob,
  resumeCurrentJob,
} from '../services/enrichmentJobs';
```

Depois adicionar o handler logo após `bulkEnrichStartHandler` (linhas 162–167 atualmente):

```ts
export async function bulkEnrichRetryFailedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await startRetryApiErrorJob(req.user!.userId);
    res.json(job);
  } catch (e) { next(e); }
}
```

- [ ] **Step 2: Registrar rota**

Em `server/routes/leads.ts`, adicionar `bulkEnrichRetryFailedHandler` aos imports do controller (linhas 3–19). Atualizar o bloco de imports inserindo a linha nova:

```ts
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  importHandler,
  enrichHandler,
  bulkEnrichStartHandler,
  bulkEnrichRetryFailedHandler,
  bulkEnrichGetHandler,
  bulkEnrichCancelHandler,
  bulkEnrichPauseHandler,
  bulkEnrichResumeHandler,
  transitionsHandler,
  markLostHandler,
  getByIdHandler,
  closeNoDealHandler,
} from '../controllers/leadsController';
```

Adicionar a rota no bloco "Bulk enrichment routes" (linhas 27–32). A ordem entre elas não importa (nenhuma é prefixo de outra), mas pra coesão coloca logo após o `POST /enrich-bulk`:

```ts
// Bulk enrichment routes — vêm ANTES de /:id pra não conflitar.
router.get('/enrich-bulk', authGuard, requireRole('admin'), bulkEnrichGetHandler);
router.post('/enrich-bulk', authGuard, requireRole('admin'), bulkEnrichStartHandler);
router.post('/enrich-bulk/retry-failed', authGuard, requireRole('admin'), bulkEnrichRetryFailedHandler);
router.post('/enrich-bulk/cancel', authGuard, requireRole('admin'), bulkEnrichCancelHandler);
router.post('/enrich-bulk/pause', authGuard, requireRole('admin'), bulkEnrichPauseHandler);
router.post('/enrich-bulk/resume', authGuard, requireRole('admin'), bulkEnrichResumeHandler);
```

- [ ] **Step 3: Adicionar smoke tests na API existente**

Em `server/tests/leads-api.test.ts`, encontrar uma região existente de testes de bulk enrichment (procurar por `/enrich-bulk` ou `bulkEnrichStartHandler`). Se não existir um describe específico, criar um novo no fim do arquivo. Adicionar:

```ts
import { db } from '../db/client';
import { enrichmentJobs, enrichmentJobLeads, leads } from '../db/schema';

describe('POST /api/leads/enrich-bulk/retry-failed', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/leads/enrich-bulk/retry-failed');
    expect(res.status).toBe(401);
  });

  it('403 com role recepcao', async () => {
    await createUser({ email: 'retry-rec@x.com', password: 'pw123456', role: 'recepcao' });
    const token = await loginAs('retry-rec@x.com');
    const res = await request(app)
      .post('/api/leads/enrich-bulk/retry-failed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('200 quando há candidatos api_error', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: null, cnpj: '11222333000181' });
    // Cria job antigo + uma row api_error pro lead.
    const admin = await createUser({ email: 'retry-admin@x.com', role: 'admin' });
    const [oldJob] = await db.insert(enrichmentJobs).values({
      status: 'completed',
      totalLeads: 1,
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
      startedAt: new Date(),
      completedAt: new Date(),
      createdByUserId: admin.id,
    }).returning();
    await db.insert(enrichmentJobLeads).values({
      jobId: oldJob.id,
      leadId: lead.id,
      status: 'failed',
      resultStatus: 'api_error',
      processedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/leads/enrich-bulk/retry-failed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalLeads).toBe(1);
    expect(res.body.status).toBe('running');
  });

  it('400 quando zero candidatos', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/enrich-bulk/retry-failed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
```

Adapte os imports do topo do arquivo se `request`, `app`, `createUser`, `loginAs`, `seedAuth`, `createLead` ainda não estão importados. Olhe o que outros describes do arquivo já usam.

- [ ] **Step 4: Rodar os testes**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- retry-api-error leads-api 2>&1 | tail -15
```

Esperado: testes do service (6) + smoke da rota (4) — todos verdes.

- [ ] **Step 5: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add server/controllers/leadsController.ts server/routes/leads.ts server/tests/leads-api.test.ts
git commit -m "feat: add POST /enrich-bulk/retry-failed route"
```

---

## Task 4: Hook `useRetryFailedBulkEnrichment`

**Files:**
- Modify: `src/features/leads/api.ts`

- [ ] **Step 1: Adicionar o hook**

Em `src/features/leads/api.ts`, após `useStartBulkEnrichment` (linhas 154–163), adicionar:

```ts
export function useRetryFailedBulkEnrichment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PublicEnrichmentJob>('/leads/enrich-bulk/retry-failed', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BULK_KEY });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
```

Mesmo padrão de `useStartBulkEnrichment` — invalida BULK_KEY (pra refletir o novo job ativo) e `['leads']` (porque a tabela de leads mostra badges baseados em enrichment status).

- [ ] **Step 2: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add src/features/leads/api.ts
git commit -m "feat: add useRetryFailedBulkEnrichment hook"
```

---

## Task 5: Botão "Retentar BrasilAPI falhou" no dialog

**Files:**
- Modify: `src/features/leads/BulkEnrichmentDialog.tsx`

- [ ] **Step 1: Atualizar o import dos hooks**

Substituir o bloco de imports (linhas 23–29):

```tsx
import {
  useBulkEnrichmentJob,
  useStartBulkEnrichment,
  useRetryFailedBulkEnrichment,
  useCancelBulkEnrichment,
  usePauseBulkEnrichment,
  useResumeBulkEnrichment,
} from './api';
```

- [ ] **Step 2: Instanciar o hook e adicionar handler**

Logo após `const start = useStartBulkEnrichment();` (linha 40), adicionar:

```tsx
const retry = useRetryFailedBulkEnrichment();
```

Logo após a função `onStart` (linhas 64–71), adicionar:

```tsx
async function onRetryFailed() {
  try {
    const job = await retry.mutateAsync();
    toast.success(`Retentando ${job.totalLeads} lead${job.totalLeads === 1 ? '' : 's'} com erro BrasilAPI.`);
  } catch (e) {
    // Mensagens do backend:
    //  400 → "Nenhum lead com erro BrasilAPI pra retentar"
    //  409 → "Já existe um job de enriquecimento em andamento"
    toast.error(e instanceof Error ? e.message : 'Erro ao retentar');
  }
}
```

- [ ] **Step 3: Adicionar o botão no footer**

Localizar o bloco `{!isActive && ( <Button onClick={onStart} ...>...</Button> )}` (linhas 207–211). Substituir pelo bloco abaixo, que coloca os 2 botões lado a lado quando não há job ativo:

```tsx
{!isActive && (
  <>
    <Button onClick={onStart} disabled={start.isPending || retry.isPending}>
      {start.isPending ? 'Iniciando…' : 'Iniciar enriquecimento'}
    </Button>
    <Button
      variant="outline"
      onClick={onRetryFailed}
      disabled={retry.isPending || start.isPending}
    >
      {retry.isPending ? 'Retentando…' : 'Retentar BrasilAPI falhou'}
    </Button>
  </>
)}
```

Notas:
- O botão "Iniciar enriquecimento" continua sendo o primary; o "Retentar" é `outline` (secundário visualmente).
- Ambos desabilitam quando QUALQUER mutation estiver em flight (evita disparar os 2 simultaneamente).
- Quando há job ativo (`isActive=true`), nenhum dos 2 aparece — o footer mostra pause/cancel/resume.

- [ ] **Step 4: Typecheck**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

- [ ] **Step 5: Smoke visual manual (opcional)**

Rodar `npm run dev` em outro terminal. Em `/cadastros`, abrir o BulkEnrichmentDialog:

1. **Sem nenhum job ativo + sem api_error pendente**: 2 botões aparecem ("Iniciar enriquecimento" + "Retentar BrasilAPI falhou"). Clicar Retentar → toast "Nenhum lead com erro BrasilAPI pra retentar".
2. **Sem job ativo + COM api_error pendente** (forçar via SQL ou import + falha): Retentar → toast "Retentando N leads com erro BrasilAPI."; job aparece em running.
3. **Com job ativo**: nenhum dos 2 botões aparece, só pause/cancel.

- [ ] **Step 6: Commit**

```bash
cd C:/Saas_lubritec/lubritec-main && git add src/features/leads/BulkEnrichmentDialog.tsx
git commit -m "feat: retry BrasilAPI errors button in enrichment dialog"
```

---

## Task 6: Verificação final

- [ ] **Step 1: Rodar a suíte focada**

```bash
cd C:/Saas_lubritec/lubritec-main && npm test -- retry-api-error leads-api enrichment-append leads-import-auto-enrichment 2>&1 | tail -20
```

Se embedded-postgres reclamar de diretório suja, limpar primeiro:

```bash
rm -rf "C:/Users/User/AppData/Local/Temp/lubritec-embedded-pg"
```

Esperado: tudo verde.

- [ ] **Step 2: Typecheck completo**

```bash
cd C:/Saas_lubritec/lubritec-main && npm run lint 2>&1 | tail -5
```

Esperado: clean.

- [ ] **Step 3: Conferir git log**

```bash
cd C:/Saas_lubritec/lubritec-main && git log --oneline -7
```

Esperado: ver os 5 commits da feature (Task 1 → Task 5) em ordem cronológica.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| Comportamento "click cria job só com api_error" | Task 2 (`startRetryApiErrorJob`) + testes Task 1 |
| 409 se job ativo | Task 2 + teste Task 1 (caso #1) |
| 400 se zero candidatos | Task 2 + teste Task 1 (caso #2) |
| Filtra `flow_stage='incomplete'` + `length(cnpj)=14` + `api_error` | Task 2 (query JOIN) + teste Task 1 (caso #3) |
| DISTINCT garante 1 entrada por lead | Task 2 (`selectDistinct`) + teste Task 1 (caso #4) |
| Job em `running` com `createdByUserId` correto | Task 2 + teste Task 1 (caso #5) |
| api_error de job cancelled ainda elegível | Teste Task 1 (caso #6) |
| Endpoint POST `/leads/enrich-bulk/retry-failed`, guard admin | Task 3 (controller + rota) + testes Task 3 (auth) |
| Hook `useRetryFailedBulkEnrichment` invalida BULK_KEY e leads | Task 4 |
| Botão `outline` ao lado de Iniciar, só quando `!isActive` | Task 5 |
| Mensagens de toast (sucesso com N, erro 400, erro 409) | Task 5 (`onRetryFailed`) |

**Placeholder scan:** nenhum TBD/TODO/"adicionar tratamento de erro" vago. Cada step tem código completo ou comando exato.

**Type consistency:**
- `startRetryApiErrorJob(userId: string): Promise<PublicEnrichmentJob>` — mesma assinatura usada em service (Task 2), controller (Task 3), hook (Task 4).
- `BULK_KEY` reusado no novo hook (mesmo valor já existente no `api.ts`).
- `bulkEnrichRetryFailedHandler` referenciado em controller (Task 3) e import da rota (Task 3) com mesmo nome.
- Endpoint `/leads/enrich-bulk/retry-failed` (no API client) ⇄ `/enrich-bulk/retry-failed` (na rota Express, prefixo `/leads` é montado em outro lugar) — consistente com os outros endpoints do mesmo dialog.
