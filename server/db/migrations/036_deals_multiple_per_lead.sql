-- Migration 036: permitir MÚLTIPLOS deals por lead (recompra), mantendo no
-- máximo 1 ATIVO por lead.
--
-- Contexto: lubrificante/troca de óleo é recorrente. Cliente cuja venda foi
-- 'ganho' pode voltar dias/meses depois pedindo novo orçamento. Antes,
-- deals.lead_id era UNIQUE (1 deal por lead pra sempre) — a única saída era
-- "reativar" o card ganho, o que apagava o registro da venda anterior.
--
-- Novo modelo (padrão CRM: lead = conta, deal = ciclo de venda):
--   - deals fechados (ganho/perdido) acumulam como histórico do lead;
--   - cliente recorrente vira um NOVO card;
--   - invariante garantido no banco: no máximo 1 deal NÃO-terminal por lead.

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lead_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_deals_one_active_per_lead
  ON deals (lead_id)
  WHERE stage NOT IN ('ganho', 'perdido');
