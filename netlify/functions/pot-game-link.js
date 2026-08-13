// Koppel of ontkoppel een game aan één of meer potten.
// POST { password, pot_ids: string[], game_id: string|null }
//
// game_id = null → ontkoppel game (clear pot.game_id + pot.game_state)
// game_id = 'quest-1-...' → koppel game (init game_state = null totdat klant scant)

const { getStore } = require('@netlify/blobs');
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

  const potIds = Array.isArray(body.pot_ids)
    ? body.pot_ids.map(s => String(s || '').toUpperCase().trim()).filter(s => /^POT-\d{3}$/.test(s))
    : [];
  if (potIds.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing pot_ids' }) };
  }
  const gameId = body.game_id ? String(body.game_id).trim() : null;
  if (gameId && !getGame(gameId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'unknown game_id', game_id: gameId }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const now = new Date().toISOString();
  const updated = [];

  for (const pid of potIds) {
    const pot = (await potsStore.get(pid, { type: 'json' })) || { id: pid };
    const next = { ...pot };
    if (gameId) {
      // Alleen overschrijven als de pot nog niet gewonnen heeft of een andere game heeft
      next.game_id = gameId;
      // game_state niet wissen als al gewonnen — anders alles op nul
      if (!next.game_state || next.game_state.game_id !== gameId) {
        next.game_state = null; // wordt geïnitialiseerd zodra klant /game/{id} opent
      }
    } else {
      next.game_id = null;
      next.game_state = null;
    }
    next.game_linked_at = now;
    await potsStore.setJSON(pid, next);
    updated.push(pid);
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, updated, game_id: gameId }),
  };
};
