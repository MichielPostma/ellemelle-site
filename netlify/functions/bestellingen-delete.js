// Permanently delete an order — both the Netlify Forms submission AND the local blob state.
// POST { password, order_id }
const { getStore } = require('@netlify/blobs');
const { blobOpts, deleteSubmission } = require('./_lib/orders');

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
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  try {
    // Mark as deleted in blob first (acts as a tombstone if Forms API fails)
    const store = getStore(blobOpts('ellemelle-orders'));
    const current = (await store.get(orderId, { type: 'json' })) || {};
    await store.setJSON(orderId, { ...current, deleted: true, deleted_at: new Date().toISOString() });
    await deleteSubmission(orderId);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
