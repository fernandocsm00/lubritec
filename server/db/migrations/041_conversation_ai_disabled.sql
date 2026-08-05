-- Migration 041: chave de desligar a IA por conversa.
--
-- A IA passou a responder também a fila Recepção (antes só a fila 'ia'), então a
-- fila deixou de ser o único freio: precisamos de um freio POR CONVERSA. Assim
-- que alguém do time responde pela Inbox, marcamos ai_disabled=true e a IA nunca
-- mais fala naquela conversa — evita a IA respondendo por cima de um atendimento
-- humano em andamento. Reversível na mão pelo cabeçalho do chat.

ALTER TABLE conversations
  ADD COLUMN ai_disabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: conversas que JÁ estão com humano (fila comercial) ou que já tiveram
-- resposta de gente nascem com a IA desligada — religar é ação consciente.
--
-- Atenção: disparo de campanha também grava sent_by_user_id (o criador da
-- campanha), então "tem out com user" NÃO significa humano respondendo. Excluímos
-- as mensagens que são disparo (as que campaign_recipients aponta) — sem isso o
-- backfill desligaria a IA justamente nas conversas de campanha, que são as que
-- funcionam hoje.
UPDATE conversations c
SET ai_disabled = TRUE
WHERE c.queue = 'comercial'
   OR EXISTS (
     SELECT 1 FROM messages m
     WHERE m.conversation_id = c.id
       AND m.direction = 'out'
       AND m.sent_by_user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM campaign_recipients cr WHERE cr.message_id = m.id
       )
   );
