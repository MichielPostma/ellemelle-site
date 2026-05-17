// Admin override of:
//   - delivery_date (geplande bezorgweek) — was the existing behaviour
//   - uiterlijke_bezorgdatum (vaste belofte) — new in refactor #115
//
// POST { password, order_id, delivery_date?, uiterlijke_bezorgdatum? }
//   - Both fields optional; pass "" to clear override (revert to auto-computed)
//   - Both overrides are appended to order.history for auditeerbaarheid
const { getStore } = require('@netlify/blobs');
const { blobOpts } = require('./_lib/orders');

function isoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

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
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing order_id' }) };

  const hasGeplande = Object.prototype.hasOwnProperty.call(body, 'delivery_date');
  const hasUiterlijke = Object.prototype.hasOwnProperty.call(body, 'uiterlijke_bezorgdatum');
  if (!hasGeplande && !hasUiterlijke) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'pass delivery_date or uiterlijke_bezorgdatum' }) };
  }

  const dateGeplande   = hasGeplande   ? (body.delivery_date == null ? '' : String(body.delivery_date)).trim() : null;
  const dateUiterlijke = hasUiterlijke ? (body.uiterlijke_bezorgdatum == null ? '' : String(body.uiterlijke_bezorgdatum)).trim() : null;
  if (dateGeplande && !isoOk(dateGeplande)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid delivery_date (expected YYYY-MM-DD)' }) };
  }
  if (dateUiterlijke && !isoOk(dateUiterlijke)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid uiterlijke_bezorgdatum (expected YYYY-MM-DD)' }) };
  }

  const store = getStore(blobOpts('ellemelle-orders'));
  const current = (await store.get(orderId, { type: 'json' })) || {};
  const next = { ...current };
  const now = new Date().toISOString();
  const history = Array.isArray(current.history) ? current.history.slice() : [];

  if (hasGeplande) {
    const prev = current.delivery_date_override || null;
    const val = dateGeplande || null;
    if (prev !== val) {
      next.delivery_date_override = val;
      history.push({ at: now, action: 'override_geplande_bezorgweek', from: prev, to: val });
    }
  }
  if (hasUiterlijke) {
    const prev = current.uiterlijke_bezorgdatum_override || null;
    const val = dateUiterlijke || null;
    if (prev !== val) {
      next.uiterlijke_bezorgdatum_override = val;
      history.push({ at: now, action: 'override_uiterlijke_bezorgdatum', from: prev, to: val });
    }
  }
  next.history = history;
  await store.setJSON(orderId, next);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, order: next }) };
};
