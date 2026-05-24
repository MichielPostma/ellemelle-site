// Public: read a pot's state plus the linked order's customer-visible fields.
// GET /api/pot/POT-001  (or POST with {pot_id})

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
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  // Accept GET (path param) or POST (body)
  let potId = '';
  if (event.queryStringParameters && event.queryStringParameters.pot_id) {
    potId = event.queryStringParameters.pot_id;
  }
  if (!potId && event.path) {
    const m = event.path.match(/POT-\d{3}/i);
    if (m) potId = m[0];
  }
  if (!potId && event.body) {
    try { potId = (JSON.parse(event.body || '{}').pot_id || '').toString(); } catch {}
  }
  potId = potId.toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));

  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found', pot_id: potId }) };
  }

  // Look up linked order if any
  let voornaam = '', adres = '', stad = '';
  if (pot.order_id) {
    // First try blob (custom-tracked state).
    const orderBlob = await ordersStore.get(pot.order_id, { type: 'json' });
    // Then fetch Netlify Forms submission to get the customer name/address
    try {
      const token = process.env.NETLIFY_API_TOKEN;
      const r = await fetch(`https://api.netlify.com/api/v1/submissions/${pot.order_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const sub = await r.json();
        const d = sub.data || {};
        voornaam = d.voornaam || '';
        adres = [d.straat, [d.huisnummer, d.toevoeging].filter(Boolean).join('-')].filter(Boolean).join(' ');
        stad = [d.postcode, d.plaats].filter(Boolean).join(' ').trim();
      }
    } catch (e) { /* fallback to blob fields below */ }
    if (!voornaam && orderBlob && orderBlob.voornaam) voornaam = orderBlob.voornaam;
  }

  // Fetch order blob for additional context (pickup status, ratings, etc.)
  let orderBlob = null;
  if (pot.order_id) {
    try { orderBlob = await ordersStore.get(pot.order_id, { type: 'json' }); } catch {}
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      id: potId,
      status: pot.status,
      production_date: pot.production_date || null,
      expiry_date:     pot.expiry_date || null,
      delivered_at:    pot.delivered_at || null,
      return_requested_at: pot.return_requested_at || null,
      returned_at:     pot.returned_at || null,
      voornaam:        voornaam || null,
      adres:           adres || null,
      stad:            stad || null,
      // Order-derived signals (already-submitted ratings, pickup state)
      pickup_requested_at: (orderBlob && orderBlob.pickup_requested_at) || null,
      ratings:             (orderBlob && orderBlob.ratings) || null,
      rated_at:            (orderBlob && orderBlob.rated_at) || null,
    }),
  };
};
