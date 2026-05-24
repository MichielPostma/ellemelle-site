// Public: customer marks their delivered pot as "please pick it up".
// POST { pot_id }
// Idempotent — if already pickup-requested, returns ok without error.

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

async function notifyMichiel(payload) {
  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) return { mailed: false, reason: 'no RESEND_API_KEY' };
  const from = process.env.RESEND_FROM || 'ELLEMELLE <onboarding@resend.dev>';
  const subject = `Ophaalverzoek — ${payload.pot_id} (${payload.voornaam || 'onbekend'})`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
      <h2 style="color:#D9301E;">Ophaalverzoek</h2>
      <p><strong>${esc(payload.voornaam || '?')}</strong> wil de lege pot <strong>${esc(payload.pot_id)}</strong> ophalen.</p>
      <p style="font-size:14px;color:#555;">Geen nieuwe pot besteld.</p>
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'pot is not delivered to a customer' }) };
  }
  // Idempotent
  if (pot.status === 'pickup-requested' || pot.status === 'pickup-with-reorder') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: pot.status, idempotent: true }) };
  }
  if (pot.status !== 'delivered') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'pot is not in delivered state', current: pot.status }) };
  }

  const now = new Date().toISOString();
  const existingHistory = Array.isArray(pot.history) ? pot.history : [];
  const histEntry = { at: now, action: 'pickup_requested', order_id: pot.order_id };
  await potsStore.setJSON(potId, {
    ...pot,
    status: 'pickup-requested',
    return_requested_at: now,
    history: existingHistory.concat([histEntry]),
  });
  const existingOrder = (await ordersStore.get(pot.order_id, { type: 'json' })) || {};
  // Promote the order's status so admin sees the pickup request show up in the UI.
  await ordersStore.setJSON(pot.order_id, {
    ...existingOrder,
    pickup_requested_at: now,
    order_status: 'pickup_self_requested',
  });

  // Fetch the customer's name for the notification
  let voornaam = '';
  try {
    const token = process.env.NETLIFY_API_TOKEN;
    const r = await fetch(`https://api.netlify.com/api/v1/submissions/${pot.order_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) { const sub = await r.json(); voornaam = (sub.data || {}).voornaam || ''; }
  } catch {}

  const mail = await notifyMichiel({ pot_id: potId, voornaam });
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'pickup-requested', mail }) };
};
