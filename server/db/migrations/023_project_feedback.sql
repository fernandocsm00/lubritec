-- Migration 023: Ajustes / sugestões de melhoria do projeto.
--
-- Espaço compartilhado entre Orion e Lubritec na página /projeto para
-- registro de ajustes solicitados (texto + screenshots). O time da Orion
-- marca como done conforme resolve.

CREATE TABLE project_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  content     text NOT NULL,
  images      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_feedback_created ON project_feedback(created_at DESC);
CREATE INDEX idx_project_feedback_status  ON project_feedback(status);
