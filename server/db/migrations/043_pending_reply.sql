-- Migration 043: pendencia de resposta do nosso lado.
--
-- Conversa em que o cliente mandou a ultima mensagem e ninguem respondeu. O
-- slaWatchdog existente so vigia lead que ninguem ASSUMIU (assigned_to IS NULL);
-- conversa ja em atendimento passava batido.
--
-- Horario comercial NAO ganha colunas novas: ai_business_hours_start/_end/_days
-- e dispatch_timezone ja existem nesta mesma tabela e sao reaproveitados.

ALTER TABLE org_settings
  ADD COLUMN pending_reply_alert_min    integer NOT NULL DEFAULT 60,
  ADD COLUMN pending_reply_escalate_min integer NOT NULL DEFAULT 180;

-- Alertas ja disparados. A unicidade inclui pending_since (o last_inbound_at do
-- ciclo) porque estar devendo resposta e RECORRENTE: o cliente escreve, a gente
-- responde, ele escreve de novo. Sem essa coluna a conversa alertaria uma unica
-- vez na vida e o sistema pararia de avisar justamente nas conversas mais ativas.
CREATE TABLE conversation_reply_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pending_since   timestamptz NOT NULL,
  level           integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uidx_reply_alerts_cycle
  ON conversation_reply_alerts (conversation_id, pending_since, level);
