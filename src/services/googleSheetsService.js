// Integracion real con Google Sheets API (https://developers.google.com/sheets/api).
// A diferencia de QuickBooks y Siigo, este conector NO depende de que el cliente
// use un sistema contable formal -- sirve para cualquier negocio en cualquier
// pais (incluida Honduras) que ya lleve sus numeros en una hoja de calculo,
// que es el caso de la mayoria de las PYMES pequenas.
//
// Flujo: OAuth2 con Google (como QuickBooks) para autorizar lectura de Sheets,
// y despues el usuario nos dice CUAL hoja de calculo leer (no hay forma de
// adivinarlo solo con el OAuth). Esperamos un formato de columnas fijo -- ver
// la plantilla ENDIMASTER_Plantilla_Financiera.xlsx.

const { google } = require('googleapis');
const { pool } = require('../config/db');
const { encrypt, decrypt } = require('./cryptoService');

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthorizationUrl(companyId) {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // necesario para recibir refresh_token
    prompt: 'consent',      // fuerza a que SIEMPRE regrese refresh_token, incluso en reconexiones
    scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    state: String(companyId)
  });
}

async function handleCallback(code, companyId) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  const expiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

  await pool.query(
    `INSERT INTO connector_tokens (company_id, provider, realm_id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, 'google_sheets', NULL, $2, $3, $4, now())
     ON CONFLICT (company_id, provider)
     DO UPDATE SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = now()`,
    [companyId, encrypt(tokens.access_token), tokens.refresh_token ? encrypt(tokens.refresh_token) : null, expiresAt]
  );
}

// Guarda cual spreadsheet leer (se pide DESPUES del OAuth, en un segundo paso)
async function setSpreadsheetId(companyId, spreadsheetId) {
  await pool.query(
    `UPDATE connector_tokens SET realm_id = $1, updated_at = now() WHERE company_id = $2 AND provider = 'google_sheets'`,
    [spreadsheetId, companyId]
  );
}

async function getAuthorizedClient(companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM connector_tokens WHERE company_id = $1 AND provider = 'google_sheets'`,
    [companyId]
  );
  if (!rows.length) throw new Error(`La empresa ${companyId} no tiene Google Sheets conectado.`);
  const row = rows[0];
  if (!row.realm_id) throw new Error('Falta indicar cual hoja de calculo leer (spreadsheetId).');

  const client = newOAuthClient();
  client.setCredentials({
    access_token: decrypt(row.access_token),
    refresh_token: row.refresh_token ? decrypt(row.refresh_token) : undefined
  });
  return { client, spreadsheetId: row.realm_id };
}

// Lee la hoja "ENDIMASTER" del spreadsheet, con el formato de columnas fijo de
// la plantilla: Periodo, Ingresos, Costo de Ventas, Gastos Operativos, Caja,
// Cuentas por Cobrar, Cuentas por Pagar, Inventario.
async function fetchMonthlyRows(companyId) {
  const { client, spreadsheetId } = await getAuthorizedClient(companyId);
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'ENDIMASTER!A2:H1000' // fila 1 son encabezados, se ignora
  });

  const rows = res.data.values || [];
  return rows
    .filter(r => r[0]) // ignora filas vacias (sin periodo)
    .map(r => ({
      periodKey: r[0],
      revenue: parseFloat(r[1]) || 0,
      cogs: parseFloat(r[2]) || 0,
      opex: parseFloat(r[3]) || 0,
      cash: parseFloat(r[4]) || 0,
      ar: parseFloat(r[5]) || 0,
      ap: parseFloat(r[6]) || 0,
      inventory: parseFloat(r[7]) || 0
    }));
}

module.exports = { getAuthorizationUrl, handleCallback, setSpreadsheetId, fetchMonthlyRows };
