// Accessibility / contrast checker — injected into the browsed page.
// Scans for WCAG AA contrast failures and common a11y problems (missing alt,
// unlabeled controls, empty controls), marks each on the page, and shows a
// results panel. Resolves with { issues, url, total } on "Send" or null.
function getA11yScript() {
  return `(function() {
  ['__a11y_layer__','__a11y_panel__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  return new Promise(function(resolve) {
    var resolved = false;
    var raf = null;

    function done(val) {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
      document.removeEventListener('keydown', onKey, true);
      ['__a11y_layer__','__a11y_panel__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      resolve(val);
    }
    function onKey(e){ if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onKey, true);

    // ── Color / contrast helpers (WCAG) ───────────────────────────────
    function parseColor(str) {
      var m = (str || '').match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      var p = m[1].split(',').map(parseFloat);
      if (p.length < 3) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
    function ratio(a, b) { var L1 = lum(a), L2 = lum(b); var hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }
    function over(fg, bg) { var a = fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
    function hex(c) { return '#' + [c.r, c.g, c.b].map(function(v){ return ('0' + Math.round(v).toString(16)).slice(-2); }).join('').toUpperCase(); }

    // The solid color behind an element's text, or null if indeterminate
    // (a background image/gradient sits behind it).
    function effectiveBg(el) {
      var cur = el, stack = [];
      while (cur && cur.nodeType === 1) {
        var cs = getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        var bg = parseColor(cs.backgroundColor);
        if (bg && bg.a > 0) { stack.push(bg); if (bg.a >= 1) break; }
        cur = cur.parentElement;
      }
      var result = { r: 255, g: 255, b: 255, a: 1 };
      for (var i = stack.length - 1; i >= 0; i--) result = over(stack[i], result);
      return result;
    }

    // ── DOM helpers ───────────────────────────────────────────────────
    function hasText(el) {
      for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) return true; }
      return false;
    }
    function visible(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }
    function getSelector(el) {
      if (el.id) return '#' + el.id;
      var parts = [], cur = el;
      for (var i = 0; i < 4 && cur && cur.tagName && cur !== document.documentElement; i++) {
        var p = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
          var cls = cur.className.trim().split(/\\s+/).filter(function(c){ return c && c.indexOf('__a11y') !== 0; }).slice(0, 2);
          if (cls.length) p += '.' + cls.join('.');
        }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
    function accName(el) {
      var al = el.getAttribute('aria-label'); if (al && al.trim()) return true;
      var lb = el.getAttribute('aria-labelledby'); if (lb && document.getElementById(lb.split(' ')[0])) return true;
      var ti = el.getAttribute('title'); if (ti && ti.trim()) return true;
      if (el.id) { try { if (document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]')) return true; } catch (e) {} }
      if (el.closest && el.closest('label')) return true;
      if (el.textContent && el.textContent.trim()) return true;
      var img = el.querySelector && el.querySelector('img[alt]'); if (img && img.getAttribute('alt').trim()) return true;
      return false;
    }

    // ── Scan ──────────────────────────────────────────────────────────
    var issues = [];   // { el, cat, label, detail, color }
    var CAP = 100;
    var COLORS = { contrast: '#f59e0b', alt: '#ef4444', label: '#ef4444', name: '#ef4444' };
    var LABELS = { contrast: 'Contrast', alt: 'Missing alt text', label: 'Unlabeled control', name: 'Empty control' };
    var BADGE  = { contrast: 'Low contrast', alt: 'Missing alt', label: 'No label', name: 'No name' };

    function add(el, cat, detail, extra) {
      if (issues.length >= CAP) return;
      var iss = { el: el, cat: cat, label: LABELS[cat], detail: detail, color: COLORS[cat] };
      if (extra) for (var k in extra) iss[k] = extra[k];
      issues.push(iss);
    }
    function hexToRgb(h) {
      var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null;
      var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }

    // Contrast: every visible text-bearing element vs its effective background.
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && issues.length < CAP; i++) {
      var el = all[i];
      if (!hasText(el) || !visible(el)) continue;
      var cs = getComputedStyle(el);
      var fg = parseColor(cs.color); if (!fg) continue;
      var bg = effectiveBg(el); if (!bg) continue;            // over an image → skip
      if (fg.a < 1) fg = over(fg, bg);
      var fs = parseFloat(cs.fontSize) || 16;
      var bold = cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 700;
      var large = fs >= 24 || (fs >= 18.66 && bold);
      var need = large ? 3 : 4.5;
      var cr = ratio(fg, bg);
      if (cr < need) {
        add(el, 'contrast', cr.toFixed(2) + ':1, needs ' + need + ':1', { fgHex: hex(fg), bgHex: hex(bg), need: need });
      }
    }

    // Images without an alt attribute.
    document.querySelectorAll('img:not([alt])').forEach(function(el){ if (visible(el)) add(el, 'alt', el.currentSrc || el.src || ''); });

    // Form controls with no accessible name.
    document.querySelectorAll('input,select,textarea').forEach(function(el){
      var t = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden','submit','reset','button','image'].indexOf(t) !== -1) return;
      if (visible(el) && !accName(el)) add(el, 'label', el.tagName.toLowerCase() + (t ? '[type=' + t + ']' : ''));
    });

    // Buttons / links with no accessible name.
    document.querySelectorAll('button,a[href],[role=button]').forEach(function(el){
      if (visible(el) && !accName(el)) add(el, 'name', el.tagName.toLowerCase());
    });

    // ── Markers on the page ───────────────────────────────────────────
    var layer = document.createElement('div');
    layer.id = '__a11y_layer__';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    document.body.appendChild(layer);

    issues.forEach(function(iss, i){
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;box-sizing:border-box;border:2px solid ' + iss.color + ';'
        + 'border-radius:2px;pointer-events:none;transition:background .1s;';
      var badge = document.createElement('div');
      badge.textContent = (i + 1);
      badge.style.cssText = 'position:absolute;top:-9px;left:-2px;min-width:15px;height:15px;padding:0 3px;'
        + 'box-sizing:border-box;background:' + iss.color + ';color:#0a0a0a;font:700 10px/15px system-ui,sans-serif;'
        + 'text-align:center;border-radius:3px;';
      b.appendChild(badge);
      layer.appendChild(b);
      iss.marker = b;
    });

    function position() {
      raf = null;
      issues.forEach(function(iss){
        var r = iss.el.getBoundingClientRect();
        var m = iss.marker;
        if ((r.width < 1 && r.height < 1) || r.bottom < 0 || r.top > window.innerHeight) { m.style.display = 'none'; return; }
        m.style.display = '';
        m.style.left = r.left + 'px'; m.style.top = r.top + 'px';
        m.style.width = r.width + 'px'; m.style.height = r.height + 'px';
      });
    }
    function onScroll(){ if (!raf) raf = requestAnimationFrame(position); }
    position();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);

    function flash(iss){
      if (!iss.marker) return;
      iss.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var m = iss.marker;
      m.style.background = 'rgba(255,255,255,.18)';
      setTimeout(function(){ m.style.background = ''; }, 700);
    }

    // ── Results panel ─────────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id = '__a11y_panel__';
    panel.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;width:300px;max-height:80vh;'
      + 'display:flex;flex-direction:column;background:#080808;border:1px solid #222;border-radius:6px;overflow:hidden;'
      + 'box-shadow:0 16px 56px rgba(0,0,0,.92),0 0 0 1px rgba(255,255,255,.04);'
      + "font-family:Consolas,'Courier New',monospace;color:#888;user-select:none;";

    var byCat = {};
    issues.forEach(function(iss, i){ (byCat[iss.cat] = byCat[iss.cat] || []).push(i); });
    var order = ['contrast','alt','label','name'];

    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    var inStyle = 'background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;font:11px Consolas,monospace;padding:4px 7px;outline:none;';
    function colorRow(label, cid, hid, val) {
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">'
        + '<span style="width:72px;flex-shrink:0;font-size:10.5px;color:#888;font-family:system-ui,sans-serif;">' + label + '</span>'
        + '<label style="position:relative;width:20px;height:20px;border-radius:4px;flex-shrink:0;border:1px solid rgba(255,255,255,.2);overflow:hidden;cursor:pointer;background:' + val + ';">'
          + '<input type="color" id="' + cid + '" value="' + val.toLowerCase() + '" style="position:absolute;inset:-3px;width:160%;height:160%;border:none;padding:0;cursor:pointer;">'
        + '</label>'
        + '<input type="text" id="' + hid + '" value="' + val + '" spellcheck="false" style="flex:1;min-width:0;' + inStyle + 'letter-spacing:.05em;">'
      + '</div>';
    }
    function descFor(iss) {
      if (iss.cat === 'contrast') return 'Text and background fall below the WCAG AA contrast minimum of ' + iss.need + ':1. Adjust the colors below until it passes.';
      if (iss.cat === 'alt')   return 'This image has no alt attribute, so screen readers cannot describe it. Add concise alt text — or empty alt if it is purely decorative.';
      if (iss.cat === 'label') return 'This control has no accessible name (no label, aria-label, or title), so assistive tech cannot tell users what it is for.';
      if (iss.cat === 'name')  return 'This button or link has no text or accessible name, so screen readers announce it with nothing to describe it.';
      return '';
    }
    function placeholderFor(iss) {
      if (iss.cat === 'alt')      return 'What does this image show?';
      if (iss.cat === 'label')    return 'What is this control for?';
      if (iss.cat === 'name')     return 'What should this control say?';
      if (iss.cat === 'contrast') return 'Any notes on the color fix?';
      return 'Instructions';
    }

    var rows = '';
    if (!issues.length) {
      rows = '<div style="padding:22px 16px;text-align:center;color:#5a5a5a;font-size:12px;">No contrast or a11y issues found.</div>';
    } else {
      order.forEach(function(cat){
        var list = byCat[cat]; if (!list) return;
        rows += '<div style="padding:9px 14px 4px;font-family:system-ui,-apple-system,sans-serif;font-size:9px;font-weight:700;'
          + 'letter-spacing:.12em;text-transform:uppercase;color:#666;">' + LABELS[cat] + ' (' + list.length + ')</div>';
        list.forEach(function(idx){
          var iss = issues[idx];
          var bodyInner = '<div style="font-size:10.5px;line-height:1.5;color:#8a8a8a;font-family:system-ui,-apple-system,sans-serif;margin-bottom:10px;">' + descFor(iss) + '</div>';
          if (iss.cat === 'contrast') {
            bodyInner += colorRow('Text', '__a11y_fg_' + idx, '__a11y_fgh_' + idx, iss.fgHex)
              + colorRow('Background', '__a11y_bg_' + idx, '__a11y_bgh_' + idx, iss.bgHex)
              + '<div id="__a11y_ratio_' + idx + '" style="font-size:10.5px;font-family:system-ui,sans-serif;margin:1px 0 9px;"></div>';
          }
          bodyInner += '<textarea id="__a11y_note_' + idx + '" rows="2" placeholder="' + placeholderFor(iss) + '" style="width:100%;box-sizing:border-box;' + inStyle + 'resize:vertical;line-height:1.4;"></textarea>';
          rows += '<div class="__a11y_issue">'
            + '<div class="__a11y_head" data-i="' + idx + '" style="display:flex;gap:8px;padding:6px 14px;cursor:pointer;align-items:flex-start;">'
              + '<input type="checkbox" class="__a11y_cb" data-i="' + idx + '" checked style="flex-shrink:0;margin:0;width:13px;height:13px;accent-color:#4a9eff;cursor:pointer;position:relative;top:1px;">'
              + '<span style="flex-shrink:0;width:15px;height:15px;border-radius:3px;background:' + iss.color + ';color:#0a0a0a;font:700 9px/15px system-ui,sans-serif;text-align:center;">' + (idx + 1) + '</span>'
              + '<div style="min-width:0;flex:1;">'
                + '<div style="display:flex;align-items:center;gap:6px;">'
                  + '<span style="flex:1;min-width:0;color:#bbb;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(iss.detail) + '</span>'
                  + '<span style="flex-shrink:0;font:700 8.5px/1.5 system-ui,-apple-system,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:' + iss.color + ';background:' + iss.color + '1f;border:1px solid ' + iss.color + '4d;border-radius:3px;padding:0 5px;">' + BADGE[iss.cat] + '</span>'
                + '</div>'
                + '<div style="color:#666;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + esc(getSelector(iss.el)) + '">' + esc(getSelector(iss.el)) + '</div>'
              + '</div>'
              + '<svg id="__a11y_chev_' + idx + '" width="9" height="9" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;margin-top:3px;transition:transform .15s;"><polyline points="3,1.5 6.5,5 3,8.5" stroke="#666" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>'
            + '</div>'
            + '<div class="__a11y_body" id="__a11y_body_' + idx + '" style="display:none;padding:4px 14px 12px 37px;background:#18181b;">' + bodyInner + '</div>'
          + '</div>';
        });
      });
    }

    panel.innerHTML =
      '<div id="__a11y_tb__" style="display:flex;align-items:center;padding:10px 14px 6px;cursor:grab;flex-shrink:0;">'
        + "<span style=\\"flex:1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fff;\\">Accessibility</span>"
        + '<button id="__a11y_close__" title="Close" style="background:none;border:none;color:#444;font-size:13px;cursor:pointer;padding:2px 4px;border-radius:3px;line-height:1;">\\u2715</button>'
      + '</div>'
      + "<div style=\\"padding:0 14px 9px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:10.5px;line-height:1.45;color:#777;flex-shrink:0;\\">Scans this page for WCAG AA contrast failures and missing accessible names. Tick the issues to send; expand any for details and to fix contrast.</div>"
      + (issues.length ? '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 14px 9px;flex-shrink:0;font-family:system-ui,-apple-system,sans-serif;">'
          + '<span style="font-size:10px;color:#666;">' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') + ' found</span>'
          + '<button id="__a11y_toggleall__" style="background:none;border:none;color:#4a9eff;font:600 10.5px system-ui,sans-serif;cursor:pointer;padding:0;">Deselect all</button>'
        + '</div>' : '')
      + '<div style="height:1px;background:#1c1c1c;flex-shrink:0;"></div>'
      + '<div id="__a11y_list__" style="overflow-y:auto;flex:1;">' + rows + '</div>'
      + (issues.length ? '<div style="height:1px;background:#1c1c1c;flex-shrink:0;"></div>'
        + '<div style="padding:8px 10px;flex-shrink:0;"><button id="__a11y_send__" style="width:100%;box-sizing:border-box;'
        + 'background:rgba(74,158,255,.16);border:1px solid rgba(74,158,255,.5);color:#4a9eff;border-radius:5px;'
        + "padding:7px 0;font:600 12px system-ui,sans-serif;cursor:pointer;\\">Send " + issues.length + ' to chat</button></div>' : '');

    document.body.appendChild(panel);

    var listEl = panel.querySelector('#__a11y_list__');
    var sendBtn = panel.querySelector('#__a11y_send__');
    var toggleAll = panel.querySelector('#__a11y_toggleall__');

    function checkedCount(){ return panel.querySelectorAll('.__a11y_cb:checked').length; }
    function updateSend(){
      var n = checkedCount();
      if (sendBtn) {
        sendBtn.textContent = 'Send ' + n + ' to chat';
        sendBtn.disabled = n === 0;
        sendBtn.style.opacity = n === 0 ? '0.45' : '';
        sendBtn.style.cursor = n === 0 ? 'default' : 'pointer';
      }
      if (toggleAll) toggleAll.textContent = (n === 0) ? 'Select all' : 'Deselect all';
    }

    // checkboxes + select/deselect all
    panel.querySelectorAll('.__a11y_cb').forEach(function(cb){
      cb.addEventListener('click', function(e){ e.stopPropagation(); });
      cb.addEventListener('change', updateSend);
    });
    if (toggleAll) toggleAll.addEventListener('click', function(){
      var on = checkedCount() === 0;                 // none checked → select all, else deselect all
      panel.querySelectorAll('.__a11y_cb').forEach(function(cb){ cb.checked = on; });
      updateSend();
    });

    // drawers + per-issue color editing
    function wirePair(colorEl, hexEl, swatch, apply, onChange){
      function set(v, fromPicker){
        swatch.style.background = v;
        if (fromPicker) hexEl.value = v.toUpperCase(); else { try { colorEl.value = v.toLowerCase(); } catch(e){} }
        apply(v); onChange();
      }
      colorEl.addEventListener('click', function(e){ e.stopPropagation(); });
      colorEl.addEventListener('input', function(e){ e.stopPropagation(); set(colorEl.value, true); });
      hexEl.addEventListener('click', function(e){ e.stopPropagation(); });
      hexEl.addEventListener('input', function(e){
        e.stopPropagation();
        var v = hexEl.value.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(v)) { if (v[0] !== '#') v = '#' + v; set(v, false); }
      });
    }
    issues.forEach(function(iss, idx){
      var head = panel.querySelector('.__a11y_head[data-i="' + idx + '"]');
      var body = panel.querySelector('#__a11y_body_' + idx);
      var chev = panel.querySelector('#__a11y_chev_' + idx);
      var note = panel.querySelector('#__a11y_note_' + idx);
      if (note) note.addEventListener('click', function(e){ e.stopPropagation(); });
      var open = false;
      head.addEventListener('mouseover', function(){ head.style.background = open ? '#1f1f23' : '#121212'; if (iss.marker) iss.marker.style.background = 'rgba(255,255,255,.16)'; });
      head.addEventListener('mouseout',  function(){ head.style.background = open ? '#18181b' : ''; if (iss.marker) iss.marker.style.background = ''; });
      head.addEventListener('click', function(e){
        if (e.target.closest('.__a11y_cb')) return;
        open = !open;
        body.style.display = open ? '' : 'none';
        head.style.background = open ? '#18181b' : '';
        if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
        if (open) flash(iss);
      });
      if (iss.cat === 'contrast') {
        var fgC = panel.querySelector('#__a11y_fg_' + idx), fgH = panel.querySelector('#__a11y_fgh_' + idx);
        var bgC = panel.querySelector('#__a11y_bg_' + idx), bgH = panel.querySelector('#__a11y_bgh_' + idx);
        var ratioEl = panel.querySelector('#__a11y_ratio_' + idx);
        var recompute = function(){
          var f = hexToRgb(fgH.value), b = hexToRgb(bgH.value);
          if (!f || !b) { ratioEl.textContent = ''; return; }
          var cr = ratio(f, b), pass = cr >= iss.need;
          ratioEl.innerHTML = '<span style="color:' + (pass ? '#4ade80' : '#f59e0b') + ';">' + cr.toFixed(2) + ':1 — ' + (pass ? 'Passes AA' : 'Fails AA') + '</span>';
        };
        wirePair(fgC, fgH, fgC.parentElement, function(v){ iss.el.style.setProperty('color', v, 'important'); }, recompute);
        wirePair(bgC, bgH, bgC.parentElement, function(v){ iss.el.style.setProperty('background-color', v, 'important'); }, recompute);
        recompute();
      }
    });
    updateSend();

    // Cap the list to ~5 issue rows (+100px of breathing room); scroll beyond.
    var headEls = panel.querySelectorAll('.__a11y_head');
    if (headEls.length > 5) {
      var listTop = listEl.getBoundingClientRect().top;
      listEl.style.maxHeight = (Math.ceil(headEls[4].getBoundingClientRect().bottom - listTop) + 100) + 'px';
    }

    var closeBtn = panel.querySelector('#__a11y_close__');
    closeBtn.addEventListener('mouseover', function(){ closeBtn.style.background = '#2a2a2a'; closeBtn.style.color = '#ccc'; });
    closeBtn.addEventListener('mouseout',  function(){ closeBtn.style.background = 'none'; closeBtn.style.color = '#444'; });
    closeBtn.addEventListener('click', function(){ done(null); });

    if (sendBtn) sendBtn.addEventListener('click', function(){
      if (sendBtn.disabled) return;
      var sel = [];
      panel.querySelectorAll('.__a11y_cb:checked').forEach(function(cb){
        var idx = +cb.dataset.i, iss = issues[idx];
        var noteEl = panel.querySelector('#__a11y_note_' + idx);
        var o = { category: iss.label, selector: getSelector(iss.el), detail: iss.detail, instruction: noteEl ? noteEl.value.trim() : '' };
        if (iss.cat === 'contrast') {
          var fgH = panel.querySelector('#__a11y_fgh_' + idx), bgH = panel.querySelector('#__a11y_bgh_' + idx);
          o.fromText = iss.fgHex; o.fromBg = iss.bgHex;
          o.toText = fgH ? fgH.value.toUpperCase() : iss.fgHex;
          o.toBg = bgH ? bgH.value.toUpperCase() : iss.bgHex;
        }
        sel.push(o);
      });
      if (!sel.length) return;
      done({ url: location.href, total: sel.length, issues: sel });
    });

    // drag the panel by its titlebar
    var tb = panel.querySelector('#__a11y_tb__');
    tb.addEventListener('mousedown', function(e){
      if (e.target.closest('#__a11y_close__')) return;
      e.preventDefault();
      var rc = panel.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.left = rc.left + 'px'; panel.style.top = rc.top + 'px';
      var ox = e.clientX - rc.left, oy = e.clientY - rc.top;
      tb.style.cursor = 'grabbing';
      function mv(ev){
        var nx = Math.min(Math.max(2, ev.clientX - ox), window.innerWidth - panel.offsetWidth - 2);
        var ny = Math.min(Math.max(2, ev.clientY - oy), window.innerHeight - panel.offsetHeight - 2);
        panel.style.left = nx + 'px'; panel.style.top = ny + 'px';
      }
      function up(){ tb.style.cursor = 'grab'; document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); }
      document.addEventListener('mousemove', mv, true);
      document.addEventListener('mouseup', up, true);
    });
  });
})()`;
}

module.exports = { getA11yScript };
