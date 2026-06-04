function getCombinedScript({ isClick, bounds, cx, cy, mouseUpX, mouseUpY }) {
  const b = JSON.stringify(bounds || {});

  return `(function() {
  ['__cathode_popup_host__', '__cathode_row_hl__'].forEach(id => {
    const e = document.getElementById(id); if (e) e.remove();
  });

  // ── Element detection ───────────────────────────────────────────
  function getInfo(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (['html','body','head','script','style','meta','link','noscript'].includes(tag)) return null;
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    const id = el.id ? '#' + el.id : '';
    const fk = Object.keys(el).find(k =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let reactName = null;
    let debugSource = null;
    if (fk) {
      let fiber = el[fk];
      while (fiber) {
        if (fiber.type && typeof fiber.type === 'function') {
          const n = fiber.type.displayName || fiber.type.name || '';
          if (n && !/^[a-z]/.test(n) && n !== 'Component' && n !== 'Fragment') {
            reactName = n;
            if (fiber._debugSource) {
              debugSource = { file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber };
            }
            break;
          }
        }
        fiber = fiber.return;
      }
    }
    return { el, label: reactName || (tag + id + (cls ? '.' + cls : '')), reactComponent: reactName, tag, debugSource };
  }

  let items;
  ${isClick ? `
    const _el = document.elementFromPoint(${Math.round(cx)}, ${Math.round(cy)});
    const _info = getInfo(_el);
    items = _info ? [_info] : [];
  ` : `
    const _b = ${b};
    const _seen = new Set();
    items = [];
    for (const _el of document.querySelectorAll('*')) {
      if (items.length >= 14) break;
      if (_el.id && _el.id.startsWith('__cathode')) continue;
      const _r = _el.getBoundingClientRect();
      if (_r.width < 2 || _r.height < 2) continue;
      if (_r.width > window.innerWidth * 0.95 && _r.height > window.innerHeight * 0.95) continue;
      if (_r.right < _b.x || _r.left > _b.x + _b.width ||
          _r.bottom < _b.y || _r.top > _b.y + _b.height) continue;
      const _info = getInfo(_el);
      if (!_info || _seen.has(_info.label)) continue;
      _seen.add(_info.label);
      items.push(_info);
    }
  `}

  if (!items || items.length === 0) return null;

  // ── Hover highlight ─────────────────────────────────────────────
  const hl = document.createElement('div');
  hl.id = '__cathode_row_hl__';
  hl.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483645',
    'border:2px solid #4a9eff', 'background:rgba(74,158,255,0.09)',
    'box-sizing:border-box', 'border-radius:2px', 'display:none',
  ].join(';');
  const hlTag = document.createElement('div');
  hlTag.style.cssText = [
    'position:absolute', 'bottom:100%', 'left:-2px',
    'background:#4a9eff', 'color:#fff',
    'font:700 10px/16px monospace', 'padding:1px 7px',
    'border-radius:3px 3px 0 0', 'white-space:nowrap',
  ].join(';');
  hl.appendChild(hlTag);
  document.documentElement.appendChild(hl);

  function showHl(item) {
    const r = item.el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { hl.style.display = 'none'; return; }
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px';
    hlTag.textContent = item.label;
    hl.style.display = 'block';
  }
  function hideHl() { hl.style.display = 'none'; }

  // ── Popup ───────────────────────────────────────────────────────
  return new Promise((resolve) => {
    let resolved = false;
    let savedInstruction = '';

    function done(result) {
      if (resolved) return;
      resolved = true;
      host.remove();
      hl.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(result);
    }

    // Host: full-viewport fixed layer appended to <html> so no page
    // transform/overflow can clip or hide it.
    const host = document.createElement('div');
    host.id = '__cathode_popup_host__';
    host.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:100vw', 'height:100vh',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const POPUP_W = 360;
    // Initial position: at mouseup, clamped to viewport
    let curX = Math.min(${mouseUpX}, window.innerWidth  - POPUP_W - 10);
    let curY = ${mouseUpY};
    curX = Math.max(10, curX);
    if (curY + 460 > window.innerHeight - 10) curY = Math.max(10, curY - 460);

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function sendResult() {
      const ta = shadow.querySelector('textarea');
      done({
        items: items.map(({ label, reactComponent, tag, debugSource }) => ({ label, reactComponent, tag, debugSource })),
        instruction: ta ? ta.value.trim() : '',
      });
    }

    function build() {
      const rows = items.map((item, i) => \`
        <div class="el-row" data-i="\${i}">
          <span class="el-name">\${esc(item.label)}</span>
          <button class="el-x" data-i="\${i}" tabindex="-1">✕</button>
        </div>
      \`).join('');

      shadow.innerHTML = \`
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

          /* Popup is position:absolute inside the fixed full-viewport host —
             immune to page transforms and overflow:hidden on body/ancestors. */
          .popup {
            position: absolute;
            left: \${curX}px;
            top: \${curY}px;
            width: \${POPUP_W}px;
            background: #080808;
            border: 1px solid #222;
            border-radius: 6px;
            box-shadow: 0 16px 56px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.04);
            font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            overflow: hidden;
            pointer-events: all;
            user-select: none;
          }

          /* Drag handle / title row */
          .popup-titlebar {
            display: flex;
            align-items: center;
            padding: 10px 16px 6px;
            cursor: grab;
          }
          .popup-titlebar:active { cursor: grabbing; }
          .section-title {
            flex: 1;
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 10px; font-weight: 800;
            letter-spacing: 0.18em; text-transform: uppercase;
            color: #fff;
          }
          .popup-close {
            background: none; border: none;
            color: #444; font-size: 13px;
            cursor: pointer; padding: 2px 4px;
            border-radius: 3px; line-height: 1;
            transition: background 0.1s, color 0.1s;
            pointer-events: all;
          }
          .popup-close:hover { background: #2a2a2a; color: #ccc; }

          .divider { height: 1px; background: #1c1c1c; }

          .el-list { padding: 4px 0; max-height: 185px; overflow-y: auto; }
          .el-list::-webkit-scrollbar { width: 4px; }
          .el-list::-webkit-scrollbar-track { background: transparent; }
          .el-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }

          .el-row {
            display: flex; align-items: center;
            padding: 8px 16px;
            border-bottom: 1px solid #0f0f0f;
            cursor: default;
            transition: background 0.1s;
          }
          .el-row:last-child { border-bottom: none; }
          .el-row:hover { background: #111; }
          .el-name {
            flex: 1; font-size: 12px; color: #555;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            transition: color 0.1s;
          }
          .el-row:hover .el-name { color: #bbb; }
          .el-x {
            background: none; border: none;
            color: #333; font-size: 11px;
            cursor: pointer; padding: 2px 4px;
            flex-shrink: 0; font-family: inherit;
            transition: color 0.1s; pointer-events: all;
          }
          .el-x:hover { color: #888; }

          .inst-title {
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 10px; font-weight: 800;
            letter-spacing: 0.18em; text-transform: uppercase;
            color: #fff; padding: 12px 16px 8px;
          }
          .textarea-wrap { position: relative; margin: 0 10px 12px; }
          textarea {
            display: block; width: 100%; min-height: 88px;
            background: #141414; border: 1px solid #1e1e1e;
            border-radius: 4px; color: #666;
            font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            font-size: 12px; line-height: 1.5;
            padding: 10px 36px 28px 10px;
            resize: vertical; outline: none;
            pointer-events: all; user-select: text;
          }
          textarea::placeholder { color: #333; }
          textarea:focus { border-color: #2a2a2a; color: #888; }
          .send-btn {
            position: absolute; right: 8px; bottom: 8px;
            background: none; border: none; color: #3a3a3a;
            cursor: pointer; padding: 4px; line-height: 0;
            transition: color 0.12s; pointer-events: all;
          }
          .send-btn:hover { color: #aaa; }
        </style>

        <div class="popup">
          <div class="popup-titlebar">
            <span class="section-title">Targeted Elements</span>
            <button class="popup-close" title="Close">✕</button>
          </div>
          <div class="divider"></div>
          <div class="el-list">\${rows}</div>
          <div class="inst-title">Instructions</div>
          <div class="textarea-wrap">
            <textarea placeholder="give instructions here"></textarea>
            <button class="send-btn" title="Send (Ctrl+Enter)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"
                         fill="currentColor" stroke="none"></polygon>
              </svg>
            </button>
          </div>
        </div>
      \`;

      // ── Drag ─────────────────────────────────────────────────────
      const popup   = shadow.querySelector('.popup');
      const titlebar = shadow.querySelector('.popup-titlebar');
      titlebar.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('popup-close')) return;
        const startX = e.clientX - curX;
        const startY = e.clientY - curY;
        e.preventDefault();
        function onMove(e) {
          curX = Math.max(0, Math.min(window.innerWidth  - POPUP_W,  e.clientX - startX));
          curY = Math.max(0, Math.min(window.innerHeight - 60,        e.clientY - startY));
          popup.style.left = curX + 'px';
          popup.style.top  = curY + 'px';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup',   onUp,   true);
        }
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup',   onUp,   true);
      });

      // ── Close button ──────────────────────────────────────────────
      shadow.querySelector('.popup-close').addEventListener('click', (e) => {
        e.stopPropagation();
        done(null);
      });

      // ── Textarea ──────────────────────────────────────────────────
      const ta = shadow.querySelector('textarea');
      ta.value = savedInstruction;
      ta.addEventListener('input', () => { savedInstruction = ta.value; });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); sendResult();
        }
      });

      // ── Row hover → highlight in page ─────────────────────────────
      shadow.querySelectorAll('.el-row').forEach((row) => {
        const i = parseInt(row.dataset.i);
        row.addEventListener('mouseenter', () => showHl(items[i]));
        row.addEventListener('mouseleave', hideHl);
      });

      // ── Row X buttons ─────────────────────────────────────────────
      shadow.querySelectorAll('.el-x').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          hideHl();
          items.splice(parseInt(btn.dataset.i), 1);
          if (items.length === 0) { done(null); return; }
          build();
        });
      });

      // ── Send ──────────────────────────────────────────────────────
      shadow.querySelector('.send-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        sendResult();
      });
    }

    build();

    // Click outside to dismiss (after short delay to avoid self-dismiss)
    setTimeout(() => {
      document.addEventListener('click', function onOut(e) {
        if (!e.composedPath().includes(host)) {
          document.removeEventListener('click', onOut, true);
          done(null);
        }
      }, true);
    }, 150);

    function onEsc(e) { if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onEsc, true);
  });
})()`;
}

module.exports = { getCombinedScript };
