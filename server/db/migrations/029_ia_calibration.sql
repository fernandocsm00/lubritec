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
