const { Z } = require('./ui-constants');
const path   = require('path');
const { MARCH_OUTLINE_CSS, MARCH_KEYFRAMES_JS, ACCENT, ACCENT_RGB } = require('./inject-styles');
const SHARED = require('./inject-shared');
const { iconB64 } = require('./read-icon');

const RESIZE_B64 = iconB64(path.join(__dirname, 'icons', 'resize-cursor.svg'));
const RESIZE_CURSOR = `url("data:image/svg+xml;base64,${RESIZE_B64}") 16 16, move`;

// Panel mode: the user hovers + clicks an element, then drags the on-page
// handles to resize it live. Instead of an in-page toolbar, the instructions /
// dimensions / Send-Cancel live in the left column. The script resolves as soon
// as an element is selected (handles stay alive); window.__cathodeResize then
// drives live dims, reset, the final result, and teardown.
function getResizeScript() {
  return `(function() {
  ${MARCH_KEYFRAMES_JS}
  ['__cr_ov','__cr_hv','__cr_hr'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
  if (window.__cathodeResize) { try { window.__cathodeResize.clear(); } catch(e){} }

  return new Promise(function(resolve) {
    var phase = 'hover';
    var selEl = null;
    var origRect = null;
    var origW = '', origH = '';
    var activeHandle = null;
    var drag = null;
    var rafId = null;
    var resolved = false;

    function resolveOnce(val) { if (resolved) return; resolved = true; resolve(val); }
    function teardown() {
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      ['__cr_ov','__cr_hv','__cr_hr'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      window.__cathodeResize = null;
    }

    // ── Hover overlay ─────────────────────────────────────────────────
    var ov = document.createElement('div');
    ov.id = '__cr_ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${RESIZE_CURSOR}';
    (document.body || document.documentElement).appendChild(ov);

    var hv = document.createElement('div');
    hv.id = '__cr_hv';
    hv.style.cssText = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_MID};box-sizing:border-box;display:none;' +
      'transition:left 40ms,top 40ms,width 40ms,height 40ms;${MARCH_OUTLINE_CSS}';
    (document.body || document.documentElement).appendChild(hv);

    var lastHover = null;
    ov.addEventListener('mousemove', function(e) {
      ov.style.pointerEvents = 'none';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      ov.style.pointerEvents = '';
      if (!el || el === document.body || el === document.documentElement) { hv.style.display = 'none'; lastHover = null; return; }
      if (el === lastHover) return;
      lastHover = el;
      var r = el.getBoundingClientRect();
      hv.style.display = '';
      hv.style.left   = r.left   + 'px';
      hv.style.top    = r.top    + 'px';
      hv.style.width  = r.width  + 'px';
      hv.style.height = r.height + 'px';
    });
    ov.addEventListener('mouseleave', function() { hv.style.display = 'none'; lastHover = null; });

    ov.addEventListener('click', function(e) {
      if (phase !== 'hover') return;
      e.preventDefault(); e.stopPropagation();
      ov.style.pointerEvents = 'none';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      ov.style.pointerEvents = '';
      if (!el || el === document.body || el === document.documentElement) return;
      selectEl(el);
    });

    // ── Keyboard ──────────────────────────────────────────────────────
    function onKey(e) {
      if (e.key === 'Escape' && phase === 'hover') { resolveOnce(null); teardown(); }
    }
    document.addEventListener('keydown', onKey, true);

    // ── Select ───────────────────────────────────────────────────────
    function selectEl(el) {
      phase = 'selected';
      selEl = el;
      var r = el.getBoundingClientRect();
      origRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      origW = el.style.width  || '';
      origH = el.style.height || '';
      if (ov) ov.remove();
      if (hv) hv.remove();
      buildHandles();
      rafId = requestAnimationFrame(rafLoop);

      window.__cathodeResize = {
        dims: function() {
          var rr = selEl.getBoundingClientRect();
          return { oW: Math.round(origRect.width), oH: Math.round(origRect.height), nW: Math.round(rr.width), nH: Math.round(rr.height) };
        },
        set: function(dim, value) {
          var v = Math.max(10, Math.round(value));
          if (dim === 'w') selEl.style.width = v + 'px';
          else if (dim === 'h') selEl.style.height = v + 'px';
        },
        reset: function() { selEl.style.width = origW; selEl.style.height = origH; },
        result: function() {
          var rr = selEl.getBoundingClientRect();
          var snip = selEl.outerHTML.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').slice(0, 160);
          return { selector: getSelector(selEl), tag: selEl.tagName.toLowerCase(), snippet: snip,
                   oW: Math.round(origRect.width), oH: Math.round(origRect.height),
                   nW: Math.round(rr.width), nH: Math.round(rr.height) };
        },
        clear: function() { teardown(); },
      };

      resolveOnce({
        selector: getSelector(selEl), tag: selEl.tagName.toLowerCase(),
        label: labelFor(selEl), selShort: shortSel(selEl),
        oW: Math.round(origRect.width), oH: Math.round(origRect.height),
        vw: window.innerWidth, vh: window.innerHeight,
      });
    }

    // The pretty tag.class shown after the readable name (matches the old title).
    function shortSel(el) {
      var t = el.tagName.toLowerCase();
      var id = el.id ? '#' + el.id : '';
      var cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      return t + id + cls;
    }
    // Same naming mechanism as the box/lasso panel (combined-inject bestLabel):
    // the element's own text; images by format; controls by placeholder/value;
    // aria-label; else '' so the panel shows the selector alone.
    function labelFor(el) {
      var t = el.tagName.toLowerCase();
      function clip(s) { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > 42 ? s.slice(0, 41) + '…' : s; }
      if (t === 'img' || t === 'picture' || t === 'image') {
        var src = el.currentSrc || el.src || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        var ext = String(src).split(/[?#]/)[0].match(/\\.([a-z0-9]{2,5})$/i);
        if (ext) return ext[1].toLowerCase() === 'jpeg' ? 'JPG' : ext[1].toUpperCase();
        var data = String(src).match(/^data:image\\/([a-z0-9.+-]+)/i);
        if (data) return data[1].toUpperCase();
        return 'Image';
      }
      if (t === 'input' || t === 'textarea' || t === 'select') {
        var cv = clip(el.getAttribute('placeholder') || el.value || el.getAttribute('aria-label'));
        if (cv) return cv;
      }
      var ownsText = false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var nd = el.childNodes[i];
        if (nd.nodeType === 3 && nd.nodeValue && nd.nodeValue.trim()) { ownsText = true; break; }
      }
      var raw = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (raw && (ownsText || raw.length <= 60)) return raw.length > 42 ? raw.slice(0, 41) + '…' : raw;
      var aria = clip(el.getAttribute('aria-label') || el.getAttribute('title'));
      if (aria) return aria;
      return '';
    }

    // ── Handles UI (no toolbar — just box + 8 handles + size label) ───
    var hr = null, box = null, sizeLabel = null, lastRect = null;
    function buildHandles() {
      hr = document.createElement('div');
      hr.id = '__cr_hr';
      hr.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:${Z.OVERLAY_TOP};overflow:visible;';
      (document.body || document.documentElement).appendChild(hr);

      box = document.createElement('div');
      box.id = '__cr_box';
      box.style.cssText = 'position:absolute;border:1.5px solid ${ACCENT};box-sizing:border-box;pointer-events:none;' +
        'box-shadow:0 0 14px 2px rgba(${ACCENT_RGB},0.45),0 0 30px 6px rgba(${ACCENT_RGB},0.22);';
      hr.appendChild(box);

      var handles = [
        { id: 'nw', cursor: 'nw-resize' }, { id: 'n', cursor: 'n-resize' },
        { id: 'ne', cursor: 'ne-resize' }, { id: 'e', cursor: 'e-resize' },
        { id: 'se', cursor: 'se-resize' }, { id: 's', cursor: 's-resize' },
        { id: 'sw', cursor: 'sw-resize' }, { id: 'w', cursor: 'w-resize' },
      ];
      handles.forEach(function(def) {
        var h = document.createElement('div');
        h.dataset.h = def.id;
        h.style.cssText = 'position:absolute;width:10px;height:10px;background:#fff;border:none;' +
          'border-radius:2px;box-sizing:border-box;pointer-events:auto;cursor:' + def.cursor + ';' +
          'box-shadow:0 0 8px 2px rgba(${ACCENT_RGB},0.6);';
        h.addEventListener('mousedown', function(e) { startDrag(e, def.id); }, true);
        box.appendChild(h);
      });

      sizeLabel = document.createElement('div');
      sizeLabel.style.cssText = 'position:absolute;pointer-events:none;background:${ACCENT};border:none;' +
        'border-radius:4px;color:#fff;font:700 11px/1.4 monospace;padding:2px 7px;white-space:nowrap;' +
        'font-variant-numeric:tabular-nums;box-shadow:0 2px 8px rgba(0,0,0,.5);';
      hr.appendChild(sizeLabel);

      positionAll();
    }

    function positionAll() {
      if (!selEl || !hr) return;
      var r = selEl.getBoundingClientRect();
      // The rafLoop runs continuously while an element is selected, but most frames
      // are idle. Skip the reposition work (8 handle writes + a forced offsetHeight
      // read + style writes) when the element hasn't moved/resized since last frame.
      if (lastRect && r.left === lastRect.left && r.top === lastRect.top && r.width === lastRect.width && r.height === lastRect.height) return;
      lastRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      if (box) {
        box.style.left   = r.left   + 'px';
        box.style.top    = r.top    + 'px';
        box.style.width  = r.width  + 'px';
        box.style.height = r.height + 'px';
        var mid = { x: Math.round(r.width / 2), y: Math.round(r.height / 2) };
        var pos = {
          nw: [-5, -5], n: [mid.x - 5, -5], ne: [r.width - 5, -5], e: [r.width - 5, mid.y - 5],
          se: [r.width - 5, r.height - 5], s: [mid.x - 5, r.height - 5], sw: [-5, r.height - 5], w: [-5, mid.y - 5],
        };
        Object.keys(pos).forEach(function(id) {
          var h = box.querySelector('[data-h="' + id + '"]');
          if (h) { h.style.left = pos[id][0] + 'px'; h.style.top = pos[id][1] + 'px'; }
        });
      }
      if (sizeLabel) {
        var nW = Math.round(r.width), nH = Math.round(r.height);
        var oW = Math.round(origRect.width), oH = Math.round(origRect.height);
        var dW = nW - oW, dH = nH - oH;
        var ws = nW + (dW !== 0 ? ' (' + (dW > 0 ? '+' : '') + dW + ')' : '');
        var hs = nH + (dH !== 0 ? ' (' + (dH > 0 ? '+' : '') + dH + ')' : '');
        sizeLabel.textContent = ws + ' \\u00d7 ' + hs;
        var lh = sizeLabel.offsetHeight || 20;
        var lTop = r.top >= lh + 8 ? r.top - lh - 6 : r.bottom + 6;
        sizeLabel.style.left = Math.max(4, r.left) + 'px';
        sizeLabel.style.top  = lTop + 'px';
      }
    }

    function rafLoop() { positionAll(); rafId = requestAnimationFrame(rafLoop); }

    // ── Drag ─────────────────────────────────────────────────────────
    function startDrag(e, handleId) {
      e.stopPropagation(); e.preventDefault();
      activeHandle = handleId;
      var r = selEl.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, { capture: true, once: true });
    }
    function onMove(e) {
      if (!activeHandle || !drag) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (activeHandle.indexOf('e') !== -1) selEl.style.width  = Math.max(10, Math.round(drag.w + dx)) + 'px';
      if (activeHandle.indexOf('w') !== -1) selEl.style.width  = Math.max(10, Math.round(drag.w - dx)) + 'px';
      if (activeHandle.indexOf('s') !== -1) selEl.style.height = Math.max(10, Math.round(drag.h + dy)) + 'px';
      if (activeHandle.indexOf('n') !== -1) selEl.style.height = Math.max(10, Math.round(drag.h - dy)) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      activeHandle = null; drag = null;
    }

    // ── Selector helper (shared) ──────────────────────────────────────
${SHARED.selectorHelper('__cr')}
  });
})()`;
}

module.exports = { getResizeScript };
