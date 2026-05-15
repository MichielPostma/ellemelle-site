const { POT_IDS, setPot } = require('./_lib/blobs');

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

  const now = new Date().toISOString();
  const force = !!body.force;
  const created = [];
  const skipped = [];
  const { getStore } = require('@netlify/blobs');
  const store = getStore({ name: 'ellemelle-pots', consistency: 'strong' });

  for (const id of POT_IDS) {
    const existing = await store.get(id, { type: 'json' });
    if (existing && !force) {
      skipped.push(id);
      continue;
    }
    const data = {
      id,
      status: 'available',
      order_id: null,
      delivered_at: null,
      returned_at: null,
      seeded_at: now,
    };
    await setPot(id, data);
    created.push(id);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, created, skipped, total: POT_IDS.length }),
  };
};
