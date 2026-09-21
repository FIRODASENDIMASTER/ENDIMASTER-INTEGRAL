const { pool } = require('../config/db');

// ===================================================================
// Los reportes de QuickBooks (P&L, Balance General, Flujo de Efectivo)
// vienen como un ARBOL de filas anidadas: una seccion como "Activos"
// contiene dentro otras secciones como "Bancos", "Cuentas por Cobrar",
// etc. El bug original buscaba los grupos solo en el primer nivel del
// arbol (rows.find(...)), por eso Caja, CxC e Inventario siempre daban
// cero -- estan anidados 2-3 niveles mas abajo. Estas funciones recorren
// el arbol completo sin importar la profundidad.
// ===================================================================

// Busca recursivamente una seccion por su nombre de grupo (ej: 'BankAccounts',
// 'AR', 'FixedAssets') en cualquier nivel del arbol, y devuelve su total (Summary).
function sectionTotal(report, groupName) {
  const found = findSection(report?.Rows?.Row || [], groupName);
  if (!found) return 0;
  const summary = found.Summary?.ColData || [];
  const value = summary[summary.length - 1]?.value;
  return parseFloat(value || '0');
}

function findSection(rows, groupName) {
  for (const row of rows) {
    if (row.group === groupName) return row;
    if (row.Rows?.Row) {
      const nested = findSection(row.Rows.Row, groupName);
      if (nested) return nested;
    }
  }
  return null;
}

// Busca una CUENTA especifica por nombre (no una seccion) recorriendo hasta las
// hojas del arbol -- por ejemplo la cuenta "Inventory Asset" dentro de
// "OtherCurrentAssets", o una cuenta de prestamo dentro de "OtherCurrentLiabilities".
// QuickBooks no separa Inventario ni Deuda de corto plazo en su propio grupo por
// defecto, asi que esto es lo mas cercano a extraerlos de forma automatica.
// Devuelve la SUMA de todas las cuentas hoja cuyo nombre haga match con el patron.
function sumLeafAccountsMatching(rows, pattern) {
  let total = 0;
  for (const row of rows) {
    if (row.Rows?.Row) {
      total += sumLeafAccountsMatching(row.Rows.Row, pattern);
    } else if (row.ColData?.length) {
      const label = row.ColData[0]?.value || '';
      if (pattern.test(label)) {
        const value = row.ColData[row.ColData.length - 1]?.value;
        total += parseFloat(value || '0');
      }
    }
  }
  return total;
}

function calcKpis({ revenue, cogs, opex }) {
  const grossProfit = revenue - cogs;
  const grossMargin = revenue !== 0 ? grossProfit / revenue : 0;
  const ebitda = grossProfit - opex;
  return { grossProfit, grossMargin, ebitda };
}

// Guarda un periodo (mes) ya calculado, listo para que el dashboard lo consuma directo.
// Recibe los 3 estados financieros de QuickBooks: P&L, Balance General y Flujo de Efectivo.
async function upsertFinancialPeriod(companyId, periodKey, pnlReport, balanceSheetReport, cashFlowReport) {
  // --- Estado de resultados (P&L) ---
  const revenue = sectionTotal(pnlReport, 'Income');
  const cogs = sectionTotal(pnlReport, 'COGS');
  const opex = sectionTotal(pnlReport, 'Expenses');
  const otherIncome = sectionTotal(pnlReport, 'OtherIncome');
  const otherExpenses = sectionTotal(pnlReport, 'OtherExpenses');
  const { ebitda, grossMargin } = calcKpis({ revenue, cogs, opex });

  // --- Balance General ---
  // Grupos reales de QuickBooks (nombres oficiales de su Report API), buscados
  // recursivamente sin importar en que nivel de anidacion esten:
  const cash = sectionTotal(balanceSheetReport, 'BankAccounts');
  const ar = sectionTotal(balanceSheetReport, 'AR');
  const otherCurrentAssets = sectionTotal(balanceSheetReport, 'OtherCurrentAssets');
  const fixedAssets = sectionTotal(balanceSheetReport, 'FixedAssets');
  const otherAssets = sectionTotal(balanceSheetReport, 'OtherAssets');
  // El total de activos es el propio resumen de la seccion "Assets" (no existe
  // un grupo hijo separado llamado "TotalAssets" en el reporte de QuickBooks).
  const totalAssets = sectionTotal(balanceSheetReport, 'Assets');

  const ap = sectionTotal(balanceSheetReport, 'AP');
  const otherCurrentLiabilities = sectionTotal(balanceSheetReport, 'OtherCurrentLiabilities');
  const longTermLiabilities = sectionTotal(balanceSheetReport, 'LongTermLiabilities');
  // Mismo caso: el total de pasivos es el resumen de la seccion "Liabilities" misma.
  const totalLiabilities = sectionTotal(balanceSheetReport, 'Liabilities');
  const equity = sectionTotal(balanceSheetReport, 'Equity');

  // Inventario y deuda de corto plazo NO tienen grupo propio en QuickBooks por
  // defecto -- van mezclados dentro de "OtherCurrentAssets"/"OtherCurrentLiabilities".
  // Los extraemos buscando cuentas hoja cuyo nombre coincida (heuristica por nombre,
  // no garantizada al 100% si el plan de cuentas del cliente usa otros nombres).
  const bsRows = balanceSheetReport?.Rows?.Row || [];
  const inventory = sumLeafAccountsMatching(bsRows, /inventory/i);
  const shortTermDebt = sumLeafAccountsMatching(bsRows, /loan|line of credit|note payable|préstamo|prestamo/i);
  // El resto de "OtherCurrentAssets" que no es inventario, y el resto de
  // "OtherCurrentLiabilities" que no es deuda de corto plazo:
  const otherCurrentAssetsNet = Math.max(otherCurrentAssets - inventory, 0);
  const otherCurrentLiabilitiesNet = Math.max(otherCurrentLiabilities - shortTermDebt, 0);

  // --- Flujo de Efectivo ---
  const operatingCashFlow = cashFlowReport ? sectionTotal(cashFlowReport, 'OperatingActivities') : 0;
  const investingCashFlow = cashFlowReport ? sectionTotal(cashFlowReport, 'InvestingActivities') : 0;
  const financingCashFlow = cashFlowReport ? sectionTotal(cashFlowReport, 'FinancingActivities') : 0;
  const netCashChange = operatingCashFlow + investingCashFlow + financingCashFlow;

  await pool.query(
    `INSERT INTO financial_periods
      (company_id, period_key, revenue, cogs, opex, other_income, other_expenses, ebitda, gross_margin,
       cash_balance, accounts_receivable, inventory, other_current_assets, fixed_assets, other_assets, total_assets,
       accounts_payable, short_term_debt, other_current_liabilities, long_term_liabilities, total_liabilities, equity,
       operating_cash_flow, investing_cash_flow, financing_cash_flow, net_cash_change,
       source, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             $10,$11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,
             'quickbooks', now())
     ON CONFLICT (company_id, period_key)
     DO UPDATE SET revenue=$3, cogs=$4, opex=$5, other_income=$6, other_expenses=$7, ebitda=$8, gross_margin=$9,
                   cash_balance=$10, accounts_receivable=$11, inventory=$12, other_current_assets=$13,
                   fixed_assets=$14, other_assets=$15, total_assets=$16,
                   accounts_payable=$17, short_term_debt=$18, other_current_liabilities=$19,
                   long_term_liabilities=$20, total_liabilities=$21, equity=$22,
                   operating_cash_flow=$23, investing_cash_flow=$24, financing_cash_flow=$25, net_cash_change=$26,
                   synced_at=now()`,
    [companyId, periodKey, revenue, cogs, opex, otherIncome, otherExpenses, ebitda, grossMargin,
     cash, ar, inventory, otherCurrentAssetsNet, fixedAssets, otherAssets, totalAssets,
     ap, shortTermDebt, otherCurrentLiabilitiesNet, longTermLiabilities, totalLiabilities, equity,
     operatingCashFlow, investingCashFlow, financingCashFlow, netCashChange]
  );

  return {
    revenue, cogs, opex, otherIncome, otherExpenses, ebitda, grossMargin,
    cash, ar, inventory, otherCurrentAssets: otherCurrentAssetsNet, fixedAssets, otherAssets, totalAssets,
    ap, shortTermDebt, otherCurrentLiabilities: otherCurrentLiabilitiesNet, longTermLiabilities, totalLiabilities, equity,
    operatingCashFlow, investingCashFlow, financingCashFlow, netCashChange
  };
}

// Trae la serie historica ya calculada, para pintar el dashboard/forecast
async function getFinancialSeries(companyId, limit = 24) {
  const { rows } = await pool.query(
    `SELECT * FROM financial_periods WHERE company_id = $1 ORDER BY period_key DESC LIMIT $2`,
    [companyId, limit]
  );
  return rows.reverse(); // orden cronologico ascendente para graficar
}

// Deteccion simple de anomalias reales: variacion mensual fuera de +/- 2 desviaciones estandar.
// Esto reemplaza al motor simulado del frontend; se puede sofisticar despues con un modelo ML.
function detectAnomalies(series, field = 'ebitda') {
  const values = series.map((r) => parseFloat(r[field]));
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
  const stdev = Math.sqrt(variance);

  return series
    .map((row, i) => {
      const z = stdev ? (values[i] - mean) / stdev : 0;
      return { period: row.period_key, value: values[i], zScore: z, isAnomaly: Math.abs(z) >= 2 };
    })
    .filter((r) => r.isAnomaly);
}

// Guarda un periodo a partir de una fila ya "plana" (no un reporte anidado como
// QuickBooks) -- usado por el conector de Google Sheets, donde el propio
// usuario ya escribio los numeros en columnas fijas.
async function upsertFinancialPeriodFromFlatRow(companyId, row, source = 'manual') {
  const { ebitda, grossMargin } = calcKpis({ revenue: row.revenue, cogs: row.cogs, opex: row.opex });
  await pool.query(
    `INSERT INTO financial_periods
      (company_id, period_key, revenue, cogs, opex, ebitda, gross_margin,
       cash_balance, accounts_receivable, accounts_payable, inventory, source, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (company_id, period_key)
     DO UPDATE SET revenue=$3, cogs=$4, opex=$5, ebitda=$6, gross_margin=$7,
                   cash_balance=$8, accounts_receivable=$9, accounts_payable=$10, inventory=$11,
                   source=$12, synced_at=now()`,
    [companyId, row.periodKey, row.revenue, row.cogs, row.opex, ebitda, grossMargin,
     row.cash, row.ar, row.ap, row.inventory, source]
  );
}

module.exports = { upsertFinancialPeriod, upsertFinancialPeriodFromFlatRow, getFinancialSeries, detectAnomalies, calcKpis };
