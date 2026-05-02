CREATE TABLE whatsapp_instance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton       boolean NOT NULL DEFAULT true,
  base_url        text NOT NULL,
  instance_id     text,
  instance_token  text,
  webhook_secret  text,
  webhook_url     text,
  webhook_synced  boolean NOT NULL DEFAULT false,
  phone_number    text,
  profile_name    text,
  last_status     text,
  last_status_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_whatsapp_instance_singleton
  ON whatsapp_instance(singleton);
