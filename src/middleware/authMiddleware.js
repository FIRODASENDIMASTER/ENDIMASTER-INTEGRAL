const { verifyToken } = require('../services/authService');
const { pool } = require('../config/db');

// Verifica el JWT y adjunta req.user = { id, email }
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Falta el header Authorization: Bearer <token>.' });
  }

  try {
    const payload = verifyToken(token);
    const { rows } = await pool.query('SELECT id, email, full_name FROM users WHERE id = $1', [payload.sub]);
    if (!rows.length) return res.status(401).json({ error: 'Usuario no existe.' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado. Inicia sesion de nuevo.' });
  }
}

// Verifica que req.user tenga acceso a la empresa indicada en :id (o :companyId) de la ruta,
// y opcionalmente que su rol este dentro de la lista permitida.
// Uso: router.get('/:id/financials', requireAuth, requireCompanyAccess(), handler)
//      router.post('/:id/invite', requireAuth, requireCompanyAccess(['ceo','admin']), handler)
function requireCompanyAccess(allowedRoles = null) {
  return async (req, res, next) => {
    const companyId = req.params.id || req.params.companyId || req.body.companyId;
    if (!companyId) return res.status(400).json({ error: 'Falta companyId en la solicitud.' });

    const { rows } = await pool.query(
      `SELECT role FROM user_companies WHERE user_id = $1 AND company_id = $2`,
      [req.user.id, companyId]
    );

    if (!rows.length) {
      return res.status(403).json({ error: 'No tienes acceso a esta empresa.' });
    }

    const role = rows[0].role;
    if (allowedRoles && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: `Tu rol (${role}) no tiene permiso para esta accion.` });
    }

    req.companyRole = role;
    next();
  };
}

module.exports = { requireAuth, requireCompanyAccess };
