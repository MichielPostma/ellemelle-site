// Save (or remove) a web-push subscription in blob storage.
// POST { password, subscription, action? }  — action: 'subscribe' (default) | 'unsubscribe'
const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}
function endpointKey(endpoint) {
  return crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 24);
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  const sub = body.subscription;
  if (!sub || !sub.endpoint) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing subscription.endpoint' }) };
  const store = getStore(blobOpts('ellemelle-push-subscriptions'));
  const key = endpointKey(sub.endpoint);
  if (body.action === 'unsubscribe') {
    await store.delete(key);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, removed: key }) };
  }
  await store.setJSON(key, {
    endpoint: sub.endpoint,
    keys: sub.keys || null,
    subscribed_at: new Date().toISOString(),
    user_agent: (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '',
  });
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key }) };
};
