// Update app-config (e.g. next_production_date).
// POST { password, next_production_date }

const { setAppConfig } = require('./_lib/inventory');

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
  const patch = {};
  if (typeof body.next_production_date === 'string') {
    if (body.next_production_date === '') patch.next_production_date = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(body.next_production_date)) patch.next_production_date = body.next_production_date;
    else return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid date (expected YYYY-MM-DD)' }) };
  }
  if (typeof body.customer_stop === 'boolean') {
    patch.customer_stop = body.customer_stop;
  }
  if (typeof body.customer_stop_whatsapp_url === 'string') {
    const u = body.customer_stop_whatsapp_url.trim();
    if (u === '') patch.customer_stop_whatsapp_url = null;
    else if (/^https?:\/\//i.test(u)) patch.customer_stop_whatsapp_url = u;
    else return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid whatsapp url (expected http(s)://…)' }) };
  }
  const cfg = await setAppConfig(patch);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, config: cfg }) };
};
