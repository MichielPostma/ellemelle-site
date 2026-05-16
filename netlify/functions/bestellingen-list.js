// List all orders chronologically with stock allocation + optional filter.
const { listEnrichedOrders } = require('./_lib/orders');

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
  try {
    const { all, total_stock } = await listEnrichedOrders();
    all.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { statusCode: 200, headers, body: JSON.stringify({
      orders: all, total: all.length, total_stock,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
