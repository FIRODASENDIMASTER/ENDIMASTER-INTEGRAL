const OAuthClient = require('intuit-oauth');
const QuickBooks = require('node-quickbooks');
const { pool } = require('../config/db');
const { encrypt, decrypt } = require('./cryptoService');

const ENV = process.env.QBO_ENVIRONMENT || 'sandbox'; // 'sandbox' | 'production'

function newOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: ENV,
    redirectUri: process.env.QBO_REDIRECT_URI // ej: http://localhost:3000/api/connectors/quickbooks/callback
  });
}

// Paso 1: genera la URL a la que se manda al usuario para autorizar
function getAuthorizationUrl(companyId) {
  const oauthClient = newOAuthClient();
  return oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: String(companyId) // asi sabemos a que empresa pertenece el callback
  });
}

// Paso 2: intercambia el codigo recibido en el callback por tokens, y los guarda cifrados
async function handleCallback({ url, companyId }) {
  const oauthClient = newOAuthClient();
  const authResponse = await oauthClient.createToken(url);
  const token = authResponse.getJson();
  const realmId = oauthClient.getToken().realmId;

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  await pool.query(
    `INSERT INTO connector_tokens (company_id, provider, realm_id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, 'quickbooks', $2, $3, $4, $5, now())
     ON CONFLICT (company_id, provider)
     DO UPDATE SET realm_id = $2, access_token = $3, refresh_token = $4, expires_at = $5, updated_at = now()`,
    [companyId, realmId, encrypt(token.access_token), encrypt(token.refresh_token), expiresAt]
  );

  return { realmId };
}

// Refresca el access_token si ya vencio, usando el refresh_token guardado
async function getValidClient(companyId) {
  const { rows } = await pool.query(
    `SELECT * FROM connector_tokens WHERE company_id = $1 AND provider = 'quickbooks'`,
    [companyId]
  );
  if (!rows.length) {
    throw new Error(`La empresa ${companyId} no tiene QuickBooks conectado todavia.`);
  }
  const row = rows[0];
  const oauthClient = newOAuthClient();
  oauthClient.token.setToken({
    access_token: decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
    realmId: row.realm_id
  });

  if (new Date(row.expires_at) <= new Date()) {
    const refreshed = await oauthClient.refresh();
    const token = refreshed.getJson();
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    await pool.query(
      `UPDATE connector_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now()
       WHERE company_id=$4 AND provider='quickbooks'`,
      [encrypt(token.access_token), encrypt(token.refresh_token), expiresAt, companyId]
    );
  }

  const finalToken = oauthClient.getToken();
  return new QuickBooks(
    process.env.QBO_CLIENT_ID,
    process.env.QBO_CLIENT_SECRET,
    finalToken.access_token,
    false, // no token secret (OAuth2)
    row.realm_id,
    ENV === 'sandbox', // useSandbox
    false, // debug
    null,  // minor version
    '2.0',
    finalToken.refresh_token
  );
}

// Trae el reporte de Perdidas y Ganancias real de QuickBooks para un rango de fechas
function fetchProfitAndLoss(qbo, startDate, endDate) {
  return new Promise((resolve, reject) => {
    qbo.reportProfitAndLoss({ start_date: startDate, end_date: endDate }, (err, report) => {
      if (err) return reject(err);
      resolve(report);
    });
  });
}

function fetchBalanceSheet(qbo, asOfDate) {
  return new Promise((resolve, reject) => {
    qbo.reportBalanceSheet({ date: asOfDate }, (err, report) => {
      if (err) return reject(err);
      resolve(report);
    });
  });
}

// Trae el Estado de Flujo de Efectivo real de QuickBooks para un rango de fechas.
// Completa los 3 estados financieros junto con P&L y Balance General.
function fetchCashFlow(qbo, startDate, endDate) {
  return new Promise((resolve, reject) => {
    qbo.reportCashFlow({ start_date: startDate, end_date: endDate }, (err, report) => {
      if (err) return reject(err);
      resolve(report);
    });
  });
}

module.exports = {
  getAuthorizationUrl,
  handleCallback,
  getValidClient,
  fetchProfitAndLoss,
  fetchBalanceSheet,
  fetchCashFlow
};
