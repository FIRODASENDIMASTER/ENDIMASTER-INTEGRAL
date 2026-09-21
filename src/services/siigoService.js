// Integracion real con Siigo API (https://developers.siigo.com).
// A diferencia de QuickBooks, Siigo NO usa un flujo de redireccion OAuth: el
// usuario genera sus propias credenciales dentro de Siigo Nube (menu Alianzas
// > "Mi Credencial API") y nos las entrega directamente (usuario + access_key).
// Nosotros las cambiamos por un token Bearer que expira cada 24h.
//
// NOTA DE TRANSPARENCIA: la documentacion publica de Siigo no expone un
// reporte contable tipo "Estado de Resultados" ya calculado (a diferencia de
// QuickBooks). Lo que SI esta confirmado y documentado publicamente es el
// listado de facturas de venta (/v1/invoices) y facturas de compra
// (/v1/purchases), cada una con su monto total y fecha. Por eso el ingreso y
// costo mensual aqui se calculan SUMANDO las facturas del periodo, no leyendo
// un reporte ya armado. Es un calculo legitimo, pero mas simple que el de
// QuickBooks (no separa automaticamente COGS de gastos operativos, por ejemplo).

const SIIGO_BASE_URL = 'https://api.siigo.com';

async function siigoLogin(username, accessKey, partnerId) {
  const attempts = ['/v1/auth', '/auth']; // la doc publica no es 100% consistente sobre cual path es el vigente
  let lastError;

  for (const path of attempts) {
    try {
      const res = await fetch(`${SIIGO_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Partner-Id': partnerId
        },
        body: JSON.stringify({ username, access_key: accessKey })
      });
      if (res.ok) return res.json(); // { access_token, expires_in, token_type }
      lastError = new Error(`Siigo respondio ${res.status} en ${path}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Trae TODAS las paginas de un listado (facturas o compras) dentro de un rango de fechas
async function fetchAllPages(endpoint, token, partnerId, dateStart, dateEnd) {
  const results = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `${SIIGO_BASE_URL}${endpoint}?date_start=${dateStart}&date_end=${dateEnd}&page=${page}&page_size=${pageSize}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Partner-Id': partnerId }
    });
    if (!res.ok) throw new Error(`Siigo respondio ${res.status} consultando ${endpoint}`);
    const data = await res.json();
    results.push(...(data.results || []));

    const totalResults = data.pagination?.total_results ?? results.length;
    // Nos detenemos cuando ya acumulamos tantos resultados como el total reportado,
    // o si la pagina vino vacia (evita loop infinito si Siigo cambia el formato).
    if (results.length >= totalResults || !data.results?.length) break;
    page += 1;
  }
  return results;
}

// Suma los totales de facturas de venta (ingreso) y compra (costo) de un mes,
// agrupados por mes YYYY-MM, para poblar financial_periods igual que QuickBooks.
async function fetchMonthlyTotals(token, partnerId, dateStart, dateEnd) {
  const [invoices, purchases] = await Promise.all([
    fetchAllPages('/v1/invoices', token, partnerId, dateStart, dateEnd),
    fetchAllPages('/v1/purchases', token, partnerId, dateStart, dateEnd)
  ]);

  const revenue = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  const cogs = purchases.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);

  return { revenue, cogs, invoiceCount: invoices.length, purchaseCount: purchases.length };
}

module.exports = { siigoLogin, fetchMonthlyTotals };
