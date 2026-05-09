-- 025_campaigns_cooldown_alert.sql
-- Marca quando a notificação "muitos leads pulados por cooldown" foi enviada
-- pra essa campanha. Idempotência: notificação só dispara uma vez.
ALTER TABLE campaigns ADD COLUMN cooldown_alert_sent_at timestamptz;
