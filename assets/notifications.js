// Admin notifications — reusable across all admin pages.
//
// Usage (call once after admin login):
//   window.EllemelNotif.init({
//     password: STATE.password,          // admin password to auth requests
//     mountBefore: document.querySelector('#menu-open'),  // bell renders BEFORE this
//     baseUrl: '/.netlify/functions',    // optional (default this value)
//   });
//
// Uses the existing Ellemel design tokens (--cream, --red, --black, DM Sans).
// Falls back to defaults if the host page doesn't declare them.

(function () {
  const LS_KEY_LAST_READ = 'ellemel_notif_last_read';
  const LS_KEY_CACHE = 'ellemel_notif_cache_v1';

  let currentPassword = null;
  let currentBaseUrl = '/.netlify/functions';
  let cachedItems = [];

  function getLastRead() {
    try { return localStorage.getItem(LS_KEY_LAST_READ) || ''; } catch { return ''; }
  }
  function setLastRead(ts) {
    try { localStorage.setItem(LS_KEY_LAST_READ, ts); } catch {}
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(LS_KEY_CACHE);
      if (raw) cachedItems = JSON.parse(raw) || [];
    } catch { cachedItems = []; }
  }
  function saveCache() {
    try {
      localStorage.setItem(LS_KEY_CACHE, JSON.stringify(cachedItems.slice(0, 100)));
    } catch {}
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffSec = Math.round((now - d) / 1000);
    if (diffSec < 60) return 'net';
    if (diffSec < 3600) return Math.floor(diffSec / 60) + ' min';
    if (diffSec < 86400) return Math.floor(diffSec / 3600) + ' u';
    if (diffSec < 604800) return Math.floor(diffSec / 86400) + ' d';
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }
  function fmtDayLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const yday = new Date(now); yday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Vandaag';
    if (d.toDateString() === yday.toDateString()) return 'Gisteren';
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
  }

  function hasUnread() {
    const lastRead = getLastRead();
    if (!cachedItems.length) return false;
    if (!lastRead) return true;
    return cachedItems.some(it => String(it.at) > lastRead);
  }

  // ---- SVG icons (red outline, 24×24 viewBox) ----
  const SVG = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V15h4v7"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    unlink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07L11.42 5"/><path d="M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  };

  const ACTION_ICON_MAP = {
    'status_changed': 'status',
    'override_geplande_bezorgweek': 'calendar',
    'override_uiterlijke_bezorgdatum': 'calendar',
    'backfill_uiterlijke': 'calendar',
    'extra-pot-ordered': 'box',
    'set_update_message_status': 'mail',
    'share_message': 'message',
    'message_shared': 'message',
    'scanned': 'scan',
    'game_check_in': 'scan',
    'game_mission_completed': 'check',
    'game_won': 'trophy',
    'notes_added': 'note',
    'refunded_klant_credit': 'money',
    'apply_order_credit': 'money',
    'save_rating': 'star',
    'pot_coupled': 'link',
    'pot_uncoupled': 'unlink',
    'new_order': 'cart',
  };

  function injectStyles() {
    if (document.getElementById('ellemel-notif-styles')) return;
    const css = `
      /* Bell in the topbar — matches host page menu-btn size */
      .notif-bell-btn {
        width: 44px; height: 44px;
        border: none; background: transparent;
        cursor: pointer; padding: 10px;
        color: var(--black, #1A1A1A);
        -webkit-tap-highlight-color: transparent;
        position: relative;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .notif-bell-btn svg { width: 24px; height: 24px; display: block; }
      .notif-bell-dot {
        position: absolute;
        top: 8px; right: 8px;
        width: 8px; height: 8px;
        background: var(--red, #D9301E);
        border-radius: 50%;
        border: 2px solid var(--cream, #feece2);
        box-sizing: content-box;
      }

      /* Full-page Updates screen — inherits body font + beige background */
      .notif-page {
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
      .notif-page.open { transform: translateX(0); }
      .notif-page-inner {
        max-width: 1100px;
        margin: 0 auto;
      }
      .notif-page-back {
        background: transparent; border: none; padding: 6px 0;
        color: var(--black, #1A1A1A);
        font-family: inherit; font-size: 15px; font-weight: 600;
        cursor: pointer; text-decoration: none;
        display: inline-block; margin-bottom: 4px;
      }
      .notif-page-back:hover { color: var(--red, #D9301E); }
      .notif-page-title {
        color: var(--red, #D9301E);
        font-size: 28px;
        line-height: 1.15;
        margin-bottom: 18px;
        letter-spacing: -0.2px;
        font-weight: 700;
        font-family: inherit;
      }
      .notif-day-label {
        color: #666;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        margin: 18px 0 8px;
      }
      .notif-day-label:first-of-type { margin-top: 4px; }
      .notif-day-card {
        background: var(--white, #fff);
        border: 2px solid rgba(0,0,0,0.08);
        border-radius: 12px;
        margin-bottom: 8px;
        overflow: hidden;
      }
      .notif-item {
        display: flex; align-items: center;
        gap: 12px;
        padding: 12px 14px;
        background: transparent;
        cursor: pointer;
        text-decoration: none;
        color: inherit;
        font-family: inherit;
        border-bottom: 1px solid var(--cream-dark, #ECE3D2);
        transition: background 100ms;
      }
      .notif-item:last-child { border-bottom: none; }
      .notif-item:hover { background: rgba(0,0,0,0.02); }
      .notif-item.unread {
        background: rgba(217,48,30,0.04);
      }
      .notif-item-icon {
        width: 30px; height: 30px;
        flex-shrink: 0;
        color: var(--red, #D9301E);
        display: flex; align-items: center; justify-content: center;
      }
      .notif-item-icon svg { width: 20px; height: 20px; display: block; }
      .notif-item-body { flex: 1; min-width: 0; }
      .notif-item-title {
        font-size: 14px; font-weight: 600;
        color: var(--black, #1A1A1A);
        margin-bottom: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .notif-item-sub {
        font-size: 12px;
        color: #666;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .notif-item-arrow {
        width: 24px; height: 24px;
        flex-shrink: 0;
        color: var(--red, #D9301E);
        display: flex; align-items: center; justify-content: center;
        opacity: 0.7;
      }
      .notif-item-arrow svg { width: 18px; height: 18px; display: block; }
      .notif-empty {
        padding: 60px 20px;
        text-align: center;
        color: #999;
        font-size: 14px;
      }
      .notif-loading {
        padding: 60px 20px;
        text-align: center;
        color: #999;
        font-size: 14px;
      }
    `;
    const s = document.createElement('style');
    s.id = 'ellemel-notif-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensurePageDom() {
    if (document.getElementById('notif-page')) return;
    const page = document.createElement('div');
    page.className = 'notif-page';
    page.id = 'notif-page';
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.innerHTML = `
      <div class="notif-page-inner">
        <button class="notif-page-back" id="notif-page-back" type="button" aria-label="Terug">← Terug</button>
        <h1 class="notif-page-title">Updates</h1>
        <div id="notif-page-body">
          <div class="notif-loading">Laden…</div>
        </div>
      </div>
    `;
    document.body.appendChild(page);
    page.querySelector('#notif-page-back').addEventListener('click', closePage);
    window.addEventListener('popstate', () => {
      if (page.classList.contains('open')) closePage(true);
    });
  }

  function ensureBellButton(mountBefore) {
    if (document.getElementById('notif-bell-btn')) return document.getElementById('notif-bell-btn');
    if (!mountBefore || !mountBefore.parentNode) return null;

    const btn = document.createElement('button');
    btn.className = 'notif-bell-btn';
    btn.id = 'notif-bell-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Meldingen');
    btn.innerHTML = SVG.bell + '<span class="notif-bell-dot" id="notif-bell-dot" hidden></span>';

    // If mountBefore is absolutely positioned (e.g. bestelling.html),
    // mirror the positioning to the left so bell sits next to hamburger.
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

  function renderDot() {
    const unread = hasUnread();
    const dot = document.getElementById('notif-bell-dot');
    if (dot) dot.hidden = !unread;
    // Also sync any menu-drawer dot so drawer-based Meldingen entries show unread.
    const menuDot = document.getElementById('menu-notif-dot');
    if (menuDot) menuDot.style.display = unread ? 'inline-block' : 'none';
  }

  function iconSvgFor(action) {
    const key = ACTION_ICON_MAP[action];
    return SVG[key] || SVG.default;
  }

  function renderTimeline() {
    const body = document.getElementById('notif-page-body');
    if (!body) return;
    if (!cachedItems.length) {
      body.innerHTML = '<div class="notif-empty">Nog geen updates.</div>';
      return;
    }
    const lastRead = getLastRead();
    // Group items by day-label so each date becomes one card
    const groups = [];
    let currentDay = null;
    for (const it of cachedItems) {
      const day = fmtDayLabel(it.at);
      if (day !== currentDay) {
        currentDay = day;
        groups.push({ day, items: [] });
      }
      groups[groups.length - 1].items.push(it);
    }
    let html = '';
    for (const g of groups) {
      html += `<div class="notif-day-label">${escapeHtml(g.day)}</div>`;
      html += '<div class="notif-day-card">';
      for (const it of g.items) {
        const isUnread = lastRead ? String(it.at) > lastRead : true;
        const cls = 'notif-item' + (isUnread ? ' unread' : '');
        const tag = it.url ? 'a' : 'div';
        const href = it.url ? ` href="${escapeAttr(it.url)}"` : '';
        html += `
          <${tag} class="${cls}"${href}>
            <div class="notif-item-icon">${iconSvgFor(it.action)}</div>
            <div class="notif-item-body">
              <div class="notif-item-title">${escapeHtml(it.title || '')}</div>
              <div class="notif-item-sub">${escapeHtml(it.subtitle || '')} · ${escapeHtml(fmtRelative(it.at))}</div>
            </div>
            <div class="notif-item-arrow">${SVG.arrow}</div>
          </${tag}>
        `;
      }
      html += '</div>';
    }
    body.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  async function fetchNotifications() {
    if (!currentPassword) return;
    try {
      const r = await fetch(currentBaseUrl + '/notifications-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, limit: 100 }),
      });
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.notifications)) {
        cachedItems = j.notifications;
        saveCache();
        renderDot();
      }
    } catch {}
  }

  function openPage() {
    ensurePageDom();
    const page = document.getElementById('notif-page');
    renderTimeline();
    try { history.pushState({ notifPage: true }, ''); } catch {}
    requestAnimationFrame(() => page.classList.add('open'));
    if (cachedItems[0] && cachedItems[0].at) {
      setLastRead(cachedItems[0].at);
      renderDot();
    }
  }
  function closePage(fromPopstate) {
    const page = document.getElementById('notif-page');
    if (page) page.classList.remove('open');
    if (!fromPopstate) {
      try {
        if (history.state && history.state.notifPage) history.back();
      } catch {}
    }
  }

  const api = {
    init({ password, mountBefore, baseUrl }) {
      injectStyles();
      currentPassword = password;
      if (baseUrl) currentBaseUrl = baseUrl;
      loadCache();
      ensureBellButton(mountBefore);
      ensurePageDom();
      renderDot();
      fetchNotifications();
      if (api._interval) clearInterval(api._interval);
      api._interval = setInterval(fetchNotifications, 45000);
      window.addEventListener('focus', fetchNotifications);
    },
    refresh: fetchNotifications,
    open: openPage,
    close: closePage,
    _interval: null,
  };
  window.EllemelNotif = api;
})();
