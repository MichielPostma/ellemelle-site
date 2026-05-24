// One-shot admin endpoint to recompute statiegeld_credit for every customer
// according to the new model (credit = #pots currently outstanding × €1).
//
// Definition of "outstanding":
//   - Pots physically with the customer (pot.status in delivered/pickup-requested/pickup-with-reorder)
//   - Plus pots already paid for via an open order (order_status !== delivered/neighbors AND no delivered_pot yet)
//
// Computed from current state only (no history walk), so it's robust against legacy data
// without was_swap markers.
//
// Side effects (when not dry_run):
//   - Sets customer.statiegeld_credit = computed value (absolute)
//   - Stamps order.credit_applied = true on every order so the lazy hook in orders.js
//     doesn't double-add on next read.
//
// POST { password, dry_run? }

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders, blobOpts } = require('./_lib/orders');
const { customerKey, getCustomer, setCreditAbsolute } = require('./_lib/customer');
const { POT_IDS } = require('./_lib/inventory');

const HELD_POT_STATUSES = new Set(['delivered', 'pickup-requested', 'pickup-with-reorder']);

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
  const dryRun = !!body.dry_run;

  try {
    const { all: orders } = await listEnrichedOrders();
    const ordersStore = getStore(blobOpts('ellemelle-orders'));
    const potsStore   = getStore(blobOpts('ellemelle-pots'));
    const orderStates = await Promise.all(
      orders.map(o => ordersStore.get(o.id, { type: 'json' }).catch(() => ({})))
    );
    const pots = await Promise.all(
      POT_IDS.map(pid => potsStore.get(pid, { type: 'json' }).then(p => p && { id: pid, ...p }).catch(() => null))
    );

    // Build orderId → { ck, profile, is_delivered } map
    const orderInfo = new Map();
    const customerProfiles = new Map();
    for (const o of orders) {
      const profile = {
        voornaam: o.voornaam, kanaal: o.kanaal,
        telefoon: o.telefoon, email: o.email,
      };
      const ck = customerKey(profile);
      orderInfo.set(o.id, {
        ck,
        profile,
        aantal: o.aantal || 1,
        order_status: o.order_status,
        delivered_pot: o.delivered_pot,
      });
      if (ck && !customerProfiles.has(ck)) customerProfiles.set(ck, profile);
    }

    // Compute credit per customer
    const credit = new Map(); // ck → number
    const breakdown = new Map(); // ck → { held: n, pending: n }

    // (a) Pots currently HELD by a customer
    for (const p of pots) {
      if (!p || !HELD_POT_STATUSES.has(p.status) || !p.order_id) continue;
      const info = orderInfo.get(p.order_id);
      if (!info || !info.ck) continue;
      credit.set(info.ck, (credit.get(info.ck) || 0) + 1);
      const br = breakdown.get(info.ck) || { held: 0, pending: 0 };
      br.held += 1;
      breakdown.set(info.ck, br);
    }

    // (b) Pots already ORDERED but not yet delivered (paid deposit, awaiting fulfilment)
    for (const o of orders) {
      const info = orderInfo.get(o.id);
      if (!info || !info.ck) continue;
      const isClosed = ['delivered', 'neighbors'].includes(o.order_status);
      if (isClosed) continue;
      // Open order — add aantal as "pending". (Held pots are tracked above, but open orders
      // never have a delivered_pot yet — it's set when the bezorger marks delivery.)
      const pending = info.aantal;
      credit.set(info.ck, (credit.get(info.ck) || 0) + pending);
      const br = breakdown.get(info.ck) || { held: 0, pending: 0 };
      br.pending += pending;
      breakdown.set(info.ck, br);
    }

    const changes = [];
    if (!dryRun) {
      // Stamp credit_applied on every order so the lazy hook doesn't re-apply.
      const orderWrites = [];
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i];
        const state = orderStates[i] || {};
        if (!state.credit_applied) {
          state.credit_applied = true;
          state.credit_applied_at = new Date().toISOString();
          state.credit_applied_amount = 0; // backfill computed value absolutely, so per-order delta is N/A
          state.credit_applied_skipped_reason = 'backfill';
          const histEntry = {
            at: state.credit_applied_at,
            action: 'backfill_credit_applied',
          };
          state.history = Array.isArray(state.history) ? state.history.concat([histEntry]) : [histEntry];
          orderWrites.push(ordersStore.setJSON(o.id, state).catch(() => null));
        }
      }
      await Promise.allSettled(orderWrites);

      const customerWrites = [];
      for (const [ck, value] of credit) {
        const profile = customerProfiles.get(ck) || {};
        const br = breakdown.get(ck) || { held: 0, pending: 0 };
        customerWrites.push(
          setCreditAbsolute(ck, profile, value, {
            action: 'backfill_recompute',
            held: br.held, pending: br.pending,
          })
            .then(rec => changes.push({
              ck, voornaam: profile.voornaam, new_credit: rec.statiegeld_credit,
              held: br.held, pending: br.pending,
            }))
            .catch(err => changes.push({ ck, error: String(err && err.message || err) }))
        );
      }
      await Promise.allSettled(customerWrites);
    } else {
      for (const [ck, value] of credit) {
        const profile = customerProfiles.get(ck) || {};
        const br = breakdown.get(ck) || { held: 0, pending: 0 };
        const existing = await getCustomer(ck);
        changes.push({
          ck, voornaam: profile.voornaam,
          previous_credit: (existing && existing.statiegeld_credit) || 0,
          computed_credit: Math.max(0, value),
          held: br.held, pending: br.pending,
        });
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: true,
        dry_run: dryRun,
        orders_processed: orders.length,
        customers_updated: changes.length,
        changes: changes.sort((a,b) => (b.new_credit || b.computed_credit || 0) - (a.new_credit || a.computed_credit || 0)),
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e), stack: e && e.stack }) };
  }
};
