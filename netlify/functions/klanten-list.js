// Aggregate customers from orders + customer blobs + pot states.
// POST { password }
// Response: { customers: [{ key, voornaam, adres, total_orders, active_orders, pots_at_home, is_top_10_customer, statiegeld_credit, last_order_at }] }

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders, customerMatchKey, blobOpts } = require('./_lib/orders');
const { getCustomer, customerKey } = require('./_lib/customer');
const { POT_IDS } = require('./_lib/inventory');

function makeIdentityKey(o) {
  // Prefer phone/email-based match (same as customer.js); fallback to name+address tuple.
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
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  try {
    const { all: orders } = await listEnrichedOrders();
    // Build pot→order_id map for "pots at home"
    const potsStore = getStore(blobOpts('ellemelle-pots'));
    const potsAtHome = {};
    for (const pid of POT_IDS) {
      const p = await potsStore.get(pid, { type: 'json' });
      if (p && p.status === 'delivered' && p.order_id) {
        potsAtHome[p.order_id] = (potsAtHome[p.order_id] || 0) + 1;
      }
    }

    // Group orders by identity key
    const map = new Map();
    for (const o of orders) {
      const k = makeIdentityKey(o);
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          voornaam: o.voornaam || '',
          adres: `${o.straat || ''} ${o.huisnummer || ''}${o.toevoeging ? '-' + o.toevoeging : ''}`.trim(),
          plaats: o.plaats || '',
          kanaal: o.kanaal || '',
          telefoon: o.telefoon || '',
          email: o.email || '',
          orders: [],
          total_orders: 0,
          active_orders: 0,
          pots_at_home: 0,
          last_order_at: null,
        });
      }
      const c = map.get(k);
      c.orders.push({ id: o.id, created_at: o.created_at, order_status: o.order_status, delivery_date: o.delivery_date });
      c.total_orders += 1;
      if (!['delivered','neighbors'].includes(o.order_status)) c.active_orders += 1;
      if (potsAtHome[o.id]) c.pots_at_home += potsAtHome[o.id];
      if (!c.last_order_at || String(o.created_at) > String(c.last_order_at)) c.last_order_at = o.created_at;
    }

    // Customer blob lookup for statiegeld_credit
    const customers = Array.from(map.values());
    for (const c of customers) {
      try {
        const cust = await getCustomer(customerKey({
          kanaal: c.kanaal, telefoon: c.telefoon, email: c.email,
        }));
        c.statiegeld_credit = (cust && cust.statiegeld_credit) || 0;
      } catch { c.statiegeld_credit = 0; }
    }

    // Rank top 10 by total_orders desc
    const sorted = [...customers].sort((a, b) => b.total_orders - a.total_orders);
    const topSet = new Set(sorted.slice(0, 10).map(c => c.key));
    for (const c of customers) c.is_top_10_customer = topSet.has(c.key);

    // Sort final list: most recent order first
    customers.sort((a, b) => String(b.last_order_at).localeCompare(String(a.last_order_at)));

    return { statusCode: 200, headers, body: JSON.stringify({ customers, total: customers.length }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
