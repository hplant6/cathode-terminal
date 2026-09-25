// Shared "marching ants" selection outline for injected page overlays.
// 4px dash / 3px gap drawn as per-edge gradients (native 'dashed' can't size its
// segments), a soft glow, and a clockwise march. Each inject script interpolates
// these strings into its overlay element + injects the keyframes.
//
// The colour is the theme's Selection colour (--spec-selection), pushed from the
// renderer whenever the theme changes (setOverlayAccent). The CSS strings are getters,
// so read them as S.MARCH_OUTLINE_CSS at script-build time; destructuring them at
// require time would freeze the colour that was current then.
let accent = '#FF5720';        // default until the renderer reports the theme
let accentRgb = '255,87,32';   // rgb triplet for rgba() glow variants

function setOverlayAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  accent = '#' + m[1].toUpperCase();
  accentRgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  return true;
}

const gH = () => `repeating-linear-gradient(90deg,${accent} 0 4px,transparent 4px 7px)`;
const gV = () => `repeating-linear-gradient(0deg,${accent} 0 4px,transparent 4px 7px)`;

// Border only (no glow) — for overlays that already use box-shadow (e.g. the
// screenshot crop's dim surround, which the glow would fight).
const marchBorder = () =>
  'border:none;background-color:transparent;border-radius:0;' +
  'background-image:' + gH() + ',' + gH() + ',' + gV() + ',' + gV() + ';' +
  'background-position:0 0,0 100%,0 0,100% 0;' +
  'background-size:100% 1px,100% 1px,1px 100%,1px 100%;' +
  'background-repeat:repeat-x,repeat-x,repeat-y,repeat-y;' +
  'animation:cathode-march 0.6s linear infinite';

const MARCH_KEYFRAMES =
  '@keyframes cathode-march{from{background-position:0 0,0 100%,0 0,100% 0}to{background-position:7px 0,-7px 100%,0 -7px,100% 7px}}' +
  '@keyframes cathode-march-svg{to{stroke-dashoffset:-7}}';   /* for SVG stroke dashes (one 4+3 period) */

// JS (as a string) that injects the keyframes once into the host page.
const MARCH_KEYFRAMES_JS =
  "if(!document.getElementById('__cathode_march_style__')){var __cms=document.createElement('style');__cms.id='__cathode_march_style__';__cms.textContent=" +
  JSON.stringify(MARCH_KEYFRAMES) + ";document.documentElement.appendChild(__cms);}";

module.exports = {
  setOverlayAccent,
  get ACCENT() { return accent; },
  get ACCENT_RGB() { return accentRgb; },
  get MARCH_BORDER_CSS() { return marchBorder(); },
  // Full outline = border + soft glow.
  get MARCH_OUTLINE_CSS() { return marchBorder() + `;box-shadow:0 0 14px 2px rgba(${accentRgb},0.275),0 0 30px 6px rgba(${accentRgb},0.14)`; },
  MARCH_KEYFRAMES,
  MARCH_KEYFRAMES_JS,
};
