-- Migration 042: valor de orçamento lido de print, aguardando confirmação humana.
--
-- O time monta orçamento num ERP fechado (sem API) e manda print pro cliente. O
-- valor total fica só nos pixels, e hoje NENHUM deal em 'proposta_enviada' tem
-- proposal_value preenchido — o pipeline não tem previsão de receita.
--
-- Guardamos por MENSAGEM, não em deals, por dois motivos: a detecção pode
-- acontecer antes de o deal existir, e assim fica o rastro de qual imagem gerou
-- qual valor (necessário pra responder "por que esse card está R$ 3.443?").

CREATE TABLE budget_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  detected_value NUMERIC(12,2) NOT NULL,
  detected_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmed_value NUMERIC(12,2),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma detecção por mensagem — o reprocessamento do mesmo envio não duplica card.
CREATE UNIQUE INDEX uidx_budget_detections_message ON budget_detections (message_id);

-- O painel consulta "tem pendente pra esse lead?" a cada render da conversa.
CREATE INDEX idx_budget_detections_pending
  ON budget_detections (lead_id, created_at DESC)
  WHERE status = 'pending';
