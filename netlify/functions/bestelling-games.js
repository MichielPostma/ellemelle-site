// Geef alle games terug die gekoppeld zijn aan een pot binnen deze bestelling.
// POST { password, order_id }

const { getStore } = require('@netlify/blobs');
const { getGame } = require('./_lib/games');
const { customerKey, getCustomer } = require('./_lib/customer');

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

  const orderId = String(body.order_id || '').trim();
  if (!orderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };
  }

  const ordersStore = getStore(blobOpts('ellemelle-orders'));
  const potsStore = getStore(blobOpts('ellemelle-orders').name === 'ellemelle-orders' ? blobOpts('ellemelle-pots') : null);

  const order = (await ordersStore.get(orderId, { type: 'json' })) || {};
  const potIds = new Set();
  if (order.delivered_pot) potIds.add(order.delivered_pot);
  (Array.isArray(order.assigned_pots) ? order.assigned_pots : []).forEach(p => potIds.add(p));

  // Probeer ook klant op te halen voor customer-status
  let customer = null;
  try {
    const token = process.env.NETLIFY_API_TOKEN;
    const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sub.ok) {
      const j = await sub.json();
      const d = j.data || {};
      const ck = customerKey(d);
      if (ck) customer = await getCustomer(ck);
    }
  } catch {}
  const custHist = (customer && Array.isArray(customer.history)) ? customer.history : [];

  const realPotsStore = getStore(blobOpts('ellemelle-pots'));
  const games = [];
  for (const pid of potIds) {
    const pot = await realPotsStore.get(pid, { type: 'json' }).catch(() => null);
    if (!pot || !pot.game_id) continue;
    const game = getGame(pot.game_id);
    if (!game) continue;
    const events = custHist.filter(h => h && h.pot_id === pid && h.game_id === pot.game_id);
    // Pot.game_state is bron van waarheid — bestaat 'ie niet, dan is de game nog niet
    // écht gestart (ook al staat er een oude 'game_started' entry in de klant-history
    // van vóór de commit-flag fix).
    let customerStatus = 'gekoppeld';
    if (pot.game_state) {
      if      (events.some(h => h.action === 'game_won'))                    customerStatus = 'gewonnen';
      else if (events.some(h => h.action === 'game_mission_completed')) customerStatus = 'bezig';
      else if (events.some(h => h.action === 'game_started'))           customerStatus = 'gestart';
    }
    games.push({
      pot_id: pid,
      game_id: pot.game_id,
      game_name: game.name,
      prize_label: game.prize_label,
      customer_status: customerStatus,
      state: pot.game_state || null,
    });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, games }) };
};
