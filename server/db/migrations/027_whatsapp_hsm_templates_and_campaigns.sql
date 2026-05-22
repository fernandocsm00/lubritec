BEGIN;

-- whatsapp_hsm_templates
CREATE TABLE IF NOT EXISTS whatsapp_hsm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES whatsapp_instance(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED')),
  components JSONB NOT NULL,
  variable_count INT NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hsm_instance_name_lang
  ON whatsapp_hsm_templates(instance_id, name, language);
CREATE INDEX IF NOT EXISTS idx_hsm_status ON whatsapp_hsm_templates(status);

-- campaigns: instance_id + hsm_template_id + hsm_variables
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS instance_id UUID
    REFERENCES whatsapp_instance(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hsm_template_id UUID
    REFERENCES whatsapp_hsm_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hsm_variables JSONB DEFAULT '[]'::jsonb;

-- Backfill instance_id from default row
UPDATE campaigns
SET instance_id = (SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1)
WHERE instance_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campaigns WHERE instance_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set campaigns.instance_id NOT NULL: NULL values remain';
  END IF;
  ALTER TABLE campaigns ALTER COLUMN instance_id SET NOT NULL;
END $$;

COMMIT;
