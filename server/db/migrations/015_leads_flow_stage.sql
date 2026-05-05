-- Migration 015: Add flow_stage to leads + allow nullable phone.
--
-- Why nullable phone: o fluxo macro permite subir leads com CNPJ-only
-- (sem telefone), aguardando enriquecimento via BrasilAPI/scraping/IA.
-- Conversations.phone segue NOT NULL (só leads com phone podem ter conversa).
--
-- flow_stage representa a etapa do funil macro, ortogonal ao status quente/
-- morno/frio. Stages possíveis (definidos em shared/types.ts):
--   incomplete | complete | dispatched | engaged | qualified | handed_off | lost
--
-- Backfill:
--   - leads com phone preenchido => 'complete' (pronto pra disparo)
--   - leads sem phone            => 'incomplete' (default)
--   - leads que já têm conversa  => 'engaged' (já interagiram)
--   - leads que já têm deal      => 'handed_off' (comercial assumiu)

-- 1. Permite phone NULL (CNPJ-only leads ficam aqui até enriquecimento)
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;

-- 2. Adiciona coluna flow_stage com default 'incomplete'
ALTER TABLE leads ADD COLUMN flow_stage TEXT NOT NULL DEFAULT 'incomplete';

-- 3. Backfill em ordem: stages "mais avançados" sobrescrevem os anteriores
UPDATE leads SET flow_stage = 'complete' WHERE phone IS NOT NULL AND phone <> '';

UPDATE leads SET flow_stage = 'engaged'
 WHERE EXISTS (
   SELECT 1 FROM conversations c
    WHERE c.lead_id = leads.id AND c.last_inbound_at IS NOT NULL
 );

UPDATE leads SET flow_stage = 'handed_off'
 WHERE EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = leads.id);

-- 4. Índice pra filtrar por etapa rapidamente no /cadastros e dashboards
CREATE INDEX idx_leads_flow_stage ON leads(flow_stage);
