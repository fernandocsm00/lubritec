-- Migration 017: Auto-disparo "campanha contínua" (Sprint 4).
--
-- Quando um lead atinge flow_stage='complete' (telefone preenchido), ele é
-- automaticamente enrolado numa campanha contínua singleton. O dispatcher
-- existente (campaignsDispatcher.ts) processa as recipients pendentes
-- respeitando o horário comercial configurável em org_settings.

-- 1. Campos novos em campaigns
ALTER TABLE campaigns
  ADD COLUMN is_continuous boolean NOT NULL DEFAULT false,
  -- A/B testing: array de variantes [{body, mediaUrl?, mediaMime?, name?}].
  -- Quando vazio/null, usa o messageBody legado.
  ADD COLUMN message_variants jsonb;

-- Apenas uma campanha contínua ativa por vez (singleton). Partial unique index
-- garante isso a nível de banco.
CREATE UNIQUE INDEX idx_campaigns_one_continuous
  ON campaigns ((1)) WHERE is_continuous = true;

-- 2. Janela de envio respeitando horário comercial (org_settings)
ALTER TABLE org_settings
  ADD COLUMN dispatch_start_hour    integer NOT NULL DEFAULT 8,
  ADD COLUMN dispatch_end_hour      integer NOT NULL DEFAULT 18,
  ADD COLUMN dispatch_skip_weekends boolean NOT NULL DEFAULT true,
  ADD COLUMN dispatch_timezone      text NOT NULL DEFAULT 'America/Sao_Paulo';
