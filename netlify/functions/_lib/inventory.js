// Inventory helpers for ELLEMELLE pot stock + delivery date calculation.
// Pot statuses (extended):
//   - uninitialized: no record yet (never seeded)
//   - available:     empty pot waiting to be filled (= statiegeld returned)
//   - voorraad:      filled with chocopasta, in stock — sellable
//   - delivered:     handed to a customer (current trip)
//   - returned:      legacy/archived terminal status (kept for compat)
//
// Per pot we also store (when status === 'voorraad'):
//   production_date: ISO date string (YYYY-MM-DD)
//   expiry_date:     production_date + 56 days (8 weeks)

const { getStore } = require('@netlify/blobs');

const POT_IDS = Array.from({ length: 25 }, (_, i) => `POT-${String(i + 1).padStart(3, '0')}`);
const VALID_STATUSES = ['uninitialized','available','voorraad','delivered','returned'];
const EXPIRY_DAYS = 56;

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return opts;
}

function potsStore()   { return getStore(blobOpts('ellemelle-pots')); }
function configStore() { return getStore(blobOpts('ellemelle-app-config')); }

// --- Date helpers ---
function toISODate(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDaysISO(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() + days);
  return toISODate(x);
}
function todayISO() {
  return toISODate(new Date());
}
// Next Saturday on/after a given date (if it IS Saturday, returns same day)
function nextSaturday(isoDateOrDate) {
  const base = (typeof isoDateOrDate === 'string')
    ? new Date(isoDateOrDate + 'T00:00:00Z')
    : (isoDateOrDate || new Date());
  const x = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = x.getUTCDay(); // 0=Sun..6=Sat
  const offset = (6 - day + 7) % 7;
  x.setUTCDate(x.getUTCDate() + offset);
  return toISODate(x);
}

// --- Public helpers ---
function nextDeliverySaturday() {
  return nextSaturday(new Date());
}
function nextDeliveryAfter(productionDateISO) {
  // First Saturday STRICTLY AFTER the production date.
  // Production and delivery on the same day is not logistically practical.
  // If production date is in past/today, fall back to today as pivot, then jump to the next Saturday strictly after.
  const todayISOv = todayISO();
  const pivot = (productionDateISO && productionDateISO > todayISOv) ? productionDateISO : todayISOv;
  // Skip the pivot day itself by adding 1, then snap to next Saturday on/after that.
  const x = new Date(pivot + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return nextSaturday(x);
}

async function setProductionDate(potId, dateISO) {
  const id = String(potId).toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(id)) throw new Error('invalid pot id');
  const date = (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO)) ? dateISO : todayISO();
  const expiry = addDaysISO(date, EXPIRY_DAYS);
  const store = potsStore();
  const current = (await store.get(id, { type: 'json' })) || { id };
  const next = {
    ...current,
    id,
    status: 'voorraad',
    production_date: date,
    expiry_date: expiry,
    voorraad_at: new Date().toISOString(),
    // Clear delivered-only fields when (re)entering stock
    order_id: null,
    delivered_at: null,
    delivered_to: null,
    returned_at: null,
    returned_for_order: null,
  };
  await store.setJSON(id, next);
  return next;
}

async function setPotStatus(potId, status, opts) {
  const id = String(potId).toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(id)) throw new Error('invalid pot id');
  if (!VALID_STATUSES.includes(status)) throw new Error('invalid status');
  if (status === 'voorraad') {
    return setProductionDate(id, (opts && opts.production_date) || todayISO());
  }
  const store = potsStore();
  const current = (await store.get(id, { type: 'json' })) || { id };
  const next = {
    ...current,
    id,
    status,
  };
  // When entering "available" (empty/leeg), clear production + delivery refs
  if (status === 'available') {
    next.production_date = null;
    next.expiry_date = null;
    next.order_id = null;
    next.delivered_at = null;
    next.delivered_to = null;
    next.returned_at = null;
    next.returned_for_order = null;
  }
  if (status === 'returned') {
    next.returned_at = new Date().toISOString();
  }
  await store.setJSON(id, next);
  return next;
}

async function countInStock() {
  const store = potsStore();
  // Parallel fetch — same pattern as listAllPots, count voorraad locally.
  const pots = await Promise.all(
    POT_IDS.map(id => store.get(id, { type: 'json' }).catch(() => null))
  );
  return pots.filter(p => p && p.status === 'voorraad').length;
}

async function listAllPots() {
  const store = potsStore();
  // Parallel fetch — 25 blob reads in flight at once instead of serial.
  const fetched = await Promise.all(
    POT_IDS.map(id => store.get(id, { type: 'json' }).catch(() => null))
  );
  return POT_IDS.map((id, i) => fetched[i] || { id, status: 'uninitialized' });
}

// --- App config (next_production_date etc.) ---
async function getAppConfig() {
  const store = configStore();
  const v = await store.get('main', { type: 'json' });
  return v || { next_production_date: null };
}
async function setAppConfig(patch) {
  const store = configStore();
  const cur = (await store.get('main', { type: 'json' })) || {};
  const next = { ...cur, ...(patch || {}), updated_at: new Date().toISOString() };
  await store.setJSON('main', next);
  return next;
}

module.exports = {
  POT_IDS, VALID_STATUSES, EXPIRY_DAYS,
  todayISO, addDaysISO, nextSaturday,
  nextDeliverySaturday, nextDeliveryAfter,
  setProductionDate, setPotStatus, countInStock, listAllPots,
  getAppConfig, setAppConfig,
};
