-- Migration 031: Extended fields for leads (Lubritec sales taxonomy).
-- Adiciona phone2 (telefone secundario, fallback de campanha), address1/2,
-- city, e a classificacao comercial IMBP + Segmento.
--
-- IMBP (Linha de Negocio): codigo fixo da taxonomia interna da Lubritec.
-- Segmento: agrupamento de IMBPs. Derivavel do IMBP, mas armazenado para
-- permitir filtros/agregacoes diretos sem join/case-when.
--
-- Todos os campos sao opcionais (B2B legacy: leads vindos de WhatsApp ou
-- importacoes antigas nao tem essa info).

ALTER TABLE leads
  ADD COLUMN phone2    TEXT,
  ADD COLUMN address1  TEXT,
  ADD COLUMN address2  TEXT,
  ADD COLUMN city      TEXT,
  ADD COLUMN imbp      TEXT,
  ADD COLUMN segment   TEXT;

-- Indices para filtros futuros por cidade/IMBP/segmento.
CREATE INDEX IF NOT EXISTS idx_leads_city    ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_imbp    ON leads(imbp);
CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads(segment);
