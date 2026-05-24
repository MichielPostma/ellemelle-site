// Customer blob helper — stores statiegeld credit + delivery history per contact.
// Key = SHA-1 hex of normalized contact (phone digits or lowercase email).
//
// statiegeld_credit semantics (post task #204):
//   Credit = # pots currently "outstanding" with this customer × €1.
//   - On new order submission: credit += aantal (deposit paid)
//   - On pot return WITHOUT swap: credit -= 1 (deposit refunded / kept)
//   - On swap (pickup-with-reorder): no credit change (deposit rolls onto new pot)

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function customerKey(orderData) {
  const d = orderData || {};
  const kanaal = (d.kanaal || '').toLowerCase();
  let raw = '';
  if (kanaal === 'whatsapp') {
    raw = 'tel:' + String(d.telefoon || '').replace(/\D/g, '');
  } else {
    raw = 'mail:' + String(d.email || '').trim().toLowerCase();
  }
  if (raw === 'tel:' || raw === 'mail:') return null;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

async function getCustomer(key) {
  if (!key) return null;
  const store = getStore(blobOpts('ellemelle-customers'));
  return await store.get(key, { type: 'json' });
}

async function saveCustomer(key, data) {
  if (!key) return null;
  const store = getStore(blobOpts('ellemelle-customers'));
  await store.setJSON(key, data);
  return data;
}

async function listAllCustomers() {
  const store = getStore(blobOpts('ellemelle-customers'));
  const keys = [];
  for await (const { key } of store.list().blobs ? [] : []) {
    keys.push(key);
  }
  // Fallback path (list() returns AsyncIterable or {blobs:[]} depending on version)
  const out = [];
  try {
    const list = await store.list();
    const blobs = Array.isArray(list.blobs) ? list.blobs : [];
    for (const b of blobs) {
      const data = await store.get(b.key, { type: 'json' });
      if (data) out.push({ key: b.key, ...data });
    }
  } catch {}
  return out;
}

function _defaultRecord(key, profile) {
  return {
    contact_key: key,
    voornaam: profile.voornaam || '',
    kanaal:   profile.kanaal   || '',
    telefoon: profile.telefoon || '',
    email:    profile.email    || '',
    statiegeld_credit: 0,
    history: [],
  };
}

async function appendHistory(key, profile, entry) {
  if (!key) return null;
  const existing = (await getCustomer(key)) || _defaultRecord(key, profile);
  // Always refresh profile (in case name changed)
  if (profile.voornaam) existing.voornaam = profile.voornaam;
  if (profile.kanaal)   existing.kanaal   = profile.kanaal;
  if (profile.telefoon) existing.telefoon = profile.telefoon;
  if (profile.email)    existing.email    = profile.email;
  existing.history = existing.history || [];
  existing.history.push(Object.assign({ ts: new Date().toISOString() }, entry));
  if (typeof entry.credit_delta === 'number') {
    existing.statiegeld_credit = Math.max(0, (existing.statiegeld_credit || 0) + entry.credit_delta);
  }
  await saveCustomer(key, existing);
  return existing;
}

// Set credit to an absolute value (used by backfill). Logs the change in history.
async function setCreditAbsolute(key, profile, value, entry) {
  if (!key) return null;
  const existing = (await getCustomer(key)) || _defaultRecord(key, profile);
  if (profile.voornaam) existing.voornaam = profile.voornaam;
  if (profile.kanaal)   existing.kanaal   = profile.kanaal;
  if (profile.telefoon) existing.telefoon = profile.telefoon;
  if (profile.email)    existing.email    = profile.email;
  const prev = existing.statiegeld_credit || 0;
  existing.statiegeld_credit = Math.max(0, value);
  existing.history = existing.history || [];
  existing.history.push(Object.assign({
    ts: new Date().toISOString(),
    prev_credit: prev,
    new_credit: existing.statiegeld_credit,
  }, entry));
  await saveCustomer(key, existing);
  return existing;
}

module.exports = {
  customerKey,
  getCustomer,
  saveCustomer,
  appendHistory,
  setCreditAbsolute,
  listAllCustomers,
};
