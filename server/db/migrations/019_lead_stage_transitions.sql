-- Migration 019: Lead stage transitions log (Sprint 6.3).
--
-- Cada mudança em leads.flow_stage gera 1 row aqui. Permite cohort analysis
-- (tempo médio em cada etapa, conversão por época de importação, audit trail
-- por lead). Append-only — nenhum stage update sobrescreve histórico.

CREATE TABLE lead_stage_transitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage  text,                    -- null no insert inicial
  to_stage    text NOT NULL,
  source      text NOT NULL,           -- create|manual_update|csv_import|enrichment|webhook_inbound|campaign_dispatch|ai_qualification|deal_created|...
  metadata    jsonb,                   -- contexto opcional: { campaignId, jobId, conversationId, ... }
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lst_lead_id   ON lead_stage_transitions(lead_id, changed_at DESC);
CREATE INDEX idx_lst_to_stage  ON lead_stage_transitions(to_stage, changed_at);
CREATE INDEX idx_lst_changed_at ON lead_stage_transitions(changed_at);

-- Backfill: cria 1 row "create" pra cada lead existente, usando o created_at
-- como changed_at. Isso garante que a query de avg-time-in-stage funciona pra
-- todos os leads, não só os criados depois desta migration.
INSERT INTO lead_stage_transitions (lead_id, from_stage, to_stage, source, changed_at)
SELECT id, NULL, flow_stage, 'backfill', created_at FROM leads;
