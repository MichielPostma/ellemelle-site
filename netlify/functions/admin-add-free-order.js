// admin-add-free-order.js — Admin creëert een gratis bestelling voor een bestaande klant.
// Klantgegevens (adres/kanaal) worden hergebruikt uit meest recente order van dezelfde customer_key.
// De submission wordt aangemaakt via Netlify Forms POST zodat 'ie in de standaard "Nieuw" flow verschijnt.
// Pot-toewijzing gebeurt niet — bezorger scant een pot op leveringsdag (bestaande flow).

const { listEnrichedOrders, invalidateOrderCache } = require('./_lib/orders');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid JSON' }) }; }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const klantKey = String(body.klant_key || '').trim();
  const aantal = Math.max(1, Math.min(10, parseInt(body.aantal || 1, 10) || 1));
  const reden = String(body.reden || '').trim();
  const redenNote = String(body.reden_note || '').trim();
  const deliveryDate = String(body.delivery_date || '').trim();

  if (!klantKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'klant_key required' }) };
  if (!reden) return { statusCode: 400, headers, body: JSON.stringify({ error: 'reden required' }) };
  if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'delivery_date must be YYYY-MM-DD' }) };
  }

  // Klantdata ophalen uit meest recente order
  let klant;
  try {
    const { all } = await listEnrichedOrders();
    const klantOrders = all.filter(o => o.customer_key === klantKey);
    if (klantOrders.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'klant not found' }) };
    }
    klantOrders.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    klant = klantOrders[0];
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'klant lookup failed: ' + (e && e.message || e) }) };
  }

  // Bouw form submission
  const params = new URLSearchParams();
  params.append('form-name', 'ellemelle-signup');
  params.append('voornaam', klant.voornaam || '');
  params.append('telefoon', klant.telefoon || '');
  params.append('email', klant.email || '');
  params.append('kanaal', klant.kanaal || 'whatsapp');
  params.append('straat', klant.straat || '');
  params.append('huisnummer', klant.huisnummer || '');
  params.append('toevoeging', klant.toevoeging || '');
  params.append('postcode', klant.postcode || '');
  params.append('plaats', klant.plaats || 'Haarlem');
  params.append('aantal', String(aantal));
  if (deliveryDate) params.append('delivery_date', deliveryDate);
  params.append('delivery_mode', 'bezorging');
  params.append('is_admin_order', 'true');
  params.append('is_free', 'true');
  params.append('reden', reden);
  if (redenNote) params.append('reden_note', redenNote);
  params.append('customer_identifier', klantKey);
  params.append('bot-field', ''); // honeypot leeg

  // POST naar site root — Netlify Forms detecteert en slaat op
  const submitUrl = (process.env.URL || 'https://ellemel.nl').replace(/\/$/, '') + '/';
  let subRes;
  try {
    subRes = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    });
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'submit fetch failed: ' + (e && e.message || e) }) };
  }
  // Netlify Forms returned 200 of 303 op success
  if (subRes.status !== 200 && subRes.status !== 303 && subRes.status !== 302) {
    const txt = await subRes.text().catch(() => '');
    return { statusCode: 502, headers, body: JSON.stringify({
      error: 'forms submit not accepted', status: subRes.status, body: txt.slice(0, 200)
    }) };
  }

  invalidateOrderCache();
  return { statusCode: 200, headers, body: JSON.stringify({
    ok: true,
    klant: { voornaam: klant.voornaam, key: klantKey },
    aantal, reden, delivery_date: deliveryDate || null,
  }) };
};
