const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// Aplica el esquema base y cualquier migracion en db/*.sql automaticamente al
// arrancar el servidor. Es seguro correrlo cada vez: todo el SQL usa
// "IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS", asi que no rompe nada si ya
// se habia aplicado antes. Esto evita depender de que alguien entre a mano
// con psql en un servidor de hosting donde no hay terminal comoda.
async function initDatabase() {
  const dbDir = path.join(__dirname, '..', '..', 'db');
  const files = ['schema.sql', 'migrate_v2_full_financials.sql', 'migrate_v3_siigo_connector.sql'];

  for (const file of files) {
    const filePath = path.join(dbDir, file);
    if (!fs.existsSync(filePath)) continue;
    const sql = fs.readFileSync(filePath, 'utf8');
    try {
      await pool.query(sql);
      console.log(`[db-init] Aplicado: ${file}`);
    } catch (err) {
      console.error(`[db-init] Error aplicando ${file}:`, err.message);
      throw err;
    }
  }
}

module.exports = { initDatabase };
