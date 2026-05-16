// Update a single pot's status.
// POST { password, pot_id, status, production_date? }

const { setPotStatus, setProductionDate, VALID_STATUSES } = require('./_lib/inventory');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  const potId = String(body.pot_id || '').toUpperCase().trim();
  const status = String(body.status || '').toLowerCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot_id' }) };
  }
  if (!VALID_STATUSES.includes(status)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid status', allowed: VALID_STATUSES }) };
  }
  try {
    const pot = status === 'voorraad'
      ? await setProductionDate(potId, body.production_date || null)
      : await setPotStatus(potId, status);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pot }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
