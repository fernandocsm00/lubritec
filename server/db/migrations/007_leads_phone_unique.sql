-- Drop dups (mantém o registro mais antigo por phone) antes de aplicar UNIQUE.
DELETE FROM leads l
USING leads l2
WHERE l.phone = l2.phone
  AND l.created_at > l2.created_at;

ALTER TABLE leads ADD CONSTRAINT leads_phone_key UNIQUE (phone);
DROP INDEX idx_leads_phone;
