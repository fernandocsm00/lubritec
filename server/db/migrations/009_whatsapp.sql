-- Enums
CREATE TYPE conversation_queue AS ENUM ('ia', 'recepcao', 'comercial');
CREATE TYPE conversation_status AS ENUM (
  'aguardando_atendimento',
  'em_atendimento',
  'encerrada'
);
CREATE TYPE message_direction AS ENUM ('in', 'out');
CREATE TYPE message_kind AS ENUM ('text', 'image', 'audio', 'video', 'document', 'unknown');

-- Conversations
CREATE TABLE conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               text NOT NULL UNIQUE,
  lead_id             uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  queue               conversation_queue NOT NULL DEFAULT 'recepcao',
  status              conversation_status NOT NULL DEFAULT 'aguardando_atendimento',
  assigned_to         uuid REFERENCES users(id) ON DELETE SET NULL,
  origin_kind         text NOT NULL DEFAULT 'organic'
                      CHECK (origin_kind IN ('organic', 'campaign')),
  origin_campaign_id  uuid,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  last_inbound_at     timestamptz,
  unread_count        int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_queue_status_lastmsg
  ON conversations(queue, status, last_message_at DESC);
CREATE INDEX idx_conv_assigned
  ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conv_origin
  ON conversations(origin_kind, origin_campaign_id);
CREATE INDEX idx_conv_last_inbound
  ON conversations(last_inbound_at) WHERE status != 'encerrada';

-- Messages
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       message_direction NOT NULL,
  kind            message_kind NOT NULL DEFAULT 'text',
  body            text,
  media_url       text,
  media_mime      text,
  sent_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  uazapi_msg_id   text UNIQUE,
  raw_payload     jsonb NOT NULL,
  sent_at         timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_msg_conv_sent ON messages(conversation_id, sent_at DESC);

-- Message templates (composer)
CREATE TABLE message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
