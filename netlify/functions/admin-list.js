// Admin endpoint — list all signups. Requires ADMIN_PASSWORD.
// POST { password } → { signups: [...], total, paid, outstanding }
// Source: Supabase if configured, else Netlify Forms API.

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad JSON' }) }; }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_PASSWORD not set' }) };
  }
  if (!body.password || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  // --- Supabase path ---
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/signups?select=*&order=created_at.desc`;
      const r = await fetch(url, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (!r.ok) throw new Error('supabase ' + r.status);
      const rows = await r.json();
      const paid = rows.filter(r => r.betaald).length;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          signups: rows.map(normalizeRow),
          total: rows.length,
          paid,
          outstanding: rows.length - paid,
          source: 'supabase',
        }),
      };
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
    }
  }

  // --- Netlify Forms path ---
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  if (token && siteId) {
    try {
      const fres = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const forms = await fres.json();
      const form = forms.find(f => f.name === 'ellemelle-signup');
      if (!form) {
        return { statusCode: 200, headers, body: JSON.stringify({ signups: [], total: 0, paid: 0, outstanding: 0 }) };
      }
      const sres = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const subs = await sres.json();
      const rows = subs.map(s => ({
        id: s.id,
        voornaam: s.data && s.data.voornaam || '',
        telefoon: s.data && s.data.telefoon || null,
        email: s.data && s.data.email || null,
        kanaal: s.data && s.data.kanaal || 'email',
        straat: s.data && s.data.straat || '',
        huisnummer: s.data && s.data.huisnummer || '',
        toevoeging: s.data && s.data.toevoeging || null,
        postcode: s.data && s.data.postcode || '',
        plaats: s.data && s.data.plaats || '',
        created_at: s.created_at,
        betaald: false, // Netlify Forms has no built-in flag; track manually elsewhere
      }));
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          signups: rows,
          total: rows.length,
          paid: 0,
          outstanding: rows.length,
          source: 'netlify-forms',
          note: 'Betaal-status tracking vereist Supabase. Met Netlify Forms is "betaald" altijd false.',
        }),
      };
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
    }
  }

  return {
    statusCode: 503, headers,
    body: JSON.stringify({ error: 'no datastore configured', hint: 'set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY OR NETLIFY_API_TOKEN + SITE_ID' }),
  };
};

function normalizeRow(r) {
  return {
    id: r.id,
    voornaam: r.voornaam || '',
    telefoon: r.telefoon,
    email: r.email,
    kanaal: r.kanaal,
    straat: r.straat,
    huisnummer: r.huisnummer,
    toevoeging: r.toevoeging,
    postcode: r.postcode,
    plaats: r.plaats,
    created_at: r.created_at,
    betaald: !!r.betaald,
  };
}
