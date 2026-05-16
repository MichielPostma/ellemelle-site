// List all 25 pots + app config (next_production_date) + counts per status.
// Pots with status=delivered get enriched with customer { voornaam, adres, plaats } from the linked order.
// POST { password }

const { listAllPots, getAppConfig, countInStock } = require('./_lib/inventory');

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
  const pots = await listAllPots();
  const cfg = await getAppConfig();
  const stock = await countInStock();

  // Enrich delivered pots with customer info from Netlify Forms
  const token = process.env.NETLIFY_API_TOKEN;
  if (token) {
    for (const p of pots) {
      if (p.status === 'delivered' && p.order_id) {
        try {
          const r = await fetch(`https://api.netlify.com/api/v1/submissions/${p.order_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.ok) {
            const j = await r.json();
            const d = j.data || {};
            p.customer = {
              voornaam: d.voornaam || '',
              adres: `${d.straat || ''} ${d.huisnummer || ''}${d.toevoeging ? '-' + d.toevoeging : ''}`.trim(),
              plaats: d.plaats || '',
            };
          }
        } catch {}
      }
    }
  }

  const counts = pots.reduce((m, p) => { m[p.status||'uninitialized']=(m[p.status||'uninitialized']||0)+1; return m; }, {});
  return { statusCode: 200, headers, body: JSON.stringify({
    pots, counts, stock_count: stock, config: cfg,
  }) };
};
