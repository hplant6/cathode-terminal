const { Z } = require('./ui-constants');
const path = require('path');
const { MARCH_BORDER_CSS, MARCH_KEYFRAMES_JS, ACCENT, ACCENT_RGB } = require('./inject-styles');
const { iconText } = require('./read-icon');

// Build the camera cursor data URL once at require time
const cameraSVG = iconText(path.join(__dirname, 'icons', 'camera.svg'))
  .replace(/height="18"/, 'height="24"')
  .replace(/width="18"/, 'width="24"');
const CURSOR_B64 = Buffer.from(cameraSVG).toString('base64');
const CURSOR_URL = `url("data:image/svg+xml;base64,${CURSOR_B64}") 9 9, crosshair`;

function getScreenshotScript() {
  return `(function() {
  ${MARCH_KEYFRAMES_JS}
  const existing = document.getElementById('__cathode_shot__');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    let resolved = false;
    function done(result) {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(result);
    }

    // Full-viewport capture overlay
    const overlay = document.createElement('div');
    overlay.id = '__cathode_shot__';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:${Z.OVERLAY_TOP}',
      'cursor:${CURSOR_URL}',
    ].join(';');
    document.documentElement.appendChild(overlay);

    // Selection rect — box-shadow creates the dim surround, the rect itself stays clear
    const sel = document.createElement('div');
    sel.style.cssText = [
      'position:fixed', 'pointer-events:none',
      'display:none', 'box-sizing:border-box',
      '${MARCH_BORDER_CSS}',
    ].join(';');
    overlay.appendChild(sel);

    const lbl = document.createElement('div');
    lbl.style.cssText = [
      'position:fixed', 'pointer-events:none',
      'background:${ACCENT}', 'color:#fff',
      'font:700 10px/16px monospace', 'padding:1px 6px',
      'border-radius:0 0 3px 3px', 'display:none',
    ].join(';');
    overlay.appendChild(lbl);

    let drawing = false, startX = 0, startY = 0;

    // Keep a drag inside the viewport. The pointer can leave the overlay entirely — the
    // window's own resize border owns the outermost pixels, and the view is inset from
    // the window edge — so clamp rather than let a stray coordinate poison the rect.
    const clampX = (v) => Math.max(0, Math.min(window.innerWidth,  v));
    const clampY = (v) => Math.max(0, Math.min(window.innerHeight, v));
    const rectOf = (e) => {
      const cx = clampX(e.clientX), cy = clampY(e.clientY);
      return { x: Math.min(startX, cx), y: Math.min(startY, cy),
               w: Math.abs(cx - startX), h: Math.abs(cy - startY) };
    };

    // Pointer events with capture, not mouse events on the overlay. Bound to the overlay,
    // a drag that wandered off it never delivered its mouseup: the drag stayed open and
    // the capture was silently stranded. That reads as a dead band around the edges, and
    // worst at the corners, where you can leave the overlay in both axes at once.
    // setPointerCapture routes move/up back here wherever the pointer actually goes.
    overlay.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { overlay.setPointerCapture(e.pointerId); } catch (_) {}
      drawing = true;
      startX = clampX(e.clientX); startY = clampY(e.clientY);
      sel.style.left = startX + 'px'; sel.style.top = startY + 'px';
      sel.style.width = '0'; sel.style.height = '0';
      sel.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.48)';
      sel.style.display = 'block';
    });

    overlay.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r = rectOf(e);
      sel.style.left = r.x + 'px'; sel.style.top = r.y + 'px';
      sel.style.width = r.w + 'px'; sel.style.height = r.h + 'px';
      lbl.textContent = r.w + ' × ' + r.h;
      lbl.style.left = r.x + 'px';
      lbl.style.top  = (r.y - 18) + 'px';
      lbl.style.display = 'block';
    });

    function finish(e) {
      if (!drawing) return;
      drawing = false;
      try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
      const r = rectOf(e);
      // 3px, not 10. The old floor quietly refused anything thin — a divider, a single
      // line of text, a narrow icon strip — and refused it by cancelling, so the tool
      // looked broken rather than fussy. This only needs to tell a drag from a click.
      if (r.w < 3 || r.h < 3) { done(null); return; }
      done({ x: r.x, y: r.y, width: r.w, height: r.h, mouseUpX: clampX(e.clientX), mouseUpY: clampY(e.clientY) });
    }
    overlay.addEventListener('pointerup', finish);
    // The capture can be broken out from under us (a system gesture, the window losing
    // focus). Settle with what was drawn instead of leaving the drag half-open forever.
    overlay.addEventListener('pointercancel', finish);

    function onEsc(e) { if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onEsc, true);
  });
})()`;
}

module.exports = { getScreenshotScript };
