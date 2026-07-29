-- Migration 040: janela de "auto-reply" da IA.
--
-- Resposta que chega em menos de N segundos após o nosso disparo é quase certo
-- um auto-responder (não um humano). Nesse caso a IA responde, mas NÃO passa a
-- conversa pro Comercial — só passa quando vier uma resposta genuína (>= N s).
-- Default 15s.

ALTER TABLE org_settings
  ADD COLUMN ai_auto_reply_window_seconds INTEGER NOT NULL DEFAULT 15;
