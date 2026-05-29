// ELLEMELLE shared pull-to-refresh — touch-only, mobile-first.
// Drop into any admin page after <body>. The script self-attaches once.
//
// Behaviour:
//   - User pulls down from the top of the page (scrollTop === 0).
//   - A red ELLEMELLE spinner slides in from the top, growing with pull distance.
//   - Past the threshold (~64px), the indicator commits and the page reloads on release.
//   - Under the threshold, indicator springs back, no action.
//
// Embed mode (iframes) is opt-out — pulls in the embedded admin order drawer would feel weird.

(function(){
  if (window.__ellemellePullToRefresh) return;
  window.__ellemellePullToRefresh = true;

  // Skip in iframes / admin embed contexts.
  try { if (window.top !== window) return; } catch { /* cross-origin: assume embed, skip */ return; }
  if (document.documentElement.classList.contains('embed-mode') ||
      document.body && document.body.classList.contains('on-embed')) return;

  const THRESHOLD = 64;   // px — commit point
  const MAX_PULL  = 120;  // px — visual cap on indicator
  const RESIST    = 0.55; // pulled distance is scaled down so it feels like rubber

  // Indicator markup + styling.
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = [
    'position: fixed', 'top: 0', 'left: 0', 'right: 0',
    'display: flex', 'align-items: center', 'justify-content: center',
    'height: 0px', 'pointer-events: none',
    'z-index: 999', 'overflow: hidden',
    'transition: height 220ms cubic-bezier(.2,.7,.2,1)',
  ].join(';');

  const inner = document.createElement('div');
  inner.style.cssText = [
    'width: 36px', 'height: 36px', 'border-radius: 50%',
    'background: #ffffff',
    'box-shadow: 0 2px 10px rgba(0,0,0,0.12)',
    'display: flex', 'align-items: center', 'justify-content: center',
    'opacity: 0',
    'transition: opacity 160ms, transform 160ms',
  ].join(';');
  inner.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="#D9301E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="1 4 1 10 7 10"></polyline>' +
    '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>' +
    '</svg>';
  wrap.appendChild(inner);

  // Inject once the body is ready.
  function attachIndicator() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', attachIndicator); return; }
    document.body.appendChild(wrap);
  }
  attachIndicator();

  let startY = 0;
  let pulling = false;
  let committed = false;

  function setHeight(px) {
    wrap.style.transition = 'none';
    wrap.style.height = px + 'px';
    const ratio = Math.min(1, px / THRESHOLD);
    inner.style.opacity = String(0.4 + 0.6 * ratio);
    inner.style.transform = `rotate(${ratio * 270}deg)`;
  }
  function springBack() {
    wrap.style.transition = 'height 220ms cubic-bezier(.2,.7,.2,1)';
    wrap.style.height = '0px';
    inner.style.opacity = '0';
    inner.style.transform = 'rotate(0deg)';
  }
  function commitAndReload() {
    wrap.style.transition = 'height 160ms ease-out';
    wrap.style.height = '52px';
    inner.style.opacity = '1';
    // Spin the icon while the page reloads.
    inner.style.animation = 'ellemelle-ptr-spin 0.7s linear infinite';
    if (!document.getElementById('ellemelle-ptr-style')) {
      const st = document.createElement('style');
      st.id = 'ellemelle-ptr-style';
      st.textContent = '@keyframes ellemelle-ptr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    setTimeout(() => location.reload(), 120);
  }

  function onTouchStart(e) {
    if (committed) return;
    // Only when the page is scrolled to the very top.
    const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    if (scrollTop > 0) { pulling = false; return; }
    if (!e.touches || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }
  function onTouchMove(e) {
    if (!pulling || committed) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { setHeight(0); return; }
    // Only intercept if pulling clearly downward.
    if (dy < 8) return;
    const pulled = Math.min(MAX_PULL, dy * RESIST);
    setHeight(pulled);
    // Block native scroll so the gesture feels owned by us.
    if (e.cancelable) e.preventDefault();
  }
  function onTouchEnd() {
    if (!pulling) return;
    pulling = false;
    const h = parseFloat(wrap.style.height || '0');
    if (h >= THRESHOLD && !committed) {
      committed = true;
      commitAndReload();
    } else {
      springBack();
    }
  }

  // Use non-passive to allow preventDefault on the move events.
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove',  onTouchMove,  { passive: false });
  window.addEventListener('touchend',   onTouchEnd,   { passive: true });
  window.addEventListener('touchcancel', onTouchEnd,  { passive: true });
})();
