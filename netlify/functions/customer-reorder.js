// Public: customer requests a new pot to be delivered, old pot to be picked up.
// POST { pot_id }
// 1) Submits a new entry to Netlify Forms (`ellemelle-signup`) with voornaam+address from the
//    original order + is_reorder=true + original_pot_id.
// 2) Updates the pot.status = pickup-with-reorder.
// 3) Notifies Michiel via Resend (if key set).

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function getOriginalSubmission(orderId) {
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token || !orderId) return null;
  const r = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
}

function encodeForm(data) {
  return Object.keys(data).map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(data[k] || '')
  ).join('&');
}

async function notifyMichiel({ pot_id, voornaam, new_order_id }) {
  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) return { mailed: false, reason: 'no RESEND_API_KEY' };
  const from = process.env.RESEND_FROM || 'ELLEMELLE <onboarding@resend.dev>';
  const subject = `Reorder! ${voornaam || ''} wil nieuwe pot, oude pot ${pot_id} ophalen`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
      <h2 style="color:#D9301E;">Nieuwe bestelling via reorder</h2>
      <p><strong>${esc(voornaam || '?')}</strong> wil een <strong>nieuwe pot</strong> en de oude pot <strong>${esc(pot_id)}</strong> ophalen.</p>
      <p style="font-size:14px;color:#555;">Nieuwe Netlify Forms entry: ${esc(new_order_id || '(zie dashboard)')}</p>
      <p style="font-size:12px;color:#888;margin-top:24px;">Tijdstip: ${new Date().toISOString()}</p>
    </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: ['hi@michielpostma.nl'], subject, html }),
    });
    return { mailed: true };
  } catch (e) {
    return { mailed: false, reason: String(e && e.message || e) };
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const potId = String(body.pot_id || '').toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }

  const potsStore   = getStore(blobOpts('ellemelle-pots'));
  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found' }) };
  if (!pot.order_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'pot not delivered to a customer' }) };
  }
  if (pot.status === 'pickup-with-reorder') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: pot.status, idempotent: true }) };
  }
  if (pot.status !== 'delivered' && pot.status !== 'pickup-requested') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot not in deliverable state', current: pot.status }) };
  }

  // Fetch original submission to copy customer fields into new Netlify Forms entry
  const orig = await getOriginalSubmission(pot.order_id);
  const d = (orig && orig.data) || {};
  const payload = {
    'form-name':  'ellemelle-signup',
    'bot-field':  '',
    voornaam:     d.voornaam   || '',
    telefoon:     d.telefoon   || '',
    email:        d.email      || '',
    kanaal:       d.kanaal     || 'whatsapp',
    straat:       d.straat     || '',
    huisnummer:   d.huisnummer || '',
    toevoeging:   d.toevoeging || '',
    postcode:     d.postcode   || '',
    plaats:       d.plaats     || 'Haarlem',
    is_reorder:        'true',
    original_pot_id:   potId,
    original_order_id: pot.order_id,
  };

  // Submit to the site root — Netlify Forms detects and stores it.
  let new_order_id = null;
  try {
    const submitRes = await fetch('https://ellemelle.netlify.app/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeForm(payload),
    });
    // Netlify Forms server-side submission doesn't return the new id directly,
    // so we fetch the most recent submission to find it.
    if (submitRes.ok) {
      try {
        const token = process.env.NETLIFY_API_TOKEN;
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
          // Match by reorder + voornaam + most recent
          const match = sList.find(s => (s.data || {}).is_reorder === 'true' && (s.data || {}).original_pot_id === potId);
          if (match) new_order_id = match.id;
        }
      } catch {}
    }
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'reorder submission failed', detail: String(e && e.message || e) }) };
  }

  const now = new Date().toISOString();
  await potsStore.setJSON(potId, { ...pot, status: 'pickup-with-reorder', reorder_at: now, reorder_order_id: new_order_id });
  const existingOrder = (await ordersStore.get(pot.order_id, { type: 'json' })) || {};
  await ordersStore.setJSON(pot.order_id, {
    ...existingOrder,
    pickup_requested_at: existingOrder.pickup_requested_at || now,
    reorder_at: now,
    reorder_order_id: new_order_id,
  });

  const mail = await notifyMichiel({ pot_id: potId, voornaam: d.voornaam || '', new_order_id });
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'pickup-with-reorder', new_order_id, mail }) };
};
