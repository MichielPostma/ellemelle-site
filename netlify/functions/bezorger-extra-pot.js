// Create an extra-pot follow-on order for an existing customer.
// POST { password, order_id }
// - Creates new Netlify Forms submission with is_extra=true + parent_order_id.
// - Subtracts customer credit (up to total) and returns the final amount due + tikkie url.
// - Logs to customer history.

const { getStore } = require('@netlify/blobs');
const { customerKey, getCustomer, saveCustomer, appendHistory } = require('./_lib/customer');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function encodeForm(data) {
  return Object.keys(data).map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(data[k] || '')
  ).join('&');
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
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };

  const token = process.env.NETLIFY_API_TOKEN;
  if (!token) return { statusCode: 500, headers, body: JSON.stringify({ error: 'missing NETLIFY_API_TOKEN' }) };

  // Fetch original submission for customer fields
  let orig = null;
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) orig = await r.json();
  } catch {}
  if (!orig) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'original order not found' }) };
  }
  const d = orig.data || {};

  // Compute amount due, subtracting customer credit (max €6)
  const POT_PRICE = 5.0;
  const STATIEGELD = 1.0;
  const grossAmount = POT_PRICE + STATIEGELD; // €6
  const ck = customerKey(d);
  let creditBefore = 0, creditUsed = 0;
  if (ck) {
    const cust = await getCustomer(ck);
    creditBefore = (cust && cust.statiegeld_credit) || 0;
    creditUsed = Math.min(creditBefore, grossAmount);
  }
  const amountDue = Math.max(0, grossAmount - creditUsed);

  // Submit extra-pot entry to Netlify Forms
  const payload = {
    'form-name': 'ellemelle-signup',
    'bot-field': '',
    voornaam:    d.voornaam   || '',
    telefoon:    d.telefoon   || '',
    email:       d.email      || '',
    kanaal:      d.kanaal     || 'whatsapp',
    straat:      d.straat     || '',
    huisnummer:  d.huisnummer || '',
    toevoeging:  d.toevoeging || '',
    postcode:    d.postcode   || '',
    plaats:      d.plaats     || 'Haarlem',
    is_extra:        'true',
    parent_order_id: orderId,
    amount_due:      String(amountDue.toFixed(2)),
    credit_used:     String(creditUsed.toFixed(2)),
  };

  let newOrderId = null;
  try {
    const submitRes = await fetch('https://ellemelle.netlify.app/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeForm(payload),
    });
    if (submitRes.ok) {
      // Look up newest submission to grab its ID
      try {
        const siteId = process.env.NETLIFY_SITE_ID;
        const fl = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const forms = await fl.json();
        const form = forms.find(f => f.name === 'ellemelle-signup');
        if (form) {
          const sl = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=5`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const sList = await sl.json();
          const match = sList.find(s => (s.data || {}).is_extra === 'true' && (s.data || {}).parent_order_id === orderId);
          if (match) newOrderId = match.id;
        }
      } catch {}
    }
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'extra-pot submission failed', detail: String(e && e.message || e) }) };
  }

  // Apply credit + history
  if (ck && creditUsed > 0) {
    const cust = (await getCustomer(ck)) || {
      contact_key: ck, voornaam: d.voornaam || '', kanaal: d.kanaal || '',
      telefoon: d.telefoon || '', email: d.email || '', statiegeld_credit: 0, history: [],
    };
    cust.statiegeld_credit = Math.max(0, (cust.statiegeld_credit || 0) - creditUsed);
    cust.history = cust.history || [];
    cust.history.push({ ts: new Date().toISOString(), action: 'extra-pot-ordered',
      parent_order_id: orderId, new_order_id: newOrderId, amount_due: amountDue, credit_used: creditUsed });
    await saveCustomer(ck, cust);
  } else if (ck) {
    await appendHistory(ck, d, { action: 'extra-pot-ordered',
      parent_order_id: orderId, new_order_id: newOrderId, amount_due: amountDue, credit_used: 0 });
  }

  // Pick a tikkie URL (alternating A/B for simple load split)
  const tikkie = (Math.random() > 0.5)
    ? (process.env.TIKKIE_LINK_A || process.env.TIKKIE_LINK_B || '')
    : (process.env.TIKKIE_LINK_B || process.env.TIKKIE_LINK_A || '');

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      new_order_id: newOrderId,
      amount_due: amountDue,
      credit_used: creditUsed,
      tikkie_url: tikkie,
      customer: { voornaam: d.voornaam || '', kanaal: d.kanaal || '', telefoon: d.telefoon || '', email: d.email || '' },
    }),
  };
};
