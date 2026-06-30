'use strict';

const fs   = require('fs');
const { Z } = require('./ui-constants');
const path = require('path');
const { iconB64 } = require('./read-icon');

const MARKER_B64 = iconB64(path.join(__dirname, 'icons', 'marker-cursor.svg'));
const MARKER_CURSOR = `url("data:image/svg+xml;base64,${MARKER_B64}") 2 16, crosshair`;

// Sets up a persistent marker layer (canvas + draw overlay) and exposes
// window.__cathodeMarker for the in-app panel to drive (color / size / clear /
// composite / teardown). The brush controls live in the left-column panel now,
// so there's no on-page toolbar.
function getDrawScript() {
  return `(function() {
    if (window.__cathodeMarker) return true;

    var color = '#ff3b30', lineWidth = 4, drawing = false, lastX = 0, lastY = 0;

    var canvas = document.createElement('canvas');
    canvas.id = '__cathode_draw_canvas__';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:${Z.OVERLAY_MID};pointer-events:none;';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    var overlay = document.createElement('div');
    overlay.id = '__cathode_draw_overlay__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${MARKER_CURSOR}';
    document.body.appendChild(overlay);

    function drawDot(x, y) { ctx.beginPath(); ctx.arc(x, y, lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    function onDown(e) { drawing = true; lastX = e.clientX; lastY = e.clientY; drawDot(lastX, lastY); }
    function onMove(e) {
      if (!drawing) return;
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(e.clientX, e.clientY); ctx.stroke();
      lastX = e.clientX; lastY = e.clientY;
    }
    function onUp() { drawing = false; }
    overlay.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    window.__cathodeMarker = {
      setColor: function(c) { if (c) color = c; },
      setSize:  function(n) { lineWidth = Math.max(1, +n || 1); },
      clear:    function() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
      composite: function() { return canvas.toDataURL('image/png'); },
      teardown: function() {
        canvas.remove(); overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.__cathodeMarker = null;
      },
    };
    return true;
  })()`;
}

module.exports = { getDrawScript };
