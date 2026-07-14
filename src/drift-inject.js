// Design-drift scanner — injected into the browsed page.
// Discovers the design system's tokens from :root CSS custom properties, then
// flags element values that are a near-miss to a token (a hard-coded value that
// *should* be the token) — i.e. design drift. Covers four categories:
//   • color   — text / background / border colors        (ΔRGB distance)
//   • type    — font-size                                 (px distance)
//   • radius  — uniform border-radius                     (px distance)
//   • shadow  — box-shadow                                (structural distance)
// Marks each on the page and hands the findings to the left-column panel.
// Resolves with { url, total, tokens, issues } on handoff, or null if cancelled.
const SHARED = require('./inject-shared');
const { Z } = require('./ui-constants');
const { ACCENT } = require('./inject-styles');

// `sbTokens` (optional) is a { '--name': 'value', … } map of design-system
// tokens pre-resolved from a connected Storybook's preview `:root`. When present
// they take priority over the scanned page's own `:root` custom properties, so
// drift snaps to the canonical design system rather than a page's local copy.
function getDriftScript(sbTokens) {
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

    // ── length + shadow parsing (computed styles resolve to px; token values
    //    may be authored in rem/em — normalise everything to px) ──
    var ROOTPX = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    function lenToPx(v) {
      var m = /^(-?[\\d.]+)(px|rem|em)?$/.exec((v || '').trim());
      if (!m) return null;
      var n = parseFloat(m[1]); if (isNaN(n)) return null;
      var u = m[2] || 'px';
      return u === 'px' ? n : (u === 'rem' || u === 'em') ? n * ROOTPX : null;
    }
    function colorOf(c) { if (!c) return null; return parseRGB(c) || (c.charAt(0) === '#' ? hexToRgb(c) : null); }
    function splitTop(str, sep) {   // split on top-level separators (comma outside parens)
      var out = [], depth = 0, cur = '';
      for (var i = 0; i < str.length; i++) {
        var c = str[i];
        if (c === '(') depth++; else if (c === ')') depth--;
        if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
      }
      if (cur.trim()) out.push(cur);
      return out;
    }
    function parseShadow(str) {
      if (!str || str === 'none') return null;
      var parts = splitTop(str, ',').map(function(s){ return s.trim(); }).filter(Boolean);
      if (!parts.length) return null;
      var layers = parts.map(function(s) {
        var inset = /\\binset\\b/i.test(s);
        var color = (s.match(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}\\b/i) || [''])[0];
        var rest  = s.replace(/rgba?\\([^)]*\\)/ig, '').replace(/#[0-9a-f]{3,8}\\b/ig, '').replace(/\\binset\\b/ig, '');
        var nums  = (rest.match(/-?[\\d.]+(?:px|rem|em)?/g) || []).map(function(t){ return lenToPx(t) || 0; });
        return { x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, color: color, inset: inset };
      });
      return layers.length ? layers : null;
    }
    function shadowDist(a, b) {
      if (!a || !b || a.length !== b.length) return Infinity;
      var total = 0;
      for (var i = 0; i < a.length; i++) {
        if (a[i].inset !== b[i].inset) return Infinity;
        total += Math.abs(a[i].x - b[i].x) + Math.abs(a[i].y - b[i].y) + Math.abs(a[i].blur - b[i].blur) + Math.abs(a[i].spread - b[i].spread);
        var ca = colorOf(a[i].color), cb = colorOf(b[i].color);
        if (ca && cb) total += dist(ca, cb) / 8;   // fold color delta into px-ish units
      }
      return total;
    }
    function fmtPx(n) { return (Math.round(n * 10) / 10) + 'px'; }

    // ── 1. Discover tokens, bucketed by category ──
    //    Value type decides color vs shadow vs length; among lengths, the token
    //    *name* decides radius vs type (so a radius never gets suggested for a
    //    font-size, and vice-versa — under-report before mis-suggesting).
    var tokens = { color: [], type: [], radius: [], shadow: [] };
    var seenNames = {};   // first accept wins → Storybook tokens (fed first) beat page copies
    function classifyLen(name) {
      if (/(radius|rounded|corner|-r-|blob|\\bround)/i.test(name)) return 'radius';
      if (/(font|text|type|leading|heading|display|title|caption|label|body|\\bfs\\b)/i.test(name)) return 'type';
      return null;   // spacing / generic length → out of scope
    }
    function addToken(name, val, source) {
      if (seenNames[name]) return;
      val = (val || '').trim(); if (!val) return;
      // Color: the *entire* value is a color literal (guarded so a shadow's
      // inner rgba() isn't mistaken for a color token).
      if (/^rgba?\\([^)]*\\)$/i.test(val) || /^#[0-9a-f]{3,8}$/i.test(val)) {
        var rgb = parseRGB(val) || hexToRgb(val);
        if (rgb && rgb.a > 0) { seenNames[name] = 1; tokens.color.push({ name: name, rgb: rgb, hex: toHex(rgb.r, rgb.g, rgb.b), val: val, source: source }); }
        return;
      }
      // Shadow: named like one, or structurally a shadow (lengths + a color).
      var sh = parseShadow(val);
      if (sh && (/(shadow|elevation|elevate)/i.test(name) || sh[0].color)) { seenNames[name] = 1; tokens.shadow.push({ name: name, layers: sh, val: val, source: source }); return; }
      // Length → radius or type, by name.
      var px = lenToPx(val);
      if (px != null) {
        var kind = classifyLen(name);
        if (kind === 'radius') { seenNames[name] = 1; tokens.radius.push({ name: name, px: px, val: val, source: source }); }
        else if (kind === 'type') { seenNames[name] = 1; tokens.type.push({ name: name, px: px, val: val, source: source }); }
      }
    }
    // Storybook design-system tokens first (canonical), then the page's own :root.
    var SB_TOKENS = ${JSON.stringify(sbTokens && typeof sbTokens === 'object' ? sbTokens : {})};
    var sbCount = 0;
    for (var sn in SB_TOKENS) { var before = seenNames[sn]; addToken(sn, SB_TOKENS[sn], 'storybook'); if (!before && seenNames[sn]) sbCount++; }
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
      for (var name in names) addToken(name, (rootCS.getPropertyValue(name) || '').trim(), 'page');
    })();
    var tokenTotal = tokens.color.length + tokens.type.length + tokens.radius.length + tokens.shadow.length;

    function nearestColor(rgb) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < tokens.color.length; i++) { var d = dist(rgb, tokens.color[i].rgb); if (d < bestD) { bestD = d; best = tokens.color[i]; } }
      return best ? { token: best, d: bestD } : null;
    }
    function nearestLen(px, arr) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < arr.length; i++) { var d = Math.abs(px - arr[i].px); if (d < bestD) { bestD = d; best = arr[i]; } }
      return best ? { token: best, d: bestD } : null;
    }
    function nearestShadow(layers) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < tokens.shadow.length; i++) { var d = shadowDist(layers, tokens.shadow[i].layers); if (d < bestD) { bestD = d; best = tokens.shadow[i]; } }
      return best ? { token: best, d: bestD } : null;
    }

    // ── 2. Scan elements for drift ──
    // Per-category tolerances: within → "you meant this token"; 0 (exact, already
    // on-system) and beyond → skip (a deliberate one-off, not drift).
    var NEAR_COLOR = 14, NEAR_TYPE = 2.5, NEAR_RADIUS = 3, NEAR_SHADOW = 6;
    var issues = [], CAP = 160, seen = {};
    var COLOR_PROPS = [ { css: 'color', k: 'text' }, { css: 'background-color', k: 'bg' }, { css: 'border-top-color', k: 'border' } ];
    function add(el, cat, prop, from, orig, tok, toVal, d, extra) {
      var key = getSelector(el) + '|' + prop + '|' + from;
      if (seen[key]) return; seen[key] = 1;
      var iss = { el: el, cat: cat, prop: prop, from: from, orig: orig, token: tok.name, toVal: toVal, source: tok.source, d: Math.round(d * 10) / 10 };
      if (extra) for (var kk in extra) iss[kk] = extra[kk];
      issues.push(iss);
    }
    var all = tokenTotal && document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && issues.length < CAP; i++) {
      var el = all[i]; if (!visible(el)) continue;
      var cs = getComputedStyle(el);

      // colors
      for (var pi = 0; pi < COLOR_PROPS.length && tokens.color.length; pi++) {
        if (COLOR_PROPS[pi].k === 'border' && (parseFloat(cs.borderTopWidth) || 0) === 0) continue;
        var crgb = parseRGB(cs.getPropertyValue(COLOR_PROPS[pi].css)); if (!crgb || crgb.a === 0) continue;
        var nc = nearestColor(crgb);
        if (!nc || nc.d === 0 || nc.d > NEAR_COLOR) continue;
        var hex = toHex(crgb.r, crgb.g, crgb.b);
        add(el, 'color', COLOR_PROPS[pi].css, hex, hex, nc.token, nc.token.hex, nc.d, { k: COLOR_PROPS[pi].k, hex: hex, tokenHex: nc.token.hex });
      }

      // type — font-size
      if (tokens.type.length) {
        var fpx = parseFloat(cs.fontSize);
        if (fpx) {
          var nt = nearestLen(fpx, tokens.type);
          if (nt && nt.d > 0.25 && nt.d <= NEAR_TYPE) add(el, 'type', 'font-size', fmtPx(fpx), fmtPx(fpx), nt.token, nt.token.val, nt.d);
        }
      }

      // radius — only uniform, px-defined corners (mixed / % radii are usually intentional)
      if (tokens.radius.length) {
        var tlr = cs.borderTopLeftRadius;
        if (tlr && tlr === cs.borderTopRightRadius && tlr === cs.borderBottomRightRadius && tlr === cs.borderBottomLeftRadius && /px$/.test(tlr)) {
          var rpx = parseFloat(tlr);
          if (rpx > 0 && rpx <= 64) {   // skip 0 and pill/full-round (9999px)
            var nr = nearestLen(rpx, tokens.radius);
            if (nr && nr.d > 0.25 && nr.d <= NEAR_RADIUS) add(el, 'radius', 'border-radius', fmtPx(rpx), fmtPx(rpx), nr.token, nr.token.val, nr.d);
          }
        }
      }

      // shadow — box-shadow
      if (tokens.shadow.length) {
        var esh = parseShadow(cs.boxShadow);
        if (esh) {
          var ns = nearestShadow(esh);
          if (ns && ns.d > 0.5 && ns.d <= NEAR_SHADOW) add(el, 'shadow', 'box-shadow', cs.boxShadow, cs.boxShadow, ns.token, ns.token.val, ns.d);
        }
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
      return { idx: i, cat: iss.cat, prop: iss.prop, from: iss.from, token: iss.token, toVal: iss.toVal, source: iss.source,
               hex: iss.hex, tokenHex: iss.tokenHex, k: iss.k, d: iss.d, selector: getSelector(iss.el) };
    });
    window.__cathodeDrift = {
      flash: function(idx){ var iss = issues[idx]; if (iss) flash(iss); },
      // Live-preview the fix by pointing the property at the token.
      apply: function(idx){ var iss = issues[idx]; if (iss) iss.el.style.setProperty(iss.prop, 'var(' + iss.token + ')', 'important'); },
      unapply: function(idx){ var iss = issues[idx]; if (iss) iss.el.style.setProperty(iss.prop, iss.orig, 'important'); },
      clear: function(){ resolved = true; teardown(); window.__cathodeDrift = null; },
    };
    resolved = true;
    resolve({ url: location.href, total: issues.length, tokens: tokenTotal, sbTokens: sbCount, issues: serial });
  });
})()`;
}

module.exports = { getDriftScript };
