const fs = require('fs');
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

    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      drawing = true;
      startX = e.clientX; startY = e.clientY;
      sel.style.left = startX + 'px'; sel.style.top = startY + 'px';
      sel.style.width = '0'; sel.style.height = '0';
      sel.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.48)';
      sel.style.display = 'block';
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      sel.style.left = x + 'px'; sel.style.top = y + 'px';
      sel.style.width = w + 'px'; sel.style.height = h + 'px';
      lbl.textContent = w + ' × ' + h;
      lbl.style.left = x + 'px';
      lbl.style.top  = (y - 18) + 'px';
      lbl.style.display = 'block';
    });

    overlay.addEventListener('mouseup', (e) => {
      if (!drawing) return;
      drawing = false;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      if (w < 10 || h < 10) { done(null); return; }
      done({ x, y, width: w, height: h, mouseUpX: e.clientX, mouseUpY: e.clientY });
    });

    function onEsc(e) { if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onEsc, true);
  });
})()`;
}

module.exports = { getScreenshotScript };
