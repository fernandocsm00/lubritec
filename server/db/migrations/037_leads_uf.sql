-- Migration 037: UF (estado) no cadastro de leads.
-- A operacao Lubritec atende apenas RS (Rio Grande do Sul) e BA (Bahia).
-- Enum aplicado na camada de aplicacao (shared/types UF_VALUES); no banco fica
-- como TEXT nullable, seguindo o padrao dos demais campos da taxonomia.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS uf TEXT;

-- Backfill: todos os cadastros ja existentes sao do Rio Grande do Sul.
-- Os novos serao preenchidos manualmente (RS ou BA) no cadastro.
UPDATE leads SET uf = 'RS' WHERE uf IS NULL;

-- Indice para filtros/agregacoes por estado (ex.: segmentar campanhas RS x BA).
CREATE INDEX IF NOT EXISTS idx_leads_uf ON leads(uf);
