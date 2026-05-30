// Lists Netlify Forms signups grouped by ISO delivery-week,
// using the shared chronological stock-allocation in _lib/orders.
//
// In addition to delivery orders, this also synthesises pickup-only stops for pots that
// the klant has requested to pick up (status === 'pickup-requested'). These pickups are
// scheduled for the next Saturday after pickup_requested_at and merged into the same week
// grouping the deliveries use. Each entry carries a `stop_type`:
//   - 'levering'         — pure delivery
//   - 'pickup'           — pickup-only stop (no new delivery)
//   - 'pickup_levering'  — combined: new pot delivery + old pot pickup (reorder + swap)

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders, isoWeekOfDate, nextSaturdayISO, toISODate, blobOpts } = require('./_lib/orders');
const { POT_IDS } = require('./_lib/inventory');

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

  // -----------------------------------------------------------------------------
  // Tag deliveries + synthesise pickup-only stops.
  //
  // 1. Walk all pots; collect ones with status 'pickup-requested' (klant scanned + chose ophalen)
  //    or 'pickup-with-reorder' (klant scanned + chose nieuwe pot — old pot also needs pickup).
  // 2. For each delivery order, decide its stop_type by checking whether one of its pots is
  //    a "swap" pickup (reorder linked to a previously delivered pot at same address).
  // 3. For pure pickup-requested pots (no reorder), build a synthetic stop entry for the
  //    bezorger overview, scheduled for the next Saturday after pickup_requested_at.
  // -----------------------------------------------------------------------------
  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const pickupPots = []; // { pot, pot_status, pickup_at_iso, order_id }
  for (const pid of POT_IDS) {
    let p;
    try { p = await potsStore.get(pid, { type: 'json' }); } catch { continue; }
    if (!p) continue;
    if (p.status !== 'pickup-requested' && p.status !== 'pickup-with-reorder') continue;
    pickupPots.push({
      pot_id: pid,
      pot_status: p.status,
      pickup_at_iso: p.pickup_requested_at || p.reorder_at || new Date().toISOString(),
      order_id: p.order_id || null,
    });
  }

  // Index orders by id for quick lookup
  const ordersById = new Map();
  for (const o of allEnriched) ordersById.set(o.id, o);

  // Helper: figure out which delivery order corresponds to the new pot for a 'pickup-with-reorder' pot.
  // The reorder flow files a new Netlify Forms entry with is_reorder=true + original_pot_id=POT-X.
  function findReorderForOldPot(potId) {
    return allEnriched.find(o => o.is_reorder && o.original_pot_id === potId
                              && !['delivered','neighbors','picked_up'].includes(o.order_status));
  }

  // Default every delivery to stop_type='levering' first.
  for (const o of allEnriched) o.stop_type = 'levering';

  // For each pickup pot, decide where it fits.
  const syntheticPickupStops = [];
  for (const pp of pickupPots) {
    if (pp.pot_status === 'pickup-with-reorder') {
      // The new delivery order picks up this pot at the same address.
      const reorder = findReorderForOldPot(pp.pot_id);
      if (reorder) {
        reorder.stop_type = 'pickup_levering';
        reorder.pickup_pot_id = pp.pot_id;
        continue;
      }
      // No matching reorder (yet) — fall through to a synthetic pickup-only stop.
    }
    // Pickup-only entry — schedule next Saturday after the pickup request.
    const pickupDate = nextSaturdayISO(toISODate(new Date(pp.pickup_at_iso)));
    const pickupWeek = isoWeekOfDate(pickupDate);
    const origOrder  = pp.order_id ? ordersById.get(pp.order_id) : null;
    if (!origOrder) continue; // pot has order_id but enriched list doesn't have it (e.g. deleted)
    syntheticPickupStops.push({
      // Reuse customer fields from the original order so the bezorger card has address etc.
      id: 'pickup:' + pp.pot_id,
      pickup_for_order_id: pp.order_id,
      pickup_pot_id: pp.pot_id,
      stop_type: 'pickup',
      created_at: pp.pickup_at_iso,
      voornaam: origOrder.voornaam, kanaal: origOrder.kanaal, telefoon: origOrder.telefoon, email: origOrder.email,
      straat: origOrder.straat, huisnummer: origOrder.huisnummer, toevoeging: origOrder.toevoeging,
      postcode: origOrder.postcode, plaats: origOrder.plaats,
      lat: origOrder.lat, lng: origOrder.lng,
      aantal: 0, // no new delivery
      order_status: 'pickup_requested',
      delivery_date: pickupDate,
      delivery_week: pickupWeek,
      delivery_mode: 'pickup',
      uiterlijke_bezorgdatum: pickupDate,
      uiterlijke_bezorgdatum_computed: pickupDate,
      uiterlijke_bezorgdatum_override: null,
    });
  }

  // Pickup-only orders (customer comes to collect at Busken Huëtstraat) don't need a bezorger stop.
  const deliverableStops = allEnriched.filter(o => !o.pickup_only);

  // Combine deliveries + synthetic pickups into one flat list before grouping.
  const allStops = deliverableStops.concat(syntheticPickupStops);

  // Group by ISO week of delivery_date
  const map = new Map();
  for (const o of allStops) {
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

  return { statusCode: 200, headers, body: JSON.stringify({ weeks: result, total: allEnriched.length, stock_count: totalStock }) };
};
