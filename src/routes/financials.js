const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getFinancialSeries, detectAnomalies } = require('../services/kpiService');
const { hashPassword } = require('../services/authService');
const { requireAuth, requireCompanyAccess } = require('../middleware/authMiddleware');

const VALID_ROLES = ['ceo', 'admin', 'contador', 'finanzas', 'ventas', 'rrhh', 'operaciones', 'crm'];

// Roles con permiso de ver cifras financieras completas. Ventas/RRHH/Operaciones/CRM
// veran solo sus propios modulos (eso se filtra en el frontend segun el rol que
// devuelve /api/auth/me), pero aqui protegemos tambien a nivel de API.
const FINANCIAL_ROLES = ['ceo', 'admin', 'contador', 'finanzas'];

// GET /api/companies -> SOLO las empresas a las que el usuario autenticado tiene acceso
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.sector, c.currency, uc.role
       FROM user_companies uc
       JOIN companies c ON c.id = uc.company_id
       WHERE uc.user_id = $1
       ORDER BY c.name`,
      [req.user.id]
    );
    res.json({ companies: rows });
  } catch (err) {
    console.error('[companies list]', err);
    res.status(500).json({ error: 'No se pudo listar las empresas.' });
  }
});

// POST /api/companies -> crea una empresa y hace CEO automaticamente a quien la crea
router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, sector, currency } = req.body;
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO companies (name, sector, currency) VALUES ($1,$2,$3) RETURNING id, name, sector, currency',
      [name, sector || null, currency || 'USD']
    );
    const company = rows[0];
    await client.query(
      `INSERT INTO user_companies (user_id, company_id, role) VALUES ($1,$2,'ceo')`,
      [req.user.id, company.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ company: { ...company, role: 'ceo' } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[create company]', err);
    res.status(500).json({ error: 'No se pudo crear la empresa.' });
  } finally {
    client.release();
  }
});

// GET /api/companies/:id/financials  -> requiere pertenecer a la empresa Y tener un rol financiero
router.get('/:id/financials', requireAuth, requireCompanyAccess(FINANCIAL_ROLES), async (req, res) => {
  try {
    const series = await getFinancialSeries(req.params.id);
    res.json({ companyId: req.params.id, role: req.companyRole, series });
  } catch (err) {
    console.error('[financials]', err);
    res.status(500).json({ error: 'No se pudo obtener el historial financiero.' });
  }
});

// GET /api/companies/:id/anomalies -> mismo control de acceso que financials
router.get('/:id/anomalies', requireAuth, requireCompanyAccess(FINANCIAL_ROLES), async (req, res) => {
  try {
    const series = await getFinancialSeries(req.params.id);
    const anomalies = detectAnomalies(series, req.query.field || 'ebitda');
    res.json({ companyId: req.params.id, anomalies });
  } catch (err) {
    console.error('[anomalies]', err);
    res.status(500).json({ error: 'No se pudo calcular anomalias.' });
  }
});

// POST /api/companies/:id/invite  { email, role, fullName? }
// Solo un 'ceo' o 'admin' de esa empresa puede invitar a alguien mas.
// Si el correo no existe todavia como usuario, se crea con una contrasena temporal
// (en produccion: enviarla por correo; aqui se devuelve en la respuesta solo para pruebas locales).
router.post('/:id/invite', requireAuth, requireCompanyAccess(['ceo', 'admin']), async (req, res) => {
  const { email, role, fullName } = req.body;
  const companyId = req.params.id;

  if (!email || !role) return res.status(400).json({ error: 'email y role son requeridos.' });
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Rol invalido. Usa uno de: ${VALID_ROLES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    let userId;
    let temporaryPassword = null;

    if (rows.length) {
      userId = rows[0].id;
    } else {
      temporaryPassword = crypto.randomBytes(6).toString('hex');
      const passwordHash = await hashPassword(temporaryPassword);
      const created = await client.query(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING id`,
        [email, passwordHash, fullName || email.split('@')[0]]
      );
      userId = created.rows[0].id;
    }

    await client.query(
      `INSERT INTO user_companies (user_id, company_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, company_id) DO UPDATE SET role = $3`,
      [userId, companyId, role]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Usuario vinculado a la empresa.', temporaryPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[companies/invite]', err);
    res.status(500).json({ error: 'No se pudo invitar al usuario.' });
  } finally {
    client.release();
  }
});

module.exports = router;
