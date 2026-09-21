require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./config/initDb');

const authRoutes = require('./routes/auth');
const connectorsRoutes = require('./routes/connectors');
const financialsRoutes = require('./routes/financials');
const copilotRoutes = require('./routes/copilot');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/connectors', connectorsRoutes);
app.use('/api/companies', financialsRoutes);
app.use('/api/copilot', copilotRoutes);

const PORT = process.env.PORT || 3000;

// Aplica el esquema de base de datos ANTES de aceptar trafico, para que el
// primer arranque en un servidor nuevo (Render, Railway, etc.) ya quede listo
// sin que nadie tenga que correr psql a mano.
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ENDIMASTER backend escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[startup] No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
