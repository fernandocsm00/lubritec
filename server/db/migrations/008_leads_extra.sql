ALTER TABLE leads
  ADD COLUMN email TEXT,
  ADD COLUMN notes TEXT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'frio'
    CHECK (status IN ('frio', 'morno', 'quente')),
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'whatsapp'));

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created_at ON leads(created_at);
