// ── Combined element-popup script (page side) ─────────────────────
// cathodeCombinedPage is a REAL function — lintable and syntax-checked at
// require time — serialized with .toString() and executed inside the browsed
// page. It must stay fully self-contained: no closure references; everything
// it needs arrives through OPTS. getCombinedScript() below builds the string.
const { Z } = require('./ui-constants');

// Computed-style properties surfaced per element in the popup.
const CSS_PROPS = [
    'display','flex-direction','flex-wrap','justify-content','align-items','align-self',
    'gap','grid-template-columns','grid-template-rows',
    'width','height','min-width','max-width','min-height','max-height',
    'padding-top','padding-right','padding-bottom','padding-left',
    'margin-top','margin-right','margin-bottom','margin-left',
    'position','top','right','bottom','left','z-index',
    'font-size','font-weight','font-family','line-height','letter-spacing',
    'text-align','text-transform','color',
    'background-color','background-image','background-size',
    'border-radius','border-top-width','border-top-color','border-top-style',
    'box-shadow','opacity','overflow','cursor','transform',
  ];

function cathodeCombinedPage(OPTS) {
  const { isClick, bounds, cx, cy, mouseUpX, mouseUpY, aiDevMode, wholePage, CSS_PROPS, Z } = OPTS;
  ['__cathode_popup_host__', '__cathode_row_hl__'].forEach(id => {
    const e = document.getElementById(id); if (e) e.remove();
  });

  // ── Element detection ───────────────────────────────────────────
  function getInfo(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (['html','body','head','script','style','meta','link','noscript'].includes(tag)) return null;
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 2).join('.')
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
    const cssSelector = tag + id + (cls ? '.' + cls : '');
    return { el, label: reactName || cssSelector, cssSelector, reactComponent: reactName, tag, debugSource };
  }

  let items;
  if (wholePage) {
    const _el = document.body || document.documentElement;
    const _info = getInfo(_el);
    items = _info ? [_info] : [];
  } else if (isClick) {
    const _el = document.elementFromPoint(cx, cy);
    const _info = getInfo(_el);
    items = _info ? [_info] : [];
  } else {
    const _b = bounds;
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
  }

  if (!items || items.length === 0) return null;

  // ── CSS extraction (computed values per element) ────────────────
  // CSS_PROPS arrives via OPTS (same list main.js uses).
  function getElementCSS(el) {
    try {
      const style = window.getComputedStyle(el);
      const props = [];
      for (const name of CSS_PROPS) {
        const value = (style.getPropertyValue(name) || '').trim();
        if (!value) continue;
        if (value === 'rgba(0, 0, 0, 0)') continue;
        if (/^(padding|margin)/.test(name) && value === '0px') continue;
        if ((name === 'transition' || name === 'animation') && value.startsWith('none')) continue;
        props.push({ name, value });
      }
      return props;
    } catch (_) { return []; }
  }
  for (const item of items) {
    item.cssProps = getElementCSS(item.el);
  }

  // ── Hover highlight ─────────────────────────────────────────────
  const hl = document.createElement('div');
  hl.id = '__cathode_row_hl__';
  hl.style.cssText = [
    'position:fixed','pointer-events:none','z-index:' + Z.ROW_HIGHLIGHT,
    'border:2px solid #22d3ee','background:rgba(34,211,238,0.12)',
    'box-sizing:border-box','border-radius:2px','display:none',
  ].join(';');
  const hlTag = document.createElement('div');
  hlTag.style.cssText = [
    'position:absolute','bottom:100%','left:-2px',
    'background:#22d3ee','color:#06141a',
    'font:700 10px/16px monospace','padding:1px 7px',
    'border-radius:3px 3px 0 0','white-space:nowrap',
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
    const expandedSet = new Set();
    const checkedCSS   = {}; // { [itemIndex]: Set<propName> }
    const modifiedProps = {}; // { [itemIndex]: { [propName]: newValue } }
    let cpEl = null, cpIro = null;
    let cpSyncing = false, cpBuilt = false, cpMode = 'hex';
    let cpCurrentApply = null, cpCurrentSwatch = null;
    let cpInputEls = null;  // cached after buildCpEl — avoids getElementById on every color change
    let cpSetMode  = null;  // assigned in buildCpEl so showColorPicker can call it after display:block

    function done(result) {
      if (resolved) return;
      resolved = true;
      host.remove();
      hl.remove();
      const sel = document.getElementById('__cathode_selection__');
      if (sel) sel.remove();   // clear the persisted selection outline on close
      if (cpIro) { try { cpIro.off('color:change'); } catch(e){ console.warn('[iro]', e); } cpIro = null; }
      if (cpEl) { cpEl.remove(); cpEl = null; cpBuilt = false; cpInputEls = null; cpSetMode = null; }
      document.removeEventListener('keydown', onEsc, true);
      resolve(result);
    }

    const host = document.createElement('div');
    host.id = '__cathode_popup_host__';
    host.style.cssText = [
      'position:fixed','top:0','left:0',
      'width:100vw','height:100vh',
      'pointer-events:none',
      'z-index:' + Z.OVERLAY,
    ].join(';');
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const POPUP_W = 380;
    let curX = Math.min(mouseUpX, window.innerWidth - POPUP_W - 10);
    let curY = mouseUpY;
    curX = Math.max(10, curX);
    if (curY + 520 > window.innerHeight - 10) curY = Math.max(10, curY - 520);

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function hideColorPicker() {
      if (cpEl) cpEl.style.display = 'none';
      if (cpIro) { try { cpIro.off('color:change'); } catch(e){ console.warn('[iro]', e); } }
    }

    function loadIro(cb) {
      if (window.iro) { cb(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5/dist/iro.min.js';
      s.onload = cb;
      document.head.appendChild(s);
    }

    function syncCpInputs(color) {
      if (!cpInputEls) return;
      cpSyncing = true;
      cpInputEls.hex.value = color.hexString;
      const rgb = color.rgb;
      cpInputEls.r.value = rgb.r;
      cpInputEls.g.value = rgb.g;
      cpInputEls.b.value = rgb.b;
      const hsl = color.hsl;
      cpInputEls.h.value = Math.round(hsl.h);
      cpInputEls.s.value = Math.round(hsl.s);
      cpInputEls.l.value = Math.round(hsl.l);
      cpSyncing = false;
    }

    function buildCpEl() {
      cpBuilt = true;
      cpEl = document.createElement('div');
      cpEl.style.cssText = [
        'position:fixed','z-index:' + Z.OVERLAY,
        'background:#0d0d0d','border:1px solid #2a2a2a',
        'border-radius:8px','padding:12px',
        'box-shadow:0 8px 40px rgba(0,0,0,0.9)',
        'display:none','font-family:Consolas,monospace',
        'color:#888','user-select:none','width:224px'
      ].join(';');

      cpEl.innerHTML =
        '<div id="__cathode_iro__"></div>' +
        '<div style="margin-top:10px">' +
          '<div id="__cp_bar__" style="position:relative;display:flex;background:#111;border:1px solid #222;border-radius:20px;padding:2px;">' +
            '<div id="__cp_thumb__" style="position:absolute;top:2px;bottom:2px;left:2px;background:#1a1400;border:1px solid #d4aa00;border-radius:16px;transition:left 0.18s ease,width 0.18s ease;pointer-events:none;"></div>' +
            '<button id="__cp_m_hex__" style="flex:1;background:transparent;border:none;color:#d4aa00;font-size:10px;font-weight:600;cursor:pointer;padding:5px 0;border-radius:16px;position:relative;z-index:1;font-family:Consolas,monospace;letter-spacing:0.05em;">HEX</button>' +
            '<button id="__cp_m_rgb__" style="flex:1;background:transparent;border:none;color:#555;font-size:10px;font-weight:600;cursor:pointer;padding:5px 0;border-radius:16px;position:relative;z-index:1;font-family:Consolas,monospace;letter-spacing:0.05em;">RGB</button>' +
            '<button id="__cp_m_hsl__" style="flex:1;background:transparent;border:none;color:#555;font-size:10px;font-weight:600;cursor:pointer;padding:5px 0;border-radius:16px;position:relative;z-index:1;font-family:Consolas,monospace;letter-spacing:0.05em;">HSL</button>' +
          '</div>' +
          '<div id="__cp_p_hex__" style="margin-top:7px;">' +
            '<input id="__cp_hex__" type="text" style="width:100%;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 8px;font-family:Consolas,monospace;font-size:11px;outline:none;box-sizing:border-box;"/>' +
          '</div>' +
          '<div id="__cp_p_rgb__" style="margin-top:7px;display:none;">' +
            '<div style="display:flex;gap:4px;align-items:center;">' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">R</span>' +
              '<input id="__cp_r__" type="number" min="0" max="255" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">G</span>' +
              '<input id="__cp_g__" type="number" min="0" max="255" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">B</span>' +
              '<input id="__cp_b__" type="number" min="0" max="255" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
            '</div>' +
          '</div>' +
          '<div id="__cp_p_hsl__" style="margin-top:7px;display:none;">' +
            '<div style="display:flex;gap:4px;align-items:center;">' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">H</span>' +
              '<input id="__cp_h__" type="number" min="0" max="360" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">S</span>' +
              '<input id="__cp_s__" type="number" min="0" max="100" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
              '<span style="font-size:10px;color:#555;width:12px;text-align:center;flex-shrink:0">L</span>' +
              '<input id="__cp_l__" type="number" min="0" max="100" style="flex:1;min-width:0;background:#161616;border:1px solid #222;border-radius:3px;color:#bbb;padding:4px 4px;font-family:Consolas,monospace;font-size:11px;outline:none;"/>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.documentElement.appendChild(cpEl);

      function setCpMode(mode) {
        cpMode = mode;
        ['hex','rgb','hsl'].forEach(m => {
          const p = document.getElementById('__cp_p_' + m + '__');
          const b = document.getElementById('__cp_m_' + m + '__');
          if (p) p.style.display = m === mode ? '' : 'none';
          if (b) b.style.color = m === mode ? '#d4aa00' : '#555';
        });
        const activeBtn = document.getElementById('__cp_m_' + mode + '__');
        const thumb = document.getElementById('__cp_thumb__');
        if (activeBtn && thumb) {
          thumb.style.left = activeBtn.offsetLeft + 'px';
          thumb.style.width = activeBtn.offsetWidth + 'px';
        }
      }

      ['hex','rgb','hsl'].forEach(m => {
        const btn = document.getElementById('__cp_m_' + m + '__');
        if (!btn) return;
        btn.addEventListener('mousedown', e => e.stopPropagation());
        btn.addEventListener('click', e => { e.stopPropagation(); setCpMode(m); });
      });

      function wireCpInput(id, setter) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('mousedown', e => e.stopPropagation());
        el.addEventListener('input', () => {
          if (!cpIro || cpSyncing) return;
          cpSyncing = true;
          try { setter(el.value); } catch(e) {}
          cpSyncing = false;
          syncCpInputs(cpIro.color);
          if (cpCurrentSwatch) cpCurrentSwatch.style.background = cpIro.color.hexString;
          if (cpCurrentApply)  cpCurrentApply(cpIro.color.hexString);
        });
      }
      wireCpInput('__cp_hex__', v => { cpIro.color.hexString = v; });
      wireCpInput('__cp_r__',   v => { const c = cpIro.color.rgb; c.r = +v; cpIro.color.rgb = c; });
      wireCpInput('__cp_g__',   v => { const c = cpIro.color.rgb; c.g = +v; cpIro.color.rgb = c; });
      wireCpInput('__cp_b__',   v => { const c = cpIro.color.rgb; c.b = +v; cpIro.color.rgb = c; });
      wireCpInput('__cp_h__',   v => { const c = cpIro.color.hsl; c.h = +v; cpIro.color.hsl = c; });
      wireCpInput('__cp_s__',   v => { const c = cpIro.color.hsl; c.s = +v; cpIro.color.hsl = c; });
      wireCpInput('__cp_l__',   v => { const c = cpIro.color.hsl; c.l = +v; cpIro.color.hsl = c; });

      // Cache input elements — used by syncCpInputs on every color:change event
      cpInputEls = {
        hex: document.getElementById('__cp_hex__'),
        r:   document.getElementById('__cp_r__'),
        g:   document.getElementById('__cp_g__'),
        b:   document.getElementById('__cp_b__'),
        h:   document.getElementById('__cp_h__'),
        s:   document.getElementById('__cp_s__'),
        l:   document.getElementById('__cp_l__'),
      };

      // Expose setCpMode so showColorPicker can call it after making cpEl visible
      cpSetMode = setCpMode;
    }

    function showColorPicker(swatchEl, value, applyFn) {
      if (!cpBuilt) buildCpEl();
      cpCurrentSwatch = swatchEl;
      cpCurrentApply  = applyFn;

      const r = swatchEl.getBoundingClientRect();
      const pw = 248, ph = 340;
      const left = (r.left - pw - 10) > 0 ? r.left - pw - 10 : r.right + 10;
      const top  = Math.min(r.top, window.innerHeight - ph - 10);
      cpEl.style.left = left + 'px';
      cpEl.style.top  = top  + 'px';
      cpEl.style.display = 'block';
      if (cpSetMode) cpSetMode(cpMode);  // position thumb now that element is visible

      function attachIroListener() {
        cpIro.on('color:change', (color) => {
          if (cpSyncing) return;
          syncCpInputs(color);
          if (cpCurrentSwatch) cpCurrentSwatch.style.background = color.hexString;
          if (cpCurrentApply)  cpCurrentApply(color.hexString);
        });
      }

      if (cpIro) {
        // Reuse existing picker — just update the color and re-attach listener
        try { cpIro.off('color:change'); } catch(e){ console.warn('[iro]', e); }
        try { cpIro.color.set(value || '#ffffff'); } catch(e){}
        attachIroListener();
        syncCpInputs(cpIro.color);
        return;
      }

      // First open — create the picker
      loadIro(() => {
        const mount = document.getElementById('__cathode_iro__');
        if (mount) mount.innerHTML = '';
        try {
          cpIro = new iro.ColorPicker('#__cathode_iro__', {
            width: 200,
            color: value || '#ffffff',
            layout: [
              { component: iro.ui.Box },
              { component: iro.ui.Slider, options: { sliderType: 'hue' } },
            ]
          });
        } catch(e) { return; }
        attachIroListener();
        syncCpInputs(cpIro.color);
      });
    }

    function sendResult() {
      const ta = shadow.querySelector('textarea');
      const instruction = ta ? ta.value.trim() : '';
      const resultItems = items.map(({ label, cssSelector, reactComponent, tag, debugSource, cssProps }, i) => {
        const sel  = checkedCSS[i]    || new Set();
        const mods = modifiedProps[i] || {};
        const selectedCSS = (cssProps || [])
          .filter(p => sel.has(p.name))
          .map(p => {
            const newVal = mods[p.name];
            return newVal !== undefined
              ? p.name + ': ' + newVal + '  /* was: ' + p.value + ' */'
              : p.name + ': ' + p.value;
          });
        return { label, cssSelector, reactComponent, tag, debugSource, selectedCSS };
      });
      const actions = aiDevMode ? Array.from(shadow.querySelectorAll('.aidev-cb:checked')).map(cb => ({ label: cb.nextElementSibling?.textContent || '', instruction: cb.dataset.instruction || '' })) : [];
      done({ items: resultItems, instruction, actions });
    }

    function build() {
      const drawerRows = items.map((item, i) => {
        const isOpen = expandedSet.has(i);
        const checked = checkedCSS[i] || new Set();
        const mods    = modifiedProps[i] || {};
        const cssRows = (item.cssProps || []).map(p => `
          <label class="css-row">
            <input class="css-cb" type="checkbox" data-i="${i}" data-prop="${esc(p.name)}" ${checked.has(p.name) ? 'checked' : ''} />
            <span class="prop-name">${esc(p.name)}</span>
            <span class="prop-sep">:</span>
            ${p.name.includes('color') && (mods[p.name] || p.value) !== 'none' ? '<span class="color-swatch" style="background:' + esc(mods[p.name] !== undefined ? mods[p.name] : p.value) + '"></span>' : ''}
            <span class="prop-value${mods[p.name] !== undefined ? ' modified' : ''}"
                  data-i="${i}" data-prop="${esc(p.name)}" data-orig="${esc(p.value)}"
                  title="Click to edit">${esc(mods[p.name] !== undefined ? mods[p.name] : p.value)}</span>
          </label>
        `).join('');

        if (aiDevMode) {
          return `
            <div class="drawer aidev-el" data-i="${i}">
              <div class="drawer-header static" data-i="${i}">
                <span class="el-name">${esc(item.label)}</span>
                <button class="el-x" data-i="${i}" tabindex="-1">✕</button>
              </div>
            </div>
          `;
        }

        return `
          <div class="drawer" data-i="${i}">
            <div class="drawer-header" data-i="${i}">
              <span class="caret" data-i="${i}">${isOpen ? '▼' : '▶'}</span>
              <span class="el-name">${esc(item.label)}</span>
              <button class="el-x" data-i="${i}" tabindex="-1">✕</button>
            </div>
            <div class="drawer-body" data-i="${i}" style="display:${isOpen ? 'block' : 'none'}">
              ${cssRows ? '<div class="search-wrap"><input class="css-search" type="text" placeholder="filter…" data-i="' + i + '" autocomplete="off" spellcheck="false" /></div>' : ''}
              ${cssRows || '<div class="no-css">no CSS properties</div>'}
            </div>
          </div>
        `;
      }).join('');

      shadow.innerHTML = `
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          .popup {
            position: absolute;
            left: ${curX}px; top: ${curY}px;
            width: ${POPUP_W}px;
            background: #080808;
            border: 1px solid #222;
            border-radius: 6px;
            box-shadow: 0 16px 56px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.04);
            font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            overflow: hidden;
            pointer-events: all;
            user-select: none;
          }
          .popup-titlebar {
            display: flex; align-items: center;
            padding: 10px 16px 6px; cursor: grab;
          }
          .popup-titlebar:active { cursor: grabbing; }
          .section-title {
            flex: 1;
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 10px; font-weight: 800;
            letter-spacing: 0.18em; text-transform: uppercase; color: #fff;
          }
          .popup-close {
            background: none; border: none; color: #444; font-size: 13px;
            cursor: pointer; padding: 2px 4px; border-radius: 3px; line-height: 1;
            transition: background 0.1s, color 0.1s; pointer-events: all;
          }
          .popup-close:hover { background: #2a2a2a; color: #ccc; }
          .divider { height: 1px; background: #1c1c1c; }
          .chip-bar { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 10px; }
          .chip {
            font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            font-size: 10px; padding: 2px 8px; border-radius: 10px;
            border: 1px solid #2a2a2a; background: #0d0d0d; color: #555;
            cursor: pointer; transition: background 0.1s, color 0.1s, border-color 0.1s;
            pointer-events: all; user-select: none;
          }
          .chip:hover { border-color: #444; color: #888; }
          .chip.active { background: #1a1400; border-color: #d4aa00; color: #d4aa00; }
          .el-list { padding: 4px 0; max-height: 300px; overflow-y: auto; }
          .el-list::-webkit-scrollbar { width: 4px; }
          .el-list::-webkit-scrollbar-track { background: transparent; }
          .el-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
          .drawer { border-bottom: 1px solid #0f0f0f; }
          .drawer:last-child { border-bottom: none; }
          .drawer-header {
            display: flex; align-items: center;
            padding: 8px 12px 8px 10px; gap: 6px;
            cursor: pointer; transition: background 0.1s;
          }
          .drawer-header:hover { background: #111; }
          .drawer-header.static { cursor: default; padding-left: 12px; }
          .caret {
            font-size: 8px; color: #444; flex-shrink: 0;
            width: 10px; text-align: center;
            transition: color 0.1s; user-select: none;
          }
          .drawer-header:hover .caret { color: #777; }
          .el-name {
            flex: 1; font-size: 12px; color: #555;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            transition: color 0.1s;
          }
          .drawer-header:hover .el-name { color: #bbb; }
          .el-x {
            background: none; border: none; color: #333; font-size: 11px;
            cursor: pointer; padding: 2px 5px; flex-shrink: 0;
            font-family: inherit; border-radius: 3px;
            transition: color 0.1s, background 0.1s; pointer-events: all;
          }
          .el-x:hover { color: #888; background: #1a1a1a; }
          .drawer-body { background: #040404; border-top: 1px solid #0f0f0f; }
          .search-wrap { padding: 5px 8px; border-bottom: 1px solid #0a0a0a; }
          .css-search {
            width: 100%; background: #080808; border: 1px solid #161616;
            border-radius: 3px; color: #555;
            font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            font-size: 11px; padding: 3px 7px; outline: none;
            pointer-events: all; user-select: text; box-sizing: border-box;
          }
          .css-search::placeholder { color: #222; }
          .css-search:focus { border-color: #2a2a2a; color: #777; }
          .css-row {
            display: flex; align-items: baseline;
            gap: 5px; padding: 5px 12px 5px 26px;
            cursor: pointer; transition: background 0.08s;
          }
          .css-row:hover { background: #0c0c0c; }
          .css-cb {
            flex-shrink: 0; cursor: pointer;
            accent-color: #4a9eff; width: 11px; height: 11px; margin: 0;
          }
          .prop-name  { color: #569cd6; font-size: 11px; flex-shrink: 0; }
          .prop-sep   { color: #555;    font-size: 11px; flex-shrink: 0; }
          .color-swatch {
            display: inline-block; flex-shrink: 0;
            width: 10px; height: 10px;
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 2px;
            vertical-align: middle; margin-bottom: 1px;
          }
          .prop-value {
            color: #ce9178; font-size: 11px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            cursor: text; border-radius: 2px;
          }
          .prop-value:hover { background: #111; }
          .prop-value.modified { color: #d4aa00; }
          .prop-edit {
            color: #d4aa00; font-size: 11px; font-family: inherit;
            background: #0d0d0d; border: 1px solid #d4aa00;
            border-radius: 2px; padding: 0 3px; outline: none;
            min-width: 40px; width: auto; max-width: 160px;
            pointer-events: all; user-select: text;
          }
          .no-css { padding: 7px 26px; font-size: 11px; color: #2a2a2a; font-style: italic; }
          .inst-title {
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 10px; font-weight: 800;
            letter-spacing: 0.18em; text-transform: uppercase;
            color: #fff; padding: 12px 16px 8px;
          }
          .textarea-wrap { position: relative; margin: 0 10px 12px; }
          textarea {
            display: block; width: 100%; min-height: 88px;
            background: #141414; border: 1px solid #1e1e1e; border-radius: 4px;
            color: #666; font-family: 'Consolas','Cascadia Code','Courier New',monospace;
            font-size: 12px; line-height: 1.5; padding: 10px 36px 28px 10px;
            resize: vertical; outline: none; pointer-events: all; user-select: text;
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
          .actions-wrap { border-bottom: 1px solid #1c1c1c; padding-bottom: 4px; }
          .actions-search {
            display: block; width: calc(100% - 32px);
            margin: 6px 16px 4px; padding: 5px 8px;
            background: #111; border: 1px solid #252525; border-radius: 4px;
            color: #aaa; font-size: 11px; outline: none; box-sizing: border-box;
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
          }
          .actions-search::placeholder { color: #333; }
          .actions-search:focus { border-color: #333; }
          .actions-scroll {
            max-height: 180px; overflow-y: auto; padding: 2px 0 4px;
          }
          .actions-scroll::-webkit-scrollbar { width: 4px; }
          .actions-scroll::-webkit-scrollbar-track { background: transparent; }
          .actions-scroll::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
          .action-drawer-header {
            display: flex; align-items: center; justify-content: space-between;
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
            text-transform: uppercase; color: #444;
            padding: 8px 16px 4px; cursor: pointer; user-select: none;
          }
          .action-drawer-header:hover { color: #666; }
          .drawer-chevron {
            width: 10px; height: 10px; flex-shrink: 0;
            transition: transform 0.15s; transform: rotate(-90deg);
          }
          .action-drawer-header.open .drawer-chevron { transform: rotate(0deg); }
          .action-drawer-body { overflow: hidden; }
          .action-drawer-body.collapsed { display: none; }
          .action-row { display: flex; align-items: center; gap: 8px; padding: 4px 16px; cursor: pointer; }
          .action-row:hover { background: #111; }
          .aidev-cb { accent-color: #4a9eff; cursor: pointer; flex-shrink: 0; }
          .action-label { font-size: 12px; color: #666; cursor: pointer; user-select: none; }
          .action-row:hover .action-label { color: #aaa; }
          .action-tip {
            position: fixed; z-index: 2147483646;
            max-width: 270px; padding: 9px 11px;
            background: #161616; border: 1px solid #2e2e2e; border-radius: 6px;
            box-shadow: 0 10px 32px rgba(0,0,0,0.85);
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 11px; line-height: 1.5; color: #b8b8b8;
            pointer-events: none; user-select: none;
            opacity: 0; transition: opacity 0.1s; display: none;
          }
          .action-tip.show { display: block; opacity: 1; }
        </style>
        <div class="popup">
          <div class="popup-titlebar">
            <span class="section-title">Targeted Elements</span>
            <button class="popup-close" title="Close">✕</button>
          </div>
          <div class="divider"></div>
          ${aiDevMode ? '' : `
          <div class="chip-bar">
            <button class="chip" data-filter="color">color</button>
            <button class="chip" data-filter="font">font</button>
            <button class="chip" data-filter="padding">padding</button>
            <button class="chip" data-filter="border">border</button>
            <button class="chip" data-filter="height">height</button>
            <button class="chip" data-filter="width">width</button>
          </div>`}
          <div class="el-list">${drawerRows}</div>
          <div class="divider"></div>
          ${aiDevMode ? `
          <div class="inst-title">Actions to Perform</div>
          <div class="actions-wrap">
            <input class="actions-search" type="text" placeholder="Search actions...">
            <div class="actions-scroll" id="__aidev_actions__">
            <div class="action-drawer">
            <div class="action-drawer-header"><span>Inspect &amp; Audit</span><svg class="drawer-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 5 5 9 1"></polyline></svg></div>
            <div class="action-drawer-body collapsed">
            <label class="action-row" data-keywords="css computed styles properties inspect appearance look"><input class="aidev-cb" type="checkbox" data-instruction="Check the styles for the selected component."><span class="action-label">Check Styles</span></label>
            <label class="action-row" data-keywords="text readable legible clipped overflow wrap truncate ellipsis contrast"><input class="aidev-cb" type="checkbox" data-instruction="Check if the selected element has visible text content that is clipped, overflows its container, triggers an unexpected multi-line wrap, or is using a color that is unreadable against the background."><span class="action-label">Text Readability</span></label>
            <label class="action-row" data-keywords="contrast wcag accessibility a11y ratio color colour aa legible"><input class="aidev-cb" type="checkbox" data-instruction="For the targeted element/area, calculate the contrast ratio and ensure nothing fails the WCAG AA 4.5:1 standard."><span class="action-label">Color Contrast</span></label>
            <label class="action-row" data-keywords="design tokens variables css custom properties theme theming consistency"><input class="aidev-cb" type="checkbox" data-instruction="Extract the selected element's computed CSS properties and ensure it is using proper design tokens."><span class="action-label">Verify Design Tokens</span></label>
            <label class="action-row" data-keywords="keyboard tab focus a11y accessibility navigation enter space reachable"><input class="aidev-cb" type="checkbox" data-instruction="Verify keyboard events for the targeted element — ensure it is reachable via Tab, activatable via Enter/Space, and that focus is visually indicated."><span class="action-label">Keyboard Navigation</span></label>
            <label class="action-row" data-keywords="form error validation input field message invalid required state"><input class="aidev-cb" type="checkbox" data-instruction="Check the error states of the targeted input field or interactive element — verify error messages appear correctly, are accessible, and the field is styled appropriately on error."><span class="action-label">Verify Form Error States</span></label>
            <label class="action-row" data-keywords="z-index zindex stacking layer overlap hidden behind covered visibility"><input class="aidev-cb" type="checkbox" data-instruction="Inspect the computed z-index of the targeted element and check if it is being incorrectly hidden or overlapped by another element."><span class="action-label">Z-index Visibility</span></label>

            </div></div>
            <div class="action-drawer">
            <div class="action-drawer-header"><span>Interact</span><svg class="drawer-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 5 5 9 1"></polyline></svg></div>
            <div class="action-drawer-body collapsed">
            <label class="action-row" data-keywords="hover focus state pointer mouse keyboard tab interaction"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, hover over the targeted element and take a screenshot to capture its hover state. Then focus it via keyboard Tab and capture the focus state. Report any missing, unexpected, or inaccessible visual changes."><span class="action-label">Hover &amp; Focus States</span></label>
            <label class="action-row" data-keywords="scroll overflow scrollbar bottom top sticky lazy"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, scroll the targeted element or area to its absolute bottom, take a screenshot, then scroll back to the absolute top and take another screenshot. Report any overflow issues, missing scroll indicators, or content cut-off."><span class="action-label">Scroll</span></label>
            <label class="action-row" data-keywords="input form field type text validation submit entry typing"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, locate input fields within the targeted element or area. Type sample text to observe the active state, clear the field to observe the static/empty state, then trigger validation (submit or blur) to observe the error state. Screenshot each state and report any styling or accessibility issues."><span class="action-label">Input &amp; Forms</span></label>
            <label class="action-row" data-keywords="dropdown menu select combobox popover flyout open close"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, click any dropdown or menu trigger within the targeted element or area. Check and screenshot the open state for readability, z-index layering, color contrast, and alignment issues. Also verify the menu closes correctly on outside click or Escape."><span class="action-label">Dropdown &amp; Menus</span></label>
            <label class="action-row" data-keywords="link anchor href navigation url target blank broken dead"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, find all anchor links within the targeted element or area. For each link, check the href value, whether it opens in the same tab (_self) or a new tab (_blank), and navigate to verify the destination is correct and not broken. Report any dead links or unexpected target behavior."><span class="action-label">Verify Links</span></label>
            <label class="action-row" data-keywords="refresh reload page persistence reset load reflow"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, take a screenshot of the targeted element or area before refreshing the page. Refresh the page, wait for load to complete, then take another screenshot of the same area. Compare the before and after states and report any elements that failed to load, shifted position, or changed unexpectedly."><span class="action-label">Page Refreshing</span></label>
            <label class="action-row" data-keywords="tab tabs tabpanel switch active panel segment"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, find all tab elements within the targeted area. Click each tab one by one, taking a screenshot after each click to capture the active state. Also check the static (unselected), inactive (disabled if any), and focus states. Report any styling inconsistencies, missing states, or accessibility issues."><span class="action-label">Tabs</span></label>
            <label class="action-row" data-keywords="video media play playback autoplay controls audio mute"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, locate any video elements within the targeted area. Check whether the video is autoplaying when it should not (or failing to autoplay when it should). Observe and screenshot the playback controls. Check if the video source is loading correctly or if the element shows a broken/missing state. Report all findings."><span class="action-label">Video &amp; Playback</span></label>
            <label class="action-row" data-keywords="drag drop dnd sortable reorder move draggable"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, locate any draggable elements within the targeted area. Attempt to drag an item and drop it onto a valid target. Take screenshots before, during (if possible), and after the drag operation. Verify the drop registers correctly, the UI updates as expected, and report any broken drag handles, missing drop zones, or incorrect state after drop."><span class="action-label">Drag &amp; Drop</span></label>
            <label class="action-row" data-keywords="modal dialog popup overlay lightbox focus trap backdrop escape"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, trigger any modal or dialog within the targeted area. Screenshot the open state and verify: content is readable, focus is trapped inside (Tab cycles within the modal), the backdrop dismisses on click, and Escape closes it. Then close the modal and verify focus returns to the trigger element. Report any issues with focus management, z-index, or missing close behavior."><span class="action-label">Modal &amp; Dialog</span></label>
            <label class="action-row" data-keywords="responsive resize breakpoint mobile tablet desktop viewport rwd media query"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, resize the browser viewport to 375px (mobile), 768px (tablet), and 1280px (desktop) widths. Take a screenshot of the targeted element at each breakpoint. Report any layout breaks, overflowing content, elements that overlap, text that becomes unreadable, or interactions that stop working at smaller sizes."><span class="action-label">Resize / Responsive</span></label>
            <label class="action-row" data-keywords="copy clipboard paste button toast"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, locate any copy-to-clipboard buttons or interactions within the targeted area. Click each one and verify via browser console or page feedback (toast, tooltip, button state change) that the copy action triggered. Where possible, paste the clipboard content to confirm the correct value was copied. Report any buttons that fail silently or copy incorrect content."><span class="action-label">Copy to Clipboard</span></label>
            <label class="action-row" data-keywords="animation transition motion transform keyframe jank fade slide easing"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, trigger any CSS animations or transitions on the targeted element (hover, click, page load). Take screenshots before and after the transition. Check that transitions complete smoothly without flickering, layout shift, or paint artifacts. Verify animation duration feels appropriate and that no elements are left in a broken mid-animation state. Report any jank, unexpected movement, or missing transitions."><span class="action-label">Animation &amp; Transitions</span></label>

            </div></div>
            <div class="action-drawer">
            <div class="action-drawer-header"><span>Inject &amp; Script</span><svg class="drawer-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 5 5 9 1"></polyline></svg></div>
            <div class="action-drawer-body collapsed">
            <label class="action-row" data-keywords="accessibility a11y audit axe wcag violations aria contrast scan"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, inject the axe-core accessibility library (https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js) via page.evaluate, then run axe.run() scoped to the targeted element. Report all violations with their WCAG rule ID, impact level (critical/serious/moderate/minor), the failing element selector, and a description of how to fix each issue."><span class="action-label">Run Accessibility Audit</span></label>
            <label class="action-row" data-keywords="state loading error empty success force component react vue class data-state"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, attempt to force the targeted element or component into each of these states: loading, error, empty, and success. Try each approach in order: (1) toggle CSS classes like .loading, .error, .empty, .success, (2) set data attributes like data-state, (3) manipulate React/Vue component state via __vue__ or React DevTools fiber, (4) directly modify DOM content. Screenshot each state and report which states exist, which are missing, and any visual issues found."><span class="action-label">Force Component State</span></label>
            <label class="action-row" data-keywords="css variables custom properties tokens theme override theming"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to collect all CSS custom properties (variables starting with --) that are computed on the targeted element and its ancestors. List each token name and its current value. Then test the element by overriding key color and spacing tokens with injected values to verify the theming system responds correctly. Report any hardcoded values that should be using tokens but are not."><span class="action-label">Override CSS Variables</span></label>
            <label class="action-row" data-keywords="pseudo hover focus active visited state force style"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to force pseudo-states on the targeted element by injecting a temporary <style> tag that applies the :hover, :focus, and :active CSS rules as regular class overrides. Take a screenshot of each forced state. Then remove the injected styles. Report any missing, inconsistent, or inaccessible pseudo-state styles."><span class="action-label">Force Pseudo-state</span></label>
            <label class="action-row" data-keywords="network error fetch xhr 500 404 timeout fail offline api mock"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to override the global fetch and XMLHttpRequest on the page so that any network requests triggered by interacting with the targeted element return a simulated error (status 500, status 404, and a network timeout in sequence). Interact with the element to trigger each error condition, screenshot the resulting UI, and report whether the error states are handled gracefully, display appropriate messages, and avoid broken or empty UI."><span class="action-label">Simulate Network Error</span></label>
            <label class="action-row" data-keywords="dark mode light theme prefers-color-scheme color scheme toggle"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to override window.matchMedia so that prefers-color-scheme returns 'dark', then take a screenshot of the targeted element. Then override it to return 'light' and take another screenshot. Report any colors, icons, or images that do not adapt correctly between modes, any missing dark mode styles, and contrast issues specific to either mode."><span class="action-label">Toggle Dark Mode</span></label>
            <label class="action-row" data-keywords="spacing margin padding gap layout box overlay visualize grid highlight"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to inject a visual spacing overlay onto the targeted element and its direct children. For each element, draw colored box overlays: blue for margin, green for padding, and yellow for gap. Use absolute-positioned divs with semi-transparent backgrounds injected into the DOM. Take a screenshot showing all spacing overlays. Report any inconsistent spacing values, elements not using design token increments (e.g. 4px/8px grid), or unexpected zero-margin/padding values."><span class="action-label">Highlight Spacing</span></label>
            <label class="action-row" data-keywords="event listener handler click bind geteventlisteners memory leak"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, use the CDP Runtime.evaluate or page.evaluate with getEventListeners (if available in the execution context) to retrieve all event listeners attached to the targeted element. List each listener by event type, whether it is passive, once-only, or capturing, and the function source if available. Report any duplicate listeners on the same event, potentially missing listeners (e.g. no click handler on a button), or listeners that may cause memory leaks."><span class="action-label">Event Listener Audit</span></label>
            <label class="action-row" data-keywords="localstorage sessionstorage storage feature flag cookie cache state"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to read all localStorage and sessionStorage keys and values. Identify any keys that appear related to the targeted element or feature (by name, route, or component context). Display their current values and flag any that may be affecting the element's visible behavior, toggling features, or caching stale data. Report any suspicious, outdated, or overly large stored values."><span class="action-label">LocalStorage &amp; Feature Flags</span></label>
            <label class="action-row" data-keywords="clear reset localstorage cookies first run onboarding fresh cache incognito"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to clear localStorage, sessionStorage, and all cookies accessible from the current origin. Then reload the page and navigate back to the targeted element. Screenshot the element in this clean first-run state. Report any missing onboarding states, broken default values, elements that rely on cached data and fail without it, or any console errors triggered on first load."><span class="action-label">Clear State &amp; First-Run</span></label>

            </div></div>
            <div class="action-drawer">
            <div class="action-drawer-header"><span>Extract</span><svg class="drawer-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 5 5 9 1"></polyline></svg></div>
            <div class="action-drawer-body collapsed">
            <label class="action-row" data-keywords="color colour palette hex rgb swatch extract scrape"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate on the targeted element and all its descendants to collect every unique color value found in computed styles — including color, background-color, border-color, outline-color, box-shadow, and text-decoration-color. Deduplicate the results, convert all values to hex where possible, and output a grouped list showing each unique color alongside the elements and CSS properties that use it."><span class="action-label">Color Palette</span></label>
            <label class="action-row" data-keywords="typography font text size weight line-height letter-spacing type scale"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate on the targeted element and all its descendants to extract all typography-related computed styles: font-family, font-size, font-weight, line-height, letter-spacing, text-transform, and text-decoration. Group results by unique combinations and list which elements use each combination. Flag any fonts or sizes that appear inconsistent with a design system scale."><span class="action-label">Typography Styles</span></label>
            <label class="action-row" data-keywords="spacing margin padding gap grid flex layout values scale"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate on the targeted element and all its descendants to extract all spacing and layout values: margin, padding, gap, row-gap, column-gap, grid-template-columns, grid-template-rows, and flex properties. Group by element and flag any values that do not align to a 4px or 8px grid increment, suggesting they fall outside a standard design system spacing scale."><span class="action-label">Spacing &amp; Layout Values</span></label>
            <label class="action-row" data-keywords="assets media image video font background src url download"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate on the targeted element and all its descendants to collect all external asset references: img src and srcset URLs, video src and poster URLs, CSS background-image URLs, @font-face src URLs, and audio src URLs. Output a categorized list of each asset type with its full resolved URL. Flag any broken, relative-without-base, or suspiciously large asset paths."><span class="action-label">Assets &amp; Media</span></label>
            <label class="action-row" data-keywords="dom html outerhtml markup structure tree element source"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to extract the full outerHTML of the targeted element. Format it as clean, indented HTML. Strip any injected Cathode overlay elements (id starting with __cathode). Output the result as a code block. This is useful for copying into documentation, filing bug reports, or reproducing UI in isolation."><span class="action-label">DOM Structure</span></label>
            <label class="action-row" data-keywords="computed styles css export json properties dump getcomputedstyle"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to call getComputedStyle on the targeted element and collect all non-empty CSS property/value pairs. Save the result as a structured JSON object to a file named computed-styles.json. Also highlight any properties that appear to be using hardcoded values where a CSS custom property (design token) would be expected."><span class="action-label">Computed Styles Export</span></label>
            <label class="action-row" data-keywords="component props state react vue fiber data json"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to walk the React fiber tree or Vue component instance tree for the targeted element. Extract the component name, all current props (excluding event handlers), and current state where accessible. Output the results as a structured JSON object. This is useful for reproducing a specific UI state or understanding what data is driving the component."><span class="action-label">Component Props &amp; State</span></label>
            <label class="action-row" data-keywords="form schema input field name type required validation pattern"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to find all form elements (input, select, textarea, button[type=submit]) within the targeted area. For each field extract: name, id, type, required, disabled, placeholder, value, pattern, min, max, minlength, maxlength, and autocomplete attributes. Output as a structured table. Flag any fields missing labels, name attributes, or accessible descriptions."><span class="action-label">Form Schema</span></label>
            <label class="action-row" data-keywords="accessibility a11y aria tree role label semantic screen reader"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to walk the DOM of the targeted element and extract the full accessibility tree: each element's tag, role (explicit aria-role or implicit), aria-label, aria-labelledby, aria-describedby, aria-expanded, aria-hidden, tabindex, and any other aria-* attributes. Output as an indented tree structure. Flag any elements that are interactive but missing accessible names, or that have aria-hidden incorrectly applied."><span class="action-label">Accessibility Tree</span></label>
            <label class="action-row" data-keywords="text content copy strings i18n localization plain text scrape"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to extract all visible text content from the targeted element, preserving the hierarchy (headings, paragraphs, list items, button labels, link text, placeholder text). Output as structured plain text with element context noted. This is useful for copy audits, internationalization reviews, or passing content to a design or content tool."><span class="action-label">Text Content</span></label>
            <label class="action-row" data-keywords="network request fetch xhr api endpoint url payload response"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, override fetch and XMLHttpRequest on the page before interacting with the targeted element. Record every network request triggered, including: URL, method, request headers, request body, response status, and response body (truncated if large). Interact with the element (click, submit, hover as appropriate) to trigger its network activity. Output the captured requests as a structured list. This is useful for mapping component-to-API dependencies."><span class="action-label">Network Requests</span></label>
            <label class="action-row" data-keywords="image img src alt dimensions lazy broken extract scrape"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to find all img elements within the targeted area. For each image extract: src (resolved absolute URL), alt text, width, height, naturalWidth, naturalHeight, loading attribute (lazy/eager), and whether the image is visible in the viewport. Check if any images are broken (naturalWidth === 0), missing alt text, or not using lazy loading when below the fold. Output a structured list and flag all issues found."><span class="action-label">Extract Images</span></label>
            <label class="action-row" data-keywords="svg vector icon graphic viewbox inline path stroke fill"><input class="aidev-cb" type="checkbox" data-instruction="Using browser tools, run page.evaluate to find all SVG elements within the targeted area — both inline SVGs and those referenced via img src or CSS. For each SVG extract: the element type (inline/img/css), dimensions (width, height, viewBox), presence of a title or aria-label for accessibility, fill and stroke color values, and the full SVG markup for inline elements. Flag any SVGs missing accessible labels, using hardcoded colors that should be currentColor, or with missing viewBox attributes that would prevent responsive scaling. Output a structured report."><span class="action-label">SVG &amp; Vector Elements</span></label>
            </div></div>
            </div>
          </div>
          ` : ''}
          <div class="inst-title">Instructions</div>
          <div class="textarea-wrap">
            <textarea placeholder="give instructions here"></textarea>
            <button class="send-btn" title="Send (Enter)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none"></polygon>
              </svg>
            </button>
          </div>
        </div>
        ${aiDevMode ? '<div class="action-tip"></div>' : ''}
      `;

      // ── Drag ────────────────────────────────────────────────────
      const popup    = shadow.querySelector('.popup');
      const titlebar = shadow.querySelector('.popup-titlebar');
      titlebar.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('popup-close')) return;
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

      // ── Close ───────────────────────────────────────────────────
      shadow.querySelector('.popup-close').addEventListener('click', (e) => {
        e.stopPropagation(); done(null);
      });

      // ── Filter chips ─────────────────────────────────────────────
      let activeChip = null;
      function applyChipFilter(keyword) {
        shadow.querySelectorAll('.css-row').forEach(row => {
          const name = row.querySelector('.prop-name').textContent.toLowerCase();
          row.style.display = (!keyword || name.includes(keyword)) ? '' : 'none';
        });
        if (keyword) {
          shadow.querySelectorAll('.drawer-body').forEach(body => {
            body.style.display = 'block';
          });
          shadow.querySelectorAll('.caret').forEach(c => c.textContent = '▼');
        }
      }
      shadow.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('mousedown', e => e.stopPropagation());
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const filter = chip.dataset.filter;
          if (activeChip === filter) {
            activeChip = null;
            chip.classList.remove('active');
            applyChipFilter(null);
          } else {
            shadow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeChip = filter;
            applyChipFilter(filter);
          }
        });
      });

      // ── Drawer toggle (no full rebuild — just flip visibility) ──
      shadow.querySelectorAll('.drawer-header').forEach(header => {
        const i = parseInt(header.dataset.i);
        header.addEventListener('click', (e) => {
          if (e.target.classList.contains('el-x')) return;
          const body  = shadow.querySelector('.drawer-body[data-i="' + i + '"]');
          const caret = shadow.querySelector('.caret[data-i="' + i + '"]');
          if (expandedSet.has(i)) {
            expandedSet.delete(i);
            if (body)  body.style.display = 'none';
            if (caret) caret.textContent  = '▶';
          } else {
            expandedSet.add(i);
            if (body)  body.style.display = 'block';
            if (caret) caret.textContent  = '▼';
          }
        });
        header.addEventListener('mouseenter', () => { if (items[i]) showHl(items[i]); });
        header.addEventListener('mouseleave', hideHl);
      });

      // ── Search ──────────────────────────────────────────────────
      shadow.querySelectorAll('.css-search').forEach(input => {
        input.addEventListener('mousedown', e => e.stopPropagation());
        input.addEventListener('input', () => {
          const q = input.value.toLowerCase();
          const body = shadow.querySelector('.drawer-body[data-i="' + input.dataset.i + '"]');
          body.querySelectorAll('.css-row').forEach(row => {
            const name = row.querySelector('.prop-name').textContent.toLowerCase();
            const val  = row.querySelector('.prop-value').textContent.toLowerCase();
            row.style.display = (!q || name.includes(q) || val.includes(q)) ? '' : 'none';
          });
        });
      });

      // ── Inline value editing ────────────────────────────────────
      function attachValueEdit(span) {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const idx  = parseInt(span.dataset.i);
          const prop = span.dataset.prop;
          const orig = span.dataset.orig;
          const cur  = modifiedProps[idx] && modifiedProps[idx][prop] !== undefined
                         ? modifiedProps[idx][prop] : orig;

          const inp = document.createElement('input');
          inp.className   = 'prop-edit';
          inp.value       = cur;
          inp.dataset.i   = idx;
          inp.dataset.prop = prop;
          inp.dataset.orig = orig;
          span.replaceWith(inp);
          inp.focus(); inp.select();

          function makeSpan(val) {
            const s = document.createElement('span');
            s.className  = 'prop-value' + (val !== orig ? ' modified' : '');
            s.dataset.i  = idx; s.dataset.prop = prop; s.dataset.orig = orig;
            s.title      = 'Click to edit';
            s.textContent = val;
            attachValueEdit(s);
            return s;
          }

          let committed = false;
          function commit() {
            if (committed) return;
            committed = true;
            const val = inp.value.trim();
            inp.replaceWith(makeSpan(val));
            if (val !== orig) {
              if (!modifiedProps[idx]) modifiedProps[idx] = {};
              modifiedProps[idx][prop] = val;
              if (!checkedCSS[idx]) checkedCSS[idx] = new Set();
              checkedCSS[idx].add(prop);
              const cb = shadow.querySelector('.css-cb[data-i="' + idx + '"][data-prop="' + prop + '"]');
              if (cb) cb.checked = true;
            } else {
              if (modifiedProps[idx]) delete modifiedProps[idx][prop];
            }
          }

          function revert() {
            if (committed) return;
            committed = true;
            items[idx].el.style.removeProperty(prop);
            if (modifiedProps[idx]) delete modifiedProps[idx][prop];
            inp.replaceWith(makeSpan(orig));
          }

          inp.addEventListener('mousedown', e => e.stopPropagation());
          inp.addEventListener('input', () => {
            items[idx].el.style.setProperty(prop, inp.value);
            const swatch = inp.closest('.css-row') && inp.closest('.css-row').querySelector('.color-swatch');
            if (swatch) swatch.style.background = inp.value;
          });
          inp.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter')  { e.preventDefault(); commit(); return; }
            if (e.key === 'Escape') { e.preventDefault(); revert(); return; }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              const num = parseFloat(inp.value);
              if (!isNaN(num)) {
                e.preventDefault();
                const unit   = inp.value.replace(/^-?[\d.]+/, '');
                const step   = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
                const dir    = e.key === 'ArrowUp' ? 1 : -1;
                const newNum = Math.round((num + dir * step) * 1000) / 1000;
                inp.value = newNum + unit;
                items[idx].el.style.setProperty(prop, inp.value);
              }
            }
          });
          inp.addEventListener('blur', () => commit());
        });
      }
      shadow.querySelectorAll('.prop-value').forEach(span => attachValueEdit(span));

      // ── Color swatches ───────────────────────────────────────────
      shadow.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('mousedown', e => e.stopPropagation());
        swatch.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          const valSpan = swatch.nextElementSibling;
          const idx  = parseInt(valSpan.dataset.i);
          const prop = valSpan.dataset.prop;
          const orig = valSpan.dataset.orig;
          const cur  = modifiedProps[idx] && modifiedProps[idx][prop] !== undefined
                         ? modifiedProps[idx][prop] : valSpan.textContent.trim();
          showColorPicker(swatch, cur, (hex) => {
            items[idx].el.style.setProperty(prop, hex);
            valSpan.textContent = hex;
            hex !== orig ? valSpan.classList.add('modified') : valSpan.classList.remove('modified');
            swatch.style.background = hex;
            if (!modifiedProps[idx]) modifiedProps[idx] = {};
            modifiedProps[idx][prop] = hex;
            if (!checkedCSS[idx]) checkedCSS[idx] = new Set();
            checkedCSS[idx].add(prop);
            const cb = shadow.querySelector('.css-cb[data-i="' + idx + '"][data-prop="' + prop + '"]');
            if (cb) cb.checked = true;
          });
        });
      });

      // ── X buttons ───────────────────────────────────────────────
      shadow.querySelectorAll('.el-x').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          hideHl();
          const i = parseInt(btn.dataset.i);
          items.splice(i, 1);
          // Re-index state after splice
          const newChecked = {}, newMods = {}, newExpanded = new Set();
          items.forEach((_, ni) => {
            const oi = ni >= i ? ni + 1 : ni;
            if (checkedCSS[oi])    newChecked[ni] = checkedCSS[oi];
            if (modifiedProps[oi]) newMods[ni]    = modifiedProps[oi];
            if (expandedSet.has(oi)) newExpanded.add(ni);
          });
          for (const k in checkedCSS)    delete checkedCSS[k];
          for (const k in modifiedProps) delete modifiedProps[k];
          Object.assign(checkedCSS, newChecked);
          Object.assign(modifiedProps, newMods);
          expandedSet.clear();
          newExpanded.forEach(n => expandedSet.add(n));
          if (items.length === 0) { done(null); return; }
          build();
        });
      });

      // ── Checkboxes ──────────────────────────────────────────────
      shadow.querySelectorAll('.css-cb').forEach(cb => {
        const i = parseInt(cb.dataset.i);
        if (!checkedCSS[i]) checkedCSS[i] = new Set();
        cb.addEventListener('change', () => {
          if (cb.checked) checkedCSS[i].add(cb.dataset.prop);
          else            checkedCSS[i].delete(cb.dataset.prop);
        });
      });

      // ── Textarea ────────────────────────────────────────────────
      const ta = shadow.querySelector('textarea');
      ta.value = savedInstruction;
      ta.addEventListener('input', () => { savedInstruction = ta.value; });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendResult(); }
      });

      // ── Send ────────────────────────────────────────────────────
      shadow.querySelector('.send-btn').addEventListener('click', (e) => {
        e.stopPropagation(); sendResult();
      });

      // ── AI Dev drawers & search ──────────────────────────────────
      if (aiDevMode) {
        shadow.querySelectorAll('.action-drawer-header').forEach(header => {
          header.addEventListener('mousedown', e => e.stopPropagation());
          header.addEventListener('click', () => {
            const body = header.nextElementSibling;
            const open = header.classList.toggle('open');
            body.classList.toggle('collapsed', !open);
          });
        });
        const srch = shadow.querySelector('.actions-search');
        if (srch) {
          srch.addEventListener('mousedown', e => e.stopPropagation());
          srch.addEventListener('input', () => {
            const q = srch.value.toLowerCase().trim();
            shadow.querySelectorAll('.action-drawer').forEach(drawer => {
              const hdr  = drawer.querySelector('.action-drawer-header');
              const body = drawer.querySelector('.action-drawer-body');
              let any = false;
              body.querySelectorAll('.action-row').forEach(row => {
                const label = (row.querySelector('.action-label').textContent || '').toLowerCase();
                const kw    = (row.dataset.keywords || '').toLowerCase();
                const match = !q || label.includes(q) || kw.includes(q);
                row.style.display = match ? '' : 'none';
                if (match) any = true;
              });
              drawer.style.display = q && !any ? 'none' : '';
              if (q) {
                // While searching, auto-expand drawers that have matches
                if (any) { hdr.classList.add('open'); body.classList.remove('collapsed'); }
              } else {
                // Cleared search → restore default collapsed state
                hdr.classList.remove('open');
                body.classList.add('collapsed');
              }
            });
          });
        }

        // ── Action tooltips ────────────────────────────────────────
        const tip = shadow.querySelector('.action-tip');
        if (tip) {
          shadow.querySelectorAll('.action-row').forEach(row => {
            const instr = row.querySelector('.aidev-cb')?.dataset.instruction || '';
            if (!instr) return;
            row.addEventListener('mouseenter', () => {
              tip.textContent = instr;
              tip.style.left = '-9999px'; tip.style.top = '-9999px';
              tip.classList.add('show');
              const r  = row.getBoundingClientRect();
              const tr = tip.getBoundingClientRect();
              let left = r.left - tr.width - 10;
              if (left < 8) left = r.right + 10;
              let top = r.top - 4;
              if (top + tr.height > window.innerHeight - 8) top = window.innerHeight - tr.height - 8;
              if (top < 8) top = 8;
              tip.style.left = left + 'px';
              tip.style.top  = top + 'px';
            });
            row.addEventListener('mouseleave', () => tip.classList.remove('show'));
          });
        }
      }
    }

    build();

    setTimeout(() => {
      document.addEventListener('click', function onOut(e) {
        if (cpEl && cpEl.style.display !== 'none' && cpEl.contains(e.target)) { return; }
        if (cpEl && cpEl.style.display !== 'none') { hideColorPicker(); return; }
        if (!e.composedPath().includes(host)) {
          document.removeEventListener('click', onOut, true);
          done(null);
        }
      }, true);
    }, 150);

    function onEsc(e) {
      if (e.key === 'Escape') {
        if (cpEl && cpEl.style.display !== 'none') { hideColorPicker(); }
        else { done(null); }
      }
    }
    document.addEventListener('keydown', onEsc, true);
  });
}

function getCombinedScript({ isClick, bounds, cx, cy, mouseUpX, mouseUpY, aiDevMode = false, wholePage = false }) {
  const opts = {
    isClick: isClick === true,
    bounds: bounds || {},
    cx: Math.round(cx || 0),
    cy: Math.round(cy || 0),
    mouseUpX, mouseUpY,
    aiDevMode: aiDevMode === true,
    wholePage: wholePage === true,
    CSS_PROPS,
    Z,
  };
  return `(${cathodeCombinedPage.toString()})(${JSON.stringify(opts)})`;
}

module.exports = { getCombinedScript };
