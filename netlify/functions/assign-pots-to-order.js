// Admin: link one or more in-stock pots (status=voorraad) to a specific order, OR clear them.
// POST { password, order_id, pot_ids: string[] }
//
// Side-effects:
//   - For each pot in pot_ids:    pot.order_id = order_id (status stays 'voorraad' until bezorger delivers)
//   - For pots that WERE on this order but aren't in the new list: pot.order_id cleared
//   - Order blob:                 order.assigned_pots = pot_ids (sorted)
//
// Guards:
//   - Each new pot must exist + status='voorraad' + (no order_id OR order_id===this order)
//   - Order must exist (orderBlob is created if missing, since orders blob is sparse)
//   - Statuses that already have a final pot link (delivered etc.) reject — coupling pre-delivery only

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

// Statuses where pre-delivery pot coupling is meaningful.
const COUPLE_OK_STATUSES = new Set(['todo', 'confirmed', 'retry']);

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

  const orderId  = String(body.order_id || '').trim();
  const requested = Array.isArray(body.pot_ids) ? body.pot_ids.map(s => String(s || '').toUpperCase().trim()) : [];
  if (!orderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  }
  for (const pid of requested) {
    if (!/^POT-\d{3}$/.test(pid)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id', pot_id: pid }) };
    }
  }
  // De-dup + sort for stable storage
  const desired = [...new Set(requested)].sort();

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const orderBlob = (await ordersStore.get(orderId, { type: 'json' })) || {};

  // Reject coupling on orders that have already been delivered / are post-delivery.
  // We rely on the saved order_status in the blob; if blob has no status, default to 'todo' (ok to couple).
  const status = orderBlob.order_status || 'todo';
  if (!COUPLE_OK_STATUSES.has(status)) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'order status does not allow coupling', status }) };
  }

  // Validate desired pots — each must exist, be in voorraad, and not booked to a different order.
  const desiredPots = [];
  for (const pid of desired) {
    const p = await potsStore.get(pid, { type: 'json' });
    if (!p) return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found', pot_id: pid }) };
    if (p.status !== 'voorraad') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot not in voorraad', pot_id: pid, status: p.status }) };
    }
    if (p.order_id && p.order_id !== orderId) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot already linked to another order', pot_id: pid, other_order: p.order_id }) };
    }
    desiredPots.push(p);
  }

  // Previously linked pots: drop any that are no longer in the desired set.
  const previous = Array.isArray(orderBlob.assigned_pots) ? orderBlob.assigned_pots : [];
  const desiredSet = new Set(desired);
  const toRemove = previous.filter(pid => !desiredSet.has(pid));

  for (const pid of toRemove) {
    const p = await potsStore.get(pid, { type: 'json' });
    if (!p) continue;
    if (p.order_id !== orderId) continue;       // only unlink ones we actually own
    if (p.status === 'delivered') continue;     // never undo a delivery
    const { order_id, ...rest } = p;            // strip order_id field
    await potsStore.setJSON(pid, rest);
  }

  // Link desired pots — set order_id, keep status as voorraad.
  for (const p of desiredPots) {
    if (p.order_id === orderId) continue;       // already linked, no write needed
    await potsStore.setJSON(p.id, { ...p, order_id: orderId });
  }

  // Persist on the order blob.
  await ordersStore.setJSON(orderId, { ...orderBlob, assigned_pots: desired });

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, order_id: orderId, assigned_pots: desired, removed: toRemove }),
  };
};
