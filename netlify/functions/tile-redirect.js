// Tegel-redirect endpoint.
// URL formaat: /t/<ID>   bv. /t/T01 … /t/T20
//
// Fysieke tegels hangen in de openbare ruimte, dus scans komen van 2 groepen:
//   1) Kids die middenin de speurtocht zitten en met hun default phone-camera scannen
//      i.p.v. via de in-app scanner van /game/POT-XXX. Voor hen: de scan werkt hier niet;
//      de homepage toont een banner dat ze vanuit de pot-pagina moeten scannen.
//   2) Voorbijgangers die de sticker zien en 'm proberen te scannen. Voor hen: gewoon
//      de homepage tonen zodat ze chocopasta kunnen bestellen.
//
// Beide groepen worden dus naar de homepage geredirect met ?from_tile=<ID>, waar
// index.html een uitlegbanner rendert als die param aanwezig is.
//
// (Optioneel: per tegel kan in Netlify Blobs store 'ellemelle-tiles' nog een custom
// destination staan; die wint als 'ie gezet is.)

const { getStore } = require('@netlify/blobs');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

exports.handler = async (event) => {
  // Pak de tegel-ID uit het pad (case-insensitive). Sta zowel /t/T01 als /t/T01/ toe.
  const path = event.path || '';
  const m = path.match(/^\/t\/([A-Za-z0-9-]+)\/?$/);
  if (!m) {
    return { statusCode: 404, body: 'Not found' };
  }
  const id = m[1].toUpperCase();

  // Optioneel: custom destination via Netlify Blobs (wint als aanwezig)
  let config = null;
  try {
    const store = getStore(blobOpts('ellemelle-tiles'));
    config = await store.get(id, { type: 'json' });
  } catch {}

  if (config && typeof config.destination === 'string' && /^https?:\/\//.test(config.destination)) {
    return {
      statusCode: 302,
      headers: { Location: config.destination, 'Cache-Control': 'no-store' },
      body: '',
    };
  }

  // Standaard: naar de homepage met from_tile-param. index.html rendert daar
  // een uitleg-banner voor kids die middenin de speurtocht zitten.
  return {
    statusCode: 302,
    headers: {
      Location: '/?from_tile=' + encodeURIComponent(id),
      'Cache-Control': 'no-store',
    },
    body: '',
  };
};
