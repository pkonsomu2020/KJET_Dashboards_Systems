-- ============================================================
-- KJET Co-Investment Dashboard — PostgreSQL Schema
-- Run once: psql -U kjet_user -d kjet -f schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. CLUSTERS (core identity) ──────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
  id                          SERIAL PRIMARY KEY,
  application_number          VARCHAR(30)   UNIQUE NOT NULL,
  status                      VARCHAR(20)   DEFAULT 'Submitted',
  submitted_at                TIMESTAMPTZ,
  created_at_mis              TIMESTAMPTZ,
  cluster_name                TEXT          NOT NULL,
  legal_form                  VARCHAR(50),
  registration_date           DATE,
  physical_address            TEXT,
  county                      VARCHAR(50)   NOT NULL,
  constituency                TEXT,
  ward                        TEXT,
  value_chain                 TEXT          NOT NULL,
  phone                       VARCHAR(30),
  email                       VARCHAR(150),
  insurance                   TEXT,
  signatories                 TEXT,
  executives_ownership        TEXT,
  prior_funding               TEXT,
  current_applications        BOOLEAN,
  current_applications_detail TEXT,
  vision                      TEXT,
  mission                     TEXT,
  goal_1                      TEXT,
  goal_2                      TEXT,
  goal_3                      TEXT,
  goal_4                      TEXT,
  goal_5                      TEXT,
  google_drive_folder         TEXT,
  created_at                  TIMESTAMPTZ   DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   DEFAULT NOW()
);

-- ── 2. CONTACTS (authorized rep + project manager) ───────────
CREATE TABLE IF NOT EXISTS cluster_contacts (
  id            SERIAL PRIMARY KEY,
  cluster_id    INTEGER     REFERENCES clusters(id) ON DELETE CASCADE,
  contact_type  VARCHAR(20) NOT NULL,   -- 'authorized' | 'manager'
  full_name     TEXT,
  position      TEXT,
  id_number     VARCHAR(30),
  phone         VARCHAR(30),
  email         VARCHAR(150)
);

-- ── 3. BANKING ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_banking (
  id           SERIAL PRIMARY KEY,
  cluster_id   INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  bank_name    TEXT,
  bank_account VARCHAR(60)
);

-- ── 4. MEMBERSHIP ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_membership (
  id            SERIAL PRIMARY KEY,
  cluster_id    INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  total_members INTEGER DEFAULT 0,
  men           INTEGER DEFAULT 0,
  women         INTEGER DEFAULT 0,
  youth         INTEGER DEFAULT 0,
  pwd           INTEGER DEFAULT 0
);

-- ── 5. BUSINESS NARRATIVE (Section 2) ────────────────────────
CREATE TABLE IF NOT EXISTS cluster_business (
  id                       SERIAL PRIMARY KEY,
  cluster_id               INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  business_description     TEXT,
  investment_needs         TEXT,
  market_geography         TEXT,
  market_size              TEXT,
  competitor_1             TEXT,
  competitor_2             TEXT,
  competitor_3             TEXT,
  pricing_method           TEXT,
  pricing_changes          TEXT,
  production_process       TEXT,
  installed_capacity       NUMERIC,
  installed_capacity_unit  VARCHAR(50),
  current_output           NUMERIC,
  current_output_unit      VARCHAR(50),
  capacity_utilisation_pct NUMERIC,
  main_bottleneck          TEXT
);

-- ── 6. PRODUCTS (up to 4 per cluster) ────────────────────────
CREATE TABLE IF NOT EXISTS cluster_products (
  id            SERIAL PRIMARY KEY,
  cluster_id    INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  product_order SMALLINT,
  product_name  TEXT,
  unit          VARCHAR(50),
  price_kes     NUMERIC,
  active_months TEXT
);

-- ── 7. BUYERS (up to 5 per cluster) ──────────────────────────
CREATE TABLE IF NOT EXISTS cluster_buyers (
  id             SERIAL PRIMARY KEY,
  cluster_id     INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  buyer_order    SMALLINT,
  buyer_name     TEXT,
  buyer_type     VARCHAR(50),
  annual_volume  NUMERIC,
  annual_revenue NUMERIC,
  contract_years SMALLINT
);

-- ── 8. MACHINERY ITEMS (up to 6 per cluster) ─────────────────
CREATE TABLE IF NOT EXISTS cluster_machinery (
  id             SERIAL PRIMARY KEY,
  cluster_id     INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  item_order     SMALLINT,
  description    TEXT,
  quantity       NUMERIC,
  unit_cost_kes  NUMERIC,
  total_cost_kes NUMERIC
);

-- ── 9. BUNDLED SERVICES (up to 5 per cluster) ────────────────
CREATE TABLE IF NOT EXISTS cluster_services (
  id             SERIAL PRIMARY KEY,
  cluster_id     INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  item_order     SMALLINT,
  description    TEXT,
  quantity       NUMERIC,
  unit_cost_kes  NUMERIC,
  total_cost_kes NUMERIC
);

-- ── 10. SUPPLIER QUOTATIONS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_quotations (
  id               SERIAL PRIMARY KEY,
  cluster_id       INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  item_order       SMALLINT,
  item_name        TEXT,
  quote_1          NUMERIC,
  quote_2          NUMERIC,
  quote_3          NUMERIC,
  supplier         TEXT,
  selected_price   NUMERIC,
  selection_reason TEXT
);

-- ── 11. FINANCIALS (Section 3 + Section 5) ───────────────────
CREATE TABLE IF NOT EXISTS cluster_financials (
  id                            SERIAL PRIMARY KEY,
  cluster_id                    INTEGER REFERENCES clusters(id) ON DELETE CASCADE,

  -- Section 3
  total_project_cost            NUMERIC,
  machinery_subtotal            NUMERIC,
  services_subtotal             NUMERIC,
  cluster_contribution          NUMERIC,
  grant_requested               NUMERIC,
  cluster_share_pct             NUMERIC,
  grant_share_pct               NUMERIC,
  has_vehicles                  BOOLEAN,
  implementation_timeline       TEXT,
  problem_addressed             TEXT,
  without_grant_alternative     TEXT,
  why_now                       TEXT,
  machinery_source              TEXT,
  lead_time                     TEXT,

  -- Section 5 budget
  section5_budget_total         NUMERIC,
  budget_productive_assets      NUMERIC,
  budget_productive_assets_pct  NUMERIC,
  budget_services               NUMERIC,
  budget_services_pct           NUMERIC,
  budget_working_capital        NUMERIC,
  budget_working_capital_pct    NUMERIC,
  budget_land_buildings         NUMERIC,
  budget_land_buildings_pct     NUMERIC,
  budget_preop_expenses         NUMERIC,
  budget_preop_expenses_pct     NUMERIC,
  capacity_ability_explanation  TEXT,

  -- Viability
  payback_period_years          NUMERIC,
  payback_period_notes          TEXT,
  irr_pct                       NUMERIC,
  irr_notes                     TEXT,
  npv_kes                       NUMERIC,
  npv_notes                     TEXT,

  -- Key assumptions
  key_assumption_1              TEXT,
  key_assumption_2              TEXT,
  key_assumption_3              TEXT,
  key_assumption_4              TEXT,
  key_assumption_5              TEXT,

  -- Compliance (enforced at DB level)
  compliance_status VARCHAR(30) GENERATED ALWAYS AS (
    CASE
      WHEN total_project_cost IS NULL OR total_project_cost = 0 THEN 'Missing financials'
      WHEN grant_requested > 32000000
        OR grant_requested > total_project_cost * 0.5
        OR cluster_contribution < total_project_cost * 0.5         THEN 'Review required'
      ELSE 'Within limits'
    END
  ) STORED
);

-- ── 12. PROFIT & LOSS (3 years) ───────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_pl (
  id                    SERIAL PRIMARY KEY,
  cluster_id            INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  year                  SMALLINT NOT NULL,   -- 1, 2, 3
  revenue_without       NUMERIC,
  revenue_with          NUMERIC,
  cogs_without          NUMERIC,
  cogs_with             NUMERIC,
  gross_profit_without  NUMERIC,
  gross_profit_with     NUMERIC,
  salaries_without      NUMERIC,
  salaries_with         NUMERIC,
  rent_without          NUMERIC,
  rent_with             NUMERIC,
  marketing_without     NUMERIC,
  marketing_with        NUMERIC,
  other_opex_without    NUMERIC,
  other_opex_with       NUMERIC,
  ebitda_without        NUMERIC,
  ebitda_with           NUMERIC,
  depreciation_without  NUMERIC,
  depreciation_with     NUMERIC,
  net_profit_without    NUMERIC,
  net_profit_with       NUMERIC
);

-- ── 13. CASHFLOW ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_cashflow (
  id                   SERIAL PRIMARY KEY,
  cluster_id           INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  year                 SMALLINT NOT NULL,
  month                SMALLINT,   -- 1-12 for Y1; NULL for Y2/Y3 (annual)
  opening_cash_balance NUMERIC,
  sales_inflows        NUMERIC,
  equipment_payments   NUMERIC,
  closing_cash_balance NUMERIC
);

-- ── 14. BALANCE SHEET ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_balancesheet (
  id                       SERIAL PRIMARY KEY,
  cluster_id               INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  year                     SMALLINT NOT NULL,
  asset_cash               NUMERIC,
  asset_receivables        NUMERIC,
  asset_inventory          NUMERIC,
  asset_fixed_assets_net   NUMERIC,
  liab_payables            NUMERIC,
  liab_loans               NUMERIC,
  equity_members_contrib   NUMERIC,
  equity_retained_earnings NUMERIC
);

-- ── 15. EMPLOYMENT (Section 4) ────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_employment (
  id                 SERIAL PRIMARY KEY,
  cluster_id         INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  jobs_today         INTEGER,
  jobs_year1         INTEGER,
  jobs_year3         INTEGER,
  jobs_women_today   INTEGER,
  jobs_women_year1   INTEGER,
  jobs_women_year3   INTEGER,
  jobs_youth_today   INTEGER,
  jobs_youth_year1   INTEGER,
  jobs_youth_year3   INTEGER,
  jobs_pwd_today     INTEGER,
  jobs_pwd_year1     INTEGER,
  jobs_pwd_year3     INTEGER,
  income_today       NUMERIC,
  income_year1       NUMERIC,
  income_year3       NUMERIC,
  income_assumptions TEXT
);

-- ── 16. IMPACT METRICS (Section 4) ───────────────────────────
CREATE TABLE IF NOT EXISTS cluster_impact (
  id                         SERIAL PRIMARY KEY,
  cluster_id                 INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  daily_output_today         NUMERIC,
  daily_output_after         NUMERIC,
  daily_output_pct           NUMERIC,
  capacity_today_pct         NUMERIC,
  capacity_after_pct         NUMERIC,
  reject_rate_today          NUMERIC,
  reject_rate_after          NUMERIC,
  energy_today               NUMERIC,
  energy_after               NUMERIC,
  labour_today               NUMERIC,
  labour_after               NUMERIC,
  quality_today              TEXT,
  quality_after              TEXT,
  sales_uplift_y1_units      NUMERIC,
  sales_uplift_y1_revenue    NUMERIC,
  sales_uplift_y1_assumptions TEXT,
  sales_uplift_y2_units      NUMERIC,
  sales_uplift_y2_revenue    NUMERIC,
  sales_uplift_y2_assumptions TEXT,
  sales_uplift_y3_units      NUMERIC,
  sales_uplift_y3_revenue    NUMERIC,
  sales_uplift_y3_assumptions TEXT,
  impact_local_sourcing      TEXT,
  impact_skills_transfer     TEXT,
  impact_environmental       TEXT,
  impact_food_security       TEXT,
  impact_other               TEXT
);

-- ── 17. RISKS (Section 6) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_risks (
  id             SERIAL PRIMARY KEY,
  cluster_id     INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  risk_category  VARCHAR(60) NOT NULL,
  likelihood     VARCHAR(10),   -- low | medium | high | na
  impact         VARCHAR(10),   -- low | medium | high | na
  phase          VARCHAR(20),   -- construction | operation
  mitigation     TEXT
);

-- ── 18. SUSTAINABILITY (Section 7) ───────────────────────────
CREATE TABLE IF NOT EXISTS cluster_sustainability (
  id                  SERIAL PRIMARY KEY,
  cluster_id          INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  sustainability_plan TEXT
);

-- ── 19. DOCUMENTS (file references per section) ───────────────
CREATE TABLE IF NOT EXISTS cluster_documents (
  id                SERIAL PRIMARY KEY,
  cluster_id        INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
  section           VARCHAR(15) NOT NULL,
  document_type     VARCHAR(60),
  original_filename TEXT,
  file_extension    VARCHAR(10),
  google_drive_url  TEXT,
  folder_url        TEXT
);

-- ── BETTER AUTH TABLES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_user (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  email           TEXT UNIQUE NOT NULL,
  email_verified  BOOLEAN     DEFAULT FALSE,
  image           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT        REFERENCES auth_user(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_account (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT    REFERENCES auth_user(id) ON DELETE CASCADE,
  account_id               TEXT    NOT NULL,
  provider_id              TEXT    NOT NULL,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_verification (
  id          TEXT PRIMARY KEY,
  identifier  TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clusters_county       ON clusters(county);
CREATE INDEX IF NOT EXISTS idx_clusters_value_chain  ON clusters(value_chain);
CREATE INDEX IF NOT EXISTS idx_clusters_status       ON clusters(status);
CREATE INDEX IF NOT EXISTS idx_cluster_financials_id ON cluster_financials(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_employment_id ON cluster_employment(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_membership_id ON cluster_membership(cluster_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_token    ON auth_session(token);
CREATE INDEX IF NOT EXISTS idx_auth_session_user     ON auth_session(user_id);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
