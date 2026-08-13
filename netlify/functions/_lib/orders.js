// Shared helper: fetch Netlify Forms submissions, enrich with blob state,
// and apply chronological voorraad allocation (oldest orders consume stock first).

const { getStore } = require('@netlify/blobs');
const { countInStock } = require('./inventory');
const { customerKey, appendHistory } = require('./customer');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

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


// Compute uiterlijke (fixed promise) from snapshot mode + created_at + snapshot_date
function computeUiterlijke(createdAt, snapshotMode, snapshotDate) {
  if (snapshotMode === 'stock') {
    // 1 week belofte: next saturday at least 7 days after order
    const base = new Date(createdAt);
    base.setUTCDate(base.getUTCDate() + 7);
    return nextSaturdayISO(toISODate(base));
  }
  if (snapshotMode === 'production') {
    // Snapshot already captures next saturday after production_date at submit-time
    return snapshotDate;
  }
  // no_schedule fallback
  return fallbackNoScheduleDate(createdAt);
}

// Short-TTL cache for the form lookup (form id never changes per site)
let __formCache = { at: 0, form: null };
const __FORM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllSubmissions() {
  const token  = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) throw new Error('missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID');
  let form = __formCache.form;
  if (!form || (Date.now() - __formCache.at) > __FORM_CACHE_TTL_MS) {
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!formsRes.ok) throw new Error('forms list failed');
    const forms = await formsRes.json();
    form = forms.find(f => f.name === 'ellemelle-signup');
    if (!form) return { form: null, subs: [] };
    __formCache = { at: Date.now(), form };
  }
  const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!subsRes.ok) throw new Error('submissions fetch failed');
  const subs = await subsRes.json();
  return { form, subs };
}

async function deleteSubmission(orderId) {
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token) throw new Error('missing NETLIFY_API_TOKEN');
  const r = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 404) {
    const t = await r.text().catch(() => '');
    throw new Error(`delete failed: ${r.status} ${t.slice(0,200)}`);
  }
  return true;
}

// Module-level warm-function cache for listEnrichedOrders (cuts repeat polls to ~0ms).
let __orderCache = { at: 0, data: null };
const __ORDER_CACHE_TTL_MS = 5000;

// Enrich + chronologically allocate stock. Returns array of orders with effective delivery_date/mode.
async function listEnrichedOrders() {
  // Warm cache (per warm-function instance) — admin pages poll repeatedly within seconds
  if (__orderCache.data && (Date.now() - __orderCache.at) < __ORDER_CACHE_TTL_MS) {
    // Deep-ish clone via JSON to avoid callers mutating the cached array (esp. delivery_mode/date)
    return JSON.parse(JSON.stringify(__orderCache.data));
  }
  const [subsResult, totalStock] = await Promise.all([
    fetchAllSubmissions(),
    countInStock(),
  ]);
  const subs = subsResult.subs;
  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  // Parallel blob reads — was N serial reads (~50-100ms each = multi-second), now one round-trip
  const states = await Promise.all(
    subs.map(s => ordersStore.get(s.id, { type: 'json' }).catch(() => null))
  );
  const enriched = [];
  const backfillWrites = [];
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    const d = sub.data || {};
    const orderId = sub.id;
    let state = states[i] || {};
    let snapshotDate = d.delivery_date || state.delivery_date_snapshot || null;
    let snapshotMode = d.delivery_mode || state.delivery_mode || null;
    if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      snapshotDate = fallbackNoScheduleDate(sub.created_at);
      if (!snapshotMode) snapshotMode = 'no_schedule';
    }
    if (!snapshotMode) snapshotMode = 'production';
    // Backfill uiterlijke_bezorgdatum on first read — fixed at original promise.
    // Collect writes for fire-and-forget AFTER returning so we don't block the response.
    if (!state.uiterlijke_bezorgdatum_computed) {
      state.uiterlijke_bezorgdatum_computed = computeUiterlijke(sub.created_at, snapshotMode, snapshotDate);
      const histEntry = { at: new Date().toISOString(), action: 'backfill_uiterlijke', value: state.uiterlijke_bezorgdatum_computed };
      state.history = Array.isArray(state.history) ? state.history.concat([histEntry]) : [histEntry];
      backfillWrites.push(ordersStore.setJSON(orderId, state).catch(() => null));
    }
    // Lazy first-seen credit application: orders enter via Netlify Forms (no server hook),
    // so we apply the +€1/pot deposit credit the FIRST time we observe an order.
    // Idempotent via state.credit_applied flag. Reorders skip the increment (the deposit
    // rolls onto the new pot from the previous one — bezorger-pot-return.js handles the swap).
    if (!state.credit_applied) {
      const isReorder = String(d.is_reorder || '').toLowerCase() === 'true';
      const aantal = Math.max(1, parseInt(d.aantal || 1, 10) || 1);
      const ck = customerKey(d);
      state.credit_applied = true;
      state.credit_applied_at = new Date().toISOString();
      state.credit_applied_amount = isReorder ? 0 : aantal;
      state.credit_applied_skipped_reason = isReorder ? 'reorder-swap' : null;
      const histEntry2 = {
        at: state.credit_applied_at,
        action: 'apply_order_credit',
        amount: state.credit_applied_amount,
        is_reorder: isReorder,
      };
      state.history = Array.isArray(state.history) ? state.history.concat([histEntry2]) : [histEntry2];
      backfillWrites.push(ordersStore.setJSON(orderId, state).catch(() => null));
      if (!isReorder && ck) {
        backfillWrites.push(appendHistory(ck, d, {
          action: 'order-placed', order_id: orderId, aantal, credit_delta: aantal,
        }).catch(() => null));
      }
    }
    const uiterlijke = state.uiterlijke_bezorgdatum_override || state.uiterlijke_bezorgdatum_computed;
    enriched.push({
      id: orderId,
      created_at: sub.created_at,
      aantal:     Math.max(1, parseInt(d.aantal || 1, 10) || 1),
      voornaam:   d.voornaam   || '',
      kanaal:     d.kanaal     || '',
      email:      d.email      || '',
      telefoon:   d.telefoon   || '',
      straat:     d.straat     || '',
      huisnummer: d.huisnummer || '',
      toevoeging: d.toevoeging || '',
      postcode:   d.postcode   || '',
      plaats:     d.plaats     || '',
      is_extra:        d.is_extra        || '',
      parent_order_id: d.parent_order_id || '',
      // Reorder-from-pot context (set by customer-reorder.js when klant scans pot + bestelt nieuwe).
      is_reorder:      String(d.is_reorder || '').toLowerCase() === 'true',
      original_pot_id: d.original_pot_id || '',
      original_order_id: d.original_order_id || '',
      // Out-of-area pickup-only flag — set by index.html step 2 fallback flow.
      pickup_only:     String(d.pickup_only || '').toLowerCase() === 'true',
      // Snapshot fallback
      snapshot_delivery_date: snapshotDate,
      snapshot_delivery_mode: snapshotMode,
      // Uiterlijke (fixed promise — never moves with stock changes)
      uiterlijke_bezorgdatum: uiterlijke,
      uiterlijke_bezorgdatum_computed: state.uiterlijke_bezorgdatum_computed,
      uiterlijke_bezorgdatum_override: state.uiterlijke_bezorgdatum_override || null,
      // Manual override of GEPLANDE bezorgweek
      delivery_date_override: state.delivery_date_override || null,
      // Custom label voor bezorging (bv. "Ronde Ellis") — override op de standaard weeknaam
      custom_delivery_label: state.custom_delivery_label || null,
      // Update-message tracker (for koken batch flow)
      update_message_status: state.update_message_status || 'not_sent',
      update_message_status_at: state.update_message_status_at || null,
      // Stable contact-hash for customer credit + grouping (sha1 hex of normalized phone/email)
      customer_key: customerKey(d),
      // Customer satisfaction ratings (filled in via /pot/:id survey)
      ratings: state.ratings || null,
      rated_at: state.rated_at || null,
      // Delivery progress
      delivered_pot: state.delivered_pot || null,
      delivered_at:  state.delivered_at  || null,
      // Pots admin manually pre-coupled to this order (separate from `delivered_pot` which is set on actual delivery).
      assigned_pots: Array.isArray(state.assigned_pots) ? state.assigned_pots : [],
      order_status:  state.order_status  || (state.delivered_pot ? 'delivered' : 'todo'),
      deleted: !!state.deleted,
      history: Array.isArray(state.history) ? state.history : [],
      // Stripe-payment context — bedrag dat daadwerkelijk is afgerekend.
      // paid_amount_cents wordt door stripe-webhook op het order-blob gezet
      // bij payment_intent.succeeded. Ontbreekt bij Tikkie/handmatige orders.
      payment_intent_id: state.payment_intent_id || null,
      paid_amount_cents: (typeof state.paid_amount_cents === 'number')
        ? state.paid_amount_cents
        // Fallback voor historische Stripe-orders vóór de €3-fix: statiegeld
        // was toen €1/pot, dus €5 product + €1 statiegeld − €1 credit/pot.
        : (state.payment_intent_id
            ? (function() {
                const a = Math.max(1, parseInt(d.aantal || 1, 10) || 1);
                const credit = Math.max(0, parseInt(d.statiegeld_credit || 0, 10) || 0);
                return Math.max(50, a * 500 + a * 100 - Math.min(credit, a) * 100);
              })()
            : null),
    });
  }

  // Drop "deleted" orders from view
  const visible = enriched.filter(o => !o.deleted);

  // Chronological stock allocation — totalStock already fetched in parallel above
  const open = visible.filter(o => !['delivered','neighbors'].includes(o.order_status));
  const done = visible.filter(o =>  ['delivered','neighbors'].includes(o.order_status));
  open.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let remaining = totalStock;
  for (const o of open) {
    // Stock allocation is chronological — override orders ALSO consume a stock pot when available
    // (the override date is preserved; only the production-budget bookkeeping changes).
    const hasOverride = !!o.delivery_date_override;
    if (remaining > 0) {
      o.delivery_mode = 'stock';
      o.delivery_date = hasOverride
        ? o.delivery_date_override
        : nextSaturdayISO(toISODate(o.created_at));
      remaining -= 1;
    } else if (hasOverride) {
      o.delivery_mode = 'override';
      o.delivery_date = o.delivery_date_override;
    } else {
      o.delivery_mode = o.snapshot_delivery_mode;
      o.delivery_date = o.snapshot_delivery_date;
    }
    o.delivery_week = isoWeekOfDate(o.delivery_date);
  }
  for (const o of done) {
    o.delivery_mode = o.delivery_date_override ? 'override' : o.snapshot_delivery_mode;
    o.delivery_date = o.delivery_date_override || o.snapshot_delivery_date;
    o.delivery_week = isoWeekOfDate(o.delivery_date);
  }
  // Compute is_te_laat — geplande > uiterlijke (only "te laat" when ECHT past promise)
  for (const o of [...open, ...done]) {
    o.geplande_bezorgweek = o.delivery_date;
    o.is_te_laat = !!(o.uiterlijke_bezorgdatum && o.delivery_date && o.delivery_date > o.uiterlijke_bezorgdatum);
  }
  const result = { all: [...open, ...done], total_stock: totalStock };
  __orderCache = { at: Date.now(), data: result };
  // Fire-and-forget backfill writes — don't block the response
  if (backfillWrites.length) {
    Promise.allSettled(backfillWrites).catch(() => {});
  }
  return JSON.parse(JSON.stringify(result));
}

// Invalidate the warm cache (call after any blob mutation that affects orders).
function invalidateOrderCache() {
  __orderCache = { at: 0, data: null };
}

// Find related orders for the same customer (match on phone digits or lowercase email)
function customerMatchKey(o) {
  const k = (o.kanaal || '').toLowerCase();
  if (k === 'whatsapp' && o.telefoon) return 'tel:' + String(o.telefoon).replace(/\D/g, '');
  if (o.email) return 'mail:' + String(o.email).trim().toLowerCase();
  return null;
}


// Sum of aantal across all orders with order_status === 'todo' (active, not yet delivered/neighbors).
async function sumActiveOrderPots() {
  const { all } = await listEnrichedOrders();
  return all
    .filter(o => o.order_status === 'todo')
    .reduce((sum, o) => sum + (parseInt(o.aantal, 10) || 1), 0);
}

module.exports = {
  blobOpts, toISODate, nextSaturdayISO, isoWeekOfDate, fallbackNoScheduleDate, computeUiterlijke,
  invalidateOrderCache,
  fetchAllSubmissions, deleteSubmission, listEnrichedOrders, sumActiveOrderPots, customerMatchKey,
};
