-- Migration 034: claim atômico + retry com backoff no dispatcher de campanhas.
--
-- 'sending' = recipient foi reivindicado por uma instância do dispatcher e está
-- em voo. Impede que duas instâncias (ou dois ticks sobrepostos) enviem a mesma
-- mensagem: o claim é feito via UPDATE ... FOR UPDATE SKIP LOCKED.
--
-- attempt_count/next_attempt_at = retry com backoff exponencial pra falhas
-- TRANSIENTES do provider (5xx/429/rede). Falhas permanentes (4xx) continuam
-- indo direto pra 'failed'.
--
-- Rollback:
--   ALTER TABLE campaign_recipients DROP COLUMN attempt_count, DROP COLUMN next_attempt_at;
--   (valor de enum não tem DROP — 'sending' fica órfão, inofensivo)

ALTER TYPE campaign_recipient_status ADD VALUE IF NOT EXISTS 'sending' BEFORE 'sent';

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
