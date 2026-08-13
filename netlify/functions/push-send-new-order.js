// Fan-out web-push notifications to all stored subscriptions.
// POST { voornaam, aantal, straat, huisnummer, order_id? }
// No password required — public endpoint called from index.html after order success.
const { getStore } = require('@netlify/blobs');
const webpush = require('web-push');

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:hi@ellemelle.example';
  if (!pub || !priv) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'VAPID keys not configured' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const voornaam = String(body.voornaam || 'Klant').slice(0, 60);
  const aantal = parseInt(body.aantal || 1, 10) || 1;
  const straat = String(body.straat || '').slice(0, 80);
  const huisnummer = String(body.huisnummer || '').slice(0, 12);
  const orderId = body.order_id || null;
  const addr = (straat + ' ' + huisnummer).trim();
  const url = orderId ? ('/bestelling/' + orderId) : '/bestellingen';

  webpush.setVapidDetails(subj, pub, priv);
  const payload = JSON.stringify({
    title: 'Nieuwe Ellemel-bestelling 🛒',
    body: `${voornaam} bestelde ${aantal} pot${aantal === 1 ? '' : 'ten'}${addr ? ' op ' + addr : ''}`,
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: 'new-order-' + Date.now(),
    url,
  });

  const store = getStore(blobOpts('ellemelle-push-subscriptions'));
  const list = await store.list();
  const results = { sent: 0, failed: 0, removed: 0 };
  for (const item of list.blobs || []) {
    const sub = await store.get(item.key, { type: 'json' });
    if (!sub || !sub.endpoint) continue;
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys || {} }, payload);
      results.sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await store.delete(item.key);
        results.removed += 1;
      } else {
        results.failed += 1;
      }
    }
  }

  // Append to push-log blob for the in-app notifications drawer.
  // Best-effort — never fails the request.
  try {
    const logStore = getStore(blobOpts('ellemelle-push-log'));
    const existing = (await logStore.get('log', { type: 'json' })) || [];
    const arr = Array.isArray(existing) ? existing : [];
    arr.push({
      at: new Date().toISOString(),
      icon: '🛒',
      title: 'Nieuwe Ellemel-bestelling',
      body: `${voornaam} bestelde ${aantal} pot${aantal === 1 ? '' : 'ten'}${addr ? ' op ' + addr : ''}`,
      url,
      order_id: orderId,
      action: 'new_order',
    });
    // Cap the log to the last 500 entries to avoid unbounded growth.
    const capped = arr.slice(-500);
    await logStore.setJSON('log', capped);
  } catch (e) {
    // ignore — logging is a nice-to-have
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...results }) };
};
