-- Migracion v3: permite conectores que no usan refresh_token (como Siigo,
-- que se re-autentica con usuario+llave en vez de un flujo OAuth con refresh).
-- Seguro de correr aunque ya tengas datos.
-- Uso: psql -U postgres -d endimaster -f db\migrate_v3_siigo_connector.sql

ALTER TABLE connector_tokens ALTER COLUMN refresh_token DROP NOT NULL;

-- Permite guardar 'siigo' como proveedor valido (ya no hay restriccion CHECK
-- explicita en esta tabla, pero dejamos documentado el conjunto de valores usados)
COMMENT ON COLUMN connector_tokens.provider IS 'quickbooks | siigo | (futuros conectores)';
