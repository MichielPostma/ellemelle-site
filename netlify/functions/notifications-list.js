// Aggregates recent events for the admin notifications timeline drawer.
// Returns a merged, chronologically-sorted list of:
//   - order.history events (status changes, scans, message-sent, etc.)
//   - Push notifications sent to admins (from push-log blob)
//
// POST { password, limit?: number } — password-gated, defaults to 100 items.

const { getStore } = require('@netlify/blobs');
const { listEnrichedOrders } = require('./_lib/orders');

function blobOpts(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_API_TOKEN;
  }
  return opts;
}

function displayName(order) {
  const v = (order.voornaam || '').trim();
  const a = (order.achternaam || '').trim();
  return (v + ' ' + a).trim() || (order.email || 'Onbekend');
}

// Turn a raw order.history entry + context into a UI-friendly notification.
function historyEntryToNotification(order, entry) {
  const at = entry.at || entry.ts || entry.created_at || null;
  if (!at) return null;
  const action = entry.action || entry.type || 'event';
  const customer = displayName(order);
  const orderUrl = '/bestelling/' + order.id;

  // Compact human labels + icons per known action type
  const LABELS = {
    'status_changed': { icon: '🔄', title: (e) => `Status naar "${e.to || '—'}"` },
    'override_geplande_bezorgweek': { icon: '📅', title: (e) => `Bezorgweek gewijzigd → ${e.to || '—'}` },
    'override_uiterlijke_bezorgdatum': { icon: '📅', title: (e) => `Uiterlijke datum → ${e.to || '—'}` },
    'backfill_uiterlijke': { icon: '📅', title: () => `Uiterlijke datum (backfill)` },
    'extra-pot-ordered': { icon: '🍯', title: () => `Extra pot besteld` },
    'set_update_message_status': { icon: '✉️', title: (e) => `Update-bericht: ${e.to || '—'}` },
    'share_message': { icon: '💬', title: (e) => `Bericht verstuurd (${e.channel || '—'})` },
    'message_shared': { icon: '💬', title: (e) => `Bericht verstuurd (${e.channel || '—'})` },
    'scanned': { icon: '📱', title: (e) => `Pot gescand (missie ${e.mission_idx ?? '?'})` },
    'game_check_in': { icon: '📱', title: (e) => `Missie ${e.mission_idx ?? '?'} check-in` },
    'game_mission_completed': { icon: '🎯', title: (e) => `Missie ${e.mission_idx ?? '?'} voltooid` },
    'game_won': { icon: '🏆', title: () => `Spel gewonnen 🎉` },
    'notes_added': { icon: '📝', title: () => `Notitie toegevoegd` },
    'refunded_klant_credit': { icon: '💰', title: (e) => `Klant-credit terugbetaald (€${((e.amount ?? 0) * 3)})` },
    'apply_order_credit': { icon: '💰', title: (e) => `Credit toegepast (€${((e.amount ?? 0) * 3)})` },
    'save_rating': { icon: '⭐', title: (e) => `Beoordeling opgeslagen (${e.rating ?? '?'} sterren)` },
    'pot_coupled': { icon: '🔗', title: (e) => `Pot ${e.pot_id || '?'} gekoppeld` },
    'pot_uncoupled': { icon: '✂️', title: (e) => `Pot ${e.pot_id || '?'} ontkoppeld` },
    'new_order': { icon: '🛒', title: () => `Nieuwe bestelling` },
  };

  const meta = LABELS[action] || { icon: '📌', title: () => action.replace(/_/g, ' ') };
  return {
    at,
    icon: meta.icon,
    title: meta.title(entry),
    subtitle: customer,
    url: orderUrl,
    order_id: order.id,
    action,
    source: 'order_history',
  };
}

async function readPushLog() {
  const store = getStore(blobOpts('ellemelle-push-log'));
  try {
    const raw = await store.get('log', { type: 'json' });
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch { return []; }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body.password !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  const limit = Math.max(10, Math.min(500, parseInt(body.limit || 100, 10) || 100));

  try {
    // 1) All orders + their histories
    const { all } = await listEnrichedOrders();
    const orderEvents = [];
    for (const o of (all || [])) {
      const h = Array.isArray(o.history) ? o.history : [];
      for (const e of h) {
        const notif = historyEntryToNotification(o, e);
        if (notif) orderEvents.push(notif);
      }
    }

    // 2) Push-log entries (as they were pushed)
    const pushLog = await readPushLog();
    const pushEvents = pushLog.map(p => ({
      at: p.at,
      icon: p.icon || '🔔',
      title: p.title || 'Push melding',
      subtitle: p.body || '',
      url: p.url || null,
      order_id: p.order_id || null,
      action: p.action || 'push',
      source: 'push',
    }));

    // 3) Merge, sort by `at` desc, cap
    const all_events = orderEvents.concat(pushEvents)
      .filter(e => e && e.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, limit);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, notifications: all_events }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server error: ' + (e && e.message || e) }) };
  }
};
