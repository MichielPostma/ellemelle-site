// Lijst alle shopping-requests in de queue.
// POST { password, only_active?: boolean, limit?: number }
//
// only_active=true → alleen queued + in_progress (default voor Cowork polling).
// Default limit 50.
//
// Returns: { ok, requests: [...] } — newest first.

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

// Cowork hoeft 1× per dag te checken — geef alles wat nog "loopt" terug.
const ACTIVE = new Set(['queued', 'in_progress', 'awaiting_payment', 'in_order']);

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const onlyActive = !!body.only_active;
  const limit = Math.max(1, Math.min(200, parseInt(body.limit, 10) || 50));

  const store = getStore(blobOpts('ellemelle-shopping-queue'));
  // List all keys then fetch in parallel.
  const listing = await store.list();
  const keys = (listing && listing.blobs) ? listing.blobs.map(b => b.key) : [];
  const fetched = await Promise.all(
    keys.map(k => store.get(k, { type: 'json' }).catch(() => null))
  );
  let items = fetched.filter(Boolean);
  if (onlyActive) items = items.filter(r => ACTIVE.has(r.status));
  // Newest first by id (id sorts chronologically because of SHP-YYYYMMDD-HHMMSS format)
  items.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
  items = items.slice(0, limit);

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requests: items }) };
};
