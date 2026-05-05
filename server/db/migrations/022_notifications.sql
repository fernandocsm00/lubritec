-- Migration 022: Centro de notificações in-app (Sprint 6.8).
--
-- Notificações dirigidas a usuários (1 row por (user_id, evento)). UI
-- mostra sino no header com badge de unread + dropdown de últimas N.

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,        -- enrichment_completed | lead_qualified | dispatch_failed | etc
  title       text NOT NULL,
  body        text NOT NULL,
  action_url  text,                  -- link clicável no dropdown ('/whatsapp', '/cadastros?flowStage=qualified', etc)
  metadata    jsonb,                 -- contexto opcional pra debug
  read_at     timestamptz,           -- null = unread
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice principal: pra cada user, listar notificações mais recentes.
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
-- Partial index pra contar unread rapidamente (queries muito frequentes do badge).
CREATE INDEX idx_notifications_user_unread  ON notifications(user_id) WHERE read_at IS NULL;
