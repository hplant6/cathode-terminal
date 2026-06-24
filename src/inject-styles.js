// Shared "marching ants" selection outline for injected page overlays.
// 4px orange dash / 3px gap drawn as per-edge gradients (native 'dashed' can't
// size its segments), a soft glow, and a clockwise march. Each inject script
// interpolates these strings into its overlay element + injects the keyframes.
const _gH = 'repeating-linear-gradient(90deg,#FF5720 0 4px,transparent 4px 7px)';
const _gV = 'repeating-linear-gradient(0deg,#FF5720 0 4px,transparent 4px 7px)';

// Border only (no glow) — for overlays that already use box-shadow (e.g. the
// screenshot crop's dim surround, which the glow would fight).
const MARCH_BORDER_CSS =
  'border:none;background-color:transparent;border-radius:0;' +
  'background-image:' + _gH + ',' + _gH + ',' + _gV + ',' + _gV + ';' +
  'background-position:0 0,0 100%,0 0,100% 0;' +
  'background-size:100% 1px,100% 1px,1px 100%,1px 100%;' +
  'background-repeat:repeat-x,repeat-x,repeat-y,repeat-y;' +
  'animation:cathode-march 0.6s linear infinite';

// Full outline = border + soft glow.
const MARCH_OUTLINE_CSS =
  MARCH_BORDER_CSS + ';box-shadow:0 0 14px 2px rgba(255,87,32,0.275),0 0 30px 6px rgba(255,87,32,0.14)';

const MARCH_KEYFRAMES =
  '@keyframes cathode-march{from{background-position:0 0,0 100%,0 0,100% 0}to{background-position:7px 0,-7px 100%,0 -7px,100% 7px}}';

// JS (as a string) that injects the keyframes once into the host page.
const MARCH_KEYFRAMES_JS =
  "if(!document.getElementById('__cathode_march_style__')){var __cms=document.createElement('style');__cms.id='__cathode_march_style__';__cms.textContent=" +
  JSON.stringify(MARCH_KEYFRAMES) + ";document.documentElement.appendChild(__cms);}";

module.exports = { MARCH_BORDER_CSS, MARCH_OUTLINE_CSS, MARCH_KEYFRAMES, MARCH_KEYFRAMES_JS };
