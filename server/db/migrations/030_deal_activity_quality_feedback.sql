-- 030_deal_activity_quality_feedback.sql
-- Adds 'quality_feedback' to deal_activity_kind enum (Sprint Calibração IA)

BEGIN;

ALTER TYPE deal_activity_kind ADD VALUE IF NOT EXISTS 'quality_feedback';

COMMIT;
