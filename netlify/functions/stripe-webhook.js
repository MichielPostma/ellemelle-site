// Stripe webhook handler.
// Listens for payment_intent.succeeded → reads temp_order_id from metadata →
// fetches pending order blob → submits to Netlify Forms + fires notify + push.
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET   — whsec_… from Stripe Dashboard → Webhooks
//   STRIPE_SECRET_KEY       — sk_live_… (for blob/auth on Stripe API if needed later)
//   NETLIFY_SITE_ID         — site id (for blob access from background fn)
//   NETLIFY_API_TOKEN       — personal access token (for blob access)
//   URL                     — base URL (auto-injected by Netlify), used for self-fetches
//
// Idempotency: writes a `ellemelle-paid-orders/<payment_intent_id>` blob on first success.
//              Subsequent retries see the marker and short-circuit.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function storeOpts(name) {
  const o = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    o.siteID = process.env.NETLIFY_SITE_ID;
    o.token  = process.env.NETLIFY_API_TOKEN;
  }
  return o;
}

// Stripe signature verification.
// Stripe-Signature header format:  t=<unix>,v1=<sig>,v1=<sig2>,…
// Signed payload = `${t}.${rawBody}` — HMAC-SHA256 with the webhook secret.
function verifyStripeSignature(rawBody, header, secret, toleranceSec) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').map(s => s.trim());
  let t = null;
  const sigs = [];
  for (const p of parts) {
    if (p.startsWith('t=')) t = p.slice(2);
    else if (p.startsWith('v1=')) sigs.push(p.slice(3));
  }
  if (!t || sigs.length === 0) return false;
  const tNum = parseInt(t, 10);
  if (!Number.isFinite(tNum)) return false;
  // 5 min default tolerance
  const tol = toleranceSec || 5 * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tNum) > tol) return false;
  const payload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  for (const sig of sigs) {
    // Timing-safe equality
    if (sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return true;
    }
  }
  return false;
}

// Form-urlencode a flat object (for Netlify Forms POST and Resend API).
function encodeForm(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_WEBHOOK_SECRET missing' }) };
  }

  // Netlify normally hands us event.body as a string. If isBase64Encoded, decode.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const sigHeader = event.headers['stripe-signature']
                 || event.headers['Stripe-Signature']
                 || event.headers['STRIPE-SIGNATURE'];

  if (!verifyStripeSignature(rawBody, sigHeader, secret)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'signature_invalid' }) };
  }

  let evt;
  try { evt = JSON.parse(rawBody); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_json' }) };
  }

  // Only act on payment_intent.succeeded — return 200 for everything else so Stripe doesn't retry.
  if (evt.type !== 'payment_intent.succeeded') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ignored: evt.type }) };
  }

  const pi = (evt.data && evt.data.object) || {};
  const piId = pi.id;
  const meta = pi.metadata || {};
  const tempOrderId  = meta.temp_order_id || '';
  const reorderPotId = (meta.reorder_pot_id || '').toUpperCase();
  const baseUrl = process.env.URL || 'https://ellemelle.netlify.app';

  // Idempotency: if we've already processed this PI, short-circuit.
  let paidStore, pendingStore;
  try {
    paidStore    = getStore(storeOpts('ellemelle-paid-orders'));
    pendingStore = getStore(storeOpts('ellemelle-pending-orders'));
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_init_failed', detail: String(e && e.message || e) }) };
  }

  try {
    const existing = await paidStore.get(piId, { type: 'json' });
    if (existing) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, idempotent: true }) };
    }
  } catch { /* not-found is fine */ }

  // Reorder branch — pot scan flow. customer-reorder owns the full reorder side-effects
  // (fetches original customer fields, files a new Netlify Forms entry with is_reorder=true,
  // flips pot.status to pickup-with-reorder, mails Michiel). It's idempotent on pot.status.
  if (/^POT-\d{3}$/.test(reorderPotId)) {
    const reorderAantal     = Math.max(1, parseInt(meta.reorder_aantal, 10) || 1);
    const reorderPickupOnly = String(meta.reorder_pickup_only || '').toLowerCase() === 'true';
    try {
      const r = await fetch(baseUrl + '/.netlify/functions/customer-reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pot_id: reorderPotId,
          aantal: reorderAantal,
          pickup_only: reorderPickupOnly,
        }),
      });
      const j = await r.json().catch(() => ({}));
      await paidStore.setJSON(piId, {
        piId, status: r.ok ? 'reorder_created' : 'reorder_failed',
        reorderPotId, response: j, at: new Date().toISOString(),
      }).catch(() => {});
      return { statusCode: 200, headers, body: JSON.stringify({ ok: r.ok, reorder: true, reorderPotId, detail: j }) };
    } catch (e) {
      await paidStore.setJSON(piId, { piId, status: 'reorder_call_failed', reorderPotId, error: String(e && e.message || e), at: new Date().toISOString() }).catch(() => {});
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, warning: 'reorder_call_failed' }) };
    }
  }

  // Fetch the pending order payload from blob storage.
  if (!tempOrderId) {
    // Mark processed but log warning — can't create the order without the payload.
    await paidStore.setJSON(piId, { piId, status: 'no_temp_order_id', at: new Date().toISOString() }).catch(() => {});
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, warning: 'no_temp_order_id_in_metadata' }) };
  }

  let pending;
  try {
    pending = await pendingStore.get(tempOrderId, { type: 'json' });
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_read_failed', detail: String(e && e.message || e) }) };
  }
  if (!pending || !pending.order) {
    await paidStore.setJSON(piId, { piId, status: 'pending_not_found', tempOrderId, at: new Date().toISOString() }).catch(() => {});
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, warning: 'pending_order_missing', tempOrderId }) };
  }

  const order = pending.order;

  // 1. Submit to Netlify Forms (root POST) — the source of truth.
  try {
    const formBody = encodeForm(Object.assign({ 'form-name': 'ellemelle-signup', 'bot-field': '' }, order));
    await fetch(baseUrl + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
  } catch (e) {
    // Don't fail the webhook — Stripe will retry and we still want the marker.
    // Save the failure for diagnostics.
    await paidStore.setJSON(piId, { piId, status: 'forms_submit_failed', tempOrderId, error: String(e && e.message || e), at: new Date().toISOString() }).catch(() => {});
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, warning: 'forms_submit_failed' }) };
  }

  // 1b. Find the newly-created Netlify Forms submission and write payment_intent_id to its
  // order blob. We need this link so refund-deposit can later find the PI for a given order.
  // Netlify Forms is eventually consistent — give it a couple of seconds, then poll.
  let netlifyOrderId = '';
  try {
    const netlifyToken = process.env.NETLIFY_API_TOKEN;
    const siteId      = process.env.NETLIFY_SITE_ID;
    if (netlifyToken && siteId) {
      // Fetch the form id for ellemelle-signup
      const fl = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
        headers: { Authorization: `Bearer ${netlifyToken}` },
      });
      const forms = fl.ok ? await fl.json() : [];
      const form = Array.isArray(forms) ? forms.find(f => f.name === 'ellemelle-signup') : null;
      if (form) {
        // Wait up to ~4s, retrying because the submission might not be indexed yet.
        const matchVN  = String(order.voornaam   || '').trim().toLowerCase();
        const matchPC  = String(order.postcode   || '').trim().toUpperCase().replace(/\s+/g, '');
        const matchHN  = String(order.huisnummer || '').trim();
        const cutoff   = Date.now() - 5 * 60 * 1000; // ignore anything older than 5 min
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 1200));
          const sl = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=10`, {
            headers: { Authorization: `Bearer ${netlifyToken}` },
          });
          const subs = sl.ok ? await sl.json() : [];
          if (!Array.isArray(subs)) continue;
          const match = subs.find(s => {
            if (!s || !s.data) return false;
            const created = new Date(s.created_at || 0).getTime();
            if (created < cutoff) return false;
            const d = s.data;
            const dVN = String(d.voornaam   || '').trim().toLowerCase();
            const dPC = String(d.postcode   || '').trim().toUpperCase().replace(/\s+/g, '');
            const dHN = String(d.huisnummer || '').trim();
            return dVN === matchVN && dPC === matchPC && dHN === matchHN;
          });
          if (match) { netlifyOrderId = match.id; break; }
        }
      }
    }
  } catch { /* best effort */ }

  // Write the PI id to the order blob so refund-deposit (admin-side) can look it up later.
  if (netlifyOrderId) {
    try {
      const ordersStore = getStore(storeOpts('ellemelle-orders'));
      const existing = (await ordersStore.get(netlifyOrderId, { type: 'json' })) || {};
      await ordersStore.setJSON(netlifyOrderId, Object.assign({}, existing, {
        payment_intent_id: piId,
        paid_at: new Date().toISOString(),
        paid_amount_cents: typeof pi.amount === 'number' ? pi.amount : (pi.amount_received || null),
      }));
    } catch { /* non-critical */ }
  }

  // 2. Fire-and-forget: confirmation email + admin push notification.
  try {
    fetch(baseUrl + '/.netlify/functions/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    }).catch(() => {});
  } catch {}

  try {
    fetch(baseUrl + '/.netlify/functions/push-send-new-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voornaam: order.voornaam,
        aantal: order.aantal,
        straat: order.straat,
        huisnummer: order.huisnummer,
      }),
    }).catch(() => {});
  } catch {}

  // 3. Mark paid + flip pending status (keep both blobs for confirmation-page lookup).
  await paidStore.setJSON(piId, {
    piId,
    status: 'created',
    tempOrderId,
    voornaam: order.voornaam,
    aantal: order.aantal,
    at: new Date().toISOString(),
  }).catch(() => {});

  try {
    await pendingStore.setJSON(tempOrderId, Object.assign({}, pending, {
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_intent_id: piId,
    }));
  } catch { /* non-critical */ }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, created: true, tempOrderId, piId }) };
};
