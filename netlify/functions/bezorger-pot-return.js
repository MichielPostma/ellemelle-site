// Mark a delivered pot as returned + credit €1 statiegeld to the customer.
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
  const potId   = String(body.pot_id   || '').toUpperCase().trim();
  if (!orderId || !/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid order_id or pot_id' }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  }
  // Allow returning from any non-available state — the bezorger is collecting an actual pot.
  if (pot.status === 'available' || pot.status === 'returned') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot not in returnable state', current: pot.status }) };
  }

  const now = new Date().toISOString();
  await potsStore.setJSON(potId, {
    ...pot, status: 'returned', returned_at: now, returned_for_order: orderId,
  });

  // Credit customer +€1
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
        action: 'pot-returned', pot_id: potId, order_id: orderId, credit_delta: 1.0,
      });
    }
  } catch (e) { /* swallow */ }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pot_id: potId, returned_at: now }) };
};
