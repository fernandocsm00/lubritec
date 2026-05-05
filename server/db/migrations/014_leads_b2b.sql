-- Migration 014: Pivot leads to B2B model.
-- Wipes existing leads (and dependent rows via CASCADE — user explicitly chose
-- to start clean), drops B2C vehicle/mileage/last-purchase columns, and makes
-- CNPJ the unique business identifier (phone is no longer unique).

TRUNCATE TABLE leads RESTART IDENTITY CASCADE;

ALTER TABLE leads
  DROP COLUMN vehicle_plate,
  DROP COLUMN vehicle_model,
  DROP COLUMN last_purchase_date,
  DROP COLUMN avg_mileage_per_day;

ALTER TABLE leads DROP CONSTRAINT leads_phone_key;
CREATE INDEX idx_leads_phone ON leads(phone);

-- CNPJ is nullable so inbound WhatsApp messages from unknown numbers can still
-- create a lead with no CNPJ yet — users fill it in later. The application
-- layer enforces CNPJ as required for manual creation and CSV import. Postgres
-- UNIQUE allows multiple NULLs, which is what we want here.
ALTER TABLE leads ADD COLUMN cnpj TEXT;
ALTER TABLE leads ADD CONSTRAINT leads_cnpj_key UNIQUE (cnpj);
