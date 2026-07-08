// Admin: set a single customer's statiegeld_credit to an absolute value.
// POST { password, key, value, reason? }
//
// `key` can be either:
//   - The sha1 customer-key (16 chars, hex) — as returned by _lib/customer.customerKey().
//   - A raw contact string ('tel:0651840229' or 'mail:foo@bar.com') — will be hashed here.
//
// Response: { ok, prev_credit, new_credit, key }

const crypto = require('crypto');
const { listEnrichedOrders, customerMatchKey } = require('./_lib/orders');
const { getCustomer, setCreditAbsolute, customerKey } = require('./_lib/customer');

function looksLikeSha1(s) { return /^[0-9a-f]{16}$/.test(s); }

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
  const rawKey = String(body.key || '').trim();
  const value = Number(body.value);
  if (!rawKey || !Number.isFinite(value) || value < 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'need key + non-negative numeric value' }) };
  }

  // Resolve to sha1 customer-key.
  let ck = rawKey;
  if (!looksLikeSha1(rawKey)) {
    // Raw contact form — hash it the same way _lib/customer.customerKey does.
    ck = crypto.createHash('sha1').update(rawKey.toLowerCase()).digest('hex').slice(0, 16);
  }

  // Locate a matching order so we can pass a profile to setCreditAbsolute (for history).
  const { all: orders } = await listEnrichedOrders();
  const match = orders.find(o => customerKey(o) === ck);
  const profile = match ? {
    voornaam: match.voornaam, kanaal: match.kanaal,
    telefoon: match.telefoon, email: match.email,
  } : {};

  const prev = ((await getCustomer(ck)) || {}).statiegeld_credit || 0;
  await setCreditAbsolute(ck, profile, value, {
    action: 'admin-set-credit',
    reason: body.reason || 'admin manual adjustment',
    via: 'admin-set-credit endpoint',
  });

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, key: ck, prev_credit: prev, new_credit: value }),
  };
};
