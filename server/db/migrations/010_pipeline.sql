-- Enums
CREATE TYPE deal_stage AS ENUM (
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido'
);
CREATE TYPE loss_reason AS ENUM (
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil'
);
CREATE TYPE deal_activity_kind AS ENUM (
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed'
);

-- Deals
CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE RESTRICT,
  stage           deal_stage NOT NULL DEFAULT 'proposta_enviada',
  proposal_value  numeric(12,2),
  loss_reason     loss_reason,
  notes           text,
  owner_user_id   uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_stage_updated ON deals(stage, updated_at DESC);
CREATE INDEX idx_deals_owner ON deals(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_deals_closed_at ON deals(closed_at) WHERE closed_at IS NOT NULL;

-- Activity log
CREATE TABLE deal_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind           deal_activity_kind NOT NULL,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dealact_deal_created ON deal_activities(deal_id, created_at DESC);
