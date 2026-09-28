-- Migration 049: card por campanha.
--
-- Até aqui o card não guardava campanha e o banco permitia 1 card aberto por
-- lead (036). A IA que qualificava um lead num re-disparo caía no card antigo
-- (caso Samuel/Diana, campanha Teste Andrei III, 25/09/2026). Agora cada card é
-- de uma campanha e o limite é 1 aberto por (lead, campanha); "sem campanha"
-- (orgânico, manual, fora da vigência) é um balde próprio.
--
-- Idempotente: o teste reexecuta este arquivo sobre um banco que já o aplicou.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Varredura de encerramento já rodou pra campanha: cada campanha fecha seus
-- cards uma vez só (card reaberto com "Reativar" depois disso fica aberto).
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS cards_closed_at TIMESTAMPTZ;

-- Backfill: campanha do último disparo ao lead ANTES da criação do card. Num
-- lead re-disparado é a campanha que de fato gerou o card, não a que abriu a
-- conversa (o selo antigo). Sem disparo antes → fica sem campanha.
UPDATE deals d
SET campaign_id = (
  SELECT cr.campaign_id
  FROM campaign_recipients cr
  WHERE cr.lead_id = d.lead_id
    AND cr.sent_at IS NOT NULL
    AND cr.sent_at <= d.created_at
  ORDER BY cr.sent_at DESC
  LIMIT 1
)
WHERE d.campaign_id IS NULL;

-- Dados legados têm no máximo 1 aberto por lead (036), então satisfazem o índice novo.
DROP INDEX IF EXISTS uidx_deals_one_active_per_lead;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_deals_one_active_per_lead_campaign
  ON deals (lead_id, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE stage NOT IN ('ganho', 'perdido');

CREATE INDEX IF NOT EXISTS idx_deals_campaign_id
  ON deals (campaign_id) WHERE campaign_id IS NOT NULL;

-- "Não mexer nos cards atuais" (decisão de 28/09/2026): campanha que já estava
-- vencida no deploy conta como varrida, senão a varredura automática fecharia
-- de uma vez todos os cards antigos. Essas só fecham pelo botão "Encerrar".
UPDATE campaigns
SET cards_closed_at = now()
WHERE validity_end IS NOT NULL
  AND validity_end < now()
  AND cards_closed_at IS NULL;
