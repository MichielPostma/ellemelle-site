// Thin wrapper around Netlify Blobs for ELLEMELLE pot tracking.
// Stores:
//   pots/POT-NNN   → { id, status, order_id?, delivered_at?, returned_at?, ... }
//   orders/ORDER-X → { id, voornaam, address, contact, status, delivery_week, ... }

const { getStore } = require('@netlify/blobs');

const POT_IDS = Array.from({ length: 25 }, (_, i) => `POT-${String(i + 1).padStart(3, '0')}`);

function storeOpts(name) {
  const opts = { name, consistency: 'strong' };
  // Manual config: required when functions are deployed via API (the runtime env
  // var injection isn't always available outside the Git-based build pipeline).
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return opts;
}
function potsStore()   { return getStore(storeOpts('ellemelle-pots')); }
function ordersStore() { return getStore(storeOpts('ellemelle-orders')); }

async function getPot(id) {
  const raw = await potsStore().get(id, { type: 'json' });
  return raw || null;
}

async function setPot(id, data) {
  return potsStore().setJSON(id, data);
}

async function listPots() {
  const store = potsStore();
  const out = [];
  for (const id of POT_IDS) {
    const v = await store.get(id, { type: 'json' });
    if (v) out.push(v);
    else out.push({ id, status: 'uninitialized' });
  }
  return out;
}

async function getOrder(id) {
  return ordersStore().get(id, { type: 'json' });
}

async function setOrder(id, data) {
  return ordersStore().setJSON(id, data);
}

async function listOrders() {
  const store = ordersStore();
  const { blobs } = await store.list();
  const orders = [];
  for (const b of blobs) {
    const v = await store.get(b.key, { type: 'json' });
    if (v) orders.push(v);
  }
  return orders;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Determines delivery week (next Saturday after a given date)
function deliveryWeekForDate(dateStr) {
  const d = new Date(dateStr || Date.now());
  // Days until next Saturday (6) — if today is Saturday, use this Saturday
  const day = d.getDay();
  const offset = (6 - day + 7) % 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + offset);
  return isoWeek(sat);
}

module.exports = {
  POT_IDS,
  getPot, setPot, listPots,
  getOrder, setOrder, listOrders,
  isoWeek, deliveryWeekForDate,
};
