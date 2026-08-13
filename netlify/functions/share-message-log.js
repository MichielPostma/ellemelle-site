// Log dat er via /bestellingen een app-bericht is gedeeld met een klant.
// POST { password, target_type: 'order' | 'customer', target_id, recipient_name?, message?, has_photo? }
//
// Voor target_type='order': appendt aan order.history (zelfde patroon als status_changed).
// Voor target_type='customer': appendt aan customer.history via appendHistory helper.
//
// Returns { ok }

const { getStore } = require('@netlify/blobs');
const { appendHistory } = require('./_lib/customer');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
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
  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const targetType = String(body.target_type || '').toLowerCase().trim();
  const targetId   = String(body.target_id   || '').trim();
  if (!targetId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing target_id' }) };
  }
  if (targetType !== 'order' && targetType !== 'customer') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'target_type must be order or customer' }) };
  }

  const now = new Date().toISOString();
  const entry = {
    at: now,
    action: 'message_shared',
    message: String(body.message || '').slice(0, 2000),
    recipient: String(body.recipient_name || '').slice(0, 100),
    has_photo: !!body.has_photo,
  };

  if (targetType === 'order') {
    const ordersStore = getStore(blobOpts('ellemelle-orders'));
    const existing = (await ordersStore.get(targetId, { type: 'json' })) || {};
    const history = Array.isArray(existing.history) ? existing.history.slice() : [];
    history.push(entry);
    await ordersStore.setJSON(targetId, { ...existing, history });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, target_type: 'order', target_id: targetId }) };
  }

  // customer
  // Customer-history accepteert profile + entry. We weten profile niet, dus stuur lege.
  try {
    await appendHistory(targetId, {}, { ts: now, ...entry });
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, target_type: 'customer', target_id: targetId }) };
};
