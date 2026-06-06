const { ipcRenderer } = require('electron');
const { Terminal }    = require('@xterm/xterm');
const { FitAddon }    = require('@xterm/addon-fit');

// ── Theme init ────────────────────────────────────────────────────
document.body.dataset.theme = localStorage.getItem('cathode-theme') || 'minimal';

const TERMINAL_THEMES = {
  minimal: {
    background: '#1e1e1e', foreground: '#cccccc', cursor: '#4a9eff',
    selectionBackground: 'rgba(74,158,255,0.3)',
    black: '#1a1a1a',   brightBlack:   '#555555',
    red: '#f44747',     brightRed:     '#f44747',
    green: '#6a9955',   brightGreen:   '#b5cea8',
    yellow: '#dcdcaa',  brightYellow:  '#dcdcaa',
    blue: '#569cd6',    brightBlue:    '#9cdcfe',
    magenta: '#c586c0', brightMagenta: '#c586c0',
    cyan: '#4ec9b0',    brightCyan:    '#4ec9b0',
    white: '#d4d4d4',   brightWhite:   '#ffffff',
  },
  winamp: {
    background: '#0a0a16', foreground: '#b4ff30', cursor: '#d4aa00',
    selectionBackground: 'rgba(212,170,0,0.3)',
    black: '#07070f',   brightBlack:   '#3a3a5a',
    red: '#ff4444',     brightRed:     '#ff6666',
    green: '#b4ff30',   brightGreen:   '#d4ff80',
    yellow: '#d4aa00',  brightYellow:  '#ffd700',
    blue: '#5555aa',    brightBlue:    '#8888cc',
    magenta: '#cc55cc', brightMagenta: '#ee88ee',
    cyan: '#00ff41',    brightCyan:    '#44ff88',
    white: '#b4ff30',   brightWhite:   '#d4ff80',
  },
};

function applyTheme(name) {
  document.body.dataset.theme = name;
  localStorage.setItem('cathode-theme', name);
  const termTheme = TERMINAL_THEMES[name] || TERMINAL_THEMES.minimal;
  TERM_OPTS.theme = termTheme;  // keep in sync so new sessions inherit current theme
  for (const s of sessions.values()) s.term.options.theme = termTheme;
}

// ── Pin icons ─────────────────────────────────────────────────────
const ICON_PIN_UNPINNED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><line x1="9" y1="16.25" x2="9" y2="12.25"></line><path d="M14.25,12.25c-.089-.699-.318-1.76-.969-2.875-.335-.574-.703-1.028-1.031-1.375V3.75c0-1.105-.895-2-2-2h-2.5c-1.105,0-2,.895-2,2v4.25c-.329,.347-.697,.801-1.031,1.375-.65,1.115-.88,2.176-.969,2.875H14.25Z"></path></g></svg>`;
const ICON_PIN_PINNED   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g fill="currentColor"><path d="M9,17c-.414,0-.75-.336-.75-.75v-4c0-.414,.336-.75,.75-.75s.75,.336,.75,.75v4c0,.414-.336,.75-.75,.75Z"></path><path d="M13.929,8.997c-.266-.456-.578-.888-.929-1.288V3.75c0-1.517-1.233-2.75-2.75-2.75h-2.5c-1.517,0-2.75,1.233-2.75,2.75v3.959c-.352,.4-.663,.832-.929,1.288-.563,.965-.921,2.027-1.065,3.158-.027,.214,.039,.429,.181,.59,.143,.162,.348,.254,.563,.254H14.25c.215,0,.42-.093,.563-.254,.142-.162,.208-.376,.181-.59-.144-1.131-.502-2.193-1.065-3.158Z"></path></g></svg>`;
const ICON_PIN_REMOVE   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g fill="currentColor"><path d="M3.75,13h1.25L13,5v-1.25c0-1.517-1.233-2.75-2.75-2.75h-2.5c-1.517,0-2.75,1.233-2.75,2.75v3.959c-.352,.4-.663,.832-.929,1.288-.563,.965-.921,2.027-1.065,3.158-.027,.214,.039,.429,.181,.59,.143,.162,.348,.254,.563,.254Z"></path><path d="M13.21,7.972l-4.96,5.028v3.25c0,.414,.336,.75,.75,.75s.75-.336,.75-.75v-3.25h4.5c.215,0,.42-.093,.563-.254,.142-.162,.208-.376,.181-.59-.144-1.131-.502-2.193-1.065-3.158-.21-.36-.456-.699-.72-1.025Z"></path><path d="M2,16.75c-.192,0-.384-.073-.53-.22-.293-.293-.293-.768,0-1.061L15.47,1.47c.293-.293,.768-.293,1.061,0s.293,.768,0,1.061L2.53,16.53c-.146,.146-.338,.22-.53,.22Z"></path></g></svg>`;

const TERM_OPTS = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  theme: TERMINAL_THEMES[localStorage.getItem('cathode-theme')] || TERMINAL_THEMES.minimal,
  scrollback: 5000,
  allowProposedApi: true,
};

const PTY_SEND_DELAY  = 80;  // ms between paste() and sending Enter — gives PTY time to buffer
const MSG_HISTORY_MAX = 500;

// ── PTY Sessions ──────────────────────────────────────────────────
const ptySessionsEl = document.getElementById('pty-sessions');
const ptyTabsEl     = document.getElementById('pty-tabs-container');
const sessions      = new Map(); // id → { name, term, fitAddon, el, ro }
let activeId        = null;
let nextId          = 1;

function createSession(name) {
  const id    = nextId++;
  const sName = name || `P${id}`;

  const el = document.createElement('div');
  el.className = 'pty-session';
  ptySessionsEl.appendChild(el);

  const gutter = document.createElement('div');
  gutter.className = 'pty-gutter';
  el.appendChild(gutter);

  const termEl = document.createElement('div');
  termEl.className = 'pty-term-wrap';
  el.appendChild(termEl);

  const pinBar = document.createElement('div');
  pinBar.className = 'pty-pinbar';
  el.appendChild(pinBar);

  const term     = new Terminal(TERM_OPTS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl);
  term.onData(data => ipcRenderer.send('pty-input', { id, data }));
  term.onScroll(() => { if (id === activeId) updatePinGutter(id); });

  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: term.cols, rows: term.rows });
  });
  ro.observe(termEl);

  ipcRenderer.send('pty-spawn', { id });
  sessions.set(id, {
    name: sName, term, fitAddon, el, gutter, termEl, pinBar, ro,
    trackedLines: new Set(), claudeLines: [],
  });
  switchSession(id);
  return id;
}

function closeSession(id) {
  if (sessions.size <= 1) return;
  const s = sessions.get(id);
  if (!s) return;
  if (activeId === id) {
    const ids  = [...sessions.keys()];
    const idx  = ids.indexOf(id);
    switchSession(ids[idx + 1] ?? ids[idx - 1]);
  }
  s.ro.disconnect();
  s.term.dispose();
  s.el.remove();
  ipcRenderer.send('pty-kill', { id });
  sessions.delete(id);
  renderPtyTabs();
}

function switchSession(id) {
  if (activeId !== null) {
    const prev = sessions.get(activeId);
    if (prev) prev.el.classList.remove('active');
  }
  activeId = id;
  const s = sessions.get(id);
  if (!s) return;
  s.el.classList.add('active');
  ipcRenderer.send('set-active-pty', { id });
  setTimeout(() => {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: s.term.cols, rows: s.term.rows });
    updatePinGutter(id);
    updatePinBar(id);
  }, 0);
  renderPtyTabs();
}

function renderPtyTabs() {
  ptyTabsEl.innerHTML = '';
  for (const [id, s] of sessions) {
    const tab = document.createElement('div');
    tab.className = 'pty-tab' + (id === activeId ? ' active' : '');

    const nameEl = document.createElement('span');
    nameEl.className = 'pty-tab-name';
    nameEl.textContent = s.name;
    nameEl.title = s.name;
    nameEl.addEventListener('click', e => {
      e.stopPropagation();
      if (id !== activeId) { switchSession(id); return; }
      startRename(nameEl, id);
    });
    tab.appendChild(nameEl);

    if (sessions.size > 1) {
      const x = document.createElement('button');
      x.className = 'pty-tab-close';
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); closeSession(id); });
      tab.appendChild(x);
    }

    tab.addEventListener('click', () => switchSession(id));
    ptyTabsEl.appendChild(tab);
  }
}

function startRename(nameEl, id) {
  const s = sessions.get(id);
  if (!s) return;
  const input = document.createElement('input');
  input.className = 'pty-tab-rename';
  input.value = s.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => { const v = input.value.trim(); if (v) s.name = v; renderPtyTabs(); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = s.name; input.blur(); }
    e.stopPropagation();
  });
}

ipcRenderer.on('pty-output', (_, { id, data }) => {
  const s = sessions.get(id);
  if (!s) return;
  s.term.write(data, () => {
    if (data.includes('●') || data.includes('•')) detectClaudeLines(id);
  });
});

document.getElementById('btn-restart').addEventListener('click', () => {
  const s = sessions.get(activeId);
  if (s) { s.term.clear(); ipcRenderer.send('pty-restart', { id: activeId }); }
});

document.getElementById('btn-new-pty').addEventListener('click', () => createSession());

// Boot first session
createSession('P1');

// ── Pin system ───────────────────────────────────────────────────
function getTermRowHeight(termEl) {
  const row = termEl.querySelector('.xterm-rows > div');
  return row ? row.getBoundingClientRect().height : Math.ceil(TERM_OPTS.fontSize * 1.2);
}

function detectClaudeLines(id) {
  const s = sessions.get(id);
  if (!s) return;
  const buf = s.term.buffer.active;
  const cursorLine = buf.baseY + buf.cursorY;
  const scanStart  = Math.max(0, cursorLine - 40);
  let changed = false;
  for (let i = scanStart; i <= cursorLine; i++) {
    if (s.trackedLines.has(i)) continue;
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true).trimStart();
    if (text.startsWith('●') || text.startsWith('•')) {
      s.trackedLines.add(i);
      s.claudeLines.push({ bufferLine: i, pinned: false, uid: `${id}-${i}` });
      changed = true;
    }
  }
  if (changed && id === activeId) updatePinGutter(id);
}

function updatePinGutter(id) {
  const s = sessions.get(id);
  if (!s) return;
  const { term, termEl, gutter, claudeLines } = s;
  gutter.innerHTML = '';
  const rowH     = getTermRowHeight(termEl);
  if (!rowH) return;
  const viewportY = term.buffer.active.viewportY;
  const visRows   = term.rows;

  claudeLines.forEach(entry => {
    const relLine = entry.bufferLine - viewportY;
    if (relLine < 0 || relLine >= visRows) return;
    const y = relLine * rowH + rowH / 2;

    const btn = document.createElement('button');
    btn.className  = 'pin-btn' + (entry.pinned ? ' pinned' : '');
    btn.style.top  = y + 'px';
    btn.innerHTML  = entry.pinned ? ICON_PIN_PINNED : ICON_PIN_UNPINNED;
    btn.title      = entry.pinned ? 'Unpin' : 'Pin this response';

    btn.addEventListener('mouseenter', () => {
      if (entry.pinned) btn.innerHTML = ICON_PIN_REMOVE;
    });
    btn.addEventListener('mouseleave', () => {
      btn.innerHTML = entry.pinned ? ICON_PIN_PINNED : ICON_PIN_UNPINNED;
    });
    btn.addEventListener('click', () => {
      entry.pinned = !entry.pinned;
      updatePinGutter(id);
      updatePinBar(id);
    });

    gutter.appendChild(btn);
  });
}

function updatePinBar(id) {
  const s = sessions.get(id);
  if (!s) return;
  const { term, pinBar, claudeLines } = s;
  const pinned = claudeLines.filter(e => e.pinned);
  pinBar.innerHTML = '';
  pinBar.classList.toggle('has-pins', pinned.length > 0);
  if (!pinned.length) return;

  const totalLines = term.buffer.active.length || 1;
  const barH = pinBar.offsetHeight;

  pinned.forEach(entry => {
    const dot = document.createElement('div');
    dot.className = 'pin-dot';
    dot.style.top = Math.round((entry.bufferLine / totalLines) * barH) + 'px';
    dot.title = 'Jump to pinned response';
    dot.addEventListener('click', () => {
      term.scrollToLine(Math.max(0, entry.bufferLine - Math.floor(term.rows / 4)));
    });
    pinBar.appendChild(dot);
  });
}

// ── Divider drag ──────────────────────────────────────────────────
const divider   = document.getElementById('divider');
const leftPanel = document.getElementById('left-panel');
let dragging = false;
let currentDevToolsWidth = 0;

ipcRenderer.on('devtools-layout', (_, { leftPanelWidth, devToolsWidth: dw }) => {
  currentDevToolsWidth = dw;
  leftPanel.style.width = leftPanelWidth + 'px';
  document.getElementById('devtools-placeholder').style.width = dw + 'px';
  const s = sessions.get(activeId);
  if (s) {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id: activeId, cols: s.term.cols, rows: s.term.rows });
  }
});

divider.addEventListener('mousedown', e => {
  dragging = true;
  divider.classList.add('dragging');
  leftPanel.style.transition = 'none';
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const appW     = document.getElementById('app').offsetWidth - currentDevToolsWidth;
  const fraction = Math.min(0.75, Math.max(0.2, e.clientX / appW));
  leftPanel.style.width = Math.round(fraction * appW) + 'px';
  ipcRenderer.send('split-changed', fraction);
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  leftPanel.style.transition = '';
  const s = sessions.get(activeId);
  if (s) {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id: activeId, cols: s.term.cols, rows: s.term.rows });
  }
});

// ── Panel collapse toggle ─────────────────────────────────────────
const btnPanelToggle = document.getElementById('btn-panel-toggle');
let panelCollapsed = false;
let savedPanelWidth = null;

const appEl = document.getElementById('app');

btnPanelToggle.addEventListener('click', () => {
  panelCollapsed = !panelCollapsed;
  if (panelCollapsed) {
    savedPanelWidth = leftPanel.style.width || null;
    leftPanel.classList.add('collapsed');
    btnPanelToggle.classList.add('collapsed');
    ipcRenderer.send('split-changed', 0);
  } else {
    leftPanel.classList.remove('collapsed');
    btnPanelToggle.classList.remove('collapsed');
    if (savedPanelWidth) leftPanel.style.width = savedPanelWidth;
    setTimeout(() => {
      const w = leftPanel.offsetWidth;
      ipcRenderer.send('split-changed', w / appEl.offsetWidth);
    }, 250);
  }
  setTimeout(() => {
    const s = sessions.get(activeId);
    if (s) {
      s.fitAddon.fit();
      ipcRenderer.send('pty-resize', { id: activeId, cols: s.term.cols, rows: s.term.rows });
    }
  }, 220);
});

// ── Settings dropdown ─────────────────────────────────────────────
const gearBtn      = document.getElementById('btn-settings');
const settingsMenu = document.getElementById('settings-menu');
const apiKeyModal  = document.getElementById('api-key-modal');
const apiKeyInput  = document.getElementById('api-key-input');

function openSettingsMenu() {
  settingsMenu.classList.add('open');
  ipcRenderer.send('browser-view-hide');
}
function closeSettingsMenu() {
  settingsMenu.classList.remove('open');
  ipcRenderer.send('browser-view-show');
}

gearBtn.addEventListener('click', e => {
  e.stopPropagation();
  settingsMenu.classList.contains('open') ? closeSettingsMenu() : openSettingsMenu();
});

document.addEventListener('click', e => {
  if (settingsMenu.classList.contains('open') && !settingsMenu.contains(e.target) && e.target !== gearBtn) {
    closeSettingsMenu();
  }
});

document.getElementById('sm-new-window').addEventListener('click', () => {
  closeSettingsMenu();
  ipcRenderer.send('new-window');
});

document.getElementById('sm-api-key').addEventListener('click', () => {
  closeSettingsMenu();
  const saved = localStorage.getItem('cathode-api-key') || '';
  apiKeyInput.value = saved;
  apiKeyModal.classList.add('open');
  ipcRenderer.send('browser-view-hide');
  requestAnimationFrame(() => apiKeyInput.focus());
});

function closeApiKeyModal() {
  apiKeyModal.classList.remove('open');
  ipcRenderer.send('browser-view-show');
}

document.getElementById('sm-theme').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('sm-theme').classList.toggle('open');
});

document.getElementById('sm-theme-minimal').addEventListener('click', () => {
  applyTheme('minimal');
  closeSettingsMenu();
});

document.getElementById('sm-theme-winamp').addEventListener('click', () => {
  applyTheme('winamp');
  closeSettingsMenu();
});

document.getElementById('api-key-cancel').addEventListener('click', closeApiKeyModal);

document.getElementById('api-key-confirm').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem('cathode-api-key', key);
    ipcRenderer.send('set-api-key', key);
  }
  closeApiKeyModal();
});

apiKeyModal.addEventListener('click', e => {
  if (e.target === apiKeyModal) closeApiKeyModal();
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('api-key-confirm').click();
  if (e.key === 'Escape') closeApiKeyModal();
});

// ── Right panel view switching ────────────────────────────────────
const tabBar            = document.getElementById('tab-bar');
const rightSb           = document.getElementById('right-storybook');
const browserPlaceholder = document.getElementById('browser-placeholder');

const viewTabThumb = document.getElementById('view-tab-thumb');

function updateViewTabThumb() {
  const active = document.querySelector('.view-tab.active');
  if (!active || !viewTabThumb) return;
  viewTabThumb.style.left  = active.offsetLeft + 'px';
  viewTabThumb.style.width = active.offsetWidth + 'px';
}

document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateViewTabThumb();
    const view = btn.dataset.view;
    tabBar.style.display             = view === 'project'   ? ''     : 'none';
    rightSb.style.display            = view === 'storybook' ? 'flex' : 'none';
    browserPlaceholder.style.display = view === 'project'   ? ''     : 'none';
    ipcRenderer.send('right-panel-mode', view);
  });
});

requestAnimationFrame(updateViewTabThumb);

// ── Browser tabs & address bar ────────────────────────────────────
const addressBar    = document.getElementById('address-bar');
const tabsContainer = document.getElementById('tabs-container');
let tabs        = [];
let activeTabId = null;
let nextTabId   = 1;

function createTab(url = '') {
  const tab = { id: nextTabId++, url, title: 'New Tab' };
  tabs.push(tab);
  switchTab(tab.id, true);
  return tab;
}

function closeTab(id) {
  if (tabs.length === 1) return;
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (activeTabId === id) switchTab(tabs[Math.min(idx, tabs.length - 1)].id, true);
  else renderTabs();
}

function switchTab(id, navigate = false) {
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  addressBar.value = (tab.url && tab.url !== 'about:blank') ? tab.url : '';
  if (navigate) ipcRenderer.send('browser-navigate', tab.url || 'about:blank');
  renderTabs();
}

function renderTabs() {
  tabsContainer.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.title = tab.title;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    el.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    el.appendChild(closeBtn);

    el.addEventListener('click', () => { if (tab.id !== activeTabId) switchTab(tab.id, true); });
    tabsContainer.appendChild(el);
  }
}

createTab('');
document.getElementById('btn-new-tab').addEventListener('click', () => createTab(''));

addressBar.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { ipcRenderer.send('browser-navigate', addressBar.value); addressBar.blur(); }
  if (e.key === 'Escape') addressBar.blur();
});
addressBar.addEventListener('focus', () => addressBar.select());
document.getElementById('btn-reload').addEventListener('click', () => ipcRenderer.send('browser-reload'));

ipcRenderer.on('browser-url-changed', (_, url) => {
  addressBar.value = (url && url !== 'about:blank') ? url : '';
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.url = url;
});

ipcRenderer.on('tab-title-updated', (_, title) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && title) { tab.title = title; renderTabs(); }
});

const devToolsBtn = document.getElementById('btn-devtools');
devToolsBtn.addEventListener('click', () => ipcRenderer.send('browser-toggle-devtools'));
ipcRenderer.on('devtools-opened', () => devToolsBtn.classList.add('active'));
ipcRenderer.on('devtools-closed', () => devToolsBtn.classList.remove('active'));

// ── Pick mode ─────────────────────────────────────────────────────
let pickMode = null;

function setPickMode(mode) {
  if (pickMode === mode) { clearPickMode(); return; }
  pickMode = mode;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-pick-${mode}`).classList.add('active');
  ipcRenderer.send('pick-start', mode);
}

document.getElementById('btn-pick-box').addEventListener('click',   () => setPickMode('box'));
document.getElementById('btn-pick-lasso').addEventListener('click', () => setPickMode('lasso'));
document.getElementById('btn-screenshot').addEventListener('click', () => {
  if (pickMode === 'screenshot') { clearPickMode(); return; }
  clearPickMode();
  pickMode = 'screenshot';
  document.getElementById('btn-screenshot').classList.add('active');
  ipcRenderer.send('pick-screenshot');
});
document.getElementById('btn-pick-resize').addEventListener('click', () => {
  if (pickMode === 'resize') { clearPickMode(); return; }
  clearPickMode();
  pickMode = 'resize';
  document.getElementById('btn-pick-resize').classList.add('active');
  ipcRenderer.send('pick-resize');
});

function clearPickMode() {
  pickMode = null;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
}

ipcRenderer.on('pick-cancelled', () => clearPickMode());
ipcRenderer.on('pick-complete',  () => clearPickMode());

// Route pick/screenshot output to the active PTY session
ipcRenderer.on('pick-send-to-pty', (_, message) => {
  const s = sessions.get(activeId);
  if (s) {
    s.term.paste(message);
    setTimeout(() => ipcRenderer.send('pty-input', { id: activeId, data: '\r' }), PTY_SEND_DELAY);
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressBar.focus(); }
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab(''); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
  if (e.key === 'F5')  ipcRenderer.send('browser-reload');
  if (e.key === 'F12') ipcRenderer.send('browser-toggle-devtools');
  if (e.ctrlKey && e.shiftKey && e.key === 'B') setPickMode('box');
  if (e.ctrlKey && e.shiftKey && e.key === 'L') setPickMode('lasso');
});

// ── Left-panel mode: Terminal ↔ UI ────────────────────────────────
const uiTextarea  = document.getElementById('ui-textarea');
const uiCharCount = document.getElementById('ui-char-count');
let msgHistory = [];
let historyIdx  = 0;

function refitActive() {
  const s = sessions.get(activeId);
  if (s) setTimeout(() => {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id: activeId, cols: s.term.cols, rows: s.term.rows });
  }, 60);
}

const modeThumb = document.getElementById('mode-switch-thumb');

function updateModeThumb() {
  const active = document.querySelector('.mode-opt.active');
  if (!active || !modeThumb) return;
  modeThumb.style.left  = active.offsetLeft + 'px';
  modeThumb.style.width = active.offsetWidth + 'px';
}

document.querySelectorAll('.mode-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const isUI = btn.dataset.mode === 'ui';
    leftPanel.classList.toggle('ui-mode', isUI);
    updateModeThumb();
    refitActive();
    if (isUI) uiTextarea.focus();
  });
});

// Position thumb on load (rAF ensures layout is complete)
requestAnimationFrame(updateModeThumb);

// ── Audit dropdown ────────────────────────────────────────────────
const AUDIT_TYPES = [
  {
    label: 'Correctness',
    prompt: 'Run a correctness audit on this codebase. Check for logic bugs, off-by-one errors, edge cases not handled, race conditions, unhandled promise rejections, and dead or unreachable code. Report findings only — do not make changes.',
  },
  {
    label: 'Security',
    prompt: 'Run a security audit on this codebase. Check for injection vulnerabilities (XSS, SQL, command injection), unsafe use of eval, sensitive data hardcoded in source, authentication or authorization gaps, and insecure storage. Report findings only — do not make changes.',
  },
  {
    label: 'Performance',
    prompt: 'Run a performance audit on this codebase. Check for unnecessary work in hot paths, memory leaks (event listeners not removed, unbounded collections), expensive operations inside loops, and repeated DOM queries that could be cached. Report findings only — do not make changes.',
  },
  {
    label: 'Maintainability',
    prompt: 'Run a maintainability audit on this codebase. Check for duplicated logic, magic numbers or strings that should be named constants, overly complex functions, inconsistent naming or patterns, and non-obvious behavior lacking any explanation. Report findings only — do not make changes.',
  },
  {
    label: 'Reliability',
    prompt: 'Run a reliability audit on this codebase. Check for missing null/undefined guards at system boundaries, unhandled failure cases from external calls, state that can get out of sync between components, and assumptions that may not hold at runtime. Report findings only — do not make changes.',
  },
  {
    label: 'Accessibility',
    prompt: 'Run an accessibility audit on this codebase. Check for missing ARIA roles and labels, interactive elements unreachable by keyboard, focus not managed on dynamic content, missing alt text on images, and hardcoded colors that may have insufficient contrast. Report findings only — do not make changes.',
  },
  {
    label: 'Dependencies',
    prompt: 'Run a dependency audit on this project. Review package.json and any lock files for outdated packages, abandoned or unmaintained libraries, known vulnerability patterns, and packages pulling in far more than needed for the task. Report findings only — do not make changes.',
  },
];

(function initAuditDropdown() {
  const btnAudit  = document.getElementById('btn-audit');
  const auditMenu = document.getElementById('audit-menu');
  if (!btnAudit || !auditMenu) return;

  auditMenu.innerHTML = AUDIT_TYPES.map((t, i) =>
    `<div class="audit-item" data-i="${i}"><span class="audit-item-label">${t.label}</span></div>`
  ).join('');

  btnAudit.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = auditMenu.classList.toggle('open');
    btnAudit.classList.toggle('active', isOpen);
  });

  auditMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.audit-item');
    if (!item) return;
    const audit = AUDIT_TYPES[parseInt(item.dataset.i)];
    if (!audit) return;
    auditMenu.classList.remove('open');
    btnAudit.classList.remove('active');
    if (!activeId) return;
    const s = sessions.get(activeId);
    if (!s) return;
    s.term.paste(audit.prompt);
    setTimeout(() => ipcRenderer.send('pty-input', { id: activeId, data: '\r' }), PTY_SEND_DELAY);
  });

  document.addEventListener('click', (e) => {
    if (!auditMenu.classList.contains('open')) return;
    if (!btnAudit.contains(e.target) && !auditMenu.contains(e.target)) {
      auditMenu.classList.remove('open');
      btnAudit.classList.remove('active');
    }
  });
})();

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 300) + 'px';
}

// ── Slash command menu ────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/help',          desc: 'Show help and available commands' },
  { cmd: '/clear',         desc: 'Clear conversation history' },
  { cmd: '/compact',       desc: 'Compact conversation (add optional instructions)' },
  { cmd: '/cost',          desc: 'Show token usage and cost for this session' },
  { cmd: '/doctor',        desc: 'Check Claude Code installation health' },
  { cmd: '/exit',          desc: 'Exit Claude Code' },
  { cmd: '/init',          desc: 'Initialize CLAUDE.md in current project' },
  { cmd: '/login',         desc: 'Sign in to Anthropic' },
  { cmd: '/logout',        desc: 'Sign out from Anthropic' },
  { cmd: '/memory',        desc: 'Edit CLAUDE.md memory files' },
  { cmd: '/model',         desc: 'Set or view the AI model' },
  { cmd: '/permissions',   desc: 'Manage tool permissions' },
  { cmd: '/pr_comments',   desc: 'View comments on the current pull request' },
  { cmd: '/release_notes', desc: 'Show Claude Code release notes' },
  { cmd: '/review',        desc: 'Run a code review on recent changes' },
  { cmd: '/status',        desc: 'Show account and billing status' },
  { cmd: '/vim',           desc: 'Toggle vim keybindings mode' },
  { cmd: '/bug',           desc: 'Report a bug to Anthropic' },
];

// ── Saved prompts ─────────────────────────────────────────────────
let savedPrompts = JSON.parse(localStorage.getItem('cathode-saved-prompts') || '[]');

function savePromptsToStorage() {
  localStorage.setItem('cathode-saved-prompts', JSON.stringify(savedPrompts));
}

const btnSavePrompt = document.getElementById('btn-save-prompt');
const savePromptTag = document.getElementById('save-prompt-tag');
let saveTagTimer    = null;

function updateSaveBtn() {
  btnSavePrompt.classList.toggle('show', uiTextarea.value.length > 0);
}

btnSavePrompt.addEventListener('click', () => {
  const name = uiTextarea.value.split('\n')[0].slice(0, 50).trim() || 'Untitled';
  savedPrompts.push({ id: Date.now(), name, text: uiTextarea.value });
  savePromptsToStorage();
  btnSavePrompt.classList.add('saved');
  savePromptTag.classList.add('show');
  clearTimeout(saveTagTimer);
  saveTagTimer = setTimeout(() => {
    savePromptTag.classList.remove('show');
    btnSavePrompt.classList.remove('saved');
  }, 1500);
});

function showSavedPromptsView() {
  slashMenu.innerHTML = '';
  slashMenu.classList.add('visible');
  slashVisible  = true;
  slashMenuView = 'prompts';
  spFocusIdx    = 0;
  spSubFocus    = 'row';

  const header = document.createElement('div');
  header.className = 'sp-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'sp-back-btn';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('mousedown', e => e.preventDefault());
  backBtn.addEventListener('click', () => showSlashMenu('/'));

  const title = document.createElement('span');
  title.className = 'sp-title';
  title.textContent = savedPrompts.length ? `Saved Prompts (${savedPrompts.length})` : 'Saved Prompts';

  header.appendChild(backBtn);
  header.appendChild(title);
  slashMenu.appendChild(header);

  if (!savedPrompts.length) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = 'No saved prompts yet. Type a message and click the bookmark icon to save it.';
    slashMenu.appendChild(empty);
    return;
  }

  savedPrompts.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'sp-item' + (idx === 0 ? ' focused' : '');

    const num = document.createElement('span');
    num.className = 'sp-item-num';
    num.textContent = idx + 1;

    const name = document.createElement('span');
    name.className = 'sp-item-name';
    name.textContent = p.name;
    name.title = p.text;

    const actions = document.createElement('div');
    actions.className = 'sp-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'sp-btn sp-edit';
    editBtn.title = 'Edit prompt';
    editBtn.innerHTML = '&#x270e;';
    editBtn.addEventListener('mousedown', e => e.preventDefault());
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      showSPEditMode(idx);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'sp-btn sp-delete';
    delBtn.title = 'Delete prompt';
    delBtn.innerHTML = '&#x2715;';
    delBtn.addEventListener('mousedown', e => e.preventDefault());
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      savedPrompts = savedPrompts.filter(sp => sp.id !== p.id);
      savePromptsToStorage();
      showSavedPromptsView();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(num);
    item.appendChild(name);
    item.appendChild(actions);

    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', e => {
      if (e.target.closest('.sp-btn')) return;
      useSavedPrompt(p);
    });

    slashMenu.appendChild(item);
  });
  updateSPFocusViz();
}

const slashMenu = document.getElementById('slash-menu');
let slashFocusIdx = 0;
let slashVisible  = false;
let slashMenuView = 'commands'; // 'commands' | 'prompts'
let spFocusIdx    = 0;          // -1 = back button, 0..n-1 = prompt rows
let spSubFocus    = 'row';      // 'row' | 'edit' | 'delete'
let spEditActive  = false;

function getSlashQuery() {
  const val     = uiTextarea.value;
  const pos     = uiTextarea.selectionStart;
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  const line    = val.slice(lineStart, pos);
  return line.startsWith('/') ? line : null;
}

function getSavedPromptsEntry() {
  const count = savedPrompts.length;
  return {
    cmd: '/saved-prompts',
    label: count ? `Saved Prompts (${count})` : 'Saved Prompts',
    desc: 'View and use your saved prompts',
  };
}

function showSlashMenu(query) {
  slashMenuView = 'commands';
  const entry = getSavedPromptsEntry();
  const savedMatches = entry.cmd.startsWith(query);
  const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
  if (!savedMatches && !filtered.length) { hideSlashMenu(); return; }
  const allItems = savedMatches ? [entry, ...filtered] : filtered;
  slashMenu.innerHTML = '';
  allItems.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'slash-item' + (i === 0 ? ' focused' : '');
    item.dataset.cmd = c.cmd;
    const cmd  = document.createElement('span'); cmd.className  = 'slash-cmd';  cmd.textContent = c.label || c.cmd;
    const desc = document.createElement('span'); desc.className = 'slash-desc'; desc.textContent = c.desc;
    item.appendChild(cmd); item.appendChild(desc);
    slashMenu.appendChild(item);
  });
  slashFocusIdx = 0;
  slashMenu.classList.add('visible');
  slashVisible = true;
}

function hideSlashMenu() {
  slashMenu.classList.remove('visible');
  slashVisible  = false;
  slashMenuView = 'commands';
  spFocusIdx    = 0;
  spSubFocus    = 'row';
  spEditActive  = false;
}

function updateSPFocusViz() {
  const items = slashMenu.querySelectorAll('.sp-item');
  items.forEach((el, i) => el.classList.toggle('focused', i === spFocusIdx));
  const backBtn = slashMenu.querySelector('.sp-back-btn');
  if (backBtn) backBtn.classList.toggle('focused', spFocusIdx === -1);
  slashMenu.querySelectorAll('.sp-btn').forEach(b => b.classList.remove('sub-focused'));
  if (spFocusIdx >= 0 && spSubFocus !== 'row') {
    const row = items[spFocusIdx];
    if (row) {
      const btn = row.querySelector(spSubFocus === 'edit' ? '.sp-edit' : '.sp-delete');
      if (btn) btn.classList.add('sub-focused');
    }
  }
}

function moveSPFocus(delta) {
  const items = slashMenu.querySelectorAll('.sp-item');
  spSubFocus = 'row';
  if (delta > 0) {
    if (spFocusIdx === -1) spFocusIdx = 0;
    else if (spFocusIdx < items.length - 1) spFocusIdx++;
  } else {
    if (spFocusIdx === 0) spFocusIdx = -1;
    else if (spFocusIdx > 0) spFocusIdx--;
  }
  updateSPFocusViz();
  if (spFocusIdx >= 0 && items[spFocusIdx]) {
    items[spFocusIdx].scrollIntoView({ block: 'nearest' });
  } else if (spFocusIdx === -1) {
    const backBtn = slashMenu.querySelector('.sp-back-btn');
    if (backBtn) backBtn.scrollIntoView({ block: 'nearest' });
  }
}

function moveSPSubFocus(delta) {
  if (spFocusIdx < 0) return;
  const order = ['row', 'edit', 'delete'];
  spSubFocus = order[(order.indexOf(spSubFocus) + delta + order.length) % order.length];
  updateSPFocusViz();
}

function activateSPFocused() {
  if (spFocusIdx === -1) { showSlashMenu('/'); return; }
  const p = savedPrompts[spFocusIdx];
  if (!p) return;
  if (spSubFocus === 'row')    { useSavedPrompt(p); return; }
  if (spSubFocus === 'edit')   { showSPEditMode(spFocusIdx); return; }
  if (spSubFocus === 'delete') {
    savedPrompts = savedPrompts.filter(sp => sp.id !== p.id);
    savePromptsToStorage();
    spFocusIdx = Math.min(spFocusIdx, savedPrompts.length - 1);
    if (spFocusIdx < 0 && savedPrompts.length) spFocusIdx = 0;
    showSavedPromptsView();
  }
}

function useSavedPrompt(p) {
  hideSlashMenu();
  uiTextarea.value = p.text;
  sendUiMessage();
}

function showSPEditMode(editIdx) {
  const p = savedPrompts[editIdx];
  if (!p) return;
  spEditActive = true;

  const items = slashMenu.querySelectorAll('.sp-item');
  const itemEl = items[editIdx];
  if (!itemEl) return;

  const editor = document.createElement('div');
  editor.className = 'sp-item-editor';

  const ta = document.createElement('textarea');
  ta.className = 'sp-edit-textarea';
  ta.value = p.text;
  ta.rows = 4;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape')                  { e.preventDefault(); cancelEdit(); }
    if (e.ctrlKey && e.key === 'Enter')      { e.preventDefault(); saveEdit(); }
    e.stopPropagation();
  });

  const actRow = document.createElement('div');
  actRow.className = 'sp-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'sp-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', saveEdit);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sp-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelEdit);

  function saveEdit() {
    const newText = ta.value.trim();
    if (newText) { savedPrompts[editIdx].text = newText; savePromptsToStorage(); }
    exitEdit();
  }
  function cancelEdit() { exitEdit(); }
  function exitEdit() {
    spEditActive = false;
    showSavedPromptsView();
    uiTextarea.focus();
  }

  actRow.appendChild(saveBtn);
  actRow.appendChild(cancelBtn);
  editor.appendChild(ta);
  editor.appendChild(actRow);
  itemEl.replaceWith(editor);

  requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
}

function moveFocus(delta) {
  const items = slashMenu.querySelectorAll('.slash-item');
  if (!items.length) return;
  items[slashFocusIdx].classList.remove('focused');
  slashFocusIdx = (slashFocusIdx + delta + items.length) % items.length;
  items[slashFocusIdx].classList.add('focused');
  items[slashFocusIdx].scrollIntoView({ block: 'nearest' });
}

function commitSlash(cmd) {
  if (cmd === '/saved-prompts') {
    showSavedPromptsView();
    return;
  }
  const val       = uiTextarea.value;
  const pos       = uiTextarea.selectionStart;
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  uiTextarea.value = val.slice(0, lineStart) + cmd + val.slice(pos);
  uiTextarea.selectionStart = uiTextarea.selectionEnd = lineStart + cmd.length;
  hideSlashMenu();
  autoResize(uiTextarea);
  uiTextarea.focus();
}

// Keep focus in textarea when clicking menu items
slashMenu.addEventListener('mousedown', e => e.preventDefault());
slashMenu.addEventListener('click', e => {
  const item = e.target.closest('.slash-item');
  if (item) commitSlash(item.dataset.cmd);
});

uiTextarea.addEventListener('input', () => {
  autoResize(uiTextarea);
  const n = uiTextarea.value.length;
  uiCharCount.textContent = n > 0 ? n + ' chars' : '';
  updateSaveBtn();
  const query = getSlashQuery();
  if (query !== null) showSlashMenu(query); else hideSlashMenu();
});

uiTextarea.addEventListener('keydown', e => {
  // Slash menu navigation takes priority
  if (slashVisible) {
    if (slashMenuView === 'prompts') {
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveSPFocus(1);     return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); moveSPFocus(-1);    return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveSPSubFocus(1);  return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSPSubFocus(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); activateSPFocused(); return; }
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (savedPrompts[idx]) useSavedPrompt(savedPrompts[idx]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    } else {
      if (e.key === 'ArrowDown')                { e.preventDefault(); moveFocus(1);  return; }
      if (e.key === 'ArrowUp')                  { e.preventDefault(); moveFocus(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const focused = slashMenu.querySelector('.slash-item.focused');
        if (focused) commitSlash(focused.dataset.cmd);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUiMessage(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault(); uiTextarea.value = e.key; sendUiMessage(); return;
  }
  // History: arrow up at very start, arrow down at very end
  if (e.key === 'ArrowUp' && uiTextarea.selectionStart === 0 && uiTextarea.selectionEnd === 0 && msgHistory.length) {
    e.preventDefault();
    historyIdx = Math.max(0, historyIdx - 1);
    uiTextarea.value = msgHistory[historyIdx] || '';
    autoResize(uiTextarea);
    return;
  }
  if (e.key === 'ArrowDown' && uiTextarea.selectionEnd === uiTextarea.value.length) {
    e.preventDefault();
    historyIdx = Math.min(msgHistory.length, historyIdx + 1);
    uiTextarea.value = historyIdx < msgHistory.length ? msgHistory[historyIdx] : '';
    autoResize(uiTextarea);
    return;
  }
});

uiTextarea.addEventListener('blur', () => { if (!spEditActive) setTimeout(hideSlashMenu, 120); });

function sendUiMessage() {
  const raw = uiTextarea.value;
  if (!raw.trim()) return;
  msgHistory.push(raw);
  if (msgHistory.length > MSG_HISTORY_MAX) msgHistory.shift();
  historyIdx = msgHistory.length;
  const text = (sbConfig && sbConfig.autoInject)
    ? sbContextText(sbConfig) + '\n\n' + raw
    : raw;
  const s = sessions.get(activeId);
  if (s) {
    s.term.paste(text);
    setTimeout(() => ipcRenderer.send('pty-input', { id: activeId, data: '\r' }), PTY_SEND_DELAY);
  }
  uiTextarea.value = '';
  uiTextarea.style.height = '';
  uiCharCount.textContent = '';
  updateSaveBtn();
}

document.getElementById('btn-ui-send').addEventListener('click', sendUiMessage);

// Code block wrap
document.getElementById('btn-ui-code').addEventListener('click', () => {
  const start = uiTextarea.selectionStart;
  const end   = uiTextarea.selectionEnd;
  const val   = uiTextarea.value;
  const sel   = val.slice(start, end);
  const multi = sel.includes('\n');
  const wrapped = multi ? '```\n' + sel + '\n```' : '`' + sel + '`';
  uiTextarea.value = val.slice(0, start) + wrapped + val.slice(end);
  uiTextarea.selectionStart = start + (multi ? 4 : 1);
  uiTextarea.selectionEnd   = start + (multi ? 4 : 1) + sel.length;
  autoResize(uiTextarea);
  uiTextarea.focus();
});

// File attach — opens native file dialog, inserts paths at cursor
document.getElementById('btn-ui-attach').addEventListener('click', async () => {
  const paths = await ipcRenderer.invoke('show-file-dialog');
  if (!paths || !paths.length) return;
  const insert = paths.join('\n');
  const pos    = uiTextarea.selectionStart;
  const val    = uiTextarea.value;
  uiTextarea.value = val.slice(0, pos) + insert + val.slice(pos);
  uiTextarea.selectionStart = uiTextarea.selectionEnd = pos + insert.length;
  autoResize(uiTextarea);
  uiTextarea.focus();
});

// ── Storybook panel ──────────────────────────────────────────────
let sbConfig = JSON.parse(localStorage.getItem('cathode-storybook') || 'null');

function sbContextText(cfg) {
  const loc = cfg.type === 'url' ? cfg.value : `the folder at ${cfg.value}`;
  return `[Design System] Before making any UI changes, reference the Storybook at ${loc}. Use its design tokens, component APIs, and visual styles to ensure consistency with the existing design system.`;
}

function renderSbConnected() {
  document.getElementById('sb-setup').style.display     = 'none';
  document.getElementById('sb-connected').style.display = 'flex';
  document.getElementById('sb-conn-val').textContent    = sbConfig.value;
  document.getElementById('sb-auto-conn').checked       = sbConfig.autoInject;
  document.getElementById('sb-preview-text').textContent = sbContextText(sbConfig);
}

function renderSbSetup() {
  document.getElementById('sb-setup').style.display     = 'flex';
  document.getElementById('sb-connected').style.display = 'none';
}

// Init
if (sbConfig) renderSbConnected(); else renderSbSetup();

document.getElementById('sb-connect').addEventListener('click', () => {
  const url    = document.getElementById('sb-url').value.trim();
  const folder = document.getElementById('sb-folder').value.trim();
  const auto   = document.getElementById('sb-auto').checked;
  const value  = url || folder;
  if (!value) {
    document.getElementById('sb-url').focus();
    document.getElementById('sb-url').style.borderColor = '#f44747';
    setTimeout(() => document.getElementById('sb-url').style.borderColor = '', 1500);
    return;
  }
  sbConfig = { type: url ? 'url' : 'folder', value, autoInject: auto };
  localStorage.setItem('cathode-storybook', JSON.stringify(sbConfig));
  renderSbConnected();
});

document.getElementById('sb-disconnect').addEventListener('click', () => {
  sbConfig = null;
  localStorage.removeItem('cathode-storybook');
  document.getElementById('sb-url').value    = '';
  document.getElementById('sb-folder').value = '';
  renderSbSetup();
});

document.getElementById('sb-auto-conn').addEventListener('change', e => {
  if (!sbConfig) return;
  sbConfig.autoInject = e.target.checked;
  localStorage.setItem('cathode-storybook', JSON.stringify(sbConfig));
});

document.getElementById('sb-browse').addEventListener('click', async () => {
  const path = await ipcRenderer.invoke('show-folder-dialog');
  if (path) {
    document.getElementById('sb-folder').value = path;
    document.getElementById('sb-url').value    = '';
  }
});

// Allow Enter to submit URL field
document.getElementById('sb-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sb-connect').click(); }
  e.stopPropagation();
});
document.getElementById('sb-folder').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sb-connect').click(); }
  e.stopPropagation();
});

// ── Ready ─────────────────────────────────────────────────────────
const _savedApiKey = localStorage.getItem('cathode-api-key');
if (_savedApiKey) ipcRenderer.send('set-api-key', _savedApiKey);
ipcRenderer.send('renderer-ready');
