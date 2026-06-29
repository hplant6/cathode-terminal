// Shared JS *source fragments* for the page-injected tool scripts.
// Each export is page-side code (runs in the browsed page, not in Node); they're
// interpolated into the tools' template-literal scripts, e.g.
//   `... ${require('./inject-shared').colorHelpers} ...`
// This is the single source of truth for helpers that were copy-pasted across
// eyedropper / a11y / resize / combined inject scripts.

// WCAG-style color + contrast helpers.
//   parseRGB → { r, g, b, a } | null  (null only for no-match / <3 components;
//     a transparent color still parses, with a:0 — callers that care about
//     opacity should check `.a`).
const colorHelpers = `
    function toHex(r, g, b) {
      return '#' + [r, g, b].map(function(v){ return ('0' + (Math.round(v) & 255).toString(16)).slice(-2); }).join('').toUpperCase();
    }
    function parseRGB(str) {
      var m = (str || '').match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      var p = m[1].split(',').map(function(x){ return parseFloat(x); });
      if (p.length < 3) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function rgbHex(str) { var c = parseRGB(str); return c ? toHex(c.r, c.g, c.b) : null; }
    function hexToRgb(h) {
      var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null;
      var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    function _lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function lum(c) { return 0.2126 * _lin(c.r) + 0.7152 * _lin(c.g) + 0.0722 * _lin(c.b); }
    function ratio(a, b) { var L1 = lum(a), L2 = lum(b); var hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }
    function over(fg, bg) { var a = fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
    function dist(a, b) { var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b; return Math.sqrt(dr * dr + dg * dg + db * db); }
`;

// HTML-escape for building innerHTML strings.
const escHelper = `
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
`;

// A readable CSS selector for an element (id, else a tag.class chain up to 4
// ancestors). `prefix` is the tool's own internal class prefix to skip.
function selectorHelper(prefix) {
  return `
    function getSelector(el) {
      if (el.id) return '#' + el.id;
      var parts = [], cur = el;
      for (var i = 0; i < 4 && cur && cur.tagName && cur !== document.documentElement; i++) {
        var p = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
          var cls = cur.className.trim().split(/\\s+/).filter(function(c){ return c && c.indexOf('${prefix}') !== 0; }).slice(0, 2);
          if (cls.length) p += '.' + cls.join('.');
        }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
`;
}

module.exports = { colorHelpers, escHelper, selectorHelper };
