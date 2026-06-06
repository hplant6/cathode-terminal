function getCombinedScript({ isClick, bounds, cx, cy, mouseUpX, mouseUpY }) {
  const b = JSON.stringify(bounds || {});

  // CSS properties to surface per element (getComputedStyle keys)
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

  // ── CSS extraction (computed values per element) ────────────────
  const CSS_PROPS = ${JSON.stringify(CSS_PROPS)};
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
    'position:fixed','pointer-events:none','z-index:2147483645',
    'border:2px solid #4a9eff','background:rgba(74,158,255,0.09)',
    'box-sizing:border-box','border-radius:2px','display:none',
  ].join(';');
  const hlTag = document.createElement('div');
  hlTag.style.cssText = [
    'position:absolute','bottom:100%','left:-2px',
    'background:#4a9eff','color:#fff',
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
      'z-index:2147483647',
    ].join(';');
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const POPUP_W = 380;
    let curX = Math.min(${mouseUpX}, window.innerWidth - POPUP_W - 10);
    let curY = ${mouseUpY};
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
        'position:fixed','z-index:2147483647',
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
      const resultItems = items.map(({ label, reactComponent, tag, debugSource, cssProps }, i) => {
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
        return { label, reactComponent, tag, debugSource, selectedCSS };
      });
      done({ items: resultItems, instruction });
    }

    function build() {
      const drawerRows = items.map((item, i) => {
        const isOpen = expandedSet.has(i);
        const checked = checkedCSS[i] || new Set();
        const mods    = modifiedProps[i] || {};
        const cssRows = (item.cssProps || []).map(p => \`
          <label class="css-row">
            <input class="css-cb" type="checkbox" data-i="\${i}" data-prop="\${esc(p.name)}" \${checked.has(p.name) ? 'checked' : ''} />
            <span class="prop-name">\${esc(p.name)}</span>
            <span class="prop-sep">:</span>
            \${p.name.includes('color') && (mods[p.name] || p.value) !== 'none' ? '<span class="color-swatch" style="background:' + esc(mods[p.name] !== undefined ? mods[p.name] : p.value) + '"></span>' : ''}
            <span class="prop-value\${mods[p.name] !== undefined ? ' modified' : ''}"
                  data-i="\${i}" data-prop="\${esc(p.name)}" data-orig="\${esc(p.value)}"
                  title="Click to edit">\${esc(mods[p.name] !== undefined ? mods[p.name] : p.value)}</span>
          </label>
        \`).join('');

        return \`
          <div class="drawer" data-i="\${i}">
            <div class="drawer-header" data-i="\${i}">
              <span class="caret" data-i="\${i}">\${isOpen ? '▼' : '▶'}</span>
              <span class="el-name">\${esc(item.label)}</span>
              <button class="el-x" data-i="\${i}" tabindex="-1">✕</button>
            </div>
            <div class="drawer-body" data-i="\${i}" style="display:\${isOpen ? 'block' : 'none'}">
              \${cssRows ? '<div class="search-wrap"><input class="css-search" type="text" placeholder="filter…" data-i="' + i + '" autocomplete="off" spellcheck="false" /></div>' : ''}
              \${cssRows || '<div class="no-css">no CSS properties</div>'}
            </div>
          </div>
        \`;
      }).join('');

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
        </style>
        <div class="popup">
          <div class="popup-titlebar">
            <span class="section-title">Targeted Elements</span>
            <button class="popup-close" title="Close">✕</button>
          </div>
          <div class="divider"></div>
          <div class="chip-bar">
            <button class="chip" data-filter="color">color</button>
            <button class="chip" data-filter="font">font</button>
            <button class="chip" data-filter="padding">padding</button>
            <button class="chip" data-filter="border">border</button>
            <button class="chip" data-filter="height">height</button>
            <button class="chip" data-filter="width">width</button>
          </div>
          <div class="el-list">\${drawerRows}</div>
          <div class="divider"></div>
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
      \`;

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
})()`;
}

module.exports = { getCombinedScript };
