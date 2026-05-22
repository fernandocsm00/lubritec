-- Multi-provider WhatsApp: add discriminator + JSONB config + multi-row support.
-- Companion script: server/scripts/encryptWhatsappCreds.ts must be run AFTER
-- this migration to: (1) encrypt the legacy plaintext creds, (2) populate
-- provider_config, (3) DROP the legacy columns.

-- -- whatsapp_instance ---------------------------------------------------
ALTER TABLE whatsapp_instance DROP COLUMN IF EXISTS singleton;

-- Give legacy plaintext columns a default so Drizzle inserts (which no longer
-- include these fields) don't violate NOT NULL. The encryption backfill script
-- will populate them and then DROP the columns.
ALTER TABLE whatsapp_instance
  ALTER COLUMN base_url SET DEFAULT '',
  ALTER COLUMN webhook_synced SET DEFAULT false;

ALTER TABLE whatsapp_instance
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('uazapi','meta_cloud')),
  ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Linha principal',
  ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

UPDATE whatsapp_instance SET is_default = true
WHERE id = (SELECT id FROM whatsapp_instance ORDER BY created_at ASC LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_instance_default
  ON whatsapp_instance ((is_default)) WHERE is_default = true;

-- -- conversations.instance_id -------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instance_id UUID
  REFERENCES whatsapp_instance(id) ON DELETE RESTRICT;

UPDATE conversations
SET instance_id = (SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1)
WHERE instance_id IS NULL;

-- IMPORTANT: only enforce NOT NULL if there are rows AND a default instance exists.
-- In a clean test DB both tables are empty so this is a safe no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversations WHERE instance_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set conversations.instance_id NOT NULL: NULL values remain';
  END IF;
  ALTER TABLE conversations ALTER COLUMN instance_id SET NOT NULL;
END $$;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_instance_phone
  ON conversations(instance_id, phone);

-- -- messages.provider + rename uazapi_msg_id ---------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi'
  CHECK (provider IN ('uazapi','meta_cloud'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'messages'
      AND column_name = 'uazapi_msg_id'
  ) THEN
    ALTER TABLE messages RENAME COLUMN uazapi_msg_id TO provider_msg_id;
  END IF;
END $$;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_uazapi_msg_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_msgid
  ON messages(provider, provider_msg_id) WHERE provider_msg_id IS NOT NULL;
