// Admin: refund a customer's entire statiegeld credit balance via Stripe.
// POST { password, key }
//
// Strategy:
//   1. Resolve customer + their orders via the same identity-key matcher as klant-get.
//   2. Compute amount_cents = statiegeld_credit × 300.
//   3. Walk the customer's orders newest-first; for each one that has a payment_intent_id,
//      look up how much is still refundable on that PI (pi.amount minus already-refunded sum),
//      and issue a refund for as much of the remaining-needed amount as that PI can cover.
//   4. After all refunds succeed, set customer.statiegeld_credit = 0 and append a single
//      history entry summarising the total refund + first iban_last4 (for display).

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders, blobOpts, customerMatchKey } = require('./_lib/orders');
const { getCustomer, saveCustomer, customerKey } = require('./_lib/customer');

const REFUND_ETA_DAYS = 5;

function makeIdentityKey(o) {
  const ck = customerMatchKey(o);
  if (ck) return ck;
  const addr = `${(o.straat||'').toLowerCase()}|${(o.huisnummer||'')}|${(o.toevoeging||'').toLowerCase()}`;
  const name = (o.voornaam || '').toLowerCase().trim();
  return `addr:${name}|${addr}`;
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
  const key = String(body.key || '').trim();
  if (!key) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing key' }) };
  }

  const { all: orders } = await listEnrichedOrders();
  // Accept both key formats (see klant-get.js).
  const matching = orders.filter(o => {
    if (makeIdentityKey(o) === key) return true;
    const ck = customerKey(o);
    if (ck && ck === key) return true;
    return false;
  });
  if (matching.length === 0) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'customer not found' }) };
  }
  matching.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const newest = matching[0];

  const ck = customerKey({ kanaal: newest.kanaal, telefoon: newest.telefoon, email: newest.email });
  const cust = ck ? (await getCustomer(ck)) : null;
  const creditUnits = (cust && cust.statiegeld_credit) || 0;
  let needed = creditUnits * 300; // €3 per outstanding pot
  if (needed < 50) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'no credit to refund' }) };
  }

  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const refunds = [];
  let firstIbanLast4 = '';

  for (const o of matching) {
    if (needed <= 0) break;
    const blob = (await ordersStore.get(o.id, { type: 'json' })) || {};
    const piId = blob.payment_intent_id;
    if (!piId) continue;

    // How much is still refundable on this PI?
    let pi;
    try { pi = await stripeGET('/payment_intents/' + encodeURIComponent(piId) + '?expand[]=latest_charge', secret); }
    catch { continue; }
    const piAmount = Number(pi.amount || 0);
    let alreadyRefunded = 0;
    try {
      const list = await stripeGET('/refunds?payment_intent=' + encodeURIComponent(piId) + '&limit=100', secret);
      for (const r of (list.data || [])) {
        if (r.status === 'succeeded' || r.status === 'pending') alreadyRefunded += Number(r.amount || 0);
      }
    } catch {}
    const remaining = Math.max(0, piAmount - alreadyRefunded);
    if (remaining < 50) continue;

    const thisAmount = Math.min(needed, remaining);
    if (thisAmount < 50) continue; // Stripe rejects < 50¢

    let refund;
    try {
      refund = await stripePOST('/refunds', secret, {
        payment_intent: piId,
        amount: String(thisAmount),
        reason: 'requested_by_customer',
        'metadata[order_id]': o.id,
        'metadata[customer_key]': key,
        'metadata[kind]': 'klant_credit_refund',
      });
    } catch (e) {
      // Continue trying other PIs; collect the error for the response.
      refunds.push({ order_id: o.id, error: e.detail || String(e) });
      continue;
    }

    // Capture IBAN last 4 from the original charge (best-effort, first one wins).
    if (!firstIbanLast4) {
      const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      const ideal = charge && charge.payment_method_details && charge.payment_method_details.ideal;
      if (ideal && ideal.iban_last4) firstIbanLast4 = String(ideal.iban_last4);
    }

    needed -= thisAmount;
    refunds.push({ order_id: o.id, refund_id: refund.id, amount_cents: thisAmount });
  }

  const totalRefunded = (creditUnits * 300) - Math.max(0, needed);
  if (totalRefunded < 50) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'no PI capacity for refund', detail: refunds }) };
  }

  // Reset customer credit (subtract only what we managed to actually refund).
  if (cust) {
    const unitsRefunded = Math.floor(totalRefunded / 300);
    const newCredit = Math.max(0, (cust.statiegeld_credit || 0) - unitsRefunded);
    cust.statiegeld_credit = newCredit;
    cust.history = Array.isArray(cust.history) ? cust.history : [];
    cust.history.push({
      ts: new Date().toISOString(),
      action: 'credit-refunded',
      amount_cents: totalRefunded,
      iban_last4: firstIbanLast4 || null,
      refund_ids: refunds.filter(r => r.refund_id).map(r => r.refund_id),
      via: 'klant_detail',
    });
    try { await saveCustomer(ck, cust); } catch { /* swallow */ }
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      total_amount_cents: totalRefunded,
      iban_last4: firstIbanLast4 || null,
      eta_days: REFUND_ETA_DAYS,
      refunds,
    }),
  };
};
