const fs   = require('fs');
const path = require('path');
const { MARCH_OUTLINE_CSS, MARCH_KEYFRAMES_JS } = require('./inject-styles');
const { Z } = require('./ui-constants');

const LASSO_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'icons', 'lasso-cursor.svg'), 'utf8')).toString('base64');
const LASSO_CURSOR = `url("data:image/svg+xml;base64,${LASSO_B64}") 9 2, crosshair`;

const BOX_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'icons', 'box-select-cursor.svg'), 'utf8')).toString('base64');
const BOX_CURSOR = `url("data:image/svg+xml;base64,${BOX_B64}") 14 4, crosshair`;

const STORYBOOK_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'icons', 'storybook-cursor.svg'), 'utf8')).toString('base64');
const STORYBOOK_CURSOR = `url("data:image/svg+xml;base64,${STORYBOOK_B64}") 9 9, crosshair`;

const EXTRACT_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'icons', 'extract-cursor.svg'), 'utf8')).toString('base64');
const EXTRACT_CURSOR = `url("data:image/svg+xml;base64,${EXTRACT_B64}") 3 3, crosshair`;

function getPickerScript(mode) {
  const cursorCss = mode === 'lasso' ? LASSO_CURSOR
    : mode === 'box'       ? BOX_CURSOR
    : mode === 'aidev'     ? EXTRACT_CURSOR
    : mode === 'component' ? STORYBOOK_CURSOR
    : 'crosshair';
  return `(function() {
  ${MARCH_KEYFRAMES_JS}
  const existing = document.getElementById('__cathode_picker__');
  if (existing) existing.remove();
  const existingHl = document.getElementById('__cathode_hl__');
  if (existingHl) existingHl.remove();
  const existingSel = document.getElementById('__cathode_selection__');
  if (existingSel) existingSel.remove();

  return new Promise((resolve) => {
    let resolved = false;

    function done(result) {
      if (resolved) return;
      resolved = true;
      // Keep the drawn selection outline on the page (under the popup) so the
      // user can see what they selected. The popup removes it when it closes.
      if (shape && result && result.mode !== 'click') {
        const sel = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sel.id = '__cathode_selection__';
        sel.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${Z.SELECTION};overflow:visible;';
        sel.appendChild(shape.cloneNode(true));
        document.body.appendChild(sel);
      }
      overlay.remove();
      hl.remove();
      document.removeEventListener('keydown', onKeyDown);
      resolve(result);
    }

    // Hover highlight box
    const hl = document.createElement('div');
    hl.id = '__cathode_hl__';
    hl.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:${Z.HOVER_HIGHLIGHT}',
      'box-sizing:border-box', 'transition:left 40ms,top 40ms,width 40ms,height 40ms',
      '${MARCH_OUTLINE_CSS}',
    ].join(';');
    document.body.appendChild(hl);

    // Label that follows the highlight
    const label = document.createElement('div');
    label.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:${Z.HOVER_HIGHLIGHT}',
      'background:#FF5720', 'color:#fff', 'font:bold 11px/18px monospace',
      'padding:1px 6px', 'border-radius:2px', 'white-space:nowrap',
    ].join(';');
    document.body.appendChild(label);

    // Full-page capture overlay
    const overlay = document.createElement('div');
    overlay.id = '__cathode_picker__';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:${Z.OVERLAY};cursor:${cursorCss}';
    document.body.appendChild(overlay);

    // SVG canvas for drawing shapes
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    overlay.appendChild(svg);

    let drawing = false, startX = 0, startY = 0;
    let pathPoints = [];
    let shape = null;
    const MODE = ${JSON.stringify(mode)};
    const isBox = MODE === 'box' || MODE === 'aidev';

    function getLabelText(el) {
      if (!el) return '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
        : '';
      const id = el.id ? '#' + el.id : '';
      return el.tagName.toLowerCase() + id + cls;
    }

    // Hover
    overlay.addEventListener('mousemove', (e) => {
      if (drawing) return;
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = '';
      if (el && el !== overlay) {
        const r = el.getBoundingClientRect();
        hl.style.cssText += ';left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;display:block;';
        label.textContent = getLabelText(el);
        const lTop = r.top > 22 ? r.top - 20 : r.bottom + 2;
        label.style.left = r.left + 'px';
        label.style.top = lTop + 'px';
        label.style.display = 'block';
      }
    });

    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();

      // Extract tool: holding Shift selects the whole page
      if (MODE === 'aidev' && e.shiftKey) {
        done({
          mode: 'click', wholePage: true,
          cx: e.clientX, cy: e.clientY,
          mouseUpX: e.clientX, mouseUpY: e.clientY,
          bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
          scrollX: window.scrollX, scrollY: window.scrollY,
        });
        return;
      }

      drawing = true;
      hl.style.display = 'none';
      label.style.display = 'none';
      startX = e.clientX; startY = e.clientY;
      pathPoints = [{ x: e.clientX, y: e.clientY }];

      if (isBox) {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      } else {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      }
      shape.setAttribute('fill', 'rgba(255,87,32,0.10)');
      shape.setAttribute('stroke', '#FF5720');
      shape.setAttribute('stroke-width', '1.5');
      shape.setAttribute('stroke-dasharray', '4,3');
      shape.setAttribute('stroke-linejoin', 'round');
      shape.setAttribute('stroke-linecap', 'butt');
      shape.style.animation = 'cathode-march-svg 0.6s linear infinite';   /* marching ants */
      shape.style.filter = 'drop-shadow(0 0 6px rgba(255,87,32,0.5))';     /* orange glow */
      svg.appendChild(shape);
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!drawing || !shape) return;
      if (isBox) {
        shape.setAttribute('x', Math.min(startX, e.clientX));
        shape.setAttribute('y', Math.min(startY, e.clientY));
        shape.setAttribute('width', Math.abs(e.clientX - startX));
        shape.setAttribute('height', Math.abs(e.clientY - startY));
      } else {
        pathPoints.push({ x: e.clientX, y: e.clientY });
        const d = pathPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ' ' + p.y).join(' ') + ' Z';
        shape.setAttribute('d', d);
      }
    });

    overlay.addEventListener('mouseup', (e) => {
      if (!drawing) return;
      drawing = false;
      const dx = e.clientX - startX, dy = e.clientY - startY;

      // Small movement = treat as single element click
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        overlay.style.pointerEvents = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = '';
        const r = el ? el.getBoundingClientRect() : { left: e.clientX, top: e.clientY, width: 1, height: 1 };
        done({
          mode: 'click',
          cx: e.clientX, cy: e.clientY,
          mouseUpX: e.clientX, mouseUpY: e.clientY,
          bounds: { x: r.left, y: r.top, width: r.width, height: r.height },
          scrollX: window.scrollX, scrollY: window.scrollY,
        });
        return;
      }

      let bounds;
      if (isBox) {
        bounds = {
          x: Math.min(startX, e.clientX), y: Math.min(startY, e.clientY),
          width: Math.abs(dx), height: Math.abs(dy),
        };
      } else {
        const xs = pathPoints.map(p => p.x), ys = pathPoints.map(p => p.y);
        bounds = {
          x: Math.min(...xs), y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }

      done({
        mode: MODE,
        cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2,
        mouseUpX: e.clientX, mouseUpY: e.clientY,
        bounds,
        scrollX: window.scrollX, scrollY: window.scrollY,
      });
    });

    function onKeyDown(e) { if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onKeyDown);
  });
})()`;
}

module.exports = { getPickerScript };
