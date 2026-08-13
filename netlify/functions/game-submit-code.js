// Verifieer het raadsel-antwoord voor de HUIDIGE stop.
// POST { pot_id, code }
//
// Bij correct antwoord:
//   - laatste stop:   pot.game_state.won = true, log game_won.
//   - anders:         advance current_mission_idx + 1, scanned reset, log game_mission_completed.
// Bij incorrect: 400 + helper-tekst.
//
// Het antwoord moet eerst "scanned" zijn — anders 400 too_early.

const { getStore } = require('@netlify/blobs');
const { getGame, stopForIdx } = require('./_lib/games');
const { customerKey, appendHistory } = require('./_lib/customer');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const potId = String(body.pot_id || '').toUpperCase().trim();
  const answer = normalize(body.code);
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }
  if (!answer) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing answer' }) };
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

  const state = pot.game_state || { current_mission_idx: 1, scanned: false, won: false };
  if (state.won) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, already_won: true, prize_label: game.prize_label }) };
  }
  if (!state.scanned) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'too_early', detail: 'Scan eerst de tegel om je raadsel te krijgen.' }) };
  }

  const currentStop = stopForIdx(game, state.current_mission_idx);
  if (!currentStop) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'invalid state' }) };
  }
  const expected = normalize(currentStop.riddle_answer);
  if (expected !== answer) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'wrong_answer', detail: 'Hmm, dat antwoord klopt niet. Luister het raadsel nog eens en probeer opnieuw.' }) };
  }

  const totalMissions = game.missions.length + 1;
  const now = new Date().toISOString();

  // Voeg huidige stop toe aan completed (als die er nog niet in zit)
  const completed = Array.isArray(state.completed) ? [...state.completed] : [];
  if (!completed.includes(state.current_mission_idx)) {
    completed.push(state.current_mission_idx);
  }
  // Volgende current = laagste niet-completed in 1..totalMissions, anders null (won)
  let nextCurrent = null;
  for (let i = 1; i <= totalMissions; i++) {
    if (!completed.includes(i)) { nextCurrent = i; break; }
  }
  const isWin = nextCurrent === null;
  const nextState = isWin
    ? { ...state, completed, current_mission_idx: totalMissions, scanned: true, won: true, won_at: now }
    : { ...state, completed, current_mission_idx: nextCurrent, scanned: false };
  pot.game_state = nextState;
  await potsStore.setJSON(potId, pot);
  const isLast = isWin;

  // Logging op klant
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
          if (isLast) {
            await appendHistory(ck, d, {
              action: 'game_won',
              game_id: game.id,
              game_name: game.name,
              prize_label: game.prize_label,
              pot_id: potId,
            });
          } else {
            await appendHistory(ck, d, {
              action: 'game_mission_completed',
              game_id: game.id,
              mission_idx: state.current_mission_idx,
              mission_title: currentStop.title,
              pot_id: potId,
            });
          }
        }
      }
    } catch {}
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      advanced: !isLast,
      won: isLast,
      state: nextState,
      prize_label: isLast ? game.prize_label : undefined,
    }),
  };
};
