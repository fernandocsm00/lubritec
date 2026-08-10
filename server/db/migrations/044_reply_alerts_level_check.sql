-- Migration 044: dominio do nivel de alerta de pendencia.
--
-- Fica separada da 043 porque aquela ja rodou. `level` entra na chave unica
-- (conversation_id, pending_since, level), entao um valor fora do dominio nao
-- colide com nada: a linha e gravada, nao deduplica contra os niveis reais e a
-- conversa volta a alertar a cada tick. Espelha o CHECK que
-- conversation_sla_events ja tem (migration 028).
--
-- 1 = alerta pro dono da conversa; 2 = escalacao pro admin.

ALTER TABLE conversation_reply_alerts
  ADD CONSTRAINT chk_reply_alerts_level CHECK (level IN (1, 2));
