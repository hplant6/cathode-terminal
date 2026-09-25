const { Z } = require('./ui-constants');
const path = require('path');
const IS = require('./inject-styles');   // read at build time: the colour follows the theme
const SHARED = require('./inject-shared');
const { iconB64 } = require('./read-icon');
const { KEYFRAMES_FN_SRC } = require('./animation-spec');

const ANIM_B64 = iconB64(path.join(__dirname, 'icons', 'animation-cursor.svg'));
const ANIM_CURSOR = `url("data:image/svg+xml;base64,${ANIM_B64}") 16 16, crosshair`;

// Phase 1: hover + click to target an element; the script resolves with its
// selector/label. Animation controls, live preview, and the composed request live
// in the left-column panel. window.__cathodeAnim exposes result() (the target(s)'
// selector + snippet) and clear() (teardown). Preview lands in Phase 2.
// append: Add Selection — the new target joins window.__cathodeAnim.targets instead
// of replacing the session, so one spec (built in Phase 2) previews/sends against all
// of them.
function getAnimationScript(append) {
  return `(function() {
  ${IS.MARCH_KEYFRAMES_JS}
  var __animKeyframes = ${KEYFRAMES_FN_SRC};   // inlined spec→WAAPI generator (shared with the panel)
  var __prev = (${append ? 'true' : 'false'} && window.__cathodeAnim) ? window.__cathodeAnim : null;
  if (__prev) { try { __prev.cancelAnims(); } catch(e){} }   // drop any live preview, keep targets/overlay state
  else if (window.__cathodeAnim) { try { window.__cathodeAnim.clear(); } catch(e){} }
  ['__ca_ov','__ca_hv'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

  return new Promise(function(resolve) {
    var phase = 'hover';
    var curAnims = [];
    function cancelAll(){ curAnims.forEach(function(a){ try{a.cancel();}catch(e){} }); curAnims = []; }
    function finiteRevert(a, o){ if (o.iterations !== Infinity && a.finished) { a.finished.then(function(){ var i = curAnims.indexOf(a); if (i>=0) { try{a.cancel();}catch(e){} curAnims.splice(i,1); } }).catch(function(){}); } }
    var resolved = false;
    function resolveOnce(val){ if (resolved) return; resolved = true; resolve(val); }
    function teardown() {
      cancelAll();
      document.removeEventListener('keydown', onKey, true);
      ['__ca_ov','__ca_hv'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      window.__cathodeAnim = null;
    }

    var ov = document.createElement('div');
    ov.id = '__ca_ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${ANIM_CURSOR}';
    (document.body || document.documentElement).appendChild(ov);

    var hv = document.createElement('div');
    hv.id = '__ca_hv';
    hv.style.cssText = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_MID};box-sizing:border-box;display:none;' +
      'transition:left 40ms,top 40ms,width 40ms,height 40ms;${IS.MARCH_OUTLINE_CSS}';
    (document.body || document.documentElement).appendChild(hv);

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
      hv.style.left = r.left + 'px'; hv.style.top = r.top + 'px';
      hv.style.width = r.width + 'px'; hv.style.height = r.height + 'px';
    });
    ov.addEventListener('mouseleave', function(){ hv.style.display = 'none'; lastHover = null; });

    ov.addEventListener('click', function(e) {
      if (phase !== 'hover') return;
      e.preventDefault(); e.stopPropagation();
      ov.style.pointerEvents = 'none';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      ov.style.pointerEvents = '';
      if (!el || el === document.body || el === document.documentElement) return;
      selectEl(el);
    });

    function onKey(e) {
      if (e.key !== 'Escape' || phase !== 'hover') return;
      resolveOnce(null);
      if (__prev) {
        // Cancelling an appended pick leaves the existing target(s)' session alone —
        // only this pick's own overlay needs cleaning up.
        document.removeEventListener('keydown', onKey, true);
        ['__ca_ov','__ca_hv'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      } else {
        teardown();
      }
    }
    document.addEventListener('keydown', onKey, true);

    function itemInfo(t) {
      var snip = t.outerHTML.replace(/\\n/g,' ').replace(/\\s{2,}/g,' ').slice(0,160);
      return { selector: getSelector(t), tag: t.tagName.toLowerCase(), label: labelFor(t), snippet: snip };
    }

    function selectEl(el) {
      phase = 'selected';
      if (ov) ov.remove();
      if (hv) hv.remove();
      var targets = __prev ? __prev.targets.slice() : [];
      var base = targets.length;
      if (targets.indexOf(el) === -1) targets.push(el);   // picking the same element twice adds nothing new
      window.__cathodeAnim = {
        targets: targets,
        result: function() { return targets.map(itemInfo); },
        cancelAnims: function() { try { cancelAll(); } catch(e){} },   // drop a live preview without tearing the session down
        preview: function(spec) {
          try { cancelAll(); } catch(e){}
          targets.forEach(function(t) {
            try {
              var r = __animKeyframes(spec), o = r.options;
              var waOpts = { duration: o.duration, easing: o.easing, iterations: o.iterations, fill: o.fill, direction: o.playDirection };
              // Stagger previews the target's children cascading; otherwise the element itself.
              // Finite previews revert when done so nothing gets stuck faded-out mid-tweak.
              if (spec.stagger && t.children && t.children.length) {
                for (var i = 0; i < t.children.length; i++) {
                  if (o.transformOrigin !== 'center') t.children[i].style.transformOrigin = o.transformOrigin;
                  var ca = t.children[i].animate(r.keyframes, Object.assign({}, waOpts, { delay: o.delay + i * spec.stagger }));
                  curAnims.push(ca); finiteRevert(ca, o);
                }
              } else {
                if (o.transformOrigin !== 'center') t.style.transformOrigin = o.transformOrigin;
                var a = t.animate(r.keyframes, Object.assign({}, waOpts, { delay: o.delay }));
                curAnims.push(a); finiteRevert(a, o);
              }
            } catch(e) {}
          });
        },
        clear: function(){ teardown(); },
      };
      resolveOnce({ items: targets.slice(base).map(itemInfo), base: base });
    }

    function labelFor(el) {
      var t = el.tagName.toLowerCase();
      var id = el.id ? '#' + el.id : '';
      var cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
      return t + id + cls;
    }

${SHARED.selectorHelper('__ca')}
  });
})()`;
}

module.exports = { getAnimationScript };
