-- Migration 018: Bulk enrichment jobs (Sprint 6.1).
--
-- Worker em background processa leads incomplete via BrasilAPI respeitando
-- rate limit (~3 req/min = 21s entre chamadas). Pra 3k leads roda ~17h.
-- Singleton: apenas um job ativo (running/pending) por vez — partial unique
-- index garante isso.

CREATE TABLE enrichment_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status               text NOT NULL DEFAULT 'pending',  -- pending | running | completed | cancelled
  total_leads          integer NOT NULL,
  processed_count      integer NOT NULL DEFAULT 0,
  succeeded_count      integer NOT NULL DEFAULT 0,       -- phone_found
  failed_count         integer NOT NULL DEFAULT 0,       -- todos os outros status
  started_at           timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  last_error           text,
  created_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Apenas um job ativo (pending OU running) por vez.
CREATE UNIQUE INDEX idx_enrichment_jobs_singleton_active
  ON enrichment_jobs ((1)) WHERE status IN ('pending', 'running');

-- Snapshot de leads no momento que o job foi criado. Worker pega o próximo
-- pending, processa, marca como succeeded/failed.
CREATE TABLE enrichment_job_leads (
  job_id         uuid NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
  lead_id        uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending',  -- pending | succeeded | failed
  result_status  text,  -- phone_found | phone_not_in_brasilapi | cnpj_not_found | cnpj_inactive | api_error
  phone_found    text,
  error_message  text,
  processed_at   timestamptz,
  PRIMARY KEY (job_id, lead_id)
);

-- Índice pra worker pegar o próximo pending rapidamente.
CREATE INDEX idx_ejl_pending ON enrichment_job_leads(job_id) WHERE status = 'pending';
