-- Migracion: agrega las columnas de balance general completo y flujo de efectivo
-- que faltaban. Seguro de correr aunque ya tengas datos -- no borra nada.
-- Uso: psql -U postgres -d endimaster -f db\migrate_v2_full_financials.sql

ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS other_income NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(18,2) DEFAULT 0;

ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS inventory NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS other_current_assets NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS fixed_assets NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS other_assets NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS total_assets NUMERIC(18,2) DEFAULT 0;

ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS short_term_debt NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS other_current_liabilities NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS long_term_liabilities NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS total_liabilities NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS equity NUMERIC(18,2) DEFAULT 0;

ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS operating_cash_flow NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS investing_cash_flow NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS financing_cash_flow NUMERIC(18,2) DEFAULT 0;
ALTER TABLE financial_periods ADD COLUMN IF NOT EXISTS net_cash_change NUMERIC(18,2) DEFAULT 0;
