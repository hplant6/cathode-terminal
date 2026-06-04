const { app, BrowserWindow, WebContentsView, ipcMain, Menu, nativeTheme } = require('electron');
Menu.setApplicationMenu(null);
nativeTheme.themeSource = 'dark';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getPickerScript }        = require('./src/picker-inject');
const { getCombinedScript }       = require('./src/combined-inject');
const { getScreenshotScript }     = require('./src/screenshot-inject');
const { getScreenshotPopupScript } = require('./src/screenshot-popup-inject');

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
let ptyProcess;

const TOOLBAR_HEIGHT = 42;
const TITLEBAR_HEIGHT = 36; // Windows hidden titlebar overlay sits inside content area

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
    titleBarOverlay: { color: '#1a1a1a', symbolColor: '#888888', height: 36 },
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
  });
  browserView.webContents.on('did-navigate-in-page', (_, url) => {
    saveLastURL(url);
    mainWindow.webContents.send('browser-url-changed', url);
  });

  // Intercept window.open() — deny OS window, open inside app as WebContentsViews
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => openInlinePopup(url));
    return { action: 'deny' };
  });

  mainWindow.on('resize', () => {
    repositionBrowserView();
    repositionInlinePopup();
  });
}

// ── Inline popup (WebContentsView overlay) ────────────────────────
let popupBarView     = null;
let popupContentView = null;

function getPopupBounds() {
  const [winW, winH] = mainWindow.getContentSize();
  const fraction  = global.splitFraction ?? 0.4;
  const rightX    = Math.round(winW * fraction) + 4;
  const rightW    = winW - rightX;
  const topOffset = TITLEBAR_HEIGHT + TOOLBAR_HEIGHT;
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
  const BAR = 36;

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
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: BAR });
  popupBarView.webContents.loadFile(path.join(__dirname, 'src', 'popup-bar.html'));
  popupBarView.webContents.once('did-finish-load', () => {
    popupBarView.webContents.send('popup-url', url);
  });
  mainWindow.contentView.addChildView(popupBarView);

  // Content view
  popupContentView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  popupContentView.setBounds({ x: b.x, y: b.y + BAR, width: b.width, height: b.height - BAR });
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
  const BAR = 36;
  if (popupBarView)     popupBarView.setBounds({ x: b.x, y: b.y, width: b.width, height: BAR });
  if (popupContentView) popupContentView.setBounds({ x: b.x, y: b.y + BAR, width: b.width, height: b.height - BAR });
}

ipcMain.on('close-inline-popup', () => closeInlinePopup());

function repositionBrowserView(splitFraction) {
  if (!mainWindow || !browserView) return;
  const [winW, winH] = mainWindow.getContentSize();
  const fraction = splitFraction ?? global.splitFraction ?? 0.4;
  const leftW = Math.round(winW * fraction);
  const rightX = leftW + 4;
  const topOffset = TITLEBAR_HEIGHT + TOOLBAR_HEIGHT;
  browserView.setBounds({ x: rightX, y: topOffset, width: winW - rightX, height: winH - topOffset });
}

// ── PTY ───────────────────────────────────────────────────────────
function spawnPty() {
  try {
    const pty = require('@homebridge/node-pty-prebuilt-multiarch');
    // Run claude inside WSL via wsl.exe — bash -lic loads the full login shell
    // so nvm, PATH, and other shell config are available.
    ptyProcess = pty.spawn('wsl.exe', ['bash', '-lic', 'claude'], {
      name: 'xterm-256color',
      cols: 80, rows: 24,
      cwd: process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty-output', data);
    });
    ptyProcess.onExit(() => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('pty-output', '\r\n\x1b[33m[Claude session ended]\x1b[0m\r\n');
      ptyProcess = null;
    });
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('pty-output', `\r\n\x1b[31m[Error starting claude: ${err.message}]\x1b[0m\r\n`);
  }
}

// ── IPC: terminal ─────────────────────────────────────────────────
ipcMain.on('pty-input',   (_, data)          => { if (ptyProcess) ptyProcess.write(data); });
ipcMain.on('pty-resize',  (_, { cols, rows }) => { if (ptyProcess) ptyProcess.resize(cols, rows); });
ipcMain.on('pty-restart', () => {
  if (ptyProcess) { try { ptyProcess.kill(); } catch (_) {} }
  spawnPty();
});

// ── IPC: browser ──────────────────────────────────────────────────
ipcMain.on('browser-navigate', (_, url) => {
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    const isLocal = /^localhost(:\d+)?(\/|$)|^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(target);
    target = (isLocal ? 'http://' : 'https://') + target;
  }
  browserView.webContents.loadURL(target);
});
ipcMain.on('browser-go-back',    () => { if (browserView.webContents.canGoBack()) browserView.webContents.goBack(); });
ipcMain.on('browser-go-forward', () => { if (browserView.webContents.canGoForward()) browserView.webContents.goForward(); });
ipcMain.on('browser-reload',     () => browserView.webContents.reload());
ipcMain.on('browser-navigate-home', () => {
  // Don't persist blank — next launch should still remember the real last URL
  browserView.webContents.loadURL('about:blank');
  mainWindow.webContents.send('browser-url-changed', 'about:blank');
});
ipcMain.on('browser-toggle-devtools', () => {
  if (browserView.webContents.isDevToolsOpened()) {
    browserView.webContents.closeDevTools();
    mainWindow.webContents.send('devtools-closed');
  } else {
    browserView.webContents.openDevTools({ mode: 'right' });
    mainWindow.webContents.send('devtools-opened');
  }
});

// ── IPC: layout ───────────────────────────────────────────────────
ipcMain.on('split-changed', (_, fraction) => {
  global.splitFraction = fraction;
  repositionBrowserView(fraction);
});
ipcMain.on('renderer-ready', () => { repositionBrowserView(); spawnPty(); });

// ── IPC: element picker ───────────────────────────────────────────
ipcMain.on('pick-start', async (_, mode) => {
  try {
    // Phase 1: user draws selection
    const picked = await browserView.webContents.executeJavaScript(getPickerScript(mode));
    if (!picked) { mainWindow.webContents.send('pick-cancelled'); return; }

    const { cx, cy, mouseUpX, mouseUpY, bounds, mode: pickedMode } = picked;

    // Phase 2: element detection + popup in one script (shares live DOM refs for hover highlight)
    const result = await browserView.webContents.executeJavaScript(
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

    // Phase 3: CSS source refs via CDP
    await ensureCDP();
    const cssRefs = await getCSSSourceRefs({ cx, cy }).catch(() => []);

    // Phase 4: format source-first and write to PTY
    const message = formatSourceMessage({ items, cssRefs, instruction });
    if (ptyProcess) {
      ptyProcess.write(message);
      setTimeout(() => { if (ptyProcess) ptyProcess.write('\r'); }, 80);
    }

  } catch (err) {
    console.error('Pick error:', err);
    mainWindow.webContents.send('pick-cancelled');
  }
});

// ── IPC: screenshot ───────────────────────────────────────────────
ipcMain.on('pick-screenshot', async () => {
  try {
    // Phase 1: user draws the capture region
    const sel = await browserView.webContents.executeJavaScript(getScreenshotScript());
    if (!sel) { mainWindow.webContents.send('pick-cancelled'); return; }

    const { x, y, width, height, mouseUpX, mouseUpY } = sel;

    // Phase 2: capture that rectangle from the WebContentsView
    const image = await browserView.webContents.capturePage({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });

    // Phase 3: save PNG
    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const filename  = `screenshot-${Date.now()}.png`;
    const filepath  = path.join(screenshotsDir, filename);
    const pngBuffer = image.toPNG();
    fs.writeFileSync(filepath, pngBuffer);

    // Phase 4: show popup in browser with thumbnail preview
    const thumbB64 = pngBuffer.toString('base64');
    const popupResult = await browserView.webContents.executeJavaScript(
      getScreenshotPopupScript(thumbB64, mouseUpX, mouseUpY)
    );

    mainWindow.webContents.send('pick-cancelled');

    if (!popupResult) return;
    const { instruction } = popupResult;

    // Phase 5: write to PTY — Claude Code can read the file
    const msg = `[Screenshot: ${filepath}]${instruction ? '\n\n' + instruction : ''}`;
    if (ptyProcess) {
      ptyProcess.write(msg);
      setTimeout(() => { if (ptyProcess) ptyProcess.write('\r'); }, 80);
    }
  } catch (err) {
    console.error('Screenshot error:', err);
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

// ── Element context extraction ────────────────────────────────────
async function extractElementContext({ cx, cy }) {
  const dbg = browserView.webContents.debugger;

  let nodeId;
  try {
    const loc = await dbg.sendCommand('DOM.getNodeForLocation', {
      x: Math.round(cx), y: Math.round(cy),
      includeUserAgentShadowDOM: false,
    });
    nodeId = loc.nodeId;
    if (!nodeId) return null;
  } catch (e) { return null; }

  const [attrRes, htmlRes, cssRes, computedRes] = await Promise.all([
    dbg.sendCommand('DOM.getAttributes',          { nodeId }),
    dbg.sendCommand('DOM.getOuterHTML',           { nodeId }),
    dbg.sendCommand('CSS.getMatchedStylesForNode',{ nodeId }).catch(() => ({})),
    dbg.sendCommand('CSS.getComputedStyleForNode',{ nodeId }).catch(() => ({})),
  ]);

  // Fetch any new stylesheets we haven't seen yet
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

  // React fiber walk runs in the page context
  const reactInfo = await browserView.webContents.executeJavaScript(`
    (function() {
      const el = document.elementFromPoint(${Math.round(cx)}, ${Math.round(cy)});
      if (!el) return null;
      const key = Object.keys(el).find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return { hasReact: false };
      let fiber = el[key];
      const comps = [];
      while (fiber && comps.length < 5) {
        if (fiber.type && typeof fiber.type === 'function') {
          const name = fiber.type.displayName || fiber.type.name || '';
          if (name && !/^[a-z]/.test(name) && name !== 'Component' && name !== 'Fragment') {
            const src = fiber._debugSource;
            comps.push({
              name,
              file: src ? src.fileName : null,
              line: src ? src.lineNumber : null,
            });
          }
        }
        fiber = fiber.return;
      }
      return { hasReact: comps.length > 0, components: comps };
    })()
  `).catch(() => null);

  return formatContext({
    attributes: attrRes.attributes || [],
    outerHTML: htmlRes.outerHTML || '',
    cssRes,
    computedRes,
    reactInfo,
  });
}

// ── Context formatter ─────────────────────────────────────────────
function shortPath(url) {
  if (!url) return '';
  // Strip everything before /src/ for readability
  return url.replace(/^.*?\/src\//, 'src/').replace(/\?.*$/, '');
}

function formatContext({ attributes, outerHTML, cssRes, computedRes, reactInfo }) {
  const lines = [];
  lines.push('───── Element Context ─────');

  // React component tree
  if (reactInfo?.hasReact && reactInfo.components.length > 0) {
    reactInfo.components.forEach((c, i) => {
      const indent = '  '.repeat(i);
      const arrow  = i === 0 ? '' : '└─ ';
      const src    = c.file ? ` (${shortPath(c.file)}:${c.line})` : '';
      lines.push(`${indent}${arrow}${c.name}${src}`);
    });
  }

  // Opening tag (truncated)
  const tag = outerHTML.match(/^<[^>]*>/)?.[0] || '';
  lines.push(`<${tag.replace(/^</, '').substring(0, 180)}${tag.length > 180 ? '…' : ''}`);

  // Matched CSS rules (non-UA, with properties)
  const rules = (cssRes.matchedCSSRules || [])
    .filter(m => m.rule.origin !== 'user-agent' && (m.rule.style?.cssProperties?.length ?? 0) > 0)
    .slice(0, 8);

  if (rules.length > 0) {
    lines.push('CSS:');
    for (const { rule } of rules) {
      const selector = rule.selectorList.text;
      const props = (rule.style.cssProperties || [])
        .filter(p => p.value && !p.disabled && !p.implicit)
        .map(p => `${p.name}: ${p.value}`)
        .slice(0, 6)
        .join('; ');
      if (!props) continue;
      const sid  = rule.style.styleSheetId;
      const src  = sid && stylesheetMap[sid] ? `  ← ${shortPath(stylesheetMap[sid])}` : '';
      lines.push(`  ${selector} { ${props} }${src}`);
    }
  }

  // Key computed styles
  const WANT = new Set([
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'margin','font-size','font-weight','font-family',
    'color','background-color','display','flex-direction',
    'gap','border-radius','width','height','line-height','letter-spacing',
  ]);
  const SKIP_VALUES = new Set(['auto','none','normal','rgba(0, 0, 0, 0)','0px','transparent','']);
  const computed = (computedRes.computedStyle || [])
    .filter(p => WANT.has(p.name) && !SKIP_VALUES.has(p.value))
    .map(p => `${p.name}: ${p.value}`)
    .join('; ');
  if (computed) lines.push(`Computed: ${computed}`);

  lines.push('──────────────────────────');
  return lines.join('\n');
}

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
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
  if (ptyProcess) { try { ptyProcess.kill(); } catch (_) {} }
  if (process.platform !== 'darwin') app.quit();
});
