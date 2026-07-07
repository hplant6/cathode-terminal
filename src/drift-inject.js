// Design-drift scanner — injected into the browsed page.
// Phase 1 (colors): discovers the design system's color tokens from :root CSS
// custom properties, then flags element colors that are a near-miss to a token
// (a hard-coded value that *should* be the token) — i.e. design drift. Marks each
// on the page and hands the findings to the left-column panel. Resolves with
// { url, total, tokens, issues } on handoff, or null if cancelled.
const SHARED = require('./inject-shared');
const { Z } = require('./ui-constants');
const { ACCENT } = require('./inject-styles');

function getDriftScript() {
  return `(function() {
  var LAYER = '__drift_layer__';
  var old = document.getElementById(LAYER); if (old) old.remove();

  return new Promise(function(resolve) {
    var resolved = false, raf = null;
    function teardown() {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
      document.removeEventListener('keydown', onKey, true);
      var l = document.getElementById(LAYER); if (l) l.remove();
    }
    function onKey(e){ if (e.key === 'Escape' && !resolved) { teardown(); resolved = true; resolve(null); } }
    document.addEventListener('keydown', onKey, true);

${SHARED.colorHelpers}
${SHARED.selectorHelper('__drift')}

    function visible(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    // ── 1. Discover color tokens (:root custom properties that resolve to colors) ──
    var tokens = [];   // { name, rgb, hex }
    (function() {
      var names = {};
      for (var s = 0; s < document.styleSheets.length; s++) {
        var rules; try { rules = document.styleSheets[s].cssRules; } catch (e) { continue; }   // cross-origin sheet
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          var st = rules[r].style; if (!st) continue;
          for (var p = 0; p < st.length; p++) { var nm = st[p]; if (nm.indexOf('--') === 0) names[nm] = 1; }
        }
      }
      var rootCS = getComputedStyle(document.documentElement);
      for (var name in names) {
        var val = (rootCS.getPropertyValue(name) || '').trim();
        var rgb = parseRGB(val) || (val.charAt(0) === '#' ? hexToRgb(val) : null);
        if (rgb && rgb.a > 0) tokens.push({ name: name, rgb: rgb, hex: toHex(rgb.r, rgb.g, rgb.b) });
      }
    })();

    function nearestToken(rgb) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < tokens.length; i++) { var d = dist(rgb, tokens[i].rgb); if (d < bestD) { bestD = d; best = tokens[i]; } }
      return best ? { token: best, d: bestD } : null;
    }

    // ── 2. Scan elements for drifted colors ──
    var NEAR = 14;   // RGB distance: within this of a token (but not exact) → "you meant this token"
    var issues = [], CAP = 120, seen = {};
    var PROPS = [ { css: 'color', k: 'text' }, { css: 'background-color', k: 'bg' }, { css: 'border-top-color', k: 'border' } ];
    var all = tokens.length && document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && issues.length < CAP; i++) {
      var el = all[i]; if (!visible(el)) continue;
      var cs = getComputedStyle(el);
      for (var pi = 0; pi < PROPS.length; pi++) {
        if (PROPS[pi].k === 'border' && (parseFloat(cs.borderTopWidth) || 0) === 0) continue;   // no visible border
        var rgb = parseRGB(cs.getPropertyValue(PROPS[pi].css)); if (!rgb || rgb.a === 0) continue;
        var near = nearestToken(rgb);
        if (!near || near.d === 0 || near.d > NEAR) continue;   // no tokens / exact (on-palette) / far (off-palette, skip)
        var hex = toHex(rgb.r, rgb.g, rgb.b);
        var key = getSelector(el) + '|' + PROPS[pi].css + '|' + hex;
        if (seen[key]) continue; seen[key] = 1;
        issues.push({ el: el, prop: PROPS[pi].css, k: PROPS[pi].k, hex: hex, token: near.token.name, tokenHex: near.token.hex, d: Math.round(near.d) });
      }
    }

    // ── 3. Markers on the page (mirror the a11y overlay) ──
    var layer = document.createElement('div');
    layer.id = LAYER;
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:${Z.OVERLAY_MID};';
    (document.body || document.documentElement).appendChild(layer);
    issues.forEach(function(iss, i) {
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;box-sizing:border-box;border:2px solid ${ACCENT};border-radius:2px;pointer-events:none;transition:background .1s;';
      var badge = document.createElement('div');
      badge.textContent = (i + 1);
      badge.style.cssText = 'position:absolute;top:-12px;left:-4px;min-width:24px;height:24px;padding:0 5px;box-sizing:border-box;background:${ACCENT};color:#fff;font:700 12px/24px system-ui,sans-serif;text-align:center;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.55);';
      b.appendChild(badge); layer.appendChild(b); iss.marker = b;
    });
    function position() {
      raf = null;
      issues.forEach(function(iss) {
        var r = iss.el.getBoundingClientRect(), m = iss.marker;
        if ((r.width < 1 && r.height < 1) || r.bottom < 0 || r.top > window.innerHeight) { m.style.display = 'none'; return; }
        m.style.display = ''; m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; m.style.width = r.width + 'px'; m.style.height = r.height + 'px';
      });
    }
    function onScroll(){ if (!raf) raf = requestAnimationFrame(position); }
    position();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    function flash(iss) {
      if (!iss.marker) return;
      iss.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      iss.marker.style.background = 'rgba(255,255,255,.18)';
      setTimeout(function(){ iss.marker.style.background = ''; }, 700);
    }

    // ── 4. Handoff to the left-column panel ──
    var serial = issues.map(function(iss, i) {
      return { idx: i, prop: iss.prop, k: iss.k, hex: iss.hex, token: iss.token, tokenHex: iss.tokenHex, d: iss.d, selector: getSelector(iss.el) };
    });
    window.__cathodeDrift = {
      flash: function(idx){ var iss = issues[idx]; if (iss) flash(iss); },
      // Live-preview the fix by pointing the property at the token.
      apply: function(idx){ var iss = issues[idx]; if (iss) iss.el.style.setProperty(iss.prop, 'var(' + iss.token + ')', 'important'); },
      unapply: function(idx){ var iss = issues[idx]; if (iss) iss.el.style.setProperty(iss.prop, iss.hex, 'important'); },
      clear: function(){ resolved = true; teardown(); window.__cathodeDrift = null; },
    };
    resolved = true;
    resolve({ url: location.href, total: issues.length, tokens: tokens.length, issues: serial });
  });
})()`;
}

module.exports = { getDriftScript };
