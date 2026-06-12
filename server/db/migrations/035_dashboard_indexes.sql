-- Migration 035: índices pra agregações do dashboard.
--
-- As queries de funil/estatísticas filtram conversations por created_at e
-- contam messages por sent_by_user_id+sent_at (leaderboard/responsividade).
-- Sem índice, ambas degradam pra seq scan conforme a base cresce.
--
-- Já existem (não duplicar): idx_msg_conv_sent (conversation_id, sent_at DESC),
-- idx_leads_phone, idx_recipients_campaign_status, idx_conv_queue_status_lastmsg.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_conversations_created_at;
--   DROP INDEX IF EXISTS idx_messages_sent_by_user_sent_at;

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sent_by_user_sent_at
  ON messages(sent_by_user_id, sent_at)
  WHERE sent_by_user_id IS NOT NULL;
