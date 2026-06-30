const SHARED = require('./inject-shared');
const { Z } = require('./ui-constants');

function getPopupScript(elements, mouseUpX, mouseUpY) {
  const elementsJSON = JSON.stringify(elements);

  return `(function() {
  const existing = document.getElementById('__cathode_popup_host__');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    let resolved = false;
    let items = ${elementsJSON};
    let savedInstruction = '';
    let introDone = false;

    function done(result) {
      if (resolved) return;
      resolved = true;
      host.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(result);
    }

    const host = document.createElement('div');
    host.id = '__cathode_popup_host__';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:${Z.OVERLAY_TOP};pointer-events:none;';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // Smart positioning: appear at mouseup, clamp to viewport
    const POPUP_W = 360;
    let px = ${mouseUpX};
    let py = ${mouseUpY};
    if (px + POPUP_W + 10 > window.innerWidth)  px = window.innerWidth - POPUP_W - 10;
    if (px < 10) px = 10;
    // vertical: flip above cursor if near bottom
    const APPROX_H = 420;
    if (py + APPROX_H > window.innerHeight - 10) py = Math.max(10, py - APPROX_H);

    function build() {
      const rows = items.map((item, i) => \`
        <div class="el-row">
          <span class="el-name">\${esc(item.label)}</span>
          <button class="el-x" data-i="\${i}" tabindex="-1">✕</button>
        </div>
      \`).join('');

      shadow.innerHTML = \`
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          .popup {
            position: fixed;
            left: \${px}px;
            top: \${py}px;
            width: \${POPUP_W}px;
            background: #080808;
            border: 1px solid #222;
            border-radius: 6px;
            box-shadow: 0 16px 56px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.04);
            font-family: 'Consolas', 'Cascadia Code', 'Courier New', monospace;
            overflow: hidden;
            pointer-events: all;
            user-select: none;
          }
          .section-title {
            font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #fff;
            padding: 14px 16px 10px;
          }
          .divider { height: 1px; background: #1c1c1c; }
          .el-list { padding: 4px 0; max-height: 185px; overflow-y: auto; }
          .el-list::-webkit-scrollbar { width: 4px; }
          .el-list::-webkit-scrollbar-track { background: transparent; }
          .el-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
          .el-row {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            border-bottom: 1px solid #0f0f0f;
            transition: background 0.1s;
          }
          .el-row:hover { background: #111; }
          .el-row:last-child { border-bottom: none; }
          .el-name {
            flex: 1;
            font-size: 12px;
            color: #555;
            transition: color 0.1s;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .el-row:hover .el-name { color: #aaa; }
          .el-x {
            background: none;
            border: none;
            color: #333;
            font-size: 11px;
            cursor: pointer;
            padding: 2px 4px;
            flex-shrink: 0;
            font-family: inherit;
            transition: color 0.1s;
            pointer-events: all;
          }
          .el-x:hover { color: #888; }
          .inst-title {
            font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #fff;
            padding: 12px 16px 8px;
          }
          .textarea-wrap {
            position: relative;
            margin: 0 10px 12px;
          }
          textarea {
            display: block;
            width: 100%;
            min-height: 88px;
            background: #141414;
            border: 1px solid #1e1e1e;
            border-radius: 4px;
            color: #666;
            font-family: 'Consolas', 'Cascadia Code', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.5;
            padding: 10px 36px 28px 10px;
            resize: vertical;
            outline: none;
            pointer-events: all;
            user-select: text;
          }
          textarea::placeholder { color: #333; }
          textarea:focus { border-color: #2a2a2a; color: #888; }
          .send-btn {
            position: absolute;
            right: 8px;
            bottom: 8px;
            background: none;
            border: none;
            color: #3a3a3a;
            cursor: pointer;
            padding: 4px;
            line-height: 0;
            transition: color 0.12s;
            pointer-events: all;
          }
          .send-btn:hover { color: #aaa; }
        </style>
        <div class="popup">
          <div class="section-title">Targeted Elements</div>
          <div class="divider"></div>
          <div class="el-list">\${rows}</div>
          <div class="inst-title">Instructions</div>
          <div class="textarea-wrap">
            <textarea placeholder="give instructions here"></textarea>
            <button class="send-btn" title="Send (Enter)">
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

      // Restore textarea
      const ta = shadow.querySelector('textarea');
      ta.value = savedInstruction;
      ta.addEventListener('input', () => { savedInstruction = ta.value; });

      // X buttons
      shadow.querySelectorAll('.el-x').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          items.splice(parseInt(btn.dataset.i), 1);
          if (items.length === 0) { done(null); return; }
          build();
        });
      });

      // Send button
      shadow.querySelector('.send-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        done({ items, instruction: shadow.querySelector('textarea').value.trim() });
      });

      // Enter to send, Shift+Enter for newline
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          done({ items, instruction: ta.value.trim() });
        }
      });

      // Intro: grow down from the title + fade in (first build only)
      if (!introDone) {
        introDone = true;
        const popup = shadow.querySelector('.popup');
        const tt = shadow.querySelector('.section-title');
        const startH = (tt ? tt.offsetHeight : 36) + 4;
        const fullH = popup ? popup.scrollHeight : 0;
        if (popup && fullH > startH) {
          popup.style.transition = 'none';
          popup.style.opacity = '0';
          popup.style.height = startH + 'px';
          void popup.offsetHeight;
          requestAnimationFrame(() => {
            popup.style.transition = 'height 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.22s ease';
            popup.style.opacity = '1';
            popup.style.height = fullH + 'px';
          });
          popup.addEventListener('transitionend', function te(e) {
            if (e.target !== popup || e.propertyName !== 'height') return;
            popup.style.height = '';
            popup.style.transition = '';
            popup.removeEventListener('transitionend', te);
          });
        }
      }
    }

${SHARED.escHelper}

    build();

    // Click outside to dismiss (delayed to avoid immediate self-dismiss)
    setTimeout(() => {
      document.addEventListener('click', function onOutside(e) {
        const path = e.composedPath();
        if (!path.includes(host)) {
          document.removeEventListener('click', onOutside, true);
          done(null);
        }
      }, true);
    }, 150);

    function onEsc(e) { if (e.key === 'Escape') done(null); }
    document.addEventListener('keydown', onEsc, true);
  });
})()`;
}

module.exports = { getPopupScript };
