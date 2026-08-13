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
  // STRICT invariant: only filled pots (voorraad) can be delivered.
  // Empty (available), uninitialized, returned or already-delivered pots are rejected.
  // This prevents drift like voorraad → available → delivered (which loses production_date)
  // and keeps the data model honest: a delivered pot ALWAYS has a production date.
  if (pot.status !== 'voorraad') {
    return { statusCode: 409, headers, body: JSON.stringify({
      error: `Alleen volle (voorraad) potten kunnen bezorgd worden. ${potId} heeft status: ${pot.status}.`,
      status: pot.status,
      current_order: pot.order_id,
    }) };
  }
  const existingOrder = (await ordersStore.get(orderId, { type: 'json' })) || {};
  if (existingOrder.delivered_pot) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'order already delivered', delivered_pot: existingOrder.delivered_pot }) };
  }

  const now = new Date().toISOString();
  const existingHistory = Array.isArray(pot.history) ? pot.history : [];
  // Optional scan-location for audit trail (from bezorger geolocation at scan time).
  const loc = body.scan_location;
  const validLoc = (loc && typeof loc === 'object' && Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
    ? { lat: Number(loc.lat), lng: Number(loc.lng), accuracy: Number(loc.accuracy) || null }
    : null;
  // Log the delivery event into pot.history so admin scan-drawer can show a full audit trail.
  const histEntry = {
    at: now,
    action: 'delivered',
    order_id: orderId,
    ...(validLoc ? { scan_location: validLoc } : {}),
  };
  await potsStore.setJSON(potId, {
    ...pot, status: 'delivered', order_id: orderId, delivered_at: now,
    history: existingHistory.concat([histEntry]),
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
