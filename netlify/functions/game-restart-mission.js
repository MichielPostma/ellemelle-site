// Herstart één missie zonder de andere te resetten.
// POST { pot_id, mission_idx }
//
// Verwijdert mission_idx uit completed[], zet current_mission_idx = mission_idx,
// scanned = false, won = false. Andere completed missies blijven intact.

const { getStore } = require('@netlify/blobs');
const { getGame } = require('./_lib/games');
const { customerKey, appendHistory } = require('./_lib/customer');

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
  const potId = String(body.pot_id || '').toUpperCase().trim();
  const missionIdx = Number(body.mission_idx);
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }
  if (!Number.isInteger(missionIdx) || missionIdx < 1) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid mission_idx' }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot || !pot.game_id) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot or game not found' }) };
  }
  const game = getGame(pot.game_id);
  if (!game) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'game definition missing' }) };
  }

  const totalMissions = game.missions.length + 1;
  if (missionIdx > totalMissions) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'mission_idx out of range' }) };
  }

  const state = pot.game_state || { current_mission_idx: 1, scanned: false, won: false, completed: [] };
  const completed = (Array.isArray(state.completed) ? state.completed : []).filter(i => i !== missionIdx);

  const nextState = {
    ...state,
    completed,
    current_mission_idx: missionIdx,
    scanned: false,
    won: false,
    won_at: null,
  };
  pot.game_state = nextState;
  await potsStore.setJSON(potId, pot);

  // Log herstart op klant
  if (pot.order_id) {
    try {
      const token = process.env.NETLIFY_API_TOKEN;
      const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${pot.order_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sub.ok) {
        const j = await sub.json();
        const d = j.data || {};
        const ck = customerKey(d);
        if (ck) {
          await appendHistory(ck, d, {
            action: 'game_mission_restarted',
            game_id: game.id,
            mission_idx: missionIdx,
            pot_id: potId,
          });
        }
      }
    } catch {}
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, state: nextState }),
  };
};
