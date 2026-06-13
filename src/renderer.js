const { ipcRenderer } = require('electron');
const { Terminal }    = require('@xterm/xterm');
const { FitAddon }    = require('@xterm/addon-fit');
const { gsap }        = require('gsap');

// Canvas renderer: xterm 5's default DOM renderer mutates dozens of row
// elements per frame during heavy output. Canvas keeps that off the DOM
// entirely. Optional — falls back to the DOM renderer if it can't load.
let CanvasAddon = null;
try { ({ CanvasAddon } = require('@xterm/addon-canvas')); } catch (_) {}
function attachCanvasRenderer(term) {
  if (!CanvasAddon) return;
  try { term.loadAddon(new CanvasAddon()); } catch (_) {}
}
const { trashIcon, eyeIcon, chevronRightIcon } = require('./icons');

// HTML-escape for any text interpolated into innerHTML templates (escapes
// quotes too, so it is safe in attribute values). The ONLY escaping helper —
// don't add per-module copies.
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── localStorage keys ─────────────────────────────────────────────
// Single registry — get/set sites reference LS.* so key strings can't drift.
const LS = {
  theme:        'cathode-theme',
  apiKey:       'cathode-api-key',
  apiKeys:      'cathode-api-keys',
  profiles:     'cathode-profiles',
  auditTypes:   'cathode-audit-types',
  savedPrompts: 'cathode-saved-prompts',
  tabs:         'cathode-tabs',
  storybook:    'cathode-storybook',
  usageMini:    'cathode-usage-mini',
  onboarded:    'cathode-onboarded',
  projectDir:   'cathode-project-dir',
};

// ── Theme init ────────────────────────────────────────────────────
document.body.dataset.theme = localStorage.getItem(LS.theme) || 'minimal';

const TERMINAL_THEMES = {
  minimal: {
    background: '#131313', foreground: '#cccccc', cursor: '#4a9eff',
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
  localStorage.setItem(LS.theme, name);
  const termTheme = TERMINAL_THEMES[name] || TERMINAL_THEMES.minimal;
  TERM_OPTS.theme = termTheme;
  for (const s of sessions.values()) {
    if (s.type !== 'acp' && s.term) s.term.options.theme = termTheme;
  }
}

// ── Pin icons ─────────────────────────────────────────────────────
const ICON_PIN_UNPINNED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><line x1="9" y1="16.25" x2="9" y2="12.25"></line><path d="M14.25,12.25c-.089-.699-.318-1.76-.969-2.875-.335-.574-.703-1.028-1.031-1.375V3.75c0-1.105-.895-2-2-2h-2.5c-1.105,0-2,.895-2,2v4.25c-.329,.347-.697,.801-1.031,1.375-.65,1.115-.88,2.176-.969,2.875H14.25Z"></path></g></svg>`;
const ICON_PIN_PINNED   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g fill="currentColor"><path d="M9,17c-.414,0-.75-.336-.75-.75v-4c0-.414,.336-.75,.75-.75s.75,.336,.75,.75v4c0,.414-.336,.75-.75,.75Z"></path><path d="M13.929,8.997c-.266-.456-.578-.888-.929-1.288V3.75c0-1.517-1.233-2.75-2.75-2.75h-2.5c-1.517,0-2.75,1.233-2.75,2.75v3.959c-.352,.4-.663,.832-.929,1.288-.563,.965-.921,2.027-1.065,3.158-.027,.214,.039,.429,.181,.59,.143,.162,.348,.254,.563,.254H14.25c.215,0,.42-.093,.563-.254,.142-.162,.208-.376,.181-.59-.144-1.131-.502-2.193-1.065-3.158Z"></path></g></svg>`;
const ICON_PIN_REMOVE   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><g fill="currentColor"><path d="M3.75,13h1.25L13,5v-1.25c0-1.517-1.233-2.75-2.75-2.75h-2.5c-1.517,0-2.75,1.233-2.75,2.75v3.959c-.352,.4-.663,.832-.929,1.288-.563,.965-.921,2.027-1.065,3.158-.027,.214,.039,.429,.181,.59,.143,.162,.348,.254,.563,.254Z"></path><path d="M13.21,7.972l-4.96,5.028v3.25c0,.414,.336,.75,.75,.75s.75-.336,.75-.75v-3.25h4.5c.215,0,.42-.093,.563-.254,.142-.162,.208-.376,.181-.59-.144-1.131-.502-2.193-1.065-3.158-.21-.36-.456-.699-.72-1.025Z"></path><path d="M2,16.75c-.192,0-.384-.073-.53-.22-.293-.293-.293-.768,0-1.061L15.47,1.47c.293-.293,.768-.293,1.061,0s.293,.768,0,1.061L2.53,16.53c-.146,.146-.338,.22-.53,.22Z"></path></g></svg>`;

const TERM_OPTS = {
  cursorBlink: true,
  disableStdin: true,
  fontSize: 14,
  fontFamily: "'Space Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  fontWeight: '400',
  theme: TERMINAL_THEMES[localStorage.getItem(LS.theme)] || TERMINAL_THEMES.minimal,
  scrollback: 5000,
  allowProposedApi: true,
};

const PTY_SEND_DELAY  = 80;  // ms between paste() and sending Enter — gives PTY time to buffer
const MSG_HISTORY_MAX = 500;
const PANEL_ANIM_MS   = 220; // left-panel collapse/expand animation (matches CSS transition)
const PTY_MODEL_SWITCH_SETTLE_MS = 1300; // PTY has no "ready" signal — confirm model switch after this

// ── PTY Sessions ──────────────────────────────────────────────────
const ptySessionsEl = document.getElementById('pty-sessions');
const ptyTabsEl     = document.getElementById('pty-tabs-container');
// chat log / status removed
const chatLogEl    = null;
const chatStatusEl = null;
const sessions      = new Map(); // id → { name, term, fitAddon, el, ro }
let activeId        = null;
let nextId          = 1;

function getDefaultProfile() {
  return sessionProfiles[0] || { name: 'Claude Code', command: 'claude' };
}

function createSession(name, command, acp) {
  const profile = getDefaultProfile();
  const cmd     = command != null ? command : profile.command;
  const isAcp   = acp != null ? (acp === true) : (command == null && profile.acp === true);
  const id      = nextId++;
  const sName   = name || profile.name;

  if (isAcp) {
    createAcpSession(id, sName);
    return id;
  }

  const el = document.createElement('div');
  el.className = 'pty-session';
  ptySessionsEl.appendChild(el);

  const termEl = document.createElement('div');
  termEl.className = 'pty-term-wrap';
  el.appendChild(termEl);

  const term     = new Terminal(TERM_OPTS);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl);
  attachCanvasRenderer(term);
  term.onData(data => ipcRenderer.send('pty-input', { id, data }));

  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: term.cols, rows: term.rows });
  });
  ro.observe(termEl);

  ipcRenderer.send('pty-spawn', { id, command: cmd });
  sessions.set(id, {
    name: sName, command: cmd, term, fitAddon, el, termEl, ro,
    claudeLines: [], seenBulletTexts: new Set(), trackedLines: new Set(),
    chatTurnLine: Number.MAX_SAFE_INTEGER, rawLineBuffer: '', rawBulletFlag: false,
    chatMsgs: [], chatAiEl: null, chatDebounce: null, msgSent: false, headerShown: false,
  });
  switchSession(id);
  return id;
}


function createAcpSession(id, name) {
  const el = document.createElement('div');
  el.className = 'pty-session';
  ptySessionsEl.appendChild(el);

  const chatEl = document.createElement('div');
  chatEl.className = 'acp-chat';
  el.appendChild(chatEl);

  const msgsEl = document.createElement('div');
  msgsEl.className = 'acp-messages';
  chatEl.appendChild(msgsEl);

  // Terminal view — real xterm PTY (lazy-spawned on first switch)
  const termEl = document.createElement('div');
  termEl.className = 'pty-term-wrap';
  termEl.style.cssText = 'display:none;flex:1;min-height:0;';
  chatEl.appendChild(termEl);

  const acpTerm = new Terminal({ ...TERM_OPTS, disableStdin: false });
  const acpFit  = new FitAddon();
  acpTerm.loadAddon(acpFit);
  acpTerm.open(termEl);
  attachCanvasRenderer(acpTerm);
  acpTerm.onData(data => ipcRenderer.send('pty-input', { id, data }));

  const acpRo = new ResizeObserver(() => {
    if (termEl.style.display !== 'none') {
      acpFit.fit();
      ipcRenderer.send('pty-resize', { id, cols: acpTerm.cols, rows: acpTerm.rows });
    }
  });
  acpRo.observe(termEl);

  const statusEl = document.createElement('div');
  statusEl.className = 'acp-status';
  const dotEl = document.createElement('div');
  dotEl.className = 'acp-status-dot';
  const statusTextEl = document.createElement('span');
  statusTextEl.textContent = 'Connecting…';

  statusEl.appendChild(dotEl);
  statusEl.appendChild(statusTextEl);
  chatEl.appendChild(statusEl);

  sessions.set(id, {
    name, type: 'acp', el, chatEl, msgsEl, dotEl, statusTextEl,
    termEl, term: acpTerm, fitAddon: acpFit, ro: acpRo, _ptySpawned: false,
    viewMode: 'chat',
    toolCards: new Map(),
    streamEl: null, streamTextEl: null, streamMsgId: null,
  });
  ipcRenderer.send('acp-spawn', { id });
  switchSession(id);
}

function closeSession(id) {
  if (sessions.size <= 1) return;
  const s = sessions.get(id);
  if (!s) return;
  if (activeId === id) {
    const ids = [...sessions.keys()];
    const idx = ids.indexOf(id);
    switchSession(ids[idx + 1] ?? ids[idx - 1]);
  }
  if (s.type === 'acp') {
    ipcRenderer.send('acp-kill', { id });
    if (s._ptySpawned) ipcRenderer.send('pty-kill', { id });
    s.ro.disconnect();
    s.term.dispose();
  } else {
    s.ro.disconnect();
    s.term.dispose();
    ipcRenderer.send('pty-kill', { id });
  }
  s.el.remove();
  sessions.delete(id);
  renderPtyTabs();
}

const svtEl    = document.getElementById('session-view-toggle');
const svtThumb = document.getElementById('svt-thumb');

function updateSvtThumb() {
  const active = svtEl.querySelector('.svt-tab.active');
  if (!active) return;
  svtThumb.style.left  = active.offsetLeft + 'px';
  svtThumb.style.width = active.offsetWidth + 'px';
}

function switchAcpView(id, view) {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  s.viewMode = view;
  s.msgsEl.style.display  = view === 'chat' ? '' : 'none';
  s.termEl.style.display  = view === 'term' ? '' : 'none';
  if (view === 'term') {
    if (!s._ptySpawned) {
      s._ptySpawned = true;
      ipcRenderer.send('pty-spawn', { id, command: 'claude' });
    }
    refitSession(id, 50);
  }
  svtEl.querySelectorAll('.svt-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  updateSvtThumb();
}

svtEl.querySelectorAll('.svt-tab').forEach(btn => {
  btn.addEventListener('click', () => switchAcpView(activeId, btn.dataset.view));
});

function syncSvt(s) {
  if (!s) { svtEl.style.display = 'none'; return; }
  svtEl.style.display = '';
  const isAcp = s.type === 'acp';
  svtEl.querySelectorAll('.svt-tab').forEach(b => {
    const isChat = b.dataset.view === 'chat';
    b.style.display = (!isAcp && isChat) ? 'none' : '';
    b.classList.toggle('active', isAcp ? b.dataset.view === s.viewMode : b.dataset.view === 'term');
  });
  requestAnimationFrame(updateSvtThumb);
}

// ── Model selector ────────────────────────────────────────────────
const modelWrap  = document.getElementById('model-wrap');
const btnModel   = document.getElementById('btn-model');
const modelLabel = document.getElementById('btn-model-label');
const modelMenu  = document.getElementById('model-menu');

function currentModelLabel(s, key) {
  const cat = MODEL_CATALOG[key];
  if (!cat) return 'Model';
  const sel = cat.models.find(m => m.id === (s.model || ''));
  return sel ? sel.label : (cat.models[0] ? cat.models[0].label : 'Model');
}

function renderModelSelector() {
  const s = sessions.get(activeId);
  const key = sessionToolKey(s);
  if (!s || !key) { modelWrap.style.display = 'none'; return; }
  modelWrap.style.display = '';
  if (s.model === undefined) s.model = MODEL_CATALOG[key].models[0]?.id ?? '';
  modelLabel.textContent = currentModelLabel(s, key);

  modelMenu.innerHTML = '';
  MODEL_CATALOG[key].models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === (s.model || '') ? ' selected' : '');
    item.innerHTML =
      `<svg class="model-check" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 5,9 10,3"></polyline></svg>` +
      `<span class="model-item-label"></span>`;
    item.querySelector('.model-item-label').textContent = m.label;
    item.addEventListener('click', () => {
      modelMenu.classList.remove('open');
      btnModel.classList.remove('active');
      if (m.id === (s.model || '')) return;
      selectModel(m.id);
    });
    modelMenu.appendChild(item);
  });
}

// ── Toasts ────────────────────────────────────────────────────────
const toastStack = document.getElementById('toast-stack');
function showToast(text, { spinner = false, duration = 0 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (spinner) {
    const sp = document.createElement('div');
    sp.className = 'toast-spinner';
    el.appendChild(sp);
  }
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  toastStack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = null;
  function dismiss() {
    if (!el.isConnected) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
    if (timer) { clearTimeout(timer); timer = null; }
  }
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { dismiss, el };
}

function selectModel(modelId) {
  const s = sessions.get(activeId);
  const key = sessionToolKey(s);
  if (!s || !key) return;
  s.model = modelId;
  const label = (MODEL_CATALOG[key].models.find(m => m.id === modelId) || {}).label || modelId || 'Default';

  if (s._modelToast) s._modelToast.dismiss();
  s._modelToast = showToast(`Switching to ${label}…`, { spinner: true });
  s._pendingModelLabel = label;

  if (s.type === 'acp') {
    // Restart the Claude ACP adapter with the chosen model.
    // The toast is dismissed in the acp-ready handler once it reconnects.
    acpSetStatus(s, 'connecting');
    s.statusTextEl.textContent = 'Switching model…';
    ipcRenderer.send('acp-kill', { id: activeId });
    ipcRenderer.send('acp-spawn', { id: activeId, model: modelId });
  } else {
    s.term.clear();
    ipcRenderer.send('pty-restart', { id: activeId, command: commandWithModel(s.command, key, modelId) });
    // PTY has no clean "ready" signal — confirm shortly after relaunch.
    setTimeout(() => finishModelSwitch(s), PTY_MODEL_SWITCH_SETTLE_MS);
  }
  renderModelSelector();
}

// Dismiss the "switching…" toast and flash a brief confirmation
function finishModelSwitch(s) {
  if (!s || !s._modelToast) return;
  s._modelToast.dismiss();
  s._modelToast = null;
  showToast(`Model: ${s._pendingModelLabel || ''}`.trim(), { duration: 1800 });
  s._pendingModelLabel = null;
}

// ── Usage panel ───────────────────────────────────────────────────
const usagePanel   = document.getElementById('usage-panel');
const usageBody    = document.getElementById('usage-body');
const usageModelEl = document.getElementById('usage-model');
const btnUsage     = document.getElementById('btn-usage');
const usageViewFull = document.getElementById('usage-view-full');
const usageViewMini = document.getElementById('usage-view-mini');
let usageOpen = false;
let usageMini = localStorage.getItem(LS.usageMini) === '1';
let _lastUsage = null;

function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function barClass(pct) { return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : ''; }

function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const opts = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return 'Resets ' + d.toLocaleString(undefined, opts);
}

function usageBarRow(label, pct, sub) {
  pct = Math.max(0, Math.min(100, pct || 0));
  return `
    <div class="usage-row">
      <div class="usage-row-head">
        <span class="usage-row-label">${label}</span>
        <span class="usage-row-value">${pct.toFixed(0)}% used</span>
      </div>
      <div class="usage-bar"><div class="usage-bar-fill ${barClass(pct)}" style="width:${pct}%"></div></div>
      ${sub ? `<div class="usage-sub">${sub}</div>` : ''}
    </div>`;
}

// Semicircle gauge (speedometer style) for the compact view.
// `color` overrides the threshold coloring with a fixed fill.
function gaugeSvg(pct, color) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const fillStyle = color ? ` style="stroke:${color}"` : '';
  const fillCls   = color ? '' : ` ${barClass(pct)}`;
  return `<svg class="gauge" width="58" height="35" viewBox="0 0 80 48">
    <path class="g-track" fill="none" stroke-linecap="round" d="M8,44 A32,32 0 0 1 72,44" pathLength="100"></path>
    <path class="g-fill${fillCls}"${fillStyle} fill="none" stroke-linecap="round" d="M8,44 A32,32 0 0 1 72,44" pathLength="100" stroke-dasharray="${pct} 100"></path>
    <text class="g-pct" x="40" y="43">${Math.round(pct)}%</text>
  </svg>`;
}

function usageMiniItem(labelHtml, pct, sub, color) {
  return `<div class="usage-mini-item">
    <div class="umi-main">
      ${gaugeSvg(pct, color)}
      <div class="umi-label">${labelHtml}</div>
    </div>
    <div class="umi-sub">${sub || ''}</div>
  </div>`;
}

function renderUsage({ ctx, lim, isClaude }) {
  usageModelEl.textContent = (ctx && ctx.ok && ctx.model) ? ctx.model : '';

  // Build the shared metric list (each: full label, compact label, %, sub-line)
  const metrics = [];
  if (isClaude && ctx && ctx.ok) {
    const pct = ctx.contextWindow ? (ctx.contextTokens / ctx.contextWindow) * 100 : 0;
    metrics.push({
      label: 'Context window', mini: 'Context<br>Window', pct,
      sub: `${fmtTokens(ctx.contextTokens)}/${fmtTokens(ctx.contextWindow)} tokens`,
    });
  }
  if (lim && lim.ok) {
    metrics.push({
      label: 'Current session (5h)', mini: 'Usage limit:<br>This session',
      pct: lim.fiveHour.utilization, sub: fmtReset(lim.fiveHour.resetsAt),
      color: '#B32D2D',
    });
    if (lim.sevenDay) metrics.push({
      label: 'Current week (all models)', mini: 'Usage limit:<br>Current week',
      pct: lim.sevenDay.utilization, sub: fmtReset(lim.sevenDay.resetsAt),
      color: '#B32D2D',
    });
  }

  if (!metrics.length) {
    const authIssue = lim && lim.reason === 'auth';
    usageBody.innerHTML = `<div class="usage-empty"></div>`;
    usageBody.firstChild.textContent = authIssue
      ? 'Sign in to Claude Code to see usage limits.'
      : (isClaude ? 'No usage data yet for this session.' : 'Usage limits require a Claude sign-in.');
    return;
  }

  usageBody.innerHTML = usageMini
    ? `<div class="usage-mini">${metrics.map(m => usageMiniItem(m.mini, m.pct, m.sub, m.color)).join('')}</div>`
    : metrics.map(m => usageBarRow(m.label, m.pct, m.sub)).join('');
}

async function refreshUsage() {
  if (!usageOpen) return;
  const s = sessions.get(activeId);
  const isClaude = !!(s && s.type === 'acp');
  const [ctx, lim] = await Promise.all([
    isClaude ? ipcRenderer.invoke('get-usage', { cwd: s.cwd || '' }) : Promise.resolve(null),
    ipcRenderer.invoke('get-rate-limits'),
  ]);
  _lastUsage = { ctx, lim, isClaude };
  renderUsage(_lastUsage);
}

function setUsageView(mini) {
  usageMini = mini;
  localStorage.setItem(LS.usageMini, mini ? '1' : '0');
  usageViewFull.classList.toggle('active', !mini);
  usageViewMini.classList.toggle('active', mini);
  if (_lastUsage) renderUsage(_lastUsage);   // re-render from cache (no refetch)
  else refreshUsage();
}
usageViewFull.addEventListener('click', () => setUsageView(false));
usageViewMini.addEventListener('click', () => setUsageView(true));
usageViewFull.classList.toggle('active', !usageMini);
usageViewMini.classList.toggle('active', usageMini);

btnUsage.addEventListener('click', () => {
  usageOpen = !usageOpen;
  usagePanel.style.display = usageOpen ? '' : 'none';
  btnUsage.classList.toggle('active', usageOpen);
  if (usageOpen) refreshUsage();
});

btnModel.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = modelMenu.classList.toggle('open');
  btnModel.classList.toggle('active', open);
});
document.addEventListener('click', (e) => {
  if (!modelMenu.classList.contains('open')) return;
  if (modelWrap.contains(e.target)) return;
  modelMenu.classList.remove('open');
  btnModel.classList.remove('active');
});

// ── Figma quick actions (composer) ────────────────────────────────
// Shown only when a `figma` MCP server is connected. Selecting an action
// drops a chip into the composer; on send, the chip's instruction is
// prepended so the agent invokes the matching Figma MCP tool.
const FIGMA_ACTIONS = [
  { key: 'build',  group: 'Framelink (paste a Figma URL)', title: 'Build Selected Frame',
    desc: "Turn a Figma frame into production code. Paste the frame's URL — it pulls the layout, styles, and assets and builds it.",
    instruction: "Using the Figma MCP (Framelink figma-developer-mcp), call get_figma_data on the Figma URL provided in this message, then build it as production-ready code that faithfully matches the layout, auto-layout/spacing, colors, typography, and assets. Download any required images/icons with download_images." },
  { key: 'specs',  group: 'Framelink (paste a Figma URL)', title: 'Extract Design Specs',
    desc: "Pull exact specs from a Figma URL: spacing, sizes, colors (hex), and full typography — no eyeballing.",
    instruction: "Using the Figma MCP (Framelink), call get_figma_data on the Figma URL provided and return a structured spec: layout/auto-layout, spacing, element sizes, colors (hex), typography (family, size, weight, line-height, letter-spacing), and border radii." },
  { key: 'icons',  group: 'Framelink (paste a Figma URL)', title: 'Extract Icons',
    desc: "Export the vector / SVG icons inside a Figma frame to files.",
    instruction: "Using the Figma MCP (Framelink), identify the vector/icon nodes within the Figma URL provided and export them as SVG via download_images. List each icon with its name and saved file path." },
  { key: 'images', group: 'Framelink (paste a Figma URL)', title: 'Extract Images',
    desc: "Download the raster images (PNG / JPG) used in a Figma frame.",
    instruction: "Using the Figma MCP (Framelink), download the raster images (PNG/JPG) referenced in the Figma URL provided via download_images. List each with its name, dimensions, and saved file path." },
  { key: 'styles', group: 'Framelink (paste a Figma URL)', title: 'List Styles',
    desc: "List every color and text style used in a Figma file, with their values, and flag off-system ones.",
    instruction: "Using the Figma MCP (Framelink), call get_figma_data on the Figma URL provided and list every color style and text style used (grouped, with their values). Flag any values that look inconsistent or off-system." },
  { key: 'variables', group: 'Dev Mode desktop app (uses your selection)', title: 'Extract Variables',
    desc: "Read the design variables / tokens bound to your current selection in the Figma desktop app.",
    instruction: "Using the Figma Dev Mode MCP server, call get_variable_defs on my current Figma selection and return all bound design variables/tokens (color, spacing, typography, radius) with their names and resolved values." },
  { key: 'create', group: 'Dev Mode desktop app (uses your selection)', title: 'Create Selection',
    desc: "Generate code for whatever you've selected in the Figma desktop app, using your framework and tokens.",
    instruction: "Using the Figma Dev Mode MCP server, generate code for my current Figma selection (get_code). Use the framework I specify (default to this project's framework), our design tokens, and our existing components where available." },
  { key: 'token',  group: 'Dev Mode desktop app (uses your selection)', title: 'Locate Design Token',
    desc: "Map your Figma selection to your real codebase components via Code Connect, instead of generic markup.",
    instruction: "Using the Figma Dev Mode MCP server with Code Connect (get_code_connect_map), map my current Figma selection to our real codebase components and return those components instead of generic markup. If a node has no mapping, note it explicitly." },
];

const FIGMA_GLYPH = `<svg class="figma-glyph" viewBox="0 0 38 57" width="9" height="13" xmlns="http://www.w3.org/2000/svg"><path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 1 1-19 0z"/><path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z"/><path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z"/><path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/><path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/></svg>`;

const INFO_ICON = `<svg viewBox="0 0 18 18" width="13" height="13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="7.25"/><path d="M6.925,6.619c.388-1.057,1.294-1.492,2.18-1.492,.895,0,1.818,.638,1.818,1.808,0,1.784-1.816,1.468-2.096,3.065"/><path d="M8.791,13.567c-.552,0-1-.449-1-1s.448-1,1-1,1,.449,1,1-.448,1-1,1Z" fill="currentColor" stroke="none"/></svg>`;

const figmaWrap   = document.getElementById('figma-wrap');
const btnFigma    = document.getElementById('btn-figma');
const figmaMenu   = document.getElementById('figma-menu');
const composerChips = document.getElementById('composer-chips');
let figmaChips = [];   // [{key,title,instruction}]

// Hover tooltip (positioned to the LEFT of the menu so it stays within
// the HTML panel rather than over a native view on the right).
let figmaTipEl = null;
function showFigmaTip(item, text) {
  if (!figmaTipEl) {
    figmaTipEl = document.createElement('div');
    figmaTipEl.className = 'figma-tip';
    document.body.appendChild(figmaTipEl);
  }
  const tip = figmaTipEl;
  tip.textContent = text;
  tip.style.left = '-9999px'; tip.style.top = '-9999px';
  tip.classList.add('show');
  const r = item.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left - tr.width - 10;
  if (left < 8) left = Math.min(r.right + 10, window.innerWidth - tr.width - 8);
  let top = r.top + (r.height - tr.height) / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - tr.height - 8));
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}
function hideFigmaTip() {
  if (figmaTipEl) figmaTipEl.classList.remove('show');
}

(function buildFigmaMenu() {
  const clipHint = document.createElement('div');
  clipHint.className = 'figma-clip-hint';
  clipHint.style.display = 'none';
  figmaMenu.appendChild(clipHint);
  let lastGroup = null;
  FIGMA_ACTIONS.forEach(a => {
    if (a.group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'figma-group-label';
      g.textContent = a.group;
      figmaMenu.appendChild(g);
      lastGroup = a.group;
    }
    const item = document.createElement('div');
    item.className = 'figma-menu-item';
    const info = document.createElement('span');
    info.className = 'figma-info-btn';
    info.innerHTML = INFO_ICON;
    const label = document.createElement('span');
    label.className = 'figma-item-label';
    label.textContent = a.title;
    item.appendChild(info);
    item.appendChild(label);
    // Tooltip shows immediately when hovering the info icon
    info.addEventListener('mouseenter', () => showFigmaTip(info, a.desc));
    info.addEventListener('mouseleave', hideFigmaTip);
    item.addEventListener('click', () => {
      hideFigmaTip();
      addFigmaChip(a);
      figmaMenu.classList.remove('open');
      btnFigma.classList.remove('active');
    });
    figmaMenu.appendChild(item);
  });
})();

const FIGMA_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/[^\s]+/i;
async function getClipboardFigmaUrl() {
  try {
    const text = await ipcRenderer.invoke('clipboard-read');
    const m = (text || '').match(FIGMA_URL_RE);
    return m ? m[0] : '';
  } catch (_) { return ''; }
}
function truncUrl(u) {
  const s = u.replace(/^https?:\/\/(?:www\.)?figma\.com/i, '') || u;
  return '…' + (s.length > 22 ? s.slice(0, 22) + '…' : s);
}

function renderFigmaChips() {
  composerChips.innerHTML = '';
  figmaChips.forEach((c, i) => {
    const incomplete = c.needsUrl && !c.url;
    const chip = document.createElement('span');
    chip.className = 'composer-chip' + (incomplete ? ' incomplete' : '');
    chip.dataset.key = c.key;

    const glyph = document.createElement('span');
    glyph.innerHTML = FIGMA_GLYPH;
    chip.appendChild(glyph.firstChild);

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = c.title;
    chip.appendChild(label);

    if (c.needsUrl) {
      const url = document.createElement('span');
      url.className = 'chip-url' + (c.url ? '' : ' empty');
      url.textContent = c.url ? truncUrl(c.url) : 'Paste Figma URL';
      url.title = c.url || 'Click to paste your Figma URL';
      url.addEventListener('click', (e) => { e.stopPropagation(); editChipUrl(c, chip); });
      chip.appendChild(url);
    }

    const x = document.createElement('button');
    x.className = 'chip-x';
    x.title = 'Remove';
    x.textContent = '✕';
    x.addEventListener('click', () => { figmaChips.splice(i, 1); renderFigmaChips(); });
    chip.appendChild(x);

    composerChips.appendChild(chip);
  });
  composerChips.classList.toggle('has-chips', figmaChips.length > 0);
}

function editChipUrl(c, chip) {
  const urlEl = chip.querySelector('.chip-url');
  if (!urlEl) return;
  const input = document.createElement('input');
  input.className = 'chip-url-input';
  input.value = c.url || '';
  input.placeholder = 'Paste Figma URL';
  urlEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = () => { if (done) return; done = true; c.url = input.value.trim(); renderFigmaChips(); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); commit(); uiTextarea.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); done = true; renderFigmaChips(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);
}
function focusChipUrl(key) {
  const chip = composerChips.querySelector(`.composer-chip[data-key="${key}"]`);
  const c = figmaChips.find(x => x.key === key);
  if (chip && c) editChipUrl(c, chip);
}

async function addFigmaChip(a) {
  if (figmaChips.some(c => c.key === a.key)) return;   // no dupes
  const needsUrl = a.group.startsWith('Framelink');
  const url = needsUrl ? await getClipboardFigmaUrl() : '';
  figmaChips.push({ key: a.key, title: a.title, instruction: a.instruction, needsUrl, url });
  renderFigmaChips();
  if (needsUrl && !url) focusChipUrl(a.key);   // nothing in clipboard → prompt to paste
  else uiTextarea.focus();
}
function clearFigmaChips() { figmaChips = []; renderFigmaChips(); }

btnFigma.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = figmaMenu.classList.toggle('open');
  btnFigma.classList.toggle('active', open);
  if (!open) { hideFigmaTip(); return; }
  // Surface whether a Figma link is ready in the clipboard
  const hint = figmaMenu.querySelector('.figma-clip-hint');
  const url = await getClipboardFigmaUrl();
  if (hint) {
    hint.textContent = url ? '📋 Figma link in clipboard — Framelink actions will use it' : '';
    hint.style.display = url ? 'block' : 'none';
  }
});
document.addEventListener('click', (e) => {
  if (!figmaMenu.classList.contains('open')) return;
  if (figmaWrap.contains(e.target)) return;
  figmaMenu.classList.remove('open');
  btnFigma.classList.remove('active');
  hideFigmaTip();
});

async function refreshFigmaTool() {
  try {
    const { connected } = await ipcRenderer.invoke('mcp-has-server', { name: 'figma' });
    figmaWrap.style.display = connected ? '' : 'none';
    if (!connected) clearFigmaChips();
  } catch (_) { figmaWrap.style.display = 'none'; }
}
refreshFigmaTool();

// Re-fit a session's terminal to its container and tell the PTY the new size.
// No-ops for ACP sessions showing the chat view (their terminal is hidden).
// `delay` lets layout/animation settle before measuring.
function refitSession(id, delay = 0) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'acp' && s.viewMode !== 'term') return;
  setTimeout(() => {
    s.fitAddon.fit();
    ipcRenderer.send('pty-resize', { id, cols: s.term.cols, rows: s.term.rows });
  }, delay);
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
  refitSession(id);
  syncSvt(s);
  renderModelSelector();
  refreshUsage();
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

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'pty-tab-settings';
    settingsBtn.title = 'Session settings';
    settingsBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
    settingsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rect = settingsBtn.getBoundingClientRect();
      ipcRenderer.send('show-tab-settings-menu', { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) });
    });
    tab.appendChild(settingsBtn);

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

const SPINNER_RE  = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
// Strips CSI (ESC [ … letter), OSC (ESC ] … BEL or ST), and 2-char ESC sequences.
// Used only for ● detection; xterm.js gets the original bytes for rendering.
const ANSI_STRIP_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;

ipcRenderer.on('pty-output', (_, { id, data }) => {
  const s = sessions.get(id);
  if (!s) return;
  if (s.type === 'acp') {
    s.term.write(data);
    return;
  }

  /* ── Chat-from-terminal detection (disabled — pivoted to stream-json) ──
  {
    const stripped = data.replace(ANSI_STRIP_RE, '');
    const lines = (s.rawLineBuffer + stripped).split('\n');
    s.rawLineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const segs = line.split('\r');
      let content = '';
      for (let i = segs.length - 1; i >= 0; i--) {
        if (segs[i]) { content = segs[i]; break; }
      }
      const trimmed = content.trimStart();
      if (trimmed.startsWith('●') || trimmed.startsWith('•')) {
        s.rawBulletFlag = true;
        break;
      }
    }
  }
  ── end disabled block ── */

  s.term.write(data, () => {
    /* disabled: if (s.rawBulletFlag) {
      s.rawBulletFlag = false;
      if (scanBufferForBullets(id)) updateChatAi(id);
    } */
    const hasBullet  = data.includes('●') || data.includes('•');
    const hasSpinner = SPINNER_RE.test(data);
  });
});


document.getElementById('btn-restart').addEventListener('click', () => {
  const s = sessions.get(activeId);
  if (!s || s.type === 'acp') return;
  s.term.clear();
  ipcRenderer.send('pty-restart', { id: activeId, command: s.command });
});

// ── Session Profiles ─────────────────────────────────────────────
const PROFILES_KEY = LS.profiles;
const DEFAULT_PROFILES = [
  { id: 'claude', name: 'Claude Code', command: 'claude', acp: true },
];

const AVAILABLE_MODELS = [
  { id: 'codex',  name: 'OpenAI Codex CLI', desc: "OpenAI's AI coding agent for the terminal",       install: 'npm install -g @openai/codex',                                                              command: 'codex'  },
  { id: 'gemini', name: 'Gemini CLI',        desc: "Google's AI assistant for the command line",      install: 'npm install -g @google/gemini-cli',                                                         command: 'gemini' },
  { id: 'aider',  name: 'Aider',             desc: 'AI pair programming in your terminal',            install: 'curl -fsSL https://aider.chat/install.sh | sh',                                             command: 'aider'  },
  { id: 'llm',    name: 'LLM CLI',           desc: 'Multi-model CLI tool, supports many providers',   install: 'curl -LsSf https://astral.sh/uv/install.sh | sh && ~/.local/bin/uv tool install llm',       command: 'llm'    },
];

// ── Per-tool model catalog ────────────────────────────────────────
// `flag` is the CLI flag used to launch the tool with a model (PTY tools).
// Claude (ACP) is special-cased: model is applied via ANTHROPIC_MODEL on respawn.
// `id: ''` means "tool default" (no flag / inherit settings).
const MODEL_CATALOG = {
  claude: { flag: '--model', models: [
    { id: '',       label: 'Default (settings)' },
    { id: 'opus',   label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku',  label: 'Haiku' },
  ]},
  codex: { flag: '--model', models: [
    { id: '',            label: 'Default' },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'gpt-5',       label: 'GPT-5' },
    { id: 'o4-mini',     label: 'o4-mini' },
    { id: 'o3',          label: 'o3' },
  ]},
  gemini: { flag: '-m', models: [
    { id: '',                 label: 'Default' },
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ]},
  aider: { flag: '--model', models: [
    { id: '',         label: 'Default' },
    { id: 'sonnet',   label: 'Claude Sonnet' },
    { id: 'opus',     label: 'Claude Opus' },
    { id: 'gpt-4o',   label: 'GPT-4o' },
    { id: 'gpt-4.1',  label: 'GPT-4.1' },
    { id: 'deepseek', label: 'DeepSeek' },
  ]},
  llm: { flag: '-m', models: [
    { id: '',                  label: 'Default' },
    { id: 'gpt-4o',            label: 'GPT-4o' },
    { id: 'gpt-4o-mini',       label: 'GPT-4o mini' },
    { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro' },
  ]},
};

// Map a session to its tool key in MODEL_CATALOG (or null if no models known)
function sessionToolKey(s) {
  if (!s) return null;
  if (s.type === 'acp') return 'claude';
  const base = (s.command || '').trim().split(/\s+/)[0].replace(/.*\//, '');
  return MODEL_CATALOG[base] ? base : null;
}

// Build a PTY launch command for a base command + chosen model
function commandWithModel(baseCommand, toolKey, modelId) {
  const cat = MODEL_CATALOG[toolKey];
  if (!cat || !cat.flag || !modelId) return baseCommand;
  return `${baseCommand} ${cat.flag} ${modelId}`;
}

let sessionProfiles = (() => {
  try {
    const s = localStorage.getItem(PROFILES_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      // Migrate: claude profile gets acp:true; all others default to acp:false
      return parsed.map(p => p.id === 'claude'
        ? { ...p, acp: p.acp !== false }
        : { ...p, acp: p.acp === true });
    }
  } catch (_) {}
  return DEFAULT_PROFILES.map(p => ({ ...p }));
})();

function saveProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(sessionProfiles));
}

// ── Profile dropdown ──────────────────────────────────────────────
const profileMenu   = document.getElementById('profile-menu');
const btnNewPty     = document.getElementById('btn-new-pty');

function renderProfileMenu() {
  profileMenu.innerHTML = '';
  sessionProfiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = 'profile-item';
    item.textContent = profile.name;
    item.addEventListener('click', () => {
      profileMenu.classList.remove('open');
      createSession(profile.name, profile.command, profile.acp);
    });
    profileMenu.appendChild(item);
  });
  const divider = document.createElement('div');
  divider.className = 'audit-divider';
  profileMenu.appendChild(divider);
  const manage = document.createElement('div');
  manage.className = 'profile-item profile-item-manage';
  manage.textContent = 'Manage profiles…';
  manage.addEventListener('click', () => {
    profileMenu.classList.remove('open');
    openProfilesModal();
  });
  profileMenu.appendChild(manage);
}

btnNewPty.addEventListener('click', () => {
  renderProfileMenu();
  profileMenu.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (!profileMenu.classList.contains('open')) return;
  if (!btnNewPty.closest('#new-pty-wrap').contains(e.target)) profileMenu.classList.remove('open');
});

// ── Profiles modal ────────────────────────────────────────────────
const profilesModal    = document.getElementById('profiles-modal');
const profilesList     = document.getElementById('profiles-list');

const DELETE_ICON_SVG = trashIcon(15);
const AP_CHEVRON_SVG  = chevronRightIcon(11);

function addProfileCard(name = '', command = '', startExpanded = false, profileId = '') {
  const card = document.createElement('div');
  card.className = 'ap-card' + (startExpanded ? ' expanded' : '');
  card.dataset.profileId = profileId;   // identity survives deletions/reordering
  card.innerHTML = `
    <div class="ap-card-row">
      <button class="ap-chevron" title="Expand">${AP_CHEVRON_SVG}</button>
      <span class="ap-card-name">${escHtml(name) || '<em>Untitled</em>'}</span>
      <button class="ap-delete" title="Remove">${DELETE_ICON_SVG}</button>
    </div>
    <div class="ap-card-body" style="${startExpanded ? '' : 'display:none'}">
      <span class="ap-field-title">Profile Name</span>
      <input class="ap-label" placeholder="e.g. Claude Code" value="${escHtml(name)}" />
      <span class="ap-field-title">Command</span>
      <input class="ap-label profile-cmd" placeholder="e.g. claude" value="${escHtml(command)}" />
    </div>
  `;
  const row     = card.querySelector('.ap-card-row');
  const body    = card.querySelector('.ap-card-body');
  const nameEl  = card.querySelector('.ap-card-name');
  const nameIn  = card.querySelector('.ap-label');

  function toggle() {
    const open = card.classList.toggle('expanded');
    body.style.display = open ? '' : 'none';
  }

  row.addEventListener('click', e => {
    if (e.target.closest('.ap-delete')) return;
    toggle();
  });

  nameIn.addEventListener('input', () => {
    nameEl.textContent = nameIn.value || '';
    if (!nameIn.value) nameEl.innerHTML = '<em>Untitled</em>';
  });

  card.querySelector('.ap-delete').addEventListener('click', () => card.remove());
  profilesList.appendChild(card);
}

const profilesModalCtl = wireModal(profilesModal, {
  onClose: () => _installListeners.forEach(fn => fn()),   // detach streaming-install listeners
});

function openProfilesModal() {
  profilesList.innerHTML = '';
  sessionProfiles.forEach(p => addProfileCard(p.name, p.command, false, p.id));
  switchProfilesTab('mine');
  profilesModalCtl.open();
}

function switchProfilesTab(tab) {
  document.querySelectorAll('.profiles-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('profiles-tab-mine').style.display    = tab === 'mine'    ? '' : 'none';
  document.getElementById('profiles-tab-install').style.display = tab === 'install' ? '' : 'none';
  document.getElementById('profiles-footer-mine').style.display    = tab === 'mine'    ? '' : 'none';
  document.getElementById('profiles-footer-install').style.display = tab === 'install' ? '' : 'none';
  if (tab === 'install') renderInstallModels();
}

// Active install listeners keyed by installId so we can clean them up
const _installListeners = new Map();

function renderInstallModels() {
  const list = document.getElementById('install-models-list');
  list.innerHTML = '';
  AVAILABLE_MODELS.forEach(model => {
    const alreadyAdded = sessionProfiles.some(p => p.command === model.command);
    const card = document.createElement('div');
    card.className = 'im-card';
    card.innerHTML = `
      <div class="im-header">
        <span class="im-name">${model.name}</span>
        <span class="im-badge checking">Checking…</span>
      </div>
      <span class="im-desc">${model.desc}</span>
      <code class="im-cmd">${model.install}</code>
      <button class="im-btn${alreadyAdded ? ' added' : ''}" disabled>${alreadyAdded ? 'Added ✓' : '…'}</button>
      <pre class="im-progress" style="display:none"></pre>
    `;
    list.appendChild(card);
    const badge      = card.querySelector('.im-badge');
    const btn        = card.querySelector('.im-btn');
    const progressEl = card.querySelector('.im-progress');

    ipcRenderer.invoke('check-model', { command: model.command }).then(installed => {
      badge.textContent = installed ? 'Installed' : 'Not installed';
      badge.className   = `im-badge ${installed ? 'installed' : 'not-installed'}`;
      if (alreadyAdded) return;
      btn.disabled = false;
      if (installed) {
        btn.textContent = 'Add Profile';
        btn.addEventListener('click', () => {
          sessionProfiles.push({ id: `profile-${Date.now()}`, name: model.name, command: model.command, acp: false });
          saveProfiles();
          btn.textContent = 'Added ✓';
          btn.classList.add('added');
          btn.disabled = true;
        });
      } else {
        btn.textContent = 'Install';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Installing…';
          badge.textContent = 'Installing…';
          badge.className = 'im-badge checking';
          progressEl.style.display = '';
          progressEl.textContent = `$ ${model.install}\n`;

          const installId = `install-${Date.now()}`;

          const onProgress = (_, { installId: iid, text }) => {
            if (iid !== installId) return;
            progressEl.textContent += text;
            progressEl.scrollTop = progressEl.scrollHeight;
          };
          const onDone = (_, { installId: iid }) => {
            if (iid !== installId) return;
            cleanup();
            badge.textContent = 'Installed';
            badge.className = 'im-badge installed';
            btn.textContent = 'Added ✓';
            btn.classList.add('added');
            progressEl.textContent += '\n✓ Done';
            if (!sessionProfiles.some(p => p.command === model.command)) {
              sessionProfiles.push({ id: `profile-${Date.now()}`, name: model.name, command: model.command, acp: false });
              saveProfiles();
            }
          };
          const onError = (_, { installId: iid, code, message }) => {
            if (iid !== installId) return;
            cleanup();
            badge.textContent = 'Failed';
            badge.className = 'im-badge not-installed';
            btn.disabled = false;
            btn.textContent = 'Retry';
            progressEl.textContent += `\n✗ Failed (exit ${code ?? ''} ${message ?? ''})`;
          };

          function cleanup() {
            ipcRenderer.off('profile-install-progress', onProgress);
            ipcRenderer.off('profile-install-done',     onDone);
            ipcRenderer.off('profile-install-error',    onError);
            _installListeners.delete(installId);
          }

          ipcRenderer.on('profile-install-progress', onProgress);
          ipcRenderer.on('profile-install-done',     onDone);
          ipcRenderer.on('profile-install-error',    onError);
          _installListeners.set(installId, cleanup);

          ipcRenderer.send('profile-install', { installId, command: model.install });
        });
      }
    });
  });
}

document.getElementById('profiles-add').addEventListener('click', () => addProfileCard('', '', true));

document.getElementById('profiles-save').addEventListener('click', () => {
  const cards = profilesList.querySelectorAll('.ap-card');
  const updated = [];
  cards.forEach((card, i) => {
    const inputs = card.querySelectorAll('input');
    const name   = inputs[0].value.trim();
    const command = inputs[1].value.trim();
    if (name && command) {
      // Match by stored id, NOT by index — after a deletion, index pairing
      // shifted and could hand another profile Claude's acp flag.
      const existing = sessionProfiles.find(p => p.id === card.dataset.profileId);
      updated.push({ id: existing?.id || `profile-${Date.now()}-${i}`, name, command, acp: existing?.acp === true });
    }
  });
  if (!updated.length) return;
  sessionProfiles = updated;
  saveProfiles();
  profilesModalCtl.close();
});

document.getElementById('btn-manage-profiles')?.addEventListener('click', () => openProfilesModal());

document.getElementById('profiles-cancel').addEventListener('click', () => profilesModalCtl.close());
document.getElementById('profiles-install-done').addEventListener('click', () => profilesModalCtl.close());

document.querySelectorAll('.profiles-tab').forEach(btn => {
  btn.addEventListener('click', () => switchProfilesTab(btn.dataset.tab));
});

// ── Modal overlay — hide native views while any modal is open ────
// Single source of truth. Watches the WHOLE document so ANY modal that uses
// the `.modal-backdrop` + `.open` convention is covered automatically —
// including modals added dynamically. New modals "just work" with no extra
// wiring; they must NOT manually toggle individual views.
(function initModalOverlay() {
  let last = null;
  function sync() {
    const open = !!document.querySelector('.modal-backdrop.open');
    if (open === last) return;          // only signal on actual change
    last = open;
    ipcRenderer.send('modal-overlay', { open });
  }
  // Observe ONLY the modal backdrops' class attributes — the previous
  // whole-document subtree observer ran this callback for every DOM mutation
  // in the app (every chat chunk, every xterm frame). Modals added later are
  // caught by a cheap non-subtree childList watch on <body>; the convention
  // (".modal-backdrop" + ".open", attached under <body>) is unchanged.
  const attrObs = new MutationObserver(sync);
  const watched = new WeakSet();
  function watch(el) {
    if (watched.has(el)) return;
    watched.add(el);
    attrObs.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  document.querySelectorAll('.modal-backdrop').forEach(watch);
  const addObs = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList?.contains('modal-backdrop')) watch(n);
        n.querySelectorAll?.('.modal-backdrop').forEach(watch);
      }
    }
    sync();   // also covers a modal being removed while open
  });
  addObs.observe(document.body, { childList: true });
  sync();
})();

// ── Modal helper ──────────────────────────────────────────────────
// Standard plumbing for `.modal-backdrop` modals: Escape closes, clicking the
// backdrop closes (unless disabled), open/close just toggle `.open`. Native
// views are hidden by the document-level observer above — do NOT send
// browser-view-hide/show or modal-overlay manually from modal code.
function wireModal(modal, { backdropClose = true, onClose } = {}) {
  const close = () => {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    onClose?.();
  };
  if (backdropClose) modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  return { open: () => modal.classList.add('open'), close };
}

// ── Global custom dropdown ────────────────────────────────────────
// Replaces each native <select>'s visuals with a styleable widget (so the
// OPEN list can be padded/spaced) while keeping the <select> for value/events.
// Programmatic `sel.value = …` stays transparent via a value setter shim.
function enhanceSelect(sel) {
  if (sel._ctEnhanced) return;
  sel._ctEnhanced = true;

  const wrap = document.createElement('div');
  wrap.className = 'ct-select' + (sel.classList.contains('tabs-add-select-field') ? ' tabs-add-select-field' : '');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const btn = document.createElement('div');
  btn.className = 'ct-select-btn';
  btn.innerHTML = `<span class="ct-select-label"></span><svg class="ct-select-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4.5 6,8.5 10,4.5"></polyline></svg>`;
  const labelEl = btn.querySelector('.ct-select-label');
  const menu = document.createElement('div');
  menu.className = 'ct-select-menu';
  wrap.appendChild(btn);
  wrap.appendChild(menu);

  function buildMenu() {
    menu.innerHTML = '';
    Array.from(sel.options).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'ct-select-opt' + (opt.value === sel.value ? ' selected' : '') + (opt.value === '' ? ' placeholder' : '');
      item.textContent = opt.textContent;
      item.addEventListener('click', () => {
        if (sel.value !== opt.value) {
          sel.value = opt.value;                         // refresh() via setter shim
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        close();
      });
      menu.appendChild(item);
    });
  }
  function refresh() {
    const opt = sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '';
    labelEl.classList.toggle('placeholder', !sel.value);
    menu.querySelectorAll('.ct-select-opt').forEach((it, i) => {
      it.classList.toggle('selected', sel.options[i] && sel.options[i].value === sel.value);
    });
  }
  function close() { wrap.classList.remove('open'); }
  function open()  {
    buildMenu(); refresh();
    wrap.classList.add('open');
    // Position the fixed menu against the button; flip up if it would overflow below
    const r = btn.getBoundingClientRect();
    menu.style.left  = r.left + 'px';
    menu.style.width = r.width + 'px';
    menu.style.top   = '-9999px';
    const mh = menu.offsetHeight;
    const below = window.innerHeight - r.bottom - 8;
    menu.style.top = (mh <= below || r.top < mh + 8)
      ? (r.bottom + 4) + 'px'
      : (r.top - 4 - mh) + 'px';
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.contains('open') ? close() : open();
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return desc.get.call(sel); },
    set(v) { desc.set.call(sel, v); refresh(); },
  });

  buildMenu();
  refresh();
}
document.querySelectorAll('select.modal-input').forEach(enhanceSelect);

// ── ACP chat helpers ──────────────────────────────────────────────
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

function acpSetStatus(s, state) {
  const labels = { ready: 'Ready', thinking: 'Thinking…', connecting: 'Connecting…', installing: 'Installing adapter…', error: 'Error', closed: 'Session ended' };
  s.dotEl.className = 'acp-status-dot' + (state === 'thinking' ? ' active' : '');
  s.statusTextEl.textContent = labels[state] || state;
}

// Coalesced to one scroll per frame — streaming calls this per chunk, and an
// unbatched scrollIntoView forces a full layout pass every call.
function acpScrollEnd(s) {
  if (s._scrollScheduled) return;
  s._scrollScheduled = true;
  requestAnimationFrame(() => {
    s._scrollScheduled = false;
    s.msgsEl.lastElementChild?.scrollIntoView({ block: 'end' });
  });
}

function renderAcpBanner(s, version, model, cwd) {
  // Drop any prior banner (e.g. when respawning after a model switch)
  s.msgsEl.querySelector('.acp-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'acp-banner';

  const versionStr = version ? `v${version}` : '';
  const modelLine  = model || 'Claude';
  const logo = document.createElement('pre');
  logo.className = 'acp-banner-logo';
  logo.textContent = [
    ` ▐▛███▜▌   Claude Code ${versionStr}`,
    `▝▜█████▛▘  ${modelLine}`,
    `  ▘▘ ▝▝    ${cwd}`,
  ].join('\n');
  banner.appendChild(logo);

  const noticesEl = document.createElement('div');
  noticesEl.className = 'acp-banner-notices';
  banner.appendChild(noticesEl);

  s.msgsEl.prepend(banner);
  s._bannerNoticesEl = noticesEl;
  s._bannerCollecting = true;
}

function acpRawLog(_s, _text) {
  // No-op: terminal view is now a real PTY (xterm); text log replaced.
}

function acpFinalizeStream(s) {
  if (s.streamEl) {
    s.streamEl.classList.remove('streaming');
    s.streamEl = null; s.streamTextEl = null;
    s.streamMsgId = null;
  }
}

function acpAddUserMsg(s, text) {
  s._bannerCollecting = false;
  acpFinalizeStream(s);
  acpRawLog(s, `\n> ${text}\n\n`);
  const el = document.createElement('div');
  el.className = 'acp-msg user';
  const t = document.createElement('div');
  t.className = 'acp-msg-text';
  t.textContent = text;
  el.appendChild(t);
  s.msgsEl.appendChild(el);
  acpScrollEnd(s);
}

function acpAppendChunk(s, text, messageId) {
  if (s.streamEl && messageId && s.streamMsgId && s.streamMsgId !== messageId) {
    acpFinalizeStream(s);
  }
  if (!s.streamEl) {
    const el = document.createElement('div');
    el.className = 'acp-msg assistant streaming';
    const t = document.createElement('div');
    t.className = 'acp-msg-text';
    el.appendChild(t);
    s.msgsEl.appendChild(el);
    s.streamEl = el; s.streamTextEl = t;
    s.streamMsgId = messageId;
  }
  // Append only the new chunk — reassigning the full accumulated text made
  // long responses O(n²) (full re-serialize + reflow per chunk).
  s.streamTextEl.appendChild(document.createTextNode(text));
  acpRawLog(s, text);
  acpScrollEnd(s);
}

function acpAddToolCard(s, update) {
  acpFinalizeStream(s);
  const card = document.createElement('div');
  card.className = 'acp-tool';

  const header = document.createElement('div');
  header.className = 'acp-tool-header';
  const nameEl = document.createElement('span');
  nameEl.className = 'acp-tool-name';
  nameEl.textContent = update.title || update.toolCallId || 'tool';
  const statusEl = document.createElement('span');
  statusEl.className = 'acp-tool-status running';
  statusEl.textContent = 'Running';
  header.appendChild(nameEl);
  header.appendChild(statusEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'acp-tool-body';
  if (update.content?.type === 'text') bodyEl.textContent = stripAnsi(update.content.text);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    bodyEl.style.display = collapsed ? 'none' : '';
  });

  card.appendChild(header);
  card.appendChild(bodyEl);
  s.msgsEl.appendChild(card);
  acpRawLog(s, `\n[${update.title || update.toolCallId || 'tool'}]\n`);
  if (update.content?.type === 'text') acpRawLog(s, stripAnsi(update.content.text));
  acpScrollEnd(s);
  s.toolCards.set(update.toolCallId, { card, statusEl, bodyEl });
}

function acpUpdateToolCard(s, update) {
  const tc = s.toolCards.get(update.toolCallId);
  if (!tc) return;
  if (update.status) {
    const done = ['completed', 'done'].includes(update.status);
    const err  = ['error', 'failed'].includes(update.status);
    tc.statusEl.className = `acp-tool-status ${done ? 'done' : err ? 'error' : 'running'}`;
    tc.statusEl.textContent = done ? 'Done' : err ? 'Error' : 'Running';
  }
  if (update.content?.type === 'text') {
    const text = stripAnsi(update.content.text);
    tc.bodyEl.appendChild(document.createTextNode(text));   // append, don't reassign (O(n²))
    tc.bodyEl.scrollTop = tc.bodyEl.scrollHeight;
    acpRawLog(s, text);
  }
}


function acpAddTermCard(s, { termId, title }) {
  if (s.toolCards.has(termId)) return;
  acpFinalizeStream(s);
  const card = document.createElement('div');
  card.className = 'acp-tool';
  const header = document.createElement('div');
  header.className = 'acp-tool-header';
  const nameEl = document.createElement('span');
  nameEl.className = 'acp-tool-name';
  nameEl.textContent = title || 'terminal';
  const statusEl = document.createElement('span');
  statusEl.className = 'acp-tool-status running';
  statusEl.textContent = 'Running';
  header.appendChild(nameEl);
  header.appendChild(statusEl);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'acp-tool-body';
  card.appendChild(header);
  card.appendChild(bodyEl);
  s.msgsEl.appendChild(card);
  acpScrollEnd(s);
  s.toolCards.set(termId, { card, statusEl, bodyEl });
}

function handleAcpUpdate(s, update) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content?.type === 'text') acpAppendChunk(s, update.content.text, update.messageId);
      break;
    case 'tool_call':        acpAddToolCard(s, update);    break;
    case 'tool_call_update': acpUpdateToolCard(s, update); break;
  }
}

// ── ACP IPC listeners ─────────────────────────────────────────────
ipcRenderer.on('acp-installing', (_, { id }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  acpSetStatus(s, 'installing');
  acpRawLog(s, '⬇ Installing adapter (one-time setup)…\n');
  const el = document.createElement('div');
  el.className = 'acp-msg assistant';
  el.dataset.installLog = 'true';
  const t = document.createElement('div');
  t.className = 'acp-msg-text';
  t.textContent = 'Installing Claude adapter (one-time setup)…';
  el.appendChild(t);
  s.msgsEl.appendChild(el);
  s._installEl = t;
  acpScrollEnd(s);
});

ipcRenderer.on('acp-install-progress', (_, { id, text }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp' || !s._installEl) return;
  s._installEl.appendChild(document.createTextNode(text));
  acpRawLog(s, text);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-ready', (_, { id, version, model, cwd }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  if (s._installEl) {
    s._installEl.remove();
    s._installEl = null;
  }
  s.cwd = cwd || s.cwd || '';
  acpSetStatus(s, 'ready');
  renderAcpBanner(s, version || '', model || '', cwd || '');
  finishModelSwitch(s);  // dismiss "switching…" toast + confirm, if a model switch is pending
});

ipcRenderer.on('acp-update', (_, { id, update }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') handleAcpUpdate(s, update);
});

ipcRenderer.on('acp-done', (_, { id }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') { acpFinalizeStream(s); acpRawLog(s, '\n'); acpSetStatus(s, 'ready'); }
  if (id === activeId) refreshUsage();  // update usage after each reply (panel re-reads only if open)
});

ipcRenderer.on('acp-closed', (_, { id }) => {
  const s = sessions.get(id);
  if (s?.type === 'acp') { acpFinalizeStream(s); acpRawLog(s, '\n[Session ended]\n'); acpSetStatus(s, 'closed'); }
});

ipcRenderer.on('acp-error', (_, { id, message }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  if (s._modelToast) { s._modelToast.dismiss(); s._modelToast = null; s._pendingModelLabel = null; }
  acpFinalizeStream(s);
  acpRawLog(s, `\nError: ${message}\n`);
  acpSetStatus(s, 'error');
  const el = document.createElement('div');
  el.className = 'acp-msg error';
  el.textContent = `Error: ${message}`;
  s.msgsEl.appendChild(el);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-tool-approved', (_, { id, toolCall }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  acpFinalizeStream(s);
  const label = toolCall?.title || toolCall?.input?.command || 'tool';
  acpRawLog(s, `▶ ${label}\n`);
  const el = document.createElement('div');
  el.className = 'acp-approved';
  el.textContent = `▶ ${label}`;
  s.msgsEl.appendChild(el);
  acpScrollEnd(s);
});

ipcRenderer.on('acp-term-create', (_, { id, termId, title }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  acpRawLog(s, `\n[terminal: ${title || termId}]\n`);
  acpAddTermCard(s, { termId, title });
});

ipcRenderer.on('acp-term-output', (_, { id, termId, output }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  const stripped = stripAnsi(output);
  // Collect ▎ notice lines from startup banner output
  if (s._bannerCollecting && s._bannerNoticesEl) {
    for (const line of stripped.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('▎') || trimmed.startsWith('▏')) {
        const d = document.createElement('div');
        d.className = 'acp-banner-notice';
        d.textContent = line.replace(/^\s*[▎▏]\s?/, '').trim();
        s._bannerNoticesEl.appendChild(d);
      }
    }
  }
  const tc = s.toolCards.get(termId);
  if (tc) { tc.bodyEl.appendChild(document.createTextNode(stripped)); tc.bodyEl.scrollTop = tc.bodyEl.scrollHeight; }
});

ipcRenderer.on('acp-term-release', (_, { id, termId }) => {
  const s = sessions.get(id);
  if (!s || s.type !== 'acp') return;
  const tc = s.toolCards.get(termId);
  if (tc) { tc.statusEl.className = 'acp-tool-status done'; tc.statusEl.textContent = 'Done'; }
});

// Boot first session
createSession();

// ── Pin system ───────────────────────────────────────────────────
function getTermRowHeight(termEl) {
  const row = termEl.querySelector('.xterm-rows > div');
  return row ? row.getBoundingClientRect().height : Math.ceil(TERM_OPTS.fontSize * 1.2);
}


// ── Chat log ──────────────────────────────────────────────────────

function makeChatBubble(role, text, pinned = false) {
  const el = document.createElement('div');
  el.className = `chat-msg chat-msg-${role}`;
  if (pinned) el.classList.add('pinned');

  const body = document.createElement('span');
  body.className = 'chat-msg-body';
  body.textContent = text;
  el.appendChild(body);

  if (role === 'ai') {
    const btn = document.createElement('button');
    btn.className = 'chat-pin-btn' + (pinned ? ' pinned' : '');
    btn.innerHTML = pinned ? ICON_PIN_PINNED : ICON_PIN_UNPINNED;
    btn.title = pinned ? 'Unpin' : 'Pin';
    btn.addEventListener('mouseenter', () => {
      const s = sessions.get(activeId);
      const msg = s?.chatMsgs.find(m => m.el === el);
      if (msg?.pinned) btn.innerHTML = ICON_PIN_REMOVE;
    });
    btn.addEventListener('mouseleave', () => {
      const s = sessions.get(activeId);
      const msg = s?.chatMsgs.find(m => m.el === el);
      btn.innerHTML = msg?.pinned ? ICON_PIN_PINNED : ICON_PIN_UNPINNED;
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const s = sessions.get(activeId);
      const msg = s?.chatMsgs.find(m => m.el === el);
      if (!msg) return;
      msg.pinned = !msg.pinned;
      el.classList.toggle('pinned', msg.pinned);
      btn.className = 'chat-pin-btn' + (msg.pinned ? ' pinned' : '');
      btn.innerHTML = msg.pinned ? ICON_PIN_PINNED : ICON_PIN_UNPINNED;
      btn.title = msg.pinned ? 'Unpin' : 'Pin';
    });
    el.appendChild(btn);
  }
  return el;
}

function renderChatLog(_id) {}

function showSessionHeader(_id) {}

function readStatusLines(s) {
  const buf = s.term.buffer.active;
  const cursorLine = buf.baseY + buf.cursorY;
  const found = [];
  for (let i = Math.max(0, cursorLine - 20); i <= cursorLine; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true).trim();
    if (!text) continue;
    if (SPINNER_RE.test(text) || /^[+└├]/.test(text)) found.push(text);
  }
  return found.slice(-3); // at most 3 lines (spinner/mulling + sub-lines)
}

function setChatStatus(_lines) {}

function scanBufferForBullets(_id) { return false; }
function updateChatAi(_id) {}

// ── Divider drag ──────────────────────────────────────────────────
const divider   = document.getElementById('divider');
const leftPanel = document.getElementById('left-panel');
const appRootEl = document.getElementById('app');
const devtoolsPlaceholderEl = document.getElementById('devtools-placeholder');
let dragging = false;
let currentDevToolsWidth = 0;

// devtools-layout streams continuously during divider drags and the DevTools
// open/close animation. Refit the PTY once, trailing — fitAddon.fit()
// measures the DOM and resizes the shell, far too heavy to run per event.
let layoutRefitTimer = null;
ipcRenderer.on('devtools-layout', (_, { leftPanelWidth, devToolsWidth: dw }) => {
  currentDevToolsWidth = dw;
  leftPanel.style.width = leftPanelWidth + 'px';
  devtoolsPlaceholderEl.style.width = dw + 'px';
  clearTimeout(layoutRefitTimer);
  layoutRefitTimer = setTimeout(() => refitSession(activeId), 80);
});

divider.addEventListener('mousedown', e => {
  dragging = true;
  divider.classList.add('dragging');
  leftPanel.style.transition = 'none';
  e.preventDefault();
});
// rAF-throttled: mousemove fires at 60–120 Hz; each un-throttled event caused
// a style write + IPC → 4 native setBounds in main. One update per frame.
let dragClientX = 0, dragRaf = 0;
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  dragClientX = e.clientX;
  if (dragRaf) return;
  dragRaf = requestAnimationFrame(() => {
    dragRaf = 0;
    if (!dragging) return;
    const appW     = appRootEl.offsetWidth - currentDevToolsWidth;
    const fraction = Math.min(0.75, Math.max(0.2, dragClientX / appW));
    leftPanel.style.width = Math.round(fraction * appW) + 'px';
    ipcRenderer.send('split-changed', fraction);
  });
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  leftPanel.style.transition = '';
  refitSession(activeId);
});

// ── Panel collapse toggle ─────────────────────────────────────────
const btnPanelToggle = document.getElementById('btn-panel-toggle');
let panelCollapsed = false;
let savedPanelWidth = null;

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
      ipcRenderer.send('split-changed', w / appRootEl.offsetWidth);
    }, 250);
  }
  refitSession(activeId, PANEL_ANIM_MS);
});

// ── Settings dropdown ─────────────────────────────────────────────
const gearBtn      = document.getElementById('btn-settings');
const apiKeyModal  = document.getElementById('api-key-modal');
const apiKeyInput  = document.getElementById('api-key-input');

gearBtn.addEventListener('click', e => {
  e.stopPropagation();
  const rect = gearBtn.getBoundingClientRect();
  ipcRenderer.send('show-settings-menu', { x: Math.round(rect.left), y: Math.round(rect.bottom) });
});

let openAuditPromptsModal      = null;
let openEditTabsModal          = null;
let openMcpToolsModal          = null;
let openKeyboardShortcutsModal = null;

ipcRenderer.on('settings-action', (_, action) => {
  switch (action) {
    case 'api-key': {
      const saved = localStorage.getItem(LS.apiKey) || '';
      apiKeyInput.value = saved;
      apiKeyModalCtl.open();
      requestAnimationFrame(() => apiKeyInput.focus());
      break;
    }
    case 'manage-llms':   openProfilesModal?.();     break;
    case 'get-started':   openOnboarding?.();        break;
    case 'auth':          openAuthModal();           break;
    case 'claude-md':     openClaudeMdModal();       break;
    case 'audit-prompts': openAuditPromptsModal?.(); break;
    case 'edit-tabs':     openEditTabsModal?.();     break;
    case 'mcp-tools':          openMcpToolsModal?.();          break;
    case 'keyboard-shortcuts': openKeyboardShortcutsModal?.(); break;
    case 'theme-minimal': applyTheme('minimal'); break;
    case 'theme-winamp':  applyTheme('winamp');  break;
    case 'new-window':    ipcRenderer.send('new-window'); break;
  }
});

const apiKeyModalCtl = wireModal(apiKeyModal);
const closeApiKeyModal = apiKeyModalCtl.close;

document.getElementById('api-key-cancel').addEventListener('click', closeApiKeyModal);

document.getElementById('api-key-confirm').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(LS.apiKey, key);
    ipcRenderer.send('set-api-key', key);
  }
  closeApiKeyModal();
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('api-key-confirm').click();
  if (e.key === 'Escape') closeApiKeyModal();
});

// ── API Keys modal ────────────────────────────────────────────────
const API_KEYS_STORE = LS.apiKeys;

function loadApiKeys() {
  try { const r = localStorage.getItem(API_KEYS_STORE); if (r) return JSON.parse(r); } catch (_) {}
  const legacy = localStorage.getItem(LS.apiKey);
  if (legacy) {
    const keys = [{ id: `k${Date.now()}`, name: 'Default', key: legacy, active: true }];
    localStorage.setItem(API_KEYS_STORE, JSON.stringify(keys));
    return keys;
  }
  return [];
}

function persistApiKeys(keys) {
  localStorage.setItem(API_KEYS_STORE, JSON.stringify(keys));
  const active = keys.find(k => k.active);
  if (active) {
    localStorage.setItem(LS.apiKey, active.key);
    ipcRenderer.send('set-api-key', active.key);
  }
}

function maskKey(key) {
  if (!key || key.length <= 12) return '•'.repeat(Math.min((key || '').length, 12));
  return key.slice(0, 8) + '…' + key.slice(-4);
}

function renderApiKeysList() {
  const listEl = document.getElementById('api-keys-list');
  const keys = loadApiKeys();
  listEl.innerHTML = '';
  if (!keys.length) {
    listEl.innerHTML = '<p class="modal-desc" style="margin:8px 0;opacity:0.55">No keys saved yet — add one below.</p>';
    return;
  }
  keys.forEach(k => {
    const item = document.createElement('div');
    item.className = 'api-key-item' + (k.active ? ' active' : '');
    item.innerHTML = `
      <div class="api-key-dot"></div>
      <div class="api-key-info">
        <span class="api-key-label">${k.name}</span>
        <span class="api-key-masked">${maskKey(k.key)}</span>
      </div>
      <button class="api-key-use" ${k.active ? 'disabled' : ''}>${k.active ? 'Active' : 'Use'}</button>
      <button class="api-key-del" title="Remove">✕</button>
    `;
    item.querySelector('.api-key-use').addEventListener('click', () => {
      const all = loadApiKeys();
      all.forEach(x => { x.active = x.id === k.id; });
      persistApiKeys(all);
      renderApiKeysList();
    });
    item.querySelector('.api-key-del').addEventListener('click', () => {
      let all = loadApiKeys().filter(x => x.id !== k.id);
      if (k.active && all.length) { all[0].active = true; persistApiKeys(all); }
      else localStorage.setItem(API_KEYS_STORE, JSON.stringify(all));
      renderApiKeysList();
    });
    listEl.appendChild(item);
  });
}

const authModal     = document.getElementById('auth-modal');
const apiKeyNewForm = document.getElementById('api-key-new-form');

async function renderAuthAccountSection() {
  const el = document.getElementById('auth-account-status');
  el.innerHTML = '<span class="auth-loading">Checking…</span>';
  const creds = await ipcRenderer.invoke('auth-status-read');
  const oauth        = creds?.claudeAiOauth ?? creds;
  const hasToken     = !!(oauth?.accessToken);
  const expiresAt    = oauth?.expiresAt;
  const expired      = expiresAt && Date.now() > expiresAt;
  const loggedIn     = hasToken && !expired;
  const subType      = oauth?.subscriptionType || '';
  const email        = oauth?.account?.emailAddress || oauth?.email || '';
  const subLabel     = subType === 'pro' ? 'Claude Pro' : subType ? subType : 'claude.ai';
  const displayName  = email || subLabel;
  const subLine      = email ? subLabel : '';

  el.innerHTML = `
    <div class="auth-account-row${loggedIn ? ' active' : ''}">
      <div class="auth-dot${loggedIn ? ' on' : ''}"></div>
      <div class="auth-account-info">
        <span class="auth-account-name">${loggedIn ? displayName : 'Not logged in'}</span>
        ${loggedIn && subLine ? `<span class="auth-account-sub">${subLine}</span>` : ''}
        ${expired  ? `<span class="auth-account-sub warn">Session expired — re-authenticate</span>` : ''}
        ${!hasToken ? `<span class="auth-account-sub">Run claude auth login to connect your account</span>` : ''}
      </div>
      <button class="api-key-use auth-reauth-btn">${loggedIn ? 'Re-auth' : 'Log in'}</button>
    </div>
  `;
  el.querySelector('.auth-reauth-btn').addEventListener('click', () => {
    authModalCtl.close();
    createSession('Claude Auth', 'claude auth login', false);
  });
}

const authModalCtl = wireModal(authModal);

async function openAuthModal() {
  renderAuthAccountSection();
  renderApiKeysList();
  apiKeyNewForm.style.display = 'none';
  authModalCtl.open();
}

document.getElementById('api-key-new-open').addEventListener('click', () => {
  const open = apiKeyNewForm.style.display === 'none';
  apiKeyNewForm.style.display = open ? '' : 'none';
  if (open) {
    document.getElementById('api-key-new-name').value = '';
    document.getElementById('api-key-new-value').value = '';
    document.getElementById('api-key-new-name').focus();
  }
});

function commitNewApiKey() {
  const name = document.getElementById('api-key-new-name').value.trim();
  const key  = document.getElementById('api-key-new-value').value.trim();
  if (!name || !key) return;
  const keys = loadApiKeys();
  const isFirst = !keys.length;
  keys.push({ id: `k${Date.now()}`, name, key, active: isFirst });
  if (isFirst) persistApiKeys(keys);
  else localStorage.setItem(API_KEYS_STORE, JSON.stringify(keys));
  apiKeyNewForm.style.display = 'none';
  renderApiKeysList();
}

document.getElementById('api-key-new-save').addEventListener('click', commitNewApiKey);
document.getElementById('api-key-new-cancel').addEventListener('click', () => { apiKeyNewForm.style.display = 'none'; });
document.getElementById('api-key-new-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('api-key-new-value').focus();
});
document.getElementById('api-key-new-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') commitNewApiKey();
  if (e.key === 'Escape') { apiKeyNewForm.style.display = 'none'; }
});
document.getElementById('auth-done').addEventListener('click', () => authModalCtl.close());

// ── CLAUDE.md editor modal ────────────────────────────────────────
const claudeMdModal    = document.getElementById('claude-md-modal');
const claudeMdTextarea = document.getElementById('claude-md-textarea');

const claudeMdModalCtl = wireModal(claudeMdModal);

async function openClaudeMdModal() {
  claudeMdTextarea.value = '';
  claudeMdTextarea.placeholder = 'Loading…';
  claudeMdModalCtl.open();
  const content = await ipcRenderer.invoke('claude-md-read');
  claudeMdTextarea.value = content;
  claudeMdTextarea.placeholder = '# Agent Instructions\n\nWrite instructions for Claude here…';
  claudeMdTextarea.focus();
}

document.getElementById('claude-md-cancel').addEventListener('click', () => claudeMdModalCtl.close());
document.getElementById('claude-md-save').addEventListener('click', async () => {
  const btn = document.getElementById('claude-md-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const ok = await ipcRenderer.invoke('claude-md-write', claudeMdTextarea.value);
  btn.disabled = false;
  btn.textContent = 'Save';
  if (ok) claudeMdModalCtl.close();
});

// ── Right panel view switching ────────────────────────────────────
const tabBar            = document.getElementById('tab-bar');
const rightSb           = document.getElementById('right-storybook');
const browserPlaceholder = document.getElementById('browser-placeholder');
const codePanel         = document.getElementById('code-panel');

const viewTabThumb = document.getElementById('view-tab-thumb');

function updateViewTabThumb() {
  const active = document.querySelector('.view-tab.active');
  if (!active || !viewTabThumb) return;
  viewTabThumb.style.left  = active.offsetLeft + 'px';
  viewTabThumb.style.width = active.offsetWidth + 'px';
}

// ── Tab configuration ──────────────────────────────────────────────
// TAB_TYPES is the single catalog for built-in view-tab types: the default
// config, the Edit Tabs modal (defaults + add-options), and the icon map all
// derive from it. To add a tab type: add it here, then handle its panel in
// activateViewTab (and main.js right-panel-mode if it needs a native view).
const TAB_ICONS = {
  project:   `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><path opacity="0.4" d="M9.5 5.5C9.5 3.96 8.573 2.65005 7.25 2.06995V5.75H4.25V2.06995C2.927 2.65005 2 3.9599 2 5.5C2 7.0401 2.927 8.34995 4.25 8.93005V15.25C4.25 15.8 4.698 16.25 5.25 16.25H6.25C6.802 16.25 7.25 15.8 7.25 15.25V8.93005C8.573 8.34995 9.5 7.0401 9.5 5.5Z" fill="currentColor" stroke="none"/><path opacity="0.4" d="M15.25 9.25V15.25C15.25 15.8 14.802 16.25 14.25 16.25H13.25C12.698 16.25 12.25 15.8 12.25 15.25V9.25" fill="currentColor" stroke="none"/><path d="M9.5 5.5C9.5 3.96 8.573 2.65005 7.25 2.06995V5.75H4.25V2.06995C2.927 2.65005 2 3.9599 2 5.5C2 7.0401 2.927 8.34995 4.25 8.93005V15.25C4.25 15.8 4.698 16.25 5.25 16.25H6.25C6.802 16.25 7.25 15.8 7.25 15.25V8.93005C8.573 8.34995 9.5 7.0401 9.5 5.5Z"/><path d="M15.25 9.25V15.25C15.25 15.8 14.802 16.25 14.25 16.25H13.25C12.698 16.25 12.25 15.8 12.25 15.25V9.25"/><path d="M11.25 9.25H16.25"/><path d="M13.75 9.25V2.25"/><path d="M13.75 5.25L14.75 3.5L14.25 1.75H13.25L12.75 3.5L13.75 5.25Z" fill="currentColor"/></g></svg>`,
  figma:     `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="13" viewBox="0 0 200 300"><path d="M50 300c27.6 0 50-22.4 50-50v-50H50c-27.6 0-50 22.4-50 50s22.4 50 50 50z" fill="#0acf83"/><path d="M0 150c0-27.6 22.4-50 50-50h50v100H50c-27.6 0-50-22.4-50-50z" fill="#a259ff"/><path d="M0 50C0 22.4 22.4 0 50 0h50v100H50C22.4 100 0 77.6 0 50z" fill="#f24e1e"/><path d="M100 0h50c27.6 0 50 22.4 50 50s-22.4 50-50 50h-50V0z" fill="#ff7262"/><path d="M200 150c0 27.6-22.4 50-50 50s-50-22.4-50-50 22.4-50 50-50 50 22.4 50 50z" fill="#1abcfe"/></svg>`,
  storybook: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="m9,15.051c.17,0,.339-.045.494-.134.643-.371,1.732-.847,3.141-.845.899.001,1.667.197,2.27.435.648.255,1.344-.24,1.344-.937V4.487c0-.354-.181-.68-.486-.86-.5393-.3183-1.4027-.7163-2.513-.8308"/><path d="m9,15.051c-.17,0-.339-.045-.494-.134-.643-.371-1.732-.847-3.141-.845-.899.001-1.667.197-2.27.435-.648.255-1.344-.237-1.344-.933V4.484c0-.354.181-.676.486-.856.637-.376,1.726-.863,3.14-.863,1.89,0,3.198.872,3.624,1.182"/><path d="m8.999,15.051c.6301-1.3222,1.9537-2.2143,3.6105-2.3971.3692-.0407.6405-.3676.6405-.739V2.3259c0-.4569-.4081-.8165-.8599-.7486-1.5127.2275-2.7746,1.0598-3.3911,2.3686v11.105Z"/></g></svg>`,
  url:       `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><circle cx="9" cy="9" r="7"/><path d="M9 2c0 0-2.5 3-2.5 7s2.5 7 2.5 7"/><path d="M9 2c0 0 2.5 3 2.5 7S9 16 9 16"/><line x1="2" y1="9" x2="16" y2="9"/><path d="M2.75 6h12.5"/><path d="M2.75 12h12.5"/></g></svg>`,
  code:      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 18 18"><g stroke-linecap="round" stroke-width="1.25" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="1.75" y="2.75" width="14.5" height="12.5" rx="2"/><circle cx="4.25" cy="5.25" r=".75" fill="currentColor" stroke="none"/><circle cx="6.75" cy="5.25" r=".75" fill="currentColor" stroke="none"/><polyline points="10.75 12.25 13 10 10.75 7.75"/><polyline points="7.25 12.25 5 10 7.25 7.75"/></g></svg>`,
};

function toRoman(n) {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r = '';
  vals.forEach((v, i) => { while (n >= v) { r += syms[i]; n -= v; } });
  return r;
}

function getTabIconHtml(tab) {
  if (tab.type === 'url' && tab.url) {
    try {
      const { hostname } = new URL(tab.url);
      return `<img class="tab-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=16" width="14" height="14" />`;
    } catch (_) {}
  }
  return TAB_ICONS[tab.type] || TAB_ICONS.url;
}

function equalizeTabWidths() {
  const container   = document.getElementById('right-panel-tabs');
  const tabs        = [...container.querySelectorAll('.view-tab')];
  if (!tabs.length) return;

  const appBar      = document.getElementById('app-bar');
  const settingsBtn = document.getElementById('btn-settings');
  const devToolsBtn = document.getElementById('btn-devtools');

  // Reset to natural size for measurement
  container.style.maxWidth = '';
  tabs.forEach(t => { t.style.width = ''; });

  // Centered tab bar must not overlap the tools on either side.
  // Left boundary = the settings button (now beside the logo); right boundary =
  // the devtools button (now the first tool to the right of the tabs).
  const center     = appBar.offsetWidth / 2;
  const rightLimit = devToolsBtn.offsetLeft - 10;
  const leftLimit  = settingsBtn.offsetLeft + settingsBtn.offsetWidth + 10;
  const halfAvail  = Math.min(rightLimit - center, center - leftLimit);
  const maxWidth   = Math.max(80, 2 * halfAvail);

  const containerPad = 4; // 2px padding each side
  const available    = maxWidth - containerPad;
  const naturalMax   = Math.max(...tabs.map(t => t.offsetWidth));
  const perTab = naturalMax * tabs.length <= available
    ? naturalMax
    : Math.max(50, Math.floor(available / tabs.length));

  container.style.maxWidth = maxWidth + 'px';
  tabs.forEach(t => { t.style.width = perTab + 'px'; });
}

const TAB_TYPES = {
  project:   { label: 'Working File' },
  code:      { label: 'Code Viewer' },
  figma:     { label: 'Figma' },
  storybook: { label: 'Storybook' },
};
const BUILTIN_TAB_ORDER = Object.keys(TAB_TYPES);

function defaultTabFor(type) {
  return { id: type, type, label: TAB_TYPES[type].label };
}

const DEFAULT_TABS_CONFIG = BUILTIN_TAB_ORDER.map(defaultTabFor);

let tabsConfig = (() => {
  try {
    const s = localStorage.getItem(LS.tabs);
    if (s) {
      const cfg = JSON.parse(s);
      // Migration: ensure the Code Viewer tab exists (and carries its current
      // label) for users with an older saved config.
      if (Array.isArray(cfg)) {
        let changed = false;
        const codeTab = cfg.find(t => t.type === 'code');
        if (!codeTab) {
          const at = Math.max(0, cfg.findIndex(t => t.type === 'project')) + 1;
          cfg.splice(at, 0, defaultTabFor('code'));
          changed = true;
        } else if (codeTab.label === 'Code') {
          codeTab.label = TAB_TYPES.code.label;   // rename only the old default; leave custom names
          changed = true;
        }
        if (changed) localStorage.setItem(LS.tabs, JSON.stringify(cfg));
      }
      return cfg;
    }
  } catch (_) {}
  return DEFAULT_TABS_CONFIG.map(t => ({ ...t }));
})();

let activeViewTabId = tabsConfig[0]?.id || 'project';

const projectToolsEl = document.getElementById('project-tools');

function setProjectToolsVisible(visible, animate) {
  const btns = Array.from(projectToolsEl.querySelectorAll('.pick-btn'));
  gsap.killTweensOf([projectToolsEl, ...btns]);

  if (!animate) {
    gsap.set(projectToolsEl, visible ? { clearProps: 'width' } : { width: 0 });
    gsap.set(btns,           visible ? { clearProps: 'opacity' } : { opacity: 0 });
    return;
  }

  if (visible) {
    // Measure natural width synchronously: clear constraint → read → restore before next paint
    gsap.set(projectToolsEl, { clearProps: 'width' });
    const naturalW = projectToolsEl.offsetWidth;
    gsap.set(projectToolsEl, { width: 0 });

    gsap.timeline()
      .set(btns, { opacity: 0 })
      .to(projectToolsEl, { width: naturalW, duration: 0.22, ease: 'power2.out' })
      .to(btns, { opacity: 1, duration: 0.18, ease: 'power1.in' });
  } else {
    gsap.timeline()
      .to(btns, { opacity: 0, duration: 0.09, ease: 'power1.out' })
      .to(projectToolsEl, { width: 0, duration: 0.14, ease: 'power2.in' });
  }
}

function activateViewTab(tabId, silent = false) {
  activeViewTabId = tabId;
  const tab = tabsConfig.find(t => t.id === tabId);
  if (!tab) return;
  document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === tabId));
  updateViewTabThumb();
  const isProject   = tab.type === 'project';
  const isStorybook = tab.type === 'storybook';
  const isCode      = tab.type === 'code';
  tabBar.style.display             = isProject   ? '' : 'none';
  rightSb.style.display            = isStorybook ? 'flex' : 'none';
  browserPlaceholder.style.display = isProject   ? '' : 'none';
  if (codePanel) codePanel.style.display = isCode ? 'flex' : 'none';
  setProjectToolsVisible(isProject, !silent);
  if (isCode) window.__onCodeTabActive?.();
  else window.__onCodeTabInactive?.();
  if (!silent) {
    const mode = tab.type === 'url' ? 'url:' + tab.url : tab.type;
    ipcRenderer.send('right-panel-mode', mode);
    updateWfEmpty();   // re-evaluate when the user switches view tabs (guarded to user actions to avoid init TDZ)
  }
}

function renderViewTabs() {
  const container = document.getElementById('right-panel-tabs');
  container.querySelectorAll('.view-tab').forEach(b => b.remove());
  tabsConfig.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'view-tab' + (tab.id === activeViewTabId ? ' active' : '');
    btn.dataset.view = tab.id;
    btn.title = tab.label;
    btn.innerHTML = `${getTabIconHtml(tab)}<span class="view-tab-label">${escHtml(tab.label)}</span>`;
    btn.addEventListener('click', () => activateViewTab(tab.id));
    container.appendChild(btn);
  });
  requestAnimationFrame(() => { equalizeTabWidths(); updateViewTabThumb(); });
}

renderViewTabs();
activateViewTab(activeViewTabId, true);

window.addEventListener('resize', () => { equalizeTabWidths(); updateViewTabThumb(); });

document.getElementById('right-panel-tabs').addEventListener('contextmenu', e => {
  e.preventDefault();
  ipcRenderer.send('show-tabs-context-menu', { x: e.clientX, y: e.clientY });
});

// ── Browser tabs & address bar ────────────────────────────────────
const addressBar    = document.getElementById('address-bar');
const tabsContainer = document.getElementById('tabs-container');
let tabs        = [];
let activeTabId = null;
let nextTabId   = 1;

// ── Working File empty state ──────────────────────────────────────
const wfEmpty    = document.getElementById('wf-empty');
const wfUrl      = document.getElementById('wf-url');
const wfCloneRow = document.getElementById('wf-clone-row');
const wfRepo     = document.getElementById('wf-repo');

function projectTabActive() {
  const t = tabsConfig.find(t => t.id === activeViewTabId);
  return !!(t && t.type === 'project');
}
function browserIsBlank() {
  const t = tabs.find(t => t.id === activeTabId);
  const url = t ? t.url : '';
  return !url || url === 'about:blank';
}
function updateWfEmpty() {
  const empty = projectTabActive() && browserIsBlank();
  wfEmpty.classList.toggle('visible', empty);
  if (!empty) wfCloneRow.classList.remove('visible');
  // Nothing loaded → the pick tools have nothing to act on: show them inactive.
  document.getElementById('toolbar')?.classList.toggle('tools-inactive', empty);
  ipcRenderer.send('set-browser-empty', empty);
}

// Hand a task to the active agent (fills the composer, ready to review + send)
function prefillComposer(text) {
  uiTextarea.value = text;
  uiTextarea.dispatchEvent(new Event('input', { bubbles: true }));   // resize + char count + save btn
  uiTextarea.focus();
  uiTextarea.setSelectionRange(text.length, text.length);
}
// Send a task straight to the active agent
function sendToAgent(text) {
  uiTextarea.value = text;
  sendUiMessage();
}

function wfOpen() {
  const v = wfUrl.value.trim();
  if (!v) { wfUrl.focus(); return; }
  ipcRenderer.send('browser-navigate', v);
}
document.getElementById('wf-go').addEventListener('click', wfOpen);
wfUrl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); wfOpen(); } });

document.getElementById('wf-serve').addEventListener('click', () => {
  wfCloneRow.classList.remove('visible');
  sendToAgent("I want to run a local dev server and view it here in the Working File. First, ask me which repository or project folder you should use. Once I've told you, start that project's dev server on a free, open localhost port and reply with the exact http://localhost:<port> URL so I can open it.");
});
document.getElementById('wf-clone').addEventListener('click', () => {
  wfCloneRow.classList.add('visible');
  wfRepo.focus();
});
function wfCloneGo() {
  const repo = wfRepo.value.trim();
  if (!repo) { wfRepo.focus(); return; }
  sendToAgent(`Clone the repository at ${repo} into my project folder, install its dependencies, and start its dev server on a free, open localhost port. When it's running, reply with the exact http://localhost:<port> URL so I can open it here in the Working File.`);
  wfRepo.value = '';
  wfCloneRow.classList.remove('visible');
}
document.getElementById('wf-clone-go').addEventListener('click', wfCloneGo);
wfRepo.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); wfCloneGo(); } });

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
  // Only navigate when the tab actually has a URL. Navigating blank tabs to
  // about:blank at boot raced (and aborted) the saved-URL restore in main;
  // a blank tab hides the browser view via set-browser-empty anyway.
  if (navigate && tab.url && tab.url !== 'about:blank') {
    ipcRenderer.send('browser-navigate', tab.url);
  }
  renderTabs();
  updateWfEmpty();
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
  updateWfEmpty();
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

const PICK_CURSORS = { box: 'crosshair', lasso: 'crosshair', screenshot: 'crosshair', resize: 'move', component: 'cell', draw: 'crosshair', aidev: 'crosshair' };
function applyPickCursor(mode) {
  document.documentElement.setAttribute('data-pick', mode || '');
}

function setPickMode(mode) {
  if (pickMode === mode) {
    // Toggle off: also dismiss the armed overlay in the page, not just the UI
    ipcRenderer.send('pick-cancel');
    clearPickMode();
    return;
  }
  pickMode = mode;
  applyPickCursor(mode);
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-pick-${mode}`).classList.add('active');
  ipcRenderer.send('pick-start', mode);
}

document.getElementById('btn-pick-box').addEventListener('click',   () => setPickMode('box'));
document.getElementById('btn-pick-lasso').addEventListener('click', () => setPickMode('lasso'));
document.getElementById('btn-pick-aidev').addEventListener('click', () => setPickMode('aidev'));
document.getElementById('btn-screenshot').addEventListener('click', () => {
  if (pickMode === 'screenshot') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'screenshot';
  applyPickCursor('screenshot');
  document.getElementById('btn-screenshot').classList.add('active');
  ipcRenderer.send('pick-screenshot');
});
document.getElementById('btn-pick-resize').addEventListener('click', () => {
  if (pickMode === 'resize') { ipcRenderer.send('pick-cancel'); clearPickMode(); return; }
  clearPickMode();
  pickMode = 'resize';
  applyPickCursor('resize');
  document.getElementById('btn-pick-resize').classList.add('active');
  ipcRenderer.send('pick-resize');
});

document.getElementById('btn-draw').addEventListener('click', () => {
  if (pickMode === 'draw') { clearPickMode(); ipcRenderer.send('draw-cancel'); return; }
  clearPickMode();
  pickMode = 'draw';
  applyPickCursor('draw');
  document.getElementById('btn-draw').classList.add('active');
  ipcRenderer.send('pick-draw');
});

function clearPickMode() {
  pickMode = null;
  applyPickCursor(null);
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
}

ipcRenderer.on('pick-cancelled', () => clearPickMode());
ipcRenderer.on('pick-complete',  () => clearPickMode());

// Route a message to the active session — chat (ACP) or PTY. The single
// sending path for tools, audits, and the composer. `display` is what the
// chat bubble shows when it differs from the full prompt text (e.g. chip
// summaries instead of full Figma instructions).
function routeToActiveSession(text, display = text) {
  const s = sessions.get(activeId);
  if (!s) return;
  if (s.type === 'acp') {
    acpAddUserMsg(s, display);
    acpSetStatus(s, 'thinking');
    ipcRenderer.send('acp-prompt', { id: activeId, text });
  } else {
    s.term.paste(text);
    setTimeout(() => ipcRenderer.send('pty-input', { id: activeId, data: '\r' }), PTY_SEND_DELAY);
  }
}

// Route pick/screenshot output to the active session
ipcRenderer.on('pick-send-to-session', (_, message) => routeToActiveSession(message));

// Composite draw canvas over page screenshot in the renderer (has Canvas API)
ipcRenderer.on('draw-composite', async (_, { pageB64, canvasDataUrl, instructions }) => {
  const offscreen = document.createElement('canvas');
  const img1 = new Image(), img2 = new Image();
  img1.src = 'data:image/png;base64,' + pageB64;
  img2.src = canvasDataUrl;
  await Promise.all([
    new Promise(r => { img1.onload = r; img1.onerror = r; }),
    new Promise(r => { img2.onload = r; img2.onerror = r; }),
  ]);
  offscreen.width  = img1.naturalWidth  || img2.naturalWidth;
  offscreen.height = img1.naturalHeight || img2.naturalHeight;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(img1, 0, 0);
  ctx.drawImage(img2, 0, 0);
  ipcRenderer.send('draw-composite-done', { compositeDataUrl: offscreen.toDataURL('image/png'), instructions });
});

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressBar.focus(); }
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab(''); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
  if (e.key === 'F5')  ipcRenderer.send('browser-reload');
  if (e.key === 'F12') ipcRenderer.send('browser-toggle-devtools');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '\\') { e.preventDefault(); btnPanelToggle.click(); }

  // Escape — cancel active tool
  if (e.key === 'Escape' && pickMode) {
    ipcRenderer.send('pick-cancel');
    clearPickMode();
  }

  // Save prompt
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
    e.preventDefault();
    if (uiTextarea.value.trim()) btnSavePrompt.click();
  }
});

// ── Shortcut actions forwarded from main.js before-input-event ──────────
// before-input-event fires in the main process for whichever WebContentsView
// currently has keyboard focus, then sends this IPC to the renderer. Tool
// shortcuts are Alt+<letter>, so no input-focus guard is needed.
const TOOL_BTN = { b: 'btn-pick-box', l: 'btn-pick-lasso', i: 'btn-screenshot', r: 'btn-pick-resize', s: 'btn-pick-component', m: 'btn-draw', a: 'btn-pick-aidev' };
ipcRenderer.on('shortcut-action', (_, action) => {
  if (action.type === 'tab-switch') {
    const idx = tabsConfig.findIndex(t => t.id === activeViewTabId);
    if (idx !== -1) activateViewTab(tabsConfig[(idx + action.dir + tabsConfig.length) % tabsConfig.length].id);
  } else if (action.type === 'tool') {
    document.getElementById(TOOL_BTN[action.key])?.click();
  } else if (action.type === 'panel-toggle') {
    btnPanelToggle.click();
  } else if (action.type === 'escape' && pickMode) {
    ipcRenderer.send('pick-cancel');
    clearPickMode();
  }
});

// ── Left-panel mode: Terminal ↔ UI ────────────────────────────────
const uiTextarea  = document.getElementById('ui-textarea');
const uiCharCount = document.getElementById('ui-char-count');
let msgHistory = [];
let historyIdx  = 0;

function refitActive() { refitSession(activeId, 60); }


// ── Audit types (persisted) ───────────────────────────────────────
const AUDIT_TYPES_DEFAULT = [
  { label: 'Correctness',     prompt: 'Run a correctness audit on this codebase. Check for logic bugs, off-by-one errors, edge cases not handled, race conditions, unhandled promise rejections, and dead or unreachable code. Report findings only — do not make changes.' },
  { label: 'Security',        prompt: 'Run a security audit on this codebase. Check for injection vulnerabilities (XSS, SQL, command injection), unsafe use of eval, sensitive data hardcoded in source, authentication or authorization gaps, and insecure storage. Report findings only — do not make changes.' },
  { label: 'Performance',     prompt: 'Run a performance audit on this codebase. Check for unnecessary work in hot paths, memory leaks (event listeners not removed, unbounded collections), expensive operations inside loops, and repeated DOM queries that could be cached. Report findings only — do not make changes.' },
  { label: 'Maintainability', prompt: 'Run a maintainability audit on this codebase. Check for duplicated logic, magic numbers or strings that should be named constants, overly complex functions, inconsistent naming or patterns, and non-obvious behavior lacking any explanation. Report findings only — do not make changes.' },
  { label: 'Reliability',     prompt: 'Run a reliability audit on this codebase. Check for missing null/undefined guards at system boundaries, unhandled failure cases from external calls, state that can get out of sync between components, and assumptions that may not hold at runtime. Report findings only — do not make changes.' },
  { label: 'Accessibility',   prompt: 'Run an accessibility audit on this codebase. Check for missing ARIA roles and labels, interactive elements unreachable by keyboard, focus not managed on dynamic content, missing alt text on images, and hardcoded colors that may have insufficient contrast. Report findings only — do not make changes.' },
  { label: 'Dependencies',    prompt: 'Run a dependency audit on this project. Review package.json and any lock files for outdated packages, abandoned or unmaintained libraries, known vulnerability patterns, and packages pulling in far more than needed for the task. Report findings only — do not make changes.' },
];

let auditTypes = (() => {
  try {
    const stored = localStorage.getItem(LS.auditTypes);
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return AUDIT_TYPES_DEFAULT.map(t => ({ ...t }));
})();

function buildAuditMenu() {
  const auditMenu = document.getElementById('audit-menu');
  if (!auditMenu) return;
  auditMenu.innerHTML = auditTypes.map((t, i) =>
    `<div class="audit-item" data-i="${i}"><span class="audit-item-label">${escHtml(t.label)}</span></div>`
  ).join('')
  + `<div class="audit-divider"></div>`
  + `<div class="audit-item audit-item-edit" data-action="edit-prompts"><span class="audit-item-label">Edit prompts…</span></div>`;
}

(function initAuditDropdown() {
  const btnAudit  = document.getElementById('btn-audit');
  const auditMenu = document.getElementById('audit-menu');
  if (!btnAudit || !auditMenu) return;

  buildAuditMenu();

  btnAudit.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = auditMenu.classList.toggle('open');
    btnAudit.classList.toggle('active', isOpen);
  });

  auditMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.audit-item');
    if (!item) return;
    auditMenu.classList.remove('open');
    btnAudit.classList.remove('active');
    if (item.dataset.action === 'edit-prompts') {
      openAuditPromptsModal?.();
      return;
    }
    const audit = auditTypes[parseInt(item.dataset.i)];
    if (!audit) return;
    if (!activeId) return;
    routeToActiveSession(audit.prompt);
  });

  document.addEventListener('click', (e) => {
    if (!auditMenu.classList.contains('open')) return;
    if (!btnAudit.contains(e.target) && !auditMenu.contains(e.target)) {
      auditMenu.classList.remove('open');
      btnAudit.classList.remove('active');
    }
  });
})();

// ── Audit prompts modal ───────────────────────────────────────────
(function initAuditPromptsModal() {
  const modal     = document.getElementById('audit-prompts-modal');
  const list      = document.getElementById('audit-prompts-list');
  const addBtn    = document.getElementById('audit-prompts-add');
  const cancelBtn = document.getElementById('audit-prompts-cancel');
  const saveBtn   = document.getElementById('audit-prompts-save');
  if (!modal) return;

  const esc = escHtml;

  function addCard(label = '', prompt = '', expanded = false) {
    const card = document.createElement('div');
    card.className = 'ap-card' + (expanded ? ' expanded' : '');
    card.innerHTML = `
      <div class="ap-card-row">
        <span class="ap-chevron">${chevronRightIcon(14)}</span>
        <span class="ap-card-name"></span>
        <button class="ap-delete" title="Remove prompt">${trashIcon(15)}</button>
      </div>
      <div class="ap-card-body">
        <span class="ap-field-title">Label</span>
        <input class="ap-label" placeholder="e.g. Security" value="${esc(label)}" />
        <span class="ap-field-title">Prompt</span>
        <textarea class="ap-prompt" rows="3" placeholder="Audit prompt sent to Claude Code...">${esc(prompt)}</textarea>
      </div>
    `;
    const nameEl  = card.querySelector('.ap-card-name');
    const labelIn = card.querySelector('.ap-label');
    const syncName = () => {
      const v = labelIn.value.trim();
      nameEl.innerHTML = v ? esc(v) : '<em>New prompt</em>';
    };
    syncName();
    labelIn.addEventListener('input', syncName);

    card.querySelector('.ap-card-row').addEventListener('click', (e) => {
      if (e.target.closest('.ap-delete')) return;
      card.classList.toggle('expanded');
    });
    card.querySelector('.ap-delete').addEventListener('click', () => card.remove());
    list.appendChild(card);
    return card;
  }

  function renderCards() {
    list.innerHTML = '';
    auditTypes.forEach(t => addCard(t.label, t.prompt));
  }

  const ctl = wireModal(modal);

  addBtn.addEventListener('click', () => {
    const card = addCard('', '', true);
    card.querySelector('.ap-label').focus();
  });

  cancelBtn.addEventListener('click', ctl.close);

  saveBtn.addEventListener('click', () => {
    const updated = [];
    list.querySelectorAll('.ap-card').forEach(card => {
      const label  = card.querySelector('.ap-label').value.trim();
      const prompt = card.querySelector('.ap-prompt').value.trim();
      if (label && prompt) updated.push({ label, prompt });
    });
    auditTypes = updated;
    localStorage.setItem(LS.auditTypes, JSON.stringify(auditTypes));
    buildAuditMenu();
    ctl.close();
  });

  openAuditPromptsModal = function() {
    renderCards();
    ctl.open();
  };
})();

// ── Edit Tabs modal ───────────────────────────────────────────────
(function initEditTabsModal() {
  const modal      = document.getElementById('tabs-modal');
  const listEl     = document.getElementById('tabs-modal-list');
  const addSel     = document.getElementById('tabs-add-select');
  const addBtn     = document.getElementById('tabs-add-btn');
  const urlFields  = document.getElementById('tabs-add-url-fields');
  const addLabelIn = document.getElementById('tabs-add-label');
  const addUrlIn   = document.getElementById('tabs-add-url-input');
  const cancelBtn  = document.getElementById('tabs-modal-cancel');
  const saveBtn    = document.getElementById('tabs-modal-save');
  if (!modal) return;

  // Both derived from the TAB_TYPES catalog — see its comment.
  const BUILTIN_DEFAULTS = Object.fromEntries(BUILTIN_TAB_ORDER.map(t => [t, defaultTabFor(t)]));
  const BUILTIN_OPTIONS  = BUILTIN_TAB_ORDER.map(t => ({ value: t, label: TAB_TYPES[t].label }));

  const esc = escHtml;

  let draft = [];
  let dragSrcIdx = -1;

  function updateAddSelect() {
    const prev = addSel.value;
    addSel.innerHTML = '';
    BUILTIN_OPTIONS.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      addSel.appendChild(opt);
    });
    const urlOpt = document.createElement('option');
    urlOpt.value = 'url'; urlOpt.textContent = 'Custom URL…';
    addSel.appendChild(urlOpt);
    if ([...addSel.options].some(o => o.value === prev)) addSel.value = prev;
    if (addSel.value === 'url') urlFields.classList.add('visible');
    else urlFields.classList.remove('visible');
    updateAddBtn();
  }

  const GRIP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="16" height="16" fill="currentColor"><circle cx="9" cy="6.75" r="1.25"/><circle cx="14.25" cy="6.75" r="1.25"/><circle cx="3.75" cy="6.75" r="1.25"/><circle cx="9" cy="11.25" r="1.25"/><circle cx="14.25" cy="11.25" r="1.25"/><circle cx="3.75" cy="11.25" r="1.25"/></svg>`;

  function renderList() {
    listEl.innerHTML = '';
    draft.forEach((tab, i) => {
      const row = document.createElement('div');
      row.className = 'tabs-modal-row';
      const isUrl = tab.type === 'url';
      row.innerHTML = `
        <span class="tabs-modal-drag" title="Drag to reorder">${GRIP_ICON}</span>
        <span class="tabs-modal-row-icon">${getTabIconHtml(tab)}</span>
        <span class="tabs-modal-row-label">${esc(tab.label)}</span>
        ${isUrl
          ? `<span class="tabs-modal-row-url" title="${esc(tab.url || '')}">${esc(tab.url || '')}</span>`
          : `<span class="tabs-modal-row-badge">${esc(tab.type)}</span>`}
        <button class="tabs-modal-remove" title="Remove">✕</button>
      `;
      row.draggable = true;

      row.addEventListener('dragstart', e => {
        dragSrcIdx = i;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => row.classList.add('dragging'));
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        listEl.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
        if (dragSrcIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        if (dragSrcIdx === -1 || dragSrcIdx === i) return;
        const [moved] = draft.splice(dragSrcIdx, 1);
        draft.splice(i, 0, moved);
        dragSrcIdx = -1;
        renderList();
      });

      row.querySelector('.tabs-modal-remove').addEventListener('click', () => {
        draft.splice(i, 1);
        renderList();
      });

      listEl.appendChild(row);
    });

    updateAddSelect();
  }

  function updateAddBtn() {
    if (addSel.value === 'url') {
      const ready = !!(addLabelIn.value.trim() && addUrlIn.value.trim());
      addBtn.disabled = !ready;
      addBtn.classList.toggle('ready', ready);
    } else {
      addBtn.disabled = false;
      addBtn.classList.add('ready');
    }
  }

  addSel.addEventListener('change', () => {
    if (addSel.value === 'url') urlFields.classList.add('visible');
    else urlFields.classList.remove('visible');
    updateAddBtn();
  });
  addLabelIn.addEventListener('input', updateAddBtn);
  addUrlIn.addEventListener('input', updateAddBtn);

  addBtn.addEventListener('click', () => {
    const type = addSel.value;
    if (type === 'url') {
      const label = addLabelIn.value.trim();
      let url     = addUrlIn.value.trim();
      if (!label || !url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      draft.push({ id: 'url:' + url, type: 'url', label, url });
      addLabelIn.value = '';
      addUrlIn.value   = '';
    } else {
      const base = BUILTIN_DEFAULTS[type];
      const count = draft.filter(t => t.type === type).length;
      const label = count === 0 ? base.label : `${base.label} ${toRoman(count + 1)}`;
      const id    = count === 0 ? base.id : `${base.id}-${count + 1}`;
      draft.push({ id, type, label });
    }
    renderList();
  });

  const ctl = wireModal(modal);

  saveBtn.addEventListener('click', () => {
    // Destroy removed custom views in main
    tabsConfig
      .filter(t => t.type === 'url' && !draft.some(d => d.id === t.id))
      .forEach(t => ipcRenderer.send('destroy-custom-view', t.url));

    tabsConfig = draft;
    localStorage.setItem(LS.tabs, JSON.stringify(tabsConfig));
    renderViewTabs();

    // If active tab was removed, switch to first available
    if (tabsConfig.length && !tabsConfig.find(t => t.id === activeViewTabId)) {
      activateViewTab(tabsConfig[0].id);
    }

    ctl.close();
  });

  cancelBtn.addEventListener('click', ctl.close);

  openEditTabsModal = function() {
    draft = tabsConfig.map(t => ({ ...t }));
    addLabelIn.value = '';
    addUrlIn.value   = '';
    renderList(); // also calls updateAddSelect() → updateAddBtn()
    ctl.open();
  };
})();

// ── MCP Tools modal ───────────────────────────────────────────────
(function initMcpToolsModal() {
  const modal        = document.getElementById('mcp-modal');
  const listEl       = document.getElementById('mcp-modal-list');
  const svcSel       = document.getElementById('mcp-service-select');
  const customFields = document.getElementById('mcp-custom-fields');
  const tokenField   = document.getElementById('mcp-token-field');
  const nameIn       = document.getElementById('mcp-add-name');
  const pkgIn        = document.getElementById('mcp-add-package');
  const envVarIn     = document.getElementById('mcp-add-envvar');
  const tokenIn      = document.getElementById('mcp-add-token-input');
  const tokenHint    = document.getElementById('mcp-token-hint');
  const noTokenInfo  = document.getElementById('mcp-no-token-info');
  const addBtn       = document.getElementById('mcp-add-btn');
  const closeBtn     = document.getElementById('mcp-cancel');
  const restartNotice = document.getElementById('mcp-restart-notice');
  const restartBtn   = document.getElementById('mcp-restart-btn');
  if (!modal) return;

  const connectMsg = document.getElementById('mcp-connect-msg');

  const TOKEN_HINTS = {
    'figma-framelink': 'Generate a Personal Access Token at figma.com → Settings → Security → Personal access tokens',
    'figma-devmode':   'No token. Requires the Figma desktop app running with Dev Mode MCP enabled (Preferences → Enable Dev Mode MCP Server).',
    'github':          'Generate a token at github.com → Settings → Developer settings → Personal access tokens',
    'linear':          'Generate an API key at linear.app → Settings → API',
    'browser':         'No token needed. Launches a Playwright-controlled browser.',
  };
  // Catalog keys that need no token — Connect enabled immediately
  const NO_TOKEN_SERVICES = new Set(['browser', 'figma-devmode']);
  const NO_TOKEN_DESCRIPTIONS = {
    'browser':       'No API key needed — controls a Playwright browser directly.',
    'figma-devmode': 'No API key needed — connects to the Figma desktop app’s local Dev Mode server. Make sure Figma desktop is open with Dev Mode MCP enabled.',
  };

  let agentList = [];   // [{key,label}]
  let servers   = [];   // [{name, agents:{key:status}}]

  const esc = escHtml;

  function agentDots(srv) {
    return agentList.map(a => {
      const st = srv.agents[a.key];
      const cls = st === 'connected' ? 'ok' : st === 'disabled' ? 'warn' : st ? 'on' : 'off';
      const title = st ? `${a.label}: ${st}` : `${a.label}: not added`;
      return `<span class="mcp-agent-dot ${cls}" title="${esc(title)}">${esc(a.label.split(' ')[0])}</span>`;
    }).join('');
  }

  function renderRows() {
    listEl.innerHTML = '';
    if (!servers.length) {
      listEl.innerHTML = '<div class="mcp-status">No MCP servers connected yet.</div>';
      return;
    }
    servers.forEach((srv) => {
      const row = document.createElement('div');
      row.className = 'mcp-list-row';
      row.innerHTML = `
        <span class="mcp-list-name">${esc(srv.name)}</span>
        <span class="mcp-agent-dots">${agentDots(srv)}</span>
        <button class="tabs-modal-remove" title="Disconnect from all agents">✕</button>
      `;
      row.querySelector('.tabs-modal-remove').addEventListener('click', async () => {
        row.querySelector('.tabs-modal-remove').textContent = '…';
        await ipcRenderer.invoke('mcp-disconnect', { serverName: srv.name });
        await loadAndRender();
      });
      listEl.appendChild(row);
    });
  }

  function updateVisibility() {
    const svc       = svcSel.value;
    const custom    = svc === 'custom';
    const noToken   = NO_TOKEN_SERVICES.has(svc);
    const needToken = !!svc && !noToken && !custom;
    customFields.classList.toggle('visible', custom);
    tokenField.classList.toggle('visible', needToken || custom);
    if (tokenHint)   tokenHint.textContent = (svc && TOKEN_HINTS[svc]) || '';
    if (noTokenInfo) {
      noTokenInfo.textContent = noToken ? (NO_TOKEN_DESCRIPTIONS[svc] || '') : '';
      noTokenInfo.classList.toggle('visible', noToken && !!svc);
    }
  }

  function updateConnectBtn() {
    const svc = svcSel.value;
    let ready = false;
    if (NO_TOKEN_SERVICES.has(svc)) {
      ready = true;
    } else if (svc === 'custom') {
      ready = !!(nameIn.value.trim() && pkgIn.value.trim());
    } else if (svc) {
      ready = !!tokenIn.value.trim();
    }
    addBtn.disabled = !ready;
    addBtn.classList.toggle('ready', ready);
  }

  svcSel.addEventListener('change', () => { updateVisibility(); updateConnectBtn(); });
  [nameIn, pkgIn, envVarIn, tokenIn].forEach(el => el.addEventListener('input', updateConnectBtn));
  updateConnectBtn();

  addBtn.addEventListener('click', async () => {
    const svc   = svcSel.value;
    const token = tokenIn.value.trim();
    if (!svc) return;

    addBtn.disabled = true;
    addBtn.textContent = 'Connecting…';
    connectMsg.className = 'mcp-connect-msg';
    connectMsg.textContent = `Adding to ${agentList.map(a => a.label).join(', ') || 'agents'}…`;

    const result = await ipcRenderer.invoke('mcp-connect', {
      catalogKey: svc,
      token,
      custom: svc === 'custom'
        ? { name: nameIn.value.trim(), npxPackage: pkgIn.value.trim(), envVar: envVarIn.value.trim() }
        : undefined,
    });

    addBtn.textContent = 'Connect';

    if (!result || result.error) {
      connectMsg.className = 'mcp-connect-msg err';
      connectMsg.textContent = result?.error || 'Connection failed.';
      updateConnectBtn();
      return;
    }

    const okAgents  = result.results.filter(r => r.ok).map(r => r.label);
    const badAgents = result.results.filter(r => !r.ok);
    if (okAgents.length) {
      connectMsg.className = 'mcp-connect-msg ok';
      connectMsg.textContent = `✓ Added to ${okAgents.join(', ')}.` +
        (badAgents.length ? `  Failed: ${badAgents.map(b => b.label).join(', ')}.` : '');
      restartNotice.classList.add('visible');
    } else {
      connectMsg.className = 'mcp-connect-msg err';
      connectMsg.textContent = `Failed: ${badAgents.map(b => `${b.label} (${b.detail})`).join('; ')}`;
    }

    svcSel.value = ''; tokenIn.value = ''; nameIn.value = ''; pkgIn.value = ''; envVarIn.value = '';
    updateVisibility();
    updateConnectBtn();
    await loadAndRender();
  });

  async function loadAndRender() {
    listEl.innerHTML = '<div class="mcp-status">Checking agents…</div>';
    const status = await ipcRenderer.invoke('mcp-status');
    agentList = status.agents || [];
    servers   = status.servers || [];
    renderRows();
    refreshFigmaTool();   // show/hide the composer Figma button as connections change
  }

  // backdropClose off: a stray click during a long `mcp list` check shouldn't dismiss
  const ctl = wireModal(modal, { backdropClose: false });

  restartBtn.addEventListener('click', () => {
    if (activeId !== null) ipcRenderer.send('pty-restart', { id: activeId });
    ctl.close();
  });

  closeBtn.addEventListener('click', ctl.close);

  openMcpToolsModal = async function() {
    restartNotice.classList.remove('visible');
    connectMsg.textContent = '';
    connectMsg.className = 'mcp-connect-msg';
    svcSel.value = '';
    updateVisibility();
    updateConnectBtn();
    ctl.open();
    await loadAndRender();
  };
})();

// ── Keyboard Shortcuts modal ──────────────────────────────────────
(function initKeyboardShortcutsModal() {
  const modal    = document.getElementById('kb-modal');
  const closeBtn = document.getElementById('kb-close');
  if (!modal) return;

  const ctl = wireModal(modal);
  closeBtn.addEventListener('click', ctl.close);
  openKeyboardShortcutsModal = ctl.open;
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
let savedPrompts = JSON.parse(localStorage.getItem(LS.savedPrompts) || '[]');

function savePromptsToStorage() {
  localStorage.setItem(LS.savedPrompts, JSON.stringify(savedPrompts));
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
  const figma = figmaChips.slice();
  if (!raw.trim() && !figma.length) return;

  // A Framelink action can't run without its Figma URL — prompt for it instead of sending.
  const missing = figma.find(f => f.needsUrl && !f.url);
  if (missing) { focusChipUrl(missing.key); return; }

  if (raw.trim()) {
    msgHistory.push(raw);
    if (msgHistory.length > MSG_HISTORY_MAX) msgHistory.shift();
    historyIdx = msgHistory.length;
  }

  // Compose: Figma action instructions (with their URL) first, then the user's free text.
  let body = raw;
  if (figma.length) {
    const instr = figma
      .map(f => f.needsUrl && f.url ? `${f.instruction}\n\nFigma URL: ${f.url}` : f.instruction)
      .join('\n\n');
    body = instr + (raw.trim() ? '\n\n' + raw : '');
  }
  // What the user sees in the chat (chip titles + their text)
  const display = figma.length
    ? figma.map(f => `[Figma: ${f.title}]`).join(' ') + (raw.trim() ? '\n' + raw : '')
    : raw;

  const text = (sbConfig && sbConfig.autoInject)
    ? sbContextText(sbConfig) + '\n\n' + body
    : body;
  routeToActiveSession(text, display);
  clearFigmaChips();
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

let updateComponentPickerBtn = null; // set by component picker IIFE

// ── Storybook panel ──────────────────────────────────────────────
let sbConfig = JSON.parse(localStorage.getItem(LS.storybook) || 'null');

function sbContextText(cfg) {
  return `[Design System] Before making any UI changes, reference the Storybook at ${cfg.value}. Use its design tokens, component APIs, and visual styles to ensure consistency with the existing design system.`;
}

function renderSbConnected() {
  document.getElementById('sb-setup').style.display     = 'none';
  document.getElementById('sb-connected').style.display = 'flex';
  document.getElementById('sb-conn-val').textContent    = sbConfig.value;
  document.getElementById('sb-auto-conn').checked       = sbConfig.autoInject;
  document.getElementById('sb-preview-text').textContent = sbContextText(sbConfig);
  document.getElementById('sb-preview').style.display = sbConfig.autoInject ? '' : 'none';
  const filesEl = document.getElementById('sb-memory-files');
  if (filesEl) {
    filesEl.textContent = `${sbConfig.projectDir || 'Home folder (global)'}  —  CLAUDE.md · AGENTS.md · GEMINI.md`;
  }
}

function renderSbSetup() {
  document.getElementById('sb-setup').style.display     = 'flex';
  document.getElementById('sb-connected').style.display = 'none';
}

function sbNotifyMain() {
  if (sbConfig) ipcRenderer.send('storybook-load-url', sbConfig.value);
  else          ipcRenderer.send('storybook-disconnect');
}

// Init — restore live view if URL was previously connected
ipcRenderer.send('set-project-dir', { dir: (sbConfig && sbConfig.projectDir) || '' });
if (sbConfig) {
  if (sbConfig.projectDir) document.getElementById('sb-folder').value = sbConfig.projectDir;
  renderSbConnected();
  sbNotifyMain();
} else renderSbSetup();

document.getElementById('sb-folder-pick').addEventListener('click', async () => {
  const dir = await ipcRenderer.invoke('show-folder-dialog');
  if (dir) document.getElementById('sb-folder').value = dir;
});

document.getElementById('sb-connect').addEventListener('click', async () => {
  const url  = document.getElementById('sb-url').value.trim();
  const auto = document.getElementById('sb-auto').checked;
  const dir  = document.getElementById('sb-folder').value.trim();
  if (!url) {
    document.getElementById('sb-url').focus();
    document.getElementById('sb-url').style.borderColor = '#f44747';
    setTimeout(() => document.getElementById('sb-url').style.borderColor = '', 1500);
    return;
  }
  sbConfig = { value: url, autoInject: auto, projectDir: dir };
  localStorage.setItem(LS.storybook, JSON.stringify(sbConfig));
  // Point future sessions at the project dir, then write the memory files there
  ipcRenderer.send('set-project-dir', { dir });
  await ipcRenderer.invoke('storybook-write-memory', { url });
  renderSbConnected();
  sbNotifyMain();
  updateComponentPickerBtn?.();
});

document.getElementById('sb-disconnect').addEventListener('click', async () => {
  await ipcRenderer.invoke('storybook-clear-memory');   // remove the managed block first
  sbConfig = null;
  localStorage.removeItem(LS.storybook);
  document.getElementById('sb-url').value = '';
  document.getElementById('sb-folder').value = '';
  ipcRenderer.send('set-project-dir', { dir: '' });
  renderSbSetup();
  ipcRenderer.send('storybook-disconnect');
  updateComponentPickerBtn?.();
});

document.getElementById('sb-auto-conn').addEventListener('change', e => {
  if (!sbConfig) return;
  sbConfig.autoInject = e.target.checked;
  localStorage.setItem(LS.storybook, JSON.stringify(sbConfig));
  document.getElementById('sb-preview').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('sb-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sb-connect').click(); }
  e.stopPropagation();
});

// ── Component picker ─────────────────────────────────────────────
(function initComponentPicker() {
  const btn = document.getElementById('btn-pick-component');
  if (!btn) return;

  let pickActive = false;

  updateComponentPickerBtn = function() {
    btn.disabled = !sbConfig;
    btn.title = sbConfig
      ? 'Click element on page to pick Storybook component'
      : 'Connect a Storybook to use component picker';
  };
  updateComponentPickerBtn();

  btn.addEventListener('click', () => {
    if (!sbConfig) return;
    if (pickActive) {
      // 'pick-cancel' dispatches Escape into the page so the click-capture
      // overlay actually tears down (sending 'pick-cancelled' did nothing —
      // that's a main→renderer event with no ipcMain handler).
      ipcRenderer.send('pick-cancel');
      pickActive = false;
      clearPickMode();
      return;
    }
    pickActive = true;
    pickMode = 'component';   // lets the global Escape handler cancel this mode too
    btn.classList.add('active');
    ipcRenderer.send('pick-component');
  });

  ipcRenderer.on('pick-cancelled', () => { pickActive = false; });

  ipcRenderer.on('pick-component-result', (_, target) => {
    pickActive = false;
    ipcRenderer.send('open-component-picker', { target, sbUrl: sbConfig.value });
  });
})();

// ── Onboarding (setup checklist + tools tour) ─────────────────────
let openOnboarding = null;
(function initOnboarding() {
  const modal   = document.getElementById('onboarding');
  const stepsEl = document.getElementById('onb-steps');
  const optEl   = document.getElementById('onb-optional');
  const toolsEl = document.getElementById('onb-tools-grid');
  if (!modal) return;

  const ONB_STEPS = [
    { id: 'wsl', detect: 'wsl', manual: true, title: 'WSL 2 + Ubuntu',
      desc: 'The Linux environment Cathode runs your agents in. One-time — needs admin & a reboot.',
      cmd: 'wsl --install',
      manualHtml: 'Open <b>Windows PowerShell as Administrator</b>, run the command below, then <b>reboot</b>. After Ubuntu finishes its first-time setup, come back and press <b>Re-check</b>.' },
    { id: 'node', detect: 'node', title: 'Node.js',
      desc: 'Runtime for Claude Code and MCP servers (installs via nvm — no admin needed).',
      cmd: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts' },
    { id: 'claude', detect: 'claude', title: 'Claude Code',
      desc: "Anthropic's coding agent CLI — the default agent.",
      cmd: 'npm install -g @anthropic-ai/claude-code' },
    { id: 'auth', detect: 'auth', auth: true, title: 'Sign in to Claude',
      desc: 'Authenticate with your Anthropic account or an API key so the agent can run.' },
  ];

  const AUDIT_ICON = '<svg viewBox="0 0 18 18" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M14.25 11.75V14.25C14.25 15.355 13.355 16.25 12.25 16.25H5.75C4.645 16.25 3.75 15.355 3.75 14.25V12.25"/><path d="M3.75 6.25V3.75C3.75 2.645 4.645 1.75 5.75 1.75H12.25C13.355 1.75 14.25 2.645 14.25 3.75V5.75"/><path d="M1.75 9.25H5.51C5.95 9.25 6.338 8.963 6.466 8.542L7.465 5.272C7.514 5.111 7.741 5.109 7.793 5.269L10.207 12.729C10.259 12.889 10.486 12.887 10.535 12.726L11.534 9.456C11.662 9.035 12.051 8.748 12.49 8.748H16.25"/></svg>';
  const EYE_ICON = eyeIcon(14);

  // Each tool: name, blurb, and `sel` = the real element to highlight on hover
  // (its icon is also cloned from that element so the cards match the app).
  const TOOL_SECTIONS = [
    { title: 'Workspace', tools: [
      { n: 'Working File', d: 'Target a live site or local dev server to inspect & edit with your agent.', sel: '.view-tab[data-view="project"]' },
      { n: 'Storybook', d: 'Pick a design-system component to insert at a targeted location on the page.', sel: '.view-tab[data-view="storybook"]' },
      { n: 'Usage', d: 'Context-window fill and your 5-hour / weekly Claude limits as live gauges.', sel: '#btn-usage' },
    ]},
    { title: 'Toolbar tools', tools: [
      { n: 'Box select', d: 'Draw a box to select page elements and send them to chat (Alt+B).', sel: '#btn-pick-box' },
      { n: 'Lasso select', d: 'Freehand-select page elements (Alt+L).', sel: '#btn-pick-lasso' },
      { n: 'Resize', d: 'Resize an element directly on the page (Alt+R).', sel: '#btn-pick-resize' },
      { n: 'Screenshot', d: 'Capture a region of the page for the agent (Alt+I).', sel: '#btn-screenshot' },
      { n: 'Draw', d: 'Annotate the page with a marker, then hand it over (Alt+M).', sel: '#btn-draw' },
    ]},
    { title: 'Panel controls', tools: [
      { n: 'Audit', d: 'Run a code audit — pick an audit type from the dropdown.', sel: '#btn-audit', icon: AUDIT_ICON },
      { n: 'Chat / Terminal', d: 'Toggle a Claude session between chat view and the raw terminal.', sel: '#session-view-toggle' },
      { n: 'Inspect (DevTools)', d: 'Open the embedded DevTools panel for the page.', sel: '#btn-devtools' },
    ]},
  ];

  const els = {};

  function setState(step, state, badge) {
    const e = els[step.id];
    if (!e) return;
    e.root.className = 'onb-step ' + state;
    e.badge.textContent = badge;
  }

  async function detect(step) {
    if (step.detect === 'wsl')  return ipcRenderer.invoke('check-wsl');
    if (step.detect === 'auth') return ipcRenderer.invoke('check-claude-auth');
    return ipcRenderer.invoke('check-model', { command: step.detect });
  }

  async function recheck(step) {
    setState(step, 'checking', 'Checking…');
    const ok = await detect(step);
    setState(step, ok ? 'ok' : 'missing', ok ? 'Installed' : 'Missing');
    const e = els[step.id];
    if (e && e.installBtn) e.installBtn.disabled = false;
  }

  function runInstall(step) {
    const e = els[step.id];
    setState(step, 'running', 'Installing…');
    e.installBtn.disabled = true;
    e.log.classList.add('visible');
    e.log.textContent = '$ ' + step.cmd + '\n\n';
    ipcRenderer.send('onboarding-run', { id: step.id, command: step.cmd });
  }

  ipcRenderer.on('onboarding-output', (_, { id, data }) => {
    const e = els[id];
    if (e) { e.log.textContent += data; e.log.scrollTop = e.log.scrollHeight; }
  });
  ipcRenderer.on('onboarding-done', (_, { id, code }) => {
    const e = els[id];
    if (e) e.log.textContent += `\n[finished · exit ${code}]\n`;
    const step = ONB_STEPS.find(s => s.id === id) || ONB_STEPS_OPT.find(s => s.id === id);
    if (step) recheck(step);
  });

  const esc = escHtml;

  function renderSteps() {
    stepsEl.innerHTML = '';
    ONB_STEPS.forEach((step, i) => {
      const root = document.createElement('div');
      root.className = 'onb-step checking';
      root.innerHTML = `
        <div class="onb-step-row">
          <span class="onb-step-icon">${i + 1}</span>
          <div class="onb-step-main">
            <div class="onb-step-title">${step.title} <span class="onb-step-badge">Checking…</span></div>
            <div class="onb-step-desc">${step.desc}</div>
          </div>
          <div class="onb-step-actions"></div>
        </div>
        <div class="onb-step-extra"></div>`;
      const actions = root.querySelector('.onb-step-actions');
      const extra   = root.querySelector('.onb-step-extra');
      const badge   = root.querySelector('.onb-step-badge');

      const recheckBtn = mkBtn('Re-check', '', () => recheck(step));

      let installBtn = null, log = null;
      if (step.manual) {
        extra.innerHTML = `<div class="onb-manual">${step.manualHtml}</div>
          <div class="onb-cmd"><code>${esc(step.cmd)}</code></div>`;
        const cmdRow = extra.querySelector('.onb-cmd');
        cmdRow.appendChild(mkBtn('Copy', 'primary', () => navigator.clipboard.writeText(step.cmd)));
        actions.appendChild(recheckBtn);
      } else if (step.auth) {
        installBtn = mkBtn('Open authentication', 'primary', () => openAuthModal());
        actions.appendChild(installBtn);
        actions.appendChild(recheckBtn);
      } else {
        log = document.createElement('div');
        log.className = 'onb-log';
        extra.appendChild(log);
        installBtn = mkBtn('Install', 'primary', () => runInstall(step));
        actions.appendChild(installBtn);
        actions.appendChild(recheckBtn);
      }

      stepsEl.appendChild(root);
      els[step.id] = { root, badge, installBtn, log: log || document.createElement('div') };
    });
  }

  function renderOptional() {
    optEl.innerHTML = '';
    (typeof AVAILABLE_MODELS !== 'undefined' ? AVAILABLE_MODELS : []).forEach(m => {
      const root = document.createElement('div');
      root.className = 'onb-step checking';
      root.innerHTML = `
        <div class="onb-step-row">
          <span class="onb-step-icon">+</span>
          <div class="onb-step-main">
            <div class="onb-step-title">${m.name} <span class="onb-step-badge">Checking…</span></div>
            <div class="onb-step-desc">${esc(m.desc || '')}</div>
          </div>
          <div class="onb-step-actions"></div>
        </div>
        <div class="onb-step-extra"></div>`;
      const actions = root.querySelector('.onb-step-actions');
      const extra   = root.querySelector('.onb-step-extra');
      const badge   = root.querySelector('.onb-step-badge');
      const log = document.createElement('div'); log.className = 'onb-log'; extra.appendChild(log);
      const step = { id: 'opt-' + m.id, detect: m.command, cmd: m.install };
      const installBtn = mkBtn('Install', 'primary', () => runInstall(step));
      actions.appendChild(installBtn);
      actions.appendChild(mkBtn('Re-check', '', () => recheck(step)));
      optEl.appendChild(root);
      els[step.id] = { root, badge, installBtn, log };
      ONB_STEPS_OPT.push(step);
    });
  }

  function iconFor(tool) {
    if (tool.icon) return tool.icon;
    const svg = document.querySelector(tool.sel + ' svg, ' + tool.sel + ' img');
    return svg ? svg.outerHTML : '<span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:block"></span>';
  }

  // ── Hover-to-locate: dim the panel and ring the real element ──────
  let ring = null;
  function locate(sel) {
    const el = sel && document.querySelector(sel);
    if (!el) { clearLocate(); return; }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { clearLocate(); return; }  // hidden right now
    modal.classList.add('locating');
    if (!ring) { ring = document.createElement('div'); ring.id = 'onb-locate-ring'; document.body.appendChild(ring); }
    ring.style.left   = (r.left - 6) + 'px';
    ring.style.top    = (r.top - 6) + 'px';
    ring.style.width  = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    ring.classList.add('show');
  }
  function clearLocate() {
    modal.classList.remove('locating');
    if (ring) ring.classList.remove('show');
  }

  function renderTools() {
    toolsEl.innerHTML = '';
    TOOL_SECTIONS.forEach(section => {
      const sec = document.createElement('div');
      sec.className = 'onb-tool-section';
      const head = document.createElement('div');
      head.className = 'onb-tool-section-head';
      head.textContent = section.title;
      sec.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'onb-tool-cards';
      section.tools.forEach(t => {
        const card = document.createElement('div');
        card.className = 'onb-tool';
        card.innerHTML = `<div class="onb-tool-icon">${iconFor(t)}</div>` +
          `<div class="onb-tool-main"><div class="onb-tool-name"></div><div class="onb-tool-desc"></div></div>` +
          `<button class="onb-tool-eye" title="Show where this is on screen">${EYE_ICON}</button>`;
        card.querySelector('.onb-tool-name').textContent = t.n;
        card.querySelector('.onb-tool-desc').textContent = t.d;
        // Locate only when hovering the eye — not the whole card
        const eye = card.querySelector('.onb-tool-eye');
        eye.addEventListener('mouseenter', () => locate(t.sel));
        eye.addEventListener('mouseleave', clearLocate);
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      toolsEl.appendChild(sec);
    });
  }

  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'onb-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  const ONB_STEPS_OPT = [];

  function detectAll() {
    return Promise.all([...ONB_STEPS, ...ONB_STEPS_OPT].map(recheck));
  }

  // Tabs
  modal.querySelectorAll('.onb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      clearLocate();
      modal.querySelectorAll('.onb-tab').forEach(t => t.classList.toggle('active', t === tab));
      modal.classList.toggle('tab-tools', tab.dataset.tab === 'tools');
      document.getElementById('onb-setup').style.display = tab.dataset.tab === 'setup' ? '' : 'none';
      document.getElementById('onb-tools').style.display = tab.dataset.tab === 'tools' ? '' : 'none';
    });
  });

  function close() {
    clearLocate();
    modal.classList.remove('open');
    ipcRenderer.send('onboarding-cancel');
    localStorage.setItem(LS.onboarded, '1');
  }
  document.getElementById('onb-close').addEventListener('click', close);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

  let built = false;
  openOnboarding = function() {
    if (!built) { renderSteps(); renderOptional(); renderTools(); built = true; }
    modal.classList.add('open');
    detectAll();
  };

  // First run
  if (!localStorage.getItem(LS.onboarded)) {
    setTimeout(() => openOnboarding(), 400);
  }
})();

// ── Code tab (Monaco read-only project viewer) ────────────────────
(function initCodeTab() {
  const emptyEl    = document.getElementById('code-empty');
  const mainEl     = document.getElementById('code-main');
  const treeEl     = document.getElementById('code-tree');
  const rootNameEl = document.getElementById('code-root-name');
  const pathEl     = document.getElementById('code-file-path');
  const welcomeEl  = document.getElementById('code-welcome');
  const editorEl   = document.getElementById('code-editor');
  const openBtn    = document.getElementById('code-open-folder');
  const refreshBtn = document.getElementById('code-refresh');
  const changeBtn  = document.getElementById('code-change-folder');
  if (!treeEl) return;

  let projectDir = '', monaco = null, editor = null, currentModel = null;
  let activeFileEl = null, firstActivation = true;
  let openRel = null, openName = null, openMtime = 0;
  const expanded = new Set();    // rel paths of expanded dirs (preserved across refreshes)
  const dirMtimes = new Map();   // rel dir -> last-seen mtimeMs (structural-change baseline)
  let pollTimer = null, polling = false, flashTimer = null;
  const updatedEl = document.getElementById('code-updated');

  const EXT_LANG = {
    js:'javascript', jsx:'javascript', mjs:'javascript', cjs:'javascript',
    ts:'typescript', tsx:'typescript', json:'json', jsonc:'json',
    html:'html', htm:'html', vue:'html', svelte:'html',
    css:'css', scss:'scss', sass:'scss', less:'less',
    md:'markdown', markdown:'markdown', py:'python', rb:'ruby', go:'go', rs:'rust',
    java:'java', c:'c', h:'c', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp',
    cs:'csharp', php:'php', sh:'shell', bash:'shell', zsh:'shell',
    yml:'yaml', yaml:'yaml', xml:'xml', svg:'xml', sql:'sql',
    toml:'ini', ini:'ini', conf:'ini', lua:'lua', swift:'swift', kt:'kotlin',
    dart:'dart', r:'r', pl:'perl', ps1:'powershell', bat:'bat', graphql:'graphql', gql:'graphql',
  };
  function langFor(name) {
    const base = name.toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
    if (base === 'makefile') return 'plaintext';
    const ext = base.includes('.') ? base.split('.').pop() : '';
    return EXT_LANG[ext] || 'plaintext';
  }
  function basename(p) {
    const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  const CHEV = chevronRightIcon(12);
  const FOLDER = `<svg class="code-ico" viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 5.25c0-.69.56-1.25 1.25-1.25h2.4c.4 0 .78.19 1.02.51l.66.88h5.92c.69 0 1.25.56 1.25 1.25v6.36c0 .69-.56 1.25-1.25 1.25H4c-.69 0-1.25-.56-1.25-1.25V5.25Z"/></svg>`;
  const FILE = `<svg class="code-ico" viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.25 1.75H5c-.69 0-1.25.56-1.25 1.25v12c0 .69.56 1.25 1.25 1.25h8c.69 0 1.25-.56 1.25-1.25V5.75l-4-4Z"/><path d="M10 1.9V6h4.1"/></svg>`;

  function loadMonaco() {
    return new Promise(resolve => {
      if (monaco) return resolve(monaco);
      if (!window.__amdRequire) return resolve(null);
      window.__amdRequire(['vs/editor/editor.main'], () => { monaco = window.monaco; resolve(monaco); });
    });
  }
  async function ensureEditor() {
    await loadMonaco();
    if (!monaco) return null;
    if (!editor) {
      editor = monaco.editor.create(editorEl, {
        value: '', language: 'plaintext', readOnly: true, theme: 'vs-dark',
        automaticLayout: true, fontSize: 12.5, lineHeight: 18,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        minimap: { enabled: true }, scrollBeyondLastLine: false, renderWhitespace: 'none',
      });
    }
    return editor;
  }

  function markActive(el) {
    if (activeFileEl) activeFileEl.classList.remove('active');
    activeFileEl = el; if (el) el.classList.add('active');
  }
  function showMessage(rel, msg) {
    pathEl.textContent = rel || 'No file selected';
    welcomeEl.querySelector('span').textContent = msg;
    welcomeEl.style.display = 'flex';
    editorEl.style.display = 'none';
  }

  function flashUpdated() {
    if (!updatedEl) return;
    updatedEl.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => updatedEl.classList.remove('show'), 1400);
  }

  async function showFile(rel, name, el) {
    markActive(el);
    openRel = rel; openName = name; openMtime = 0;
    pathEl.textContent = rel;
    const res = await ipcRenderer.invoke('code-read', { rel });
    if (!res || res.error)  { openRel = null; return showMessage(rel, res?.error || 'Could not open file'); }
    if (res.tooLarge)       { openRel = null; return showMessage(rel, 'File too large to preview (over 2 MB)'); }
    if (res.binary)         { openRel = null; return showMessage(rel, 'Binary file — preview unavailable'); }
    openMtime = res.mtimeMs || 0;
    welcomeEl.style.display = 'none';
    editorEl.style.display = 'block';
    const ed = await ensureEditor();
    if (ed) {
      const old = currentModel;
      currentModel = monaco.editor.createModel(res.content, langFor(name));
      ed.setModel(currentModel);
      ed.setScrollPosition({ scrollTop: 0 });
      if (old) old.dispose();
      requestAnimationFrame(() => ed.layout());
    }
  }

  // Re-read the open file in place when it changes on disk, preserving scroll/cursor.
  async function reloadOpenFile() {
    if (!openRel || !editor || !monaco) return;
    const rel = openRel;
    const res = await ipcRenderer.invoke('code-read', { rel });
    if (rel !== openRel) return;   // user switched files mid-read
    if (!res || res.error) { showMessage(rel, res?.error || 'File no longer available'); openRel = null; return; }
    if (res.binary || res.tooLarge) return;
    openMtime = res.mtimeMs || openMtime;
    const view = editor.saveViewState();
    const lang = currentModel ? currentModel.getLanguageId() : langFor(openName);
    const old = currentModel;
    currentModel = monaco.editor.createModel(res.content, lang);
    editor.setModel(currentModel);
    if (view) editor.restoreViewState(view);
    if (old) old.dispose();
    flashUpdated();
  }

  async function buildLevel(parentEl, rel, depth) {
    const res = await ipcRenderer.invoke('code-list', { rel });
    const entries = (res && res.entries) || [];
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const isDir = entry.type === 'dir';
      const row = document.createElement('div');
      row.className = 'code-row code-' + entry.type + (entry.ignored ? ' code-ignored' : '');
      row.style.paddingLeft = (8 + depth * 13) + 'px';
      row.innerHTML = (isDir ? `<span class="code-chev">${CHEV}</span>${FOLDER}`
                             : `<span class="code-chev"></span>${FILE}`)
                    + `<span class="code-row-name"></span>`;
      row.querySelector('.code-row-name').textContent = entry.name;
      parentEl.appendChild(row);
      if (isDir) {
        const kids = document.createElement('div');
        kids.className = 'code-children';
        kids.style.display = 'none';
        parentEl.appendChild(kids);
        let loaded = false;
        const setOpen = async (open) => {
          if (open) {
            row.classList.add('expanded'); kids.style.display = 'block'; expanded.add(childRel);
            if (!loaded) { loaded = true; await buildLevel(kids, childRel, depth + 1); }
          } else {
            row.classList.remove('expanded'); kids.style.display = 'none'; expanded.delete(childRel);
          }
        };
        row.addEventListener('click', () => setOpen(kids.style.display === 'none'));
        if (expanded.has(childRel)) await setOpen(true);   // restore expansion on rebuild
      } else {
        row.addEventListener('click', () => showFile(childRel, entry.name, row));
        if (openRel === childRel) markActive(row);
      }
    }
  }

  // Rebuild the tree, preserving expansion state and tree scroll position.
  async function buildTree() {
    const scrollTop = treeEl.scrollTop;
    treeEl.innerHTML = '';
    await buildLevel(treeEl, '', 0);
    if (!treeEl.children.length) treeEl.innerHTML = '<div class="code-tree-note">Empty folder</div>';
    treeEl.scrollTop = scrollTop;
  }

  // ── Live reload: poll mtimes of the open file + expanded dirs ──────
  // Polling (not fs.watch) because the agent edits inside WSL, and Windows
  // file-change events don't fire for the \\wsl.localhost share. stat() over
  // the share always reports current mtimes, so this stays reliable.
  async function poll() {
    if (polling || !projectDir || document.hidden) return;
    polling = true;
    try {
      const dirs = ['', ...expanded];
      const relAtPoll = openRel;   // snapshot: the user can switch files during the await
      const paths = relAtPoll ? [...dirs, relAtPoll] : dirs;
      const res = await ipcRenderer.invoke('code-poll', { paths });
      if (!res) return;
      // Open file: content edits bump the file's own mtime. Only act if the
      // open file is still the one this poll asked about.
      if (relAtPoll && relAtPoll === openRel) {
        const m = res[relAtPoll];
        if (m == null) { showMessage(relAtPoll, 'File no longer available'); openRel = null; }
        else if (openMtime && m !== openMtime) { await reloadOpenFile(); }
        else if (!openMtime) openMtime = m;
      }
      // Tree: create/delete/rename bumps the parent dir's mtime.
      let dirty = false;
      for (const d of dirs) {
        const m = res[d];
        if (m == null) { expanded.delete(d); dirMtimes.delete(d); dirty = true; continue; }
        const prev = dirMtimes.get(d);
        if (prev !== undefined && prev !== m) dirty = true;
        dirMtimes.set(d, m);
      }
      if (dirty) await buildTree();
    } catch (_) {} finally { polling = false; }
  }
  function startPoll() { if (!pollTimer) pollTimer = setInterval(poll, 1200); }
  function stopPoll()  { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  async function refresh() {
    projectDir = (await ipcRenderer.invoke('get-project-dir')) || '';
    if (!projectDir) {
      const saved = localStorage.getItem(LS.projectDir);
      if (saved) { ipcRenderer.send('set-project-dir', { dir: saved }); projectDir = saved; }
    }
    if (!projectDir) { stopPoll(); emptyEl.style.display = 'flex'; mainEl.style.display = 'none'; return; }
    emptyEl.style.display = 'none';
    mainEl.style.display = 'flex';
    rootNameEl.textContent = basename(projectDir);
    rootNameEl.title = projectDir;
    expanded.clear(); dirMtimes.clear();
    openRel = null; openName = null; openMtime = 0;
    showMessage('', 'Select a file to view it');
    await buildTree();
    startPoll();
  }

  async function pickFolder() {
    const dir = await ipcRenderer.invoke('pick-project-dir');
    if (dir) { localStorage.setItem(LS.projectDir, dir); await refresh(); }
  }

  openBtn?.addEventListener('click', pickFolder);
  changeBtn?.addEventListener('click', pickFolder);
  refreshBtn?.addEventListener('click', () => { if (projectDir) buildTree(); });

  window.__onCodeTabActive = function () {
    if (firstActivation || !projectDir) { firstActivation = false; refresh(); }
    else { if (editor) requestAnimationFrame(() => editor.layout()); startPoll(); }
  };
  window.__onCodeTabInactive = function () { stopPoll(); };
})();

// ── Ready ─────────────────────────────────────────────────────────
const _savedApiKey = localStorage.getItem(LS.apiKey);
if (_savedApiKey) ipcRenderer.send('set-api-key', _savedApiKey);
ipcRenderer.send('renderer-ready');
