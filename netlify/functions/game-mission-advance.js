// Scan validation — verifieer dat de gescande qr_token bij de HUIDIGE stop hoort.
// POST { pot_id, qr_token }
//
// Bij match: state.scanned = true (audio + raadsel-invoer worden zichtbaar in de UI).
// Bij mismatch: error 'wrong_tile' (verkeerde tegel) of 'unrecognized_qr'.
// Bij correct match maar al gescand: ok=true, already=true.

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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const potId = String(body.pot_id || '').toUpperCase().trim();
  const qrToken = String(body.qr_token || '').trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }
  if (!qrToken) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing qr_token' }) };
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
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, already_done: true, state }) };
  }
  const currentStop = stopForIdx(game, state.current_mission_idx);
  if (!currentStop) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'invalid state' }) };
  }

  // Welke stop hoort bij dit scangetoken?
  // Master-unlock "0000" → forceer scan voor de huidige stop (voor ouders / help-flow).
  //
  // Token-normalisatie: fysieke tegels bevatten de URL "https://ellemel.nl/t/T01"
  // terwijl de game-definitie tokens van vorm "ELLEMEL-T01" gebruikt. We pakken bij
  // beide alleen het tile-id (T01, T02, …) zodat scans vanuit de in-app scanner én
  // eventuele varianten (raw "T01", "ELLEMEL-T01", of de volledige URL) matchen.
  function tileId(s) {
    if (!s) return '';
    const t = String(s).trim();
    const urlMatch = t.match(/\/t\/([A-Za-z0-9-]+)\/?$/);
    if (urlMatch) return urlMatch[1].toUpperCase();
    return t.toUpperCase().replace(/^ELLEMEL-/, '');
  }
  const allStops = [game.intro, ...game.missions];
  let matchedStop;
  let matchedIdx;
  if (qrToken === '0000') {
    matchedStop = currentStop;
    matchedIdx = state.current_mission_idx;
  } else {
    const wantedId = tileId(qrToken);
    matchedStop = allStops.find(s => tileId(s.qr_token) === wantedId);
    if (!matchedStop) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'unrecognized_qr', detail: 'Deze QR-code hoort niet bij deze speurtocht.' }) };
    }
    matchedIdx = matchedStop === game.intro ? 1 : matchedStop.idx;
  }
  if (matchedIdx !== state.current_mission_idx) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({
        error: 'wrong_tile',
        detail: matchedIdx < state.current_mission_idx
          ? 'Deze tegel heb je al eerder gescand!'
          : 'Je bent nog niet bij deze stop — fiets eerst naar de tegel die nu aan de beurt is.',
        scanned_idx: matchedIdx,
        expected_idx: state.current_mission_idx,
      }),
    };
  }

  const alreadyScanned = state.scanned === true;
  const nextState = { ...state, scanned: true };
  pot.game_state = nextState;
  await potsStore.setJSON(potId, pot);

  // Log scan op klant (alleen bij eerste keer)
  if (!alreadyScanned && pot.order_id) {
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
            action: 'game_tile_scanned',
            game_id: game.id,
            mission_idx: matchedIdx,
            mission_title: matchedStop.title,
            pot_id: potId,
          });
        }
      }
    } catch {}
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true,
      already: alreadyScanned,
      state: nextState,
      stop: { idx: matchedIdx, title: matchedStop.title, audio_text: matchedStop.audio_text },
    }),
  };
};
