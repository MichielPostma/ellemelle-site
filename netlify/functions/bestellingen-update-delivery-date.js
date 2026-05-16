// Override the auto-computed delivery_date for a specific order.
// POST { password, order_id, delivery_date: "YYYY-MM-DD" | "" }
const { getStore } = require('@netlify/blobs');
const { blobOpts } = require('./_lib/orders');

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
  const orderId = String(body.order_id || '').trim();
  const dateStr = (body.delivery_date == null ? '' : String(body.delivery_date)).trim();
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid date (expected YYYY-MM-DD)' }) };
  }
  const store = getStore(blobOpts('ellemelle-orders'));
  const current = (await store.get(orderId, { type: 'json' })) || {};
  const next = { ...current, delivery_date_override: dateStr || null };
  await store.setJSON(orderId, next);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order: next }) };
};
