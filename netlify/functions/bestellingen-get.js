// Get single order details + customer history (other orders by same customer)
// + customer record (incl. statiegeld_credit).
const { listEnrichedOrders, customerMatchKey } = require('./_lib/orders');
const { customerKey, getCustomer } = require('./_lib/customer');

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
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  try {
    const { all } = await listEnrichedOrders();
    const order = all.find(o => o.id === orderId);
    if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };
    const myKey = customerMatchKey(order);
    const history = myKey
      ? all.filter(o => o.id !== orderId && customerMatchKey(o) === myKey)
            .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      : [];
    // Look up customer blob (statiegeld credit etc.) via the hash key.
    const ck = customerKey(order);
    const customer = ck ? await getCustomer(ck) : null;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        order,
        history,
        customer: customer ? {
          contact_key: customer.contact_key,
          statiegeld_credit: customer.statiegeld_credit || 0,
          voornaam: customer.voornaam,
        } : null,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
