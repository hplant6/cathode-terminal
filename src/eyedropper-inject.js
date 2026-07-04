// Eyedropper tool — injected into the browsed page.
// Phase 1 (hover): a magnifier loupe follows the cursor showing zoomed real
//   pixels (sampled from a page snapshot) + a swatch + the hex value.
// Phase 2 (click): locks onto the element under the cursor, auto-detects which
//   CSS property produced the sampled color, and shows a card (styled like the
//   lasso "Targeted Elements" popup) with the shared iro color picker to edit
//   the color live, plus an instruction box to hand it to the agent.
// Resolves with { selector, tag, property, fromColor, toColor, changed,
//   pickedColor, instruction } or null.
const { Z } = require('./ui-constants');
const path = require('path');
const { MARCH_OUTLINE_CSS, MARCH_KEYFRAMES_JS, ACCENT, ACCENT_RGB } = require('./inject-styles');
const { iconB64 } = require('./read-icon');

const ED_CURSOR_B64 = iconB64(path.join(__dirname, 'icons', 'eyedropper-cursor.svg'));
// Hotspot at the dropper tip (bottom-left), for a 22px-tall cursor.
const ED_CURSOR = `url("data:image/svg+xml;base64,${ED_CURSOR_B64}") 2 20, crosshair`;

function getEyedropperScript(snapshotDataUrl) {
  return `(function() {
  ${MARCH_KEYFRAMES_JS}
  if (window.__cathodeEyedropper) { try { window.__cathodeEyedropper.clear(); } catch(e){} }   // disarm the previous run's key handler first (like resize-inject)
  ['__ed_ov','__ed_loupe','__ed_pop','__ed_hl__','__ed_cp__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  return new Promise(function(resolve) {
    var resolved = false;
    var ready = false;
    var phase = 'hover';                 // 'hover' | 'selected'
    var selEl = null, prop = null;
    var fromHex = '#000000', pickedHex = '#000000', curHex = '#000000';

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img = new Image();


    // Panel mode: resolve once on selection (handles stay), then teardown later.
    function resolveOnce(v) { if (resolved) return; resolved = true; resolve(v); }
    function edTeardown() {
      document.removeEventListener('keydown', onKey, true);
      ['__ed_ov','__ed_loupe','__ed_pop','__ed_hl__','__ed_cp__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      window.__cathodeEyedropper = null;
    }
    function edLabel(el) {
      var t = el.tagName.toLowerCase();
      var id = el.id ? '#' + el.id : '';
      var cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      return t + id + cls;
    }


    // ── Overlay (custom eyedropper cursor; locks scroll so the snapshot holds)
    var ov = document.createElement('div');
    ov.id = '__ed_ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${ED_CURSOR};';
    (document.body || document.documentElement).appendChild(ov);
    ov.addEventListener('wheel', function(e){ e.preventDefault(); }, { passive: false });

    // ── Loupe ─────────────────────────────────────────────────────────
    // Black rounded container (22px, orange glow) → magnification area (20px)
    // with a centered crosshair reticle → hex value beneath, all inside the shell.
    var loupe = document.createElement('div');
    loupe.id = '__ed_loupe';
    loupe.style.cssText = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_TOP};display:none;'
      + 'flex-direction:column;align-items:center;gap:9px;padding:11px 11px 8px;background:#000;border-radius:22px;'
      + 'box-shadow:0 0 18px rgba(${ACCENT_RGB},.55),0 0 0 1px rgba(${ACCENT_RGB},.40),0 10px 30px rgba(0,0,0,.7);';
    var lmag = document.createElement('div');
    lmag.style.cssText = 'position:relative;width:150px;height:150px;border-radius:20px;overflow:hidden;background:#0a0a0a;';
    var lcanvas = document.createElement('canvas');
    lcanvas.width = 150; lcanvas.height = 150;
    lcanvas.style.cssText = 'display:block;width:150px;height:150px;';
    lmag.appendChild(lcanvas);
    var lcross = document.createElement('div');
    // Reticle color is forced with !important inline styles: design-heavy pages
    // often set global svg/path fill rules that would otherwise repaint the
    // crosshair to their brand color (a fill="#fff" attribute loses to any page
    // CSS), making it vanish on a dark loupe. The stroke thickens the lines and
    // the drop-shadow keeps it legible on ANY magnified background, light or dark.
    var CROSS_CSS = 'fill:#fff!important;stroke:#fff!important;stroke-width:1.5!important';
    lcross.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:42px;opacity:.9;pointer-events:none;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.85));';
    lcross.innerHTML = '<svg width="44" height="42" viewBox="0 0 50 48" style="overflow:visible!important" xmlns="http://www.w3.org/2000/svg">'
      + '<path style="' + CROSS_CSS + '" d="M38.6655 23.8288C38.6655 16.1581 32.4476 9.93936 24.7768 9.9392C17.1059 9.9392 10.8872 16.158 10.8872 23.8288C10.8873 31.4996 17.106 37.7175 24.7768 37.7175V38.7175L24.3921 38.7126C16.4742 38.5119 10.0925 32.1305 9.89206 24.2126L9.88718 23.8288C9.88718 15.6057 16.5537 8.9392 24.7768 8.9392L25.1606 8.94408C33.2063 9.1478 39.6655 15.7341 39.6655 23.8288L39.6606 24.2126C39.4569 32.2582 32.8714 38.7174 24.7768 38.7175V37.7175C32.4475 37.7174 38.6653 31.4995 38.6655 23.8288Z"/>'
      + '<path style="' + CROSS_CSS + '" d="M23.7765 4.37114e-08L24.7765 0V9.88672H23.7765V4.37114e-08Z"/>'
      + '<path style="' + CROSS_CSS + '" d="M23.7765 38.0011H24.7765V47.8878H23.7765V38.0011Z"/>'
      + '<path style="' + CROSS_CSS + '" d="M49.5526 22.8286V23.8286L39.6655 23.8288L39.6659 22.8286H49.5526Z"/>'
      + '<path style="' + CROSS_CSS + '" d="M9.88672 22.8286L9.88718 23.8288L0 23.8286V22.8286H9.88672Z"/></svg>';
    lmag.appendChild(lcross);
    loupe.appendChild(lmag);
    var lval = document.createElement('span');
    lval.style.cssText = "font-family:Consolas,'Courier New',monospace;font-size:14px;font-weight:700;color:#fff;letter-spacing:.06em;";
    loupe.appendChild(lval);
    (document.body || document.documentElement).appendChild(loupe);
    var lctx = lcanvas.getContext('2d');

    // ── Snapshot ──────────────────────────────────────────────────────
    img.onload = function() {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      ready = true;
    };
    img.src = ${JSON.stringify(snapshotDataUrl)};

    // ── Helpers ───────────────────────────────────────────────────────
    function toHex(r, g, b) {
      return '#' + [r, g, b].map(function(v){ return ('0' + (v & 255).toString(16)).slice(-2); }).join('').toUpperCase();
    }
    function sampleAt(cx, cy) {
      if (!ready) return null;
      var ix = Math.floor(cx * (canvas.width / window.innerWidth));
      var iy = Math.floor(cy * (canvas.height / window.innerHeight));
      ix = Math.max(0, Math.min(canvas.width - 1, ix));
      iy = Math.max(0, Math.min(canvas.height - 1, iy));
      var d = ctx.getImageData(ix, iy, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], ix: ix, iy: iy };
    }
    function parseRGB(str) {
      var m = (str || '').match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      var p = m[1].split(',').map(function(x){ return parseFloat(x); });
      if (p.length < 3) return null;
      if (p.length >= 4 && p[3] === 0) return null;   // fully transparent → ignore
      return { r: p[0], g: p[1], b: p[2] };
    }
    function rgbHex(str) {
      var rgb = parseRGB(str);
      return rgb ? toHex(Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)) : null;
    }
    function dist(a, b) { var dr=a.r-b.r, dg=a.g-b.g, db=a.b-b.b; return Math.sqrt(dr*dr+dg*dg+db*db); }

    function getSelector(el) {
      if (el.id) return '#' + el.id;
      var parts = [], cur = el;
      for (var i = 0; i < 4 && cur && cur.tagName && cur !== document.documentElement; i++) {
        var p = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
          var cls = cur.className.trim().split(/\\s+/).filter(function(c){ return c && c.indexOf('__ed') !== 0; }).slice(0, 2);
          if (cls.length) p += '.' + cls.join('.');
        }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function hexToRgb(h) {
      var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null;
      var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function hasDirectText(el) {
      for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) return true; }
      return false;
    }
    function hasBorder(cs) {
      return ['Top','Right','Bottom','Left'].some(function(s){
        return parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none';
      });
    }
    function shadowColorOf(str) { var m = (str || '').match(/rgba?\\([^)]*\\)/); return m ? rgbHex(m[0]) : null; }
    function withShadowColor(str, hex) { return (str || '').replace(/rgba?\\([^)]*\\)/g, hex); }

    // A simple single-color CSS property (color, background-color, …).
    function colorDesc(p, label, computedVal) {
      return {
        prop: p, label: label, origHex: (rgbHex(computedVal) || '#000000').toUpperCase(),
        savedVal: '', savedPriority: '',
        activate: function(){ this.savedVal = selEl.style.getPropertyValue(p); this.savedPriority = selEl.style.getPropertyPriority(p); },
        apply: function(hex){ selEl.style.setProperty(p, hex, 'important'); },
        restore: function(){ if (this.savedVal) selEl.style.setProperty(p, this.savedVal, this.savedPriority); else selEl.style.removeProperty(p); }
      };
    }
    // box-shadow: edit just the color, preserving offset/blur/spread/inset.
    function shadowDesc(computed) {
      return {
        prop: 'box-shadow', label: 'Shadow', origHex: (shadowColorOf(computed) || '#000000').toUpperCase(),
        computed: computed, savedVal: '', savedPriority: '',
        activate: function(){ this.savedVal = selEl.style.getPropertyValue('box-shadow'); this.savedPriority = selEl.style.getPropertyPriority('box-shadow'); },
        apply: function(hex){ selEl.style.setProperty('box-shadow', withShadowColor(this.computed, hex), 'important'); },
        restore: function(){ if (this.savedVal) selEl.style.setProperty('box-shadow', this.savedVal, this.savedPriority); else selEl.style.removeProperty('box-shadow'); }
      };
    }

    // Build the list of color-influencing properties that actually apply.
    function buildPropList(el) {
      var cs = getComputedStyle(el);
      var list = [];
      if (hasDirectText(el))                  list.push(colorDesc('color', 'Text color', cs.color));
      if (parseRGB(cs.backgroundColor))       list.push(colorDesc('background-color', 'Background', cs.backgroundColor));
      if (hasBorder(cs))                      list.push(colorDesc('border-color', 'Border', cs.borderTopColor));
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
                                              list.push(colorDesc('outline-color', 'Outline', cs.outlineColor));
      if (cs.boxShadow && cs.boxShadow !== 'none') list.push(shadowDesc(cs.boxShadow));
      if (cs.textDecorationLine && cs.textDecorationLine !== 'none')
                                              list.push(colorDesc('text-decoration-color', 'Underline', cs.textDecorationColor));
      var isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
      if (isSvg && cs.fill   && cs.fill   !== 'none') list.push(colorDesc('fill', 'Fill', cs.fill));
      if (isSvg && cs.stroke && cs.stroke !== 'none') list.push(colorDesc('stroke', 'Stroke', cs.stroke));
      if (!list.length) {
        list.push(colorDesc('background-color', 'Background', cs.backgroundColor));
        list.push(colorDesc('color', 'Text color', cs.color));
      }
      return list;
    }

    // ── Hover loupe ───────────────────────────────────────────────────
    function drawLoupe(cx, cy) {
      var s = sampleAt(cx, cy); if (!s) return;
      var hex = toHex(s.r, s.g, s.b);
      var zoom = 8, srcW = lcanvas.width / zoom, srcH = lcanvas.height / zoom;
      lctx.imageSmoothingEnabled = false;
      lctx.clearRect(0, 0, lcanvas.width, lcanvas.height);
      lctx.drawImage(canvas, s.ix - srcW / 2, s.iy - srcH / 2, srcW, srcH, 0, 0, lcanvas.width, lcanvas.height);
      lval.textContent = hex;   // crosshair reticle is a centered DOM overlay; no canvas marker needed
      var lw = loupe.offsetWidth || 174, lh = loupe.offsetHeight || 205;
      var lx = cx + 14, ly = cy - lh - 14;   // default: above the cursor
      if (lx + lw > window.innerWidth - 6) lx = cx - lw - 14;
      if (ly < 6) ly = cy + 14;              // near the top edge → flip below the cursor
      loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px'; loupe.style.display = 'flex';
    }
    ov.addEventListener('mousemove', function(e) { if (phase === 'hover') drawLoupe(e.clientX, e.clientY); });
    ov.addEventListener('mouseleave', function() { if (phase === 'hover') loupe.style.display = 'none'; });

    ov.addEventListener('click', function(e) {
      if (phase !== 'hover') return;
      e.preventDefault(); e.stopPropagation();
      var s = sampleAt(e.clientX, e.clientY); if (!s) return;
      ov.style.pointerEvents = 'none';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      ov.style.pointerEvents = '';
      if (!el || el === document.body || el === document.documentElement) return;
      selectEl(el, toHex(s.r, s.g, s.b), s);
    });

    // ── Select element → editor card ──────────────────────────────────
    var props = [], active = null;

    function selectEl(el, hex, sample) {
      phase = 'selected';
      selEl = el; pickedHex = hex;
      loupe.style.display = 'none';
      ov.style.cursor = 'default'; ov.style.pointerEvents = 'none';
      props = buildPropList(el);
      // default to whichever applicable property is closest to the sampled pixel
      var best = props[0], bestD = 1e9;
      props.forEach(function(d){ var rgb = hexToRgb(d.origHex); var dd = rgb ? dist(rgb, sample) : 1e9; if (dd < bestD) { bestD = dd; best = d; } });
      active = best; active.activate();
      prop = active.prop;
      // Show the EXACT sampled pixel, not the matched property's computed color
      // (anti-aliased edges / gradients / images won't equal any one property).
      fromHex = pickedHex; curHex = pickedHex;

      // Hand off to the left-column panel; keep refs live for live editing.
      if (ov) ov.remove();
      if (loupe) loupe.remove();
      window.__cathodeEyedropper = {
        setProp: function(p) {
          if (active) active.restore();
          var nd = null;
          for (var i = 0; i < props.length; i++) { if (props[i].prop === p) { nd = props[i]; break; } }
          if (!nd) return null;
          active = nd; active.activate();
          fromHex = active.origHex; curHex = fromHex;
          return { from: fromHex };
        },
        setColor: function(hex) { curHex = (hex || '').toUpperCase(); if (active) active.apply(hex); },
        result: function(instruction) {
          return {
            selector: getSelector(selEl), tag: selEl.tagName.toLowerCase(),
            property: active ? active.prop : prop, fromColor: fromHex, toColor: curHex.toUpperCase(),
            changed: curHex.toUpperCase() !== fromHex.toUpperCase(), pickedColor: pickedHex,
            instruction: instruction || '',
          };
        },
        cancel: function() { if (active) active.restore(); edTeardown(); },
        clear: function() { edTeardown(); },
      };
      resolveOnce({
        selector: getSelector(selEl), tag: selEl.tagName.toLowerCase(), label: edLabel(selEl),
        pickedHex: pickedHex,
        props: props.map(function(d) { return { prop: d.prop, label: d.label, origHex: d.origHex }; }),
        activeIdx: props.indexOf(active),
      });
    }




    // ── Keyboard ──────────────────────────────────────────────────────
    // Selection hands off to the left-column panel, which owns cancel/send;
    // here we only allow Escape to back out during the hover (sampling) phase.
    function onKey(e) {
      if (e.key === 'Escape' && phase === 'hover') { resolveOnce(null); edTeardown(); }
    }
    document.addEventListener('keydown', onKey, true);
  });
})()`;
}

module.exports = { getEyedropperScript };
