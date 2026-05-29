// Admin: get one customer's detail (identified by the same key klanten-list emits).
// POST { password, key }
// Response:
//   {
//     customer: { key, voornaam, adres, plaats, kanaal, telefoon, email,
//                 statiegeld_credit, pots_at_home, total_orders, active_orders, history },
//     orders: [{ id, created_at, order_status, delivery_date, payment_intent_id }]
//   }
//
// The key can be either:
//   - The sha1 customer-key (when phone/email is on file), or
//   - 'addr:{lower_voornaam}|{lower_straat}|{huisnummer}|{lower_toevoeging}' fallback.

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders, blobOpts, customerMatchKey } = require('./_lib/orders');
const { getCustomer, customerKey } = require('./_lib/customer');
const { POT_IDS } = require('./_lib/inventory');

function makeIdentityKey(o) {
  const ck = customerMatchKey(o);
  if (ck) return ck;
  const addr = `${(o.straat||'').toLowerCase()}|${(o.huisnummer||'')}|${(o.toevoeging||'').toLowerCase()}`;
  const name = (o.voornaam || '').toLowerCase().trim();
  return `addr:${name}|${addr}`;
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
  const key = String(body.key || '').trim();
  if (!key) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing key' }) };
  }

  try {
    const { all: orders } = await listEnrichedOrders();
    // Filter orders matching this customer key.
    const matching = orders.filter(o => makeIdentityKey(o) === key);
    if (matching.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'customer not found' }) };
    }

    // Sort newest first for the list + when computing PI refundability.
    matching.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const newest = matching[0];

    // pots_at_home
    const potsStore = getStore(blobOpts('ellemelle-pots'));
    let potsAtHome = 0;
    for (const pid of POT_IDS) {
      const p = await potsStore.get(pid, { type: 'json' });
      if (p && ['delivered','pickup-requested','pickup-with-reorder'].includes(p.status) && p.order_id) {
        if (matching.find(o => o.id === p.order_id)) potsAtHome += 1;
      }
    }

    // Lookup customer blob (statiegeld_credit + history) via sha1 customerKey when possible.
    const ck = customerKey({ kanaal: newest.kanaal, telefoon: newest.telefoon, email: newest.email });
    const cust = ck ? (await getCustomer(ck)) : null;

    // For each order, pull the payment_intent_id from the order blob (saved by stripe-webhook).
    const ordersStore = getStore(blobOpts('ellemelle-orders'));
    const orderRows = [];
    for (const o of matching) {
      const blob = (await ordersStore.get(o.id, { type: 'json' })) || {};
      orderRows.push({
        id:                o.id,
        created_at:        o.created_at,
        order_status:      o.order_status,
        delivery_date:     o.delivery_date,
        payment_intent_id: blob.payment_intent_id || null,
      });
    }

    const customer = {
      key,
      voornaam: newest.voornaam || '',
      adres: `${newest.straat || ''} ${newest.huisnummer || ''}${newest.toevoeging ? '-' + newest.toevoeging : ''}`.trim(),
      plaats: newest.plaats || '',
      kanaal: newest.kanaal || '',
      telefoon: newest.telefoon || '',
      email: newest.email || '',
      statiegeld_credit: (cust && cust.statiegeld_credit) || 0,
      pots_at_home: potsAtHome,
      total_orders: matching.length,
      active_orders: matching.filter(o => !['delivered','neighbors','picked_up'].includes(o.order_status)).length,
      history: (cust && Array.isArray(cust.history)) ? cust.history : [],
    };

    return { statusCode: 200, headers, body: JSON.stringify({ customer, orders: orderRows }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
