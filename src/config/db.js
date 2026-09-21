const { Pool } = require('pg');

// Usa DATABASE_URL (recomendado en Railway/Render/Fly.io) o variables sueltas.
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false }
    : {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'endimaster'
      }
);

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de PostgreSQL', err);
});

module.exports = { pool };
