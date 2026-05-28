// Create + immediately confirm a Stripe Payment Intent for an iDeal payment with a pre-selected bank.
// POST { voornaam, aantal, statiegeld_credit?, bank, email?, order_id?, success_pot_id?, full_order?, reorder_pot_id? }
// Returns { url, payment_intent_id, temp_order_id? } where `url` is the iDeal bank redirect (skips Stripe Checkout entirely).
//
// Reorder flow (klant scant pot → wil nieuwe pot): caller supplies `reorder_pot_id` instead of `full_order`.
// The webhook will read that id from metadata on payment success and call customer-reorder server-to-server,
// which derives the customer fields from the original order and files the new entry.
//
// Pricing (cents):
//   product:  aantal × 500
//   deposit:  aantal × 100
//   discount: min(statiegeld_credit, aantal) × 100   (capped at deposit)
//
// Why server-side confirm? With `confirm=true` and `payment_method_data.ideal.bank`, Stripe creates and
// confirms the intent in one call, returning next_action.redirect_to_url.url — the bank's iDeal page.
// This skips both Stripe Checkout (email/name/Wero) and the client-side Stripe.js library entirely.
//
// Order-after-payment: when `full_order` is supplied, the full order payload is written to the
// `ellemelle-pending-orders` blob under a generated `temp_order_id`, and that id is attached to the
// PaymentIntent metadata. The Stripe webhook reads that id on payment_intent.succeeded and only then
// creates the actual Netlify Forms entry, ensuring no order is filed for failed/abandoned payments.

const { getStore } = require('@netlify/blobs');

const VALID_BANKS = new Set([
  'abn_amro','asn_bank','bunq','handelsbanken','ing','knab','moneyou','n26','nn',
  'rabobank','regiobank','revolut','sns_bank','triodos_bank','van_lanschot','yoursafe'
]);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function storeOpts(name) {
  const o = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    o.siteID = process.env.NETLIFY_SITE_ID;
    o.token  = process.env.NETLIFY_API_TOKEN;
  }
  return o;
}

async function writePendingOrder(orderPayload) {
  const id = uuid();
  const record = {
    id,
    order: orderPayload,
    created_at: new Date().toISOString(),
    status: 'awaiting_payment',
  };
  const store = getStore(storeOpts('ellemelle-pending-orders'));
  await store.setJSON(id, record);
  return id;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY missing' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const aantal = Math.max(1, parseInt(body.aantal, 10) || 1);
  const credit = Math.max(0, parseInt(body.statiegeld_credit, 10) || 0);
  const bank = String(body.bank || '').trim();
  if (bank && !VALID_BANKS.has(bank)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_bank', bank }) };
  }

  const productCents  = aantal * 500;
  const depositCents  = aantal * 100;
  const discountCents = Math.min(credit, aantal) * 100;
  const totalCents    = Math.max(50, productCents + depositCents - discountCents); // Stripe min: 50 cents

  const voornaam = String(body.voornaam || '').trim() || 'klant';
  const orderId  = body.order_id ? String(body.order_id) : '';
  const baseUrl  = process.env.URL || 'https://ellemelle.netlify.app';

  // Order-after-payment: persist full order payload in blob storage under a fresh UUID.
  // The webhook will read this on payment_intent.succeeded and only then submit to Netlify Forms.
  let tempOrderId = '';
  if (body.full_order && typeof body.full_order === 'object') {
    try {
      tempOrderId = await writePendingOrder(body.full_order);
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'blob_write_failed', detail: String(e && e.message || e) }) };
    }
  }

  // Reorder context: just a pot id — webhook fetches original customer fields via customer-reorder.
  const reorderPotId = String(body.reorder_pot_id || '').toUpperCase().trim();
  const isReorder = /^POT-\d{3}$/.test(reorderPotId);

  // Build the return URL. Prefer success_pay_id (pay.html QR-handoff) → success_pot_id (reorder) →
  // orderId (admin direct) → '/'.
  const successPayId = String(body.success_pay_id || '').trim();
  const successPath = successPayId
    ? `/pay/${encodeURIComponent(successPayId)}`
    : body.success_pot_id
      ? `/pot/${encodeURIComponent(body.success_pot_id)}`
      : orderId
        ? `/bestelling/${encodeURIComponent(orderId)}`
        : '/';
  const params = new URLSearchParams();
  params.set('paid', 'stripe');
  if (voornaam && voornaam !== 'klant') params.set('voornaam', voornaam);
  if (tempOrderId) params.set('order_ref', tempOrderId);
  const returnUrl = `${baseUrl}${successPath}?${params.toString()}`;

  // No-bank path: try Payment Intents API with confirm=true and iDEAL without specifying a bank.
  // For iDEAL 2.0/Wero this typically returns a redirect URL to pay.ideal.nl where the customer picks a bank.
  // Skips the Stripe Checkout hosted page (no email/name/Wero choice step).
  if (!bank) {
    const pParams = new URLSearchParams();
    pParams.set('amount', String(totalCents));
    pParams.set('currency', 'eur');
    pParams.set('payment_method_types[0]', 'ideal');
    pParams.set('payment_method_data[type]', 'ideal');
    pParams.set('payment_method_data[billing_details][name]', voornaam);
    const email = String(body.email || '').trim();
    if (email && /@/.test(email)) {
      pParams.set('payment_method_data[billing_details][email]', email);
      pParams.set('receipt_email', email);
    }
    pParams.set('description', `ELLEMELLE chocopasta — ${aantal} pot${aantal === 1 ? '' : 'ten'}`);
    pParams.set('confirm', 'true');
    pParams.set('return_url', returnUrl);
    if (orderId)      pParams.set('metadata[order_id]', orderId);
    if (tempOrderId)  pParams.set('metadata[temp_order_id]', tempOrderId);
    if (isReorder)    pParams.set('metadata[reorder_pot_id]', reorderPotId);
    if (voornaam)     pParams.set('metadata[voornaam]', voornaam);
    pParams.set('metadata[aantal]', String(aantal));
    pParams.set('metadata[statiegeld_credit]', String(credit));
    try {
      const pr = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: pParams.toString(),
      });
      const pd = await pr.json();
      if (!pr.ok) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'stripe_error_pi_no_bank', detail: pd }) };
      }
      const redirectUrl = pd.next_action && pd.next_action.redirect_to_url && pd.next_action.redirect_to_url.url;
      if (!redirectUrl) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'no_redirect_url_no_bank', status: pd.status }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ url: redirectUrl, payment_intent_id: pd.id, temp_order_id: tempOrderId }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
    }
  }
  // Bank pre-selected: use Payment Intents with confirm=true → direct bank redirect (skip Stripe Checkout)
  const params2 = new URLSearchParams();
  params2.set('amount', String(totalCents));
  params2.set('currency', 'eur');
  params2.set('payment_method_types[0]', 'ideal');
  params2.set('payment_method_data[type]', 'ideal');
  params2.set('payment_method_data[ideal][bank]', bank);
  params2.set('payment_method_data[billing_details][name]', voornaam);
  const email = String(body.email || '').trim();
  if (email && /@/.test(email)) {
    params2.set('payment_method_data[billing_details][email]', email);
    params2.set('receipt_email', email);
  }
  params2.set('description', `ELLEMELLE chocopasta — ${aantal} pot${aantal === 1 ? '' : 'ten'}`);
  params2.set('confirm', 'true');
  params2.set('return_url', returnUrl);
  if (orderId)      params2.set('metadata[order_id]', orderId);
  if (tempOrderId)  params2.set('metadata[temp_order_id]', tempOrderId);
  if (isReorder)    params2.set('metadata[reorder_pot_id]', reorderPotId);
  if (voornaam)     params2.set('metadata[voornaam]', voornaam);
  params2.set('metadata[aantal]', String(aantal));
  params2.set('metadata[statiegeld_credit]', String(credit));
  params2.set('metadata[bank]', bank);

  try {
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params2.toString(),
    });
    const data = await r.json();
    if (!r.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'stripe_error', detail: data }) };
    }
    const redirectUrl = data.next_action && data.next_action.redirect_to_url && data.next_action.redirect_to_url.url;
    if (!redirectUrl) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'no_redirect_url', status: data.status }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({
      url: redirectUrl,
      payment_intent_id: data.id,
      temp_order_id: tempOrderId,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
