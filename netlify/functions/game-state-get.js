// Publieke endpoint — geef game-data + huidige voortgang terug voor een pot.
// GET /api/game/POT-001   OR   POST { pot_id }
// Geen wachtwoord — dit is voor de klant op /game/{pot_id}.

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
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  let potId = '';
  if (event.queryStringParameters && event.queryStringParameters.pot_id) {
    potId = event.queryStringParameters.pot_id;
  }
  if (!potId && event.path) {
    const m = event.path.match(/POT-\d{3}/i);
    if (m) potId = m[0];
  }
  if (!potId && event.body) {
    try { potId = (JSON.parse(event.body || '{}').pot_id || '').toString(); } catch {}
  }
  potId = potId.toUpperCase().trim();
  if (!/^POT-\d{3}$/.test(potId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid pot id' }) };
  }

  const potsStore = getStore(blobOpts('ellemelle-pots'));
  const pot = await potsStore.get(potId, { type: 'json' });
  if (!pot) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'pot not found', pot_id: potId }) };
  }

  if (!pot.game_id) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, pot_id: potId, has_game: false }),
    };
  }

  const game = getGame(pot.game_id);
  if (!game) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pot_id: potId, has_game: false, error: 'game definition missing' }) };
  }

  // Commit-flag: alleen persistent maken (en "gestart" loggen) wanneer de speler
  // écht start (intro play indrukt of een stop opent). Zonder commit geven we
  // een default state terug zonder deze op te slaan — dus "je hebt m niet
  // gestart door alleen de pagina te openen".
  let commit = false;
  try {
    if (event.queryStringParameters && String(event.queryStringParameters.commit || '') === '1') commit = true;
    if (!commit && event.body) {
      const b = JSON.parse(event.body || '{}');
      if (b && (b.commit === true || b.commit === '1' || b.commit === 1)) commit = true;
    }
  } catch {}

  // Init state
  let state = pot.game_state || null;
  const isFirstStart = !state;
  if (!state) {
    state = {
      game_id: game.id,
      current_mission_idx: 1, // intro = stop 1
      scanned: false,         // true wanneer de tegel van current stop is gescand
      won: false,
      started_at: null,       // pas gezet wanneer commit=1
      won_at: null,
    };
  }
  if (isFirstStart && commit) {
    state.started_at = new Date().toISOString();
    pot.game_state = state;
    await potsStore.setJSON(potId, pot);

    // Log game_started op de klant (best-effort, niet blocking)
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
              action: 'game_started',
              game_id: game.id,
              game_name: game.name,
              pot_id: potId,
            });
          }
        }
      } catch { /* swallow */ }
    }
  }
  if (state && typeof state.scanned !== 'boolean') {
    // Migrate oude state zonder scanned veld
    state.scanned = false;
  }
  // Migratie: bouw completed[] op uit oude current_mission_idx als 'ie ontbreekt
  if (!Array.isArray(state.completed)) {
    const c = [];
    for (let i = 1; i < state.current_mission_idx; i++) c.push(i);
    if (state.won) {
      // Win-state: alle stops zijn voltooid
      const total = game.missions.length + 1;
      for (let i = 1; i <= total; i++) if (!c.includes(i)) c.push(i);
    }
    state.completed = c;
  }

  // Admin mode: zelfde gating als de speler, maar krijgt extra qr_token + riddle_answer
  // per stop terug zodat admin makkelijk kan testen zonder het echte spel te doorlopen.
  let adminMode = false;
  let body2 = {};
  try { body2 = JSON.parse(event.body || '{}'); } catch {}
  const sentPw = (event.queryStringParameters && event.queryStringParameters.password) || body2.password;
  if (sentPw && process.env.ADMIN_PASSWORD && sentPw === process.env.ADMIN_PASSWORD) {
    adminMode = true;
  }

  const totalMissions = game.missions.length + 1;
  const visibleState = state;

  // Per stop: audio_text onthullen wanneer completed of (current && scanned).
  // qr_token + riddle_answer alleen voor admin debugging (niet voor speler).
  const completedSet = new Set(state.completed || []);
  const safeStop = (s, idx) => {
    if (!s) return null;
    const isCompleted = completedSet.has(idx);
    const isCurrent   = idx === state.current_mission_idx && !isCompleted;
    const reveal = isCompleted || (isCurrent && state.scanned);
    return {
      idx,
      title: s.title,
      mission_image: s.mission_image || null,
      body: s.body,
      body_subheading: s.body_subheading,
      body_extra: s.body_extra,
      lat: s.lat, lng: s.lng, place: s.place,
      puzzle_type: s.puzzle_type || "multiple_choice",
      ...(reveal ? {
        audio_text: s.audio_text,
        puzzle_question: s.puzzle_question,
        puzzle_options: s.puzzle_options,
        name_template: s.name_template,
      } : {}),
      ...(adminMode ? { qr_token: s.qr_token, riddle_answer: s.riddle_answer } : {}),
    };
  };

  const stops = [
    safeStop(game.intro, 1),
    ...game.missions.map(m => safeStop(m, m.idx)),
  ];

  // Klant-personalisatie: haal voornaam op via bestelling (best-effort, cached vrijwillig).
  let customerName = '';
  if (pot.voornaam) {
    customerName = String(pot.voornaam).trim();
  } else if (pot.order_id && process.env.NETLIFY_API_TOKEN) {
    try {
      const sub = await fetch(`https://api.netlify.com/api/v1/submissions/${pot.order_id}`, {
        headers: { Authorization: `Bearer ${process.env.NETLIFY_API_TOKEN}` },
      });
      if (sub.ok) {
        const j = await sub.json();
        const d = j.data || {};
        customerName = (d.voornaam || '').toString().trim();
      }
    } catch {}
  }
  const safeName = customerName ? customerName.charAt(0).toUpperCase() + customerName.slice(1) : '';
  const interp = (tpl) => String(tpl || '').replace(/\{\{name\}\}/g, safeName || 'avonturier');

  const safeGame = {
    id: game.id,
    name: game.name,
    prize_label: game.prize_label,
    header_image: game.header_image || null,
    welcome_audio: interp(game.welcome_audio),
    welcome_title: interp(game.welcome_title),
    welcome_lead: interp(game.welcome_lead),
    stops,
    total_missions: totalMissions,
    customer_name: safeName,
    ...(adminMode ? { secret_code: game.secret_code } : {}),
  };

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ok: true, pot_id: potId, has_game: true,
      game: safeGame, state: visibleState,
      admin_mode: adminMode,
      real_state: adminMode ? state : undefined,
    }),
  };
};
