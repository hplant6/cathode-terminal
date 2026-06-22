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

    // ── Inspect/Extract: the APP reads the live page and hands the agent
    // structured data — no parallel/agent-owned browser involved. Each entry
    // runs in the real page over the user's selection. ─────────────────────
    function _xRoots() { return items.map(it => it.el).filter(Boolean); }
    function _xNodes(cap) {
      const seen = new Set();
      for (const r of _xRoots()) {
        seen.add(r);
        for (const k of r.querySelectorAll('*')) { if (seen.size >= cap) break; seen.add(k); }
        if (seen.size >= cap) break;
      }
      return [...seen];
    }
    function _xHex(c) {
      const m = c && c.match(/rgba?\(([^)]+)\)/);
      if (!m) return (c || '').trim();
      const p = m[1].split(',').map(s => parseFloat(s));
      if (p.length < 3) return c;
      if (p.length === 4 && p[3] === 0) return 'transparent';
      const h = n => ('0' + Math.round(n).toString(16)).slice(-2);
      const hex = '#' + h(p[0]) + h(p[1]) + h(p[2]);
      return (p.length === 4 && p[3] < 1) ? hex + ' (' + p[3] + 'a)' : hex;
    }
    const EXTRACTORS = {
      // "Extract the styling of this button so we can make something similar"
      styles() {
        return items.filter(it => it.el).map(it => {
          const cs = getComputedStyle(it.el);
          const props = {};
          for (const name of CSS_PROPS) {
            const v = (cs.getPropertyValue(name) || '').trim();
            if (!v || v === 'rgba(0, 0, 0, 0)') continue;
            if (/^(padding|margin)/.test(name) && v === '0px') continue;
            props[name] = v;
          }
          return { selector: it.cssSelector || it.label, props };
        });
      },
      palette() {
        const PROPS = ['color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color','outline-color','text-decoration-color','fill','stroke'];
        const counts = {};
        const bump = hex => { if (hex && hex !== 'transparent' && hex !== 'none') counts[hex] = (counts[hex] || 0) + 1; };
        for (const el of _xNodes(4000)) {
          const cs = getComputedStyle(el);
          for (const p of PROPS) { const v = (cs.getPropertyValue(p) || '').trim(); if (v) bump(_xHex(v)); }
          for (const p of ['box-shadow','background-image']) {
            (cs.getPropertyValue(p).match(/rgba?\([^)]+\)/g) || []).forEach(c => bump(_xHex(c)));
          }
        }
        return Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([hex,count]) => ({ hex, count }));
      },
      typography() {
        const combos = {};
        for (const el of _xNodes(4000)) {
          if (!el.textContent || !el.textContent.trim()) continue;
          const cs = getComputedStyle(el);
          const key = [cs.fontSize, cs.lineHeight, cs.fontWeight, cs.letterSpacing, cs.textTransform, cs.fontFamily].join('|');
          combos[key] = (combos[key] || 0) + 1;
        }
        return Object.entries(combos).sort((a,b) => b[1]-a[1]).slice(0, 40).map(([k,count]) => {
          const [size,lineHeight,weight,letterSpacing,textTransform,family] = k.split('|');
          return { size, lineHeight, weight, letterSpacing, textTransform, family, count };
        });
      },
      spacing() {
        const PROPS = ['margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','gap','row-gap','column-gap'];
        const vals = {};
        for (const el of _xNodes(4000)) {
          const cs = getComputedStyle(el);
          for (const p of PROPS) { const v = (cs.getPropertyValue(p) || '').trim(); if (v && v !== '0px' && v !== 'normal') vals[v] = (vals[v] || 0) + 1; }
        }
        return Object.entries(vals).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0])).map(([value,count]) => ({ value, count }));
      },
      tokens() {
        const names = new Set();
        try {
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
            for (const rule of rules) {
              if (rule.style) for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
              if (names.size >= 400) break;
            }
            if (names.size >= 400) break;
          }
        } catch (_) {}
        const rootCS = getComputedStyle(document.documentElement);
        const out = [];
        for (const name of names) { const v = rootCS.getPropertyValue(name).trim(); if (v) out.push({ name, value: v }); }
        return out.sort((a,b) => a.name.localeCompare(b.name));
      },
      dom() {
        const el = _xRoots()[0];
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('[id^="__cathode"]').forEach(n => n.remove());
        let html = clone.outerHTML || '';
        if (html.length > 6000) html = html.slice(0, 6000) + '\n…(truncated)';
        return html;
      },
      text() {
        const out = [];
        for (const root of _xRoots()) {
          const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walk.nextNode())) {
            const t = n.textContent.trim();
            if (!t) continue;
            const parent = n.parentElement;
            if (!parent) continue;
            const cs = getComputedStyle(parent);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            out.push({ tag: parent.tagName.toLowerCase(), text: t.slice(0, 200) });
            if (out.length >= 200) return out;
          }
        }
        return out;
      },
      forms() {
        const fields = [];
        for (const root of _xRoots()) {
          const list = root.matches && root.matches('input,select,textarea') ? [root] : [];
          root.querySelectorAll('input,select,textarea').forEach(e => list.push(e));
          for (const f of list) {
            const labelled = !!(f.labels && f.labels.length) || !!f.getAttribute('aria-label') || !!f.getAttribute('aria-labelledby');
            fields.push({
              tag: f.tagName.toLowerCase(), type: f.type || '', name: f.name || '', id: f.id || '',
              required: !!f.required, disabled: !!f.disabled,
              placeholder: f.placeholder || '', pattern: f.getAttribute('pattern') || '', hasLabel: labelled,
            });
            if (fields.length >= 100) return fields;
          }
        }
        return fields;
      },
      a11y() {
        const out = [];
        const INTERACTIVE = new Set(['a','button','input','select','textarea']);
        for (const el of _xNodes(2000)) {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const tabindex = el.getAttribute('tabindex');
          const aria = {};
          for (const at of el.attributes) if (at.name.startsWith('aria-')) aria[at.name] = at.value;
          const interactive = INTERACTIVE.has(tag) || role === 'button' || role === 'link' || tabindex === '0';
          if (!interactive && !role && Object.keys(aria).length === 0 && tabindex === null) continue;
          const name = el.getAttribute('aria-label')
            || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : '')
            || (interactive ? (el.textContent || '').trim().slice(0, 40) : '');
          out.push({ tag, role: role || '', name, tabindex: tabindex, aria, missingName: interactive && !name });
          if (out.length >= 150) break;
        }
        return out;
      },
    };

    // ── Media collection (images / videos / svgs) ────────────────────
    function _xName(url, fallbackBase, ext) {
      try {
        const u = new URL(url, location.href);
        let base = (u.pathname.split('/').pop() || '').split('?')[0];
        if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
        if (base) return base + ext;
      } catch (_) {}
      return fallbackBase + '-' + Math.random().toString(36).slice(2, 7) + ext;
    }
    function collectMedia(types) {
      const assets = [];
      const seen = new Set();
      const add = a => { const k = a.inline || a.url; if (k && !seen.has(k)) { seen.add(k); assets.push(a); } };
      for (const root of _xRoots()) {
        if (types.includes('images')) {
          const list = root.matches && root.matches('img') ? [root] : [];
          root.querySelectorAll('img').forEach(i => list.push(i));
          for (const img of list) {
            const url = img.currentSrc || img.src;
            if (url) add({ kind: 'image', url, name: _xName(url, 'image', '.png'),
              alt: img.getAttribute('alt'), hasAlt: img.hasAttribute('alt'),
              w: img.naturalWidth, h: img.naturalHeight,
              loading: img.loading || 'eager', broken: !!(img.complete && img.naturalWidth === 0) });
            if (assets.length >= 120) return assets;
          }
          for (const el of _xNodes(2000)) {
            const m = (getComputedStyle(el).backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
            if (m && !m[1].startsWith('data:')) add({ kind: 'image', url: m[1], name: _xName(m[1], 'bg', '.png'), source: 'css-background' });
          }
        }
        if (types.includes('svgs')) {
          const list = root.matches && root.matches('svg') ? [root] : [];
          root.querySelectorAll('svg').forEach(s => list.push(s));
          list.forEach(s => add({ kind: 'svg', inline: s.outerHTML, name: 'icon-' + (assets.length + 1) + '.svg',
            viewBox: s.getAttribute('viewBox') || '', title: (s.querySelector('title') && s.querySelector('title').textContent) || (s.getAttribute('aria-label') || '') }));
          root.querySelectorAll('img[src$=".svg"]').forEach(i => { if (i.src) add({ kind: 'svg', url: i.src, name: _xName(i.src, 'icon', '.svg') }); });
        }
        if (types.includes('videos')) {
          const list = root.matches && root.matches('video') ? [root] : [];
          root.querySelectorAll('video').forEach(v => list.push(v));
          for (const v of list) {
            const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src);
            if (src) add({ kind: 'video', url: src, name: _xName(src, 'video', '.mp4') });
            if (v.poster) add({ kind: 'image', url: v.poster, name: _xName(v.poster, 'poster', '.jpg'), source: 'video-poster' });
          }
        }
      }
      return assets;
    }
    // Only blob: URLs must be resolved in-page (main can't fetch them); http(s)
    // and data: are downloaded main-side (no CORS, carries the page session).
    async function resolveBlobAssets(assets) {
      for (const a of assets) {
        if (a.url && a.url.startsWith('blob:')) {
          try {
            const blob = await (await fetch(a.url)).blob();
            a.mime = blob.type || '';
            a.b64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r((fr.result || '').toString().split(',')[1] || ''); fr.readAsDataURL(blob); });
            delete a.url;
          } catch (e) { a.fetchError = String((e && e.message) || e); }
        }
      }
    }

  // ── Panel mode ──────────────────────────────────────────────────
  // Instead of rendering the in-page popup, draw a PERSISTENT outline around
  // every selected element and keep the live refs alive on window so the
  // left-column panel (HTML side) can drive removal / clearing. Resolve
  // immediately with the serialized items the panel + formatter need.
  if (OPTS.panelMode) {
    // Tear down a previous panel session (removes its scroll/resize listeners).
    if (window.__cathodePanel) { try { window.__cathodePanel.clear(); } catch (e) {} }
    const prev = document.getElementById('__cathode_panel_hl__');
    if (prev) prev.remove();
    const phost = document.createElement('div');
    phost.id = '__cathode_panel_hl__';
    phost.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:' + Z.OVERLAY + ';';
    document.documentElement.appendChild(phost);
    const psel = document.getElementById('__cathode_selection__');
    if (psel) psel.remove();   // per-element outlines replace the drag rectangle

    function pBox(item) {
      const r = item.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const b = document.createElement('div');
      b.style.cssText = [
        'position:fixed','box-sizing:border-box','pointer-events:none','border-radius:2px',
        'left:' + r.left + 'px','top:' + r.top + 'px','width:' + r.width + 'px','height:' + r.height + 'px',
        'border:2px solid #22d3ee','background:rgba(34,211,238,0.10)',
      ].join(';');
      const tg = document.createElement('div');
      tg.textContent = item.label;
      tg.style.cssText = 'position:absolute;bottom:100%;left:-2px;background:#22d3ee;color:#06141a;font:700 10px/16px monospace;padding:1px 7px;border-radius:3px 3px 0 0;white-space:nowrap;';
      b.appendChild(tg);
      return b;
    }
    function pDraw(active) {
      phost.innerHTML = '';
      items.forEach((item, i) => {
        if (active && active.indexOf(i) === -1) return;
        const b = pBox(item);
        if (b) phost.appendChild(b);
      });
    }
    const pReflow = () => pDraw(window.__cathodePanel ? window.__cathodePanel.active : null);
    window.addEventListener('scroll', pReflow, true);
    window.addEventListener('resize', pReflow, true);
    window.__cathodePanel = {
      active: [],   // nothing highlighted until the panel hovers/opens a drawer
      set(idx) { this.active = idx; pDraw(idx); },
      // Live-edit a selected element's inline style from the left-column panel.
      // value null/undefined → remove the override. Reflow so outlines track.
      style(i, prop, value) {
        const el = items[i] && items[i].el;
        if (!el) return;
        if (value === null || value === undefined) el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
        pDraw(this.active);
      },
      // Extract tool: run the chosen extractors / collect media over the live
      // selection (uses the helpers hoisted into this function's scope).
      async extract(keys, mediaTypes, mediaDest) {
        const extracts = [];
        (keys || []).forEach((key) => {
          let data = null;
          try { data = EXTRACTORS[key] ? EXTRACTORS[key]() : null; }
          catch (e) { data = { error: String((e && e.message) || e) }; }
          extracts.push({ key, data });
        });
        let media = null;
        if (mediaTypes && mediaTypes.length) {
          const assets = collectMedia(mediaTypes);
          if (mediaDest === 'download') await resolveBlobAssets(assets);
          media = { dest: mediaDest || 'chat', types: mediaTypes, assets };
        }
        return { extracts, media };
      },
      clear() {
        try { window.removeEventListener('scroll', pReflow, true); window.removeEventListener('resize', pReflow, true); } catch (e) {}
        const h = document.getElementById('__cathode_panel_hl__'); if (h) h.remove();
        window.__cathodePanel = null;
      },
    };
    pDraw([]);

    const serial = items.map(({ label, cssSelector, reactComponent, tag, debugSource, cssProps }) =>
      ({ label, cssSelector, reactComponent, tag, debugSource, cssProps: cssProps || [] }));
    return Promise.resolve({ panel: true, items: serial });
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

    async function sendResult() {
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
      // Extract mode: run the selected extractors / collect media in-page NOW
      // (while we still hold live element refs) and return the actual data.
      const extracts = [];
      let media = null;
      if (aiDevMode) {
        shadow.querySelectorAll('.aidev-cb[data-extract]:checked').forEach(cb => {
          const key = cb.dataset.extract;
          const label = (cb.nextElementSibling && cb.nextElementSibling.textContent) || key;
          const analysis = cb.dataset.instruction || '';
          let data = null;
          try { data = EXTRACTORS[key] ? EXTRACTORS[key]() : null; }
          catch (e) { data = { error: String((e && e.message) || e) }; }
          extracts.push({ key, label, analysis, data });
        });
        const types = [...shadow.querySelectorAll('.media-cb:checked')].map(cb => cb.dataset.media);
        if (types.length) {
          const dest = shadow.querySelector('.media-seg-btn.active')?.dataset.dest || 'chat';
          const assets = collectMedia(types);
          if (dest === 'download') await resolveBlobAssets(assets);
          media = { dest, types, assets };
        }
      }
      done({ items: resultItems, instruction, extracts, media });
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
          .actions-scroll {
            max-height: 180px; overflow-y: auto; padding: 2px 0 4px;
          }
          .actions-scroll::-webkit-scrollbar { width: 4px; }
          .actions-scroll::-webkit-scrollbar-track { background: transparent; }
          .actions-scroll::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
          .action-row { display: flex; align-items: center; gap: 8px; padding: 5px 16px; cursor: pointer; }
          .action-row:hover { background: #111; }
          .aidev-cb { accent-color: #4a9eff; cursor: pointer; flex-shrink: 0; }
          .action-label { font-size: 12px; color: #666; cursor: pointer; user-select: none; }
          .action-row:hover .action-label { color: #aaa; }
          .ax-group { padding-bottom: 4px; }
          .ax-group + .ax-group { border-top: 1px solid #161616; margin-top: 2px; }
          .ax-group-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 16px 4px;
          }
          .ax-group-title {
            font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
            text-transform: uppercase; color: #555;
          }
          .ax-group-note { font-size: 9px; color: #3a3a3a; font-family: system-ui,-apple-system,'Segoe UI',sans-serif; }
          .media-dest { padding: 6px 16px 8px; }
          .media-seg { display: flex; width: 100%; background: #111; border: 1px solid #222; border-radius: 6px; padding: 2px; gap: 2px; }
          .media-seg-btn {
            flex: 1; height: 28px;
            background: transparent; border: none; color: #888;
            font-size: 11.5px; font-weight: 600; border-radius: 5px;
            cursor: pointer; font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
            pointer-events: all; transition: background 0.12s, color 0.12s;
          }
          .media-seg-btn:hover { color: #bbb; }
          .media-seg-btn.active { background: rgba(74,158,255,0.16); color: #4a9eff; box-shadow: inset 0 0 0 1px rgba(74,158,255,0.4); }
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
          <div class="inst-title">Extract</div>
          <div class="actions-wrap">
            <div class="actions-scroll" id="__aidev_actions__">
            <div class="ax-group">
              <div class="ax-group-row"><span class="ax-group-title">Media</span></div>
              <label class="action-row" data-keywords="image images photo picture png jpg download"><input class="aidev-cb media-cb" type="checkbox" data-media="images"><span class="action-label">Images</span></label>
              <label class="action-row" data-keywords="svg vector icon graphic download"><input class="aidev-cb media-cb" type="checkbox" data-media="svgs"><span class="action-label">SVGs</span></label>
              <label class="action-row" data-keywords="video media mp4 webm clip download"><input class="aidev-cb media-cb" type="checkbox" data-media="videos"><span class="action-label">Videos</span></label>
              <div class="media-dest">
                <div class="media-seg">
                  <button class="media-seg-btn active" data-dest="chat" tabindex="-1">Send to chat</button>
                  <button class="media-seg-btn" data-dest="download" tabindex="-1">Download…</button>
                </div>
              </div>
            </div>
            <div class="ax-group">
              <div class="ax-group-row"><span class="ax-group-title">Styles &amp; Content</span><span class="ax-group-note">→ chat</span></div>
              <label class="action-row" data-keywords="styles css computed copy clone replicate similar button component"><input class="aidev-cb" type="checkbox" data-extract="styles" data-instruction="The selected element's key computed styles — use them to recreate something visually similar."><span class="action-label">Element Styles</span></label>
              <label class="action-row" data-keywords="color colour palette hex rgb swatch tokens"><input class="aidev-cb" type="checkbox" data-extract="palette" data-instruction="List each unique color with its usage count, and flag near-duplicate or off-system values that should consolidate to a design token."><span class="action-label">Color Palette</span></label>
              <label class="action-row" data-keywords="typography font text size weight line-height letter-spacing type scale"><input class="aidev-cb" type="checkbox" data-extract="typography" data-instruction="Review the type styles and flag combinations that break a consistent type scale (odd sizes, weights, or line-heights)."><span class="action-label">Typography</span></label>
              <label class="action-row" data-keywords="spacing margin padding gap grid flex layout values scale"><input class="aidev-cb" type="checkbox" data-extract="spacing" data-instruction="Review the spacing values and flag any that fall off a 4px/8px grid or look inconsistent."><span class="action-label">Spacing &amp; Layout</span></label>
              <label class="action-row" data-keywords="design tokens variables css custom properties theme theming"><input class="aidev-cb" type="checkbox" data-extract="tokens" data-instruction="These are the CSS custom properties (design tokens) in scope. Flag where the selection uses hardcoded values that should reference one of these."><span class="action-label">Design Tokens</span></label>
              <label class="action-row" data-keywords="dom html outerhtml markup structure tree element source"><input class="aidev-cb" type="checkbox" data-extract="dom" data-instruction="The selected element's markup, for reference."><span class="action-label">DOM Structure</span></label>
              <label class="action-row" data-keywords="text content copy strings i18n localization plain text"><input class="aidev-cb" type="checkbox" data-extract="text" data-instruction="Review the visible copy for clarity, consistency, and i18n readiness."><span class="action-label">Text Content</span></label>
              <label class="action-row" data-keywords="form schema input field name type required validation pattern label"><input class="aidev-cb" type="checkbox" data-extract="forms" data-instruction="Review the form fields and flag any missing labels, name attributes, or validation."><span class="action-label">Form Schema</span></label>
              <label class="action-row" data-keywords="accessibility a11y aria tree role label semantic screen reader tabindex"><input class="aidev-cb" type="checkbox" data-extract="a11y" data-instruction="Review the accessibility info and flag interactive elements missing accessible names or with incorrect aria."><span class="action-label">Accessibility</span></label>
            </div>
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

      // ── Intro: grow down from the titlebar + fade in ────────────
      const popup    = shadow.querySelector('.popup');
      (function introAnim() {
        const tb = shadow.querySelector('.popup-titlebar');
        const startH = (tb ? tb.offsetHeight : 34) + 8;   // show only the title first
        const fullH  = popup.scrollHeight;
        if (!fullH || fullH <= startH) return;
        popup.style.transition = 'none';
        popup.style.opacity = '0';
        popup.style.height = startH + 'px';
        void popup.offsetHeight;                          // commit the start frame
        requestAnimationFrame(() => {
          popup.style.transition = 'height 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.22s ease';
          popup.style.opacity = '1';
          popup.style.height = fullH + 'px';
        });
        popup.addEventListener('transitionend', function te(e) {
          if (e.target !== popup || e.propertyName !== 'height') return;
          popup.style.height = '';                        // back to auto (keeps textarea resizable)
          popup.style.transition = '';
          popup.removeEventListener('transitionend', te);
        });
      })();

      // ── Drag ────────────────────────────────────────────────────
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

      // ── Extract: media destination toggle + tooltips ─────────────
      if (aiDevMode) {
        shadow.querySelectorAll('.media-seg-btn').forEach(btn => {
          btn.addEventListener('mousedown', e => e.stopPropagation());
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            shadow.querySelectorAll('.media-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });

        // ── Action tooltips (shows the agent's analysis ask) ─────────
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

function getCombinedScript({ isClick, bounds, cx, cy, mouseUpX, mouseUpY, aiDevMode = false, wholePage = false, panelMode = false }) {
  const opts = {
    isClick: isClick === true,
    bounds: bounds || {},
    cx: Math.round(cx || 0),
    cy: Math.round(cy || 0),
    mouseUpX, mouseUpY,
    aiDevMode: aiDevMode === true,
    wholePage: wholePage === true,
    panelMode: panelMode === true,
    CSS_PROPS,
    Z,
  };
  return `(${cathodeCombinedPage.toString()})(${JSON.stringify(opts)})`;
}

module.exports = { getCombinedScript };
