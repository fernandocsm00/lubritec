CREATE TYPE campaign_status AS ENUM (
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'
);

CREATE TYPE campaign_recipient_status AS ENUM (
  'pending', 'sent', 'failed', 'skipped'
);

CREATE TABLE campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  description          text,
  status               campaign_status NOT NULL DEFAULT 'draft',
  template_id          uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  message_body         text NOT NULL,
  media_url            text,
  media_mime           text,
  audience_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_total       int NOT NULL DEFAULT 0,
  scheduled_at         timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  sent_count           int NOT NULL DEFAULT 0,
  failed_count         int NOT NULL DEFAULT 0,
  skipped_count        int NOT NULL DEFAULT 0,
  rate_per_minute      int NOT NULL DEFAULT 20,
  created_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled_at ON campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_campaigns_owner ON campaigns(created_by_user_id);

CREATE TABLE campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  phone           text NOT NULL,
  status          campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);

CREATE INDEX idx_recipients_campaign_status ON campaign_recipients(campaign_id, status);
CREATE INDEX idx_recipients_lead ON campaign_recipients(lead_id);

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_origin_campaign
  FOREIGN KEY (origin_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
