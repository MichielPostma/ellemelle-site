// Undo a delivery: free up the pot, clear the order's delivered state.
// POST { password, order_id }

const { getStore } = require('@netlify/blobs');

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
  const orderId = String(body.order_id || '').trim();
  if (!orderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));

  const order = await ordersStore.get(orderId, { type: 'json' });
  if (!order || !order.delivered_pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'no delivery to undo for this order' }) };
  }
  const potId = order.delivered_pot;
  const pot = await potsStore.get(potId, { type: 'json' });
  if (pot) {
    await potsStore.setJSON(potId, {
      ...pot, status: 'available', order_id: null, delivered_at: null,
    });
  }
  await ordersStore.setJSON(orderId, {
    ...order, delivered_pot: null, delivered_at: null,
  });
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, undone_pot: potId, order_id: orderId }),
  };
};
