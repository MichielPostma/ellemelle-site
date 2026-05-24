// Take in an empty pot.
// Two scenarios:
//   1. Pure return (no swap): customer.statiegeld_credit -= 1 (deposit "refunded").
//   2. Swap (pot.status === 'pickup-with-reorder'): no credit change — deposit rolls onto
//      the new pot. The +€1 from the new order already incremented the credit at order time;
//      the −€1 we'd normally apply on return is suppressed here.
//
// The previous delivery is archived in pot.history so we still know who had it.
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

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));

  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  }
  // Can take in any pot that's currently with a customer (delivered, returned, pickup-*, etc.)
  // Already available? Nothing to do.
  if (pot.status === 'available') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot already available' }) };
  }

  // Detect swap: pot.status === 'pickup-with-reorder' means a new order was placed via
  // /pot/:id "Lege pot ophalen en nieuwe bestelling", which we treat as a swap (deposit
  // rolls onto the incoming new pot). All other return states are "pure returns".
  const isSwap = pot.status === 'pickup-with-reorder';

  const now = new Date().toISOString();
  // Archive the current trip in pot.history (with an explicit action label).
  const trip = {
    at: now,
    action: 'returned',
    kind: isSwap ? 'swap' : 'pickup',
    order_id: pot.order_id || orderId,
    delivered_at: pot.delivered_at || null,
    returned_at: now,
    returned_for_order: orderId,
    was_swap: isSwap,
  };
  const history = Array.isArray(pot.history) ? pot.history : [];
  history.push(trip);
  // Reset pot to available stock
  await potsStore.setJSON(potId, {
    ...pot,
    status: 'available',
    order_id: null,
    delivered_at: null,
    delivered_to: null,
    returned_at: null,
    returned_for_order: null,
    history,
  });

  // If this pot was tied to an order, also clear the order's delivered_pot reference
  // so the order isn't permanently marked as having a pot held.
  // (We keep order_status='delivered' so the bezorglijst stays "done" — the pot is just unbound.)
  if (pot.order_id) {
    try {
      const order = await ordersStore.get(pot.order_id, { type: 'json' });
      if (order && order.delivered_pot === potId) {
        await ordersStore.setJSON(pot.order_id, {
          ...order,
          delivered_pot: null,
          pot_returned_at: now,
          pot_returned_was_swap: isSwap,
        });
      }
    } catch {}
  }

  // Mutate customer credit on the *original* delivery's customer (not the return-order's).
  // For pure returns: -1. For swaps: no change.
  let creditMutation = null;
  if (!isSwap && pot.order_id) {
    try {
      const token = process.env.NETLIFY_API_TOKEN;
      const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${pot.order_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sub.ok) {
        const j = await sub.json();
        const d = j.data || {};
        const ck = customerKey(d);
        if (ck) {
          await appendHistory(ck, d, {
            action: 'pot-returned', pot_id: potId, order_id: orderId, credit_delta: -1,
          });
          creditMutation = { customer_key: ck, delta: -1 };
        }
      }
    } catch (e) { /* swallow */ }
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      pot_id: potId,
      returned_at: now,
      new_status: 'available',
      was_swap: isSwap,
      credit_mutation: creditMutation,
    }),
  };
};
