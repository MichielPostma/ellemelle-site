// Record a delivery: pot is scanned at a customer.
// POST { password, order_id, pot_id }

const { getStore } = require('@netlify/blobs');
const { customerKey, appendHistory } = require('./_lib/customer');

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
  const potId   = String(body.pot_id   || '').trim().toUpperCase();
  if (!orderId || !/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid order_id or pot_id' }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));

  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found — run seed-pots first' }) };
  }
  // Accept pots that are EITHER empty (available) OR ready-to-ship (voorraad).
  // Voorraad pots come straight off the production shelf and get delivered to a customer
  // in one scan via the admin scan-FAB flow.
  if (pot.status !== 'available' && pot.status !== 'voorraad') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot not available or voorraad', status: pot.status, current_order: pot.order_id }) };
  }
  const existingOrder = (await ordersStore.get(orderId, { type: 'json' })) || {};
  if (existingOrder.delivered_pot) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'order already delivered', delivered_pot: existingOrder.delivered_pot }) };
  }

  const now = new Date().toISOString();
  await potsStore.setJSON(potId, {
    ...pot, status: 'delivered', order_id: orderId, delivered_at: now,
  });
  await ordersStore.setJSON(orderId, {
    ...existingOrder, delivered_pot: potId, delivered_at: now, order_status: 'delivered',
  });

  // Log customer history (best-effort, non-blocking errors)
  try {
    const token = process.env.NETLIFY_API_TOKEN;
    const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sub.ok) {
      const j = await sub.json();
      const d = j.data || {};
      const ck = customerKey(d);
      if (ck) await appendHistory(ck, d, {
        action: 'pot-delivered', pot_id: potId, order_id: orderId
      });
    }
  } catch (e) { /* swallow */ }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, pot_id: potId, order_id: orderId, delivered_at: now }),
  };
};
