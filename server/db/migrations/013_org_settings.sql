CREATE TABLE org_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton           boolean NOT NULL DEFAULT true,
  monthly_sales_goal  numeric(12, 2),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_org_settings_singleton
  ON org_settings(singleton);

INSERT INTO org_settings (singleton, monthly_sales_goal)
VALUES (true, NULL);
