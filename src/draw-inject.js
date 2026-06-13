'use strict';

const fs   = require('fs');
const path = require('path');

const MARKER_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'icons', 'marker-cursor.svg'), 'utf8')).toString('base64');
const MARKER_CURSOR = `url("data:image/svg+xml;base64,${MARKER_B64}") 2 16, crosshair`;

function getDrawScript() {
  const LABEL = 'font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#555;margin-bottom:6px;';

  return `(function() {
    if (document.getElementById('__cathode_draw_canvas__')) return Promise.resolve(null);

    var color = '#ff3b30';
    var lineWidth = 4;
    var drawing = false;
    var lastX = 0, lastY = 0;

    // ── Canvas ──────────────────────────────────────────────────────
    var canvas = document.createElement('canvas');
    canvas.id = '__cathode_draw_canvas__';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── Draw overlay ─────────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.id = '__cathode_draw_overlay__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;cursor:${MARKER_CURSOR}';
    document.body.appendChild(overlay);

    function drawDot(x, y) {
      ctx.beginPath();
      ctx.arc(x, y, lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    overlay.addEventListener('mousedown', function(e) {
      drawing = true; lastX = e.clientX; lastY = e.clientY;
      drawDot(lastX, lastY);
    });
    document.addEventListener('mousemove', function(e) {
      if (!drawing) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(e.clientX, e.clientY);
      ctx.stroke();
      lastX = e.clientX; lastY = e.clientY;
    });
    document.addEventListener('mouseup', function() { drawing = false; });

    // ── Inject styles ─────────────────────────────────────────────────
    var styleEl = document.createElement('style');
    styleEl.textContent =
      '#__cdraw_size_slider__{-webkit-appearance:none;width:100%;height:4px;border-radius:2px;outline:none;cursor:pointer;}' +
      '#__cdraw_size_slider__::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.5);}' +
      '#__cdraw_color_swatch__:hover{border-color:rgba(255,255,255,0.4)!important;}';
    document.head.appendChild(styleEl);

    // ── Floating toolbar ─────────────────────────────────────────────
    var toolbar = document.createElement('div');
    toolbar.id = '__cathode_draw_toolbar__';
    toolbar.style.cssText = [
      'position:fixed;top:80px;right:20px;',
      'z-index:2147483647;',
      'background:#1b1b22;border:1px solid #383848;',
      'border-radius:12px;padding:14px 16px;',
      'display:flex;flex-direction:column;gap:12px;',
      'width:230px;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.65);',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'font-size:11px;color:#bbb;user-select:none;',
    ].join('');

    toolbar.innerHTML = \`
      <div id="__cdraw_header__" style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid #383848;cursor:move;">
        <span style="font-size:12px;font-weight:600;color:#fff;letter-spacing:0.02em;">Marker Annotations</span>
        <button id="__cdraw_close__" style="background:transparent;border:none;color:#666;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;">✕</button>
      </div>

      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div style="flex:0 0 auto;display:flex;flex-direction:column;">
          <div style="${LABEL}">Color</div>
          <div id="__cdraw_color_swatch__" style="width:36px;height:36px;border-radius:8px;background:#ff3b30;cursor:pointer;border:2px solid rgba(255,255,255,0.15);box-sizing:border-box;transition:border-color 0.1s;"></div>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
          <div style="${LABEL}">Brush Size</div>
          <div style="height:36px;display:flex;align-items:center;">
            <input type="range" id="__cdraw_size_slider__" min="1" max="20" value="4" style="width:100%;" />
          </div>
        </div>
      </div>

      <div id="__cdraw_iro_wrap__" style="display:none;justify-content:center;">
        <div id="__cdraw_iro_mount__"></div>
      </div>

      <div>
        <div style="${LABEL}">Instructions</div>
        <textarea id="__cdraw_instructions__" placeholder="Describe the change..." style="width:100%;height:48px;min-height:48px;box-sizing:border-box;background:#111117;border:1px solid #383848;border-radius:8px;padding:8px 10px;color:#fff;font-size:12px;font-family:inherit;resize:vertical;outline:none;line-height:1.45;overflow-y:auto;"></textarea>
      </div>

      <button id="__cdraw_send__" style="width:100%;height:32px;background:#1a6cf5;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;box-sizing:border-box;">Send</button>
    \`;
    document.body.appendChild(toolbar);

    // ── Toolbar blocks drawing while hovered ─────────────────────────
    toolbar.addEventListener('mouseenter', function() { overlay.style.pointerEvents = 'none'; });
    toolbar.addEventListener('mouseleave', function() { overlay.style.pointerEvents = ''; });

    // ── Drag ─────────────────────────────────────────────────────────
    var dragging = false, dOffX = 0, dOffY = 0;
    document.getElementById('__cdraw_header__').addEventListener('mousedown', function(e) {
      if (e.target.id === '__cdraw_close__') return;
      dragging = true;
      var r = toolbar.getBoundingClientRect();
      dOffX = e.clientX - r.left; dOffY = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      toolbar.style.right = 'auto';
      toolbar.style.left  = (e.clientX - dOffX) + 'px';
      toolbar.style.top   = (e.clientY - dOffY) + 'px';
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    // ── Color swatch → iro circular picker ───────────────────────────
    var swatchEl = document.getElementById('__cdraw_color_swatch__');
    var iroWrap  = document.getElementById('__cdraw_iro_wrap__');
    var iroInst  = null;

    function loadIro(cb) {
      if (window.iro) { cb(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5/dist/iro.min.js';
      s.onload = cb;
      document.head.appendChild(s);
    }

    swatchEl.addEventListener('click', function() {
      var isOpen = iroWrap.style.display !== 'none';
      if (isOpen) { iroWrap.style.display = 'none'; return; }
      iroWrap.style.display = 'flex';
      if (iroInst) return;
      loadIro(function() {
        try {
          iroInst = new iro.ColorPicker('#__cdraw_iro_mount__', {
            width: 190,
            color: color,
            layout: [{ component: iro.ui.Wheel }]
          });
          iroInst.on('color:change', function(c) {
            color = c.hexString;
            swatchEl.style.background = color;
          });
        } catch(e) {}
      });
    });

    // ── Brush size slider ─────────────────────────────────────────────
    var slider = document.getElementById('__cdraw_size_slider__');
    function updateSlider() {
      var pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.background = 'linear-gradient(to right,#007aff 0%,#007aff ' + pct + '%,#383848 ' + pct + '%,#383848 100%)';
      lineWidth = parseInt(slider.value);
    }
    slider.addEventListener('input', updateSlider);
    updateSlider();

    // ── Prevent textarea Enter from bubbling ──────────────────────────
    document.getElementById('__cdraw_instructions__').addEventListener('keydown', function(e) {
      e.stopPropagation();
    });

    // ── Send / Close ──────────────────────────────────────────────────
    return new Promise(function(resolve) {
      function cleanup() {
        canvas.remove();
        overlay.remove();
        toolbar.remove();
        styleEl.remove();
        document.removeEventListener('keydown', onKey);
      }

      document.getElementById('__cdraw_send__').addEventListener('click', function() {
        var dataUrl = canvas.toDataURL('image/png');
        var instr   = document.getElementById('__cdraw_instructions__').value.trim();
        cleanup();
        resolve({ canvasDataUrl: dataUrl, instructions: instr });
      });

      document.getElementById('__cdraw_close__').addEventListener('click', function() {
        cleanup(); resolve(null);
      });

      function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(null); } }
      document.addEventListener('keydown', onKey);
    });
  })()`;
}

module.exports = { getDrawScript };
