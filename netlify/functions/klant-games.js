// Geef alle games terug die ooit gekoppeld zijn (geweest) aan een pot van deze klant.
// POST { password, customer_key }
//
// Resolutie: customer history bevat 'pot-delivered' entries met pot_id. Voor elke pot pak
// we de huidige game_id + game_state. Als de pot momenteel NIET de eerder gespeelde game
// heeft (bv. opnieuw uitgegeven), tonen we 'm alsnog met label "Niet meer actief op pot".

const { getStore } = require('@netlify/blobs');
const { getCustomer } = require('./_lib/customer');
const { getGame } = require('./_lib/games');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const key = String(body.customer_key || '').trim();
  if (!key) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing customer_key' }) };
  }
  const customer = await getCustomer(key);
  if (!customer) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, games: [] }) };
  }

  // Verzamel ALLE pot_ids uit history (pot-delivered events) en game_started events.
  const potIds = new Set();
  const hist = Array.isArray(customer.history) ? customer.history : [];
  hist.forEach(h => {
    if (h && h.pot_id) potIds.add(String(h.pot_id).toUpperCase());
  });

  // Voor elke pot, pak game_id + state. Skip pots die nooit een game hadden.
  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const seen = new Set(); // gelijke pot-game combinaties niet dubbel tonen
  const games = [];
  for (const pid of potIds) {
    const pot = await potsStore.get(pid, { type: 'json' }).catch(() => null);
    if (!pot) continue;
    // Mogelijk had de pot OOIT een game (zichtbaar in customer-history game_started entries).
    // We tonen: huidige game_id van de pot (wat de admin nu kan testen) ÉN game_id's uit history.
    const historyGameIds = new Set();
    hist.forEach(h => {
      if (h && h.action && /^game_/.test(h.action) && h.pot_id === pid && h.game_id) {
        historyGameIds.add(h.game_id);
      }
    });
    if (pot.game_id) historyGameIds.add(pot.game_id);

    for (const gid of historyGameIds) {
      const k = pid + '::' + gid;
      if (seen.has(k)) continue;
      seen.add(k);
      const game = getGame(gid);
      if (!game) continue;
      const isActive = pot.game_id === gid;
      const state = isActive ? (pot.game_state || null) : null;
      // Customer-side status uit history: highest 'game_X' actie voor deze pot+game
      let customerStatus = 'gekoppeld';
      const events = hist.filter(h => h && h.pot_id === pid && h.game_id === gid);
      if (events.some(h => h.action === 'game_won'))               customerStatus = 'gewonnen';
      else if (events.some(h => h.action === 'game_mission_completed')) customerStatus = 'bezig';
      else if (events.some(h => h.action === 'game_started'))      customerStatus = 'gestart';
      else if (!isActive)                                          customerStatus = 'historisch';
      games.push({
        pot_id: pid,
        game_id: gid,
        game_name: game.name,
        prize_label: game.prize_label,
        is_active_on_pot: isActive,
        customer_status: customerStatus,
        state: state,
      });
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, games }) };
};
