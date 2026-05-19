// Track whether a "batch ready" update message has been sent to a customer.
// POST { password, order_id, status: 'sent' | 'not_sent' }
const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

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
  const status = body.status === 'sent' ? 'sent' : 'not_sent';
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };

  const store = getStore(blobOpts('ellemelle-orders'));
  const current = (await store.get(orderId, { type: 'json' })) || {};
  const next = { ...current };
  const now = new Date().toISOString();
  if (current.update_message_status !== status) {
    next.update_message_status = status;
    next.update_message_status_at = now;
    const history = Array.isArray(current.history) ? current.history.slice() : [];
    history.push({ at: now, action: 'set_update_message_status', from: current.update_message_status || 'not_sent', to: status });
    next.history = history;
    await store.setJSON(orderId, next);
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order_id: orderId, status }) };
};
