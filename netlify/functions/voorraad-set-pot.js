// Update a single pot's status — production flow only.
// POST { password, pot_id, status, production_date? }
//
// Allowed transitions:
//   any (except delivered/returned) → voorraad   (productie)
//   voorraad/uninitialized          → available  (correctie / brak)
//
// Rejected:
//   target status delivered or returned    (those statuses are managed by the bezorger flow)
//   any transition FROM delivered/returned (those pots are with a customer; only bezorger flow may change them)

const { getStore } = require('@netlify/blobs');
const { setPotStatus, setProductionDate, VALID_STATUSES } = require('./_lib/inventory');

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
  const potId = String(body.pot_id || '').toUpperCase().trim();
  const status = String(body.status || '').toLowerCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot_id' }) };
  }
  if (!VALID_STATUSES.includes(status)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid status', allowed: VALID_STATUSES }) };
  }
  // Target status guard — only voorraad or available allowed via this endpoint.
  if (status !== 'voorraad' && status !== 'available') {
    return { statusCode: 400, headers, body: JSON.stringify({
      error: 'voorraad endpoint only manages production flow — gebruik bezorger-flow voor delivered/returned',
    }) };
  }
  // Source status guard — pots currently with a customer can't be edited here.
  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const current = (await potsStore.get(potId, { type: 'json' })) || {};
  const curStatus = current.status || 'uninitialized';
  if (curStatus === 'delivered' || curStatus === 'returned') {
    return { statusCode: 409, headers, body: JSON.stringify({
      error: 'Deze pot is bezorgd aan een klant, status kan niet gewijzigd worden via voorraad.',
      current: curStatus,
    }) };
  }
  try {
    let pot = status === 'voorraad'
      ? await setProductionDate(potId, body.production_date || null)
      : await setPotStatus(potId, status);
    const now = new Date().toISOString();
    // When admin recycles a pot back into stock (from returned), stamp a new cycle start.
    // pot.history is PRESERVED (admin can still see old trips); /pot/:id filters history
    // to entries whose timestamp ≥ current_cycle_start so each customer sees a fresh pot.
    if (curStatus === 'returned' && (status === 'voorraad' || status === 'available')) {
      pot = { ...pot, current_cycle_start: now };
    }
    // Append status_change entry so admin scan-drawer shows the timeline.
    const histEntry = { at: now, action: 'status_change', from: curStatus, to: status };
    const newHistory = (Array.isArray(pot.history) ? pot.history : []).concat([histEntry]);
    pot = { ...pot, history: newHistory };
    await potsStore.setJSON(potId, pot);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pot }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
