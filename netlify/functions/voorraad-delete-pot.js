// Permanently delete a pot blob entry.
// Safety: refuses delete if status === 'delivered' (pot is at customer).
// POST { password, pot_id }
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
  const potId = String(body.pot_id || '').toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot_id' }) };
  }

  const store = getStore(blobOpts('ellemelle-pots'));
  const pot = await store.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  }
  if (pot.status === 'delivered') {
    return {
      statusCode: 409,
      headers,
      body: JSON.stringify({ error: 'kan niet verwijderen — pot is bezorgd bij een klant' })
    };
  }
  await store.delete(potId);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: potId }) };
};
