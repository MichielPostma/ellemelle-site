// Fetch a temp-order blob for the /pay/:id page.
// GET ?id=<uuid> → { id, order, created_at, status }
const { getStore } = require('@netlify/blobs');

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
  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad_id' }) };
  }
  try {
    const store = getStore(storeOpts());
    const data = await store.get(id, { type: 'json' });
    if (!data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_read_failed', detail: String(e && e.message || e) }) };
  }
};
