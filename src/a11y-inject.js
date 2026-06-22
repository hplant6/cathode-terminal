// Accessibility / contrast checker — injected into the browsed page.
// Scans for WCAG AA contrast failures and common a11y problems (missing alt,
// unlabeled controls, empty controls), marks each on the page, and shows a
// results panel. Resolves with { issues, url, total } on "Send" or null.
const SHARED = require('./inject-shared');

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
${SHARED.colorHelpers}

    // The solid color behind an element's text, or null if indeterminate
    // (a background image/gradient sits behind it).
    function effectiveBg(el) {
      var cur = el, stack = [];
      while (cur && cur.nodeType === 1) {
        var cs = getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        var bg = parseRGB(cs.backgroundColor);
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
${SHARED.selectorHelper('__a11y')}
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
    // Contrast: every visible text-bearing element vs its effective background.
    var all = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && issues.length < CAP; i++) {
      var el = all[i];
      if (!hasText(el) || !visible(el)) continue;
      var cs = getComputedStyle(el);
      var fg = parseRGB(cs.color); if (!fg) continue;
      var bg = effectiveBg(el); if (!bg) continue;            // over an image → skip
      if (fg.a < 1) fg = over(fg, bg);
      var fs = parseFloat(cs.fontSize) || 16;
      var bold = cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 700;
      var large = fs >= 24 || (fs >= 18.66 && bold);
      var need = large ? 3 : 4.5;
      var cr = ratio(fg, bg);
      if (cr < need) {
        add(el, 'contrast', cr.toFixed(2) + ':1, needs ' + need + ':1', { fgHex: toHex(fg.r, fg.g, fg.b), bgHex: toHex(bg.r, bg.g, bg.b), need: need });
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

    // ── Hand off to the left-column panel ─────────────────────────────
    // Markers stay on the page; the results list (drawers, color editing,
    // notes) lives in the column. window.__cathodeA11y applies live color
    // edits to the elements and tears everything down on send/cancel.
    var serial = issues.map(function(iss, i){
      var o = { idx: i, cat: iss.cat, label: iss.label, badge: BADGE[iss.cat], detail: iss.detail, selector: getSelector(iss.el) };
      if (iss.cat === 'contrast') { o.fgHex = iss.fgHex; o.bgHex = iss.bgHex; o.need = iss.need; }
      return o;
    });
    window.__cathodeA11y = {
      setColor: function(idx, which, hex){
        var iss = issues[idx]; if (!iss) return;
        if (which === 'text') iss.el.style.setProperty('color', hex, 'important');
        else if (which === 'bg') iss.el.style.setProperty('background-color', hex, 'important');
      },
      flash: function(idx){ var iss = issues[idx]; if (iss) flash(iss); },
      clear: function(){
        resolved = true;
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll, true);
        document.removeEventListener('keydown', onKey, true);
        ['__a11y_layer__','__a11y_panel__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
        window.__cathodeA11y = null;
      },
    };
    resolve({ url: location.href, total: issues.length, issues: serial });
  });
})()`;
}

module.exports = { getA11yScript };
