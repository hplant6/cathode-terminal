const { Z } = require('./ui-constants');

function getScreenshotPopupScript(thumbB64, mouseUpX, mouseUpY) {
  const POPUP_W = 340;
  const thumbData = `data:image/png;base64,${thumbB64}`;

  return `(function() {
  const existing = document.getElementById('__cathode_shot_popup__');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    let resolved = false;
    function done(result) {
      if (resolved) return;
      resolved = true;
      host.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(result);
    }

    const host = document.createElement('div');
    host.id = '__cathode_shot_popup__';
    host.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:100vw', 'height:100vh',
      'pointer-events:none', 'z-index:${Z.OVERLAY_TOP}',
    ].join(';');
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const POPUP_W = ${POPUP_W};
    let curX = Math.min(${mouseUpX}, window.innerWidth - POPUP_W - 10);
    let curY = ${mouseUpY} + 12;
    curX = Math.max(10, curX);
    if (curY + 340 > window.innerHeight - 10) curY = Math.max(10, ${mouseUpY} - 340 - 12);

    function sendResult() {
      const ta = shadow.querySelector('textarea');
      done({ instruction: ta ? ta.value.trim() : '' });
    }

    shadow.innerHTML = \`
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .popup {
          position: absolute;
          left: \${curX}px; top: \${curY}px;
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
        .titlebar {
          display: flex; align-items: center;
          padding: 10px 16px 8px;
          cursor: grab; border-bottom: 1px solid #1c1c1c;
        }
        .titlebar:active { cursor: grabbing; }
        .title {
          flex: 1;
          font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.18em; text-transform: uppercase; color: #fff;
        }
        .close-btn {
          background: none; border: none; color: #444; font-size: 13px;
          cursor: pointer; padding: 2px 4px; border-radius: 3px; line-height: 1;
          transition: background 0.1s, color 0.1s; pointer-events: all;
        }
        .close-btn:hover { background: #2a2a2a; color: #ccc; }
        .thumb-wrap { padding: 10px 10px 6px; }
        .thumb {
          display: block; width: 100%; max-height: 160px;
          object-fit: cover; object-position: top left;
          border-radius: 3px; border: 1px solid #1e1e1e;
        }
        .inst-title {
          font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.18em; text-transform: uppercase;
          color: #fff; padding: 8px 16px 6px;
        }
        .textarea-wrap { position: relative; margin: 0 10px 12px; }
        textarea {
          display: block; width: 100%; min-height: 72px;
          background: #141414; border: 1px solid #1e1e1e; border-radius: 4px;
          color: #666; font-family: 'Consolas','Cascadia Code','Courier New',monospace;
          font-size: 12px; line-height: 1.5;
          padding: 10px 36px 10px 10px;
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
        <div class="titlebar">
          <span class="title">Screenshot</span>
          <button class="close-btn" title="Close">✕</button>
        </div>
        <div class="thumb-wrap">
          <img class="thumb" src="${thumbData}" alt="screenshot" />
        </div>
        <div class="inst-title">Instructions</div>
        <div class="textarea-wrap">
          <textarea placeholder="describe what to change…" autofocus></textarea>
          <button class="send-btn" title="Send (Ctrl+Enter)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none"></polygon>
            </svg>
          </button>
        </div>
      </div>
    \`;

    const popup    = shadow.querySelector('.popup');
    const titlebar = shadow.querySelector('.titlebar');
    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('close-btn')) return;
      const ox = e.clientX - curX, oy = e.clientY - curY;
      e.preventDefault();
      function onMove(e) {
        curX = Math.max(0, Math.min(window.innerWidth  - POPUP_W, e.clientX - ox));
        curY = Math.max(0, Math.min(window.innerHeight - 60,       e.clientY - oy));
        popup.style.left = curX + 'px'; popup.style.top = curY + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup',   onUp,   true);
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup',   onUp,   true);
    });

    shadow.querySelector('.close-btn').addEventListener('click', () => done(null));
    shadow.querySelector('.send-btn').addEventListener('click',  (e) => { e.stopPropagation(); sendResult(); });

    const ta = shadow.querySelector('textarea');
    setTimeout(() => ta && ta.focus(), 50);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendResult(); }
    });

    // Click outside to dismiss
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

module.exports = { getScreenshotPopupScript };
