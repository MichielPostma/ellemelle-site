// One-shot admin endpoint: reconstruct pot.history from the existing pot fields + linked order.
// For each pot with status delivered/pickup-requested/returned (or any pot with delivered_at)
// reconstruct entries:
//   - { at: delivered_at,        action: 'delivered',         order_id }     when delivered_at present
//   - { at: return_requested_at, action: 'pickup_requested',  order_id }     when return_requested_at present
//   - { at: rated_at,            action: 'rated',  stars,     order_id }     from linked order
//   - { at: returned_at,         action: 'returned', kind: 'pickup' }        when returned_at present
//
// Idempotent: only adds entries that don't already exist (de-duped by at+action).
//
// POST { password, dry_run? }

const { getStore } = require('@netlify/blobs');
const { POT_IDS } = require('./_lib/inventory');

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
  const dryRun = !!body.dry_run;

  try {
    const potsStore = getStore(blobOpts('ellemelle-pots'));
    const ordersStore = getStore(blobOpts('ellemelle-orders'));

    const summary = [];
    for (const pid of POT_IDS) {
      const pot = await potsStore.get(pid, { type: 'json' });
      if (!pot) continue;

      const newEntries = [];
      // 1. delivered_at → 'delivered' entry
      if (pot.delivered_at) {
        newEntries.push({
          at: pot.delivered_at,
          action: 'delivered',
          order_id: pot.order_id || null,
        });
      }
      // 2. return_requested_at → 'pickup_requested' entry
      if (pot.return_requested_at) {
        newEntries.push({
          at: pot.return_requested_at,
          action: 'pickup_requested',
          order_id: pot.order_id || null,
        });
      }
      // 3. linked order's rated_at → 'rated' entry
      if (pot.order_id) {
        try {
          const order = await ordersStore.get(pot.order_id, { type: 'json' });
          if (order && order.rated_at && order.ratings) {
            newEntries.push({
              at: order.rated_at,
              action: 'rated',
              stars: order.ratings,
              order_id: pot.order_id,
            });
          }
        } catch {}
      }
      // 4. returned_at → 'returned' entry
      if (pot.returned_at) {
        newEntries.push({
          at: pot.returned_at,
          action: 'returned',
          kind: 'pickup',
          order_id: pot.order_id || null,
        });
      }

      if (newEntries.length === 0) {
        summary.push({ pot_id: pid, added: 0 });
        continue;
      }

      const existing = Array.isArray(pot.history) ? pot.history : [];
      const seen = new Set(existing.map(e => `${e.at}|${e.action}`));
      const fresh = newEntries.filter(e => !seen.has(`${e.at}|${e.action}`));

      if (fresh.length === 0) {
        summary.push({ pot_id: pid, added: 0, skipped: 'all already in history' });
        continue;
      }

      if (!dryRun) {
        const merged = existing.concat(fresh).sort((a, b) => String(a.at).localeCompare(String(b.at)));
        await potsStore.setJSON(pid, { ...pot, history: merged });
      }
      summary.push({ pot_id: pid, added: fresh.length, entries: fresh.map(e => e.action) });
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, dry_run: dryRun, summary }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
