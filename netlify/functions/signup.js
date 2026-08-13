// Signup handler.
// Strategy:
//   1. If Supabase env vars are set → INSERT row into `signups` table.
//   2. Otherwise → return 503 so client falls back to direct Netlify Forms POST.
//
// Required env vars for Supabase path:
//   SUPABASE_URL              e.g. https://abcd.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY (service-role key — write access)
//
// Optional:
//   RESEND_API_KEY            — if set, sends a confirmation e-mail
//   RESEND_FROM               — default: 'Ellemel <onboarding@resend.dev>'

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid JSON' }) };
  }

  // Basic sanitation
  const cleaned = {
    voornaam:   String(payload.voornaam   || '').trim().slice(0, 60),
    telefoon:   String(payload.telefoon   || '').trim().slice(0, 24) || null,
    email:      String(payload.email      || '').trim().slice(0, 120) || null,
    kanaal:     ['whatsapp', 'email'].includes(payload.kanaal) ? payload.kanaal : 'email',
    straat:     String(payload.straat     || '').trim().slice(0, 120),
    huisnummer: String(payload.huisnummer || '').trim().slice(0, 8),
    toevoeging: String(payload.toevoeging || '').trim().slice(0, 8) || null,
    postcode:   String(payload.postcode   || '').trim().slice(0, 8),
    plaats:     String(payload.plaats     || '').trim().slice(0, 60) || 'Haarlem',
  };

  if (!cleaned.voornaam || !cleaned.postcode || !cleaned.huisnummer) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing fields' }) };
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // -- Fallback path: no Supabase → tell client to use Netlify Forms ----
  if (!SB_URL || !SB_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'no datastore configured', fallback: 'netlify-forms' }),
    };
  }

  // -- Supabase INSERT --------------------------------------------------
  try {
    const r = await fetch(`${SB_URL.replace(/\/$/, '')}/rest/v1/signups`, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify([cleaned]),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'supabase insert failed', detail: txt }) };
    }
    const inserted = await r.json();
    const row = Array.isArray(inserted) ? inserted[0] : inserted;

    // -- Optional confirmation email via Resend -------------------------
    if (process.env.RESEND_API_KEY && cleaned.email && cleaned.kanaal === 'email') {
      sendConfirmationMail(cleaned).catch(() => { /* non-blocking */ });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: row && row.id }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};

async function sendConfirmationMail(p) {
  const from = process.env.RESEND_FROM || 'Ellemel <onboarding@resend.dev>';
  const subject = `Yes ${p.voornaam}, je staat op de Ellemel lijst 🎉`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
      <h1 style="color:#D9301E;font-family:Impact,sans-serif;letter-spacing:1px;">Ellemel</h1>
      <p>Hoi ${escapeHtml(p.voornaam)},</p>
      <p>Yes! Je staat op de lijst voor één pot ambachtelijke Ellemel chocopasta.</p>
      <p>
        <strong>Bezorgadres</strong><br>
        ${escapeHtml(p.straat)} ${escapeHtml(p.huisnummer)}${p.toevoeging ? '-'+escapeHtml(p.toevoeging) : ''}<br>
        ${escapeHtml(p.postcode)} ${escapeHtml(p.plaats)}
      </p>
      <p><strong>Totaal:</strong> €6,00 (€5 + €1 statiegeld pot)</p>
      <p>Binnen 4 weken aan je deur. Tot snel!</p>
      <p style="color:#8B1A0E;">— Ellis & Melle</p>
    </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [p.email], subject, html }),
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
