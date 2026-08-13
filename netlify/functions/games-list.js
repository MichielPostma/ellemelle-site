// Lijst alle beschikbare games — voor admin dropdown.
// POST { password }
// Returns { ok, games: [{ id, name, prize_label, mission_count }] }

const { listGames } = require('./_lib/games');

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
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, games: listGames() }) };
};
