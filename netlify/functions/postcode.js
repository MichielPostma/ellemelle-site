// Postcode lookup proxy — uses PDOK Locatieserver (free, no key required).
// Endpoint: GET /api/postcode?postcode=2011AA&number=1
// Returns:  { street, city, postcode, number }

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const qs = event.queryStringParameters || {};
    const postcode = String(qs.postcode || '').replace(/\s+/g, '').toUpperCase();
    const number = String(qs.number || '').replace(/\D/g, '');

    if (!/^\d{4}[A-Z]{2}$/.test(postcode) || !number) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'invalid postcode or number' }),
      };
    }

    // PDOK Locatieserver Free search (incl. centroide_ll for lat/lng)
    const q = encodeURIComponent(`postcode:${postcode} AND huisnummer:${number}`);
    const url =
      `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free` +
      `?q=${q}&fl=woonplaatsnaam,straatnaam,huisnummer,postcode,centroide_ll&rows=1&fq=type:adres`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ellemel-site/1.0 (ellis-melle@example.nl)' },
    });
    if (!res.ok) throw new Error('PDOK ' + res.status);
    const json = await res.json();
    const doc = (json.response && json.response.docs && json.response.docs[0]) || null;
    if (!doc) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };
    }
    // Parse centroide_ll "POINT(lng lat)"
    let lat = null, lng = null;
    const m = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(String(doc.centroide_ll || ''));
    if (m) { lng = parseFloat(m[1]); lat = parseFloat(m[2]); }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        street: doc.straatnaam || '',
        city: doc.woonplaatsnaam || '',
        postcode: doc.postcode || postcode,
        number: doc.huisnummer || number,
        lat, lng,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'lookup failed', detail: String(e && e.message || e) }),
    };
  }
};
