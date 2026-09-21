require('dotenv').config();
const cron = require('node-cron');
const { pool } = require('../config/db');
const qbo = require('../services/quickbooksService');
const { upsertFinancialPeriod } = require('../services/kpiService');

async function syncCompany(companyId) {
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

  const kpis = await upsertFinancialPeriod(companyId, periodKey, pnl, bs, cf);
  console.log(`[sync] Empresa ${companyId} actualizada:`, kpis);
}

async function syncAllCompanies() {
  const { rows } = await pool.query(
    `SELECT DISTINCT company_id FROM connector_tokens WHERE provider = 'quickbooks'`
  );
  for (const row of rows) {
    try {
      await syncCompany(row.company_id);
    } catch (err) {
      console.error(`[sync] Fallo al sincronizar empresa ${row.company_id}:`, err.message);
    }
  }
}

const runOnce = process.argv.includes('--once');

if (runOnce) {
  syncAllCompanies().then(() => process.exit(0));
} else {
  // Corre cada hora. Ajusta segun cuanta frecuencia de datos necesites.
  cron.schedule('0 * * * *', () => {
    console.log('[sync] Iniciando sincronizacion programada...');
    syncAllCompanies();
  });
  console.log('[sync] Worker de sincronizacion activo (cada hora).');
}
