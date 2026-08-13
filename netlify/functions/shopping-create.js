// Maak een nieuwe shopping-request voor de keuken aan.
// POST { password, pot_count, ingredients?: [{ name, grams, notes? }], shops? }
// Cowork's scheduled task pakt deze later op en plaatst de bestelling bij de leverancier.
//
// Default leverancier: De Notenshop (denotenshop.nl). Alle ingrediënten bio.
//
// Returns: { ok, request_id, request }

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

// Recipe per 1 pot van 370g — moet in sync blijven met koken.html INGREDIENTS.
// Alles bio. Hoeveelheden per ingrediënt × pot_count.
const PER_POT_GRAMS = [
  { name: 'Hazelnoten gepeld geroosterd (bio)',   grams: 137  },
  { name: 'Cashewnoten ongebrand (bio)',           grams: 18.5 },
  { name: 'Olijfolie koudgeperst (bio)',           grams: 41   },
  { name: 'Zonnebloemolie koudgeperst (bio)',      grams: 37   },
  { name: 'Cacaopoeder (bio)',                     grams: 52   },
  { name: 'Agavesiroop donker (bio)',              grams: 59   },
  { name: 'Magere melkpoeder (bio)',               grams: 15   },
  { name: 'Vanille natuurlijke smaakstof (bio)',   grams: 11   },
];

function isoNow() { return new Date().toISOString(); }

function makeRequestId() {
  // SHP-YYYYMMDD-HHMMSS — sorteerbaar als string
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `SHP-${y}${m}${day}-${hh}${mm}${ss}`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const potCount = Math.max(1, Math.min(50, parseInt(body.pot_count, 10) || 1));
  // Schaal de standaard-recipe op basis van pot_count. Override kan via body.ingredients.
  const ingredients = Array.isArray(body.ingredients) && body.ingredients.length
    ? body.ingredients.map(i => ({
        name: String(i.name || '').slice(0, 200),
        grams: Math.max(0, Number(i.grams) || 0),
        notes: String(i.notes || '').slice(0, 500),
      }))
    : PER_POT_GRAMS.map(i => ({
        name: i.name,
        grams: Math.round(i.grams * potCount * 10) / 10,
        notes: '',
      }));

  const shops = Array.isArray(body.shops) && body.shops.length
    ? body.shops.map(s => String(s).slice(0, 100))
    : ['denotenshop.nl'];

  const now = isoNow();
  const requestId = makeRequestId();
  const request = {
    id: requestId,
    created_at: now,
    status: 'queued',
    pot_count: potCount,
    ingredients,
    shops,
    started_at: null,
    completed_at: null,
    result_notes: '',
    order_refs: [],
    // Door Cowork tussen-statuses in te vullen tijdens de flow:
    cart_url: null,                // Awaiting_payment: link naar gevulde winkelmandje
    expected_delivery_date: null,  // In_order: verwachte leverdatum (YYYY-MM-DD)
    tracking_url: null,            // Ready: DHL / koerier track & trace link
    delivered_at: null,            // Ready: timestamp van bezorging
    history: [{ at: now, action: 'created', by: 'admin' }],
  };

  const store = getStore(blobOpts('ellemelle-shopping-queue'));
  await store.setJSON(requestId, request);

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, request_id: requestId, request }),
  };
};
