const { app, BrowserWindow, WebContentsView, ipcMain, Menu, nativeTheme, dialog } = require('electron');
Menu.setApplicationMenu(null);
nativeTheme.themeSource = 'dark';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getPickerScript }        = require('./src/picker-inject');
const { getCombinedScript }       = require('./src/combined-inject');
const { getScreenshotScript }     = require('./src/screenshot-inject');
const { getScreenshotPopupScript } = require('./src/screenshot-popup-inject');
const { getResizeScript }         = require('./src/resize-inject');
const http = require('http');

// ── HiDPI: read saved scale factor and apply BEFORE app.whenReady() ──
// Chromium's --force-device-scale-factor must be set before the process
// initialises its GPU stack, so we persist it and apply on the next launch.
const DISPLAY_FILE = path.join(os.homedir(), 'AppData', 'Roaming', 'cathode-terminal', 'display.json');

function readSavedScale() {
  try { return JSON.parse(fs.readFileSync(DISPLAY_FILE, 'utf8')).scaleFactor || 1; }
  catch (_) { return 1; }
}
function saveScale(sf) {
  try {
    fs.mkdirSync(path.dirname(DISPLAY_FILE), { recursive: true });
    fs.writeFileSync(DISPLAY_FILE, JSON.stringify({ scaleFactor: sf }));
  } catch (_) {}
}

const savedScale = readSavedScale();
if (savedScale > 1) app.commandLine.appendSwitch('force-device-scale-factor', String(savedScale));

// Expose Chromium remote-debugging on localhost so we can load the DevTools
// frontend in our own WebContentsView (the only reliable embedded-panel path).
const DEVTOOLS_PORT = 19222;
app.commandLine.appendSwitch('remote-debugging-port', String(DEVTOOLS_PORT));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

// ── Persistent browser URL ────────────────────────────────────────
function getStateFile() {
  return path.join(app.getPath('userData'), 'browser-state.json');
}
function loadLastURL() {
  try {
    const data = JSON.parse(fs.readFileSync(getStateFile(), 'utf8'));
    return data.url || 'about:blank';
  } catch (_) { return 'about:blank'; }
}
function saveLastURL(url) {
  if (!url || url === 'about:blank') return;
  try { fs.writeFileSync(getStateFile(), JSON.stringify({ url })); } catch (_) {}
}

let mainWindow;
let browserView;
let figmaView      = null;
let devToolsView   = null;  // WebContentsView hosting the embedded DevTools frontend
let devToolsOpening = false; // guard against double-open
let devToolsOpen   = false;
let devToolsWidth  = 0;
let devToolsTimer  = null;
const DT_WIDTH     = 420;
const ptyProcesses = {};
let activePtyId    = null;
let rightPanelMode = 'project';

const TOOLBAR_HEIGHT    = 46;
const TABBAR_HEIGHT     = 38;
const POPUP_BAR_HEIGHT  = 36;

let splitFraction = 0.4;

// ── CDP state ─────────────────────────────────────────────────────
let cdpReady = false;
let stylesheetMap = {}; // styleSheetId → sourceURL

function resetCDP() { cdpReady = false; stylesheetMap = {}; }

async function ensureCDP() {
  if (cdpReady) return;
  const dbg = browserView.webContents.debugger;
  try { dbg.attach('1.3'); } catch (_) {}
  await dbg.sendCommand('DOM.enable');
  await dbg.sendCommand('CSS.enable');
  try {
    const { headers } = await dbg.sendCommand('CSS.getAllStyleSheets');
    for (const h of headers) {
      if (h.sourceURL) stylesheetMap[h.styleSheetId] = h.sourceURL;
    }
  } catch (_) {}
  cdpReady = true;
}

// ── Window setup ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#252525', symbolColor: '#888888', height: 46 },
    // nodeIntegration required: renderer uses ipcRenderer and node-pty directly
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  browserView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.contentView.addChildView(browserView);
  browserView.webContents.loadURL(loadLastURL());

  browserView.webContents.on('did-navigate', (_, url) => {
    resetCDP();
    saveLastURL(url);
    mainWindow.webContents.send('browser-url-changed', url);
    // Reconnect embedded DevTools after full navigation (WebSocket target URL may change)
    if (devToolsView) {
      browserView.webContents.once('did-finish-load', () => reconnectDevTools());
    }
  });
  browserView.webContents.on('did-navigate-in-page', (_, url) => {
    saveLastURL(url);
    mainWindow.webContents.send('browser-url-changed', url);
  });
  browserView.webContents.on('page-title-updated', (_, title) => {
    mainWindow.webContents.send('tab-title-updated', title);
  });

  // Intercept window.open() — deny OS window, open inside app as WebContentsViews
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => openInlinePopup(url));
    return { action: 'deny' };
  });

  // ── Context menu: browser view ────────────────────────────────────
  browserView.webContents.on('context-menu', (_, p) => {
    const tpl = [];

    if (p.selectionText || p.isEditable) {
      if (p.editFlags.canCut)  tpl.push({ label: 'Cut',  click: () => browserView.webContents.cut()  });
      if (p.selectionText)     tpl.push({ label: 'Copy', click: () => browserView.webContents.copy() });
      if (p.editFlags.canPaste) tpl.push({ label: 'Paste', click: () => browserView.webContents.paste() });
      tpl.push({ label: 'Select All', click: () => browserView.webContents.selectAll() });
      tpl.push({ type: 'separator' });
    }

    tpl.push(
      { label: 'Back',        enabled: browserView.webContents.canGoBack(),    click: () => browserView.webContents.goBack()    },
      { label: 'Forward',     enabled: browserView.webContents.canGoForward(), click: () => browserView.webContents.goForward() },
      { label: 'Reload',      click: () => browserView.webContents.reload() },
      { label: 'Hard Reload', click: () => browserView.webContents.reloadIgnoringCache() },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => openDevToolsPanel(p.x, p.y) }
    );

    Menu.buildFromTemplate(tpl).popup({ window: mainWindow });
  });

  // ── Context menu: main renderer (address bar, inputs, terminal) ───
  mainWindow.webContents.on('context-menu', (_, p) => {
    const tpl = [];
    if (p.editFlags.canCut)    tpl.push({ label: 'Cut',        role: 'cut'       });
    if (p.selectionText || p.editFlags.canCopy) tpl.push({ label: 'Copy', role: 'copy' });
    if (p.editFlags.canPaste)  tpl.push({ label: 'Paste',      role: 'paste'     });
    if (tpl.length)            tpl.push({ type: 'separator' });
    tpl.push(                  { label: 'Select All',          role: 'selectAll' });
    if (tpl.length > 1) Menu.buildFromTemplate(tpl).popup({ window: mainWindow });
  });

  mainWindow.on('resize', () => {
    repositionBrowserView();
    repositionInlinePopup();
    repositionRightPanelView();
    repositionDevToolsView();
    broadcastLayout();
  });
}

// ── Inline popup (WebContentsView overlay) ────────────────────────
let popupBarView     = null;
let popupContentView = null;

function getPopupBounds() {
  const [winW, winH] = mainWindow.getContentSize();
  const fraction  = splitFraction;
  const rightX    = Math.round(winW * fraction) + 6;
  const rightW    = winW - rightX;
  const topOffset = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
  const availH    = winH - topOffset;

  const popW = Math.min(580, Math.round(rightW * 0.88));
  const popH = Math.min(720, Math.round(availH  * 0.88));
  const popX = rightX + Math.round((rightW - popW) / 2);
  const popY = topOffset + Math.round((availH - popH) / 2);
  return { x: popX, y: popY, width: popW, height: popH };
}

// Return the registrable domain (e.g. "kindo.ai" from "app.kindo.ai")
function rootDomain(hostname) {
  const parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

function openInlinePopup(url) {
  closeInlinePopup(false); // close any existing without removing backdrop

  const b = getPopupBounds();

  // Snapshot the main browser's root domain so we can detect when auth returns home
  let mainRoot = '';
  try { mainRoot = rootDomain(new URL(browserView.webContents.getURL()).hostname); } catch (_) {}

  // Backdrop injected into the main browser page
  browserView.webContents.executeJavaScript(`
    (function() {
      if (document.getElementById('__cathode_backdrop__')) return;
      const bd = document.createElement('div');
      bd.id = '__cathode_backdrop__';
      bd.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
      document.body.appendChild(bd);
    })()
  `).catch(() => {});

  // Header bar view
  popupBarView = new WebContentsView({
    // nodeIntegration required: popup bar uses ipcRenderer to close/communicate
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: POPUP_BAR_HEIGHT });
  popupBarView.webContents.loadFile(path.join(__dirname, 'src', 'popup-bar.html'));
  popupBarView.webContents.once('did-finish-load', () => {
    popupBarView.webContents.send('popup-url', url);
  });
  mainWindow.contentView.addChildView(popupBarView);

  // Content view
  popupContentView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  popupContentView.setBounds({ x: b.x, y: b.y + POPUP_BAR_HEIGHT, width: b.width, height: b.height - POPUP_BAR_HEIGHT });
  popupContentView.webContents.loadURL(url);
  popupContentView.webContents.on('did-navigate', (_, u) => {
    // Update header URL
    if (popupBarView && !popupBarView.webContents.isDestroyed()) {
      popupBarView.webContents.send('popup-url', u);
    }
    // Detect auth completion: popup landed back on the same root domain as the main browser.
    // Promote it — load in the main browser and close the popup.
    try {
      const popupRoot = rootDomain(new URL(u).hostname);
      if (mainRoot && popupRoot === mainRoot) {
        browserView.webContents.loadURL(u);
        mainWindow.webContents.send('browser-url-changed', u);
        closeInlinePopup();
      }
    } catch (_) {}
  });
  mainWindow.contentView.addChildView(popupContentView);
}

function closeInlinePopup(removeBackdrop = true) {
  if (popupBarView)     { mainWindow.contentView.removeChildView(popupBarView);     popupBarView = null; }
  if (popupContentView) { mainWindow.contentView.removeChildView(popupContentView); popupContentView = null; }
  if (removeBackdrop) {
    browserView.webContents.executeJavaScript(
      `const bd=document.getElementById('__cathode_backdrop__');if(bd)bd.remove();`
    ).catch(() => {});
  }
}

function repositionInlinePopup() {
  if (!popupBarView && !popupContentView) return;
  const b = getPopupBounds();
  if (popupBarView)     popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: POPUP_BAR_HEIGHT });
  if (popupContentView) popupContentView.setBounds({ x: b.x, y: b.y + POPUP_BAR_HEIGHT, width: b.width, height: b.height - POPUP_BAR_HEIGHT });
}

ipcMain.on('close-inline-popup', () => closeInlinePopup());

// ── Right panel views (Figma, Storybook) ─────────────────────────
function repositionRightPanelView() {
  if (!mainWindow) return;
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = splitFraction;
  const availW   = winW - devToolsWidth;
  const rightX   = Math.round(availW * fraction) + 6;
  const rightW   = availW - rightX;
  if (figmaView) {
    figmaView.setBounds(
      rightPanelMode === 'figma'
        ? { x: rightX, y: TOOLBAR_HEIGHT, width: rightW, height: winH - TOOLBAR_HEIGHT }
        : { x: -10000, y: 0, width: 1, height: 1 }
    );
  }
}

function repositionDevToolsView() {
  if (!devToolsView || !mainWindow || mainWindow.isDestroyed()) return;
  const [winW, winH] = mainWindow.getContentSize();
  devToolsView.setBounds(devToolsWidth > 0
    ? { x: winW - devToolsWidth, y: 0, width: devToolsWidth, height: winH }
    : { x: -10000, y: 0, width: 1, height: 1 });
}

// ── Remote DevTools helpers ───────────────────────────────────────
async function fetchTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('DevTools list timeout')); });
  });
}

async function getDevToolsURL() {
  const targets = await fetchTargets();
  const pageUrl = browserView.webContents.getURL();
  const isBlank = !pageUrl || pageUrl === 'about:blank';

  // Exclude: the DevTools view itself, main renderer HTML, internal Electron targets
  const exclude = u => !u
    || u.startsWith('devtools://')
    || u.startsWith('file://')
    || u.startsWith('http://127.0.0.1')
    || u.startsWith('chrome-extension://')
    || u.includes('figma.com');

  // Prefer exact URL match; fall back to first non-excluded page target
  const target = isBlank
    ? targets.find(t => t.type === 'page' && !exclude(t.url))
    : (targets.find(t => t.type === 'page' && t.url === pageUrl)
      ?? targets.find(t => t.type === 'page' && !exclude(t.url)));

  if (!target) throw new Error(`No DevTools target found (pageUrl=${pageUrl})`);
  const wsPath = target.webSocketDebuggerUrl.replace(/^ws:\/\//, '');
  return `http://127.0.0.1:${DEVTOOLS_PORT}/devtools/inspector.html?ws=${wsPath}`;
}

async function reconnectDevTools() {
  if (!devToolsView || devToolsView.webContents.isDestroyed()) return;
  try {
    const url = await getDevToolsURL();
    devToolsView.webContents.loadURL(url);
  } catch (_) {}
}

async function inspectElementCDP(x, y) {
  try {
    await ensureCDP();
    const { nodeId } = await browserView.webContents.debugger.sendCommand('DOM.getNodeForLocation', {
      x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false,
    });
    if (nodeId) await browserView.webContents.debugger.sendCommand('DOM.setInspectedNode', { nodeId });
  } catch (_) {}
}

function broadcastLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [winW] = mainWindow.getContentSize();
  const frac   = splitFraction;
  const leftW  = Math.max(280, Math.round((winW - devToolsWidth - 4) * frac));
  mainWindow.webContents.send('devtools-layout', { leftPanelWidth: leftW, devToolsWidth });
}

function animateDevTools(open) {
  if (devToolsTimer) { clearInterval(devToolsTimer); devToolsTimer = null; }
  const startW    = devToolsWidth;
  const targetW   = open ? DT_WIDTH : 0;
  const startTime = Date.now();
  const DURATION  = 220;
  devToolsTimer = setInterval(() => {
    const t    = Math.min((Date.now() - startTime) / DURATION, 1);
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    devToolsWidth = Math.round(startW + (targetW - startW) * ease);
    repositionBrowserView();
    repositionRightPanelView();
    repositionInlinePopup();
    repositionDevToolsView();
    broadcastLayout();
    if (t >= 1) {
      clearInterval(devToolsTimer);
      devToolsTimer = null;
      devToolsWidth = targetW;
      devToolsOpen  = open;
      if (!open && devToolsView) {
        mainWindow.contentView.removeChildView(devToolsView);
        devToolsView = null;
      }
      mainWindow.webContents.send(open ? 'devtools-opened' : 'devtools-closed');
    }
  }, 16);
}

async function openDevToolsPanel(inspectX, inspectY) {
  if (devToolsView || devToolsOpening) {
    if (inspectX != null) inspectElementCDP(inspectX, inspectY);
    return;
  }
  devToolsOpening = true;
  try {
    // 300ms: remote-debugging server needs time to register the new target after navigation
    await new Promise(r => setTimeout(r, 300));
    const url = await getDevToolsURL();
    // contextIsolation: false required for the embedded devtools:// frontend to function
    devToolsView = new WebContentsView({ webPreferences: { contextIsolation: false } });
    mainWindow.contentView.addChildView(devToolsView);
    repositionDevToolsView(); // park off-screen; animation will bring it in
    devToolsView.webContents.loadURL(url);
    devToolsView.webContents.once('did-fail-load', () => {
      if (devToolsView) { mainWindow.contentView.removeChildView(devToolsView); devToolsView = null; }
      devToolsOpen = false;
    });
    if (inspectX != null) {
      devToolsView.webContents.once('did-finish-load', () => inspectElementCDP(inspectX, inspectY));
    }
    animateDevTools(true);
  } catch (err) {
    console.error('[DevTools]', err.message);
    if (devToolsView) { mainWindow.contentView.removeChildView(devToolsView); devToolsView = null; }
  } finally {
    devToolsOpening = false;
  }
}

function createFigmaView() {
  figmaView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  mainWindow.contentView.addChildView(figmaView);
  figmaView.webContents.loadURL('https://www.figma.com');
  repositionRightPanelView();
}

ipcMain.on('right-panel-mode', (_, mode) => {
  rightPanelMode = mode;
  if (mode === 'figma' && !figmaView) createFigmaView();
  repositionBrowserView();
  repositionRightPanelView();
});

function repositionBrowserView(overrideFraction) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!browserView || browserView.webContents.isDestroyed()) return;
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = overrideFraction ?? splitFraction;
  const availW  = winW - devToolsWidth;
  const leftW   = Math.round(availW * fraction);
  const rightX  = leftW + 6;
  if (rightPanelMode !== 'project') {
    browserView.setBounds({ x: -10000, y: 0, width: 1, height: 1 });
    return;
  }
  const topOffset = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
  browserView.setBounds({ x: rightX, y: topOffset, width: availW - rightX, height: winH - topOffset });
}

// ── PTY sessions ──────────────────────────────────────────────────
function spawnPty(id) {
  try {
    const pty  = require('node-pty');
    const proc = pty.spawn('wsl.exe', ['bash', '-lic', 'claude'], {
      name: 'xterm-256color', cols: 80, rows: 24,
      cwd: process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    proc.onData(data => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty-output', { id, data });
    });
    proc.onExit(() => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('pty-output', { id, data: '\r\n\x1b[33m[Claude session ended]\x1b[0m\r\n' });
      delete ptyProcesses[id];
    });
    ptyProcesses[id] = proc;
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('pty-output', { id, data: `\r\n\x1b[31m[Error starting claude: ${err.message}]\x1b[0m\r\n` });
  }
}

// ── IPC: terminal ─────────────────────────────────────────────────
ipcMain.on('pty-input',   (_, { id, data })       => { if (ptyProcesses[id]) ptyProcesses[id].write(data); });
ipcMain.on('pty-resize',  (_, { id, cols, rows })  => { if (ptyProcesses[id]) ptyProcesses[id].resize(cols, rows); });
ipcMain.on('pty-spawn',   (_, { id })              => spawnPty(id));
ipcMain.on('pty-kill',    (_, { id })              => {
  if (ptyProcesses[id]) { try { ptyProcesses[id].kill(); } catch (_) {} delete ptyProcesses[id]; }
});
ipcMain.on('pty-restart', (_, { id })              => {
  if (ptyProcesses[id]) { try { ptyProcesses[id].kill(); } catch (_) {} delete ptyProcesses[id]; }
  spawnPty(id);
});
ipcMain.on('set-active-pty', (_, { id }) => { activePtyId = id; });

// ── IPC: browser ──────────────────────────────────────────────────
ipcMain.on('browser-navigate', (_, url) => {
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    const isLocal = /^localhost(:\d+)?(\/|$)|^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(target);
    target = (isLocal ? 'http://' : 'https://') + target;
  }
  browserView.webContents.loadURL(target);
});
ipcMain.on('browser-reload', () => browserView.webContents.reloadIgnoringCache());
ipcMain.on('browser-toggle-devtools', () => {
  if (devToolsOpen || devToolsView) animateDevTools(false);
  else openDevToolsPanel();
});

// ── IPC: layout ───────────────────────────────────────────────────
ipcMain.on('split-changed', (_, fraction) => {
  splitFraction = fraction;
  repositionBrowserView(fraction);
  repositionRightPanelView();
  broadcastLayout();
});
ipcMain.on('renderer-ready', () => { repositionBrowserView(); broadcastLayout(); });

ipcMain.handle('show-file-dialog', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  return filePaths || [];
});

ipcMain.handle('show-folder-dialog', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return filePaths[0] || null;
});

function getApiKeyFile() {
  return path.join(app.getPath('userData'), '.api-key');
}
function loadSavedApiKey() {
  try {
    const key = fs.readFileSync(getApiKeyFile(), 'utf8').trim();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch (_) {}
}

ipcMain.on('set-api-key', (_, key) => {
  process.env.ANTHROPIC_API_KEY = key;
  try { fs.writeFileSync(getApiKeyFile(), key, 'utf8'); } catch (_) {}
});

ipcMain.on('browser-view-hide', () => {
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.setBounds({ x: -10000, y: 0, width: 1, height: 1 });
  }
});

ipcMain.on('browser-view-show', () => {
  repositionBrowserView();
});

ipcMain.on('new-window', () => {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 800, minHeight: 600,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#252525', symbolColor: '#888888', height: 46 },
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
});

// ── Active right-panel WebContentsView ───────────────────────────
function getActivePickView() {
  if (rightPanelMode === 'figma'   && figmaView)   return figmaView;
  if (rightPanelMode === 'project' && browserView) return browserView;
  return null; // storybook has no WebContentsView yet
}

// ── IPC: element picker ───────────────────────────────────────────
ipcMain.on('pick-start', async (_, mode) => {
  const view = getActivePickView();
  if (!view) { mainWindow.webContents.send('pick-cancelled'); return; }
  try {
    // Phase 1: user draws selection
    const picked = await view.webContents.executeJavaScript(getPickerScript(mode));
    if (!picked) { mainWindow.webContents.send('pick-cancelled'); return; }

    const { cx, cy, mouseUpX, mouseUpY, bounds, mode: pickedMode } = picked;

    // Phase 2: element detection + popup in one script (shares live DOM refs for hover highlight)
    const result = await view.webContents.executeJavaScript(
      getCombinedScript({
        isClick: pickedMode === 'click',
        bounds, cx, cy,
        mouseUpX: mouseUpX ?? cx,
        mouseUpY: mouseUpY ?? cy,
      })
    );

    mainWindow.webContents.send('pick-cancelled'); // clear active button state

    if (!result) return;
    const { items, instruction } = result;
    if (!instruction && items.length === 0) return;

    // Phase 3: CSS source refs via CDP (project view only — source maps only meaningful for local dev)
    let cssRefs = [];
    if (view === browserView) {
      await ensureCDP();
      cssRefs = await getCSSSourceRefs({ cx, cy }).catch(() => []);
    }

    // Phase 4: format source-first and write to PTY
    const message = formatSourceMessage({ items, cssRefs, instruction });
    mainWindow.webContents.send('pick-send-to-pty', message);

  } catch (err) {
    console.error('Pick error:', err);
    mainWindow.webContents.send('pick-cancelled');
  }
});

// ── IPC: screenshot ───────────────────────────────────────────────
ipcMain.on('pick-screenshot', async () => {
  const view = getActivePickView();
  if (!view) { mainWindow.webContents.send('pick-cancelled'); return; }
  try {
    // Phase 1: user draws the capture region
    const sel = await view.webContents.executeJavaScript(getScreenshotScript());
    if (!sel) { mainWindow.webContents.send('pick-cancelled'); return; }

    const { x, y, width, height, mouseUpX, mouseUpY } = sel;

    // Phase 2: capture that rectangle from the WebContentsView
    const image = await view.webContents.capturePage({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });

    // Phase 3: save PNG
    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const filename  = `screenshot-${Date.now()}.png`;
    const filepath  = path.join(screenshotsDir, filename);
    const pngBuffer = image.toPNG();
    fs.writeFileSync(filepath, pngBuffer);

    // Phase 4: show popup in browser with thumbnail preview
    const thumbB64 = pngBuffer.toString('base64');
    const popupResult = await view.webContents.executeJavaScript(
      getScreenshotPopupScript(thumbB64, mouseUpX, mouseUpY)
    );

    mainWindow.webContents.send('pick-cancelled');

    if (!popupResult) return;
    const { instruction } = popupResult;

    // Phase 5: write to PTY — Claude Code can read the file
    const msg = `[Screenshot: ${filepath}]${instruction ? '\n\n' + instruction : ''}`;
    mainWindow.webContents.send('pick-send-to-pty', msg);
  } catch (err) {
    console.error('Screenshot error:', err);
    mainWindow.webContents.send('pick-cancelled');
  }
});

// ── IPC: element resize ───────────────────────────────────────────
ipcMain.on('pick-resize', async () => {
  const view = getActivePickView();
  if (!view) { mainWindow.webContents.send('pick-cancelled'); return; }
  try {
    const result = await view.webContents.executeJavaScript(getResizeScript());
    mainWindow.webContents.send('pick-cancelled');
    if (!result) return;

    const { selector, tag, snippet, oW, oH, nW, nH, instructions } = result;
    const lines = [
      '───── Resize Request ─────',
      snippet,
      '',
      'Selector: ' + selector,
    ];
    if (nW !== oW) lines.push('  width:  ' + oW + 'px  →  ' + nW + 'px');
    if (nH !== oH) lines.push('  height: ' + oH + 'px  →  ' + nH + 'px');
    if (instructions) { lines.push('', 'Additional instructions: ' + instructions); }
    lines.push('', 'Update the CSS so this element matches these dimensions.');

    mainWindow.webContents.send('pick-send-to-pty', lines.join('\n'));
  } catch (err) {
    console.error('Resize error:', err);
    mainWindow.webContents.send('pick-cancelled');
  }
});

// ── Source-first message formatter ───────────────────────────────
function formatSourceMessage({ items, cssRefs, instruction }) {
  const lines = ['───── Element Context ─────'];

  // React components — lead with file:line if available
  for (const item of items) {
    if (item.debugSource) {
      const file = shortPath(item.debugSource.file);
      lines.push(`${file}:${item.debugSource.line}  →  ${item.reactComponent || item.label}`);
    } else {
      lines.push(`• ${item.label}`);
    }
    if (item.selectedCSS && item.selectedCSS.length > 0) {
      for (const css of item.selectedCSS) lines.push(`    ${css}`);
    }
  }

  // CSS rules with source file:line references
  if (cssRefs.length > 0) {
    lines.push('');
    for (const ref of cssRefs) {
      const src = ref.file ? `  ←  ${ref.file}${ref.line ? ':' + ref.line : ''}` : '';
      lines.push(`${ref.selector} { ${ref.props} }${src}`);
    }
  }

  lines.push('──────────────────────────');
  return lines.join('\n') + (instruction ? `\n\n${instruction}` : '');
}

// ── CSS source ref extraction via CDP ────────────────────────────
async function getCSSSourceRefs({ cx, cy }) {
  const dbg = browserView.webContents.debugger;
  const { nodeId } = await dbg.sendCommand('DOM.getNodeForLocation', {
    x: Math.round(cx), y: Math.round(cy),
    includeUserAgentShadowDOM: false,
  });
  if (!nodeId) return [];

  const cssRes = await dbg.sendCommand('CSS.getMatchedStylesForNode', { nodeId }).catch(() => ({}));

  // Fetch any stylesheet URLs we haven't seen yet
  const unknownIds = new Set();
  for (const m of (cssRes.matchedCSSRules || [])) {
    const sid = m.rule?.style?.styleSheetId;
    if (sid && !stylesheetMap[sid]) unknownIds.add(sid);
  }
  await Promise.all([...unknownIds].map(async (sid) => {
    try {
      const { styleSheet } = await dbg.sendCommand('CSS.getStyleSheet', { styleSheetId: sid });
      if (styleSheet.sourceURL) stylesheetMap[sid] = styleSheet.sourceURL;
    } catch (_) {}
  }));

  return (cssRes.matchedCSSRules || [])
    .filter(m => m.rule.origin !== 'user-agent' && (m.rule.style?.cssProperties?.length ?? 0) > 0)
    .slice(0, 8)
    .map(({ rule }) => {
      const props = (rule.style.cssProperties || [])
        .filter(p => p.value && !p.disabled && !p.implicit)
        .map(p => `${p.name}: ${p.value}`)
        .slice(0, 5)
        .join('; ');
      const sid  = rule.style.styleSheetId;
      const file = sid && stylesheetMap[sid] ? shortPath(stylesheetMap[sid]) : null;
      const line = rule.style.range ? rule.style.range.startLine + 1 : null;
      return { selector: rule.selectorList.text, props, file, line };
    })
    .filter(r => r.props);
}

// ── Path helpers ──────────────────────────────────────────────────
function shortPath(url) {
  if (!url) return '';
  return url.replace(/^.*?\/src\//, 'src/').replace(/\?.*$/, '');
}


// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSavedApiKey();
  const { screen } = require('electron');
  const currentScale = screen.getPrimaryDisplay().scaleFactor;

  if (currentScale !== savedScale) {
    // Scale changed (or first run on HiDPI) — persist and relaunch so the
    // --force-device-scale-factor flag is applied from process start.
    saveScale(currentScale);
    const args = process.argv.slice(1).filter(a => !a.startsWith('--force-device-scale-factor'));
    app.relaunch({ args });
    app.exit(0);
    return;
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  Object.values(ptyProcesses).forEach(p => { try { p.kill(); } catch (_) {} });
  if (process.platform !== 'darwin') app.quit();
});
