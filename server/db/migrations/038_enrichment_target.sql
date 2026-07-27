-- Migration 038: alvo do enriquecimento (Telefone 1 x Telefone 2).
--
-- Jobs de Cadastros preenchem `phone` (Telefone 1); jobs de audiência de
-- campanha preenchem `phone2` (Telefone 2). Default 'phone' preserva o
-- comportamento dos jobs existentes.

ALTER TABLE enrichment_jobs
  ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'phone';
