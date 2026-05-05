-- Migration 016: AI atendimento — adiciona campos de configuração da IA
-- na singleton org_settings.
--
-- Single-tenant: a Lubritec é uma única empresa. O briefing é editável pela
-- tela admin em /settings?tab=ai. ai_enabled liga/desliga globalmente.

ALTER TABLE org_settings
  ADD COLUMN ai_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_agent_name     text NOT NULL DEFAULT 'Atendente Lubritec',
  ADD COLUMN ai_business_name  text NOT NULL DEFAULT 'Lubritec',
  ADD COLUMN ai_business_desc  text NOT NULL DEFAULT '',
  ADD COLUMN ai_products       text NOT NULL DEFAULT '',
  ADD COLUMN ai_target_audience text NOT NULL DEFAULT '',
  ADD COLUMN ai_tone           text NOT NULL DEFAULT 'profissional e cordial',
  ADD COLUMN ai_objective      text NOT NULL DEFAULT 'qualificar o lead e agendar contato com o comercial',
  ADD COLUMN ai_dont_talk      text NOT NULL DEFAULT '',
  ADD COLUMN ai_always_ask     text NOT NULL DEFAULT '',
  ADD COLUMN ai_qualify_when   text NOT NULL DEFAULT 'cliente demonstrou interesse claro em comprar, pediu orçamento, ou solicitou agendamento',
  ADD COLUMN ai_business_hours text NOT NULL DEFAULT '',
  ADD COLUMN ai_after_hours_msg text NOT NULL DEFAULT '';
