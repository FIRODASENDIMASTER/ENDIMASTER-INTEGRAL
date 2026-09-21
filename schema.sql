-- ENDIMASTER — Esquema real (reemplaza a los datos simulados del frontend)
-- Ejecutar con: psql -U tu_usuario -d endimaster -f db/schema.sql

CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  sector        TEXT,
  currency      TEXT DEFAULT 'USD',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Usuarios del sistema (login real). La contrasena nunca se guarda en texto plano.
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Relacion muchos-a-muchos: un usuario puede pertenecer a varias empresas,
-- y en cada una tiene un rol distinto. Esto es lo que hace posible que un
-- contador vea solo Finanzas y el CEO vea todo.
CREATE TABLE IF NOT EXISTS user_companies (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('ceo','admin','contador','finanzas','ventas','rrhh','operaciones','crm')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

-- Credenciales OAuth de cada conector (QuickBooks, y a futuro otros).
-- Los tokens se guardan cifrados a nivel de aplicacion (ver services/crypto.js),
-- nunca en texto plano.
CREATE TABLE IF NOT EXISTS connector_tokens (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,            -- 'quickbooks', 'contpaqi', 'siigo', etc.
  realm_id        TEXT,                     -- id de la empresa en QuickBooks
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,                     -- algunos conectores (ej. Siigo) no usan refresh_token
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, provider)
);

-- Cuentas contables normalizadas (independiente del sistema de origen)
CREATE TABLE IF NOT EXISTS gl_accounts (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_id   TEXT,                       -- id en QuickBooks/Contpaqi
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,              -- 'revenue','cogs','opex','asset','liability','equity'
  UNIQUE(company_id, external_id)
);

-- Snapshot mensual ya calculado: esto es lo que el dashboard consulta directamente,
-- para no recalcular KPIs en cada carga de pantalla.
-- Incluye los 3 estados financieros completos: Estado de Resultados, Balance
-- General y Estado de Flujo de Efectivo (todos provenientes de QuickBooks).
CREATE TABLE IF NOT EXISTS financial_periods (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_key      TEXT NOT NULL,            -- '2026-08'

  -- Estado de resultados
  revenue         NUMERIC(18,2) DEFAULT 0,
  cogs            NUMERIC(18,2) DEFAULT 0,
  opex            NUMERIC(18,2) DEFAULT 0,
  other_income    NUMERIC(18,2) DEFAULT 0,
  other_expenses  NUMERIC(18,2) DEFAULT 0,
  ebitda          NUMERIC(18,2) DEFAULT 0,
  gross_margin    NUMERIC(6,3) DEFAULT 0,

  -- Balance general — activos
  cash_balance          NUMERIC(18,2) DEFAULT 0,
  accounts_receivable   NUMERIC(18,2) DEFAULT 0,
  inventory             NUMERIC(18,2) DEFAULT 0,
  other_current_assets  NUMERIC(18,2) DEFAULT 0,
  fixed_assets          NUMERIC(18,2) DEFAULT 0,
  other_assets          NUMERIC(18,2) DEFAULT 0,
  total_assets          NUMERIC(18,2) DEFAULT 0,

  -- Balance general — pasivos y patrimonio
  accounts_payable          NUMERIC(18,2) DEFAULT 0,
  short_term_debt           NUMERIC(18,2) DEFAULT 0,
  other_current_liabilities NUMERIC(18,2) DEFAULT 0,
  long_term_liabilities     NUMERIC(18,2) DEFAULT 0,
  total_liabilities         NUMERIC(18,2) DEFAULT 0,
  equity                    NUMERIC(18,2) DEFAULT 0,

  -- Estado de flujo de efectivo
  operating_cash_flow  NUMERIC(18,2) DEFAULT 0,
  investing_cash_flow  NUMERIC(18,2) DEFAULT 0,
  financing_cash_flow  NUMERIC(18,2) DEFAULT 0,
  net_cash_change      NUMERIC(18,2) DEFAULT 0,

  source          TEXT DEFAULT 'quickbooks',
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, period_key)
);

-- Transacciones crudas normalizadas (para detectar anomalias y trazabilidad)
CREATE TABLE IF NOT EXISTS transactions (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_id   TEXT,
  gl_account_id INTEGER REFERENCES gl_accounts(id),
  tx_date       DATE NOT NULL,
  amount        NUMERIC(18,2) NOT NULL,
  memo          TEXT,
  UNIQUE(company_id, external_id)
);

-- Historial de preguntas al copiloto, por empresa (da contexto y permite medir uso real)
CREATE TABLE IF NOT EXISTS copilot_messages (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,              -- 'user' | 'assistant'
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_periods_company ON financial_periods(company_id, period_key);
CREATE INDEX IF NOT EXISTS idx_transactions_company_date ON transactions(company_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_copilot_company ON copilot_messages(company_id, created_at);
