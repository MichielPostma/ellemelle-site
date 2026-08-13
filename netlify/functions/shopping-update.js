// Update een shopping-request — gebruikt door Cowork's scheduled task om voortgang te rapporteren.
// POST { password, request_id, status?, notes?, order_refs? }
//
// status:     'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
// notes:      vrije tekst (Cowork can leg uit wat 't deed of waarom 't faalde)
// order_refs: array van strings (bestelnummers bij de leverancier)
//
// Returns: { ok, request }

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

const ALLOWED_STATUS = new Set([
  'queued',
  'in_progress',
  'awaiting_payment', // Cart bij De Notenshop is gevuld — Michiel moet iDEAL bevestigen
  'in_order',         // Betaling gelukt — bestelling is geplaatst en wordt klaargemaakt
  'ready',            // Geleverd op het adres — track & trace beschikbaar
  'failed',
  'cancelled',
]);
const TERMINAL = new Set(['ready', 'failed', 'cancelled']);

function isoNow() { return new Date().toISOString(); }

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

  const requestId = String(body.request_id || '').trim();
  if (!requestId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing request_id' }) };
  }

  const store = getStore(blobOpts('ellemelle-shopping-queue'));
  const existing = await store.get(requestId, { type: 'json' });
  if (!existing) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'request not found', request_id: requestId }) };
  }

  const now = isoNow();
  const history = Array.isArray(existing.history) ? existing.history.slice() : [];
  let patch = {};

  if (typeof body.status === 'string') {
    const s = body.status.toLowerCase();
    if (!ALLOWED_STATUS.has(s)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid status', allowed: [...ALLOWED_STATUS] }) };
    }
    if (s !== existing.status) {
      patch.status = s;
      if (s === 'in_progress' && !existing.started_at) patch.started_at = now;
      if (TERMINAL.has(s) && !existing.completed_at)   patch.completed_at = now;
      history.push({ at: now, action: 'status_changed', from: existing.status, to: s });
    }
  }

  if (typeof body.notes === 'string') {
    patch.result_notes = body.notes.slice(0, 4000);
    history.push({ at: now, action: 'notes_added' });
  }

  if (Array.isArray(body.order_refs)) {
    patch.order_refs = body.order_refs.map(s => String(s || '').slice(0, 100)).filter(Boolean);
    history.push({ at: now, action: 'order_refs_set' });
  }

  // Cart-URL (voor awaiting_payment) en track & trace (voor ready) — door Cowork ingevuld.
  if (typeof body.cart_url === 'string' && body.cart_url.startsWith('http')) {
    patch.cart_url = body.cart_url.slice(0, 1000);
    history.push({ at: now, action: 'cart_url_set' });
  }
  if (typeof body.tracking_url === 'string' && body.tracking_url.startsWith('http')) {
    patch.tracking_url = body.tracking_url.slice(0, 1000);
    history.push({ at: now, action: 'tracking_url_set' });
  }
  if (typeof body.expected_delivery_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_delivery_date)) {
    patch.expected_delivery_date = body.expected_delivery_date;
    history.push({ at: now, action: 'expected_delivery_set', value: body.expected_delivery_date });
  }
  if (typeof body.delivered_at === 'string') {
    patch.delivered_at = body.delivered_at.slice(0, 100);
  }

  const next = { ...existing, ...patch, history };
  await store.setJSON(requestId, next);

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, request: next }) };
};
