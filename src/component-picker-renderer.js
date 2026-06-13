const { ipcRenderer } = require('electron');
const { eyeIcon } = require('./icons');

// ── State ─────────────────────────────────────────────────────────
let sbUrl       = '';
let allStories  = [];
let target      = null;
let selected    = null;

// ── DOM ───────────────────────────────────────────────────────────
const locLink     = document.getElementById('cp-loc-link');
const searchIn    = document.getElementById('cp-search');
const listEl      = document.getElementById('cp-list');
const instr       = document.getElementById('cp-instructions');
const insertBtn   = document.getElementById('cp-insert');
const flyout      = document.getElementById('cp-flyout');
const flyoutCap   = document.getElementById('cp-flyout-cap');
const flyoutFrame = document.getElementById('cp-flyout-iframe');
const flyoutLoad  = document.getElementById('cp-flyout-loading');
const dockBtn     = document.getElementById('cp-dock');

let docked = false;

const EYE = eyeIcon(14);
const TILE_RIGHT = `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="7.25 7 9.25 9 7.25 11"/><line x1="9.25" y1="9" x2="4.25" y2="9"/><rect x="1.75" y="3.25" width="14.5" height="11.5" rx="2" ry="2"/><rect x="11.75" y="6.25" width="1.5" height="5.5" fill="currentColor" stroke="none"/></svg>`;
const TILE_LEFT  = `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="10.75 7 8.75 9 10.75 11"/><line x1="8.75" y1="9" x2="13.75" y2="9"/><rect x="1.75" y="3.25" width="14.5" height="11.5" rx="2" ry="2"/><rect x="4.75" y="6.25" width="1.5" height="5.5" fill="currentColor" stroke="none"/></svg>`;
dockBtn.innerHTML = TILE_RIGHT;

function nodeGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function close() { ipcRenderer.send('component-picker-cancel'); }
function targetSig(t) {
  return '<' + t.tag + (t.id ? '#' + t.id : '') + ((t.classes && t.classes[0]) ? '.' + t.classes[0] : '') + '>';
}

// ── Init ──────────────────────────────────────────────────────────
ipcRenderer.on('picker-init', async (_, { target: tgt, sbUrl: url }) => {
  sbUrl  = url.replace(/\/$/, '');
  target = tgt;

  const sig = targetSig(tgt);
  locLink.textContent = sig + (tgt.text ? ` — "${tgt.text.slice(0, 40)}${tgt.text.length > 40 ? '…' : ''}"` : '');
  locLink.title = sig + (tgt.selector ? '  ·  ' + tgt.selector : '');

  listEl.innerHTML = '<div class="cp-loading">Loading components…</div>';
  try {
    const data = await nodeGet(sbUrl + '/index.json');
    allStories = Object.values(data.entries || {}).filter(e => e.type === 'story');
    renderList('');
    setTimeout(() => searchIn.focus(), 50);
  } catch (_) {
    listEl.innerHTML = `<div class="cp-loading cp-error">Failed to load components from ${sbUrl}</div>`;
  }
});

// ── Selected-location highlight (on the live page) ────────────────
locLink.addEventListener('mouseenter', () => {
  if (target && target.selector) ipcRenderer.send('cp-highlight-target', { selector: target.selector });
});
locLink.addEventListener('mouseleave', () => ipcRenderer.send('cp-clear-target-highlight'));

// ── Component list ────────────────────────────────────────────────
function renderList(query) {
  const q = query.toLowerCase();
  const filtered = q
    ? allStories.filter(s => s.title.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    : allStories;
  if (!filtered.length) { listEl.innerHTML = '<div class="cp-loading">No components match.</div>'; return; }

  listEl.innerHTML = '';
  filtered.slice(0, 200).forEach(story => {
    const row = document.createElement('div');
    row.className = 'cp-item' + (selected && selected.id === story.id ? ' selected' : '');
    const main = document.createElement('div');
    main.className = 'cp-item-main';
    main.innerHTML = `<span class="cp-item-title"></span><span class="cp-item-name"></span>`;
    main.querySelector('.cp-item-title').textContent = story.title;
    main.querySelector('.cp-item-name').textContent  = story.name;
    const eye = document.createElement('span');
    eye.className = 'cp-eye';
    eye.title = 'Preview';
    eye.innerHTML = EYE;
    row.appendChild(main);
    row.appendChild(eye);

    row.addEventListener('click', () => selectStory(story, row));
    row.addEventListener('mouseenter', () => { if (docked) renderPreview(story); });
    eye.addEventListener('click', e => e.stopPropagation());
    eye.addEventListener('mouseenter', () => showFlyout(story, eye));
    eye.addEventListener('mouseleave', hideFlyout);

    listEl.appendChild(row);
  });
}

function selectStory(story, row) {
  selected = story;
  listEl.querySelectorAll('.cp-item').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');
  insertBtn.disabled = false;
  if (docked) renderPreview(story);
}

searchIn.addEventListener('input', () => renderList(searchIn.value));
searchIn.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const first = listEl.querySelector('.cp-item'); if (first) first.click(); }
});

// ── Preview ───────────────────────────────────────────────────────
const FLYOUT_LEFT = 12 + 380 + 8;   // popup left + width + gap

function renderPreview(story) {
  if (!story) return;
  flyoutCap.textContent = story.title + '  /  ' + story.name;
  flyoutLoad.style.display = 'flex';
  flyoutFrame.onload = () => { flyoutLoad.style.display = 'none'; };
  flyoutFrame.src = `${sbUrl}/iframe.html?id=${story.id}&viewMode=story`;
}

// Hover-the-eye flyout (only when the panel isn't docked)
function showFlyout(story, eyeEl) {
  if (docked) return;
  renderPreview(story);
  const fh = flyout.offsetHeight || 240;
  let top = eyeEl.getBoundingClientRect().top - 6;
  top = Math.max(12, Math.min(top, window.innerHeight - fh - 12));
  flyout.style.left = FLYOUT_LEFT + 'px';
  flyout.style.top  = top + 'px';
  flyout.classList.add('show');
}
function hideFlyout() {
  if (docked) return;   // stay open while docked
  flyout.classList.remove('show');
  flyoutFrame.src = 'about:blank';
}

// Docked preview panel (slides out, pinned beside the popup)
dockBtn.addEventListener('click', () => {
  docked = !docked;
  document.body.classList.toggle('docked', docked);
  dockBtn.classList.toggle('active', docked);
  dockBtn.innerHTML = docked ? TILE_LEFT : TILE_RIGHT;
  dockBtn.title = docked ? 'Hide preview panel' : 'Show preview panel';
  if (docked) {
    flyout.classList.add('docked');
    flyout.style.left = FLYOUT_LEFT + 'px';
    flyout.style.top  = '12px';
    renderPreview(selected || allStories[0]);
    requestAnimationFrame(() => flyout.classList.add('show'));
  } else {
    flyout.classList.remove('docked', 'show');
    flyoutFrame.src = 'about:blank';
  }
});

// ── Insert ────────────────────────────────────────────────────────
insertBtn.addEventListener('click', async () => {
  if (!selected) return;
  const instructions = instr.value.trim();
  const storyUrl = sbUrl + '/?path=/story/' + selected.id;

  let argsLine = '';
  try {
    const detail = await nodeGet(sbUrl + '/stories/' + selected.id + '.json');
    if (detail.args && Object.keys(detail.args).length) argsLine = '\nDefault args: ' + JSON.stringify(detail.args);
  } catch (_) {}

  const t = target;
  const targetDesc = t
    ? '\nTarget element: ' + targetSig(t)
        + (t.text ? ` ("${t.text.slice(0, 60)}")` : '')
        + (t.selector ? '\nSelector: ' + t.selector : '')
    : '';

  const msg = [
    `[Component Reference] Use the Storybook component "${selected.title} / ${selected.name}" as a reference for this change.`,
    'Story: ' + storyUrl,
    argsLine,
    targetDesc,
    instructions ? '\nInstructions: ' + instructions : '',
  ].filter(Boolean).join('\n');

  ipcRenderer.send('cp-clear-target-highlight');
  ipcRenderer.send('component-picker-result', msg);
});

instr.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) insertBtn.click();
});

// ── Global ────────────────────────────────────────────────────────
document.getElementById('cp-close').addEventListener('click', close);
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
// The window is transparent around the popup — clicking the backdrop closes it
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#cp-popup') && !e.target.closest('#cp-flyout')) close();
});
