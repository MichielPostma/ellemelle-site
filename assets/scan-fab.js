// ELLEMELLE shared QR-scan FAB — state-aware admin pot drawer.
// Five modes based on pot.status: uninitialized / available / voorraad / delivered / returned.
// Always shows pot details + history at the bottom.

import QrScanner from 'https://esm.sh/qr-scanner@1.4.2';

(function () {
  'use strict';

  const STORAGE_KEY = 'ellemelle_admin_session_v1';
  let qrScanner = null;
  let overlayEl = null;
  let drawerRoot = null;
  let __currentPot = null;
  let __ordersCache = null;  // {at, orders} — small in-memory cache
  let __selectedStockTarget = null; // 'available' | 'voorraad' — for stock state picker

  // ───── helpers ─────────────────────────────────────────────────────────
  function getPassword() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o.expires && Date.now() > o.expires) return null;
      return o.password || null;
    } catch { return null; }
  }
  async function api(ep, body) {
    const pw = getPassword();
    if (!pw) return { ok: false, data: { error: 'no session' } };
    const r = await fetch(`/.netlify/functions/${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ password: pw }, body || {})),
    });
    let data = {};
    try { data = await r.json(); } catch {}
    return { ok: r.ok, data };
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function fmtDateNL(iso) {
    if (!iso) return '';
    const M = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
    const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
    return `${d} ${M[m-1]} ${y}`;
  }
  function fmtDateShort(iso) {
    if (!iso) return '';
    const M = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
  }
  function daysUntil(iso) {
    if (!iso) return null;
    const [y,m,d] = iso.split('-').map(n => parseInt(n,10));
    const t = new Date(y, m-1, d); t.setHours(0,0,0,0);
    const n = new Date(); n.setHours(0,0,0,0);
    return Math.round((t - n) / (24*3600*1000));
  }
  function expiryText(iso) {
    const n = daysUntil(iso);
    if (n === null) return null;
    if (n < 0)   return 'verlopen';
    if (n === 0) return 'vandaag laatste dag';
    if (n === 1) return 'nog 1 dag';
    return `nog ${n} dagen`;
  }
  function fmtEuro(n) {
    return '€' + (Number(n) || 0).toFixed(2).replace('.', ',');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toast(msg, type) {
    let t = document.querySelector('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1A1A1A;color:white;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:600;z-index:1000;opacity:0;transition:opacity 200ms;box-shadow:0 8px 20px rgba(0,0,0,0.2);max-width:90%;text-align:center;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'error' ? '#D9301E' : (type === 'success' ? '#1c7d3f' : '#1A1A1A');
    t.style.opacity = '1';
    clearTimeout(window.__sfbT);
    window.__sfbT = setTimeout(() => { t.style.opacity = '0'; }, 2800);
  }
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(); const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const t = now + i * 0.08;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        osc.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t); osc.stop(t + 0.4);
      });
    } catch {}
  }

  // ───── camera overlay ──────────────────────────────────────────────────
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'scan-fab-overlay';
    overlayEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:200;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;';
    overlayEl.innerHTML = `
      <div style="position:relative;width:100%;max-width:420px;aspect-ratio:1/1;background:#000;border-radius:14px;overflow:hidden;">
        <video id="scan-fab-video" playsinline muted style="width:100%;height:100%;display:block;object-fit:cover;"></video>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <div style="width:60%;height:60%;border:3px solid rgba(255,255,255,0.6);border-radius:14px;"></div>
        </div>
      </div>
      <div style="color:white;font-size:14px;font-weight:600;margin-top:18px;text-align:center;">Scan een POT-QR-code</div>
      <button id="scan-fab-cancel" type="button" style="margin-top:18px;background:transparent;color:white;border:2px solid rgba(255,255,255,0.4);padding:12px 28px;border-radius:14px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;">Annuleer</button>
    `;
    document.body.appendChild(overlayEl);
    document.getElementById('scan-fab-cancel').addEventListener('click', stopScan);
    return overlayEl;
  }
  async function startScan() {
    ensureOverlay();
    ensureDrawer();
    overlayEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const video = document.getElementById('scan-fab-video');
    if (qrScanner) return;
    qrScanner = new QrScanner(video, async (result) => {
      const text = result.data || result;
      const m = /POT-\d{3}/i.exec(text);
      if (!m) return;
      const potId = m[0].toUpperCase();
      playChime();
      stopScan();
      await handlePotScan(potId);
    }, { highlightScanRegion: true, returnDetailedScanResult: true });
    try { await qrScanner.start(); }
    catch { stopScan(); toast('Camera niet beschikbaar', 'error'); }
  }
  function stopScan() {
    if (qrScanner) { qrScanner.stop(); qrScanner.destroy(); qrScanner = null; }
    if (overlayEl) overlayEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function handlePotScan(potId) {
    // Use pot-get — returns enriched pot + customer fields if delivered.
    const res = await api('pot-get', { pot_id: potId });
    if (!res.ok && res.data && res.data.error !== 'pot not found') {
      toast('Kon pot niet ophalen', 'error');
      return;
    }
    const pot = res.ok ? res.data : { id: potId, status: 'uninitialized' };
    // pot-get doesn't return history — fall back to voorraad-list for that.
    if (!pot.history) {
      try {
        const vr = await api('voorraad-list');
        if (vr.ok) {
          const full = (vr.data.pots || []).find(p => p.id === potId);
          if (full) { pot.history = full.history || []; pot.order_id = pot.order_id || full.order_id; }
        }
      } catch {}
    }
    openDrawer(pot);
  }

  // ───── drawer shell ────────────────────────────────────────────────────
  function ensureDrawer() {
    if (drawerRoot) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'sfb-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);opacity:0;pointer-events:none;transition:opacity 200ms;z-index:90;';
    const drawer = document.createElement('div');
    drawer.id = 'sfb-drawer';
    drawer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#feece2;border-radius:20px 20px 0 0;padding:16px 20px 28px;transform:translateY(100%);transition:transform 220ms;z-index:100;max-height:88vh;overflow-y:auto;box-shadow:0 -10px 30px rgba(0,0,0,0.12);padding-bottom:max(28px,env(safe-area-inset-bottom));';
    drawer.innerHTML = `
      <div style="width:40px;height:4px;border-radius:2px;background:rgba(0,0,0,0.18);margin:0 auto 14px;"></div>
      <div id="sfb-pid" style="font-size:14px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">POT-XXX</div>
      <h2 id="sfb-title" style="font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 18px;line-height:1.25;">—</h2>
      <div id="sfb-actions" style="display:flex;flex-direction:column;gap:10px;"></div>
      <div id="sfb-prod-date" hidden style="margin-top:14px;">
        <div style="color:#666;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Productiedatum</div>
        <input type="date" id="sfb-date" style="width:100%;min-height:56px;padding:0 18px;font-size:16px;font-family:inherit;font-weight:400;background:#fff;border:2px solid transparent;border-radius:14px;box-shadow:0 2px 10px rgba(139,26,14,0.08);color:#1A1A1A;appearance:none;-webkit-appearance:none;text-align:left;line-height:52px;height:56px;box-sizing:border-box;">
      </div>
      <div id="sfb-orders" hidden style="margin-top:24px;">
        <div style="color:#666;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px;">Pot afgeven aan</div>
        <div id="sfb-orders-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>
      <div id="sfb-err" style="color:#D9301E;font-size:14px;font-weight:600;margin-top:10px;display:none;"></div>
      <hr id="sfb-divider" style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:22px 0 18px;">
      <div id="sfb-details" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="sfb-history-wrap" hidden style="margin-top:18px;">
        <div style="color:#666;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Pot historie</div>
        <div id="sfb-history" style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:14px;padding:0;overflow:hidden;"></div>
      </div>
      <div id="sfb-footer-actions" style="margin-top:22px;display:flex;flex-direction:column;gap:10px;"></div>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    drawerRoot = { backdrop, drawer };
    backdrop.addEventListener('click', closeDrawer);
  }

  function closeDrawer() {
    if (!drawerRoot) return;
    drawerRoot.backdrop.style.opacity = '0';
    drawerRoot.backdrop.style.pointerEvents = 'none';
    drawerRoot.drawer.style.transform = 'translateY(100%)';
    __currentPot = null;
  }

  // ───── action button factory ───────────────────────────────────────────
  function actionButton(label, opts) {
    opts = opts || {};
    const variant = opts.variant || 'primary';
    const base = 'display:block;width:100%;min-height:56px;border-radius:14px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:0.2px;cursor:pointer;text-align:center;line-height:52px;-webkit-tap-highlight-color:transparent;border:none;';
    let style;
    if (variant === 'primary')   style = base + 'background:#D9301E;color:white;';
    else if (variant === 'outline') style = base + 'background:transparent;color:#D9301E;border:2px solid #D9301E;';
    else if (variant === 'subtle')  style = base + 'background:transparent;color:#666;border:2px solid rgba(0,0,0,0.12);';
    else style = base;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = style;
    if (opts.onClick) btn.addEventListener('click', opts.onClick);
    return btn;
  }

  function showError(msg) {
    const el = document.getElementById('sfb-err');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearError() {
    const el = document.getElementById('sfb-err');
    el.style.display = 'none';
    el.textContent = '';
  }

  // ───── status-history label ────────────────────────────────────────────
  function historyLabel(entry) {
    const a = entry.action || '';
    if (a === 'delivered')        return 'Bezorgd';
    if (a === 'pickup_requested') return 'Ophaal aangevraagd';
    if (a === 'rated') {
      const r = entry.stars || {};
      const avg = ['taste','texture','kids'].map(k => r[k]).filter(Number.isFinite);
      const n = avg.length ? (avg.reduce((s,x)=>s+x,0)/avg.length).toFixed(1) : null;
      return n ? `Beoordeling ${n}★` : 'Beoordeling';
    }
    if (a === 'returned')         return entry.kind === 'swap' ? 'Teruggenomen (swap)' : 'Teruggenomen';
    if (a === 'status_change')    return `Status: ${entry.from || '?'} → ${entry.to || '?'}`;
    if (a === 'save_rating')      return 'Beoordeling';
    // Legacy 'trip' entries (pre-#208) had delivered_at + returned_at + was_swap, no explicit action
    if (entry.delivered_at && entry.returned_at && !a) {
      const swap = entry.was_swap ? ' (swap)' : '';
      return `Bezorgd → teruggenomen${swap}`;
    }
    return a || '–';
  }

  // ───── action handlers ─────────────────────────────────────────────────
  async function withGuard(fn) {
    clearError();
    try {
      const res = await fn();
      if (res && res.ok === false) {
        const m = (res.data && (res.data.error || res.data.message)) || 'Mislukt';
        showError(m);
        return null;
      }
      return res ? res.data : null;
    } catch (e) {
      showError(String(e && e.message || e));
      return null;
    }
  }

  async function setPotStatus(target, opts) {
    if (!__currentPot) return;
    const body = { pot_id: __currentPot.id, status: target };
    if (target === 'voorraad') {
      body.production_date = (opts && opts.production_date) || document.getElementById('sfb-date').value || todayISO();
    }
    const data = await withGuard(() => api('voorraad-set-pot', body));
    if (!data) return false;
    return true;
  }

  async function deleteCurrent(opts) {
    if (!__currentPot) return;
    const skipFirst = !!(opts && opts.skipFirstConfirm);
    if (!skipFirst && !confirm(`Weet je het zeker? POT ${__currentPot.id} wordt verwijderd.`)) return;
    const data = await withGuard(() => api('voorraad-delete-pot', { pot_id: __currentPot.id }));
    if (!data) return;
    toast(`${__currentPot.id} verwijderd`, 'success');
    closeDrawer();
    softRefreshPage();
  }

  async function returnPot(opts) {
    // opts.swap = true → mark pot as pickup-with-reorder FIRST, then return (so backend skips the -€1)
    if (!__currentPot || !__currentPot.order_id) return;
    if (opts && opts.swap) {
      // Mark the pot as pickup-with-reorder via customer-reorder endpoint?
      // Simpler: call bezorger-pot-return which checks pot.status === 'pickup-with-reorder'.
      // For a swap from the scan-FAB, we navigate to the reorder flow on the same customer.
      // The actual pot.history -1 credit logic happens when the new pot is delivered + old picked up.
      // For now: navigate to admin reorder flow with customer prefilled.
      navigateToReorder(__currentPot);
      return;
    }
    // Pure return — credit -1 happens server-side.
    const data = await withGuard(() => api('bezorger-pot-return', {
      order_id: __currentPot.order_id, pot_id: __currentPot.id,
    }));
    if (!data) return;
    toast(`${__currentPot.id} teruggenomen — statiegeld terug`, 'success');
    closeDrawer();
    softRefreshPage();
  }

  function navigateToReorder(pot) {
    // Open the admin order flow as a new tab with customer prefilled.
    // The customer's voornaam/adres come from pot-get; if missing, fall back to bestelling page.
    const q = new URLSearchParams();
    q.set('start', 'existing');
    if (pot.voornaam) q.set('voornaam', pot.voornaam);
    if (pot.adres) {
      const m = /^(.*?)\s+(\d+)(?:-(.+))?$/.exec(pot.adres);
      if (m) {
        q.set('straat', m[1].trim());
        q.set('huisnummer', m[2]);
        if (m[3]) q.set('toevoeging', m[3]);
      }
    }
    if (pot.stad) {
      const m = /^(\d{4}\s?[A-Z]{2})\s+(.+)$/.exec(pot.stad);
      if (m) { q.set('postcode', m[1]); q.set('plaats', m[2]); }
    }
    closeDrawer();
    window.open('/?' + q.toString(), '_blank');
  }

  async function deliverToOrder(orderId, orderVoornaam) {
    if (!__currentPot) return;
    const data = await withGuard(() => api('bezorger-deliver', {
      pot_id: __currentPot.id, order_id: orderId,
    }));
    if (!data) return;
    toast(`${__currentPot.id} bezorgd aan ${orderVoornaam || 'klant'}`, 'success');
    closeDrawer();
    // Navigate to the bestelling page so admin can confirm details + see success state
    window.location.href = '/bestelling/' + orderId + '?just_delivered=' + encodeURIComponent(__currentPot.id);
  }

  // ───── orders fetcher (for voorraad mode) ──────────────────────────────
  async function loadOpenOrders() {
    if (__ordersCache && (Date.now() - __ordersCache.at) < 10000) return __ordersCache.orders;
    const res = await api('bestellingen-list');
    if (!res.ok) return [];
    const all = res.data.orders || [];
    const open = all.filter(o =>
      ['todo', 'confirmed'].includes(o.order_status) &&
      !o.delivered_pot
    ).sort((a, b) => String(a.delivery_date || a.created_at).localeCompare(String(b.delivery_date || b.created_at)));
    __ordersCache = { at: Date.now(), orders: open };
    return open;
  }


  // Radio-card picker for stock states (available + voorraad), modelled on the old /voorraad drawer.
  function renderStockPicker(parent, currentStatus) {
    parent.innerHTML = '';
    const cardStyle = 'display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;background:#fff;border-radius:14px;border:2px solid rgba(0,0,0,0.08);cursor:pointer;text-align:left;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:border-color 120ms;box-shadow:0 2px 10px rgba(139,26,14,0.06);';
    const opts = [
      { value: 'available', title: 'Leeg',   sub: 'Pot is leeg en klaar om gevuld te worden', img: '/Images/pot-leeg-label.png' },
      { value: 'voorraad',  title: 'Gevuld', sub: 'Pot is gevuld en klaar voor bezorging',     img: '/Images/pot-bezorgd.png' },
    ];
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.target = o.value;
      btn.style.cssText = cardStyle;
      btn.innerHTML = `
        <img src="${o.img}" style="width:64px;height:64px;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0;">
        <div style="min-width:0;flex:1;">
          <div style="color:#1A1A1A;font-size:17px;font-weight:700;margin-bottom:2px;">${o.title}</div>
          <div style="color:#666;font-size:13px;line-height:1.35;">${o.sub}</div>
        </div>
      `;
      btn.addEventListener('click', () => selectStockTarget(o.value));
      parent.appendChild(btn);
    });
    selectStockTarget(currentStatus === 'voorraad' ? 'voorraad' : 'available');
  }

  function selectStockTarget(target) {
    __selectedStockTarget = target;
    document.querySelectorAll('#sfb-actions button[data-target]').forEach(b => {
      b.style.borderColor = b.dataset.target === target ? '#D9301E' : 'rgba(0,0,0,0.08)';
    });
    document.getElementById('sfb-prod-date').hidden = target !== 'voorraad';
  }

  async function saveStockTarget() {
    if (!__currentPot || !__selectedStockTarget) return;
    const target = __selectedStockTarget;
    const curr = __currentPot.status === 'uninitialized' ? 'available' : __currentPot.status;
    if (curr === target) { toast('Geen wijziging'); return; }
    if (await setPotStatus(target)) {
      toast(`${__currentPot.id} → ${target === 'voorraad' ? 'gevuld' : 'leeg'}`, 'success');
      closeDrawer(); softRefreshPage();
    }
  }

  // ───── per-status renderers ────────────────────────────────────────────
  function renderActions(pot) {
    const wrap = document.getElementById('sfb-actions');
    wrap.innerHTML = '';
    const status = pot.status || 'uninitialized';
    const titleEl = document.getElementById('sfb-title');
    const dateWrap = document.getElementById('sfb-prod-date');
    const ordersWrap = document.getElementById('sfb-orders');
    dateWrap.hidden = true;
    ordersWrap.hidden = true;

    if (status === 'uninitialized' || status === 'available') {
      // Radio-card picker (Leeg / Gevuld) + datum input + Bewaar primary button.
      titleEl.textContent = (status === 'uninitialized')
        ? 'Deze pot is nog niet op voorraad, wat wil je doen?'
        : 'Deze pot is leeg op voorraad, wat wil je doen?';
      // Card picker lives inside #sfb-actions (we hand it that DOM node)
      wrap.style.gap = '10px';
      renderStockPicker(wrap, status);
      // Date input — only relevant for the voorraad target; renderStockPicker toggles it via selectStockTarget.
      document.getElementById('sfb-date').value = todayISO();
      // Bewaar button below the cards
      const saveBtn = actionButton('Bewaar →', { variant: 'primary', onClick: saveStockTarget });
      saveBtn.style.marginTop = '8px';
      wrap.appendChild(saveBtn);
    }
    else if (status === 'voorraad') {
      titleEl.textContent = 'Deze pot is gevuld op voorraad, wat wil je doen?';
      // Radio-card picker so admin can flip Leeg/Gevuld in the same drawer.
      wrap.style.gap = '10px';
      renderStockPicker(wrap, status);
      document.getElementById('sfb-date').value = pot.production_date || todayISO();
      const saveBtn = actionButton('Bewaar →', { variant: 'primary', onClick: saveStockTarget });
      saveBtn.style.marginTop = '8px';
      wrap.appendChild(saveBtn);
      // "Pot afgeven" sectie
      ordersWrap.hidden = false;
      const list = document.getElementById('sfb-orders-list');
      list.innerHTML = '<div style="color:#666;font-size:14px;padding:8px 4px;">Openstaande bestellingen laden…</div>';
      loadOpenOrders().then(orders => {
        if (!orders.length) {
          list.innerHTML = '<div style="color:#666;font-size:14px;padding:8px 4px;">Geen openstaande bestellingen.</div>';
          return;
        }
        list.innerHTML = '';
        orders.forEach(o => {
          const row = document.createElement('button');
          row.type = 'button';
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;background:#fff;border:none;border-radius:14px;padding:14px 16px;text-align:left;font-family:inherit;cursor:pointer;box-shadow:0 2px 10px rgba(139,26,14,0.06);-webkit-tap-highlight-color:transparent;';
          const adres = `${o.straat || ''} ${o.huisnummer || ''}${o.toevoeging ? '-' + o.toevoeging : ''}`.trim();
          row.innerHTML = `
            <div style="min-width:0;flex:1;">
              <div style="font-size:15px;font-weight:700;color:#1A1A1A;">${esc(o.voornaam || '?')}</div>
              <div style="font-size:13px;color:#666;margin-top:2px;">${esc(adres)}</div>
            </div>
            <div style="font-size:12px;color:#999;font-weight:600;flex-shrink:0;">${esc(fmtDateShort(o.delivery_date))}</div>
          `;
          row.addEventListener('click', () => deliverToOrder(o.id, o.voornaam));
          list.appendChild(row);
        });
      });
    }
    else if (status === 'delivered') {
      const name = pot.voornaam || 'klant';
      titleEl.textContent = `Deze pot is bij ${name}, wat wil je doen?`;
      wrap.appendChild(actionButton('Statiegeld terug geven →', { variant: 'primary', onClick: () => returnPot() }));
      wrap.appendChild(actionButton('Wisselen voor nieuwe pot →', { variant: 'outline', onClick: () => returnPot({ swap: true }) }));
    }
    else if (status === 'returned') {
      titleEl.textContent = 'Deze pot heb je eerder teruggenomen, wat wil je doen?';
      dateWrap.hidden = false;
      document.getElementById('sfb-date').value = todayISO();
      wrap.appendChild(actionButton('Vol op voorraad zetten →', { variant: 'primary', onClick: async () => {
        if (await setPotStatus('voorraad')) {
          toast(`${pot.id} → gevuld (nieuwe cyclus)`, 'success');
          closeDrawer(); softRefreshPage();
        }
      }}));
      wrap.appendChild(actionButton('Leeg op voorraad zetten →', { variant: 'outline', onClick: async () => {
        if (await setPotStatus('available')) {
          toast(`${pot.id} → leeg (nieuwe cyclus)`, 'success');
          closeDrawer(); softRefreshPage();
        }
      }}));
      // "Pot verwijderen" sits at the bottom for returned-state — below pot details + history.
      // We render it after the history block via the dedicated footer slot.
    }
    else {
      titleEl.textContent = 'Onbekende pot-status: ' + status;
    }
  }

  function renderDetails(pot) {
    const wrap = document.getElementById('sfb-details');
    const rows = [];
    const status = pot.status || 'uninitialized';
    rows.push(['Status', describe(status)]);
    if (pot.production_date) {
      rows.push(['Productiedatum', fmtDateNL(pot.production_date)]);
    }
    if (pot.expiry_date) {
      const exp = expiryText(pot.expiry_date);
      rows.push(['Houdbaar t/m', `${fmtDateNL(pot.expiry_date)}${exp ? ' · ' + exp : ''}`]);
    }
    if (pot.delivered_at) {
      rows.push(['Bezorgd', fmtDateShort(pot.delivered_at.slice(0,10))]);
    }
    if (pot.returned_at) {
      rows.push(['Teruggenomen', fmtDateShort(pot.returned_at.slice(0,10))]);
    }
    if (pot.voornaam) {
      rows.push(['Klant', pot.voornaam]);
    }
    if (pot.adres) {
      rows.push(['Adres', pot.adres]);
    }
    // Statiegeld info — only meaningful for delivered/returned (link to order)
    if (pot.order_id) {
      rows.push([
        'Bestelling',
        `<a href="/bestelling/${esc(pot.order_id)}" style="color:#D9301E;text-decoration:none;font-weight:600;">Bekijk →</a>`,
      ]);
    }
    wrap.innerHTML = rows.map(([k, v]) =>
      `<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;line-height:1.4;">
        <span style="color:#666;">${esc(k)}</span>
        <span style="color:#1A1A1A;font-weight:500;text-align:right;">${v.startsWith('<a ') ? v : esc(v)}</span>
      </div>`
    ).join('');
  }

  function describe(s) {
    return ({
      uninitialized: 'Nog niet op voorraad',
      available: 'Op voorraad (leeg)',
      voorraad: 'Op voorraad (gevuld)',
      delivered: 'Bezorgd',
      returned: 'Teruggenomen',
      'pickup-requested': 'Ophaal aangevraagd',
      'pickup-with-reorder': 'Wissel-pot',
    }[s]) || s;
  }

  function renderHistory(pot) {
    const wrap = document.getElementById('sfb-history-wrap');
    const list = document.getElementById('sfb-history');
    const h = Array.isArray(pot.history) ? pot.history : [];
    if (!h.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const sorted = [...h].sort((a, b) =>
      String(b.returned_at || b.at || b.ts || b.delivered_at || '').localeCompare(String(a.returned_at || a.at || a.ts || a.delivered_at || ''))
    );
    // Render as a single white info-card with bottom-bordered entries (matches /bestelling Activiteit).
    list.innerHTML = sorted.slice(0, 12).map((entry, idx, arr) => {
      const date = entry.at || entry.returned_at || entry.ts || entry.delivered_at || '';
      const dateStr = date ? fmtDateShort(date.slice ? date.slice(0,10) : date) : '';
      const isLast = idx === arr.length - 1;
      return `<div style="padding:12px 16px;display:flex;flex-direction:column;gap:2px;${isLast ? '' : 'border-bottom:1px solid rgba(0,0,0,0.06);'}">
        <span style="color:#888;font-size:12px;">${esc(dateStr)}</span>
        <span style="color:#1A1A1A;font-size:14px;line-height:1.4;">${esc(historyLabel(entry))}</span>
      </div>`;
    }).join('');
  }

  function openDrawer(pot) {
    ensureDrawer();
    __currentPot = pot;
    clearError();
    document.getElementById('sfb-pid').textContent = pot.id;
    renderActions(pot);
    renderDetails(pot);
    renderHistory(pot);
    renderFooter(pot);
    drawerRoot.backdrop.style.opacity = '1';
    drawerRoot.backdrop.style.pointerEvents = 'auto';
    drawerRoot.drawer.style.transform = 'translateY(0)';
    drawerRoot.drawer.scrollTop = 0;
  }

  // Render the always-at-the-bottom Verwijder pot button.
  // For `delivered` an extra-strong confirm is needed because the pot is at a customer.
  function renderFooter(pot) {
    const wrap = document.getElementById('sfb-footer-actions');
    wrap.innerHTML = '';
    const status = pot.status || 'uninitialized';
    // Uninitialized has nothing to delete yet
    if (status === 'uninitialized') return;
    if (status === 'delivered') {
      wrap.appendChild(actionButton('Pot verwijderen', {
        variant: 'outline',
        onClick: async () => {
          if (!__currentPot) return;
          const name = __currentPot.voornaam || 'klant';
          const ok = confirm(`Weet je het echt zeker? POT ${__currentPot.id} staat nog bij ${name}. Verwijderen kan niet ongedaan worden.`);
          if (!ok) return;
          await deleteCurrent({ skipFirstConfirm: true });
        },
      }));
      return;
    }
    wrap.appendChild(actionButton('Pot verwijderen', { variant: 'outline', onClick: deleteCurrent }));
  }

  function softRefreshPage() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('cache_voorraad-list') || k.startsWith('cache_bezorger-orders') || k.startsWith('cache_bestellingen-list') || k.startsWith('cache_klanten-list') || k.startsWith('cache_bestellingen-get'))) {
          keys.push(k);
        }
      }
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch {}
    if (location.pathname === '/voorraad' || location.pathname === '/bestellingen' || location.pathname === '/koken') {
      location.reload();
    } else {
      try { window.dispatchEvent(new CustomEvent('apiFresh')); } catch {}
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('fab-scan');
    if (btn) btn.addEventListener('click', startScan);
  });

  // Expose for debugging/testing
  window.__sfb = { openDrawer, handlePotScan, startScan };
})();
