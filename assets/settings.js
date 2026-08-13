// Admin settings — reusable across all admin pages.
//
// Usage (call once after admin login):
//   window.EllemelSettings.init({
//     password: STATE.password,
//     mountBefore: document.querySelector('#notif-bell-btn')
//                  || document.querySelector('#menu-open'),
//     onLogout: () => { clearSession(); location.reload(); },
//   });
//
// Renders a gear icon in the topbar (before `mountBefore`).
// Tapping it opens a full-page "Instellingen" overlay with:
//   - "Meldingen"  → toggle switch (delegates to hidden #push-toggle-btn)
//   - "Uitloggen"  → row that calls onLogout callback
//
// Matches the Ellemel design tokens (--cream, --red, --black, DM Sans).

(function () {
  let currentPassword = null;
  let currentOnLogout = null;

  // ─── icons ──────────────────────────────────────────────────────────────
  const SVG = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  };

  // ─── styles ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ellemel-settings-styles')) return;
    const css = `
      .settings-gear-btn {
        width: 44px; height: 44px;
        border: none; background: transparent;
        cursor: pointer; padding: 10px;
        color: var(--black, #1A1A1A);
        -webkit-tap-highlight-color: transparent;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .settings-gear-btn svg { width: 24px; height: 24px; display: block; }

      /* Full-page Instellingen screen — matches notif-page pattern */
      .settings-page {
        position: fixed; inset: 0;
        background: var(--cream, #feece2);
        color: var(--black, #1A1A1A);
        z-index: 9999;
        overflow-y: auto;
        padding: 24px;
        -webkit-overflow-scrolling: touch;
        transform: translateX(100%);
        transition: transform 260ms cubic-bezier(0.32, 0.72, 0, 1);
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      .settings-page.open { transform: translateX(0); }
      .settings-page-inner {
        max-width: 1100px;
        margin: 0 auto;
      }
      .settings-page-back {
        background: transparent; border: none; padding: 6px 0;
        color: var(--black, #1A1A1A);
        font-family: inherit; font-size: 15px; font-weight: 600;
        cursor: pointer; text-decoration: none;
        display: inline-block; margin-bottom: 4px;
      }
      .settings-page-back:hover { color: var(--red, #D9301E); }
      .settings-page-title {
        color: var(--red, #D9301E);
        font-size: 28px;
        line-height: 1.15;
        margin-bottom: 18px;
        letter-spacing: -0.2px;
        font-weight: 700;
        font-family: inherit;
      }
      .settings-group-label {
        color: #666;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        margin: 18px 0 8px;
      }
      .settings-group-label:first-of-type { margin-top: 4px; }
      .settings-card {
        background: var(--white, #fff);
        border: 2px solid rgba(0,0,0,0.08);
        border-radius: 12px;
        margin-bottom: 8px;
        overflow: hidden;
      }
      .settings-row {
        display: flex; align-items: center;
        gap: 12px;
        padding: 14px 16px;
        background: transparent;
        cursor: pointer;
        text-align: left;
        text-decoration: none;
        color: inherit;
        font-family: inherit;
        border: 0;
        width: 100%;
        border-bottom: 1px solid var(--cream-dark, #ECE3D2);
        transition: background 100ms;
      }
      .settings-row:last-child { border-bottom: none; }
      .settings-row:hover { background: rgba(0,0,0,0.02); }
      .settings-row-icon {
        width: 30px; height: 30px;
        flex-shrink: 0;
        color: var(--red, #D9301E);
        display: flex; align-items: center; justify-content: center;
      }
      .settings-row-icon svg { width: 22px; height: 22px; display: block; }
      .settings-row-body { flex: 1; min-width: 0; }
      .settings-row-title {
        font-size: 15px; font-weight: 600;
        color: var(--black, #1A1A1A);
        margin-bottom: 2px;
      }
      .settings-row-sub {
        font-size: 12px;
        color: #666;
      }
      .settings-row-arrow {
        width: 24px; height: 24px;
        flex-shrink: 0;
        color: var(--red, #D9301E);
        display: flex; align-items: center; justify-content: center;
        opacity: 0.7;
      }
      .settings-row-arrow svg { width: 18px; height: 18px; display: block; }

      /* iOS-style toggle switch */
      .settings-toggle {
        position: relative;
        width: 46px; height: 28px;
        flex-shrink: 0;
        background: rgba(0,0,0,0.15);
        border-radius: 999px;
        transition: background 180ms;
      }
      .settings-toggle::after {
        content: '';
        position: absolute; top: 3px; left: 3px;
        width: 22px; height: 22px;
        background: #fff;
        border-radius: 50%;
        transition: transform 180ms;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
      }
      .settings-toggle.on { background: var(--red, #D9301E); }
      .settings-toggle.on::after { transform: translateX(18px); }
      .settings-toggle.disabled { opacity: 0.4; }
    `;
    const s = document.createElement('style');
    s.id = 'ellemel-settings-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensurePageDom() {
    if (document.getElementById('settings-page')) return;
    const page = document.createElement('div');
    page.className = 'settings-page';
    page.id = 'settings-page';
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.innerHTML = `
      <div class="settings-page-inner">
        <button class="settings-page-back" id="settings-page-back" type="button" aria-label="Terug">← Terug</button>
        <h1 class="settings-page-title">Instellingen</h1>
        <div id="settings-page-body"></div>
      </div>
    `;
    document.body.appendChild(page);
    page.querySelector('#settings-page-back').addEventListener('click', () => closePage(false));
    window.addEventListener('popstate', () => {
      if (page.classList.contains('open')) closePage(true);
    });
  }

  function ensureGearButton(mountBefore) {
    if (document.getElementById('settings-gear-btn')) return document.getElementById('settings-gear-btn');
    if (!mountBefore || !mountBefore.parentNode) return null;

    const btn = document.createElement('button');
    btn.className = 'settings-gear-btn';
    btn.id = 'settings-gear-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Instellingen');
    btn.innerHTML = SVG.gear;

    // Mirror positioning if mountBefore is absolutely positioned (e.g. bestelling.html)
    const cs = window.getComputedStyle(mountBefore);
    if (cs.position === 'absolute' || cs.position === 'fixed') {
      const w = mountBefore.offsetWidth || 44;
      const rightVal = cs.right;
      const rightPx = rightVal.endsWith('px') ? parseFloat(rightVal) : 20;
      btn.style.position = cs.position;
      btn.style.top = cs.top;
      btn.style.right = (rightPx + w) + 'px';
      btn.style.color = cs.color;
    }

    mountBefore.parentNode.insertBefore(btn, mountBefore);
    btn.addEventListener('click', openPage);
    return btn;
  }

  // ─── push subscription (self-contained; works on any page with /sw.js) ──
  const VAPID_PUB = 'BHs8XMmB85-7cvflwulhQc4xsjvSRjpQz_1uEoGUlDgYcj0_mtvzjyeNujg6nwlpZstsx0lAo3QzHBvQY0oqTHo';
  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
  }
  async function isSubscribed() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  }
  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await registerSW();
    if (!reg) return false;
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUB),
      });
    }
    if (!currentPassword) return false;
    const r = await fetch('/.netlify/functions/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: currentPassword, subscription: sub.toJSON() }),
    });
    return r.ok;
  }
  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return true;
    if (currentPassword) {
      try {
        await fetch('/.netlify/functions/push-subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: currentPassword, subscription: sub.toJSON(), action: 'unsubscribe' }),
        });
      } catch {}
    }
    try { await sub.unsubscribe(); } catch {}
    return true;
  }
  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unavailable';
    if (typeof Notification === 'undefined') return 'unavailable';
    if (Notification.permission === 'denied') return 'denied';
    const on = await isSubscribed();
    return on ? 'on' : 'off';
  }

  // ─── klantenstop (public read via levering-info; admin write via voorraad-set-config) ──
  async function fetchCustomerStop() {
    try {
      const r = await fetch('/.netlify/functions/levering-info?aantal=1&ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      return !!j.customer_stop;
    } catch { return false; }
  }
  async function setCustomerStop(active) {
    if (!currentPassword) return false;
    try {
      const r = await fetch('/.netlify/functions/voorraad-set-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, customer_stop: !!active }),
      });
      return r.ok;
    } catch { return false; }
  }

  async function renderRows() {
    const body = document.getElementById('settings-page-body');
    if (!body) return;
    const [state, stopOn] = await Promise.all([pushState(), fetchCustomerStop()]);
    const toggleCls = 'settings-toggle' + (state === 'on' ? ' on' : '') + (state === 'unavailable' || state === 'denied' ? ' disabled' : '');
    const notifSub = state === 'denied'
      ? 'Meldingen zijn geblokkeerd — sta toe in browser-instellingen'
      : state === 'unavailable'
        ? 'Deze browser ondersteunt geen push-meldingen'
        : (state === 'on' ? 'Aan' : 'Uit');
    const stopToggleCls = 'settings-toggle' + (stopOn ? ' on' : '');
    body.innerHTML = `
      <div class="settings-group-label">Winkel</div>
      <div class="settings-card">
        <button type="button" class="settings-row" id="settings-toggle-stop">
          <div class="settings-row-icon">${SVG.stop}</div>
          <div class="settings-row-body">
            <div class="settings-row-title">Nieuwe-klantenstop</div>
            <div class="settings-row-sub">Pauzeert alleen nieuwe klanten — bestaande klanten kunnen blijven reorderen via hun pot-QR.</div>
          </div>
          <div class="${stopToggleCls}" id="settings-stop-toggle"></div>
        </button>
      </div>
      <div class="settings-group-label">Account</div>
      <div class="settings-card">
        <button type="button" class="settings-row" id="settings-toggle-notif">
          <div class="settings-row-icon">${SVG.bell}</div>
          <div class="settings-row-body">
            <div class="settings-row-title">Meldingen</div>
            <div class="settings-row-sub">${notifSub}</div>
          </div>
          <div class="${toggleCls}" id="settings-notif-toggle"></div>
        </button>
        <button type="button" class="settings-row" id="settings-logout">
          <div class="settings-row-icon">${SVG.logout}</div>
          <div class="settings-row-body">
            <div class="settings-row-title">Uitloggen</div>
            <div class="settings-row-sub">Sessie afsluiten en teruggaan naar login</div>
          </div>
          <div class="settings-row-arrow">${SVG.arrow}</div>
        </button>
      </div>
    `;
    const notifBtn = document.getElementById('settings-toggle-notif');
    notifBtn.addEventListener('click', async () => {
      const st = await pushState();
      if (st === 'unavailable' || st === 'denied') return;
      notifBtn.style.pointerEvents = 'none';
      if (st === 'on') await unsubscribePush();
      else            await subscribePush();
      notifBtn.style.pointerEvents = '';
      renderRows();
    });
    const stopBtn = document.getElementById('settings-toggle-stop');
    const stopVisual = document.getElementById('settings-stop-toggle');
    stopBtn.addEventListener('click', async () => {
      stopBtn.style.pointerEvents = 'none';
      const currentlyOn = stopVisual.classList.contains('on');
      // Optimistic flip
      stopVisual.classList.toggle('on', !currentlyOn);
      const ok = await setCustomerStop(!currentlyOn);
      if (!ok) {
        // Roll back
        stopVisual.classList.toggle('on', currentlyOn);
      }
      stopBtn.style.pointerEvents = '';
    });
    document.getElementById('settings-logout').addEventListener('click', () => {
      if (typeof currentOnLogout === 'function') currentOnLogout();
      else { try { localStorage.removeItem('ellemelle_admin_session_v1'); } catch {} location.reload(); }
    });
  }

  function openPage() {
    ensurePageDom();
    const page = document.getElementById('settings-page');
    renderRows();
    try { history.pushState({ settingsPage: true }, ''); } catch {}
    requestAnimationFrame(() => page.classList.add('open'));
  }
  function closePage(fromPopstate) {
    const page = document.getElementById('settings-page');
    if (page) page.classList.remove('open');
    if (!fromPopstate) {
      try {
        if (history.state && history.state.settingsPage) history.back();
      } catch {}
    }
  }

  const api = {
    init({ password, mountBefore, onLogout }) {
      injectStyles();
      currentPassword = password || null;
      currentOnLogout = typeof onLogout === 'function' ? onLogout : null;
      ensureGearButton(mountBefore);
      ensurePageDom();
    },
    open: openPage,
    close: closePage,
  };
  window.EllemelSettings = api;
})();
