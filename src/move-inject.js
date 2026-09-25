const { Z } = require('./ui-constants');
const IS = require('./inject-styles');   // read at build time: the colour follows the theme
const SHARED = require('./inject-shared');
const path = require('path');
const { iconB64 } = require('./read-icon');

// Same four-way move cursor the Resize tool used (Move took over its slot).
const MOVE_B64 = iconB64(path.join(__dirname, 'icons', 'resize-cursor.svg'));
const MOVE_CURSOR = `url("data:image/svg+xml;base64,${MOVE_B64}") 16 16, move`;

const DANGER = '#f44747';   // matches --danger in the app theme

// Move tool: select element(s), drag an arrow to where they should live, repeat,
// then Send one batched request. The page is never rearranged — the arrows are the
// request. The script resolves as soon as the tool is armed; main then polls
// window.__cathodeMove.state(ver) for the live move list (same relay as Resize).
//
//   click              select (replaces)        shift+click   add / remove
//   drag from element  arrow → drop target      shift (held)  target the parent instead
//   ctrl/⌘ on release  nudge (pixel offset)     click badge / arrowhead   delete that move
//   ctrl/⌘+Z           remove the last move     Escape        cancel drag → clear selection → close
function getMoveScript(opts) {
  const snap = !(opts && opts.snap === false);
  return `(function() {
  ${IS.MARCH_KEYFRAMES_JS}
  if (window.__cathodeMove) { try { window.__cathodeMove.clear(); } catch(e){} }

  var ACCENT = '${IS.ACCENT}', DANGER = '${DANGER}';
  var NS = 'http://www.w3.org/2000/svg';
  var PAD = 5;   // selection boxes sit just outside the element, like Box select
  var TAG_CSS = 'position:absolute;bottom:100%;left:-2px;background:' + ACCENT + ';color:#fff;font:700 11px/16px monospace;padding:1px 7px;border-radius:3px 3px 0 0;white-space:nowrap;pointer-events:none';
  var root = document.body || document.documentElement;
  var VOID = { IMG:1, INPUT:1, BR:1, HR:1, META:1, LINK:1, AREA:1, BASE:1, COL:1, EMBED:1, SOURCE:1, TRACK:1, WBR:1,
               VIDEO:1, AUDIO:1, IFRAME:1, TEXTAREA:1, SELECT:1, CANVAS:1, svg:1, SVG:1, OPTION:1, PICTURE:1 };

  var moves = [];          // recorded moves (see record())
  var nextId = 1;
  var selection = [];      // selected elements (document order not guaranteed)
  var drag = null;         // { x0, y0, active, x, y, drop, nudge }
  var hotId = null;        // move highlighted from the panel or by hovering its arrow
  var delId = null;        // move whose badge/arrowhead is under the cursor → click deletes it
  var ver = 1;             // bumps whenever the reported state changes
  var wantClose = false;   // Escape with nothing to cancel → ask the app to close the tool
  var alive = true;
  var moved = false;       // first move recorded → drop the "drag to move" hint
  var snap = ${snap ? 'true' : 'false'};   // on: drops snap to before/after/inside an element · off: free arrow to any point
  function bump() { ver++; }

  // ── Layers ──
  var ov = document.createElement('div');   // captures pointer input over the page
  ov.id = '__cm_ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY_BASE};cursor:${MOVE_CURSOR};background:transparent';
  root.appendChild(ov);

  var hv = document.createElement('div');   // hover box
  hv.id = '__cm_hv';
  var HV_FULL_CSS = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_MID};box-sizing:border-box;display:none;' +
    'transition:left 40ms,top 40ms,width 40ms,height 40ms;${IS.MARCH_OUTLINE_CSS}';
  var HV_QUIET_CSS = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_MID};box-sizing:border-box;display:none;' +
    'transition:left 40ms,top 40ms,width 40ms,height 40ms;box-shadow:0 0 0 2px rgba(${IS.ACCENT_RGB},0.85);background:rgba(${IS.ACCENT_RGB},0.06);border-radius:2px';
  hv.style.cssText = HV_FULL_CSS;
  var hvTag = document.createElement('div');
  hvTag.style.cssText = TAG_CSS;
  hv.appendChild(hvTag);
  root.appendChild(hv);

  var selLayer = document.createElement('div');   // marching-ants outlines for the selection
  selLayer.id = '__cm_sel';
  selLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:${Z.OVERLAY_MID}';
  root.appendChild(selLayer);

  var svg = document.createElementNS(NS, 'svg');   // arrows, drop indicators, badges
  svg.id = '__cm_svg';
  svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:${Z.OVERLAY_TOP};overflow:visible');
  root.appendChild(svg);

  var tip = document.createElement('div');   // drop description that follows the cursor
  tip.id = '__cm_tip';
  tip.style.cssText = 'position:fixed;pointer-events:none;z-index:${Z.OVERLAY_TOP};display:none;padding:3px 7px;border-radius:4px;' +
    'background:#1b1b1b;color:#eee;font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  root.appendChild(tip);

  // Snap | Drag switch — sits under the current selection, the moment you're about to drag.
  // Snap: drops resolve before/after/inside an element. Drag: the arrow goes to any spot.
  var sw = document.createElement('div');
  sw.id = '__cm_snap';
  sw.title = 'Snap: drop before/after/inside an element · Drag: point the arrow anywhere (S)';
  sw.style.cssText = 'position:fixed;z-index:${Z.OVERLAY_TOP};display:none;padding:2px;background:#000;border:1px solid #2a2930;border-radius:6px;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:pointer;user-select:none;font:700 10px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase';
  var swThumb = document.createElement('span');
  swThumb.style.cssText = 'position:absolute;top:2px;bottom:2px;left:2px;width:0;background:' + ACCENT + ';border-radius:4px;transition:left .2s cubic-bezier(.45,.05,.2,1),width .2s cubic-bezier(.45,.05,.2,1)';
  sw.appendChild(swThumb);
  var swOpts = ['snap', 'drag'].map(function(k) {
    var o = document.createElement('span');
    o.textContent = k;
    o.dataset.k = k;
    o.style.cssText = 'position:relative;display:inline-block;padding:6px 11px;transition:color .15s';
    sw.appendChild(o);
    return o;
  });
  function paintSwitch() {
    var on = swOpts[snap ? 0 : 1];
    swOpts.forEach(function(o) { o.style.color = o === on ? '#fff' : '#8a8a90'; });
    swThumb.style.left = on.offsetLeft + 'px';
    swThumb.style.width = on.offsetWidth + 'px';
  }
  function setSnapMode(on) { if (snap === !!on) return; snap = !!on; paintSwitch(); bump(); if (drag && drag.active) updateDrag(); }
  sw.addEventListener('mousedown', function(e) {
    e.preventDefault(); e.stopPropagation();
    var k = e.target && e.target.dataset && e.target.dataset.k;
    setSnapMode(k ? k === 'snap' : !snap);
  });
  // The bar under the selection: holds the Snap | Drag switch.
  var bar = document.createElement('div');
  bar.id = '__cm_bar';
  bar.style.cssText = 'position:fixed;z-index:${Z.OVERLAY_TOP};display:none;align-items:center;gap:6px';
  sw.style.position = 'relative';
  sw.style.zIndex = '';
  bar.append(sw);
  root.appendChild(bar);
  function placeSwitch() {
    var box = selection.length && !(drag && drag.shown) ? bbox(selection) : null;
    if (!box) { bar.style.display = 'none'; return; }
    var first = bar.style.display === 'none';
    bar.style.display = 'flex';
    sw.style.display = '';
    if (first) {   // needs layout to measure the labels; place the thumb instantly, don't grow it in from 0
      var tr = swThumb.style.transition;
      swThumb.style.transition = 'none';
      paintSwitch();
      void swThumb.offsetWidth;
      swThumb.style.transition = tr;
    }
    var h = bar.offsetHeight, w = bar.offsetWidth;
    var top = box.bottom + PAD + 6;
    if (top + h > window.innerHeight - 4) top = Math.max(4, box.top - PAD - 22 - h);   // no room below → above the name tags
    var left = Math.min(Math.max(4, box.left - PAD), window.innerWidth - w - 4);
    bar.style.top = top + 'px'; bar.style.left = left + 'px';
  }

  function isOurs(el) { return !!(el && el.closest && el.closest('#__cm_ov,#__cm_hv,#__cm_sel,#__cm_svg,#__cm_tip,#__cm_snap,#__cm_bar')); }
  function pickAt(x, y) {
    ov.style.pointerEvents = 'none'; svg.style.display = 'none';   // arrow hit-strokes would shadow the page
    var el = document.elementFromPoint(x, y);
    ov.style.pointerEvents = ''; svg.style.display = '';
    if (!el || isOurs(el) || el === document.body || el === document.documentElement) return null;
    return el;
  }

  // ── Element info ──
  function labelFor(el) {
    var t = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return t + id + cls;
  }
  function info(el) {
    var snip = el.outerHTML.replace(/\\n/g, ' ').replace(/\\s{2,}/g, ' ').slice(0, 160);
    return { selector: getSelector(el), label: labelFor(el), snippet: snip };
  }
  function kids(el) { return el && el.parentElement ? Array.prototype.slice.call(el.parentElement.children) : []; }
  function whereIs(el) {   // "inside div.actions (child 2 of 3)"
    var p = el.parentElement;
    if (!p) return '';
    var k = kids(el);
    return 'inside ' + getSelector(p) + ' (child ' + (k.indexOf(el) + 1) + ' of ' + k.length + ')';
  }
  function docOrder(list) {
    return list.slice().sort(function(a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
  }

  // ── Drop resolution ──
  // Flow axis of el within its parent: siblings side by side → row, else column.
  function isRowFlow(el) {
    var p = el.parentElement;
    if (!p) return false;
    var sib = el.previousElementSibling || el.nextElementSibling;
    if (sib) {
      var a = el.getBoundingClientRect(), b = sib.getBoundingClientRect();
      var vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (a.height && b.height) return vOverlap > Math.min(a.height, b.height) * 0.5;
    }
    var cs = getComputedStyle(p);
    if (cs.display.indexOf('flex') !== -1) return cs.flexDirection.indexOf('row') === 0;
    var d = getComputedStyle(el).display;
    return d === 'inline' || d === 'inline-block' || d === 'inline-flex';
  }
  function canContain(el) { return !VOID[el.tagName] && !(el instanceof SVGElement); }

  function resolveDrop(x, y, sources, climb) {
    var ref = pickAt(x, y);
    if (ref && climb && ref.parentElement && ref.parentElement !== document.body) ref = ref.parentElement;
    if (!ref) return { ok: false, why: 'Drop onto an element' };
    for (var i = 0; i < sources.length; i++) {
      if (sources[i] === ref || sources[i].contains(ref)) return { ok: false, ref: ref, why: "Can't move an element into itself" };
    }
    var r = ref.getBoundingClientRect();
    var row = isRowFlow(ref);
    var f = row ? (x - r.left) / (r.width || 1) : (y - r.top) / (r.height || 1);
    var place = f < 0.3 ? 'before' : f > 0.7 ? 'after' : (canContain(ref) ? 'inside' : (f < 0.5 ? 'before' : 'after'));
    // Dropping a single element right next to where it already is changes nothing.
    if (sources.length === 1) {
      var s = sources[0];
      if ((place === 'before' && ref.previousElementSibling === s) || (place === 'after' && ref.nextElementSibling === s) ||
          (place === 'inside' && ref === s.parentElement && ref.lastElementChild === s)) {
        return { ok: false, ref: ref, why: 'Already there' };
      }
    }
    return { ok: true, ref: ref, place: place, row: row };
  }

  // Snapping off: the arrow just points at a spot. Keep what's under it as context.
  function freeDrop(x, y) {
    var over = pickAt(x, y);
    if (over && selection.some(function(s) { return s === over || s.contains(over); })) over = null;
    return { ok: true, free: true, x: x, y: y, over: over };
  }

  // Endpoint of an arrow on its drop target: the insertion edge, or the centre for inside.
  function dropPoint(ref, place, row) {
    var r = ref.getBoundingClientRect();
    if (place === 'inside') return { x: r.left + r.width / 2, y: r.bottom - Math.min(INSIDE_INSET, r.width / 4, r.height / 4) };   // meets the inside bracket
    if (row) return { x: place === 'before' ? r.left : r.right, y: r.top + r.height / 2 };
    return { x: r.left + r.width / 2, y: place === 'before' ? r.top : r.bottom };
  }

  // ── Geometry helpers ──
  function bbox(els) {
    var l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity, any = false;
    els.forEach(function(el) {
      if (!el || !el.isConnected) return;
      var r = el.getBoundingClientRect();
      any = true;
      l = Math.min(l, r.left); t = Math.min(t, r.top); rr = Math.max(rr, r.right); b = Math.max(b, r.bottom);
    });
    return any ? { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t } : null;
  }
  // Where the segment from the box centre toward (tx,ty) leaves the box.
  function edgePoint(box, tx, ty) {
    var cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    var dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    var sx = dx ? (box.width / 2) / Math.abs(dx) : Infinity;
    var sy = dy ? (box.height / 2) / Math.abs(dy) : Infinity;
    var s = Math.min(sx, sy, 1);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  // ── Drawing ──
  function mk(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function arrow(g, a, b, color, opts) {
    opts = opts || {};
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = Math.max(-80, Math.min(80, len * 0.18)) * (opts.flip ? -1 : 1);
    var cx = (a.x + b.x) / 2 - dy / len * bow, cy = (a.y + b.y) / 2 + dx / len * bow;
    var tx = b.x - cx, ty = b.y - cy, tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl; ty /= tl;
    var hs = opts.hot ? 16 : 14, hw = hs * 0.5;
    // The line stops at the head's base so its cap doesn't blur the tip.
    var ex = b.x - tx * hs * 0.8, ey = b.y - ty * hs * 0.8;
    var d = 'M' + a.x + ',' + a.y + ' Q' + cx + ',' + cy + ' ' + ex + ',' + ey;
    var w = opts.hot ? 3.5 : 2.5;
    var head = b.x + ',' + b.y + ' ' + (b.x - tx * hs - ty * hw) + ',' + (b.y - ty * hs + tx * hw) + ' ' + (b.x - tx * hs + ty * hw) + ',' + (b.y - ty * hs - tx * hw);
    // Thin dark halo under stroke and head keeps them legible on any page colour.
    g.appendChild(mk('path', { d: d, fill: 'none', stroke: 'rgba(0,0,0,0.3)', 'stroke-width': w + 2, 'stroke-linecap': 'round' }));
    g.appendChild(mk('polygon', { points: head, fill: 'rgba(0,0,0,0.3)', stroke: 'rgba(0,0,0,0.3)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    var line = mk('path', { d: d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' });
    if (opts.dashed) line.setAttribute('stroke-dasharray', '7 5');
    g.appendChild(line);
    g.appendChild(mk('polygon', { points: head, fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
  }
  // Delete targets: the number badge and the arrowhead. Hovering either turns the arrow red
  // and the badge into ✕; a clean click removes the move (a press that moves becomes a drag). The line itself isn't clickable — a hit
  // area along it would block drags on every element it crosses.
  function deleteTarget(node, m) {
    node.style.pointerEvents = 'all';
    node.style.cursor = 'pointer';
    node.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); if (e.button === 0) press(e, m.id); });
    node.addEventListener('mouseenter', function() { if (delId !== m.id) { delId = m.id; hotId = m.id; bump(); draw(); } });
    node.addEventListener('mouseleave', function() { if (delId === m.id) { delId = null; hotId = null; bump(); draw(); } });
  }
  function badge(g, x, y, text, color, m) {
    var w = Math.max(18, 8 + text.length * 7);
    var r = mk('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 9, fill: color, stroke: '#fff', 'stroke-width': 1.5 });
    var t = mk('text', { x: x, y: y + 4, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 700,
      'font-family': 'ui-sans-serif,system-ui,Segoe UI,sans-serif' });
    t.textContent = text;
    g.appendChild(r);
    g.appendChild(t);
    if (m) deleteTarget(r, m);
  }
  // Insertion marks only — no boxes on other elements, which read as hover/selection
  // highlights mid-drag. before/after: a line on that edge. inside: a bracket along the
  // container's inner bottom edge, where the element lands as its last child.
  var INSIDE_INSET = 6;
  function indicator(g, drop, color) {
    var r = drop.ref.getBoundingClientRect();
    var line = function(x1, y1, x2, y2) { g.appendChild(mk('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' })); };
    if (drop.place === 'inside') {
      var i = Math.min(INSIDE_INSET, r.width / 4, r.height / 4);
      var y = r.bottom - i, x1 = r.left + i, x2 = r.right - i, tick = Math.min(8, r.height / 3);
      line(x1, y, x2, y);
      line(x1, y, x1, y - tick);
      line(x2, y, x2, y - tick);
    } else if (drop.row) {
      var x = drop.place === 'before' ? r.left : r.right;
      line(x, r.top - 4, x, r.bottom + 4);
    } else {
      var yy = drop.place === 'before' ? r.top : r.bottom;
      line(r.left - 4, yy, r.right + 4, yy);
    }
  }

  function outline(r, dashed, color, tag, fill) {
    var p = dashed ? 0 : PAD;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;box-sizing:border-box;pointer-events:none;left:' + (r.left - p) + 'px;top:' + (r.top - p) + 'px;width:' + (r.width + p * 2) + 'px;height:' + (r.height + p * 2) + 'px;' +
      (dashed ? 'border:2px dashed ' + color + ';background:rgba(${IS.ACCENT_RGB},0.06)' : '${IS.MARCH_OUTLINE_CSS}') +
      (fill ? ';background-color:' + fill : '');
    if (tag) { var t = document.createElement('div'); t.style.cssText = TAG_CSS; t.textContent = tag; d.appendChild(t); }
    selLayer.appendChild(d);
  }

  // Re-find elements that HMR swapped out from under a move (by their captured selector).
  function refresh(list, infos) {
    return list.map(function(n, i) {
      if (n && n.isConnected) return n;
      try { return document.querySelector(infos[i].selector); } catch (e) { return null; }
    });
  }
  function moveEls(m) {
    m.sources = refresh(m.sources, m.srcInfo);
    if (m.kind === 'move') m.ref = refresh([m.ref], [m.refInfo])[0];
    var stale = m.sources.some(function(n) { return !n; }) || (m.kind === 'move' && !m.ref);
    if (stale !== !!m.stale) { m.stale = stale; bump(); }
  }

  function draw() {
    if (!alive) return;
    setCursor();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    selLayer.innerHTML = '';
    var g = mk('g', {});
    svg.appendChild(g);

    moves.forEach(function(m, i) {
      moveEls(m);
      var box = bbox(m.sources);
      if (!box) return;
      var hot = m.id === hotId;
      var deleting = m.id === delId;
      var color = deleting ? DANGER : m.stale ? '#888' : ACCENT;
      var end;
      if (m.kind === 'nudge') {
        var gr = { left: box.left + m.dx, top: box.top + m.dy, width: box.width, height: box.height };
        outline(gr, true, color);
        end = { x: box.left + box.width / 2 + m.dx, y: box.top + box.height / 2 + m.dy };
      } else if (m.kind === 'free') {
        end = { x: m.px - window.scrollX, y: m.py - window.scrollY };   // stored in page coords → scrolls with the page
      } else if (m.ref && m.ref.isConnected) {
        end = dropPoint(m.ref, m.place, m.row);
        if (hot) indicator(g, { ref: m.ref, place: m.place, row: m.row }, color);
      } else return;
      if (hot) outline(box, false, color);
      var start = edgePoint(box, end.x, end.y);
      arrow(g, start, end, color, { dashed: m.kind === 'nudge', hot: hot, flip: i % 2 === 1 });
      var headHit = mk('circle', { cx: end.x, cy: end.y, r: 12, fill: 'transparent' });
      g.appendChild(headHit);
      deleteTarget(headHit, m);
      badge(g, start.x, start.y, deleting ? '✕' : String(i + 1) + (m.sources.length > 1 ? ' ×' + m.sources.length : ''), color, m);
    });

    if (hoverEl && !drag) setHover(hoverEl);
    selection = selection.filter(function(n) { return n.isConnected; });
    // Grabbed: the selection fills orange while it's being dragged, from the press if it
    // landed on the selection, otherwise once the mouse moves (a press elsewhere may
    // still turn out to be a click that selects something else).
    var grabbed = drag && drag.del == null &&
      (drag.shown || !drag.hadSel || (drag.target && selectedAncestor(drag.target)));
    selection.forEach(function(n, k) {
      outline(n.getBoundingClientRect(), false, ACCENT, labelFor(n) + (!moved && k === 0 ? ' · drag to move' : ''), grabbed ? 'rgba(${IS.ACCENT_RGB},0.28)' : null);
    });
    placeSwitch();

    if (drag && drag.shown && !drag.active) {
      var eb = bbox(selection);
      if (eb) arrow(g, edgePoint(eb, drag.x, drag.y), { x: drag.x, y: drag.y }, ACCENT, { hot: true });
    }
    if (drag && drag.active) {
      var sb = bbox(selection);
      if (sb) {
        var target = { x: drag.x, y: drag.y };
        var ok = drag.nudge || (drag.drop && drag.drop.ok);
        var c = ok ? ACCENT : DANGER;
        if (drag.drop && drag.drop.free) {
          // free arrow: straight to the cursor, no snapping indicator
        } else if (drag.nudge) {
          outline({ left: sb.left + drag.x - drag.x0, top: sb.top + drag.y - drag.y0, width: sb.width, height: sb.height }, true, ACCENT);
        } else if (drag.drop && drag.drop.ok) {
          indicator(g, drag.drop, c);
          target = dropPoint(drag.drop.ref, drag.drop.place, drag.drop.row);
        }
        arrow(g, edgePoint(sb, target.x, target.y), target, c, { dashed: drag.nudge, hot: true });
      }
    }
  }

  // ── Recording ──
  function describeDrop(d) {
    if (!d || !d.ok) return (d && d.why) || '';
    return d.place + ' ' + labelFor(d.ref);
  }
  function record(sources, drop, nudge) {
    var ordered = docOrder(sources);
    var m = { id: nextId++, sources: ordered, srcInfo: ordered.map(info), from: whereIs(ordered[0]), note: '' };
    if (nudge) {
      m.kind = 'nudge'; m.dx = Math.round(nudge.dx); m.dy = Math.round(nudge.dy);
    } else if (drop.free) {
      var b = bbox(ordered);
      m.kind = 'free';
      m.px = Math.round(drop.x + window.scrollX); m.py = Math.round(drop.y + window.scrollY);
      m.dx = Math.round(drop.x - (b.left + b.width / 2)); m.dy = Math.round(drop.y - (b.top + b.height / 2));
      m.overInfo = drop.over ? info(drop.over) : null;
    } else {
      m.kind = 'move'; m.ref = drop.ref; m.refInfo = info(drop.ref); m.place = drop.place; m.row = drop.row;
      var sbx = bbox(ordered), land = dropPoint(drop.ref, drop.place, drop.row);   // travel, for the panel row
      m.dx = Math.round(land.x - (sbx.left + sbx.width / 2)); m.dy = Math.round(land.y - (sbx.top + sbx.height / 2));
      m.refParent = drop.ref.parentElement ? getSelector(drop.ref.parentElement) : '';
    }
    moves.push(m);
    moved = true;
    selection = [];
    bump();
  }
  function removeMove(id) {
    var i = moves.findIndex(function(m) { return m.id === id; });
    if (i === -1) return;
    moves.splice(i, 1);
    if (delId === id) delId = null;
    if (hotId === id) hotId = null;
    bump(); draw();
  }

  // ── Pointer ──
  var hoverEl = null;   // kept so the hover box can follow its element on scroll
  function setHover(el) {
    hoverEl = el;
    if (!el || !el.isConnected) { hv.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    var quiet = selection.length > 0;   // a selection is active: hovering just offers "click to select instead"
    if (quiet !== hv._quiet) {
      hv._quiet = quiet;
      hv.style.cssText = quiet ? HV_QUIET_CSS : HV_FULL_CSS;
      hvTag.style.display = quiet ? 'none' : '';
    }
    hv.style.display = '';
    hv.style.left = r.left + 'px'; hv.style.top = r.top + 'px';
    hv.style.width = r.width + 'px'; hv.style.height = r.height + 'px';
    hvTag.textContent = labelFor(el);
  }
  function selectedAncestor(el) {
    for (var i = 0; i < selection.length; i++) if (selection[i] === el || selection[i].contains(el)) return selection[i];
    return null;
  }

  // Pressing always starts a potential drag. With a selection, the drag draws the
  // selection's arrow wherever you pressed; if the mouse never moves, it was a click, and
  // onUp applies click meaning (select what's under it). With nothing selected, pressing
  // an element selects it and drags it in one go.
  //   delId  the press landed on a move's badge/arrowhead: a clean click deletes that move.
  function press(e, delId) {
    var t = pickAt(e.clientX, e.clientY);
    var prevSel = selection.slice();
    if (delId == null && e.shiftKey) {   // toggle membership, no drag
      if (!t) return;
      var i = selection.indexOf(t);
      if (i === -1) {
        // Keep the selection free of nesting: a new ancestor replaces its descendants.
        selection = selection.filter(function(n) { return !t.contains(n); });
        if (!selectedAncestor(t)) selection.push(t);
      } else selection.splice(i, 1);
      bump(); draw();
      return;
    }
    var hadSel = selection.length > 0;
    if (!hadSel) {
      if (t) { selection = [t]; bump(); }
      else if (delId == null) return;
    }
    drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, shown: false, drop: null, nudge: false,
             del: delId == null ? null : delId, prevSel: prevSel, hadSel: hadSel, target: t };
    ov.style.cursor = 'grabbing';
    draw();
  }
  ov.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    press(e, null);
  });

  var scrollTimer = null;
  function autoScroll(y) {
    var edge = 40, h = window.innerHeight, v = 0;
    if (y < edge) v = -Math.ceil((edge - y) / 3);
    else if (y > h - edge) v = Math.ceil((y - (h - edge)) / 3);
    if (!v) { if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; } return; }
    if (scrollTimer) clearInterval(scrollTimer);
    scrollTimer = setInterval(function() { window.scrollBy(0, v); updateDrag(); }, 16);
  }
  function stopAutoScroll() { if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; } }

  var lastShift = false, lastMod = false;
  function updateDrag() {
    if (!drag || !drag.active) return;
    drag.nudge = lastMod;
    drag.drop = drag.nudge ? null : snap ? resolveDrop(drag.x, drag.y, selection, lastShift) : freeDrop(drag.x, drag.y);
    tip.textContent = (drag.drop && drag.drop.free) ? (drag.drop.over ? 'over ' + labelFor(drag.drop.over) : 'here')
      : drag.nudge
      ? 'nudge ' + Math.round(drag.x - drag.x0) + ', ' + Math.round(drag.y - drag.y0) + ' px'
      : describeDrop(drag.drop);
    tip.style.display = tip.textContent ? '' : 'none';
    tip.style.color = (drag.nudge || (drag.drop && drag.drop.ok)) ? '#eee' : DANGER;
    tip.style.left = (drag.x + 14) + 'px'; tip.style.top = (drag.y + 16) + 'px';
    draw();
  }

  function onMove(e) {
    lastShift = e.shiftKey; lastMod = e.ctrlKey || e.metaKey;
    if (drag) {
      drag.x = e.clientX; drag.y = e.clientY;
      var dist = Math.abs(drag.x - drag.x0) + Math.abs(drag.y - drag.y0);
      if (!drag.shown && dist > 0) { drag.shown = true; setHover(null); }   // arrow feedback from the first pixel
      if (!drag.active && dist > 5) drag.active = true;                    // …but it only counts as a drag past 5px
      if (drag.active) { autoScroll(e.clientY); updateDrag(); } else draw();
      return;
    }
    var t = pickAt(e.clientX, e.clientY);
    setHover(t && !selectedAncestor(t) ? t : null);
    setCursor();
  }
  function onUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    stopAutoScroll();
    tip.style.display = 'none';
    if (!d.active && d.del != null) {   // clean click on a badge/arrowhead → delete, selection untouched
      selection = d.prevSel.filter(function(n) { return n.isConnected; });
      bump();
      removeMove(d.del);
      return;
    }
    if (!d.active && d.hadSel) {   // a click, not a drag → select what's under it (or clear)
      var t = d.target;
      if (!t) selection = [];
      else if (!selectedAncestor(t)) selection = [t];
      bump();
    }
    if (d.active && selection.length) {
      lastMod = e.ctrlKey || e.metaKey; lastShift = e.shiftKey;
      if (lastMod) {
        var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
        if (Math.abs(dx) + Math.abs(dy) > 2) record(selection, null, { dx: dx, dy: dy });
      } else {
        var drop = snap ? resolveDrop(e.clientX, e.clientY, selection, lastShift) : freeDrop(e.clientX, e.clientY);
        if (drop.ok) record(selection, drop, null);
      }
    }
    draw();
  }
  // With a selection, a drag anywhere moves it → grab hand everywhere; otherwise the move cursor.
  function setCursor() { ov.style.cursor = drag ? 'grabbing' : selection.length ? 'grab' : '${MOVE_CURSOR}'; }
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  ov.addEventListener('mouseleave', function() { if (!drag) setHover(null); });

  function onKey(e) {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') {
      lastShift = e.shiftKey; lastMod = e.ctrlKey || e.metaKey;
      if (drag && drag.active) updateDrag();
      return;
    }
    var handled = true;
    if (e.key === 'Escape') {
      if (drag) { drag = null; stopAutoScroll(); tip.style.display = 'none'; }
      else if (selection.length) { selection = []; bump(); }
      else { wantClose = true; bump(); }
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setSnapMode(!snap);
    } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && moves.length) {
      removeMove(moves[moves.length - 1].id);
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); draw(); }
  }
  function onKeyUp(e) {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') {
      lastShift = e.shiftKey; lastMod = e.ctrlKey || e.metaKey;
      if (drag && drag.active) updateDrag();
    }
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);

  // Arrows follow their elements through scrolling, resizing and layout shifts.
  var raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(function() { raf = 0; draw(); }); }
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  var tick = setInterval(function() { if (moves.length || selection.length) schedule(); }, 300);

  function teardown() {
    alive = false;
    stopAutoScroll();
    clearInterval(tick);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    ['__cm_ov', '__cm_hv', '__cm_sel', '__cm_svg', '__cm_tip', '__cm_snap', '__cm_bar'].forEach(function(id) { var n = document.getElementById(id); if (n) n.remove(); });
    window.__cathodeMove = null;
  }

  function report(m) {
    var r = { id: m.id, kind: m.kind, stale: !!m.stale, sources: m.srcInfo, from: m.from };
    if (m.kind === 'nudge') { r.dx = m.dx; r.dy = m.dy; }
    else if (m.kind === 'free') { r.dx = m.dx; r.dy = m.dy; r.px = m.px; r.py = m.py; r.over = m.overInfo; }
    else { r.place = m.place; r.ref = m.refInfo; r.refParent = m.refParent; r.dx = m.dx; r.dy = m.dy; }
    return r;
  }

  window.__cathodeMove = {
    // Main polls this; null means "nothing changed since ver".
    state: function(since) {
      if (since === ver) return null;
      return { ver: ver, moves: moves.map(report), selected: selection.length, hot: hotId, close: wantClose, snap: snap };
    },
    moves: function() { return moves.map(report); },
    remove: function(id) { removeMove(id); },
    highlight: function(id) { hotId = id; bump(); draw(); },
    setSnap: function(on) { setSnapMode(on); },
    hideChrome: function() { setHover(null); tip.style.display = 'none'; selection = []; delId = null; hotId = null; draw(); },
    clear: teardown,
  };

${SHARED.selectorHelper('__cm')}

  draw();
  return true;
})()`;
}

module.exports = { getMoveScript };
