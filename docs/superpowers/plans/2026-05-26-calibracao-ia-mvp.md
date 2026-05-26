# Calibração da IA — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a calibração da IA de qualificação observável e ajustável, expondo (1) a ficha individual de cada caso (lead + perguntas + resposta + decisão + outcome), (2) feedback binário do vendedor no momento do desfecho, e (3) fila cega de auditoria com amostragem aleatória de 10% dos não-qualificados pra medir falso negativo.

**Architecture:** Sprint backend-first. Adiciona 1 tabela nova (`audit_sample_assignments`), estende 3 tabelas existentes (`ai_call_logs`, `deals`, `campaigns`), 1 endpoint composto de leitura (`GET /leads/:id/case-sheet`), 1 endpoint de fila cega, e novos campos nos diálogos de Ganho/Perda/Encerrar do Kanban. Frontend reutiliza o componente `CaseSheet` em duas montagens (drawer do lead e aba do deal).

**Tech Stack:** TypeScript, Express, Drizzle ORM, Postgres (Supabase), Vitest, React 19, shadcn/ui, TanStack Query, react-hook-form.

---

## Princípios deste plano

- **TDD obrigatório:** todo backend muda com teste falhando antes do código de produção. Frontend testa via API.
- **Migrations backward-compatible:** usar `ADD COLUMN IF NOT EXISTS` com defaults; nada quebra deploy.
- **Commit por step:** cada step termina em commit. Mensagens em pt-br seguindo padrão do repo (`feat:`, `fix:`, `test:`).
- **Nada de placeholder:** se o step diz "implemente X", o código exato vai junto.
- **Conventional file paths:** sempre absoluto (`C:\Saas_lubritec\lubritec-main\...`) ou relativo à raiz do projeto.

## File Structure

### Arquivos novos

```
server/db/migrations/029_ia_calibration.sql           # schema changes (1 migration agregada)
server/services/auditSampleService.ts                 # lógica de amostragem cega + atribuição
server/services/caseSheetService.ts                   # composição da ficha do caso
server/routes/audit.ts                                # rotas da fila cega
server/routes/caseSheet.ts                            # rota GET /leads/:id/case-sheet
server/controllers/auditController.ts
server/controllers/caseSheetController.ts
server/tests/audit-sample.test.ts
server/tests/case-sheet.test.ts
server/tests/deals-feedback.test.ts
server/tests/ai-audit-persistence.test.ts

src/features/case-sheet/CaseSheet.tsx                 # componente compartilhado
src/features/case-sheet/api.ts
src/features/case-sheet/types.ts
src/features/case-sheet/QualificationPathBadge.tsx
src/features/case-sheet/QuestionsAnswersList.tsx

src/features/campaigns/CampaignUnqualifiedTab.tsx     # lista aberta de não-qualificados
src/features/campaigns/CampaignAuditQueueTab.tsx      # fila cega de auditoria
```

### Arquivos modificados

```
server/db/schema.ts                                   # adicionar tipos drizzle das novas colunas
shared/types.ts                                       # PublicCaseSheet, AuditSample*, lead_quality_feedback
server/services/aiAtendimento.ts                      # persistir audit fields em recordAiCall
server/services/dealsService.ts                       # aceitar leadQualityFeedback em changeStage + novo closeLeadWithoutDeal
server/services/leadsService.ts                       # encerrar lead sem deal
server/controllers/dealsController.ts                 # schema zod do feedback
server/routes/deals.ts                                # endpoint POST /:id/close-no-deal
server/services/campaignsService.ts                   # incluir contadores de não-qualificados no funnel
server/app.ts                                         # registrar novas rotas

src/features/inside-sales/GanhoValueDialog.tsx        # adicionar toggle feedback (obrigatório)
src/features/inside-sales/LossReasonDialog.tsx        # adicionar toggle feedback (obrigatório)
src/features/inside-sales/KanbanBoard.tsx             # passar feedback no callback de stage change
src/features/inside-sales/api.ts                      # changeStage com feedback param
src/features/leads/LeadActions.tsx                    # botão "Encerrar sem deal"
src/features/leads/CloseNoDealDialog.tsx              # NOVO — diálogo de encerramento
src/features/leads/LeadDialog.tsx                     # tab "Ficha do Caso"
src/features/inside-sales/DealDrawer.tsx              # tab "Ficha do Caso"
src/features/campaigns/CampaignFunnel.tsx             # tabs Não Qualificados + Fila Cega
```

---

# Parte A — Schema & Tipos (Foundation)

Migração única que adiciona tudo de uma vez. Não roda código novo ainda.

### Task A1: Migration SQL com todas as colunas/tabelas novas

**Files:**
- Create: `server/db/migrations/029_ia_calibration.sql`

- [ ] **Step 1: Escrever migration completa**

Criar arquivo `server/db/migrations/029_ia_calibration.sql`:

```sql
-- 029_ia_calibration.sql — MVP de calibração da IA
-- Adiciona dados de auditoria em ai_call_logs, feedback de qualidade em deals,
-- pergunta de qualificação em campaigns, e tabela de amostragem cega.

BEGIN;

-- ── ai_call_logs: dados de auditoria ────────────────────────────────────
-- decision_reason: trecho/justificativa que a IA deu pra decisão (preenchido
-- a partir do RESUMO ou de campo dedicado no prompt).
-- qualification_path: 'campaign_direct' (qualificada já no 1º turno via
-- pergunta da campanha) | 'conversation' (após N turnos) | null (pré-existente).
-- questions_answers: pares pergunta→resposta que foram considerados.
-- prompt_version: hash/identificador da versão do system prompt no momento.

ALTER TABLE ai_call_logs
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS qualification_path text,
  ADD COLUMN IF NOT EXISTS questions_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_lead_qualified
  ON ai_call_logs(lead_id, qualified);
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_campaign
  ON ai_call_logs(campaign_id) WHERE campaign_id IS NOT NULL;

-- ── campaigns: pergunta de qualificação ─────────────────────────────────
-- Texto da pergunta que a campanha faz no template/HSM. Quando o lead responde
-- afirmativamente a essa pergunta no 1º turno, a IA pode qualificar direto.
-- Optional: se NULL, fluxo segue conversacional puro.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS qualification_question text;

-- ── deals: feedback binário de qualidade do lead ────────────────────────
-- lead_quality_feedback: 'good' | 'bad' | null (não dado ainda)
-- lead_quality_feedback_at: quando foi dado
-- lead_quality_feedback_by: quem deu (usually owner do deal)

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lead_quality_feedback text,
  ADD COLUMN IF NOT EXISTS lead_quality_feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_quality_feedback_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE deals
  ADD CONSTRAINT deals_lead_quality_feedback_chk
  CHECK (lead_quality_feedback IS NULL OR lead_quality_feedback IN ('good', 'bad'));

CREATE INDEX IF NOT EXISTS idx_deals_lead_quality_feedback
  ON deals(lead_quality_feedback) WHERE lead_quality_feedback IS NOT NULL;

-- ── leads: encerramento explícito sem deal ──────────────────────────────
-- Quando vendedor pega um lead na fila comercial e conclui que não vai
-- virar deal, marca encerrado. Adicionamos campos análogos ao deal pra
-- capturar o feedback de calibração.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS closed_no_deal_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_no_deal_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_no_deal_reason text,
  ADD COLUMN IF NOT EXISTS closed_no_deal_quality text;

ALTER TABLE leads
  ADD CONSTRAINT leads_closed_no_deal_quality_chk
  CHECK (closed_no_deal_quality IS NULL OR closed_no_deal_quality IN ('good', 'bad'));

-- ── audit_sample_assignments: fila cega de auditoria ────────────────────
-- Cada linha = um lead rejeitado pela IA que foi amostrado pra revisão cega.
-- status: 'pending' | 'assigned' | 'contacted' | 'skipped'
-- outcome: 'good' | 'bad' | null (preenchido ao contactar)
-- IMPORTANTE: outcome='good' aqui significa FALSO NEGATIVO da IA.

CREATE TABLE IF NOT EXISTS audit_sample_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  ai_call_log_id uuid REFERENCES ai_call_logs(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  contacted_at timestamptz,
  outcome text,
  outcome_at timestamptz,
  outcome_notes text,
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT audit_sample_outcome_chk
    CHECK (outcome IS NULL OR outcome IN ('good', 'bad')),
  CONSTRAINT audit_sample_status_chk
    CHECK (status IN ('pending', 'assigned', 'contacted', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_audit_sample_status_campaign
  ON audit_sample_assignments(status, campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_sample_assigned_to
  ON audit_sample_assignments(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_sample_lead_unique
  ON audit_sample_assignments(lead_id);

COMMIT;
```

- [ ] **Step 2: Rodar migration localmente**

Run: `npm run migrate`
Expected: stdout deve incluir `applied 029_ia_calibration.sql` (ou equivalente, conferir formato do script `migrate.ts`).

- [ ] **Step 3: Verificar no banco**

Run no psql ou via cli do Supabase:
```sql
\d ai_call_logs
\d deals
\d campaigns
\d leads
\d audit_sample_assignments
```
Expected: todas as colunas/tabelas presentes.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/029_ia_calibration.sql
git commit -m "feat(db): migration 029 — schema de calibração da IA (audit fields, feedback binário, amostragem cega)"
```

### Task A2: Atualizar Drizzle schema

**Files:**
- Modify: `server/db/schema.ts` (linhas 81-93 leads, 146-157 deals, 241-272 campaigns, 354-370 aiCallLogs)

- [ ] **Step 1: Adicionar novas colunas em `leads`**

Em `server/db/schema.ts`, dentro de `export const leads = pgTable('leads', {...})`, ANTES do bloco `createdAt`, adicionar:

```typescript
  closedNoDealAt: timestamp('closed_no_deal_at', { withTimezone: true }),
  closedNoDealBy: uuid('closed_no_deal_by').references(() => users.id, { onDelete: 'set null' }),
  closedNoDealReason: text('closed_no_deal_reason'),
  closedNoDealQuality: text('closed_no_deal_quality', { enum: ['good', 'bad'] }),
```

- [ ] **Step 2: Adicionar novas colunas em `deals`**

Em `export const deals = pgTable('deals', {...})`, ANTES de `createdAt`, adicionar:

```typescript
  leadQualityFeedback: text('lead_quality_feedback', { enum: ['good', 'bad'] }),
  leadQualityFeedbackAt: timestamp('lead_quality_feedback_at', { withTimezone: true }),
  leadQualityFeedbackBy: uuid('lead_quality_feedback_by').references(() => users.id, { onDelete: 'set null' }),
```

- [ ] **Step 3: Adicionar coluna em `campaigns`**

Em `export const campaigns = pgTable('campaigns', {...})`, ANTES de `createdByUserId`, adicionar:

```typescript
  qualificationQuestion: text('qualification_question'),
```

- [ ] **Step 4: Adicionar colunas em `aiCallLogs`**

Em `export const aiCallLogs = pgTable('ai_call_logs', {...})`, ANTES de `createdAt`, adicionar:

```typescript
  decisionReason: text('decision_reason'),
  qualificationPath: text('qualification_path', { enum: ['campaign_direct', 'conversation'] }),
  questionsAnswers: jsonb('questions_answers').notNull().default([]),
  promptVersion: text('prompt_version'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
```

- [ ] **Step 5: Adicionar tabela `auditSampleAssignments` no final do arquivo (antes do bloco de `export type`s)**

```typescript
// ── Audit sample assignments (Sprint Calibração IA) ──────────────
// Amostragem cega: 10% dos leads marcados "não qualificados" pela IA
// entram aqui pra contato controlado e medição de falso negativo.
export const auditSampleAssignments = pgTable('audit_sample_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
  aiCallLogId: uuid('ai_call_log_id').references(() => aiCallLogs.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  outcome: text('outcome', { enum: ['good', 'bad'] }),
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  outcomeNotes: text('outcome_notes'),
  status: text('status', { enum: ['pending', 'assigned', 'contacted', 'skipped'] }).notNull().default('pending'),
}, (t) => ({
  statusCampaignIdx: index('idx_audit_sample_status_campaign').on(t.status, t.campaignId),
  assignedToIdx: index('idx_audit_sample_assigned_to').on(t.assignedTo),
}));

export type AuditSampleAssignment = typeof auditSampleAssignments.$inferSelect;
export type NewAuditSampleAssignment = typeof auditSampleAssignments.$inferInsert;
```

- [ ] **Step 6: Verificar typecheck**

Run: `npm run lint`
Expected: sem erros de TS.

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): tipos drizzle para schema 029 (calibração IA)"
```

### Task A3: Atualizar shared/types.ts

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Adicionar tipos de feedback e ficha do caso**

Adicionar no final de `shared/types.ts` (antes da última linha):

```typescript
// ---------------------------------------------------------------------------
// AI Calibration (Sprint Calibração IA — 2026-05-26)
// ---------------------------------------------------------------------------

export const LEAD_QUALITY_FEEDBACK = ['good', 'bad'] as const;
export type LeadQualityFeedback = (typeof LEAD_QUALITY_FEEDBACK)[number];

export const QUALIFICATION_PATHS = ['campaign_direct', 'conversation'] as const;
export type QualificationPath = (typeof QUALIFICATION_PATHS)[number];

export interface QuestionAnswer {
  question: string;
  answer: string;
  consideredAt: string;        // ISO timestamp
}

/** Ficha do caso: composição read-only de tudo que importa pra calibrar IA. */
export interface PublicCaseSheet {
  leadId: string;
  leadName: string;
  // Decisão da IA
  aiCallLogId: string | null;
  qualified: boolean | null;
  qualificationPath: QualificationPath | null;
  decisionReason: string | null;
  questionsAnswers: QuestionAnswer[];
  promptVersion: string | null;
  decidedAt: string | null;
  model: string | null;
  // Contexto da campanha (se origem campaign)
  campaignId: string | null;
  campaignName: string | null;
  qualificationQuestion: string | null;     // pergunta da campanha
  campaignMessageBody: string | null;       // primeira mensagem do disparo
  firstInboundReply: string | null;         // primeira resposta do lead
  // Trajetória do deal (se houver)
  dealId: string | null;
  dealStage: DealStage | null;
  dealValue: number | null;
  dealLossReason: LossReason | null;
  leadQualityFeedback: LeadQualityFeedback | null;
  leadQualityFeedbackAt: string | null;
  // Encerramento sem deal (se houver)
  closedNoDealAt: string | null;
  closedNoDealReason: string | null;
  closedNoDealQuality: LeadQualityFeedback | null;
}

export interface ReanalyzeCaseInput {
  reason: string;     // por que admin pediu reanálise (livre)
}

// ── Audit sample queue ────────────────────────────────────────────
export const AUDIT_SAMPLE_STATUSES = ['pending', 'assigned', 'contacted', 'skipped'] as const;
export type AuditSampleStatus = (typeof AUDIT_SAMPLE_STATUSES)[number];

export interface PublicAuditSample {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadCnpj: string | null;
  campaignId: string | null;
  campaignName: string | null;
  sampledAt: string;
  status: AuditSampleStatus;
  assignedTo: { id: string; name: string } | null;
  assignedAt: string | null;
  contactedAt: string | null;
  outcome: LeadQualityFeedback | null;
  outcomeAt: string | null;
  outcomeNotes: string | null;
  // IMPORTANTE: a UI da fila cega NÃO mostra a decisão da IA nem o motivo.
  // Esses campos só aparecem em endpoints internos de relatório.
}

export interface AuditSampleAssignInput {
  // claim (toma pra si): vazio
}

export interface AuditSampleOutcomeInput {
  outcome: LeadQualityFeedback;
  notes?: string;
}

export interface CampaignCalibrationMetrics {
  campaignId: string;
  totalQualifiedByAi: number;          // IA disse "qualificado"
  totalNotQualifiedByAi: number;       // IA disse "não qualificado"
  feedbackGivenCount: number;          // quantos qualificados receberam feedback bin
  feedbackGoodCount: number;           // dos qualificados, vendedor marcou "bom"
  feedbackBadCount: number;            // dos qualificados, vendedor marcou "ruim"
  precision: number | null;            // good / (good + bad) — null se 0 feedback
  // Recall via fila cega
  auditTotal: number;
  auditContacted: number;
  auditGood: number;                   // falsos negativos confirmados
  auditBad: number;                    // verdadeiros negativos
  estimatedRecall: number | null;      // good_qualified / (good_qualified + extrapolated_audit_good)
}

export interface CloseLeadNoDealInput {
  reason: string;
  quality: LeadQualityFeedback;
}
```

- [ ] **Step 2: Estender `UpdateOrgSettingsInput`/`PublicCampaign` se necessário**

Em `PublicCampaign`, adicionar campo:

```typescript
  qualificationQuestion: string | null;
```

(Inserir após `messageBody: string;`)

- [ ] **Step 3: Estender DEAL_ACTIVITY_KINDS**

Em `shared/types.ts`, modificar:

```typescript
export const DEAL_ACTIVITY_KINDS = [
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed',
  'quality_feedback',         // NOVO: vendedor deu feedback bom/ruim
] as const;
```

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts
git commit -m "feat(types): tipos públicos para calibração IA (ficha do caso, feedback, fila cega)"
```

---

# Parte B — Persistência de Audit Data na IA

### Task B1: Estender `recordAiCall` pra aceitar audit fields

**Files:**
- Modify: `server/services/aiAtendimento.ts` (procurar função `recordAiCall`, está nas linhas ~253-263 ou próximo)

- [ ] **Step 1: Localizar `recordAiCall`**

Run: `Grep "function recordAiCall" server/services/aiAtendimento.ts`
ou: `Grep "recordAiCall" server/services/`

A função vive em `aiAtendimento.ts`. Localizar e ler completa antes de editar.

- [ ] **Step 2: Escrever teste falhando**

Criar `server/tests/ai-audit-persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { aiCallLogs, leads, conversations, whatsappInstance } from '../db/schema';
import { recordAiCall } from '../services/aiAtendimento';
import { eq } from 'drizzle-orm';

describe('recordAiCall — audit fields', () => {
  let leadId: string;
  let conversationId: string;
  let instanceId: string;

  beforeEach(async () => {
    // Setup mínimo: cria instance, lead, conversation
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'test', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    instanceId = inst.id;
    const [l] = await db.insert(leads).values({ name: 'Lead Audit', phone: '5511999999999' })
      .returning({ id: leads.id });
    leadId = l.id;
    const [c] = await db.insert(conversations).values({
      phone: '5511999999999', instanceId, leadId,
    }).returning({ id: conversations.id });
    conversationId = c.id;
  });

  it('persiste decisionReason, questionsAnswers, promptVersion, qualificationPath', async () => {
    await recordAiCall({
      conversationId,
      leadId,
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 800,
      qualified: true,
      humanIntent: false,
      decisionReason: 'Cliente pediu orçamento explícito',
      qualificationPath: 'conversation',
      questionsAnswers: [
        { question: 'Você troca óleo regularmente?', answer: 'Sim, a cada 5k km', consideredAt: new Date().toISOString() },
      ],
      promptVersion: 'v1-2026-05-26',
    });

    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.leadId, leadId)).limit(1);
    expect(log).toBeDefined();
    expect(log.decisionReason).toBe('Cliente pediu orçamento explícito');
    expect(log.qualificationPath).toBe('conversation');
    expect(Array.isArray(log.questionsAnswers)).toBe(true);
    expect((log.questionsAnswers as unknown[]).length).toBe(1);
    expect(log.promptVersion).toBe('v1-2026-05-26');
  });

  it('aceita audit fields ausentes (backward-compat)', async () => {
    await recordAiCall({
      conversationId,
      leadId,
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 800,
      qualified: false,
      humanIntent: false,
    });
    const [log] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.leadId, leadId)).limit(1);
    expect(log).toBeDefined();
    expect(log.decisionReason).toBeNull();
    expect(log.qualificationPath).toBeNull();
    expect(log.questionsAnswers).toEqual([]);
  });
});
```

- [ ] **Step 3: Rodar teste e verificar que falha**

Run: `npx vitest run server/tests/ai-audit-persistence.test.ts`
Expected: FAIL com erro indicando que a função `recordAiCall` não aceita os novos campos.

- [ ] **Step 4: Estender assinatura e implementação de `recordAiCall`**

Em `server/services/aiAtendimento.ts`, modificar a interface/signature da `recordAiCall` pra aceitar os novos campos opcionais. Localizar onde está (provavelmente próximo à linha 253). Trocar pra:

```typescript
interface RecordAiCallInput {
  conversationId: string;
  leadId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  qualified: boolean;
  humanIntent: boolean;
  error?: string | null;
  // ── Audit fields (Sprint Calibração IA) ──
  decisionReason?: string | null;
  qualificationPath?: 'campaign_direct' | 'conversation' | null;
  questionsAnswers?: Array<{ question: string; answer: string; consideredAt: string }>;
  promptVersion?: string | null;
  campaignId?: string | null;
}

export async function recordAiCall(input: RecordAiCallInput): Promise<void> {
  await db.insert(aiCallLogs).values({
    conversationId: input.conversationId,
    leadId: input.leadId,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    latencyMs: input.latencyMs,
    qualified: input.qualified,
    humanIntent: input.humanIntent,
    error: input.error ?? null,
    decisionReason: input.decisionReason ?? null,
    qualificationPath: input.qualificationPath ?? null,
    questionsAnswers: input.questionsAnswers ?? [],
    promptVersion: input.promptVersion ?? null,
    campaignId: input.campaignId ?? null,
  });
}
```

(Se houver cálculo de `costUsd` na função existente, manter — não removi de propósito, copiar do código atual.)

- [ ] **Step 5: Rodar teste e verificar que passa**

Run: `npx vitest run server/tests/ai-audit-persistence.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/aiAtendimento.ts server/tests/ai-audit-persistence.test.ts
git commit -m "feat(ai): persistir audit fields em ai_call_logs (decision_reason, questions_answers, prompt_version)"
```

### Task B2: Popular audit fields no pipeline de qualificação

**Files:**
- Modify: `server/services/aiAtendimento.ts` (função `processInboundWithAi`, próximo às linhas que chamam `recordAiCall` após parse da resposta do Gemini)

- [ ] **Step 1: Localizar pontos de chamada de recordAiCall**

Run: `Grep "recordAiCall" server/services/aiAtendimento.ts -n`

Esperado: ao menos 2 chamadas — uma para human_intent (linha ~253) e outra após parse da resposta da IA.

- [ ] **Step 2: Identificar como obter `decisionReason` e `questionsAnswers`**

A função `parseQualificationTag` (linha 119-148) retorna `summary` (do bloco `[RESUMO]`). **Reutilizar `summary` como `decisionReason`** — é o que a IA já produz hoje.

Pra `questionsAnswers`, no MVP: extrair do histórico de mensagens **as últimas N pares de in/out** (pergunta da IA → resposta do lead) e serializar. Manter simples — não tentar fazer NLP.

- [ ] **Step 3: Escrever helper `extractQuestionsAnswers` no mesmo arquivo**

Adicionar em `server/services/aiAtendimento.ts`, antes de `processInboundWithAi`:

```typescript
/**
 * Extrai pares pergunta→resposta do histórico recente.
 * Procura por mensagens out (IA) que terminam em '?' seguidas de uma in (lead).
 * Limita a 5 pares (mais que isso é ruído).
 */
function extractQuestionsAnswers(
  history: Array<{ direction: 'in' | 'out'; body: string | null }>,
  currentInbound: string,
): Array<{ question: string; answer: string; consideredAt: string }> {
  const pairs: Array<{ question: string; answer: string; consideredAt: string }> = [];
  const now = new Date().toISOString();
  // Reverso pra cronologia
  const msgs = history.filter((m) => m.body);
  for (let i = 0; i < msgs.length - 1; i++) {
    const cur = msgs[i];
    const next = msgs[i + 1];
    if (cur.direction === 'out' && cur.body && cur.body.includes('?') && next.direction === 'in' && next.body) {
      pairs.push({ question: cur.body.trim().slice(0, 500), answer: next.body.trim().slice(0, 500), consideredAt: now });
    }
  }
  // Adiciona a resposta atual à última pergunta da IA, se houver
  const lastOut = [...msgs].reverse().find((m) => m.direction === 'out' && m.body?.includes('?'));
  if (lastOut?.body) {
    pairs.push({ question: lastOut.body.trim().slice(0, 500), answer: currentInbound.slice(0, 500), consideredAt: now });
  }
  return pairs.slice(-5);
}
```

- [ ] **Step 4: Determinar `qualificationPath`**

A regra: se este é o **primeiro inbound** da conversa (sem trocas prévias) E a conversa tem `originKind='campaign'`, é `campaign_direct`. Senão, `conversation`.

No `processInboundWithAi`, após carregar o histórico (após linha ~278), adicionar:

```typescript
// Determinar qualification path: primeiro inbound de conversa originada de campanha = campaign_direct
const isFirstInbound = historyRows.filter((m) => m.direction === 'in').length <= 1;
const [convFull] = await db.select({ originKind: conversations.originKind, originCampaignId: conversations.originCampaignId })
  .from(conversations)
  .where(eq(conversations.id, input.conversationId))
  .limit(1);
const qualificationPath: 'campaign_direct' | 'conversation' =
  (isFirstInbound && convFull?.originKind === 'campaign') ? 'campaign_direct' : 'conversation';
const campaignIdForLog = convFull?.originCampaignId ?? null;
```

- [ ] **Step 5: Definir `promptVersion`**

No topo de `server/services/aiAtendimento.ts`, adicionar constante:

```typescript
// Bump esta string a cada mudança material no system prompt (buildSystemPrompt).
// Permite filtrar métricas de calibração por versão.
export const PROMPT_VERSION = 'v1-2026-05-26';
```

- [ ] **Step 6: Atualizar TODAS as chamadas de `recordAiCall` pra incluir novos campos**

Onde `recordAiCall` é chamada após parse bem-sucedido (busque por padrão `recordAiCall({` no arquivo):

```typescript
await recordAiCall({
  conversationId: input.conversationId,
  leadId: input.leadId,
  model: 'gemini-2.5-flash',     // ou variável existente
  inputTokens,
  outputTokens,
  latencyMs,
  qualified: parsed.qualification === 'qualified',
  humanIntent: false,
  decisionReason: parsed.summary,
  qualificationPath,
  questionsAnswers: extractQuestionsAnswers(historyRows, input.inboundText),
  promptVersion: PROMPT_VERSION,
  campaignId: campaignIdForLog,
});
```

(Use os nomes de variáveis exatos que existem na função — `inputTokens`, `outputTokens`, `latencyMs`, `parsed` etc.)

A chamada de `human_intent` (linha ~253) **não muda** — não é uma decisão da IA propriamente dita.

- [ ] **Step 7: Verificar typecheck e rodar testes**

Run: `npm run lint && npx vitest run server/tests/ai-`
Expected: tudo passa. Os testes pré-existentes da IA não devem quebrar (campos novos são opcionais).

- [ ] **Step 8: Commit**

```bash
git add server/services/aiAtendimento.ts
git commit -m "feat(ai): popular audit fields no pipeline (decisionReason via [RESUMO], questionsAnswers via histórico, qualificationPath)"
```

### Task B3: Salvar `qualificationQuestion` ao criar campanha

**Files:**
- Modify: `server/services/campaignsService.ts`
- Modify: `server/controllers/campaignsController.ts` (ou onde está o zod schema de create)

- [ ] **Step 1: Encontrar schema zod de create/update campaign**

Run: `Grep "z.object" server/controllers/campaignsController.ts -n`

Localizar `createCampaignBody` ou similar.

- [ ] **Step 2: Adicionar campo opcional**

No schema zod, adicionar:
```typescript
qualificationQuestion: z.string().trim().max(500).nullable().optional(),
```

- [ ] **Step 3: Repassar no service**

Em `server/services/campaignsService.ts`, na função de create/update, propagar:
```typescript
qualificationQuestion: input.qualificationQuestion ?? null,
```

- [ ] **Step 4: Estender mapper `toPublicCampaign`**

Localizar `toPublicCampaign` (ou similar) em `campaignsService.ts` e adicionar:
```typescript
qualificationQuestion: row.qualificationQuestion,
```

- [ ] **Step 5: Typecheck**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add server/services/campaignsService.ts server/controllers/campaignsController.ts
git commit -m "feat(campaigns): salvar qualification_question na campanha (default null)"
```

### Task B4: Criação automática de deal ao qualificar

**Contexto:** Hoje a IA qualifica, move conversa pra fila Comercial e seta `lead.flowStage='qualified'`, MAS NÃO cria deal. Deal só nasce via `pipelineIntegration.maybeAddDealFromConversation` quando vendedor envia imagem. Mudança de regra: **toda qualificação cria deal sem owner (Pull model)** — deal nasce em `lead_no_comercial`, `ownerUserId=null`, vendedor puxa pra si.

**Files:**
- Modify: `server/services/dealsService.ts` (função `createDeal` — aceitar `ownerUserId: string | null` e novo source)
- Modify: `server/services/aiAtendimento.ts` (chamar createDeal dentro da transação de qualificação)
- Modify: `shared/types.ts` (estender enum interno de source se exposto; ver código)
- Test: estender `server/tests/deals-feedback.test.ts` ou novo `server/tests/deals-ai-qualified.test.ts`

- [ ] **Step 1: Escrever teste falhando**

Criar `server/tests/deals-ai-qualified.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { leads, deals } from '../db/schema';
import { createDeal } from '../services/dealsService';
import { eq } from 'drizzle-orm';

describe('createDeal — source ai_qualified (sem owner)', () => {
  let leadId: string;
  beforeEach(async () => {
    const [l] = await db.insert(leads).values({ name: 'Lead AI Qual', phone: '5511000000300' })
      .returning({ id: leads.id });
    leadId = l.id;
  });

  it('cria deal com ownerUserId=null e source=ai_qualified', async () => {
    const deal = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    expect(deal.stage).toBe('lead_no_comercial');
    expect(deal.owner).toBeNull();
    const [row] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
    expect(row.ownerUserId).toBeNull();
  });

  it('é idempotente (segundo call retorna o mesmo deal)', async () => {
    const d1 = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    const d2 = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    expect(d1.id).toBe(d2.id);
  });
});
```

Run: `npx vitest run server/tests/deals-ai-qualified.test.ts`
Expected: FAIL (createDeal exige ownerUserId: string, não aceita null).

- [ ] **Step 2: Estender `createDeal`**

Em `server/services/dealsService.ts`, modificar a função `createDeal`:

```typescript
export async function createDeal(input: {
  leadId: string;
  proposalValue?: number | null;
  ownerUserId: string | null;       // AGORA aceita null (Pull model)
  source: 'manual' | 'auto_image' | 'ai_qualified';
}): Promise<PublicDeal> {
  const [existing] = await db.select().from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
  if (existing) {
    return getDealById(existing.id);
  }

  const [leadBefore] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);

  const dealId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(deals)
      .values({
        leadId: input.leadId,
        stage: 'lead_no_comercial',
        proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
        ownerUserId: input.ownerUserId,       // pode ser null agora
      })
      .returning({ id: deals.id });
    await logActivity(tx, {
      dealId: created.id,
      kind: 'created',
      // Sem actor humano quando source é automatizada (ai_qualified, auto_image)
      actorUserId: input.source === 'manual' ? input.ownerUserId : null,
      metadata: { source: input.source },
    });
    await tx
      .update(leads)
      .set({ flowStage: 'handed_off', updatedAt: new Date() })
      .where(and(eq(leads.id, input.leadId), sql`${leads.flowStage} <> 'lost'`));
    return created.id;
  });

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

Run: `npx vitest run server/tests/deals-ai-qualified.test.ts`
Expected: PASS.

- [ ] **Step 3: Adicionar 'ai_qualified' em TRANSITION_SOURCES (se aplicável)**

Verificar `shared/types.ts` na constante `TRANSITION_SOURCES`. Já existe `'ai_qualification'` lá (linha ~776), que é o source da transição IA→qualified. Esse é usado pra o `flow_stage` change. **NÃO confundir com o source do deal** (esse é interno ao `metadata` da activity).

Não há mudança a fazer aqui — só estamos passando `'ai_qualified'` como string no metadata da activity. Não precisa entrar em enum exposto.

- [ ] **Step 4: Chamar `createDeal` no pipeline da IA**

Em `server/services/aiAtendimento.ts`, localizar a transação onde `qualification === 'qualified'` move conversa pra Comercial e seta `flowStage='qualified'` (próximo da linha 392-406).

DEPOIS de fechar essa transação (não dentro — `createDeal` tem sua própria transaction), adicionar:

```typescript
// Qualificação criou flowStage='qualified'. Agora cria deal sem owner (Pull model).
// Idempotente — se já existir deal (re-qualificação), no-op via createDeal interno.
if (qualification === 'qualified') {
  const { createDeal } = await import('./dealsService');
  await createDeal({
    leadId: input.leadId,
    ownerUserId: null,        // Pull: vendedor puxa do Kanban "Não atribuído"
    source: 'ai_qualified',
  });
}
```

(Esse bloco deve vir DEPOIS do `await db.transaction(...)` que move pra comercial e ANTES do `emitNotification('lead_qualified', ...)`. Verificar fluxo exato no arquivo.)

- [ ] **Step 5: Verificar callers existentes**

Run: `Grep "createDeal\(" server/ -n`

Listar todos os callers de `createDeal` e validar que continuam compilando com a nova signature (`ownerUserId: string | null`). Tipicamente:
- `pipelineIntegration.ts` linha 24: passa `opts.userId` (string) — compatível.
- `dealsController.ts` (handler de create manual): provavelmente passa `req.user.userId` — compatível.

Se algum caller precisava de owner garantido, manter como string lá.

- [ ] **Step 6: Atualizar PublicDeal mapper (se necessário)**

`toPublic` em `dealsService.ts` já trata `row.owner ? {...} : null` corretamente (linha ~50). Sem mudança.

- [ ] **Step 7: Typecheck + suite de testes**

Run: `npm run lint && npx vitest run server/tests/deals`
Expected: tudo verde. Atenção especial pra testes que assumiam `owner` sempre presente.

- [ ] **Step 8: Smoke do fluxo de qualificação (opcional — pode esperar Parte G)**

Se quiser validar agora, simular uma resposta inbound que dispara qualificação e conferir no DB:
```sql
SELECT id, owner_user_id, stage FROM deals WHERE lead_id = '<leadId>';
-- Esperado: 1 linha, owner_user_id=NULL, stage='lead_no_comercial'
```

- [ ] **Step 9: Commit**

```bash
git add server/services/dealsService.ts server/services/aiAtendimento.ts server/tests/deals-ai-qualified.test.ts
git commit -m "feat(ai): criar deal automaticamente ao qualificar (Pull model — ownerUserId=null)"
```

---

# Parte C — Feedback Binário no Desfecho

### Task C1: Backend — estender `changeStage` pra receber feedback

**Files:**
- Modify: `server/services/dealsService.ts` (função `changeStage`, linhas 420-497)
- Modify: `server/controllers/dealsController.ts` (schema zod de stageHandler)
- Test: `server/tests/deals-feedback.test.ts`

- [ ] **Step 1: Escrever teste falhando**

Criar `server/tests/deals-feedback.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { leads, deals, users, dealActivities } from '../db/schema';
import { changeStage, createDeal } from '../services/dealsService';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';

describe('changeStage — leadQualityFeedback', () => {
  let leadId: string; let userId: string; let dealId: string;

  beforeEach(async () => {
    const [u] = await db.insert(users).values({
      email: `test-${Date.now()}@x.com`, name: 'Vendedor', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    userId = u.id;
    const [l] = await db.insert(leads).values({ name: 'Lead FB', phone: '5511000000000' })
      .returning({ id: leads.id });
    leadId = l.id;
    const d = await createDeal({ leadId, ownerUserId: userId, source: 'manual', proposalValue: 1000 });
    dealId = d.id;
  });

  it('exige leadQualityFeedback ao mover pra ganho', async () => {
    await expect(
      changeStage({ id: dealId, actorUserId: userId, stage: 'ganho' /* missing feedback */ }),
    ).rejects.toThrow(/leadQualityFeedback is required/);
  });

  it('grava leadQualityFeedback ao mover pra ganho', async () => {
    const updated = await changeStage({
      id: dealId, actorUserId: userId, stage: 'ganho', leadQualityFeedback: 'good',
    });
    expect(updated.stage).toBe('ganho');
    const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    expect(row.leadQualityFeedback).toBe('good');
    expect(row.leadQualityFeedbackBy).toBe(userId);
    expect(row.leadQualityFeedbackAt).toBeInstanceOf(Date);
  });

  it('grava leadQualityFeedback ao mover pra perdido', async () => {
    const updated = await changeStage({
      id: dealId, actorUserId: userId, stage: 'perdido',
      lossReason: 'preco', leadQualityFeedback: 'bad',
    });
    expect(updated.stage).toBe('perdido');
    const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    expect(row.leadQualityFeedback).toBe('bad');
  });

  it('registra activity quality_feedback', async () => {
    await changeStage({
      id: dealId, actorUserId: userId, stage: 'ganho', leadQualityFeedback: 'good',
    });
    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, dealId));
    const fbAct = acts.find((a) => a.kind === 'quality_feedback');
    expect(fbAct).toBeDefined();
    expect((fbAct?.metadata as { feedback: string }).feedback).toBe('good');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/deals-feedback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modificar `changeStage` em `server/services/dealsService.ts`**

Localizar a função `changeStage` (linha 420). Modificar assinatura e implementação:

```typescript
export async function changeStage(input: {
  id: string;
  actorUserId: string;
  stage: DealStage;
  lossReason?: LossReason;
  leadQualityFeedback?: LeadQualityFeedback;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  if (input.stage === 'perdido' && !input.lossReason) {
    throw new HttpError(400, 'lossReason is required when moving to perdido');
  }
  if (input.stage === 'ganho' && current.proposalValue == null) {
    throw new HttpError(400, 'proposalValue is required before marking as ganho');
  }
  // NOVO: feedback obrigatório ao mover pra ganho/perdido
  if ((input.stage === 'ganho' || input.stage === 'perdido') && !input.leadQualityFeedback) {
    throw new HttpError(400, 'leadQualityFeedback is required when moving to ganho/perdido');
  }
  if (input.stage === current.stage) {
    return getDealById(input.id);
  }

  const isTerminalNow = current.stage === 'ganho' || current.stage === 'perdido';
  const movingToActive =
    input.stage === 'lead_no_comercial' ||
    input.stage === 'proposta_enviada' ||
    input.stage === 'em_negociacao';
  const reactivating = isTerminalNow && movingToActive;

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {
      stage: input.stage,
      updatedAt: new Date(),
    };
    if (input.stage === 'ganho' || input.stage === 'perdido') {
      patch.closedAt = new Date();
    } else {
      patch.closedAt = null;
    }
    patch.lossReason = input.stage === 'perdido' ? input.lossReason : null;

    // NOVO: gravar feedback
    if (input.leadQualityFeedback) {
      patch.leadQualityFeedback = input.leadQualityFeedback;
      patch.leadQualityFeedbackAt = new Date();
      patch.leadQualityFeedbackBy = input.actorUserId;
    }

    await tx.update(deals).set(patch).where(eq(deals.id, input.id));

    if (reactivating) {
      await logActivity(tx, {
        dealId: input.id, kind: 'reactivated', actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    } else {
      await logActivity(tx, {
        dealId: input.id, kind: 'stage_changed', actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    }

    if (input.stage === 'ganho') {
      await logActivity(tx, {
        dealId: input.id, kind: 'won', actorUserId: input.actorUserId,
        metadata: { value: Number(current.proposalValue) },
      });
    }
    if (input.stage === 'perdido') {
      await logActivity(tx, {
        dealId: input.id, kind: 'lost', actorUserId: input.actorUserId,
        metadata: { reason: input.lossReason },
      });
    }

    // NOVO: activity de quality_feedback
    if (input.leadQualityFeedback) {
      await logActivity(tx, {
        dealId: input.id, kind: 'quality_feedback', actorUserId: input.actorUserId,
        metadata: { feedback: input.leadQualityFeedback },
      });
    }
  });

  return getDealById(input.id);
}
```

Adicionar import no topo do arquivo:
```typescript
import type { LeadQualityFeedback } from '@shared/types';
```

- [ ] **Step 4: Atualizar controller (zod schema)**

Em `server/controllers/dealsController.ts`, atualizar `stageBody`:

```typescript
const stageBody = z.object({
  stage: z.enum(DEAL_STAGES),
  lossReason: z.enum(LOSS_REASONS).optional(),
  leadQualityFeedback: z.enum(LEAD_QUALITY_FEEDBACK).optional(),
});
```

Garantir import:
```typescript
import { LEAD_QUALITY_FEEDBACK } from '@shared/types';
```

E passar pro service:
```typescript
const deal = await changeStage({
  id, actorUserId: req.user!.userId,
  stage: data.stage,
  lossReason: data.lossReason,
  leadQualityFeedback: data.leadQualityFeedback,
});
```

- [ ] **Step 5: Rodar testes**

Run: `npx vitest run server/tests/deals-feedback.test.ts`
Expected: PASS (4/4).

Rodar também o suite completo de deals pra garantir que não quebrou:
Run: `npx vitest run server/tests/deals`
Expected: tudo verde.

- [ ] **Step 6: Atualizar mapper `toPublic` em `dealsService.ts`**

Em `toPublic` (linha 35), adicionar:
```typescript
leadQualityFeedback: row.deal.leadQualityFeedback as LeadQualityFeedback | null,
leadQualityFeedbackAt: row.deal.leadQualityFeedbackAt?.toISOString() ?? null,
```

E atualizar `PublicDeal` em `shared/types.ts`:
```typescript
export interface PublicDeal {
  // ... existentes ...
  leadQualityFeedback: LeadQualityFeedback | null;
  leadQualityFeedbackAt: string | null;
}
```

- [ ] **Step 7: Typecheck + commit**

Run: `npm run lint`

```bash
git add server/services/dealsService.ts server/controllers/dealsController.ts shared/types.ts server/tests/deals-feedback.test.ts
git commit -m "feat(deals): feedback binário obrigatório ao mover pra ganho/perdido"
```

### Task C2: Backend — endpoint "Encerrar lead sem deal"

**Files:**
- Create: `server/controllers/leadsController.ts` (ou modificar existente)
- Modify: `server/services/leadsService.ts`
- Modify: `server/routes/leads.ts`

- [ ] **Step 1: Escrever teste falhando**

Adicionar no final de `server/tests/leads-service.test.ts` (criar se não existir):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { leads, users } from '../db/schema';
import { closeLeadNoDeal } from '../services/leadsService';
import { eq } from 'drizzle-orm';

describe('closeLeadNoDeal', () => {
  let leadId: string; let userId: string;
  beforeEach(async () => {
    const [u] = await db.insert(users).values({
      email: `closeur-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    userId = u.id;
    const [l] = await db.insert(leads).values({ name: 'Lead Close', phone: '5511000000001' })
      .returning({ id: leads.id });
    leadId = l.id;
  });

  it('encerra lead com feedback bad', async () => {
    await closeLeadNoDeal({ leadId, actorUserId: userId, reason: 'Cliente não quer mais', quality: 'bad' });
    const [row] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    expect(row.flowStage).toBe('lost');
    expect(row.closedNoDealQuality).toBe('bad');
    expect(row.closedNoDealBy).toBe(userId);
    expect(row.closedNoDealAt).toBeInstanceOf(Date);
    expect(row.closedNoDealReason).toBe('Cliente não quer mais');
  });

  it('rejeita se lead já tem deal', async () => {
    // criar deal primeiro
    const { createDeal } = await import('../services/dealsService');
    await createDeal({ leadId, ownerUserId: userId, source: 'manual', proposalValue: 100 });
    await expect(
      closeLeadNoDeal({ leadId, actorUserId: userId, reason: 'x', quality: 'good' }),
    ).rejects.toThrow(/already has a deal/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/leads-service.test.ts`
Expected: FAIL — função não existe.

- [ ] **Step 3: Implementar `closeLeadNoDeal`**

Adicionar em `server/services/leadsService.ts` (no final do arquivo):

```typescript
import { deals } from '../db/schema';
import type { LeadQualityFeedback } from '@shared/types';

/**
 * Encerra um lead sem criar deal. Captura feedback de calibração da IA.
 * Lead vai pra flowStage='lost'. Idempotente: se já lost, atualiza campos.
 */
export async function closeLeadNoDeal(input: {
  leadId: string;
  actorUserId: string;
  reason: string;
  quality: LeadQualityFeedback;
}): Promise<void> {
  // Rejeita se já existe deal — caminho errado, deveria ter usado changeStage.
  const [existingDeal] = await db.select().from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
  if (existingDeal) {
    throw new HttpError(400, 'Lead already has a deal — use deal stage change instead');
  }

  await db.update(leads).set({
    flowStage: 'lost',
    closedNoDealAt: new Date(),
    closedNoDealBy: input.actorUserId,
    closedNoDealReason: input.reason,
    closedNoDealQuality: input.quality,
    updatedAt: new Date(),
  }).where(eq(leads.id, input.leadId));

  // Audit trail
  const { recordTransition } = await import('./stageTransitions');
  await recordTransition({
    leadId: input.leadId,
    fromStage: null,    // fromStage não importa aqui — opcional ou puxa do current
    toStage: 'lost',
    source: 'manual_lost',
    metadata: { reason: input.reason, quality: input.quality, by: input.actorUserId },
  });
}
```

(Verificar imports existentes: `db`, `leads`, `eq`, `HttpError` devem estar no topo. Se faltar algum, adicionar.)

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/leads-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar endpoint na route**

Em `server/routes/leads.ts`, adicionar:

```typescript
router.post('/:id/close-no-deal', requireAuth(), closeNoDealHandler);
```

Em `server/controllers/leadsController.ts` (criar se não existir, senão adicionar handler):

```typescript
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { LEAD_QUALITY_FEEDBACK } from '@shared/types';
import { closeLeadNoDeal } from '../services/leadsService';

const closeNoDealBody = z.object({
  reason: z.string().trim().min(3).max(500),
  quality: z.enum(LEAD_QUALITY_FEEDBACK),
});

export async function closeNoDealHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = closeNoDealBody.parse(req.body);
    await closeLeadNoDeal({
      leadId: id,
      actorUserId: req.user!.userId,
      reason: data.reason,
      quality: data.quality,
    });
    res.status(204).send();
  } catch (e) { next(e); }
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run lint && npx vitest run server/tests/leads-service.test.ts`

```bash
git add server/services/leadsService.ts server/controllers/leadsController.ts server/routes/leads.ts server/tests/leads-service.test.ts
git commit -m "feat(leads): endpoint POST /leads/:id/close-no-deal — encerra lead sem deal com feedback de calibração"
```

### Task C3: Frontend — estender dialogs Ganho/Perda com toggle feedback

**Files:**
- Modify: `src/features/inside-sales/GanhoValueDialog.tsx`
- Modify: `src/features/inside-sales/LossReasonDialog.tsx`
- Modify: `src/features/inside-sales/KanbanBoard.tsx`
- Modify: `src/features/inside-sales/api.ts`

- [ ] **Step 1: Reescrever `GanhoValueDialog.tsx`**

Substituir conteúdo inteiro:

```tsx
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';
import type { LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (value: number, feedback: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function GanhoValueDialog({ open, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<LeadQualityFeedback | null>(null);

  const canConfirm = value != null && value > 0 && feedback != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setValue(null); setFeedback(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar fechamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Valor da venda</Label>
            <ValueInput value={value} onChange={setValue} />
          </div>
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA: ajuda a entender se ela está acertando.
            </p>
            <div className="flex gap-2">
              <Button
                variant={feedback === 'good' ? 'default' : 'outline'}
                onClick={() => setFeedback('good')}
                type="button"
                className="flex-1"
              >
                Sim, estava bom
              </Button>
              <Button
                variant={feedback === 'bad' ? 'destructive' : 'outline'}
                onClick={() => setFeedback('bad')}
                type="button"
                className="flex-1"
              >
                Não, mal qualificado
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => value != null && feedback != null && onConfirm(value, feedback)}
          >
            Marcar como ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Reescrever `LossReasonDialog.tsx`**

```tsx
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LOSS_REASON_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason, LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (reason: LossReason, feedback: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function LossReasonDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<LossReason | ''>('');
  const [feedback, setFeedback] = useState<LeadQualityFeedback | null>(null);
  const canConfirm = !!reason && feedback != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); setFeedback(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Por que você está perdendo este deal?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA: ajuda a entender se ela está mandando lead bom mesmo que perca.
            </p>
            <div className="flex gap-2">
              <Button
                variant={feedback === 'good' ? 'default' : 'outline'}
                onClick={() => setFeedback('good')}
                type="button"
                className="flex-1"
              >
                Sim, estava bom
              </Button>
              <Button
                variant={feedback === 'bad' ? 'destructive' : 'outline'}
                onClick={() => setFeedback('bad')}
                type="button"
                className="flex-1"
              >
                Não, mal qualificado
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => reason && feedback && onConfirm(reason, feedback)}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Atualizar `KanbanBoard.tsx`**

Localizar onde `<GanhoValueDialog onConfirm={...}>` e `<LossReasonDialog onConfirm={...}>` são montados.

Atualizar callbacks pra propagar feedback:

```tsx
<GanhoValueDialog
  open={ganhoDialogOpen}
  onConfirm={(value, feedback) => {
    changeStageMutation.mutate({
      dealId: pendingMove.dealId,
      stage: 'ganho',
      leadQualityFeedback: feedback,
    });
    setGanhoDialogOpen(false);
  }}
  onCancel={() => setGanhoDialogOpen(false)}
/>

<LossReasonDialog
  open={lossDialogOpen}
  onConfirm={(reason, feedback) => {
    changeStageMutation.mutate({
      dealId: pendingMove.dealId,
      stage: 'perdido',
      lossReason: reason,
      leadQualityFeedback: feedback,
    });
    setLossDialogOpen(false);
  }}
  onCancel={() => setLossDialogOpen(false)}
/>
```

(Nomes exatos de `ganhoDialogOpen`, `lossDialogOpen`, `pendingMove`, `changeStageMutation` podem variar — ajustar conforme código real.)

- [ ] **Step 4: Atualizar `api.ts` do inside-sales**

Localizar `changeStage` (mutation/fetch) e atualizar tipo do payload:

```typescript
export async function changeStage(input: {
  dealId: string;
  stage: DealStage;
  lossReason?: LossReason;
  leadQualityFeedback?: LeadQualityFeedback;
}): Promise<PublicDeal> {
  const res = await api.post(`/deals/${input.dealId}/stage`, {
    stage: input.stage,
    lossReason: input.lossReason,
    leadQualityFeedback: input.leadQualityFeedback,
  });
  return res.data;
}
```

(Imports: `LeadQualityFeedback` de `@shared/types`.)

- [ ] **Step 5: Typecheck**

Run: `npm run lint`

- [ ] **Step 6: Smoke test manual**

```bash
npm run dev
```

Abrir Kanban, arrastar deal pra Ganho ou Perdido. Verificar:
- Botão "Marcar como ganho/perdido" desabilita até feedback escolhido
- Submissão persiste o feedback (checar via `select * from deals where id=...`)

- [ ] **Step 7: Commit**

```bash
git add src/features/inside-sales/GanhoValueDialog.tsx src/features/inside-sales/LossReasonDialog.tsx src/features/inside-sales/KanbanBoard.tsx src/features/inside-sales/api.ts
git commit -m "feat(inside-sales): toggle de feedback binário obrigatório nos diálogos Ganho/Perda"
```

### Task C4: Frontend — diálogo "Encerrar lead sem deal" + botão

**Files:**
- Create: `src/features/leads/CloseNoDealDialog.tsx`
- Modify: `src/features/leads/LeadActions.tsx`
- Modify: `src/features/leads/api.ts`

- [ ] **Step 1: Criar `CloseNoDealDialog.tsx`**

```tsx
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (reason: string, quality: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function CloseNoDealDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [quality, setQuality] = useState<LeadQualityFeedback | null>(null);
  const canConfirm = reason.trim().length >= 3 && quality != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); setQuality(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar lead sem virar deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo do encerramento</Label>
            <Textarea
              placeholder="Ex.: cliente respondeu mas sumiu, sem interesse real, número errado..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA. Importante mesmo quando não vira deal.
            </p>
            <div className="flex gap-2">
              <Button
                variant={quality === 'good' ? 'default' : 'outline'}
                onClick={() => setQuality('good')}
                type="button"
                className="flex-1"
              >
                Sim, estava bom
              </Button>
              <Button
                variant={quality === 'bad' ? 'destructive' : 'outline'}
                onClick={() => setQuality('bad')}
                type="button"
                className="flex-1"
              >
                Não, mal qualificado
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => quality && onConfirm(reason.trim(), quality)}
          >
            Encerrar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Adicionar função em `src/features/leads/api.ts`**

```typescript
import type { LeadQualityFeedback } from '@shared/types';

export async function closeLeadNoDeal(input: {
  leadId: string;
  reason: string;
  quality: LeadQualityFeedback;
}): Promise<void> {
  await api.post(`/leads/${input.leadId}/close-no-deal`, {
    reason: input.reason,
    quality: input.quality,
  });
}
```

- [ ] **Step 3: Adicionar botão no `LeadActions.tsx`**

Localizar `LeadActions.tsx` e adicionar item no menu/lista de actions:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloseNoDealDialog } from './CloseNoDealDialog';
import { closeLeadNoDeal } from './api';

// dentro do componente
const [closeDialogOpen, setCloseDialogOpen] = useState(false);
const qc = useQueryClient();
const closeMut = useMutation({
  mutationFn: closeLeadNoDeal,
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['leads'] });
    setCloseDialogOpen(false);
  },
});

// no JSX
<Button variant="ghost" onClick={() => setCloseDialogOpen(true)}>
  Encerrar sem deal
</Button>

<CloseNoDealDialog
  open={closeDialogOpen}
  onConfirm={(reason, quality) => closeMut.mutate({ leadId: lead.id, reason, quality })}
  onCancel={() => setCloseDialogOpen(false)}
/>
```

(Encaixe exato depende da estrutura atual de `LeadActions.tsx` — adicionar onde fizer sentido visualmente, geralmente no dropdown de ações.)

- [ ] **Step 4: Typecheck e smoke**

Run: `npm run lint && npm run dev`

Verificar UI manualmente: o botão aparece, abre diálogo, confirma, lead vira `flow_stage='lost'`.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/CloseNoDealDialog.tsx src/features/leads/LeadActions.tsx src/features/leads/api.ts
git commit -m "feat(leads): botão 'Encerrar sem deal' com diálogo de feedback de calibração"
```

---

# Parte D — Fila Cega de Auditoria (10% amostragem)

### Task D1: Service de amostragem

**Files:**
- Create: `server/services/auditSampleService.ts`
- Create: `server/tests/audit-sample.test.ts`

- [ ] **Step 1: Escrever teste falhando**

`server/tests/audit-sample.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { auditSampleAssignments, leads, users, campaigns, whatsappInstance } from '../db/schema';
import {
  enrollIfSampled, claimNextSample, recordOutcome, AUDIT_SAMPLE_RATE,
} from '../services/auditSampleService';
import { eq } from 'drizzle-orm';

describe('audit sample service', () => {
  let leadId: string; let userId: string; let campaignId: string;

  beforeEach(async () => {
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'i', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    const [u] = await db.insert(users).values({
      email: `audit-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    userId = u.id;
    const [l] = await db.insert(leads).values({ name: 'Lead A', phone: '5511000000099' })
      .returning({ id: leads.id });
    leadId = l.id;
    const [c] = await db.insert(campaigns).values({
      name: 'Camp', messageBody: 'oi', createdByUserId: userId, instanceId: inst.id,
    }).returning({ id: campaigns.id });
    campaignId = c.id;
  });

  it('AUDIT_SAMPLE_RATE = 0.10', () => {
    expect(AUDIT_SAMPLE_RATE).toBe(0.10);
  });

  it('enrollIfSampled cria assignment quando força sampling', async () => {
    // forceSample bypass do random — usado em testes
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const [row] = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.leadId, leadId)).limit(1);
    expect(row).toBeDefined();
    expect(row.status).toBe('pending');
    expect(row.campaignId).toBe(campaignId);
  });

  it('enrollIfSampled é idempotente (unique no leadId)', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    // Não deve lançar; segundo é no-op
    const rows = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.leadId, leadId));
    expect(rows.length).toBe(1);
  });

  it('claimNextSample atribui pra usuário', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const claimed = await claimNextSample({ userId, campaignId });
    expect(claimed).not.toBeNull();
    expect(claimed!.leadId).toBe(leadId);
    expect(claimed!.assignedTo?.id).toBe(userId);
  });

  it('recordOutcome marca como contacted com outcome', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const claimed = await claimNextSample({ userId, campaignId });
    await recordOutcome({ id: claimed!.id, outcome: 'good', userId, notes: 'achou interessante' });
    const [row] = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.id, claimed!.id)).limit(1);
    expect(row.status).toBe('contacted');
    expect(row.outcome).toBe('good');
    expect(row.outcomeNotes).toBe('achou interessante');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/audit-sample.test.ts`
Expected: FAIL — service não existe.

- [ ] **Step 3: Implementar `auditSampleService.ts`**

```typescript
import { db } from '../db/client';
import { auditSampleAssignments, leads, users, campaigns } from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicAuditSample, LeadQualityFeedback } from '@shared/types';

export const AUDIT_SAMPLE_RATE = 0.10;

/**
 * Inscreve um lead na fila cega de auditoria com probabilidade AUDIT_SAMPLE_RATE.
 * Chamado pelo pipeline da IA quando lead é marcado "não qualificado".
 * Idempotente — duplicatas no leadId são silenciosamente ignoradas (unique idx).
 *
 * forceSample: bypass do random pra testes.
 */
export async function enrollIfSampled(input: {
  leadId: string;
  campaignId: string | null;
  aiCallLogId: string | null;
  forceSample?: boolean;
}): Promise<void> {
  const sampled = input.forceSample ?? (Math.random() < AUDIT_SAMPLE_RATE);
  if (!sampled) return;

  try {
    await db.insert(auditSampleAssignments).values({
      leadId: input.leadId,
      campaignId: input.campaignId,
      aiCallLogId: input.aiCallLogId,
      status: 'pending',
    });
  } catch (e) {
    // Unique violation no leadId → já está na fila, no-op.
    if (e instanceof Error && e.message.includes('duplicate')) return;
    throw e;
  }
}

function toPublic(row: typeof auditSampleAssignments.$inferSelect & {
  leadName: string; leadPhone: string | null; leadCnpj: string | null;
  campaignName: string | null; assignedName: string | null;
}): PublicAuditSample {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.leadName,
    leadPhone: row.leadPhone,
    leadCnpj: row.leadCnpj,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    sampledAt: row.sampledAt.toISOString(),
    status: row.status as PublicAuditSample['status'],
    assignedTo: row.assignedTo && row.assignedName
      ? { id: row.assignedTo, name: row.assignedName } : null,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    contactedAt: row.contactedAt?.toISOString() ?? null,
    outcome: row.outcome as LeadQualityFeedback | null,
    outcomeAt: row.outcomeAt?.toISOString() ?? null,
    outcomeNotes: row.outcomeNotes,
  };
}

/**
 * Lista a fila cega de auditoria. Filtra por campaignId se passado.
 * Importante: NÃO retorna decisão da IA nem motivo da rejeição — visualização cega.
 */
export async function listSamples(input: {
  campaignId?: string;
  status?: PublicAuditSample['status'];
  assignedToMe?: string;     // userId — se passado, filtra só os meus
}): Promise<PublicAuditSample[]> {
  const conds = [];
  if (input.campaignId) conds.push(eq(auditSampleAssignments.campaignId, input.campaignId));
  if (input.status) conds.push(eq(auditSampleAssignments.status, input.status));
  if (input.assignedToMe) conds.push(eq(auditSampleAssignments.assignedTo, input.assignedToMe));

  const rows = await db.select({
    a: auditSampleAssignments,
    leadName: leads.name,
    leadPhone: leads.phone,
    leadCnpj: leads.cnpj,
    campaignName: campaigns.name,
    assignedName: users.name,
  })
    .from(auditSampleAssignments)
    .innerJoin(leads, eq(auditSampleAssignments.leadId, leads.id))
    .leftJoin(campaigns, eq(auditSampleAssignments.campaignId, campaigns.id))
    .leftJoin(users, eq(auditSampleAssignments.assignedTo, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(auditSampleAssignments.sampledAt);

  return rows.map((r) => toPublic({ ...r.a,
    leadName: r.leadName, leadPhone: r.leadPhone, leadCnpj: r.leadCnpj,
    campaignName: r.campaignName, assignedName: r.assignedName,
  }));
}

/**
 * Pega o próximo sample pendente da fila e atribui ao usuário.
 * Returns null se a fila está vazia.
 */
export async function claimNextSample(input: {
  userId: string;
  campaignId?: string;
}): Promise<PublicAuditSample | null> {
  const conds = [eq(auditSampleAssignments.status, 'pending')];
  if (input.campaignId) conds.push(eq(auditSampleAssignments.campaignId, input.campaignId));

  const [row] = await db.select().from(auditSampleAssignments)
    .where(and(...conds))
    .orderBy(auditSampleAssignments.sampledAt)
    .limit(1);
  if (!row) return null;

  await db.update(auditSampleAssignments).set({
    assignedTo: input.userId,
    assignedAt: new Date(),
    status: 'assigned',
  }).where(eq(auditSampleAssignments.id, row.id));

  const list = await listSamples({ assignedToMe: input.userId });
  return list.find((s) => s.id === row.id) ?? null;
}

/**
 * Registra outcome de uma amostra contatada.
 * outcome='good' = falso negativo da IA (lead era bom mas IA descartou)
 * outcome='bad'  = verdadeiro negativo confirmado
 */
export async function recordOutcome(input: {
  id: string;
  userId: string;
  outcome: LeadQualityFeedback;
  notes?: string;
}): Promise<PublicAuditSample> {
  const [current] = await db.select().from(auditSampleAssignments)
    .where(eq(auditSampleAssignments.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Audit sample not found');
  if (current.assignedTo !== input.userId) {
    throw new HttpError(403, 'Only the assignee can record outcome');
  }

  await db.update(auditSampleAssignments).set({
    contactedAt: new Date(),
    outcome: input.outcome,
    outcomeAt: new Date(),
    outcomeNotes: input.notes ?? null,
    status: 'contacted',
  }).where(eq(auditSampleAssignments.id, input.id));

  const list = await listSamples({ assignedToMe: input.userId });
  const found = list.find((s) => s.id === input.id);
  if (!found) throw new HttpError(500, 'Sample disappeared after update');
  return found;
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/audit-sample.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add server/services/auditSampleService.ts server/tests/audit-sample.test.ts
git commit -m "feat(audit): service de fila cega — amostragem 10%, claim, outcome"
```

### Task D2: Integrar amostragem no pipeline da IA

**Files:**
- Modify: `server/services/aiAtendimento.ts`

- [ ] **Step 1: Adicionar chamada após recordAiCall**

No `processInboundWithAi`, após a chamada de `recordAiCall` que registra a decisão da IA (quando `qualified=false`), adicionar:

```typescript
// Se IA disse "não qualificado", amostra 10% pra auditoria cega.
if (parsed.qualification === 'not_qualified') {
  const [logRow] = await db.select({ id: aiCallLogs.id })
    .from(aiCallLogs)
    .where(and(
      eq(aiCallLogs.leadId, input.leadId),
      eq(aiCallLogs.conversationId, input.conversationId),
    ))
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(1);
  const { enrollIfSampled } = await import('./auditSampleService');
  await enrollIfSampled({
    leadId: input.leadId,
    campaignId: campaignIdForLog,
    aiCallLogId: logRow?.id ?? null,
  });
}
```

(Imports `aiCallLogs`, `and`, `desc` já devem estar — verificar e adicionar se faltar.)

- [ ] **Step 2: Typecheck**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add server/services/aiAtendimento.ts
git commit -m "feat(ai): inscrever 10% dos não-qualificados na fila cega de auditoria"
```

### Task D3: Routes e controller da fila cega

**Files:**
- Create: `server/controllers/auditController.ts`
- Create: `server/routes/audit.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Criar controller**

`server/controllers/auditController.ts`:

```typescript
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { LEAD_QUALITY_FEEDBACK, AUDIT_SAMPLE_STATUSES } from '@shared/types';
import { listSamples, claimNextSample, recordOutcome } from '../services/auditSampleService';

const listQuery = z.object({
  campaignId: z.string().uuid().optional(),
  status: z.enum(AUDIT_SAMPLE_STATUSES).optional(),
  mineOnly: z.coerce.boolean().optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = listQuery.parse(req.query);
    const items = await listSamples({
      campaignId: q.campaignId,
      status: q.status,
      assignedToMe: q.mineOnly ? req.user!.userId : undefined,
    });
    res.json({ items });
  } catch (e) { next(e); }
}

const claimQuery = z.object({
  campaignId: z.string().uuid().optional(),
});

export async function claimHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = claimQuery.parse(req.body);
    const claimed = await claimNextSample({ userId: req.user!.userId, campaignId: q.campaignId });
    if (!claimed) return res.status(204).send();
    res.json(claimed);
  } catch (e) { next(e); }
}

const outcomeBody = z.object({
  outcome: z.enum(LEAD_QUALITY_FEEDBACK),
  notes: z.string().trim().max(500).optional(),
});

export async function outcomeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = outcomeBody.parse(req.body);
    const updated = await recordOutcome({
      id, userId: req.user!.userId, outcome: data.outcome, notes: data.notes,
    });
    res.json(updated);
  } catch (e) { next(e); }
}
```

- [ ] **Step 2: Criar route**

`server/routes/audit.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listHandler, claimHandler, outcomeHandler } from '../controllers/auditController';

export const auditRouter = Router();

auditRouter.get('/samples', requireAuth(), listHandler);
auditRouter.post('/samples/claim', requireAuth(), claimHandler);
auditRouter.patch('/samples/:id/outcome', requireAuth(), outcomeHandler);
```

(Ajustar import de `requireAuth` conforme padrão do projeto — checar como outras routes fazem em `routes/deals.ts`.)

- [ ] **Step 3: Registrar router em `server/app.ts`**

Localizar onde outros routers são plugados (padrão: `app.use('/api/deals', dealsRouter)`). Adicionar:

```typescript
import { auditRouter } from './routes/audit';
// ...
app.use('/api/audit', auditRouter);
```

- [ ] **Step 4: Typecheck**

Run: `npm run lint`

- [ ] **Step 5: Commit**

```bash
git add server/controllers/auditController.ts server/routes/audit.ts server/app.ts
git commit -m "feat(audit): rotas /api/audit/samples (list, claim, outcome)"
```

### Task D4: Frontend — sub-view "Fila cega" na campanha

**Files:**
- Create: `src/features/campaigns/CampaignAuditQueueTab.tsx`
- Modify: `src/features/campaigns/api.ts`

- [ ] **Step 1: Adicionar APIs em `src/features/campaigns/api.ts`**

```typescript
import type { PublicAuditSample, LeadQualityFeedback } from '@shared/types';

export async function listAuditSamples(campaignId: string): Promise<PublicAuditSample[]> {
  const res = await api.get('/audit/samples', { params: { campaignId } });
  return res.data.items;
}

export async function claimAuditSample(campaignId: string): Promise<PublicAuditSample | null> {
  const res = await api.post('/audit/samples/claim', { campaignId });
  if (res.status === 204) return null;
  return res.data;
}

export async function recordAuditOutcome(input: {
  id: string; outcome: LeadQualityFeedback; notes?: string;
}): Promise<PublicAuditSample> {
  const res = await api.patch(`/audit/samples/${input.id}/outcome`, {
    outcome: input.outcome, notes: input.notes,
  });
  return res.data;
}
```

- [ ] **Step 2: Criar componente `CampaignAuditQueueTab.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listAuditSamples, claimAuditSample, recordAuditOutcome,
} from './api';
import type { PublicAuditSample, LeadQualityFeedback } from '@shared/types';

interface Props { campaignId: string }

export function CampaignAuditQueueTab({ campaignId }: Props) {
  const qc = useQueryClient();
  const { data: samples = [], isLoading } = useQuery({
    queryKey: ['audit-samples', campaignId],
    queryFn: () => listAuditSamples(campaignId),
  });

  const claimMut = useMutation({
    mutationFn: () => claimAuditSample(campaignId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-samples', campaignId] }),
  });

  const pending = samples.filter((s) => s.status === 'pending');
  const myAssigned = samples.filter((s) => s.status === 'assigned');
  const contacted = samples.filter((s) => s.status === 'contacted');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Fila cega de auditoria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            10% dos leads que a IA marcou "não qualificados" caem nesta fila.
            Você contata <strong>sem ver a decisão da IA</strong> e avalia se o lead era bom.
            Leads marcados "bom" aqui = falsos negativos (a IA descartou um lead que era bom).
          </p>
          <p className="text-xs">
            <strong>Recompensa:</strong> leads que você marcar "bom" voltam pra sua fila comercial com prioridade.
          </p>
        </CardContent>
      </Card>

      {isLoading && <p>Carregando...</p>}

      <section>
        <h3 className="font-medium mb-2">Disponível pra revisão ({pending.length})</h3>
        <Button onClick={() => claimMut.mutate()} disabled={!pending.length || claimMut.isPending}>
          {claimMut.isPending ? 'Pegando...' : 'Pegar próximo lead'}
        </Button>
      </section>

      <section>
        <h3 className="font-medium mb-2">Atribuídos a mim ({myAssigned.length})</h3>
        {myAssigned.map((s) => (
          <AssignedCard key={s.id} sample={s} campaignId={campaignId} />
        ))}
      </section>

      <section>
        <h3 className="font-medium mb-2">Já contatados ({contacted.length})</h3>
        <table className="w-full text-sm">
          <thead><tr><th>Lead</th><th>Outcome</th><th>Quando</th></tr></thead>
          <tbody>
            {contacted.map((s) => (
              <tr key={s.id}>
                <td>{s.leadName}</td>
                <td>{s.outcome === 'good' ? '✅ Bom (falso negativo)' : '❌ Ruim (confirmado)'}</td>
                <td>{s.contactedAt ? new Date(s.contactedAt).toLocaleString('pt-BR') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AssignedCard({ sample, campaignId }: { sample: PublicAuditSample; campaignId: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const mut = useMutation({
    mutationFn: (outcome: LeadQualityFeedback) => recordAuditOutcome({ id: sample.id, outcome, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-samples', campaignId] }),
  });

  return (
    <Card className="mb-2">
      <CardContent className="pt-4 space-y-2">
        <div><strong>{sample.leadName}</strong> — {sample.leadPhone ?? 'sem telefone'} — {sample.leadCnpj ?? 'sem CNPJ'}</div>
        <Textarea
          placeholder="O que você descobriu ao contatar? (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button onClick={() => mut.mutate('good')} disabled={mut.isPending}>Era um bom lead</Button>
          <Button variant="destructive" onClick={() => mut.mutate('bad')} disabled={mut.isPending}>
            Era ruim mesmo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Adicionar tab no `CampaignFunnel.tsx` (ou no container da campanha)**

Localizar o componente que renderiza detalhes/relatório de uma campanha (pode ser `CampaignFunnel.tsx` ou uma página em `src/pages/campaigns/[id]`). Se já existe estrutura de tabs, adicionar tab. Se não:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CampaignAuditQueueTab } from './CampaignAuditQueueTab';

<Tabs defaultValue="funnel">
  <TabsList>
    <TabsTrigger value="funnel">Funil</TabsTrigger>
    <TabsTrigger value="audit">Fila cega (auditoria IA)</TabsTrigger>
  </TabsList>
  <TabsContent value="funnel">
    {/* JSX existente do funil */}
  </TabsContent>
  <TabsContent value="audit">
    <CampaignAuditQueueTab campaignId={campaign.id} />
  </TabsContent>
</Tabs>
```

(Adaptar conforme o nome do prop/variável da campanha disponível.)

- [ ] **Step 4: Typecheck + smoke manual**

Run: `npm run lint && npm run dev`

- [ ] **Step 5: Commit**

```bash
git add src/features/campaigns/CampaignAuditQueueTab.tsx src/features/campaigns/api.ts src/features/campaigns/CampaignFunnel.tsx
git commit -m "feat(campaigns): aba 'Fila cega de auditoria' na visão da campanha"
```

### Task D5: Frontend — sub-view "Não qualificados" (lista aberta)

**Files:**
- Create: `src/features/campaigns/CampaignUnqualifiedTab.tsx`
- Modify: `server/services/campaignsService.ts` (adicionar query)
- Modify: `server/routes/campaigns.ts` (endpoint)

- [ ] **Step 1: Adicionar endpoint backend `GET /campaigns/:id/unqualified-leads`**

Em `server/services/campaignsService.ts`, adicionar função:

```typescript
export async function listUnqualifiedLeads(campaignId: string): Promise<Array<{
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadCnpj: string | null;
  decidedAt: string;
  decisionReason: string | null;
  ageInDays: number;
  reattemptCount: number;     // quantas campanhas já recrutaram este lead
}>> {
  // Leads que esta campanha disparou + IA marcou não qualificado.
  // JOIN: campaign_recipients × ai_call_logs onde qualified=false.
  const rows = await db.execute<{
    lead_id: string; lead_name: string; phone: string | null; cnpj: string | null;
    decided_at: Date; decision_reason: string | null; age_days: number; reattempt_count: number;
  }>(sql`
    SELECT
      l.id as lead_id,
      l.name as lead_name,
      l.phone,
      l.cnpj,
      acl.created_at as decided_at,
      acl.decision_reason,
      EXTRACT(DAY FROM (now() - acl.created_at))::int as age_days,
      (SELECT COUNT(*)::int FROM campaign_recipients cr2 WHERE cr2.lead_id = l.id) as reattempt_count
    FROM ai_call_logs acl
    INNER JOIN leads l ON l.id = acl.lead_id
    INNER JOIN campaign_recipients cr ON cr.lead_id = l.id
    WHERE cr.campaign_id = ${campaignId}
      AND acl.qualified = false
      AND acl.campaign_id = ${campaignId}
    ORDER BY acl.created_at DESC
    LIMIT 500
  `);
  return rows.map((r) => ({
    leadId: r.lead_id,
    leadName: r.lead_name,
    leadPhone: r.phone,
    leadCnpj: r.cnpj,
    decidedAt: new Date(r.decided_at).toISOString(),
    decisionReason: r.decision_reason,
    ageInDays: r.age_days,
    reattemptCount: r.reattempt_count,
  }));
}
```

- [ ] **Step 2: Adicionar rota**

Em `server/routes/campaigns.ts`, adicionar:

```typescript
router.get('/:id/unqualified-leads', requireAuth(), async (req, res, next) => {
  try {
    const items = await listUnqualifiedLeads(req.params.id);
    res.json({ items });
  } catch (e) { next(e); }
});
```

(Imports: adicionar `listUnqualifiedLeads` do service.)

- [ ] **Step 3: Adicionar API client**

Em `src/features/campaigns/api.ts`:

```typescript
export interface UnqualifiedLead {
  leadId: string; leadName: string;
  leadPhone: string | null; leadCnpj: string | null;
  decidedAt: string; decisionReason: string | null;
  ageInDays: number; reattemptCount: number;
}

export async function listUnqualifiedLeads(campaignId: string): Promise<UnqualifiedLead[]> {
  const res = await api.get(`/campaigns/${campaignId}/unqualified-leads`);
  return res.data.items;
}
```

- [ ] **Step 4: Criar componente `CampaignUnqualifiedTab.tsx`**

```tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUnqualifiedLeads, type UnqualifiedLead } from './api';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

interface Props { campaignId: string }

export function CampaignUnqualifiedTab({ campaignId }: Props) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['campaign-unqualified', campaignId],
    queryFn: () => listUnqualifiedLeads(campaignId),
  });
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const s = search.toLowerCase();
    return leads.filter((l) =>
      l.leadName.toLowerCase().includes(s) ||
      (l.leadCnpj?.includes(s) ?? false) ||
      (l.decisionReason?.toLowerCase().includes(s) ?? false),
    );
  }, [leads, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
          <p>
            Leads que a IA marcou <strong>não qualificados</strong> nesta campanha.
            Útil pra reciclar em campanhas futuras quando o produto/contexto mudar.
          </p>
          <p className="text-xs">
            <strong>Atenção:</strong> esta lista não substitui a fila cega — escolher por aqui mantém o viés da IA.
            Use só pra reciclagem direcionada (ex.: novo produto que atende um perfil que antes não cabia).
          </p>
        </CardContent>
      </Card>

      <Input
        placeholder="Buscar por nome, CNPJ, motivo..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading && <p>Carregando...</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>Lead</th>
            <th>CNPJ</th>
            <th>Motivo IA</th>
            <th>Idade</th>
            <th>Tentativas</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((l) => (
            <tr key={l.leadId} className="border-t">
              <td>{l.leadName}</td>
              <td>{l.leadCnpj ?? '-'}</td>
              <td className="max-w-xs truncate" title={l.decisionReason ?? ''}>
                {l.decisionReason ?? '(sem motivo registrado)'}
              </td>
              <td>{l.ageInDays}d</td>
              <td>{l.reattemptCount}</td>
            </tr>
          ))}
          {filtered.length === 0 && !isLoading && (
            <tr><td colSpan={5} className="text-center text-muted-foreground py-4">Nenhum lead encontrado.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Plugar na estrutura de tabs (mesma de D4)**

Adicionar tab "Não qualificados":

```tsx
<TabsTrigger value="unqualified">Não qualificados</TabsTrigger>
{/* ... */}
<TabsContent value="unqualified">
  <CampaignUnqualifiedTab campaignId={campaign.id} />
</TabsContent>
```

- [ ] **Step 6: Typecheck e commit**

Run: `npm run lint`

```bash
git add src/features/campaigns/CampaignUnqualifiedTab.tsx src/features/campaigns/api.ts server/services/campaignsService.ts server/routes/campaigns.ts src/features/campaigns/CampaignFunnel.tsx
git commit -m "feat(campaigns): aba 'Não qualificados' — lista aberta de rejeitados pela IA pra reciclagem"
```

---

# Parte E — Ficha do Caso

### Task E1: Backend — serviço de composição da ficha

**Files:**
- Create: `server/services/caseSheetService.ts`
- Create: `server/tests/case-sheet.test.ts`

- [ ] **Step 1: Escrever teste falhando**

`server/tests/case-sheet.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import {
  aiCallLogs, leads, conversations, whatsappInstance, campaigns, deals, users, messages,
} from '../db/schema';
import { getCaseSheet } from '../services/caseSheetService';

describe('getCaseSheet', () => {
  it('retorna ficha vazia (mas válida) para lead sem decisão de IA', async () => {
    const [l] = await db.insert(leads).values({ name: 'Sem IA', phone: '5511000000200' })
      .returning({ id: leads.id });
    const sheet = await getCaseSheet(l.id);
    expect(sheet.leadId).toBe(l.id);
    expect(sheet.aiCallLogId).toBeNull();
    expect(sheet.qualified).toBeNull();
    expect(sheet.dealId).toBeNull();
  });

  it('compõe ficha completa de lead qualificado direto via campanha', async () => {
    const [u] = await db.insert(users).values({
      email: `cs-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'i', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    const [c] = await db.insert(campaigns).values({
      name: 'Camp X', messageBody: 'Quer trocar óleo?',
      qualificationQuestion: 'Você precisa trocar o óleo agora?',
      createdByUserId: u.id, instanceId: inst.id,
    }).returning({ id: campaigns.id });
    const [l] = await db.insert(leads).values({ name: 'Lead Camp', phone: '5511000000201' })
      .returning({ id: leads.id });
    const [conv] = await db.insert(conversations).values({
      phone: '5511000000201', instanceId: inst.id, leadId: l.id,
      originKind: 'campaign', originCampaignId: c.id,
    }).returning({ id: conversations.id });
    await db.insert(messages).values({
      conversationId: conv.id, direction: 'in', kind: 'text',
      body: 'Sim, preciso urgente!', rawPayload: {}, sentAt: new Date(),
    });
    await db.insert(aiCallLogs).values({
      conversationId: conv.id, leadId: l.id, model: 'gemini',
      inputTokens: 50, outputTokens: 20, latencyMs: 500,
      qualified: true, humanIntent: false,
      decisionReason: 'Pediu urgente',
      qualificationPath: 'campaign_direct',
      campaignId: c.id,
      questionsAnswers: [{ question: 'Você precisa?', answer: 'Sim, urgente!', consideredAt: new Date().toISOString() }],
    });

    const sheet = await getCaseSheet(l.id);
    expect(sheet.qualified).toBe(true);
    expect(sheet.qualificationPath).toBe('campaign_direct');
    expect(sheet.decisionReason).toBe('Pediu urgente');
    expect(sheet.campaignId).toBe(c.id);
    expect(sheet.campaignName).toBe('Camp X');
    expect(sheet.qualificationQuestion).toBe('Você precisa trocar o óleo agora?');
    expect(sheet.firstInboundReply).toBe('Sim, preciso urgente!');
    expect(sheet.questionsAnswers.length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/tests/case-sheet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar service**

`server/services/caseSheetService.ts`:

```typescript
import { db } from '../db/client';
import {
  aiCallLogs, leads, deals, campaigns, conversations, messages,
} from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicCaseSheet, QualificationPath, QuestionAnswer,
  LossReason, DealStage, LeadQualityFeedback,
} from '@shared/types';

export async function getCaseSheet(leadId: string): Promise<PublicCaseSheet> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new HttpError(404, 'Lead not found');

  // Última decisão da IA (mais recente)
  const [aiLog] = await db.select().from(aiCallLogs)
    .where(and(eq(aiCallLogs.leadId, leadId), eq(aiCallLogs.humanIntent, false)))
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(1);

  // Conversa de origem (se houver)
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.leadId, leadId))
    .orderBy(asc(conversations.createdAt))
    .limit(1);

  // Campanha de origem (do aiLog ou da conversa)
  const campaignId = aiLog?.campaignId ?? conv?.originCampaignId ?? null;
  let campaignName: string | null = null;
  let qualificationQuestion: string | null = null;
  let campaignMessageBody: string | null = null;
  if (campaignId) {
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (camp) {
      campaignName = camp.name;
      qualificationQuestion = camp.qualificationQuestion;
      campaignMessageBody = camp.messageBody;
    }
  }

  // Primeira resposta inbound do lead (se houver conversa)
  let firstInboundReply: string | null = null;
  if (conv) {
    const [firstIn] = await db.select({ body: messages.body }).from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'in')))
      .orderBy(asc(messages.sentAt))
      .limit(1);
    firstInboundReply = firstIn?.body ?? null;
  }

  // Deal (se houver)
  const [deal] = await db.select().from(deals).where(eq(deals.leadId, leadId)).limit(1);

  return {
    leadId,
    leadName: lead.name,
    aiCallLogId: aiLog?.id ?? null,
    qualified: aiLog?.qualified ?? null,
    qualificationPath: (aiLog?.qualificationPath ?? null) as QualificationPath | null,
    decisionReason: aiLog?.decisionReason ?? null,
    questionsAnswers: (aiLog?.questionsAnswers as QuestionAnswer[] | null) ?? [],
    promptVersion: aiLog?.promptVersion ?? null,
    decidedAt: aiLog?.createdAt?.toISOString() ?? null,
    model: aiLog?.model ?? null,
    campaignId,
    campaignName,
    qualificationQuestion,
    campaignMessageBody,
    firstInboundReply,
    dealId: deal?.id ?? null,
    dealStage: (deal?.stage as DealStage | null) ?? null,
    dealValue: deal?.proposalValue == null ? null : Number(deal.proposalValue),
    dealLossReason: (deal?.lossReason as LossReason | null) ?? null,
    leadQualityFeedback: (deal?.leadQualityFeedback as LeadQualityFeedback | null) ?? null,
    leadQualityFeedbackAt: deal?.leadQualityFeedbackAt?.toISOString() ?? null,
    closedNoDealAt: lead.closedNoDealAt?.toISOString() ?? null,
    closedNoDealReason: lead.closedNoDealReason ?? null,
    closedNoDealQuality: (lead.closedNoDealQuality as LeadQualityFeedback | null) ?? null,
  };
}

/**
 * Reanálise (admin only) — não sobrescreve; cria nova ai_call_log com
 * marcador no decisionReason indicando "Reanálise solicitada por <admin>".
 *
 * MVP: não chama o Gemini de novo — apenas registra a solicitação como log.
 * Versão futura: re-roda o pipeline com o prompt atual.
 */
export async function requestReanalysis(input: {
  leadId: string;
  adminUserId: string;
  reason: string;
}): Promise<void> {
  // No MVP, só registra como uma entrada manual em ai_call_logs marcada com prompt_version='reanalysis-stub'.
  // Futuro: re-roda o pipeline da IA. Por enquanto, expor a entrada como histórico.
  await db.insert(aiCallLogs).values({
    leadId: input.leadId,
    conversationId: null,
    model: 'reanalysis-stub',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    qualified: false,
    humanIntent: false,
    decisionReason: `[REANÁLISE SOLICITADA] ${input.reason}`,
    promptVersion: 'reanalysis-stub',
  });
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run server/tests/case-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/caseSheetService.ts server/tests/case-sheet.test.ts
git commit -m "feat(case-sheet): service compõe ficha do caso (IA + campanha + deal + close)"
```

### Task E2: Routes da ficha do caso

**Files:**
- Create: `server/controllers/caseSheetController.ts`
- Create: `server/routes/caseSheet.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Criar controller e route**

`server/controllers/caseSheetController.ts`:

```typescript
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { getCaseSheet, requestReanalysis } from '../services/caseSheetService';

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sheet = await getCaseSheet(req.params.leadId);
    res.json(sheet);
  } catch (e) { next(e); }
}

const reanalyzeBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

export async function reanalyzeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ message: 'admin only' });
    const data = reanalyzeBody.parse(req.body);
    await requestReanalysis({
      leadId: req.params.leadId,
      adminUserId: req.user!.userId,
      reason: data.reason,
    });
    res.status(202).send();
  } catch (e) { next(e); }
}
```

`server/routes/caseSheet.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getHandler, reanalyzeHandler } from '../controllers/caseSheetController';

export const caseSheetRouter = Router();

caseSheetRouter.get('/:leadId/case-sheet', requireAuth(), getHandler);
caseSheetRouter.post('/:leadId/case-sheet/reanalyze', requireAuth(), reanalyzeHandler);
```

- [ ] **Step 2: Registrar em `server/app.ts`**

```typescript
import { caseSheetRouter } from './routes/caseSheet';
app.use('/api/leads', caseSheetRouter);
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`

- [ ] **Step 4: Commit**

```bash
git add server/controllers/caseSheetController.ts server/routes/caseSheet.ts server/app.ts
git commit -m "feat(case-sheet): rotas GET /leads/:id/case-sheet e POST .../reanalyze (admin)"
```

### Task E3: Frontend — componente `CaseSheet`

**Files:**
- Create: `src/features/case-sheet/CaseSheet.tsx`
- Create: `src/features/case-sheet/api.ts`
- Create: `src/features/case-sheet/QualificationPathBadge.tsx`
- Create: `src/features/case-sheet/QuestionsAnswersList.tsx`

- [ ] **Step 1: API client**

`src/features/case-sheet/api.ts`:

```typescript
import { api } from '@/lib/api';
import type { PublicCaseSheet } from '@shared/types';

export async function fetchCaseSheet(leadId: string): Promise<PublicCaseSheet> {
  const res = await api.get(`/leads/${leadId}/case-sheet`);
  return res.data;
}

export async function reanalyzeCase(leadId: string, reason: string): Promise<void> {
  await api.post(`/leads/${leadId}/case-sheet/reanalyze`, { reason });
}
```

(Ajustar import de `api` conforme padrão do projeto — checar como `src/features/leads/api.ts` faz.)

- [ ] **Step 2: Badge de path**

`src/features/case-sheet/QualificationPathBadge.tsx`:

```tsx
import type { QualificationPath } from '@shared/types';

interface Props { path: QualificationPath | null }

export function QualificationPathBadge({ path }: Props) {
  if (!path) return <span className="text-xs text-muted-foreground">— sem decisão da IA —</span>;
  if (path === 'campaign_direct') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
      Qualificado direto via campanha
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">
      Qualificado após conversa
    </span>
  );
}
```

- [ ] **Step 3: Lista de Q&A**

`src/features/case-sheet/QuestionsAnswersList.tsx`:

```tsx
import type { QuestionAnswer } from '@shared/types';

interface Props { items: QuestionAnswer[] }

export function QuestionsAnswersList({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum par pergunta→resposta registrado.</p>;
  }
  return (
    <ol className="space-y-3">
      {items.map((qa, i) => (
        <li key={i} className="border-l-2 border-muted pl-3">
          <p className="text-xs text-muted-foreground">Pergunta da IA:</p>
          <p className="font-medium text-sm">{qa.question}</p>
          <p className="text-xs text-muted-foreground mt-1">Resposta do lead:</p>
          <p className="text-sm">{qa.answer}</p>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Componente principal `CaseSheet.tsx`**

```tsx
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchCaseSheet, reanalyzeCase } from './api';
import { QualificationPathBadge } from './QualificationPathBadge';
import { QuestionsAnswersList } from './QuestionsAnswersList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  leadId: string;
  /** Quando true, exibe botão "Solicitar reanálise" (admin only). */
  isAdmin: boolean;
  /** Link opcional para o deal correspondente. */
  onOpenDeal?: (dealId: string) => void;
}

export function CaseSheet({ leadId, isAdmin, onOpenDeal }: Props) {
  const { data: sheet, isLoading, refetch } = useQuery({
    queryKey: ['case-sheet', leadId],
    queryFn: () => fetchCaseSheet(leadId),
  });
  const [reanalysisOpen, setReanalysisOpen] = useState(false);
  const [reanalysisReason, setReanalysisReason] = useState('');
  const reMut = useMutation({
    mutationFn: () => reanalyzeCase(leadId, reanalysisReason),
    onSuccess: () => { setReanalysisOpen(false); setReanalysisReason(''); refetch(); },
  });

  if (isLoading || !sheet) return <p>Carregando ficha...</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Decisão da IA</CardTitle>
          <QualificationPathBadge path={sheet.qualificationPath} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {sheet.qualified == null ? (
            <p className="text-muted-foreground">Nenhuma decisão registrada.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <strong>Resultado:</strong>
                <span className={sheet.qualified ? 'text-green-700' : 'text-red-700'}>
                  {sheet.qualified ? '✓ Qualificado' : '✗ Não qualificado'}
                </span>
              </div>
              <div><strong>Modelo:</strong> {sheet.model} <span className="text-xs text-muted-foreground">({sheet.promptVersion ?? 'sem versão'})</span></div>
              {sheet.decidedAt && (
                <div><strong>Decidido em:</strong> {new Date(sheet.decidedAt).toLocaleString('pt-BR')}</div>
              )}
              {sheet.decisionReason && (
                <div>
                  <strong>Razão da decisão:</strong>
                  <p className="mt-1 p-2 bg-muted rounded text-sm">{sheet.decisionReason}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {sheet.qualificationPath === 'campaign_direct' && sheet.campaignId && (
        <Card>
          <CardHeader><CardTitle>Contexto da campanha</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Campanha:</strong> {sheet.campaignName}</div>
            {sheet.qualificationQuestion && (
              <div>
                <strong>Pergunta de qualificação:</strong>
                <p className="mt-1 p-2 bg-muted rounded">{sheet.qualificationQuestion}</p>
              </div>
            )}
            {sheet.firstInboundReply && (
              <div>
                <strong>Primeira resposta do lead:</strong>
                <p className="mt-1 p-2 bg-muted rounded italic">"{sheet.firstInboundReply}"</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sheet.qualificationPath === 'conversation' && sheet.questionsAnswers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Perguntas e respostas avaliadas</CardTitle></CardHeader>
          <CardContent>
            <QuestionsAnswersList items={sheet.questionsAnswers} />
          </CardContent>
        </Card>
      )}

      {sheet.dealId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Trajetória do deal</CardTitle>
            {onOpenDeal && <Button variant="ghost" size="sm" onClick={() => onOpenDeal(sheet.dealId!)}>Abrir deal →</Button>}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><strong>Estágio:</strong> {sheet.dealStage}</div>
            {sheet.dealValue != null && (
              <div><strong>Valor:</strong> R$ {sheet.dealValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            )}
            {sheet.dealLossReason && <div><strong>Motivo de perda:</strong> {sheet.dealLossReason}</div>}
            {sheet.leadQualityFeedback && (
              <div>
                <strong>Feedback do vendedor:</strong>{' '}
                <span className={sheet.leadQualityFeedback === 'good' ? 'text-green-700' : 'text-red-700'}>
                  {sheet.leadQualityFeedback === 'good' ? 'Lead estava bom' : 'Lead mal qualificado'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sheet.closedNoDealAt && (
        <Card>
          <CardHeader><CardTitle>Encerrado sem deal</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><strong>Em:</strong> {new Date(sheet.closedNoDealAt).toLocaleString('pt-BR')}</div>
            {sheet.closedNoDealReason && (
              <div><strong>Motivo:</strong> {sheet.closedNoDealReason}</div>
            )}
            {sheet.closedNoDealQuality && (
              <div>
                <strong>Feedback:</strong>{' '}
                <span className={sheet.closedNoDealQuality === 'good' ? 'text-green-700' : 'text-red-700'}>
                  {sheet.closedNoDealQuality === 'good' ? 'Lead estava bom' : 'Lead mal qualificado'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && sheet.qualified != null && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setReanalysisOpen(true)}>
            Solicitar reanálise
          </Button>
        </div>
      )}

      <Dialog open={reanalysisOpen} onOpenChange={(o) => !o && setReanalysisOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Solicitar reanálise da decisão</DialogTitle></DialogHeader>
          <Textarea
            placeholder="Por que esta decisão deveria ser revista? (registra no histórico)"
            value={reanalysisReason}
            onChange={(e) => setReanalysisReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReanalysisOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => reMut.mutate()}
              disabled={reanalysisReason.trim().length < 3 || reMut.isPending}
            >
              Solicitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/features/case-sheet/
git commit -m "feat(case-sheet): componente CaseSheet (decisão IA + campanha + deal + reanálise admin)"
```

### Task E4: Plugar `CaseSheet` no `LeadDialog` e `DealDrawer`

**Files:**
- Modify: `src/features/leads/LeadDialog.tsx`
- Modify: `src/features/inside-sales/DealDrawer.tsx`

- [ ] **Step 1: Adicionar tab no `LeadDialog.tsx`**

Localizar estrutura do `LeadDialog`. Se já tem tabs, adicionar. Se é form puro, envolver em `Tabs`:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CaseSheet } from '@/features/case-sheet/CaseSheet';
import { useAuth } from '@/features/auth/useAuth';   // ou hook equivalente

// dentro do componente
const { user } = useAuth();
const isAdmin = user?.role === 'admin';

// dentro do DialogContent
<Tabs defaultValue="info">
  <TabsList>
    <TabsTrigger value="info">Informações</TabsTrigger>
    <TabsTrigger value="case-sheet">Ficha do Caso</TabsTrigger>
  </TabsList>
  <TabsContent value="info">
    {/* form existente */}
  </TabsContent>
  <TabsContent value="case-sheet">
    {lead?.id && <CaseSheet leadId={lead.id} isAdmin={isAdmin} />}
  </TabsContent>
</Tabs>
```

(Ajustar conforme estrutura real; se `lead.id` não está disponível imediatamente em "criação", esconder a tab nesse caso: `{mode === 'edit' && <TabsTrigger value="case-sheet">...}`.)

- [ ] **Step 2: Adicionar tab no `DealDrawer.tsx`**

Análogo: envolver conteúdo em `Tabs` e adicionar:

```tsx
<TabsTrigger value="case-sheet">Ficha do Caso</TabsTrigger>
{/* ... */}
<TabsContent value="case-sheet">
  <CaseSheet
    leadId={deal.lead.id}
    isAdmin={isAdmin}
    onOpenDeal={(id) => { /* já estamos no deal — no-op ou highlight */ }}
  />
</TabsContent>
```

- [ ] **Step 3: Smoke manual**

```bash
npm run dev
```

Abrir um lead que tem `ai_call_logs`. Navegar pra tab "Ficha do Caso". Validar:
- Dados aparecem corretamente
- Path badge mostra `campaign_direct` ou `conversation`
- Se admin, botão "Solicitar reanálise" aparece
- Se há deal, mostra trajetória

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/LeadDialog.tsx src/features/inside-sales/DealDrawer.tsx
git commit -m "feat(case-sheet): plugar CaseSheet em LeadDialog e DealDrawer (tabs)"
```

---

# Parte F — Métricas de Calibração (visão consolidada)

### Task F1: Backend — endpoint de métricas por campanha

**Files:**
- Modify: `server/services/campaignsService.ts`
- Modify: `server/routes/campaigns.ts`

- [ ] **Step 1: Adicionar função de métricas**

Em `campaignsService.ts`:

```typescript
import type { CampaignCalibrationMetrics } from '@shared/types';

export async function getCalibrationMetrics(campaignId: string): Promise<CampaignCalibrationMetrics> {
  // Decisões da IA nesta campanha
  const decisionRows = await db.execute<{ qualified: boolean; count: number }>(sql`
    SELECT qualified, COUNT(*)::int as count
    FROM ai_call_logs
    WHERE campaign_id = ${campaignId} AND human_intent = false
    GROUP BY qualified
  `);
  const totalQualifiedByAi = decisionRows.find((r) => r.qualified === true)?.count ?? 0;
  const totalNotQualifiedByAi = decisionRows.find((r) => r.qualified === false)?.count ?? 0;

  // Feedback dos qualificados que viraram deal
  const feedbackRows = await db.execute<{ feedback: string | null; count: number }>(sql`
    SELECT d.lead_quality_feedback as feedback, COUNT(*)::int as count
    FROM deals d
    INNER JOIN ai_call_logs acl ON acl.lead_id = d.lead_id
    WHERE acl.campaign_id = ${campaignId} AND acl.qualified = true
    GROUP BY d.lead_quality_feedback
  `);
  const feedbackGoodCount = feedbackRows.find((r) => r.feedback === 'good')?.count ?? 0;
  const feedbackBadCount = feedbackRows.find((r) => r.feedback === 'bad')?.count ?? 0;
  const feedbackGivenCount = feedbackGoodCount + feedbackBadCount;
  const precision = feedbackGivenCount > 0 ? feedbackGoodCount / feedbackGivenCount : null;

  // Audit (recall estimado)
  const auditRows = await db.execute<{ outcome: string | null; status: string; count: number }>(sql`
    SELECT outcome, status, COUNT(*)::int as count
    FROM audit_sample_assignments
    WHERE campaign_id = ${campaignId}
    GROUP BY outcome, status
  `);
  const auditTotal = auditRows.reduce((a, r) => a + r.count, 0);
  const auditContacted = auditRows.filter((r) => r.status === 'contacted').reduce((a, r) => a + r.count, 0);
  const auditGood = auditRows.filter((r) => r.outcome === 'good').reduce((a, r) => a + r.count, 0);
  const auditBad = auditRows.filter((r) => r.outcome === 'bad').reduce((a, r) => a + r.count, 0);

  // Recall estimado: extrapola auditGood de 10% pra 100% dos rejeitados.
  // recall ≈ trueQualified / (trueQualified + estimatedMissed)
  // estimatedMissed = (auditGood / auditContacted) * totalNotQualifiedByAi se auditContacted > 0
  let estimatedRecall: number | null = null;
  if (auditContacted > 0) {
    const missRate = auditGood / auditContacted;
    const estimatedMissed = missRate * totalNotQualifiedByAi;
    const trueQualified = feedbackGoodCount;
    const denom = trueQualified + estimatedMissed;
    estimatedRecall = denom > 0 ? trueQualified / denom : null;
  }

  return {
    campaignId,
    totalQualifiedByAi,
    totalNotQualifiedByAi,
    feedbackGivenCount,
    feedbackGoodCount,
    feedbackBadCount,
    precision,
    auditTotal,
    auditContacted,
    auditGood,
    auditBad,
    estimatedRecall,
  };
}
```

- [ ] **Step 2: Adicionar rota**

Em `server/routes/campaigns.ts`:

```typescript
router.get('/:id/calibration-metrics', requireAuth(), async (req, res, next) => {
  try {
    const metrics = await getCalibrationMetrics(req.params.id);
    res.json(metrics);
  } catch (e) { next(e); }
});
```

(Adicionar import de `getCalibrationMetrics`.)

- [ ] **Step 3: Smoke test manual via curl**

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/campaigns/<id>/calibration-metrics
```

Expected: JSON com `precision`, `estimatedRecall`, contagens.

- [ ] **Step 4: Commit**

```bash
git add server/services/campaignsService.ts server/routes/campaigns.ts
git commit -m "feat(campaigns): endpoint GET /campaigns/:id/calibration-metrics (precision + estimated recall)"
```

### Task F2: Frontend — card de calibração no funil da campanha

**Files:**
- Modify: `src/features/campaigns/CampaignFunnel.tsx`
- Modify: `src/features/campaigns/api.ts`

- [ ] **Step 1: API client**

Em `src/features/campaigns/api.ts`:

```typescript
import type { CampaignCalibrationMetrics } from '@shared/types';

export async function fetchCalibrationMetrics(campaignId: string): Promise<CampaignCalibrationMetrics> {
  const res = await api.get(`/campaigns/${campaignId}/calibration-metrics`);
  return res.data;
}
```

- [ ] **Step 2: Card no `CampaignFunnel.tsx`**

Adicionar card "Calibração da IA" na visão de funil (próximo ao `LossReasonsCard`):

```tsx
import { useQuery } from '@tanstack/react-query';
import { fetchCalibrationMetrics } from './api';

// no componente
const { data: cal } = useQuery({
  queryKey: ['calibration', campaignId],
  queryFn: () => fetchCalibrationMetrics(campaignId),
});

// JSX
<Card>
  <CardHeader><CardTitle>Calibração da IA</CardTitle></CardHeader>
  <CardContent className="space-y-2 text-sm">
    {!cal ? <p>—</p> : (
      <>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Qualificados pela IA</p>
            <p className="text-xl font-medium">{cal.totalQualifiedByAi}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Rejeitados pela IA</p>
            <p className="text-xl font-medium">{cal.totalNotQualifiedByAi}</p>
          </div>
        </div>
        <hr />
        <div>
          <p className="text-xs text-muted-foreground">Precisão (feedback dos qualificados)</p>
          {cal.feedbackGivenCount === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Sem dados ainda — precisa de feedback dos vendedores no Kanban.
            </p>
          ) : (
            <p className="text-xl font-medium">
              {(cal.precision! * 100).toFixed(0)}%
              <span className="text-xs text-muted-foreground ml-2">
                ({cal.feedbackGoodCount}/{cal.feedbackGivenCount} marcados bons)
              </span>
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Recall estimado (via fila cega)</p>
          {cal.auditContacted === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Sem auditoria ainda — vendedores precisam contatar leads na fila cega.
            </p>
          ) : cal.estimatedRecall == null ? (
            <p className="text-sm italic text-muted-foreground">Insuficiente pra estimar.</p>
          ) : (
            <p className="text-xl font-medium">
              {(cal.estimatedRecall * 100).toFixed(0)}%
              <span className="text-xs text-muted-foreground ml-2">
                ({cal.auditGood} falsos negativos em {cal.auditContacted} contatados)
              </span>
            </p>
          )}
        </div>
      </>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Smoke manual + commit**

Run: `npm run lint && npm run dev`

```bash
git add src/features/campaigns/CampaignFunnel.tsx src/features/campaigns/api.ts
git commit -m "feat(campaigns): card de calibração da IA no funil (precisão + recall estimado)"
```

---

# Parte G — Validação Final

### Task G1: Suite completa de testes

- [ ] **Step 1: Rodar tudo**

Run: `npm test`
Expected: zero falhas. Se houver, investigar e corrigir antes de prosseguir.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros.

### Task G2: Checklist manual end-to-end

- [ ] **Step 1: Simular fluxo completo**

Cenário A — feedback no Kanban:
1. Criar lead manualmente
2. Mover deal pra "Ganho" → diálogo exige valor + feedback → submeter
3. Verificar via psql: `select lead_quality_feedback from deals where id=...`
4. Mover outro deal pra "Perdido" com feedback "bad" → conferir activity em `deal_activities`

Cenário B — encerrar sem deal:
1. No drawer/menu do lead, clicar "Encerrar sem deal"
2. Preencher motivo + feedback → submeter
3. Verificar lead.flow_stage='lost' + campos closed_no_deal_*

Cenário C — fila cega:
1. Forçar uma decisão "não qualificado" via IA (rodar o webhook handler com uma resposta vaga)
2. Reabrir até pegar uma amostra (10% — pode precisar de várias)
3. Abrir campanha → tab "Fila cega" → clicar "Pegar próximo lead"
4. Marcar outcome → conferir status="contacted" em `audit_sample_assignments`

Cenário D — ficha do caso:
1. Abrir lead que tem ai_call_log → tab "Ficha do Caso"
2. Validar QA list, decision reason, path badge
3. Se admin, abrir reanálise → submeter → conferir nova entrada `model='reanalysis-stub'` em ai_call_logs

Cenário E — métricas:
1. Abrir campanha que já tem dados (qualificados + feedback + audit) → conferir card "Calibração da IA"
2. Validar precisão e recall estimado numericamente

- [ ] **Step 2: Commit final**

Se houver pequenos ajustes nessa rodada, commitar:
```bash
git commit -m "chore(calibracao-ia): ajustes pós-validação E2E"
```

---

# Self-Review (executar antes de submeter)

**1. Spec coverage:**
- [ ] Ficha do caso: drawer do lead + aba do deal — ✓ (E4)
- [ ] Ficha inclui pergunta da campanha quando qualificação foi direta — ✓ (A1, B2, E1, E3)
- [ ] Reanálise só admin — ✓ (E2)
- [ ] Feedback binário obrigatório em Ganho/Perda — ✓ (C1, C3)
- [ ] Captura feedback em encerramento sem deal — ✓ (C2, C4)
- [ ] Fila cega com recompensa por marcação "good" — ⚠️ PARCIAL: a UI menciona a recompensa textualmente mas o reroteamento automático do lead "good" pra fila do auditor NÃO está implementado. Decisão: virou follow-up; prioridade baixa enquanto não houver volume.
- [ ] Amostragem 10% — ✓ (D1)

**2. Placeholder scan:** revisar plano — sem "TBD", "TODO", "handle edge cases".

**3. Type consistency:**
- `LeadQualityFeedback`: usado consistente em deals + leads.closedNoDealQuality + audit outcome ✓
- `QualificationPath`: 'campaign_direct' | 'conversation' — usado nos 3 lugares ✓
- `recordAiCall` interface: estendida e propagada ✓

---

# Followups conhecidos (não MVP)

1. **Recompensa do auditor:** quando `outcome='good'` na fila cega, criar conversation/deal automaticamente atribuído ao auditor com prioridade no Kanban. Decisão de produto pendente (já incentiva via UI, falta o sistema fazer).
2. **Reanálise real:** hoje stub. Versão futura re-roda Gemini com prompt atualizado e cria novo `ai_call_log` linkado ao anterior.
3. **Few-shot dinâmico:** alimentar prompt da IA com últimos N leads rotulados bom/ruim. Depende de massa crítica de feedback.
4. **Métricas separadas por tipo de campanha:** quando houver tipos (`reativação` / `pré-venda`), filtrar métricas. Por enquanto agregação simples.
5. **Admin override de samples travados** (code review Parte D): se vendedor for desativado depois de pegar um sample, ele fica preso em `status='assigned'` sem caminho de saída. Adicionar rota `PATCH /audit/samples/:id/reassign` (admin) ou `POST /audit/samples/:id/release` que volta status=pending. Não bloqueia MVP — ocorre apenas em demissões/inativações.
6. **Correlated subquery em `listUnqualifiedLeads`** (code review Parte D): `(SELECT COUNT(*)::int FROM campaign_recipients cr2 WHERE cr2.lead_id = l.id)` roda N vezes (N=resultados). Para `LIMIT 500` é tolerável; quando virar 5000+ trocar por `COUNT(*) OVER (PARTITION BY l.id)` ou `LEFT JOIN ... GROUP BY l.id`.
7. **`enrollIfSampled` fora de transação do pipeline da IA** (code review Parte D): se servidor crashar entre `recordAiCall` e `enrollIfSampled`, perdemos amostragem desse lead (até 10% × P(crash)). Tolerável dado que amostragem já é probabilística — mas idealmente envolver ambos na mesma transação. Refator não-trivial porque `aiAtendimento.processInboundWithAi` já tem múltiplas transações pequenas.
8. **Performance da busca client-side em `CampaignUnqualifiedTab`**: `useMemo` filter em até 500 itens, OK pra MVP. Acima disso, paginação server-side ou debounced search via query param.
5. **Auditoria por gerente, não vendedor:** caso vendedor sabote a fila cega (marcar tudo "bad" rápido), pivotar pra fluxo de gerente.
