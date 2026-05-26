-- 030_deal_activity_quality_feedback.sql
-- Adds 'quality_feedback' to deal_activity_kind enum (Sprint Calibracao IA).
--
-- NOTA: ALTER TYPE ... ADD VALUE NAO eh rollbackable dentro de uma transacao
-- em Postgres — uma vez emitido, o valor existe ate ser removido manualmente.
-- Por isso este arquivo NAO envolve BEGIN/COMMIT: seria uma promessa falsa de
-- atomicidade. Idempotente via IF NOT EXISTS.

ALTER TYPE deal_activity_kind ADD VALUE IF NOT EXISTS 'quality_feedback';
