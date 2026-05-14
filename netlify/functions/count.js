// Counter endpoint — returns { count, max } for the homepage pill.
// Sources, in order of preference:
//   1. Supabase: SELECT count(*) FROM signups
//   2. Netlify Forms API (needs NETLIFY_API_TOKEN + SITE_ID)
//   3. Fallback: 0

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  const max = parseInt(process.env.MAX_SIGNUPS || '10', 10);

  // --- 1. Supabase ---
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/signups?select=id`;
      const r = await fetch(url, {
        method: 'HEAD',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'count=exact',
          'Range-Unit': 'items',
          'Range': '0-0',
        },
      });
      // Content-Range header looks like: "0-0/<total>"
      const cr = r.headers.get('content-range') || '';
      const m = /\/(\d+)$/.exec(cr);
      if (m) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ count: parseInt(m[1], 10), max, source: 'supabase' }),
        };
      }
    } catch (e) { /* fall through */ }
  }

  // --- 2. Netlify Forms API ---
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  if (token && siteId) {
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const forms = await r.json();
        const form = forms.find(f => f.name === 'ellemelle-signup');
        if (form) {
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ count: form.submission_count || 0, max, source: 'netlify-forms' }),
          };
        }
      }
    } catch (e) { /* fall through */ }
  }

  // --- 3. Fallback ---
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ count: 0, max, source: 'fallback' }),
  };
};
