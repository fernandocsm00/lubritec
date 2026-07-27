# Campanha — Audiência por CNPJ (import + dedup + enriquecimento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Trocar o CSV de telefones da Etapa 3 da campanha por um import de Cadastros por CNPJ (upsert), com detecção de duplicados (no arquivo + campanha anterior, ação genérica manter/excluir) e enriquecimento BrasilAPI que preenche o Telefone 2 em background.

**Architecture:** Reusa `parseLeadsCsv`/`importLeadsFromCsv` num novo endpoint de import; a audiência passa a ser `importedLeadIds` (em `AudienceFilters`); estende o job de enriquecimento singleton com `target` (`phone`|`phone2`) e escopo por leadIds; frontend reescreve o bloco CSV da `AudienceStep`.

**Tech Stack:** Express + Drizzle + Postgres (schema `lubritec`), React 19 + TS + Vite + TanStack Query, vitest (embedded-postgres), multer, csv-parse/ExcelJS.

**Spec:** `docs/superpowers/specs/2026-07-27-campaign-cnpj-audience-import-design.md`

Rodar type-check com `npm run lint`; testes com `npx vitest run <arquivo>`.

---

### Task 1: Tipos compartilhados

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1:** Adicionar em `AudienceFilters` o campo `importedLeadIds?: string[];` (audiência por leads importados; quando presente, ignora status/source/daysSinceCreated/phoneCsv).

- [ ] **Step 2:** Adicionar o tipo do enriquecimento:
```ts
export const ENRICHMENT_TARGETS = ['phone', 'phone2'] as const;
export type EnrichmentTarget = (typeof ENRICHMENT_TARGETS)[number];
```

- [ ] **Step 3:** Adicionar `recentlyFound` em `PublicEnrichmentJob`:
```ts
// leads que acabaram de ganhar telefone neste job (mais recentes primeiro)
recentlyFound?: Array<{ leadId: string; name: string; cnpj: string | null; phone: string | null; phone2: string | null }>;
```

- [ ] **Step 4:** Adicionar o resultado do import de audiência:
```ts
export interface CampaignAudienceImportResult {
  report: ImportReport;
  importedLeadIds: string[];
  duplicatesInFileCount: number;
  previouslyParticipated: Array<{
    leadId: string; cnpj: string | null; name: string;
    lastCampaign: { id: string; name: string; participatedAt: string } | null;
  }>;
}
```

- [ ] **Step 5:** `npm run lint` (type-check) — deve passar. Commit: `feat(types): tipos de audiência por CNPJ + enrichment target/recentlyFound`.

---

### Task 2: Migration — coluna `target` no job de enriquecimento

**Files:**
- Create: `server/db/migrations/038_enrichment_target.sql`
- Modify: `server/db/schema.ts` (tabela `enrichmentJobs`)

- [ ] **Step 1:** Migration:
```sql
-- Migration 038: alvo do enriquecimento (telefone 1 x telefone 2).
-- Jobs de Cadastros preenchem phone (Tel 1); jobs de audiência de campanha
-- preenchem phone2 (Tel 2). Default 'phone' preserva jobs existentes.
ALTER TABLE enrichment_jobs
  ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'phone';
```

- [ ] **Step 2:** No schema, adicionar em `enrichmentJobs`: `target: text('target', { enum: ENRICHMENT_TARGETS }).notNull().default('phone'),` (importar `ENRICHMENT_TARGETS` de `../../shared/types`).

- [ ] **Step 3:** `npm run lint`. Commit: `feat(db): migration 038 target no enrichment_jobs`.

---

### Task 3: Backend — `importLeadsFromCsv` retorna os leadIds importados

**Files:**
- Modify: `server/services/leadsImport.ts` (função `importLeadsFromCsv`, `ImportReport` continua igual — os ids vão num retorno interno)
- Test: `server/tests/leads-import-ids.test.ts`

Contexto: hoje `importLeadsFromCsv` retorna `ImportReport` (sem ids). O import de audiência precisa dos leadIds (novos + existentes) casados por CNPJ. Em vez de mudar o `ImportReport` público, adicionar uma função `importLeadsFromCsvWithIds(buf, opts)` que roda o mesmo fluxo e retorna `{ report, leadIds }`.

- [ ] **Step 1 (teste):** Em `leads-import-ids.test.ts`, importar um CSV com 2 CNPJs novos + 1 existente; esperar `leadIds.length === 3` e que todos existem em `leads` com os CNPJs do arquivo.
```ts
import { importLeadsFromCsvWithIds } from '../services/leadsImport';
// monta CSV "nome,cnpj,telefone" com VALID_CNPJ_1..3; pré-cria 1 lead com VALID_CNPJ_3
// espera: report.inserted === 2, report.updated === 1, leadIds cobre os 3 CNPJs
```

- [ ] **Step 2:** Rodar o teste — falha (função não existe).

- [ ] **Step 3 (impl):** Refatorar `importLeadsFromCsv` para delegar a `importLeadsFromCsvWithIds` (que coleta os `leadId` no loop de insert/upsert — hoje o insert já usa `.returning({ id })`, e o upsert tem `existing.id`). `importLeadsFromCsv` retorna só `result.report`. Coletar num `Set`/array `leadIds` conforme cada linha resolve pra um lead (novo ou existente).

- [ ] **Step 4:** Rodar o teste — passa. `npm run lint`.

- [ ] **Step 5:** Commit: `feat(leads): importLeadsFromCsvWithIds expõe os leadIds importados`.

---

### Task 4: Backend — participação anterior em campanhas

**Files:**
- Create: `server/services/campaignAudienceImport.ts` (novo módulo do import de audiência)
- Test: `server/tests/campaign-previous-participation.test.ts`

- [ ] **Step 1 (teste):** `findPreviousParticipation(leadIds)` → dado um lead que já é recipient de uma campanha "Campanha A" (createdAt anterior) e outro que nunca participou, retorna só o primeiro, com `lastCampaign.name === 'Campanha A'`.

- [ ] **Step 2:** Rodar — falha.

- [ ] **Step 3 (impl):** Em `campaignAudienceImport.ts`:
```ts
export async function findPreviousParticipation(leadIds: string[]): Promise<CampaignAudienceImportResult['previouslyParticipated']> {
  if (!leadIds.length) return [];
  // Para cada lead: a campanha mais recente em que foi recipient
  // (DISTINCT ON (cr.lead_id) ... ORDER BY cr.lead_id, COALESCE(cr.sent_at, cr.created_at) DESC).
  // Join leads (cnpj, name) e campaigns (id, name).
  // Retorna [{ leadId, cnpj, name, lastCampaign: { id, name, participatedAt } }]
}
```
Usar SQL raw via `db.execute(sql`...`)` com `inArray`/`ANY($1)` nos leadIds; participatedAt = ISO de `COALESCE(sent_at, created_at)`.

- [ ] **Step 4:** Rodar — passa. `npm run lint`. Commit: `feat(campaigns): findPreviousParticipation por leadIds`.

---

### Task 5: Backend — service + endpoint de import de audiência

**Files:**
- Modify: `server/services/campaignAudienceImport.ts` (add `importCampaignAudience`)
- Modify: `server/controllers/campaignsController.ts` (handler)
- Modify: `server/routes/campaigns.ts` (rota multipart)
- Test: `server/tests/campaign-audience-import.test.ts`

- [ ] **Step 1 (teste):** POST `/api/campaigns/audience/import` (multipart) com CSV nome,cnpj,telefone → 200, body tem `importedLeadIds` (2), `report.inserted===2`, `previouslyParticipated`. CSV sem coluna cnpj → `report`/erro de missing header (reaproveita comportamento do parser → 400). Linha sem cnpj → rejeitada no `report.rejected`.

- [ ] **Step 2:** Rodar — falha.

- [ ] **Step 3 (impl service):**
```ts
export async function importCampaignAudience(buf: Buffer, userId: string): Promise<CampaignAudienceImportResult> {
  const { report, leadIds } = await importLeadsFromCsvWithIds(buf, { userId });
  const previouslyParticipated = await findPreviousParticipation(leadIds);
  // duplicatesInFileCount: linhas rejeitadas com motivo "duplicado no arquivo"
  const duplicatesInFileCount = report.rejected.filter(r => /duplicad/i.test(r.reason)).length;
  return { report, importedLeadIds: leadIds, duplicatesInFileCount, previouslyParticipated };
}
```

- [ ] **Step 4 (impl controller/route):** Handler reusa o multer `multerCsv` (igual ao `/leads/import`); admin+comercial (checar RBAC atual das rotas de campanha). Rota: `router.post('/audience/import', ...guard, multerCsv.single('file'), importAudienceHandler)`. Handler chama `importCampaignAudience(req.file.buffer, req.user.userId)`; erro de missing header → 400 (o service/parser lança HttpError).

- [ ] **Step 5:** Rodar — passa. `npm run lint`. Commit: `feat(campaigns): endpoint POST /campaigns/audience/import`.

---

### Task 6: Backend — enriquecimento com target=phone2 e escopo por leadIds

**Files:**
- Modify: `server/services/enrichmentJobs.ts` (criação de job com target + escopo; `buildPublic` com recentlyFound)
- Modify: `server/services/leadsEnrichment.ts` OU `enrichmentJobs.processNextEnrichment` (gravar em phone/phone2 conforme target)
- Test: `server/tests/enrichment-phone2.test.ts`

- [ ] **Step 1 (teste):** Criar job escopado (`startScopedEnrichment(leadIds, 'phone2', userId)`) sobre 1 lead que TEM phone1 e CNPJ válido; mockar `lookupCnpj` p/ retornar telefone; rodar `processNextEnrichment` até drenar; esperar que o lead ganhou `phone2` (e `phone` inalterado). Segundo teste: job `phone2` não sobrescreve `phone2` já preenchido. Terceiro: 409 se já houver job ativo.

- [ ] **Step 2:** Rodar — falha.

- [ ] **Step 3 (impl):**
  - `startScopedEnrichment(leadIds, target, userId)`: valida singleton (mesmo 409 do `startBulkEnrichment`); filtra leadIds com CNPJ 14 dígitos; cria `enrichment_jobs` com `target`; insere `enrichment_job_leads` só desses leads (não usa o snapshot global). Reaproveita o worker.
  - No worker (`processNextEnrichment`): ao encontrar telefone, se `job.target === 'phone2'` → `updateLead({ id, phone2 })` só se `phone2` vazio e o número ≠ phone1; senão marca `phone_not_in_brasilapi`/skip. Se `target==='phone'`, comportamento atual.
  - `updateLead` já aceita `phone2` (ver `leadsService.updateLead`).

- [ ] **Step 4:** Rodar — passa. `npm run lint`. Commit: `feat(enrichment): job escopado com target=phone2`.

---

### Task 7: Backend — `recentlyFound` no status + endpoint de start da campanha

**Files:**
- Modify: `server/services/enrichmentJobs.ts` (`buildPublic`/`getCurrentJob` inclui recentlyFound)
- Modify: `server/controllers/campaignsController.ts` + `server/routes/campaigns.ts` (POST /audience/enrich)
- Test: `server/tests/enrichment-recently-found.test.ts` + adicionar caso no campaign-audience

- [ ] **Step 1 (teste):** Após enriquecer 1 lead (phone_found), `getCurrentJob()` retorna `recentlyFound` com esse lead (name/cnpj/phone2). Endpoint `POST /api/campaigns/audience/enrich {leadIds}` → 200 e cria job target=phone2; 409 se singleton ocupado.

- [ ] **Step 2:** Rodar — falha.

- [ ] **Step 3 (impl):** `buildPublic` faz um join extra: últimos ~20 `enrichment_job_leads` do job com `resultStatus='phone_found'` ( order desc por updatedAt) join `leads` → `recentlyFound`. Handler `enrichAudienceHandler` chama `startScopedEnrichment(body.leadIds, 'phone2', userId)`. Rota `router.post('/audience/enrich', ...guard, enrichAudienceHandler)`.

- [ ] **Step 4:** Rodar — passa. `npm run lint`. Commit: `feat(campaigns): POST /campaigns/audience/enrich + recentlyFound`.

---

### Task 8: Backend — audiência por `importedLeadIds`

**Files:**
- Modify: `server/services/campaignsAudience.ts` (`dryRun`, `resolveAudience`; `buildWhere`)
- Modify: `server/services/campaignsService.ts` (`createCampaign` — pular `materializeCsvLeads` quando há importedLeadIds)
- Test: `server/tests/campaign-audience-imported-ids.test.ts`

- [ ] **Step 1 (teste):** `dryRun({ importedLeadIds:[a,b], excludeLeadIds:[b] })` → total conta só o `a` (com phone), respeita exclude; `resolveAudience` idem. Lead sem phone1 não entra.

- [ ] **Step 2:** Rodar — falha.

- [ ] **Step 3 (impl):** Em `buildWhere`/seleção: quando `importedLeadIds?.length`, condição = `inArray(leads.id, importedLeadIds)` + `isNotNull(leads.phone)` + `notInArray(leads.id, realLeadIds(excludeLeadIds))`, ignorando status/source/daysSinceCreated/phoneCsv. `resolveAudience` retorna esses `{leadId, phone}`. Em `createCampaign`, quando há `importedLeadIds`, **não** chamar `materializeCsvLeads` (leads já existem).

- [ ] **Step 4:** Rodar — passa. `npm run lint`. Commit: `feat(campaigns): audiência por importedLeadIds`.

---

### Task 9: Frontend — api (import, enrich, status)

**Files:**
- Modify: `src/features/campaigns/api.ts` (useImportAudience, useEnrichAudience)
- Modify: `src/features/leads/api.ts` (o hook de status já existe: `useBulkEnrichmentJob` — reusar; expõe recentlyFound via PublicEnrichmentJob)

- [ ] **Step 1:** `useImportAudience(): mutation(file → CampaignAudienceImportResult)` → `POST /campaigns/audience/import` (FormData). `useEnrichAudience(): mutation(leadIds → PublicEnrichmentJob)` → `POST /campaigns/audience/enrich`.

- [ ] **Step 2:** `npm run lint`. Commit: `feat(campaigns): api de import/enrich de audiência`.

---

### Task 10: Frontend — reescrita do bloco CSV na AudienceStep

**Files:**
- Modify: `src/features/campaigns/AudienceStep.tsx`
- Create: `src/features/campaigns/AudienceCsvImport.tsx` (uploader + relatório + duplicados + enriquecimento)
- Modify: `src/pages/campaigns/CampaignNewPage.tsx` (estado: importedLeadIds/excludeLeadIds em vez de phoneCsv)

- [ ] **Step 1:** `AudienceCsvImport`: drag/drop (.csv,.xlsx) → `useImportAudience`; renderiza tiles do `report` (Inseridos/Atualizados/Rejeitados) + `duplicatesInFileCount`; se `previouslyParticipated.length`, painel com a lista (CNPJ, nome, última campanha, data) + toggle de ação genérica **Manter todos** (default) / **Excluir todos** → quando "Excluir", `onExcludeChange(previouslyParticipated.map(p=>p.leadId))`, senão `[]`. Botão **Enriquecimento de dados** → `useEnrichAudience(importedLeadIds)`; abaixo, progresso via `useBulkEnrichmentJob({enabled, pollMs:3000})` (barra + `recentlyFound` lista "novo Tel 2: nome → phone2"); desabilitado com aviso se `job?.status==='running'` de outro escopo (409 tratado com toast).

- [ ] **Step 2:** `AudienceStep`: substitui `<CsvUpload>` por `<AudienceCsvImport onImported={setImportedLeadIds} onExcludeChange={setExcludeLeadIds} />`. O `filters` passa a levar `importedLeadIds` + `excludeLeadIds`; o `dryRun`/contador e `AudiencePreviewTable` operam sobre isso. Remover o caminho `phoneCsv` da UI (mantém no tipo).

- [ ] **Step 3:** `CampaignNewPage`: estado `importedLeadIds`, `excludeLeadIds`; `canNext` do passo 3 = `audienceTotal > 0` (dryRun). `submit` monta `audienceFilter = { importedLeadIds, excludeLeadIds }`.

- [ ] **Step 4:** `npm run lint`. Commit: `feat(campaigns): Etapa 3 com import por CNPJ + duplicados + enriquecimento`.

---

### Task 11: Verificação final

- [ ] **Step 1:** `npm run lint` (frontend+backend) limpo.
- [ ] **Step 2:** Rodar a suíte afetada: `npx vitest run server/tests/leads-import-ids.test.ts server/tests/campaign-previous-participation.test.ts server/tests/campaign-audience-import.test.ts server/tests/enrichment-phone2.test.ts server/tests/enrichment-recently-found.test.ts server/tests/campaign-audience-imported-ids.test.ts server/tests/campaigns-crud.test.ts server/tests/campaigns-dispatch.test.ts server/tests/leads-service.test.ts`.
- [ ] **Step 3:** Commit final se houver ajustes; parar pra revisão do usuário antes de merge/deploy.
