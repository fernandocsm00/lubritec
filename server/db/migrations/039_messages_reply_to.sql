-- Migration 039: "responder citando" (quoted reply) do WhatsApp.
--
-- reply_to_message_id aponta pra mensagem citada (a que está sendo respondida).
-- Nos dois sentidos: outbound (atendente cita msg do lead) e inbound (lead cita
-- msg nossa). ON DELETE SET NULL — se a citada for apagada, a citação some.

ALTER TABLE messages
  ADD COLUMN reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
