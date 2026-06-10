-- Migration 033: indice parcial pra acelerar agregacao "campanhas do lead"
-- e filtro "leads em qualquer das campanhas X". So entram registros com
-- sent_at preenchido (semantica "envio efetivado").

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_lead_sent
  ON campaign_recipients (lead_id, campaign_id)
  WHERE sent_at IS NOT NULL;
