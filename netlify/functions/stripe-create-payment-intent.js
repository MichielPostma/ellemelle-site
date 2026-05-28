// Create + immediately confirm a Stripe Payment Intent for an iDeal payment with a pre-selected bank.
// POST { voornaam, aantal, statiegeld_credit?, bank, email?, order_id?, success_pot_id? }
// Returns { url, payment_intent_id } where `url` is the iDeal bank redirect (skips Stripe Checkout entirely).
//
// Pricing (cents):
//   product:  aantal × 500
//   deposit:  aantal × 100
//   discount: min(statiegeld_credit, aantal) × 100   (capped at deposit)
//
// Why server-side confirm? With `confirm=true` and `payment_method_data.ideal.bank`, Stripe creates and
// confirms the intent in one call, returning next_action.redirect_to_url.url — the bank's iDeal page.
// This skips both Stripe Checkout (email/name/Wero) and the client-side Stripe.js library entirely.

const VALID_BANKS = new Set([
  'abn_amro','asn_bank','bunq','handelsbanken','ing','knab','moneyou','n26','nn',
  'rabobank','regiobank','revolut','sns_bank','triodos_bank','van_lanschot','yoursafe'
]);

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
  const successPath = body.success_pot_id ? `/pot/${encodeURIComponent(body.success_pot_id)}`
                    : orderId ? `/bestelling/${encodeURIComponent(orderId)}`
                    : '/';
  const voornaamParam = voornaam && voornaam !== 'klant'
    ? `&voornaam=${encodeURIComponent(voornaam)}`
    : '';
  const returnUrl = `${baseUrl}${successPath}?paid=stripe${voornaamParam}`;

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
    if (orderId)  pParams.set('metadata[order_id]', orderId);
    if (voornaam) pParams.set('metadata[voornaam]', voornaam);
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
      return { statusCode: 200, headers, body: JSON.stringify({ url: redirectUrl, payment_intent_id: pd.id }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
    }
  }
  // Bank pre-selected: use Payment Intents with confirm=true → direct bank redirect (skip Stripe Checkout)
  const params = new URLSearchParams();
  params.set('amount', String(totalCents));
  params.set('currency', 'eur');
  params.set('payment_method_types[0]', 'ideal');
  params.set('payment_method_data[type]', 'ideal');
  params.set('payment_method_data[ideal][bank]', bank);
  params.set('payment_method_data[billing_details][name]', voornaam);
  const email = String(body.email || '').trim();
  if (email && /@/.test(email)) {
    params.set('payment_method_data[billing_details][email]', email);
    params.set('receipt_email', email);
  }
  params.set('description', `ELLEMELLE chocopasta — ${aantal} pot${aantal === 1 ? '' : 'ten'}`);
  params.set('confirm', 'true');
  params.set('return_url', returnUrl);
  if (orderId)  params.set('metadata[order_id]', orderId);
  if (voornaam) params.set('metadata[voornaam]', voornaam);
  params.set('metadata[aantal]', String(aantal));
  params.set('metadata[statiegeld_credit]', String(credit));
  params.set('metadata[bank]', bank);

  try {
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
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
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
