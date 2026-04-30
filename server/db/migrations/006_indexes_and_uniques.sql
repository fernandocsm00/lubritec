ALTER TABLE sessions ADD CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);
DROP INDEX idx_sessions_refresh_hash;

ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_token_hash_key UNIQUE (token_hash);

CREATE INDEX idx_leads_last_purchase_date ON leads(last_purchase_date);
