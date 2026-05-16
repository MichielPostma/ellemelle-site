// Lists Netlify Forms signups grouped by ISO delivery-week (next Saturday after order).
// Merges delivery state from blob store `ellemelle-orders/{submission_id}`.

const { getStore } = require('@netlify/blobs');
const { deliveryWeekForDate, isoWeek } = require('./_lib/blobs');

function toISODate(d) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function nextSaturdayISO(baseISO) {
  const x = new Date(baseISO + 'T00:00:00Z');
  const dow = x.getUTCDay();
  const offset = (6 - dow + 7) % 7;
  x.setUTCDate(x.getUTCDate() + offset);
  return toISODate(x);
}
function isoWeekOfDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function fallbackNoScheduleDate(createdAt) {
  const x = new Date(createdAt);
  x.setUTCDate(x.getUTCDate() + 28);
  return nextSaturdayISO(toISODate(x));
}

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function isoWeekToDateRange(iso) {
  // "2026-W20" → { start: Date(Mon), end: Date(Sun), saturday: Date }
  const m = /^(\d{4})-W(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  // ISO 8601: week 1 is the week with the first Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  return { start: monday, end: sunday, saturday };
}

function formatRange(iso) {
  const r = isoWeekToDateRange(iso);
  if (!r) return iso;
  const months = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  const m1 = months[r.start.getUTCMonth()];
  const m2 = months[r.end.getUTCMonth()];
  if (m1 === m2) {
    return `Week ${parseInt(iso.split('-W')[1],10)} — ${r.start.getUTCDate()} t/m ${r.end.getUTCDate()} ${m2}`;
  }
  return `Week ${parseInt(iso.split('-W')[1],10)} — ${r.start.getUTCDate()} ${m1} t/m ${r.end.getUTCDate()} ${m2}`;
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

  // Fetch Netlify Forms submissions
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID' }) };
  }
  // Find the ellemelle-signup form
  const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!formsRes.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'forms list failed' }) };
  }
  const forms = await formsRes.json();
  const form = forms.find(f => f.name === 'ellemelle-signup');
  if (!form) {
    return { statusCode: 200, headers, body: JSON.stringify({ weeks: [], total: 0 }) };
  }
  const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!subsRes.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'submissions fetch failed' }) };
  }
  const subs = await subsRes.json();

  // Helper: lookup lat/lng via PDOK Locatieserver (no key required)
  async function geocode(postcode, number) {
    if (!postcode || !number) return null;
    const pc = postcode.replace(/\s+/g,'').toUpperCase();
    const nr = String(number).replace(/\D/g,'');
    const q  = encodeURIComponent(`postcode:${pc} AND huisnummer:${nr}`);
    try {
      const r = await fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${q}&fl=centroide_ll&rows=1&fq=type:adres`, {
        headers: { 'User-Agent': 'ELLEMELLE-bezorger/1.0' },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const doc = j && j.response && j.response.docs && j.response.docs[0];
      if (!doc) return null;
      const m = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(String(doc.centroide_ll || ''));
      if (!m) return null;
      return { lat: parseFloat(m[2]), lng: parseFloat(m[1]) };
    } catch { return null; }
  }

  // Merge with blob delivery state + geocode each address (parallel)
  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const geocodes = await Promise.all(subs.map(s => geocode((s.data||{}).postcode, (s.data||{}).huisnummer)));
  const enriched = [];
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const d = s.data || {};
    const orderId = s.id;
    let state = await ordersStore.get(orderId, { type: 'json' });
    state = state || {};
    // Resolve delivery_date: prefer submitted form field; else state blob; else fallback (no_schedule deadline 28d → next sat)
    let deliveryDate = d.delivery_date || state.delivery_date || null;
    let deliveryMode = d.delivery_mode || state.delivery_mode || null;
    if (!deliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
      deliveryDate = fallbackNoScheduleDate(s.created_at);
      if (!deliveryMode) deliveryMode = 'no_schedule';
    }
    if (!deliveryMode) deliveryMode = 'production';
    const week = isoWeekOfDate(deliveryDate);
    const geo = geocodes[i] || {};
    enriched.push({
      id: orderId,
      created_at: s.created_at,
      voornaam: d.voornaam || '',
      kanaal: d.kanaal || '',
      email: d.email || '',
      telefoon: d.telefoon || '',
      straat: d.straat || '',
      huisnummer: d.huisnummer || '',
      toevoeging: d.toevoeging || '',
      postcode: d.postcode || '',
      plaats: d.plaats || '',
      lat: geo.lat || null,
      lng: geo.lng || null,
      delivery_date: deliveryDate,
      delivery_mode: deliveryMode,
      delivery_week: week,
      delivered_pot: state.delivered_pot || null,
      delivered_at: state.delivered_at || null,
      order_status: state.order_status || (state.delivered_pot ? 'delivered' : 'todo'),
    });
  }

  // Group by week
  const map = new Map();
  for (const o of enriched) {
    const k = o.delivery_week;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(o);
  }
  const weeks = Array.from(map.keys()).sort();
  const result = weeks.map(w => {
    const orders = map.get(w);
    const doneStatuses = new Set(['delivered','neighbors']);
    const allStock = orders.length > 0 && orders.every(o => o.delivery_mode === 'stock');
    return {
      iso: w,
      label: formatRange(w),
      orders,
      total: orders.length,
      delivered: orders.filter(o => doneStatuses.has(o.order_status)).length,
      all_done: orders.length > 0 && orders.every(o => doneStatuses.has(o.order_status)),
      has_all_stock: allStock,
    };
  });

  return { statusCode: 200, headers, body: JSON.stringify({ weeks: result, total: enriched.length }) };
};
