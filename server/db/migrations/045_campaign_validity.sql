-- Migration 045: vigencia comercial da campanha.
--
-- Distinta do ciclo do disparo, que ja existe em scheduled_at/started_at/
-- completed_at. Uma campanha termina de disparar em horas, mas a condicao
-- comercial corre por dias -- e e nesse periodo que os leads respondem. Sem
-- estas colunas nao havia como responder "quais campanhas estao vigentes".
--
-- Nulas de proposito: as campanhas que ja existem nao tiveram vigencia
-- informada, e inventar uma retroativa seria fabricar dado. Elas ficam como
-- "sem vigencia", que e distinguivel de "expirada".
--
-- O default de 7 dias corridos e resolvido NA CRIACAO e gravado aqui, nao
-- calculado na leitura: se a regra mudar, as campanhas antigas mantem a
-- vigencia que de fato valeu na epoca.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS validity_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validity_end   TIMESTAMPTZ;

-- Fim anterior ao inicio e erro de digitacao, nao estado valido.
ALTER TABLE campaigns
  ADD CONSTRAINT chk_campaigns_validity_order
  CHECK (validity_start IS NULL OR validity_end IS NULL OR validity_end >= validity_start);

-- Consulta do selo/filtro: "vigentes agora" varre por validity_end.
CREATE INDEX IF NOT EXISTS idx_campaigns_validity_end
  ON campaigns (validity_end) WHERE validity_end IS NOT NULL;
