// Shared animation model — the single source of truth for turning a spec into
// WAAPI keyframes (used by the inject's live preview) and into CSS / JS starter
// snippets (used by main to compose the chat request). animKeyframes() is kept
// self-contained (no closure deps) so its source can be inlined into the page
// script for preview; the renderer/main call the exports directly.

// ── Dropdown catalogs (shared by the renderer UI) ─────────────────────────
const ANIM_TYPES = [
  { group: 'Entrance', items: [['fade-in','Fade In'],['slide-in','Slide In'],['zoom-in','Zoom In'],['rotate-in','Rotate In'],['flip-in','Flip In'],['bounce-in','Bounce In'],['blur-in','Blur In']] },
  { group: 'Exit',     items: [['fade-out','Fade Out'],['slide-out','Slide Out'],['zoom-out','Zoom Out'],['rotate-out','Rotate Out'],['flip-out','Flip Out'],['blur-out','Blur Out']] },
  { group: 'Emphasis', items: [['pulse','Pulse'],['bounce','Bounce'],['shake','Shake'],['wobble','Wobble'],['swing','Swing'],['tada','Tada'],['jello','Jello'],['flash','Flash'],['heartbeat','Heartbeat'],['rubber-band','Rubber Band'],['spin','Spin']] },
  { group: 'Property',  items: [['color','Color'],['background','Background'],['size','Size / Scale'],['rotate','Rotate'],['skew','Skew'],['blur','Blur'],['opacity','Opacity']] },
];
const EASINGS = [
  ['ease','Default (ease)'],['linear','Linear'],['ease-in','Ease In'],['ease-out','Ease Out'],['ease-in-out','Ease In-Out'],
  ['cubic-bezier(0.68,-0.55,0.265,1.55)','Back'],['cubic-bezier(0.34,1.56,0.64,1)','Overshoot'],['cubic-bezier(0.68,-0.6,0.32,1.6)','Elastic'],['steps(6,end)','Steps'],
];
const DIRECTIONS = [['up','Up'],['down','Down'],['left','Left'],['right','Right']];
const TRIGGERS   = [['load','On load'],['scroll','On scroll into view'],['hover','On hover'],['click','On click']];

// Which conditional controls a given type exposes, and the amount slider's meaning.
function fieldsFor(type) {
  const s = { direction: false, distance: false, amount: false, color: false };
  if (type === 'slide-in' || type === 'slide-out') { s.direction = true; s.distance = true; }
  if (type === 'flip-in' || type === 'flip-out') s.direction = true;
  if (['zoom-in','zoom-out','rotate-in','rotate-out','rotate','blur-in','blur-out','blur','size','skew','opacity','pulse'].indexOf(type) !== -1) s.amount = true;
  if (type === 'bounce') s.distance = true;
  if (type === 'color' || type === 'background') s.color = true;
  return s;
}
function amountMeta(type) {
  switch (type) {
    case 'zoom-in': case 'zoom-out': return { label: 'Start scale', min: 0, max: 2, step: 0.05, def: 0.3 };
    case 'size':                     return { label: 'Scale', min: 0, max: 3, step: 0.05, def: 1.5 };
    case 'pulse':                    return { label: 'Peak scale', min: 1, max: 1.6, step: 0.02, def: 1.06 };
    case 'rotate-in': case 'rotate-out': return { label: 'Rotation °', min: 0, max: 360, step: 5, def: 180 };
    case 'rotate':                   return { label: 'Rotation °', min: -360, max: 360, step: 5, def: 45 };
    case 'skew':                     return { label: 'Skew °', min: -45, max: 45, step: 1, def: 12 };
    case 'blur-in': case 'blur-out': case 'blur': return { label: 'Blur px', min: 0, max: 30, step: 1, def: 8 };
    case 'opacity':                  return { label: 'Opacity', min: 0, max: 1, step: 0.05, def: 0.5 };
    default:                         return { label: 'Amount', min: 0, max: 100, step: 1, def: 1 };
  }
}

// ── The core: spec → { keyframes, options } (self-contained) ───────────────
function animKeyframes(spec) {
  spec = spec || {};
  var type  = spec.type || 'fade-in';
  var dur   = spec.duration != null ? Number(spec.duration) : 1000;
  var delay = spec.delay != null ? Number(spec.delay) : 0;
  var ease  = spec.easing || 'ease';
  var dist  = spec.distance != null ? Number(spec.distance) : 40;
  var amt   = spec.amount != null ? Number(spec.amount) : null;
  var dir   = spec.direction || 'up';
  var color = spec.targetColor || '#ff5720';
  var iters = spec.repeat === 'infinite' ? Infinity : (spec.repeat ? Number(spec.repeat) : 1);
  var fill  = spec.fill || 'both';

  function slideFrom() {
    if (dir === 'left')  return 'translateX(-' + dist + 'px)';
    if (dir === 'right') return 'translateX(' + dist + 'px)';
    if (dir === 'down')  return 'translateY(' + dist + 'px)';
    return 'translateY(-' + dist + 'px)';
  }
  function flipAxis() { return (dir === 'left' || dir === 'right') ? 'Y' : 'X'; }
  function A(fallback) { return amt != null ? amt : fallback; }

  var kf;
  switch (type) {
    case 'fade-in':   kf = [{ opacity: 0 }, { opacity: 1 }]; break;
    case 'fade-out':  kf = [{ opacity: 1 }, { opacity: 0 }]; break;
    case 'slide-in':  kf = [{ opacity: 0, transform: slideFrom() }, { opacity: 1, transform: 'none' }]; break;
    case 'slide-out': kf = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: slideFrom() }]; break;
    case 'zoom-in':   kf = [{ opacity: 0, transform: 'scale(' + A(0.3) + ')' }, { opacity: 1, transform: 'scale(1)' }]; break;
    case 'zoom-out':  kf = [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(' + A(0.3) + ')' }]; break;
    case 'rotate-in': kf = [{ opacity: 0, transform: 'rotate(-' + A(180) + 'deg)' }, { opacity: 1, transform: 'none' }]; break;
    case 'rotate-out':kf = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'rotate(' + A(180) + 'deg)' }]; break;
    case 'flip-in':   kf = [{ opacity: 0, transform: 'perspective(400px) rotate' + flipAxis() + '(90deg)' }, { opacity: 1, transform: 'perspective(400px) rotate' + flipAxis() + '(0deg)' }]; break;
    case 'flip-out':  kf = [{ opacity: 1, transform: 'perspective(400px) rotate' + flipAxis() + '(0deg)' }, { opacity: 0, transform: 'perspective(400px) rotate' + flipAxis() + '(90deg)' }]; break;
    case 'blur-in':   kf = [{ opacity: 0, filter: 'blur(' + A(8) + 'px)' }, { opacity: 1, filter: 'blur(0px)' }]; break;
    case 'blur-out':  kf = [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(' + A(8) + 'px)' }]; break;
    case 'bounce-in': kf = [{ offset: 0, opacity: 0, transform: 'scale(0.3)' }, { offset: 0.5, opacity: 1, transform: 'scale(1.05)' }, { offset: 0.7, transform: 'scale(0.9)' }, { offset: 1, opacity: 1, transform: 'scale(1)' }]; break;
    case 'pulse':     kf = [{ transform: 'scale(1)' }, { transform: 'scale(' + A(1.06) + ')' }, { transform: 'scale(1)' }]; break;
    case 'bounce':    { var b = dist || 20; kf = [{ offset: 0, transform: 'translateY(0)' }, { offset: 0.4, transform: 'translateY(-' + b + 'px)' }, { offset: 0.6, transform: 'translateY(-' + (b / 2) + 'px)' }, { offset: 0.8, transform: 'translateY(0)' }, { offset: 1, transform: 'translateY(0)' }]; } break;
    case 'shake':     kf = [{ offset: 0, transform: 'translateX(0)' }, { offset: 0.1, transform: 'translateX(-10px)' }, { offset: 0.2, transform: 'translateX(10px)' }, { offset: 0.3, transform: 'translateX(-10px)' }, { offset: 0.4, transform: 'translateX(10px)' }, { offset: 0.5, transform: 'translateX(-10px)' }, { offset: 0.6, transform: 'translateX(10px)' }, { offset: 0.7, transform: 'translateX(-10px)' }, { offset: 0.8, transform: 'translateX(10px)' }, { offset: 0.9, transform: 'translateX(-10px)' }, { offset: 1, transform: 'translateX(0)' }]; break;
    case 'wobble':    kf = [{ offset: 0, transform: 'none' }, { offset: 0.15, transform: 'translateX(-25%) rotate(-5deg)' }, { offset: 0.3, transform: 'translateX(20%) rotate(3deg)' }, { offset: 0.45, transform: 'translateX(-15%) rotate(-3deg)' }, { offset: 0.6, transform: 'translateX(10%) rotate(2deg)' }, { offset: 0.75, transform: 'translateX(-5%) rotate(-1deg)' }, { offset: 1, transform: 'none' }]; break;
    case 'swing':     kf = [{ offset: 0, transform: 'rotate(0deg)' }, { offset: 0.2, transform: 'rotate(15deg)' }, { offset: 0.4, transform: 'rotate(-10deg)' }, { offset: 0.6, transform: 'rotate(5deg)' }, { offset: 0.8, transform: 'rotate(-5deg)' }, { offset: 1, transform: 'rotate(0deg)' }]; break;
    case 'tada':      kf = [{ offset: 0, transform: 'scale(1)' }, { offset: 0.1, transform: 'scale(0.9) rotate(-3deg)' }, { offset: 0.3, transform: 'scale(1.1) rotate(3deg)' }, { offset: 0.4, transform: 'scale(1.1) rotate(-3deg)' }, { offset: 0.5, transform: 'scale(1.1) rotate(3deg)' }, { offset: 0.6, transform: 'scale(1.1) rotate(-3deg)' }, { offset: 0.7, transform: 'scale(1.1) rotate(3deg)' }, { offset: 0.8, transform: 'scale(1.1) rotate(-3deg)' }, { offset: 0.9, transform: 'scale(1.1) rotate(3deg)' }, { offset: 1, transform: 'scale(1)' }]; break;
    case 'jello':     kf = [{ offset: 0, transform: 'none' }, { offset: 0.11, transform: 'skewX(-12.5deg) skewY(-12.5deg)' }, { offset: 0.22, transform: 'skewX(6.25deg) skewY(6.25deg)' }, { offset: 0.33, transform: 'skewX(-3.125deg) skewY(-3.125deg)' }, { offset: 0.44, transform: 'skewX(1.56deg) skewY(1.56deg)' }, { offset: 0.55, transform: 'skewX(-0.78deg) skewY(-0.78deg)' }, { offset: 1, transform: 'none' }]; break;
    case 'flash':     kf = [{ offset: 0, opacity: 1 }, { offset: 0.25, opacity: 0 }, { offset: 0.5, opacity: 1 }, { offset: 0.75, opacity: 0 }, { offset: 1, opacity: 1 }]; break;
    case 'heartbeat': kf = [{ offset: 0, transform: 'scale(1)' }, { offset: 0.14, transform: 'scale(1.3)' }, { offset: 0.28, transform: 'scale(1)' }, { offset: 0.42, transform: 'scale(1.3)' }, { offset: 0.7, transform: 'scale(1)' }, { offset: 1, transform: 'scale(1)' }]; break;
    case 'rubber-band': kf = [{ offset: 0, transform: 'scale(1)' }, { offset: 0.3, transform: 'scaleX(1.25) scaleY(0.75)' }, { offset: 0.4, transform: 'scaleX(0.75) scaleY(1.25)' }, { offset: 0.5, transform: 'scaleX(1.15) scaleY(0.85)' }, { offset: 0.65, transform: 'scaleX(0.95) scaleY(1.05)' }, { offset: 0.75, transform: 'scaleX(1.05) scaleY(0.95)' }, { offset: 1, transform: 'scale(1)' }]; break;
    case 'spin':      kf = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }]; break;
    case 'color':      kf = [{ color: color }]; break;
    case 'background': kf = [{ backgroundColor: color }]; break;
    case 'size':       kf = [{ transform: 'scale(' + A(1.5) + ')' }]; break;
    case 'rotate':     kf = [{ transform: 'rotate(' + A(45) + 'deg)' }]; break;
    case 'skew':       kf = [{ transform: 'skewX(' + A(12) + 'deg)' }]; break;
    case 'blur':       kf = [{ filter: 'blur(' + A(4) + 'px)' }]; break;
    case 'opacity':    kf = [{ opacity: A(0.5) }]; break;
    default:           kf = [{ opacity: 0 }, { opacity: 1 }];
  }
  return { keyframes: kf, options: { duration: dur, delay: delay, easing: ease, iterations: iters, fill: fill } };
}

// ── Snippet generation (renderer/main side) ────────────────────────────────
function cssProp(k) { return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }); }

function triggerCss(spec, selector) {
  const t = spec.trigger || 'load';
  if (t === 'hover')  return '\n/* trigger: move the `animation:` line into ' + selector + ':hover to play on hover */';
  if (t === 'scroll') return '\n/* trigger: on scroll — put the `animation:` line under a `.in-view` class and add it via IntersectionObserver */';
  if (t === 'click')  return '\n/* trigger: on click — toggle a `.play` class that carries the `animation:` line */';
  return '';
}
function triggerJs(spec, play) {
  const t = spec.trigger || 'load';
  if (t === 'hover')  return "el.addEventListener('mouseenter', () => { " + play + " });";
  if (t === 'click')  return "el.addEventListener('click', () => { " + play + " });";
  if (t === 'scroll') return 'new IntersectionObserver((entries, ob) => {\n  entries.forEach(e => { if (e.isIntersecting) { ' + play + ' ob.unobserve(e.target); } });\n}).observe(el);';
  return play;
}

function cssSnippet(spec, selector) {
  const r = animKeyframes(spec), o = r.options, kfs = r.keyframes;
  const name = 'cath-' + (spec.type || 'anim');
  const body = kfs.map(function (kf, i) {
    const pct = kf.offset != null ? +(kf.offset * 100).toFixed(2) : (kfs.length === 1 ? 100 : Math.round(i / (kfs.length - 1) * 100));
    const decls = Object.keys(kf).filter(function (k) { return k !== 'offset'; }).map(function (k) { return cssProp(k) + ': ' + kf[k]; }).join('; ');
    return '  ' + pct + '% { ' + decls + '; }';
  }).join('\n');
  const iters = o.iterations === Infinity ? 'infinite' : o.iterations;
  const rule = selector + ' {\n  animation: ' + name + ' ' + o.duration + 'ms ' + o.easing + ' ' + o.delay + 'ms ' + iters + ' ' + o.fill + ';\n}';
  return '@keyframes ' + name + ' {\n' + body + '\n}\n' + rule + triggerCss(spec, selector);
}
function jsSnippet(spec, selector) {
  const r = animKeyframes(spec), o = r.options;
  const iters = o.iterations === Infinity ? 'Infinity' : o.iterations;
  const opts = '{ duration: ' + o.duration + ', delay: ' + o.delay + ", easing: '" + o.easing + "', iterations: " + iters + ", fill: '" + o.fill + "' }";
  const play = 'el.animate(' + JSON.stringify(r.keyframes) + ', ' + opts + ');';
  return "const el = document.querySelector('" + String(selector).replace(/'/g, "\\'") + "');\n" + triggerJs(spec, play);
}

function labelForType(type) {
  for (const g of ANIM_TYPES) for (const it of g.items) if (it[0] === type) return it[1];
  return type;
}
// Human-readable one-liner for the chat request header.
function summaryFor(spec) {
  spec = spec || {};
  const f = fieldsFor(spec.type);
  const p = [labelForType(spec.type)];
  if (f.direction && spec.direction) p.push('from ' + spec.direction);
  if (f.distance && spec.distance != null) p.push(spec.distance + 'px');
  if (f.amount && spec.amount != null) p.push(amountMeta(spec.type).label.toLowerCase() + ' ' + spec.amount);
  if (f.color && spec.targetColor) p.push('→ ' + spec.targetColor);
  let tail = (spec.duration != null ? spec.duration : 1000) + 'ms';
  if (spec.delay) tail += ', ' + spec.delay + 'ms delay';
  tail += ', ' + (spec.easing || 'ease');
  if (spec.repeat === 'infinite') tail += ', loop';
  else if (spec.repeat && Number(spec.repeat) > 1) tail += ', ×' + spec.repeat;
  tail += ', on ' + (spec.trigger || 'load');
  return p.join(' ') + ' — ' + tail;
}

module.exports = {
  ANIM_TYPES, EASINGS, DIRECTIONS, TRIGGERS, fieldsFor, amountMeta, labelForType, summaryFor,
  animKeyframes, cssSnippet, jsSnippet,
  KEYFRAMES_FN_SRC: animKeyframes.toString(),
};
