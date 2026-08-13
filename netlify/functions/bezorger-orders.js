// Lists Netlify Forms signups grouped by ISO delivery-week,
// using the shared chronological stock-allocation in _lib/orders.

const { listEnrichedOrders, isoWeekOfDate } = require('./_lib/orders');

function isoWeekToDateRange(iso) {
  const m = /^(\d{4})-W(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
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

// PDOK geocoder
async function geocode(postcode, number) {
  if (!postcode || !number) return null;
  const pc = postcode.replace(/\s+/g,'').toUpperCase();
  const nr = String(number).replace(/\D/g,'');
  const q  = encodeURIComponent(`postcode:${pc} AND huisnummer:${nr}`);
  try {
    const r = await fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${q}&fl=centroide_ll&rows=1&fq=type:adres`, {
      headers: { 'User-Agent': 'Ellemel-bezorger/1.0' },
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
  let allEnriched, totalStock;
  try {
    const res = await listEnrichedOrders();
    allEnriched = res.all;
    totalStock = res.total_stock;
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }

  // Geocode in parallel for bezorger view
  const geos = await Promise.all(allEnriched.map(o => geocode(o.postcode, o.huisnummer)));
  allEnriched.forEach((o, i) => {
    if (geos[i]) { o.lat = geos[i].lat; o.lng = geos[i].lng; }
  });

  // Group by ISO week of delivery_date
  const map = new Map();
  for (const o of allEnriched) {
    // Groepeer per week ÉN per optioneel custom_delivery_label — als admin een aangepaste
    // bezorging plant met een naam, wordt die een eigen entry in de bezorgen-dropdown.
    const labelKey = o.custom_delivery_label || '';
    const k = o.delivery_week + '::' + labelKey;
    if (!map.has(k)) map.set(k, { week: o.delivery_week, label: labelKey, orders: [] });
    map.get(k).orders.push(o);
  }
  const keys = Array.from(map.keys()).sort();
  const result = keys.map(k => {
    const bucket = map.get(k);
    const orders = bucket.orders;
    const doneStatuses = new Set(['delivered','neighbors']);
    const allStock = orders.length > 0 && orders.every(o => o.delivery_mode === 'stock');
    return {
      iso: bucket.week,
      label: formatRange(bucket.week),
      custom_label: bucket.label || null,
      orders,
      total: orders.length,
      delivered: orders.filter(o => doneStatuses.has(o.order_status)).length,
      all_done: orders.length > 0 && orders.every(o => doneStatuses.has(o.order_status)),
      has_all_stock: allStock,
    };
  });

  return { statusCode: 200, headers, body: JSON.stringify({ weeks: result, total: allEnriched.length, stock_count: totalStock }) };
};
