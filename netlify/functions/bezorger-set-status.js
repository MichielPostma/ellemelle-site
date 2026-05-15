// Update an order's status (used for neighbors / retry flows).
// POST { password, order_id, status }
// Allowed status values: 'todo' | 'delivered' | 'neighbors' | 'retry'

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

const ALLOWED = new Set(['todo', 'delivered', 'neighbors', 'retry']);

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
  const status  = String(body.status   || '').toLowerCase().trim();
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  if (!ALLOWED.has(status)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid status' }) };

  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const existing = (await ordersStore.get(orderId, { type: 'json' })) || {};
  const now = new Date().toISOString();
  await ordersStore.setJSON(orderId, { ...existing, order_status: status, status_updated_at: now });

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order_id: orderId, order_status: status }) };
};
