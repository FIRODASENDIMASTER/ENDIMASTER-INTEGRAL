const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { hashPassword, comparePassword, signToken } = require('../services/authService');
const { requireAuth } = require('../middleware/authMiddleware');

// POST /api/auth/register  { email, password, fullName, companyId?, role? }
// Si se manda companyId + role, el usuario nuevo queda vinculado a esa empresa
// de una vez (util para el primer usuario = CEO de una empresa nueva).
router.post('/register', async (req, res) => {
  const { email, password, fullName, companyId, role } = req.body;
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'email, password y fullName son requeridos.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING id, email, full_name`,
      [email, passwordHash, fullName]
    );
    const user = rows[0];

    if (companyId && role) {
      await client.query(
        `INSERT INTO user_companies (user_id, company_id, role) VALUES ($1,$2,$3)`,
        [user.id, companyId, role]
      );
    }

    await client.query('COMMIT');

    const token = signToken(user.id);
    res.status(201).json({ token, user });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  } finally {
    client.release();
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos.' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Correo o contrasena incorrectos.' });

    const user = rows[0];
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Correo o contrasena incorrectos.' });

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name }
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'No se pudo iniciar sesion.' });
  }
});

// GET /api/auth/me  -> perfil + empresas a las que tiene acceso, con su rol en cada una.
// El frontend usa esto justo despues del login para saber que mostrar.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.sector, c.currency, uc.role
     FROM user_companies uc
     JOIN companies c ON c.id = uc.company_id
     WHERE uc.user_id = $1
     ORDER BY c.name`,
    [req.user.id]
  );
  res.json({ user: req.user, companies: rows });
});

module.exports = router;
