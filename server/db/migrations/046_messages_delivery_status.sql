-- Migration 046: status de entrega REAL das mensagens de saída.
--
-- Por que isto existe: até aqui o sistema não tinha NENHUMA confirmação de
-- entrega. O que a Inbox chamava de "enviada ✓✓" era só "o provedor aceitou na
-- fila dele" — a UazAPI devolve `status: "Pending"` em 100% dos sends (435/435
-- no banco de produção em 08/2026) e a Meta devolve 200 com o wamid mesmo pra
-- mensagem que vai falhar depois. Mensagem que nunca chegou ao destino ficava
-- indistinguível de mensagem lida.
--
-- Os ACKs sempre existiram e eram descartados: a UazAPI manda `messages_update`
-- (Pending→Sent→Delivered→Read→Error) e a Meta manda o array `statuses`
-- (sent/delivered/read/failed + código do erro). Agora há onde gravá-los.
--
-- NULL = mensagem anterior a esta migration. Entrega desconhecida — de
-- propósito: preencher com um status inventado repetiria a mentira que esta
-- migration existe pra corrigir.

ALTER TABLE messages
  ADD COLUMN delivery_status TEXT
    CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  ADD COLUMN delivery_status_at TIMESTAMPTZ,
  ADD COLUMN delivery_error_code TEXT,
  ADD COLUMN delivery_error_message TEXT;

-- O webhook de ACK chega com o provider_msg_id e precisa achar a linha local
-- rápido. Já existe idx_messages_provider_msgid (UNIQUE em provider+id), que
-- cobre a busca exata. Este índice cobre a busca pelo SUFIXO: a UazAPI grava o
-- id como 'owner:messageid' no send e manda só 'messageid' no update.
CREATE INDEX IF NOT EXISTS idx_messages_provider_msgid_suffix
  ON messages (split_part(provider_msg_id, ':', 2))
  WHERE provider_msg_id IS NOT NULL;

-- Fila de saída pendente de ACK — usada pra listar o que travou em 'queued'.
CREATE INDEX IF NOT EXISTS idx_messages_delivery_pending
  ON messages (delivery_status, sent_at)
  WHERE direction = 'out';
