// Toggle the `betaald` flag on a signup row.
// POST { password, id, betaald } → { ok: true }
// Only works with Supabase as the datastore.

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad JSON' }) }; }

  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  if (!body.id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing id' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 503, headers,
      body: JSON.stringify({ error: 'Supabase required to track payment status' }),
    };
  }

  try {
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/signups?id=eq.${encodeURIComponent(body.id)}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ betaald: !!body.betaald }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'supabase update failed', detail: t }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
