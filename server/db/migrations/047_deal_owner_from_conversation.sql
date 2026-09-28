-- Migration 047: card do Inside Sales sem dono herda o dono da conversa.
--
-- Até 28/09/2026 o dono da conversa (conversations.assigned_to) e o dono do card
-- (deals.owner_user_id) não tinham ligação: a IA criava o card sem dono ao
-- qualificar, o vendedor assumia a conversa e o card ficava "Sem dono". O código
-- agora mantém os dois juntos (syncDealOwnerWithConversation); isto acerta os
-- cards que já nasceram tortos.
--
-- Só card ABERTO e sem dono. Card fechado é histórico; card com dono foi uma
-- escolha de alguém. Lead com conversa em mais de uma linha: vale o dono da
-- conversa com mensagem mais recente. Dono desativado não herda: o card
-- continua sem dono, visível pra alguém puxar.
--
-- Não grava em deal_activities nem mexe em updated_at de propósito: o selo
-- "parado" do card é calculado pela última atividade, e uma correção de dado
-- faria o selo sumir de cards que ninguém tocou.

UPDATE deals d
SET owner_user_id = dono.assigned_to
FROM (
  SELECT DISTINCT ON (c.lead_id) c.lead_id, c.assigned_to
  FROM conversations c
  JOIN users u ON u.id = c.assigned_to AND u.is_active
  ORDER BY c.lead_id, c.last_message_at DESC
) dono
WHERE d.lead_id = dono.lead_id
  AND d.owner_user_id IS NULL
  AND d.stage NOT IN ('ganho', 'perdido');
