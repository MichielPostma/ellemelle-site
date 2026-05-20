// ELLEMELLE shared QR-scan FAB
// Mounts a camera overlay + Nieuwe-pot drawer on demand.
// Page must include <button id="fab-scan" class="fab fab-scan"> and an admin session in localStorage.

import QrScanner from 'https://esm.sh/qr-scanner@1.4.2';

(function () {
  'use strict';

  const STORAGE_KEY = 'ellemelle_admin_session_v1';
  let qrScanner = null;
  let overlayEl = null;
  let drawerEl = null;
  let backdropEl = null;
  let __pendingPotId = null;
  let __selectedNewStatus = 'available';

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
    try {
      await qrScanner.start();
    } catch {
      stopScan();
      toast('Camera niet beschikbaar', 'error');
    }
  }
  function stopScan() {
    if (qrScanner) { qrScanner.stop(); qrScanner.destroy(); qrScanner = null; }
    if (overlayEl) overlayEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const t = now + i * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    } catch {}
  }

  // --- After scan: dispatch ---
  async function handlePotScan(potId) {
    const res = await api('voorraad-list');
    if (!res.ok) { toast('Kon voorraad niet ophalen', 'error'); return; }
    const pot = (res.data.pots || []).find(p => p.id === potId);
    const status = pot && pot.status ? pot.status : 'uninitialized';
    if (status === 'uninitialized') {
      openNewPotDrawer(potId);
    } else {
      // Existing pot → nav to /voorraad with focus param
      const url = `/voorraad?pot=${encodeURIComponent(potId)}`;
      if (location.pathname === '/voorraad') {
        location.search = `?pot=${encodeURIComponent(potId)}`;
      } else {
        location.href = url;
      }
    }
  }

  // --- Nieuwe pot drawer ---
  function ensureDrawer() {
    if (drawerEl) return;
    backdropEl = document.createElement('div');
    backdropEl.id = 'new-pot-backdrop';
    backdropEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);opacity:0;pointer-events:none;transition:opacity 200ms;z-index:90;';

    drawerEl = document.createElement('div');
    drawerEl.id = 'new-pot-drawer';
    drawerEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#feece2;border-radius:20px 20px 0 0;padding:16px 20px 28px;transform:translateY(100%);transition:transform 220ms;z-index:100;max-height:80vh;overflow-y:auto;box-shadow:0 -10px 30px rgba(0,0,0,0.12);padding-bottom:max(28px,env(safe-area-inset-bottom));';
    drawerEl.innerHTML = `
      <div style="width:40px;height:4px;border-radius:2px;background:rgba(0,0,0,0.18);margin:0 auto 14px;"></div>
      <h2 id="new-pot-title" style="font-size:22px;font-weight:700;color:#D9301E;margin-bottom:8px;">Nieuwe pot —</h2>
      <div style="color:#666;font-size:14px;line-height:1.4;margin-bottom:18px;">Voeg deze pot toe aan je voorraad</div>
      <div id="new-pot-cards" style="display:grid;gap:10px;">
        <button class="np-card" data-status="available" type="button" style="display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;background:#fff;border-radius:14px;border:2px solid rgba(0,0,0,0.08);box-shadow:0 2px 10px rgba(139,26,14,0.08);cursor:pointer;text-align:left;font-family:inherit;-webkit-tap-highlight-color:transparent;">
          <img src="/Images/pot-leeg-label.png" style="width:64px;height:64px;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0;">
          <div style="min-width:0;flex:1;">
            <div style="color:#1A1A1A;font-size:17px;font-weight:700;margin-bottom:2px;">Leeg</div>
            <div style="color:#666;font-size:13px;line-height:1.35;">Pot is leeg, klaar om gevuld te worden</div>
          </div>
        </button>
        <button class="np-card" data-status="voorraad" type="button" style="display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;background:#fff;border-radius:14px;border:2px solid rgba(0,0,0,0.08);box-shadow:0 2px 10px rgba(139,26,14,0.08);cursor:pointer;text-align:left;font-family:inherit;-webkit-tap-highlight-color:transparent;">
          <img src="/Images/pot-bezorgd.png" style="width:64px;height:64px;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0;">
          <div style="min-width:0;flex:1;">
            <div style="color:#1A1A1A;font-size:17px;font-weight:700;margin-bottom:2px;">Gevuld</div>
            <div style="color:#666;font-size:13px;line-height:1.35;">Pot is gevuld en klaar voor bezorging</div>
          </div>
        </button>
      </div>
      <div id="new-pot-date-field" hidden style="margin-top:14px;">
        <div style="color:#666;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Productiedatum</div>
        <input type="date" id="new-pot-date-input" style="width:100%;min-height:56px;padding:16px 18px;font-size:16px;font-family:inherit;font-weight:400;background:#fff;border:2px solid transparent;border-radius:14px;box-shadow:0 2px 10px rgba(139,26,14,0.08);color:#1A1A1A;appearance:none;-webkit-appearance:none;text-align:left;line-height:52px;height:56px;box-sizing:border-box;">
      </div>
      <div id="new-pot-err" style="color:#D9301E;font-size:14px;font-weight:600;margin-top:10px;display:none;"></div>
      <button id="new-pot-save" class="btn-primary" type="button" style="display:block;width:100%;min-height:60px;text-align:center;line-height:60px;background:#D9301E;color:white;border:none;border-radius:14px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:0.2px;cursor:pointer;margin-top:16px;">Voeg toe aan voorraad →</button>
    `;

    document.body.appendChild(backdropEl);
    document.body.appendChild(drawerEl);
    backdropEl.addEventListener('click', closeNewPotDrawer);
    document.getElementById('new-pot-save').addEventListener('click', saveNewPot);
    drawerEl.querySelectorAll('.np-card').forEach(c => {
      c.addEventListener('click', () => selectNewPotCard(c.dataset.status));
    });
  }

  function selectNewPotCard(target) {
    __selectedNewStatus = target;
    drawerEl.querySelectorAll('.np-card').forEach(c => {
      const sel = c.dataset.status === target;
      c.style.borderColor = sel ? '#D9301E' : 'rgba(0,0,0,0.08)';
    });
    document.getElementById('new-pot-date-field').hidden = target !== 'voorraad';
  }
  function openNewPotDrawer(potId) {
    __pendingPotId = potId;
    ensureDrawer();
    document.getElementById('new-pot-title').textContent = `Nieuwe pot ${potId}`;
    document.getElementById('new-pot-date-input').value = todayISO();
    document.getElementById('new-pot-err').style.display = 'none';
    selectNewPotCard('available');
    backdropEl.style.opacity = '1';
    backdropEl.style.pointerEvents = 'auto';
    drawerEl.style.transform = 'translateY(0)';
  }
  function closeNewPotDrawer() {
    backdropEl.style.opacity = '0';
    backdropEl.style.pointerEvents = 'none';
    drawerEl.style.transform = 'translateY(100%)';
  }
  async function saveNewPot() {
    if (!__pendingPotId) return;
    const body = { pot_id: __pendingPotId, status: __selectedNewStatus };
    if (__selectedNewStatus === 'voorraad') {
      body.production_date = document.getElementById('new-pot-date-input').value || todayISO();
    }
    const res = await api('voorraad-set-pot', body);
    if (!res.ok) {
      const err = document.getElementById('new-pot-err');
      err.textContent = res.data.error || 'Toevoegen mislukt';
      err.style.display = 'block';
      return;
    }
    toast(`${__pendingPotId} toegevoegd`, 'success');
    closeNewPotDrawer();
  }

  // --- Bindings ---
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('fab-scan');
    if (btn) btn.addEventListener('click', startScan);
  });
})();
