-- Migration 020: Inclui 'paused' no índice singleton de jobs de enriquecimento.
--
-- Sprint 6.6 adiciona pause/resume. Antes, paused job não bloqueava criação
-- de outro job. Agora o índice cobre os 3 estados "ativos".

DROP INDEX IF EXISTS idx_enrichment_jobs_singleton_active;

CREATE UNIQUE INDEX idx_enrichment_jobs_singleton_active
  ON enrichment_jobs ((1)) WHERE status IN ('pending', 'running', 'paused');
