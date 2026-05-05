-- Migration 021: Log de chamadas da IA de atendimento (Sprint 6.7).
--
-- Cada call do Gemini grava 1 row aqui pra calcular custo, latência e taxa
-- de qualificação. Append-only. Indexed por created_at pra range queries.

CREATE TABLE ai_call_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_usd        numeric(10, 6) NOT NULL DEFAULT 0,
  latency_ms      integer NOT NULL DEFAULT 0,
  qualified       boolean NOT NULL DEFAULT false,
  human_intent    boolean NOT NULL DEFAULT false,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_call_logs_created_at ON ai_call_logs(created_at);
CREATE INDEX idx_ai_call_logs_qualified  ON ai_call_logs(created_at) WHERE qualified = true;
