// Fetch a pending-order blob by id. Used by the success page to render the recap
// from the source of truth (rather than relying on localStorage which can be stale
// across iframe contexts or device handoffs).
//
// GET /api/order/get-pending?id=<temp_order_id>
//   → 200 { id, order, status, created_at, paid_at?, payment_intent_id? }
//   → 404 if not found

const { getStore } = require('@netlify/blobs');

function storeOpts() {
  const o = { name: 'ellemelle-pending-orders', consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    o.siteID = process.env.NETLIFY_SITE_ID;
    o.token  = process.env.NETLIFY_API_TOKEN;
  }
  return o;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing_id' }) };
  }
  try {
    const store = getStore(storeOpts());
    const rec = await store.get(id, { type: 'json' });
    if (!rec) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(rec) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_read_failed', detail: String(e && e.message || e) }) };
  }
};
