-- 024_deal_stage_lead_no_comercial.sql
-- Adiciona etapa de triagem antes de 'proposta_enviada' no Kanban de deals.
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'lead_no_comercial' BEFORE 'proposta_enviada';
