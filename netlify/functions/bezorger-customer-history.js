// Return customer history + credit balance for the contact linked to a given order.
// POST { password, order_id }

const { customerKey, getCustomer } = require('./_lib/customer');

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

  const token = process.env.NETLIFY_API_TOKEN;
  let d = null;
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const j = await r.json();
      d = j.data || {};
    }
  } catch {}
  if (!d) return { statusCode: 404, headers, body: JSON.stringify({ error: 'order not found' }) };

  const ck = customerKey(d);
  if (!ck) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, statiegeld_credit: 0, history: [] }) };

  const cust = (await getCustomer(ck)) || { statiegeld_credit: 0, history: [] };
  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      contact_key: ck,
      statiegeld_credit: cust.statiegeld_credit || 0,
      history: cust.history || [],
    }),
  };
};
