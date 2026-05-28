// Create a Stripe Checkout session for an ELLEMELLE order.
// POST { order_id?, voornaam, aantal, statiegeld_credit?, success_pot_id? }
// Returns { url } — frontend redirects there.
//
// Uses raw HTTPS calls to Stripe's REST API (no @stripe/stripe-node) so the
// function stays small and we don't have to bundle the SDK.
//
// Pricing (cents):
//   product:  aantal × 500
//   deposit:  aantal × 100
//   discount: min(statiegeld_credit, aantal) × 100   (rolled-over deposit from earlier pots)
//   total:    product + deposit - discount

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
  const credit = Math.max(0, Number(body.statiegeld_credit) || 0);
  const productCents = aantal * 500;     // €5 / pot
  const depositCents = aantal * 100;     // €1 statiegeld / pot
  const discountCents = Math.min(credit, aantal) * 100;
  const totalCents = productCents + depositCents - discountCents;
  if (totalCents <= 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'total amount must be > 0' }) };
  }

  const voornaam = String(body.voornaam || '').trim() || 'klant';
  const orderId  = body.order_id ? String(body.order_id) : '';
  const baseUrl  = process.env.URL || 'https://ellemelle.netlify.app';
  // Cancel back to root; success goes to /pot/{id} if known, otherwise the order detail.
  const successPath = body.success_pot_id ? `/pot/${encodeURIComponent(body.success_pot_id)}`
                    : orderId ? `/bestelling/${encodeURIComponent(orderId)}`
                    : '/';
  // Include voornaam in success_url so the thank-you page can greet the user even if localStorage is unavailable (different device).
  const voornaamParam = voornaam && voornaam !== 'klant'
    ? `&voornaam=${encodeURIComponent(voornaam)}`
    : '';
  const successUrl = `${baseUrl}${successPath}?paid=stripe&session_id={CHECKOUT_SESSION_ID}${voornaamParam}`;
  const cancelUrl  = `${baseUrl}/?canceled=stripe`;

  // Form-encoded payload for Stripe REST API
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  // iDeal only — sends the customer straight to the bank picker without a method-choice step.
  params.set('payment_method_types[0]', 'ideal');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  // Single combined line item — clear total for the customer
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(totalCents));
  params.set('line_items[0][price_data][product_data][name]',
    `ELLEMELLE chocopasta — ${aantal} pot${aantal === 1 ? '' : 'ten'}`);
  params.set('line_items[0][price_data][product_data][description]',
    discountCents > 0
      ? `${aantal}× pot (€${(productCents/100).toFixed(2)}) + statiegeld (€${(depositCents/100).toFixed(2)}) − credit (−€${(discountCents/100).toFixed(2)})`
      : `${aantal}× pot (€${(productCents/100).toFixed(2)}) + statiegeld (€${(depositCents/100).toFixed(2)})`);
  // Metadata so we can reconcile in the dashboard / webhook later
  // Minimise friction: don't force a Stripe Customer object, pre-fill email if we have it.
  // 'never' is NOT a valid value (Stripe accepts only 'if_required' | 'always'); 'if_required' = default.
  params.set('customer_creation', 'if_required');
  const email = String(body.email || '').trim();
  if (email && /@/.test(email)) params.set('customer_email', email);
  if (orderId)  params.set('metadata[order_id]', orderId);
  if (voornaam) params.set('metadata[voornaam]', voornaam);
  params.set('metadata[aantal]', String(aantal));
  params.set('metadata[statiegeld_credit]', String(credit));

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'stripe error', detail: data }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ url: data.url, id: data.id }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
