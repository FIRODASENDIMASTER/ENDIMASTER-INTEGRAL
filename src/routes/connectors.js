const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const qbo = require('../services/quickbooksService');
const siigo = require('../services/siigoService');
const googleSheets = require('../services/googleSheetsService');
const { encrypt } = require('../services/cryptoService');
const { upsertFinancialPeriod, upsertFinancialPeriodFromFlatRow } = require('../services/kpiService');
const { requireAuth, requireCompanyAccess } = require('../middleware/authMiddleware');

// GET /api/connectors/status/:companyId -> que sistemas ya estan conectados
router.get('/status/:companyId', requireAuth, requireCompanyAccess(), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT provider, realm_id FROM connector_tokens WHERE company_id = $1`,
    [req.params.companyId]
  );
  res.json({
    connected: rows.map(r => r.provider),
    // Google Sheets necesita un segundo paso (elegir la hoja) -- avisamos si falta
    googleSheetsNeedsSpreadsheet: rows.some(r => r.provider === 'google_sheets' && !r.realm_id)
  });
});

// ===== Google Sheets =====
// Paso 1: autorizar acceso de solo lectura a Google Sheets
router.get('/googlesheets/connect/:companyId', requireAuth, requireCompanyAccess(['ceo', 'admin']), (req, res) => {
  const url = googleSheets.getAuthorizationUrl(req.params.companyId);
  res.json({ url });
});

// Paso 1b: Google redirige aqui despues de autorizar
router.get('/googlesheets/callback', async (req, res) => {
  try {
    const companyId = req.query.state;
    await googleSheets.handleCallback(req.query.code, companyId);
    // Redirige de vuelta al dashboard; el frontend detecta este parametro y
    // pide el ID de la hoja de calculo en un segundo paso.
    res.redirect(`${process.env.FRONTEND_URL}/EndiMaster_conectado.html?connected=google_sheets&needsSpreadsheet=1`);
  } catch (err) {
    console.error('[google sheets callback]', err);
    res.status(500).send('No se pudo completar la conexion con Google Sheets.');
  }
});

// Paso 2: el usuario indica cual spreadsheet leer, y sincronizamos de inmediato
router.post('/googlesheets/set-sheet', requireAuth, requireCompanyAccess(['ceo', 'admin']), async (req, res) => {
  const { spreadsheetId } = req.body;
  const companyId = req.body.companyId;
  if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId es requerido.' });

  try {
    await googleSheets.setSpreadsheetId(companyId, spreadsheetId);
    const rows = await googleSheets.fetchMonthlyRows(companyId);
    for (const row of rows) {
      await upsertFinancialPeriodFromFlatRow(companyId, row, 'google_sheets');
    }
    res.json({ message: 'Google Sheets conectado.', periodsFound: rows.length });
  } catch (err) {
    console.error('[google sheets set-sheet]', err);
    res.status(400).json({ error: 'No se pudo leer la hoja: ' + err.message + '. Verifica que el ID sea correcto y que la hoja se llame exactamente "ENDIMASTER".' });
  }
});

// ===== Siigo =====
// POST /api/connectors/siigo/connect  { companyId, username, accessKey }
router.post('/siigo/connect', requireAuth, requireCompanyAccess(['ceo', 'admin']), async (req, res) => {
  const { username, accessKey } = req.body;
  const companyId = req.params.id || req.body.companyId;

  if (!username || !accessKey) {
    return res.status(400).json({ error: 'username y accessKey son requeridos.' });
  }
  if (!process.env.SIIGO_PARTNER_ID) {
    return res.status(500).json({ error: 'El servidor no tiene configurado SIIGO_PARTNER_ID (requerido por Siigo API).' });
  }

  try {
    await siigo.siigoLogin(username, accessKey, process.env.SIIGO_PARTNER_ID);

    await pool.query(
      `INSERT INTO connector_tokens (company_id, provider, realm_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, 'siigo', $2, $3, NULL, now() + interval '100 years', now())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET realm_id = $2, access_token = $3, expires_at = now() + interval '100 years', updated_at = now()`,
      [companyId, username, encrypt(accessKey)]
    );

    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const last = today.toISOString().slice(0, 10);
    const periodKey = today.toISOString().slice(0, 7);

    const auth = await siigo.siigoLogin(username, accessKey, process.env.SIIGO_PARTNER_ID);
    const totals = await siigo.fetchMonthlyTotals(auth.access_token, process.env.SIIGO_PARTNER_ID, first, last);

    await upsertFinancialPeriod(companyId, periodKey,
      { Rows: { Row: [
        { group: 'Income', Summary: { ColData: [{ value: 'Total' }, { value: String(totals.revenue) }] } },
        { group: 'COGS', Summary: { ColData: [{ value: 'Total' }, { value: String(totals.cogs) }] } },
        { group: 'Expenses', Summary: { ColData: [{ value: 'Total' }, { value: '0' }] } }
      ]}},
      null, null
    );

    res.status(201).json({ message: 'Siigo conectado correctamente.', invoicesFound: totals.invoiceCount, purchasesFound: totals.purchaseCount });
  } catch (err) {
    console.error('[siigo connect]', err);
    res.status(400).json({ error: 'No se pudo conectar con Siigo. Verifica el usuario y la llave de acceso: ' + err.message });
  }
});

// ===== QuickBooks =====
router.get('/quickbooks/connect/:companyId', requireAuth, requireCompanyAccess(['ceo', 'admin']), (req, res) => {
  const url = qbo.getAuthorizationUrl(req.params.companyId);
  res.json({ url });
});

// Intuit redirige de vuelta aqui despues de que el usuario autoriza
router.get('/quickbooks/callback', async (req, res) => {
  try {
    const companyId = req.query.state;
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const { realmId } = await qbo.handleCallback({ url: fullUrl, companyId });

    // Trae y guarda de inmediato el mes actual, para que el usuario vea datos reales al volver
    const client = await qbo.getValidClient(companyId);
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const last = today.toISOString().slice(0, 10);
    const periodKey = today.toISOString().slice(0, 7);

    const [pnl, bs, cf] = await Promise.all([
      qbo.fetchProfitAndLoss(client, first, last),
      qbo.fetchBalanceSheet(client, last),
      qbo.fetchCashFlow(client, first, last)
    ]);
    await upsertFinancialPeriod(companyId, periodKey, pnl, bs, cf);

    // Redirige de vuelta al dashboard real (el nombre exacto del archivo, no la raiz)
    res.redirect(`${process.env.FRONTEND_URL}/EndiMaster_conectado.html?connected=quickbooks&realmId=${realmId}`);
  } catch (err) {
    console.error('[quickbooks callback]', err);
    res.status(500).send('No se pudo completar la conexion con QuickBooks. Revisa los logs del servidor.');
  }
});

module.exports = router;
