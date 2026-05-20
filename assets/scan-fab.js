// ELLEMELLE shared QR-scan FAB
// Single drawer handles all pot statuses inline on current page (no navigation).

import QrScanner from 'https://esm.sh/qr-scanner@1.4.2';

(function () {
  'use strict';

  const STORAGE_KEY = 'ellemelle_admin_session_v1';
  let qrScanner = null;
  let overlayEl = null;
  let drawerRoot = null;
  let __currentPot = null;
  let __selectedStatus = 'available';

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
    const MONTHS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
    const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
    return `${d} ${MONTHS[m-1]} ${y}`;
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
    if (n < 0) return { text: 'verlopen', expired: true };
    if (n === 0) return { text: 'vandaag laatste dag', expired: false };
    if (n === 1) return { text: 'nog 1 dag houdbaar', expired: false };
    return { text: `nog ${n} dagen houdbaar`, expired: false };
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
    window.__sfbT = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
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
  function describe(status) {
    return ({
      uninitialized: 'Niet geseed', available: 'Leeg', voorraad: 'Gevuld',
      delivered: 'Bezorgd', returned: 'Retour',
    }[status]) || status;
  }
  function statusSentence(pot) {
    const s = pot.status || 'uninitialized';
    if (s === 'voorraad') {
      const exp = pot.expiry_date ? expiryText(pot.expiry_date) : null;
      const date = pot.production_date ? fmtDateNL(pot.production_date) : null;
      if (date && exp) {
        if (exp.expired) return `Deze pot is gevuld op ${date} en is verlopen.`;
        if (exp.text === 'vandaag laatste dag') return `Deze pot is gevuld op ${date} — vandaag is de laatste dag.`;
        return `Deze pot is gevuld op ${date} en ${exp.text}.`;
      }
      if (date) return `Deze pot is gevuld op ${date}.`;
      return 'Deze pot is gevuld.';
    }
    if (s === 'delivered') return 'Deze pot is bezorgd bij een klant.';
    if (s === 'returned')  return 'Deze pot is teruggegeven en wacht op verwerking.';
    return 'Deze pot is leeg en klaar om gevuld te worden.';
  }

  // --- Camera overlay ---
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
    const res = await api('voorraad-list');
    if (!res.ok) { toast('Kon voorraad niet ophalen', 'error'); return; }
    const pot = (res.data.pots || []).find(p => p.id === potId) || { id: potId, status: 'uninitialized' };
    openDrawer(pot);
  }

  // --- Unified pot drawer ---
  function ensureDrawer() {
    if (drawerRoot) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'sfb-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);opacity:0;pointer-events:none;transition:opacity 200ms;z-index:90;';
    const drawer = document.createElement('div');
    drawer.id = 'sfb-drawer';
    drawer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#feece2;border-radius:20px 20px 0 0;padding:16px 20px 28px;transform:translateY(100%);transition:transform 220ms;z-index:100;max-height:85vh;overflow-y:auto;box-shadow:0 -10px 30px rgba(0,0,0,0.12);padding-bottom:max(28px,env(safe-area-inset-bottom));';
    drawer.innerHTML = `
      <div style="width:40px;height:4px;border-radius:2px;background:rgba(0,0,0,0.18);margin:0 auto 14px;"></div>
      <h2 id="sfb-pid" style="font-size:24px;font-weight:700;color:#D9301E;margin-bottom:6px;">POT-XXX</h2>
      <div id="sfb-sub" style="color:#666;font-size:14px;line-height:1.4;margin-bottom:18px;">—</div>
      <div id="sfb-cards" style="display:none;gap:10px;"></div>
      <div id="sfb-prod-date" hidden style="margin-top:14px;">
        <div style="color:#666;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Productiedatum</div>
        <input type="date" id="sfb-date" style="width:100%;min-height:56px;padding:0 18px;font-size:16px;font-family:inherit;font-weight:400;background:#fff;border:2px solid transparent;border-radius:14px;box-shadow:0 2px 10px rgba(139,26,14,0.08);color:#1A1A1A;appearance:none;-webkit-appearance:none;text-align:left;line-height:52px;height:56px;box-sizing:border-box;">
      </div>
      <a id="sfb-bestelling" href="#" target="_blank" rel="noopener" hidden style="display:block;width:100%;min-height:56px;background:transparent;color:#D9301E;border:2px solid #D9301E;border-radius:14px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:0.2px;cursor:pointer;text-align:center;line-height:52px;text-decoration:none;margin-top:14px;-webkit-tap-highlight-color:transparent;">Bekijk bestelling</a>
      <div id="sfb-banner" hidden style="margin-top:12px;padding:12px 14px;background:rgba(0,0,0,0.04);border-radius:14px;color:#555;font-size:13px;line-height:1.45;">Status wordt automatisch beheerd via de bezorger-flow.</div>
      <div id="sfb-err" style="color:#D9301E;font-size:14px;font-weight:600;margin-top:10px;display:none;"></div>
      <button id="sfb-save" type="button" hidden style="display:block;width:100%;min-height:60px;line-height:60px;text-align:center;background:#D9301E;color:white;border:none;border-radius:14px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:0.2px;cursor:pointer;margin-top:16px;">Bewaar →</button>
      <button id="sfb-delete" type="button" hidden style="display:block;width:100%;min-height:56px;line-height:52px;text-align:center;background:transparent;color:#D9301E;border:2px solid #D9301E;border-radius:14px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:0.2px;cursor:pointer;margin-top:24px;-webkit-tap-highlight-color:transparent;">Verwijder pot</button>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    drawerRoot = { backdrop, drawer };
    backdrop.addEventListener('click', closeDrawer);
    document.getElementById('sfb-save').addEventListener('click', saveStatus);
    document.getElementById('sfb-delete').addEventListener('click', deletePot);
  }

  function renderStatusCards(selected) {
    const wrap = document.getElementById('sfb-cards');
    wrap.style.display = 'grid';
    const cardStyle = 'display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;background:#fff;border-radius:14px;border:2px solid rgba(0,0,0,0.08);box-shadow:0 2px 10px rgba(139,26,14,0.08);cursor:pointer;text-align:left;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:border-color 120ms;';
    const sel = (s) => s === selected ? 'border-color:#D9301E;' : '';
    wrap.innerHTML = `
      <button class="sfb-card" data-status="available" type="button" style="${cardStyle}${sel('available')}">
        <img src="/Images/pot-leeg-label.png" style="width:64px;height:64px;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0;">
        <div style="min-width:0;flex:1;">
          <div style="color:#1A1A1A;font-size:17px;font-weight:700;margin-bottom:2px;">Leeg</div>
          <div style="color:#666;font-size:13px;line-height:1.35;">Pot is leeg en klaar om gevuld te worden</div>
        </div>
      </button>
      <button class="sfb-card" data-status="voorraad" type="button" style="${cardStyle}${sel('voorraad')}">
        <img src="/Images/pot-bezorgd.png" style="width:64px;height:64px;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0;">
        <div style="min-width:0;flex:1;">
          <div style="color:#1A1A1A;font-size:17px;font-weight:700;margin-bottom:2px;">Gevuld</div>
          <div style="color:#666;font-size:13px;line-height:1.35;">Pot is gevuld en klaar voor bezorging</div>
        </div>
      </button>
    `;
    wrap.querySelectorAll('.sfb-card').forEach(c => {
      c.addEventListener('click', () => selectCard(c.dataset.status));
    });
  }
  function selectCard(target) {
    __selectedStatus = target;
    document.querySelectorAll('#sfb-cards .sfb-card').forEach(c => {
      c.style.borderColor = c.dataset.status === target ? '#D9301E' : 'rgba(0,0,0,0.08)';
    });
    document.getElementById('sfb-prod-date').hidden = target !== 'voorraad';
  }

  function openDrawer(pot) {
    ensureDrawer();
    __currentPot = pot;
    const status = pot.status || 'uninitialized';
    document.getElementById('sfb-pid').textContent = pot.id;
    document.getElementById('sfb-sub').textContent = statusSentence(pot);
    document.getElementById('sfb-err').style.display = 'none';
    const cardsEl = document.getElementById('sfb-cards');
    const saveEl  = document.getElementById('sfb-save');
    const dateEl  = document.getElementById('sfb-prod-date');
    const dateIn  = document.getElementById('sfb-date');
    const linkEl  = document.getElementById('sfb-bestelling');
    const bannerEl= document.getElementById('sfb-banner');
    const delEl   = document.getElementById('sfb-delete');

    if (status === 'delivered' || status === 'returned') {
      // Read-only banner + customer + Bekijk bestelling
      cardsEl.style.display = 'none';
      saveEl.hidden = true;
      dateEl.hidden = true;
      delEl.hidden = true; // can't delete delivered/returned
      const c = pot.customer || {};
      const name = c.voornaam || 'klant';
      const addr = c.adres || '';
      const verb = status === 'returned' ? 'teruggegeven door' : 'bezorgd aan';
      const prep = status === 'returned' ? 'van' : 'op';
      let sentence = '';
      if (pot.order_id) {
        sentence = `Deze pot is ${verb} ${name}${addr ? ` ${prep} ${addr}` : ''}. `;
        linkEl.href = '/bestelling/' + pot.order_id;
        linkEl.hidden = false;
      } else {
        linkEl.hidden = true;
      }
      bannerEl.textContent = sentence + 'Status wordt automatisch beheerd via de bezorger-flow.';
      bannerEl.hidden = false;
      // Allow delete of returned only (delivered = locked)
      if (status === 'returned') delEl.hidden = false;
    } else {
      // available / voorraad / uninitialized → status-card picker
      linkEl.hidden = true;
      bannerEl.hidden = true;
      // Pre-select: voorraad → 'voorraad', else 'available'
      const pre = status === 'voorraad' ? 'voorraad' : 'available';
      renderStatusCards(pre);
      __selectedStatus = pre;
      dateIn.value = pot.production_date || todayISO();
      dateEl.hidden = pre !== 'voorraad';
      saveEl.hidden = false;
      saveEl.textContent = status === 'uninitialized' ? 'Voeg toe aan voorraad →' : 'Bewaar →';
      delEl.hidden = false;
    }

    drawerRoot.backdrop.style.opacity = '1';
    drawerRoot.backdrop.style.pointerEvents = 'auto';
    drawerRoot.drawer.style.transform = 'translateY(0)';
  }
  function closeDrawer() {
    if (!drawerRoot) return;
    drawerRoot.backdrop.style.opacity = '0';
    drawerRoot.backdrop.style.pointerEvents = 'none';
    drawerRoot.drawer.style.transform = 'translateY(100%)';
    __currentPot = null;
  }
  async function saveStatus() {
    if (!__currentPot) return;
    const target = __selectedStatus;
    const current = __currentPot.status || 'uninitialized';
    // For uninitialized: any choice creates the pot. For others: only save when changed.
    if (current !== 'uninitialized' && current === target) {
      toast('Geen wijziging');
      return;
    }
    const body = { pot_id: __currentPot.id, status: target };
    if (target === 'voorraad') {
      body.production_date = document.getElementById('sfb-date').value || todayISO();
    }
    const res = await api('voorraad-set-pot', body);
    if (!res.ok) {
      const err = document.getElementById('sfb-err');
      err.textContent = res.data.error || 'Opslaan mislukt';
      err.style.display = 'block';
      return;
    }
    toast(`${__currentPot.id} → ${describe(target)}`, 'success');
    closeDrawer();
    // Refresh current page if we touched its data
    softRefreshPage();
  }
  async function deletePot() {
    if (!__currentPot) return;
    const pid = __currentPot.id;
    if (!confirm('Weet je het zeker? Dit kan niet ongedaan gemaakt worden.')) return;
    const res = await api('voorraad-delete-pot', { pot_id: pid });
    if (!res.ok) {
      const err = document.getElementById('sfb-err');
      err.textContent = res.data.error || 'Verwijderen mislukt';
      err.style.display = 'block';
      return;
    }
    toast(`${pid} verwijderd`, 'success');
    closeDrawer();
    softRefreshPage();
  }

  // Best-effort refresh: re-trigger the page's own data load if available.
  function softRefreshPage() {
    // Voorraad page exposes refresh() via its IIFE — we can't call it directly.
    // Easiest: clear sessionStorage cache (used by the page-level api wrapper) so next interaction re-fetches.
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('cache_voorraad-list') || k.startsWith('cache_bezorger-orders') || k.startsWith('cache_bestellingen-list'))) {
          keys.push(k);
        }
      }
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch {}
    // On /voorraad specifically, hard reload to re-render grid
    if (location.pathname === '/voorraad') {
      // Soft reload (no query bump) so user lands in same place
      location.reload();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('fab-scan');
    if (btn) btn.addEventListener('click', startScan);
  });

  // Expose for debugging/testing
  window.__sfb = { openDrawer, handlePotScan };
})();
