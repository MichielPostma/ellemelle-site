// List all 25 pots + app config (next_production_date) + counts per status.
// POST { password }

const { listAllPots, getAppConfig, countInStock } = require('./_lib/inventory');

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
  const pots = await listAllPots();
  const counts = pots.reduce((m, p) => { m[p.status||'uninitialized']=(m[p.status||'uninitialized']||0)+1; return m; }, {});
  const cfg = await getAppConfig();
  const stock = await countInStock();
  return { statusCode: 200, headers, body: JSON.stringify({
    pots, counts, stock_count: stock, config: cfg,
  }) };
};
