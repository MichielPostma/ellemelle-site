// Create a temporary order blob for the admin-via-QR flow.
// POST body = the full order payload (voornaam, adres, aantal, kanaal, contact, delivery_date, ...).
// Returns { id, url } where url is the public /pay/:id page that the klant scans into.
const { getStore } = require('@netlify/blobs');

function uuid() {
  // RFC4122 v4-ish, sufficient for non-secret temp IDs.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function storeOpts() {
  const o = { name: 'ellemelle-temp-orders', consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    o.siteID = process.env.NETLIFY_SITE_ID;
    o.token = process.env.NETLIFY_API_TOKEN;
  }
  return o;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const id = uuid();
  const baseUrl = process.env.URL || 'https://ellemelle.netlify.app';
  const record = {
    id,
    order: body,            // full order payload (admin-side snapshot)
    created_at: new Date().toISOString(),
    status: 'pending',      // pending → paid (once Stripe webhook updates / klant returns from bank)
  };

  try {
    const store = getStore(storeOpts());
    await store.setJSON(id, record);
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_write_failed', detail: String(e && e.message || e) }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ id, url: `${baseUrl}/pay/${id}` }),
  };
};
