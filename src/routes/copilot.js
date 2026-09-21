const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { getFinancialSeries, detectAnomalies } = require('../services/kpiService');
const { requireAuth, requireCompanyAccess } = require('../middleware/authMiddleware');

// Arma el contexto real de la empresa para que el modelo responda con datos verdaderos,
// no con lo que "cree" que es cierto. Esto es lo que reemplaza a buildSystemPrompt() del HTML.
async function buildSystemPrompt(companyId) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
  const company = rows[0];
  const series = await getFinancialSeries(companyId, 12);
  const anomalies = detectAnomalies(series);

  const last = series[series.length - 1] || {};
  const prev = series[series.length - 2] || {};

  return `Eres el copiloto financiero de ENDIMASTER para la empresa "${company?.name || 'sin nombre'}" (sector: ${company?.sector || 'N/D'}).
Responde SIEMPRE basandote en los datos reales entregados abajo, nunca inventes cifras.

Ultimo periodo disponible (${last.period_key || 'N/D'}):
- Ingresos: ${last.revenue ?? 'N/D'}
- EBITDA: ${last.ebitda ?? 'N/D'}
- Margen bruto: ${last.gross_margin ?? 'N/D'}
- Caja: ${last.cash_balance ?? 'N/D'}
- Cuentas por cobrar: ${last.accounts_receivable ?? 'N/D'}
- Cuentas por pagar: ${last.accounts_payable ?? 'N/D'}

Periodo anterior (${prev.period_key || 'N/D'}):
- EBITDA: ${prev.ebitda ?? 'N/D'}

Anomalias detectadas en los ultimos 12 meses: ${anomalies.length
    ? anomalies.map((a) => `${a.period} (z=${a.zScore.toFixed(2)})`).join(', ')
    : 'ninguna'}.

Estructura tu respuesta en: Respuesta ejecutiva, Evidencia, Impacto, Nivel de confianza, Recomendacion.
Se breve, concreto y en espanol.`;
}

// POST /api/copilot/ask  { companyId, question }
// Cualquier rol vinculado a la empresa puede preguntar (el contexto que arma
// buildSystemPrompt ya esta limitado a datos financieros; si mas adelante agregas
// contexto de RRHH/Ventas, filtra ahi mismo segun req.companyRole).
router.post('/ask', requireAuth, requireCompanyAccess(), async (req, res) => {
  const { companyId, question } = req.body;
  if (!companyId || !question) {
    return res.status(400).json({ error: 'companyId y question son requeridos.' });
  }

  try {
    await pool.query(
      `INSERT INTO copilot_messages (company_id, role, content) VALUES ($1,'user',$2)`,
      [companyId, question]
    );

    const { rows: history } = await pool.query(
      `SELECT role, content FROM copilot_messages WHERE company_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [companyId]
    );

    const systemPrompt = await buildSystemPrompt(companyId);

    // La API key vive SOLO aqui, en el servidor. Nunca se envia al navegador.
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: history.reverse().map((m) => ({ role: m.role, content: m.content }))
      })
    });

    const data = await response.json();
    const text = (data.content || []).map((b) => b.text || '').join('\n') || 'No pude generar una respuesta en este momento.';

    await pool.query(
      `INSERT INTO copilot_messages (company_id, role, content) VALUES ($1,'assistant',$2)`,
      [companyId, text]
    );

    res.json({ answer: text });
  } catch (err) {
    console.error('[copilot ask]', err);
    res.status(500).json({ error: 'No se pudo conectar con el motor de IA en este momento.' });
  }
});

module.exports = router;
