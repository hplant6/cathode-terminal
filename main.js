const { app, BrowserWindow, WebContentsView, ipcMain, Menu, nativeImage, nativeTheme, dialog, safeStorage, clipboard, net, shell } = require('electron');
const { IPC } = require('./src/ipc-channels');
// Windows/Linux use custom HTML window chrome → no menu. macOS needs the standard
// app/edit/window menus or Cmd+Q/C/V/X/A/W and the like won't work at all.
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
} else {
  Menu.setApplicationMenu(null);
}
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
const { iconB64 } = require('./src/read-icon');

const STORYBOOK_CURSOR_B64 = iconB64(path.join(__dirname, 'src', 'icons', 'storybook-cursor.svg'));
const STORYBOOK_CURSOR_CSS = `url("data:image/svg+xml;base64,${STORYBOOK_CURSOR_B64}") 9 9, crosshair`;
const { execFile, spawn } = require('child_process');
// Platform abstraction layer: all WSL/cmd.exe/PowerShell/registry branching is
// behind this so main.js stays platform-agnostic (Windows uses WSL; macOS/Linux
// run agents/tools natively). See src/platform/index.js.
const platform = require('./src/platform');

// Async *nix exec helpers — sync variants freeze the main thread (and every
// native-view repaint) for seconds; anything UI-adjacent must use these.
// (Thin wrappers over the platform adapter so existing call sites are unchanged.)
function wslExecFile(args, timeout = 6000) { return platform.nixExecFile(args, timeout); }
function wslExecInput(args, input, timeout = 5000) { return platform.nixExecInput(args, input, timeout); }

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
  } catch (e) { logErr('save scale', e); }
}

const savedScale = readSavedScale();
if (savedScale > 1) app.commandLine.appendSwitch('force-device-scale-factor', String(savedScale));

// The Chrome DevTools Protocol powers the in-app DevTools panel, but it's also a
// standing RCE + secret-exfil channel: any local process can Runtime.evaluate
// against the node-integrated main window (process.env, child_process). Only open
// it in dev builds (or with an explicit opt-in); never ship it in a packaged app.
const DEVTOOLS_PORT = 19222;
const REMOTE_DEBUG = !app.isPackaged || process.env.CATHODE_REMOTE_DEBUG === '1';
if (REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', String(DEVTOOLS_PORT));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${DEVTOOLS_PORT}`);
}

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
  try { fs.writeFileSync(getStateFile(), JSON.stringify({ url })); } catch (e) { logErr('save last url', e); }
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
const TABBAR_HEIGHT     = 46;   /* browser chrome bar height (matches #tab-bar in styles.css) */
const SB_BAR_HEIGHT     = 46;   /* Storybook instance bar height (matches #sb-bar in styles.css) */
const POPUP_BAR_HEIGHT  = 36;

// Safe send to the main renderer — async handlers can outlive the window.
function uiSend(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// Most failures here are deliberately best-effort. Route the ones worth
// diagnosing (data-losing file writes) through this so they're visible in the
// console instead of vanishing — without changing the best-effort behavior.
function logErr(label, e) { console.error('[cathode] ' + label + ':', (e && e.message) || e); }

// Commands we run on the user's behalf (onboarding step / profile install) are
// intentionally the user's own — but they arrive over IPC and go straight to a
// shell, so reject the things that are only ever abuse: empty, absurdly long, or
// containing NUL / newlines (a single setup command is one line; a newline is the
// hallmark of an injected multi-command payload).
function validRunCommand(c) {
  return typeof c === 'string' && c.trim().length > 0 && c.length <= 4096 && !/[\x00\r\n]/.test(c);
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
// Single-pane (collapsed) mode: null = normal split; 'browser' = browser fills
// the main area beside the left strip; 'chat' = chat fills it, browser hidden.
let singlePane = null;
const STRIP_W = 50;   // single-pane left strip width (must match the CSS divider width)
// ── Shortcut handler ─────────────────────────────────────────────
// Attach before-input-event to any WebContentsView webContents so
// shortcuts work no matter which panel currently holds keyboard focus.
// tabOnly = true  → only tab-switching (safe for utility/popup views)
// Tool shortcuts are Alt+<letter> so they can never collide with typing
// (in the composer or inside the browsed page) — no focus tracking needed.
const TOOL_KEYS = new Set(require('./src/tools').TOOLS.map(t => t.key));

// Toolbar tools mirrored into the browser context menu. The renderer registers
// them (label, accelerator, key, rasterized icon) once the toolbar is built.
let browserTools = [];
ipcMain.on(IPC.REGISTER_BROWSER_TOOLS, (_, tools) => { browserTools = Array.isArray(tools) ? tools : []; });
function attachShortcutHandler(wc, { tabOnly = false } = {}) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const ctrl = input.control || input.meta;

    // Ctrl/Cmd+Shift+←/→ — tab switching (all views)
    if (ctrl && input.shift && !input.alt) {
      if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
        event.preventDefault();
        mainWindow.webContents.send(IPC.SHORTCUT_ACTION, {
          type: 'tab-switch',
          dir: input.key === 'ArrowLeft' ? -1 : 1,
        });
        return;
      }
    }

    // Escape — cancel active tool (all views)
    if (!ctrl && !input.shift && !input.alt && input.key === 'Escape') {
      mainWindow.webContents.send(IPC.SHORTCUT_ACTION, { type: 'escape' });
      return;
    }

    // Ctrl/Cmd+\ — toggle terminal/browser divider
    if (ctrl && !input.shift && !input.alt && input.key === '\\') {
      event.preventDefault();
      mainWindow.webContents.send(IPC.SHORTCUT_ACTION, { type: 'panel-toggle' });
      return;
    }

    if (tabOnly) return;

    // Alt+<letter> — activate a tool. Uses input.code (physical key) so it's
    // robust across keyboard layouts / OS Alt-char behavior.
    if (input.alt && !ctrl && !input.shift && /^Key[A-Z]$/.test(input.code || '')) {
      const key = input.code.slice(3).toLowerCase();
      if (TOOL_KEYS.has(key)) {
        event.preventDefault();
        mainWindow.webContents.send(IPC.SHORTCUT_ACTION, { type: 'tool', key });
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
  uiSend(IPC.CONSOLE_ENTRY, entry);
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
ipcMain.handle(IPC.CONSOLE_GET, () => consoleLog);
ipcMain.on(IPC.CONSOLE_CLEAR, () => { consoleLog = []; });

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

let _sysPerfTimer = null;
function startSysPerf() {
  if (_sysPerfTimer) return;
  platform.startGpuSampler();
  _sysPerfTimer = setInterval(() => {
    uiSend(IPC.SYSPERF, { cpu: cpuPercent(), ram: ramPercent(), gpu: platform.gpuPercent() });
  }, 2000);
}
function stopSysPerf() {
  if (!_sysPerfTimer) return;
  clearInterval(_sysPerfTimer);
  _sysPerfTimer = null;
  platform.stopGpuSampler();
}
// Renderer drives this by the sysperf panel's visibility — no point sampling
// CPU/RAM/GPU every 2 s (and rebuilding the bars) while the panel is closed.
ipcMain.on(IPC.SYSPERF_ACTIVE, (_, on) => { on ? startSysPerf() : stopSysPerf(); });

// Top processes by memory or CPU, grouped by name and summed so multi-process
// apps (Chrome, Code…) read as one entry — like Task Manager. On-demand (the
// renderer polls only while a process-breakdown view is open).
//   by='cpu' → instantaneous % from perf counters, normalized by logical cores.
//   else     → working-set bytes via Get-Process.
ipcMain.handle(IPC.TOP_PROCS, (_, by) => platform.topProcs(by));

// ── Window setup ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, 'icon.png'),   // window/taskbar icon (dev + packaged)
    titleBarStyle: 'hidden',   // Windows: custom HTML controls (#window-controls); macOS: native traffic lights show through
    // macOS keeps the native traffic lights with titleBarStyle:'hidden' — inset them into the 46px app-bar.
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 18 } } : {}),
    // nodeIntegration required: renderer uses ipcRenderer and node-pty directly
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // The main window runs with nodeIntegration — never let it navigate to, or open,
  // remote content (that would run with full Node access). Keep it on the local
  // app; route any external link to the OS browser instead.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url).catch(() => {}); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Keep the custom maximize/restore icon in sync with the real window state.
  const sendMaxState = () => uiSend(IPC.WINDOW_MAXIMIZED_STATE, mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  browserView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.contentView.addChildView(browserView);
  // Square the native browser view so its top edge meets the tab bar without a corner
  // notch. (setBorderRadius is uniform, so a square view reads as full-bleed in every view.)
  // Guarded so an older build just stays square instead of throwing.
  if (typeof browserView.setBorderRadius === 'function') browserView.setBorderRadius(0);
  attachConsoleCapture();
  browserView.webContents.loadURL(loadLastURL()).catch(() => {});
  // Style the Working File page's scrollbar to match the app — shade 7 track + arrow buttons, shade 3 thumb (the grab handle)
  const WF_SCROLLBAR_CSS = [
    '::-webkit-scrollbar { width: 16px; height: 16px; }',
    '::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: #08090C; }',
    '::-webkit-scrollbar-thumb { background: #28262F; }',
    "::-webkit-scrollbar-button:single-button { background: #08090C; display: block; height: 16px; width: 16px; background-repeat: no-repeat; background-position: center; background-size: 8px; }",
    "::-webkit-scrollbar-button:single-button:vertical:decrement { background-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23212026' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,8 6,5 9,8'/></svg>\"); }",
    "::-webkit-scrollbar-button:single-button:vertical:increment { background-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23212026' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,5 6,8 9,5'/></svg>\"); }",
    "::-webkit-scrollbar-button:single-button:horizontal:decrement { background-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23212026' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='8,3 5,6 8,9'/></svg>\"); }",
    "::-webkit-scrollbar-button:single-button:horizontal:increment { background-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23212026' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='5,3 8,6 5,9'/></svg>\"); }",
  ].join('\n');
  browserView.webContents.on('did-finish-load', () => { browserView.webContents.insertCSS(WF_SCROLLBAR_CSS).catch(() => {}); });

  browserView.webContents.on('did-navigate', (_, url) => {
    resetCDP();
    saveLastURL(url);
    mainWindow.webContents.send(IPC.BROWSER_URL_CHANGED, url);
    // Reconnect embedded DevTools after full navigation (WebSocket target URL may change)
    if (devToolsView) {
      browserView.webContents.once('did-finish-load', () => reconnectDevTools());
    }
  });
  browserView.webContents.on('did-navigate-in-page', (_, url) => {
    saveLastURL(url);
    mainWindow.webContents.send(IPC.BROWSER_URL_CHANGED, url);
  });
  browserView.webContents.on('page-title-updated', (_, title) => {
    mainWindow.webContents.send(IPC.TAB_TITLE_UPDATED, title);
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
          click: () => mainWindow.webContents.send(IPC.SHORTCUT_ACTION, { type: 'tool', key: t.key }),
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
  const rightX    = Math.round(availW * splitFraction) + 10;
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
// Registrable domain for the auth-popup "returned home" heuristic. Keeps three
// labels for common two-level public suffixes (co.uk, com.au…) so unrelated
// *.co.uk sites aren't collapsed to the same root. Not PSL-complete — an unknown
// suffix just degrades to the old two-label behavior.
const TWO_LEVEL_TLDS = new Set(['co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','co.jp','co.nz','co.za','com.br','co.in']);
function rootDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
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
  // Node-integrated → never let it navigate away from or open windows beyond its bundled file.
  popupBarView.webContents.on('will-navigate', (e, navUrl) => { if (!navUrl.startsWith('file://')) e.preventDefault(); });
  popupBarView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: POPUP_BAR_HEIGHT });
  popupBarView.webContents.loadFile(path.join(__dirname, 'src', 'popup-bar.html'));
  popupBarView.webContents.once('did-finish-load', () => {
    popupBarView.webContents.send(IPC.POPUP_URL, url);
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
      popupBarView.webContents.send(IPC.POPUP_URL, u);
    }
    // Detect auth completion: popup landed back on the same root domain as the main browser.
    // Promote it — load in the main browser and close the popup.
    try {
      const popupRoot = rootDomain(new URL(u).hostname);
      if (mainRoot && popupRoot === mainRoot) {
        browserView.webContents.loadURL(u).catch(() => {});
        mainWindow.webContents.send(IPC.BROWSER_URL_CHANGED, u);
        closeInlinePopup();
      }
    } catch (_) {}
  });
  mainWindow.contentView.addChildView(popupContentView);
}

// Free a WebContentsView's underlying webContents. removeChildView only detaches
// it from the layout tree — without this the renderer process (plus its timers,
// listeners, and network) leaks until unreliable GC. close() destroys it
// immediately (no beforeunload wait by default, so an arbitrary custom-URL page
// can't block teardown). Guarded so a bad/absent state can't throw.
function freeView(view) {
  try { const wc = view && view.webContents; if (wc && !wc.isDestroyed()) wc.close(); } catch (_) {}
}

function closeInlinePopup(removeBackdrop = true) {
  if (popupBarView)     { mainWindow.contentView.removeChildView(popupBarView);     freeView(popupBarView);     popupBarView = null; }
  if (popupContentView) { mainWindow.contentView.removeChildView(popupContentView); freeView(popupContentView); popupContentView = null; }
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

ipcMain.on(IPC.CLOSE_INLINE_POPUP, () => closeInlinePopup());

// ── Right panel views (Figma, Storybook, custom URL) ─────────────
// A panel WebContentsView (Figma / Storybook / custom URL): isolated context,
// our shortcut handler, navigated to url. Caller positions it via repositionRightPanelView().
function createPanelView(url) {
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  mainWindow.contentView.addChildView(view);
  // Rounded container, matching the browser view (Figma / Storybook / URL pop-outs).
  if (typeof view.setBorderRadius === 'function') view.setBorderRadius(22);
  attachShortcutHandler(view.webContents);
  view.webContents.loadURL(url).catch(() => {});
  return view;
}

function ensureCustomView(url) {
  if (customViews.has(url)) return customViews.get(url);
  const view = createPanelView(url);
  customViews.set(url, view);
  return view;
}

function destroyCustomView(url) {
  const view = customViews.get(url);
  if (!view) return;
  try { mainWindow.contentView.removeChildView(view); freeView(view); } catch (_) {}
  customViews.delete(url);
}

function repositionRightPanelView() {
  if (!mainWindow) return;
  const offscreen = OFFSCREEN_BOUNDS;
  if (modalOpen || singlePane === 'chat') {   // chat fills the main area → hide every right-panel view
    if (figmaView)    figmaView.setBounds(offscreen);
    if (storybookView) storybookView.setBounds(offscreen);
    for (const view of customViews.values()) view.setBounds(offscreen);
    return;
  }
  const [winW, winH] = mainWindow.getContentSize();
  const availW = winW - devToolsWidth;
  // collapsed (single-pane) → the active view fills from the left strip; otherwise the split position
  const rightX = singlePane === 'browser' ? (STRIP_W + 1) : (Math.round(availW * splitFraction) + 11);
  const PAD = 8;   // rounded-container inset (top/right/bottom; left flush) — matches the browser view
  const onBounds = { x: rightX, y: TOOLBAR_HEIGHT + PAD, width: (availW - rightX) - PAD, height: (winH - TOOLBAR_HEIGHT) - PAD * 2 };
  if (figmaView)     figmaView.setBounds(rightPanelMode === 'figma'         ? onBounds : offscreen);
  // Storybook reserves a top strip for the instance bar (#sb-bar) when a Storybook is active.
  const sbY = TOOLBAR_HEIGHT + (activeSbId ? SB_BAR_HEIGHT : 0);
  const sbBounds = { x: rightX, y: sbY, width: (availW - rightX) - PAD, height: (winH - sbY) - PAD };   /* top connects to the sb-bar; 8px right/bottom */
  const sbVisible = rightPanelMode === 'storybook' && activeSbId && !sbSetupOpen;   // setup overlay suppresses the view
  if (storybookView) storybookView.setBounds(sbVisible ? sbBounds : offscreen);
  for (const [url, view] of customViews) view.setBounds(rightPanelMode === 'url:' + url ? onBounds : offscreen);
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
  mainWindow.webContents.send(IPC.DEVTOOLS_LAYOUT, { leftPanelWidth: leftW, devToolsWidth });
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
        freeView(devToolsView);
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
      if (devToolsView) { mainWindow.contentView.removeChildView(devToolsView); freeView(devToolsView); devToolsView = null; }
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
    if (devToolsView) { mainWindow.contentView.removeChildView(devToolsView); freeView(devToolsView); devToolsView = null; }
  } finally {
    devToolsOpening = false;
  }
}

function createFigmaView() {
  figmaView = createPanelView('https://www.figma.com');
  repositionRightPanelView();
}

function createStorybookView(url) {
  if (storybookView && !storybookView.webContents.isDestroyed()) {
    storybookView.webContents.loadURL(url).catch(() => {});
    repositionRightPanelView();
    return;
  }
  storybookView = createPanelView(url);
  // Storybook connects to the sb-bar at the top, so square its corners (setBorderRadius
  // is all-or-nothing — can't round just the bottom). createPanelView set it to 22.
  if (typeof storybookView.setBorderRadius === 'function') storybookView.setBorderRadius(0);
  repositionRightPanelView();
}

function destroyStorybookView() {
  if (!storybookView) return;
  try { mainWindow.contentView.removeChildView(storybookView); freeView(storybookView); } catch (_) {}
  storybookView = null;
  repositionRightPanelView();
}

ipcMain.on(IPC.STORYBOOK_LOAD_URL, (_, url) => {
  createStorybookView(url);
});

ipcMain.on(IPC.STORYBOOK_DISCONNECT, () => {
  destroyStorybookView();
});

// ── Managed Storybook dev server ──────────────────────────────────
// Spawn `storybook dev` for a project dir (or the bundled demo), poll until it
// answers, then hand the live URL to the existing storybookView + component
// picker. The child is detached (its own process group) so the whole build
// tree can be torn down on stop / quit.
// Multiple managed/adopted Storybooks live in a registry; one WebContentsView
// shows the active one. The bar (renderer) renders from `storybook-instances`.
const sbServers = new Map();   // id → { id, proc, port, url, dir, label, status, log, managed }
let activeSbId = null, sbSeq = 0, sbSetupOpen = false;

function sbLabel(dir) { return !dir ? '' : (dir === SB_DEMO_DIR ? 'Demo' : (path.basename(dir.replace(/[\\/]+$/, '')) || 'Storybook')); }
function sbSerialize() {
  return [...sbServers.values()].map(s => ({ id: s.id, port: s.port, url: s.url, label: s.label, status: s.status, managed: s.managed, active: s.id === activeSbId }));
}
function emitInstances() { uiSend(IPC.STORYBOOK_INSTANCES, { instances: sbSerialize(), activeId: activeSbId }); }
function setActiveStorybook(id) {
  const inst = sbServers.get(id);
  if (!inst) return;
  activeSbId = id;
  createStorybookView(inst.url);   // single view, (re)loads the active instance
  emitInstances();
}
function pickActiveOrHide() {
  const next = [...sbServers.values()].find(s => s.status === 'ready');
  if (next) setActiveStorybook(next.id);
  else { destroyStorybookView(); activeSbId = null; emitInstances(); }
}

const nodeNet = require('net');   // Node's net (Electron's `net` above is the Chromium client)
const SB_DEMO_DIR = app.isPackaged ? path.join(process.resourcesPath, 'storybook-demo') : path.join(__dirname, 'storybook-demo');
function sbStateFile() { return path.join(app.getPath('userData'), 'storybook-server.json'); }
function tailLines(s, n) { return (s || '').split('\n').filter(Boolean).slice(-n).join('\n'); }

// Find a free TCP port from `start` upward, so a busy 6006 doesn't block us.
function findFreePort(start, tries = 30) {
  return new Promise((resolve) => {
    let port = start, n = 0;
    const tryPort = () => {
      const srv = nodeNet.createServer();
      srv.once('error', () => { try { srv.close(); } catch (_) {} if (++n >= tries) return resolve(start); port++; tryPort(); });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

// Persist the managed PID so a crashed run can be reaped next launch — guarded by
// the owning app's PID, so another *live* instance's server is never touched.
function writeSbState() {
  const managed = [...sbServers.values()].filter(s => s.managed && s.proc).map(s => ({ sbPid: s.proc.pid, port: s.port }));
  try { managed.length ? fs.writeFileSync(sbStateFile(), JSON.stringify({ appPid: process.pid, managed }), 'utf8') : clearSbState(); } catch (_) {}
}
function clearSbState() { try { fs.unlinkSync(sbStateFile()); } catch (_) {} }
function reapOrphanStorybook() {
  let st; try { st = JSON.parse(fs.readFileSync(sbStateFile(), 'utf8')); } catch (_) { return; }
  if (!st || !Array.isArray(st.managed)) return clearSbState();
  let appAlive = false; try { process.kill(st.appPid, 0); appAlive = true; } catch (_) {}
  if (appAlive) return;   // another running instance still owns them — leave them alone
  for (const m of st.managed) { try { process.kill(-m.sbPid, 'SIGTERM'); } catch (_) { try { process.kill(m.sbPid, 'SIGTERM'); } catch (_) {} } }
  clearSbState();
}

function sbStatus(state, extra = {}) { uiSend(IPC.STORYBOOK_SERVER_STATUS, { state, ...extra }); }

function pollInstanceReady(inst, tries = 150) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (!sbServers.has(inst.id)) return resolve(false);   // stopped while waiting
      const req = http.get(inst.url + '/iframe.html', (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
      function retry() { if (++n >= tries) return resolve(false); setTimeout(tick, 1000); }
    };
    tick();
  });
}

function stopInstance(id) {
  const inst = sbServers.get(id);
  if (!inst) return;
  sbServers.delete(id);
  if (inst.managed && inst.proc) { try { process.kill(-inst.proc.pid, 'SIGTERM'); } catch (_) { try { inst.proc.kill(); } catch (_) {} } }
  writeSbState();
  if (activeSbId === id) pickActiveOrHide(); else emitInstances();
}
function stopAllStorybook() {
  for (const inst of sbServers.values()) { if (inst.managed && inst.proc) { try { process.kill(-inst.proc.pid, 'SIGTERM'); } catch (_) {} } }
  sbServers.clear(); activeSbId = null; clearSbState();
}

// Resolve the working dir (empty → bundled demo) + detect an installed Storybook.
function sbResolveDir(dir) { return (dir && fs.existsSync(dir)) ? dir : SB_DEMO_DIR; }
function sbBin(dir) { return path.join(dir, 'node_modules', '.bin', 'storybook' + (process.platform === 'win32' ? '.cmd' : '')); }
function sbHasStorybook(dir) { return fs.existsSync(path.join(dir, '.storybook')) && fs.existsSync(sbBin(dir)); }

// App-owned preview styling — written into the project's OWN .storybook/preview-head.html,
// the only place that can style the (cross-origin) preview iframe. Idempotent managed block.
const SB_PV_START = '<!-- cathode:preview:start -->';
const SB_PV_END   = '<!-- cathode:preview:end -->';
function previewHeadBlock() {
  return [
    SB_PV_START,
    '<style>',
    '  /* Cathode Terminal — managed preview styling (thumb-only scrollbars) */',
    '  ::-webkit-scrollbar { width: 8px; height: 8px; }',
    '  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }',
    '  ::-webkit-scrollbar-thumb { background: rgba(140,140,150,0.35); border-radius: 4px; }',
    '  ::-webkit-scrollbar-thumb:hover { background: rgba(140,140,150,0.55); }',
    '</style>',
    SB_PV_END,
  ].join('\n');
}
function ensurePreviewHead(projectDir) {
  const sbDir = path.join(projectDir, '.storybook');
  if (!fs.existsSync(sbDir)) return;
  const fp = path.join(sbDir, 'preview-head.html');
  let existing = '';
  try { existing = fs.readFileSync(fp, 'utf8'); } catch (_) {}
  const s = existing.indexOf(SB_PV_START), e = existing.indexOf(SB_PV_END);
  let base = (s !== -1 && e !== -1) ? (existing.slice(0, s) + existing.slice(e + SB_PV_END.length)) : existing;
  base = base.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  try { fs.writeFileSync(fp, (base ? base + '\n' : '') + previewHeadBlock() + '\n', 'utf8'); }
  catch (err) { console.error('[storybook] preview-head write failed', err.message); }
}

ipcMain.handle(IPC.STORYBOOK_DETECT, (_, { dir } = {}) => {
  const projectDir = sbResolveDir(dir);
  return { dir: projectDir, installed: sbHasStorybook(projectDir), isDemo: projectDir === SB_DEMO_DIR };
});

ipcMain.handle(IPC.STORYBOOK_SERVER_START, async (_, { dir, port } = {}) => {
  const projectDir = sbResolveDir(dir);
  for (const s of sbServers.values()) { if (s.dir === projectDir) { setActiveStorybook(s.id); return { ok: true, url: s.url, already: true }; } }   // already running this dir
  if (!sbHasStorybook(projectDir)) {
    sbStatus('error', { message: 'No Storybook found in ' + projectDir + ' — build one with your agent first.' });
    return { ok: false, error: 'no-storybook', dir: projectDir };
  }
  ensurePreviewHead(projectDir);   // step 4: app-owned preview styling
  const usePort = port || await findFreePort(6006);   // step 6: don't get blocked by a busy 6006
  const url = `http://localhost:${usePort}`;
  const id  = 'sb' + (++sbSeq);
  const inst = { id, proc: null, port: usePort, url, dir: projectDir, label: sbLabel(projectDir), status: 'starting', log: '', managed: true };
  sbServers.set(id, inst);
  emitInstances();
  sbStatus('starting', { url, dir: projectDir });
  let proc;
  try {
    proc = spawn(sbBin(projectDir), ['dev', '-p', String(usePort), '--ci'], {
      cwd: projectDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    });
  } catch (e) {
    sbServers.delete(id); emitInstances(); sbStatus('error', { message: e.message });
    return { ok: false, error: e.message };
  }
  inst.proc = proc; writeSbState();
  const onLog = (d) => { inst.log = (inst.log + d).slice(-4000); };   // rolling tail for diagnosis
  if (proc.stdout) proc.stdout.on('data', onLog);
  if (proc.stderr) proc.stderr.on('data', onLog);
  proc.on('exit', (code) => {
    if (!sbServers.has(id)) return;
    sbServers.delete(id); writeSbState();
    sbStatus('stopped', { code, log: tailLines(inst.log, 8) });
    if (activeSbId === id) pickActiveOrHide(); else emitInstances();
  });

  const ready = await pollInstanceReady(inst);
  if (!sbServers.has(id)) return { ok: false, error: 'stopped' };            // stopped during startup
  if (!ready) { stopInstance(id); sbStatus('error', { message: 'Storybook didn’t come up on ' + url + '.', log: tailLines(inst.log, 8) }); return { ok: false, error: 'timeout' }; }
  inst.status = 'ready';
  setActiveStorybook(id);                                            // auto-connect the live view
  sbStatus('ready', { url, dir: projectDir });
  return { ok: true, url };
});

ipcMain.handle(IPC.STORYBOOK_SERVER_STOP, (_, { id } = {}) => { stopInstance(id || activeSbId); return { ok: true }; });
ipcMain.handle(IPC.STORYBOOK_LIST,          () => ({ instances: sbSerialize(), activeId: activeSbId }));
ipcMain.handle(IPC.STORYBOOK_RELOAD,        () => { if (storybookView && !storybookView.webContents.isDestroyed()) storybookView.webContents.reload(); return { ok: true }; });
ipcMain.handle(IPC.STORYBOOK_OPEN_EXTERNAL, (_, { id } = {}) => { const inst = sbServers.get(id || activeSbId); if (inst) shell.openExternal(inst.url); return { ok: true }; });

// Detect Storybooks the app didn't start (scan common ports), then adopt one.
function scanPorts(known) {
  const ports = Array.from({ length: 11 }, (_, i) => 6006 + i).filter(p => !known.has(p));
  return Promise.all(ports.map(port => new Promise((res) => {
    const req = http.get(`http://localhost:${port}/iframe.html`, (r) => { r.resume(); res(r.statusCode && r.statusCode < 500 ? { port, url: `http://localhost:${port}` } : null); });
    req.on('error', () => res(null));
    req.setTimeout(800, () => { req.destroy(); res(null); });
  }))).then(rs => rs.filter(Boolean));
}
function adoptPort(port) {
  for (const s of sbServers.values()) if (s.port === port) { setActiveStorybook(s.id); return s; }
  const id = 'sb' + (++sbSeq);
  const inst = { id, proc: null, port, url: `http://localhost:${port}`, dir: '', label: 'Port ' + port, status: 'ready', log: '', managed: false };
  sbServers.set(id, inst);
  setActiveStorybook(id);
  return inst;
}
ipcMain.handle(IPC.STORYBOOK_SCAN,  async () => ({ found: await scanPorts(new Set([...sbServers.values()].map(s => s.port))) }));
ipcMain.handle(IPC.STORYBOOK_ADOPT, (_, { port } = {}) => { const i = adoptPort(port); return { ok: true, id: i.id, url: i.url }; });

// Native instance switcher (HTML can't overlay the WebContentsView, so use Menu.popup).
ipcMain.handle(IPC.STORYBOOK_OPEN_SWITCHER, async () => {
  const items = [...sbServers.values()].map(s => ({
    label: `${s.label}  ·  :${s.port}${s.managed ? '' : '  (external)'}`,
    type: 'checkbox', checked: s.id === activeSbId, click: () => setActiveStorybook(s.id),
  }));
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: 'New Storybook…', click: () => uiSend(IPC.STORYBOOK_SHOW_SETUP) });
  Menu.buildFromTemplate(items).popup({ window: mainWindow });
  return { ok: true };
});

// Setup panel shown over the view (add/manage) → suppress the native view while open.
ipcMain.on(IPC.STORYBOOK_SETUP_OPEN, (_, open) => { sbSetupOpen = !!open; repositionRightPanelView(); });

app.on('before-quit', stopAllStorybook);

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

ipcMain.handle(IPC.STORYBOOK_WRITE_MEMORY, (_, { url } = {}) => {
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

ipcMain.handle(IPC.STORYBOOK_CLEAR_MEMORY, () => {
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
ipcMain.on(IPC.MODAL_OVERLAY, (_, { open } = {}) => {
  modalOpen = open;
  repositionAll();
});

ipcMain.on(IPC.RIGHT_PANEL_MODE, (_, mode) => {
  rightPanelMode = mode;
  if (mode === 'figma' && !figmaView) createFigmaView();
  if (mode.startsWith('url:')) ensureCustomView(mode.slice(4));
  repositionAll();
});

ipcMain.on(IPC.DESTROY_CUSTOM_VIEW, (_, url) => destroyCustomView(url));

function repositionBrowserView(overrideFraction) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!browserView || browserView.webContents.isDestroyed()) return;
  // While ghost-dragging a resize handle the view stays hidden (the renderer
  // shows a ghost frame); applied on drag-end.
  if (resizingDevice) { browserView.setBounds(OFFSCREEN_BOUNDS); return; }
  // browserEmpty → the project URL is blank; hide the view so the HTML empty
  // state in #browser-placeholder shows through.
  // single-pane chat → the chat fills the main area; hide the browser entirely.
  if (modalOpen || rightPanelMode !== 'project' || browserEmpty || singlePane === 'chat') {
    browserView.setBounds(OFFSCREEN_BOUNDS);
    uiSend(IPC.DEVICE_VIEW_BOUNDS, null);   // hide the resize handles
    return;
  }
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = overrideFraction ?? splitFraction;
  const availW  = winW - devToolsWidth;
  const leftW   = Math.round(availW * fraction);
  const topOffset = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
  const PAD     = 8;   // rounded-container inset (top/right/bottom; left flush)
  // single-pane browser → the browser sits right of the fixed left strip;
  // otherwise it follows the split (left-panel width + 10px divider).
  const rightX  = singlePane === 'browser' ? (STRIP_W + 1) : (leftW + 11);   // +1 = right-column left inset (matches #right-panel padding-left)
  const panelY = topOffset + PAD;   // 8px top inset
  const panelW = (availW - rightX) - PAD, panelH = (winH - topOffset) - PAD * 2;

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
    const y = panelY;                                  // top-anchored (8px inset)
    browserView.setBounds({ x, y, width: w, height: h });
    uiSend(IPC.DEVICE_VIEW_BOUNDS, { x, y, width: w, height: h, panelW, panelH, panelX: rightX, panelY });
    return;
  }
  // No emulation → fill the panel, no handles
  browserView.setBounds({ x: rightX, y: panelY, width: panelW, height: panelH });
  uiSend(IPC.DEVICE_VIEW_BOUNDS, null);
}

// ── Project folder ────────────────────────────────────────────────
// The directory sessions launch in (and where agent-memory files live).
// Empty/unset → the user's home, which makes the memory files *global*.
let currentProjectDir = '';
function homeDir() { return platform.homeDir(); }
function sessionCwd() { return currentProjectDir || homeDir(); }
ipcMain.on(IPC.SET_PROJECT_DIR, (_, { dir } = {}) => { currentProjectDir = dir || ''; });

// ── Agent runtime environment (WSL vs Windows vs native) ──────────
// Most tools (claude/aider/llm) run in WSL on Windows. Gemini/Codex may be
// installed via *Windows* npm instead, so we detect where each binary lives.
// On macOS/Linux there is no split — agents run natively. resolveAgentEnv,
// agentVersion (Windows cmd.exe versions) and agentCwd live in the platform
// adapter; aliased here so existing call sites read unchanged.
const DUAL_ENV_BINS = new Set(['gemini', 'codex']);
const resolveAgentEnv = platform.resolveAgentEnv;
const winVersion = platform.agentVersion;
function winCwd() { return platform.agentCwd(sessionCwd(), homeDir()); }

// ── PTY sessions ──────────────────────────────────────────────────
function safeKill(proc) { try { proc && proc.kill(); } catch (_) {} }
function killPty(id)    { safeKill(ptyProcesses[id]); delete ptyProcesses[id]; delete ptyOutBuf[id]; }

// Coalesce pty output: node-pty emits one chunk per read, so heavy output (large
// file dumps, verbose builds) otherwise floods the IPC boundary with thousands of
// tiny messages/sec — each a serialize/deserialize + event-loop wake on both
// processes. Buffer per-id and flush once per frame: cuts IPC volume 1-2 orders of
// magnitude with imperceptible (<=16ms) latency. xterm already batches rendering.
const ptyOutBuf = Object.create(null);   // id -> pending output string
let ptyFlushTimer = null;
function flushPtyOut() {
  ptyFlushTimer = null;
  for (const id in ptyOutBuf) {
    const data = ptyOutBuf[id];
    delete ptyOutBuf[id];
    if (data) uiSend(IPC.PTY_OUTPUT, { id, data });
  }
}
function queuePtyOut(id, data) {
  ptyOutBuf[id] = (ptyOutBuf[id] || '') + data;
  if (!ptyFlushTimer) ptyFlushTimer = setTimeout(flushPtyOut, 16);
}

async function spawnPty(id, command = 'claude') {
  ptyCommands[id] = command;
  try {
    const pty  = require('node-pty');
    const base = command.trim().split(/\s+/)[0].replace(/.*\//, '');
    const env  = DUAL_ENV_BINS.has(base) ? await resolveAgentEnv(base) : 'wsl';
    let proc;
    if (env === 'win') {
      // Windows-installed agent (e.g. Gemini/Codex via Windows npm) → run on Windows.
      const { file, args } = platform.cmdFileArgs(['/c', command]);
      proc = pty.spawn(file, args, {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: winCwd(), env: process.env,
      });
    } else {
      // Prepend pip/pipx user-install dir so tools like aider are found
      const wrappedCmd = `export PATH="$HOME/.local/bin:$PATH"; ${command}`;
      const { file, args } = platform.nixFileArgs(['bash', '-lic', wrappedCmd]);
      proc = pty.spawn(file, args, {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: sessionCwd(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    }
    proc.onData(data => { queuePtyOut(id, data); });
    proc.onExit(() => {
      // Guard: a restart may have already replaced this id with a new proc —
      // a stale exit must not clobber the new entry (or print into its term).
      if (ptyProcesses[id] !== proc) return;
      // Flush any buffered output before the end marker so order is preserved.
      if (ptyOutBuf[id]) { uiSend(IPC.PTY_OUTPUT, { id, data: ptyOutBuf[id] }); delete ptyOutBuf[id]; }
      uiSend(IPC.PTY_OUTPUT, { id, data: '\r\n\x1b[33m[Session ended]\x1b[0m\r\n' });
      delete ptyProcesses[id];
    });
    ptyProcesses[id] = proc;
  } catch (err) {
    uiSend(IPC.PTY_OUTPUT, { id, data: `\r\n\x1b[31m[Error starting session: ${err.message}]\x1b[0m\r\n` });
  }
}

// ── IPC: terminal ─────────────────────────────────────────────────
ipcMain.on(IPC.PTY_INPUT,   (_, { id, data })       => { const p = ptyProcesses[id]; if (p) { try { p.write(data); } catch (_) {} } });
// node-pty throws synchronously if the pty has already exited (e.g. a refit fires
// after the process ended) — swallow it so it doesn't crash the main process.
ipcMain.on(IPC.PTY_RESIZE,  (_, { id, cols, rows })  => { const p = ptyProcesses[id]; if (p) { try { p.resize(cols, rows); } catch (_) {} } });
ipcMain.on(IPC.PTY_SPAWN,   (_, { id, command })     => spawnPty(id, command));
ipcMain.on(IPC.PTY_KILL,    (_, { id })              => {
  killPty(id);
});
ipcMain.on(IPC.PTY_RESTART, (_, { id, command })     => {
  killPty(id);
  spawnPty(id, command || ptyCommands[id] || 'claude');
});
ipcMain.on(IPC.SET_ACTIVE_PTY, (_, { id } = {}) => { activePtyId = id; });

ipcMain.handle(IPC.CHECK_MODEL, (_, { command } = {}) => {
  return new Promise(resolve => {
    try {
      const safe = command.replace(/[^a-zA-Z0-9\-_.]/g, '');
      const p = platform.nixSpawn(['bash', '-lic', `command -v ${safe} >/dev/null 2>&1`]);
      p.on('close', code => resolve(code === 0));
      p.on('error', () => resolve(false));
      setTimeout(() => { safeKill(p); resolve(false); }, 4000);
    } catch (_) { resolve(false); }
  });
});

// ── Onboarding: detection + streaming install runner ──────────────
// check-wsl → "is the *nix environment reachable?" (always true on macOS/Linux)
ipcMain.handle(IPC.CHECK_WSL, () => platform.checkNixEnv());

ipcMain.handle(IPC.CHECK_CLAUDE_AUTH, () => new Promise(resolve => {
  try {
    const p = platform.nixSpawn(['bash', '-lic', 'test -f ~/.claude/.credentials.json && echo yes']);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/yes/.test(out)));
    p.on('error', () => resolve(false));
    setTimeout(() => { safeKill(p); resolve(false); }, 5000);
  } catch (_) { resolve(false); }
}));

let onboardingProc = null;
ipcMain.on(IPC.ONBOARDING_RUN, (_, { id, command } = {}) => {
  const send = uiSend;
  if (!validRunCommand(command)) { send('onboarding-done', { id, code: 1 }); return; }
  safeKill(onboardingProc);
  try {
    // Keep a local ref: the killed proc's async 'close' must not null out a
    // replacement that was assigned in the meantime (orphaning its kill handle).
    const proc = platform.nixSpawn(['bash', '-lic', command]);
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
ipcMain.on(IPC.ONBOARDING_CANCEL, () => { safeKill(onboardingProc); onboardingProc = null; });

// ── Profile installer (streams output back to the modal) ──────────
ipcMain.on(IPC.PROFILE_INSTALL, (_, { installId, command } = {}) => {
  const send = uiSend;
  if (!validRunCommand(command)) { send('profile-install-error', { installId, message: 'Invalid install command.' }); return; }
  try {
    const proc = platform.nixSpawn(['bash', '-lc', command], {
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
      // On Windows, run through `cmd.exe /c npm` — Node refuses to spawn a
      // `.cmd` file directly (throws EINVAL). On POSIX, npm runs natively.
      const p = platform.cmdSpawn(['/c', 'npm', 'ls', '-g', ACP_ADAPTER_PKG, '--json', '--depth=0'],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      p.stdout.on('data', d => out += d);
      p.on('close', () => {
        try { finish(JSON.parse(out).dependencies?.[ACP_ADAPTER_PKG]?.version || null); }
        catch (_) { finish(null); }
      });
      p.on('error', () => finish(null));
      setTimeout(() => { safeKill(p); finish(null); }, 15000);
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
  uiSend(IPC.ACP_INSTALLING, { id });
  const ok = await new Promise(resolve => {
    // Windows: `cmd.exe /c npm` — never spawn `npm.cmd` directly (EINVAL). POSIX: npm native.
    const inst = platform.cmdSpawn(['/c', 'npm', 'install', '-g', `${ACP_ADAPTER_PKG}@${ACP_ADAPTER_VERSION}`],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    inst.stdout.on('data', d => uiSend(IPC.ACP_INSTALL_PROGRESS, { id, text: d.toString() }));
    inst.stderr.on('data', d => uiSend(IPC.ACP_INSTALL_PROGRESS, { id, text: d.toString() }));
    inst.on('close', code => resolve(code === 0));
    inst.on('error', () => resolve(false));
  });
  if (!ok) { uiSend(IPC.ACP_ERROR, { id, message: `Failed to install the adapter. Run: npm install -g ${ACP_ADAPTER_PKG}@${ACP_ADAPTER_VERSION}` }); return false; }
  _acpAdapterVerified = true;
  return true;
}

async function launchClaudeAcp(modelOverride) {
  // Point the adapter at WSL's ~/.claude (same OAuth credentials). Probes run
  // async + parallel — sync versions froze the UI for ~14s on every spawn.
  const [cfgOut, verOut, setOut] = await Promise.all([
    wslExecFile(platform.claudeConfigDirArgs(), 5000),
    wslExecFile(['bash', '-lc', 'claude --version 2>/dev/null'], 6000),
    wslExecFile(['-e', 'sh', '-c', 'cat ~/.claude/settings.json 2>/dev/null'], 3000),
  ]);
  const wslClaudeConfigDir = (cfgOut || '').trim() || null;
  const version = (verOut || '').trim().replace(/^Claude\s+Code\s+/i, '').replace(/^v/i, '');
  let model = '';
  try { model = JSON.parse(setOut).model || ''; } catch (_) {}
  if (modelOverride) model = modelOverride;
  const proc = platform.cmdSpawn(['/c', 'claude-agent-acp'], {
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
    proc = platform.cmdSpawn(['/c', bin, ...acpArgs], { stdio: ['pipe', 'pipe', 'pipe'], cwd: winCwd(), windowsHide: true });
  } else {
    version = ((await wslExecFile(['bash', '-lic', `${bin} --version 2>/dev/null`], 6000)) || '').trim().split('\n').filter(Boolean).pop() || '';
    proc = platform.nixSpawn(['bash', '-lic', `${bin} ${acpArgs.join(' ')}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: sessionCwd() });
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
    uiSend(IPC.ACP_ERROR, { id, message: `Failed to start ${ACP_LABELS[agentKey] || agentKey}: ${(err && err.message) || err}` });
    return;
  }
  const acpCwd = sessionCwd();

  // Accumulate stderr so we can show it if the process dies early
  let stderrBuf = '';
  proc.stderr.on('data', d => {
    stderrBuf += d.toString();
    if (stderrBuf.length > 65536) stderrBuf = stderrBuf.slice(-65536);   // keep only recent stderr (error report uses the tail)
    console.error('[acp]', d.toString().trim());
  });

  let connected = false;
  let errorSent = false;   // an error path already told the renderer — don't double-report
  proc.on('exit', (code, signal) => {
    if (connected || errorSent) return; // normal exit after use — already handled via conn.closed
    const detail = stderrBuf.trim().split('\n').slice(-3).join(' | ') || `exit ${code ?? signal}`;
    console.error('[acp] early exit:', detail);
    uiSend(IPC.ACP_ERROR, { id, message: `Adapter exited before connecting: ${detail}` });
  });

  proc.on('error', err => {
    console.error('[acp] proc error:', err);
    uiSend(IPC.ACP_ERROR, { id, message: err.message });
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
      try { fs.writeFileSync(params.path, params.content, 'utf8'); } catch (e) { logErr('agent writeTextFile ' + params.path, e); }
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
    safeKill(proc);
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
    safeKill(proc);
  }
}

ipcMain.on(IPC.ACP_SPAWN, (_, { id, model, agent } = {}) => {
  spawnAcpSession(id, model || '', agent || 'claude').catch(err => {
    console.error('[acp] spawn error:', err);
    uiSend(IPC.ACP_ERROR, { id, message: err.message });
  });
});

ipcMain.on(IPC.ACP_PROMPT, async (_, { id, text } = {}) => {
  const s = acpSessions.get(id);
  if (!s) return;
  try {
    await s.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text }] });
    uiSend(IPC.ACP_DONE, { id });
  } catch (err) {
    console.error('[acp] prompt error:', err);
    uiSend(IPC.ACP_ERROR, { id, message: err.message });
  }
});

ipcMain.on(IPC.ACP_CANCEL, async (_, { id } = {}) => {
  const s = acpSessions.get(id);
  if (!s) return;
  try { await s.conn.cancel({ sessionId: s.sessionId }); } catch (_) {}
});

ipcMain.on(IPC.ACP_KILL, (_, { id } = {}) => {
  const s = acpSessions.get(id);
  if (!s) return;
  safeKill(s.proc);
  acpSessions.delete(id);
});

// ── IPC: usage (parsed from Claude local transcripts) ─────────────
let _claudeConfigDirPromise = null;   // cached async resolution (was sync — blocked the UI)
function claudeConfigDir() {
  if (!_claudeConfigDirPromise) {
    _claudeConfigDirPromise = wslExecFile(platform.claudeConfigDirArgs(), 5000)
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

// Serialize usage reads. `computeUsage` advances a shared cache offset and reads
// the transcript incrementally; two concurrent calls (panel poll + post-reply
// refresh firing together) would read overlapping byte ranges and double-count
// tokens/cost. Chain them so each runs strictly after the previous settles.
let _usageLock = Promise.resolve();
function computeUsageSerial(file) {
  const run = _usageLock.then(() => computeUsage(file));
  _usageLock = run.then(() => {}, () => {});   // keep the chain alive past failures
  return run;
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
    contextWindow: 200_000,   // every current Claude model is 200k; revisit if a 1M-context variant is added
    inputTokens: c.inT, outputTokens: c.outT, cacheCreate: c.cc, cacheRead: c.cr,
    totalTokens: c.inT + c.outT + c.cc + c.cr,
    costUsd,
  };
}

ipcMain.handle(IPC.GET_USAGE, async (_, { cwd } = {}) => {
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
    return { ok: true, ...(await computeUsageSerial(file)) };
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
      res.on('error', reject);   // mid-stream response error → reject now, don't wait for timeout
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// Live subscription rate-limit usage — same data Claude Code's /usage shows
ipcMain.handle(IPC.GET_RATE_LIMITS, async () => {
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
ipcMain.on(IPC.BROWSER_NAVIGATE, (_, url) => {
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
ipcMain.on(IPC.SET_BROWSER_EMPTY, (_, empty) => {
  browserEmpty = !!empty;
  repositionBrowserView();
});
ipcMain.on(IPC.BROWSER_RELOAD, () => browserView.webContents.reloadIgnoringCache());
ipcMain.on(IPC.BROWSER_TOGGLE_DEVTOOLS, () => {
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
  if (notify) uiSend(IPC.DEVICE_CHANGED, { name: deviceEmulation ? deviceEmulation.name : '', default: deviceEmulation === null });
}
ipcMain.on(IPC.SHOW_DEVICE_MENU, (_, { x, y, devices, activeName, defaultView } = {}) => {
  const tpl = [{ label: 'Default view', type: 'checkbox', checked: !!defaultView, click: () => setEmulation({ default: true }) }];
  tpl.push({ type: 'separator' });
  tpl.push({ label: 'Responsive', type: 'checkbox', checked: !defaultView && !activeName, click: () => setEmulation({ responsive: true }) });
  for (const d of (devices || [])) {
    tpl.push({ label: d.name, type: 'checkbox', checked: d.name === activeName, click: () => setEmulation(d) });
  }
  tpl.push({ type: 'separator' });
  tpl.push({ label: 'Edit…', click: () => uiSend(IPC.SETTINGS_ACTION, 'edit-devices') });
  // x is the renderer's right-aligned origin (button right edge − menu width).
  Menu.buildFromTemplate(tpl).popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
});
// Apply a persisted device on startup (renderer drives persistence, so no notify).
ipcMain.on(IPC.SET_DEVICE, (_, d) => setEmulation(d || null, false));

// Resize-handle drag: hide the view while a ghost frame is dragged, then apply
// the dragged size as a custom (Responsive) viewport on release.
ipcMain.on(IPC.DEVICE_RESIZE_START, () => { resizingDevice = true; repositionBrowserView(); });
ipcMain.on(IPC.DEVICE_RESIZE_END, (_, { width, height } = {}) => {
  resizingDevice = false;
  if (width > 0 && height > 0) deviceEmulation = { name: '', fit: false, width, height };
  repositionBrowserView();
});

// ── IPC: layout ───────────────────────────────────────────────────
ipcMain.on(IPC.SPLIT_CHANGED, (_, fraction) => {
  splitFraction = fraction;
  repositionAll();
  broadcastLayout();
});

// Single-pane (collapsed) mode toggle: 'browser' | 'chat' | null (normal split).
ipcMain.on(IPC.SINGLE_PANE, (_, mode) => {
  singlePane = (mode === 'browser' || mode === 'chat') ? mode : null;
  repositionAll();
  broadcastLayout();
});

// Native menus can't take CSS — match their light/dark appearance to the theme.
ipcMain.on(IPC.NATIVE_THEME, (_, source) => {
  if (source === 'light' || source === 'dark') nativeTheme.themeSource = source;
});
ipcMain.on(IPC.RENDERER_READY, () => {
  repositionBrowserView();
  broadcastLayout();
  // Re-sync the renderer with the restored browser URL. At boot the renderer registers
  // its browser-url-changed listener only after the initial did-navigate may have already
  // fired, so without this re-push the restored page stays hidden behind the empty state.
  try {
    let u = (browserView && !browserView.webContents.isDestroyed()) ? browserView.webContents.getURL() : '';
    if (!u || u === 'about:blank') u = loadLastURL();
    if (u && u !== 'about:blank') mainWindow.webContents.send(IPC.BROWSER_URL_CHANGED, u);
  } catch (_) {}
});


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
function wslRun(cmdString, timeout = 25000, extraEnv = null) {
  return new Promise(resolve => {
    const { file, args } = platform.nixFileArgs(['bash', '-lic', cmdString]);
    execFile(file, args,
      { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, env: extraEnv ? { ...process.env, ...extraEnv } : process.env },
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

// The secret is referenced from the process env (CATHODE_MCP_SECRET, set by the
// caller via wslRun) instead of embedded, so it never appears in this command
// string / the process list. The placeholder is shell-quoted with the rest, then
// spliced to '"$VAR"' so bash expands it from the env at run time.
function buildMcpAddCmd(agent, entry, hasToken) {
  const TOK = '@@CATHODE_MCP_SECRET@@';
  const parts = [agent.cli, 'mcp', 'add', entry.serverName, '-s', 'user', '-t', entry.transport];
  if (entry.transport === 'stdio') {
    if (entry.envVar && hasToken) parts.push('-e', `${entry.envVar}=${TOK}`);
    if (entry.staticEnv) for (const [k, v] of Object.entries(entry.staticEnv)) parts.push('-e', `${k}=${v}`);
    if (agent.sep) parts.push('--');
    parts.push(entry.command, ...(entry.args || []));
  } else {
    parts.push(entry.url);
    if (entry.authHeader && hasToken) parts.push('-H', `${entry.authHeader}: ${TOK}`);
  }
  return parts.map(shq).join(' ').replaceAll(TOK, `'"$CATHODE_MCP_SECRET"'`);
}

ipcMain.handle(IPC.CLIPBOARD_READ, () => { try { return clipboard.readText(); } catch (_) { return ''; } });

// Fast check (no health-check) whether a given MCP server is configured in any
// agent's user-scope config. Reads the config files directly.
ipcMain.handle(IPC.MCP_HAS_SERVER, async (_, { name } = {}) => {
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
ipcMain.handle(IPC.MCP_CONNECT, async (_, { catalogKey, token, custom } = {}) => {
  const entry = catalogKey === 'custom' ? buildCustomEntry(custom) : MCP_CATALOG[catalogKey];
  if (!entry) return { ok: false, error: 'Unknown service' };
  const agents = await detectMcpAgents();
  if (!agents.length) return { ok: false, error: 'No supported agents (Claude/Gemini/Codex) found in WSL.' };

  const results = [];
  for (const agent of agents) {
    await wslRun(`${agent.cli} mcp remove ${shq(entry.serverName)} -s user`, T_MCP_PROBE);   // idempotent
    const r = await wslRun(buildMcpAddCmd(agent, entry, !!token), T_MCP_ADD, token ? { CATHODE_MCP_SECRET: String(token) } : null);
    results.push({
      agent: agent.key, label: agent.label, ok: r.ok,
      detail: r.ok ? '' : r.out.trim().split('\n').filter(Boolean).slice(-1)[0] || 'failed',
    });
  }
  return { ok: results.some(r => r.ok), serverName: entry.serverName, service: entry.service, results };
});

// Disconnect: remove from every agent
ipcMain.handle(IPC.MCP_DISCONNECT, async (_, { serverName } = {}) => {
  for (const agent of await detectMcpAgents()) {
    await wslRun(`${agent.cli} mcp remove ${shq(serverName)} -s user`, T_MCP_PROBE);
  }
  return { ok: true };
});

// Status: parse `<cli> mcp list` per agent → { servers, agents }
ipcMain.handle(IPC.MCP_STATUS, async () => {
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

ipcMain.handle(IPC.SHOW_FILE_DIALOG, async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  return filePaths || [];
});

ipcMain.handle(IPC.SHOW_FOLDER_DIALOG, async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return filePaths[0] || null;
});

// Pick a single image file (for the box-select image properties → passed to the agent by path).
ipcMain.handle(IPC.PICK_IMAGE_FILE, async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'] }],
  });
  return (filePaths && filePaths[0]) || null;
});

// ── Code tab: project file browsing (read-only) ───────────────────
// currentProjectDir comes back from the folder dialog as a Windows path
// (UNC \\wsl.localhost\... for WSL folders, C:\... for Windows), so Node fs
// reads it directly — no WSL round-trip needed.
const CODE_HEAVY_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv', '.svn', '.hg']);   // .git is dropped earlier by the explicit name filter
const CODE_MAX_BYTES  = 2 * 1024 * 1024;

function codeSafeJoin(rel) {
  if (!currentProjectDir) return null;
  const root = path.resolve(currentProjectDir);
  const target = path.resolve(root, rel || '');
  if (target !== root && !target.startsWith(root + path.sep)) return null; // traversal guard
  return target;
}

ipcMain.handle(IPC.GET_PROJECT_DIR, () => currentProjectDir || '');

ipcMain.handle(IPC.PICK_PROJECT_DIR, async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  const dir = (filePaths && filePaths[0]) || '';
  if (dir) currentProjectDir = dir;
  return dir;
});

// All async (fs.promises): the project dir is usually a \\wsl.localhost UNC
// path where each sync FS call blocks the main thread for a network
// round-trip — code-poll alone fired several of those every 1.2 s.
ipcMain.handle(IPC.CODE_LIST, async (_, { rel } = {}) => {
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

ipcMain.handle(IPC.CODE_READ, async (_, { rel } = {}) => {
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
function gitBase(dir = sessionCwd()) { return platform.gitBase(dir); }
function gitExec(args, { maxBuffer = 8 << 20, timeout = 15000, dir } = {}) {
  const { bin, prefix } = gitBase(dir);
  return new Promise((resolve) => {
    // `timeout` guards against a hung git (credential prompt, slow \\wsl UNC,
    // slow wsl.exe spin-up) so diff calls can never hang the Changes tab.
    execFile(bin, [...prefix, ...args],
      { windowsHide: true, maxBuffer, encoding: 'utf8', timeout, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        resolve({ failed: !!err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
      });
  });
}
function looksBinary(s) { return s.indexOf('\u0000') !== -1; }

ipcMain.handle(IPC.DIFF_STATUS, async () => {
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

ipcMain.handle(IPC.DIFF_FILE, async (_, { rel, status } = {}) => {
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
ipcMain.handle(IPC.CODE_POLL, async (_, { paths } = {}) => {
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

function getApiKeyFile() { return path.join(app.getPath('userData'), '.api-key'); }

// Secrets at rest: encrypt with the OS keychain (safeStorage) when available,
// and always write 0600. Falls back to plaintext only where the OS can't
// encrypt (e.g. headless Linux with no keyring) so the app still works.
function encryptToFile(file, plaintext) {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(String(plaintext))
    : Buffer.from(String(plaintext), 'utf8');
  fs.writeFileSync(file, data, { mode: 0o600 });
}
function decryptFromFile(file) {
  const buf = fs.readFileSync(file);                 // throws if missing — caller guards
  if (safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(buf); }
    catch (_) { return buf.toString('utf8'); }       // legacy plaintext → re-encrypted on next write
  }
  return buf.toString('utf8');
}

function loadSavedApiKey() {
  try {
    const key = decryptFromFile(getApiKeyFile()).trim();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch (_) {}
}

ipcMain.on(IPC.SET_API_KEY, (_, key) => {
  process.env.ANTHROPIC_API_KEY = key || '';
  try { encryptToFile(getApiKeyFile(), key || ''); } catch (e) { logErr('save api key', e); }
});

// Seal/open a string for the renderer, so its secrets stay in localStorage but
// encrypted at rest. Synchronous so the renderer keeps its sync storage API. The
// "v1:" prefix marks sealed values, so legacy plaintext is read as-is and
// re-sealed on the next write.
ipcMain.on(IPC.SECRET_SEAL, (e, plaintext) => {
  try {
    e.returnValue = safeStorage.isEncryptionAvailable()
      ? 'v1:' + safeStorage.encryptString(String(plaintext)).toString('base64')
      : String(plaintext);
  } catch (_) { e.returnValue = String(plaintext); }
});
ipcMain.on(IPC.SECRET_OPEN, (e, sealed) => {
  try {
    e.returnValue = (typeof sealed === 'string' && sealed.startsWith('v1:') && safeStorage.isEncryptionAvailable())
      ? safeStorage.decryptString(Buffer.from(sealed.slice(3), 'base64'))
      : (sealed || '');
  } catch (_) { e.returnValue = sealed || ''; }
});

// ── In-app update: git-pull the app's own checkout and relaunch ───
// For people running from a source checkout (the dev model). Uses --ff-only so
// it refuses to clobber a dirty/diverged tree (correct behaviour for someone
// actively editing the app — they update via their own git workflow).
async function checkForAppUpdate() {
  const dir = app.getAppPath();
  const info = (message, detail, type = 'info') =>
    dialog.showMessageBox(mainWindow, { type, message, detail: detail || '', buttons: ['OK'] });

  const inside = await gitExec(['rev-parse', '--is-inside-work-tree'], { dir, timeout: 8000 });
  if (inside.failed) {
    return info('In-app update unavailable',
      inside.code === 'ENOENT'
        ? 'Git was not found on PATH.'
        : 'This build is not running from a git checkout, so update it the way you installed it.');
  }
  const fetched = await gitExec(['fetch', '--quiet'], { dir, timeout: 30000 });
  if (fetched.failed) {
    return info('Could not check for updates', (fetched.stderr || 'git fetch failed').trim().slice(0, 300), 'warning');
  }
  const counts = await gitExec(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { dir });
  let behind = 0;
  if (!counts.failed) behind = +(counts.stdout.trim().split(/\s+/)[1]) || 0;
  if (behind === 0) return info('You’re up to date', 'No new updates are available.');

  const status = await gitExec(['status', '--porcelain'], { dir });
  const dirty = !status.failed && status.stdout.trim().length > 0;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    message: `${behind} update${behind === 1 ? '' : 's'} available`,
    detail: (dirty ? 'Heads up: you have uncommitted changes, which may block a fast-forward update.\n\n' : '')
      + 'Pull the latest and restart the app?',
    buttons: ['Update & Restart', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (response !== 0) return;

  const pull = await gitExec(['pull', '--ff-only'], { dir, timeout: 60000 });
  if (pull.failed) {
    return info('Update failed',
      (pull.stderr || pull.stdout || 'git pull --ff-only failed').trim().slice(0, 400)
      + '\n\nResolve it manually (e.g. commit or stash local changes), then try again.', 'error');
  }
  const changed = await gitExec(['diff', '--name-only', 'HEAD@{1}', 'HEAD'], { dir });
  if (!changed.failed && /(^|\n)(package\.json|package-lock\.json)\b/.test(changed.stdout)) {
    return info('Updated — dependencies changed',
      'Run `npm install` in the app folder, then restart the app manually.');
  }
  await dialog.showMessageBox(mainWindow, {
    type: 'info', message: 'Updated', detail: 'The app will now restart to apply the update.', buttons: ['Restart'],
  });
  app.relaunch();
  app.exit(0);
}

// Quiet check a few seconds after launch — surfaces "N available" without a
// dialog (renderer shows a dismissible toast + a dot on the gear).
async function startupUpdateCheck() {
  try {
    const dir = app.getAppPath();
    if ((await gitExec(['rev-parse', '--is-inside-work-tree'], { dir, timeout: 8000 })).failed) return;
    if ((await gitExec(['fetch', '--quiet'], { dir, timeout: 30000 })).failed) return;
    const counts = await gitExec(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { dir });
    if (counts.failed) return;
    const behind = +(counts.stdout.trim().split(/\s+/)[1]) || 0;
    if (behind > 0) uiSend(IPC.UPDATE_AVAILABLE, { behind });
  } catch (_) { /* never let a background check throw */ }
}
// Let the toast / gear trigger the full (dialog-driven) update flow.
ipcMain.on(IPC.APP_CHECK_UPDATES, () => { checkForAppUpdate().catch(() => {}); });

ipcMain.on(IPC.SHOW_SETTINGS_MENU, (_, pos) => {
  const act = id => () => uiSend(IPC.SETTINGS_ACTION, id);
  const menu = Menu.buildFromTemplate([
    { label: 'Get Started (Setup & Tools)', click: act('get-started') },
    { type: 'separator' },
    { label: 'Authentication',     click: act('auth') },
    { label: 'Manage LLMs',        click: act('manage-llms') },
    { label: 'Color Themes',       click: act('theme') },
    { label: 'Audit Prompts',      click: act('audit-prompts') },
    { label: 'Edit Tabs',          click: act('edit-tabs') },
    { label: 'MCP Tool Tokens',    click: act('mcp-tools') },
    { label: 'Keyboard Shortcuts', click: act('keyboard-shortcuts') },
    { type: 'separator' },
    { label: 'Check for Updates…', click: () => { checkForAppUpdate().catch(() => {}); } },
    { label: 'New Window',         click: act('new-window') },
    { type: 'separator' },
    { label: 'Report an Issue…',   click: () => { shell.openExternal('https://github.com/hplant6/cathode-terminal/issues/new').catch(() => {}); } },
  ]);
  menu.popup({ window: mainWindow, x: pos.x, y: pos.y });
});

ipcMain.on(IPC.SHOW_SB_BAR_MENU, (_, { x, y } = {}) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Open in browser', click: () => uiSend(IPC.SB_BAR_MENU_ACTION, 'external') },
    { label: 'Detect running Storybooks…', click: async () => {
      const found = await scanPorts(new Set([...sbServers.values()].map(s => s.port)));
      const tmpl = found.length ? found.map(f => ({ label: `Adopt Storybook on :${f.port}`, click: () => adoptPort(f.port) }))
                                : [{ label: 'No other running Storybooks found', enabled: false }];
      Menu.buildFromTemplate(tmpl).popup({ window: mainWindow });
    }},
    { type: 'separator' },
    { label: 'Stop Storybook',  click: () => uiSend(IPC.SB_BAR_MENU_ACTION, 'stop') },
  ]);
  menu.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
});

ipcMain.handle(IPC.AUTH_STATUS_READ, async () => {
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

ipcMain.handle(IPC.AGENT_MD_READ, async (_, { agent } = {}) => {
  try {
    const t = await agentMemoryTarget(agent);
    if (t.mode === 'fs') { try { return fs.readFileSync(t.path, 'utf8'); } catch (_) { return ''; } }
    return (await wslExecFile(['-e', 'sh', '-c', `cat ${t.rel} 2>/dev/null`], 5000)) || '';
  } catch (_) { return ''; }
});

ipcMain.handle(IPC.AGENT_MD_WRITE, async (_, { agent, content } = {}) => {
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

ipcMain.on(IPC.SHOW_TABS_CONTEXT_MENU, (_, pos) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Edit Tabs', click: () => mainWindow.webContents.send(IPC.SETTINGS_ACTION, 'edit-tabs') },
  ]);
  menu.popup({ window: mainWindow, x: pos.x, y: pos.y });
});

// ── Custom window controls (frameless titlebar) ──────────────────
ipcMain.on(IPC.WINDOW_MINIMIZE, (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); });
ipcMain.on(IPC.WINDOW_MAXIMIZE_TOGGLE, (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
ipcMain.on(IPC.WINDOW_CLOSE, (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });

ipcMain.on(IPC.NEW_WINDOW, () => {
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
// URL of the page currently shown in the right panel (the tab the user is looking at).
function activePageUrl() {
  try { return getActivePickView()?.webContents.getURL() || ''; } catch (_) { return ''; }
}
// Human label for where the active page lives — the Working File or a specific Storybook instance.
function pageSource() {
  try {
    if (rightPanelMode === 'storybook' && activeSbId) {
      const inst = sbServers.get(activeSbId);
      if (inst) return `the Storybook running on :${inst.port}${inst.label ? ` ("${inst.label}")` : ''}`;
      return 'the Storybook';
    }
  } catch (_) {}
  return "the app's Working File";
}

// ── IPC: element picker ───────────────────────────────────────────
ipcMain.on(IPC.PICK_START, async (_, mode) => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    // Phase 1: user draws selection
    const picked = await view.webContents.executeJavaScript(getPickerScript(mode));
    if (!picked) { uiSend(IPC.PICK_CANCELLED); return; }

    const { cx, cy, mouseUpX, mouseUpY, bounds, mode: pickedMode, wholePage } = picked;

    // Box/Lasso and Extract all use the left-column panel (panelMode draws a
    // persistent highlight and returns immediately, keeping live DOM refs alive).
    const usePanel = (mode === 'box' || mode === 'lasso' || mode === 'aidev');

    const result = await view.webContents.executeJavaScript(
      getCombinedScript({
        isClick: pickedMode === 'click',
        bounds, cx, cy,
        mouseUpX: mouseUpX ?? cx,
        mouseUpY: mouseUpY ?? cy,
        aiDevMode: mode === 'aidev',
        wholePage: wholePage === true,
        panelMode: usePanel,
      })
    );

    if (usePanel) {
      if (!result || !result.items || !result.items.length) {
        uiSend(IPC.PICK_CANCELLED);
        await clearPanelHighlight(view);
        return;
      }
      if (mode === 'aidev') {
        pendingExtract = { view, items: result.items };
        uiSend(IPC.EXTRACT_PANEL_OPEN, { tool: 'Extract', items: result.items });
        return;   // finalized via extract-panel-send / -cancel
      }
      // CSS source refs now (project view only — source maps only meaningful for local dev)
      let cssRefs = [];
      if (view === browserView) {
        await ensureCDP();
        cssRefs = await getCSSSourceRefs({ cx, cy }).catch(() => []);
      }
      pendingPanelPick = { view, items: result.items, cssRefs };
      const toolLabel = mode === 'lasso' ? 'Lasso Select' : 'Box Select';
      uiSend(IPC.PICK_PANEL_OPEN, { items: result.items, tool: toolLabel });   // full items incl. cssProps/debugSource
      return;   // panel stays open; result is finalized via pick-panel-send/-cancel
    }

    uiSend(IPC.PICK_CANCELLED); // clear active button state

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
    const srcArgs = { items, cssRefs, extracts, media, mediaSummary, pageUrl };
    uiSend(IPC.PICK_SEND_TO_SESSION, {
      text:   formatSourceMessage({ ...srcArgs, instruction }),
      body:   (instruction || '').trim(),
      detail: formatSourceMessage({ ...srcArgs, instruction: '' }),
      label:  'Element Context',
    });

  } catch (err) {
    console.error('Pick error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

// ── IPC: box/lasso left-column panel ──────────────────────────────
// While the panel is open in the renderer, the page keeps a persistent
// highlight (window.__cathodePanel) around the selected elements. These
// handlers drive removal/clearing and finalize the message on send.
let pendingPanelPick = null;   // { view, items, cssRefs }
async function clearPanelHighlight(view) {
  const wc = (view || (pendingPanelPick && pendingPanelPick.view) || {}).webContents;
  if (!wc || wc.isDestroyed()) return;
  try { await wc.executeJavaScript('window.__cathodePanel && window.__cathodePanel.clear()'); } catch (_) {}
}
ipcMain.on(IPC.PICK_PANEL_UPDATE, async (_, { active } = {}) => {
  const p = pendingPanelPick;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return;
  try { await p.view.webContents.executeJavaScript(`window.__cathodePanel && window.__cathodePanel.set(${JSON.stringify(active || [])})`); } catch (_) {}
});
// Live style edit from a drawer → apply to the actual page element.
ipcMain.on(IPC.PICK_PANEL_STYLE, async (_, { i, prop, value } = {}) => {
  const p = pendingPanelPick;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return;
  const v = (value === null || value === undefined) ? 'null' : JSON.stringify(String(value));
  try { await p.view.webContents.executeJavaScript(`window.__cathodePanel && window.__cathodePanel.style(${Number(i)}, ${JSON.stringify(String(prop))}, ${v})`); } catch (_) {}
});
// Finalize: the renderer sends the resolved items (with selectedCSS already built).
// Picked images are passed by absolute local path (in url('…')); tell the agent
// to copy them into the project and rewrite the references to be portable.
function localAssetNote(items) {
  const paths = new Set();
  for (const it of (items || [])) {
    for (const css of (it.selectedCSS || [])) {
      const val = css.replace(/\/\*.*?\*\//g, '');   // ignore the "was:" comment — only the chosen value
      let m; const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
      while ((m = re.exec(val))) {
        const u = m[1].trim();
        if (/^([a-zA-Z]:[\\/]|\/)/.test(u)) paths.add(u);   // absolute local path (drive letter or leading /)
      }
    }
  }
  if (!paths.size) return '';
  return '\n\nThe CSS above references local image files by absolute path:\n'
    + [...paths].map(p => `  • ${p}`).join('\n')
    + '\n\nCopy each of these into the working project directory (e.g. an assets/ folder within the project) and update the url() references to point at the copied paths relative to the project.';
}

ipcMain.on(IPC.PICK_PANEL_SEND, async (_, { instruction = '', items = [] } = {}) => {
  const p = pendingPanelPick;
  pendingPanelPick = null;
  if (!p) { uiSend(IPC.PICK_CANCELLED); return; }
  await clearPanelHighlight(p.view);
  uiSend(IPC.PICK_CANCELLED);
  if (!items.length && !instruction.trim()) return;
  const note = localAssetNote(items);
  let pageUrl = ''; try { pageUrl = p.view.webContents.getURL(); } catch (_) {}   // the page being viewed
  const text   = formatSourceMessage({ items, cssRefs: p.cssRefs || [], instruction,      pageUrl }) + note;   // full → agent
  const detail = formatSourceMessage({ items, cssRefs: p.cssRefs || [], instruction: '',  pageUrl }) + note;   // CSS/DOM without the typed note → drawer
  uiSend(IPC.PICK_SEND_TO_SESSION, { text, body: instruction.trim(), detail, label: 'Element Context' });
});
ipcMain.on(IPC.PICK_PANEL_CANCEL, async () => {
  const p = pendingPanelPick;
  pendingPanelPick = null;
  if (p) await clearPanelHighlight(p.view);
  uiSend(IPC.PICK_CANCELLED);
});

// ── Extract tool panel ────────────────────────────────────────────
let pendingExtract = null;   // { view, items }
ipcMain.on(IPC.EXTRACT_PANEL_HIGHLIGHT, async (_, { active } = {}) => {
  const p = pendingExtract;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return;
  try { await p.view.webContents.executeJavaScript(`window.__cathodePanel && window.__cathodePanel.set(${JSON.stringify(active || [])})`); } catch (_) {}
});
// Show/hide the persisted box/lasso selection overlay (the panel's "Hide selection" link).
ipcMain.on(IPC.TOGGLE_PAGE_SELECTION, (_, { visible } = {}) => {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(`(function(){var s=document.getElementById('__cathode_selection__');if(s)s.style.display=${visible ? "''" : "'none'"};})()`).catch(() => {});
});
// Per-element extraction: each entry has its own keys/media chosen in its drawer,
// extracted independently (scoped to that element), then merged into one message.
ipcMain.on(IPC.EXTRACT_PANEL_SEND, async (_, { perElement = [], instruction = '' } = {}) => {
  const p = pendingExtract;
  pendingExtract = null;
  if (!p) { uiSend(IPC.PICK_CANCELLED); return; }
  const view = p.view;
  const extracts = [];      // { key, label: "Element — Extractor", analysis, data }
  let assets = [], anyDownload = false;
  const mediaTypeSet = new Set();
  for (const pe of (perElement || [])) {
    const keys = (pe.sel || []).map(s => s.key);
    const mediaTypes = pe.mediaTypes || [];
    if (!keys.length && !mediaTypes.length) continue;
    let res = null;
    try {
      res = await view.webContents.executeJavaScript(
        `window.__cathodePanel && window.__cathodePanel.extract(${Number(pe.index)}, ${JSON.stringify(keys)}, ${JSON.stringify(mediaTypes)}, ${JSON.stringify(pe.mediaDest || 'chat')})`);
    } catch (e) { console.error('Extract error:', e); }
    if (!res) continue;
    (res.extracts || []).forEach(e => {
      const meta = (pe.sel || []).find(s => s.key === e.key) || {};
      extracts.push({ key: e.key, label: `${pe.label || 'Element'} — ${meta.label || e.key}`, analysis: meta.analysis || '', data: e.data });
    });
    if (res.media && res.media.assets && res.media.assets.length) {
      assets = assets.concat(res.media.assets);
      (res.media.types || []).forEach(t => mediaTypeSet.add(t));
      if (res.media.dest === 'download') anyDownload = true;
    }
  }
  await clearPanelHighlight(view);
  uiSend(IPC.PICK_CANCELLED);
  let media = null, mediaSummary = null;
  if (assets.length) {
    media = { dest: anyDownload ? 'download' : 'chat', types: [...mediaTypeSet], assets };
    if (anyDownload) mediaSummary = await downloadMediaAssets(assets, view.webContents.session);
  }
  if (!extracts.length && !media && !instruction.trim()) return;
  const pageUrl = view.webContents.getURL();
  const srcArgs = { items: p.items, cssRefs: [], extracts, media, mediaSummary, pageUrl };
  uiSend(IPC.PICK_SEND_TO_SESSION, {
    text:   formatSourceMessage({ ...srcArgs, instruction }),
    body:   (instruction || '').trim(),
    detail: formatSourceMessage({ ...srcArgs, instruction: '' }),
    label:  'Element Context',
  });
});
ipcMain.on(IPC.EXTRACT_PANEL_CANCEL, async () => {
  const p = pendingExtract;
  pendingExtract = null;
  if (p) await clearPanelHighlight(p.view);
  uiSend(IPC.PICK_CANCELLED);
});

// ── IPC: screenshot ───────────────────────────────────────────────
ipcMain.on(IPC.PICK_SCREENSHOT, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    // Phase 1: user draws the capture region
    const sel = await view.webContents.executeJavaScript(getScreenshotScript());
    if (!sel) { uiSend(IPC.PICK_CANCELLED); return; }

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

    // Phase 4: hand off to the left-column panel (preview + instruction).
    pendingScreenshot = { filepath };
    uiSend(IPC.SCREENSHOT_PANEL_OPEN, {
      tool: 'Screenshot',
      dataUrl: 'data:image/png;base64,' + pngBuffer.toString('base64'),
      filepath,
    });
  } catch (err) {
    console.error('Screenshot error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

let pendingScreenshot = null;   // { filepath }
ipcMain.on(IPC.SCREENSHOT_PANEL_SEND, (_, { instruction = '', compositeDataUrl = null } = {}) => {
  const p = pendingScreenshot;
  pendingScreenshot = null;
  uiSend(IPC.PICK_CANCELLED);
  if (!p) return;
  if (compositeDataUrl) {   // marker drawing → overwrite the saved PNG with the annotated composite
    try { fs.writeFileSync(p.filepath, Buffer.from(compositeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')); } catch (_) {}
  }
  const instr = (instruction || '').trim();
  const ssUrl = activePageUrl();
  const shotRef = (ssUrl ? `From ${pageSource()} — ${ssUrl}\n` : '') + `[Screenshot: ${p.filepath}]`;
  uiSend(IPC.PICK_SEND_TO_SESSION, { text: instr ? `${shotRef}\n\n${instr}` : shotRef, body: instr, detail: shotRef, label: 'Screenshot' });
});
ipcMain.on(IPC.SCREENSHOT_PANEL_CANCEL, () => {
  const p = pendingScreenshot;
  pendingScreenshot = null;
  uiSend(IPC.PICK_CANCELLED);
  if (p) { try { fs.unlinkSync(p.filepath); } catch (_) {} }   // discard the orphaned capture
});

// ── IPC: draw tool ────────────────────────────────────────────────
// Set up the persistent marker layer, then open the in-app brush panel.
ipcMain.on(IPC.PICK_DRAW, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    await view.webContents.executeJavaScript(getDrawScript());
    uiSend(IPC.DRAW_PANEL_OPEN);
  } catch (err) {
    console.error('Draw setup error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});
function markerCall(method, arg) {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  const a = arg === undefined ? '' : JSON.stringify(arg);
  view.webContents.executeJavaScript(`window.__cathodeMarker&&window.__cathodeMarker.${method}(${a})`).catch(() => {});
}
ipcMain.on(IPC.MARKER_SET_COLOR, (_, c) => markerCall('setColor', c));
ipcMain.on(IPC.MARKER_SET_SIZE,  (_, n) => markerCall('setSize', n));
ipcMain.on(IPC.MARKER_CLEAR, () => markerCall('clear'));
ipcMain.on(IPC.MARKER_CANCEL, () => markerCall('teardown'));

// Send: grab the marker layer + a page screenshot, hand to the renderer to
// composite, then tear the marker down.
ipcMain.on(IPC.MARKER_SEND, async (_, { instructions = '' } = {}) => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    const canvasDataUrl = await view.webContents.executeJavaScript('window.__cathodeMarker&&window.__cathodeMarker.composite()');
    const pageImage = await view.webContents.capturePage();
    const pageB64   = pageImage.toPNG().toString('base64');
    markerCall('teardown');
    uiSend(IPC.DRAW_COMPOSITE, { pageB64, canvasDataUrl, instructions });
  } catch (err) {
    console.error('Marker send error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

ipcMain.on(IPC.DRAW_CANCEL, () => markerCall('teardown'));

ipcMain.on(IPC.PICK_CANCEL, () => {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`
  ).catch(() => {});
});

ipcMain.on(IPC.DRAW_COMPOSITE_DONE, (_, { compositeDataUrl, instructions } = {}) => {
  const buf  = Buffer.from(compositeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const dir  = require('path').join(require('electron').app.getPath('userData'), 'screenshots');
  require('fs').mkdirSync(dir, { recursive: true });
  const file = require('path').join(dir, 'draw-' + Date.now() + '.png');
  require('fs').writeFileSync(file, buf);
  const dwUrl = activePageUrl();
  const drawRef = (dwUrl ? `From ${pageSource()} — ${dwUrl}\n` : '') + '[Drawing: ' + file + ']';
  const drawInstr = (instructions || '').trim();
  uiSend(IPC.PICK_SEND_TO_SESSION, { text: drawInstr ? `${drawRef}\n\n${drawInstr}` : drawRef, body: drawInstr, detail: drawRef, label: 'Drawing' });
});

// ── IPC: element resize (left-column panel) ───────────────────────
// The on-page handles stay live in the page; instructions/dimensions/Send-Cancel
// live in the left column. window.__cathodeResize drives live dims + teardown.
let pendingResize  = null;   // { view }
let resizePollTimer = null;
function stopResizePoll() { if (resizePollTimer) { clearInterval(resizePollTimer); resizePollTimer = null; } }
function startResizePoll() {
  stopResizePoll();
  resizePollTimer = setInterval(async () => {
    const p = pendingResize;
    if (!p || !p.view || p.view.webContents.isDestroyed()) { stopResizePoll(); return; }
    try {
      const d = await p.view.webContents.executeJavaScript('window.__cathodeResize && window.__cathodeResize.dims()');
      if (d) uiSend(IPC.RESIZE_PANEL_DIMS, d);
    } catch (_) {}
  }, 150);
}
async function clearResize(view, reset) {
  const wc = (view || (pendingResize && pendingResize.view) || {}).webContents;
  if (!wc || wc.isDestroyed()) return;
  const js = reset
    ? 'window.__cathodeResize && (window.__cathodeResize.reset(), window.__cathodeResize.clear())'
    : 'window.__cathodeResize && window.__cathodeResize.clear()';
  try { await wc.executeJavaScript(js); } catch (_) {}
}

ipcMain.on(IPC.PICK_RESIZE, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    const sel = await view.webContents.executeJavaScript(getResizeScript());
    if (!sel) { uiSend(IPC.PICK_CANCELLED); return; }   // cancelled before selecting
    pendingResize = { view };
    uiSend(IPC.RESIZE_PANEL_OPEN, { tool: 'Resize', label: sel.label, oW: sel.oW, oH: sel.oH, vw: sel.vw, vh: sel.vh });
    startResizePoll();
  } catch (err) {
    console.error('Resize error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

ipcMain.on(IPC.RESIZE_PANEL_RESET, async () => {
  const p = pendingResize;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return;
  try { await p.view.webContents.executeJavaScript('window.__cathodeResize && window.__cathodeResize.reset()'); } catch (_) {}
});
ipcMain.on(IPC.RESIZE_PANEL_SET, async (_, { dim, value } = {}) => {
  const p = pendingResize;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return;
  try { await p.view.webContents.executeJavaScript(`window.__cathodeResize && window.__cathodeResize.set(${JSON.stringify(String(dim))}, ${Number(value)})`); } catch (_) {}
});
ipcMain.on(IPC.RESIZE_PANEL_SEND, async (_, { instruction = '' } = {}) => {
  const p = pendingResize;
  pendingResize = null; stopResizePoll();
  if (!p) { uiSend(IPC.PICK_CANCELLED); return; }
  let res = null;
  try { res = await p.view.webContents.executeJavaScript('window.__cathodeResize && window.__cathodeResize.result()'); } catch (_) {}
  await clearResize(p.view, false);   // keep the resize applied on the page
  uiSend(IPC.PICK_CANCELLED);
  if (!res) return;
  const { selector, snippet, oW, oH, nW, nH } = res;
  const instr = (instruction || '').trim();
  if (Math.abs(nW - oW) < 2 && Math.abs(nH - oH) < 2 && !instr) return;   // nothing to send
  const lines = ['───── Resize Request ─────', snippet, '', 'Selector: ' + selector];
  if (nW !== oW) lines.push('  width:  ' + oW + 'px  →  ' + nW + 'px');
  if (nH !== oH) lines.push('  height: ' + oH + 'px  →  ' + nH + 'px');
  const rzUrl = activePageUrl();
  const detail = (rzUrl ? `From ${pageSource()} — ${rzUrl}\n\n` : '') + lines.join('\n');
  const body = (instr ? instr + '\n\n' : '') + 'Update the CSS so this element matches these dimensions.';
  uiSend(IPC.PICK_SEND_TO_SESSION, { text: detail + '\n\n' + body, body, detail, label: 'Resize request' });
});
ipcMain.on(IPC.RESIZE_PANEL_CANCEL, async () => {
  const p = pendingResize;
  pendingResize = null; stopResizePoll();
  if (p) await clearResize(p.view, true);   // revert the on-page resize
  uiSend(IPC.PICK_CANCELLED);
});

// ── IPC: eyedropper (left-column panel) ───────────────────────────
// Phase 1 (loupe sampling) stays on the page; on click the script resolves with
// the element + applicable color properties and keeps refs live. The panel then
// drives property switching / live color edits via window.__cathodeEyedropper.
let pendingEyedropper = null;   // { view }
function edExec(js) {
  const p = pendingEyedropper;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return Promise.resolve(null);
  return p.view.webContents.executeJavaScript(js).catch(() => null);
}

ipcMain.on(IPC.PICK_EYEDROPPER, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    // Snapshot the rendered viewport so the loupe can sample exact pixels.
    const image = await view.webContents.capturePage();
    const sel = await view.webContents.executeJavaScript(getEyedropperScript(image.toDataURL()));
    if (!sel) { uiSend(IPC.PICK_CANCELLED); return; }   // cancelled during hover
    pendingEyedropper = { view };
    uiSend(IPC.EYEDROPPER_PANEL_OPEN, { tool: 'Eyedropper', ...sel });
  } catch (err) {
    console.error('Eyedropper error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

ipcMain.handle(IPC.EYEDROPPER_SET_PROP, (_, { prop } = {}) =>
  edExec(`window.__cathodeEyedropper && window.__cathodeEyedropper.setProp(${JSON.stringify(String(prop))})`));
ipcMain.on(IPC.EYEDROPPER_SET_COLOR, (_, { hex } = {}) => {
  edExec(`window.__cathodeEyedropper && window.__cathodeEyedropper.setColor(${JSON.stringify(String(hex))})`);
});
ipcMain.on(IPC.EYEDROPPER_SEND, async (_, { instruction = '' } = {}) => {
  if (!pendingEyedropper) { uiSend(IPC.PICK_CANCELLED); return; }
  const res = await edExec(`window.__cathodeEyedropper && window.__cathodeEyedropper.result(${JSON.stringify(String(instruction))})`);
  await edExec('window.__cathodeEyedropper && window.__cathodeEyedropper.clear()');   // keep the edit applied
  pendingEyedropper = null;
  uiSend(IPC.PICK_CANCELLED);
  if (!res) return;
  const { selector, property, fromColor, toColor, changed, pickedColor, instruction: instr } = res;
  let body, detail = '';
  if (changed) {
    const edUrl = activePageUrl();
    detail = (edUrl ? `From ${pageSource()} — ${edUrl}\n\n` : '') + ['───── Color Change Request ─────', 'Selector: ' + selector, '  ' + property + ': ' + fromColor + '  →  ' + toColor].join('\n');
    const what = property === 'box-shadow' ? "box-shadow's color" : property;
    body = (instr ? instr + '\n\n' : '') + "Update the CSS so this element's " + what + ' is ' + toColor + '.';
  } else {
    const edUrl = activePageUrl();
    detail = edUrl ? `From ${pageSource()} — ${edUrl}` : '';
    body = 'Picked ' + (pickedColor || fromColor) + ' — ' + property + ' on ' + selector + '.' + (instr ? '\n\n' + instr : '');
  }
  uiSend(IPC.PICK_SEND_TO_SESSION, { text: detail ? detail + '\n\n' + body : body, body, detail, label: 'Color' });
});
ipcMain.on(IPC.EYEDROPPER_CANCEL, async () => {
  if (pendingEyedropper) await edExec('window.__cathodeEyedropper && window.__cathodeEyedropper.cancel()');
  pendingEyedropper = null;
  uiSend(IPC.PICK_CANCELLED);
});

// ── IPC: accessibility checker (left-column panel) ────────────────
// The scan + page markers stay on the page; the results list (drawers, live
// color editing, notes) lives in the column via window.__cathodeA11y.
let pendingA11y = null;   // { view }
function a11yExec(js) {
  const p = pendingA11y;
  if (!p || !p.view || p.view.webContents.isDestroyed()) return Promise.resolve(null);
  return p.view.webContents.executeJavaScript(js).catch(() => null);
}
ipcMain.on(IPC.PICK_A11Y, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    const result = await view.webContents.executeJavaScript(getA11yScript());
    uiSend(IPC.PICK_CANCELLED);
    if (!result) return;
    pendingA11y = { view };
    uiSend(IPC.A11Y_PANEL_OPEN, { tool: 'Accessibility', url: result.url, total: result.total, issues: result.issues });
  } catch (err) {
    console.error('A11y check error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});
ipcMain.on(IPC.A11Y_SET_COLOR, (_, { idx, which, hex } = {}) => {
  a11yExec(`window.__cathodeA11y && window.__cathodeA11y.setColor(${Number(idx)}, ${JSON.stringify(String(which))}, ${JSON.stringify(String(hex))})`);
});
ipcMain.on(IPC.A11Y_FLASH, (_, { idx } = {}) => {
  a11yExec(`window.__cathodeA11y && window.__cathodeA11y.flash(${Number(idx)})`);
});
ipcMain.on(IPC.A11Y_SEND, async (_, { issues = [], instruction = '' } = {}) => {
  if (!pendingA11y) { return; }
  await a11yExec('window.__cathodeA11y && window.__cathodeA11y.clear()');
  pendingA11y = null;
  if (!issues.length && !instruction.trim()) return;
  const groups = {};
  for (const it of issues) (groups[it.category] = groups[it.category] || []).push(it);
  const url = issues[0] && issues[0].url;
  const lines = ['───── Accessibility Audit ─────', `${issues.length} issue${issues.length === 1 ? '' : 's'} to fix${url ? ' on ' + url : ''}`];
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
  const a11yUrl = activePageUrl();
  const detail = (a11yUrl ? `From ${pageSource()} — ${a11yUrl}\n\n` : '') + lines.join('\n');
  const body = (instruction.trim() ? instruction.trim() + '\n\n' : '') + 'Fix these so the page meets WCAG AA (contrast ≥ 4.5:1 for normal text / 3:1 for large; every image, control, and link has an accessible name). Where suggested colors are given, apply them.';
  uiSend(IPC.PICK_SEND_TO_SESSION, { text: detail + '\n\n' + body, body, detail, label: 'Accessibility check' });
});
ipcMain.on(IPC.A11Y_CANCEL, async () => {
  if (pendingA11y) await a11yExec('window.__cathodeA11y && window.__cathodeA11y.clear()');
  pendingA11y = null;
});

// Hover the "Selected location" link → outline that element on the live page
function clearCpHighlight() {
  const view = getActivePickView();
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript("(function(){['__cathode_cp_hl__','__cathode_cp_marker__'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});})()").catch(() => {});
}
ipcMain.on(IPC.CP_HIGHLIGHT_TARGET, (_, { selector } = {}) => {
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
ipcMain.on(IPC.CP_CLEAR_TARGET_HIGHLIGHT, () => clearCpHighlight());

// ── IPC: component picker ─────────────────────────────────────────
ipcMain.on(IPC.PICK_COMPONENT, async () => {
  const view = getActivePickView();
  if (!view) { uiSend(IPC.PICK_CANCELLED); return; }
  try {
    const result = await view.webContents.executeJavaScript(`
      (function() {
        var oldMk = document.getElementById('__cathode_cp_marker__'); if (oldMk) oldMk.remove();
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
            // leave an orange marker (the storybook cursor icon) at the click point
            const mk = document.createElement('div'); mk.id = '__cathode_cp_marker__';
            mk.style.cssText = 'position:fixed;left:' + (e.clientX - 9) + 'px;top:' + (e.clientY - 9) + 'px;width:18px;height:18px;z-index:${Z.OVERLAY};pointer-events:none;background:#FF5720;-webkit-mask:url("data:image/svg+xml;base64,${STORYBOOK_CURSOR_B64}") no-repeat center / contain;mask:url("data:image/svg+xml;base64,${STORYBOOK_CURSOR_B64}") no-repeat center / contain;filter:drop-shadow(0 0 4px rgba(255,87,32,0.6));';
            document.documentElement.appendChild(mk);
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
    uiSend(IPC.PICK_CANCELLED);
    if (!result) return;
    uiSend(IPC.PICK_COMPONENT_RESULT, result);
  } catch (err) {
    console.error('Component pick error:', err);
    uiSend(IPC.PICK_CANCELLED);
  }
});

// ── Media download (Extract tool) ─────────────────────────────────
// Bytes are fetched main-side via Electron net (no page CORS; carries the
// view's session cookies). inline SVG / data: / blob-b64 are written directly.
const NET_IDLE_MS = 30000;   // abort an asset fetch after this long with no progress (tune for slow links / big assets)
function netFetch(url, session) {
  return new Promise((resolve, reject) => {
    let req, settled = false, timer;
    // Single-settlement guard so a late error after a timeout/abort can't
    // double-resolve the promise.
    const settle = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
    // Idle timeout: abort if no progress for 20s. Without this, a connection that
    // opens but never sends `end` hangs this promise (and its caller) forever.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { req && req.abort(); } catch (_) {}
        settle(reject, new Error('request stalled (timeout)'));
      }, NET_IDLE_MS);
    };
    try { req = net.request({ url, session }); } catch (e) { return reject(e); }
    arm();
    req.on('response', res => {
      arm();
      if (res.statusCode >= 400) { req.abort(); return settle(reject, new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', c => {
        arm();   // progress → reset the stall timer
        size += c.length;
        if (size > 60 * 1024 * 1024) { req.abort(); return settle(reject, new Error('too large (>60MB)')); }
        chunks.push(c);
      });
      res.on('end', () => settle(resolve, Buffer.concat(chunks)));
      res.on('error', e => settle(reject, e));
    });
    req.on('error', e => settle(reject, e));
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
    lines.push(`I used the Extract tool on the live page in ${pageSource()}. Everything below is the actual current DOM/styles/assets of what I selected — use it directly; do not re-open or re-fetch the page.`);
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
  lines.push(`These are live elements from ${pageSource()}${pageUrl ? ` — ${pageUrl}` : ''}.`);

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
function readRealScale() { return platform.readRealScale(); }

function relaunchWithScale(scale) {
  saveScale(scale);
  const args = process.argv.slice(1).filter(a => !a.startsWith('--force-device-scale-factor'));
  app.relaunch({ args });
  app.exit(0);
}

app.whenReady().then(async () => {
  loadSavedApiKey();
  reapOrphanStorybook();   // step 6: clean up a Storybook server orphaned by a crashed run
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
  // sysperf sampling is started on demand by the renderer (sysperf-active IPC)
  // when its panel is open, instead of running unconditionally for the app's life.
  setTimeout(() => startupUpdateCheck(), 4000);   // quiet, non-blocking
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  Object.values(ptyProcesses).forEach(p => { safeKill(p); });
  platform.stopGpuSampler();
  if (process.platform !== 'darwin') app.quit();
});
