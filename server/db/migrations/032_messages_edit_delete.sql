-- Migration 032: Edit/delete de mensagens enviadas (revoke + edit via UazAPI).
-- Espelha o comportamento nativo do WhatsApp: atendente pode apagar pra todos
-- (UazAPI POST /message/delete) e editar texto (POST /message/edit), com
-- janelas de tempo equivalentes (~48h apagar, ~15min editar).
--
-- edited_at  : NULL = nunca editada; preenchido = quando atendente editou (UI mostra "(editado)")
-- deleted_at : NULL = visivel; preenchido = msg revogada (UI mostra placeholder "Esta mensagem foi apagada")
-- original_body: snapshot do corpo ANTES da primeira edicao (debug/audit, nao mostrado no UI)
--
-- Webhook tambem usa deleted_at quando o proprio cliente apaga a msg dele
-- pelo celular (UazAPI manda messages_update status=Deleted).

ALTER TABLE messages
  ADD COLUMN edited_at     TIMESTAMPTZ,
  ADD COLUMN deleted_at    TIMESTAMPTZ,
  ADD COLUMN original_body TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at) WHERE deleted_at IS NOT NULL;
