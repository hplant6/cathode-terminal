function getResizeScript() {
  return `(function() {
  ['__cr_ov','__cr_hv','__cr_hr'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  return new Promise(function(resolve) {
    var phase = 'hover';
    var selEl = null;
    var origRect = null;
    var origW = '', origH = '';
    var activeHandle = null;
    var drag = null;
    var rafId = null;
    var resolved = false;

    function done(val) {
      if (resolved) return;
      resolved = true;
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      var ov = document.getElementById('__cr_ov');
      var hv = document.getElementById('__cr_hv');
      var hr = document.getElementById('__cr_hr');
      if (ov) ov.remove();
      if (hv) hv.remove();
      if (hr) hr.remove();
      resolve(val);
    }

    // ── Hover overlay ─────────────────────────────────────────────────
    var ov = document.createElement('div');
    ov.id = '__cr_ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483645;cursor:crosshair;';
    document.body.appendChild(ov);

    var hv = document.createElement('div');
    hv.id = '__cr_hv';
    hv.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;' +
      'border:2px solid #4a9eff;background:rgba(74,158,255,.07);box-sizing:border-box;display:none;' +
      'border-radius:2px;transition:all 40ms;';
    document.body.appendChild(hv);

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
      if (e.key === 'Escape') { revert(); done(null); }
      // Don't intercept Enter when typing in the textarea
      if (e.key === 'Enter' && phase === 'selected' && document.activeElement !== instrInput) {
        e.preventDefault(); apply();
      }
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
      hv.style.display = 'none';
      ov.style.cursor = 'default';
      ov.style.pointerEvents = 'none';
      buildUI();
      rafId = requestAnimationFrame(rafLoop);
    }

    // ── Handles UI ───────────────────────────────────────────────────
    var hr = null;
    var sizeLabel = null;
    var toolbar = null;
    var instrInput = null;

    function buildUI() {
      if (hr) hr.remove();
      hr = document.createElement('div');
      hr.id = '__cr_hr';
      hr.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:visible;';
      document.body.appendChild(hr);

      // Selection box outline
      var box = document.createElement('div');
      box.id = '__cr_box';
      box.style.cssText = 'position:absolute;border:1.5px solid #4a9eff;box-sizing:border-box;pointer-events:none;';
      hr.appendChild(box);

      // 8 resize handles: all corners + edge midpoints
      var handles = [
        { id: 'nw', cursor: 'nw-resize' },
        { id: 'n',  cursor: 'n-resize'  },
        { id: 'ne', cursor: 'ne-resize' },
        { id: 'e',  cursor: 'e-resize'  },
        { id: 'se', cursor: 'se-resize' },
        { id: 's',  cursor: 's-resize'  },
        { id: 'sw', cursor: 'sw-resize' },
        { id: 'w',  cursor: 'w-resize'  },
      ];
      handles.forEach(function(def) {
        var h = document.createElement('div');
        h.dataset.h = def.id;
        h.style.cssText = 'position:absolute;width:10px;height:10px;background:#fff;border:1.5px solid #4a9eff;' +
          'border-radius:2px;box-sizing:border-box;pointer-events:auto;cursor:' + def.cursor + ';';
        h.addEventListener('mousedown', function(e) { startDrag(e, def.id); }, true);
        box.appendChild(h);
      });

      // Toolbar card
      toolbar = document.createElement('div');
      toolbar.id = '__cr_tb';
      toolbar.style.cssText = 'position:absolute;pointer-events:auto;background:#1e1e1e;border:1px solid #333;' +
        'border-radius:6px;display:flex;flex-direction:column;overflow:hidden;' +
        'font:12px/1.4 system-ui,sans-serif;color:#ccc;user-select:none;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.7);min-width:260px;';

      // Top row: size label | Add Instructions  Reset  Cancel
      var topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;padding:6px 8px;';

      sizeLabel = document.createElement('span');
      sizeLabel.style.cssText = 'font-variant-numeric:tabular-nums;flex:1;display:inline-block;';
      topRow.appendChild(sizeLabel);

      var sep = document.createElement('span');
      sep.textContent = '|'; sep.style.opacity = '0.3';
      topRow.appendChild(sep);

      // Drawer (instructions textarea only — no button inside)
      var drawerOpen = false;
      var drawerEl = document.createElement('div');
      drawerEl.style.cssText = 'display:none;flex-direction:column;padding:0 8px 8px;border-top:1px solid #2a2a2a;';

      var toggleBtn = mkBtn('▸ Add Instructions', '#888', function() {
        drawerOpen = !drawerOpen;
        toggleBtn.textContent = (drawerOpen ? '▾' : '▸') + ' Add Instructions';
        toggleBtn.style.color = drawerOpen ? '#4a9eff' : '#888';
        drawerEl.style.display = drawerOpen ? 'flex' : 'none';
        if (drawerOpen && instrInput) { setTimeout(function(){ instrInput.focus(); }, 0); }
      });
      topRow.appendChild(toggleBtn);

      // Reset: restores original dimensions without closing the tool
      topRow.appendChild(mkSolidBtn('Reset',  function() {
        if (selEl) { selEl.style.width = origW; selEl.style.height = origH; }
      }));
      topRow.appendChild(mkSolidBtn('Cancel', function() { revert(); done(null); }));
      toolbar.appendChild(topRow);

      // Drawer: textarea only
      instrInput = document.createElement('textarea');
      instrInput.placeholder = 'Additional instructions';
      instrInput.rows = 3;
      instrInput.style.cssText = 'background:#252525;border:1px solid #3a3a3a;border-radius:3px;' +
        'color:#ccc;font:12px/1.5 system-ui,sans-serif;padding:5px 8px;outline:none;' +
        'width:100%;box-sizing:border-box;resize:vertical;min-height:56px;margin-top:8px;';
      instrInput.addEventListener('focus', function() { instrInput.style.borderColor = '#4a9eff55'; });
      instrInput.addEventListener('blur',  function() { instrInput.style.borderColor = '#3a3a3a'; });
      drawerEl.appendChild(instrInput);
      toolbar.appendChild(drawerEl);

      // Bottom bar: Request a Change — always visible, full width
      var bottomBar = document.createElement('div');
      bottomBar.style.cssText = 'padding:6px 8px;border-top:1px solid #2a2a2a;';
      var applyBtn = document.createElement('button');
      applyBtn.textContent = 'Request a Change';
      applyBtn.style.cssText = 'width:100%;box-sizing:border-box;background:#4a9eff1a;' +
        'border:1px solid #4a9eff55;border-radius:3px;color:#4a9eff;padding:5px 0;' +
        'font:12px/1.4 system-ui,sans-serif;cursor:pointer;';
      applyBtn.addEventListener('click', function(e) { e.stopPropagation(); apply(); });
      bottomBar.appendChild(applyBtn);
      toolbar.appendChild(bottomBar);

      hr.appendChild(toolbar);

      positionAll();
    }

    function mkBtn(text, color, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'background:transparent;border:1px solid ' + color + '55;border-radius:3px;' +
        'color:' + color + ';padding:1px 9px;font:11px/1.6 system-ui,sans-serif;cursor:pointer;';
      b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
      return b;
    }

    function mkSolidBtn(text, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'background:#2e2e2e;border:1px solid #555;border-radius:3px;' +
        'color:#ccc;padding:2px 10px;font:11px/1.6 system-ui,sans-serif;cursor:pointer;';
      b.addEventListener('mouseover', function() { b.style.background = '#3a3a3a'; b.style.color = '#fff'; });
      b.addEventListener('mouseout',  function() { b.style.background = '#2e2e2e'; b.style.color = '#ccc'; });
      b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
      return b;
    }

    function positionAll() {
      if (!selEl || !hr) return;
      var r = selEl.getBoundingClientRect();

      var box = document.getElementById('__cr_box');
      if (box) {
        box.style.left   = r.left   + 'px';
        box.style.top    = r.top    + 'px';
        box.style.width  = r.width  + 'px';
        box.style.height = r.height + 'px';

        var mid = { x: Math.round(r.width / 2), y: Math.round(r.height / 2) };
        var pos = {
          nw: [-5,           -5          ],
          n:  [mid.x - 5,    -5          ],
          ne: [r.width - 5,  -5          ],
          e:  [r.width - 5,  mid.y - 5   ],
          se: [r.width - 5,  r.height - 5],
          s:  [mid.x - 5,    r.height - 5],
          sw: [-5,           r.height - 5],
          w:  [-5,           mid.y - 5   ],
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
        sizeLabel.textContent = ws + ' \xd7 ' + hs;
      }

      if (toolbar) {
        var toolH = toolbar.offsetHeight || 36;
        var tTop = r.top >= toolH + 8 ? r.top - toolH - 5 : r.bottom + 5;
        toolbar.style.left = Math.max(4, r.left) + 'px';
        toolbar.style.top  = tTop + 'px';
      }
    }

    function rafLoop() {
      positionAll();
      rafId = requestAnimationFrame(rafLoop);
    }

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

    // ── Selector helper ───────────────────────────────────────────────
    function getSelector(el) {
      if (el.id) return '#' + el.id;
      var parts = [];
      var cur = el;
      for (var i = 0; i < 4 && cur && cur.tagName && cur !== document.documentElement; i++) {
        var p = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
          var cls = cur.className.trim().split(/\\s+/).filter(function(c){ return c && !c.startsWith('__cr'); }).slice(0, 2);
          if (cls.length) p += '.' + cls.join('.');
        }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    // ── Revert inline styles ──────────────────────────────────────────
    function revert() {
      if (selEl) { selEl.style.width = origW; selEl.style.height = origH; }
    }

    // ── Apply ─────────────────────────────────────────────────────────
    function apply() {
      if (!selEl) { done(null); return; }
      var r = selEl.getBoundingClientRect();
      var nW = Math.round(r.width),       nH = Math.round(r.height);
      var oW = Math.round(origRect.width), oH = Math.round(origRect.height);
      var instructions = instrInput ? instrInput.value.trim() : '';
      if (Math.abs(nW - oW) < 2 && Math.abs(nH - oH) < 2 && !instructions) { done(null); return; }
      var snippet = selEl.outerHTML.replace(/\\n/g,' ').replace(/\\s{2,}/g,' ').slice(0, 160);
      done({ selector: getSelector(selEl), tag: selEl.tagName.toLowerCase(), snippet: snippet, oW: oW, oH: oH, nW: nW, nH: nH, instructions: instructions });
    }
  });
})()`;
}

module.exports = { getResizeScript };
