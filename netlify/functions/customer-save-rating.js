// Public: customer submits star ratings for the pot they just received.
// POST { pot_id, ratings: { taste?: 1-5, texture?: 1-5, kids?: 1-5 } }
// Persists onto the order blob: { ratings, rated_at }

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function clampStar(v) {
  const n = parseInt(v, 10);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return null;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const potId = String(body.pot_id || '').toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }
  const input = body.ratings || {};
  const cleaned = {};
  ['taste', 'texture', 'kids'].forEach(k => {
    const v = clampStar(input[k]);
    if (v !== null) cleaned[k] = v;
  });
  if (Object.keys(cleaned).length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'no valid ratings provided' }) };
  }

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  if (!pot.order_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'pot is not delivered to a customer' }) };
  }

  const existingOrder = (await ordersStore.get(pot.order_id, { type: 'json' })) || {};
  const prevRatings = existingOrder.ratings || {};
  const mergedRatings = { ...prevRatings, ...cleaned };
  const now = new Date().toISOString();
  const next = { ...existingOrder, ratings: mergedRatings, rated_at: now };
  // Append a small history entry for audit (on the order side)
  const hist = Array.isArray(existingOrder.history) ? existingOrder.history : [];
  hist.push({ at: now, action: 'save_rating', value: cleaned });
  next.history = hist;
  await ordersStore.setJSON(pot.order_id, next);

  // Also stamp pot.history so the admin scan-drawer shows the rating event.
  const potHistory = Array.isArray(pot.history) ? pot.history : [];
  potHistory.push({ at: now, action: 'rated', stars: cleaned, order_id: pot.order_id });
  await potsStore.setJSON(potId, { ...pot, history: potHistory });

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ratings: mergedRatings, rated_at: now }) };
};
