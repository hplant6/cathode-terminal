// Eyedropper tool — injected into the browsed page.
// Phase 1 (hover): a magnifier loupe follows the cursor showing zoomed real
//   pixels (sampled from a page snapshot) + a swatch + the hex value.
// Phase 2 (click): locks onto the element under the cursor, auto-detects which
//   CSS property produced the sampled color, and shows a card (styled like the
//   lasso "Targeted Elements" popup) with the shared iro color picker to edit
//   the color live, plus an instruction box to hand it to the agent.
// Resolves with { selector, tag, property, fromColor, toColor, changed,
//   pickedColor, instruction } or null.
const fs   = require('fs');
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
  ['__ed_ov','__ed_loupe','__ed_pop','__ed_hl__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  return new Promise(function(resolve) {
    var resolved = false;
    var ready = false;
    var phase = 'hover';                 // 'hover' | 'selected'
    var selEl = null, prop = null;
    var fromHex = '#000000', pickedHex = '#000000', curHex = '#000000';

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img = new Image();

    // iro picker state
    var picker = null, syncing = false, cpMode = 'hex', inputEls = null, instr = null, setMode = null;
    var closePickerFn = null, docClickHandler = null;

    function done(val) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey, true);
      if (docClickHandler) document.removeEventListener('mousedown', docClickHandler, true);
      if (picker) { try { picker.off('color:change'); } catch (e) {} picker = null; }
      ['__ed_ov','__ed_loupe','__ed_pop','__ed_hl__','__ed_cp__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      resolve(val);
    }

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

    // Reusable: drag an element by a handle, skipping mousedowns on skipSel.
    function makeDraggable(el, handle, skipSel) {
      if (!handle) return;
      handle.style.cursor = 'grab';
      handle.addEventListener('mousedown', function(e){
        if (skipSel && e.target.closest(skipSel)) return;
        e.preventDefault();
        var rc = el.getBoundingClientRect();
        var ox = e.clientX - rc.left, oy = e.clientY - rc.top;
        handle.style.cursor = 'grabbing';
        function mv(ev){
          var nx = Math.min(Math.max(2, ev.clientX - ox), window.innerWidth - el.offsetWidth - 2);
          var ny = Math.min(Math.max(2, ev.clientY - oy), window.innerHeight - el.offsetHeight - 2);
          el.style.left = nx + 'px'; el.style.top = ny + 'px';
        }
        function up(){ handle.style.cursor = 'grab'; document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); }
        document.addEventListener('mousemove', mv, true);
        document.addEventListener('mouseup', up, true);
      });
    }

    // ── Overlay (custom eyedropper cursor; locks scroll so the snapshot holds)
    var ov = document.createElement('div');
    ov.id = '__ed_ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${ED_CURSOR};';
    document.body.appendChild(ov);
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
    lcross.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:40px;height:38px;opacity:.5;pointer-events:none;';
    lcross.innerHTML = '<svg width="40" height="38" viewBox="0 0 50 48" fill="#fff" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M38.6655 23.8288C38.6655 16.1581 32.4476 9.93936 24.7768 9.9392C17.1059 9.9392 10.8872 16.158 10.8872 23.8288C10.8873 31.4996 17.106 37.7175 24.7768 37.7175V38.7175L24.3921 38.7126C16.4742 38.5119 10.0925 32.1305 9.89206 24.2126L9.88718 23.8288C9.88718 15.6057 16.5537 8.9392 24.7768 8.9392L25.1606 8.94408C33.2063 9.1478 39.6655 15.7341 39.6655 23.8288L39.6606 24.2126C39.4569 32.2582 32.8714 38.7174 24.7768 38.7175V37.7175C32.4475 37.7174 38.6653 31.4995 38.6655 23.8288Z"/>'
      + '<path d="M23.7765 4.37114e-08L24.7765 0V9.88672H23.7765V4.37114e-08Z"/>'
      + '<path d="M23.7765 38.0011H24.7765V47.8878H23.7765V38.0011Z"/>'
      + '<path d="M49.5526 22.8286V23.8286L39.6655 23.8288L39.6659 22.8286H49.5526Z"/>'
      + '<path d="M9.88672 22.8286L9.88718 23.8288L0 23.8286V22.8286H9.88672Z"/></svg>';
    lmag.appendChild(lcross);
    loupe.appendChild(lmag);
    var lval = document.createElement('span');
    lval.style.cssText = "font-family:Consolas,'Courier New',monospace;font-size:14px;font-weight:700;color:#fff;letter-spacing:.06em;";
    loupe.appendChild(lval);
    document.body.appendChild(loupe);
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

    function applyColor(hex) { if (active) active.apply(hex); }
    function revert() { if (active) active.restore(); }

    // ── iro color picker (shared plugin) ──────────────────────────────
    function loadIro(cb) {
      if (window.iro) { cb(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5/dist/iro.min.js';
      s.onload = cb; s.onerror = function(){ cb(); };
      document.head.appendChild(s);
    }
    function syncInputs(color) {
      if (!inputEls) return;
      syncing = true;
      inputEls.hex.value = color.hexString.toUpperCase();
      var rgb = color.rgb; inputEls.r.value = rgb.r; inputEls.g.value = rgb.g; inputEls.b.value = rgb.b;
      var hsl = color.hsl; inputEls.h.value = Math.round(hsl.h); inputEls.s.value = Math.round(hsl.s); inputEls.l.value = Math.round(hsl.l);
      syncing = false;
    }

    function buildCard(el) {
      var card = document.createElement('div');
      card.id = '__ed_pop';
      card.style.cssText = 'position:fixed;z-index:${Z.OVERLAY_TOP};width:236px;background:#080808;'
        + 'border:1px solid #222;border-radius:6px;overflow:hidden;'
        + 'box-shadow:0 16px 56px rgba(0,0,0,.92),0 0 0 1px rgba(255,255,255,.04);'
        + "font-family:Consolas,'Courier New',monospace;color:#888;user-select:none;";

      var inputStyle = 'background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;'
        + 'padding:4px 6px;font-family:Consolas,monospace;font-size:11px;outline:none;';
      var modeBtn = function(m, label, active) {
        return '<button id="__ed_m_' + m + '__" style="flex:1;background:transparent;border:none;'
          + 'color:' + (active ? '#d4aa00' : '#555') + ';font-size:10px;font-weight:600;cursor:pointer;'
          + 'padding:5px 0;border-radius:16px;position:relative;z-index:1;font-family:Consolas,monospace;'
          + 'letter-spacing:.05em;">' + label + '</button>';
      };
      var numInput = function(id) {
        return '<input id="' + id + '" type="number" min="0" max="255" style="flex:1;min-width:0;' + inputStyle + 'padding:4px 4px;"/>';
      };
      var lbl = function(t) { return '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">' + t + '</span>'; };

      card.innerHTML =
        '<div id="__ed_titlebar__" style="display:flex;align-items:center;padding:10px 14px 7px;cursor:grab;">'
          + "<span style=\\"flex:1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fff;\\">Color</span>"
          + '<button id="__ed_close__" title="Close" style="background:none;border:none;color:#444;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:3px;line-height:1;">\\u2715</button>'
        + '</div>'
        + '<div style="height:1px;background:#1c1c1c;"></div>'
        + '<div style="padding:11px 14px 0;">'
          + "<div style=\\"font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#555;margin-bottom:5px;\\">Targeted element</div>"
          + '<div id="__ed_meta__" style="font-size:11px;color:#4a9eff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;margin-bottom:10px;"></div>'
          + '<div style="position:relative;margin-bottom:11px;">'
            + '<select id="__ed_propsel__" style="width:100%;box-sizing:border-box;background:#161616;border:1px solid #222;border-radius:4px;color:#bbb;font-family:Consolas,monospace;font-size:11px;padding:6px 26px 6px 8px;outline:none;cursor:pointer;appearance:none;-webkit-appearance:none;"></select>'
            + '<svg id="__ed_caret__" width="10" height="10" viewBox="0 0 10 10" fill="none" style="position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;"><polyline points="2,3.5 5,6.5 8,3.5" stroke="#888" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>'
          + '</div>'
          + '<div style="height:1px;background:#1c1c1c;margin:0 -14px 12px;"></div>'
          + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<div id="__ed_oldwrap__" style="display:none;align-items:center;gap:8px;">'
              + '<div id="__ed_oldsw__" style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 0 0 1px rgba(0,0,0,.4);flex-shrink:0;"></div>'
              + '<span id="__ed_oldval__" style="font-size:11.5px;color:#777;letter-spacing:.06em;"></span>'
              + '<span style="color:#555;font-size:13px;line-height:1;">\\u2192</span>'
            + '</div>'
            + '<div id="__ed_swatch__" title="Edit color" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.22);box-shadow:inset 0 0 0 1px rgba(0,0,0,.4);cursor:pointer;flex-shrink:0;"></div>'
            + '<span id="__ed_swval__" style="font-size:12px;color:#bbb;letter-spacing:.06em;cursor:pointer;"></span>'
          + '</div>'
        + '</div>'
        + "<div style=\\"font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fff;padding:12px 14px 7px;\\">Instructions</div>"
        + '<div style="position:relative;margin:0 10px 12px;">'
          + '<textarea id="__ed_instr__" placeholder="give instructions here" style="display:block;width:100%;box-sizing:border-box;min-height:64px;background:#141414;border:1px solid #1e1e1e;border-radius:4px;color:#888;font-family:Consolas,monospace;font-size:12px;line-height:1.5;padding:9px 34px 9px 10px;resize:vertical;outline:none;"></textarea>'
          + '<button id="__ed_send__" title="Send (Enter)" style="position:absolute;right:8px;bottom:8px;background:none;border:none;color:#3a3a3a;cursor:pointer;padding:4px;line-height:0;transition:color .12s;">'
            + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none"></polygon></svg>'
          + '</button>'
        + '</div>';

      document.body.appendChild(card);

      var meta = card.querySelector('#__ed_meta__');
      meta.textContent = getSelector(el);
      meta.title = meta.textContent;
      instr = card.querySelector('#__ed_instr__');

      // targeted-element link → hover to outline it on the page
      var hl = document.createElement('div');
      hl.id = '__ed_hl__';
      hl.style.cssText = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_MID};box-sizing:border-box;display:none;${MARCH_OUTLINE_CSS}';
      document.body.appendChild(hl);
      meta.addEventListener('mouseenter', function(){
        var rr = selEl.getBoundingClientRect();
        hl.style.left = rr.left + 'px'; hl.style.top = rr.top + 'px';
        hl.style.width = rr.width + 'px'; hl.style.height = rr.height + 'px'; hl.style.display = 'block';
        meta.style.textDecoration = 'underline';
      });
      meta.addEventListener('mouseleave', function(){ hl.style.display = 'none'; meta.style.textDecoration = ''; });

      var swatch = card.querySelector('#__ed_swatch__');
      var swval  = card.querySelector('#__ed_swval__');
      var oldwrap = card.querySelector('#__ed_oldwrap__');
      var oldsw   = card.querySelector('#__ed_oldsw__');
      var oldval  = card.querySelector('#__ed_oldval__');
      function setOld() { if (oldsw) oldsw.style.background = fromHex; if (oldval) oldval.textContent = fromHex; }
      setOld();
      function updateCurrent(hex) {
        curHex = hex.toUpperCase();
        if (swatch) swatch.style.background = hex;
        if (swval)  swval.textContent = curHex;
        // show the old → new comparison only once the color actually differs
        if (oldwrap) oldwrap.style.display = (curHex !== fromHex.toUpperCase()) ? 'flex' : 'none';
      }
      updateCurrent(fromHex);

      // property-target dropdown (only the color properties that apply)
      var propSel = card.querySelector('#__ed_propsel__');
      propSel.innerHTML = props.map(function(d, i){
        return '<option value="' + i + '"' + (d === active ? ' selected' : '') + '>' + d.label + '</option>';
      }).join('');
      propSel.addEventListener('mousedown', function(e){ e.stopPropagation(); });
      propSel.addEventListener('change', function(){ switchProp(props[+propSel.value]); });
      // nothing to switch to → render the dropdown as inactive
      if (props.length <= 1) {
        propSel.disabled = true;
        propSel.style.opacity = '0.5';
        propSel.style.cursor = 'default';
        var caret = card.querySelector('#__ed_caret__'); if (caret) caret.style.opacity = '0.4';
      }
      function switchProp(desc) {
        if (!desc || desc === active) return;
        active.restore();                 // revert the previous property's preview
        active = desc; active.activate();
        prop = active.prop;
        fromHex = active.origHex; curHex = fromHex;
        setOld();
        if (picker) { syncing = true; try { picker.color.set(fromHex); } catch (e) {} syncing = false; syncInputs(picker.color); }
        updateCurrent(fromHex);
      }

      makeDraggable(card, card.querySelector('#__ed_titlebar__'), '#__ed_close__');

      // close ✕ = cancel
      var closeBtn = card.querySelector('#__ed_close__');
      closeBtn.addEventListener('mouseover', function(){ closeBtn.style.background = '#2a2a2a'; closeBtn.style.color = '#ccc'; });
      closeBtn.addEventListener('mouseout',  function(){ closeBtn.style.background = 'none'; closeBtn.style.color = '#444'; });
      closeBtn.addEventListener('click', function(e){ e.stopPropagation(); revert(); done(null); });

      var sendBtn = card.querySelector('#__ed_send__');
      sendBtn.addEventListener('mouseover', function(){ sendBtn.style.color = '#aaa'; });
      sendBtn.addEventListener('mouseout',  function(){ sendBtn.style.color = '#3a3a3a'; });
      sendBtn.addEventListener('click', function(e){ e.stopPropagation(); send(); });

      // ── Color picker — a separate window/modal (built on first open) ──
      var cpModal = null, cpFirst = true;

      function buildPickerModal() {
        cpModal = document.createElement('div');
        cpModal.id = '__ed_cp__';
        cpModal.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:${Z.OVERLAY_TOP};width:224px;background:#0d0d0d;'
          + 'border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;box-shadow:0 12px 44px rgba(0,0,0,.9);'
          + "font-family:Consolas,'Courier New',monospace;color:#888;user-select:none;";
        cpModal.innerHTML =
          '<div id="__ed_cp_tb__" style="display:flex;align-items:center;padding:9px 12px 7px;cursor:grab;">'
            + "<span style=\\"flex:1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fff;\\">Color picker</span>"
            + '<button id="__ed_cp_close__" title="Close" style="background:none;border:none;color:#444;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:3px;line-height:1;">\\u2715</button>'
          + '</div>'
          + '<div style="height:1px;background:#1c1c1c;"></div>'
          + '<div style="padding:11px 12px 12px;">'
            + '<div id="__ed_iro__" style="display:flex;justify-content:center;"></div>'
            + '<div style="margin-top:10px;">'
              + '<div id="__ed_bar__" style="position:relative;display:flex;background:#111;border:1px solid #222;border-radius:20px;padding:2px;">'
                + '<div id="__ed_thumb__" style="position:absolute;top:2px;bottom:2px;left:2px;background:#1a1400;border:1px solid #d4aa00;border-radius:16px;transition:left .18s ease,width .18s ease;pointer-events:none;"></div>'
                + modeBtn('hex','HEX',true) + modeBtn('rgb','RGB',false) + modeBtn('hsl','HSL',false)
              + '</div>'
              + '<div id="__ed_p_hex__" style="margin-top:7px;"><input id="__ed_hex__" type="text" spellcheck="false" style="width:100%;box-sizing:border-box;' + inputStyle + 'font-size:12px;letter-spacing:.06em;"/></div>'
              + '<div id="__ed_p_rgb__" style="margin-top:7px;display:none;"><div style="display:flex;gap:4px;align-items:center;">'
                + lbl('R') + numInput('__ed_r__') + lbl('G') + numInput('__ed_g__') + lbl('B') + numInput('__ed_b__')
              + '</div></div>'
              + '<div id="__ed_p_hsl__" style="margin-top:7px;display:none;"><div style="display:flex;gap:4px;align-items:center;">'
                + lbl('H') + numInput('__ed_h__') + lbl('S') + numInput('__ed_s__') + lbl('L') + numInput('__ed_l__')
              + '</div></div>'
            + '</div>'
          + '</div>';
        document.body.appendChild(cpModal);

        makeDraggable(cpModal, cpModal.querySelector('#__ed_cp_tb__'), '#__ed_cp_close__');
        var cpClose = cpModal.querySelector('#__ed_cp_close__');
        cpClose.addEventListener('mouseover', function(){ cpClose.style.background = '#2a2a2a'; cpClose.style.color = '#ccc'; });
        cpClose.addEventListener('mouseout',  function(){ cpClose.style.background = 'none'; cpClose.style.color = '#444'; });
        cpClose.addEventListener('click', function(e){ e.stopPropagation(); closePicker(); });

        setMode = function(mode) {
          cpMode = mode;
          ['hex','rgb','hsl'].forEach(function(m){
            var p = cpModal.querySelector('#__ed_p_' + m + '__');
            var b = cpModal.querySelector('#__ed_m_' + m + '__');
            if (p) p.style.display = m === mode ? '' : 'none';
            if (b) b.style.color = m === mode ? '#d4aa00' : '#555';
          });
          var ab = cpModal.querySelector('#__ed_m_' + mode + '__');
          var th = cpModal.querySelector('#__ed_thumb__');
          if (ab && th) { th.style.left = ab.offsetLeft + 'px'; th.style.width = ab.offsetWidth + 'px'; }
        };
        ['hex','rgb','hsl'].forEach(function(m){
          var b = cpModal.querySelector('#__ed_m_' + m + '__');
          if (b) { b.addEventListener('mousedown', function(e){ e.stopPropagation(); });
                   b.addEventListener('click', function(e){ e.stopPropagation(); setMode(m); }); }
        });

        inputEls = {
          hex: cpModal.querySelector('#__ed_hex__'),
          r: cpModal.querySelector('#__ed_r__'), g: cpModal.querySelector('#__ed_g__'), b: cpModal.querySelector('#__ed_b__'),
          h: cpModal.querySelector('#__ed_h__'), s: cpModal.querySelector('#__ed_s__'), l: cpModal.querySelector('#__ed_l__')
        };
        function wire(el, setter) {
          if (!el) return;
          el.addEventListener('mousedown', function(e){ e.stopPropagation(); });
          el.addEventListener('input', function(){
            if (!picker || syncing) return;
            syncing = true; try { setter(el.value); } catch (e) {} syncing = false;
            syncInputs(picker.color); applyColor(picker.color.hexString); updateCurrent(picker.color.hexString);
          });
        }
        wire(inputEls.hex, function(v){ picker.color.hexString = v; });
        wire(inputEls.r, function(v){ var c = picker.color.rgb; c.r = +v; picker.color.rgb = c; });
        wire(inputEls.g, function(v){ var c = picker.color.rgb; c.g = +v; picker.color.rgb = c; });
        wire(inputEls.b, function(v){ var c = picker.color.rgb; c.b = +v; picker.color.rgb = c; });
        wire(inputEls.h, function(v){ var c = picker.color.hsl; c.h = +v; picker.color.hsl = c; });
        wire(inputEls.s, function(v){ var c = picker.color.hsl; c.s = +v; picker.color.hsl = c; });
        wire(inputEls.l, function(v){ var c = picker.color.hsl; c.l = +v; picker.color.hsl = c; });

        loadIro(function(){
          if (!window.iro) { if (inputEls.hex) inputEls.hex.value = curHex; return; }
          try {
            picker = new iro.ColorPicker(cpModal.querySelector('#__ed_iro__'), {
              width: 196, color: curHex,
              layout: [ { component: iro.ui.Box }, { component: iro.ui.Slider, options: { sliderType: 'hue' } } ]
            });
            picker.on('color:change', function(color){
              if (syncing) return;
              syncInputs(color); applyColor(color.hexString); updateCurrent(color.hexString);
            });
            syncInputs(picker.color);
          } catch (e) {}
        });
      }

      function openPicker() {
        if (!cpModal) buildPickerModal();
        cpModal.style.display = 'block';
        if (picker) { syncing = true; try { picker.color.set(curHex); } catch (e) {} syncing = false; syncInputs(picker.color); }
        var r = swatch.getBoundingClientRect();
        var pw = cpModal.offsetWidth || 224, ph = cpModal.offsetHeight || 320;
        var left = (r.right + 10 + pw <= window.innerWidth) ? r.right + 10 : Math.max(6, r.left - pw - 10);
        var top  = Math.min(Math.max(6, r.top - 6), window.innerHeight - ph - 6);
        cpModal.style.left = left + 'px'; cpModal.style.top = top + 'px';
        if (cpFirst) { cpFirst = false; if (setMode) setMode(cpMode); }
      }
      function closePicker() {
        if (cpModal && cpModal.style.display === 'block') { cpModal.style.display = 'none'; return true; }
        return false;
      }
      closePickerFn = closePicker;
      function togglePicker() { if (cpModal && cpModal.style.display === 'block') closePicker(); else openPicker(); }
      swatch.addEventListener('click', function(e){ e.stopPropagation(); togglePicker(); });
      swval.addEventListener('click',  function(e){ e.stopPropagation(); togglePicker(); });

      // click outside the picker (and not the swatch) closes it
      docClickHandler = function(e){
        if (!cpModal || cpModal.style.display !== 'block') return;
        if (cpModal.contains(e.target) || e.target === swatch || e.target === swval) return;
        closePicker();
      };
      document.addEventListener('mousedown', docClickHandler, true);

      // position near the element, clamped to the viewport
      var r = el.getBoundingClientRect();
      var cw = card.offsetWidth || 236, ch = card.offsetHeight || 360;
      var x = Math.min(Math.max(6, r.left), window.innerWidth - cw - 6);
      var y = (r.bottom + 8 + ch <= window.innerHeight) ? r.bottom + 8 : Math.max(6, r.top - ch - 8);
      card.style.left = x + 'px'; card.style.top = y + 'px';
    }

    function send() {
      done({
        selector: getSelector(selEl),
        tag: selEl.tagName.toLowerCase(),
        property: prop,
        fromColor: fromHex,
        toColor: curHex.toUpperCase(),
        changed: curHex.toUpperCase() !== fromHex.toUpperCase(),
        pickedColor: pickedHex,
        instruction: instr ? instr.value.trim() : ''
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
