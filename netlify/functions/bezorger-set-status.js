// Update an order's status manually (admin override).
// POST { password, order_id, status }
// Allowed status values: 'todo' | 'confirmed' | 'delivered' | 'neighbors' | 'retry' | 'pickup_self_requested' | 'picked_up'
// Special: when resetting to 'todo' and a pot was previously delivered, unlink the pot
// (return it to 'available' stock) so it can be re-used.

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

const ALLOWED = new Set(['todo', 'confirmed', 'delivered', 'neighbors', 'retry', 'pickup_self_requested', 'picked_up']);

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
  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const existing = (await ordersStore.get(orderId, { type: 'json' })) || {};
  const now = new Date().toISOString();

  // Reset path: if status=todo and a pot was linked, free it up.
  if (status === 'todo' && existing.delivered_pot) {
    const potId = existing.delivered_pot;
    try {
      const pot = await potsStore.get(potId, { type: 'json' });
      if (pot) {
        await potsStore.setJSON(potId, {
          ...pot, status: 'available', order_id: null, delivered_at: null,
        });
      }
    } catch {}
    const prev = existing.order_status || 'todo';
    const histR = Array.isArray(existing.history) ? existing.history.slice() : [];
    histR.push({ at: now, action: 'status_changed', from: prev, to: 'todo' });
    await ordersStore.setJSON(orderId, {
      ...existing,
      order_status: 'todo',
      status_updated_at: now,
      delivered_pot: null,
      delivered_at: null,
      pot_returned_at: null,
      history: histR,
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order_id: orderId, order_status: 'todo', unlinked_pot: potId }) };
  }

  const prevStatus = existing.order_status || 'todo';
  const hist = Array.isArray(existing.history) ? existing.history.slice() : [];
  if (prevStatus !== status) hist.push({ at: now, action: 'status_changed', from: prevStatus, to: status });

  // Sync pre-coupled pots to a delivered state when the order itself is moved into a
  // delivered-like status. This fixes the case where admin coupled a pot in advance via the
  // bestelling-detail drawer (pot.status stays 'voorraad' until bezorger-deliver), and then
  // marks the order as delivered without using /bezorger. Without this sync the customer-side
  // /pot/{id} would show "pot not recognized" because pot.status was never flipped.
  const DELIVERED_LIKE = new Set(['delivered', 'neighbors', 'picked_up']);
  const assignedPots = Array.isArray(existing.assigned_pots) ? existing.assigned_pots : [];
  const update = { ...existing, order_status: status, status_updated_at: now, history: hist };
  let syncedPotId = null;
  if (DELIVERED_LIKE.has(status) && assignedPots.length && !existing.delivered_pot) {
    for (const pid of assignedPots) {
      try {
        const pot = await potsStore.get(pid, { type: 'json' });
        if (!pot) continue;
        // Don't downgrade pots already in a different lifecycle (e.g. returned).
        if (pot.status === 'voorraad' || pot.status === 'available') {
          const potHist = Array.isArray(pot.history) ? pot.history : [];
          await potsStore.setJSON(pid, {
            ...pot,
            status: 'delivered',
            order_id: orderId,
            delivered_at: now,
            history: potHist.concat([{ at: now, action: 'delivered', order_id: orderId, via: 'set-status' }]),
          });
        }
      } catch { /* best effort */ }
    }
    // Record the first one as the canonical delivered_pot so the customer Retourpagina + downstream UI works.
    syncedPotId = assignedPots[0];
    update.delivered_pot = syncedPotId;
    update.delivered_at = now;
  }

  await ordersStore.setJSON(orderId, update);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order_id: orderId, order_status: status, delivered_pot: update.delivered_pot || null, synced_pot: syncedPotId }) };
};
