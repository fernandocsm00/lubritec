-- Migration 027: Sprint de Enhances do módulo IA
--
-- Cobre as Fases 1, 2 e 3 do sprint:
--   E1 (notif WhatsApp): users.phone
--   E2 (resumo handoff): conversations.handoff_summary
--   E3 (horário comercial): org_settings.ai_business_hours_*, conversations.pending_ai_response
--   E4 (fila com tempo): conversations.entered_queue_at
--   E5 (SLA): conversation_sla_events
--
-- Referência: sprint-ia-enhances.md
-- Single-tenant: backfills usam updated_at onde aplicável.

-- --E1 / E9: telefone pessoal do vendedor (pra notificação WhatsApp) --
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text;

-- --E2, E3, E4: novos campos em conversations --
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_summary       text,
  ADD COLUMN IF NOT EXISTS entered_queue_at      timestamptz,
  ADD COLUMN IF NOT EXISTS pending_ai_response   boolean NOT NULL DEFAULT false;

-- Backfill entered_queue_at pras conversas que já estão em fila comercial.
-- Usa updated_at como aproximação — não temos o momento exato da transição.
UPDATE conversations
   SET entered_queue_at = updated_at
 WHERE queue = 'comercial'
   AND entered_queue_at IS NULL;

-- Index pra ordenação por tempo de espera + filtro de pendentes da IA.
CREATE INDEX IF NOT EXISTS idx_conversations_queue_entered
  ON conversations (queue, entered_queue_at)
  WHERE queue = 'comercial';

CREATE INDEX IF NOT EXISTS idx_conversations_pending_ai
  ON conversations (pending_ai_response)
  WHERE pending_ai_response = true;

-- --E3: horário comercial específico da IA --
-- Reaproveita o conceito de dispatchStartHour/EndHour mas mantém independente,
-- porque "horário da IA" e "janela de disparo de campanhas" não são a mesma coisa.
ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS ai_business_hours_start  integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS ai_business_hours_end    integer NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS ai_business_hours_days   text    NOT NULL DEFAULT '1,2,3,4,5',
  ADD COLUMN IF NOT EXISTS ai_24x7                  boolean NOT NULL DEFAULT false;

-- ai_business_hours_days é CSV de ISO weekdays (1=seg, ..., 7=dom).
-- Default '1,2,3,4,5' = seg a sex. Editável em Settings > IA.

-- --E5: eventos de SLA disparados (idempotência por nível) --
CREATE TABLE IF NOT EXISTS conversation_sla_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  level           integer NOT NULL CHECK (level IN (1, 2, 3)),
  fired_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_events_conv
  ON conversation_sla_events (conversation_id);

-- Garante que um nível dispara só uma vez por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_events_conv_level_uniq
  ON conversation_sla_events (conversation_id, level);
