// Notify handler.
// POST { voornaam, email, kanaal, telefoon, straat, huisnummer, toevoeging, postcode, plaats }
//
// Behaviour:
//   - If RESEND_API_KEY is set AND payload.kanaal === 'email' AND payload.email looks valid
//     → sends a confirmation email to the user via Resend.
//   - Always returns 200 (notification is non-critical). Submission storage happens
//     separately via Netlify Forms (client posts to `/`). Michiel's admin notification
//     is delivered by Netlify Forms' built-in `submission_created → email` hook.

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad JSON' }) }; }

  const result = { mailed: false, reason: null };

  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) { result.reason = 'no RESEND_API_KEY'; return ok(result); }
  if (p.kanaal !== 'email') { result.reason = 'kanaal != email'; return ok(result); }
  const email = String(p.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { result.reason = 'invalid email'; return ok(result); }

  const from = process.env.RESEND_FROM || 'Ellemel <onboarding@resend.dev>';
  const voornaam = String(p.voornaam || 'jij').trim().slice(0, 60);
  const adres = [p.straat, [p.huisnummer, p.toevoeging].filter(Boolean).join('-')].filter(Boolean).join(' ');
  const stad = [p.postcode, p.plaats].filter(Boolean).join(' ');
  // Dynamisch prijzen: aantal × €5 pot + aantal × €3 statiegeld.
  const aantal = Math.max(1, parseInt(p.aantal, 10) || 1);
  const productEuros = aantal * 5;
  const depositEuros = aantal * 3;
  const totalEuros   = productEuros + depositEuros;
  const eur = (n) => `€${n.toFixed(2).replace('.', ',')}`;
  const subject = `Leuk ${voornaam}! Je bestelling is genoteerd`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;background:#fdf4ea;padding:32px 24px;border-radius:12px;">
      <h1 style="color:#D9301E;font-size:24px;margin:0 0 16px;">Leuk ${esc(voornaam)}!</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
        Bedankt voor je bestelling. Doe je betaling via de Tikkie-link op de bevestigingspagina,
        dan bezorgen we binnen 4 weken bij je thuis.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px;">
        <tr><td style="padding:6px 0;color:#666;">${aantal}× Ellemel pot 250g</td><td style="text-align:right;padding:6px 0;">${eur(productEuros)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Statiegeld glazen ${aantal === 1 ? 'pot' : 'potten'}</td><td style="text-align:right;padding:6px 0;">${eur(depositEuros)}</td></tr>
        <tr><td style="padding:10px 0 6px;border-top:1px dashed #ECE3D2;font-weight:700;">Totaal</td>
            <td style="text-align:right;padding:10px 0 6px;border-top:1px dashed #ECE3D2;font-weight:700;color:#8B1A0E;">${eur(totalEuros)}</td></tr>
      </table>
      <p style="font-size:14px;line-height:1.5;margin:16px 0 4px;">
        <strong>Bezorgadres</strong><br>
        ${esc(adres)}<br>
        ${esc(stad)}
      </p>
      <p style="font-size:13px;color:#666;margin:24px 0 0;">— Ellis & Melle</p>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (!r.ok) { result.reason = 'resend ' + r.status; return ok(result); }
    result.mailed = true;
  } catch (e) {
    result.reason = 'fetch err: ' + (e && e.message || e);
  }
  return ok(result);
};

function ok(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
