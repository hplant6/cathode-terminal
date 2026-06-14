const { app, BrowserWindow, WebContentsView, ipcMain, Menu, nativeImage, nativeTheme, dialog, safeStorage, clipboard, net } = require('electron');
Menu.setApplicationMenu(null);
nativeTheme.themeSource = 'dark';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getPickerScript }        = require('./src/picker-inject');
const { Z }                       = require('./src/ui-constants');
const { getCombinedScript }       = require('./src/combined-inject');
const { getScreenshotScript }     = require('./src/screenshot-inject');
const { getScreenshotPopupScript } = require('./src/screenshot-popup-inject');
const { getResizeScript }         = require('./src/resize-inject');
const { getDrawScript }           = require('./src/draw-inject');
const { getEyedropperScript }     = require('./src/eyedropper-inject');
const { getA11yScript }           = require('./src/a11y-inject');
const http = require('http');

const STORYBOOK_CURSOR_B64 = Buffer.from(fs.readFileSync(path.join(__dirname, 'src', 'icons', 'storybook-cursor.svg'), 'utf8')).toString('base64');
const STORYBOOK_CURSOR_CSS = `url("data:image/svg+xml;base64,${STORYBOOK_CURSOR_B64}") 9 9, crosshair`;
const { execFile, spawn } = require('child_process');

// Async WSL exec helpers — sync variants freeze the main thread (and every
// native-view repaint) for seconds; anything UI-adjacent must use these.
function wslExecFile(args, timeout = 6000) {
  return new Promise(resolve => {
    execFile('wsl.exe', args, { encoding: 'utf8', timeout }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}
function wslExecInput(args, input, timeout = 5000) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    try {
      const p = spawn('wsl.exe', args);
      p.on('close', code => finish(code === 0));
      p.on('error', () => finish(false));
      setTimeout(() => { try { p.kill(); } catch (_) {} finish(false); }, timeout);
      p.stdin.write(input);
      p.stdin.end();
    } catch (_) { finish(false); }
  });
}

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

const DEVTOOLS_PORT = 19222;
app.commandLine.appendSwitch('remote-debugging-port', String(DEVTOOLS_PORT));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${DEVTOOLS_PORT}`);

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
let storybookView  = null;
let devToolsView   = null;  // WebContentsView hosting the embedded DevTools frontend
let devToolsOpening = false; // guard against double-open
let devToolsOpen   = false;
let devToolsWidth  = 0;
let devToolsTimer  = null;
const DT_WIDTH     = 420;
const ptyProcesses = {};
const ptyCommands  = {};
let modalOpen      = false;
let browserEmpty   = false;   // project URL is blank → show HTML empty state
let deviceEmulation = null;   // { name, fit, width, height } → size the view to a device viewport
let resizingDevice  = false;  // true while the user is ghost-dragging a resize handle
const DEVICE_HANDLE = 14;     // backdrop reserved on the view's right+bottom for resize handles
let activePtyId    = null;
let rightPanelMode = 'project';
const customViews  = new Map(); // url → WebContentsView

const TOOLBAR_HEIGHT    = 46;
const TABBAR_HEIGHT     = 38;
const POPUP_BAR_HEIGHT  = 36;

// Safe send to the main renderer — async handlers can outlive the window.
function uiSend(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// Bounds that park a WebContentsView far offscreen (views can't be hidden,
// only moved). Shared sentinel — do not mutate.
const OFFSCREEN_BOUNDS = { x: -10000, y: 0, width: 1, height: 1 };

// Reposition every native view in one call. Always use this (not individual
// reposition fns) when layout state changes — a missed member is how modals
// ended up behind views in the past. Each member is idempotent and respects
// modalOpen / rightPanelMode itself.
function repositionAll() {
  repositionBrowserView();
  repositionRightPanelView();
  repositionDevToolsView();
  repositionInlinePopup();
}

let splitFraction = 0.4;
// ── Shortcut handler ─────────────────────────────────────────────
// Attach before-input-event to any WebContentsView webContents so
// shortcuts work no matter which panel currently holds keyboard focus.
// tabOnly = true  → only tab-switching (safe for utility/popup views)
// Tool shortcuts are Alt+<letter> so they can never collide with typing
// (in the composer or inside the browsed page) — no focus tracking needed.
const TOOL_KEYS = new Set(['b', 'l', 'i', 'r', 's', 'm', 'e', 'c', 'a']);

// Toolbar tools mirrored into the browser context menu. The renderer registers
// them (label, accelerator, key, rasterized icon) once the toolbar is built.
let browserTools = [];
ipcMain.on('register-browser-tools', (_, tools) => { browserTools = Array.isArray(tools) ? tools : []; });
function attachShortcutHandler(wc, { tabOnly = false } = {}) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const ctrl = input.control || input.meta;

    // Ctrl/Cmd+Shift+←/→ — tab switching (all views)
    if (ctrl && input.shift && !input.alt) {
      if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
        event.preventDefault();
        mainWindow.webContents.send('shortcut-action', {
          type: 'tab-switch',
          dir: input.key === 'ArrowLeft' ? -1 : 1,
        });
        return;
      }
    }

    // Escape — cancel active tool (all views)
    if (!ctrl && !input.shift && !input.alt && input.key === 'Escape') {
      mainWindow.webContents.send('shortcut-action', { type: 'escape' });
      return;
    }

    // Ctrl/Cmd+\ — toggle terminal/browser divider
    if (ctrl && !input.shift && !input.alt && input.key === '\\') {
      event.preventDefault();
      mainWindow.webContents.send('shortcut-action', { type: 'panel-toggle' });
      return;
    }

    if (tabOnly) return;

    // Alt+<letter> — activate a tool. Uses input.code (physical key) so it's
    // robust across keyboard layouts / OS Alt-char behavior.
    if (input.alt && !ctrl && !input.shift && /^Key[A-Z]$/.test(input.code || '')) {
      const key = input.code.slice(3).toLowerCase();
      if (TOOL_KEYS.has(key)) {
        event.preventDefault();
        mainWindow.webContents.send('shortcut-action', { type: 'tool', key });
      }
    }
  });
}

// ── CDP state ─────────────────────────────────────────────────────
let cdpReady = false;
let stylesheetMap = {}; // styleSheetId → sourceURL

function resetCDP() {
  cdpReady = false;
  stylesheetMap = {};
  try { browserView.webContents.debugger.detach(); } catch (_) {}
}

async function ensureCDP() {
  if (cdpReady) return;
  if (devToolsView) return; // debugger.attach() conflicts with the open DevTools WebSocket session
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

// ── Console & Network capture (for the Console tab) ───────────────
// Uses webContents 'console-message' (page console) + session.webRequest
// (failed requests) — no CDP, so it never fights DevTools or the extract CDP.
const CONSOLE_CAP = 600;
let consoleLog = [];
let consoleSeq = 0;
function pushEntry(entry) {
  entry.id = ++consoleSeq;
  entry.ts = Date.now();
  consoleLog.push(entry);
  if (consoleLog.length > CONSOLE_CAP) consoleLog.shift();
  uiSend('console-entry', entry);
}
function normLevel(level) {
  if (typeof level === 'string') {
    const l = level.toLowerCase();
    if (l.startsWith('err')) return 'error';
    if (l.startsWith('warn')) return 'warn';
    if (l.startsWith('debug') || l.startsWith('verbose')) return 'debug';
    if (l.startsWith('info')) return 'info';
    return 'log';
  }
  return ['log', 'info', 'warn', 'error'][level] || 'log';
}
function attachConsoleCapture() {
  const wc = browserView.webContents;
  // Page console — handles both the legacy (event, level, message, line, src)
  // signature and the newer single-event-object form.
  wc.on('console-message', (...args) => {
    let level, message, line, src;
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      const e = args[0]; level = e.level; message = e.message; line = e.lineNumber; src = e.sourceId;
    } else { [, level, message, line, src] = args; }
    pushEntry({ kind: 'console', level: normLevel(level), text: String(message == null ? '' : message), source: src || '', line: line || 0 });
  });
  // Network failures (4xx/5xx + transport errors) scoped to the browser view.
  try {
    wc.session.webRequest.onCompleted((d) => {
      if (d.webContentsId !== wc.id) return;
      if (d.statusCode >= 400) pushEntry({ kind: 'net', method: d.method, url: d.url, status: d.statusCode, type: d.resourceType });
    });
    wc.session.webRequest.onErrorOccurred((d) => {
      if (d.webContentsId !== wc.id) return;
      if (d.error === 'net::ERR_ABORTED') return;
      pushEntry({ kind: 'net', method: d.method, url: d.url, status: 0, type: d.resourceType, error: d.error });
    });
  } catch (_) {}
}
ipcMain.handle('console-get', () => consoleLog);
ipcMain.on('console-clear', () => { consoleLog = []; });

// ── System performance sampler (CPU / RAM / GPU) ──────────────────
// Pushes {cpu,ram,gpu} percentages to the renderer's perf graph every 2s.
// CPU/RAM come from `os`; GPU from a persistent Windows perf-counter loop
// (best effort — null when unavailable, e.g. non-Windows or localized counters).
let _prevCpu = os.cpus().map(c => ({ ...c.times }));
function cpuPercent() {
  const cur = os.cpus().map(c => c.times);
  let idle = 0, total = 0;
  for (let i = 0; i < cur.length && i < _prevCpu.length; i++) {
    const a = _prevCpu[i], b = cur[i];
    idle  += b.idle - a.idle;
    total += (b.user + b.nice + b.sys + b.idle + b.irq) - (a.user + a.nice + a.sys + a.idle + a.irq);
  }
  _prevCpu = cur;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total)))) : 0;
}
function ramPercent() {
  const total = os.totalmem();
  return total > 0 ? Math.round(100 * (total - os.freemem()) / total) : 0;
}

let _gpuPct = null;            // null → unavailable
let _gpuProc = null;
function startGpuSampler() {
  if (process.platform !== 'win32' || _gpuProc) return;
  // Sum the 3D-engine utilization across all GPU adapters (≈ Task Manager's
  // "3D" reading). Streams one rounded number every 2s; 'NA' on failure.
  const script =
    "while($true){try{" +
    "$s=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples;" +
    "$sum=($s|Measure-Object -Property CookedValue -Sum).Sum;" +
    "Write-Output ([math]::Round($sum))}catch{Write-Output 'NA'};" +
    "Start-Sleep -Milliseconds 2000}";
  try {
    _gpuProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    _gpuProc.stdout.on('data', (d) => {
      const line = d.toString().trim().split(/\r?\n/).pop().trim();
      _gpuPct = (line === 'NA' || line === '') ? null : Math.max(0, Math.min(100, parseInt(line, 10) || 0));
    });
    _gpuProc.on('error', () => { _gpuPct = null; _gpuProc = null; });
    _gpuProc.on('close', () => { _gpuProc = null; });
  } catch (_) { _gpuProc = null; }
}

let _sysPerfTimer = null;
function startSysPerf() {
  if (_sysPerfTimer) return;
  startGpuSampler();
  _sysPerfTimer = setInterval(() => {
    uiSend('sysperf', { cpu: cpuPercent(), ram: ramPercent(), gpu: _gpuPct });
  }, 2000);
}

// Top processes by memory or CPU, grouped by name and summed so multi-process
// apps (Chrome, Code…) read as one entry — like Task Manager. On-demand (the
// renderer polls only while a process-breakdown view is open).
//   by='cpu' → instantaneous % from perf counters, normalized by logical cores.
//   else     → working-set bytes via Get-Process.
ipcMain.handle('top-procs', async (_, by) => {
  if (process.platform !== 'win32') return { ok: false };
  const cpu = by === 'cpu';
  const cmd = cpu
    ? "$n=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;" +
      "(Get-Counter '\\Process(*)\\% Processor Time').CounterSamples | " +
      "Where-Object { $_.InstanceName -ne '_total' -and $_.InstanceName -ne 'idle' } | " +
      "Group-Object { $_.InstanceName -replace '#\\d+$','' } | " +
      "ForEach-Object { [pscustomobject]@{ n=$_.Name; v=[math]::Round((($_.Group | Measure-Object CookedValue -Sum).Sum)/$n,1) } } | " +
      "Sort-Object v -Descending | Select-Object -First 6 | ConvertTo-Json -Compress"
    : "Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ n=$_.Name; " +
      "v=(($_.Group | Measure-Object WorkingSet64 -Sum).Sum) } } | " +
      "Sort-Object v -Descending | Select-Object -First 6 | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, maxBuffer: 1 << 20, timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) { resolve({ ok: false }); return; }
        try {
          let data = JSON.parse(stdout.trim());
          if (!Array.isArray(data)) data = [data];
          resolve({ ok: true, by: cpu ? 'cpu' : 'ram', procs: data.map(d => ({ name: d.n, value: d.v })) });
        } catch (_) { resolve({ ok: false }); }
      });
  });
});

// ── Window setup ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, 'icon.png'),   // window/taskbar icon (dev + packaged)
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
  attachConsoleCapture();
  browserView.webContents.loadURL(loadLastURL()).catch(() => {});

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

    // Toolbar tools on top (with their icons), so they're reachable from the
    // page without moving to the app toolbar. Same action path as Alt+<key>.
    if (browserTools.length) {
      for (const t of browserTools) {
        tpl.push({
          label: t.label,
          accelerator: t.accel,
          registerAccelerator: false,            // display only — Alt+<key> already handles it
          icon: t.icon ? nativeImage.createFromDataURL(t.icon) : undefined,
          click: () => mainWindow.webContents.send('shortcut-action', { type: 'tool', key: t.key }),
        });
      }
      tpl.push({ type: 'separator' });
    }

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

  // ── Keyboard shortcuts (fires for whichever view has focus) ─────────
  attachShortcutHandler(mainWindow.webContents);
  attachShortcutHandler(browserView.webContents);

  mainWindow.on('resize', () => {
    repositionAll();
    broadcastLayout();
  });

}

// ── Inline popup (WebContentsView overlay) ────────────────────────
let popupBarView     = null;
let popupContentView = null;

function getPopupBounds() {
  const [winW, winH] = mainWindow.getContentSize();
  // Subtract the DevTools panel like every other layout fn — previously this
  // ignored it, so popups mis-centered while DevTools was open.
  const availW    = winW - devToolsWidth;
  const rightX    = Math.round(availW * splitFraction) + 6;
  const rightW    = availW - rightX;
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
      bd.style.cssText = 'position:fixed;inset:0;z-index:${Z.BACKDROP};background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
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
  popupContentView.webContents.loadURL(url).catch(() => {});
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
        browserView.webContents.loadURL(u).catch(() => {});
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
  const offscreen = OFFSCREEN_BOUNDS;
  if (modalOpen) {
    if (popupBarView)     popupBarView.setBounds(offscreen);
    if (popupContentView) popupContentView.setBounds(offscreen);
    return;
  }
  const b = getPopupBounds();
  if (popupBarView)     popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: POPUP_BAR_HEIGHT });
  if (popupContentView) popupContentView.setBounds({ x: b.x, y: b.y + POPUP_BAR_HEIGHT, width: b.width, height: b.height - POPUP_BAR_HEIGHT });
}

ipcMain.on('close-inline-popup', () => closeInlinePopup());

// ── Right panel views (Figma, Storybook, custom URL) ─────────────
function ensureCustomView(url) {
  if (customViews.has(url)) return customViews.get(url);
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  mainWindow.contentView.addChildView(view);
  attachShortcutHandler(view.webContents);
  view.webContents.loadURL(url).catch(() => {});
  customViews.set(url, view);
  return view;
}

function destroyCustomView(url) {
  const view = customViews.get(url);
  if (!view) return;
  try { mainWindow.contentView.removeChildView(view); } catch (_) {}
  customViews.delete(url);
}

function repositionRightPanelView() {
  if (!mainWindow) return;
  const offscreen = OFFSCREEN_BOUNDS;
  if (modalOpen) {
    if (figmaView)    figmaView.setBounds(offscreen);
    if (storybookView) storybookView.setBounds(offscreen);
    for (const view of customViews.values()) view.setBounds(offscreen);
    return;
  }
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = splitFraction;
  const availW   = winW - devToolsWidth;
  const rightX   = Math.round(availW * fraction) + 6;
  const rightW   = availW - rightX;
  if (figmaView) {
    figmaView.setBounds(
      rightPanelMode === 'figma'
        ? { x: rightX, y: TOOLBAR_HEIGHT, width: rightW, height: winH - TOOLBAR_HEIGHT }
        : offscreen
    );
  }
  if (storybookView) {
    storybookView.setBounds(
      rightPanelMode === 'storybook'
        ? { x: rightX, y: TOOLBAR_HEIGHT, width: rightW, height: winH - TOOLBAR_HEIGHT }
        : offscreen
    );
  }
  for (const [url, view] of customViews) {
    view.setBounds(
      rightPanelMode === 'url:' + url
        ? { x: rightX, y: TOOLBAR_HEIGHT, width: rightW, height: winH - TOOLBAR_HEIGHT }
        : offscreen
    );
  }
}

function repositionDevToolsView() {
  if (!devToolsView || !mainWindow || mainWindow.isDestroyed()) return;
  if (modalOpen) { devToolsView.setBounds(OFFSCREEN_BOUNDS); return; }
  const [winW, winH] = mainWindow.getContentSize();
  devToolsView.setBounds(devToolsWidth > 0
    ? { x: winW - devToolsWidth, y: TOOLBAR_HEIGHT, width: devToolsWidth, height: winH - TOOLBAR_HEIGHT }
    : OFFSCREEN_BOUNDS);
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

  const exclude = u => !u
    || u.startsWith('devtools://')
    || u.startsWith('file://')
    || u.startsWith('http://127.0.0.1')
    || u.startsWith('chrome-extension://')
    || u.includes('figma.com');

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
    devToolsView.webContents.loadURL(url).catch(() => {});
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
    repositionAll();
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
    // Detach in-process debugger before opening — both can't hold a CDP session simultaneously
    resetCDP();
    await new Promise(r => setTimeout(r, 150));
    const url = await getDevToolsURL();
    devToolsView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
    mainWindow.contentView.addChildView(devToolsView);
    attachShortcutHandler(devToolsView.webContents, { tabOnly: true });
    repositionDevToolsView();
    devToolsView.webContents.loadURL(url).catch(() => {});
    devToolsView.webContents.once('did-fail-load', () => {
      if (devToolsView) { mainWindow.contentView.removeChildView(devToolsView); devToolsView = null; }
      devToolsOpen = false;
    });
    devToolsView.webContents.once('did-finish-load', () => {
      // Hide the device toolbar toggle button and close it if currently active
      devToolsView.webContents.insertCSS('[aria-label="Toggle device toolbar"] { display: none !important; }');
      setTimeout(() => {
        if (!devToolsView || devToolsView.webContents.isDestroyed()) return;
        devToolsView.webContents.executeJavaScript(
          `const b = document.querySelector('[aria-label="Toggle device toolbar"]');` +
          `if (b && b.classList.contains('toggled')) b.click();`
        ).catch(() => {});
      }, 500);
      if (inspectX != null) inspectElementCDP(inspectX, inspectY);
    });
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
  attachShortcutHandler(figmaView.webContents);
  figmaView.webContents.loadURL('https://www.figma.com').catch(() => {});
  repositionRightPanelView();
}

function createStorybookView(url) {
  if (storybookView && !storybookView.webContents.isDestroyed()) {
    storybookView.webContents.loadURL(url).catch(() => {});
    repositionRightPanelView();
    return;
  }
  storybookView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  mainWindow.contentView.addChildView(storybookView);
  attachShortcutHandler(storybookView.webContents);
  storybookView.webContents.loadURL(url).catch(() => {});
  repositionRightPanelView();
}

function destroyStorybookView() {
  if (!storybookView) return;
  try { mainWindow.contentView.removeChildView(storybookView); } catch (_) {}
  storybookView = null;
  repositionRightPanelView();
}

ipcMain.on('storybook-load-url', (_, url) => {
  createStorybookView(url);
});

ipcMain.on('storybook-disconnect', () => {
  destroyStorybookView();
});

// ── Storybook agent-memory files ──────────────────────────────────
// Write a clearly-delimited managed block into each model's memory file
// (CLAUDE.md / AGENTS.md / GEMINI.md) so every tool natively picks up the
// Storybook reference. Idempotent: the block is replaced, never duplicated,
// and removed cleanly on disconnect. The rest of each file is untouched.
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
const SB_START = '<!-- cathode:storybook:start -->';
const SB_END   = '<!-- cathode:storybook:end -->';

function storybookBlock(url) {
  return [
    SB_START,
    '## Design System (Storybook)',
    `Reference the Storybook at ${url} before making any UI changes.`,
    'Use its design tokens, component APIs, and visual styles to keep the UI consistent with the existing design system.',
    SB_END,
  ].join('\n');
}

function stripBlock(text) {
  const s = text.indexOf(SB_START);
  if (s === -1) return text;
  const e = text.indexOf(SB_END, s);
  if (e === -1) return text.slice(0, s).replace(/\n+$/, '') + '\n';
  let out = text.slice(0, s) + text.slice(e + SB_END.length);
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '') + (out.trim() ? '\n' : '');
}

ipcMain.handle('storybook-write-memory', (_, { url }) => {
  const dir = sessionCwd();
  const written = [];
  for (const name of MEMORY_FILES) {
    const fp = path.join(dir, name);
    try {
      let existing = '';
      try { existing = fs.readFileSync(fp, 'utf8'); } catch (_) {}
      const base = stripBlock(existing).replace(/\n+$/, '');
      const next = (base ? base + '\n\n' : '') + storybookBlock(url) + '\n';
      fs.writeFileSync(fp, next, 'utf8');
      written.push(name);
    } catch (e) {
      console.error('[storybook] memory write failed', name, e.message);
    }
  }
  return { ok: true, dir, written };
});

ipcMain.handle('storybook-clear-memory', () => {
  const dir = sessionCwd();
  for (const name of MEMORY_FILES) {
    const fp = path.join(dir, name);
    try {
      if (!fs.existsSync(fp)) continue;
      const existing = fs.readFileSync(fp, 'utf8');
      if (!existing.includes(SB_START)) continue;
      const stripped = stripBlock(existing);
      if (stripped.trim()) fs.writeFileSync(fp, stripped, 'utf8');
      else fs.unlinkSync(fp);  // only remove if the file is now empty (i.e. we created it)
    } catch (e) {
      console.error('[storybook] memory clear failed', name, e.message);
    }
  }
  return { ok: true, dir };
});

// Single source of truth: when any HTML modal is open, push EVERY native
// WebContentsView offscreen so the modal (which is HTML) is never occluded.
ipcMain.on('modal-overlay', (_, { open }) => {
  modalOpen = open;
  repositionAll();
});

ipcMain.on('right-panel-mode', (_, mode) => {
  rightPanelMode = mode;
  if (mode === 'figma' && !figmaView) createFigmaView();
  if (mode.startsWith('url:')) ensureCustomView(mode.slice(4));
  repositionAll();
});

ipcMain.on('destroy-custom-view', (_, url) => destroyCustomView(url));

function repositionBrowserView(overrideFraction) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!browserView || browserView.webContents.isDestroyed()) return;
  // While ghost-dragging a resize handle the view stays hidden (the renderer
  // shows a ghost frame); applied on drag-end.
  if (resizingDevice) { browserView.setBounds(OFFSCREEN_BOUNDS); return; }
  // browserEmpty → the project URL is blank; hide the view so the HTML empty
  // state in #browser-placeholder shows through.
  if (modalOpen || rightPanelMode !== 'project' || browserEmpty) {
    browserView.setBounds(OFFSCREEN_BOUNDS);
    uiSend('device-view-bounds', null);   // hide the resize handles
    return;
  }
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = overrideFraction ?? splitFraction;
  const availW  = winW - devToolsWidth;
  const leftW   = Math.round(availW * fraction);
  const rightX  = leftW + 6;
  const topOffset = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
  const panelW = availW - rightX, panelH = winH - topOffset;

  if (deviceEmulation) {
    // Device emulation: viewport centered horizontally, top-anchored (like
    // Chrome). DEVICE_HANDLE px of backdrop is reserved on each side (width)
    // and the bottom (height) for the drag handles. `fit` → fill the available
    // area (Responsive default); otherwise the device's fixed size, clamped.
    const maxW = Math.max(160, panelW - DEVICE_HANDLE * 2);
    const maxH = Math.max(160, panelH - DEVICE_HANDLE);
    const w = deviceEmulation.fit ? maxW : Math.min(deviceEmulation.width,  maxW);
    const h = deviceEmulation.fit ? maxH : Math.min(deviceEmulation.height, maxH);
    const x = rightX + Math.round((panelW - w) / 2);   // centered horizontally
    const y = topOffset;                               // top-anchored
    browserView.setBounds({ x, y, width: w, height: h });
    uiSend('device-view-bounds', { x, y, width: w, height: h, panelW, panelH, panelX: rightX, panelY: topOffset });
    return;
  }
  // No emulation → fill the panel, no handles
  browserView.setBounds({ x: rightX, y: topOffset, width: panelW, height: panelH });
  uiSend('device-view-bounds', null);
}

// ── Project folder ────────────────────────────────────────────────
// The directory sessions launch in (and where agent-memory files live).
// Empty/unset → the user's home, which makes the memory files *global*.
let currentProjectDir = '';
function homeDir() { return process.env.USERPROFILE || process.env.HOME || process.cwd(); }
function sessionCwd() { return currentProjectDir || homeDir(); }
ipcMain.on('set-project-dir', (_, { dir }) => { currentProjectDir = dir || ''; });

// ── Agent runtime environment (WSL vs Windows) ────────────────────
// Most tools (claude/aider/llm) run in WSL. But Gemini/Codex may be installed
// via *Windows* npm — running their `/mnt/c/.../npm` shim under WSL fails
// ("exec: node: not found"). Detect once per binary and run it where it
// actually lives: a real WSL install, else the Windows install via cmd.exe.
const DUAL_ENV_BINS = new Set(['gemini', 'codex']);
const _agentEnvCache = new Map();   // bin → 'wsl' | 'win' | null
async function resolveAgentEnv(bin) {
  if (_agentEnvCache.has(bin)) return _agentEnvCache.get(bin);
  let env = null;
  const wslPath = ((await wslExecFile(['bash', '-lic', `command -v ${bin} 2>/dev/null`], 6000)) || '').trim();
  if (wslPath && !wslPath.startsWith('/mnt/')) {
    env = 'wsl';                    // a real WSL install (not a /mnt/c interop shim)
  } else {
    const onWindows = await new Promise(res => {
      try { const p = spawn('where.exe', [bin], { stdio: 'ignore' }); p.on('close', c => res(c === 0)); p.on('error', () => res(false)); }
      catch (_) { res(false); }
    });
    env = onWindows ? 'win' : (wslPath ? 'wsl' : null);
  }
  _agentEnvCache.set(bin, env);
  return env;
}
function winVersion(bin) {
  return new Promise(res => {
    let out = '';
    try {
      const p = spawn('cmd.exe', ['/c', bin, '--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      p.stdout.on('data', d => out += d);
      p.on('close', () => res(out.trim().split('\n').filter(Boolean).pop() || ''));
      p.on('error', () => res(''));
      setTimeout(() => { try { p.kill(); } catch (_) {} res(out.trim()); }, 6000);
    } catch (_) { res(''); }
  });
}
// cmd.exe can't use a \\wsl.localhost UNC dir as cwd — fall back to the Windows home.
function winCwd() {
  const c = sessionCwd();
  return (c && !c.startsWith('\\\\')) ? c : homeDir();
}

// ── PTY sessions ──────────────────────────────────────────────────
async function spawnPty(id, command = 'claude') {
  ptyCommands[id] = command;
  try {
    const pty  = require('node-pty');
    const base = command.trim().split(/\s+/)[0].replace(/.*\//, '');
    const env  = DUAL_ENV_BINS.has(base) ? await resolveAgentEnv(base) : 'wsl';
    let proc;
    if (env === 'win') {
      // Windows-installed agent (e.g. Gemini/Codex via Windows npm) → run on Windows.
      proc = pty.spawn('cmd.exe', ['/c', command], {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: winCwd(), env: process.env,
      });
    } else {
      // Prepend pip/pipx user-install dir inside WSL so tools like aider are found
      const wrappedCmd = `export PATH="$HOME/.local/bin:$PATH"; ${command}`;
      proc = pty.spawn('wsl.exe', ['bash', '-lic', wrappedCmd], {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: sessionCwd(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    }
    proc.onData(data => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty-output', { id, data });
    });
    proc.onExit(() => {
      // Guard: a restart may have already replaced this id with a new proc —
      // a stale exit must not clobber the new entry (or print into its term).
      if (ptyProcesses[id] !== proc) return;
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('pty-output', { id, data: '\r\n\x1b[33m[Session ended]\x1b[0m\r\n' });
      delete ptyProcesses[id];
    });
    ptyProcesses[id] = proc;
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('pty-output', { id, data: `\r\n\x1b[31m[Error starting session: ${err.message}]\x1b[0m\r\n` });
  }
}

// ── IPC: terminal ─────────────────────────────────────────────────
ipcMain.on('pty-input',   (_, { id, data })       => { if (ptyProcesses[id]) ptyProcesses[id].write(data); });
ipcMain.on('pty-resize',  (_, { id, cols, rows })  => { if (ptyProcesses[id]) ptyProcesses[id].resize(cols, rows); });
ipcMain.on('pty-spawn',   (_, { id, command })     => spawnPty(id, command));
ipcMain.on('pty-kill',    (_, { id })              => {
  if (ptyProcesses[id]) { try { ptyProcesses[id].kill(); } catch (_) {} delete ptyProcesses[id]; }
});
ipcMain.on('pty-restart', (_, { id, command })     => {
  if (ptyProcesses[id]) { try { ptyProcesses[id].kill(); } catch (_) {} delete ptyProcesses[id]; }
  spawnPty(id, command || ptyCommands[id] || 'claude');
});
ipcMain.on('set-active-pty', (_, { id }) => { activePtyId = id; });

ipcMain.handle('check-model', (_, { command }) => {
  return new Promise(resolve => {
    try {
      const safe = command.replace(/[^a-zA-Z0-9\-_.]/g, '');
      const p = spawn('wsl.exe', ['bash', '-lic', `command -v ${safe} >/dev/null 2>&1`]);
      p.on('close', code => resolve(code === 0));
      p.on('error', () => resolve(false));
      setTimeout(() => { try { p.kill(); } catch (_) {} resolve(false); }, 4000);
    } catch (_) { resolve(false); }
  });
});

// ── Onboarding: detection + streaming install runner ──────────────
ipcMain.handle('check-wsl', () => new Promise(resolve => {
  try {
    const p = spawn('wsl.exe', ['-e', 'echo', 'cathode-ok']);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/cathode-ok/.test(out)));
    p.on('error', () => resolve(false));
    setTimeout(() => { try { p.kill(); } catch (_) {} resolve(false); }, 6000);
  } catch (_) { resolve(false); }
}));

ipcMain.handle('check-claude-auth', () => new Promise(resolve => {
  try {
    const p = spawn('wsl.exe', ['bash', '-lic', 'test -f ~/.claude/.credentials.json && echo yes']);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/yes/.test(out)));
    p.on('error', () => resolve(false));
    setTimeout(() => { try { p.kill(); } catch (_) {} resolve(false); }, 5000);
  } catch (_) { resolve(false); }
}));

let onboardingProc = null;
ipcMain.on('onboarding-run', (_, { id, command }) => {
  const send = uiSend;
  try { if (onboardingProc) onboardingProc.kill(); } catch (_) {}
  try {
    // Keep a local ref: the killed proc's async 'close' must not null out a
    // replacement that was assigned in the meantime (orphaning its kill handle).
    const proc = spawn('wsl.exe', ['bash', '-lic', command]);
    onboardingProc = proc;
    proc.stdout.on('data', d => send('onboarding-output', { id, data: d.toString() }));
    proc.stderr.on('data', d => send('onboarding-output', { id, data: d.toString() }));
    proc.on('close', code => {
      if (onboardingProc === proc) onboardingProc = null;
      send('onboarding-done', { id, code: code ?? 0 });
    });
    proc.on('error', e => {
      if (onboardingProc === proc) onboardingProc = null;
      send('onboarding-output', { id, data: `\n[error] ${e.message}\n` });
      send('onboarding-done', { id, code: 1 });
    });
  } catch (e) {
    send('onboarding-output', { id, data: `\n[error] ${e.message}\n` });
    send('onboarding-done', { id, code: 1 });
  }
});
ipcMain.on('onboarding-cancel', () => { try { if (onboardingProc) onboardingProc.kill(); } catch (_) {} onboardingProc = null; });

// ── Profile installer (streams output back to the modal) ──────────
ipcMain.on('profile-install', (_, { installId, command }) => {
  const send = uiSend;
  try {
    const proc = spawn('wsl.exe', ['bash', '-lc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => send('profile-install-progress', { installId, text: d.toString() }));
    proc.stderr.on('data', d => send('profile-install-progress', { installId, text: d.toString() }));
    proc.on('close', code => {
      if (code === 0) send('profile-install-done',  { installId });
      else            send('profile-install-error', { installId, code });
    });
    proc.on('error', err => send('profile-install-error', { installId, message: err.message }));
  } catch (err) {
    send('profile-install-error', { installId, message: err.message });
  }
});

// ── ACP sessions ──────────────────────────────────────────────────
let _acpMod = null;
async function requireAcp() {
  if (!_acpMod) _acpMod = await import('@agentclientprotocol/sdk');
  return _acpMod;
}

// The adapter is an IMPLICIT runtime dependency (installed to Windows npm
// global at runtime, not in package.json). Pin it here and verify the
// installed VERSION — a presence-only check let stale globals skew silently.
const ACP_ADAPTER_PKG     = '@agentclientprotocol/claude-agent-acp';
const ACP_ADAPTER_VERSION = '0.42.0';
let _acpAdapterVerified   = false;   // version confirmed once per app run

function acpAdapterInstalledVersion() {
  return new Promise(resolve => {
    let out = '';
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      // Run through `cmd.exe /c npm` — Node refuses to spawn a `.cmd` file
      // directly (throws EINVAL), so never spawn `npm.cmd` itself.
      const p = spawn('cmd.exe', ['/c', 'npm', 'ls', '-g', ACP_ADAPTER_PKG, '--json', '--depth=0'],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      p.stdout.on('data', d => out += d);
      p.on('close', () => {
        try { finish(JSON.parse(out).dependencies?.[ACP_ADAPTER_PKG]?.version || null); }
        catch (_) { finish(null); }
      });
      p.on('error', () => finish(null));
      setTimeout(() => { try { p.kill(); } catch (_) {} finish(null); }, 15000);
    } catch (_) { finish(null); }   // any spawn failure → treat as "not verified"
  });
}

const acpSessions      = new Map(); // id → { proc, conn, sessionId }
const acpTermResolvers = new Map(); // termId  → resolve

// ── Per-agent ACP launch ──────────────────────────────────────────
// The ACP client/protocol below is agent-agnostic; only *launching* the agent
// differs. Claude runs the Windows-side adapter (pointed at WSL's ~/.claude);
// Gemini/Codex speak ACP themselves and run inside WSL (bash -lic for the nvm
// PATH, like the PTY tools). Each launcher returns { proc, version, model }.
const ACP_LABELS = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex' };

async function ensureClaudeAdapter(id) {
  let needInstall = false;
  if (!_acpAdapterVerified) {
    const installed = await acpAdapterInstalledVersion();
    if (installed === ACP_ADAPTER_VERSION) _acpAdapterVerified = true;
    else needInstall = true;   // missing OR wrong version → (re)install pinned
  }
  if (!needInstall) return true;
  uiSend('acp-installing', { id });
  const ok = await new Promise(resolve => {
    // `cmd.exe /c npm` — never spawn `npm.cmd` directly (Node throws EINVAL).
    const inst = spawn('cmd.exe', ['/c', 'npm', 'install', '-g', `${ACP_ADAPTER_PKG}@${ACP_ADAPTER_VERSION}`],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    inst.stdout.on('data', d => uiSend('acp-install-progress', { id, text: d.toString() }));
    inst.stderr.on('data', d => uiSend('acp-install-progress', { id, text: d.toString() }));
    inst.on('close', code => resolve(code === 0));
    inst.on('error', () => resolve(false));
  });
  if (!ok) { uiSend('acp-error', { id, message: `Failed to install the adapter. Run: npm install -g ${ACP_ADAPTER_PKG}@${ACP_ADAPTER_VERSION}` }); return false; }
  _acpAdapterVerified = true;
  return true;
}

async function launchClaudeAcp(modelOverride) {
  // Point the adapter at WSL's ~/.claude (same OAuth credentials). Probes run
  // async + parallel — sync versions froze the UI for ~14s on every spawn.
  const [cfgOut, verOut, setOut] = await Promise.all([
    wslExecFile(['bash', '-lc', 'wslpath -w ~/.claude'], 5000),
    wslExecFile(['bash', '-lc', 'claude --version 2>/dev/null'], 6000),
    wslExecFile(['-e', 'sh', '-c', 'cat ~/.claude/settings.json 2>/dev/null'], 3000),
  ]);
  const wslClaudeConfigDir = (cfgOut || '').trim() || null;
  const version = (verOut || '').trim().replace(/^Claude\s+Code\s+/i, '').replace(/^v/i, '');
  let model = '';
  try { model = JSON.parse(setOut).model || ''; } catch (_) {}
  if (modelOverride) model = modelOverride;
  const proc = spawn('cmd.exe', ['/c', 'claude-agent-acp'], {
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ...(wslClaudeConfigDir ? { CLAUDE_CONFIG_DIR: wslClaudeConfigDir } : {}),
      ...(modelOverride ? { ANTHROPIC_MODEL: modelOverride } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { proc, version, model };
}

// Gemini/Codex speak ACP themselves. They run where they're installed — a real
// WSL install (bash -lic for the nvm PATH), or a Windows npm install via
// cmd.exe (the /mnt/c shim can't find node under WSL).
async function launchAcpAgent(bin, acpArgs, agentKey) {
  const env = await resolveAgentEnv(bin);
  if (!env) throw new Error(`${ACP_LABELS[agentKey] || agentKey} not found — install it (e.g. \`npm i -g\`).`);
  let proc, version = '';
  if (env === 'win') {
    version = await winVersion(bin);
    proc = spawn('cmd.exe', ['/c', bin, ...acpArgs], { stdio: ['pipe', 'pipe', 'pipe'], cwd: winCwd(), windowsHide: true });
  } else {
    version = ((await wslExecFile(['bash', '-lic', `${bin} --version 2>/dev/null`], 6000)) || '').trim().split('\n').filter(Boolean).pop() || '';
    proc = spawn('wsl.exe', ['bash', '-lic', `${bin} ${acpArgs.join(' ')}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: sessionCwd() });
  }
  return { proc, version, model: '' };
}

const ACP_LAUNCH = {
  claude: { ensure: ensureClaudeAdapter, launch: (m) => launchClaudeAcp(m) },
  gemini: { launch: () => launchAcpAgent('gemini', ['--experimental-acp'], 'gemini') },
  codex:  { launch: () => launchAcpAgent('codex', ['acp'], 'codex') },
};

async function spawnAcpSession(id, modelOverride = '', agentKey = 'claude') {
  const acp = await requireAcp();
  const { Readable, Writable } = require('stream');
  const cfg = ACP_LAUNCH[agentKey] || ACP_LAUNCH.claude;

  if (cfg.ensure && !(await cfg.ensure(id))) return;   // ensure() reports its own error

  let proc, acpVersion = '', acpModel = '';
  try {
    ({ proc, version: acpVersion, model: acpModel } = await cfg.launch(modelOverride));
  } catch (err) {
    uiSend('acp-error', { id, message: `Failed to start ${ACP_LABELS[agentKey] || agentKey}: ${(err && err.message) || err}` });
    return;
  }
  const acpCwd = sessionCwd();

  // Accumulate stderr so we can show it if the process dies early
  let stderrBuf = '';
  proc.stderr.on('data', d => { stderrBuf += d.toString(); console.error('[acp]', d.toString().trim()); });

  let connected = false;
  let errorSent = false;   // an error path already told the renderer — don't double-report
  proc.on('exit', (code, signal) => {
    if (connected || errorSent) return; // normal exit after use — already handled via conn.closed
    const detail = stderrBuf.trim().split('\n').slice(-3).join(' | ') || `exit ${code ?? signal}`;
    console.error('[acp] early exit:', detail);
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('acp-error', { id, message: `Adapter exited before connecting: ${detail}` });
  });

  proc.on('error', err => {
    console.error('[acp] proc error:', err);
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('acp-error', { id, message: err.message });
  });

  const send = uiSend;

  const client = {
    async requestPermission(params) {
      // Auto-approve: inform the renderer for display only, then immediately allow
      const allow = params.options?.find(o => o.kind === 'allow_once') || params.options?.[0];
      send('acp-tool-approved', { id, toolCall: params.toolCall });
      return { outcome: allow
        ? { outcome: 'selected', optionId: allow.optionId }
        : { outcome: 'cancelled' }
      };
    },
    async sessionUpdate(params) {
      send('acp-update', { id, update: params.update });
    },
    async createTerminal(params) {
      const termId = `t${Date.now()}`;
      send('acp-term-create', { id, termId, title: params.title });
      return { terminalId: termId };
    },
    async terminalOutput(params) {
      send('acp-term-output', { id, termId: params.terminalId, output: params.output });
    },
    async waitForTerminalExit(params) {
      return new Promise(resolve => acpTermResolvers.set(params.terminalId, resolve));
    },
    async releaseTerminal(params) {
      send('acp-term-release', { id, termId: params.terminalId });
      const r = acpTermResolvers.get(params.terminalId);
      if (r) { r({ exitCode: 0 }); acpTermResolvers.delete(params.terminalId); }
    },
    async killTerminal(params) {
      const r = acpTermResolvers.get(params.terminalId);
      if (r) { r({ exitCode: -1 }); acpTermResolvers.delete(params.terminalId); }
    },
    async readTextFile(params) {
      try { return { content: fs.readFileSync(params.path, 'utf8') }; }
      catch (_) { return { content: '' }; }
    },
    async writeTextFile(params) {
      try { fs.writeFileSync(params.path, params.content, 'utf8'); } catch (_) {}
      return {};
    },
  };

  const toAgent   = Writable.toWeb(proc.stdin);
  const fromAgent = Readable.toWeb(proc.stdout);
  const stream    = acp.ndJsonStream(toAgent, fromAgent);
  const conn      = new acp.ClientSideConnection(() => client, stream);

  const CONNECT_TIMEOUT = 120_000;
  const timeoutErr = new Error(`${ACP_LABELS[agentKey] || agentKey} did not respond within 120 s (is its ACP mode available?)`);
  const connectTimer = setTimeout(() => {
    console.error('[acp] connect timeout');
    errorSent = true;
    send('acp-error', { id, message: timeoutErr.message });
    try { proc.kill(); } catch (_) {}
  }, CONNECT_TIMEOUT);

  try {
    await conn.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    const { sessionId } = await conn.newSession({ cwd: sessionCwd(), mcpServers: [] });
    clearTimeout(connectTimer);
    connected = true;
    const entry = { proc, conn, sessionId };
    acpSessions.set(id, entry);
    send('acp-ready', { id, version: acpVersion, model: acpModel, cwd: acpCwd, agent: agentKey });
    conn.closed.then(() => {
      // Guard: a model-switch respawn reuses the id — a stale close from the
      // killed session must not delete the replacement (or report it closed).
      if (acpSessions.get(id) !== entry) return;
      acpSessions.delete(id);
      send('acp-closed', { id });
    });
  } catch (err) {
    clearTimeout(connectTimer);
    console.error('[acp] init error:', err);
    errorSent = true;
    send('acp-error', { id, message: err.message });
    try { proc.kill(); } catch (_) {}
  }
}

ipcMain.on('acp-spawn', (_, { id, model, agent }) => {
  spawnAcpSession(id, model || '', agent || 'claude').catch(err => {
    console.error('[acp] spawn error:', err);
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('acp-error', { id, message: err.message });
  });
});

ipcMain.on('acp-prompt', async (_, { id, text }) => {
  const s = acpSessions.get(id);
  if (!s) return;
  try {
    await s.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text }] });
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('acp-done', { id });
  } catch (err) {
    console.error('[acp] prompt error:', err);
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('acp-error', { id, message: err.message });
  }
});

ipcMain.on('acp-cancel', async (_, { id }) => {
  const s = acpSessions.get(id);
  if (!s) return;
  try { await s.conn.cancel({ sessionId: s.sessionId }); } catch (_) {}
});

ipcMain.on('acp-kill', (_, { id }) => {
  const s = acpSessions.get(id);
  if (!s) return;
  try { s.proc.kill(); } catch (_) {}
  acpSessions.delete(id);
});

// ── IPC: stream-json chat ─────────────────────────────────────────
let claudeChatProc    = null;
let claudeChatSession = null;   // session_id from last init event — used for --resume
let claudeChatBuf     = '';     // incomplete JSON line buffer

function spawnClaudeChat(text) {
  if (claudeChatProc) {
    try { claudeChatProc.kill(); } catch (_) {}
    claudeChatProc = null;
  }
  claudeChatBuf = '';

  // Write the message to a temp file so we don't need to shell-escape it.
  const msgFile = path.join(os.tmpdir(), 'cathode-claude-msg.txt');
  fs.writeFileSync(msgFile, text, 'utf8');
  // Convert Windows temp path to WSL path (e.g. C:\Users\... → /mnt/c/Users/...)
  const wslPath = msgFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);

  const sessionArg = claudeChatSession ? `--resume ${claudeChatSession}` : '';
  const cmd = `claude --output-format stream-json ${sessionArg} -p "$(cat '${wslPath}')"`;

  claudeChatProc = spawn('wsl.exe', ['bash', '-lic', cmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  claudeChatProc.stdout.on('data', (chunk) => {
    claudeChatBuf += chunk.toString('utf8');
    const lines = claudeChatBuf.split('\n');
    claudeChatBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
          claudeChatSession = event.session_id;
        }
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('claude-chat-event', event);
      } catch (_) { /* non-JSON startup lines (e.g. bash profile output) — ignore */ }
    }
  });

  claudeChatProc.stderr.on('data', () => {}); // suppress stderr noise

  claudeChatProc.on('exit', (code) => {
    claudeChatProc = null;
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('claude-chat-done', { code: code ?? 0 });
  });
}

ipcMain.on('claude-chat-send',   (_, { text }) => spawnClaudeChat(text));
ipcMain.on('claude-chat-cancel', () => {
  if (claudeChatProc) {
    try { claudeChatProc.kill(); } catch (_) {}
    claudeChatProc = null;
  }
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('claude-chat-done', { code: -1, cancelled: true });
});

// ── IPC: usage (parsed from Claude local transcripts) ─────────────
let _claudeConfigDirPromise = null;   // cached async resolution (was sync — blocked the UI)
function claudeConfigDir() {
  if (!_claudeConfigDirPromise) {
    _claudeConfigDirPromise = wslExecFile(['bash', '-lc', 'wslpath -w ~/.claude'], 5000)
      .then(out => (out || '').trim() || null);
  }
  return _claudeConfigDirPromise;
}
async function claudeProjectsDir() {
  const base = await claudeConfigDir();
  return base ? path.join(base, 'projects') : null;
}

// Pricing (USD per million tokens) — approximate current Anthropic rates
function usagePricing(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus'))  return { in: 15,  out: 75, cacheWrite: 18.75, cacheRead: 1.5  };
  if (m.includes('haiku')) return { in: 0.8, out: 4,  cacheWrite: 1,     cacheRead: 0.08 };
  return { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 };  // sonnet default
}
function usageWindow(_model) { return 200000; }

// Transcript usage is fully async + incrementally cached. These files live on
// \\wsl.localhost, where every sync FS call is a blocking network round-trip
// on the main thread — and a directory scan is hundreds of them. Transcripts
// only ever APPEND, so we remember the file, byte offset, and running totals,
// and each refresh reads just the new bytes.
const fsp = fs.promises;
const USAGE_RELOCATE_MS = 30000;   // rescan for a newer transcript at most this often
let _usageCache = null;            // { file, offset, tail, inT, outT, cc, cr, model, lastCtx }
let _usageLocatedAt = 0;

async function findTranscriptFile(cwdHint) {
  const dir = await claudeProjectsDir();
  if (!dir) return null;
  let subdirs;
  try {
    const names = await fsp.readdir(dir);
    const flags = await Promise.all(names.map(async n => {
      const p = path.join(dir, n);
      try { return (await fsp.stat(p)).isDirectory() ? p : null; } catch { return null; }
    }));
    subdirs = flags.filter(Boolean);
  } catch { return null; }

  // Prefer the directory matching the session's cwd, fall back to all dirs
  let pool = subdirs;
  if (cwdHint) {
    const enc = cwdHint.replace(/[^a-zA-Z0-9]/g, '-');
    const match = subdirs.find(p => path.basename(p) === enc);
    if (match) pool = [match];
  }

  const pick = async (dirs) => {
    let best = null;
    await Promise.all(dirs.map(async sd => {
      let files;
      try { files = await fsp.readdir(sd); } catch { return; }
      await Promise.all(files.filter(f => f.endsWith('.jsonl')).map(async f => {
        const fp = path.join(sd, f);
        try {
          const mt = (await fsp.stat(fp)).mtimeMs;
          if (!best || mt > best.mtime) best = { fp, mtime: mt };
        } catch {}
      }));
    }));
    return best;
  };

  let best = await pick(pool);
  if (!best && pool !== subdirs) best = await pick(subdirs);
  return best ? best.fp : null;
}

function accumulateUsageLine(c, line) {
  const t = line.trim();
  if (!t) return;
  let ev;
  try { ev = JSON.parse(t); } catch { return; }
  const msg = ev.message || ev;
  const u = msg && msg.usage;
  if (!u) return;
  if (msg.model) c.model = msg.model;
  c.inT  += u.input_tokens || 0;
  c.outT += u.output_tokens || 0;
  c.cc   += u.cache_creation_input_tokens || 0;
  c.cr   += u.cache_read_input_tokens || 0;
  const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (ctx > 0) c.lastCtx = ctx;  // most recent turn's input context ≈ current fill
}

async function computeUsage(file) {
  const st = await fsp.stat(file);
  // New/changed file (or it shrank — shouldn't happen, but be safe): reset.
  if (!_usageCache || _usageCache.file !== file || st.size < _usageCache.offset) {
    _usageCache = { file, offset: 0, tail: '', inT: 0, outT: 0, cc: 0, cr: 0, model: '', lastCtx: 0 };
  }
  const c = _usageCache;
  if (st.size > c.offset) {
    const fh = await fsp.open(file, 'r');
    try {
      const len = st.size - c.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, c.offset);
      c.offset = st.size;
      const lines = (c.tail + buf.toString('utf8')).split('\n');
      c.tail = lines.pop() ?? '';   // keep a partial trailing line for next read
      for (const line of lines) accumulateUsageLine(c, line);
    } finally {
      await fh.close();
    }
  }
  const p = usagePricing(c.model);
  const costUsd = (c.inT * p.in + c.outT * p.out + c.cc * p.cacheWrite + c.cr * p.cacheRead) / 1e6;
  return {
    model: c.model,
    contextTokens: c.lastCtx,
    contextWindow: usageWindow(c.model),
    inputTokens: c.inT, outputTokens: c.outT, cacheCreate: c.cc, cacheRead: c.cr,
    totalTokens: c.inT + c.outT + c.cc + c.cr,
    costUsd,
  };
}

ipcMain.handle('get-usage', async (_, { cwd } = {}) => {
  try {
    // Reuse the cached transcript path; rescan the projects tree at most every
    // USAGE_RELOCATE_MS (catches a new session's transcript appearing).
    let file = _usageCache ? _usageCache.file : null;
    const now = Date.now();
    if (!file || now - _usageLocatedAt > USAGE_RELOCATE_MS) {
      const located = await findTranscriptFile(cwd);
      _usageLocatedAt = now;
      if (located) file = located;
    }
    if (!file) return { ok: false, reason: 'no-transcript' };
    return { ok: true, ...(await computeUsage(file)) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// Read the Claude OAuth access token from WSL ~/.claude/.credentials.json
async function claudeOauthToken() {
  const base = await claudeConfigDir();
  if (!base) return null;
  try {
    const raw = fs.readFileSync(path.join(base, '.credentials.json'), 'utf8');
    return JSON.parse(raw).claudeAiOauth?.accessToken || null;
  } catch (_) { return null; }
}

function httpsGetJson(host, reqPath, headers) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: reqPath, method: 'GET', headers }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// Live subscription rate-limit usage — same data Claude Code's /usage shows
ipcMain.handle('get-rate-limits', async () => {
  const tok = await claudeOauthToken();
  if (!tok) return { ok: false, reason: 'no-token' };
  try {
    const { status, body } = await httpsGetJson('api.anthropic.com', '/api/oauth/usage', {
      'Authorization': 'Bearer ' + tok,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'User-Agent': 'claude-cli',
    });
    if (status === 401 || status === 403) return { ok: false, reason: 'auth' };
    if (status !== 200) return { ok: false, reason: `http-${status}` };
    const d = JSON.parse(body);
    if (!d || !d.five_hour) return { ok: false, reason: 'no-data' };
    return {
      ok: true,
      fiveHour: { utilization: d.five_hour.utilization, resetsAt: d.five_hour.resets_at },
      sevenDay: d.seven_day
        ? { utilization: d.seven_day.utilization, resetsAt: d.seven_day.resets_at }
        : null,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// ── IPC: browser ──────────────────────────────────────────────────
ipcMain.on('browser-navigate', (_, url) => {
  let target = (url || '').trim();
  // about:blank must not be scheme-prefixed into "https://about:blank"
  if (!target || target === 'about:blank') {
    browserView.webContents.loadURL('about:blank').catch(() => {});
    return;
  }
  if (!/^https?:\/\//i.test(target)) {
    const isLocal = /^localhost(:\d+)?(\/|$)|^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(target);
    target = (isLocal ? 'http://' : 'https://') + target;
  }
  browserView.webContents.loadURL(target).catch(() => {});
});
ipcMain.on('set-browser-empty', (_, empty) => {
  browserEmpty = !!empty;
  repositionBrowserView();
});
ipcMain.on('browser-reload', () => browserView.webContents.reloadIgnoringCache());
ipcMain.on('browser-toggle-devtools', () => {
  if (devToolsOpening) return;   // mid-open: closing now would race the async open path
  if (devToolsOpen || devToolsView) animateDevTools(false);
  else openDevToolsPanel();
});

// ── Device emulation dropdown (Chrome-style) ──────────────────────
// Native menu (not HTML) because it opens over the browserView, which always
// composites above HTML. Selecting a device sizes the view to that viewport.
// d: a named device {name,width,height} → fixed; null / {responsive} → Responsive
// (fit). `notify` sends device-changed so the renderer reflects/persists it.
// d: {default:true} → null (clean full-panel browser, no handles);
// null/{responsive}/nameless → Responsive (fit, with handles); named → device.
function setEmulation(d, notify = true) {
  if (d && d.default) deviceEmulation = null;
  else if (!d || d.responsive || !d.name) deviceEmulation = { name: '', fit: !(d && d.width), width: (d && d.width) || 0, height: (d && d.height) || 0 };
  else deviceEmulation = { name: d.name, fit: false, width: d.width, height: d.height };
  repositionBrowserView();
  if (notify) uiSend('device-changed', { name: deviceEmulation ? deviceEmulation.name : '', default: deviceEmulation === null });
}
ipcMain.on('show-device-menu', (_, { x, y, devices, activeName, defaultView }) => {
  const tpl = [{ label: 'Default view', type: 'checkbox', checked: !!defaultView, click: () => setEmulation({ default: true }) }];
  tpl.push({ type: 'separator' });
  tpl.push({ label: 'Responsive', type: 'checkbox', checked: !defaultView && !activeName, click: () => setEmulation({ responsive: true }) });
  for (const d of (devices || [])) {
    tpl.push({ label: d.name, type: 'checkbox', checked: d.name === activeName, click: () => setEmulation(d) });
  }
  tpl.push({ type: 'separator' });
  tpl.push({ label: 'Edit…', click: () => uiSend('settings-action', 'edit-devices') });
  // x is the renderer's right-aligned origin (button right edge − menu width).
  Menu.buildFromTemplate(tpl).popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
});
// Apply a persisted device on startup (renderer drives persistence, so no notify).
ipcMain.on('set-device', (_, d) => setEmulation(d || null, false));

// Resize-handle drag: hide the view while a ghost frame is dragged, then apply
// the dragged size as a custom (Responsive) viewport on release.
ipcMain.on('device-resize-start', () => { resizingDevice = true; repositionBrowserView(); });
ipcMain.on('device-resize-end', (_, { width, height }) => {
  resizingDevice = false;
  if (width > 0 && height > 0) deviceEmulation = { name: '', fit: false, width, height };
  repositionBrowserView();
});

// ── IPC: layout ───────────────────────────────────────────────────
ipcMain.on('split-changed', (_, fraction) => {
  splitFraction = fraction;
  repositionAll();
  broadcastLayout();
});
ipcMain.on('renderer-ready', () => { repositionBrowserView(); broadcastLayout(); });


// ── MCP catalog ───────────────────────────────────────────────────
// Each entry is one connectable MCP server. `stdio` → command+args (+ optional
// token env); `http` → url (+ optional auth header). Connecting drives each
// agent's own `mcp add` CLI, which writes to the correct place per agent.
const MCP_CATALOG = {
  'figma-framelink': {
    service: 'figma', serverName: 'figma', label: 'Figma — Framelink (token)',
    transport: 'stdio', command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'],
    envVar: 'FIGMA_API_KEY',
  },
  'figma-devmode': {
    service: 'figma', serverName: 'figma', label: 'Figma — Dev Mode (desktop app)',
    transport: 'http', url: 'http://127.0.0.1:3845/mcp', noToken: true,
  },
  'github': {
    service: 'github', serverName: 'github', label: 'GitHub',
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
    envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
  },
  'linear': {
    service: 'linear', serverName: 'linear', label: 'Linear',
    transport: 'stdio', command: 'npx', args: ['-y', 'linear-mcp-server'],
    envVar: 'LINEAR_API_KEY',
  },
  'browser': {
    service: 'browser', serverName: 'browser', label: 'Browser (Playwright)',
    transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'],
    noToken: true, staticEnv: { PLAYWRIGHT_MCP_NO_SANDBOX: '1' },
  },
};

// Agents exposing `<cli> mcp add/remove/list`. `sep` = needs `--` before the
// stdio command (Claude does, Gemini does not).
const MCP_AGENTS = [
  { key: 'claude', cli: 'claude', label: 'Claude Code', sep: true  },
  { key: 'gemini', cli: 'gemini', label: 'Gemini CLI',  sep: false },
  { key: 'codex',  cli: 'codex',  label: 'Codex CLI',   sep: false },
];

// WSL exec timeouts (ms). `mcp list` health-checks every configured server
// (network round-trips), hence the generous ceiling; `--help` probes are local.
const T_MCP_PROBE = 12000;
const T_MCP_ADD   = 25000;
const T_MCP_LIST  = 40000;

// Single-quote-escape for safe interpolation into `bash -lic '<cmd>'`
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// Async (non-blocking) — must NOT freeze the main thread: `claude mcp list`
// health-checks can take many seconds, during which the UI/native views would
// otherwise be frozen mid-repaint.
function wslRun(cmdString, timeout = 25000) {
  return new Promise(resolve => {
    execFile('wsl.exe', ['bash', '-lic', cmdString],
      { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, out: ((stdout || '') + (stderr || '')) || err.message });
        else resolve({ ok: true, out: stdout });
      });
  });
}

// Which agents are actually runnable (codex's Windows build crashes in WSL).
// TTL'd cache: an agent installed while the app runs is picked up within 5 min
// instead of requiring a full restart.
const MCP_AGENT_CACHE_TTL = 5 * 60 * 1000;
let _mcpAgentCache = null, _mcpAgentCacheAt = 0;
async function detectMcpAgents() {
  if (_mcpAgentCache && Date.now() - _mcpAgentCacheAt < MCP_AGENT_CACHE_TTL) return _mcpAgentCache;
  const checks = await Promise.all(MCP_AGENTS.map(a => wslRun(`${a.cli} mcp --help`, T_MCP_PROBE)));
  _mcpAgentCache = MCP_AGENTS.filter((_, i) => checks[i].ok);
  _mcpAgentCacheAt = Date.now();
  return _mcpAgentCache;
}

function buildMcpAddCmd(agent, entry, token) {
  const parts = [agent.cli, 'mcp', 'add', entry.serverName, '-s', 'user', '-t', entry.transport];
  if (entry.transport === 'stdio') {
    if (entry.envVar && token) parts.push('-e', `${entry.envVar}=${token}`);
    if (entry.staticEnv) for (const [k, v] of Object.entries(entry.staticEnv)) parts.push('-e', `${k}=${v}`);
    if (agent.sep) parts.push('--');
    parts.push(entry.command, ...(entry.args || []));
  } else {
    parts.push(entry.url);
    if (entry.authHeader && token) parts.push('-H', `${entry.authHeader}: ${token}`);
  }
  return parts.map(shq).join(' ');
}

ipcMain.handle('mcp-agents', async () => (await detectMcpAgents()).map(a => ({ key: a.key, label: a.label })));

ipcMain.handle('clipboard-read', () => { try { return clipboard.readText(); } catch (_) { return ''; } });

// Fast check (no health-check) whether a given MCP server is configured in any
// agent's user-scope config. Reads the config files directly.
ipcMain.handle('mcp-has-server', async (_, { name }) => {
  const r = await wslRun(
    'cat ~/.claude.json 2>/dev/null; echo "==SPLIT=="; cat ~/.gemini/settings.json 2>/dev/null; echo "==SPLIT=="; cat ~/.codex/config.toml 2>/dev/null',
    8000);
  const out = r.out || '';
  for (const chunk of out.split('==SPLIT==')) {
    try {
      const j = JSON.parse(chunk);
      if (j.mcpServers && j.mcpServers[name]) return { connected: true };
    } catch (_) { /* toml or non-json — fall through to text scan */ }
  }
  // Codex TOML: [mcp_servers.<name>]
  if (new RegExp(`\\[mcp_servers\\.${name}\\b`).test(out)) return { connected: true };
  return { connected: false };
});

function buildCustomEntry(c) {
  if (!c || !c.name || !c.npxPackage) return null;
  return {
    service: c.name, serverName: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom',
    label: c.name, transport: 'stdio', command: 'npx', args: ['-y', c.npxPackage],
    envVar: c.envVar || undefined, noToken: !c.envVar,
  };
}

// Connect: add the server to every installed agent at user scope
ipcMain.handle('mcp-connect', async (_, { catalogKey, token, custom }) => {
  const entry = catalogKey === 'custom' ? buildCustomEntry(custom) : MCP_CATALOG[catalogKey];
  if (!entry) return { ok: false, error: 'Unknown service' };
  const agents = await detectMcpAgents();
  if (!agents.length) return { ok: false, error: 'No supported agents (Claude/Gemini/Codex) found in WSL.' };

  const results = [];
  for (const agent of agents) {
    await wslRun(`${agent.cli} mcp remove ${shq(entry.serverName)} -s user`, T_MCP_PROBE);   // idempotent
    const r = await wslRun(buildMcpAddCmd(agent, entry, token), T_MCP_ADD);
    results.push({
      agent: agent.key, label: agent.label, ok: r.ok,
      detail: r.ok ? '' : r.out.trim().split('\n').filter(Boolean).slice(-1)[0] || 'failed',
    });
  }
  return { ok: results.some(r => r.ok), serverName: entry.serverName, service: entry.service, results };
});

// Disconnect: remove from every agent
ipcMain.handle('mcp-disconnect', async (_, { serverName }) => {
  for (const agent of await detectMcpAgents()) {
    await wslRun(`${agent.cli} mcp remove ${shq(serverName)} -s user`, T_MCP_PROBE);
  }
  return { ok: true };
});

// Status: parse `<cli> mcp list` per agent → { servers, agents }
ipcMain.handle('mcp-status', async () => {
  const agents = await detectMcpAgents();
  const SKIP = new Set(['Checking', 'Configured', 'No', 'Usage', 'Warning', 'User', 'Positionals', 'Options', 'Commands']);
  const servers = {};
  const lists = await Promise.all(agents.map(a => wslRun(`${a.cli} mcp list`, T_MCP_LIST)));
  for (let ai = 0; ai < agents.length; ai++) {
    const agent = agents[ai];
    const r = lists[ai];
    for (const line of r.out.split('\n')) {
      const m = line.match(/^[\s○●✔✗•\-]*([A-Za-z0-9._-]+):\s+/);
      if (!m || SKIP.has(m[1])) continue;
      const name = m[1];
      const status = /connected|✔/i.test(line) ? 'connected'
                   : /disabled/i.test(line)     ? 'disabled'
                   : 'configured';
      (servers[name] ||= { name, agents: {} }).agents[agent.key] = status;
    }
  }
  return { agents: agents.map(a => ({ key: a.key, label: a.label })), servers: Object.values(servers) };
});

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

// ── Code tab: project file browsing (read-only) ───────────────────
// currentProjectDir comes back from the folder dialog as a Windows path
// (UNC \\wsl.localhost\... for WSL folders, C:\... for Windows), so Node fs
// reads it directly — no WSL round-trip needed.
const CODE_HEAVY_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', '.svn', '.hg']);
const CODE_MAX_BYTES  = 2 * 1024 * 1024;

function codeSafeJoin(rel) {
  if (!currentProjectDir) return null;
  const root = path.resolve(currentProjectDir);
  const target = path.resolve(root, rel || '');
  if (target !== root && !target.startsWith(root + path.sep)) return null; // traversal guard
  return target;
}

ipcMain.handle('get-project-dir', () => currentProjectDir || '');

ipcMain.handle('pick-project-dir', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  const dir = (filePaths && filePaths[0]) || '';
  if (dir) currentProjectDir = dir;
  return dir;
});

// All async (fs.promises): the project dir is usually a \\wsl.localhost UNC
// path where each sync FS call blocks the main thread for a network
// round-trip — code-poll alone fired several of those every 1.2 s.
ipcMain.handle('code-list', async (_, { rel }) => {
  try {
    const dir = codeSafeJoin(rel);
    if (!dir) return { entries: [], error: currentProjectDir ? 'Invalid path' : 'No project folder' };
    const items = await fsp.readdir(dir, { withFileTypes: true });
    const entries = items
      .filter(d => d.name !== '.git')
      .map(d => {
        const isDir = d.isDirectory();
        return { name: d.name, type: isDir ? 'dir' : 'file', ignored: isDir && CODE_HEAVY_DIRS.has(d.name) };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return { entries };
  } catch (e) { return { entries: [], error: String(e.message || e) }; }
});

ipcMain.handle('code-read', async (_, { rel }) => {
  try {
    const file = codeSafeJoin(rel);
    if (!file) return { error: currentProjectDir ? 'Invalid path' : 'No project folder' };
    const st = await fsp.stat(file);
    if (!st.isFile()) return { error: 'Not a file' };
    if (st.size > CODE_MAX_BYTES) return { tooLarge: true };
    const buf = await fsp.readFile(file);
    if (buf.subarray(0, 8192).includes(0)) return { binary: true };  // crude NUL sniff
    return { content: buf.toString('utf8'), mtimeMs: st.mtimeMs };
  } catch (e) { return { error: String(e.message || e) }; }
});

// ── Changes / Diff tab: git working-tree diff ─────────────────────
// Run git where the project actually lives: WSL git for \\wsl.localhost\…
// UNC paths, Windows git (git -C) for C:\… paths.
function gitBase() {
  const dir = sessionCwd();
  const m = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i.exec(dir);
  if (m) return { bin: 'wsl.exe', prefix: ['-d', m[1], 'git', '-C', '/' + m[2].replace(/\\/g, '/')] };
  return { bin: 'git', prefix: ['-C', dir] };
}
function gitExec(args, { maxBuffer = 8 << 20 } = {}) {
  const { bin, prefix } = gitBase();
  return new Promise((resolve) => {
    execFile(bin, [...prefix, ...args], { windowsHide: true, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ failed: !!err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
function looksBinary(s) { return s.indexOf('\u0000') !== -1; }

ipcMain.handle('diff-status', async () => {
  if (!currentProjectDir) return { ok: false, reason: 'no-folder' };
  const inside = await gitExec(['rev-parse', '--is-inside-work-tree']);
  if (inside.failed) return { ok: false, reason: inside.code === 'ENOENT' ? 'no-git' : 'not-git' };
  const br = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = br.failed ? '' : br.stdout.trim();
  const st = await gitExec(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-uall']);
  if (st.failed) return { ok: false, reason: 'not-git' };

  const stats = {};
  const num = await gitExec(['diff', 'HEAD', '--numstat']);
  if (!num.failed) num.stdout.split('\n').forEach(l => {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) stats[m[3]] = { added: m[1] === '-' ? null : +m[1], deleted: m[2] === '-' ? null : +m[2] };
  });

  const files = [];
  st.stdout.split('\n').forEach(line => {
    if (!line.trim()) return;
    const xy = line.slice(0, 2);
    let p = line.slice(3);
    let status;
    if (xy === '??' || xy.includes('A')) status = 'added';
    else if (xy.includes('D')) status = 'deleted';
    else if (xy.includes('R')) { status = 'renamed'; const a = p.split(' -> '); p = a[a.length - 1]; }
    else status = 'modified';
    const s = stats[p] || {};
    files.push({ rel: p, status, added: s.added ?? null, deleted: s.deleted ?? null });
  });
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { ok: true, branch, files };
});

ipcMain.handle('diff-file', async (_, { rel, status }) => {
  let before = '', after = '';
  const gitPath = String(rel).replace(/\\/g, '/');
  if (status !== 'added') {
    const r = await gitExec(['show', 'HEAD:' + gitPath], { maxBuffer: 16 << 20 });
    if (!r.failed) before = r.stdout;
  }
  if (status !== 'deleted') {
    try { const f = codeSafeJoin(rel); if (f) after = await fsp.readFile(f, 'utf8'); } catch (_) {}
  }
  if (looksBinary(before) || looksBinary(after)) return { binary: true };
  return { before, after };
});

// Lightweight mtime probe for live-reload polling. Returns { rel: mtimeMs|null }.
// File content edits bump the file's mtime; entry add/delete/rename bumps the
// dir's. Stats run in parallel — over UNC each one is a network round-trip.
ipcMain.handle('code-poll', async (_, { paths }) => {
  const out = {};
  if (!currentProjectDir || !Array.isArray(paths)) return out;
  await Promise.all(paths.map(async rel => {
    try {
      const p = codeSafeJoin(rel);
      out[rel] = p ? (await fsp.stat(p)).mtimeMs : null;
    } catch (_) { out[rel] = null; }
  }));
  return out;
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

ipcMain.on('show-settings-menu', (_, pos) => {
  const { Menu } = require('electron');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Get Started (Setup & Tools)',
      click: () => mainWindow.webContents.send('settings-action', 'get-started'),
    },
    { type: 'separator' },
    {
      label: 'Authentication',
      click: () => mainWindow.webContents.send('settings-action', 'auth'),
    },
    {
      label: 'Manage LLMs',
      click: () => mainWindow.webContents.send('settings-action', 'manage-llms'),
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Minimal', click: () => mainWindow.webContents.send('settings-action', 'theme-minimal') },
        { label: 'Winamp',  click: () => mainWindow.webContents.send('settings-action', 'theme-winamp')  },
      ],
    },
    {
      label: 'Audit Prompts',
      click: () => mainWindow.webContents.send('settings-action', 'audit-prompts'),
    },
    {
      label: 'Edit Tabs',
      click: () => mainWindow.webContents.send('settings-action', 'edit-tabs'),
    },
    {
      label: 'MCP Tool Tokens',
      click: () => mainWindow.webContents.send('settings-action', 'mcp-tools'),
    },
    {
      label: 'Keyboard Shortcuts',
      click: () => mainWindow.webContents.send('settings-action', 'keyboard-shortcuts'),
    },
    {
      label: 'Renderer DevTools',
      click: () => mainWindow.webContents.openDevTools({ mode: 'detach' }),
    },
    { type: 'separator' },
    {
      label: 'New Window',
      click: () => mainWindow.webContents.send('settings-action', 'new-window'),
    },
  ]);
  menu.popup({ window: mainWindow, x: pos.x, y: pos.y });
});

ipcMain.on('show-tab-settings-menu', (_, { x, y, agent }) => {
  const memFile = (AGENT_MEMORY[agent] || {}).file || 'AGENTS.md';
  const tpl = [
    { label: `Edit ${memFile}`, click: () => uiSend('edit-agent-memory', agent || 'claude') },
  ];
  // The Authentication modal is Claude-OAuth-specific — only meaningful there.
  if (agent === 'claude') tpl.push({ label: 'Authentication', click: () => uiSend('settings-action', 'auth') });
  Menu.buildFromTemplate(tpl).popup({ window: mainWindow, x, y });
});

ipcMain.handle('auth-status-read', async () => {
  const raw = await wslExecFile(['-e', 'sh', '-c', 'cat ~/.claude/.credentials.json 2>/dev/null'], 5000);
  try { return JSON.parse(raw); } catch (_) { return null; }
});

// ── Per-agent memory file ─────────────────────────────────────────
// Each agent reads its own instructions file from its config dir; resolve the
// file + how to reach it (WSL for WSL-installed agents, Windows fs for Windows
// installs). Unknown agents fall back to the project's AGENTS.md.
const AGENT_MEMORY = {
  claude: { dir: '.claude', file: 'CLAUDE.md' },
  gemini: { dir: '.gemini', file: 'GEMINI.md' },
  codex:  { dir: '.codex',  file: 'AGENTS.md' },
};
async function agentMemoryTarget(agent) {
  const m = AGENT_MEMORY[agent];
  if (!m) return { mode: 'fs', path: path.join(sessionCwd(), 'AGENTS.md'), file: 'AGENTS.md' };
  const runEnv = agent === 'claude' ? 'wsl' : (await resolveAgentEnv(agent)) || 'wsl';
  if (runEnv === 'win') return { mode: 'fs', path: path.join(homeDir(), m.dir, m.file), file: m.file };
  return { mode: 'wsl', rel: `~/${m.dir}/${m.file}`, file: m.file };
}

ipcMain.handle('agent-md-read', async (_, { agent } = {}) => {
  try {
    const t = await agentMemoryTarget(agent);
    if (t.mode === 'fs') { try { return fs.readFileSync(t.path, 'utf8'); } catch (_) { return ''; } }
    return (await wslExecFile(['-e', 'sh', '-c', `cat ${t.rel} 2>/dev/null`], 5000)) || '';
  } catch (_) { return ''; }
});

ipcMain.handle('agent-md-write', async (_, { agent, content } = {}) => {
  try {
    const t = await agentMemoryTarget(agent);
    if (t.mode === 'fs') {
      fs.mkdirSync(path.dirname(t.path), { recursive: true });
      fs.writeFileSync(t.path, content ?? '', 'utf8');
      return true;
    }
    const dir = t.rel.replace(/\/[^/]+$/, '');
    return wslExecInput(['-e', 'sh', '-c', `mkdir -p ${dir} && cat > ${t.rel}`], content ?? '', 5000);
  } catch (_) { return false; }
});

ipcMain.on('show-tabs-context-menu', (_, pos) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Edit Tabs', click: () => mainWindow.webContents.send('settings-action', 'edit-tabs') },
  ]);
  menu.popup({ window: mainWindow, x: pos.x, y: pos.y });
});

ipcMain.on('new-window', () => {
  // Launch a separate app instance. An in-process BrowserWindow would share
  // the mainWindow-bound globals (browserView, ptyProcesses, IPC routing) and
  // its sessions/views would silently target the first window.
  const args = app.isPackaged ? [] : [path.resolve(__dirname)];
  try {
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', cwd: process.cwd() }).unref();
  } catch (e) {
    console.error('[new-window] failed to launch instance:', e.message);
  }
});

// ── Active right-panel WebContentsView ───────────────────────────
function getActivePickView() {
  if (rightPanelMode === 'figma'      && figmaView)      return figmaView;
  if (rightPanelMode === 'project'   && browserView)    return browserView;
  if (rightPanelMode === 'storybook' && storybookView)  return storybookView;
  if (rightPanelMode.startsWith('url:')) {
    const view = customViews.get(rightPanelMode.slice(4));
    if (view) return view;
  }
  return null;
}

// ── IPC: element picker ───────────────────────────────────────────
ipcMain.on('pick-start', async (_, mode) => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    // Phase 1: user draws selection
    const picked = await view.webContents.executeJavaScript(getPickerScript(mode));
    if (!picked) { uiSend('pick-cancelled'); return; }

    const { cx, cy, mouseUpX, mouseUpY, bounds, mode: pickedMode, wholePage } = picked;

    // Phase 2: element detection + popup in one script (shares live DOM refs for hover highlight)
    const result = await view.webContents.executeJavaScript(
      getCombinedScript({
        isClick: pickedMode === 'click',
        bounds, cx, cy,
        mouseUpX: mouseUpX ?? cx,
        mouseUpY: mouseUpY ?? cy,
        aiDevMode: mode === 'aidev',
        wholePage: wholePage === true,
      })
    );

    uiSend('pick-cancelled'); // clear active button state

    if (!result) return;
    const { items, instruction, extracts = [], media = null } = result;
    if (!instruction && items.length === 0 && extracts.length === 0 && !media) return;

    // Phase 3: CSS source refs via CDP (project view only — source maps only meaningful for local dev)
    let cssRefs = [];
    if (view === browserView) {
      await ensureCDP();
      cssRefs = await getCSSSourceRefs({ cx, cy }).catch(() => []);
    }

    // Phase 3b: media download (folder dialog + write), if requested
    let mediaSummary = null;
    if (media && media.dest === 'download' && media.assets.length) {
      mediaSummary = await downloadMediaAssets(media.assets, view.webContents.session);
    }

    // Phase 4: format source-first and write to PTY
    const pageUrl = (extracts.length > 0 || media) ? view.webContents.getURL() : null;
    const message = formatSourceMessage({ items, cssRefs, instruction, extracts, media, mediaSummary, pageUrl });
    uiSend('pick-send-to-session', message);

  } catch (err) {
    console.error('Pick error:', err);
    uiSend('pick-cancelled');
  }
});

// ── IPC: screenshot ───────────────────────────────────────────────
ipcMain.on('pick-screenshot', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    // Phase 1: user draws the capture region
    const sel = await view.webContents.executeJavaScript(getScreenshotScript());
    if (!sel) { uiSend('pick-cancelled'); return; }

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

    uiSend('pick-cancelled');

    if (!popupResult) return;
    const { instruction } = popupResult;

    // Phase 5: write to PTY — Claude Code can read the file
    const msg = `[Screenshot: ${filepath}]${instruction ? '\n\n' + instruction : ''}`;
    uiSend('pick-send-to-session', msg);
  } catch (err) {
    console.error('Screenshot error:', err);
    uiSend('pick-cancelled');
  }
});

// ── IPC: draw tool ────────────────────────────────────────────────
ipcMain.on('pick-draw', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    const result = await view.webContents.executeJavaScript(getDrawScript());
    uiSend('pick-cancelled');
    if (!result) return;

    const { canvasDataUrl, instructions } = result;
    const pageImage = await view.webContents.capturePage();
    const pageB64   = pageImage.toPNG().toString('base64');
    uiSend('draw-composite', { pageB64, canvasDataUrl, instructions });
  } catch (err) {
    console.error('Draw tool error:', err);
    uiSend('pick-cancelled');
  }
});

ipcMain.on('draw-cancel', () => {
  const view = getActivePickView();
  if (view) {
    view.webContents.executeJavaScript(`
      (function(){
        var el = document.getElementById('__cathode_draw_canvas__');
        if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()
    `).catch(() => {});
  }
});

ipcMain.on('pick-cancel', () => {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`
  ).catch(() => {});
});

ipcMain.on('draw-composite-done', (_, { compositeDataUrl, instructions }) => {
  const buf  = Buffer.from(compositeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const dir  = require('path').join(require('electron').app.getPath('userData'), 'screenshots');
  require('fs').mkdirSync(dir, { recursive: true });
  const file = require('path').join(dir, 'draw-' + Date.now() + '.png');
  require('fs').writeFileSync(file, buf);
  const msg  = '[Drawing: ' + file + ']' + (instructions ? '\n\n' + instructions : '');
  uiSend('pick-send-to-session', msg);
});

// ── IPC: element resize ───────────────────────────────────────────
ipcMain.on('pick-resize', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    const result = await view.webContents.executeJavaScript(getResizeScript());
    uiSend('pick-cancelled');
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

    uiSend('pick-send-to-session', lines.join('\n'));
  } catch (err) {
    console.error('Resize error:', err);
    uiSend('pick-cancelled');
  }
});

// ── IPC: eyedropper ───────────────────────────────────────────────
ipcMain.on('pick-eyedropper', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    // Snapshot the rendered viewport so the loupe can sample exact pixels.
    const image = await view.webContents.capturePage();
    const result = await view.webContents.executeJavaScript(getEyedropperScript(image.toDataURL()));
    uiSend('pick-cancelled');
    if (!result) return;

    const { selector, property, fromColor, toColor, changed, pickedColor, instruction } = result;
    let msg;
    if (changed) {
      const lines = [
        '───── Color Change Request ─────',
        'Selector: ' + selector,
        '  ' + property + ': ' + fromColor + '  →  ' + toColor,
      ];
      if (instruction) lines.push('', 'Additional instructions: ' + instruction);
      const what = property === 'box-shadow' ? "box-shadow's color" : property;
      lines.push('', "Update the CSS so this element's " + what + ' is ' + toColor + '.');
      msg = lines.join('\n');
    } else {
      const lines = [
        '───── Color ─────',
        'Picked ' + (pickedColor || fromColor) + ' — ' + property + ' on ' + selector + '.',
      ];
      if (instruction) lines.push('', instruction);
      msg = lines.join('\n');
    }
    uiSend('pick-send-to-session', msg);
  } catch (err) {
    console.error('Eyedropper error:', err);
    uiSend('pick-cancelled');
  }
});

// ── IPC: accessibility / contrast checker ─────────────────────────
ipcMain.on('pick-a11y', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    const result = await view.webContents.executeJavaScript(getA11yScript());
    uiSend('pick-cancelled');
    if (!result || !result.issues || !result.issues.length) return;

    const groups = {};
    for (const it of result.issues) (groups[it.category] = groups[it.category] || []).push(it);
    const lines = ['───── Accessibility Audit ─────', `${result.total} issue${result.total === 1 ? '' : 's'} to fix on ${result.url}`];
    for (const cat of Object.keys(groups)) {
      lines.push('', `${cat.toUpperCase()} (${groups[cat].length})`);
      for (const it of groups[cat]) {
        lines.push(`• ${it.selector}${it.detail ? ' — ' + it.detail : ''}`);
        if (it.toText) {
          const parts = [];
          if (it.toText !== it.fromText) parts.push(`text ${it.fromText} → ${it.toText}`);
          if (it.toBg   !== it.fromBg)   parts.push(`background ${it.fromBg} → ${it.toBg}`);
          if (parts.length) lines.push(`    suggested: ${parts.join(', ')}`);
        }
        if (it.instruction) lines.push(`    note: ${it.instruction}`);
      }
    }
    lines.push('', 'Fix these so the page meets WCAG AA (contrast ≥ 4.5:1 for normal text / 3:1 for large; every image, control, and link has an accessible name). Where suggested colors are given, apply them.');
    uiSend('pick-send-to-session', lines.join('\n'));
  } catch (err) {
    console.error('A11y check error:', err);
    uiSend('pick-cancelled');
  }
});

// ── Component picker window ───────────────────────────────────────
let pickerWindow = null;

ipcMain.on('open-component-picker', (_, { target, sbUrl }) => {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();

  const [wx, wy] = mainWindow.getPosition();
  const [ww, wh] = mainWindow.getSize();
  const pw = 760, ph = 600;   // narrow lasso-style popup on the left + preview flyout area on the right

  pickerWindow = new BrowserWindow({
    x: wx + Math.round((ww - pw) / 2),
    y: wy + Math.round((wh - ph) / 2),
    width: pw, height: ph,
    frame: false,
    transparent: true,
    resizable: false,
    parent: mainWindow,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  pickerWindow.loadFile(path.join(__dirname, 'src/component-picker.html'));

  pickerWindow.webContents.once('did-finish-load', () => {
    pickerWindow.webContents.send('picker-init', { target, sbUrl });
    pickerWindow.show();
  });

  pickerWindow.on('closed', () => {
    pickerWindow = null;
    clearCpHighlight();
    uiSend('pick-cancelled');
  });
});

// Hover the "Selected location" link → outline that element on the live page
function clearCpHighlight() {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript("(function(){var e=document.getElementById('__cathode_cp_hl__');if(e)e.remove();})()").catch(() => {});
}
ipcMain.on('cp-highlight-target', (_, { selector }) => {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed() || !selector) return;
  const js = `(function(){
    var el=document.querySelector(${JSON.stringify(selector)});
    var hl=document.getElementById('__cathode_cp_hl__');
    if(!el){ if(hl) hl.remove(); return; }
    var r=el.getBoundingClientRect();
    if(!hl){ hl=document.createElement('div'); hl.id='__cathode_cp_hl__';
      hl.style.cssText='position:fixed;pointer-events:none;z-index:${Z.ROW_HIGHLIGHT};border:2px solid #22d3ee;background:rgba(34,211,238,0.12);box-sizing:border-box;border-radius:2px;transition:all 60ms;';
      document.body.appendChild(hl); }
    hl.style.left=r.left+'px';hl.style.top=r.top+'px';hl.style.width=r.width+'px';hl.style.height=r.height+'px';hl.style.display='block';
  })();`;
  view.webContents.executeJavaScript(js).catch(() => {});
});
ipcMain.on('cp-clear-target-highlight', () => clearCpHighlight());

ipcMain.on('component-picker-result', (_, msg) => {
  uiSend('pick-send-to-session', msg);
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
});

ipcMain.on('component-picker-cancel', () => {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
});

// ── IPC: component picker ─────────────────────────────────────────
ipcMain.on('pick-component', async () => {
  const view = getActivePickView();
  if (!view) { uiSend('pick-cancelled'); return; }
  try {
    const result = await view.webContents.executeJavaScript(`
      (function() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:${Z.OVERLAY};cursor:${STORYBOOK_CURSOR_CSS};background:transparent;';
        document.body.appendChild(overlay);
        return new Promise(resolve => {
          function cleanup() { overlay.remove(); document.removeEventListener('keydown', onKey); }
          function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(null); } }
          document.addEventListener('keydown', onKey);
          overlay.addEventListener('click', e => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
            const el = document.elementFromPoint(e.clientX, e.clientY) || document.body;
            const rect = el.getBoundingClientRect();
            const classes = Array.from(el.classList).slice(0, 5);
            function getSelector(el) {
              if (el.id) return '#' + el.id;
              const parts = []; let cur = el;
              while (cur && cur !== document.body && parts.length < 4) {
                let part = cur.tagName.toLowerCase();
                if (cur.id) { parts.unshift('#' + cur.id); break; }
                const c = typeof cur.className === 'string' && cur.className.trim().split(/\\s+/)[0];
                if (c) part += '.' + c;
                parts.unshift(part);
                cur = cur.parentElement;
              }
              return parts.join(' > ');
            }
            resolve({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              classes,
              selector: getSelector(el),
              text: (el.textContent || '').trim().slice(0, 80),
              x: Math.round(e.clientX), y: Math.round(e.clientY),
              width: Math.round(rect.width), height: Math.round(rect.height),
            });
          });
        });
      })()`);
    uiSend('pick-cancelled');
    if (!result) return;
    uiSend('pick-component-result', result);
  } catch (err) {
    console.error('Component pick error:', err);
    uiSend('pick-cancelled');
  }
});

// ── Source-first message formatter ───────────────────────────────
// ── Media download (Extract tool) ─────────────────────────────────
// Bytes are fetched main-side via Electron net (no page CORS; carries the
// view's session cookies). inline SVG / data: / blob-b64 are written directly.
function netFetch(url, session) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = net.request({ url, session }); } catch (e) { return reject(e); }
    req.on('response', res => {
      if (res.statusCode >= 400) { req.abort(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > 60 * 1024 * 1024) { req.abort(); return reject(new Error('too large (>60MB)')); }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function sanitizeFilename(name) {
  let n = String(name || 'asset').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return n || 'asset';
}
function uniquePath(dir, name) {
  let fp = path.join(dir, name);
  if (!fs.existsSync(fp)) return fp;
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let i = 1; i < 1000; i++) { fp = path.join(dir, `${base}-${i}${ext}`); if (!fs.existsSync(fp)) return fp; }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function downloadMediaAssets(assets, session) {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to save the extracted media',
    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = filePaths && filePaths[0];
  if (!dir) return { cancelled: true };
  const written = [], failed = [];
  for (const a of assets) {
    const name = sanitizeFilename(a.name);
    try {
      let buf;
      if (a.inline)            buf = Buffer.from(a.inline, 'utf8');           // inline <svg>
      else if (a.b64)          buf = Buffer.from(a.b64, 'base64');           // resolved blob:
      else if (a.fetchError)   { failed.push(`${name} (${a.fetchError})`); continue; }
      else if (!a.url)         { failed.push(`${name} (no source)`); continue; }
      else if (a.url.startsWith('data:')) {
        const comma = a.url.indexOf(',');
        buf = /;base64/i.test(a.url.slice(0, comma)) ? Buffer.from(a.url.slice(comma + 1), 'base64')
                                                     : Buffer.from(decodeURIComponent(a.url.slice(comma + 1)), 'utf8');
      } else {
        buf = await netFetch(a.url, session);
      }
      const fp = uniquePath(dir, name);
      fs.writeFileSync(fp, buf);
      written.push(path.basename(fp));
    } catch (e) { failed.push(`${name} (${String(e.message || e)})`); }
  }
  return { dir, written, failed };
}

// Render one extractor's data as compact text for the agent message.
function renderExtract(key, data) {
  if (data == null) return '(no data)';
  if (typeof data === 'string') return data || '(empty)';
  if (data.error) return `(extraction failed: ${data.error})`;
  if (Array.isArray(data) && data.length === 0) return '(none found)';
  switch (key) {
    case 'styles':
      return data.map(e => `${e.selector} {\n` + Object.entries(e.props).map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}').join('\n\n');
    case 'palette':
      return data.map(c => `${c.hex}   ×${c.count}`).join('\n');
    case 'spacing':
      return data.map(s => `${s.value}   ×${s.count}`).join('\n');
    case 'typography':
      return data.map(t => `${t.size}/${t.lineHeight}  ${t.weight}  ${t.family}`
        + (t.letterSpacing && t.letterSpacing !== 'normal' ? `  ls:${t.letterSpacing}` : '')
        + (t.textTransform && t.textTransform !== 'none' ? `  ${t.textTransform}` : '')
        + `   ×${t.count}`).join('\n');
    case 'tokens':
      return data.map(t => `${t.name}: ${t.value}`).join('\n');
    case 'text':
      return data.map(t => `<${t.tag}> ${t.text}`).join('\n');
    default:
      try { return JSON.stringify(data, null, 2); } catch (_) { return String(data); }
  }
}

function formatSourceMessage({ items, cssRefs, instruction, extracts = [], media = null, mediaSummary = null, pageUrl = null }) {
  // ── Extract mode: the app already read the live page; hand the agent the
  // actual data / downloaded files (it should NOT re-fetch — this is the
  // current DOM).
  if (extracts.length > 0 || media) {
    const lines = [];
    lines.push('I used the Extract tool on the live page in the app. Everything below is the actual current DOM/styles/assets of what I selected — use it directly; do not re-open or re-fetch the page.');
    lines.push('');
    if (pageUrl) lines.push(`Page: ${pageUrl}`);
    if (items.length > 0) {
      const sel = items.map(it => it.reactComponent ? `${it.reactComponent} (${it.cssSelector || it.label})` : (it.cssSelector || it.label)).join(', ');
      lines.push(`Selection: ${sel}`);
    }

    for (const ex of extracts) {
      lines.push('');
      lines.push(`## ${ex.label}`);
      if (ex.analysis) lines.push(ex.analysis);
      lines.push('```');
      lines.push(renderExtract(ex.key, ex.data));
      lines.push('```');
    }

    if (media) {
      lines.push('');
      lines.push(`## Media (${media.types.join(', ')})`);
      if (media.dest === 'download') {
        if (mediaSummary?.cancelled) {
          lines.push('(download cancelled — no folder chosen)');
        } else if (mediaSummary) {
          if (mediaSummary.written.length)
            lines.push(`Downloaded ${mediaSummary.written.length} file(s) to ${mediaSummary.dir}:\n` + mediaSummary.written.map(f => `  • ${f}`).join('\n'));
          if (mediaSummary.failed && mediaSummary.failed.length)
            lines.push(`Could not download:\n` + mediaSummary.failed.map(f => `  • ${f}`).join('\n'));
          if (!mediaSummary.written.length && !(mediaSummary.failed || []).length)
            lines.push('(no media found in the selection)');
        }
      } else {
        // Send-to-chat: hand the agent the asset references to act on.
        if (!media.assets.length) lines.push('(no media found in the selection)');
        else lines.push('```\n' + media.assets.map(a => {
          if (a.kind === 'svg' && a.inline) return `[svg] inline${a.title ? ' "' + a.title + '"' : ''}${a.viewBox ? ' viewBox=' + a.viewBox : ''}`;
          const dims = a.w ? `  ${a.w}×${a.h}` : '';
          const flags = [a.broken ? 'BROKEN' : '', a.hasAlt === false ? 'no-alt' : '', a.loading === 'lazy' ? 'lazy' : ''].filter(Boolean).join(' ');
          return `[${a.kind}] ${a.url}${dims}${flags ? '  (' + flags + ')' : ''}`;
        }).join('\n') + '\n```');
      }
    }

    if (instruction) {
      lines.push('');
      lines.push('Additional instructions:');
      lines.push(instruction);
    }
    return lines.join('\n');
  }

  // ── Standard pick mode format ─────────────────────────────────────
  const lines = ['───── Element Context ─────'];

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
// With --force-device-scale-factor applied, screen.getPrimaryDisplay()
// reports the FORCED value — it can never detect that the user changed their
// real display scaling. Read the true scale from the Windows registry
// (AppliedDPI, e.g. 96=100%, 120=125%) to break that latch.
function readRealScale() {
  return new Promise(resolve => {
    execFile('reg.exe',
      ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
      { encoding: 'utf8', timeout: 3000 },
      (err, out) => {
        if (err) return resolve(null);
        const m = (out || '').match(/AppliedDPI\s+REG_DWORD\s+0x([0-9a-f]+)/i);
        resolve(m ? parseInt(m[1], 16) / 96 : null);
      });
  });
}

function relaunchWithScale(scale) {
  saveScale(scale);
  const args = process.argv.slice(1).filter(a => !a.startsWith('--force-device-scale-factor'));
  app.relaunch({ args });
  app.exit(0);
}

app.whenReady().then(async () => {
  loadSavedApiKey();
  const { screen } = require('electron');
  const currentScale = screen.getPrimaryDisplay().scaleFactor;

  if (savedScale > 1) {
    // Scale is forced — Electron only reports the forced value, so consult
    // the registry for the real one. null (no key / non-Windows) → keep as-is.
    const real = await readRealScale();
    if (real !== null && Math.abs(real - savedScale) > 0.01) {
      relaunchWithScale(real);
      return;
    }
  } else if (currentScale !== savedScale) {
    // No forcing active: Electron reports the real scale; persist and relaunch
    // so the flag is applied from process start.
    relaunchWithScale(currentScale);
    return;
  }

  createWindow();
  startSysPerf();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  Object.values(ptyProcesses).forEach(p => { try { p.kill(); } catch (_) {} });
  if (_gpuProc) { try { _gpuProc.kill(); } catch (_) {} }
  if (process.platform !== 'darwin') app.quit();
});
