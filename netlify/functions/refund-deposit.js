// Admin: refund the €1 statiegeld for a delivered pot via Stripe.
// POST { password, order_id, pot_id, amount_cents? }
//
// Flow:
//   1. Resolve payment_intent_id from the order blob (saved by stripe-webhook on payment success).
//   2. Look up the underlying iDeal charge to grab the IBAN last 4 — purely for UX, so the toast
//      can say "wordt teruggestort op IBAN ****1234".
//   3. Create a Stripe refund for €1 (or the provided amount_cents) against that PI.
//   4. Update the pot blob: status → 'available', clear linkage, archive in pot.history.
//   5. Update the order blob: clear delivered_pot, set order_status → 'picked_up',
//      append a refund event to order.history.
//   6. Log a 'pot-refunded' entry on the customer's history (separate from the credit flow's
//      'pot-returned': no credit_delta because the klant got real cash back, not internal credit).
//
// Returns:
//   { ok, refund_id, amount_cents, iban_last4, eta_days }

const { getStore } = require('@netlify/blobs');
const { customerKey, appendHistory } = require('./_lib/customer');

const REFUND_ETA_DAYS = 5; // Stripe quotes ~5 business days for SEPA Credit Transfer (iDeal refund route).

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

async function stripeGET(path, secret) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    headers: { Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64') },
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error('stripe_error'), { status: r.status, detail: j });
  return j;
}

async function stripePOST(path, secret, params) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error('stripe_error'), { status: r.status, detail: j });
  return j;
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
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY missing' }) };
  }

  const orderId = String(body.order_id || '').trim();
  const potId   = String(body.pot_id   || '').toUpperCase().trim();
  const amount  = Math.max(50, parseInt(body.amount_cents, 10) || 300); // default €3, Stripe min 50¢
  if (!orderId || !/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid order_id or pot_id' }) };
  }

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));

  const pot       = await potsStore.get(potId,   { type: 'json' });
  const orderBlob = (await ordersStore.get(orderId, { type: 'json' })) || {};

  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  }
  let piId = orderBlob.payment_intent_id;

  // Fallback: als het order blob geen PI-id heeft (bv. webhook gemist), zoek Stripe direct
  // op de order-id in de metadata. Zowel PaymentIntents (nieuwe iDeal flow) als Checkout
  // Sessions (legacy fallback) hebben deze metadata gekregen bij creatie.
  if (!piId) {
    try {
      const q = encodeURIComponent(`metadata['order_id']:'${orderId}' AND status:'succeeded'`);
      const found = await stripeGET('/payment_intents/search?query=' + q + '&limit=1', secret);
      if (found.data && found.data[0] && found.data[0].id) {
        piId = found.data[0].id;
        // Persist it terug op het order blob zodat volgende calls direct raken.
        orderBlob.payment_intent_id = piId;
        await ordersStore.setJSON(orderId, orderBlob);
      }
    } catch { /* value blijft null → 409 hieronder */ }
  }
  if (!piId) {
    try {
      const q = encodeURIComponent(`metadata['order_id']:'${orderId}'`);
      const sess = await stripeGET('/checkout/sessions/search?query=' + q + '&limit=1', secret);
      const s = sess.data && sess.data[0];
      if (s && s.payment_intent) {
        piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent.id;
        orderBlob.payment_intent_id = piId;
        await ordersStore.setJSON(orderId, orderBlob);
      }
    } catch { /* still nothing → return 409 */ }
  }

  const manualMode = !!body.manual; // caller explicitly weet dat er geen Stripe-refund gedaan wordt
  if (!piId && !manualMode) {
    return {
      statusCode: 409, headers,
      body: JSON.stringify({
        error: 'no payment intent on order — refund not possible via Stripe',
        manual_available: true,
      }),
    };
  }

  // Look up the original charge to surface the last 4 of the IBAN (for the success toast).
  let ibanLast4 = '';
  let refund = { id: `manual_${orderId}_${Date.now()}` };

  if (!manualMode) {
    try {
      const pi = await stripeGET('/payment_intents/' + encodeURIComponent(piId) + '?expand[]=latest_charge', secret);
      const charge = pi.latest_charge && typeof pi.latest_charge === 'object'
        ? pi.latest_charge
        : (pi.latest_charge ? await stripeGET('/charges/' + encodeURIComponent(pi.latest_charge), secret) : null);
      const ideal = charge && charge.payment_method_details && charge.payment_method_details.ideal;
      if (ideal && ideal.iban_last4) ibanLast4 = String(ideal.iban_last4);
    } catch { /* the refund itself doesn't depend on us knowing the IBAN */ }

    // Issue the refund via Stripe.
    try {
      refund = await stripePOST('/refunds', secret, {
        payment_intent: piId,
        amount: String(amount),
        reason: 'requested_by_customer',
        'metadata[order_id]': orderId,
        'metadata[pot_id]':   potId,
        'metadata[kind]':     'deposit_refund',
      });
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'stripe_refund_failed', detail: e.detail || String(e) }) };
    }
  }

  const now = new Date().toISOString();

  // Archive the trip on the pot — same shape bezorger-pot-return uses, with refund details added.
  const potHistory = Array.isArray(pot.history) ? pot.history.slice() : [];
  potHistory.push({
    at: now,
    action: 'returned',
    kind: 'refund',
    order_id: pot.order_id || orderId,
    delivered_at: pot.delivered_at || null,
    returned_at: now,
    refund_id: refund.id,
    refund_amount_cents: amount,
    iban_last4: ibanLast4 || null,
  });

  await potsStore.setJSON(potId, {
    ...pot,
    status: 'available',
    order_id: null,
    delivered_at: null,
    delivered_to: null,
    returned_at: null,
    returned_for_order: null,
    history: potHistory,
  });

  // Order side: clear pot link, mark picked_up, append refund event to order.history.
  const orderHistory = Array.isArray(orderBlob.history) ? orderBlob.history.slice() : [];
  orderHistory.push({
    at: now,
    action: 'deposit_refunded',
    pot_id: potId,
    amount_cents: amount,
    refund_id: refund.id,
    iban_last4: ibanLast4 || null,
  });
  await ordersStore.setJSON(orderId, {
    ...orderBlob,
    delivered_pot: null,
    pot_returned_at: now,
    pot_returned_was_refund: true,
    order_status: 'picked_up',
    history: orderHistory,
  });

  // Customer-history log — no credit delta (real cash refund, not internal credit).
  try {
    const token = process.env.NETLIFY_API_TOKEN;
    if (token) {
      const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sub.ok) {
        const j = await sub.json();
        const d = j.data || {};
        const ck = customerKey(d);
        if (ck) {
          await appendHistory(ck, d, {
            action: 'pot-refunded',
            pot_id: potId,
            order_id: orderId,
            refund_id: refund.id,
            amount_cents: amount,
            iban_last4: ibanLast4 || null,
          });
        }
      }
    }
  } catch { /* best effort */ }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      refund_id: refund.id,
      amount_cents: amount,
      iban_last4: ibanLast4 || null,
      eta_days: manualMode ? null : REFUND_ETA_DAYS,
      manual: manualMode,
    }),
  };
};
