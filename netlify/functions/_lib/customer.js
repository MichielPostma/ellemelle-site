// Customer blob helper — stores statiegeld credit + delivery history per contact.
// Key = SHA-1 hex of normalized contact (phone digits or lowercase email).

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

async function appendHistory(key, profile, entry) {
  if (!key) return null;
  const existing = (await getCustomer(key)) || {
    contact_key: key,
    voornaam: profile.voornaam || '',
    kanaal: profile.kanaal || '',
    telefoon: profile.telefoon || '',
    email: profile.email || '',
    statiegeld_credit: 0,
    history: [],
  };
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

module.exports = { customerKey, getCustomer, saveCustomer, appendHistory };
